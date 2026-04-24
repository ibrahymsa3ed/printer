# Printer — Technical Planning Document

**Target platform:** Windows 10/11 (x64) only for MVP. Architecture leaves room for macOS later via an alternate `PrintAdapter` implementation.
**Stack (locked):** Electron 29+, React 18, TypeScript, Vite, Tailwind CSS, Zustand, i18next, PDF.js.

---

## 0. Assumptions & Open Questions

Listed up front so they are easy to challenge.

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | App name is `Printer` for filesystem paths until a final name is chosen. | Rename touches `%APPDATA%` paths, registry keys, license validation strings. Pin the name before Phase 3. |
| A2 | Print shops mostly use A4/A3 paper, 80–120 gsm. Booklet output is primarily A4 saddle-stitched on A3 duplex. | Other paper sizes work but imposition presets target A4→A3 by default. |
| A3 | SumatraPDF can be bundled with the installer (its MPL-2.0 license allows redistribution). | If legal disallows bundling, fall back to "require install + detect", same flow as LibreOffice. |
| A4 | Users have admin rights during install (needed to register printers, install SumatraPDF if bundled). | Without admin, installer must be user-scoped; SumatraPDF goes to `%LOCALAPPDATA%`. |
| A5 | Windows print spooler service is running and healthy. We never talk to printers below the spooler. | If spooler is dead, all jobs fail with a clear "spooler not running" error; we do not try to recover automatically. |
| A6 | License activation happens once while briefly online, then machine works fully offline forever. | If truly air-gapped from minute zero, we need a manual activation key flow (covered under licensing). |

**Open questions to resolve before Phase 1 implementation:**
- Final app display name + reverse-DNS id (e.g. `com.petlab.printer`).
- Is there a priced SKU difference between perpetual and subscription licenses?
- What is the authoritative license-issuing server, and who owns the signing key?

---

## 1. Product Requirements (PRD)

### 1.1 Target user
Print-shop operators and small-business staff who print batches of mixed documents onto one or more physical printers, frequently as saddle-stitched booklets, primarily in Arabic-speaking environments.

### 1.2 Problem
Existing Windows print dialogs do not support: batch mixed-format input, parallel distribution across printers, reliable booklet imposition, or an RTL-first UI. Operators currently print files one at a time, re-configuring each time, and manually split copies across printers.

### 1.3 Goals (measured)
- **G1** Reduce time to queue a 20-file mixed batch from ~10 minutes (manual) to under 60 seconds.
- **G2** Zero-touch parallel execution: user clicks once, all selected printers fire.
- **G3** Correct booklet imposition, RTL-aware, verified against a known worked example (see §7).
- **G4** App launches, queues, and prints fully offline after activation.
- **G5** Recover cleanly from a mid-job crash: no silent data loss, user sees interrupted jobs on restart.

### 1.4 Non-goals (MVP)
- Cloud sync of jobs or settings.
- Mobile companion app.
- Finishing options beyond what SumatraPDF/driver supports (stapling, hole punch, stitching control).
- Print accounting / quotas / user roles.
- macOS support (architecture allows it; implementation is out of scope).

### 1.5 MVP feature set (Phase 1 only)
- Add PDF files to a queue.
- See list of system-installed printers.
- Print N copies of each file to one selected printer through SumatraPDF.
- Arabic RTL UI by default, with English toggle.
- Basic saddle-stitch booklet imposition on-demand.

### 1.6 Success criteria
- 100 consecutive jobs without a leaked child process or temp file.
- Parallel print to 3 printers completes in ≤ max(single-printer time) + 5% overhead.
- Booklet output matches the worked example in §7 byte-for-byte page-order.

---

## 2. System Architecture

### 2.1 Process model

Electron gives us three process types. We use all three with clear boundaries.

