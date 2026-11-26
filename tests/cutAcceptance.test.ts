import { describe, expect, it } from 'vitest';
import { rng } from '../src/lib/color';
import { checkCutSvg, cutSvg } from '../src/lib/cutExport';
import { defaultCut, type CutParams, type RGBAImage } from '../src/lib/types';
import { runCut } from '../src/worker/cutPipeline';

/** 白底（或透明底）黑圖。fn 回傳 true 的地方是紙 */
function make(size: number, fn: (x: number, y: number) => boolean, opts: { alpha?: boolean; noise?: number } = {}): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const rand = rng(11);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, on = fn(x, y);
      const n = opts.noise ? (rand() - 0.5) * opts.noise : 0;
      const v = Math.max(0, Math.min(255, (on ? 25 : 245) + n));
      data[i] = data[i + 1] = data[i + 2] = opts.alpha && !on ? 255 : v;
      data[i + 3] = opts.alpha && !on ? 0 : 255;
    }
  return { data, width: size, height: size };
}
const D = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy);
const P: CutParams = { ...defaultCut, widthMm: 100, minAreaMm2: 1, smooth: 3 };
const run = (img: RGBAImage, p: Partial<CutParams> = {}) => runCut(img, { ...P, ...p }, 'final', img.width);

/** 簡單的多邊形內外判斷 */
const inPoly = (poly: [number, number][]) => (x: number, y: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

describe('單色切割驗收', () => {
  it('簡單剪影（五角星）：單一封閉輪廓，面積與原圖一致', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2, r = i % 2 ? 40 : 90;
      pts.push([100 + r * Math.cos(a), 100 + r * Math.sin(a)]);
    }
    const inside = inPoly(pts);
    const img = make(200, inside);
    let px = 0;
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) if (inside(x + 0.5, y + 0.5)) px++;
    const r = run(img, { method: 'outline' });
    expect(r.d.split('M').length - 1).toBe(1);
    expect(r.holes).toBe(0);
    expect(r.check.ok).toBe(true);
    const want = px * (100 / 200) ** 2;
    expect(Math.abs(r.areaMm2 - want) / want).toBeLessThan(0.03);
  });

  it('字母 O／B 的內孔：保留為孔洞，不誤建連接橋', () => {
    const O = run(make(200, (x, y) => D(x, y, 100, 100) < 80 && D(x, y, 100, 100) > 40));
    expect([O.pieces, O.holes, O.islands, O.bridges.length]).toEqual([1, 1, 0, 0]);
    const B = run(make(200, (x, y) => x > 50 && x < 150 && y > 20 && y < 180 && !(D(x, y, 100, 65) < 22) && !(D(x, y, 100, 135) < 22)));
    expect([B.pieces, B.holes, B.islands, B.bridges.length]).toEqual([1, 2, 0, 0]);
  });

  it('卡通臉：眼珠與鬍鬚等內部零件自動連回主體，臉部孔洞仍在', () => {
    const face = (x: number, y: number) => {
      if (D(x, y, 100, 100) > 90) return false;
      const eyeL = D(x, y, 68, 80), eyeR = D(x, y, 132, 80);
      if (eyeL < 20) return eyeL < 8; // 眼白挖空，中間的眼珠是獨立紙片
      if (eyeR < 20) return eyeR < 8;
      if (D(x, y, 100, 140) < 25 && y > 140) return false; // 嘴巴
      return true;
    };
    const r = run(make(200, face), { bridgeMm: 1.5 });
    expect(r.islands).toBe(2);
    expect(r.bridges).toHaveLength(2);
    expect(r.unresolved).toBe(0);
    expect(r.pieces).toBe(1);
    expect(r.holes).toBeGreaterThanOrEqual(3);
    expect(r.check.ok).toBe(true);
  });

  it('關閉自動橋接時，內部零件被明確標成風險而不是靜默通過', () => {
    const eyes = make(200, (x, y) => (D(x, y, 100, 100) < 85 && D(x, y, 100, 100) > 40) || D(x, y, 100, 100) < 15);
    const r = run(eyes, { autoBridge: false });
    expect(r.unresolved).toBe(1);
    expect(r.risks).toContain('islandsOpen');
  });

  it('超小孔洞被填起來；夠大的孔洞保留', () => {
    const img = make(200, (x, y) => D(x, y, 100, 100) < 90 && !(D(x, y, 70, 100) < 2) && !(D(x, y, 130, 100) < 25));
    const r = run(img, { fillMm2: 5 }); // 1 像素 = 0.5 mm → 小洞約 3 mm²
    expect(r.holes).toBe(1);
    expect(run(img, { fillMm2: 0 }).holes).toBe(2);
  });

  it('過細的連接處會被標記', () => {
    const dumbbell = make(200, (x, y) => D(x, y, 45, 100) < 35 || D(x, y, 155, 100) < 35 || (x > 70 && x < 130 && Math.abs(y - 100) < 1.5));
    const r = run(dumbbell, { minWidthMm: 2.5, minAreaMm2: 0 });
    expect(r.pieces).toBe(1);
    expect(r.thinCount).toBeGreaterThan(0);
    expect(r.thinD).not.toBe('');
    expect(run(dumbbell, { minWidthMm: 0.5, minAreaMm2: 0 }).thinCount).toBe(0);
  });

  it('PNG（透明底）與 JPG（雜訊、反鋸齒）都得到乾淨的單一圖形', () => {
    const shape = (x: number, y: number) => D(x, y, 100, 100) < 70 && D(x, y, 100, 100) > 30;
    const png = run(make(200, shape, { alpha: true }));
    const jpg = run(make(200, shape, { noise: 60 }), { blur: 1 });
    for (const r of [png, jpg]) {
      expect(r.pieces).toBe(1);
      expect(r.holes).toBe(1);
      expect(r.check.ok).toBe(true);
    }
    expect(Math.abs(png.areaMm2 - jpg.areaMm2) / png.areaMm2).toBeLessThan(0.05);
  });

  it('相同輸入得到相同輸出，改尺寸只縮放不改拓撲', () => {
    const img = make(200, (x, y) => D(x, y, 100, 100) < 80 && D(x, y, 100, 100) > 30);
    expect(run(img).d).toBe(run(img).d);
    const small = run(img, { widthMm: 50 }), big = run(img, { widthMm: 200 });
    expect([small.pieces, small.holes]).toEqual([big.pieces, big.holes]);
    expect(big.areaMm2 / small.areaMm2).toBeCloseTo(16, 0);
  });

  it('匯出的 SVG：尺寸、viewBox、路徑都正確，且不含會造成切割歧義的元素', () => {
    const r = run(make(200, (x, y) => D(x, y, 100, 100) < 80 && D(x, y, 100, 100) > 30));
    const svg = cutSvg(r);
    expect(svg).toContain('width="100mm" height="100mm" viewBox="0 0 100 100"');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toMatch(/<(image|mask|filter|text|clipPath|use)\b/);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(checkCutSvg(svg).ok).toBe(true);
    expect(checkCutSvg(svg).subpaths).toBe(2);
  });

  it('大圖（1200px）在可接受的時間內完成', () => {
    const t0 = Date.now();
    const r = run(make(1200, (x, y) => D(x, y, 600, 600) < 500 && D(x, y, 600, 600) > 200 && !(D(x, y, 600, 600) > 330 && D(x, y, 600, 600) < 380 && x > 600)));
    expect(r.check.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 20000);
});
