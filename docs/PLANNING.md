# `<AppName>` — Technical Planning Document

> `<AppName>` is a placeholder. Replace with the final product name (display + reverse-DNS id) once chosen. All filesystem paths, registry keys, license strings, and branding references below use `<AppName>` deliberately.

**Target platform:** Windows 10/11 (x64) only for MVP. Architecture leaves room for macOS later via an alternate `PrintAdapter` implementation.
**Stack (locked):** Electron 29+, React 18, TypeScript, Vite, Tailwind CSS, Zustand, i18next, PDF.js.

---

## 0. Assumptions & Open Questions

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | Final app name is pending. All paths, ids, and branding use `<AppName>` until locked. | Late rename is mechanical (string replace) but touches `%APPDATA%` paths, license strings, installer ids. Lock before Phase 1.5 ships externally. |
| A2 | Print shops use A4/A3 paper, 80–120 gsm. Booklets are primarily A4 saddle-stitched on A3 duplex. | Other sizes work; imposition presets target A4→A3 by default. |
| A3 | SumatraPDF can be bundled with the installer (MPL-2.0 allows redistribution). | If legal disallows bundling, fall back to "require install + detect." |
| A4 | Users have admin rights at install time. | Without admin, installer becomes user-scoped; SumatraPDF goes under `%LOCALAPPDATA%`. |
| A5 | Windows print spooler is running. We never talk to printers below the spooler. | If spooler is dead, jobs fail with a clear error; we do not auto-restart. |
| A6 | License activation happens once while briefly online, then the machine works fully offline. | If truly air-gapped from minute zero, use the manual `.lic` import flow. |

**Open questions to resolve before Phase 1.5 ships externally:**
- Final `<AppName>` (display name + reverse-DNS id, e.g. `com.<vendor>.<product>`).
- License-issuer identity and key-custody process (who holds and rotates the private Ed25519 key).
- Priced SKU split between perpetual and subscription.

---

## 1. Product Requirements (PRD)

### 1.1 Target user
Print-shop operators and small-business staff who print batches of mixed documents to one or more physical printers, frequently as saddle-stitched booklets, primarily in Arabic-speaking environments.

### 1.2 Problem
Windows' built-in print UX cannot: handle mixed-format batches, split copies across multiple printers in parallel, produce reliable booklet imposition, or present an RTL-first Arabic UI. Operators currently print files one at a time and manually split copies across printers.

### 1.3 Goals (measured)
- **G1** Reduce time to queue a 20-file batch from ~10 minutes (manual) to under 60 seconds.
- **G2** Zero-touch parallel execution: one click → all selected printers fire concurrently.
- **G3** Correct booklet imposition, RTL-aware, verified against worked examples (§7).
- **G4** App runs fully offline after activation.
- **G5** Clean recovery from a mid-job crash — no silent data loss, user sees interrupted jobs on restart.

### 1.4 Non-goals (MVP)
Cloud sync, mobile companion, finishing beyond driver capabilities (staple/hole-punch), print accounting, multi-seat roles, macOS support.

### 1.5 The **sellable MVP** (Phase 1.5 — "Commercial Minimum")
A build worth selling must include all five:

1. **PDF printing** via SumatraPDF.
2. **Booklet mode** — imposition + basic preview.
3. **Arabic-first RTL UI** (with English toggle).
4. **Multi-printer copy splitting** — one job, N printers, copies distributed.
5. **Parallel execution** — all printers fire concurrently; per-printer status; per-printer retry.

Anything shipped without these five is an internal proof step, not a sellable product.

### 1.6 Success criteria for the sellable MVP
- 100 consecutive multi-printer jobs with no leaked child process or temp file.
- Parallel print to 3 printers completes in ≤ `max(single-printer time) × 1.05`.
- Booklet output matches the worked examples in §7 byte-for-byte page-order.
- Any single printer failing in a multi-printer job leaves the others running and the failed one retryable in isolation.

---

## 2. System Architecture

### 2.1 Process model

