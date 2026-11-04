import { deltaE, rgbToLab, rng, type Lab } from '../lib/color';

export interface PaletteColor {
  lab: Lab;
  rgb: [number, number, number];
  /** 佔不透明像素的比例 */
  frac: number;
  /** 只出現在細線上的顏色（細線色救援補進來的） */
  line?: boolean;
}

interface Cluster {
  lab: Lab;
  rgbSum: [number, number, number];
  w: number;
  line?: boolean;
}

/**
 * K-means++（Lab 空間，固定種子）。
 * samples: 交錯排列的 Lab 值 [L,a,b,...]，rgb: 對應 sRGB。
 */
export function kmeans(samples: Float32Array, rgbs: Uint8Array, k: number, seed = 1234, iters = 16): Cluster[] {
  const n = samples.length / 3;
  if (n === 0) return [];
  k = Math.min(k, n);
  const rand = rng(seed);
  const centers: Lab[] = [];
  const d2 = new Float32Array(n).fill(Infinity);
  const first = Math.floor(rand() * n);
  centers.push([samples[first * 3], samples[first * 3 + 1], samples[first * 3 + 2]]);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dl = samples[i * 3] - c[0], da = samples[i * 3 + 1] - c[1], db = samples[i * 3 + 2] - c[2];
      const d = dl * dl + da * da + db * db;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i];
    }
    if (sum === 0) break;
    let r = rand() * sum, pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i];
      if (r <= 0) { pick = i; break; }
    }
    centers.push([samples[pick * 3], samples[pick * 3 + 1], samples[pick * 3 + 2]]);
  }
  const K = centers.length;
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const sums = new Float64Array(K * 3), cnt = new Float64Array(K);
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const L = samples[i * 3], A = samples[i * 3 + 1], B = samples[i * 3 + 2];
      let best = 0, bd = Infinity;
      for (let j = 0; j < K; j++) {
        const c = centers[j];
        const d = (L - c[0]) ** 2 + (A - c[1]) ** 2 + (B - c[2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      if (assign[i] !== best) changed++;
      assign[i] = best;
      sums[best * 3] += L; sums[best * 3 + 1] += A; sums[best * 3 + 2] += B; cnt[best]++;
    }
    for (let j = 0; j < K; j++) if (cnt[j] > 0) centers[j] = [sums[j * 3] / cnt[j], sums[j * 3 + 1] / cnt[j], sums[j * 3 + 2] / cnt[j]];
    if (it > 0 && changed === 0) break;
  }
  const clusters: Cluster[] = centers.map((lab) => ({ lab, rgbSum: [0, 0, 0], w: 0 }));
  for (let i = 0; i < n; i++) {
    const c = clusters[assign[i]];
    c.w++;
    c.rgbSum[0] += rgbs[i * 3]; c.rgbSum[1] += rgbs[i * 3 + 1]; c.rgbSum[2] += rgbs[i * 3 + 2];
  }
  return clusters.filter((c) => c.w > 0);
}

/**
 * 合併相近色：每次合併 ΔE 最小的一對，直到最小 ΔE ≥ 門檻或達到 maxCount。
 * 保護高對比小色塊：面積 < 2% 的色塊需 ΔE < 門檻×0.6 才會被合併。
 */
export function mergeClusters(clusters: Cluster[], threshold: number, maxCount = Infinity, minCount = 2): Cluster[] {
  const cs = clusters.map((c) => ({ ...c, lab: [...c.lab] as Lab, rgbSum: [...c.rgbSum] as [number, number, number] }));
  const total = cs.reduce((s, c) => s + c.w, 0) || 1;
  for (;;) {
    if (cs.length <= minCount) break;
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) {
        const d = deltaE(cs[i].lab, cs[j].lab);
        const small = Math.min(cs[i].w, cs[j].w) / total < 0.02;
        // 有效距離：小色塊被「放大」距離以受保護
        // 小面積且對比明顯（例如黑眼睛）才保護；幾乎同色的小色塊（雜訊、顆粒）照常合併
        const eff = small && d > 6 ? d / 0.6 : d;
        if (eff < best) { best = eff; bi = i; bj = j; }
      }
    if (bi < 0) break;
    if (best >= threshold && cs.length <= maxCount) break;
    const a = cs[bi], b = cs[bj], w = a.w + b.w;
    a.lab = [(a.lab[0] * a.w + b.lab[0] * b.w) / w, (a.lab[1] * a.w + b.lab[1] * b.w) / w, (a.lab[2] * a.w + b.lab[2] * b.w) / w];
    a.rgbSum = [a.rgbSum[0] + b.rgbSum[0], a.rgbSum[1] + b.rgbSum[1], a.rgbSum[2] + b.rgbSum[2]];
    a.w = w;
    cs.splice(bj, 1);
  }
  return cs;
}

