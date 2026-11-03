import { describe, expect, it } from 'vitest';
import { deltaE, rgbToLab } from '../src/lib/color';
import { defaultMarks, layerSvg, markPaths } from '../src/lib/svg';
import { defaultParams, type RGBAImage } from '../src/lib/types';
import { absorbSmall, components, dilate, fillHoles, thinRegions } from '../src/worker/mask';
import { Pipeline, resolveOrder } from '../src/worker/pipeline';
import { assignLabels, buildPalette } from '../src/worker/quantize';
import { ringArea, ringsToPath, simplify, traceMask } from '../src/worker/trace';

function makeImage(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number?]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}

/** 橘子測試圖：黃底、橘色漸層圓、小黑眼睛 */
const orange = () =>
  makeImage(300, 300, (x, y) => {
    const d = Math.hypot(x - 150, y - 160);
    if (Math.hypot(x - 120, y - 140) < 7 || Math.hypot(x - 180, y - 140) < 7) return [20, 20, 20];
    if (d < 100) {
      const t = (y - 60) / 200; // 漸層
      return [240 - t * 20, 140 - t * 40, 30];
    }
    return [255, 244, 200];
  });

describe('color', () => {
  it('Lab 轉換與 ΔE', () => {
    const white = rgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 0);
    expect(deltaE(rgbToLab(0, 0, 0), white)).toBeGreaterThan(99);
  });
});

describe('quantize', () => {
  it('漸層合併為單一色層，且保留小面積黑眼睛', () => {
    const img = orange();
    const { palette } = buildPalette(img, null, 12);
    expect(palette.length).toBe(3);
    const labels = assignLabels(img.data, img.width, img.height, palette);
    const eye = labels[140 * 300 + 120];
    const body = labels[100 * 300 + 150];
    const body2 = labels[240 * 300 + 150];
    expect(body).toBe(body2);
    expect(eye).not.toBe(body);
    expect(palette[eye].lab[0]).toBeLessThan(20);
  });

  it('固定種子 → 結果可重現', () => {
    const img = orange();
    const a = buildPalette(img, 5, 0).palette.map((p) => p.rgb.join());
    const b = buildPalette(img, 5, 0).palette.map((p) => p.rgb.join());
    expect(a).toEqual(b);
  });
});

describe('connected components & cleanup', () => {
  it('計算 4 連通區域', () => {
    const w = 5, h = 3;
    const m = Uint8Array.from([1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1]);
    const { areas } = components(m, w, h);
    expect(areas.sort()).toEqual([1, 1, 2, 4]);
  });

  it('小碎片併入鄰近色而非留白', () => {
    const w = 10, h = 10;
    const labels = new Int16Array(w * h).fill(0);
    labels[55] = 1;
    const out = absorbSmall(labels, w, h, 4, 2);
    expect(out[55]).toBe(0);
  });

  it('填補小孔洞但保留大孔', () => {
    const w = 20, h = 20;
    const m = new Uint8Array(w * h).fill(1);
    m[5 * w + 5] = 0; // 小孔
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) m[y * w + x] = 0; // 大孔 36px
    const out = fillHoles(m, w, h, 5);
    expect(out[5 * w + 5]).toBe(1);
    expect(out[12 * w + 12]).toBe(0);
  });

  it('偏移（外擴）為圓形', () => {
    const w = 21, h = 21;
    const m = new Uint8Array(w * h);
    m[10 * w + 10] = 1;
    const d = dilate(m, w, h, 3);
    expect(d[10 * w + 13]).toBe(1);
    expect(d[10 * w + 14]).toBe(0);
    expect(d[13 * w + 13]).toBe(0); // 斜角 √18 > 3
  });

  it('偵測過細區域', () => {
    const w = 60, h = 40;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 25; x++) m[y * w + x] = 1; // 粗塊
    for (let y = 18; y < 20; y++) for (let x = 25; x < 55; x++) m[y * w + x] = 1; // 2px 細線
    const thin = thinRegions(m, w, h, 3);
    expect(thin[19 * w + 40]).toBe(1);
    expect(thin[20 * w + 15]).toBe(0);
  });
});