```
┌──────────────────────────── Electron App ────────────────────────────┐
│  ┌── Main process (Node) ──────────────────────────────────────────┐ │
│  │   Services:                                                     │ │
│  │   • JobManager          — job + child-job lifecycle            │ │
│  │   • FileConverter       — LibreOffice soffice (Phase 2)        │ │
│  │   • BookletImposer      — pdf-lib, pure fn in shared/          │ │
│  │   • PrinterRegistry     — enumerate installed printers          │ │
│  │   • PrintAdapter        — interface                             │ │
│  │       └─ WindowsPrintAdapter  (SumatraPDF CLI)                  │ │
│  │   • TempManager         — lifecycle + cleanup                   │ │
│  │   • LicenseService      — signature verify, machine bind        │ │
│  │   • Store               — SQLite (better-sqlite3) + JSON        │ │
│  │   • IpcHub              — all renderer ↔ main traffic           │ │
│  │                                                                 │ │
│  │   Concurrency:                                                  │ │
│  │   • Child print jobs run via child_process.spawn, tracked in    │ │
│  │     a Map<childJobId, ChildProcess>; Promise.allSettled         │ │
│  │     across all children of a parent job.                        │ │
│  │   • LibreOffice conversion serialized behind an async mutex     │ │
│  │     (soffice is effectively single-instance).                   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│         │ typed ipcMain.handle / webContents.send                    │
│         ▼                                                            │
│  ┌── Preload (contextBridge) ──────────────────────────────────────┐ │
│  │   Exposes window.api.{files, printers, jobs, license, i18n}     │ │
│  │   No nodeIntegration in renderer.                               │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│         │                                                            │
│         ▼                                                            │
│  ┌── Renderer (React + Vite) ──────────────────────────────────────┐ │
│  │   Features: FileQueue, PrinterList, JobMonitor,                 │ │
│  │             BookletPreview, Settings, LicenseScreen             │ │
│  │   State: Zustand (filesStore, jobsStore, printersStore,         │ │
│  │          settingsStore, licenseStore)                           │ │
│  │   i18n: i18next, Arabic default, full RTL                       │ │
│  │   PDF.js: booklet + file preview                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Source tree

```
<repo>/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   │   ├── services/
│       │   │   ├── adapters/
│       │   │   │   ├── PrintAdapter.ts          (interface)
│       │   │   │   └── WindowsPrintAdapter.ts
│       │   │   ├── ipc/
│       │   │   └── index.ts
│       │   ├── preload/
│       │   └── renderer/
│       │       ├── features/
│       │       ├── stores/
│       │       ├── i18n/
│       │       ├── components/
│       │       └── App.tsx
│       ├── resources/         # bundled SumatraPDF, icons
│       └── electron.vite.config.ts
├── packages/
│   └── shared/
│       ├── types/             # Job, Printer, Settings, License
│       ├── booklet/           # pure imposition math
│       └── distribution/      # pure copy-split math
├── docs/
└── package.json               # pnpm workspaces
```

`packages/shared` holds pure functions used by both main (real work) and renderer (preview). Keeps the booklet math and split math testable in isolation and prevents drift between preview and print output.

### 2.3 IPC boundary

| Channel | Direction | Payload | Response |
|---|---|---|---|
| `files:add` | renderer → main | `{ paths: string[] }` | `FileEntry[]` |
| `files:remove` | renderer → main | `{ id }` | `ok` |
| `printers:list` | renderer → main | — | `Printer[]` |
| `jobs:create` | renderer → main | `JobDraft` | `Job` |
| `jobs:start` | renderer → main | `{ id }` | `ok` (events follow) |
| `jobs:cancel` | renderer → main | `{ id }` | `ok` |
| `jobs:retryChild` | renderer → main | `{ childJobId }` | `ok` |
| `jobs:event` | main → renderer | `JobEvent` (progress, status, error) | — |
| `license:status` | renderer → main | — | `LicenseStatus` |
| `license:activate` | renderer → main | `{ licenseText }` | `LicenseStatus` |

Rule: main never trusts renderer-supplied paths. It only operates on files it registered itself in the queue.

---

## 3. Data Models

Defined in `packages/shared/types`.

### 3.1 `FileEntry`
```ts
interface FileEntry {
  id: string;                        // UUID
  originalPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: Date;
  normalizedPdfPath: string | null;  // under temp dir
  pageCount: number | null;
  conversionStatus: 'pending' | 'converting' | 'ready' | 'failed';
  conversionError: string | null;
  sourceHash: string;                // sha256 of path + mtime + size (for temp reuse)
}
```

### 3.2 `Printer`
```ts
interface Printer {
  id: string;                         // hash(systemQueueName) — stable across restarts
  name: string;
  source: 'system';                   // Phase 1.5 MVP only exposes system printers
  connection: { type: 'os'; queueName: string };
  capabilities: PrinterCapabilities | null;   // null = unknown, driver handles
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: Date;
}