```
┌──────────────────────────── Electron App ────────────────────────────┐
│                                                                      │
│  ┌── Main process (Node) ──────────────────────────────────────────┐ │
│  │                                                                 │ │
│  │   Services:                                                     │ │
│  │   • JobManager          — orchestrates job lifecycle           │ │
│  │   • FileConverter       — calls LibreOffice soffice            │ │
│  │   • BookletImposer      — pdf-lib, pure fn in shared/          │ │
│  │   • PrinterRegistry     — enumerate + persist printers          │ │
│  │   • PrintAdapter        — interface                             │ │
│  │       └─ WindowsPrintAdapter  (SumatraPDF CLI)                  │ │
│  │   • TempManager         — lifecycle + cleanup                   │ │
│  │   • LicenseService      — signature verify, machine bind        │ │
│  │   • Store               — SQLite (better-sqlite3) + JSON        │ │
│  │   • IpcHub              — all renderer ↔ main traffic           │ │
│  │                                                                 │ │
│  │   Worker threads (node:worker_threads):                         │ │
│  │   • One per child print job (runs SumatraPDF spawn)             │ │
│  │   • File conversion worker pool (LibreOffice is single-instance,│ │
│  │     so this pool serializes conversions with a mutex)           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│         │ ipcMain.handle / webContents.send (typed via tRPC-like)    │
│         ▼                                                            │
│  ┌── Preload (contextBridge) ──────────────────────────────────────┐ │
│  │   Exposes window.api.{files, printers, jobs, license, i18n}     │ │
│  │   Nothing else. No nodeIntegration in renderer.                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│         │                                                            │
│         ▼                                                            │
│  ┌── Renderer (React + Vite) ──────────────────────────────────────┐ │
│  │   Features: FileQueue, PrinterList, JobMonitor, BookletPreview, │ │
│  │             Settings, LicenseScreen                             │ │
│  │   State: Zustand stores (filesStore, jobsStore, printersStore,  │ │
│  │           settingsStore, licenseStore)                          │ │
│  │   i18n: i18next, Arabic default, full RTL layout                │ │
│  │   PDF.js: booklet & file preview                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Source tree

```
printer/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/          # Node, Electron main process
│       │   │   ├── services/
│       │   │   ├── adapters/
│       │   │   │   ├── PrintAdapter.ts          (interface)
│       │   │   │   └── WindowsPrintAdapter.ts
│       │   │   ├── ipc/
│       │   │   ├── workers/
│       │   │   └── index.ts
│       │   ├── preload/
│       │   │   └── index.ts
│       │   └── renderer/
│       │       ├── features/
│       │       ├── stores/
│       │       ├── i18n/
│       │       ├── components/
│       │       └── App.tsx
│       ├── resources/         # bundled binaries (SumatraPDF), icons
│       └── electron.vite.config.ts
├── packages/
│   └── shared/                # Types + pure fns used by main AND renderer
│       ├── types/             # Job, Printer, Settings, License, ...
│       ├── booklet/           # pure imposition math
│       └── distribution/      # pure copy-split math
├── docs/
└── package.json               # pnpm workspaces
```

Rationale for the workspace: booklet math and distribution math are pure functions that both main (real work) and renderer (preview) call. Putting them in `packages/shared` makes them easy to unit-test in isolation and prevents drift.

### 2.3 IPC boundary

All IPC uses a typed request/response pattern. One file per domain.

| Channel | Direction | Payload | Response |
|---|---|---|---|
| `files:add` | renderer → main | `{ paths: string[] }` | `FileEntry[]` (with normalized PDF path if already cached) |
| `files:remove` | renderer → main | `{ id: string }` | `ok` |
| `printers:list` | renderer → main | — | `Printer[]` |
| `printers:addManual` | renderer → main | `ManualPrinterInput` | `Printer` |
| `jobs:create` | renderer → main | `JobDraft` | `Job` |
| `jobs:start` | renderer → main | `{ id }` | `ok` (events follow) |
| `jobs:cancel` | renderer → main | `{ id }` | `ok` |
| `jobs:event` | main → renderer | `JobEvent` (progress, status, error) | — |
| `license:status` | renderer → main | — | `LicenseStatus` |
| `license:activate` | renderer → main | `{ licenseText }` | `LicenseStatus` |

Rule: main process **never** trusts renderer data for file paths when resolving them on disk — it validates against the files it itself registered in the queue.

---

## 3. Data Models

Defined in `packages/shared/types`. These are the canonical shapes.

### 3.1 `FileEntry`
```ts
interface FileEntry {
  id: string;                  // UUID
  originalPath: string;        // absolute, validated on add
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: Date;

  // Conversion output (filled once converted)
  normalizedPdfPath: string | null;   // absolute path under temp dir
  pageCount: number | null;           // extracted from normalized PDF
  conversionStatus: 'pending' | 'converting' | 'ready' | 'failed';
  conversionError: string | null;

  sourceHash: string;          // sha256 of originalPath + mtime + size (used for temp reuse)
}
```

### 3.2 `Printer`
```ts
interface Printer {
  id: string;                  // stable: UUID for manual, hash(systemName) for system
  name: string;                // display name
  source: 'system' | 'manual';
  connection:
    | { type: 'os'; queueName: string }                       // system
    | { type: 'ipp'; host: string; port: number; path: string }
    | { type: 'raw'; host: string; port: number };            // manual

  capabilities: PrinterCapabilities | null;   // null = unknown, treat as "best effort"
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: Date;
}

interface PrinterCapabilities {
  paperSizes: string[];        // ['A4', 'A3', 'Letter', ...]
  supportsDuplex: boolean;
  supportsColor: boolean;
  maxCopies: number;           // many drivers cap at 999
  resolutions: number[];       // DPI values
}
```

Capability discovery on Windows: query `Get-PrintConfiguration` and WMI `Win32_Printer` via a short PowerShell script executed by `PrinterRegistry`. If both fail, `capabilities = null` and the UI falls back to "show all options, trust the driver".

### 3.3 `PrintSettings`
```ts
interface PrintSettings {
  copies: number;                       // 1..n
  pageRange: { from: number; to: number } | 'all';
  colorMode: 'color' | 'mono';
  orientation: 'portrait' | 'landscape';
  paperSize: string;                    // 'A4', 'A3', etc.
  duplex: 'none' | 'long-edge' | 'short-edge';
  collate: boolean;
  fitToPage: boolean;
}
```

Settings are validated against `capabilities` before a job starts. If a requested option is unsupported, the user sees a pre-flight warning with an auto-downgrade suggestion ("Duplex not supported → print single-sided?"). They confirm or cancel; we never silently strip.

### 3.4 `Job` and `ChildJob`
```ts
type JobStatus =
  | 'queued'        // created, waiting on conversion
  | 'preparing'     // converting files / imposing booklet
  | 'ready'         // files ready, waiting for start (if manual start) or dispatch
  | 'printing'      // at least one child is printing
  | 'done'          // all children succeeded
  | 'partial'       // some children succeeded, some failed
  | 'error'         // all children failed, or pre-flight failed
  | 'cancelled'
  | 'interrupted';  // app crashed mid-job; recoverable on restart

