import { checkCutPath } from '../lib/cutValidation';
import type { CutParams, CutResult, CutRisk, Quality, RGBAImage, RegionInfo, RegionQuery, RegionSelection } from '../lib/types';
import { components, downscale, fillHoles, median3, thinRegions } from './mask';
import { applyOverrides, bridgeIslands, innerIslands, labelRegions, regionOf, type Labels } from './regions';
import { refineRing, ringArea, ringsToPath, simplify, traceMask } from './trace';

const RES: Record<Quality, number> = { draft: 480, final: 1200 };
/** 比這個長的連接橋可能明顯改變外觀，提示使用者確認 */
const LONG_BRIDGE_MM = 8;

/**
 * 單色化：有透明背景的圖直接用透明度，其餘依明暗分界（比分界暗的是保留的紙）。
 * 回傳 1 = 保留的紙、0 = 挖空 / 背景。
 */
export function monoMask(img: RGBAImage, threshold: number): Uint8Array {
  const { width: w, height: h, data } = img;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++;
  const useAlpha = clear > w * h * 0.02;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    m[i] = useAlpha || lum < threshold ? 1 : 0;
  }
  return m;
}

/** 移除面積小於 minPx 的保留碎片（4 連通） */
export function removeSpecks(mask: Uint8Array, w: number, h: number, minPx: number): Uint8Array {
  if (minPx <= 1) return mask.slice();
  const { comp, areas } = components(mask, w, h);
  const out = mask.slice();
  for (let i = 0; i < out.length; i++) if (out[i] && areas[comp[i]] < minPx) out[i] = 0;
  return out;
}

/** 內部挖空的洞數（不接觸邊界的背景區域） */
export function countHoles(mask: Uint8Array, w: number, h: number): number {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { comp, areas } = components(inv, w, h);
  const touch = new Uint8Array(areas.length);
  for (let x = 0; x < w; x++) { if (comp[x] >= 0) touch[comp[x]] = 1; if (comp[(h - 1) * w + x] >= 0) touch[comp[(h - 1) * w + x]] = 1; }
  for (let y = 0; y < h; y++) { if (comp[y * w] >= 0) touch[comp[y * w]] = 1; if (comp[y * w + w - 1] >= 0) touch[comp[y * w + w - 1]] = 1; }
  let n = 0;
  for (let i = 0; i < areas.length; i++) if (!touch[i]) n++;
  return n;
}

interface Prepared {
  mask: Uint8Array;
  w: number;
  h: number;
  pxPerMm: number;
  L: Labels;
}

let prepKey = '';
let prepBase: RGBAImage | null = null;
let prep: Prepared | null = null;

/**
 * 單色化到補洞為止（自動判斷的結果）。連接橋與使用者的保留 / 挖空設定都建立在這之上，
 * 所以只改橋接或點選設定時不用重算。
 */
function prepare(base: RGBAImage, cut: CutParams, quality: Quality): Prepared {
  const key = JSON.stringify([quality, cut.method, cut.threshold, cut.widthMm, cut.blur, cut.minAreaMm2, cut.fillMm2]);
  if (prep && prepBase === base && prepKey === key) return prep;
  const img = downscale(base, RES[quality]);
  const { width: w, height: h } = img;
  const pxPerMm = w / cut.widthMm;
  const pre = cut.blur > 0 ? median3(img, cut.blur) : img;
  let m = monoMask(pre, cut.threshold);
  m = removeSpecks(m, w, h, cut.minAreaMm2 * pxPerMm * pxPerMm);
  // 外輪廓：內部全部填滿；鏤空：只填太小切不出來的洞
  m = fillHoles(m, w, h, cut.method === 'outline' ? Infinity : cut.fillMm2 * pxPerMm * pxPerMm);
  prep = { mask: m, w, h, pxPerMm, L: labelRegions(m, w, h) };
  prepBase = base;
  prepKey = key;
  return prep;
}