interface PrinterCapabilities {
  paperSizes: string[];
  supportsDuplex: boolean;
  duplexModes: ('long-edge' | 'short-edge')[];  // driver-reported; may be empty
  supportsColor: boolean;
  maxCopies: number;
  resolutions: number[];
}
```

The `Printer` type is forward-compatible with Phase 3's `source: 'manual'` via a union, but Phase 1.5 only populates `source: 'system'`.

### 3.3 `PrintSettings`
```ts
interface PrintSettings {
  copies: number;
  pageRange: { from: number; to: number } | 'all';
  colorMode: 'color' | 'mono';
  orientation: 'portrait' | 'landscape';
  paperSize: string;
  duplex: 'none' | 'long-edge' | 'short-edge';
  collate: boolean;
  fitToPage: boolean;
}
```

### 3.4 `Job` and `ChildJob`
```ts
type JobStatus =
  | 'queued' | 'preparing' | 'ready' | 'printing'
  | 'done' | 'partial' | 'error' | 'cancelled' | 'interrupted';

interface Job {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: JobStatus;

  files: { fileId: string; normalizedPdfPath: string; pageCount: number }[];
  bookletEnabled: boolean;
  bookletPdfPath: string | null;

  totalCopies: number;
  settingsSnapshot: PrintSettings;       // frozen at create time
  selectedPrinterIds: string[];
  distribution: Record<string, number>;  // printerId → copies

  children: ChildJob[];                  // always one per distributed printer
  progress: number;                      // 0..1
  error: string | null;
}

interface ChildJob {
  id: string;
  parentJobId: string;
  printerId: string;
  copies: number;
  status: 'queued' | 'printing' | 'done' | 'failed' | 'cancelled';
  attempts: number;                      // retries per printer
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  enginePid: number | null;              // SumatraPDF PID for cancel
}
```

Every printer selected by the user becomes one `ChildJob`. Single-printer jobs still produce exactly one child — keeping the code path uniform simplifies retry, cancel, and UI rendering.

### 3.5 `License`
```ts
interface LicensePayload {
  machineId: string;
  type: 'perpetual' | 'subscription';
  issuedAt: string;          // ISO
  expiresAt: string | null;  // null = perpetual
  features: string[];
  licenseeName: string;
}
interface LicenseFile {
  payload: LicensePayload;   // JSON
  signature: string;         // Ed25519, base64
}
```

### 3.6 Persistence

- **SQLite** (`better-sqlite3`) at `%APPDATA%/<AppName>/store.db` — tables: `jobs`, `child_jobs`, `file_entries`, `settings_profiles`. Atomic updates during parallel execution are the decisive reason over flat JSON.
- **JSON** for small single-writer state: `settings.json`, `license.lic`, `printers_seen.json`.

---

## 4. File Processing Pipeline

### 4.1 Stages

```
add → validate → hash → cached? → [no] convert → verify PDF → extract pagecount → ready
                                                                                   ↓
                                         [if booklet] impose → imposed PDF  ready
                                                                                   ↓
                                                                           dispatch
```

### 4.2 Stage details

1. **Add** — verify readability, reject zero-byte, reject unsupported extensions. MVP accepts `.pdf` only; Phase 2 adds `.docx`, `.xlsx`, `.jpg`, `.jpeg`, `.png`, `.txt`.
2. **Hash** — `sha256(absolutePath || mtimeMs || sizeBytes)`. No file-content read; invalidates automatically when the source changes.
3. **Cache lookup** — `TempManager.findByHash(hash)` → reuse normalized PDF if present + valid `.meta.json`.
4. **Convert** (Phase 2, non-PDF only) — enqueue in the conversion worker behind an async mutex; per-call timeout 120 s. Output at `%APPDATA%/<AppName>/temp/{sessionId}/{hash}.pdf`.
5. **Verify PDF** — open with `pdf-lib`. Parse failure → `conversionStatus='failed'`. No silent retry; it means a broken source.
6. **Extract page count** — from the verified PDF only. DOCX page counts lie.
7. **Booklet impose** (opt-in) — pure function in `packages/shared/booklet`. Writes one imposed PDF per job. See §7.
8. **Dispatch** — `PrintAdapter.printFile(path, settings)`.

### 4.3 Retry without reconversion

Temp files key by hash, not by job. Retrying a failed *print* reuses the normalized PDF. Retrying a failed *conversion* deletes the partial `{hash}.pdf` and reruns — safe because the hash encodes source state.

### 4.4 Crash recovery

On startup, before window show:
1. `TempManager.cleanupOrphans()` — delete session dirs older than 7 days, orphaned `.meta.json`, orphaned `.partial`.
2. `Store.findJobs({ status: ['preparing','printing'] })` → transition to `interrupted`.
3. User sees a "Previous session was interrupted — retry these jobs?" banner. Retry reuses cached PDFs (fast). Dismiss marks them `cancelled`.

We never silently resume printing on restart — that could re-print copies already picked up from the tray.

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
    onProgress?: (p: number) => void;   // best effort
    signal: AbortSignal;                // cancel → kill child process
  }): Promise<{ pid: number; exitCode: number }>;
}
```

