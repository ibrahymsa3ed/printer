# `<AppName>`

Windows desktop batch printing manager for print shops. Arabic-first RTL UI, multi-printer parallel printing, saddle-stitched booklet imposition, offline license enforcement.

> `<AppName>` is a placeholder. Replace with the final product name (display + reverse-DNS id) before Phase 1.5 ships externally. All filesystem paths, registry keys, and identifiers use `<AppName>` deliberately.

## Repo layout

```
apps/
  desktop/              # Electron + Vite + React renderer
    src/
      main/             # Node, Electron main process
        services/       # Store, TempManager, PrinterRegistry, JobManager,
                        # LicenseService, FileConverter, BookletImposer
        adapters/       # PrintAdapter interface + WindowsPrintAdapter (SumatraPDF)
        ipc/            # Typed IPC registration
      preload/          # contextBridge → window.api
      renderer/         # React 18, Tailwind, i18n (ar/en)
        features/       # FileQueue, PrinterList, JobMonitor,
                        # BookletPreview, Settings, LicenseScreen
        stores/         # Zustand
        i18n/           # Arabic default, RTL
    resources/          # SumatraPDF.exe goes here (not checked in)
packages/
  shared/               # Types + pure functions (booklet math, copy split)
    src/booklet/        # computeBookletLayout — verified against spec
    src/distribution/   # splitCopies — verified against spec
    src/types/          # Job, Printer, Settings, License …
docs/
  PLANNING.md           # Full technical planning document
```

## Scripts

```bash
pnpm install                                   # install workspace deps
pnpm -r test                                   # run unit tests (shared package)
pnpm --filter @appname/desktop dev             # launch Electron dev build
pnpm --filter @appname/desktop build           # produce a packaged build
```

## Phase status

- **Phase 1 — Core Proof (internal):** single-printer pipeline + booklet + Arabic UI.
- **Phase 1.5 — Commercial Minimum (this skeleton targets):** multi-printer split, parallel dispatch, per-child retry, partial success, basic booklet preview.
- **Phase 2:** LibreOffice conversion (`.docx`, `.xlsx`, `.jpg`, `.png`, `.txt`), print profiles.
- **Phase 3:** Offline licensing flow, manual IPP printers, optional mDNS discovery, advanced preview.

See `docs/PLANNING.md` for the full architecture, data models, booklet algorithm verification, failure matrix, and roadmap.

## Key files

- Booklet algorithm: `packages/shared/src/booklet/layout.ts` (tests in `layout.test.ts` — 19 passing)
- Copy distribution: `packages/shared/src/distribution/splitCopies.ts` (13 passing tests)
- Parallel job orchestration: `apps/desktop/src/main/services/JobManager.ts`
- Print engine: `apps/desktop/src/main/adapters/WindowsPrintAdapter.ts`

## External dependencies

- **SumatraPDF** (bundled at build time, MPL-2.0) — drop `SumatraPDF.exe` into `apps/desktop/resources/` for dev.
- **LibreOffice** — required for Phase 2 non-PDF conversion; detected at runtime, not bundled.

## Limitations (honest)

- SumatraPDF reports done/failed only, no granular progress. UI shows dispatch state, not pages-printed.
- Booklet duplex behavior depends on the printer driver — first booklet to a new printer triggers a calibration prompt (Phase 1.5).
- Manual IP/port printers are deferred to Phase 3 and not exposed in the MVP UI.
