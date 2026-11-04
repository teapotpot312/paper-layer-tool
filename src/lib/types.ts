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
