import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeBookletLayout } from '@appname/shared';
import { useFilesStore } from '../stores/filesStore';

/**
 * Basic booklet preview — part of the commercial MVP per §8.2 of the plan.
 *
 * Renders the layout structure (page numbers per sheet front/back) computed
 * from the file queue's total page count. The actual imposed PDF is drawn by
 * the main process with pdf-lib; a PDF.js render of that output is planned
 * for Phase 3 (advanced preview). This view lets operators verify the
 * imposition logic by reading the numbers before burning paper.
 */
export function BookletPreview(): JSX.Element {
  const { t, i18n } = useTranslation();
  const files = useFilesStore((s) => s.files);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [side, setSide] = useState<'front' | 'back'>('front');

  const sourcePageCount = files
    .filter((f) => f.conversionStatus === 'ready' && f.pageCount)
    .reduce((sum, f) => sum + (f.pageCount ?? 0), 0);

  const layout = useMemo(() => {
    if (sourcePageCount < 1) return null;
    return computeBookletLayout(sourcePageCount, i18n.language === 'ar');
  }, [sourcePageCount, i18n.language]);

  if (!layout) {
    return (
      <section className="card">
        <header className="card-header">{t('preview.title')}</header>
        <div className="card-body">
          <p className="text-sm text-slate-500">{t('preview.empty')}</p>
        </div>
      </section>
    );
  }

  const current = layout.sheets[sheetIndex]!;
  const pair = side === 'front' ? current.front : current.back;

  return (
    <section className="card">
      <header className="card-header flex items-center justify-between">
        <span>{t('preview.title')}</span>
        <span className="text-xs text-slate-500">
          {t('preview.sheet', { current: sheetIndex + 1, total: layout.sheetCount })}
        </span>
      </header>
      <div className="card-body space-y-3">
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-xs"
            disabled={sheetIndex === 0}
            onClick={() => setSheetIndex((i) => Math.max(0, i - 1))}
          >
            ‹
          </button>
          <button
            className="btn-secondary text-xs"
            disabled={sheetIndex === layout.sheetCount - 1}
            onClick={() => setSheetIndex((i) => Math.min(layout.sheetCount - 1, i + 1))}
          >
            ›
          </button>
          <div className="ms-auto flex rounded-md bg-slate-100 p-1">
            <button
              className={`px-3 py-1 text-xs rounded ${
                side === 'front' ? 'bg-white shadow-sm' : ''
              }`}
              onClick={() => setSide('front')}
            >
              {t('preview.front')}
            </button>
            <button
              className={`px-3 py-1 text-xs rounded ${
                side === 'back' ? 'bg-white shadow-sm' : ''
              }`}
              onClick={() => setSide('back')}
            >
              {t('preview.back')}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PagePreview pageNumber={pair.left} />
          <PagePreview pageNumber={pair.right} />
        </div>
      </div>
    </section>
  );
}

function PagePreview({ pageNumber }: { pageNumber: number }): JSX.Element {
  const isBlank = pageNumber === 0;
  return (
    <div
      className={`aspect-[1/1.414] flex items-center justify-center rounded-md border-2 border-dashed ${
        isBlank ? 'border-slate-200 bg-slate-50 text-slate-300' : 'border-slate-300 bg-white text-slate-700'
      }`}
    >
      <span className="text-4xl font-bold">{isBlank ? '—' : pageNumber}</span>
    </div>
  );
}
