import { useState } from 'react';
import { CutGuide } from './CutGuide';
import { useT } from '../i18n';
import { BRIDGE_WIDTHS, type CutMethod, type CutParams } from '../lib/types';
import type { Unit } from '../lib/project';
import { Help, Segmented, Slider, Toggle } from './controls';
import { Icon } from './Icon';

interface Props {
  cut: CutParams;
  setCut: (patch: Partial<CutParams>) => void;
  unit: Unit;
  setUnit: (u: Unit) => void;
  onUpload: () => void;
}

/** 單色切割模式的左側設定：上傳、切割設定（之後的階段會陸續加入清理與連接橋） */
export function CutSidebar({ cut, setCut, unit, setUnit, onUpload }: Props) {
  const t = useT();
  const [open, setOpen] = useState(() => window.innerWidth > 760);
  const [guide, setGuide] = useState(false);
  const methods: CutMethod[] = ['outline', 'stencil'];
  const inch = unit === 'in';
  const widthVal = inch ? cut.widthMm / 25.4 : cut.widthMm / 10;
  return (
    <aside className="left">
      <nav className="toolbar" aria-label="tools">
        <button type="button" className={'tool' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>
          <Icon name="scissors" size={22} /><span>{t('cutSetup')}</span>
        </button>
        <button type="button" className="tool" onClick={onUpload}>
          <Icon name="upload" size={22} /><span>{t('tUpload')}</span>
        </button>
      </nav>
      {open && (
        <section className="panel" aria-label={t('cutSetup')}>
          <button type="button" className="panel-close" aria-label={t('close')} onClick={() => setOpen(false)}><Icon name="x" size={16} /></button>
          <h2>{t('cutSetup')}</h2>
          <div className="style-head" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="chip info" onClick={() => setGuide(true)} aria-label={t('sgOpen')}>
              <span className="i" aria-hidden>i</span>{t('sgOpen')}
            </button>
          </div>
          <div className="cards compact">
            {methods.map((m) => (
              <button key={m} type="button" className={'card' + (cut.method === m ? ' on' : '')} aria-pressed={cut.method === m} onClick={() => setCut({ method: m })}>
                <MethodIcon method={m} />
                <strong>{t(m === 'outline' ? 'cutOutline' : 'cutStencil')}</strong>
              </button>
            ))}
          </div>
          <div className="rule" role="separator" />
          <div className="ctrl">
            <div className="ctrl-head"><label htmlFor="cw">{t('width')}</label><Help text={t('widthHelp')} /></div>
            <div className="row">
              <input
                id="cw"
                type="number"
                min={inch ? 1 : 2}
                max={inch ? 48 : 120}
                step={inch ? 0.25 : 0.5}
                value={Number(widthVal.toFixed(2))}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) setCut({ widthMm: inch ? v * 25.4 : v * 10 });
                }}
              />
              <Segmented value={unit} label={t('width')} options={[{ v: 'cm', label: t('cm') }, { v: 'in', label: t('inch') }]} onChange={setUnit} />
            </div>
          </div>
          <Slider label={t('cutThreshold')} help={t('cutThresholdHelp')} value={cut.threshold} min={10} max={245} onChange={(v) => setCut({ threshold: v })} />
          {cut.method === 'stencil' && (
            <>
              <div className="rule" role="separator" />
            <div className="bridge-box">
              <Toggle checked={cut.autoBridge} onChange={(v) => setCut({ autoBridge: v })} label={t('bridgeAuto')} help={t('bridgeAutoHelp')} />
              <div className={'ctrl' + (cut.autoBridge ? '' : ' disabled')}>
                <div className="ctrl-head"><label>{t('bridgeWidth')}</label><Help text={t('bridgeWidthHelp')} /></div>
                <Segmented value={String(cut.bridgeMm)} label={t('bridgeWidth')} options={BRIDGE_WIDTHS.map((v) => ({ v: String(v), label: v.toFixed(1) + ' mm' }))} onChange={(v) => setCut({ bridgeMm: Number(v) })} />
              </div>
            </div>
            </>
          )}
          <details className="adv">
            <summary>{t('pClean')}</summary>
            <Slider label={t('blur')} help={t('blurHelp')} value={cut.blur} min={0} max={3} onChange={(v) => setCut({ blur: v })} />
            <Slider label={t('smooth')} help={t('smoothHelp')} value={cut.smooth} min={0} max={10} onChange={(v) => setCut({ smooth: v })} />
            <Slider label={t('minArea')} help={t('cutMinAreaHelp')} value={cut.minAreaMm2} min={0} max={30} step={0.5} unit="mm²" onChange={(v) => setCut({ minAreaMm2: v })} />
            {cut.method === 'stencil' && (
              <Slider label={t('fill')} help={t('fillHelp')} value={cut.fillMm2} min={0} max={30} step={0.5} unit="mm²" onChange={(v) => setCut({ fillMm2: v })} />
            )}
            <Slider label={t('minWidth')} help={t('minWidthHelp')} value={cut.minWidthMm} min={0.5} max={4} step={0.1} unit="mm" format={(v) => v.toFixed(1)} onChange={(v) => setCut({ minWidthMm: v })} />
          </details>
        </section>
      )}
      {guide && <CutGuide current={cut.method} onPick={(m) => setCut({ method: m })} onClose={() => setGuide(false)} />}
    </aside>
  );
}

function MethodIcon({ method }: { method: CutMethod }) {
  const d = method === 'outline' ? 'M30 3a15 15 0 1 1 0 30 15 15 0 0 1 0-30z' : 'M30 3a15 15 0 1 1 0 30 15 15 0 0 1 0-30zM24 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM36 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM22 22q8 7 16 0l-2-1q-6 4-12 0z';
  return (
    <svg viewBox="0 0 60 36" width="60" height="36" aria-hidden>
      <path fillRule="evenodd" fill="currentColor" d={d} />
    </svg>
  );
}
