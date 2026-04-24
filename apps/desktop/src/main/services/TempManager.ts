import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { sessionTempDir, tempRoot } from './paths';

interface TempMeta {
  sourcePath: string;
  sourceMtimeMs: number;
  sourceSizeBytes: number;
  hash: string;
  convertedAt: string;
}

export class TempManager {
  constructor(public readonly sessionId: string = crypto.randomUUID()) {}

  sessionDir(): string {
    return sessionTempDir(this.sessionId);
  }

  normalizedPdfPath(hash: string): string {
    return path.join(this.sessionDir(), `${hash}.pdf`);
  }

  partialPath(hash: string): string {
    return path.join(this.sessionDir(), `${hash}.pdf.partial`);
  }

  metaPath(hash: string): string {
    return path.join(this.sessionDir(), `${hash}.meta.json`);
  }

  /** Hash = sha256(path || mtimeMs || sizeBytes). Cheap and stable. */
  async hashSource(absolutePath: string): Promise<string> {
    const stat = await fsp.stat(absolutePath);
    return crypto
      .createHash('sha256')
      .update(`${absolutePath}|${stat.mtimeMs}|${stat.size}`)
      .digest('hex');
  }

  /** Returns the cached PDF path if one exists with valid metadata. */
  async findByHash(hash: string): Promise<string | null> {
    try {
      const pdf = this.normalizedPdfPath(hash);
      const meta = this.metaPath(hash);
      const [pdfStat, metaRaw] = await Promise.all([
        fsp.stat(pdf),
        fsp.readFile(meta, 'utf8'),
      ]);
      if (pdfStat.size === 0) return null;
      const parsed = JSON.parse(metaRaw) as TempMeta;
      if (parsed.hash !== hash) return null;
      return pdf;
    } catch {
      return null;
    }
  }

  async writeMeta(hash: string, sourcePath: string): Promise<void> {
    const stat = await fsp.stat(sourcePath);
    const meta: TempMeta = {
      sourcePath,
      sourceMtimeMs: stat.mtimeMs,
      sourceSizeBytes: stat.size,
      hash,
      convertedAt: new Date().toISOString(),
    };
    await fsp.writeFile(this.metaPath(hash), JSON.stringify(meta, null, 2), 'utf8');
  }

  /**
   * Delete session dirs older than maxAgeDays on startup. Also scrub orphans
   * (meta without pdf, pdf without meta, stray .partial).
   */
  async cleanupOrphans(maxAgeDays = 7): Promise<void> {
    const root = tempRoot();
    const maxAgeMs = maxAgeDays * 24 * 3600 * 1000;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(root);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(root, name);
      try {
        const stat = await fsp.stat(full);
        if (stat.isDirectory() && Date.now() - stat.mtimeMs > maxAgeMs) {
          await fsp.rm(full, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }

    // Scrub within the active session.
    await this.scrubSession();
  }

  private async scrubSession(): Promise<void> {
    const dir = this.sessionDir();
    let names: string[] = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    const hashes = new Set<string>();
    const pdfs = new Set<string>();
    const metas = new Set<string>();
    const partials: string[] = [];
    for (const n of names) {
      if (n.endsWith('.pdf.partial')) partials.push(n);
      else if (n.endsWith('.pdf')) {
        const h = n.slice(0, -4);
        hashes.add(h);
        pdfs.add(h);
      } else if (n.endsWith('.meta.json')) {
        const h = n.slice(0, -'.meta.json'.length);
        hashes.add(h);
        metas.add(h);
      }
    }
    const toDelete: string[] = [...partials];
    for (const h of hashes) {
      if (!pdfs.has(h) || !metas.has(h)) {
        if (pdfs.has(h)) toDelete.push(`${h}.pdf`);
        if (metas.has(h)) toDelete.push(`${h}.meta.json`);
      }
    }
    await Promise.all(
      toDelete.map((n) =>
        fsp.rm(path.join(dir, n), { force: true }).catch(() => undefined),
      ),
    );
  }

  /** Ensures the session directory exists. */
  ensureSessionDir(): void {
    fs.mkdirSync(this.sessionDir(), { recursive: true });
  }
}
