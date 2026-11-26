import type { CutBridge, RegionOverride } from '../lib/types';
import { components } from './mask';

/** 單色遮罩的區域標記：保留的紙片與背景（挖空）各自的連通區域 */
export interface Labels {
  w: number;
  h: number;
  /** 每個像素所屬的紙片編號（-1 = 背景） */
  paper: Int32Array;
  paperAreas: number[];
  /** 每個像素所屬的背景區域編號（-1 = 紙） */
  bg: Int32Array;
  bgAreas: number[];
  /** 背景區域是否接觸影像邊界（接觸 = 外側背景；不接觸 = 內部挖空的洞） */
  bgTouch: Uint8Array;
  /**
   * 每片紙「外側」的背景區域編號：最上方那個像素上面的背景一定在這片紙的外面（洞只會在紙的範圍之內）。
   * -1 = 碰到影像邊界，視為自由的紙片
   */
  outer: Int32Array;
}

export function labelRegions(mask: Uint8Array, w: number, h: number): Labels {
  const { comp: paper, areas: paperAreas } = components(mask, w, h);
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { comp: bg, areas: bgAreas } = components(inv, w, h);

  const bgTouch = new Uint8Array(bgAreas.length);
  const paperTouch = new Uint8Array(paperAreas.length);
  const mark = (i: number) => {
    if (bg[i] >= 0) bgTouch[bg[i]] = 1;
    if (paper[i] >= 0) paperTouch[paper[i]] = 1;
  };
  for (let x = 0; x < w; x++) { mark(x); mark((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { mark(y * w); mark(y * w + w - 1); }

  const outer = new Int32Array(paperAreas.length).fill(-2);
  for (let i = 0; i < paper.length; i++) {
    const c = paper[i];
    if (c < 0 || outer[c] !== -2) continue;
    outer[c] = paperTouch[c] || i < w ? -1 : bg[i - w];
  }
  return { w, h, paper, paperAreas, bg, bgAreas, bgTouch, outer };
}

/** 內部紙片：位於挖空的洞裡、與主體分離的紙片（會掉落） */
export function innerIslands(L: Labels): number[] {
  const out: number[] = [];
  for (let c = 0; c < L.paperAreas.length; c++) if (L.outer[c] >= 0 && !L.bgTouch[L.outer[c]]) out.push(c);
  return out;
}

export interface BridgeOutcome {
  mask: Uint8Array;
  bridges: CutBridge[];
  /** 最後仍沒有接上的內部紙片數 */
  unresolved: number;
}

/**
 * 自動橋接：對每一片內部紙片，在它所在的洞裡找到最短路徑連到包住這個洞的紙，
 * 再沿著起點到終點畫一條指定寬度的連接橋。每一輪重新標記區域，已經連通的不會再建橋。
 */
export function bridgeIslands(mask: Uint8Array, w: number, h: number, pxPerMm: number, bridgeMm: number, maxPasses = 6): BridgeOutcome {
  const m = mask.slice();
  const bridges: CutBridge[] = [];
  const rPx = Math.max(0.5, (bridgeMm / 2) * pxPerMm);
  const stamp = new Int32Array(w * h);
  const origin = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let st = 0;
  let unresolved = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const L = labelRegions(m, w, h);
    const islands = innerIslands(L);
    unresolved = islands.length;
    if (!islands.length) break;
    const idx = new Map<number, number[]>(islands.map((c) => [c, []]));
    for (let i = 0; i < L.paper.length; i++) idx.get(L.paper[i])?.push(i);

    let progress = false;
    for (const c of islands) {
      const H = L.outer[c];
      st++;
      let qh = 0, qt = 0;
      for (const p of idx.get(c)!) {
        const x = p % w;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (q < 0 || q >= m.length || L.bg[q] !== H || stamp[q] === st) continue;
          stamp[q] = st; origin[q] = p; queue[qt++] = q;
        }
      }
      let a = -1, b = -1;
      while (qh < qt && a < 0) {
        const q = queue[qh++];
        const x = q % w;
        for (const n of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
          if (n < 0 || n >= m.length) continue;
          const pc = L.paper[n];
          // 碰到的紙如果自己的外側不是這個洞，就是包住這個洞的紙（同洞裡的其他內部紙片不算）
          if (pc >= 0 && pc !== c && L.outer[pc] !== H) { a = origin[q]; b = n; break; }
          if (L.bg[n] === H && stamp[n] !== st) { stamp[n] = st; origin[n] = origin[q]; queue[qt++] = n; }
        }
      }
      if (a < 0) continue;
      drawCapsule(m, w, h, a % w, (a - (a % w)) / w, b % w, (b - (b % w)) / w, rPx);
      const ax = (a % w) + 0.5, ay = Math.floor(a / w) + 0.5, bx = (b % w) + 0.5, by = Math.floor(b / w) + 0.5;
      bridges.push({ x1: ax / pxPerMm, y1: ay / pxPerMm, x2: bx / pxPerMm, y2: by / pxPerMm, widthMm: bridgeMm, lengthMm: Math.hypot(bx - ax, by - ay) / pxPerMm });
      progress = true;
    }
    if (!progress) break;
    if (pass === maxPasses - 1) unresolved = innerIslands(labelRegions(m, w, h)).length;
  }
  if (!bridges.length) return { mask: m, bridges, unresolved };
  // 最後一輪之後再數一次，確保 unresolved 反映最終結果
  unresolved = innerIslands(labelRegions(m, w, h)).length;
  return { mask: m, bridges, unresolved };
}

/** 在兩點之間畫一條半徑 r 的圓頭線段（把經過的像素設為紙） */
function drawCapsule(m: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, r: number) {
  const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - r - 1)), xe = Math.min(w - 1, Math.ceil(Math.max(x1, x2) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - r - 1)), ye = Math.min(h - 1, Math.ceil(Math.max(y1, y2) + r + 1));
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  for (let y = y0; y <= ye; y++)
    for (let x = x0; x <= xe; x++) {
      const t = len2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
      if ((x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2 <= r * r) m[y * w + x] = 1;
    }
}

