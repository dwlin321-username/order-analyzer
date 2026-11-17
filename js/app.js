/* 畫面與互動 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var uploadView = $('upload-view');
  var resultView = $('result-view');
  var dropzone = $('dropzone');
  var fileInput = $('file-input');
  var errorBox = $('error-box');

  var state = { result: null, fileName: '', regionCounty: null };
  var charts = { pay: null, qty: null };

  var fmtInt = new Intl.NumberFormat('zh-TW');
  var fmtPct = new Intl.NumberFormat('zh-TW', { style: 'percent', maximumFractionDigits: 1 });

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- 讀取檔案 ---------- */

  function decodeText(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
    } catch (e) {
      // 非 UTF-8，多半是 Excel 另存的 Big5 CSV
      return new TextDecoder('big5').decode(buf);
    }
  }

  function readWorkbook(file) {
    return file.arrayBuffer().then(function (buf) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'csv') {
        return XLSX.read(decodeText(buf), { type: 'string', raw: true });
      }
      return XLSX.read(new Uint8Array(buf), { type: 'array' });
    });
  }

  function handleFile(file) {
    if (!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'xls', 'csv'].indexOf(ext) < 0) {
      showError('不支援這種檔案格式', ['請使用 .xlsx、.xls 或 .csv 檔案。']);
      return;
    }
    readWorkbook(file).then(function (wb) {
      var sheets = wb.SheetNames.map(function (n) {
        return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: false, blankrows: false }) };
      });
      var result = OrderAnalyzer.analyze(sheets, window.TW_ZIP);
      if (!result.ok) {
        showError(result.error, result.missing);
        return;
      }
      state.result = result;
      state.fileName = file.name;
      state.regionCounty = null;
      showResult();
    }).catch(function (err) {
      console.error(err);
      showError('無法讀取這個檔案', ['檔案可能已損毀、有密碼保護，或不是 Excel／CSV 格式。']);
    });
  }

  function showError(title, list) {
    errorBox.textContent = '';
    errorBox.appendChild(el('strong', null, title));
    if (list && list.length) {
      var ul = el('ul');
      list.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      errorBox.appendChild(ul);
    }
    errorBox.hidden = false;
    resultView.hidden = true;
    uploadView.hidden = false;
  }

  /* ---------- 拖曳與選擇檔案 ---------- */

  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) {
    e.preventDefault();
    dragDepth++;
    dropzone.classList.add('is-over');
  });
  window.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropzone.classList.remove('is-over');
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-over');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener('change', function () {
    handleFile(fileInput.files[0]);
    fileInput.value = '';
  });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  $('reset-btn').addEventListener('click', function () {
    destroyCharts();
    state.result = null;
    resultView.hidden = true;
    errorBox.hidden = true;
    uploadView.hidden = false;
    window.scrollTo(0, 0);
  });
  $('region-back').addEventListener('click', function () {
    state.regionCounty = null;
    renderRegions();
  });

  /* ---------- 結果畫面 ---------- */

  function showResult() {
    var r = state.result;
    errorBox.hidden = true;
    uploadView.hidden = true;
    resultView.hidden = false;
    window.scrollTo(0, 0);

    var meta = state.fileName;
    if (r.dateFrom) meta += '・' + (r.dateFrom === r.dateTo ? r.dateFrom : r.dateFrom + ' 至 ' + r.dateTo);
    $('file-meta').textContent = meta;

    setKpi('kpi-orders', fmtInt.format(r.orderCount), '筆');
    setKpi('kpi-revenue', 'NT$' + fmtInt.format(Math.round(r.revenue)));
    setKpi('kpi-aov', 'NT$' + fmtInt.format(Math.round(r.aov)));
    setKpi('kpi-island', fmtInt.format(r.islandCount), '筆');

    renderRegions();
    renderTop();
    renderWarnings();
    renderCharts();
  }

  function setKpi(id, value, unit) {
    var e = $(id);
    e.textContent = value;
    if (unit) e.appendChild(el('small', null, unit));
  }

  function barRow(opts) {
    var row = el(opts.onClick ? 'button' : 'div', 'hbar' + (opts.value === 0 ? ' is-zero' : ''));
    if (opts.onClick) { row.type = 'button'; row.addEventListener('click', opts.onClick); }
    if (opts.rank != null) row.appendChild(el('span', 'rank', String(opts.rank)));
    var name = el('span', 'hbar-name', opts.name);
    name.title = opts.name;
    if (opts.tag) name.appendChild(el('span', 'tag', opts.tag));
    row.appendChild(name);
    var track = el('span', 'hbar-track');
    var fill = el('span', 'hbar-fill');
    fill.style.width = (opts.max ? (opts.value / opts.max) * 100 : 0) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    var val = el('span', 'hbar-val', opts.label);
    if (opts.sub) val.appendChild(el('span', 'sub', opts.sub));
    if (opts.chevron) val.appendChild(el('span', 'chev', opts.value > 0 ? '›' : ''));
    row.appendChild(val);
    row.setAttribute('aria-label', opts.aria || (opts.name + ' ' + opts.label));
    return row;
  }

  function renderRegions() {
    var r = state.result;
    var box = $('region-bars');
    box.textContent = '';
    var back = $('region-back');

    if (state.regionCounty) {
      var c = r.regions.filter(function (x) { return x.name === state.regionCounty; })[0];
      $('region-title').textContent = c.name + '・行政區分布';
      $('region-sub').textContent = '共 ' + c.count + ' 筆訂單';
      back.hidden = false;
      var dmax = c.districts.length ? c.districts[0].count : 0;
      c.districts.forEach(function (d) {
        box.appendChild(barRow({ name: d.name, value: d.count, max: dmax, label: fmtInt.format(d.count) }));
      });
      return;
    }

    $('region-title').textContent = '收貨縣市分布';
    $('region-sub').textContent = '依收貨人地址・點選縣市可查看行政區';
    back.hidden = true;
    var max = r.regions[0].count;
    if (r.unknownRegion > max) max = r.unknownRegion;
    r.regions.forEach(function (c) {
      box.appendChild(barRow({
        name: c.name,
        value: c.count,
        max: max,
        label: fmtInt.format(c.count),
        chevron: true,
        aria: c.name + ' ' + c.count + ' 筆訂單' + (c.count ? '，點選查看行政區' : ''),
        onClick: c.count ? function () { state.regionCounty = c.name; renderRegions(); } : null
      }));
    });
    if (r.unknownRegion) {
      box.appendChild(barRow({ name: '未能辨識', value: r.unknownRegion, max: max, label: fmtInt.format(r.unknownRegion) }));
    }
  }

  function renderTop() {
    var r = state.result;
    var box = $('top-bars');
    box.textContent = '';
    var max = r.top.length ? r.top[0].qty : 0;
    r.top.forEach(function (p, i) {
      var row = barRow({
        rank: i + 1,
        name: p.name,
        value: p.qty,
        max: max,
        label: fmtInt.format(p.qty) + ' 個',
        sub: 'NT$' + fmtInt.format(p.amount) + '・' + p.orders + ' 張',
        aria: '第 ' + (i + 1) + ' 名 ' + p.name + '，' + p.qty + ' 個，NT$' + p.amount + '，' + p.orders + ' 張訂單'
      });
      row.setAttribute('role', 'listitem');
      box.appendChild(row);
    });
    if (!r.top.length) box.appendChild(el('p', 'note', '訂單明細中沒有可辨識的商品。'));
    var note = $('top-note');
    var parts = ['共 ' + r.productCount + ' 種商品'];
    if (r.tiedExtra) parts.push('另有 ' + r.tiedExtra + ' 項與第 10 名同為 ' + r.top[r.top.length - 1].qty + ' 個');
    note.textContent = parts.join('・');
    note.hidden = false;
  }

  function renderWarnings() {
    var w = state.result.warnings;
    var groups = [
      { title: '無法辨識縣市的地址（已歸入「未能辨識」）', list: w.address },
      { title: '「商品總數」與訂單明細加總不一致（以商品總數為準）', list: w.qtyMismatch },
      { title: '「商品總數」不是數字（已改用明細加總）', list: w.qtyInvalid },
      { title: '「總計」金額無法辨識（以 0 計算）', list: w.amountInvalid }
    ].filter(function (g) { return g.list.length; });

    var card = $('warn-card');
    if (!groups.length) { card.hidden = true; return; }
    var ids = {};
    groups.forEach(function (g) { g.list.forEach(function (it) { ids[it.id] = 1; }); });
    var total = Object.keys(ids).length;
    $('warn-summary').textContent = '資料提醒：有 ' + total + ' 筆訂單的資料需要確認';
    var body = $('warn-body');
    body.textContent = '';
    groups.forEach(function (g) {
      body.appendChild(el('h3', null, g.title));
      var ul = el('ul');
      g.list.forEach(function (it) {
        var li = el('li');
        li.appendChild(el('code', null, it.id));
        li.appendChild(document.createTextNode('　' + it.text));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    });
    card.hidden = false;
  }

  /* ---------- Chart.js 圖表 ---------- */

  function destroyCharts() {
    Object.keys(charts).forEach(function (k) { if (charts[k]) { charts[k].destroy(); charts[k] = null; } });
  }

  // 甜甜圈中央文字
  var centerText = {
    id: 'centerText',
    afterDraw: function (chart, args, opts) {
      var meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data.length) return;
      var x = meta.data[0].x, y = meta.data[0].y;
      var ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = opts.color;
      ctx.font = '600 34px ' + opts.font;
      ctx.fillText(opts.value, x, y - 8);
      ctx.fillStyle = opts.subColor;
      ctx.font = '400 13px ' + opts.font;
      ctx.fillText(opts.label, x, y + 20);
      ctx.restore();
    }
  };

  // 長條上方數值（只標示非 0）
  var topLabels = {
    id: 'topLabels',
    afterDatasetsDraw: function (chart, args, opts) {
      var ctx = chart.ctx;
      var meta = chart.getDatasetMeta(0);
      var data = chart.data.datasets[0].data;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = opts.color;
      ctx.font = '500 12px ' + opts.font;
      meta.data.forEach(function (bar, i) {
        if (data[i] > 0) ctx.fillText(String(data[i]), bar.x, bar.y - 4);
      });
      ctx.restore();
    }
  };

  function renderCharts() {
    destroyCharts();
    var r = state.result;
    var font = css('--font');
    var text = css('--text'), text2 = css('--text-2'), grid = css('--grid'), surface = css('--surface');
    var series = [css('--series-1'), css('--series-2')];
    Chart.defaults.font.family = font;
    Chart.defaults.color = text2;

    var tooltip = {
      backgroundColor: css('--surface-2'),
      titleColor: text,
      bodyColor: text,
      borderColor: css('--border'),
      borderWidth: 1,
      padding: 10,
      cornerRadius: 10,
      displayColors: false
    };

    /* 付款方式甜甜圈 */
    var payColors = r.payments.map(function (p, i) { return series[i] || css('--text-3'); });
    charts.pay = new Chart($('pay-chart'), {
      type: 'doughnut',
      data: {
        labels: r.payments.map(function (p) { return p.name; }),
        datasets: [{
          data: r.payments.map(function (p) { return p.count; }),
          backgroundColor: payColors,
          borderColor: surface,
          borderWidth: 2,
          hoverOffset: 4
        }]
      },
      options: {
        cutout: '70%',
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltip, {
            callbacks: {
              label: function (c) { var p = r.payments[c.dataIndex]; return p.name + '：' + p.count + ' 筆（' + fmtPct.format(p.pct) + '）'; }
            }
          }),
          centerText: { value: fmtInt.format(r.orderCount), label: '筆訂單', color: text, subColor: text2, font: font }
        }
      },
      plugins: [centerText]
    });

    var legend = $('pay-legend');
    legend.textContent = '';
    r.payments.forEach(function (p, i) {
      var li = el('li');
      var dot = el('span', 'dot');
      dot.style.background = payColors[i];
      li.appendChild(dot);
      li.appendChild(el('span', 'name', p.name));
      var val = el('span', 'val', fmtInt.format(p.count) + ' 筆');
      val.appendChild(el('small', null, fmtPct.format(p.pct)));
      li.appendChild(val);
      legend.appendChild(li);
    });

    /* 商品數分布 */
    charts.qty = new Chart($('qty-chart'), {
      type: 'bar',
      data: {
        labels: r.buckets.map(function (b) { return b.label; }),
        datasets: [{
          data: r.buckets.map(function (b) { return b.count; }),
          backgroundColor: series[0],
          hoverBackgroundColor: css('--accent-hover'),
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom',
          barPercentage: 0.82,
          categoryPercentage: 0.9,
          maxBarThickness: 56
        }]
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 18 } },
        scales: {
          x: {
            grid: { display: false },
            border: { color: grid },
            ticks: { color: text2, maxRotation: 50, autoSkip: false, font: { size: 11 } },
            title: { display: true, text: '每筆訂單商品數（個）', color: text2, font: { size: 12 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: grid },
            border: { display: false },
            ticks: { precision: 0, color: text2 },
            title: { display: true, text: '訂單數（筆）', color: text2, font: { size: 12 } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltip, {
            callbacks: {
              title: function (items) { return items[0].label + ' 個'; },
              label: function (c) { return c.raw + ' 筆訂單（' + fmtPct.format(c.raw / r.orderCount) + '）'; }
            }
          }),
          topLabels: { color: text, font: font }
        }
      },
      plugins: [topLabels]
    });
  }

  // 系統切換深色／淺色模式時重新上色
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { if (state.result && !resultView.hidden) renderCharts(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }
})();
