import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawSample } from '../assets/sample';
import { I18nContext, makeT, type Lang } from '../i18n';
import { downloadText, IN, MAT12, MAT24, type ExportLayer } from '../lib/exporters';
import { HUGE, loadFromCanvas, loadFromFile, loadFromUrl, type LoadedImage } from '../lib/image';
import { autosave, defaultDoc, loadAutosave, lsGet, lsSet, parseProject, toProject, type Doc, type LayerMeta, type ProjectFile } from '../lib/project';
import type { LayerOpts, Params, PipelineResult } from '../lib/types';
import PipelineWorker from '../worker/worker?worker&inline';
import { CanvasView, type CanvasHandle, type ViewLayer, type ViewMode } from './CanvasView';
import { IconButton, Segmented, Slider } from './controls';
import { ExportDialog } from './ExportDialog';
import { Icon } from './Icon';
import { LayerPanel } from './LayerPanel';
import { Sidebar, type PanelId } from './Sidebar';
import { Tour } from './Tour';
import { useHistory } from './useHistory';

/** 這些參數改變時調色盤會重算，圖層身分隨之改變，需重設圖層設定 */
const QUANT_KEYS: (keyof Params)[] = ['k', 'merge', 'blur'];

export function App() {
  const [lang, setLang] = useState<Lang>(() => (lsGet('lang') === 'en' ? 'en' : 'zh-TW'));
  const t = useMemo(() => makeT(lang), [lang]);
  const [theme, setTheme] = useState<string>(() => lsGet('theme') ?? 'auto');
  const hist = useHistory<Doc>(defaultDoc);
  const doc = hist.doc;
  const setDoc = hist.set;

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(() => (window.innerWidth > 760 ? 'layers' : null));
  const [view, setView] = useState<ViewMode>('flat');
  const [selected, setSelected] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showThin, setShowThin] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [gap, setGap] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [tour, setTour] = useState(() => lsGet('tourDone') !== '1');
  const [restore, setRestore] = useState<ProjectFile | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const canvasRef = useRef<CanvasHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const seq = useRef(0);
  const applied = useRef(-1);

  useEffect(() => { lsSet('lang', lang); document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'; }, [lang]);
  useEffect(() => {
    lsSet('theme', theme);
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Web Worker
  useEffect(() => {
    const w = new PipelineWorker();
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'result') {
        const r = m.result as PipelineResult;
        if (import.meta.env.DEV) ((window as unknown as { __results: PipelineResult[] }).__results ??= []).push(r);
        if (r.seq > applied.current) {
          applied.current = r.seq;
          setResult(r);
          setError(null);
        }
        // 草稿結果先顯示，精確結果回來才算完成
        if (r.seq === seq.current && r.quality === 'final') setBusy(false);
      } else if (m.type === 'error') {
        setError(t('wWorker', { msg: m.message }));
        setBusy(false);
      }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!image) return;
    const buf = image.data.data.slice().buffer;
    workerRef.current?.postMessage({ type: 'image', buffer: buf, width: image.data.width, height: image.data.height, native: Math.max(image.origW, image.origH) }, [buf]);
  }, [image]);

  // 參數變動：先送低解析草稿（即時），停止操作後再送精確結果
  useEffect(() => {
    if (!image) return;
    const w = workerRef.current!;
    setBusy(true);
    w.postMessage({ type: 'run', params: doc.params, quality: 'draft', seq: ++seq.current });
    const tm = setTimeout(() => w.postMessage({ type: 'run', params: doc.params, quality: 'final', seq: ++seq.current }), 350);
    return () => clearTimeout(tm);
  }, [image, doc.params]);

  // 自動暫存
  useEffect(() => {
    if (!image) return;
    const tm = setTimeout(() => autosave(toProject(doc, image.url)), 1500);
    return () => clearTimeout(tm);
  }, [doc, image]);

  useEffect(() => {
    // index.html#sample 直接開啟範例圖（展示與自動化測試用）
    if (location.hash === '#sample') {
      setTour(false);
      openImage(loadFromCanvas(drawSample()));
      return;
    }
    loadAutosave().then((p) => p && setRestore(p));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setParams = useCallback(
    (patch: Partial<Params>) => {
      setDoc((d) => {
        const quant = QUANT_KEYS.some((k) => k in patch && patch[k] !== d.params[k]);
        const params = { ...d.params, ...patch, ...(quant ? { order: null, layerOpts: {} } : {}) };
        return { ...d, params, meta: quant ? {} : d.meta };
      });
      if (QUANT_KEYS.some((k) => k in patch)) setSelected(null);
    },
    [setDoc],
  );

  const openImage = useCallback(
    (img: LoadedImage, nextDoc?: Doc) => {
      setImage(img);
      setResult(null);
      applied.current = seq.current;
      setSelected(null);
      setShowOriginal(false);
      hist.reset(nextDoc ?? { ...defaultDoc, unit: doc.unit, params: { ...defaultDoc.params, widthMm: doc.params.widthMm } });
      setError(Math.max(img.origW, img.origH) > HUGE ? t('wDown', { w: img.origW, h: img.origH }) : null);
    },
    [hist, doc.unit, doc.params.widthMm, t],
  );

  const loadFile = useCallback(
    async (f: Blob) => {
      try {
        if (f.type === 'application/json' || (f as File).name?.endsWith('.json')) {
          const p = parseProject(await f.text());
          openImage(await loadFromUrl(p.image), p.doc);
        } else openImage(await loadFromFile(f));
      } catch {
        setError(t('wLoad'));
      }
    },
    [openImage, t],
  );

  // 貼上剪貼簿圖片
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) loadFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  // 快捷鍵
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); hist.undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); hist.redo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
      else if (mod && e.key === '0') { e.preventDefault(); canvasRef.current?.fit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const viewLayers: ViewLayer[] = useMemo(() => {
    if (!result) return [];
    const byId = new Map(result.layers.map((l) => [l.id, l]));
    return result.order.map((id, i) => {
      const meta = doc.meta[id] ?? {};
      return { layer: byId.get(id)!, color: meta.color ?? byId.get(id)!.hex, name: meta.name ?? t('layerN', { n: i + 1 }), visible: !meta.hidden, foamMm: meta.foamMm };
    });
  }, [result, doc.meta, t]);

  const exportLayers: ExportLayer[] = viewLayers
    .filter((l) => l.visible && l.layer.d)
    .map((l) => ({ layer: l.layer, color: l.color, name: l.name, foam: l.layer.foam }));

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!result) return w;
    if (result.warnings.includes('photo')) w.push(t('wPhoto'));
    const a = Math.min(result.widthMm, result.heightMm) / IN, b = Math.max(result.widthMm, result.heightMm) / IN;
    const size = { w: (result.widthMm / 10).toFixed(1), h: (result.heightMm / 10).toFixed(1) };
    if (a > MAT24.w || b > MAT24.h) w.push(t('wTooBig24', size));
    else if (b > MAT12.h) w.push(t('wTooBig', size) + ' ' + t('matNote'));
    for (const l of viewLayers) if (l.layer.nodes > 8000) w.push(t('wNodes', { name: l.name, n: l.layer.nodes }));
    return w;
  }, [result, viewLayers, t]);

  const saveProject = () => {
    if (!image) return;
    downloadText(JSON.stringify(toProject(doc, image.url)), 'paper-layer-project.json');
    setToast(t('saved'));
    setTimeout(() => setToast(null), 1500);
  };

  const onMeta = (id: number, patch: LayerMeta) => setDoc((d) => ({ ...d, meta: { ...d.meta, [id]: { ...d.meta[id], ...patch } } }));
  const onOpts = (id: number, patch: LayerOpts) =>
    setParams({ layerOpts: { ...doc.params.layerOpts, [id]: { ...doc.params.layerOpts[id], ...patch } } });

  // 累加模式下同一處過細會出現在多層，以子路徑去重後計數
  const thinTotal = useMemo(() => new Set(result?.layers.flatMap((l) => l.thinD.split('M').filter(Boolean)) ?? []).size, [result]);

  return (
    <I18nContext.Provider value={t}>
      <div
        className={'app' + (image ? '' : ' empty') + (panel && image ? ' panel-open' : '')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={(e) => {
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) { e.preventDefault(); loadFile(f); }
        }}
      >
        <header className="top">
          <div className="brand">
            <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden><rect x="4" y="16" width="24" height="12" rx="3" fill="#007a6e" /><rect x="7" y="10" width="18" height="10" rx="3" fill="#00a99d" /><rect x="10" y="4" width="12" height="10" rx="3" fill="#80d8cf" /></svg>
            <span>{t('appName')}</span>
          </div>
          <div className="top-actions">
            <IconButton icon="undo" label={t('undo')} onClick={hist.undo} disabled={!hist.canUndo} />
            <IconButton icon="redo" label={t('redo')} onClick={hist.redo} disabled={!hist.canRedo} />
            <span className="sep" />
            <IconButton icon="open" label={t('open')} onClick={() => projRef.current?.click()} />
            <IconButton icon="save" label={t('save')} onClick={saveProject} disabled={!image} />
            <IconButton icon="globe" label={t('language')} onClick={() => setLang(lang === 'en' ? 'zh-TW' : 'en')} showLabel={false} />
            <IconButton icon="moon" label={t('theme')} onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')} showLabel={false} />
            <IconButton icon="help" label="?" onClick={() => setTour(true)} showLabel={false} />
          </div>
          <button type="button" className="btn primary make" disabled={!result} onClick={() => setExportOpen(true)}>
            <span>{t('makeIt')}</span>
            <Icon name="play" size={16} />
          </button>
        </header>

        <Sidebar
          panel={panel}
          setPanel={setPanel}
          doc={doc}
          setDoc={setDoc}
          setParams={setParams}
          result={result}
          showThin={showThin}
          setShowThin={setShowThin}
          onUpload={() => fileRef.current?.click()}
          onExport={() => setExportOpen(true)}
          hasImage={!!image}
          thinTotal={thinTotal}
        />

        <main className="center">
          {!image ? (
            <div className={'drop' + (dragOver ? ' over' : '')} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}>
              <Icon name="image" size={56} />
              <h1>{t('dropTitle')}</h1>
              <p>{t('dropHint')}</p>
              <button type="button" className="btn primary big" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                <Icon name="upload" />
                <span>{t('uploadFile')}</span>
              </button>
              <p className="note">{t('privacy')}</p>
            </div>
          ) : result ? (
            <CanvasView
              ref={canvasRef}
              layers={viewLayers}
              widthMm={result.widthMm}
              heightMm={result.heightMm}
              marks={doc.marks}
              view={view}
              selected={selected}
              onSelect={setSelected}
              showThin={showThin}
              original={showOriginal ? image.url : null}
              gapMm={gap}
              zoom={zoom}
              setZoom={setZoom}
            />
          ) : (
            <div className="loading"><div className="spinner" />{t('processing')}</div>
          )}
          {image && (
            <div className="status">
              {busy && <div className="progress"><span /></div>}
              {error && <p className="notice warn"><Icon name="warn" size={16} />{error}</p>}
              {warnings.map((w) => <p key={w} className="notice warn"><Icon name="warn" size={16} />{w}</p>)}
              {thinTotal > 0 && showThin && doc.params.fix === 'off' && (
                <p className="notice thin-note">
                  <Icon name="warn" size={16} />{t('thinFound', { n: thinTotal })}
                  <button type="button" className="chip" onClick={() => setParams({ fix: 'thicken' })}>{t('fixThicken')}</button>
                  <button type="button" className="chip" onClick={() => setShowThin(false)}>{t('fixOff')}</button>
                </p>
              )}
            </div>
          )}
        </main>

        <LayerPanel
          layers={viewLayers}
          selected={selected}
          onSelect={setSelected}
          onMeta={onMeta}
          onReorder={(order) => setParams({ order })}
          opts={doc.params.layerOpts}
          onOpts={onOpts}
          globalHoles={doc.params.keepHoles}
          foamMm={gap}
        />

        <footer className="bottom">
          <div className="zoom">
            <span className="lbl">{t('zoom')}</span>
            <IconButton icon="minus" label="-" onClick={() => canvasRef.current?.zoomBy(1 / 1.25)} showLabel={false} disabled={!result} />
            <span className="zoom-val">{Math.round(zoom * 100)}%</span>
            <IconButton icon="plus" label="+" onClick={() => canvasRef.current?.zoomBy(1.25)} showLabel={false} disabled={!result} />
            <IconButton icon="fit" label={t('fit')} onClick={() => canvasRef.current?.fit()} showLabel={false} disabled={!result} />
          </div>
          <div className="views">
            <span className="lbl">{t('view')}</span>
            <Segmented value={view} label={t('view')} options={[{ v: 'flat', label: t('vFlat') }, { v: 'layers', label: t('vLayers') }, { v: 'stack', label: t('vStack') }]} onChange={setView} />
            {view === 'flat' && (
              <button type="button" className={'chip' + (showOriginal ? ' on' : '')} onClick={() => setShowOriginal((v) => !v)} disabled={!image}>{t('original')}</button>
            )}
          </div>
          {view === 'stack' && (
            <div className="gap">
              <Slider label={t('gap')} help={t('dragRotate')} value={gap} min={0} max={10} step={0.5} unit="mm" onChange={setGap} />
            </div>
          )}
          <div className="ms">{result && !busy ? t('ready', { ms: result.ms }) : busy ? t('processing') : ''}</div>
        </footer>

        <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
        <input ref={projRef} type="file" hidden accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />

        {exportOpen && result && (
          <ExportDialog layers={exportLayers} widthMm={result.widthMm} heightMm={result.heightMm} marks={doc.marks} mode={doc.params.mode} warnings={warnings} thinTotal={thinTotal} onClose={() => setExportOpen(false)} />
        )}
        {tour && (
          <Tour
            onClose={(forever) => { setTour(false); if (forever) lsSet('tourDone', '1'); }}
            onSample={() => { setTour(false); lsSet('tourDone', '1'); openImage(loadFromCanvas(drawSample())); }}
            onUpload={() => { setTour(false); fileRef.current?.click(); }}
          />
        )}
        {restore && !image && !tour && (
          <div className="toast">
            <span>{t('restore')}</span>
            <button type="button" className="btn primary" onClick={async () => { const p = restore; setRestore(null); try { openImage(await loadFromUrl(p.image), parseProject(JSON.stringify(p)).doc); } catch { setError(t('loadFail')); } }}>{t('restoreYes')}</button>
            <button type="button" className="btn" onClick={() => { setRestore(null); autosave(null); }}>{t('restoreNo')}</button>
          </div>
        )}
        {toast && <div className="toast small">{toast}</div>}
      </div>
    </I18nContext.Provider>
  );
}