/**
 * 套用使用者的保留 / 挖空設定。每個設定以正規化座標找到「自動判斷後」的區域再整塊翻轉：
 * - cut 落在紙上：整片紙挖空；keep 落在內部的洞：整個洞填滿
 * - 已經是想要的狀態就不動；keep 落在外側背景（會把整個背景填滿）或座標超出範圍：無法對應，回報 unmapped
 * 同一個區域有多個設定時，以最後一個為準。
 */
export function applyOverrides(mask: Uint8Array, L: Labels, overrides: RegionOverride[]): { mask: Uint8Array; unmapped: number } {
  const { w, h } = L;
  const clear = new Uint8Array(L.paperAreas.length);
  const fill = new Uint8Array(L.bgAreas.length);
  let unmapped = 0, any = false;
  for (const o of overrides) {
    const x = Math.floor(o.u * w), y = Math.floor(o.v * w);
    if (!(x >= 0 && x < w && y >= 0 && y < h)) { unmapped++; continue; }
    const i = y * w + x;
    if (L.paper[i] >= 0) {
      clear[L.paper[i]] = o.state === 'cut' ? 1 : 0;
      any = true;
    } else {
      const b = L.bg[i];
      if (o.state === 'keep' && L.bgTouch[b]) { unmapped++; continue; }
      fill[b] = o.state === 'keep' ? 1 : 0;
      any = true;
    }
  }
  if (!any) return { mask, unmapped };
  const out = mask.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i]) { if (clear[L.paper[i]]) out[i] = 0; }
    else if (fill[L.bg[i]]) out[i] = 1;
  }
  return { mask: out, unmapped };
}

/** 某個設定落在哪個區域：回傳區域種類與編號，找不到回傳 null */
export function regionOf(L: Labels, u: number, v: number): { kind: 'paper' | 'hole' | 'outside'; id: number } | null {
  const x = Math.floor(u * L.w), y = Math.floor(v * L.w);
  if (!(x >= 0 && x < L.w && y >= 0 && y < L.h)) return null;
  const i = y * L.w + x;
  if (L.paper[i] >= 0) return { kind: 'paper', id: L.paper[i] };
  return { kind: L.bgTouch[L.bg[i]] ? 'outside' : 'hole', id: L.bg[i] };
}
