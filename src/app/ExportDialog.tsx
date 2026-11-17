import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { rgbToLab } from '../lib/color';
import { export3dPng, exportArtwork, exportCutZip, exportFoamPads, exportLayerFiles, exportPdf, exportPtc, hasFoamPads, IN, PTC_MAX, ptcFit, sheetsFor, withDistinctColors, type ExportLayer, type PaperSize } from '../lib/exporters';
import { hexToRgb } from '../lib/color';
import type { MarkOptions } from '../lib/svg';
import { Help, Segmented } from './controls';
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

export function ExportDialog({ layers, widthMm, heightMm, marks, styleName, warnings, thinTotal: thin, onClose }: Props) {
  const t = useT();
  const [m, setM] = useState<Mode>('A');
  const [paper, setPaper] = useState<PaperSize>('letter');
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

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (m === 'A') exportArtwork(layers, widthMm, heightMm, marks);
      else await exportPtc(layers, widthMm, heightMm, paper);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const cards: { id: Mode; icon: string; title: 'modeA' | 'modeB'; desc: 'modeADesc' | 'modeBDesc' }[] = [
    { id: 'A', icon: 'scissors', title: 'modeA', desc: 'modeADesc' },
    { id: 'B', icon: 'printer', title: 'modeB', desc: 'modeBDesc' },
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
          {m === 'A' ? (
            <>
              <p className="steps">{t('cutSteps')}</p>
              {dup.length > 0 && <p className="notice warn"><Icon name="warn" size={16} />{t('dupColors', { names: dup.map((l) => `「${l.name}」（→ ${l.color}）`).join('、') })}</p>}
            </>
          ) : (
            <>
              <div className="row">
                <span>{t('paper')}</span>
                <Segmented value={paper} label={t('paper')} options={[{ v: 'letter', label: 'Letter' }, { v: 'a4', label: 'A4' }]} onChange={setPaper} />
                <Help text={t('ptcMax', { w: PTC_MAX[paper].w, h: PTC_MAX[paper].h, paper: paper === 'letter' ? 'Letter' : 'A4' })} />
              </div>
              {fit.scale < 1 && <p className="notice warn"><Icon name="warn" size={16} />{t('ptcFit', { w: (fit.w / 10).toFixed(1), h: (fit.h / 10).toFixed(1) })}</p>}
              {dark && <p className="notice warn"><Icon name="warn" size={16} />{t('ptcDark')}</p>}
              <p className="steps">{t('ptcSteps')}</p>
            </>
          )}
          <div className="btn-row">
            <button type="button" className="btn primary big" onClick={go} disabled={busy || !layers.length}>
              <Icon name="download" />
              <span>{busy ? t('downloading') : m === 'A' ? t('artworkBtn') : t('ptcBtn')}</span>
            </button>
            {m === 'A' && foamPads && (
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => exportFoamPads(layers, widthMm, heightMm, marks))}>
                <Icon name="download" size={16} /><span>{t('foamPadsBtn')}</span>
              </button>
            )}
            {m === 'A' && foamPads && <Help text={t('foamPadsHelp')} />}
          </div>
          {m === 'A' && (
            <details className="exp-more">
              <summary>{t('altTitle')}</summary>
              <p className="ctrl-help">{t('altHelp')}</p>
              <p className="notice warn strong"><Icon name="warn" size={16} />{t('zipWarn')}<Help text={t('zipHow')} /></p>
              <div className="btn-row">
                <button type="button" className="btn" disabled={busy || !layers.length} onClick={() => run(() => exportLayerFiles(layers, widthMm, heightMm, marks))}>{t('altEach')}</button>
                <button type="button" className="btn" disabled={busy || !layers.length} onClick={() => run(() => exportCutZip(layers, widthMm, heightMm, marks, t))}>{t('altZip')}</button>
              </div>
            </details>
          )}
        </section>

        {/* ② 製作說明書：另一種用途，獨立下載 */}
        <section className="exp-sec">
          <h3>{t('secGuide')}</h3>
          <div className="guide-row">
            <Icon name="file" size={26} />
            <small>{t('modeCDesc')}</small>
            <button type="button" className="btn" disabled={busy || !layers.length} onClick={() => run(async () => { await exportPdf(layers, widthMm, heightMm, styleName, t); await export3dPng(layers, widthMm, heightMm); })}>
              <Icon name="download" size={16} /><span>{t('guideBtn')}</span>
            </button>
          </div>
        </section>

        {/* ③ 摘要與紙張清單：預設收合 */}
        <details className="exp-more">
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
        {err && <p className="notice warn">{err}</p>}
      </div>
    </div>
  );
}