export function toPalette(cs: Cluster[]): PaletteColor[] {
  const total = cs.reduce((s, c) => s + c.w, 0) || 1;
  return cs
    .map((c) => ({ lab: c.lab, rgb: [c.rgbSum[0] / c.w, c.rgbSum[1] / c.w, c.rgbSum[2] / c.w] as [number, number, number], frac: c.w / total, line: c.line }))
    .sort((a, b) => b.frac - a.frac);
}

/** 從 RGBA 影像取樣（最多 maxSamples 個不透明像素） */
export function sample(data: Uint8ClampedArray, maxSamples = 40000) {
  const n = data.length / 4;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] >= 128) opaque++;
  const stride = Math.max(1, Math.ceil(opaque / maxSamples));
  const m = Math.ceil(opaque / stride);
  const labs = new Float32Array(m * 3), rgbs = new Uint8Array(m * 3);
  let c = 0, j = 0;
  for (let i = 0; i < n && j < m; i++) {
    if (data[i * 4 + 3] < 128) continue;
    if (c++ % stride !== 0) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lab = rgbToLab(r, g, b);
    labs[j * 3] = lab[0]; labs[j * 3 + 1] = lab[1]; labs[j * 3 + 2] = lab[2];
    rgbs[j * 3] = r; rgbs[j * 3 + 1] = g; rgbs[j * 3 + 2] = b;
    j++;
  }
  return { labs: labs.subarray(0, j * 3), rgbs: rgbs.subarray(0, j * 3) };
}

/** 每個像素的 Lab 值（透明像素為 NaN） */
export function labImage(data: Uint8ClampedArray): Float32Array {
  const n = data.length / 4;
  const out = new Float32Array(n * 3);
  const cache = new Map<number, Lab>();
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) { out[i * 3] = NaN; continue; }
    const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    let lab = cache.get(key);
    if (!lab) { lab = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); cache.set(key, lab); }
    out[i * 3] = lab[0]; out[i * 3 + 1] = lab[1]; out[i * 3 + 2] = lab[2];
  }
  return out;
}

/** 與 8 鄰居色差都小於 FLAT 的像素 = 色塊內部（非反鋸齒邊緣） */
const FLAT = 5;
export function flatMask(lab: Float32Array, w: number, h: number): Uint8Array {
  const flat = new Uint8Array(w * h);
  const t2 = FLAT * FLAT;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Number.isNaN(lab[i * 3])) continue;
      let ok = 1;
      for (let dy = -1; dy <= 1 && ok; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (Number.isNaN(lab[j * 3])) continue;
          const d = (lab[i * 3] - lab[j * 3]) ** 2 + (lab[i * 3 + 1] - lab[j * 3 + 1]) ** 2 + (lab[i * 3 + 2] - lab[j * 3 + 2]) ** 2;
          if (d > t2) { ok = 0; break; }
        }
      flat[i] = ok;
    }
  return flat;
}

/**
 * 建立調色盤：只從「色塊內部」取樣，反鋸齒邊緣的混色不會佔用顏色名額。
 * k=null 時自動建議：先分 16 色，以「合併相近色」門檻合併，最多 12 色。
 */
export function buildPalette(img: { data: Uint8ClampedArray; width: number; height: number }, k: number | null, merge: number): { palette: PaletteColor[]; effectiveK: number } {
  const lab = labImage(img.data);
  const flat = flatMask(lab, img.width, img.height);
  let nFlat = 0;
  for (let i = 0; i < flat.length; i++) nFlat += flat[i];
  // 幾乎沒有平坦區（例如照片）就退回全部取樣
  const useFlat = nFlat > flat.length * 0.05;
  const filtered = new Uint8ClampedArray(img.data);
  if (useFlat) for (let i = 0; i < flat.length; i++) if (!flat[i]) filtered[i * 4 + 3] = 0;
  const { labs, rgbs } = sample(filtered);
  let cs: Cluster[];
  if (k == null) {
    cs = mergeGradients(kmeans(labs, rgbs, 16), lab, flat, img.width, img.height);
    const total = cs.reduce((s, c) => s + c.w, 0);
    // 極少量的平坦色多半是雜訊
    cs = cs.filter((c) => c.w >= total * 0.0004);
    if (useFlat) cs = rescueLineColors(cs, lab, flat, img.data, img.width, img.height);
    cs = mergeClusters(cs, merge, 12, 2);
  } else {
    cs = mergeGradients(kmeans(labs, rgbs, k), lab, flat, img.width, img.height);
    if (useFlat) cs = rescueLineColors(cs, lab, flat, img.data, img.width, img.height);
    cs = mergeClusters(cs, merge, k, Math.min(2, k));
  }
  const palette = toPalette(cs);
  return { palette, effectiveK: palette.length };
}

