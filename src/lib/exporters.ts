import { strToU8, zipSync } from 'fflate';
import type { T } from '../i18n';
import { canvasSize, combinedSvg, foamSvg, layerSvg, markPaths, type MarkOptions } from './svg';
import type { LayerResult, StackMode } from './types';

export interface ExportLayer {
  layer: LayerResult;
  color: string;
  name: string;
  foam: boolean;
}

export const IN = 25.4;
/** 12×12 吋紙面積 */
export const SHEET_MM2 = 304.8 * 304.8;
/**
 * 切割墊可切範圍（吋）。官方未公開明確數值，社群普遍使用 11.5×11.5 / 11.5×23.5，
 * 介面會提醒以 Design Space 實際顯示為準。
 */
export const MAT12 = { w: 11.5, h: 11.5 };
export const MAT24 = { w: 11.5, h: 23.5 };
/**
 * Print Then Cut 最大尺寸（吋，寬×高），依 Cricut 官方說明
 * 「How large can I Print Then Cut?」（2025-03-19 版）。
 */
export const PTC_MAX = { letter: { w: 7.44, h: 9.94 }, a4: { w: 7.2, h: 10.62 } } as const;
export type PaperSize = keyof typeof PTC_MAX;

export function sheetsFor(l: LayerResult, widthMm: number, heightMm: number): number {
  const byArea = Math.ceil(l.areaMm2 / (SHEET_MM2 * 0.85));
  const byBox = Math.ceil(widthMm / (MAT12.w * IN)) * Math.ceil(heightMm / (MAT12.w * IN));
  return Math.max(1, byArea, l.areaMm2 > 0 ? byBox : 0);
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const fileHex = (hex: string) => hex.replace('#', '#').toUpperCase();

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function paperListText(layers: ExportLayer[], widthMm: number, heightMm: number, t: T): string {
  const rows = layers.map((l, i) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(l.color.slice(k, k + 2), 16));
    return `${i + 1}\t${l.name}\t${l.color}\tRGB(${r},${g},${b})\t${(l.layer.areaMm2 / 100).toFixed(1)} cm²\t${sheetsFor(l.layer, widthMm, heightMm)}${l.foam ? '\t' + t('foamTag') : ''}`;
  });
  return [`${t('paperList')} — ${(widthMm / 10).toFixed(1)} × ${(heightMm / 10).toFixed(1)} cm`, `${t('colOrder')}\tName\tHEX\tRGB\t${t('colArea')}\t${t('colSheets')}`, ...rows].join('\r\n');
}

/** 模式 A：每層一個 SVG + 合併 SVG + 泡棉墊片 + 紙張清單 → ZIP */
export function exportCutZip(layers: ExportLayer[], widthMm: number, heightMm: number, marks: MarkOptions, includeCombined: boolean, t: T) {
  const files: Record<string, Uint8Array> = {};
  layers.forEach((l, i) => {
    files[`layer-${pad2(i + 1)}-${fileHex(l.color)}.svg`] = strToU8(layerSvg(l.layer, widthMm, heightMm, marks, i + 1, layers.length, l.color));
    if (l.foam && l.layer.foamD) files[`foam-${pad2(i + 1)}.svg`] = strToU8(foamSvg(l.layer, widthMm, heightMm, marks));
  });
  if (includeCombined) files['all-layers.svg'] = strToU8(combinedSvg(layers.map((l) => ({ layer: l.layer, color: l.color })), widthMm, heightMm, marks));
  files['paper-list.txt'] = strToU8('﻿' + paperListText(layers, widthMm, heightMm, t));
  download(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), 'paper-layers.zip');
}

/** 把多層畫到 canvas（單位 mm → px） */
export function renderToCanvas(
  layers: ExportLayer[],
  widthMm: number,
  heightMm: number,
  pxPerMm: number,
  opts: { marks?: MarkOptions; pad?: number; shadow?: boolean; background?: string } = {},
): HTMLCanvasElement {
  const pad = opts.pad ?? 0;
  const { w, h, offset } = opts.marks ? canvasSize(widthMm, heightMm, opts.marks) : { w: widthMm, h: heightMm, offset: 0 };
  const c = document.createElement('canvas');
  c.width = Math.ceil((w + pad * 2) * pxPerMm);
  c.height = Math.ceil((h + pad * 2) * pxPerMm);
  const g = c.getContext('2d')!;
  if (opts.background) { g.fillStyle = opts.background; g.fillRect(0, 0, c.width, c.height); }
  g.scale(pxPerMm, pxPerMm);
  g.translate(pad + offset, pad + offset);
  for (const l of layers) {
    const p = new Path2D(l.layer.d);
    g.save();
    if (opts.shadow) {
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = 2.2 * pxPerMm;
      g.shadowOffsetX = 0.6 * pxPerMm;
      g.shadowOffsetY = 1.0 * pxPerMm;
    }
    g.fillStyle = l.color;
    g.fill(p, 'evenodd');
    g.restore();
  }
  return c;
}

const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), type, q));

/** Print Then Cut 可用尺寸（mm），超過上限時等比例縮小 */
export function ptcFit(widthMm: number, heightMm: number, paper: PaperSize) {
  const max = PTC_MAX[paper];
  const s = Math.min(1, (max.w * IN) / widthMm, (max.h * IN) / heightMm);
  return { scale: s, w: widthMm * s, h: heightMm * s };
}

