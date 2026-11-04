import { describe, expect, it } from 'vitest';
import { rng } from '../src/lib/color';
import { defaultParams, type RGBAImage } from '../src/lib/types';
import { Pipeline } from '../src/worker/pipeline';

function makeImage(w: number, h: number, fn: (x: number, y: number) => number[]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}

const run = (img: RGBAImage, p = defaultParams) => {
  const pipe = new Pipeline();
  pipe.setImage(img);
  return pipe.run(p, 'final');
};

describe('驗收', () => {
  it('純色 logo：2 層，面積與原圖幾乎一致', () => {
    // 透明背景上的藍色圓 + 中央白色方塊
    const img = makeImage(400, 400, (x, y) => {
      if (Math.hypot(x - 200, y - 200) > 150) return [0, 0, 0, 0];
      if (Math.abs(x - 200) < 50 && Math.abs(y - 200) < 50) return [255, 255, 255];
      return [20, 90, 200];
    });
    const res = run(img, { ...defaultParams, widthMm: 100 });
    expect(res.layers.length).toBe(2);
    const mm = 100 / 400;
    const circle = Math.PI * 150 * 150 * mm * mm;
    const square = 100 * 100 * mm * mm;
    const [bottom, top] = res.order.map((id) => res.layers.find((l) => l.id === id)!);
    // 亮→暗排序：白色在下（累加 = 整個圓），藍色圓環在上
    expect(Math.abs(bottom.areaMm2 - circle) / circle).toBeLessThan(0.02);
    expect(Math.abs(top.areaMm2 - (circle - square)) / (circle - square)).toBeLessThan(0.03);
    expect(res.warnings).not.toContain('photo');
  });

  it('照片（反例）：不當機並提示', () => {
    const rand = rng(7);
    const img = makeImage(600, 450, (x, y) => [
      (x * 0.4 + rand() * 60) | 0,
      (y * 0.5 + rand() * 60) | 0,
      ((x + y) * 0.2 + rand() * 60) | 0,
    ]);
    const res = run(img);
    expect(res.layers.length).toBeGreaterThan(0);
    expect(res.warnings).toContain('photo');
  }, 20000); // 雜訊圖運算量大，電腦忙碌時可能超過預設 5 秒

  it('背景可移除（淡黃圓點背景開關）', () => {
    const img = makeImage(300, 300, (x, y) => {
      if (Math.hypot(x - 150, y - 150) < 90) return [240, 130, 30];
      return [255, 244, 200];
    });
    const keep = run(img);
    const removed = run(img, { ...defaultParams, bg: 'remove' });
    expect(keep.layers.length).toBe(2);
    expect(removed.layers.length).toBe(1);
    const plate = run(img, { ...defaultParams, bg: 'plate', mode: 'independent' });
    const base = plate.layers.find((l) => l.isBg)!;
    expect(base.areaMm2).toBeCloseTo(150 * 150, -1);
  });

  it('過細區域可自動加粗或移除', () => {
    const img = makeImage(400, 200, (x, y) => {
      if (x > 20 && x < 120 && y > 20 && y < 180) return [0, 0, 0];
      if (x >= 120 && x < 380 && y >= 99 && y < 101) return [0, 0, 0]; // 2px ≈ 0.75mm
      return [255, 255, 255];
    });
    const p = { ...defaultParams, widthMm: 150, bg: 'remove' as const };
    const off = run(img, p);
    expect(off.layers[0].thinCount).toBeGreaterThan(0);
    const thick = run(img, { ...p, fix: 'thicken' });
    expect(thick.layers[0].thinCount).toBe(0);
    expect(thick.layers[0].areaMm2).toBeGreaterThan(off.layers[0].areaMm2);
    const removed = run(img, { ...p, fix: 'remove' });
    expect(removed.layers[0].areaMm2).toBeLessThan(off.layers[0].areaMm2);
  });
});

describe('獨立色塊延伸', () => {
  it('延伸只長到上層底下：上層形狀不變、下層變大', () => {
    const img = makeImage(300, 300, (x, y) => {
      if (Math.hypot(x - 150, y - 150) < 30) return [20, 20, 20];
      if (Math.hypot(x - 150, y - 150) < 100) return [240, 130, 30];
      return [255, 244, 200];
    });
    const base = { ...defaultParams, mode: 'independent' as const, widthMm: 100 };
    const a = run(img, { ...base, extendMm: 0 });
    const b = run(img, { ...base, extendMm: 1 });
    const top = (r: typeof a) => r.layers.find((l) => l.id === r.order[r.order.length - 1])!;
    const mid = (r: typeof a) => r.layers.find((l) => l.id === r.order[1])!;
    expect(top(b).areaMm2).toBeCloseTo(top(a).areaMm2, 1);
    expect(mid(b).areaMm2).toBeGreaterThan(mid(a).areaMm2);
  });
});

describe('插畫精緻度', () => {
  // 以 4 倍超取樣產生有反鋸齒邊緣的插畫：藍底、紅圓、2px 深色細線
  const aa = () =>
    makeImage(300, 300, (x, y) => {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
          const c = Math.abs(py - 60) < 1 && px > 30 && px < 270 ? [40, 25, 15] : Math.hypot(px - 150, py - 170) < 80 ? [240, 50, 45] : [135, 160, 250];
          r += c[0]; g += c[1]; b += c[2];
        }
      return [r / 16, g / 16, b / 16];
    });

  it('反鋸齒邊緣不會變成額外的雜色層，細線保留', () => {
    const res = run(aa(), { ...defaultParams, widthMm: 300 });
    expect(res.layers.map((l) => l.hex).sort()).toEqual(['#87A0FA', '#F0322D', '#28190F'].sort());
    const line = res.layers.find((l) => l.hex === '#28190F')!;
    // 細線約 240×2px = 2.4 cm²（300mm 寬時 1px = 1mm）
    expect(line.areaMm2).toBeGreaterThan(300);
  });

  it('低對比的銳利邊緣（ΔE≈9）不會被當成漸層合併', () => {
    const img = makeImage(300, 300, (x, y) => (Math.hypot(x - 150, y - 150) < 60 ? [79, 115, 86] : [85, 133, 95]));
    const res = run(img);
    expect(res.layers.length).toBe(2);
  });
});