/**
 * 合併漸層：兩群顏色若在「平坦像素之間」大量相鄰（交界沒有銳利的邊），
 * 代表它們是同一塊漸層被 K-means 切開，直接合併。真正的色塊交界是銳利邊緣，不會被合併。
 */
const GRAD_STEP = 1;
export function mergeGradients(cs: Cluster[], lab: Float32Array, flat: Uint8Array, w: number, h: number): Cluster[] {
  const K = cs.length;
  if (K < 2) return cs;
  const pal = cs.map((c) => ({ lab: c.lab })) as PaletteColor[];
  const lbl = new Int16Array(w * h).fill(-1);
  const count = new Float64Array(K);
  for (let i = 0; i < w * h; i++) {
    if (!flat[i]) continue;
    lbl[i] = nearest(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], pal)[0];
    count[lbl[i]]++;
  }
  const adj = new Float64Array(K * K);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = lbl[y * w + x];
      if (a < 0) continue;
      const i = y * w + x;
      // 只計算「幾乎同色」的相鄰像素：漸層每步色差很小，低對比的銳利邊緣則會跳一大步
      const smooth = (j: number) => (lab[i * 3] - lab[j * 3]) ** 2 + (lab[i * 3 + 1] - lab[j * 3 + 1]) ** 2 + (lab[i * 3 + 2] - lab[j * 3 + 2]) ** 2 < GRAD_STEP * GRAD_STEP;
      const r = x < w - 1 ? lbl[i + 1] : -1, d = y < h - 1 ? lbl[i + w] : -1;
      if (r >= 0 && r !== a && smooth(i + 1)) { adj[a * K + r]++; adj[r * K + a]++; }
      if (d >= 0 && d !== a && smooth(i + w)) { adj[a * K + d]++; adj[d * K + a]++; }
    }
  const parent = cs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < K; a++)
    for (let b = a + 1; b < K; b++) {
      // 真正的漸層交界很長；只靠零星相鄰串起來的不算，避免一路連鎖併進別的顏色
      const thr = Math.max(40, 0.8 * Math.sqrt(Math.min(count[a], count[b])));
      if (adj[a * K + b] > thr) parent[find(a)] = find(b);
    }
  const groups = new Map<number, Cluster>();
  cs.forEach((c, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (!g) { groups.set(r, { lab: [...c.lab] as Lab, rgbSum: [...c.rgbSum] as [number, number, number], w: c.w }); return; }
    const wt = g.w + c.w;
    g.lab = [(g.lab[0] * g.w + c.lab[0] * c.w) / wt, (g.lab[1] * g.w + c.lab[1] * c.w) / wt, (g.lab[2] * g.w + c.lab[2] * c.w) / wt];
    g.rgbSum = [g.rgbSum[0] + c.rgbSum[0], g.rgbSum[1] + c.rgbSum[1], g.rgbSum[2] + c.rgbSum[2]];
    g.w = wt;
  });
  return [...groups.values()];
}

