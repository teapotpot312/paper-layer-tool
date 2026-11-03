import type { LayerResult } from './types';

export type MarkStyle = 'corner' | 'circle' | 'cross';

export interface MarkOptions {
  enabled: boolean;
  style: MarkStyle;
  /** 作品外圍邊距 mm */
  margin: number;
  /** 記號大小 mm（L 型為臂長，圓孔為直徑，十字為全長） */
  size: number;
  numbers: boolean;
}

export const defaultMarks: MarkOptions = { enabled: false, style: 'corner', margin: 10, size: 10, numbers: false };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 畫布大小（所有層共用同一畫布與原點，疊起來自然對齊） */
export function canvasSize(widthMm: number, heightMm: number, marks: MarkOptions) {
  const m = marks.enabled || marks.numbers ? marks.margin : 0;
  return { w: r2(widthMm + 2 * m), h: r2(heightMm + 2 * m), offset: m };
}

function circle(cx: number, cy: number, r: number): string {
  return `M${r2(cx - r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx + r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx - r)} ${r2(cy)}Z`;
}

function cross(cx: number, cy: number, s: number): string {
  const a = s / 2, t = Math.max(0.8, s / 6) / 2;
  // 十字外框（單一封閉多邊形，避免重疊子路徑在 evenodd 下互相抵消）
  const p = [
    [-t, -a], [t, -a], [t, -t], [a, -t], [a, t], [t, t], [t, a], [-t, a], [-t, t], [-a, t], [-a, -t], [-t, -t],
  ];
  return 'M' + p.map(([x, y]) => `${r2(cx + x)} ${r2(cy + y)}`).join('L') + 'Z';
}

/**
 * L 型角落記號（比照 Cricut）：轉角朝外、兩臂沿作品邊緣延伸，四個角一起框出作品範圍。
 * (x, y) 為 L 的外側轉角，sx / sy 為兩臂延伸方向（±1）。單一封閉多邊形。
 */
function corner(x: number, y: number, sx: number, sy: number, len: number, t: number): string {
  const p = [[0, 0], [len, 0], [len, t], [t, t], [t, len], [0, len]];
  return 'M' + p.map(([a, b]) => `${r2(x + a * sx)} ${r2(y + b * sy)}`).join('L') + 'Z';
}

/** L 型記號的線寬（mm）：太細切不動、太粗佔版面 */
const cornerWidth = (len: number) => Math.min(2.5, Math.max(1.5, len * 0.15));

// 七段顯示器字形，讓編號不需字型即可切割
const SEGS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};
function digits(text: string, x: number, y: number, hgt: number): string {
  const w = hgt * 0.55, t = Math.max(0.6, hgt * 0.14), out: string[] = [];
  const rect = (x0: number, y0: number, ww: number, hh: number) =>
    `M${r2(x0)} ${r2(y0)}H${r2(x0 + ww)}V${r2(y0 + hh)}H${r2(x0)}Z`;
  let cx = x;
  for (const ch of text) {
    if (ch === '/') {
      const p = [[cx + w * 0.6, y], [cx + w * 0.6 + t, y], [cx + t, y + hgt], [cx, y + hgt]];
      out.push('M' + p.map(([a, b]) => `${r2(a)} ${r2(b)}`).join('L') + 'Z');
      cx += w * 0.8;
      continue;
    }
    const s = SEGS[ch] ?? '';
    const hh = hgt / 2;
    if (s.includes('a')) out.push(rect(cx, y, w, t));
    if (s.includes('g')) out.push(rect(cx, y + hh - t / 2, w, t));
    if (s.includes('d')) out.push(rect(cx, y + hgt - t, w, t));
    if (s.includes('f')) out.push(rect(cx, y, t, hh));
    if (s.includes('b')) out.push(rect(cx + w - t, y, t, hh));
    if (s.includes('e')) out.push(rect(cx, y + hh, t, hh));
    if (s.includes('c')) out.push(rect(cx + w - t, y + hh, t, hh));
    cx += w + hgt * 0.3;
  }
  return out.join('');
}

