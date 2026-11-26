import { useT } from '../i18n';
import type { CutResult, RegionSelection } from '../lib/types';
import { Icon } from './Icon';

interface Props {
  result: CutResult | null;
  sel: RegionSelection | null;
  onAction: (a: 'keep' | 'cut') => void;
}

/** 單色模式的右側「調整輪廓區域」：選取的區域只顯示用得到的動作，下方是孤島與連接橋、切割風險 */
export function RegionPanel({ result, sel, onAction }: Props) {
  const t = useT();
  const longest = result?.bridges.reduce((m, b) => Math.max(m, b.lengthMm), 0) ?? 0;
  const items = sel?.items ?? [];
  const single = items.length === 1 ? items[0] : null;
  // 已保留的才有「挖空」可做，已挖空的才有「保留」可做；兩種都有時兩個都顯示
  const canCut = items.some((i) => i.state === 'kept');
  const canKeep = items.some((i) => i.state === 'cut');
  const area = items.reduce((s, i) => s + i.areaMm2, 0);
  return (
    <aside className="right" aria-label={t('regionsTitle')}>
      <h2>{t('regionsTitle')}</h2>
      {!items.length ? (
        <p className="note">{t('regionHint')}</p>
      ) : (
        <div className="region-card">
          <div className="region-head">
            {single ? (
              <>
                <span className={'state-dot ' + (single.state === 'kept' ? 'kept' : 'cut')} aria-hidden />
                <strong>{t(single.state === 'kept' ? 'stateKept' : 'stateCut')}</strong>
                {single.forced && <em className="tag ovr-tag">● {t('forcedTag')}</em>}
              </>
            ) : (
              <strong>{t('regionSelN', { n: items.length, k: items.filter((i) => i.state === 'kept').length, c: items.filter((i) => i.state === 'cut').length })}</strong>
            )}
          </div>
          {items.some((i) => i.island) && <p className="notice warn"><Icon name="warn" size={16} />{t('regionIsland')}</p>}
          <div className="btn-row">
            {canKeep && <button type="button" className="btn primary" onClick={() => onAction('keep')}>{t('actKeep')}</button>}
            {canCut && <button type="button" className="btn primary" onClick={() => onAction('cut')}>{t('actCut')}</button>}
          </div>
          <span className="region-meta">{area.toFixed(1)} mm²</span>
        </div>
      )}

      {result && (
        <>
          <h3>{t('islandsTitle')}</h3>
          <ul className="region-list">
            <li><span>{t('islandsFound')}</span><b>{result.islands}</b></li>
            <li><span>{t('bridgesMade')}</span><b>{result.bridges.length}</b></li>
            {result.bridges.length > 0 && <li><span>{t('bridgeLongest')}</span><b>{longest.toFixed(1)} mm</b></li>}
            <li className={result.unresolved ? 'bad' : ''}><span>{t('islandsOpenCount')}</span><b>{result.unresolved}</b></li>
          </ul>
          {result.risks.length > 0 && (
            <>
              <h3>{t('risksTitle')}</h3>
              {result.risks.map((r) => (
                <p key={r} className="notice warn"><Icon name="warn" size={16} />{t(`risk_${r}`, { n: result.unresolved || result.unmapped })}</p>
              ))}
            </>
          )}
        </>
      )}
    </aside>
  );
}