function nearest(L: number, A: number, B: number, palette: PaletteColor[]): [number, number] {
  let best = 0, bd = Infinity;
  for (let j = 0; j < palette.length; j++) {
    const p = palette[j].lab;
    const d = (L - p[0]) ** 2 + (A - p[1]) ** 2 + (B - p[2]) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  return [best, Math.sqrt(bd)];
}

/** 細線像素至少要偏向細線色這麼多才保留 */
const LINE_T = 0.35;

/** 本身與主色的色差小於此值即視為純色 */
const PURE = 6;

/** 由附近色塊（或兩色塊的混色）解釋像素 P 的情況給予優勢，因為空間上有支持 */
const BIAS = 0.6;

/**
 * 找出最能解釋像素 i 的顏色：本身最近的主色，或附近色塊的顏色，或兩個附近色塊之間的混色
 * （混色歸給較接近的一側）。回傳 [標籤, 解釋距離, 是否為附近色塊解釋]。
 */
function explain(lab: Float32Array, i: number, cand: number[], palette: PaletteColor[], own: number, ownDist: number): [number, number, boolean] {
  const P0 = lab[i * 3], P1 = lab[i * 3 + 1], P2 = lab[i * 3 + 2];
  let best = own, bd = ownDist, byNeighbors = false;
  for (let a = 0; a < cand.length; a++) {
    const A = palette[cand[a]].lab;
    const da = Math.sqrt((P0 - A[0]) ** 2 + (P1 - A[1]) ** 2 + (P2 - A[2]) ** 2) * BIAS;
    if (da < bd) { bd = da; best = cand[a]; byNeighbors = true; }
    for (let b = a + 1; b < cand.length; b++) {
      const B = palette[cand[b]].lab;
      const v0 = B[0] - A[0], v1 = B[1] - A[1], v2 = B[2] - A[2];
      const len2 = v0 * v0 + v1 * v1 + v2 * v2 || 1;
      const t = Math.max(0, Math.min(1, ((P0 - A[0]) * v0 + (P1 - A[1]) * v1 + (P2 - A[2]) * v2) / len2));
      const ds = Math.sqrt((P0 - A[0] - t * v0) ** 2 + (P1 - A[1] - t * v1) ** 2 + (P2 - A[2] - t * v2) ** 2) * BIAS;
      if (ds < bd) { bd = ds; best = t < 0.5 ? cand[a] : cand[b]; byNeighbors = true; }
    }
  }
  return [best, bd, byNeighbors];
}

/** 點 P 到線段 AB 的距離（Lab） */
function segDist(P: Lab, A: Lab, B: Lab): number {
  const v0 = B[0] - A[0], v1 = B[1] - A[1], v2 = B[2] - A[2];
  const len2 = v0 * v0 + v1 * v1 + v2 * v2 || 1;
  const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * v0 + (P[1] - A[1]) * v1 + (P[2] - A[2]) * v2) / len2));
  return Math.hypot(P[0] - A[0] - t * v0, P[1] - A[1] - t * v1, P[2] - A[2] - t * v2);
}

/** 收集半徑 R 內「可信」像素（色塊內部，或本身就接近某個主色，例如細線中心）的標籤 */
function neighborLabels(labels: Int16Array, support: Uint8Array, w: number, h: number, x: number, y: number, R: number, cand: number[]) {
  cand.length = 0;
  for (let dy = -R; dy <= R; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      const j = yy * w + xx;
      if (support[j] && labels[j] >= 0 && !cand.includes(labels[j])) cand.push(labels[j]);
    }
  }
}

type Pt3 = [number, number, number];

/** 點 P 到三角形 ABC 的最短距離（Ericson, Real-Time Collision Detection 5.1.5） */
function triDist(P: Pt3, A: Pt3, B: Pt3, C: Pt3): number {
  const sub = (u: Pt3, v: Pt3): Pt3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: Pt3, v: Pt3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (u: Pt3, v: Pt3, w: Pt3, s: number, t: number): Pt3 => [u[0] + v[0] * s + w[0] * t, u[1] + v[1] * s + w[1] * t, u[2] + v[2] * s + w[2] * t];
  const ab = sub(B, A), ac = sub(C, A), ap = sub(P, A);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q: Pt3;
  if (d1 <= 0 && d2 <= 0) q = A;
  else {
    const bp = sub(P, B), d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = sub(P, C), d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = B;
    else if (d6 >= 0 && d5 <= d6) q = C;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = at(A, ab, ac, d1 / (d1 - d3), 0);
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = at(A, ab, ac, 0, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
      q = [B[0] + (C[0] - B[0]) * t, B[1] + (C[1] - B[1]) * t, B[2] + (C[2] - B[2]) * t];
    } else {
      const den = 1 / (va + vb + vc);
      q = at(A, ab, ac, vb * den, vc * den);
    }
  }
  return Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2]);
}

/**
 * 細線色救援：只出現在細線上的顏色（例如描邊、手寫字）永遠不是「色塊內部」，不會被取樣到。
 * 找出既不接近任何主色、也無法解釋成附近色塊混色的邊緣像素，另外分群補進調色盤。
 */