/** 單色切割主流程：單色化 → 清理 → 使用者設定 → 橋接 → 描邊。跑在 Web Worker 裡 */
export function runCut(base: RGBAImage, cut: CutParams, quality: Quality, nativeMax: number, seq = 0): CutResult {
  const t0 = performance.now();
  const P = prepare(base, cut, quality);
  const { w, h, pxPerMm } = P;
  const ov = applyOverrides(P.mask, P.L, cut.regions ?? []);
  let m = ov.mask;

  // 孤島：位於挖空區域內、與主體分離的紙片
  const L = m === P.mask ? P.L : labelRegions(m, w, h);
  const isl = innerIslands(L);
  const islMask = new Uint8Array(w * h);
  if (isl.length) {
    const set = new Set(isl);
    for (let i = 0; i < islMask.length; i++) if (set.has(L.paper[i])) islMask[i] = 1;
  }
  let bridges: CutResult['bridges'] = [];
  let unresolved = isl.length;
  if (cut.autoBridge && isl.length) {
    const bo = bridgeIslands(m, w, h, pxPerMm, cut.bridgeMm);
    m = bo.mask;
    bridges = bo.bridges;
    unresolved = bo.unresolved;
  }

  let area = 0;
  for (let i = 0; i < m.length; i++) area += m[i];
  const mm = 1 / pxPerMm;

  // 輪廓參數與多色模式相同的算法（保留尖角、只平滑曲線）
  const resScale = quality === 'final' ? Math.min(1, w / 1200 + 0.2) : 0.5;
  const smoothPx = (0.3 + cut.smooth * 0.6) * Math.max(0.5, resScale);
  const eps = (0.2 + cut.smooth * 0.06) * Math.max(0.5, resScale);
  const cornerDeg = 50 + cut.smooth * 4;
  const cornerWin = 3 + cut.smooth * 0.4;
  const up = Math.max(1, Math.max(w, h) / nativeMax);
  const rings = traceMask(m, w, h, 0.5).filter((rg) => Math.abs(ringArea(rg)) > 2);
  const contours = rings.map((rg) => refineRing(rg, smoothPx * up, eps * Math.sqrt(up), cornerDeg, cornerWin * up));
  const [d, nodes] = ringsToPath(contours, mm, cut.smooth > 0);

  // 過細偵測（保留的紙寬度小於最小可切寬度）
  const r = (cut.minWidthMm / 2) * pxPerMm;
  const thin = thinRegions(m, w, h, r);
  const thinRings = traceMask(thin, w, h, 0.5).map((rg) => simplify(rg, 0.6)).filter((rg) => Math.abs(ringArea(rg)) > 1);
  const [thinD] = ringsToPath(thinRings, mm, false);
  const thinCount = components(thin, w, h).areas.length;

  const heightMm = h / pxPerMm;
  const islandD = outlinePath(islMask, w, h, mm);
  const risks: CutRisk[] = [];
  if (!cut.autoBridge && isl.length) risks.push('islandsOpen');
  if (cut.autoBridge && unresolved > 0) risks.push('unresolved');
  if (bridges.some((b) => b.lengthMm > LONG_BRIDGE_MM)) risks.push('bridgeLong');
  if (bridges.length && cut.bridgeMm < cut.minWidthMm) risks.push('bridgeThin');
  if (ov.unmapped > 0) risks.push('unmapped');
  return {
    seq,
    quality,
    d,
    nodes,
    widthMm: cut.widthMm,
    heightMm,
    pxPerMm,
    areaMm2: area * mm * mm,
    pieces: components(m, w, h).areas.length,
    holes: countHoles(m, w, h),
    thinD,
    thinCount,
    islands: isl.length,
    islandD,
    bridges,
    unresolved,
    unmapped: ov.unmapped,
    risks,
    check: checkCutPath(d, cut.widthMm, heightMm),
    ms: Math.round(performance.now() - t0),
  };
}

/** 遮罩的輪廓路徑（mm，折線），用來在畫布上標示區域 */
function outlinePath(mask: Uint8Array, w: number, h: number, mm: number): string {
  const rings = traceMask(mask, w, h, 0.5).map((rg) => simplify(rg, 0.6)).filter((rg) => Math.abs(ringArea(rg)) > 1);
  return ringsToPath(rings, mm, false)[0];
}

/**
 * 點選或框選：回傳選到的區域（保留的紙片與內部挖空的洞；外側背景不能被選）。
 * 框選 = 範圍完全落在框內的區域；框裡沒有完整的區域時，改選框中心所在的區域。
 * additive：在 include（先前已選的區域）上加選；點選已選的區域則取消選取。
 */
