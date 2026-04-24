import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useJobsStore } from '../stores/jobsStore';
import { useFilesStore } from '../stores/filesStore';
import { usePrintersStore } from '../stores/printersStore';
import { useSettingsStore } from '../stores/settingsStore';
import { splitCopies, pruneZeroCopies } from '@appname/shared';

export function JobMonitor(): JSX.Element {
  const { t } = useTranslation();
  const jobs = useJobsStore((s) => s.jobs);
  const upsert = useJobsStore((s) => s.upsert);
  const updateStatus = useJobsStore((s) => s.updateStatus);
  const updateChildStatus = useJobsStore((s) => s.updateChildStatus);
  const updateProgress = useJobsStore((s) => s.updateProgress);

  const files = useFilesStore((s) => s.files);
  const printerIds = usePrintersStore((s) => Array.from(s.selectedIds));
  const printers = usePrintersStore((s) => s.printers);
  const copies = useSettingsStore((s) => s.copies);
  const bookletEnabled = useSettingsStore((s) => s.bookletEnabled);
  const setCopies = useSettingsStore((s) => s.setCopies);
  const setBookletEnabled = useSettingsStore((s) => s.setBookletEnabled);
  const printSettings = useSettingsStore((s) => s.printSettings);

  useEffect(() => {
    const off = window.api.jobs.onEvent((evt) => {
      switch (evt.type) {
        case 'status':
          updateStatus(evt.jobId, evt.status);
          break;
        case 'childStatus':
          updateChildStatus(evt.jobId, evt.childId, evt.status, evt.error ?? null);
          break;
        case 'progress':
          updateProgress(evt.jobId, evt.progress);
          break;
      }
    });
    return off;
  }, [updateStatus, updateChildStatus, updateProgress]);

  const canStart =
    files.some((f) => f.conversionStatus === 'ready') &&
    printerIds.length > 0 &&
    copies >= 1;

  // Live preview of distribution before the job is created.
  const previewDistribution =
    printerIds.length > 0 && copies >= 1
      ? pruneZeroCopies(splitCopies(copies, printerIds))
      : {};

  async function onStart(): Promise<void> {
    if (!canStart) return;
    const readyFiles = files.filter((f) => f.conversionStatus === 'ready');
    const job = await window.api.jobs.create({
      fileIds: readyFiles.map((f) => f.id),
      bookletEnabled,
      totalCopies: copies,
      settings: { ...printSettings, copies },
      selectedPrinterIds: printerIds,
    });
    upsert(job);
    await window.api.jobs.start(job.id);
  }

  return (
    <section className="card">
      <header className="card-header">{t('jobs.create')}</header>
      <div className="card-body space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            {t('jobs.copies')}:
            <input
              type="number"
              min={1}
              max={999}
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bookletEnabled}
              onChange={(e) => setBookletEnabled(e.target.checked)}
            />
            {t('jobs.booklet')}
          </label>
          <button
            className="btn-primary ms-auto"
            disabled={!canStart}
            onClick={() => void onStart()}
          >
            {t('jobs.start')}
          </button>
        </div>

        {Object.keys(previewDistribution).length > 0 && (
          <div className="rounded-md bg-slate-100 p-3 text-sm">
            <div className="mb-2 font-semibold">{t('jobs.distribution')}</div>
            <ul className="space-y-1">
              {Object.entries(previewDistribution).map(([pid, n]) => {
                const printer = printers.find((p) => p.id === pid);
                return (
                  <li key={pid} className="flex items-center justify-between">
                    <span>{printer?.name ?? pid}</span>
                    <span className="font-mono">{n}×</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {jobs.length > 0 && (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">
                    {new Date(job.createdAt).toLocaleTimeString()}
                  </span>
                  <JobStatusBadge status={job.status} />
                </div>
                <ul className="space-y-1 text-sm">
                  {job.children.map((c) => {
                    const printer = printers.find((p) => p.id === c.printerId);
                    return (
                      <li
                        key={c.id}
                        className="flex items-center justify-between rounded bg-slate-50 px-2 py-1"
                      >
                        <span>{printer?.name ?? c.printerId}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{c.copies}×</span>
                          <ChildStatusBadge status={c.status} />
                          {(c.status === 'failed' || c.status === 'cancelled') && (
                            <button
                              className="btn-secondary text-xs"
                              onClick={() => void window.api.jobs.retryChild(c.id)}
                            >
                              {t('jobs.retry')}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {job.status === 'printing' && (
                  <button
                    className="btn-danger mt-2 text-xs"
                    onClick={() => void window.api.jobs.cancel(job.id)}
                  >
                    {t('jobs.cancel')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function JobStatusBadge({ status }: { status: string }): JSX.Element {
  const { t } = useTranslation();
  const cls: Record<string, string> = {
    queued: 'bg-slate-100 text-slate-800',
    preparing: 'bg-amber-100 text-amber-800',
    ready: 'bg-amber-100 text-amber-800',
    printing: 'bg-blue-100 text-blue-800',
    done: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-orange-100 text-orange-800',
    error: 'bg-red-100 text-red-800',
    cancelled: 'bg-slate-200 text-slate-700',
    interrupted: 'bg-yellow-100 text-yellow-900',
  };
  return (
    <span className={`badge ${cls[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {t(`jobs.status.${status}`)}
    </span>
  );
}

function ChildStatusBadge({ status }: { status: string }): JSX.Element {
  const { t } = useTranslation();
  const cls: Record<string, string> = {
    queued: 'bg-slate-100 text-slate-700',
    printing: 'bg-blue-100 text-blue-800',
    done: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-slate-200 text-slate-700',
  };
  return (
    <span className={`badge ${cls[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {t(`jobs.childStatus.${status}`)}
    </span>
  );
}
