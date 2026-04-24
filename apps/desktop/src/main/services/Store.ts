import Database from 'better-sqlite3';
import { storeDbPath } from './paths';
import type { Job, ChildJob, FileEntry, JobStatus } from '@appname/shared';

/**
 * SQLite-backed persistence. Chosen over flat JSON because job and child-job
 * updates must be atomic during parallel execution.
 */
export class Store {
  private db: Database.Database;

  constructor() {
    this.db = new Database(storeDbPath());
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

      CREATE TABLE IF NOT EXISTS child_jobs (
        id TEXT PRIMARY KEY,
        parent_job_id TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY(parent_job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_child_parent ON child_jobs(parent_job_id);

      CREATE TABLE IF NOT EXISTS file_entries (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS printer_calibration (
        printer_id TEXT PRIMARY KEY,
        booklet_duplex TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  saveJob(job: Job): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO jobs (id, data, status, updated_at) VALUES (?,?,?,?)',
    );
    stmt.run(job.id, JSON.stringify(job), job.status, job.updatedAt);
    const childStmt = this.db.prepare(
      'INSERT OR REPLACE INTO child_jobs (id, parent_job_id, data, status) VALUES (?,?,?,?)',
    );
    for (const c of job.children) {
      childStmt.run(c.id, job.id, JSON.stringify(c), c.status);
    }
  }

  getJob(id: string): Job | null {
    const row = this.db
      .prepare('SELECT data FROM jobs WHERE id = ?')
      .get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Job) : null;
  }

  findJobsByStatus(statuses: JobStatus[]): Job[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT data FROM jobs WHERE status IN (${placeholders})`)
      .all(...statuses) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Job);
  }

  updateChildJob(child: ChildJob): void {
    this.db
      .prepare(
        'UPDATE child_jobs SET data = ?, status = ? WHERE id = ?',
      )
      .run(JSON.stringify(child), child.status, child.id);
  }

  saveFileEntry(entry: FileEntry): void {
    this.db
      .prepare('INSERT OR REPLACE INTO file_entries (id, data) VALUES (?,?)')
      .run(entry.id, JSON.stringify(entry));
  }

  findFileEntryByHash(hash: string): FileEntry | null {
    const rows = this.db
      .prepare('SELECT data FROM file_entries')
      .all() as Array<{ data: string }>;
    for (const r of rows) {
      const e = JSON.parse(r.data) as FileEntry;
      if (e.sourceHash === hash) return e;
    }
    return null;
  }

  getBookletCalibration(printerId: string): 'long-edge' | 'short-edge' | 'manual-flip' | null {
    const row = this.db
      .prepare('SELECT booklet_duplex FROM printer_calibration WHERE printer_id = ?')
      .get(printerId) as { booklet_duplex: string } | undefined;
    if (!row) return null;
    return row.booklet_duplex as 'long-edge' | 'short-edge' | 'manual-flip';
  }

  setBookletCalibration(
    printerId: string,
    mode: 'long-edge' | 'short-edge' | 'manual-flip',
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO printer_calibration (printer_id, booklet_duplex, updated_at) VALUES (?,?,?)',
      )
      .run(printerId, mode, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
