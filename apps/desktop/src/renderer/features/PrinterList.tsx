import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrintersStore } from '../stores/printersStore';

export function PrinterList(): JSX.Element {
  const { t } = useTranslation();
  const printers = usePrintersStore((s) => s.printers);
  const selectedIds = usePrintersStore((s) => s.selectedIds);
  const toggle = usePrintersStore((s) => s.toggle);
  const setAll = usePrintersStore((s) => s.setAll);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    const list = await window.api.printers.list();
    setAll(list);
  }

  return (
    <section className="card">
      <header className="card-header flex items-center justify-between">
        <span>{t('nav.printers')}</span>
        <button className="btn-secondary text-xs" onClick={() => void refresh()}>
          {t('printers.refresh')}
        </button>
      </header>
      <div className="card-body">
        {printers.length === 0 ? (
          <p className="text-sm text-slate-500">{t('printers.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {printers.map((p) => {
              const isSelected = selectedIds.has(p.id);
              return (
                <li
                  key={p.id}
                  className={`flex items-center justify-between rounded-md border p-3 cursor-pointer transition-colors ${
                    isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                  onClick={() => toggle(p.id)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4"
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-slate-500">{p.connection.type === 'os' ? p.connection.queueName : ''}</span>
                    </div>
                  </div>
                  <StatusPill status={p.status} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusPill({
  status,
}: {
  status: 'online' | 'offline' | 'unknown';
}): JSX.Element {
  const { t } = useTranslation();
  const cls =
    status === 'online'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'offline'
        ? 'bg-red-100 text-red-800'
        : 'bg-slate-100 text-slate-700';
  return <span className={`badge ${cls}`}>{t(`printers.${status}`)}</span>;
}
