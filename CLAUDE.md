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

- 左側工具列依必要性排序：上傳、**分色**、**樣式**、清理（選用）、對位（選用）。沒有編號徽章（使用者要求移除）。匯出只有右上角「匯出」按鈕。
- 「樣式」面板是四選一的作品樣式，一次決定疊法、泡棉、鏤空：平貼 / 輕微立體 / 強烈立體（皆為累加）/ 鏤空剪紙（獨立色塊 + 保留鏤空）。選中的卡片顯示墊泡棉層數；「ⓘ 樣式說明」開示意圖視窗。不要再加「這個樣式會…」之類的額外說明欄。
- 個別圖層可在右側面板覆寫外擴、鏤空、泡棉與預覽泡棉厚度，改過的標「已覆寫」並可還原為全域。
- 圖層面板：點一層進入該層頁面（返回鍵回列表），裡面有改色、刪除圖層（`deleted` 參數：區域由下一層補上，最底層 -1 直接移除）、逐層覆寫。底部沒有泡棉厚度滑桿（固定 3 mm，圖層頁可覆寫）；立體檢視有「俯視 / 側視」按鈕。
- 已有 ? 提示的說明不要再在外面顯示一次文字（保持畫面整潔）。
- 預設語言英文；只有使用者切換時才記住（localStorage `uiLang`）。導覽只在第一次開啟時顯示。
- 合併圖層：勾選兩層以上，併入最下面那層（沿用其顏色與位置），可「拆開」。改層數 / 合併相近色 / 細節程度時，自訂排序、逐層設定、合併都會重設。
- 匯出視窗分三區：① 切割檔二選一（純切割 → 預設單一多圖層 `artwork.svg`，每層一個 `<g id="layer-NN">`、顏色互不相同，有泡棉時另有泡棉墊片按鈕；列印再切割 → PNG，可選 Letter / A4）；② 製作說明書（PDF + 立體預覽圖，獨立按鈕）；③ 收合區：備用每層 SVG（逐檔 / ZIP，提示要先解壓縮）、匯出摘要與紙張清單。不顯示「多圖層 SVG 拆層請實測」那句。沒有底部按鈕列，右上角 × 關閉。
- 自動排序預設「面積大→小」。對位記號預設關閉（L 型角）。立體檢視左右拖曳方向已修正為跟著滑鼠。
- 預設參數：合併相近色 4、邊緣平滑度 4、最小碎片 1.5 mm²、填補小洞 0.5 mm²、最小可切寬度 1.5 mm、寬度 15 cm。

## 已知限制 / 可能的後續

- 尚未在 Cricut Design Space 實機驗證 `artwork.svg` 的拆層行為，需使用者實測。
- 處理解析度 1200px：大圖上很細的葉脈會變細；調色盤上限 12 色。
- 大圖（約 1920px）精確結果約 5–6 秒。
