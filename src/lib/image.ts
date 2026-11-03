export const WORK_MAX = 1200;
export const HUGE = 4000;

export interface LoadedImage {
  /** 處理用影像（長邊 ≤ 1200） */
  data: ImageData;
  /** 處理用影像的 PNG dataURL（存檔與原圖對照用） */
  url: string;
  origW: number;
  origH: number;
}

function fromSource(src: CanvasImageSource, w: number, h: number): LoadedImage {
  // 小圖放大、大圖縮小到長邊 1200px：細線有足夠像素，輸出輪廓更平滑
  const s = WORK_MAX / Math.max(w, h);
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, cw, ch);
  return { data: g.getImageData(0, 0, cw, ch), url: c.toDataURL('image/png'), origW: w, origH: h };
}

export function loadFromCanvas(c: HTMLCanvasElement): LoadedImage {
  return fromSource(c, c.width, c.height);
}

export function loadFromUrl(url: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // 沒有寬高的 SVG 給預設尺寸
      const w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
      try { resolve(fromSource(img, w, h)); } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('load'));
    img.src = url;
  });
}

export async function loadFromFile(file: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  try {
    return await loadFromUrl(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