interface Job {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: JobStatus;

  files: { fileId: string; normalizedPdfPath: string; pageCount: number }[];
  bookletEnabled: boolean;
  bookletPdfPath: string | null;        // imposed output, one per job

  totalCopies: number;
  settingsSnapshot: PrintSettings;      // frozen copy taken at create-time

  selectedPrinterIds: string[];
  distribution: DistributionMap;        // printerId -> copies (see §6)
  children: ChildJob[];

  progress: number;                     // 0..1, aggregate
  error: string | null;
}

interface ChildJob {
  id: string;
  parentJobId: string;
  printerId: string;
  copies: number;

  status: 'queued' | 'printing' | 'done' | 'failed' | 'cancelled';
  attempts: number;                     // retried per printer
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  enginePid: number | null;             // SumatraPDF PID for cancel/kill
}
```

### 3.5 `License`
```ts
interface LicensePayload {
  machineId: string;            // bound — must match runtime machineId
  type: 'perpetual' | 'subscription';
  issuedAt: string;             // ISO
  expiresAt: string | null;     // null = perpetual
  features: string[];           // forward-compatible feature flags
  licenseeName: string;
}
interface LicenseFile {
  payload: LicensePayload;      // JSON
  signature: string;            // Ed25519, base64
}
```

### 3.6 Persistence

- **SQLite** (`better-sqlite3`) at `%APPDATA%/Printer/store.db` — tables: `jobs`, `child_jobs`, `file_entries`, `printers_manual`, `settings_profiles`. Chosen over flat JSON because job history and atomic updates during parallel execution matter.
- **JSON** for small/single-writer state: `settings.json` (UI prefs, LibreOffice path), `license.lic` (the signed blob), `printers_seen.json` (last-seen timestamps).

---

## 4. File Processing Pipeline

### 4.1 Pipeline stages

```
add → validate → hash → cached? → [if no] convert → verify PDF → extract pagecount → ready
                                                                                      ↓
                                                   [if booklet] impose → imposedPdf ready
                                                                                      ↓
                                                                              dispatch to print
```

### 4.2 Stage-by-stage

1. **Add** — user drops files. For each: verify the path exists and is readable, reject zero-byte files, reject unsupported extensions (MVP: `.pdf`, `.docx`, `.xlsx`, `.jpg`, `.jpeg`, `.png`, `.txt`).
2. **Hash** — compute `sha256(absolutePath || mtimeMs || sizeBytes)`. Cheap (no file content), stable across sessions, invalidates automatically when the file changes.
3. **Cache lookup** — `TempManager.findByHash(hash)`. If a normalized PDF exists and its `.meta.json` is valid, reuse it → skip conversion.
4. **Convert** (non-PDF only) — enqueue in the conversion worker. LibreOffice headless is a single-instance process; we serialize conversions via an async mutex inside the worker pool. Per-call timeout: 120 s. Output name: `{hash}.pdf` in `%APPDATA%/Printer/temp/{sessionId}/`.
5. **Verify PDF** — open with `pdf-lib` (or PDF.js in node). If fails to parse, mark `conversionStatus='failed'` with the parse error. No silent retry on parse failure — it almost always means a broken source.
6. **Extract page count** — from the verified PDF only. Never trust the original file's page count (DOCX page counts lie).
7. **Booklet impose** (opt-in per job) — pure function in `packages/shared/booklet`. Input: array of input PDFs + RTL flag. Output: one imposed PDF written to temp. See §7.
8. **Dispatch** — hand the final PDF path to `PrintAdapter.printFile(path, settings)`.

### 4.3 Conversion call shape

LibreOffice CLI (Windows):
```
"C:\Program Files\LibreOffice\program\soffice.exe" ^
  --headless --norestore --nologo --nofirststartwizard ^
  --convert-to pdf:writer_pdf_Export ^
  --outdir "<tempDir>" ^
  "<inputFile>"
