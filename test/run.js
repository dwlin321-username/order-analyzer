// 以範例檔測試分析邏輯：node test/run.js <檔案路徑>
const fs = require('fs'), path = require('path'), vm = require('vm');
const XLSX = require(path.join(__dirname, '../vendor/xlsx.full.min.js'));
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/zipdata.js'), 'utf8'), ctx);
const A = require('../js/analyze.js');
const wb = XLSX.read(fs.readFileSync(process.argv[2]), { type: 'buffer' });
const sheets = wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: false }) }));
const r = A.analyze(sheets, ctx.window.TW_ZIP);
console.log(JSON.stringify(r, (k, v) => k === 'districts' && Array.isArray(v) && !v.length ? undefined : v, 1).slice(0, 4000));
// 地址邊界案例
const Z = ctx.window.TW_ZIP;
['320桃園市中壢區桃園市桃園區峨眉一街35號','924屏東縣嵌頂鄉力社村','台北市大安區忠孝東路','桃園縣中壢市中正路1號','金門縣金城鎮民生路','951台東縣綠島鄉','300新竹市東區光復路','澎湖馬公市','Tokyo Japan']
 .forEach(a => console.log(a, JSON.stringify(A.parseAddress(a, Z))));