MVP ships **only** `WindowsPrintAdapter`. A future `MacPrintAdapter` (CUPS/`lpr`) slots in without changes above the adapter.

### 5.2 Print engine — SumatraPDF

**Command shape** (per child job):
```
SumatraPDF.exe -print-to "<PrinterName>" ^
               -print-settings "<setting,setting,...>" ^
               -silent ^
               "<normalized or imposed PDF path>"
```

**Settings tokens:** `Nx` (copies), `paper=A4|A3|letter`, `color|monochrome`, `portrait|landscape`, `duplex|duplexshort|simplex`, `fit|shrink|noscale`, `odd|even`.

**Why SumatraPDF:**
- Non-interactive; reliable exit codes.
- Uses Windows spooler → inherits driver compatibility and queue stability.
- Small, fast, permissively licensed (MPL-2.0).

**Limitations (called out clearly):**
- **No granular progress** — only done/failed after the spooler accepts the job. Our UI shows *dispatch* states (converting → sending → accepted), not pages-printed.
- **No feedback past the spooler** — out-of-paper / jam at the printer is invisible to us.
- **Fragile settings string** — unknown tokens silently ignored. All `PrintSettings → string` conversion is funnelled through one module with unit tests.
- **No stapling or finishing.**

**Replacement path:** SumatraPDF is only referenced inside `WindowsPrintAdapter`. Swapping to a native WinSpool binding is a one-file rewrite.

### 5.3 What we do NOT rely on

- PowerShell (`Out-Printer`, `Start-Process -Verb Print`) — only as a debug fallback.
- ShellExecute `"print"` verb — unpredictable.
- Raw socket (port 9100) — deferred to Phase 3's optional RAW support.

### 5.4 Printer sources

**MVP (Phase 1 and 1.5): system-installed printers only.** Enumerated via WMI `Win32_Printer` at startup and on-demand. Capability probing via `Get-PrintConfiguration` + WMI. Unknown capabilities → `capabilities = null`, UI trusts the driver and shows a one-time "capabilities unknown" banner.

**Manual printers (IP + port) are explicitly out of the MVP UI.** They cannot reliably print without Phase 3's IPP path, so we do not show a "manual printer" affordance in the user-facing Phase 1/1.5 builds. The data model is forward-compatible (`source: 'system' | 'manual'` as a union) so Phase 3 adds manual support without a schema change, but the MVP UI does not expose it — avoiding the trap of a visible-but-broken feature.

Discovery (mDNS / IPP browsing) is a Phase 3 helper, not a primary mechanism.

---

## 6. Multi-Printer Distribution & Parallel Execution

> **Commercially critical.** Multi-printer split + parallel execution is part of the sellable MVP (Phase 1.5), not a later add-on.

### 6.1 Distribution algorithm (pure)

`packages/shared/distribution/splitCopies.ts`:

```ts
export function splitCopies(
  totalCopies: number,
  printerIds: string[]
): Record<string, number> {
  if (printerIds.length === 0) throw new Error('no printers');
  if (totalCopies < 1) throw new Error('copies < 1');

  const base = Math.floor(totalCopies / printerIds.length);
  const remainder = totalCopies % printerIds.length;

  return printerIds.reduce<Record<string, number>>((acc, id, i) => {
    acc[id] = base + (i < remainder ? 1 : 0);
    return acc;
  }, {});
}
```

**Verification against spec:**
- `splitCopies(10, [p1,p2])` → `{p1:5, p2:5}` ✓
- `splitCopies(10, [p1,p2,p3])` → `{p1:4, p2:3, p3:3}` ✓
- `splitCopies(5, [p1,p2])` → `{p1:3, p2:2}` ✓

**Edge cases:**
- `totalCopies < printers.length` → front printers get one each; zero-copy entries are pruned before dispatch so no empty child spawns.

### 6.2 Parallel execution model

