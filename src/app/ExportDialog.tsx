import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { rgbToLab } from '../lib/color';
import { export3dPng, exportArtwork, exportFoamPads, exportLayerFiles, exportPdf, exportPtc, hasFoamPads, IN, PTC_MAX, ptcFit, sheetsFor, withDistinctColors, type ExportLayer, type PaperSize } from '../lib/exporters';
import { hexToRgb } from '../lib/color';
import type { MarkOptions } from '../lib/svg';
import { Help } from './controls';
import { Icon } from './Icon';

type Mode = 'A' | 'B';

interface Props {
  layers: ExportLayer[];
  widthMm: number;
  heightMm: number;
  marks: MarkOptions;
  styleName: string;
  warnings: string[];
  thinTotal: number;
  onClose: () => void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ExportDialog({ layers, widthMm, heightMm, marks, styleName, warnings, thinTotal: thin, onClose }: Props) {
  const t = useT();
  const [m, setM] = useState<Mode>('A');
  const [paper, setPaper] = useState<PaperSize>('letter');
  // 純切割可一次勾選多個匯出項目：合併圖層（建議）、逐層檔案、泡棉墊片
  const [pick, setPick] = useState({ combined: true, each: false, foam: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalNodes = layers.reduce((s, l) => s + l.layer.nodes, 0);
  const sheets = layers.reduce((s, l) => s + sheetsFor(l.layer, widthMm, heightMm), 0);
  const fit = ptcFit(widthMm, heightMm, paper);
  const dark = layers.some((l) => rgbToLab(...hexToRgb(l.color))[0] < 15);

  const dup = withDistinctColors(layers).adjusted;
  const foamPads = hasFoamPads(layers);
  const foamOn = pick.foam && foamPads;
  const nothing = m === 'A' && !pick.combined && !pick.each && !foamOn;

  const run = async (fn: () => unknown) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // 同時勾選多項時依序下載，中間稍微間隔，避免瀏覽器略過連續觸發的下載
  const go = () =>
    run(async () => {
      if (m === 'B') return exportPtc(layers, widthMm, heightMm, paper);
      let first = true;
      const step = async (fn: () => unknown) => {
        if (!first) await wait(350);
        first = false;
        await fn();
      };
      if (pick.combined) await step(() => exportArtwork(layers, widthMm, heightMm, marks));
      if (pick.each) await step(() => exportLayerFiles(layers, widthMm, heightMm, marks));
      if (foamOn) await step(() => exportFoamPads(layers, widthMm, heightMm, marks));
    });

  const cards: { id: Mode; icon: string; title: 'modeA' | 'modeB'; desc: 'modeADesc' | 'modeBDesc' }[] = [
    { id: 'A', icon: 'scissors', title: 'modeA', desc: 'modeADesc' },
    { id: 'B', icon: 'printer', title: 'modeB', desc: 'modeBDesc' },
  ];
  const steps = m === 'A' ? (['cutStep1', 'cutStep2', 'cutStep3'] as const) : (['ptcStep1', 'ptcStep2', 'ptcStep3'] as const);
  const items: { key: 'combined' | 'each' | 'foam'; label: 'itemCombined' | 'itemEach' | 'itemFoam'; disabled?: boolean; help?: string }[] = [
    { key: 'combined', label: 'itemCombined', help: t('altCombinedHelp') },
    { key: 'each', label: 'itemEach', help: t('altEachHelp') },
    { key: 'foam', label: 'itemFoam', disabled: !foamPads, help: t('foamPadsHelp') },
  ];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('exportTitle')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('exportTitle')}</h2>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose}><Icon name="x" /></button>
        </header>
        {warnings.map((w) => (
          <p key={w} className="notice warn"><Icon name="warn" size={16} />{w}</p>
        ))}

        {/* ① 切割檔：純切割 / 列印再切割 二選一 */}
        <section className="exp-sec">
          <h3>{t('secCut')}</h3>
          <div className="cards two">
            {cards.map((c) => (
              <button key={c.id} type="button" className={'card' + (m === c.id ? ' on' : '')} aria-pressed={m === c.id} onClick={() => setM(c.id)}>
                <Icon name={c.icon} size={26} />
                <strong>{t(c.title)}</strong>
                <small>{t(c.desc)}</small>
              </button>
            ))}
          </div>

          {/* 摘要與紙張清單：預設收合，緊接在選擇卡片之後 */}
          <details className="exp-more exp-summary">
            <summary>{t('summaryMore', { n: layers.length, sheets })}</summary>
            <div className="summary">
              <div><small>{t('sumLayers')}</small><b>{layers.length}</b></div>
              <div><small>{t('sumSize')}</small><b>{(widthMm / 10).toFixed(1)} × {(heightMm / 10).toFixed(1)} cm</b><small>{(widthMm / IN).toFixed(2)} × {(heightMm / IN).toFixed(2)} in</small></div>
              <div><small>{t('sumNodes')}</small><b>{totalNodes.toLocaleString()}</b></div>
              <div className={thin ? 'bad' : ''}><small>{t('sumThin')}</small><b>{thin}</b></div>
              <div><small>{t('sumSheets')}</small><b>{sheets}</b></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('colOrder')}</th><th>{t('colColor')}</th><th>HEX / RGB</th><th>{t('colArea')}</th><th>{t('colSheets')}</th><th>{t('colNodes')}</th></tr>
                </thead>
                <tbody>
                  {layers.map((l, i) => (
                    <tr key={l.layer.id}>
                      <td>{i + 1}</td>
                      <td><span className="sw" style={{ background: l.color }} /> {l.name}{l.foam ? ` (${t('foamTag')})` : ''}</td>
                      <td className="mono">{l.color}<br /><small>{hexToRgb(l.color).join(', ')}</small></td>
                      <td>{(l.layer.areaMm2 / 100).toFixed(1)} cm²</td>
                      <td>{sheetsFor(l.layer, widthMm, heightMm)}</td>
                      <td className={l.layer.nodes > 8000 ? 'bad' : ''}>{l.layer.nodes.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">{t('dsNote')}</p>
          </details>

          <div className="instr">
            <strong>{t('instrLabel')}</strong>
            <ol>
              {steps.map((k, i) => (
                <li key={k}><span className="num" aria-hidden>{'①②③'[i]}</span>{t(k)}</li>
              ))}
            </ol>
          </div>
          {m === 'A' && dup.length > 0 && <p className="notice warn"><Icon name="warn" size={16} />{t('dupColors', { names: dup.map((l) => `「${l.name}」（→ ${l.color}）`).join('、') })}</p>}
          {m === 'B' && fit.scale < 1 && <p className="notice warn"><Icon name="warn" size={16} />{t('ptcFit', { w: (fit.w / 10).toFixed(1), h: (fit.h / 10).toFixed(1) })}</p>}
          {m === 'B' && dark && <p className="notice warn"><Icon name="warn" size={16} />{t('ptcDark')}</p>}

          {/* 選擇匯出項目（純切割可複選）/ 紙張尺寸（列印再切割），右側一個下載鈕 */}
          <div className="exp-pick">
            <fieldset className="exp-opts">
              <legend>{m === 'A' ? t('selectItems') : t('selectPaper')}{m === 'B' && <Help text={t('ptcMax', { w: PTC_MAX[paper].w, h: PTC_MAX[paper].h, paper: paper === 'letter' ? 'Letter' : 'A4' })} />}</legend>
              {m === 'A'
                ? items.map((it) => (
                    <label key={it.key} className={'opt' + (it.disabled ? ' disabled' : '')}>
                      <input type="checkbox" checked={pick[it.key] && !it.disabled} disabled={it.disabled} onChange={(e) => setPick({ ...pick, [it.key]: e.target.checked })} />
                      <span>{t(it.label)}</span>
                      {it.help && <Help text={it.help} />}
                    </label>
                  ))
                : (['letter', 'a4'] as const).map((p) => (
                    <label key={p} className="opt">
                      <input type="radio" name="paper" checked={paper === p} onChange={() => setPaper(p)} />
                      <span>{p === 'letter' ? 'Letter' : 'A4'}</span>
                    </label>
                  ))}
            </fieldset>
            <button type="button" className="btn primary" onClick={go} disabled={busy || !layers.length || nothing}>
              <Icon name="download" size={16} />
              <span>{busy ? t('downloading') : t('download')}</span>
            </button>
          </div>
        </section>

        {/* ② 製作說明書：另一種用途，獨立下載 */}
        <section className="exp-sec">
          <h3>{t('secGuide')}</h3>
          <button type="button" className="btn-link" disabled={busy || !layers.length} onClick={() => run(async () => { await exportPdf(layers, widthMm, heightMm, styleName, t); await export3dPng(layers, widthMm, heightMm); })}>
            <Icon name="download" size={16} /><span>{t('guideBtn')}</span>
          </button>
        </section>
        {err && <p className="notice warn">{err}</p>}
      </div>
    </div>
  );
}