describe('尖角與小圖', () => {
  it('細長三角形的尖端保持尖銳（不被磨圓）', async () => {
    const { traceMask, refineRing } = await import('../src/worker/trace');
    const w = 400, h = 400, m = new Uint8Array(w * h);
    // 頂點 (200, 40)、底邊 y=360 寬 120 的細長三角形（頂角約 21°）
    for (let y = 40; y < 360; y++) {
      const half = ((y - 40) / 320) * 60;
      for (let x = Math.ceil(200 - half); x <= Math.floor(200 + half); x++) m[y * w + x] = 1;
    }
    const [ring] = traceMask(m, w, h, 0.5);
    const c = refineRing(ring, 1.5, 0.4);
    const top = c.pts.reduce((a, p) => (p[1] < a[1] ? p : a));
    expect(top[1]).toBeLessThan(41.5);
    expect(c.corner[c.pts.indexOf(top)]).toBe(true);
  });

  it('放大 4 倍的小圖：交界的混色不會變成額外的色層', () => {
    const s = 300, big = 1200, k = big / s;
    const small = makeImage(s, s, (x, y) => {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const c = Math.hypot(x + (sx + 0.5) / 4 - 150, y + (sy + 0.5) / 4 - 150) < 90 ? [250, 185, 30] : [5, 30, 90];
          r += c[0]; g += c[1]; b += c[2];
        }
      return [r / 16, g / 16, b / 16];
    });
    // 模擬瀏覽器把小圖放大成工作影像（雙線性放大，交界變成很寬的漸層）
    const up = makeImage(big, big, (x, y) => {
      const fx = Math.min(s - 1, Math.max(0, (x + 0.5) / k - 0.5)), fy = Math.min(s - 1, Math.max(0, (y + 0.5) / k - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(s - 1, x0 + 1), y1 = Math.min(s - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const px = (xx: number, yy: number, c: number) => small.data[(yy * s + xx) * 4 + c];
      return [0, 1, 2].map((c) => px(x0, y0, c) * (1 - tx) * (1 - ty) + px(x1, y0, c) * tx * (1 - ty) + px(x0, y1, c) * (1 - tx) * ty + px(x1, y1, c) * tx * ty);
    });
    const pipe = new Pipeline();
    pipe.setImage(up, s);
    expect(pipe.run(defaultParams, 'final').layers.length).toBe(2);
  });
});

describe('邊緣平滑度', () => {
  it('越平滑凹凸越少（節點越少），但尖角仍保留', () => {
    const rand = rng(3);
    // 邊緣有隨機凹凸的圓 + 一根尖刺
    const img = makeImage(400, 400, (x, y) => {
      const a = Math.atan2(y - 200, x - 200), r = Math.hypot(x - 200, y - 200);
      const bump = 120 + 3 * Math.sin(a * 23) + (rand() - 0.5) * 2;
      const spike = Math.abs(x - 200) < (y - 20) * 0.12 && y < 100;
      return r < bump || spike ? [30, 30, 30] : [255, 255, 255];
    });
    const nodes = (s: number) => run(img, { ...defaultParams, smooth: s, bg: 'remove' }).layers[0];
    const low = nodes(0), mid = nodes(4), high = nodes(10);
    expect(high.nodes).toBeLessThan(low.nodes * 0.6);
    // 尖刺頂端在 y≈20px = 7.5mm（150mm / 400px）
    const tip = (l: typeof low) => Math.min(...[...l.d.matchAll(/[-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1])));
    expect(tip(mid)).toBeLessThan(9); // 預設平滑度：尖端完整
    expect(tip(high)).toBeLessThan(9.5 + 2); // 最高平滑度：最細的尖端可能被吃掉一點，但不超過 2mm
  });
});

describe('小面積細節', () => {
  it('細細一圈的獨特顏色（例如藍色虹膜）會保留', () => {
    // 白底上的黃色眼斑，中間一圈 3px 寬的藍色虹膜包著黑色瞳孔
    const img = makeImage(600, 600, (x, y) => {
      const d = Math.hypot(x - 300, y - 300);
      if (d < 9) return [15, 15, 30];
      if (d < 12) return [10, 135, 210];
      if (d < 60) return [250, 185, 55];
      return [253, 253, 253];
    });
    const hexes = run(img).layers.map((l) => l.hex);
    expect(hexes.some((h) => h.startsWith('#0') && parseInt(h.slice(5, 7), 16) > 180)).toBe(true);
  });

  it('低對比的柔邊陰影（ΔE≈5）在預設參數下保留', () => {
    const img = makeImage(300, 300, (x, y) => {
      // 白色身體，右半邊有淺灰陰影，交界柔和 3px
      if (Math.hypot(x - 150, y - 150) > 120) return [10, 24, 69];
      const t = Math.min(1, Math.max(0, (x - 170) / 3));
      return [246 - 13 * t, 246 - 13 * t, 247 - 12 * t];
    });
    expect(run(img).layers.length).toBe(3);
  });
});
