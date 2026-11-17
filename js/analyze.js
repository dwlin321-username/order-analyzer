/*
 * 訂單分析邏輯（不碰畫面，只把資料轉成統計結果）
 * 可在瀏覽器與 Node.js 中執行。
 */
(function (root) {
  'use strict';

  var REQUIRED = ['訂單編號', '收貨人聯絡地址', '付款方式', '訂單明細', '商品總數', '總計'];
  var ISLAND_COUNTIES = ['澎湖縣', '金門縣', '連江縣'];
  var ISLAND_DISTRICTS = { '臺東縣': ['綠島鄉', '蘭嶼鄉'], '屏東縣': ['琉球鄉'] };
  var BUCKET = 10;
  var BUCKET_MAX = 200;
  var COUNTY_ALIAS = {
    '桃園縣': '桃園市', '臺北縣': '新北市', '臺中縣': '臺中市', '臺南縣': '臺南市', '高雄縣': '高雄市'
  };

  function str(v) {
    return v == null ? '' : String(v);
  }

  /* 全形數字轉半形、去除空白、統一「台」為「臺」 */
  function normalizeAddress(s) {
    return str(s)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/\s+/g, '')
      .replace(/台(北|中|南|東)/g, '臺$1');
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    var s = str(v).replace(/[^\d.\-]/g, '');
    if (s === '' || s === '-' || s === '.') return NaN;
    return Number(s);
  }

  /* 在地址文字中找出行政區：完整名稱優先，其次比對去掉「區/鄉/鎮/市」的舊稱（如「中壢市」） */
  function findDistrict(text, county, zip) {
    var list = zip.districts[county] || [];
    var best = null, bestIdx = Infinity;
    list.forEach(function (d) {
      var i = text.indexOf(d);
      if (i >= 0 && i < bestIdx) { best = d; bestIdx = i; }
    });
    if (best) return best;
    list.forEach(function (d) {
      var base = d.slice(0, -1);
      if (base.length < 2) return;
      var i = text.indexOf(base);
      if (i >= 0 && i < bestIdx) { best = d; bestIdx = i; }
    });
    return best;
  }

  /*
   * 解析地址 → { county, district, method }
   * 1. 開頭有 3 碼郵遞區號：以郵遞區號決定縣市（可修正錯字或矛盾的地址）
   * 2. 沒有郵遞區號：以文字比對縣市與行政區
   */
  function parseAddress(raw, zip) {
    var s = normalizeAddress(raw);
    if (!s) return { county: null, district: null, method: null };

    var m = s.match(/^(\d{3})/);
    if (m && zip.zips[m[1]]) {
      var entry = zip.zips[m[1]];
      var county = entry[0];
      var district = entry[1].length === 1 ? entry[1][0] : null;
      if (!district) {
        var ci = s.indexOf(county);
        var found = findDistrict(ci >= 0 ? s.slice(ci + county.length) : s.slice(3), county, zip);
        if (found && entry[1].indexOf(found) >= 0) district = found;
      }
      return { county: county, district: district, method: 'zip' };
    }

    var text = s.replace(/^\d+/, '');
    Object.keys(COUNTY_ALIAS).forEach(function (k) { text = text.split(k).join(COUNTY_ALIAS[k]); });
    var bestCounty = null, bestIdx = Infinity, bestLen = 0;
    zip.counties.forEach(function (c) {
      var i = text.indexOf(c);
      if (i >= 0 && i < bestIdx) { bestCounty = c; bestIdx = i; bestLen = c.length; }
    });
    // 縣市沒寫「縣/市」（例如「澎湖馬公市」）
    if (!bestCounty) {
      zip.counties.forEach(function (c) {
        var base = c.slice(0, -1);
        var i = text.indexOf(base);
        if (i >= 0 && i < bestIdx) { bestCounty = c; bestIdx = i; bestLen = base.length; }
      });
    }
    // 只寫了行政區（例如「馬公市」）：用全國唯一的行政區名稱反查縣市
    if (!bestCounty) {
      var hit = uniqueDistrictLookup(text, zip);
      if (hit) return { county: hit.county, district: hit.district, method: 'text' };
      return { county: null, district: null, method: null };
    }
    var rest = text.slice(bestIdx + bestLen);
    return { county: bestCounty, district: findDistrict(rest, bestCounty, zip), method: 'text' };
  }

  var _uniqueDistricts = null;
  function uniqueDistrictLookup(text, zip) {
    if (!_uniqueDistricts) {
      var seen = {};
      Object.keys(zip.districts).forEach(function (c) {
        zip.districts[c].forEach(function (d) { (seen[d] = seen[d] || []).push(c); });
      });
      _uniqueDistricts = Object.keys(seen).filter(function (d) {
        return seen[d].length === 1 && d.length >= 3;
      }).map(function (d) { return { district: d, county: seen[d][0] }; });
    }
    var best = null, bestIdx = Infinity;
    _uniqueDistricts.forEach(function (u) {
      var i = text.indexOf(u.district);
      if (i >= 0 && i < bestIdx) { best = u; bestIdx = i; }
    });
    return best;
  }

  function isIsland(county, district) {
    if (ISLAND_COUNTIES.indexOf(county) >= 0) return true;
    return !!(ISLAND_DISTRICTS[county] && ISLAND_DISTRICTS[county].indexOf(district) >= 0);
  }

  /* 解析訂單明細：「1. 芭樂乾  數量：3  金額：NT$150」 */
  function parseItems(detail) {
    var items = [];
    str(detail).split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*\d+\s*[.．、]\s*(.+?)\s+數量\s*[:：]\s*(\d+)\s+金額\s*[:：]\s*NT\$\s*([\d,]+)/);
      if (m) items.push({ name: m[1].trim(), qty: Number(m[2]), amount: toNumber(m[3]) });
    });
    return items;
  }

  function bucketIndex(n) {
    if (n > BUCKET_MAX) return BUCKET_MAX / BUCKET;
    return Math.max(0, Math.ceil(n / BUCKET) - 1);
  }

  function bucketLabel(i) {
    if (i >= BUCKET_MAX / BUCKET) return (BUCKET_MAX + 1) + ' 以上';
    return (i * BUCKET + 1) + '–' + ((i + 1) * BUCKET);
  }

  /* 從二維陣列中找出表頭列（前 10 列中包含最多必要欄位者） */
  function findHeader(rows) {
    var best = { index: -1, score: 0 };
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var cells = (rows[r] || []).map(function (c) { return str(c).trim(); });
      var score = REQUIRED.filter(function (k) { return cells.indexOf(k) >= 0; }).length;
      if (score > best.score) best = { index: r, score: score, cells: cells };
    }
    return best;
  }

  /*
   * 主分析函式
   * sheets: [{ name, rows: 二維陣列 }]
   * 回傳 { ok:true, ... } 或 { ok:false, error }
   */
  function analyze(sheets, zip) {
    var chosen = null, bestHeader = null;
    sheets.forEach(function (sh) {
      var h = findHeader(sh.rows);
      if (!bestHeader || h.score > bestHeader.score) { bestHeader = h; chosen = sh; }
    });

    if (!chosen || bestHeader.score === 0) {
      return { ok: false, error: '找不到訂單資料表。請確認檔案是從訂單系統匯出的原始檔案。', missing: REQUIRED.slice() };
    }
    var missing = REQUIRED.filter(function (k) { return bestHeader.cells.indexOf(k) < 0; });
    if (missing.length) {
      return { ok: false, error: '檔案缺少以下欄位，無法分析：', missing: missing };
    }

    var col = {};
    bestHeader.cells.forEach(function (name, i) { if (name && !(name in col)) col[name] = i; });

    var orders = [];
    var warnings = { address: [], qtyMismatch: [], qtyInvalid: [], amountInvalid: [] };

    for (var r = bestHeader.index + 1; r < chosen.rows.length; r++) {
      var row = chosen.rows[r] || [];
      var get = function (k) { return row[col[k]]; };
      var hasData = REQUIRED.some(function (k) { return str(get(k)).trim() !== ''; });
      if (!hasData) continue;

      var id = str(get('訂單編號')).trim() || ('第 ' + (r + 1) + ' 列');
      var addrRaw = str(get('收貨人聯絡地址')).trim();
      var addr = parseAddress(addrRaw, zip);
      if (!addr.county) warnings.address.push({ id: id, text: addrRaw || '（空白）' });

      var items = parseItems(get('訂單明細'));
      var itemSum = items.reduce(function (a, b) { return a + b.qty; }, 0);
      var qty = toNumber(get('商品總數'));
      if (isNaN(qty)) {
        warnings.qtyInvalid.push({ id: id, text: str(get('商品總數')) || '（空白）' });
        qty = itemSum;
      } else if (items.length && itemSum !== qty) {
        warnings.qtyMismatch.push({ id: id, text: '商品總數 ' + qty + '，明細加總 ' + itemSum });
      }

      var total = toNumber(get('總計'));
      if (isNaN(total)) {
        warnings.amountInvalid.push({ id: id, text: str(get('總計')) || '（空白）' });
        total = 0;
      }

      var dateRaw = col['訂單日期'] != null ? str(get('訂單日期')).trim() : '';

      orders.push({
        id: id,
        county: addr.county,
        district: addr.district,
        island: addr.county ? isIsland(addr.county, addr.district) : false,
        payment: str(get('付款方式')).trim() || '（未填寫）',
        qty: qty,
        total: total,
        items: items,
        date: dateRaw
      });
    }

    if (!orders.length) {
      return { ok: false, error: '檔案中沒有任何訂單資料。' };
    }

    /* 縣市：全部 22 縣市都列出，依訂單數由多到少 */
    var countyMap = {};
    zip.counties.forEach(function (c) { countyMap[c] = { name: c, count: 0, districts: {} }; });
    var unknown = 0;
    orders.forEach(function (o) {
      if (!o.county) { unknown++; return; }
      var c = countyMap[o.county];
      c.count++;
      var d = o.district || '（行政區未明）';
      c.districts[d] = (c.districts[d] || 0) + 1;
    });
    var countyOrder = zip.counties.slice();
    var regions = countyOrder.map(function (c) {
      var info = countyMap[c];
      var ds = Object.keys(info.districts).map(function (d) {
        var cd = d === '（行政區未明）' ? null : d;
        return { name: d, count: info.districts[d], island: isIsland(c, cd) };
      }).sort(function (a, b) { return b.count - a.count; });
      return { name: c, count: info.count, island: ISLAND_COUNTIES.indexOf(c) >= 0, districts: ds };
    }).sort(function (a, b) {
      return b.count - a.count || countyOrder.indexOf(a.name) - countyOrder.indexOf(b.name);
    });

    /* 商品數分組 */
    var maxIdx = 0;
    orders.forEach(function (o) { maxIdx = Math.max(maxIdx, bucketIndex(o.qty)); });
    var buckets = [];
    for (var i = 0; i <= maxIdx; i++) buckets.push({ label: bucketLabel(i), count: 0 });
    orders.forEach(function (o) { buckets[bucketIndex(o.qty)].count++; });

    /* 付款方式 */
    var payMap = {};
    orders.forEach(function (o) { payMap[o.payment] = (payMap[o.payment] || 0) + 1; });
    var payments = Object.keys(payMap).map(function (k) {
      return { name: k, count: payMap[k], pct: payMap[k] / orders.length };
    }).sort(function (a, b) { return b.count - a.count; });

    /* 熱銷前 10 名（依數量；同分依金額、訂單數） */
    var prodMap = {};
    orders.forEach(function (o) {
      o.items.forEach(function (it) {
        var p = prodMap[it.name] || (prodMap[it.name] = { name: it.name, qty: 0, amount: 0, orders: 0, _last: null });
        p.qty += it.qty;
        p.amount += isNaN(it.amount) ? 0 : it.amount;
        if (p._last !== o) { p.orders++; p._last = o; }
      });
    });
    var products = Object.keys(prodMap).map(function (k) {
      var p = prodMap[k];
      return { name: p.name, qty: p.qty, amount: p.amount, orders: p.orders };
    }).sort(function (a, b) {
      return b.qty - a.qty || b.amount - a.amount || b.orders - a.orders;
    });
    var top = products.slice(0, 10);
    var tiedExtra = 0;
    if (products.length > 10) {
      var last = top[top.length - 1];
      tiedExtra = products.slice(10).filter(function (p) { return p.qty === last.qty; }).length;
    }

    var revenue = orders.reduce(function (a, o) { return a + o.total; }, 0);
    var dates = orders.map(function (o) { return o.date.slice(0, 10); }).filter(Boolean).sort();

    return {
      ok: true,
      sheetName: chosen.name,
      orderCount: orders.length,
      revenue: revenue,
      aov: revenue / orders.length,
      islandCount: orders.filter(function (o) { return o.island; }).length,
      dateFrom: dates[0] || '',
      dateTo: dates[dates.length - 1] || '',
      regions: regions,
      unknownRegion: unknown,
      buckets: buckets,
      payments: payments,
      top: top,
      tiedExtra: tiedExtra,
      productCount: products.length,
      warnings: warnings
    };
  }

  var api = {
    analyze: analyze,
    parseAddress: parseAddress,
    parseItems: parseItems,
    bucketIndex: bucketIndex,
    bucketLabel: bucketLabel,
    REQUIRED: REQUIRED
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrderAnalyzer = api;
})(typeof window !== 'undefined' ? window : this);
