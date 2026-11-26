export type StackMode = 'additive' | 'independent';
export type BgMode = 'keep' | 'remove' | 'plate';
export type FixMode = 'off' | 'thicken' | 'remove';
export type SortMode = 'light' | 'area';
export type Quality = 'draft' | 'final';

export type Depth = 'flat' | 'slight' | 'strong';

/** 逐層覆寫：undefined = 跟隨全域設定 */
export interface LayerOpts {
  /** 額外外擴 (mm)，加在全域延伸量上 */
  extra?: number;
  /** 保留鏤空（true）或填滿小洞（false） */
  keepHoles?: boolean;
  /** 墊泡棉（true）或平貼（false） */
  foam?: boolean;
}

export interface Params {
  /** null = 自動建議 */
  k: number | null;
  merge: number;
  blur: number;
  bg: BgMode;
  widthMm: number;
  minAreaMm2: number;
  fillMm2: number;
  smooth: number;
  minWidthMm: number;
  fix: FixMode;
  mode: StackMode;
  extendMm: number;
  sort: SortMode;
  /** 圖層 id 由下到上；null = 依 sort 自動 */
  order: number[] | null;
  /** 立體感預設組合（全域） */
  depth: Depth;
  /** 全域：保留鏤空（不填補孔洞） */
  keepHoles: boolean;
  /** 全域：匯出泡棉墊片 */
  foamOut: boolean;
  /** 泡棉墊片內縮量 (mm) */
  foamInsetMm: number;
  layerOpts: Record<number, LayerOpts>;
  /** 使用者指定的合併：來源圖層 id → 目標圖層 id */
  merges: Record<number, number>;
  /** 使用者刪除的圖層：圖層 id → 由哪一層補上（-1 = 直接移除） */
  deleted: Record<number, number>;
}

export const defaultParams: Params = {
  k: null,
  merge: 4,
  blur: 0,
  bg: 'keep',
  widthMm: 150,
  minAreaMm2: 1.5,
  fillMm2: 0.5,
  smooth: 4,
  minWidthMm: 1.5,
  fix: 'off',
  mode: 'additive',
  extendMm: 0.5,
  sort: 'area',
  order: null,
  depth: 'flat',
  keepHoles: false,
  foamOut: true,
  foamInsetMm: 1,
  layerOpts: {},
  merges: {},
  deleted: {},
};

export interface LayerResult {
  id: number;
  hex: string;
  /** 該層紙張面積 mm² */
  areaMm2: number;
  objects: number;
  /** SVG path，單位 mm，作品座標（原點在作品左上） */
  d: string;
  nodes: number;
  thinD: string;
  thinCount: number;
  /** 最終是否墊泡棉（全域設定 + 逐層覆寫） */
  foam: boolean;
  /** 只依全域設定時是否墊泡棉（介面判斷「已覆寫」用） */
  foamAuto: boolean;
  /** 泡棉墊片輪廓（墊泡棉且開啟墊片輸出時才有） */
  foamD: string;
  isBg: boolean;
  /** 被使用者合併進這一層的其他圖層 id */
  merged: number[];
}

export interface PipelineResult {
  seq: number;
  quality: Quality;
  quantKey: string;
  effectiveK: number;
  layers: LayerResult[];
  order: number[];
  widthMm: number;
  heightMm: number;
  pxPerMm: number;
  warnings: string[];
  ms: number;
  timings?: Record<string, number>;
}

export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 製作模式：選定後不可更換（要換只能關閉專案重來） */
export type AppMode = 'multi' | 'cut';
export type CutMethod = 'outline' | 'stencil';

/**
 * 使用者在畫布上點選區域後的強制設定。座標以作品寬度正規化（x / 寬度、y / 寬度），
 * 所以改變尺寸、解析度或平滑度後仍能對回同一個區域。
 */
export interface RegionOverride {
  u: number;
  v: number;
  state: 'keep' | 'cut';
}