```
Why `writer_pdf_Export`: deterministic PDF/A-ish output across DOCX/XLSX/TXT.

**Known failure modes** and how we handle them:
- Multiple `soffice` instances collide → serialize via mutex.
- Font substitution silently swaps Arabic fonts → document as a known limitation; allow user to install fonts system-wide.
- Huge XLSX files OOM `soffice` → 120 s timeout, kill process, mark conversion failed with a "file too large / unsupported" message.

### 4.4 Retry without reconversion

Temp files are keyed by hash, not by job. A retry of a failed *print* does not delete or regenerate the normalized PDF — it reuses it. A retry of a failed *conversion* deletes the partial `{hash}.pdf` and reruns. Both are safe because the hash encodes source-file state.

### 4.5 Crash recovery

On app startup, before the main window is shown:
1. `TempManager.scanOrphans()` — walk temp dirs, delete session dirs older than 7 days.
2. `Store.findJobs({ status: ['preparing','printing'] })` — these are jobs the previous run was in the middle of. Transition to `interrupted`.
3. Present the user with a "Previous session was interrupted — retry these jobs?" banner. Retry reuses cached PDFs (fast). Dismiss marks them `cancelled`.

Rule: we never silently resume printing on restart — that could re-print copies the user already picked up from the tray. User must confirm.

---

## 5. Printing Architecture

### 5.1 Abstraction

```ts
interface PrintAdapter {
  getInstalledPrinters(): Promise<Printer[]>;
  getPrinterCapabilities(printerId: string): Promise<PrinterCapabilities | null>;
  printFile(args: {
    filePath: string;
    printer: Printer;
    settings: PrintSettings;
    onProgress?: (p: number) => void;    // best effort; SumatraPDF gives little
    signal: AbortSignal;                  // for cancel → kill child process
  }): Promise<{ pid: number; exitCode: number }>;
}
```

MVP ships **only** `WindowsPrintAdapter`. A future `MacPrintAdapter` (using `lpr` + CUPS) can be swapped in without touching the job pipeline.

### 5.2 Print engine — SumatraPDF

**Command shape** (per child job):
```
SumatraPDF.exe -print-to "<PrinterName>" ^
               -print-settings "<setting,setting,...>" ^
               -silent ^
               "<normalized or imposed PDF path>"
```

**Settings string** (SumatraPDF syntax):
- `Nx` — number of copies (e.g. `5x`)
- `paper=A4` / `paper=A3` / `paper=letter`
- `color` / `monochrome`
- `portrait` / `landscape`
- `duplex` / `duplexshort` / `simplex`
- `fit` / `shrink` / `noscale`
- `odd` / `even` — page subset

Example for 5 copies, A4, color, duplex long-edge, fit:
```
-print-settings "5x,paper=A4,color,portrait,duplex,fit"
```

**Why SumatraPDF:**
- Non-interactive; reliable exit codes (`0` success, non-zero failure).
- Uses Windows spooler under the hood → we inherit spooler stability, queue, and driver compatibility.
- Fast, small binary, permissive license (MPL-2.0) — can be bundled.

**Limitations (call out clearly):**
- No granular progress — SumatraPDF returns only "done / failed" after the spooler accepts the job. "Progress" in the UI is really *dispatch progress*, not pages-printed progress.
- No stapling / finishing options.
- Feedback on printer-side failures (out of paper, jam) is lost — spooler sees the job as sent; user sees it as done in our UI. We document this.
- `-print-settings` string is fragile; unknown tokens are silently ignored. We validate our settings → string conversion in one place.

**Replacement path:** `WindowsPrintAdapter` is the only code that knows about SumatraPDF. Swapping to a native WinSpool binding (e.g. `node-win32-api` direct spooler calls) means rewriting one file. Everything above the adapter is engine-agnostic.

### 5.3 What we do NOT rely on

- **PowerShell-based printing** (`Out-Printer`, `Start-Process -Verb Print`) — only as a last-resort fallback for debugging, never primary. Slow and flaky with non-default settings.
- **ShellExecute `"print"` verb** — not primary. Relies on the file's registered handler, which is user-configurable and unpredictable.
- **Raw socket (port 9100)** — not primary. Breaks with encrypted printers, IPv6, driver-specific PJL; we leave it to the manual/advanced path only and off by default.

### 5.4 Printer sources

**Primary:** system-installed printers. Enumerated via WMI `Win32_Printer` at startup and on-demand. Each becomes a `Printer { source: 'system', connection: { type: 'os', queueName } }`.

**Secondary:** manual printers. User enters `host[:port]`, optional queue name, picks `IPP` or `RAW`. We validate:
- Resolvable hostname or valid IP.
- Port in `1..65535`, default 631 (IPP) / 9100 (RAW).
- TCP reachability test before saving (short timeout; failure is a warning, not a blocker — printer may just be off).

Manual printers persist in SQLite. They are **not** auto-installed to Windows. When the user picks a manual printer for a job, the adapter has two choices:
1. Use Windows' "Add Printer via IP" on the fly (requires admin, slow) — **not MVP**.
2. Route through SumatraPDF's CLI against a temporary OS-level printer that the user has pre-installed, OR fall back to IPP (`ipp://host:port/queue`) via a small native helper — **Phase 3**.

For Phase 1/2, manual printers are *stored but not printable* — the UI disables print for them with a "requires Phase 3 — IPP support" tooltip. This keeps the data model stable without shipping half-working code.

**Priority rules** when both sources contain the same device:
- System wins if the same queue name appears as a system printer AND a manual entry. We warn the user.
- Discovery (mDNS/IPP browsing) is explicitly *not* a primary mechanism — it's an optional helper button that suggests manual entries.

---

## 6. Multi-Printer Distribution & Parallel Execution

### 6.1 Distribution algorithm

