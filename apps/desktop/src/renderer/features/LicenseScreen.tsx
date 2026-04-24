import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LicenseStatus } from '@appname/shared';

export function LicenseScreen(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [licenseText, setLicenseText] = useState('');

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    const s = await window.api.license.status();
    setStatus(s);
  }

  async function onActivate(): Promise<void> {
    if (!licenseText.trim()) return;
    const s = await window.api.license.activate(licenseText.trim());
    setStatus(s);
  }

  if (!status) {
    return (
      <section className="card">
        <header className="card-header">{t('license.title')}</header>
        <div className="card-body text-sm text-slate-500">…</div>
      </section>
    );
  }

  const stateCls: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800',
    expiring: 'bg-amber-100 text-amber-800',
    expired: 'bg-red-100 text-red-800',
    'not-activated': 'bg-slate-100 text-slate-800',
    invalid: 'bg-red-100 text-red-800',
  };

  return (
    <section className="card">
      <header className="card-header">{t('license.title')}</header>
      <div className="card-body space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span>{t('license.state')}</span>
          <span className={`badge ${stateCls[status.state]}`}>
            {t(`license.states.${status.state}`)}
          </span>
        </div>
        <div>
          <div className="text-slate-500">{t('license.machineId')}</div>
          <div className="font-mono text-xs break-all">{status.machineId}</div>
        </div>
        {status.payload?.expiresAt && (
          <div className="flex items-center justify-between">
            <span>{t('license.expiresAt')}</span>
            <span>{new Date(status.payload.expiresAt).toLocaleDateString()}</span>
          </div>
        )}

        {status.state !== 'active' && (
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <label className="block text-xs text-slate-500">
              {t('license.pasteLicense')}
            </label>
            <textarea
              rows={6}
              className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
              value={licenseText}
              onChange={(e) => setLicenseText(e.target.value)}
            />
            <button className="btn-primary" onClick={() => void onActivate()}>
              {t('license.activate')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