describe('trace', () => {
  it('方塊的輪廓面積正確，孔洞方向相反', () => {
    const w = 40, h = 40;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) m[y * w + x] = 1;
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) m[y * w + x] = 0;
    const rings = traceMask(m, w, h, 0.01);
    expect(rings.length).toBe(2);
    const areas = rings.map(ringArea).sort((a, b) => Math.abs(b) - Math.abs(a));
    expect(Math.abs(areas[0])).toBeCloseTo(900, -1);
    expect(Math.abs(areas[1])).toBeCloseTo(100, -1);
    expect(Math.sign(areas[0])).not.toBe(Math.sign(areas[1]));
  });

  it('碰到邊界的形狀沿邊界切齊', () => {
    const w = 10, h = 10;
    const m = new Uint8Array(w * h).fill(1);
    const rings = traceMask(m, w, h, 0.01);
    expect(rings.length).toBe(1);
    expect(Math.abs(ringArea(rings[0]))).toBeCloseTo(100, 0);
  });

  it('簡化後點數變少且 path 封閉', () => {
    const w = 100, h = 100;
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 50, y - 50) < 40) m[y * w + x] = 1;
    const rings = traceMask(m, w, h, 1);
    const s = simplify(rings[0], 0.5);
    expect(s.length).toBeLessThan(rings[0].length);
    const [d, nodes] = ringsToPath([s], 0.1);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(nodes).toBe(s.length);
  });
});

describe('pipeline', () => {
  it('累加模式：下層包含上層區域', () => {
    const pipe = new Pipeline();
    pipe.setImage(orange());
    const res = pipe.run({ ...defaultParams, widthMm: 100 }, 'final');
    expect(res.layers.length).toBe(3);
    const bottom = res.layers.find((l) => l.id === res.order[0])!;
    const top = res.layers.find((l) => l.id === res.order[res.order.length - 1])!;
    expect(bottom.isBg).toBe(true);
    expect(bottom.areaMm2).toBeGreaterThan(top.areaMm2);
    expect(bottom.areaMm2).toBeCloseTo(100 * 100, -2);
  });

  it('獨立色塊 + 移除背景', () => {
    const pipe = new Pipeline();
    pipe.setImage(orange());
    const res = pipe.run({ ...defaultParams, mode: 'independent', bg: 'remove' }, 'draft');
    expect(res.layers.length).toBe(2);
    expect(res.layers.every((l) => !l.isBg)).toBe(true);
  });

  it('使用者順序保留、新層插入', () => {
    expect(resolveOrder([0, 1, 2], [2, 0, 1], [0, 1, 2])).toEqual([2, 0, 1]);
    expect(resolveOrder([0, 1, 2, 3], [2, 0, 1], [0, 1, 2, 3])).toEqual([2, 0, 1, 3]);
    expect(resolveOrder([0, 2], [2, 0, 1], [0, 2])).toEqual([2, 0]);
  });
});

describe('svg', () => {
  it('單位、viewBox 一致、evenodd、無禁用元素', () => {
    const pipe = new Pipeline();
    pipe.setImage(orange());
    const res = pipe.run({ ...defaultParams, widthMm: 150 }, 'draft');
    const svg = layerSvg(res.layers[0], res.widthMm, res.heightMm, { ...defaultMarks, enabled: true, numbers: true }, 1, 3);
    expect(svg).toMatch(/width="170mm"/);
    expect(svg).toMatch(/viewBox="0 0 170 /);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toMatch(/<(filter|mask|clipPath|image|text)\b/);
  });
});

describe('對位記號', () => {
  it('L 型角：四個角各一個 6 點封閉 L，全部在作品外的邊距內', () => {
    const W = 150, H = 100, marks = { ...defaultMarks, enabled: true, numbers: true };
    const { marks: d, label } = markPaths(W, H, marks, 1, 6);
    const subs = d.split('M').filter(Boolean);
    expect(subs.length).toBe(4);
    const off = marks.margin;
    for (const sp of subs) {
      const pts = sp.replace('Z', '').split('L').map((p) => p.trim().split(' ').map(Number));
      expect(pts.length).toBe(6);
      // L 的每個點都不在作品矩形內部
      const inside = pts.every(([x, y]) => x > off && x < off + W && y > off && y < off + H);
      expect(inside).toBe(false);
      // 至少有一臂貼著作品外側（點都在畫布範圍內）
      expect(pts.every(([x, y]) => x >= 0 && y >= 0 && x <= W + 2 * off && y <= H + 2 * off)).toBe(true);
    }
    // 編號在左上 L 的橫臂之後
    const firstLabelX = Number(label.slice(1).split(' ')[0]);
    expect(firstLabelX).toBeGreaterThan(off / 2 + marks.size);
  });
});
