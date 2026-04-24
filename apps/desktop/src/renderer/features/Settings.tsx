import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settingsStore';
import { setLanguage } from '../i18n';

export function Settings(): JSX.Element {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const arabicDigits = useSettingsStore((s) => s.arabicDigits);
  const setLang = useSettingsStore((s) => s.setLanguage);
  const setAD = useSettingsStore((s) => s.setArabicDigits);
  const printSettings = useSettingsStore((s) => s.printSettings);
  const setPrintSettings = useSettingsStore((s) => s.setPrintSettings);

  function toggleLanguage(): void {
    const next = language === 'ar' ? 'en' : 'ar';
    setLang(next);
    setLanguage(next);
  }

  return (
    <section className="card">
      <header className="card-header">{t('nav.settings')}</header>
      <div className="card-body space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <span>{t('settings.language')}</span>
          <button className="btn-secondary text-xs" onClick={toggleLanguage}>
            {t('app.language')}
          </button>
        </div>
        <label className="flex items-center justify-between">
          <span>{t('settings.arabicDigits')}</span>
          <input
            type="checkbox"
            checked={arabicDigits}
            onChange={(e) => setAD(e.target.checked)}
          />
        </label>

        <div className="border-t border-slate-200 pt-3 space-y-2">
          <label className="flex items-center justify-between">
            <span>Color</span>
            <select
              value={printSettings.colorMode}
              onChange={(e) =>
                setPrintSettings({ colorMode: e.target.value as 'color' | 'mono' })
              }
              className="rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="mono">Monochrome</option>
              <option value="color">Color</option>
            </select>
          </label>
          <label className="flex items-center justify-between">
            <span>Paper</span>
            <select
              value={printSettings.paperSize}
              onChange={(e) => setPrintSettings({ paperSize: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
              <option value="Letter">Letter</option>
            </select>
          </label>
          <label className="flex items-center justify-between">
            <span>Duplex</span>
            <select
              value={printSettings.duplex}
              onChange={(e) =>
                setPrintSettings({
                  duplex: e.target.value as 'none' | 'long-edge' | 'short-edge',
                })
              }
              className="rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="none">None</option>
              <option value="long-edge">Long edge</option>
              <option value="short-edge">Short edge</option>
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}