- Child jobs run via `child_process.spawn` in the main process.
- Tracked in `Map<childJobId, ChildProcess>`.
- `Promise.allSettled` across children — one failing never rejects the batch.
- Per-child `JobEvent`s stream to the renderer (`queued → printing → done|failed`).
- Cancel kills all child PIDs (`TerminateProcess` via Node's `kill`). The spooler may still have queued pages; we expose a one-click "purge Windows queue for this printer" helper.

**Failure isolation (commercial MVP requirement):**
- A child fails → its status becomes `'failed'`; siblings continue.
- Parent status resolves to `'done'` (all ok), `'partial'` (mixed), or `'error'` (all failed) once every child settles.
- **Retry is per child**: UI exposes "retry this printer" on each failed row. Re-spawning reuses the same PDF and settings (`attempts++`). No sibling is touched.

### 6.3 End-to-end execution flow

```
User clicks "Print"
  │
  ▼
JobManager.create(draft)                    ← validates, status = 'queued'
  │
  ▼
  preparing:
    FileConverter.ensureAll(job.files)      ← parallel where safe (Phase 2)
    if booklet: BookletImposer.run(...)     ← writes bookletPdfPath
  │
  ▼
  ready:
    distribution = splitCopies(totalCopies, selectedPrinterIds)
    children     = buildChildJobs(job, distribution)   ← one per printer
  │
  ▼
  printing:
    await Promise.allSettled(
      children.map(c => adapter.printFile({ ...c... }))
    )
  │
  ▼
  finalize:
    status = all ok → 'done' | any ok → 'partial' | none ok → 'error' | cancelled → 'cancelled'
    emit 'jobs:event' with final state
```

---

## 7. Booklet Imposition Algorithm

### 7.1 Rules (from spec)
- Two input pages per output side; each sheet holds 4 input pages.
- Total input pages must be a multiple of 4. Pad with blank pages at the end if not.
- For `N` padded pages, `sheets = N / 4`.
- Sheet `i` (0-based):
  - **Front:** left = `N − 2i`, right = `2i + 1`
  - **Back:**  left = `2i + 2`, right = `N − (2i + 1)`
- **RTL:** swap left/right on both sides.

### 7.2 Worked-example verification (N=8)

| Sheet | Side | LTR | RTL |
|---|---|---|---|
| 0 | Front | `[8, 1]` | `[1, 8]` |
| 0 | Back  | `[2, 7]` | `[7, 2]` |
| 1 | Front | `[6, 3]` | `[3, 6]` |
| 1 | Back  | `[4, 5]` | `[5, 4]` |

Matches spec.

### 7.3 Second verification (N=12)

Sheets = 3.

| Sheet | Front | Back |
|---|---|---|
| 0 | `[12, 1]` | `[2, 11]` |
| 1 | `[10, 3]` | `[4, 9]` |
| 2 | `[8, 5]`  | `[6, 7]` |

Folded + stapled LTR reads 1…12 in order. ✓

### 7.4 Implementation (sketch, not code)

Pure function `packages/shared/booklet/impose.ts`:
- Merge inputs into one logical page list (`pdf-lib` `copyPages`).
- Pad to multiple of 4 with blank pages.
- Create an output PDF where each page is two-up of the source page size (A4 source → A3 output).
- For each sheet: place `front.{left,right}` on one output page, `back.{left,right}` on the next. RTL swaps positions.
- Write output.

### 7.5 Printing the booklet — duplex mode must be validated

Booklet duplex is **not a safe assumption**. The correct duplex edge depends on:
- The printer driver's interpretation of `short-edge` vs `long-edge`.
- The source paper orientation (portrait vs landscape on the sheet).
- The imposed output's orientation relative to the physical paper feed.
- Whether the driver silently rotates 180° on the back.

A reasonable default for A4-portrait-imposed-on-A3-landscape saddle-stitched booklets is duplex **short-edge**, but we must not ship this as a silent truth.

**Calibration flow (shipped in Phase 1.5):**
1. First time a user prints a booklet to a given printer, show a "Calibrate booklet duplex" prompt.
2. Offer a 1-sheet test print (N=4, numbered pages).
3. Ask the user to confirm whether the back-side reads upright when folded. Two-choice UI: "Looks correct" or "Back is upside down".
4. Store the result per-printer as `bookletDuplex: 'short-edge' | 'long-edge' | 'manual-flip'` in a `printers_calibration` table.
5. Future booklet jobs for that printer use the stored choice automatically.

**Single-side printer path** (`capabilities.supportsDuplex === false`): print all fronts, show a reload-and-flip prompt (with a visual diagram respecting RTL), then print all backs. Also part of calibration scope.

### 7.6 Other known limitations
- Mixed paper sizes in inputs → impose at first input's size, center others; warn user.
- Encrypted PDFs → pdf-lib can't copy; booklet fails with "source PDF is protected".

---

## 8. Booklet Preview

### 8.1 Goal
Show exactly what each sheet will look like — front and back, RTL-aware — before the user commits.

### 8.2 Scope per phase

- **Phase 1 (core proof):** basic preview. One sheet at a time, show front side only, read from the actual imposed PDF via PDF.js. No advanced controls.
- **Phase 1.5 (commercial MVP):** basic preview keeps. Add front/back toggle and sheet-by-sheet navigation. This is the minimum an operator needs to trust the output before burning paper.
- **Phase 3:** advanced controls — zoom, fit-width, side-by-side front+back view, visual LTR/RTL orientation toggle for sanity-checking binding direction.

### 8.3 How it's generated
Preview renders the **actual imposed PDF** produced by `BookletImposer.run(...)`. Never a second re-imposition in the renderer — that would risk drift between preview and print.

---

## 9. Print Settings — Validation & Fallbacks

### 9.1 Validation

On `jobs:create`, every selected printer's `capabilities` is checked against `PrintSettings`.

| Setting | Check |
|---|---|
| `copies` | `1 ≤ n ≤ capabilities.maxCopies ?? 999` |
| `pageRange` | `1 ≤ from ≤ to ≤ pageCount` |
| `colorMode='color'` | requires `supportsColor` or `capabilities === null` |
| `paperSize` | in `paperSizes` or `capabilities === null` |
| `duplex ≠ 'none'` | requires `supportsDuplex` or `capabilities === null` |
| booklet + duplex | prefers calibrated value from §7.5; asks to calibrate if missing |
| `orientation`, `collate`, `fitToPage` | always allowed |

### 9.2 Fallback behavior
- **Unknown capabilities**: trust driver; banner once.
- **Conflict**: block create with a clear message + one-click adjustment suggestion. Never silently strip.

---

## 10. Localization

### 10.1 Languages
Arabic (default, RTL) and English (LTR).

### 10.2 Mechanism
- `i18next` with `apps/desktop/src/renderer/i18n/{ar,en}.json`.
- `<html dir="rtl">` / `ltr` set at boot and on language change.
- Tailwind logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`) + `tailwindcss-rtl` where variants are needed.

### 10.3 Numerals
Optional Arabic-Indic digits (`٠١٢…`) via `Intl.NumberFormat('ar-EG')`. Off by default even in Arabic UI — operators typically prefer Western digits for counts.

### 10.4 Persistence
`settings.json { language: 'ar'|'en', arabicDigits: boolean }`. Changes take effect without restart (i18next + `document.dir` + Zustand broadcast).

### 10.5 Not localized in MVP
SumatraPDF error strings (labelled, not translated). Low-level license verifier errors (stable code + localized summary).

---

## 11. Licensing (High-Level)

High-level only — deep anti-tamper is explicitly out of scope here.

### 11.1 Shape
- Offline, file-based, signed.
- Ed25519 key pair. **Private key held by the software vendor / license issuer**, who signs `.lic` files. Public key embedded in the app binary.
- Types: `perpetual` (no expiry) and `subscription` (with `expiresAt`).
- Machine-bound via a stable `machineId`.

### 11.2 Machine ID
`sha256(cpuId || primaryMacAddress || windowsInstallId)` where:
- `cpuId` — WMI first CPU's ProcessorId.
- `primaryMacAddress` — MAC of the default-route adapter at install time, cached (Wi-Fi swaps won't invalidate).
- `windowsInstallId` — `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProductId`.

Cached on first launch at `%APPDATA%/<AppName>/machine.id`.

### 11.3 License file
```json
{
  "payload": {
    "machineId": "sha256-hex…",
    "type": "subscription",
    "issuedAt": "...",
    "expiresAt": "...",
    "features": ["multi-printer", "booklet"],
    "licenseeName": "..."
  },
  "signature": "base64-ed25519-signature-of-canonical(payload)"
}
```
Stored at `%APPDATA%/<AppName>/license.lic`.

### 11.4 Validation flow (every launch)
1. Load `license.lic` → missing → License Screen only.
2. Verify Ed25519 signature over canonicalized payload with the embedded public key.
3. Check runtime `machineId` matches `payload.machineId`.
4. If subscription and expired → check grace period.
5. Pass → grant features per `payload.features`.

### 11.5 Grace period
Subscription: 7-day soft-expiry window with a visible banner, then block. Perpetual never expires.

### 11.6 Activation flow
- **Online (at install):** user enters an activation code → app POSTs `{code, machineId}` to the vendor's license server → server returns signed `license.lic` → app writes it.
- **Fully offline:** vendor support generates a `.lic` for the machineId shown in the License Screen and sends it by any channel → user imports the file.

### 11.7 Out of scope here
- Anti-tamper / obfuscation.
- License revocation lists.
- Multi-seat / floating licenses.

### 11.8 License Screen (minimum UI)
- Machine ID (copyable, monospace).
- License type, licensee.
- Status badge: Active / Expiring in N days / Expired / Not activated / Invalid.
- Expiry date for subscription.
- Import `.lic` file or paste license text.
- Reactivate button when status ≠ Active.

---

## 12. Temp File Management

### 12.1 Layout
```
%APPDATA%/<AppName>/
├── temp/
│   ├── {sessionId}/
│   │   ├── {hash}.pdf
│   │   ├── {hash}.meta.json
│   │   └── booklets/
│   │       └── {jobId}.pdf
```

### 12.2 Lifecycle

| Event | Action |
|---|---|
| App start | Cleanup orphans: delete session dirs > 7 days old, delete meta-less PDFs, invalid-meta PDFs, stray `.partial`. |
| File added | Cached by hash → reuse. Else prepare `{hash}.pdf.partial`; rename atomically on success. |
| Conversion succeeds | Write `.meta.json`. |
| Conversion fails | Delete `.partial`; no `.meta.json` → never treated as cached. |
| Job done / cancelled | Keep session + booklet PDF for 24 h so retry is instant. |
| User clicks "Clear queue" | Delete session dir immediately. |
| OS disk-low warning | Cleanup oldest sessions above threshold. |

Per-session dirs isolate one run from another — a crash can never overwrite another run's cache. Cleanup is `rm -rf {sessionId}/` rather than per-file bookkeeping.

---

## 13. LibreOffice Integration (Phase 2)

Required for non-PDF conversion; not bundled.

**Detection order:**
1. `where soffice.exe` on PATH.
2. `HKLM\SOFTWARE\LibreOffice\UNO\InstallPath` / `HKCU\...`.
3. Hardcoded: `C:\Program Files\LibreOffice\program\soffice.exe`, `(x86)\...`.
4. User override in `settings.json.libreOfficePath`.

**Missing flow:** non-PDF add → `conversionStatus='failed'`, error `LIBREOFFICE_MISSING`. UI banner: "Install LibreOffice to print Word/Excel files" with an "Open download page" button (browser) and "I already have it, browse…" for manual path. No silent binary download.

**Fallback:** none in MVP. PDFs in the same batch still print normally.

**Convert call:**
```
"...\soffice.exe" --headless --norestore --nologo --nofirststartwizard ^
  --convert-to pdf:writer_pdf_Export --outdir "<tempDir>" "<inputFile>"
```
Reason for `writer_pdf_Export`: deterministic PDF output across formats. Timeout 120 s. Arabic font substitution is a known LibreOffice behavior; users must install Arabic fonts (Cairo, Amiri) system-wide.

---

## 14. Failure Handling Strategy

| Failure | Detection | Behavior | Recovery |
|---|---|---|---|
| Conversion failed (bad source) | parse error or soffice exit ≠ 0 | File row error with code | Remove / replace file |
| LibreOffice missing | Detection empty | Banner + per-file `LIBREOFFICE_MISSING` | User installs / sets path |
| Booklet impose failed | Exception in `BookletImposer.run` | Job aborts pre-dispatch with reason | Fix source / disable booklet |
| Booklet duplex wrong side | User reports on calibration prompt | Store flip preference | Future jobs use stored value |
| Printer offline pre-flight | Spooler/WMI check before spawn | Warning: "Printer X is offline — proceed anyway?" | Confirm or deselect |
| Printer disconnects mid-print | SumatraPDF exit ≠ 0 | Child `failed`, siblings continue | Retry that child only |
| Partial success | ≥1 child ok, ≥1 failed | Job `'partial'`, row per printer | Per-child retry; reuses cached PDF |
| Cancel | User click | Kill all PIDs; status `'cancelled'` | Optional one-click purge Windows queue |
| Crash mid-print | On launch, status was `'printing'` | "Previous session interrupted" banner | Retry or dismiss (= cancel) |
| Disk full during conversion | Write fails | `DISK_FULL` error | Free space; one-click temp cleanup |
| Spooler down | Systemic WMI failure | "Windows Print Spooler is not running" | Show how to restart; no auto-restart |

**Principle:** no silent recovery. Every failure surfaces an error code + human message + at least one user action.

---

## 15. Risks & Limitations

1. **SumatraPDF progress fidelity** — no true page-by-page progress. UX mitigation: dispatch-state UI, not fake progress bars.
2. **Booklet duplex driver variance** (§7.5) — calibration step is mandatory; shipping without it risks reversed backs on unfamiliar printers.
3. **LibreOffice as external dependency** — version drift changes output subtly. Mitigation: manual path override + documented minimum version.
4. **Arabic fonts in non-PDF conversion** — silent font substitution in LibreOffice. Mitigation: documented font requirements + Phase 2 font-check helper.
5. **Manual printers deferred to Phase 3** — MVP UI does not expose them, precisely because "stored but not printable" confuses users.
6. **Mid-print reconciliation impossible** — once the spooler accepts a job, we can't know whether it physically printed. Windows limitation, documented.
7. **License binding rigidity** — motherboard swap invalidates a machine-bound license. Mitigation: 1-click Reactivate flow + lenient `machineId` derivation.
8. **Electron installer size** ~180 MB with bundled SumatraPDF — acceptable for desktop.
9. **No in-app admin elevation** — features that need admin (printer driver install) will fail silently without it. Mitigation: detect and show "run as administrator" guidance.

---

## 16. Phase Roadmap

> **Only Phase 1.5 is sellable.** Phase 1 is an internal proof step.

### Phase 1 — Core Proof (internal only)
Scope:
- PDF-only file queue (no conversion yet).
- System-installed printers (no manual).
- SumatraPDF printing to one printer.
- Arabic-first RTL UI with English toggle.
- Booklet generation (imposition).
- Basic booklet preview (one sheet at a time, actual imposed PDF).
- SQLite job history + crash recovery.

**Not shipped externally.** Single-printer only is acceptable here *solely* as a proof that the print pipeline works end-to-end.

**Exit criteria:** 50 single-printer PDF jobs without temp/process leaks. Booklet output matches spec for N=8, 12, 24. Basic preview shows imposed pages correctly.

---

### Phase 1.5 — Commercial Minimum (first sellable build)
Scope — adds to Phase 1:
- **Multi-printer selection in UI.**
- **Copy splitting** (`splitCopies` integrated into job create).
- **Parallel execution** (`Promise.allSettled` across children).
- **Per-printer child-job tracking** in UI.
- **Partial-success handling** (job status `'partial'`).
- **Retry failed printer jobs independently** (per-child retry).
- **Booklet preview** with front/back toggle + sheet navigation.
- **Booklet duplex calibration** flow (§7.5) on first booklet to a new printer.
- **Per-job settings** (copies, color, orientation, paper size, duplex, fit).

**Exit criteria (commercial):**
- 100 multi-printer jobs, no leaks.
- 3-printer parallel job within `max(single) × 1.05`.
- A single printer failing mid-batch leaves siblings untouched and is retryable in isolation.
- Booklet calibration for a new printer is a two-click flow.

---

### Phase 2 — File Conversion + Profiles
Scope:
- LibreOffice detection + missing-install flow + manual path override.
- Conversion of `.docx`, `.xlsx`, `.jpg`, `.jpeg`, `.png`, `.txt` to PDF.
- Print profiles (save/load named `PrintSettings`).
- Per-file page range UI.

**Exit criteria:** Full format coverage, round-trips verified; profiles persist across launches; Arabic-content DOCX converts with correct fonts if system fonts present.

---

### Phase 3 — Licensing + Network Printers + Polish
Scope:
- Full offline licensing flow (activation, machine-ID UI, grace period, reactivation).
- Manual IPP printers (primary network path).
- Optional RAW (9100) support behind an advanced flag.
- Optional mDNS / IPP discovery helper.
- Advanced booklet preview (zoom, side-by-side front+back, LTR/RTL visual toggle).
- Localization polish (Arabic-Indic digits toggle, formatting passes).

**Exit criteria:** Fresh install activates offline via `.lic` import. IPP printing works against at least two printer brands. Manual printer UI clearly labelled.

---

### Deferred (post-roadmap)
- macOS port via `MacPrintAdapter`.
- Finishing options (stapling, hole punch).
- Job history CSV/PDF export.
- Multi-user profiles on a shared machine.

---

## 17. Verification Plan

- **Unit tests** on pure functions: `splitCopies`, booklet imposition math for N∈{4,8,12,16,24,100}, `PrintSettings → SumatraPDF string` serializer, `machineId` derivation.
- **Integration tests** with a mock `PrintAdapter` that records spawn calls — assert correct distribution, per-child settings, partial-success flow, per-child retry.
- **Golden-file tests** for booklet imposition: compare output page order to hand-verified tables.
- **Smoke test on real hardware** per phase exit: 1 printer for Phase 1; **3 printers, mixed brands, parallel** for Phase 1.5; multi-format for Phase 2; IPP against 2 brands for Phase 3.
- **Crash-recovery drill:** `taskkill /F` mid-job, relaunch, verify interrupted flow.
- **Booklet duplex calibration drill:** fresh printer, confirm calibration captures and persists the correct flip mode.
