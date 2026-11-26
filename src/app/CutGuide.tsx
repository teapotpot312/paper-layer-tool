import { useEffect } from 'react';
import { useT } from '../i18n';
import type { CutMethod } from '../lib/types';
import { Icon } from './Icon';

const INK = '#2b2b2b';
const SHEET = '#f4f6fb';
const AMBER = '#f59e0b';

/** 兩種切割方式的示意圖：同一個臉形，內部填滿 vs. 內部鏤空（眼睛、嘴巴挖空，眼珠用橘色連接橋接回主體） */
function Sample({ method }: { method: CutMethod }) {
  return (
    <svg viewBox="0 0 200 110" className="sg-iso" aria-hidden>
      <rect width="200" height="110" fill={SHEET} />
      <circle cx="100" cy="55" r="44" fill={INK} />
      {method === 'stencil' && (
        <>
          <circle cx="84" cy="46" r="10" fill={SHEET} />
          <circle cx="116" cy="46" r="10" fill={SHEET} />
          <circle cx="84" cy="46" r="4.5" fill={INK} />
          <circle cx="116" cy="46" r="4.5" fill={INK} />
          <path d="M84 50.5V56M116 50.5V56" stroke={AMBER} strokeWidth="3" strokeLinecap="round" />
          <path d="M80 68q20 16 40 0l-3-3q-17 11-34 0z" fill={SHEET} />
        </>
      )}
    </svg>
  );
}

export function CutGuide({ current, onPick, onClose }: { current: CutMethod; onPick: (m: CutMethod) => void; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const methods: CutMethod[] = ['outline', 'stencil'];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal sg" role="dialog" aria-modal="true" aria-label={t('cutGuideTitle')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('cutGuideTitle')}</h2>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose}><Icon name="x" /></button>
        </header>
        <p className="ctrl-help">{t('cutGuideIntro')}</p>
        <div className="sg-grid two">
          {methods.map((m) => (
            <button key={m} type="button" className={'sg-card' + (current === m ? ' on' : '')} aria-pressed={current === m} onClick={() => { onPick(m); onClose(); }}>
              <Sample method={m} />
              <strong>{t(m === 'outline' ? 'cutOutline' : 'cutStencil')}{current === m && <em className="tag">{t('sgCurrent')}</em>}</strong>
              <small>{t(m === 'outline' ? 'cutOutlineDesc' : 'cutStencilDesc')}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
