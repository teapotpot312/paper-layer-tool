import { useCallback, useRef, useState } from 'react';

const LIMIT = 50;
/** 連續操作（例如拖曳滑桿）在這段時間內合併成一步 */
const MERGE_MS = 600;

export function useHistory<D>(initial: D) {
  const [s, setS] = useState({ past: [] as D[], doc: initial, future: [] as D[] });
  const last = useRef(0);

  const set = useCallback((fn: (d: D) => D) => {
    const now = Date.now();
    const merge = now - last.current < MERGE_MS;
    last.current = now;
    setS((st) => {
      const nd = fn(st.doc);
      if (nd === st.doc) return st;
      const past = merge && st.past.length ? st.past : [...st.past, st.doc].slice(-LIMIT);
      return { past, doc: nd, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    last.current = 0;
    setS((st) => (st.past.length ? { past: st.past.slice(0, -1), doc: st.past[st.past.length - 1], future: [st.doc, ...st.future] } : st));
  }, []);

  const redo = useCallback(() => {
    last.current = 0;
    setS((st) => (st.future.length ? { past: [...st.past, st.doc], doc: st.future[0], future: st.future.slice(1) } : st));
  }, []);

  const reset = useCallback((d: D) => {
    last.current = 0;
    setS({ past: [], doc: d, future: [] });
  }, []);

  return { doc: s.doc, set, undo, redo, reset, canUndo: s.past.length > 0, canRedo: s.future.length > 0 };
}
