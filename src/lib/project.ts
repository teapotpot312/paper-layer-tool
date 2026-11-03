import { defaultMarks, type MarkOptions } from './svg';
import { defaultParams, type Params } from './types';

export interface LayerMeta {
  name?: string;
  color?: string;
  hidden?: boolean;
}

export type Unit = 'cm' | 'in';

/** 可復原/重做、可存檔的文件狀態（不含圖片） */
export interface Doc {
  params: Params;
  meta: Record<number, LayerMeta>;
  marks: MarkOptions;
  unit: Unit;
}

export const defaultDoc: Doc = { params: defaultParams, meta: {}, marks: defaultMarks, unit: 'cm' };

export interface ProjectFile {
  app: 'paper-layer-tool';
  version: 1;
  doc: Doc;
  image: string;
}

export function toProject(doc: Doc, image: string): ProjectFile {
  return { app: 'paper-layer-tool', version: 1, doc, image };
}

export function parseProject(text: string): ProjectFile {
  const p = JSON.parse(text);
  if (p?.app !== 'paper-layer-tool' || typeof p.image !== 'string') throw new Error('bad project');
  return {
    ...p,
    doc: {
      ...defaultDoc,
      ...p.doc,
      params: { ...defaultParams, ...p.doc?.params },
      marks: { ...defaultMarks, ...p.doc?.marks },
    },
  };
}

// --- IndexedDB 自動暫存（不支援時安靜降級） ---
const DB = 'paper-layer-tool', STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function autosave(p: ProjectFile | null): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (p) tx.objectStore(STORE).put(p, 'autosave');
      else tx.objectStore(STORE).delete('autosave');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 無法暫存就略過 */
  }
}

export async function loadAutosave(): Promise<ProjectFile | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get('autosave');
      req.onsuccess = () => resolve((req.result as ProjectFile) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* 忽略 */ }
}
