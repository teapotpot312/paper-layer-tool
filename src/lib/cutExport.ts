import { checkCutPath } from './cutValidation';
import type { CutCheck, CutResult } from './types';

/**
 * 單色切割 SVG（Cricut Design Space 相容）：mm 單位、width/height/viewBox 一致、
 * 單一封閉的複合路徑（孔洞以 evenodd 表示）、無濾鏡/遮罩/點陣圖/文字。
 */
export function cutSvg(r: Pick<CutResult, 'd' | 'widthMm' | 'heightMm'>): string {
  const w = round(r.widthMm), h = round(r.heightMm);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
  <path id="cut-shape" d="${r.d}" fill="#000000" fill-rule="evenodd" stroke="none"/>
</svg>
`;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** 對輸出的 SVG 字串再做一次路徑檢查（取出其中的 path 與尺寸，不信任中間結果） */
export function checkCutSvg(svg: string): CutCheck {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const d = [...svg.matchAll(/<path[^>]* d="([^"]*)"/g)].map((m) => m[1]).join('');
  return checkCutPath(d, vb ? Number(vb[1]) : 0, vb ? Number(vb[2]) : 0);
}
