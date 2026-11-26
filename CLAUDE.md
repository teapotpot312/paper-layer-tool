# 紙雕分層工具 — 給 Claude 的交接說明

新對話請先讀這份，再視需要讀 `README.md`（使用說明、演算法、授權、查證、驗收）。
原始規格是 `paper-layer-tool-spec.md`（不公開、已列入 .gitignore，修訂內容已實作）。

## 工作方式（使用者的要求，務必遵守）

1. **說明截圖不要每次重做。** `docs/*.png` 只在發布重大版本前、使用者要求時才用 `scripts/shots.mjs` 重新產生。
2. **累積幾個修改再 commit 和推送。** 改完先告訴使用者，等使用者說「Commit」或「推送」才做（兩者可能分開要求，只做被要求的那一步）；不要每改一項就跑完整的打包、推送和確認部署流程。
3. **小改動不開瀏覽器截圖，只跑測試**（`npm test`）。只有版面或互動有明顯變化時才用瀏覽器預覽驗證，而且盡量用文字檢查（DOM 查詢），少截圖。
4. 只有使用者要求才 commit / push。commit 訊息用英文，結尾加 Co-Authored-By 行。
5. 介面預設英文、可切換繁體中文，中英文字串都要改（`src/i18n/zh-TW.ts`、`src/i18n/en.ts`）。回覆使用者用繁體中文。

## 專案概要

- 免費、純前端的網頁工具：把插畫依顏色分層，匯出 Cricut Design Space 可用的 SVG。不上傳、不連網、無 GPL 套件（不用 Potrace）。
- 線上版：https://teapotpot312.github.io/paper-layer-tool/（GitHub：`teapotpot312/paper-layer-tool`，推送到 `main` 後由 `.github/workflows/deploy.yml` 自動部署 GitHub Pages）。
- commit 作者 email 用 `teapotpot312@users.noreply.github.com`，不要用使用者的公司 email。
- 目前版本：最新 commit `e793a19`（已推送並部署，線上版與 `dist/index.html` 相同），工作目錄沒有未 commit 的修改。36 個測試全部通過。
- `docs/*.png` 截圖是 `ce21e8f` 時的舊介面（之後的介面整理、英文預設、匯出頁重排都還沒反映），下次發布重大版本前再用 `scripts/shots.mjs` 更新。

## 指令

- `npm run dev`：開發伺服器（瀏覽器預覽設定在 `C:\Users\molly_lee\Desktop\.claude\launch.json` 的 `paper-layer-tool`，port 5178；網址加 `#sample` 直接載入範例圖）
- `npm test`：vitest（`tests/pipeline.test.ts`、`tests/acceptance.test.ts`）
- `npm run build`：型別檢查 + 打包成單一檔案 `dist/index.html`（約 1.1 MB，雙擊可離線使用）

## 架構

- `src/worker/`：影像管線，在 Web Worker 中執行（內嵌 worker，`?worker&inline`）
  - `pipeline.ts`：主流程與快取（`memo`）。縮到 1200px 工作解析度 → 調色盤 → 分配顏色 → 清理 → 套用使用者合併（`applyMerges`）→ 排序 → 組層（累加 / 獨立）→ 過細偵測 → 描邊。也有 `pickFoam`（輕微 / 強烈立體自動挑墊泡棉的層）。
  - `quantize.ts`：CIE Lab K-means++、漸層合併、補抓小而獨特的顏色、線條色救回、邊緣混色判斷、雜邊清除。
  - `mask.ts`：多數決平滑、碎片併入（考慮色差）、EDT、膨脹 / 侵蝕、補洞、過細區域。
  - `trace.ts`：marching squares 描邊、轉角偵測（保留尖角）、平滑、Douglas-Peucker、輸出貝茲曲線。
- `src/lib/`：`types.ts`（參數與預設值 `defaultParams`）、`svg.ts`（SVG 輸出、對位記號、重複顏色微調 `distinctColors`）、`exporters.ts`（artwork.svg、每層 SVG / ZIP、泡棉墊片、Print Then Cut PNG、PDF 說明書）、`project.ts`（專案存檔、IndexedDB 自動暫存）。
- `src/app/`：React 介面。`App.tsx`（狀態、復原重做、與 worker 溝通）、`Sidebar.tsx`（左側面板）、`LayerPanel.tsx`（右側圖層面板：列表 ↔ 單層頁面、改色、排序、逐層覆寫、合併、刪除）、`CanvasView.tsx`（平面 / 分層 / 立體檢視）、`ExportDialog.tsx`、`StyleGuide.tsx`（四種樣式的示意圖視窗，內嵌 SVG）。

## 目前的介面與設計決定

