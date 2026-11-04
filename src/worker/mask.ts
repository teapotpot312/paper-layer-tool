import type { RGBAImage } from '../lib/types';
import { bbox } from './trace';

/** 盒狀降採樣到長邊 maxSide */
export function downscale(img: RGBAImage, maxSide: number): RGBAImage {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s >= 1) return img;
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const al = img.data[i + 3];
          r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n++;
        }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return { data: out, width: w, height: h };
}

/** 3×3 中值濾波（邊緣保留），重複 passes 次，用來壓低漸層與紋理雜訊 */
export function median3(img: RGBAImage, passes: number): RGBAImage {
  let src = img.data;
  const { width: w, height: h } = img;
  const buf = new Uint8Array(9);
  for (let p = 0; p < passes; p++) {
    const dst = new Uint8ClampedArray(src);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++)
        for (let c = 0; c < 3; c++) {
          let k = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) buf[k++] = src[((y + dy) * w + x + dx) * 4 + c];
          buf.sort();
          dst[(y * w + x) * 4 + c] = buf[4];
        }
    src = dst;
  }
  return { data: src, width: w, height: h };
}

/** 1D 平方距離轉換（Felzenszwalb） */
function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity && f[v[k]] === Infinity) continue;
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dv = q - v[k];
    d[q] = f[v[k]] === Infinity ? Infinity : dv * dv + f[v[k]];
  }
}

/** 每個像素到最近「feature=1」像素的平方距離 */
export function dist2(feature: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const n = Math.max(w, h);
  const f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = feature[y * w + x] ? 0 : Infinity;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

/** 圓形結構元素外擴（等同 round join offset） */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const d = dist2(mask, w, h), r2 = r * r, out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r2 ? 1 : 0;
  return out;
}

/** 圓形結構元素內縮 */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dist2(inv, w, h), r2 = r * r, out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] > r2 ? 1 : 0;
  return out;
}

/**
 * 找出「過細」區域：開運算（半徑 r）去不掉的部分保留，去掉的部分即寬度 < 2r。
 * 回傳過細像素遮罩（已濾掉轉角產生的極小碎屑）。
 */
export function thinRegions(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // 只在外框範圍內計算（外圍留 r+2 的空白，距離轉換結果與全圖相同）
  const bb = bbox(mask, w, h);
  if (!bb) return new Uint8Array(w * h);
  const pad = Math.ceil(r) + 2;
  const x0 = Math.max(0, bb[0] - pad), y0 = Math.max(0, bb[1] - pad), x1 = Math.min(w, bb[2] + pad), y1 = Math.min(h, bb[3] + pad);
  const sw = x1 - x0, sh = y1 - y0;
  if (sw === w && sh === h) return thinFull(mask, w, h, r);
  const sub = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) sub.set(mask.subarray((y + y0) * w + x0, (y + y0) * w + x1), y * sw);
  const t = thinFull(sub, sw, sh, r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < sh; y++) out.set(t.subarray(y * sw, y * sw + sw), (y + y0) * w + x0);
  return out;
}

function thinFull(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const dz = dist2(inv, w, h);
  const core = new Uint8Array(w * h), r2 = r * r;
  for (let i = 0; i < core.length; i++) core[i] = mask[i] && dz[i] >= r2 - 0.01 ? 1 : 0;
  const dc = dist2(core, w, h);
  const thin = new Uint8Array(w * h);
  for (let i = 0; i < thin.length; i++) thin[i] = mask[i] && dc[i] > r2 + 0.01 ? 1 : 0;
  const minArea = Math.max(3, 0.6 * r * r);
  const { comp, areas } = components(thin, w, h);
  for (let i = 0; i < thin.length; i++) if (thin[i] && areas[comp[i]] < minArea) thin[i] = 0;
  return thin;
}

/** 連通區域標記（4 連通），回傳每像素的區域編號（-1 = 背景）與各區面積 */
export function components(mask: Uint8Array, w: number, h: number) {
  const comp = new Int32Array(w * h).fill(-1);
  const areas: number[] = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    const id = areas.length;
    let sp = 0, area = 0;
    stack[sp++] = s; comp[s] = id;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] && comp[p - 1] < 0) { comp[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && comp[p + 1] < 0) { comp[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && comp[p - w] < 0) { comp[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && comp[p + w] < 0) { comp[p + w] = id; stack[sp++] = p + w; }
    }
    areas.push(area);
  }
  return { comp, areas };
}

