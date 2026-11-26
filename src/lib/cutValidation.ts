import type { CutCheck } from './types';

/** 小於這個尺寸（mm）的子路徑幾乎切不出來 */
const TINY_MM = 0.5;
/** 平滑曲線的控制點可能略超出作品範圍，這個範圍內視為正常 */
const BOUND_TOL = 1.5;

/**
 * 切割路徑的基本檢查（輸出的 path 字串，單位 mm）：
 * 每個子路徑都要封閉、座標有限、在作品範圍內、沒有重複的子路徑（會重複切割同一條邊）、沒有小到切不出來的碎屑。
 * 只做字串層級的檢查，不依賴 DOM，所以匯出後可以對最終 SVG 再檢查一次。
 */
export function checkCutPath(d: string, widthMm: number, heightMm: number): CutCheck {
  const subs = d.split('M').slice(1);
  let open = 0, outOfBounds = 0, duplicates = 0, tiny = 0, invalid = false;
  const seen = new Set<string>();
  for (const sub of subs) {
    if (!/Z\s*$/.test(sub)) open++;
    if (seen.has(sub)) duplicates++;
    seen.add(sub);
    const nums = (sub.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (nums.length < 6 || nums.length % 2 || nums.some((n) => !Number.isFinite(n))) { invalid = true; continue; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < nums.length; i += 2) {
      x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]);
      y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]);
    }
    if (x0 < -BOUND_TOL || y0 < -BOUND_TOL || x1 > widthMm + BOUND_TOL || y1 > heightMm + BOUND_TOL) outOfBounds++;
    if (x1 - x0 < TINY_MM && y1 - y0 < TINY_MM) tiny++;
  }
  const subpaths = subs.length;
  return { ok: subpaths > 0 && open === 0 && outOfBounds === 0 && duplicates === 0 && !invalid, subpaths, open, outOfBounds, duplicates, tiny, invalid };
}