/** 模式 B：Print Then Cut — 每層 PNG（300 DPI、透明背景、四周留白）與合成圖 */
export async function exportPtc(layers: ExportLayer[], widthMm: number, heightMm: number, paper: PaperSize) {
  const { scale } = ptcFit(widthMm, heightMm, paper);
  const dpi = 300, pxPerMm = (dpi / IN) * scale;
  // 留白 3 mm（以原尺寸計，縮放後等比例）
  const pad = 3;
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < layers.length; i++) {
    const c = renderToCanvas([layers[i]], widthMm, heightMm, pxPerMm, { pad });
    files[`print-layer-${pad2(i + 1)}-${fileHex(layers[i].color)}.png`] = new Uint8Array(await (await toBlob(c)).arrayBuffer());
  }
  const all = renderToCanvas(layers, widthMm, heightMm, pxPerMm, { pad });
  files['print-all-layers.png'] = new Uint8Array(await (await toBlob(all)).arrayBuffer());
  download(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), 'print-then-cut.zip');
}

/** 立體預覽圖 */
export function render3dPreview(layers: ExportLayer[], widthMm: number, heightMm: number): HTMLCanvasElement {
  const pxPerMm = Math.min(8, 1600 / Math.max(widthMm, heightMm));
  return renderToCanvas(layers, widthMm, heightMm, pxPerMm, { pad: 6, shadow: true, background: '#FFFFFF' });
}

export async function export3dPng(layers: ExportLayer[], widthMm: number, heightMm: number) {
  download(await toBlob(render3dPreview(layers, widthMm, heightMm)), 'preview-3d.png');
}

/**
 * 模式 C：PDF 製作說明書。文字以 canvas（系統字型）繪製後放入 PDF，
 * 避免 jsPDF 內建字型不支援中文，也不需載入外部字型。
 */
export async function exportPdf(layers: ExportLayer[], widthMm: number, heightMm: number, mode: StackMode, t: T) {
  const { jsPDF } = await import('jspdf');
  const W = 1240, H = 1754, s = W / 210; // A4 @150dpi
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px "Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif`;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#00a99d'; g.fillRect(0, 0, W, 14);
  g.fillStyle = '#111';
  g.font = font(54, true); g.fillText(t('pdfTitle'), 15 * s, 30 * s);
  g.font = font(26);
  g.fillStyle = '#444';
  g.fillText(`${t('pdfSize')}: ${(widthMm / 10).toFixed(1)} × ${(heightMm / 10).toFixed(1)} cm   ·   ${t('pdfMode')}: ${mode === 'additive' ? t('additive') : t('independent')}`, 15 * s, 40 * s);

  // 縮圖
  const prev = render3dPreview(layers, widthMm, heightMm);
  const boxW = 85 * s, boxH = 85 * s;
  const k = Math.min(boxW / prev.width, boxH / prev.height);
  g.drawImage(prev, 15 * s, 48 * s, prev.width * k, prev.height * k);

  // 層疊順序小圖
  const cols = 3, cell = 30 * s;
  layers.forEach((l, i) => {
    const x = 108 * s + (i % cols) * (cell + 3 * s), y = 48 * s + Math.floor(i / cols) * (cell + 9 * s);
    if (y + cell > 160 * s) return;
    g.strokeStyle = '#ddd'; g.strokeRect(x, y, cell, cell);
    const one = renderToCanvas([l], widthMm, heightMm, Math.min(4, (cell * 0.9) / Math.max(widthMm, heightMm)));
    const kk = Math.min((cell * 0.9) / one.width, (cell * 0.9) / one.height);
    g.drawImage(one, x + (cell - one.width * kk) / 2, y + (cell - one.height * kk) / 2, one.width * kk, one.height * kk);
    g.fillStyle = '#333'; g.font = font(20);
    g.fillText(`${i + 1}. ${l.name}`, x, y + cell + 5 * s);
  });

  // 紙張清單
  let y = 175 * s;
  g.fillStyle = '#111'; g.font = font(32, true); g.fillText(t('paperList'), 15 * s, y);
  y += 10 * s;
  g.font = font(22, true); g.fillStyle = '#555';
  const cx = [15, 30, 90, 125, 160].map((v) => v * s);
  [t('colOrder'), t('colColor'), 'HEX', t('colArea'), t('colSheets')].forEach((h, i) => g.fillText(h, cx[i], y));
  g.font = font(22);
  for (const [i, l] of layers.entries()) {
    y += 9 * s;
    if (y > 250 * s) break;
    g.fillStyle = '#333';
    g.fillText(String(i + 1), cx[0], y);
    g.fillStyle = l.color; g.fillRect(cx[1], y - 5 * s, 6 * s, 6 * s);
    g.strokeStyle = '#999'; g.strokeRect(cx[1], y - 5 * s, 6 * s, 6 * s);
    g.fillStyle = '#333';
    g.fillText(l.name + (l.foam ? ` (${t('foamTag')})` : ''), cx[1] + 8 * s, y);
    g.fillText(l.color, cx[2], y);
    g.fillText(`${(l.layer.areaMm2 / 100).toFixed(1)} cm²`, cx[3], y);
    g.fillText(String(sheetsFor(l.layer, widthMm, heightMm)), cx[4], y);
  }
  // 步驟
  y = Math.max(y + 14 * s, 255 * s);
  g.fillStyle = '#111'; g.font = font(30, true); g.fillText(t('pdfSteps'), 15 * s, y);
  g.font = font(22); g.fillStyle = '#333';
  [t('pdfStep1'), t('pdfStep2'), t('pdfStep3'), t('pdfStep4')].forEach((st, i) => g.fillText(`${i + 1}. ${st}`, 15 * s, y + (i + 1) * 8 * s));

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  download(pdf.output('blob'), 'paper-layers-guide.pdf');
}

export function downloadText(text: string, name: string, type = 'application/json') {
  download(new Blob([text], { type }), name);
}

export { markPaths };