/** 填補面積小於 maxArea 的孔洞（不接觸邊界的背景區域） */
export function fillHoles(mask: Uint8Array, w: number, h: number, maxArea: number): Uint8Array {
  const out = mask.slice();
  if (maxArea <= 0) return out;
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { comp, areas } = components(inv, w, h);
  const touches = new Uint8Array(areas.length);
  for (let x = 0; x < w; x++) {
    if (comp[x] >= 0) touches[comp[x]] = 1;
    const b = (h - 1) * w + x;
    if (comp[b] >= 0) touches[comp[b]] = 1;
  }
  for (let y = 0; y < h; y++) {
    const l = y * w, r = y * w + w - 1;
    if (comp[l] >= 0) touches[comp[l]] = 1;
    if (comp[r] >= 0) touches[comp[r]] = 1;
  }
  for (let i = 0; i < out.length; i++) {
    const c = comp[i];
    if (c >= 0 && !touches[c] && areas[c] < maxArea) out[i] = 1;
  }
  return out;
}

/** 3×3 多數決濾波（標籤圖平滑，等同對所有色層同時做開閉運算） */
/** strong：一般多數決（周圍 5 個以上同色就改），會抹平邊界凹凸；否則只清孤立雜點 */
export function modeFilter(labels: Int16Array, w: number, h: number, passes: number, nLabels: number, strong = false): Int16Array {
  let src = labels;
  const cnt = new Int32Array(nLabels + 1);
  for (let p = 0; p < passes; p++) {
    const dst = src.slice();
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        cnt.fill(0);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[src[i + dy * w + dx] + 1]++;
        const own = cnt[src[i] + 1];
        let best = src[i], bc = 0;
        for (let l = 0; l <= nLabels; l++) if (l !== src[i] + 1 && cnt[l] > bc) { bc = cnt[l]; best = l - 1; }
        // 只清掉幾乎被單一顏色包圍的孤立雜點（反鋸齒雜邊已在分色時處理），細線與轉角都保留
        if (strong ? bc >= 5 && bc > own : own <= 2 && bc >= 7) dst[i] = best;
      }
    src = dst;
  }
  return src;
}

/** 8 鄰居索引（越界為 -1；上下越界由呼叫端以 q < 0 || q >= length 判斷） */
function neighbors8(p: number, x: number, w: number): number[] {
  const l = x > 0, r = x < w - 1;
  return [l ? p - 1 : -1, r ? p + 1 : -1, p - w, p + w, l ? p - w - 1 : -1, r ? p - w + 1 : -1, l ? p + w - 1 : -1, r ? p + w + 1 : -1];
}

/**
 * 移除小碎片：同色連通區域（8 連通，斜線不會被拆碎）面積 < minArea 者，併入邊界接觸最多的鄰近色（而非留白）。
 */
export function absorbSmall(labels: Int16Array, w: number, h: number, minArea: number, nLabels: number): Int16Array {
  const out = labels.slice();
  if (minArea <= 1) return out;
  const comp = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const small: Int32Array[] = [];
  let id = 0;
  for (let s = 0; s < out.length; s++) {
    if (comp[s] >= 0 || out[s] < 0) continue;
    const lab = out[s];
    let sp = 0, n = 0;
    const pixels: number[] = [];
    stack[sp++] = s; comp[s] = id;
    while (sp > 0) {
      const p = stack[--sp];
      n++;
      if (n <= minArea) pixels.push(p);
      const x = p % w;
      const nb = neighbors8(p, x, w);
      for (const q of nb) if (q >= 0 && q < out.length && comp[q] < 0 && out[q] === lab) { comp[q] = id; stack[sp++] = q; }
    }
    if (n < minArea) small.push(Int32Array.from(pixels));
    id++;
  }
  small.sort((a, b) => a.length - b.length);
  const tally = new Int32Array(nLabels);
  for (const px of small) {
    const lab = out[px[0]];
    tally.fill(0);
    for (const p of px) {
      const x = p % w;
      const nb = neighbors8(p, x, w);
      for (const q of nb) if (q >= 0 && q < out.length && out[q] >= 0 && out[q] !== lab) tally[out[q]]++;
    }
    let best = -1, bc = 0;
    for (let l = 0; l < nLabels; l++) if (tally[l] > bc) { bc = tally[l]; best = l; }
    if (best >= 0) for (const p of px) out[p] = best;
  }
  return out;
}
