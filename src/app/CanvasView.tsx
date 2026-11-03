import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { canvasSize, markPaths, type MarkOptions } from '../lib/svg';
import type { LayerResult } from '../lib/types';

export interface ViewLayer {
  layer: LayerResult;
  color: string;
  name: string;
  visible: boolean;
}

export type ViewMode = 'flat' | 'layers' | 'stack';

/** 100% = 實際尺寸（96 dpi） */
export const PX_PER_MM = 96 / 25.4;

export interface CanvasHandle {
  fit: () => void;
  zoomBy: (f: number) => void;
}

interface Props {
  layers: ViewLayer[];
  widthMm: number;
  heightMm: number;
  marks: MarkOptions;
  view: ViewMode;
  selected: number | null;
  onSelect: (id: number | null) => void;
  showThin: boolean;
  original: string | null;
  gapMm: number;
  zoom: number;
  setZoom: (z: number) => void;
}

const clampZoom = (z: number) => Math.min(8, Math.max(0.05, z));

export const CanvasView = forwardRef<CanvasHandle, Props>(function CanvasView(props, ref) {
  const { layers, widthMm, heightMm, marks, view, zoom, setZoom } = props;
  const box = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState({ x: 50, z: -30 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean; rotate: boolean } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const { w: cw, h: ch } = canvasSize(widthMm, heightMm, marks);
  const n = layers.filter((l) => l.visible).length || 1;
  const cols = Math.ceil(Math.sqrt(n));
  const gridGap = Math.max(10, cw * 0.08);
  const contentW = view === 'layers' ? cols * cw + (cols - 1) * gridGap : cw;
  const contentH = view === 'layers' ? Math.ceil(n / cols) * (ch + gridGap * 1.2) : ch;

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 不可見（例如背景分頁）時尺寸為 0，等變成可見再算
    if (r.width < 20 || r.height < 20) return;
    const k = view === 'stack' ? 0.62 : 0.88;
    const z = clampZoom(Math.min((r.width * k) / (contentW * PX_PER_MM), (r.height * k) / (contentH * PX_PER_MM)));
    setZoom(z);
    setPan({ x: (r.width - contentW * PX_PER_MM * z) / 2, y: (r.height - contentH * PX_PER_MM * z) / 2 });
  }, [contentW, contentH, setZoom, view]);

  const zoomAt = useCallback(
    (f: number, cx?: number, cy?: number) => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = cx ?? r.width / 2, y = cy ?? r.height / 2;
      const old = zoomRef.current, nz = clampZoom(old * f);
      // 立即更新，連續滾輪事件在重繪前也能用到正確的縮放值
      zoomRef.current = nz;
      setPan((p) => ({ x: x - ((x - p.x) * nz) / old, y: y - ((y - p.y) * nz) / old }));
      setZoom(nz);
    },
    [setZoom],
  );

  useImperativeHandle(ref, () => ({ fit, zoomBy: (f) => zoomAt(f) }), [fit, zoomAt]);

  // 換圖或切換檢視時自動符合視窗
  useEffect(() => { fit(); }, [view, Math.round(contentW), Math.round(contentH)]); // eslint-disable-line react-hooks/exhaustive-deps

  // 畫布從不可見變成可見時補做一次符合視窗
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let wasHidden = el.getBoundingClientRect().width < 20;
    const ro = new ResizeObserver(([e]) => {
      const hidden = e.contentRect.width < 20 || e.contentRect.height < 20;
      if (wasHidden && !hidden) fitRef.current();
      wasHidden = hidden;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false, rotate: view === 'stack' && !e.shiftKey && e.button === 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.rotate) {
      setRot((r) => ({ x: Math.min(75, Math.max(0, r.x - (e.movementY || 0) * 0.4)), z: r.z + (e.movementX || 0) * 0.4 }));
    } else setPan({ x: d.px + dx, y: d.py + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && view !== 'stack') {
      const id = (e.target as Element).closest('[data-layer]')?.getAttribute('data-layer');
      props.onSelect(id != null ? Number(id) : null);
    }
  };

  const scale = PX_PER_MM * zoom;
  return (
    <div
      ref={box}
      className={'canvas' + (view === 'stack' ? ' rotating' : '')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        {view === 'flat' && <Flat {...props} scale={scale} />}
        {view === 'layers' && <Grid {...props} scale={scale} cols={cols} gridGap={gridGap} contentW={contentW} contentH={contentH} />}
        {view === 'stack' && <Stack {...props} scale={scale} rot={rot} />}
      </div>
    </div>
  );
});

