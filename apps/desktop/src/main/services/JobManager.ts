import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type {
  Job,
  JobDraft,
  JobEvent,
  ChildJob,
  Printer,
  FileEntry,
} from '@appname/shared';
import { splitCopies, pruneZeroCopies } from '@appname/shared';
import type { PrintAdapter } from '../adapters/PrintAdapter';
import type { Store } from './Store';
import type { PrinterRegistry } from './PrinterRegistry';
import type { TempManager } from './TempManager';
import { imposeBooklet } from './BookletImposer';

/**
 * Orchestrates the commercial-MVP print flow:
 *
 *   preparing → booklet impose (optional) →
 *   split copies across selected printers →
 *   Promise.allSettled over child jobs (true parallel) →
 *   aggregate: done | partial | error
 *
 * Per-child retry is exposed via `retryChild()`.
 */
export class JobManager extends EventEmitter {
  private jobs = new Map<string, Job>();
  private fileEntries = new Map<string, FileEntry>();
  private controllers = new Map<string, AbortController>(); // childId → abort

  constructor(
    private adapter: PrintAdapter,
    private registry: PrinterRegistry,
    private store: Store,
    private temp: TempManager,
  ) {
    super();
  }

  registerFile(entry: FileEntry): void {
    this.fileEntries.set(entry.id, entry);
    this.store.saveFileEntry(entry);
  }

