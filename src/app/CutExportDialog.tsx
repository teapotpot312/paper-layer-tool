import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { checkCutSvg, cutSvg } from '../lib/cutExport';
import { downloadText, IN } from '../lib/exporters';
import type { CutParams, CutResult } from '../lib/types';
import { Icon } from './Icon';

interface Props {
  result: CutResult;
  cut: CutParams;
  onClose: () => void;
}

/** 單色切割匯出：切割前檢查摘要 + 單一 SVG。下載前會對最終 SVG 再檢查一次路徑 */
export function CutExportDialog({ result, onClose }: Props) {
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  const svg = useMemo(() => cutSvg(result), [result]);
  const c = result.check;
  const problems = c.open + c.outOfBounds + c.duplicates + (c.invalid ? 1 : 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = () => {
    const after = checkCutSvg(svg);
    if (!after.ok) {
      setErr(t('cutExportFail'));
      return;
    }
    setErr(null);
    downloadText(svg, 'cut.svg', 'image/svg+xml');
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('cutExportTitle')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('cutExportTitle')}</h2>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose}><Icon name="x" /></button>
        </header>
        <section className="exp-sec">
          <h3>{t('cutSumTitle')}</h3>
          <div className="summary">
            <div><small>{t('cutSumSize')}</small><b>{(result.widthMm / 10).toFixed(1)} × {(result.heightMm / 10).toFixed(1)} cm</b><small>{(result.widthMm / IN).toFixed(2)} × {(result.heightMm / IN).toFixed(2)} in</small></div>
            <div><small>{t('cutSumPieces')}</small><b>{result.pieces}</b></div>
            <div><small>{t('cutSumHoles')}</small><b>{result.holes}</b></div>
            <div className={result.unresolved ? 'bad' : ''}><small>{t('cutSumIslands')}</small><b>{result.islands}</b></div>
            <div><small>{t('cutSumBridges')}</small><b>{result.bridges.length}</b></div>
            <div><small>{t('cutSumNodes')}</small><b>{result.nodes.toLocaleString()}</b></div>
            <div className={result.thinCount ? 'bad' : ''}><small>{t('cutSumThin')}</small><b>{result.thinCount}</b></div>
          </div>
          <p className={'notice ' + (problems ? 'warn' : 'ok')}>
            {problems ? <Icon name="warn" size={16} /> : null}
            <span>{t('cutSumPath')}: {problems ? t('cutPathBad', { n: problems }) : t('cutPathOk')}</span>
          </p>
          {result.unresolved > 0 && <p className="notice warn"><Icon name="warn" size={16} />{t('cutLoose', { n: result.unresolved })}</p>}
          {result.thinCount > 0 && <p className="notice warn"><Icon name="warn" size={16} />{t('cutThinNote')}</p>}
          <p className="steps">{t('cutSvgSteps')}</p>
          <div className="btn-row">
            <button type="button" className="btn primary big" onClick={download} disabled={!result.d}>
              <Icon name="download" />
              <span>{t('cutExportBtn')}</span>
            </button>
          </div>
        </section>
        {err && <p className="notice warn">{err}</p>}
        <p className="note">{t('dsNote')}</p>
      </div>
    </div>
  );
}