Pure function `packages/shared/distribution/splitCopies.ts`:

```ts
export function splitCopies(
  totalCopies: number,
  printerIds: string[]
): DistributionMap {
  if (printerIds.length === 0) throw new Error('no printers');
  if (totalCopies < 1) throw new Error('copies < 1');

  const base = Math.floor(totalCopies / printerIds.length);
  const remainder = totalCopies % printerIds.length;

  return printerIds.reduce<DistributionMap>((acc, id, i) => {
    acc[id] = base + (i < remainder ? 1 : 0);
    return acc;
  }, {});
}
```

**Verification against the spec:**
- `splitCopies(10, [p1,p2])` → `{p1:5, p2:5}` ✓
- `splitCopies(10, [p1,p2,p3])` → `{p1:4, p2:3, p3:3}` ✓
- `splitCopies(5, [p1,p2])` → `{p1:3, p2:2}` ✓

Edge cases handled:
- `totalCopies=1, printers=3` → `{p1:1, p2:0, p3:0}`. We drop zero-copy children at dispatch time so no empty child jobs spawn.
- `totalCopies < printers.length` → the front printers print one each, the rest print nothing; again, zeros are pruned.

### 6.2 Parallel execution model

One Node `worker_threads` worker per child job is overkill — SumatraPDF is a child process already, and Node's event loop can easily `await Promise.all` across several `spawn` calls. We therefore:

- Spawn SumatraPDF via `child_process.spawn` in the main process.
- Track each spawn in a `Map<childJobId, ChildProcess>`.
- Use `Promise.allSettled` over the N children — one failing does not reject the whole batch.
- Progress events emitted on `spawn`, `stdout` chunk, and `exit`.

