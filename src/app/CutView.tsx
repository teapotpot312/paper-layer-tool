import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { CutResult, RegionQuery, RegionSelection } from '../lib/types';

export type CutViewMode = 'result' | 'lines';

interface Props {
  result: CutResult;
  view: CutViewMode;
  zoom: number;
  sel: RegionSelection | null;
  /** 點選或框選：座標以作品寬度正規化；additive = 按住 Shift / Ctrl 加選 */
  onSelect: (q: RegionQuery) => void;
}

/** 拖曳超過這個距離（螢幕像素）才算框選，否則視為點選 */
const DRAG_PX = 5;

/** 單色預覽：成品 = 保留的紙（深色）與挖空；切割線 = 預計匯出的輪廓，過細處標紅、連接橋標橘。可點選或拖曳框選區域 */
export function CutView({ result, view, zoom, sel, onSelect }: Props) {
  const { widthMm: w, heightMm: h, d, thinD } = result;
  const ar = w / h;
  const stroke = Math.max(0.2, w / 700);
  const ref = useRef<SVGSVGElement>(null);
  const start = useRef<{ fx: number; fy: number; cx: number; cy: number; touch: boolean } | null>(null);
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const [box, setBox] = useState<Box | null>(null);
  // 同時存在 ref：指標事件連續觸發時 state 還沒更新，放開時要讀到最新的框
  const boxRef = useRef<Box | null>(null);
  const setDrag = (b: Box | null) => { boxRef.current = b; setBox(b); };

  const frac = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as const;
  };
  // x、y 都除以作品寬度：和解析度無關，改尺寸或平滑度後仍對得回同一區域
  const toV = (fy: number) => (fy * h) / w;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const [fx, fy] = frac(e);
    const touch = e.pointerType === 'touch';
    start.current = { fx, fy, cx: e.clientX, cy: e.clientY, touch };
    // 觸控時保留原本的捲動，只支援點選；滑鼠與觸控筆才能拖曳框選
    if (!touch) try { ref.current!.setPointerCapture(e.pointerId); } catch { /* 沒有可擷取的指標（例如自動化測試）時略過 */ }
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s || s.touch) return;
    if (Math.hypot(e.clientX - s.cx, e.clientY - s.cy) < DRAG_PX && !boxRef.current) return;
    const [fx, fy] = frac(e);
    setDrag({ x0: s.fx, y0: s.fy, x1: fx, y1: fy });
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const [fx, fy] = frac(e);
    if (boxRef.current && !s.touch) onSelect({ rect: { u0: s.fx, v0: toV(s.fy), u1: fx, v1: toV(fy) }, additive });
    else onSelect({ points: [{ u: fx, v: toV(fy) }], additive });
    setDrag(null);
  };

  return (
    <div className="cut-stage">
      <svg
        ref={ref}
        className="cut-canvas pick"
        viewBox={`0 0 ${w} ${h}`}
        style={{ '--ar': ar, '--zoom': zoom, aspectRatio: String(ar) } as CSSProperties}
        role="img"
        aria-label={view === 'result' ? 'result' : 'cut lines'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { start.current = null; setDrag(null); }}
      >
        <rect width={w} height={h} fill={view === 'result' ? '#f4f4f4' : 'var(--surface)'} />
        {view === 'result' ? (
          <path d={d} fill="#2b2b2b" fillRule="evenodd" />
        ) : (
          <>
            <path d={d} fill="var(--surface-2)" fillRule="evenodd" stroke="#e3141e" strokeWidth={stroke} strokeLinejoin="round" />
            {thinD && <path d={thinD} className="thin" fillRule="evenodd" />}
          </>
        )}
        {result.islandD && <path d={result.islandD} fill="#f59e0b" fillOpacity={0.45} stroke="#f59e0b" strokeWidth={stroke} pointerEvents="none" />}
        {view === 'lines' &&
          result.bridges.map((b, i) => (
            <line key={i} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke="#f59e0b" strokeWidth={Math.max(b.widthMm, stroke)} strokeLinecap="round" strokeOpacity={0.85} pointerEvents="none" />
          ))}
        {sel?.d && <path d={sel.d} className="region-sel" fillRule="evenodd" strokeWidth={stroke * 1.6} pointerEvents="none" />}
        {box && (
          <rect
            className="marquee"
            x={Math.min(box.x0, box.x1) * w}
            y={Math.min(box.y0, box.y1) * h}
            width={Math.abs(box.x1 - box.x0) * w}
            height={Math.abs(box.y1 - box.y0) * h}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}
