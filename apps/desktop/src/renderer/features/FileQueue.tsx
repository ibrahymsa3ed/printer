import { useTranslation } from 'react-i18next';
import { useFilesStore } from '../stores/filesStore';

export function FileQueue(): JSX.Element {
  const { t } = useTranslation();
  const files = useFilesStore((s) => s.files);
  const add = useFilesStore((s) => s.add);
  const remove = useFilesStore((s) => s.remove);

  async function onPickFiles(): Promise<void> {
    // In Electron, we'd normally open a native dialog from main. For now, use
    // a web file input as a development placeholder; main can still be wired
    // via a future `files:dialog` IPC.
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf';
    input.onchange = async (): Promise<void> => {
      const list = Array.from(input.files ?? []);
      const paths = list.map((f) => (f as File & { path?: string }).path).filter(Boolean) as string[];
      if (paths.length === 0) return;
      const entries = await window.api.files.add(paths);
      add(entries);
    };
    input.click();
  }

  return (
    <section className="card">
      <header className="card-header flex items-center justify-between">
        <span>{t('nav.queue')}</span>
        <button className="btn-primary" onClick={() => void onPickFiles()}>
          {t('files.add')}
        </button>
      </header>
      <div className="card-body">
        {files.length === 0 ? (
          <p className="text-sm text-slate-500">{t('files.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2">
                <div className="flex flex-col">
                  <span className="font-medium">{f.originalName}</span>
                  <span className="text-xs text-slate-500">
                    {f.pageCount !== null
                      ? t('files.pageCount', { count: f.pageCount })
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={f.conversionStatus} error={f.conversionError} />
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => remove(f.id)}
                  >
                    {t('files.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: 'pending' | 'converting' | 'ready' | 'failed';
  error: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  if (status === 'ready') {
    return <span className="badge bg-emerald-100 text-emerald-800">{t('files.ready')}</span>;
  }
  if (status === 'failed') {
    return (
      <span className="badge bg-red-100 text-red-800" title={error ?? undefined}>
        {t('files.failed')}
      </span>
    );
  }
  return <span className="badge bg-slate-100 text-slate-700">{t('files.pending')}</span>;
}