- 左側工具列依必要性排序：**分色**、**樣式**、清理（選用）、對位（選用），**上傳固定放最後一個**（單色模式同樣：切割設定、上傳）。沒有編號徽章（使用者要求移除）。匯出只有右上角「匯出」按鈕。
- 「樣式」面板是四選一的作品樣式，一次決定疊法、泡棉、鏤空：平貼 / 輕微立體 / 強烈立體（皆為累加）/ 鏤空剪紙（獨立色塊 + 保留鏤空）。選中的卡片顯示墊泡棉層數；「ⓘ 樣式說明」開示意圖視窗。不要再加「這個樣式會…」之類的額外說明欄。
- 個別圖層可在右側面板覆寫外擴、鏤空、泡棉與預覽泡棉厚度，改過的標「已覆寫」並可還原為全域。
- 圖層面板：點一層進入該層頁面（返回鍵回列表），裡面有改色、刪除圖層（`deleted` 參數：區域由下一層補上，最底層 -1 直接移除）、逐層覆寫。底部沒有泡棉厚度滑桿（固定 3 mm，圖層頁可覆寫）；立體檢視有「俯視 / 側視」按鈕。
- 已有 ? 提示的說明不要再在外面顯示一次文字（保持畫面整潔）。
- 英文介面的品牌名稱是 **Craftlab.tw**（`appName`）；上傳畫面不再顯示隱私說明文字（`privacy` 字串已刪）。導覽（Tour）共四步：上傳 → 選製作目的 → 調整設定（多色 / 單色）→ 匯出。內部識別碼 `paper-layer-tool`（專案檔 `app` 欄位、IndexedDB 名稱）不能改，否則舊專案檔與暫存會讀不到。
- 預設語言英文；只有使用者切換時才記住（localStorage `uiLang`）。導覽只在第一次開啟時顯示。
- 合併圖層：勾選兩層以上，併入最下面那層（沿用其顏色與位置），可「拆開」。改層數 / 合併相近色 / 細節程度時，自訂排序、逐層設定、合併都會重設。
- 匯出視窗（多色）由上而下：切割檔二選一卡片（純切割 / 列印再切割）→ 收合的摘要與紙張清單（緊接卡片）→「操作步驟」三步（①②③）→「選擇匯出項目」勾選（純切割可複選：合併圖層（建議，預設勾）/ 逐層檔案 / 泡棉墊片，沒有泡棉時停用；列印再切割改為 Letter / A4 單選）與右側單一「Download」鈕 →「製作說明書」連結式按鈕。逐層檔案是逐檔下載，已拿掉 ZIP 按鈕（`exportCutZip` 還在 exporters 裡但介面不再使用）。沒有底部按鈕列，右上角 × 關閉。
- 自動排序預設「面積大→小」。對位記號預設關閉（L 型角）。立體檢視左右拖曳方向已修正為跟著滑鼠。
- 預設參數：合併相近色 4、邊緣平滑度 4、最小碎片 1.5 mm²、填補小洞 0.5 mm²、最小可切寬度 1.5 mm、寬度 15 cm。

## 單色切割擴充（進行中，需求文件：桌面 `Paper Layer Tool prompt.docx`）

