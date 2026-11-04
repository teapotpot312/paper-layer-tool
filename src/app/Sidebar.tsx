import { useState, type ReactElement } from 'react';
import { useT } from '../i18n';
import type { Doc } from '../lib/project';
import type { Params, PipelineResult } from '../lib/types';
import { Segmented, Slider, Toggle } from './controls';
import { Icon } from './Icon';
import { StyleGuide, type Style } from './StyleGuide';

export type PanelId = 'layers' | 'clean' | 'stack' | 'register';

interface Props {
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
  doc: Doc;
  setDoc: (fn: (d: Doc) => Doc) => void;
  setParams: (patch: Partial<Params>) => void;
  result: PipelineResult | null;
  showThin: boolean;
  setShowThin: (v: boolean) => void;
  onUpload: () => void;
  onExport: () => void;
  hasImage: boolean;
  thinTotal: number;
}

/** 依設定的必要性排序：① 分色 ② 樣式 是必做，③ 清理 ④ 對位 可略過 */
const TOOLS: { id: PanelId | 'upload' | 'export'; icon: string; key: 'tUpload' | 'tLayers' | 'tClean' | 'tStack' | 'tRegister' | 'tExport' }[] = [
  { id: 'upload', icon: 'upload', key: 'tUpload' },
  { id: 'layers', icon: 'layers', key: 'tLayers' },
  { id: 'stack', icon: 'stack', key: 'tStack' },
  { id: 'clean', icon: 'clean', key: 'tClean' },
  { id: 'register', icon: 'target', key: 'tRegister' },
  { id: 'export', icon: 'download', key: 'tExport' },
];

export function Sidebar(props: Props) {
  const t = useT();
  const { panel, setPanel, hasImage } = props;
  return (
    <aside className="left">
      <nav className="toolbar" aria-label="tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={'tool' + (panel === tool.id ? ' on' : '')}
            disabled={!hasImage && tool.id !== 'upload'}
            onClick={() => {
              if (tool.id === 'upload') props.onUpload();
              else if (tool.id === 'export') props.onExport();
              else setPanel(panel === tool.id ? null : tool.id);
            }}
          >
            <Icon name={tool.icon} size={22} />
            <span>{t(tool.key)}</span>
          </button>
        ))}
      </nav>
      {panel && hasImage && (
        <section className="panel" aria-label={t(panel === 'layers' ? 'pLayers' : panel === 'clean' ? 'pClean' : panel === 'stack' ? 'pStack' : 'pRegister')}>
          <button type="button" className="panel-close" aria-label={t('close')} onClick={() => setPanel(null)}><Icon name="x" size={16} /></button>
          {panel === 'layers' && <LayersPanel {...props} />}
          {panel === 'clean' && <CleanPanel {...props} />}
          {panel === 'stack' && <StackPanel {...props} />}
          {panel === 'register' && <RegisterPanel {...props} />}
        </section>
      )}
    </aside>
  );
}

function LayersPanel({ doc, setDoc, setParams, result }: Props) {
  const t = useT();
  const p = doc.params;
  const inch = doc.unit === 'in';
  const widthVal = inch ? p.widthMm / 25.4 : p.widthMm / 10;
  return (
    <>
      <h2>{t('pLayers')}</h2>
      <p className="panel-sub">{t('pLayersSub')}</p>
      <div className="ctrl">
        <div className="ctrl-head"><label htmlFor="w">{t('width')}</label></div>
        <div className="row">
          <input
            id="w"
            type="number"
            min={inch ? 1 : 2}
            max={inch ? 48 : 120}
            step={inch ? 0.25 : 0.5}
            value={Number(widthVal.toFixed(2))}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) setParams({ widthMm: inch ? v * 25.4 : v * 10 });
            }}
          />
          <Segmented value={doc.unit} label={t('width')} options={[{ v: 'cm', label: t('cm') }, { v: 'in', label: t('inch') }]} onChange={(u) => setDoc((d) => ({ ...d, unit: u }))} />
        </div>
        <div className="ctrl-help">{t('widthHelp')}</div>
      </div>
      <Slider
        label={t('k')}
        help={t('kHelp')}
        value={p.k ?? result?.effectiveK ?? 6}
        min={2}
        max={12}
        onChange={(v) => setParams({ k: v })}
        extra={
          <button type="button" className={'chip' + (p.k == null ? ' on' : '')} onClick={() => setParams({ k: null })}>
            {p.k == null ? t('autoOn') : t('auto')}
          </button>
        }
      />
      <Slider label={t('merge')} help={t('mergeHelp')} value={p.merge} min={0} max={40} onChange={(v) => setParams({ merge: v })} />
      <div className="ctrl">
        <div className="ctrl-head"><label>{t('bg')}</label></div>
        <Segmented value={p.bg} label={t('bg')} options={[{ v: 'keep', label: t('bgKeep') }, { v: 'remove', label: t('bgRemove') }, { v: 'plate', label: t('bgPlate') }]} onChange={(v) => setParams({ bg: v })} />
        <div className="ctrl-help">{t('bgHelp')}</div>
      </div>
      <Slider label={t('blur')} help={t('blurHelp')} value={p.blur} min={0} max={3} onChange={(v) => setParams({ blur: v })} />
    </>
  );
}

