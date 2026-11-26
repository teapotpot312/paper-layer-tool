import { describe, expect, it } from 'vitest';
import { checkCutPath } from '../src/lib/cutValidation';
import { checkCutSvg, cutSvg } from '../src/lib/cutExport';
import { defaultCut, type RGBAImage } from '../src/lib/types';
import { countHoles, monoMask, removeSpecks } from '../src/worker/cutPipeline';
import { runCut } from '../src/worker/cutPipeline';

/** 白底黑圖：shapes 逐一畫在 200×200 的畫布上 */
function draw(fn: (x: number, y: number) => boolean, alphaBg = false): RGBAImage {
  const w = 200, h = 200, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, on = fn(x, y);
      const v = on ? 20 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = alphaBg && !on ? 0 : 255;
    }
  return { data, width: w, height: h };
}
const dist = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy);
const donut = (x: number, y: number) => dist(x, y, 100, 100) < 70 && dist(x, y, 100, 100) > 30;
const params = { ...defaultCut, widthMm: 100, minAreaMm2: 1, smooth: 2 };

describe('single-color cut pipeline', () => {
  it('keeps the hole of a ring in stencil mode', () => {
    const r = runCut(draw(donut), { ...params, method: 'stencil' }, 'final', 200);
    expect(r.pieces).toBe(1);
    expect(r.holes).toBe(1);
    expect(r.d.split('M').length - 1).toBe(2); // 外圈 + 內圈
    expect(r.check.ok).toBe(true);
  });

  it('fills the hole in outline mode', () => {
    const r = runCut(draw(donut), { ...params, method: 'outline' }, 'final', 200);
    expect(r.holes).toBe(0);
    expect(r.d.split('M').length - 1).toBe(1);
    expect(r.check.ok).toBe(true);
  });

  it('removes specks smaller than the minimum piece area', () => {
    const img = draw((x, y) => dist(x, y, 100, 100) < 50 || (x > 10 && x < 13 && y > 10 && y < 13));
    const small = runCut(img, { ...params, minAreaMm2: 5 }, 'final', 200);
    const keep = runCut(img, { ...params, minAreaMm2: 0 }, 'final', 200);
    expect(small.pieces).toBe(1);
    expect(keep.pieces).toBe(2);
  });

  it('uses transparency when the image has a transparent background', () => {
    // 淺色圖案在透明背景上：只看亮度會全部判成背景
    const w = 100, h = 100, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i - x) / w, on = dist(x, y, 50, 50) < 30;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 250;
      data[i * 4 + 3] = on ? 255 : 0;
    }
    const m = monoMask({ data, width: w, height: h }, 128);
    expect(m.reduce((s, v) => s + v, 0)).toBeGreaterThan(2500);
  });

  it('flags paper thinner than the minimum cuttable width', () => {
    const bar = draw((x, y) => (x > 20 && x < 180 && y > 98 && y < 102) || dist(x, y, 100, 40) < 15);
    const r = runCut(bar, { ...params, minWidthMm: 3, minAreaMm2: 0 }, 'final', 200);
    expect(r.thinCount).toBeGreaterThan(0);
  });

  it('counts holes and removes specks on raw masks', () => {
    const w = 10, h = 10, m = new Uint8Array(w * h).fill(1);
    m[5 * w + 5] = 0;
    expect(countHoles(m, w, h)).toBe(1);
    const s = new Uint8Array(w * h);
    s[0] = 1;
    expect(removeSpecks(s, w, h, 4)[0]).toBe(0);
  });
});

describe('cut path validation and export', () => {
  it('accepts a closed in-bounds path and writes a real-size SVG', () => {
    const d = 'M10 10L50 10L50 40L10 40Z';
    expect(checkCutPath(d, 100, 80).ok).toBe(true);
    const svg = cutSvg({ d, widthMm: 100, heightMm: 80 });
    expect(svg).toContain('width="100mm" height="80mm" viewBox="0 0 100 80"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toMatch(/<(image|mask|filter|text)/);
    expect(checkCutSvg(svg).ok).toBe(true);
  });

  it('detects open, duplicated, out-of-range and invalid subpaths', () => {
    expect(checkCutPath('M10 10L50 10L50 40', 100, 80).open).toBe(1);
    expect(checkCutPath('M10 10L50 10L50 40ZM10 10L50 10L50 40Z', 100, 80).duplicates).toBe(1);
    expect(checkCutPath('M10 10L500 10L50 40Z', 100, 80).outOfBounds).toBe(1);
    expect(checkCutPath('M10 10L50Z', 100, 80).invalid).toBe(true);
    expect(checkCutPath('', 100, 80).ok).toBe(false);
  });

  it('re-checks the final SVG text, not the intermediate result', () => {
    const bad = cutSvg({ d: 'M10 10L50 10L50 40', widthMm: 100, heightMm: 80 });
    expect(checkCutSvg(bad).ok).toBe(false);
  });
});
