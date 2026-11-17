// 重新產生 docs/ 說明截圖（只在發布重大版本前執行）。
//
// 需要：先 npm run build；再開一個 headless Edge 並開啟除錯埠 9333，例如
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9333 --user-data-dir=<暫存資料夾> --no-first-run about:blank
// 執行：
//   node scripts/shots.mjs "file:///C:/Users/molly_lee/Desktop/paper-layer-tool/dist/index.html#sample" docs
// 介面若改了工具列順序或按鈕 class，下面的選擇器要跟著調整：
//   .tool 依序 = 上傳(0) 分色(1) 樣式(2) 清理(3) 對位(4)；樣式面板 .panel .card 依序 = 平貼 輕微立體 強烈立體 鏤空剪紙
import { writeFileSync } from 'node:fs';
const [,, base, outDir] = process.argv;
const page = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => (await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true })).result?.value;
const size = (w, h, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('saved', name); };
const waitDone = `for(let i=0;i<160;i++){ await new Promise(r=>setTimeout(r,250)); const t=document.querySelector('.ms')?.textContent||''; if(/^(完成|Done)/.test(t)) break; } document.querySelector('.bottom .zoom button:last-child')?.click(); await new Promise(r=>setTimeout(r,400));`;
await send('Page.enable');
await size(1440, 900);
await send('Page.navigate', { url: base });
await sleep(1500);
await ev(`localStorage.setItem('tourDone','1'); localStorage.setItem('theme','light'); localStorage.setItem('uiLang','zh-TW'); location.reload();`);
await sleep(1500);
await ev(waitDone);
await shot('01-flat-view-zh');
await ev(`[...document.querySelectorAll('.tool')][3].click(); await new Promise(r=>setTimeout(r,300));`);
await shot('02-clean-panel-thin-marks');
await ev(`[...document.querySelectorAll('.views .seg button')][1].click(); await new Promise(r=>setTimeout(r,500)); document.querySelector('.bottom .zoom button:last-child')?.click(); await new Promise(r=>setTimeout(r,300));`);
await shot('03-layers-view');
await ev(`[...document.querySelectorAll('.tool')][2].click(); await new Promise(r=>setTimeout(r,300)); [...document.querySelectorAll('.panel .card')][1].click(); await new Promise(r=>setTimeout(r,300)); ${waitDone} [...document.querySelectorAll('.tool')][2].click(); [...document.querySelectorAll('.views .seg button')][2].click(); await new Promise(r=>setTimeout(r,600));`);
await shot('04-3d-view');
await ev(`[...document.querySelectorAll('.views .seg button')][0].click(); [...document.querySelectorAll('.tool')][2].click(); await new Promise(r=>setTimeout(r,300)); [...document.querySelectorAll('.panel .card')][3].click(); await new Promise(r=>setTimeout(r,500)); ${waitDone}`);
await shot('05-independent-mode'); // 鏤空剪紙樣式（檔名沿用舊名）
await ev(`[...document.querySelectorAll('.panel .card')][0].click(); ${waitDone} document.querySelector('.btn.make').click(); await new Promise(r=>setTimeout(r,500));`);
await shot('06-export-dialog');
await ev(`document.querySelector('.modal header .icon-btn').click(); await new Promise(r=>setTimeout(r,200)); if(!document.querySelector('.chip.info')) [...document.querySelectorAll('.tool')][2].click(); await new Promise(r=>setTimeout(r,300)); document.querySelector('.chip.info').click(); await new Promise(r=>setTimeout(r,500));`);
await shot('09-style-guide');
await ev(`document.querySelector('.modal header .icon-btn').click(); document.querySelector('.btn.make').click(); await new Promise(r=>setTimeout(r,300));`);
await ev(`document.querySelector('.modal header .icon-btn').click(); localStorage.setItem('uiLang','en'); localStorage.setItem('theme','dark'); location.reload();`);
await sleep(1500);
await ev(waitDone);
await shot('07-english-dark');
await size(390, 844, true);
await ev(`location.reload();`);
await sleep(1500);
await ev(waitDone + ` localStorage.setItem('uiLang','zh-TW'); localStorage.setItem('theme','light');`);
await shot('08-mobile');
ws.close(); process.exit(0);