function CleanPanel({ doc, setParams, thinTotal: thin, showThin, setShowThin }: Props) {
  const t = useT();
  const p = doc.params;
  return (
    <>
      <h2>{t('pClean')}</h2>
      <p className="panel-sub">{t('pCleanSub')}</p>
      <Slider label={t('minArea')} help={t('minAreaHelp')} value={p.minAreaMm2} min={0} max={30} step={0.5} unit="mm²" onChange={(v) => setParams({ minAreaMm2: v })} />
      <Slider label={t('fill')} help={t('fillHelp')} value={p.fillMm2} min={0} max={30} step={0.5} unit="mm²" onChange={(v) => setParams({ fillMm2: v })} />
      <Slider label={t('smooth')} help={t('smoothHelp')} value={p.smooth} min={0} max={10} onChange={(v) => setParams({ smooth: v })} />
      <Slider label={t('minWidth')} help={t('minWidthHelp')} value={p.minWidthMm} min={0.5} max={4} step={0.1} unit="mm" format={(v) => v.toFixed(1)} onChange={(v) => setParams({ minWidthMm: v })} />
      <div className={'notice ' + (thin ? 'warn' : 'ok')}>
        {thin ? <Icon name="warn" size={16} /> : null}
        <span>{thin ? t('thinFound', { n: thin }) : t('thinNone')}</span>
      </div>
      <div className="ctrl">
        <div className="ctrl-head"><label>{t('fix')}</label></div>
        <Segmented value={p.fix} label={t('fix')} options={[{ v: 'off', label: t('fixOff') }, { v: 'thicken', label: t('fixThicken') }, { v: 'remove', label: t('fixRemove') }]} onChange={(v) => setParams({ fix: v })} />
      </div>
      <Toggle checked={showThin} onChange={setShowThin} label={t('showThin')} />
    </>
  );
}

/** 作品樣式：一次決定疊層方式、泡棉與鏤空，使用者不用自己組合開關 */
const STYLES: Record<Style, Pick<Params, 'mode' | 'depth' | 'keepHoles'>> = {
  flat: { mode: 'additive', depth: 'flat', keepHoles: false },
  slight: { mode: 'additive', depth: 'slight', keepHoles: false },
  strong: { mode: 'additive', depth: 'strong', keepHoles: false },
  cutout: { mode: 'independent', depth: 'flat', keepHoles: true },
};
export const styleOf = (p: Params): Style => (p.mode === 'independent' ? 'cutout' : p.depth);

function StackPanel({ doc, setParams, result }: Props) {
  const t = useT();
  const p = doc.params;
  const style = styleOf(p);
  const [guide, setGuide] = useState(false);
  const foamN = result?.layers.filter((l) => l.foam).length ?? 0;
  const cards: { id: Style; icon: ReactElement }[] = [
    { id: 'flat', icon: <DepthIcon depth="flat" /> },
    { id: 'slight', icon: <DepthIcon depth="slight" /> },
    { id: 'strong', icon: <DepthIcon depth="strong" /> },
    { id: 'cutout', icon: <StackIcon mode="independent" /> },
  ];
  return (
    <>
      <h2>{t('pStack')}</h2>
      <div className="style-head">
        <span className="ctrl-help">{t('styleHelp')}</span>
        <button type="button" className="chip info" onClick={() => setGuide(true)} aria-label={t('sgOpen')}>
          <span className="i" aria-hidden>i</span>{t('sgOpen')}
        </button>
      </div>
      <div className="cards compact">
        {cards.map((c) => (
          <button key={c.id} type="button" className={'card' + (style === c.id ? ' on' : '')} onClick={() => setParams(STYLES[c.id])} aria-pressed={style === c.id}>
            {c.icon}
            <strong>{t(`style_${c.id}`)}</strong>
            <small>{t(`style_${c.id}Desc`)}</small>
            {style === c.id && foamN > 0 && <small className="card-now">{t('cardFoam', { n: foamN })}</small>}
          </button>
        ))}
      </div>
      <div className="ctrl">
        <div className="ctrl-head"><label>{t('sort')}</label></div>
        <Segmented value={p.order ? ('' as 'light') : p.sort} label={t('sort')} options={[{ v: 'area', label: t('sortArea') }, { v: 'light', label: t('sortLight') }]} onChange={(v) => setParams({ sort: v, order: null })} />
        <div className="ctrl-help">{t('sortHint')}</div>
      </div>
      <details className="adv">
        <summary>{t('advanced')}</summary>
        {style === 'cutout' ? (
          <Slider label={t('extend')} help={t('extendHelp')} value={p.extendMm} min={0} max={3} step={0.1} unit="mm" format={(v) => v.toFixed(1)} onChange={(v) => setParams({ extendMm: v })} />
        ) : (
          <Slider label={t('foamInset')} help={t('foamInsetHelp')} value={p.foamInsetMm} min={0.5} max={3} step={0.1} unit="mm" format={(v) => v.toFixed(1)} onChange={(v) => setParams({ foamInsetMm: v })} />
        )}
      </details>
      {guide && <StyleGuide current={style} onPick={(s) => setParams(STYLES[s])} onClose={() => setGuide(false)} />}
    </>
  );
}

