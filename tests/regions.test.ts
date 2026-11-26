import { describe, expect, it } from 'vitest';
import { defaultCut, type CutParams, type RGBAImage, type RegionQuery } from '../src/lib/types';
import { queryRegions, runCut } from '../src/worker/cutPipeline';
import { applyOverrides, bridgeIslands, innerIslands, labelRegions } from '../src/worker/regions';

function draw(fn: (x: number, y: number) => boolean): RGBAImage {
  const w = 200, h = 200, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, v = fn(x, y) ? 20 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}
const d = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy);
/** 大圓片，中間挖一個洞，洞裡有一顆獨立的圓（像眼珠／字母 O 的內側） */
const eye = (x: number, y: number) => (d(x, y, 100, 100) < 85 && d(x, y, 100, 100) > 28) || d(x, y, 100, 100) < 15;
const base: CutParams = { ...defaultCut, widthMm: 100, minAreaMm2: 1, smooth: 2 };
const run = (img: RGBAImage, p: Partial<CutParams> = {}) => runCut(img, { ...base, ...p }, 'final', 200);

describe('islands and auto bridge', () => {
  it('detects a piece floating inside a cut-out', () => {
    const r = run(draw(eye), { autoBridge: false });
    expect(r.islands).toBe(1);
    expect(r.unresolved).toBe(1);
    expect(r.pieces).toBe(2);
    expect(r.risks).toContain('islandsOpen');
    expect(r.islandD).not.toBe('');
  });

  it('bridges it back to the body with one bridge of the chosen width', () => {
    const r = run(draw(eye), { autoBridge: true, bridgeMm: 2 });
    expect(r.islands).toBe(1);
    expect(r.bridges).toHaveLength(1);
    expect(r.bridges[0].widthMm).toBe(2);
    expect(r.unresolved).toBe(0);
    expect(r.pieces).toBe(1);
    expect(r.check.ok).toBe(true);
    expect(r.risks).toEqual([]);
  });

  it('does not bridge pieces that are free (outside any cut-out) or already connected', () => {
    const two = run(draw((x, y) => d(x, y, 50, 100) < 30 || d(x, y, 150, 100) < 30));
    expect(two.islands).toBe(0);
    expect(two.bridges).toHaveLength(0);
    expect(two.pieces).toBe(2);
    // 洞中的圓用一條細桿接到外圈：本來就連通，不該再建橋
    const joined = run(draw((x, y) => eye(x, y) || (y > 98 && y < 102 && x > 100 && x < 150)));
    expect(joined.islands).toBe(0);
    expect(joined.bridges).toHaveLength(0);
  });

  it('flags long and too-thin bridges as risks', () => {
    const far = (x: number, y: number) => (d(x, y, 100, 100) < 95 && d(x, y, 100, 100) > 75) || d(x, y, 100, 100) < 20;
    const long = run(draw(far), { bridgeMm: 1, minWidthMm: 1.5 });
    expect(long.risks).toContain('bridgeLong');
    expect(long.risks).toContain('bridgeThin');
  });

  it('bridges nested islands in one run', () => {
    const nested = (x: number, y: number) => {
      const r = d(x, y, 100, 100);
      return (r < 90 && r > 70) || (r < 50 && r > 35) || r < 15;
    };
    const r = run(draw(nested));
    expect(r.islands).toBe(2);
    expect(r.unresolved).toBe(0);
    expect(r.pieces).toBe(1);
  });

  it('labels outer background and holes correctly', () => {
    const w = 60, h = 60, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (d(x, y, 30, 30) < 25 && d(x, y, 30, 30) > 12) || d(x, y, 30, 30) < 5 ? 1 : 0;
    const L = labelRegions(m, w, h);
    expect(innerIslands(L)).toHaveLength(1);
    const out = bridgeIslands(m, w, h, 2, 1.5);
    expect(out.unresolved).toBe(0);
    expect(innerIslands(labelRegions(out.mask, w, h))).toHaveLength(0);
  });
});