function rescueLineColors(cs: Cluster[], lab: Float32Array, flat: Uint8Array, data: Uint8ClampedArray, w: number, h: number): Cluster[] {
  const palette = cs.map((c) => ({ lab: c.lab })) as PaletteColor[];
  const n = w * h;
  const labels = new Int16Array(n).fill(-1);
  const near = new Float32Array(n);
  const support = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(lab[i * 3])) continue;
    const [l, d] = nearest(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], palette);
    labels[i] = l; near[i] = d;
    support[i] = flat[i] || d < PURE ? 1 : 0;
  }
  const picked: number[] = [];
  const cand: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (flat[i] || Number.isNaN(lab[i * 3])) continue;
      if (near[i] < 15) continue;
      neighborLabels(labels, support, w, h, x, y, 3, cand);
      // 亮度落在兩側色塊之間 → 是兩色交界的混色（例如深藍線條旁的灰邊）；真正的細線會比兩側都暗或都亮
      if (cand.length >= 2) {
        let lo = Infinity, hi = -Infinity;
        for (const c of cand) { lo = Math.min(lo, palette[c].lab[0]); hi = Math.max(hi, palette[c].lab[0]); }
        if (lab[i * 3] > lo - 4 && lab[i * 3] < hi + 4) continue;
      }
      const [, bd] = explain(lab, i, cand, palette, labels[i], Infinity);
      if (bd > 8) picked.push(i);
    }
  if (picked.length < Math.max(20, n * 0.0005)) return cs;
  const labs = new Float32Array(picked.length * 3), rgbs = new Uint8Array(picked.length * 3);
  picked.forEach((i, j) => {
    labs.set(lab.subarray(i * 3, i * 3 + 3), j * 3);
    rgbs.set([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], j * 3);
  });
  const extra = kmeans(labs, rgbs, Math.min(4, Math.ceil(picked.length / 200)), 99)
    .filter((c) => c.w >= Math.max(20, n * 0.0003))
    // 必須是全新的顏色：跟現有主色差很多，也不是任兩個或任三個主色的混色
    // （反鋸齒是在 RGB 裡混色，三色交會處的混色會落在三色圍成的三角形內）
    .filter((c) => {
      if (palette.some((p) => deltaE(c.lab, p.lab) < 20)) return false;
      for (let a = 0; a < palette.length; a++)
        for (let b = a + 1; b < palette.length; b++) if (segDist(c.lab, palette[a].lab, palette[b].lab) < 10) return false;
      const rgb = (k: Cluster): Pt3 => [k.rgbSum[0] / k.w, k.rgbSum[1] / k.w, k.rgbSum[2] / k.w];
      const P = rgb(c), C = cs.map(rgb);
      for (let a = 0; a < C.length; a++)
        for (let b = a + 1; b < C.length; b++)
          for (let d = b + 1; d < C.length; d++) if (triDist(P, C[a], C[b], C[d]) < 14) return false;
      return true;
    })
    .map((c) => ({ ...c, line: true }));
  return [...cs, ...extra];
}

/**
 * 每個像素分配到主色；透明為 -1。
 * 色塊內部直接取最近色。邊緣像素若能解釋成附近兩個色塊的混色（反鋸齒），
 * 就歸給較接近的那一側，避免色塊之間多出一圈雜色；
 * 真正的細線（本身就是純色）則保留自己的顏色。
 */
export function assignLabels(data: Uint8ClampedArray, w: number, h: number, palette: PaletteColor[]): Int16Array {
  const n = w * h;
  const lab = labImage(data);
  const flat = flatMask(lab, w, h);
  const labels = new Int16Array(n);
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(lab[i * 3])) { labels[i] = -1; continue; }
    const [b, d] = nearest(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], palette);
    labels[i] = b; dist[i] = d;
  }
  const R = 3;
  const cand: number[] = [];
  const out = labels.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] < 0 || flat[i]) continue;
      // 只出現在細線上的顏色：像素本身夠接近就保留
      if (palette[labels[i]].line && dist[i] < PURE) continue;
      neighborLabels(labels, flat, w, h, x, y, R, cand);
      if (!cand.length || cand.includes(labels[i])) continue;
      // 單一底色上的細線（白底黑線、牌子上的字）：像素是「底色 ↔ 細線色」的混色，偏向細線色就保留
      if (cand.length === 1) {
        const A = palette[cand[0]].lab, C = palette[labels[i]].lab;
        const P: Lab = [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];
        const v0 = C[0] - A[0], v1 = C[1] - A[1], v2 = C[2] - A[2];
        const t = ((P[0] - A[0]) * v0 + (P[1] - A[1]) * v1 + (P[2] - A[2]) * v2) / (v0 * v0 + v1 * v1 + v2 * v2 || 1);
        if (t >= LINE_T && segDist(P, A, C) < 8) continue;
      }
      const [best] = explain(lab, i, cand, palette, labels[i], dist[i]);
      out[i] = best;
    }
  return out;
}