export function queryRegions(base: RGBAImage, cut: CutParams, quality: Quality, q: RegionQuery): RegionSelection {
  const P = prepare(base, cut, quality);
  const { w, h, pxPerMm, L } = P;
  const overrides = cut.regions ?? [];
  const keyOf = (r: { kind: 'paper' | 'hole'; id: number }) => (r.kind === 'paper' ? 'p' : 'b') + r.id;
  const anchors = new Map<string, { kind: 'paper' | 'hole'; id: number; u: number; v: number }>();
  const add = (u: number, v: number) => {
    const r = regionOf(L, u, v);
    if (!r || r.kind === 'outside') return null;
    const k = keyOf(r as { kind: 'paper' | 'hole'; id: number });
    return { key: k, r: r as { kind: 'paper' | 'hole'; id: number } };
  };
  if (q.additive) for (const p of q.include ?? []) { const x = add(p.u, p.v); if (x) anchors.set(x.key, { ...x.r, u: p.u, v: p.v }); }

  for (const p of q.points ?? []) {
    const x = add(p.u, p.v);
    if (!x) continue;
    if (q.additive && anchors.has(x.key)) anchors.delete(x.key);
    else anchors.set(x.key, { ...x.r, u: p.u, v: p.v });
  }

  if (q.rect) {
    const rx0 = Math.floor(Math.min(q.rect.u0, q.rect.u1) * w), rx1 = Math.ceil(Math.max(q.rect.u0, q.rect.u1) * w);
    const ry0 = Math.floor(Math.min(q.rect.v0, q.rect.v1) * w), ry1 = Math.ceil(Math.max(q.rect.v0, q.rect.v1) * w);
    // 每個區域的外框與第一個像素（當作區域內的代表位置）
    const nP = L.paperAreas.length, nB = L.bgAreas.length;
    const box = (n: number) => ({ x0: new Int32Array(n).fill(w), y0: new Int32Array(n).fill(h), x1: new Int32Array(n).fill(-1), y1: new Int32Array(n).fill(-1), first: new Int32Array(n).fill(-1) });
    const pb = box(nP), bb = box(nB);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, pc = L.paper[i];
        const [b, id] = pc >= 0 ? [pb, pc] : [bb, L.bg[i]];
        if (x < b.x0[id]) b.x0[id] = x;
        if (x > b.x1[id]) b.x1[id] = x;
        if (y < b.y0[id]) b.y0[id] = y;
        if (y > b.y1[id]) b.y1[id] = y;
        if (b.first[id] < 0) b.first[id] = i;
      }
    const inside = (b: ReturnType<typeof box>, id: number) => b.x0[id] >= rx0 && b.x1[id] <= rx1 && b.y0[id] >= ry0 && b.y1[id] <= ry1;
    const hit: { kind: 'paper' | 'hole'; id: number; u: number; v: number }[] = [];
    const anchor = (first: number) => ({ u: ((first % w) + 0.5) / w, v: (Math.floor(first / w) + 0.5) / w });
    for (let id = 0; id < nP; id++) if (inside(pb, id)) hit.push({ kind: 'paper', id, ...anchor(pb.first[id]) });
    for (let id = 0; id < nB; id++) if (!L.bgTouch[id] && inside(bb, id)) hit.push({ kind: 'hole', id, ...anchor(bb.first[id]) });
    if (!hit.length) {
      const cu = (q.rect.u0 + q.rect.u1) / 2, cv = (q.rect.v0 + q.rect.v1) / 2;
      const x = add(cu, cv);
      if (x) hit.push({ ...x.r, u: cu, v: cv });
    }
    for (const hh of hit) anchors.set(keyOf(hh), hh);
  }

  const items: RegionInfo[] = [];
  const selP = new Uint8Array(L.paperAreas.length), selB = new Uint8Array(L.bgAreas.length);
  const islands = new Set(innerIslands(L));
  for (const a of anchors.values()) {
    const sameRegion = (o: { u: number; v: number }) => {
      const r = regionOf(L, o.u, o.v);
      return !!r && (a.kind === 'paper' ? r.kind === 'paper' && r.id === a.id : r.kind !== 'paper' && r.id === a.id);
    };
    const overrideIdx = overrides.map((o, i) => (sameRegion(o) ? i : -1)).filter((i) => i >= 0);
    const auto = a.kind === 'paper' ? 'kept' : 'cut';
    const last = overrideIdx.length ? overrides[overrideIdx[overrideIdx.length - 1]] : null;
    const state = last ? (last.state === 'keep' ? 'kept' : 'cut') : auto;
    if (a.kind === 'paper') selP[a.id] = 1; else selB[a.id] = 1;
    items.push({
      id: a.id,
      u: a.u,
      v: a.v,
      kind: a.kind,
      auto,
      state,
      forced: state !== auto,
      island: a.kind === 'paper' && islands.has(a.id),
      areaMm2: (a.kind === 'paper' ? L.paperAreas[a.id] : L.bgAreas[a.id]) / (pxPerMm * pxPerMm),
      overrideIdx,
    });
  }
  // 所有選取區域合成一個遮罩，只描一次輪廓
  let d = '';
  if (items.length) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) if ((L.paper[i] >= 0 && selP[L.paper[i]]) || (L.bg[i] >= 0 && selB[L.bg[i]])) mask[i] = 1;
    d = outlinePath(mask, w, h, 1 / pxPerMm);
  }
  return { items, d };
}
