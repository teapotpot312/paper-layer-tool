import { useEffect, type ReactElement, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';

export type Style = 'flat' | 'slight' | 'strong' | 'cutout';

/*
 * 四種作品樣式的示意圖（內嵌 SVG，離線可用）。
 * 上：斜角立體圖（看起來的樣子）；下：側面剖面（怎麼疊：紙 / 泡棉 / 鏤空）。
 * 同一個圖案：奶油色底、橘子、葉子、眼睛。
 */

const C = { base: '#FFF1C9', orange: '#F59331', leaf: '#3FA34D', eye: '#1B1B1B', foam: '#E6CFA2', foamSide: '#CDB07A', table: '#D9DFE3' };

// 設計座標 0..100 → 斜角畫面；z = 高度（px）
const iso = (z: number) => `matrix(0.78 0.3 -0.78 0.3 100 ${46 - z})`;

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

interface Part {
  d: string;
  /** 縮放中心（泡棉內縮用） */
  c: [number, number];
}

interface Piece {
  parts: Part[];
  color: string;
  /** 紙張底面高度 */
  at: number;
  /** 下面墊泡棉的厚度（泡棉在 at - foam … at） */
  foam: number;
}

const PART = {
  base: { d: 'M0 0H100V100H0Z', c: [50, 50] },
  orange: { d: circle(50, 58, 30), c: [50, 58] },
  leaf: { d: 'M50 26C56 12 72 8 80 14C74 26 60 30 50 26Z', c: [65, 19] },
  eyeL: { d: circle(41, 55, 4), c: [41, 55] },
  eyeR: { d: circle(59, 55, 4), c: [59, 55] },
} satisfies Record<string, Part>;

const PAPER = 1.6;

function pieces(style: Style): Piece[] {
  if (style === 'cutout') {
    // 每層只有自己的顏色：底層在橘子處挖空、橘子在眼睛處挖空 → 洞裡看得到桌面
    const baseHoles = PART.base.d + circle(50, 58, 28) + circle(12, 12, 5) + circle(88, 12, 5) + circle(12, 88, 5) + circle(88, 88, 5);
    return [
      { parts: [{ d: baseHoles, c: [50, 50] }], color: C.base, at: 0, foam: 0 },
      { parts: [{ d: PART.orange.d + PART.eyeL.d + PART.eyeR.d, c: [50, 58] }], color: C.orange, at: PAPER * 0.6, foam: 0 },
      { parts: [PART.leaf], color: C.leaf, at: PAPER * 1.2, foam: 0 },
    ];
  }
  // 累加：每層 = 自己 ∪ 上方所有層（上層底下一定有紙撐著）
  const f = style === 'flat' ? [0, 0, 0] : style === 'slight' ? [10, 0, 10] : [10, 10, 10];
  const stack: [Part[], string][] = [
    [[PART.base], C.base],
    [[PART.orange, PART.leaf, PART.eyeL, PART.eyeR], C.orange],
    [[PART.leaf, PART.eyeL, PART.eyeR], C.leaf],
    [[PART.eyeL, PART.eyeR], C.eye],
  ];
  let z = 0;
  return stack.map(([parts, color], i) => {
    const foam = i === 0 ? 0 : f[i - 1];
    if (i > 0) z += PAPER + foam;
    return { parts, color, at: z, foam };
  });
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function IsoView({ style }: { style: Style }) {
  const els: ReactElement[] = [];
  const draw = (key: string, parts: Part[], fill: string, tf: string, extra: Record<string, unknown> = {}, inset = false) =>
    parts.forEach((p, j) =>
      els.push(
        <path
          key={`${key}-${j}`}
          d={p.d}
          fill={fill}
          fillRule="evenodd"
          transform={inset ? `${tf} translate(${p.c[0]} ${p.c[1]}) scale(0.8) translate(${-p.c[0]} ${-p.c[1]})` : tf}
          {...extra}
        />,
      ),
    );
  pieces(style).forEach((p, i) => {
    if (p.foam) {
      const bottom = p.at - p.foam;
      // 陰影落在下方表面；泡棉以多層堆出側面
      draw(`s${i}`, p.parts, '#000', `${iso(bottom)} translate(3 3)`, { opacity: 0.14 });
      for (let z = bottom; z < p.at; z += 1) draw(`f${i}-${z}`, p.parts, C.foamSide, iso(z), {}, true);
    }
    // 紙張厚度（側面較暗）
    for (let z = p.at; z < p.at + PAPER; z += 0.5) draw(`p${i}-${z}`, p.parts, shade(p.color, 0.72), iso(z));
    draw(`t${i}`, p.parts, p.color, iso(p.at + PAPER));
  });
  return (
    <svg viewBox="0 4 200 116" className="sg-iso" aria-hidden>
      {/* 桌面 */}
      <path d="M100 38 198 77 100 116 2 77Z" fill={C.table} opacity={0.6} />
      {els}
    </svg>
  );
}

/** 側面剖面示意：寬度代表每層的範圍 */
function Section({ style }: { style: Style }) {
  const X = (v: number) => 10 + v * 1.8;
  const T = 4, F = 9, G = 58;
  const rects: ReactNode[] = [];
  const bar = (key: string, a: number, b: number, y: number, h: number, fill: string, stroke = 'rgba(0,0,0,.25)') =>
    rects.push(<rect key={key} x={X(a)} y={y} width={X(b) - X(a)} height={h} fill={fill} stroke={stroke} strokeWidth={0.6} rx={0.8} />);
  if (style === 'cutout') {
    // 各層在同一高度並排，只在邊緣稍微重疊；底層的洞看得到桌面
    bar('b1', 0, 4, G - T, T, C.base); bar('b2', 9, 16, G - T, T, C.base); bar('b3', 84, 91, G - T, T, C.base); bar('b4', 96, 100, G - T, T, C.base);
    bar('o1', 15, 31, G - T * 1.6, T, C.orange); bar('o2', 69, 85, G - T * 1.6, T, C.orange);
    bar('l1', 30, 41, G - T * 2.2, T, C.leaf); bar('l2', 59, 70, G - T * 2.2, T, C.leaf);
    bar('e', 40, 60, G - T * 2.8, T, C.eye);
  } else {
    const f = style === 'flat' ? [0, 0, 0] : style === 'slight' ? [F, 0, F] : [F, F, F];
    const layers: [number, number, string][] = [[0, 100, C.base], [15, 85, C.orange], [25, 75, C.leaf], [40, 60, C.eye]];
    let y = G;
    layers.forEach(([a, b, col], i) => {
      const foam = i === 0 ? 0 : f[i - 1];
      if (foam) {
        y -= foam;
        bar(`f${i}`, a + 4, b - 4, y, foam, C.foam, C.foamSide);
      }
      y -= T;
      bar(`p${i}`, a, b, y, T, col);
    });
  }
  return (
    <svg viewBox="0 0 200 64" className="sg-sec" aria-hidden>
      <line x1={4} x2={196} y1={G + 0.5} y2={G + 0.5} stroke={C.table} strokeWidth={2} />
      {rects}
    </svg>
  );
}

export function StyleGuide({ current, onPick, onClose }: { current: Style; onPick: (s: Style) => void; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const styles: Style[] = ['flat', 'slight', 'strong', 'cutout'];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal sg" role="dialog" aria-modal="true" aria-label={t('sgTitle')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('sgTitle')}</h2>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose}><Icon name="x" /></button>
        </header>
        <p className="ctrl-help">{t('sgIntro')}</p>
        <div className="sg-legend">
          <span><i style={{ background: C.orange }} />{t('sgPaper')}</span>
          <span><i style={{ background: C.foam, borderColor: C.foamSide }} />{t('sgFoam')}</span>
          <span><i style={{ background: C.table }} />{t('sgTable')}</span>
        </div>
        <div className="sg-grid">
          {styles.map((s) => (
            <button key={s} type="button" className={'sg-card' + (current === s ? ' on' : '')} aria-pressed={current === s} onClick={() => { onPick(s); onClose(); }}>
              <IsoView style={s} />
              <Section style={s} />
              <strong>{t(`style_${s}`)}{current === s && <em className="tag">{t('sgCurrent')}</em>}</strong>
              <small>{t(`sg_${s}`)}</small>
              <small className="sg-good">{t(`sgGood_${s}`)}</small>
            </button>
          ))}
        </div>
        <p className="note">{t('styleOverride')}</p>
      </div>
    </div>
  );
}