- 流程是「先選製作目的、再上傳圖片」：第一個畫面（`.app.empty`、沒有圖片）是 `ModeSelect`（兩張同尺寸示意圖卡片，圖在 `src/assets/mode-multi.webp`、`mode-cut.webp`，已壓縮成 720×720 WebP（品質 0.8，約 74 KB）內嵌進單檔；顯示區是正方形 cover，所以事先裁成正方形；兩張圖的卡片佔畫面比例已對齊（量測：多層卡片約 94%×100%、單層約 81%×97%，單層的原圖卡片在畫面中本來較小，從原圖 1083×1452 的 (78,227) 起裁 920 見方）），選好後 `pickedMode` 暫存，顯示上傳區（有模式標籤與「返回」，這時還沒進工作區所以可以返回），載入圖片時 `openImage` 直接帶入該模式進工作區；圖片先到的情況（貼上、拖曳、範例圖 `#sample`、換圖）仍會顯示帶縮圖的 `ModeSelect` 讓使用者選。關閉專案回到第一個畫面。模式欄位 `Doc.mode`: `multi` | `cut`，`null` = 尚未選）。選定後 `hist.reset` 清掉復原紀錄，不可回到選擇畫面；只能「關閉專案」（頂部按鈕，有未存檔／未匯出修改時 `window.confirm`）。`dirty` = 目前 doc 不是 `cleanDoc`（存檔、開匯出視窗、選定模式時更新）。
- 專案檔 `version: 2`；舊檔沒有 `mode` 一律視為 `multi`（`parseProject`）。
- 單色引擎（Phase 3）：`worker/cutPipeline.ts`（`runCut`：單色化 → 去碎片 → 補洞 → 描邊 → 過細偵測；訊息 `cut` / `cutResult`，與多色管線的排隊互相獨立）、`lib/cutValidation.ts`（`checkCutPath`：封閉、重複、超出範圍、過小、非有限數）、`lib/cutExport.ts`（單一 `<path id="cut-shape" fill-rule="evenodd">`，mm 尺寸；`checkCutSvg` 對最終 SVG 字串再檢查一次，下載前不通過就擋下）。
- 單色模式 UI：`CutSidebar`（切割方式、寬度、明暗分界、收合的清理設定）、`CutView`（用 `CutResult.d` 畫 SVG：成品 / 切割線，過細處標紅）、`CutExportDialog`（切割前檢查摘要 + `cut.svg`）、`RegionPanel`（仍是空殼，Phase 4）。
- SVG 輸入一律先點陣化（`lib/image.ts`），不另外引入向量套件。
- 孤島與橋接（Phase 4）：`worker/regions.ts`。`labelRegions` 標記紙片與背景區域；`innerIslands` = 外側背景是「不接觸邊界的洞」的紙片（碰到影像邊界或自由放置的紙片不算，不橋接）；`bridgeIslands` 對每片內部紙片做 BFS 找到包住洞的紙的最短連線，再畫指定寬度的圓頭線段，逐輪重標區域（已連通的不會重複建橋，巢狀孤島一輪內都處理）。橋寬選項 `BRIDGE_WIDTHS` = 1 / 1.5 / 2 / 3 mm，預設 1.5，`autoBridge` 預設開。
- 區域修正：`CutParams.regions`（`RegionOverride`：座標以作品寬度正規化的 u、v + `keep`/`cut`）。套用時（`applyOverrides`）以「自動判斷後」的區域整塊翻轉，所以改平滑度、細節、尺寸都不會重設；外側背景不能 keep、座標超出範圍的設定不套用，回報 `unmapped` 與 `risk_unmapped`。`cutPipeline.prepare` 把單色化到補洞的結果快取（只改橋接或點選設定不重算）。畫布選取走 worker 訊息 `region` → `queryRegions`（點選 `points`、框選 `rect`、加選 `additive` + `include`；回傳 `RegionSelection`：多個 `RegionInfo` + 合併後的輪廓 `d`，外側背景不能被選）。框選只選「外框完全在框內」的區域，框裡沒有完整區域時改選中心點所在區域。右側面板標題是「調整輪廓區域」，只顯示用得到的保留／挖空按鈕，沒有還原按鈕（按相反動作即還原）。
- 切割風險代碼（`CutRisk`）：islandsOpen、unresolved、bridgeLong（> 8 mm）、bridgeThin（橋 < 最小可切寬度）、unmapped。橋接位置的手動調整第一版不做。
- 進度：Phase 1–5 已完成（未 commit，72 個測試通過，`npm run build` 約 1.17 MB）。README 已新增單色章節與驗收列。
- 待使用者實機驗收：`cut.svg` 匯入 Design Space 的行為；需求文件希望路徑可獨立指定畫線 / 摺痕 / 切割，但目前輸出是單一複合路徑（孔洞用 evenodd 在同一路徑），Design Space 若無法把孔洞與外輪廓分開操作，要再決定是否拆成多條獨立路徑。
- Phase 5 測試：`tests/cutAcceptance.test.ts`（剪影、字母孔、卡通臉、小洞、過細、PNG/JPG、SVG 輸出、1200px 效能）、`tests/regions.test.ts`、`tests/cut.test.ts`、`tests/project.test.ts`。瀏覽器已實測上傳 SVG / PNG / JPG、模式不可逆、關閉專案、專案存檔重開與舊版專案相容。
- 預覽伺服器設定要放在 `C:\Users\molly_lee\Desktop\.claude\launch.json`（已加入 `paper-layer-tool`，用 `--prefix` 指向專案資料夾）。

## 視覺設計系統（結構取自 Gamma，色彩取自 ProArt UE 2023 Light/Dark theme）

