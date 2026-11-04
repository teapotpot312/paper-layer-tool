import { useState } from 'react';
import { useT } from '../i18n';
import { hexToRgb } from '../lib/color';
import type { LayerMeta } from '../lib/project';
import type { LayerOpts } from '../lib/types';
import type { ViewLayer } from './CanvasView';
import { Segmented, Slider } from './controls';
import { Icon } from './Icon';

interface Props {
  layers: ViewLayer[]; // 由下到上
  selected: number | null;
  onSelect: (id: number | null) => void;
  onMeta: (id: number, patch: LayerMeta) => void;
  onReorder: (order: number[]) => void;
  opts: Record<number, LayerOpts>;
  onOpts: (id: number, patch: LayerOpts) => void;
  /** 全域：保留鏤空 */
  globalHoles: boolean;
  /** 全域泡棉厚度（預覽） */
  foamMm: number;
}

const isOverridden = (o: LayerOpts | undefined, foamMm: number | undefined) =>
  !!o?.extra || o?.keepHoles !== undefined || o?.foam !== undefined || foamMm !== undefined;

function Override({ onReset }: { onReset: () => void }) {
  const t = useT();
  return (
    <span className="ovr">
      <em className="tag ovr-tag">● {t('overridden')}</em>
      <button type="button" className="chip" onClick={onReset}>{t('resetGlobal')}</button>
    </span>
  );
}

export function LayerPanel({ layers, selected, onSelect, onMeta, onReorder, opts, onOpts, globalHoles, foamMm }: Props) {
  const t = useT();
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const top = [...layers].reverse(); // 面板由上到下顯示（同 Design Space）
  const sel = layers.find((l) => l.layer.id === selected);
  const so: LayerOpts = (sel && opts[sel.layer.id]) || {};

  const drop = (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const ids = top.map((l) => l.layer.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    onReorder(ids.reverse());
  };

  const move = (id: number, dir: 1 | -1) => {
    const ids = layers.map((l) => l.layer.id);
    const i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder(ids);
  };

  return (
    <aside className="right" aria-label={t('layersTitle')}>
      <h2>{t('layersTitle')}</h2>
      {!layers.length && <p className="note">{t('noLayers')}</p>}
      <ul className="layer-list">
        {top.map((l) => {
          const idx = layers.indexOf(l) + 1;
          const isSel = selected === l.layer.id;
          return (
            <li
              key={l.layer.id}
              className={'layer-row' + (isSel ? ' sel' : '') + (overId === l.layer.id ? ' over' : '') + (l.visible ? '' : ' hidden')}
              draggable
              onDragStart={(e) => { setDragId(l.layer.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(l.layer.id)); }}
              onDragOver={(e) => { e.preventDefault(); setOverId(l.layer.id); }}
              onDragLeave={() => setOverId(null)}
              onDrop={(e) => { e.preventDefault(); drop(l.layer.id); setOverId(null); setDragId(null); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onClick={() => onSelect(isSel ? null : l.layer.id)}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(l.layer.id, 1); }
                if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(l.layer.id, -1); }
              }}
              tabIndex={0}
            >
              <span className="grip" title={t('dragHint')}><Icon name="grip" size={18} /></span>
              <button
                type="button"
                className="icon-btn"
                aria-label={l.visible ? t('hide') : t('show')}
                title={l.visible ? t('hide') : t('show')}
                onClick={(e) => { e.stopPropagation(); onMeta(l.layer.id, { hidden: l.visible }); }}
              >
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={18} />
              </button>
              <label className="swatch" style={{ background: l.color }} title={t('changeColor')} onClick={(e) => e.stopPropagation()}>
                <input type="color" value={l.color.toLowerCase()} aria-label={t('changeColor')} onChange={(e) => onMeta(l.layer.id, { color: e.target.value.toUpperCase() })} />
              </label>
              <div className="layer-info">
                {editing === l.layer.id ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={l.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { onMeta(l.layer.id, { name: e.target.value.trim() || undefined }); setEditing(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
                  />
                ) : (
                  <span className="layer-name" title={t('rename')} onDoubleClick={(e) => { e.stopPropagation(); setEditing(l.layer.id); }}>
                    {l.name}
                    {l.layer.isBg && <em className="tag">{t('bgTag')}</em>}
                    {l.layer.foam && <em className="tag foam">{t('foamTag')}</em>}
                    {isOverridden(opts[l.layer.id], l.foamMm) && <span className="ovr-dot" title={t('overridden')} aria-label={t('overridden')} />}
                  </span>
                )}
                <small>
                  {idx === layers.length ? t('top') + ' · ' : idx === 1 ? t('bottom') + ' · ' : ''}
                  {(l.layer.areaMm2 / 100).toFixed(1)} cm² · {t('objects', { n: l.layer.objects })}
                  {l.layer.thinCount > 0 && <span className="thin-dot" title={t('thinFound', { n: l.layer.thinCount })}> ● {l.layer.thinCount}</span>}
                </small>
              </div>
            </li>
          );
        })}
      </ul>
      {sel && (
        <div className="sel-panel">
          <h3>{t('selLayer')}：{sel.name}</h3>
          <p className="mono">
            {sel.color} · RGB({hexToRgb(sel.color).join(', ')})
          </p>
          <p className="ctrl-help">{t('colorNote')}</p>
          <p className="ctrl-help">{t('overrideHint')}</p>
          <Slider
            label={t('extra')}
            help={t('extendHelp')}
            value={so.extra ?? 0}
            min={-1}
            max={3}
            step={0.1}
            unit="mm"
            format={(v) => v.toFixed(1)}
            onChange={(v) => onOpts(sel.layer.id, { extra: v === 0 ? undefined : v })}
            extra={so.extra ? <Override onReset={() => onOpts(sel.layer.id, { extra: undefined })} /> : null}
          />
          <div className="ctrl">
            <div className="ctrl-head">
              <label>{t('holesRow')}</label>
              {so.keepHoles !== undefined && <Override onReset={() => onOpts(sel.layer.id, { keepHoles: undefined })} />}
            </div>
            <Segmented
              value={(so.keepHoles ?? globalHoles) ? 'keep' : 'fill'}
              label={t('holesRow')}
              options={[{ v: 'keep', label: t('holesKeep') }, { v: 'fill', label: t('holesFill') }]}
              onChange={(v) => onOpts(sel.layer.id, { keepHoles: (v === 'keep') === globalHoles ? undefined : v === 'keep' })}
            />
          </div>
          <div className="ctrl">
            <div className="ctrl-head">
              <label>{t('foamRow')}</label>
              {so.foam !== undefined && <Override onReset={() => onOpts(sel.layer.id, { foam: undefined })} />}
            </div>
            <Segmented
              value={sel.layer.foam ? 'on' : 'flat'}
              label={t('foamRow')}
              options={[{ v: 'flat', label: t('foamFlat') }, { v: 'on', label: t('foamOn') }]}
              onChange={(v) => onOpts(sel.layer.id, { foam: (v === 'on') === sel.layer.foamAuto ? undefined : v === 'on' })}
            />
          </div>
          {sel.layer.foam && (
            <Slider
              label={t('layerFoam')}
              help={t('layerFoamHelp')}
              value={sel.foamMm ?? foamMm}
              min={0}
              max={10}
              step={0.5}
              unit="mm"
              onChange={(v) => onMeta(sel.layer.id, { foamMm: v === foamMm ? undefined : v })}
              extra={sel.foamMm !== undefined ? <Override onReset={() => onMeta(sel.layer.id, { foamMm: undefined })} /> : null}
            />
          )}
        </div>
      )}
    </aside>
  );
}
