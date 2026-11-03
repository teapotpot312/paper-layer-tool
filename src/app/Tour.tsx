import { useState } from 'react';
import { useT } from '../i18n';

/** 首次使用導覽；最後一步可直接用內建範例圖體驗完整流程 */
export function Tour({ onClose, onSample, onUpload }: { onClose: (forever: boolean) => void; onSample: () => void; onUpload: () => void }) {
  const t = useT();
  const [i, setI] = useState(0);
  const steps = [
    [t('tour1t'), t('tour1')],
    [t('tour2t'), t('tour2')],
    [t('tour3t'), t('tour3')],
  ];
  const last = i === steps.length - 1;
  return (
    <div className="modal-back">
      <div className="modal tour" role="dialog" aria-modal="true" aria-label={steps[i][0]}>
        <div className="dots">{steps.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <h2>{steps[i][0]}</h2>
        <p>{steps[i][1]}</p>
        {last && (
          <div className="tour-sample">
            <p className="note">{t('tourSampleHint')}</p>
            <button type="button" className="btn primary big" onClick={onSample}>{t('useSample')}</button>
          </div>
        )}
        <footer>
          <button type="button" className="btn link" onClick={() => onClose(true)}>{t('neverShow')}</button>
          <button type="button" className={'btn' + (last ? '' : ' primary')} onClick={() => (last ? onUpload() : setI(i + 1))}>{last ? t('start') : t('next')}</button>
        </footer>
      </div>
    </div>
  );
}