function StackIcon({ mode }: { mode: 'additive' | 'independent' }) {
  return mode === 'additive' ? (
    <svg viewBox="0 0 60 36" width="60" height="36" aria-hidden>
      <rect x="4" y="22" width="52" height="10" rx="3" fill="#7fd6cd" />
      <rect x="12" y="13" width="36" height="10" rx="3" fill="#2cb8a9" />
      <rect x="20" y="4" width="20" height="10" rx="3" fill="#007a6e" />
    </svg>
  ) : (
    <svg viewBox="0 0 60 36" width="60" height="36" aria-hidden>
      <rect x="4" y="22" width="14" height="10" rx="3" fill="#7fd6cd" />
      <rect x="42" y="22" width="14" height="10" rx="3" fill="#7fd6cd" />
      <rect x="16" y="13" width="8" height="10" rx="3" fill="#2cb8a9" />
      <rect x="36" y="13" width="8" height="10" rx="3" fill="#2cb8a9" />
      <rect x="22" y="4" width="16" height="10" rx="3" fill="#007a6e" />
    </svg>
  );
}

/** 側視圖：深色 = 紙，淺色方塊 = 泡棉 */
function DepthIcon({ depth }: { depth: 'flat' | 'slight' | 'strong' }) {
  const foam = depth === 'flat' ? [false, false, false] : depth === 'slight' ? [true, false, true] : [true, true, true];
  let y = 30;
  const parts: ReactElement[] = [<rect key="b" x="4" y={y} width="52" height="3" rx="1" fill="#7fd6cd" />];
  const widths = [40, 28, 16];
  widths.forEach((wd, i) => {
    const x = 30 - wd / 2;
    if (foam[i]) { y -= 6; parts.push(<rect key={'f' + i} x={x + 3} y={y + 1} width={wd - 6} height={5} fill="#e2c9a0" />); }
    y -= 3;
    parts.push(<rect key={'p' + i} x={x} y={y} width={wd} height="3" rx="1" fill={['#2cb8a9', '#00927f', '#007a6e'][i]} />);
  });
  return <svg viewBox="0 0 60 36" width="60" height="36" aria-hidden>{parts}</svg>;
}

function RegisterPanel({ doc, setDoc }: Props) {
  const t = useT();
  const m = doc.marks;
  const set = (patch: Partial<Doc['marks']>) => setDoc((d) => ({ ...d, marks: { ...d.marks, ...patch } }));
  return (
    <>
      <h2>{t('pRegister')}</h2>
      <p className="panel-sub">{t('pRegisterSub')}</p>
      <Toggle checked={m.enabled} onChange={(v) => set({ enabled: v })} label={t('marksOn')} />
      <div className="ctrl-help">{t('marksHelp')}</div>
      <div className={'ctrl' + (m.enabled ? '' : ' disabled')}>
        <div className="ctrl-head"><label>{t('markStyle')}</label></div>
        <Segmented value={m.style} label={t('markStyle')} options={[{ v: 'corner', label: t('markCorner') }, { v: 'circle', label: t('markCircle') }, { v: 'cross', label: t('markCross') }]} onChange={(v) => set({ style: v })} />
      </div>
      <Slider label={t('margin')} help={t('marginHelp')} value={m.margin} min={5} max={25} unit="mm" disabled={!m.enabled && !m.numbers} onChange={(v) => set({ margin: v })} />
      <Slider label={t('markSize')} help={t('markSizeHelp')} value={m.size} min={2} max={20} step={0.5} unit="mm" disabled={!m.enabled} onChange={(v) => set({ size: v })} />
      <Toggle checked={m.numbers} onChange={(v) => set({ numbers: v })} label={t('numbers')} />
      <p className="note">{t('regNote')}</p>
    </>
  );
}