- 所有顏色、圓角、陰影、動態都在 `src/app/styles.css` 開頭的 design tokens（淺色 `:root`、深色 `prefers-color-scheme` 與 `[data-theme=dark]` 兩處要同步改）；元件只用變數，不直接寫色碼。色彩來源是 Figma「ProArt UE Committee」節點 42:967（淺色 `#EDEDED` 底、`#F6F6F6` 面板、金棕主色 `#E6C89B`（hover `#EFD5AF`、pressed `#CAB28F`、停用 `#D9D9D9`，按鈕上是深色字 `--on-primary`）、金棕文字 `#8F6132`、元件邊框 `#B6B6B6`；深色 `#111112` 底、`#23272F` 面板、`#333845` 抬升層、主色 `#CDAC83`（hover `#FADEBD`、pressed `#9A7A59`、停用 `#404552`）、文字 `#EBEBEB`、邊框 `#5B606C`、錯誤 `#FF4B4B`）。`--select` 是選取／焦點／勾選的外框與線條色（比主色填色深，淺色底上才看得到），填色的主要按鈕才用 `--primary`。示意圖用的金棕色階是 `--ic-1…4`。字型用 Segoe UI（設計稿字型）加系統字型堆疊。
- 結構（層級、圓角、陰影、互動狀態、動態）沿用先前參考 Gamma 的規則；色彩由 ProArt 設計稿取代，Gamma 藍已不再使用。設計稿的按鈕是膠囊形，本專案維持 12px 圓角，沒有改形狀。成功色（`--ok`）設計稿沒有，沿用原本的綠色。
- 按鈕：預設次要（表面底 + 邊框），主要用主色，頂部工具列與連結式按鈕是 ghost；選取狀態是主色邊框 + 1px 外框（不改變版面）。動態統一 `--t-fast` 160ms / `--t` 240ms、`--ease`，並尊重 `prefers-reduced-motion`。
- 陰影分四階 token：`--shadow-xs`（靜止的按鈕、卡片、圖層列）、`--shadow-sm`（懸停、浮起的小元件）、`--shadow-md`（懸停的大卡片、單色畫布）、`--shadow`（浮層：對話框、提示）；`--shadow-primary` 是主色按鈕的藍色光暈。套用規則集中在 styles.css 最後的「層次感」區塊；選取狀態 = 主色 1px 外框 + 暈影。頂部工具列與 ghost 按鈕不加陰影，手機版 `.top` 維持 sticky（不要在非媒體查詢的規則裡覆寫它的 position）。
- 精緻質感規則（styles.css 最後的「精緻質感」區塊）：線條——`--border` 是半透明髮絲線、表單元件用較實的 `--border-strong`，分隔線（`.exp-sec`、`.adv` 等）用 `border-image` 兩端淡出，頂部列下緣與 `.panel h2` / `.right > h2` 下有金色細線，卡片與按鈕上緣有 `--edge` 內緣高光；主要按鈕是金屬漸層（`--primary-grad`）並有滑過時的光掃（`::after`）；滑桿用 `--pct`（由 `Slider` 以 inline style 傳入）畫金色已填軌道。動效——緩動 `--ease` 是長尾緩出，時長 `--t-fast` 200ms / `--t` 360ms / `--t-slow` 560ms；進場動畫（`lux-in`、`lux-pop`、`lux-slide`、`lux-fade`）一律用 `backwards` fill-mode，不然會鎖住 transform、蓋掉 hover 位移；圖層列與模式卡片依序延遲出現。尊重 `prefers-reduced-motion`。頂部工具列的 ghost 按鈕不要加 box-shadow（用 `:not(.primary):not(.link):not(.back)` 的覆寫已處理）。
- 側欄版面（左側各面板、右側圖層／區域面板、圖層詳細頁）共用同一套垂直節奏：`.panel`、`.right`、`.sel-panel` 都是直向 flex，子元素間距一律 18px、子元素自己的 margin 全部歸零（styles.css「側欄版面」區塊）；群組之間放 `<div className="rule" role="separator" />`（上下各 18px）。新增側欄控制項時直接加進去、不要自己寫 margin。初始上傳畫面與選擇模式畫面（`.app.empty`、`.app.choosing`）不顯示右側欄（`LayerPanel` 只在多色工作區渲染），網格改成兩欄。
- 沒有改版的資料：預覽中的紙張、泡棉、過細紅色、橋接橘色等是語意色，刻意不跟著主題換。

## RWD（已完成）

- 三個版型：桌面（> 1100px，三欄）、平板（761–1100px，左側設定面板改成浮在畫布上、右側 240px）、手機（≤ 760px，畫布與縮放／檢視列固定在標題列下方 sticky，工具列、設定面板與圖層在下方捲動，調整時隨時看得到結果）。手機上還沒有圖片或正在選擇模式時，中央區域改成整頁高度（`.app.empty`、`.app.choosing`）。
- `(pointer: coarse)` 把按鈕、輸入框、切換開關、核取方塊放大到約 44px；≤ 480px 卡片改單欄；視窗高度 ≤ 520px 的橫向模式縮小固定列。對話框在手機上貼底、全寬。
- 單色預覽的 SVG 用 container query 單位（`cqw`/`cqh`）依容器大小等比縮放，`--ar`、`--zoom` 由 `CutView` 以 inline style 傳入。

## 已知限制 / 可能的後續

- 尚未在 Cricut Design Space 實機驗證 `artwork.svg` 的拆層行為，需使用者實測。
- 處理解析度 1200px：大圖上很細的葉脈會變細；調色盤上限 12 色。
- 大圖（約 1920px）精確結果約 5–6 秒。
