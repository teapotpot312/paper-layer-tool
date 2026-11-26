/// <reference lib="webworker" />
import type { CutParams, Params, Quality, RGBAImage } from '../lib/types';
import { queryRegions, runCut } from './cutPipeline';
import { Pipeline } from './pipeline';

const pipe = new Pipeline();
let pending: { params: Params; quality: Quality; seq: number } | null = null;
let scheduled = false;

// 單色切割模式：獨立的排隊，與多色管線互不影響
let baseImg: RGBAImage | null = null;
let nativeMax = Infinity;
let pendingCut: { cut: CutParams; quality: Quality; seq: number } | null = null;
let cutScheduled = false;

function flushCut() {
  cutScheduled = false;
  const job = pendingCut;
  pendingCut = null;
  if (!job || !baseImg) return;
  try {
    postMessage({ type: 'cutResult', result: runCut(baseImg, job.cut, job.quality, nativeMax, job.seq) });
  } catch (e) {
    postMessage({ type: 'error', seq: job.seq, message: String((e as Error)?.message ?? e) });
  }
}

// 合併排隊中的請求：只算最新的一筆
function flush() {
  scheduled = false;
  const job = pending;
  pending = null;
  if (!job) return;
  try {
    const res = pipe.run(job.params, job.quality, job.seq);
    postMessage({ type: 'result', result: res });
  } catch (e) {
    postMessage({ type: 'error', seq: job.seq, message: String((e as Error)?.message ?? e) });
  }
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'image') {
    baseImg = { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height };
    nativeMax = msg.native ?? Infinity;
    pipe.setImage(baseImg, nativeMax);
  } else if (msg.type === 'region') {
    try {
      if (baseImg) postMessage({ type: 'region', seq: msg.seq, sel: queryRegions(baseImg, msg.cut, 'final', msg.query) });
    } catch (e) {
      postMessage({ type: 'error', seq: msg.seq, message: String((e as Error)?.message ?? e) });
    }
  } else if (msg.type === 'cut') {
    pendingCut = { cut: msg.cut, quality: msg.quality, seq: msg.seq };
    if (!cutScheduled) {
      cutScheduled = true;
      setTimeout(flushCut, 0);
    }
  } else if (msg.type === 'run') {
    pending = { params: msg.params, quality: msg.quality, seq: msg.seq };
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  }
};
