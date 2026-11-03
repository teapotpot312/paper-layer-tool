import { deltaE, rgbToLab, toHex } from '../lib/color';
import type { LayerResult, Params, PipelineResult, Quality, RGBAImage } from '../lib/types';
import { absorbSmall, components, dilate, downscale, erode, fillHoles, median3, modeFilter, thinRegions } from './mask';
import { assignLabels, buildPalette, type PaletteColor } from './quantize';
import { ringArea, ringsToPath, simplify, traceMask, type Ring } from './trace';

const RES: Record<Quality, number> = { draft: 480, final: 1200 };

/**
 * 影像處理管線。每一段都以參數組成的 key 快取，參數變動時只重算受影響的後段。
 */
export class Pipeline {
  private base: RGBAImage | null = null;
  private cache = new Map<string, unknown>();

  setImage(img: RGBAImage) {
    this.base = img;
    this.cache.clear();
  }

  private memo<T>(key: string, fn: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const v = fn();
    // 每一段只保留最近幾個結果，避免記憶體無限成長
    const prefix = key.split(':')[0];
    const same = [...this.cache.keys()].filter((k) => k.startsWith(prefix + ':'));
    if (same.length >= 3) this.cache.delete(same[0]);
    this.cache.set(key, v);
    return v;
  }

  run(p: Params, quality: Quality, seq = 0): PipelineResult {
    const t0 = performance.now();
    if (!this.base) throw new Error('no image');
    const base = this.base;
    const warnings: string[] = [];

    // ② 調色盤：固定在縮圖上計算，草稿與精確結果共用同一組顏色
    const small = this.memo('s300:', () => downscale(base, 300));
    const pre300 = this.memo(`p300:${p.blur}`, () => median3(small, p.blur));
    const quantKey = `${p.k}|${p.merge}|${p.blur}`;
    const tm: Record<string, number> = {};
    const mark = (k: string) => (tm[k] = Math.round(performance.now() - t0));

    // 調色盤在 600px 上取樣（細節足夠，又不會太慢）
    const pre600 = this.memo(`p600:${p.blur}`, () => median3(downscale(base, 600), p.blur));
    const { palette, effectiveK } = this.memo(`pal:${quantKey}`, () => buildPalette(pre600, p.k, p.merge));
    // 照片判斷：顏色種類非常多，或分層後與原圖的平均色差仍很大
    const photo = this.memo(`photo:${quantKey}`, () => uniqueColors(small.data) > 9000 || meanError(pre300.data, palette) > 9);
    if (photo) warnings.push('photo');

    // ①③ 預處理與像素分配
    const res = RES[quality];
    const img = this.memo(`img:${res}`, () => downscale(base, res));
    const { width: w, height: h } = img;
    const pre = this.memo(`pre:${res}|${p.blur}`, () => median3(img, p.blur));
    mark("palette");
    const raw = this.memo(`lab:${res}|${quantKey}`, () => assignLabels(pre.data, w, h, palette));
    const pxPerMm = w / p.widthMm;
    const nL = palette.length;

    // ⑤ 清理（平滑 + 碎片併入鄰近色）
    const passes = p.smooth === 0 ? 0 : 1 + Math.round(p.smooth / 5);
    const minPx = p.minAreaMm2 * pxPerMm * pxPerMm;
    const labels = this.memo(`clean:${res}|${quantKey}|${passes}|${minPx.toFixed(1)}`, () =>
      absorbSmall(modeFilter(raw, w, h, passes, nL), w, h, minPx, nL),
    );

    const counts = new Int32Array(nL);
    for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) counts[labels[i]]++;
    const bgId = detectBackground(labels, w, h, nL);

    // ⑥ 圖層順序
    const present = palette.map((_, i) => i).filter((i) => counts[i] > 0 && !(p.bg === 'remove' && i === bgId));
    const order = resolveOrder(present, p.order, defaultOrder(present, palette, counts, bgId, p.sort));

    const N = w * h;
    const own = new Map<number, Uint8Array>();
    for (const id of order) {
      const m = new Uint8Array(N);
      if (p.bg === 'plate' && id === bgId) m.fill(1);
      else for (let i = 0; i < N; i++) if (labels[i] === id) m[i] = 1;
      own.set(id, m);
    }

    mark("clean");
    const layers: LayerResult[] = [];
    let acc: Uint8Array | null = null;
    const finals = new Map<number, Uint8Array>();
    for (let oi = order.length - 1; oi >= 0; oi--) {
      const id = order[oi];
      const opts = p.layerOpts[id] ?? {};
      const holes = (x: Uint8Array) => (opts.keepHoles ? x : fillHoles(x, w, h, p.fillMm2 * pxPerMm * pxPerMm));
      const mine = own.get(id)!;
      const above = acc;
      // 累加的聯集一律往下傳，獨立模式用來限制延伸範圍
      acc = acc ? or(acc, mine) : mine.slice();
      let m: Uint8Array;
      if (p.mode === 'additive') {
        // 累加：本層 ∪ 上方所有層
        m = holes(acc.slice());
      } else {
        // 獨立：延伸只長進「上方圖層底下」當黏貼面，可見形狀不變，也不會蓋到下層的細節
        m = holes(mine);
        if (above && p.extendMm > 0) m = or(m, and(dilate(m, w, h, p.extendMm * pxPerMm), above));
      }
      if (opts.extra) m = offset(m, w, h, opts.extra * pxPerMm);
      finals.set(id, m);
    }

    const r = (p.minWidthMm / 2) * pxPerMm;
    const resScale = res === RES.final ? Math.min(1, w / 1200 + 0.2) : 0.5;
    const sigma = (0.6 + p.smooth * 0.12) * Math.max(0.5, resScale);
    const eps = (0.35 + p.smooth * 0.1) * Math.max(0.5, resScale);
    const mm = 1 / pxPerMm;

