/// <reference lib="webworker" />
import type { Params, Quality } from '../lib/types';
import { Pipeline } from './pipeline';

const pipe = new Pipeline();
let pending: { params: Params; quality: Quality; seq: number } | null = null;
let scheduled = false;

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
    pipe.setImage({ data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height });
  } else if (msg.type === 'run') {
    pending = { params: msg.params, quality: msg.quality, seq: msg.seq };
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  }
};