/** 單色切割模式的設定 */
export interface CutParams {
  method: CutMethod;
  /** 明暗門檻 0–255：比它暗的像素視為保留的紙 */
  threshold: number;
  /** 作品寬度 (mm) */
  widthMm: number;
  /** 細節平滑 0–3（中值濾波次數）：越高越能去掉雜點與紋理，但也會抹掉細節 */
  blur: number;
  /** 邊緣平滑度 0–10 */
  smooth: number;
  /** 小於此面積的碎片會被移除 (mm²) */
  minAreaMm2: number;
  /** 小於此面積的小洞會被填起來 (mm²)；外輪廓模式一律填滿 */
  fillMm2: number;
  /** 最小可切割寬度 (mm) */
  minWidthMm: number;
  /** 自動為內部的獨立紙片加連接橋，避免掉落 */
  autoBridge: boolean;
  /** 連接橋寬度 (mm) */
  bridgeMm: number;
  /** 使用者點選區域後的保留 / 挖空設定 */
  regions: RegionOverride[];
}

export const BRIDGE_WIDTHS = [1, 1.5, 2, 3] as const;

export const defaultCut: CutParams = { method: 'stencil', threshold: 128, widthMm: 150, blur: 0, smooth: 4, minAreaMm2: 1.5, fillMm2: 0.5, minWidthMm: 1.5, autoBridge: true, bridgeMm: 1.5, regions: [] };

/** 單色切割的處理結果 */
export interface CutResult {
  seq: number;
  quality: Quality;
  /** 切割路徑（mm，複合路徑，孔洞以 evenodd 表示） */
  d: string;
  nodes: number;
  widthMm: number;
  heightMm: number;
  pxPerMm: number;
  areaMm2: number;
  /** 獨立的紙片數（連通的保留區域） */
  pieces: number;
  /** 內部挖空的洞數 */
  holes: number;
  thinD: string;
  thinCount: number;
  /** 位於挖空區域內、與主體分離的紙片數（會掉落的零件，連橋前） */
  islands: number;
  /** 這些獨立紙片的輪廓（mm） */
  islandD: string;
  /** 自動加上的連接橋 */
  bridges: CutBridge[];
  /** 自動橋接後仍無法連上的內部紙片數（或關閉自動橋接時的內部紙片數） */
  unresolved: number;
  /** 找不到對應區域、未套用的使用者設定數 */
  unmapped: number;
  /** 切割風險代碼 */
  risks: CutRisk[];
  check: CutCheck;
  ms: number;
}

/** 切割路徑的基本檢查結果 */
export interface CutCheck {
  ok: boolean;
  subpaths: number;
  /** 沒有封閉的子路徑數 */
  open: number;
  /** 超出作品範圍的子路徑數 */
  outOfBounds: number;
  /** 完全重複的子路徑數（會重複切割同一條邊） */
  duplicates: number;
  /** 小到幾乎切不出來的子路徑數 */
  tiny: number;
  /** 座標含 NaN / Infinity */
  invalid: boolean;
}

/** 一座連接橋（mm）：從內部紙片到主體的線段與寬度 */
export interface CutBridge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  widthMm: number;
  lengthMm: number;
}

export type CutRisk = 'islandsOpen' | 'bridgeLong' | 'bridgeThin' | 'unresolved' | 'unmapped';

/** 選取的一個區域 */
export interface RegionInfo {
  /** 區域在該種類裡的編號（只在同一組處理參數下有效，用來判斷是不是同一個區域） */
  id: number;
  /** 區域內的一個位置（正規化座標，保留 / 挖空設定會存成 RegionOverride） */
  u: number;
  v: number;
  /** paper = 保留的紙片；hole = 內部挖空 */
  kind: 'paper' | 'hole';
  /** 自動判斷的結果：保留或挖空 */
  auto: 'kept' | 'cut';
  /** 目前實際結果（套用使用者設定後） */
  state: 'kept' | 'cut';
  forced: boolean;
  /** 是內部、與主體分離的紙片 */
  island: boolean;
  areaMm2: number;
  /** 目前作用在這個區域上的使用者設定（RegionOverride 在 regions 陣列的索引） */
  overrideIdx: number[];
}

/** 點選或框選後的結果：一個或多個區域，加上整體的輪廓（mm，用來在畫布上標示） */
export interface RegionSelection {
  items: RegionInfo[];
  d: string;
}

/** 選取查詢：點選（points）、框選（rect，正規化座標）；additive 時在 include 已選的區域上加選 / 取消 */
export interface RegionQuery {
  points?: { u: number; v: number }[];
  rect?: { u0: number; v0: number; u1: number; v1: number };
  additive?: boolean;
  include?: { u: number; v: number }[];
}