    mark('compose');
    // 過細偵測在半解析度上做（精度約 0.25 mm，足夠提示用，速度快約 4 倍）
    const hs = res === RES.final && w > 600 ? 2 : 1;
    const hw = Math.ceil(w / hs), hh = Math.ceil(h / hs);
    const detectThin = (m: Uint8Array) => thinRegions(hs === 1 ? m : half(m, w, h), hw, hh, r / hs);
    for (const id of order) {
      let m = finals.get(id)!;
      let thin = detectThin(m);
      if (p.fix !== 'off' && thin.some((v) => v)) {
        const full = hs === 1 ? thin : double(thin, hw, hh, w, h);
        if (p.fix === 'thicken') m = or(m, dilate(full, w, h, r));
        else for (let i = 0; i < N; i++) if (full[i]) m[i] = 0;
        thin = detectThin(m);
      }
      let area = 0;
      for (let i = 0; i < N; i++) area += m[i];
      const rings = traceMask(m, w, h, sigma).map((rg) => simplify(rg, eps)).filter((rg) => Math.abs(ringArea(rg)) > 2);
      const [d, nodes] = ringsToPath(rings, mm, p.smooth > 0);
      const thinRings = traceMask(thin, hw, hh, 0.5).map((rg) => simplify(rg, 0.6 / hs)).filter((rg) => Math.abs(ringArea(rg)) > 1 / hs);
      const [thinD] = ringsToPath(thinRings, mm * hs, false);
      const thinCount = components(thin, hw, hh).areas.length;
      let foamD = "";
      if (p.layerOpts[id]?.foam) {
        const fm = erode(m, w, h, 1 * pxPerMm);
        [foamD] = ringsToPath(traceMask(fm, w, h, sigma).map((rg) => simplify(rg, eps)), mm, true);
      }
      const c = palette[id].rgb;
      layers.push({
        id,
        hex: toHex(c[0], c[1], c[2]),
        areaMm2: area * mm * mm,
        objects: countOuter(rings),
        d,
        nodes,
        thinD,
        thinCount,
        foamD,
        isBg: id === bgId,
      });
    }

    return {
      seq,
      quality,
      quantKey,
      effectiveK,
      layers,
      order,
      widthMm: p.widthMm,
      heightMm: h / pxPerMm,
      pxPerMm,
      warnings,
      ms: Math.round(performance.now() - t0),
      timings: tm,
    };
  }
}

/** 2×2 降採樣（兩個以上為 1 即為 1） */
function half(m: Uint8Array, w: number, h: number): Uint8Array {
  const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2), o = new Uint8Array(hw * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      const x0 = 2 * x, y0 = 2 * y, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      o[y * hw + x] = m[y0 * w + x0] + m[y0 * w + x1] + m[y1 * w + x0] + m[y1 * w + x1] >= 2 ? 1 : 0;
    }
  return o;
}

/** 半解析度遮罩放大回原尺寸 */
function double(m: Uint8Array, hw: number, hh: number, w: number, h: number): Uint8Array {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = m[(y >> 1) * hw + (x >> 1)];
  return o;
}

/** 正值外擴、負值內縮 */
function offset(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return r >= 0 ? dilate(m, w, h, r) : erode(m, w, h, -r);
}

function and(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] & b[i];
  return o;
}

function or(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] | b[i];
  return o;
}

function countOuter(rings: Ring[]): number {
  if (!rings.length) return 0;
  let big = rings[0], ba = 0;
  for (const r of rings) {
    const a = Math.abs(ringArea(r));
    if (a > ba) { ba = a; big = r; }
  }
  const s = Math.sign(ringArea(big));
  return rings.filter((r) => Math.sign(ringArea(r)) === s).length;
}

/** 邊框上出現最多的顏色視為背景；若邊框多半透明則無背景色 */
export function detectBackground(labels: Int16Array, w: number, h: number, nL: number): number | null {
  const cnt = new Int32Array(nL + 1);
  const add = (i: number) => cnt[labels[i] + 1]++;
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { add(y * w); add(y * w + w - 1); }
  let best = -1, bc = -1;
  for (let l = 0; l <= nL; l++) if (cnt[l] > bc) { bc = cnt[l]; best = l - 1; }
  const total = 2 * w + 2 * (h - 2);
  if (best < 0 || bc < total * 0.35) return null;
  return best;
}

export function defaultOrder(ids: number[], palette: PaletteColor[], counts: Int32Array, bgId: number | null, sort: 'light' | 'area'): number[] {
  const rest = ids.filter((i) => i !== bgId);
  rest.sort((a, b) => (sort === 'light' ? palette[b].lab[0] - palette[a].lab[0] : counts[b] - counts[a]));
  return bgId != null && ids.includes(bgId) ? [bgId, ...rest] : rest;
}

/** 使用者自訂順序：保留其中仍存在的層，新出現的層依預設順序插入 */
export function resolveOrder(present: number[], wanted: number[] | null, fallback: number[]): number[] {
  if (!wanted) return fallback;
  const set = new Set(present);
  const out = wanted.filter((i) => set.has(i));
  for (const id of fallback) if (!out.includes(id)) out.splice(Math.min(out.length, fallback.indexOf(id)), 0, id);
  return out;
}

function meanError(data: Uint8ClampedArray, palette: PaletteColor[]): number {
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * 3) {
    if (data[i + 3] < 128) continue;
    const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
    let best = Infinity;
    for (const p of palette) best = Math.min(best, deltaE(lab, p.lab));
    sum += best;
    n++;
  }
  return n ? sum / n : 0;
}

function uniqueColors(data: Uint8ClampedArray): number {
  const s = new Set<number>();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) s.add(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
  return s.size;
}
