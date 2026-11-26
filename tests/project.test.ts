import { describe, expect, it } from 'vitest';
import { defaultDoc, parseProject, toProject } from '../src/lib/project';

describe('project mode compatibility', () => {
  it('treats a version 1 project without a mode as multi-color', () => {
    const old = JSON.stringify({ app: 'paper-layer-tool', version: 1, image: 'data:image/png;base64,AA', doc: { params: { k: 5 }, meta: {}, unit: 'cm' } });
    const p = parseProject(old);
    expect(p.doc.mode).toBe('multi');
    expect(p.doc.params.k).toBe(5);
    expect(p.doc.cut.method).toBe('stencil');
  });

  it('round-trips the chosen mode and cut settings', () => {
    const doc = { ...defaultDoc, mode: 'cut' as const, cut: { ...defaultDoc.cut, method: 'outline' as const, threshold: 90 } };
    const p = parseProject(JSON.stringify(toProject(doc, 'data:image/png;base64,AA')));
    expect(p.version).toBe(2);
    expect(p.doc.mode).toBe('cut');
    expect(p.doc.cut).toEqual({ ...defaultDoc.cut, method: 'outline', threshold: 90 });
  });

  it('keeps an unchosen mode as null and rejects unknown values', () => {
    const base = { app: 'paper-layer-tool', version: 2, image: 'x' };
    expect(parseProject(JSON.stringify({ ...base, doc: { mode: null } })).doc.mode).toBeNull();
    expect(parseProject(JSON.stringify({ ...base, doc: { mode: 'weird' } })).doc.mode).toBeNull();
  });
});
