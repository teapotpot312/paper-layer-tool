import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { rgbToLab } from '../lib/color';
import { export3dPng, exportCutZip, exportPdf, exportPtc, IN, PTC_MAX, ptcFit, sheetsFor, type ExportLayer, type PaperSize } from '../lib/exporters';
import { hexToRgb } from '../lib/color';
import type { MarkOptions } from '../lib/svg';
import type { StackMode } from '../lib/types';
import { Segmented, Toggle } from './controls';
import { Icon } from './Icon';

type Mode = 'A' | 'B' | 'C';

interface Props {
  layers: ExportLayer[];
  widthMm: number;
  heightMm: number;
  marks: MarkOptions;
  mode: StackMode;
  warnings: string[];
  thinTotal: number;
  onClose: () => void;
}

export function ExportDialog({ layers, widthMm, heightMm, marks, mode, warnings, thinTotal: thin, onClose }: Props) {
  const t = useT();
  const [m, setM] = useState<Mode>('A');
  const [combined, setCombined] = useState(true);
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

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (m === 'A') exportCutZip(layers, widthMm, heightMm, marks, combined, t);
      else if (m === 'B') await exportPtc(layers, widthMm, heightMm, paper);
      else {
        await exportPdf(layers, widthMm, heightMm, mode, t);
        await export3dPng(layers, widthMm, heightMm);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const cards: { id: Mode; icon: string; title: 'modeA' | 'modeB' | 'modeC'; desc: 'modeADesc' | 'modeBDesc' | 'modeCDesc' }[] = [
    { id: 'A', icon: 'scissors', title: 'modeA', desc: 'modeADesc' },
    { id: 'B', icon: 'printer', title: 'modeB', desc: 'modeBDesc' },
    { id: 'C', icon: 'file', title: 'modeC', desc: 'modeCDesc' },
  ];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('exportTitle')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('exportTitle')}</h2>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="cards three">
          {cards.map((c) => (
            <button key={c.id} type="button" className={'card' + (m === c.id ? ' on' : '')} aria-pressed={m === c.id} onClick={() => setM(c.id)}>
              <Icon name={c.icon} size={28} />
              <strong>{t(c.title)}</strong>
              <small>{t(c.desc)}</small>
            </button>
          ))}
        </div>

        {m === 'A' && <Toggle checked={combined} onChange={setCombined} label={t('combined')} />}
        {m === 'B' && (
          <div className="ptc">
            <div className="row">
              <span>{t('paper')}</span>
              <Segmented value={paper} label={t('paper')} options={[{ v: 'letter', label: 'Letter' }, { v: 'a4', label: 'A4' }]} onChange={setPaper} />
            </div>
            <p className="ctrl-help">{t('ptcMax', { w: PTC_MAX[paper].w, h: PTC_MAX[paper].h, paper: paper === 'letter' ? 'Letter' : 'A4' })}</p>
            {fit.scale < 1 && <p className="notice warn"><Icon name="warn" size={16} />{t('ptcFit', { w: (fit.w / 10).toFixed(1), h: (fit.h / 10).toFixed(1) })}</p>}
            {dark && <p className="notice warn"><Icon name="warn" size={16} />{t('ptcDark')}</p>}
            <p className="steps">{t('ptcSteps')}</p>
          </div>
        )}

        <h3>{t('summary')}</h3>
        <div className="summary">
          <div><small>{t('sumLayers')}</small><b>{layers.length}</b></div>
          <div><small>{t('sumSize')}</small><b>{(widthMm / 10).toFixed(1)} × {(heightMm / 10).toFixed(1)} cm</b><small>{(widthMm / IN).toFixed(2)} × {(heightMm / IN).toFixed(2)} in</small></div>
          <div><small>{t('sumNodes')}</small><b>{totalNodes.toLocaleString()}</b></div>
          <div className={thin ? 'bad' : ''}><small>{t('sumThin')}</small><b>{thin}</b></div>
          <div><small>{t('sumSheets')}</small><b>{sheets}</b></div>
        </div>
        {warnings.map((w) => (
          <p key={w} className="notice warn"><Icon name="warn" size={16} />{w}</p>
        ))}

        <h3>{t('paperList')}</h3>
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
        {err && <p className="notice warn">{err}</p>}
        <footer>
          <button type="button" className="btn" onClick={onClose}>{t('close')}</button>
          <button type="button" className="btn primary big" onClick={go} disabled={busy || !layers.length}>
            <Icon name="download" />
            <span>{busy ? t('downloading') : t('download')}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