function ArtSvg({ w, h, scale, children, className }: { w: number; h: number; scale: number; children: ReactNode; className?: string }) {
  return (
    <svg className={className} width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

function Marks({ widthMm, heightMm, marks, index, total }: { widthMm: number; heightMm: number; marks: MarkOptions; index: number; total: number }) {
  if (!marks.enabled && !marks.numbers) return null;
  const m = markPaths(widthMm, heightMm, marks, index, total);
  return <path d={m.marks + m.label} fill="#9aa5ad" />;
}

function Flat({ layers, widthMm, heightMm, marks, selected, showThin, original, scale }: Props & { scale: number }) {
  const { w, h, offset } = canvasSize(widthMm, heightMm, marks);
  const vis = layers.filter((l) => l.visible);
  return (
    <ArtSvg w={w} h={h} scale={scale} className="art">
      <rect width={w} height={h} fill="#ffffff" stroke="#c9d1d6" strokeWidth={0.3} />
      <Marks widthMm={widthMm} heightMm={heightMm} marks={marks} index={1} total={layers.length} />
      <g transform={`translate(${offset} ${offset})`}>
        {original ? (
          <image href={original} width={widthMm} height={heightMm} preserveAspectRatio="none" />
        ) : (
          <>
            {vis.map((l) => (
              <path key={l.layer.id} data-layer={l.layer.id} d={l.layer.d} fill={l.color} fillRule="evenodd" opacity={selected != null && selected !== l.layer.id ? 0.18 : 1} />
            ))}
            {showThin &&
              vis
                .filter((l) => l.layer.thinD && (selected == null || selected === l.layer.id))
                .map((l) => <path key={'t' + l.layer.id} className="thin" d={l.layer.thinD} fillRule="evenodd" />)}
          </>
        )}
      </g>
    </ArtSvg>
  );
}

function Grid({ layers, widthMm, heightMm, marks, selected, showThin, scale, cols, gridGap, contentW, contentH }: Props & { scale: number; cols: number; gridGap: number; contentW: number; contentH: number }) {
  const { w, h, offset } = canvasSize(widthMm, heightMm, marks);
  const vis = layers.filter((l) => l.visible);
  const fs = Math.max(3, w * 0.045);
  return (
    <ArtSvg w={contentW} h={contentH} scale={scale} className="art">
      {vis.map((l, i) => {
        const x = (i % cols) * (w + gridGap), y = Math.floor(i / cols) * (h + gridGap * 1.2);
        const sel = selected === l.layer.id;
        return (
          <g key={l.layer.id} transform={`translate(${x} ${y})`} data-layer={l.layer.id}>
            {/* 切割墊灰底，白色紙層也看得見 */}
            <rect width={w} height={h} fill="#d5dde1" stroke={sel ? 'var(--primary)' : '#b9c3c8'} strokeWidth={sel ? 1 : 0.3} />
            <Marks widthMm={widthMm} heightMm={heightMm} marks={marks} index={layers.indexOf(l) + 1} total={layers.length} />
            <g transform={`translate(${offset} ${offset})`}>
              <path d={l.layer.d} fill={l.color} fillRule="evenodd" />
              {showThin && l.layer.thinD && <path className="thin" d={l.layer.thinD} fillRule="evenodd" />}
            </g>
            <text x={0} y={h + fs * 1.3} fontSize={fs} fill="var(--text-2)">
              {layers.indexOf(l) + 1}. {l.name} · {l.color}
            </text>
          </g>
        );
      })}
    </ArtSvg>
  );
}

function Stack({ layers, widthMm, heightMm, marks, gapMm, scale, rot }: Props & { scale: number; rot: { x: number; z: number } }) {
  const { w, h, offset } = canvasSize(widthMm, heightMm, marks);
  const vis = layers.filter((l) => l.visible);
  return (
    <div className="stack3d" style={{ width: w * scale, height: h * scale }}>
      <div className="stack3d-inner" style={{ transform: `rotateX(${rot.x}deg) rotateZ(${rot.z}deg)` }}>
        {vis.map((l, i) => (
          <svg
            key={l.layer.id}
            className="stack3d-layer"
            width={w * scale}
            height={h * scale}
            viewBox={`0 0 ${w} ${h}`}
            style={{ transform: `translateZ(${i * gapMm * scale}px)`, filter: i === 0 ? undefined : `drop-shadow(${0.4 * scale}px ${0.8 * scale}px ${(0.6 + gapMm * 0.5) * scale}px rgba(0,0,0,.35))` }}
          >
            <path transform={`translate(${offset} ${offset})`} d={l.layer.d} fill={l.color} fillRule="evenodd" />
          </svg>
        ))}
      </div>
    </div>
  );
}
