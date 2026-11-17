# 顧客訂單分析

把訂單 Excel 拖進網頁，就能立即看到分析結果。

**所有資料只在瀏覽器中處理，不會上傳到任何伺服器。**

## 分析內容

- 摘要：總訂單數、總營業額、平均客單價、離島訂單數
- 收貨縣市分布（橫式長條圖，點選縣市可查看行政區）
- 付款方式比例（甜甜圈圖）
- 熱銷商品前 10 名（依銷售數量）
- 每筆訂單商品數分布（每 10 個為一組，超過 200 個合併）

## 隱私設計

- 頁面設有 Content-Security-Policy `connect-src 'none'`，瀏覽器會阻擋此頁面發出的任何網路連線
- 不使用任何外部 CDN、字型或分析追蹤，所有程式庫都放在 `vendor/`
- 資料只存在記憶體中，關閉或重新整理頁面後即清除
- `.gitignore` 排除了 `.xlsx`／`.xls`／`.csv`，避免訂單資料被誤傳到 GitHub

驗證方式：按 F12 打開「網路（Network）」分頁後拖入檔案，不會出現任何新的連線。

## 檔案結構

| 路徑 | 說明 |
|---|---|
| `index.html` | 頁面 |
| `css/style.css` | 樣式（含深色模式） |
| `js/analyze.js` | 分析邏輯（地址辨識、分組、統計） |
| `js/app.js` | 畫面與圖表 |
| `js/zipdata.js` | 臺灣 3 碼郵遞區號對照表 |
| `vendor/` | SheetJS（讀取 Excel）、Chart.js（圖表） |
| `test/run.js` | 用 Node.js 測試分析邏輯：`node test/run.js 檔案.xlsx` |

## 第三方程式庫

- [SheetJS](https://sheetjs.com/) 0.18.5（Apache-2.0）
- [Chart.js](https://www.chartjs.org/) 4.4.7（MIT）
- [twzipcode-data](https://github.com/vinkla/twzipcode) 2.0.0（MIT）
