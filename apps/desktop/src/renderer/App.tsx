import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileQueue } from './features/FileQueue';
import { PrinterList } from './features/PrinterList';
import { JobMonitor } from './features/JobMonitor';
import { BookletPreview } from './features/BookletPreview';
import { Settings } from './features/Settings';
import { LicenseScreen } from './features/LicenseScreen';

type Tab = 'work' | 'preview' | 'settings' | 'license';

export function App(): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('work');

  return (
    <div className="flex h-full">
      <aside className="w-48 shrink-0 border-e border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4 text-lg font-bold">
          {t('app.title')}
        </div>
        <nav className="p-2 space-y-1 text-sm">
          <NavButton active={tab === 'work'} onClick={() => setTab('work')}>
            {t('nav.queue')}
          </NavButton>
          <NavButton active={tab === 'preview'} onClick={() => setTab('preview')}>
            {t('nav.preview')}
          </NavButton>
          <NavButton active={tab === 'settings'} onClick={() => setTab('settings')}>
            {t('nav.settings')}
          </NavButton>
          <NavButton active={tab === 'license'} onClick={() => setTab('license')}>
            {t('nav.license')}
          </NavButton>
        </nav>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {tab === 'work' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <FileQueue />
              <PrinterList />
            </div>
            <div>
              <JobMonitor />
            </div>
          </div>
        )}
        {tab === 'preview' && <BookletPreview />}
        {tab === 'settings' && <Settings />}
        {tab === 'license' && <LicenseScreen />}
      </main>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-md px-3 py-2 text-start transition-colors ${
        active ? 'bg-blue-50 text-blue-800 font-medium' : 'hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