  async create(draft: JobDraft): Promise<Job> {
    if (draft.selectedPrinterIds.length === 0) {
      throw new Error('JobManager.create: no printers selected');
    }
    if (draft.totalCopies < 1) {
      throw new Error('JobManager.create: copies < 1');
    }
    if (draft.fileIds.length === 0) {
      throw new Error('JobManager.create: no files');
    }

    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();

    const fileRefs = draft.fileIds.map((id) => {
      const e = this.fileEntries.get(id);
      if (!e || !e.normalizedPdfPath || !e.pageCount) {
        throw new Error(`JobManager.create: file ${id} not ready`);
      }
      return { fileId: id, normalizedPdfPath: e.normalizedPdfPath, pageCount: e.pageCount };
    });

    const distribution = pruneZeroCopies(
      splitCopies(draft.totalCopies, draft.selectedPrinterIds),
    );

    const children: ChildJob[] = Object.entries(distribution).map(([printerId, copies]) => ({
      id: crypto.randomUUID(),
      parentJobId: jobId,
      printerId,
      copies,
      status: 'queued',
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
      enginePid: null,
    }));

    const job: Job = {
      id: jobId,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      files: fileRefs,
      bookletEnabled: draft.bookletEnabled,
      bookletPdfPath: null,
      totalCopies: draft.totalCopies,
      settingsSnapshot: draft.settings,
      selectedPrinterIds: draft.selectedPrinterIds,
      distribution,
      children,
      progress: 0,
      error: null,
    };

    this.jobs.set(job.id, job);
    this.store.saveJob(job);
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  async start(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('start: job not found');

    this.transition(job, 'preparing');

    try {
      // 1. Booklet impose (if requested) — uses cached session.
      if (job.bookletEnabled) {
        const result = await imposeBooklet({
          sessionId: this.temp.sessionId,
          jobId: job.id,
          inputPdfPaths: job.files.map((f) => f.normalizedPdfPath),
          rtl: false, // TODO: pass from settings / UI
        });
        job.bookletPdfPath = result.outputPath;
        this.persist(job);
      }

      this.transition(job, 'ready');
    } catch (err) {
      job.error = `BOOKLET_FAILED: ${(err as Error).message}`;
      this.transition(job, 'error');
      return;
    }

    // 2. Parallel dispatch.
    await this.dispatchChildren(job);

    // 3. Aggregate.
    this.aggregateFinalStatus(job);
  }

  async retryChild(childId: string): Promise<void> {
    const { job, child } = this.locateChild(childId);
    if (!job || !child) throw new Error('retryChild: not found');
    if (child.status !== 'failed' && child.status !== 'cancelled') {
      throw new Error('retryChild: child is not retryable');
    }
    child.status = 'queued';
    child.error = null;
    child.attempts += 1;
    this.persist(job);

    // Re-ensure job-level status reflects in-progress again.
    this.transition(job, 'printing');
    await this.runChild(job, child);
    this.aggregateFinalStatus(job);
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    for (const child of job.children) {
      const controller = this.controllers.get(child.id);
      controller?.abort();
      if (child.status === 'queued' || child.status === 'printing') {
        child.status = 'cancelled';
      }
    }
    this.transition(job, 'cancelled');
  }

  async recoverInterrupted(): Promise<Job[]> {
    const inFlight = this.store.findJobsByStatus(['preparing', 'printing']);
    for (const j of inFlight) {
      j.status = 'interrupted';
      j.updatedAt = new Date().toISOString();
      this.jobs.set(j.id, j);
      this.store.saveJob(j);
    }
    return inFlight;
  }

  // --- internals ---

  private async dispatchChildren(job: Job): Promise<void> {
    this.transition(job, 'printing');
    await Promise.allSettled(job.children.map((c) => this.runChild(job, c)));
  }

  private async runChild(job: Job, child: ChildJob): Promise<void> {
    const printers = await this.registry.list();
    const printer = printers.find((p) => p.id === child.printerId);
    if (!printer) {
      this.failChild(job, child, 'PRINTER_NOT_FOUND');
      return;
    }

    const controller = new AbortController();
    this.controllers.set(child.id, controller);

    child.status = 'printing';
    child.startedAt = new Date().toISOString();
    this.persistChild(job, child);

    const pdfPath = job.bookletPdfPath ?? job.files[0]!.normalizedPdfPath;
    const perChildSettings = {
      ...job.settingsSnapshot,
      copies: child.copies, // each printer prints only its share
    };

    try {
      const result = await this.adapter.printFile({
        filePath: pdfPath,
        printer,
        settings: perChildSettings,
        signal: controller.signal,
        onProgress: (p) => this.emitEvent({ type: 'progress', jobId: job.id, progress: p }),
      });
      child.enginePid = result.pid;
      child.finishedAt = new Date().toISOString();
      child.status = 'done';
      this.persistChild(job, child);
    } catch (err) {
      if (controller.signal.aborted) {
        child.status = 'cancelled';
      } else {
        this.failChild(job, child, (err as Error).message);
      }
    } finally {
      this.controllers.delete(child.id);
    }
  }

  private failChild(job: Job, child: ChildJob, error: string): void {
    child.status = 'failed';
    child.error = error;
    child.finishedAt = new Date().toISOString();
    this.persistChild(job, child);
  }

  private aggregateFinalStatus(job: Job): void {
    const states = job.children.map((c) => c.status);
    const done = states.filter((s) => s === 'done').length;
    const failed = states.filter((s) => s === 'failed').length;
    const cancelled = states.filter((s) => s === 'cancelled').length;

    if (done === states.length) this.transition(job, 'done');
    else if (cancelled > 0 && done === 0 && failed === 0) this.transition(job, 'cancelled');
    else if (done > 0 && failed > 0) this.transition(job, 'partial');
    else if (failed === states.length) this.transition(job, 'error');
    else if (done > 0 && cancelled > 0) this.transition(job, 'partial');
    else this.transition(job, 'error');
  }

  private locateChild(childId: string): { job: Job | null; child: ChildJob | null } {
    for (const job of this.jobs.values()) {
      const child = job.children.find((c) => c.id === childId);
      if (child) return { job, child };
    }
    return { job: null, child: null };
  }

  private transition(job: Job, status: Job['status']): void {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    this.persist(job);
    this.emitEvent({ type: 'status', jobId: job.id, status });
  }

  private persist(job: Job): void {
    this.store.saveJob(job);
  }

  private persistChild(job: Job, child: ChildJob): void {
    job.updatedAt = new Date().toISOString();
    this.store.updateChildJob(child);
    this.store.saveJob(job);
    this.emitEvent({
      type: 'childStatus',
      jobId: job.id,
      childId: child.id,
      status: child.status,
      error: child.error,
    });
  }

  private emitEvent(evt: JobEvent): void {
    this.emit('event', evt);
  }
}
