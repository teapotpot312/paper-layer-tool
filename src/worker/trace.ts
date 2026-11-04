export type Pt = [number, number];
export type Ring = Pt[];

/** 可分離高斯模糊 */
function gaussian(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0.05) return src;
  const r = Math.ceil(sigma * 2.5);
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += src[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
      out[y * w + x] = v;
    }
  return out;
}

// 每個 case 的有向線段（內部在行進方向左側）。邊：0=上 1=右 2=下 3=左
const SEG: Record<number, number[][]> = {
  1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]],
  8: [[2, 3]], 9: [[2, 0]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]],
};

/**
 * 輪廓追蹤：遮罩先高斯模糊，再以 marching squares 取 0.5 等值線（次像素精度）。
 * 邊界外先複製一圈再補 0，讓碰到圖片邊緣的形狀沿邊緣切齊。
 * 回傳的座標單位為像素，外輪廓與孔洞方向相反（可用 nonzero 或 evenodd）。
 */
export function traceMask(mask: Uint8Array, w: number, h: number, sigma = 1): Ring[] {
  // 只處理遮罩的外框範圍（上層通常只佔畫面一小塊）
  const bb = bbox(mask, w, h);
  if (!bb) return [];
  const pad = Math.ceil(sigma * 2.5) + 2;
  const x0 = Math.max(0, bb[0] - pad), y0 = Math.max(0, bb[1] - pad), x1 = Math.min(w, bb[2] + pad), y1 = Math.min(h, bb[3] + pad);
  const sw = x1 - x0, sh = y1 - y0;
  const P = 2, W = sw + 2 * P, H = sh + 2 * P;
  const g = new Float32Array(W * H);
  for (let y = -1; y <= sh; y++)
    for (let x = -1; x <= sw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, x)), sy = Math.min(sh - 1, Math.max(0, y));
      g[(y + P) * W + x + P] = mask[(sy + y0) * w + sx + x0];
    }
  // 模糊時外圈的 0 不參與到影像邊界內
  const v = gaussian(g, W, H, sigma);
  // 模糊不能讓細線消失：原本屬於遮罩的像素至少保留 0.55（大色塊邊緣本來就高於此值，不受影響）
  if (v !== g) for (let i = 0; i < v.length; i++) if (g[i] > 0 && v[i] < 0.55) v[i] = 0.55;
  for (let x = 0; x < W; x++) { v[x] = 0; v[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { v[y * W] = 0; v[y * W + W - 1] = 0; }
  const iso = 0.5;
  // 邊 id：水平邊 (x,y)->(x+1,y) = 2*(y*W+x)，垂直邊 (x,y)->(x,y+1) = 2*(y*W+x)+1
  const next = new Int32Array(2 * W * H).fill(-1);
  const starts: number[] = [];
  const edgeId = (cx: number, cy: number, e: number) =>
    e === 0 ? 2 * (cy * W + cx) : e === 2 ? 2 * ((cy + 1) * W + cx) : e === 3 ? 2 * (cy * W + cx) + 1 : 2 * (cy * W + cx + 1) + 1;
  for (let cy = 0; cy < H - 1; cy++)
    for (let cx = 0; cx < W - 1; cx++) {
      const tl = v[cy * W + cx], tr = v[cy * W + cx + 1], br = v[(cy + 1) * W + cx + 1], bl = v[(cy + 1) * W + cx];
      const c = (tl > iso ? 1 : 0) | (tr > iso ? 2 : 0) | (br > iso ? 4 : 0) | (bl > iso ? 8 : 0);
      if (c === 0 || c === 15) continue;
      let segs = SEG[c];
      if (c === 5 || c === 10) {
        const center = (tl + tr + br + bl) / 4 > iso;
        if (c === 5) segs = center ? [[1, 0], [3, 2]] : [[3, 0], [1, 2]];
        else segs = center ? [[0, 3], [2, 1]] : [[0, 1], [2, 3]];
      }
      for (const [a, b] of segs) {
        const from = edgeId(cx, cy, a);
        next[from] = edgeId(cx, cy, b);
        starts.push(from);
      }
    }
  const point = (id: number): Pt => {
    const horiz = id % 2 === 0;
    const base = id >> 1, x = base % W, y = (base - x) / W;
    const a = v[base], b = horiz ? v[base + 1] : v[base + W];
    const t = a === b ? 0.5 : (iso - a) / (b - a);
    const px = horiz ? x + t : x, py = horiz ? y : y + t;
    // 取樣點在像素中心 → 轉回影像座標並夾在影像範圍內
    return [Math.min(w, Math.max(0, px - P + 0.5 + x0)), Math.min(h, Math.max(0, py - P + 0.5 + y0))];
  };
  const rings: Ring[] = [];
  for (const start of starts) {
    if (next[start] < 0) continue;
    const ring: Ring = [];
    let cur = start;
    while (cur >= 0 && next[cur] >= 0) {
      const n = next[cur];
      next[cur] = -1;
      ring.push(point(cur));
      cur = n;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** 遮罩中非零像素的外框 [x0, y0, x1, y1)，全空回傳 null */
export function bbox(mask: Uint8Array, w: number, h: number): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++)
      if (mask[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

/** Douglas-Peucker 簡化（封閉環） */
export function simplify(ring: Ring, eps: number): Ring {
  if (ring.length < 4 || eps <= 0) return ring;
  // 以最遠兩點切開成兩段開放折線
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[far] = 1;
  const dp = (s: number, e: number) => {
    const stack: [number, number][] = [[s, e]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const A = ring[a % ring.length], B = ring[b % ring.length];
      const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1e-9;
      let mi = -1, md = eps;
      for (let i = a + 1; i < b; i++) {
        const p = ring[i % ring.length];
        const d = Math.abs(dy * p[0] - dx * p[1] + B[0] * A[1] - B[1] * A[0]) / len;
        if (d > md) { md = d; mi = i; }
      }
      if (mi >= 0) {
        keep[mi % ring.length] = 1;
        stack.push([a, mi], [mi, b]);
      }
    }
  };
  dp(0, far);
  dp(far, ring.length);
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

const fmt = (n: number) => {
  const s = n.toFixed(2);
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
};

/** 帶轉角標記的輪廓：corner[i] 為 true 的點是尖角，輸出時不平滑 */
export interface Contour {
  pts: Ring;
  corner: boolean[];
}

/** 沿輪廓以固定間距重新取樣 */
function resample(ring: Ring, step: number): Ring {
  const n = ring.length;
  const out: Ring = [];
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = carry;
    while (t < len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += step;
    }
    carry = t - len;
  }
  return out.length >= 3 ? out : ring;
}

/** 開放折線的 Douglas-Peucker，保留兩端點，回傳保留的索引 */
function dpOpen(pts: Ring, a: number, b: number, eps: number, keep: Uint8Array) {
  const n = pts.length;
  const stack: [number, number][] = [[a, b]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    if (e - s < 2) continue;
    const A = pts[s % n], B = pts[e % n];
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
    let mi = -1, md = eps;
    for (let i = s + 1; i < e; i++) {
      const P = pts[i % n];
      const d = len < 1e-9 ? Math.hypot(P[0] - A[0], P[1] - A[1]) : Math.abs(dy * P[0] - dx * P[1] + B[0] * A[1] - B[1] * A[0]) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (mi >= 0) {
      keep[mi % n] = 1;
      stack.push([s, mi], [mi, e]);
    }
  }
}

/**
 * 保留尖角的輪廓整理（自行實作，概念類似 Potrace，但不使用其程式碼）：
 * 1. 等距重新取樣；2. 依前後約 3px 的走向找出轉折大於 cornerDeg 的尖角；
 * 3. 只平滑尖角之間的曲線（尖角固定不動）；4. 分段 Douglas-Peucker 簡化。
 */
/** windowPx：判斷轉角時前後看多遠；原圖被放大時要跟著放大，否則像素階梯會被當成尖角 */
export function refineRing(ring: Ring, smoothPx: number, eps: number, cornerDeg = 55, windowPx = 3): Contour {
  const step = 0.7;
  const pts = resample(ring, step);
  const n = pts.length;
  const k = Math.max(2, Math.round(windowPx / step));
  const corner = new Array<boolean>(n).fill(false);
  if (n >= 2 * k + 3) {
    const turn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[(i - k + n) % n], b = pts[(i + k) % n];
      const ax = p[0] - a[0], ay = p[1] - a[1], bx = b[0] - p[0], by = b[1] - p[1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      turn[i] = la && lb ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) : 0;
    }
    const thr = (cornerDeg * Math.PI) / 180;
    // 局部極大值才算尖角（避免一個轉角被標成好幾個點）
    for (let i = 0; i < n; i++) {
      if (turn[i] < thr) continue;
      let isMax = true;
      for (let d = 1; d <= k && isMax; d++) if (turn[(i + d) % n] > turn[i] || turn[(i - d + n) % n] >= turn[i]) isMax = false;
      corner[i] = isMax;
    }
  }
  // 平滑：重複三點平均（約等於 sigma = sqrt(iter/2) 個取樣的高斯），尖角固定
  const iters = Math.round(2 * (smoothPx / step) ** 2);
  let xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = pts[i][0]; ys[i] = pts[i][1]; }
  let nx = new Float64Array(n), ny = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      if (corner[i]) { nx[i] = xs[i]; ny[i] = ys[i]; continue; }
      const a = i === 0 ? n - 1 : i - 1, b = i === n - 1 ? 0 : i + 1;
      nx[i] = (xs[a] + 2 * xs[i] + xs[b]) * 0.25;
      ny[i] = (ys[a] + 2 * ys[i] + ys[b]) * 0.25;
    }
    [xs, nx] = [nx, xs];
    [ys, ny] = [ny, ys];
  }
  const cur: Ring = new Array(n);
  for (let i = 0; i < n; i++) cur[i] = [xs[i], ys[i]];
  // 分段簡化：以尖角為分段點；沒有尖角時用最遠的兩點切成兩段
  const keep = new Uint8Array(n);
  const cs = corner.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (cs.length === 0) {
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) {
      const d = (cur[i][0] - cur[0][0]) ** 2 + (cur[i][1] - cur[0][1]) ** 2;
      if (d > fd) { fd = d; far = i; }
    }
    keep[0] = keep[far] = 1;
    dpOpen(cur, 0, far, eps, keep);
    dpOpen(cur, far, n, eps, keep);
  } else {
    for (const c of cs) keep[c] = 1;
    for (let j = 0; j < cs.length; j++) {
      const a = cs[j], b = j + 1 < cs.length ? cs[j + 1] : cs[0] + n;
      dpOpen(cur, a, b, eps, keep);
    }
  }
  const out: Contour = { pts: [], corner: [] };
  for (let i = 0; i < n; i++)
    if (keep[i]) {
      out.pts.push(cur[i]);
      out.corner.push(corner[i]);
    }
  return out;
}

/**
 * 輪廓 → SVG path。smooth=false 輸出折線；否則以 Catmull-Rom 轉三次貝茲（曲線通過每個點），
 * 尖角處切線不連續，保持尖銳。scale: 像素 → mm。回傳 [d, 節點數]
 */
export function ringsToPath(rings: (Ring | Contour)[], scale: number, smooth = true): [string, number] {
  const parts: string[] = [];
  let nodes = 0;
  for (const r of rings) {
    const c: Contour = Array.isArray(r) ? { pts: r, corner: r.map(() => false) } : r;
    const n = c.pts.length;
    if (n < 3) continue;
    const P = c.pts.map(([x, y]) => [x * scale, y * scale] as Pt);
    nodes += n;
    if (!smooth) {
      parts.push('M' + P.map((p) => fmt(p[0]) + ' ' + fmt(p[1])).join('L') + 'Z');
      continue;
    }
    const dir = (a: Pt, b: Pt): Pt => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    let s = 'M' + fmt(P[0][0]) + ' ' + fmt(P[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      const c1 = c.corner[i], c2 = c.corner[(i + 1) % n];
      if (c1 && c2) {
        s += 'L' + fmt(p2[0]) + ' ' + fmt(p2[1]);
        continue;
      }
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3;
      const d1 = c1 ? dir(p1, p2) : dir(p0, p2);
      const d2 = c2 ? dir(p1, p2) : dir(p1, p3);
      s += 'C' + fmt(p1[0] + d1[0] * len) + ' ' + fmt(p1[1] + d1[1] * len) + ' ' + fmt(p2[0] - d2[0] * len) + ' ' + fmt(p2[1] - d2[1] * len) + ' ' + fmt(p2[0]) + ' ' + fmt(p2[1]);
    }
    parts.push(s + 'Z');
  }
  return [parts.join(''), nodes];
}