/** 對位記號與編號的 path（畫布座標） */
export function markPaths(widthMm: number, heightMm: number, marks: MarkOptions, index: number, total: number): { marks: string; label: string } {
  const { w, h, offset } = canvasSize(widthMm, heightMm, marks);
  let m = '';
  const c = offset / 2;
  if (marks.enabled) {
    if (marks.style === 'corner') {
      // 轉角放在邊距中線，兩臂朝作品方向延伸，不超過作品邊長的一半
      const len = Math.min(marks.size, widthMm / 2, heightMm / 2);
      const t = Math.min(cornerWidth(len), c * 0.8);
      m = [corner(c, c, 1, 1, len, t), corner(w - c, c, -1, 1, len, t), corner(w - c, h - c, -1, -1, len, t), corner(c, h - c, 1, -1, len, t)].join('');
    } else {
      const s = Math.min(marks.size, offset * 0.8);
      const pts = [[c, c], [w - c, c], [w - c, h - c], [c, h - c]];
      m = pts.map(([x, y]) => (marks.style === 'circle' ? circle(x, y, s / 2) : cross(x, y, s))).join('');
    }
  }
  let label = '';
  if (marks.numbers) {
    const hgt = Math.min(5, offset * 0.5);
    // 編號放在左上 L 的橫臂之後，避免重疊
    const x0 = marks.enabled && marks.style === 'corner' ? c + Math.min(marks.size, widthMm / 2) + 2 : offset + 2;
    label = digits(`${index}/${total}`, x0, (offset - hgt) / 2, hgt);
  }
  return { marks: m, label };
}

const fileColor = (hex: string) => hex.toUpperCase();

/**
 * 單層 SVG（Cricut Design Space 相容）：mm 單位、width/height/viewBox 一致、
 * 純填色封閉路徑、孔洞以 evenodd 表示、無濾鏡/遮罩/點陣圖/文字。
 */
export function layerSvg(layer: LayerResult, widthMm: number, heightMm: number, marks: MarkOptions, index: number, total: number, color?: string): string {
  const { w, h, offset } = canvasSize(widthMm, heightMm, marks);
  const fill = fileColor(color ?? layer.hex);
  const mp = markPaths(widthMm, heightMm, marks, index, total);
  const extra = [mp.marks && `<path d="${mp.marks}" fill="${fill}"/>`, mp.label && `<path d="${mp.label}" fill="${fill}"/>`].filter(Boolean).join('\n    ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
  <g id="layer-${String(index).padStart(2, '0')}">
    <path d="${layer.d}" fill="${fill}" fill-rule="evenodd" transform="translate(${offset} ${offset})"/>
    ${extra}
  </g>
</svg>
`;
}

/** 多圖層合併 SVG：每層一個 <g>，以不同填色區分（Design Space 依顏色拆層） */
export function combinedSvg(layers: { layer: LayerResult; color: string }[], widthMm: number, heightMm: number, marks: MarkOptions): string {
  const { w, h, offset } = canvasSize(widthMm, heightMm, marks);
  const total = layers.length;
  const groups = layers
    .map(({ layer, color }, i) => {
      const mp = markPaths(widthMm, heightMm, marks, i + 1, total);
      const fill = fileColor(color);
      const ex = [mp.marks && `<path d="${mp.marks}" fill="${fill}"/>`, mp.label && `<path d="${mp.label}" fill="${fill}"/>`].filter(Boolean).join('');
      return `  <g id="layer-${String(i + 1).padStart(2, '0')}">
    <path d="${layer.d}" fill="${fill}" fill-rule="evenodd" transform="translate(${offset} ${offset})"/>${ex}
  </g>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
${groups}
</svg>
`;
}

/** 泡棉墊片 SVG */
export function foamSvg(layer: LayerResult, widthMm: number, heightMm: number, marks: MarkOptions): string {
  const { w, h, offset } = canvasSize(widthMm, heightMm, marks);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
  <path d="${layer.foamD}" fill="#CCCCCC" fill-rule="evenodd" transform="translate(${offset} ${offset})"/>
</svg>
`;
}