**Cancel** walks the map and sends `SIGKILL` (on Windows this is `TerminateProcess` via Node's `kill`). The spooler may still have queued pages — we document this and expose a "also purge Windows print queue for this printer" one-click helper.

**Failure isolation:**
- Child A fails → its `ChildJob.status = 'failed'`, job-level status becomes `'partial'` once all settle.
- Child B keeps running unaffected.
- Retry is per child: user clicks "retry" on a failed row → we re-spawn only that child, reusing the same PDF and settings.

### 6.3 Execution flow (end-to-end)

```
User clicks "Print"
  │
  ▼
JobManager.create(draft)              ← validates, creates Job in 'queued'
  │
  ▼
  preparing phase:
    FileConverter.ensureAll(job.files)    ← parallel where safe
    if booklet: BookletImposer.run(...)   ← writes bookletPdfPath
  │
  ▼
  ready phase:
    distribution = splitCopies(totalCopies, selectedPrinterIds)
    children     = buildChildJobs(job, distribution)
  │
  ▼
  printing phase:
    await Promise.allSettled(
      children.map(c => adapter.printFile({ ... c ... }))
    )
  │
  ▼
  finalize:
    status =  all ok           → 'done'
              any ok, any fail → 'partial'
              all fail         → 'error'
              cancelled        → 'cancelled'
    emit 'jobs:event' with final state; UI updates.
```

---

## 7. Booklet Imposition Algorithm

### 7.1 Rules (from spec)
- Output sheets print two input pages per side.
- Total input pages must be a multiple of 4. Pad with blank pages at the end if not.
- For `N` padded pages, `sheets = N / 4`.
- For each sheet `i` (0-based):
  - **Front**: left = `N - 2i`, right = `2i + 1`
  - **Back**:  left = `2i + 2`, right = `N - (2i + 1)`
- **RTL**: swap left/right on both sides so the binding is on the right.

### 7.2 Worked-example verification (N=8)

| Sheet | Side | Formula | LTR result | RTL (swapped) |
|---|---|---|---|---|
| 0 | Front | `[N−2i, 2i+1]` = `[8, 1]` | `[8, 1]` | `[1, 8]` |
| 0 | Back  | `[2i+2, N−(2i+1)]` = `[2, 7]` | `[2, 7]` | `[7, 2]` |
| 1 | Front | `[6, 3]` | `[6, 3]` | `[3, 6]` |
| 1 | Back  | `[4, 5]` | `[4, 5]` | `[5, 4]` |

Matches the spec exactly.

### 7.3 Further verification (N=12)

Sheets = 3.

| Sheet | Front [L, R] | Back [L, R] |
|---|---|---|
| 0 | `[12, 1]` | `[2, 11]` |
| 1 | `[10, 3]` | `[4, 9]` |
| 2 | `[8, 5]`  | `[6, 7]` |

Reading order when folded and stapled (LTR): 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12. ✓

### 7.4 Implementation (sketch, not code)

Pure function in `packages/shared/booklet/impose.ts`:
- Input: `{ inputPdfPaths: string[], rtl: boolean, outputPath: string }`.
- Merge all inputs into one logical page list (using `pdf-lib` `PDFDocument.copyPages`).
- Pad with blank pages to nearest multiple of 4.
- Create an output PDF where each page is double-width (e.g., A3 if source is A4).
- For each sheet: place `front.left`, `front.right` onto one output page; `back.left`, `back.right` onto the next output page. RTL swaps positions.
- Write output.

**Printing the booklet:**
- Single-side printers: print all fronts first, reload stack flipped, print all backs. We detect this via `capabilities.supportsDuplex` and show the user the reload prompt.
- Duplex printers: we set `duplex=short-edge` (the binding runs through the short edge in a saddle-stitched booklet) and print in one pass.

### 7.5 Known limitations
- Mixed paper sizes across input files → we impose at the size of the first input, centered; sizes differ → user sees a warning before imposition runs.
- PDFs with encryption → pdf-lib can't copy; we fail the booklet with "source PDF is protected".

---

## 8. Booklet Preview

### 8.1 Goal
Show the user, before they commit to a job, exactly what each printed sheet will look like — front and back, with correct LTR/RTL orientation.

### 8.2 How it's generated
- We never re-impose in the renderer — that would risk drift between preview and print output. Instead, after `BookletImposer.run(...)` finishes, the renderer loads the *actual imposed PDF* via PDF.js and renders it page by page.
- One UI "sheet" = two PDF.js pages (front + back).

### 8.3 UI controls
- Sheet navigation: `← sheet 1 / N →` (arrow keys, buttons).
- Toggle front/back view within a sheet.
- Toggle LTR / RTL preview to sanity-check binding orientation (changing this triggers re-imposition; we cache both).
- Zoom with `+` / `-`.

### 8.4 RTL handling in preview
The imposed PDF itself already has pages in the correct order for the chosen binding direction. The preview just displays them; no extra mirroring in the renderer. The preview *frame chrome* (navigation, labels) follows the UI's current language direction.

---

## 9. Print Settings — Validation & Fallbacks

### 9.1 Validation

On `jobs:create`, we validate `PrintSettings` against every selected printer's `capabilities`.

| Setting | Validation |
|---|---|
| `copies` | `1 ≤ n ≤ capabilities.maxCopies ?? 999` |
| `pageRange` | `from ≥ 1`, `to ≤ file.pageCount`, `from ≤ to`; we split the range internally if needed |
| `colorMode='color'` | must have `capabilities.supportsColor` or `capabilities === null` |
| `paperSize` | must be in `capabilities.paperSizes` or `capabilities === null` |
| `duplex ≠ 'none'` | must have `capabilities.supportsDuplex` or `capabilities === null` |
| `orientation` | always allowed |
| `collate`, `fitToPage` | always allowed (SumatraPDF handles) |

### 9.2 Fallback behavior
- **Unknown capabilities**: trust the driver; show a one-time "capabilities unknown" banner.
- **Conflict detected**: block job creation with a clear message + one-click "adjust" suggestion (e.g. "Printer X does not support color → switch to mono for this job?").
- We never silently strip or substitute a setting.

---

## 10. Localization

### 10.1 Languages
- Arabic (default, RTL).
- English (LTR).

### 10.2 Mechanism
- `i18next` with one JSON file per language at `apps/desktop/src/renderer/i18n/{ar,en}.json`.
- React components use `useTranslation()` from `react-i18next`.
- Layout direction: `<html dir="rtl">` / `<html dir="ltr">` set at boot and on language change.
- Tailwind: `tailwindcss-rtl` plugin provides `ltr:` / `rtl:` variants; we prefer logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`) over physical ones to keep components direction-agnostic.

### 10.3 Numerals
- Optional "Arabic-Indic digits" toggle (`٠١٢…`). When on, all numeric displays use `Intl.NumberFormat('ar-EG')`.
- Off by default even in Arabic UI (print-shop operators usually prefer Western digits for counts).

### 10.4 Persistence
- `settings.json { language: 'ar' | 'en', arabicDigits: boolean }`.
- Changes take effect immediately without a restart (i18next + `document.dir` reassignment + Zustand broadcast).

### 10.5 What is NOT localized in MVP
- SumatraPDF error strings bubbled from the engine (we label them, don't translate).
- License file error strings from the verifier (technical; we show a stable error code + localized summary).

---

## 11. Licensing (High-Level)

### 11.1 Shape
- Offline, file-based, signed.
- Ed25519 key pair. Private key is held by PETLAB (server / ops). Public key is embedded in the app binary.
- Two license types: `perpetual` (no expiry) and `subscription` (with `expiresAt`).
- License is machine-bound via a stable `machineId`.

### 11.2 Machine ID
- Derived as `sha256(cpuId || primaryMacAddress || windowsInstallId)` where:
  - `cpuId` = first CPU's ProcessorId from WMI.
  - `primaryMacAddress` = the MAC of the default-route adapter at install time, cached (so Wi-Fi swaps don't invalidate the license).
  - `windowsInstallId` = `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProductId`.
- Cached at first launch in `%APPDATA%/Printer/machine.id` so subsequent hardware changes (e.g. NIC swap) don't break the binding until the user intentionally reactivates.

### 11.3 License file
```json
{
  "payload": {
    "machineId": "sha256-hex…",
    "type": "subscription",
    "issuedAt": "2026-04-24T10:00:00Z",
    "expiresAt": "2027-04-24T10:00:00Z",
    "features": ["multi-printer", "booklet"],
    "licenseeName": "PetLab Main Branch"
  },
  "signature": "base64-ed25519-signature-of-canonical(payload)"
}
```
Stored as `%APPDATA%/Printer/license.lic`.

### 11.4 Validation flow (on every launch)
1. Load `license.lic`. If missing → app boots into License Screen only.
2. Verify `signature` over the canonicalized `payload` with the embedded public key. If invalid → License Screen with clear error.
3. Compute runtime `machineId`. If it doesn't match `payload.machineId` → License Screen; suggest "reactivate on this machine".
4. If subscription and `expiresAt < now` → check grace period (see below). On miss → License Screen.
5. All checks pass → grant feature access based on `payload.features`.

### 11.5 Grace period
- Subscription licenses get a 7-day soft-expiry window: app still works, a banner warns the user, and after 7 days full block.
- Perpetual licenses never expire.

### 11.6 Activation flow
- **Online (at install time)**: user enters an activation code → app posts `{code, machineId}` to the license server → server returns signed `license.lic` → app writes it.
- **Fully offline**: PETLAB support generates a `license.lic` for the user's machineId (shown on the License Screen) and sends it by any channel → user imports the file.

### 11.7 Out of scope (explicitly)
- Anti-tamper / obfuscation / runtime integrity checks. We do not claim crack-proof; we claim auditable and reasonable.
- License revocation lists (no CRL in an offline app; we rely on expiry).
- Multi-seat / floating licenses.

### 11.8 License Screen (minimum UI)
- Machine ID (copyable, monospace).
- License type and licensee.
- Status badge: Active / Expiring in N days / Expired / Not activated / Invalid.
- Expiry date (if subscription).
- Import license file (file picker) / paste license text.
- "Reactivate" button (only when status ≠ Active).

---

## 12. Temp File Management

### 12.1 Layout
```
%APPDATA%/Printer/
├── temp/
│   ├── {sessionId}/                ← per-process-launch
│   │   ├── {hash}.pdf              ← normalized PDF for a source file
│   │   ├── {hash}.meta.json        ← source path, mtime, size, convertedAt
│   │   └── booklets/
│   │       └── {jobId}.pdf         ← imposed output
```

### 12.2 Lifecycle

| Event | Action |
|---|---|
| App start | `TempManager.cleanupOrphans()` — delete session dirs older than 7 days, delete meta-less PDFs, delete PDFs with invalid metadata. |
| File added | If cached for hash → reuse. Else → prepare an empty `{hash}.pdf.partial` slot; conversion writes there, atomically renames on success. |
| Conversion succeeds | Write `.meta.json` with source info. |
| Conversion fails | Delete `.partial` file. No `.meta.json` written → never treated as cached. |
| Job done (success or partial) | Mark session + booklet PDF for "keep 24h" so the user can retry without re-converting. |
| Job cancelled | Same as done — we keep. |
| User explicitly clicks "Clear queue" | Delete session dir immediately. |
| Disk low warning from OS | Cleanup oldest sessions until free space is above threshold. |

### 12.3 Handling incomplete/corrupt temp files
- `.partial` files without a matching `.meta.json` → delete on startup.
- `.pdf` files that fail `pdf-lib` open → delete + treat as uncached on next add.
- `.meta.json` without matching `.pdf` → delete the json.

### 12.4 Why per-session dirs
- Isolates the current run from history — a crash can never overwrite another run's cached files.
- Cleanup is `rm -rf {sessionId}/` instead of per-file bookkeeping.

---

## 13. LibreOffice Integration

### 13.1 Requirement
LibreOffice is required for **Phase 2** (non-PDF conversion). Not bundled in MVP — too large and versioning is fragile.

### 13.2 Detection strategy (in order)
1. `where soffice.exe` on `PATH`.
2. `HKLM\SOFTWARE\LibreOffice\UNO\InstallPath` and `HKCU\...` (registry).
3. Hard-coded common paths: `C:\Program Files\LibreOffice\program\soffice.exe`, `C:\Program Files (x86)\LibreOffice\program\soffice.exe`.
4. User-configured override in `settings.json` (`libreOfficePath`).

Detection runs on first non-PDF add in a session and on every settings screen visit. Result is cached for the session.

### 13.3 Missing-install flow
- Adding a non-PDF file with LibreOffice missing → file's `conversionStatus` becomes `failed` with error `'LIBREOFFICE_MISSING'`.
- UI shows: "Install LibreOffice to print Word/Excel files" + a "Download" button (opens the official LibreOffice download page in the user's browser — we do not silently download binaries) + a "I already have it, browse…" button for manual path configuration.

### 13.4 Fallback
- If LibreOffice is missing or unreachable, we **do not** attempt alternative conversion paths in MVP (no Office COM, no cloud API). File is marked failed; PDFs in the batch still print normally.

---

## 14. Failure Handling Strategy

| Failure | Detection | User-visible behavior | Recovery |
|---|---|---|---|
| Conversion failed (bad source) | `pdf-lib` parse error, or soffice exit ≠ 0 | File row shows error with code | User removes file or replaces it |
| LibreOffice missing | Detection step yields nothing | Banner + per-file error `LIBREOFFICE_MISSING` | User installs / sets path |
| Booklet imposition failed | Exception from `BookletImposer.run` | Job aborts pre-dispatch with reason | User fixes source (encryption, size mismatch) or disables booklet |
| Printer offline at start | WMI / spooler check before spawn | Pre-flight warning: "Printer X is offline — proceed anyway?" | User confirms or removes printer |
| Printer disconnected mid-print | SumatraPDF exit ≠ 0, or spawn error | Child job status `failed` with error | Other children continue; user retries that child only |
| Partial success | At least one child succeeded, one failed | Job status `partial`, banner shows which printers failed | Retry per-printer, reuses cached PDF |
| Cancel request | User clicks cancel | All SumatraPDF PIDs killed; job status `cancelled` | User can optionally purge Windows spooler queue (one-click) |
| App crash mid-print | Next launch sees `status='printing'` in SQLite | "Previous session was interrupted" banner | User retries or dismisses (dismiss = mark cancelled) |
| Disk full during conversion | Write fails | Conversion fails with `DISK_FULL` | User frees space; we offer one-click temp cleanup |
| Spooler service down | WMI query fails systemically | Global error: "Windows Print Spooler is not running" | We show how to restart it; do not auto-restart (requires admin) |

**Design principle:** no silent recovery. Every failure surfaces in the UI with an error code + human message + at least one action the user can take.

---

## 15. Risks & Limitations

1. **SumatraPDF progress fidelity** — we can't show true "page 3 of 10" progress. UX mitigation: show dispatch states (converting → sending → in printer's hands) rather than fake progress bars.
2. **LibreOffice as an external dependency** — out of our control. Version drift can cause subtle output differences. Mitigation: support manual path config + document minimum version.
3. **Arabic fonts in non-PDF conversion** — LibreOffice will substitute missing fonts silently. Mitigation: document the requirement to install Arabic fonts (Cairo, Amiri, etc.) system-wide; add a font-check helper in Phase 2.
4. **Manual printers (IPP/RAW) — deferred to Phase 3** — MVP ships with them stored-but-not-printable. Clearly label in UI so users are not surprised.
5. **Mid-print reconciliation impossible** — once the spooler accepts a job, we have no reliable way to know if the physical printer actually printed it. This is a Windows limitation, not ours. We document it.
6. **License binding rigidity** — hardware changes (new motherboard) invalidate a machine-bound license. Mitigation: 1-click "reactivate" flow in the License Screen + lenient machineId derivation that tolerates MAC changes.
7. **Electron app size** — expect ~180 MB installer with bundled SumatraPDF. Acceptable for desktop but worth flagging.
8. **No true admin privilege escalation in-app** — things like "install a new printer driver" fail silently if the user isn't admin. Mitigation: detect and show a clear "run as administrator" prompt.

---

## 16. Phase Roadmap

### Phase 1 — MVP (core printing loop)
Scope:
- PDF-only file queue (no conversion).
- System-installed printers only (no manual).
- Single printer at a time (no split).
- Basic booklet imposition (pure function + preview).
- Arabic RTL UI with English toggle.
- Per-job settings (copies, color, orientation, paper size, duplex, fit).
- SumatraPDF as the print engine (bundled).
- SQLite job history with crash recovery.

**Exit criteria:** 100 consecutive single-printer jobs without a temp-file or process leak. Booklet output matches spec for N=8, 12, 24.

### Phase 2 — Format support & distribution
Scope:
- Non-PDF conversion via LibreOffice (detection, missing-install flow).
- Multi-printer split with parallel execution.
- Settings profiles (save/load named `PrintSettings`).
- Per-file page range.
- Retry-per-child-job UI.

**Exit criteria:** Parallel print to 3 printers finishes within `max(single) + 5%`. DOCX/XLSX/JPG/PNG/TXT all convert and print end-to-end.

### Phase 3 — Network & licensing polish
Scope:
- Manual printers over IPP (primary), RAW (secondary).
- Optional mDNS/IPP discovery helper.
- Full licensing: activation flow, machine-ID UI, grace period, reactivation.
- Booklet preview with front/back/RTL toggles.
- Localization polish (Arabic-Indic digits toggle).

**Exit criteria:** Fully offline activation works from a fresh install. IPP printing succeeds against at least two printer brands in the shop.

### Post-roadmap candidates (explicitly deferred)
- macOS port via `MacPrintAdapter`.
- Finishing options (stapling, hole punch) — driver-dependent, complex.
- Job history export (CSV / PDF report).
- Multi-user profiles on shared machines.

---

## 17. Verification plan (how we know it works)

- **Unit tests** on pure functions: `splitCopies`, booklet imposition math, settings→SumatraPDF string serializer, machineId derivation.
- **Integration tests** with a mock `PrintAdapter` that records spawn calls — assert correct distribution and settings for canonical scenarios.
- **Golden-file tests** for booklet imposition: run for N∈{4,8,12,16,24}, compare output page order to hand-verified tables.
- **Smoke test on real hardware** per phase exit: one physical printer minimum for Phase 1; two for Phase 2; three across brands for Phase 3.
- **Crash-recovery drill**: kill the app with `taskkill /F` mid-job, relaunch, verify the "interrupted" flow.