describe('manual keep / cut overrides', () => {
  const img = draw(eye);
  const eyeAt = { u: 0.5, v: 0.5 };
  const holeAt = { u: 0.5, v: 0.39 }; // 洞的區域（距中心 22px，介於內圓與環之間）

  it('cuts a clicked paper piece out', () => {
    const r = run(img, { regions: [{ ...eyeAt, state: 'cut' }], autoBridge: false });
    expect(r.islands).toBe(0);
    expect(r.pieces).toBe(1);
    expect(r.holes).toBe(1);
  });

  it('keeps a clicked hole by filling it', () => {
    const r = run(img, { regions: [{ ...holeAt, state: 'keep' }] });
    expect(r.holes).toBe(0);
    expect(r.bridges).toHaveLength(0);
  });

  it('survives changes to smoothness and detail without being reset', () => {
    const regions = [{ ...holeAt, state: 'keep' as const }];
    for (const smooth of [0, 5, 9]) expect(run(img, { regions, smooth }).holes).toBe(0);
    expect(run(img, { regions, blur: 2 }).holes).toBe(0);
  });

  it('reports a setting that cannot be mapped instead of applying it', () => {
    const outside = run(img, { regions: [{ u: 0.02, v: 0.02, state: 'keep' }] });
    expect(outside.unmapped).toBe(1);
    expect(outside.risks).toContain('unmapped');
    expect(outside.holes).toBe(1); // 沒有套用錯誤的狀態
    const off = run(img, { regions: [{ u: 1.5, v: 0.5, state: 'cut' }] });
    expect(off.unmapped).toBe(1);
  });

  it('the last setting wins when several hit the same region', () => {
    const L = labelRegions(Uint8Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 1 : 0)), 10, 10);
    const out = applyOverrides(new Uint8Array(100).map((_, i) => (i % 10 < 5 ? 1 : 0)), L, [
      { u: 0.1, v: 0.1, state: 'cut' },
      { u: 0.2, v: 0.2, state: 'keep' },
    ]);
    expect(out.mask.reduce((s, v) => s + v, 0)).toBe(50);
  });
});

describe('region selection (click and box)', () => {
  const img = draw(eye);
  const pt = (u: number, v: number, extra: Partial<RegionQuery> = {}, cut = base) => queryRegions(img, cut, 'final', { points: [{ u, v }], ...extra });

  it('describes an inner island and its state', () => {
    const sel = pt(0.5, 0.5);
    expect(sel.items).toHaveLength(1);
    const info = sel.items[0];
    expect([info.kind, info.island, info.state, info.forced]).toEqual(['paper', true, 'kept', false]);
    expect(sel.d).not.toBe('');
  });

  it('describes holes, ignores the outside background and tracks forced state', () => {
    expect(pt(0.5, 0.39).items[0].kind).toBe('hole');
    expect(pt(0.02, 0.02).items).toHaveLength(0);
    expect(pt(2, 2).items).toHaveLength(0);
    const forced = pt(0.5, 0.5, {}, { ...base, regions: [{ u: 0.5, v: 0.5, state: 'cut' }] }).items[0];
    expect([forced.state, forced.forced, forced.overrideIdx]).toEqual(['cut', true, [0]]);
  });

  it('a box selects every region fully inside it (the island and the hole around it)', () => {
    const sel = queryRegions(img, base, 'final', { rect: { u0: 0.2, v0: 0.2, u1: 0.8, v1: 0.8 } });
    const kinds = sel.items.map((i) => i.kind).sort();
    expect(kinds).toEqual(['hole', 'paper']);
    expect(sel.items.find((i) => i.kind === 'paper')!.island).toBe(true);
  });

  it('a box that fully contains nothing falls back to the region at its center', () => {
    const sel = queryRegions(img, base, 'final', { rect: { u0: 0.47, v0: 0.47, u1: 0.53, v1: 0.53 } });
    expect(sel.items).toHaveLength(1);
    expect(sel.items[0].kind).toBe('paper');
  });

  it('additive click adds a region and clicking a selected one removes it', () => {
    const first = pt(0.5, 0.5);
    const include = first.items.map((i) => ({ u: i.u, v: i.v }));
    const both = pt(0.5, 0.39, { additive: true, include });
    expect(both.items).toHaveLength(2);
    const back = pt(0.5, 0.39, { additive: true, include: both.items.map((i) => ({ u: i.u, v: i.v })) });
    expect(back.items).toHaveLength(1);
    expect(back.items[0].kind).toBe('paper');
  });

  it('a selection made by box can be applied as overrides that stay mapped', () => {
    const sel = queryRegions(img, base, 'final', { rect: { u0: 0.2, v0: 0.2, u1: 0.8, v1: 0.8 } });
    const regions = sel.items.map((i) => ({ u: i.u, v: i.v, state: 'keep' as const }));
    const r = run(img, { regions, autoBridge: false });
    expect(r.unmapped).toBe(0);
    expect(r.holes).toBe(0); // 洞被保留（填滿），中間的紙片本來就保留
  });
});
