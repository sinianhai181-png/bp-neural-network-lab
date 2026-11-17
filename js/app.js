/* =============================================================
 * BP 实验台 · 界面与交互逻辑
 * ============================================================= */
(function () {
  'use strict';

  var E = window.BPEngine;
  var $ = function (id) { return document.getElementById(id); };
  var ACT_KEYS = Object.keys(E.ACT);
  var LOSS_KEYS = Object.keys(E.LOSS);

  function num(v, fallback) { var n = parseFloat(v); return Number.isFinite(n) ? n : (fallback || 0); }
  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(num(v, lo)))); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function fmt(v, d) {
    d = d == null ? 4 : d;
    if (!Number.isFinite(v)) return 'NaN';
    if (v !== 0 && (Math.abs(v) >= 10000 || Math.abs(v) < 0.0001)) return v.toExponential(2);
    return v.toFixed(d);
  }
  function paramStr(v) { return String(Number(v.toFixed(6))); }
  var SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
  function sup(n) { return String(n).split('').map(function (c) { return SUP[+c] || c; }).join(''); }
  function chips(arr, cls) {
    return '<div class="chips">' + arr.map(function (v) {
      return '<span class="chip ' + (cls || '') + '">' + fmt(v) + '</span>';
    }).join('') + '</div>';
  }

  /* ---------------- 预设数据集 ---------------- */
  var PRESETS = {
    xor: {
      label: 'XOR 异或', sizes: [2, 3, 1], hidden: [{ n: 3, act: 'sigmoid' }],
      outAct: 'sigmoid', loss: 'bce', lr: 0.8, epochs: 1500, optimizer: 'sgd',
      data: [{ x: [0, 0], t: [0] }, { x: [0, 1], t: [1] }, { x: [1, 0], t: [1] }, { x: [1, 1], t: [0] }]
    },
    and: {
      label: 'AND 与', sizes: [2, 2, 1], hidden: [{ n: 2, act: 'sigmoid' }],
      outAct: 'sigmoid', loss: 'mse', lr: 0.8, epochs: 1200, optimizer: 'sgd',
      data: [{ x: [0, 0], t: [0] }, { x: [0, 1], t: [0] }, { x: [1, 0], t: [0] }, { x: [1, 1], t: [1] }]
    },
    or: {
      label: 'OR 或', sizes: [2, 2, 1], hidden: [{ n: 2, act: 'sigmoid' }],
      outAct: 'sigmoid', loss: 'mse', lr: 0.8, epochs: 1200, optimizer: 'sgd',
      data: [{ x: [0, 0], t: [0] }, { x: [0, 1], t: [1] }, { x: [1, 0], t: [1] }, { x: [1, 1], t: [1] }]
    },
    linear: {
      label: '线性拟合', sizes: [1, 1], hidden: [],
      outAct: 'linear', loss: 'mse', lr: 0.03, epochs: 800, optimizer: 'sgd',
      data: [{ x: [0], t: [1] }, { x: [1], t: [3] }, { x: [2], t: [5] }, { x: [3], t: [7] }]
    },
    multi: {
      label: '三分类', sizes: [2, 5, 3], hidden: [{ n: 5, act: 'tanh' }],
      outAct: 'softmax', loss: 'ce', lr: 0.05, epochs: 1200, optimizer: 'adam',
      data: [
        { x: [0, 0], t: [1, 0, 0] }, { x: [0, 1], t: [0, 1, 0] },
        { x: [1, 0], t: [0, 0, 1] }, { x: [1, 1], t: [1, 0, 0] }
      ]
    }
  };

  /* ---------------- 全局状态 ---------------- */
  var S = {
    hidden: [{ n: 3, act: 'sigmoid' }],
    dataset: PRESETS.xor.data.map(function (s) { return { x: s.x.slice(), t: s.t.slice() }; }),
    net: null,
    history: [],        // [{ e, loss }]
    epoch: 0,
    running: false,
    paused: false,
    raf: null,
    stepCache: null,
    stepBack: null,
    lastClip: 1
  };

  /* ---------------- 读取配置 ---------------- */
  function readConfig() {
    var sizes = [clampInt($('inNodes').value, 1, 12)];
    S.hidden.forEach(function (h) { sizes.push(clampInt(h.n, 1, 12)); });
    sizes.push(clampInt($('outNodes').value, 1, 12));
    var acts = S.hidden.map(function (h) { return h.act; }).concat([$('outAct').value]);
    return {
      sizes: sizes, activations: acts,
      loss: $('lossFn').value,
      lr: Math.max(1e-8, num($('lr').value, 0.8)),
      epochs: clampInt($('epochs').value, 1, 200000),
      speed: clampInt($('speed').value, 1, 200),
      optimizer: $('optimizer').value,
      initMethod: $('initMethod').value,
      seed: clampInt($('seed').value, 0, 999999),
      gradClip: Math.max(0, num($('gradClip').value, 5))
    };
  }

  function fillSelect(sel, keys, dict, includeAll, current) {
    sel.innerHTML = keys.map(function (k) {
      if (!includeAll && k === 'softmax') return '';
      return '<option value="' + k + '"' + (k === current ? ' selected' : '') + '>' + esc(dict[k].label) + '</option>';
    }).join('');
    if (current && !sel.value) sel.value = ACT_KEYS[0];
  }

  /* ---------------- 提示 ---------------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2800);
  }
  function status(msg) { $('trainStatus').textContent = msg; }

  /* ---------------- 结构 UI ---------------- */
  function renderHidden() {
    var box = $('hiddenList');
    if (!S.hidden.length) {
      box.innerHTML = '<div class="empty" style="padding:12px">无隐藏层（输入层直连输出层，仅能拟合线性关系）</div>';
    } else {
      box.innerHTML = S.hidden.map(function (h, idx) {
        var opts = ACT_KEYS.filter(function (k) { return k !== 'softmax'; }).map(function (k) {
          return '<option value="' + k + '"' + (k === h.act ? ' selected' : '') + '>' + esc(E.ACT[k].label) + '</option>';
        }).join('');
        return '<div class="hidden-row" data-idx="' + idx + '">' +
          '<label class="hn"><span class="tag">H' + (idx + 1) + '</span>' +
          '<input type="number" class="hn-n" min="1" max="12" step="1" value="' + h.n + '" title="该隐藏层节点数"></label>' +
          '<select class="hn-a" title="该层激活函数">' + opts + '</select>' +
          '<button class="icon-btn hn-del" title="删除该隐藏层" type="button">×</button></div>';
      }).join('');
    }
    box.querySelectorAll('.hidden-row').forEach(function (row) {
      var idx = +row.dataset.idx;
      row.querySelector('.hn-n').addEventListener('change', function () {
        S.hidden[idx].n = clampInt(this.value, 1, 12); this.value = S.hidden[idx].n; onStructureChange();
      });
      row.querySelector('.hn-a').addEventListener('change', function () {
        S.hidden[idx].act = this.value; onStructureChange();
      });
      row.querySelector('.hn-del').addEventListener('click', function () {
        S.hidden.splice(idx, 1); renderHidden(); onStructureChange();
      });
    });
    updateSummary();
  }

  function updateSummary() {
    var c = readConfig();
    var params = 0;
    for (var k = 0; k < c.sizes.length - 1; k++) params += c.sizes[k + 1] * (c.sizes[k] + 1);
    $('structureSummary').textContent = '结构 ' + c.sizes.join(' → ') + ' ｜ ' + (c.sizes.length - 1) + ' 组权重矩阵 ｜ ' + params + ' 个可训练参数（含偏置）';
    $('mParams').textContent = params;
    updatePairBadge(c);
  }

  function updatePairBadge(c) {
    var outAct = c.activations[c.activations.length - 1];
    var el = $('pairBadge'), msg, warn = false;
    if (E.isPaired(c.loss, outAct)) {
      msg = '✓ 推荐组合：输出层误差化简为 δ = a − t';
    } else if (c.loss === 'bce' && outAct !== 'sigmoid') {
      msg = '⚠ BCE 要求输出在 (0,1)，当前输出层为 ' + E.ACT[outAct].label; warn = true;
    } else if (c.loss === 'ce' && outAct !== 'softmax') {
      msg = '⚠ CE 建议配合 Softmax 输出层'; warn = true;
    } else if (outAct === 'softmax' && c.loss !== 'ce') {
      msg = '⚠ Softmax 输出通常搭配 CE 损失'; warn = true;
    } else {
      msg = '配置就绪 · 通用链式法则求导';
    }
    el.textContent = msg;
    el.className = 'badge ' + (warn ? 'badge-warn' : 'badge-ok');
    $('lossHint').textContent = E.LOSS[c.loss].label + '：' + E.LOSS[c.loss].desc;
  }

  /* ---------------- 数据集 UI ---------------- */
  function fitDataset(inN, outN) {
    S.dataset.forEach(function (s) {
      while (s.x.length < inN) s.x.push(0);
      s.x.length = inN;
      while (s.t.length < outN) s.t.push(0);
      s.t.length = outN;
    });
  }
  function renderDataset() {
    var c = readConfig(), inN = c.sizes[0], outN = c.sizes[c.sizes.length - 1];
    fitDataset(inN, outN);
    var head = '<tr><th>#</th>';
    for (var i = 0; i < inN; i++) head += '<th class="th-group">x' + (i + 1) + '</th>';
    for (var j = 0; j < outN; j++) head += '<th class="th-target">t' + (j + 1) + '</th>';
    head += '</tr>';
    var body = S.dataset.map(function (s, r) {
      var row = '<tr data-row="' + r + '"><td class="row-idx">' + (r + 1) + '</td>';
      for (var i = 0; i < inN; i++) row += '<td><input class="dx" type="number" step="any" value="' + paramStr(s.x[i]) + '"></td>';
      for (var j = 0; j < outN; j++) row += '<td><input class="dt" type="number" step="any" value="' + paramStr(s.t[j]) + '"></td>';
      return row + '</tr>';
    }).join('');
    $('datasetWrap').innerHTML = '<table class="data-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    renderSampleOptions();
  }
  function collectDataset() {
    var rows = $('datasetWrap').querySelectorAll('tr[data-row]');
    var data = [];
    rows.forEach(function (tr) {
      var x = [], t = [];
      tr.querySelectorAll('input.dx').forEach(function (ip) { x.push(num(ip.value, 0)); });
      tr.querySelectorAll('input.dt').forEach(function (ip) { t.push(num(ip.value, 0)); });
      if (x.length && t.length) data.push({ x: x, t: t });
    });
    if (!data.length) throw new Error('至少需要一个训练样本');
    return data;
  }
  function renderSampleOptions() {
    var sel = $('sampleSel'), cur = +sel.value || 0;
    var c = readConfig(), inN = c.sizes[0];
    sel.innerHTML = S.dataset.map(function (s, i) {
      return '<option value="' + i + '">#' + (i + 1) + '  [' + s.x.slice(0, inN).map(function (v) { return fmt(v, 2); }).join(', ') + ']</option>';
    }).join('');
    sel.value = Math.min(cur, S.dataset.length - 1);
  }

  /* ---------------- 权重 / 偏置编辑器 ---------------- */
  function renderParamEditor() {
    var net = S.net, c = readConfig();
    var html = '';
    for (var k = 0; k < net.L; k++) {
      var nin = c.sizes[k], nout = c.sizes[k + 1];
      html += '<div class="param-layer"><h4>W⁽' + sup(k + 1) + '⁾ 、 b⁽' + sup(k + 1) + '⁾　' +
        c.sizes[k] + ' → ' + c.sizes[k + 1] + '（' + esc(E.ACT[c.activations[k]].label) + '）</h4><div class="table-scroll"><table class="data-table">';
      html += '<thead><tr><th>j \\ i</th>';
      for (var i = 0; i < nin; i++) html += '<th>a' + (i + 1) + '⁽' + sup(k) + '⁾</th>';
      html += '<th class="th-target">b</th></tr></thead><tbody>';
      for (var j = 0; j < nout; j++) {
        html += '<tr><td class="row-idx">j=' + (j + 1) + '</td>';
        for (var i2 = 0; i2 < nin; i2++) {
          html += '<td><input class="pw" data-k="' + k + '" data-j="' + j + '" data-i="' + i2 + '" type="number" step="any" value="' + paramStr(net.weights[k][j][i2]) + '"></td>';
        }
        html += '<td><input class="pb" data-k="' + k + '" data-j="' + j + '" type="number" step="any" value="' + paramStr(net.biases[k][j]) + '"></td></tr>';
      }
      html += '</tbody></table></div></div>';
    }
    $('paramEditor').innerHTML = html;
  }
  function applyParamEditor() {
    try {
      var W = [], B = [], k;
      for (k = 0; k < S.net.L; k++) {
        W.push(S.net.weights[k].map(function (r) { return r.slice(); }));
        B.push(S.net.biases[k].slice());
      }
      $('paramEditor').querySelectorAll('input.pw').forEach(function (ip) {
        W[+ip.dataset.k][+ip.dataset.j][+ip.dataset.i] = num(ip.value, 0);
      });
      $('paramEditor').querySelectorAll('input.pb').forEach(function (ip) {
        B[+ip.dataset.k][+ip.dataset.j] = num(ip.value, 0);
      });
      S.net.setParams(W, B);
      resetTraining(false);
      renderAll(false);
      toast('权重与偏置已应用到网络');
    } catch (err) { toast(err.message, true); }
  }

  /* ---------------- 网络结构图 ---------------- */
  function renderNetworkSVG() {
    var net = S.net, sizes = net.sizes, c = readConfig(), L = sizes.length - 1;
    var maxN = Math.max.apply(null, sizes);
    var w = Math.max(560, sizes.length * 170), h = Math.max(240, maxN * 46 + 100);
    var padX = 62, padTop = 46, padBottom = 40, avail = h - padTop - padBottom;
    var xOf = function (l) { return padX + (w - 2 * padX) * l / L; };
    var pos = sizes.map(function (n, l) {
      var spacing = n > 1 ? Math.min(48, avail / (n - 1)) : 0;
      var total = spacing * (n - 1);
      var start = padTop + (avail - total) / 2;
      var arr = [];
      for (var i = 0; i < n; i++) arr.push({ x: xOf(l), y: start + i * spacing });
      return arr;
    });
    var acts = null;
    if ($('showAct').checked && S.dataset.length) {
      try { acts = net.forward(S.dataset[0].x).a; } catch (e) { acts = null; }
    }
    var out = [], k, j, i, p, q;
    for (k = 0; k < L; k++) {
      for (j = 0; j < sizes[k + 1]; j++) {
        for (i = 0; i < sizes[k]; i++) {
          var wv = net.weights[k][j][i];
          p = pos[k][i]; q = pos[k + 1][j];
          out.push('<line x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '" ' +
            'stroke="' + (wv >= 0 ? '#3b82f6' : '#f97316') + '" ' +
            'stroke-width="' + (0.5 + Math.min(3.2, Math.abs(wv) * 1.1)).toFixed(2) + '" ' +
            'stroke-opacity="' + (0.16 + Math.min(0.65, Math.abs(wv) / 3)).toFixed(2) + '">' +
            '<title>W' + (k + 1) + '[' + (j + 1) + '][' + (i + 1) + '] = ' + fmt(wv, 6) + '</title></line>');
        }
      }
    }
    for (var l = 0; l <= L; l++) {
      var isIn = l === 0, isOut = l === L;
      var stroke = isIn ? '#94a3b8' : (isOut ? '#10b981' : '#6366f1');
      var label = isIn ? '输入层' : (isOut ? '输出层' : '隐藏层 ' + l);
      var actName = isIn ? 'x' : E.ACT[c.activations[l - 1]].label;
      out.push('<text x="' + xOf(l) + '" y="20" text-anchor="middle" font-size="11" font-weight="600" fill="#475569">' + esc(label) + '</text>');
      out.push('<text x="' + xOf(l) + '" y="34" text-anchor="middle" font-size="10" fill="#94a3b8">' + esc(actName) + '</text>');
      for (i = 0; i < sizes[l]; i++) {
        p = pos[l][i];
        var v = acts ? acts[l][i] : null;
        out.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="17" fill="#ffffff" stroke="' + stroke + '" stroke-width="2">' +
          '<title>' + esc(label) + ' · 节点 ' + (i + 1) + (v == null ? '' : ' · 激活值 ' + fmt(v, 6)) + '</title></circle>');
        out.push('<text x="' + p.x + '" y="' + (p.y + 3.2) + '" text-anchor="middle" font-size="' + (v == null ? 10 : 9) + '" ' +
          'font-weight="600" fill="' + stroke + '">' + (v == null ? (i + 1) : fmt(v, 2)) + '</text>');
      }
    }
    $('netSvgWrap').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="神经网络结构图">' + out.join('') + '</svg>';
    $('netStats').textContent = S.epoch ? ('第 ' + S.epoch + ' 轮 · 损失 ' + fmt(S.history.length ? S.history[S.history.length - 1].loss : 0, 6)) : '尚未开始训练';
  }

  /* ---------------- 损失曲线 ---------------- */
  function renderCurve() {
    var wrap = $('curveSvgWrap'), H = S.history;
    var w = 720, h = 250, L = 58, R = 18, T = 18, B = 34;
    if (H.length < 1) {
      wrap.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
        '<line x1="' + L + '" y1="' + (h - B) + '" x2="' + (w - R) + '" y2="' + (h - B) + '" stroke="#cbd5e1"/>' +
        '<text x="' + (w / 2) + '" y="' + (h / 2) + '" text-anchor="middle" font-size="13" fill="#94a3b8">开始训练后这里会实时绘制损失曲线</text></svg>';
      $('curveStats').textContent = '等待训练数据…';
      return;
    }
    var logMode = $('logScale').checked;
    var vals = H.map(function (p) { return Math.max(p.loss, 1e-12); });
    var maxV = Math.max.apply(null, vals), minV = Math.min.apply(null, vals);
    if (maxV <= 0) maxV = 1;
    var yLo, yHi, yOf;
    if (logMode) {
      var loExp = Math.floor(Math.log10(Math.max(minV, 1e-12)));
      var hiExp = Math.ceil(Math.log10(maxV));
      if (hiExp - loExp < 1) hiExp = loExp + 1;
      yLo = Math.pow(10, loExp); yHi = Math.pow(10, hiExp);
      yOf = function (v) { return T + (h - T - B) * (1 - (Math.log10(Math.max(v, yLo)) - loExp) / (hiExp - loExp)); };
    } else {
      yLo = 0; yHi = maxV * 1.08 || 1;
      yOf = function (v) { return T + (h - T - B) * (1 - (v - yLo) / (yHi - yLo)); };
    }
    var xOf = function (e) { return L + (w - L - R) * (H.length < 2 ? 1 : (e - H[0].e) / Math.max(1, H[H.length - 1].e - H[0].e)); };
    var svg = ['<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">'];
    svg.push('<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6366f1" stop-opacity="0.22"/><stop offset="100%" stop-color="#6366f1" stop-opacity="0.01"/></linearGradient></defs>');
    var ticks = 5, g;
    for (g = 0; g <= ticks; g++) {
      var yy = T + (h - T - B) * g / ticks;
      var tv = logMode ? yHi * Math.pow(yLo / yHi, g / ticks) : yHi * (1 - g / ticks);
      svg.push('<line x1="' + L + '" y1="' + yy + '" x2="' + (w - R) + '" y2="' + yy + '" stroke="#eef2f7" stroke-width="1"/>');
      svg.push('<text x="' + (L - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + fmt(tv, tv < 0.01 ? 3 : 3) + '</text>');
    }
    var xTicks = 5;
    for (g = 0; g <= xTicks; g++) {
      var xx = L + (w - L - R) * g / xTicks;
      var ev = Math.round(H[0].e + (H[H.length - 1].e - H[0].e) * g / xTicks);
      svg.push('<text x="' + xx + '" y="' + (h - 12) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + ev + '</text>');
      svg.push('<line x1="' + xx + '" y1="' + (h - B) + '" x2="' + xx + '" y2="' + (h - B + 4) + '" stroke="#cbd5e1"/>');
    }
    svg.push('<line x1="' + L + '" y1="' + (h - B) + '" x2="' + (w - R) + '" y2="' + (h - B) + '" stroke="#cbd5e1"/>');
    var pts = H.map(function (p, idx) { return xOf(p.e).toFixed(2) + ',' + yOf(vals[idx]).toFixed(2); });
    var firstX = xOf(H[0].e).toFixed(2), lastX = xOf(H[H.length - 1].e).toFixed(2);
    svg.push('<polygon points="' + firstX + ',' + (h - B) + ' ' + pts.join(' ') + ' ' + lastX + ',' + (h - B) + '" fill="url(#areaGrad)"/>');
    svg.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#4f46e5" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>');
    var last = H[H.length - 1];
    svg.push('<circle cx="' + xOf(last.e) + '" cy="' + yOf(Math.max(last.loss, 1e-12)) + '" r="4.5" fill="#4f46e5" stroke="#fff" stroke-width="2"/>');
    svg.push('<text x="' + (w - R - 4) + '" y="' + (T + 13) + '" text-anchor="end" font-size="11" font-weight="600" fill="#4f46e5">loss = ' + fmt(last.loss, 6) + '</text>');
    svg.push('</svg>');
    wrap.innerHTML = svg.join('');
    var best = Math.min.apply(null, vals);
    $('curveStats').textContent = '共 ' + H.length + ' 轮 ｜ 初始 ' + fmt(H[0].loss, 6) + ' → 当前 ' + fmt(last.loss, 6) + ' ｜ 最低 ' + fmt(best, 6);
  }

  /* ---------------- 指标 / 日志 / 预测 ---------------- */
  function renderMetrics() {
    $('mEpoch').textContent = S.epoch;
    var last = S.history.length ? S.history[S.history.length - 1].loss : null;
    $('mLoss').textContent = last == null ? '—' : fmt(last, 6);
    $('mBest').textContent = S.history.length ? fmt(Math.min.apply(null, S.history.map(function (p) { return p.loss; })), 6) : '—';
    var pct = Math.min(100, (S.epoch / Math.max(1, readConfig().epochs)) * 100);
    $('progressBar').style.width = pct + '%';
    $('logCount').textContent = S.history.length + ' 条';
  }
  function initLogTable() {
    $('logTable').innerHTML = '<thead><tr><th>Epoch</th><th>Loss</th><th>Δ Loss</th></tr></thead><tbody></tbody>';
  }
  function appendLogRow(loss, prev) {
    var body = $('logTable').querySelector('tbody');
    if (!body) return;
    var tr = document.createElement('tr');
    var d = prev == null ? '—' : fmt(loss - prev, 6);
    tr.innerHTML = '<td>' + S.epoch + '</td><td>' + fmt(loss, 6) + '</td><td style="color:' + (prev != null && loss < prev ? '#059669' : '#94a3b8') + '">' + d + '</td>';
    body.appendChild(tr);
    while (body.children.length > 160) body.removeChild(body.firstChild);
  }
  function renderPredictions() {
    if (!S.epoch) {
      $('predWrap').innerHTML = '<div class="empty">训练后展示每个样本的预测值与目标值。</div>';
      return;
    }
    var data = S.dataset, c = readConfig(), outN = c.sizes[c.sizes.length - 1];
    var html = '<table class="data-table"><thead><tr><th>#</th><th>输入 x</th><th>预测 a⁽ᴸ⁾</th><th>目标 t</th><th>误差</th></tr></thead><tbody>';
    data.forEach(function (s, i) {
      var a = S.net.predict(s.x);
      var err = 0;
      for (var j = 0; j < outN; j++) err += Math.abs(a[j] - s.t[j]);
      html += '<tr><td class="row-idx">' + (i + 1) + '</td><td>' + s.x.map(function (v) { return fmt(v, 2); }).join(', ') + '</td>' +
        '<td style="color:#4f46e5;font-weight:600">' + a.map(function (v) { return fmt(v, 4); }).join(', ') + '</td>' +
        '<td>' + s.t.map(function (v) { return fmt(v, 2); }).join(', ') + '</td>' +
        '<td>' + fmt(err, 4) + '</td></tr>';
    });
    $('predWrap').innerHTML = html + '</tbody></table>';
  }

  /* ---------------- 训练控制 ---------------- */
  function stopTraining() {
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = null; S.running = false; S.paused = false;
    $('btnTrain').disabled = false; $('btnTrain').textContent = '▶ 开始训练';
    $('btnPause').disabled = true; $('btnPause').textContent = '⏸ 暂停';
  }
  function resetTraining(keepNet) {
    stopTraining();
    S.history = []; S.epoch = 0; S.stepCache = null; S.stepBack = null; S.lastClip = 1;
    initLogTable();
    $('btnBackward').disabled = true; $('btnApplyStep').disabled = true;
    $('stepView').innerHTML = '<div class="empty">请选择样本后点击「① 前向传播」，逐层查看 z = W·a + b 与 a = f(z) 的数值；再点击「② 反向传播」查看误差信号 δ 与梯度。</div>';
    renderMetrics(); renderCurve(); renderPredictions();
    renderNetworkSVG();
  }
  function finishTraining(msg) {
    stopTraining();
    renderParamEditor();
    renderAll(false);
    renderPredictions();
    status(msg || ('训练完成：共 ' + S.epoch + ' 轮，最终损失 ' + fmt(S.history[S.history.length - 1].loss, 6) + '。可在下方查看每个样本的预测结果。'));
  }
  function trainOneEpoch(cfg, data) {
    var prev = S.history.length ? S.history[S.history.length - 1].loss : null;
    var r = S.net.epoch(data, cfg.lr, { optimizer: cfg.optimizer, gradClip: cfg.gradClip });
    if (!Number.isFinite(r.loss)) throw new Error('损失发散（NaN / Infinity），请降低学习率或检查参数与数据');
    S.lastClip = r.clipScale;
    S.epoch++;
    S.history.push({ e: S.epoch, loss: r.loss });
    appendLogRow(r.loss, prev);
    if (window.BPLab && typeof window.BPLab.onEpoch === 'function') {
      try { window.BPLab.onEpoch(S.epoch); } catch (e) { /* 实验台失败不影响主训练 */ }
    }
    return r;
  }
  function loop(data) {
    if (!S.running || S.paused) return;
    var cfg = readConfig();  // 每帧读取：训练中调整学习率 / 循环次数可即时生效
    try {
      for (var s = 0; s < cfg.speed && S.epoch < cfg.epochs; s++) trainOneEpoch(cfg, data);
      renderMetrics(); renderCurve(); renderNetworkSVG();
      if (S.epoch >= cfg.epochs) {
        finishTraining();
      } else {
        S.raf = requestAnimationFrame(function () { loop(data); });
      }
    } catch (err) {
      stopTraining();
      renderParamEditor();
      renderAll(false);
      toast(err.message, true);
      status('训练中断：' + err.message);
    }
  }
  function startTraining() {
    if (S.running && !S.paused) return;
    var data = collectDatasetSafely(); if (!data) return;
    if (S.paused) {
      S.paused = false; S.running = true;
      $('btnPause').textContent = '⏸ 暂停';
      $('btnTrain').disabled = true;
      $('btnPause').disabled = false;
      status('继续训练中…');
      S.raf = requestAnimationFrame(function () { loop(data); });
      return;
    }
    var cfg = readConfig();
    if (S.epoch >= cfg.epochs) {
      toast('已达到设定的循环次数：可调大 Epochs 继续，或点「重置训练」从头开始', true);
      return;
    }
    S.dataset = data;
    S.running = true; S.paused = false;
    $('btnTrain').disabled = true;
    $('btnPause').disabled = false;
    $('btnPause').textContent = '⏸ 暂停';
    status('训练中… 每帧 ' + cfg.speed + ' 轮，目标 ' + cfg.epochs + ' 轮（已训练 ' + S.epoch + ' 轮，可随时暂停）。');
    S.raf = requestAnimationFrame(function () { loop(data); });
  }
  function collectDatasetSafely() {
    try {
      var data = collectDataset();
      var c = readConfig();
      if (data[0].x.length !== c.sizes[0] || data[0].t.length !== c.sizes[c.sizes.length - 1]) {
        throw new Error('样本维度与网络输入/输出层不一致，请检查节点数设置');
      }
      return data;
    } catch (err) { toast(err.message, true); return null; }
  }

  /* ---------------- 单步推导 ---------------- */
  function vecRow(label, arr, cls) {
    return '<div class="vec-row"><div class="vec-label">' + label + '</div>' + chips(arr, cls) + '</div>';
  }
  function matrixTable(M, label, lr) {
    var isDelta = lr != null;
    var html = '<div class="vec-row"><div class="vec-label">' + label + '</div><div class="matrix-wrap"><table class="data-table" style="width:auto"><tbody>';
    M.forEach(function (row, j) {
      html += '<tr><td class="row-idx">j' + (j + 1) + '</td>' + row.map(function (v) {
        return '<td><span class="chip ' + (isDelta ? 'delta' : 'gray') + '">' + fmt(isDelta ? -lr * v : v) + '</span></td>';
      }).join('') + '</tr>';
    });
    return html + '</tbody></table></div></div>';
  }
  function renderStepForward() {
    var c = readConfig(), s = S.dataset[+$('sampleSel').value] || S.dataset[0];
    var cache = S.stepCache;
    var html = '<div class="step-block"><h3>① 前向传播 · 样本 #' + ((+$('sampleSel').value) + 1) + '</h3>' +
      '<div class="formula">a⁽⁰⁾ = x，逐层计算 z⁽ˡ⁾ = W⁽ˡ⁾a⁽ˡ⁻¹⁾ + b⁽ˡ⁾，a⁽ˡ⁾ = fₗ(z⁽ˡ⁾)</div>' +
      vecRow('输入 a⁽⁰⁾ = x', cache.a[0], 'gray') +
      vecRow('目标 t', s.t, 'alt');
    for (var l = 1; l <= S.net.L; l++) {
      var an = E.ACT[c.activations[l - 1]].label;
      html += vecRow('z⁽' + sup(l) + '⁾ = W a + b', cache.z[l]);
      html += vecRow('a⁽' + sup(l) + '⁾ = ' + esc(an) + '(z)', cache.a[l], 'alt');
    }
    var lv = S.net.lossOf(cache.a[S.net.L], s.t);
    html += '<div class="step-note">输出层结果 a⁽ᴸ⁾ = [' + cache.a[S.net.L].map(function (v) { return fmt(v); }).join(', ') +
      ']，损失 L = ' + fmt(lv, 6) + '（' + esc(E.LOSS[c.loss].label) + '）</div></div>';
    $('stepView').innerHTML = html;
  }
  function renderStepBackward() {
    var c = readConfig(), bk = S.stepBack, L = S.net.L;
    var html = '<div class="step-block"><h3>② 反向传播 · 误差信号 δ 与梯度</h3>' +
      '<div class="formula">δ⁽ᴸ⁾ = ∂L/∂a⁽ᴸ⁾ ⊙ f′(z⁽ᴸ⁾)；δ⁽ˡ⁾ = (W⁽ˡ⁺¹⁾ᵀδ⁽ˡ⁺¹⁾) ⊙ f′(z⁽ˡ⁾)</div>';
    if (bk.paired) {
      html += '<div class="step-note">当前输出层为 ' + esc(E.ACT[c.activations[L - 1]].label) + ' + ' + esc(E.LOSS[c.loss].label) +
        '，采用标准解析化简：δ⁽ᴸ⁾ = a⁽ᴸ⁾ − t（自动跳过 f′ 相乘，数值更稳定）。</div>';
    } else if (c.activations[L - 1] === 'softmax') {
      html += '<div class="step-note">Softmax 输出层使用雅可比矩阵：δᵢ = aᵢ(dᵢ − Σⱼaⱼdⱼ)，其中 d = ∂L/∂a。</div>';
    }
    for (var l = L; l >= 1; l--) {
      html += vecRow('δ⁽' + sup(l) + '⁾', bk.deltas[l], 'delta');
    }
    html += '<div class="step-note">梯度由 δ 与上一层激活值外积得到：∂L/∂W⁽ˡ⁾ = δ⁽ˡ⁾(a⁽ˡ⁻¹⁾)ᵀ，∂L/∂b⁽ˡ⁾ = δ⁽ˡ⁾。</div></div>';
    html += '<div class="step-block"><h3>梯度矩阵与参数更新量（η = ' + fmt(c.lr, 6) + '，' + esc($('optimizer').selectedOptions[0].textContent) + '）</h3>';
    for (var k = 0; k < L; k++) {
      html += matrixTable(bk.gradW[k], '∂L/∂W⁽' + sup(k + 1) + '⁾');
      html += vecRow('∂L/∂b⁽' + sup(k + 1) + '⁾', bk.gradB[k], 'gray');
      html += matrixTable(bk.gradW[k], 'ΔW⁽' + sup(k + 1) + '⁾ = −η·g', c.lr);
    }
    html += '<div class="step-note">ΔW 为 SGD 下的参考更新量；若选择 Momentum / Adam，实际写入的增量会由优化器状态另行计算。' +
      '单步模式按当前选中的<b>单个样本</b>梯度更新一次；自动训练则使用全部样本梯度的平均值（全批量 GD）。' +
      '点击「③ 应用这次更新」即可看到权重变化与新一轮损失。</div></div>';
    $('stepView').innerHTML = html;
  }

  /* ---------------- 重建网络 / 全局刷新 ---------------- */
  function rebuildNetwork() {
    stopTraining();
    var c = readConfig();
    S.net = new E.Network({
      sizes: c.sizes, activations: c.activations, loss: c.loss,
      initMethod: c.initMethod, seed: c.seed
    });
    resetTraining(false);
    renderAll(true);
  }
  function renderAll(withEditors) {
    renderSampleOptions();
    if (withEditors) { renderParamEditor(); renderDataset(); }
    updateSummary();
    renderNetworkSVG();
    renderMetrics();
    renderCurve();
    renderPredictions();
    viz('full');           // 结构 / 参数 / 数据变化后同步刷新传播全景
    labRefresh();
  }
  /* 与新可视化模块的接口：BPViz 由 js/visualizer.js 提供 */
  function viz(scope, jump) {
    var V = window.BPViz;
    if (!V || typeof V.build !== 'function') return;
    try { V.build(scope, jump); }
    catch (err) { if (window.console) console.error('[viz] ' + err.message); }
  }
  function labRefresh() {
    var L = window.BPLab;
    if (!L || typeof L.drawBoundary !== 'function') return;
    try { L.drawBoundary(); }
    catch (err) { if (window.console) console.error('[lab] ' + err.message); }
  }
  function onStructureChange() {
    var c = readConfig();
    fitDataset(c.sizes[0], c.sizes[c.sizes.length - 1]);
    rebuildNetwork();
  }

  /* ---------------- 配置导入导出 ---------------- */
  function exportConfig() {
    var c = readConfig(), p = S.net.getParams();
    var obj = {
      version: 1, sizes: c.sizes, hidden: S.hidden, outAct: c.activations[c.activations.length - 1],
      loss: c.loss, lr: c.lr, epochs: c.epochs, speed: c.speed, optimizer: c.optimizer,
      initMethod: c.initMethod, seed: c.seed, gradClip: c.gradClip,
      dataset: collectDatasetSafely() || S.dataset, weights: p.weights, biases: p.biases
    };
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bp-config.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('配置已导出为 bp-config.json');
  }
  function importConfig(text) {
    var o = JSON.parse(text);
    if (!o.hidden || !Array.isArray(o.hidden) || !o.dataset) throw new Error('配置格式不正确');
    stopTraining();
    S.hidden = o.hidden.map(function (h) { return { n: clampInt(h.n, 1, 12), act: E.ACT[h.act] ? h.act : 'sigmoid' }; });
    $('inNodes').value = clampInt(o.sizes[0], 1, 12);
    $('outNodes').value = clampInt(o.sizes[o.sizes.length - 1], 1, 12);
    fillSelect($('outAct'), ACT_KEYS, E.ACT, true, o.outAct);
    $('lossFn').value = E.LOSS[o.loss] ? o.loss : 'mse';
    ['lr', 'epochs', 'speed', 'seed', 'gradClip'].forEach(function (k) { if (o[k] != null) $(k).value = o[k]; });
    if (o.optimizer) $('optimizer').value = o.optimizer;
    if (o.initMethod) $('initMethod').value = o.initMethod;
    S.dataset = o.dataset.map(function (s) { return { x: s.x.map(Number), t: s.t.map(Number) }; });
    var c = readConfig();
    S.net = new E.Network({ sizes: c.sizes, activations: c.activations, loss: c.loss, initMethod: c.initMethod, seed: c.seed });
    if (o.weights && o.biases) S.net.setParams(o.weights, o.biases);
    renderHidden(); resetTraining(false); renderAll(true);
    toast('配置导入成功');
  }

  /* ---------------- 理论表格 ---------------- */
  function renderTheory() {
    var h = '<table class="data-table"><thead><tr><th>函数</th><th>表达式 / 说明</th></tr></thead><tbody>';
    ACT_KEYS.forEach(function (k) { h += '<tr><td><b>' + esc(E.ACT[k].label) + '</b></td><td>' + esc(E.ACT[k].desc) + '</td></tr>'; });
    $('actTable').innerHTML = h + '</tbody></table>';
    var l = '<table class="data-table"><thead><tr><th>损失函数</th><th>表达式 / 说明</th></tr></thead><tbody>';
    LOSS_KEYS.forEach(function (k) { l += '<tr><td><b>' + esc(E.LOSS[k].label) + '</b></td><td>' + esc(E.LOSS[k].desc) + '</td></tr>'; });
    $('lossTable').innerHTML = l + '</tbody></table>';
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('btnAddLayer').addEventListener('click', function () {
      if (S.hidden.length >= 5) { toast('演示最多支持 5 个隐藏层', true); return; }
      S.hidden.push({ n: 3, act: 'sigmoid' });
      renderHidden(); onStructureChange();
    });
    ['inNodes', 'outNodes'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        this.value = clampInt(this.value, 1, 12);
        onStructureChange();
      });
    });
    $('outAct').addEventListener('change', function () { onStructureChange(); });
    $('lossFn').addEventListener('change', function () {
      stopTraining();
      S.net.loss = this.value;
      resetTraining(false); renderAll(false);
      toast('损失函数已切换，历史曲线已清空');
    });
    $('initMethod').addEventListener('change', reinit);
    $('seed').addEventListener('change', reinit);
    $('btnReinit').addEventListener('click', reinit);

    $('btnLoadPreset').addEventListener('click', function () {
      var p = PRESETS[$('preset').value];
      stopTraining();
      S.hidden = p.hidden.map(function (h) { return { n: h.n, act: h.act }; });
      S.dataset = p.data.map(function (s) { return { x: s.x.slice(), t: s.t.slice() }; });
      $('inNodes').value = p.sizes[0];
      $('outNodes').value = p.sizes[p.sizes.length - 1];
      fillSelect($('outAct'), ACT_KEYS, E.ACT, true, p.outAct);
      $('lossFn').value = p.loss;
      $('lr').value = p.lr; $('epochs').value = p.epochs; $('optimizer').value = p.optimizer;
      renderHidden();
      rebuildNetwork();
      toast('已载入「' + p.label + '」示例，结构与参数已自动匹配');
    });
    $('btnAddRow').addEventListener('click', function () {
      var c = readConfig();
      S.dataset = collectDatasetSafely() || S.dataset;
      S.dataset.push({ x: new Array(c.sizes[0]).fill(0), t: new Array(c.sizes[c.sizes.length - 1]).fill(0) });
      renderDataset(); viz('full'); toast('已添加一个样本，请填写数值');
    });
    $('btnDelRow').addEventListener('click', function () {
      if (S.dataset.length <= 1) { toast('至少保留一个样本', true); return; }
      S.dataset = collectDatasetSafely() || S.dataset;
      S.dataset.pop(); renderDataset(); viz('full');
    });
    $('datasetWrap').addEventListener('change', function (e) {
      if (e.target.matches('input.dx, input.dt')) { S.dataset = collectDataset(); viz('full'); }
    });

    $('btnApplyParams').addEventListener('click', applyParamEditor);
    $('btnSyncParams').addEventListener('click', function () { renderParamEditor(); toast('已读取网络当前权重与偏置'); });
    $('btnRandomize').addEventListener('click', reinit);
    $('showAct').addEventListener('change', renderNetworkSVG);
    $('logScale').addEventListener('change', renderCurve);

    $('btnTrain').addEventListener('click', startTraining);
    $('btnPause').addEventListener('click', function () {
      if (!S.running) return;
      if (!S.paused) {
        S.paused = true;
        if (S.raf) cancelAnimationFrame(S.raf);
        this.textContent = '▶ 继续训练';
        $('btnTrain').disabled = true;
        status('已暂停于第 ' + S.epoch + ' 轮，可继续训练或单步推进。');
      } else {
        startTraining();
      }
    });
    $('btnStepEpoch').addEventListener('click', function () {
      var d = collectDatasetSafely(); if (!d) return;
      stopTraining(); S.dataset = d;
      try {
        var c = readConfig();
        if (S.history.length >= c.epochs) { toast('已达到设定的循环次数，可调大 Epochs', true); return; }
        trainOneEpoch(c, d);
        renderMetrics(); renderCurve(); renderNetworkSVG(); renderParamEditor(); renderPredictions();
        viz('full');
        status('单步完成：第 ' + S.epoch + ' 轮，损失 ' + fmt(S.history[S.history.length - 1].loss, 6) + '。');
      } catch (err) { toast(err.message, true); }
    });
    $('btnReset').addEventListener('click', function () {
      resetTraining(false);
      viz('full');
      status('训练记录已重置，当前权重与偏置保持不变。若想恢复初始参数，请使用左侧「重新初始化」。');
    });

    $('btnForward').addEventListener('click', function () {
      var d = collectDatasetSafely(); if (!d) return;
      S.dataset = d;
      var s = S.dataset[+$('sampleSel').value] || S.dataset[0];
      try {
        S.stepCache = S.net.forward(s.x);
        S.stepBack = null;
        renderStepForward();
        $('btnBackward').disabled = false; $('btnApplyStep').disabled = true;
        viz('forward');
        status('前向传播完成：可查看每一层的 z 与 a，继续点击「② 反向传播」。');
      } catch (err) { toast(err.message, true); }
    });
    $('btnBackward').addEventListener('click', function () {
      if (!S.stepCache) { toast('请先执行前向传播', true); return; }
      var s = S.dataset[+$('sampleSel').value] || S.dataset[0];
      try {
        S.stepBack = S.net.backward(S.stepCache, s.t);
        renderStepBackward();
        $('btnApplyStep').disabled = false;
        viz('full', 'delta-out');
        status('反向传播完成：δ、梯度与更新量已计算，点击「③ 应用这次更新」写入权重。');
      } catch (err) { toast(err.message, true); }
    });
    $('btnApplyStep').addEventListener('click', function () {
      if (!S.stepBack) return;
      var c = readConfig();
      S.net.clipGradients(S.stepBack.gradW, S.stepBack.gradB, c.gradClip);
      S.net.apply(S.stepBack.gradW, S.stepBack.gradB, c.lr, c.optimizer);
      var s = S.dataset[+$('sampleSel').value] || S.dataset[0];
      var newLoss = S.net.lossOf(S.net.forward(s.x).a[S.net.L], s.t);
      S.epoch++;
      var prev = S.history.length ? S.history[S.history.length - 1].loss : null;
      S.history.push({ e: S.epoch, loss: newLoss });
      appendLogRow(newLoss, prev);
      renderMetrics(); renderCurve(); renderNetworkSVG(); renderParamEditor(); renderPredictions();
      $('btnBackward').disabled = true; $('btnApplyStep').disabled = true;
      $('stepView').innerHTML = '<div class="step-block"><h3>③ 参数已更新</h3>' +
        '<div class="step-note">按该样本梯度更新一次后，损失 L = <b>' + fmt(newLoss, 6) +
        '</b>。左侧权重表、结构图、传播全景与损失曲线均已同步刷新。可再次点击「① 前向传播」观察下一轮变化。</div></div>';
      viz('full');
      status('单样本参数更新完成，当前损失 ' + fmt(newLoss, 6) + '。');
    });
    $('sampleSel').addEventListener('change', function () {
      S.stepCache = null; S.stepBack = null;
      $('btnBackward').disabled = true; $('btnApplyStep').disabled = true;
      viz('full');
    });

    $('btnExport').addEventListener('click', exportConfig);
    $('btnImport').addEventListener('click', function () { $('modalMask').hidden = false; $('importText').value = ''; });
    $('btnModalCancel').addEventListener('click', function () { $('modalMask').hidden = true; });
    $('btnModalOk').addEventListener('click', function () {
      try { importConfig($('importText').value); $('modalMask').hidden = true; }
      catch (err) { toast('导入失败：' + err.message, true); }
    });
    $('modalMask').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });

    function reinit() {
      stopTraining();
      var c = readConfig();
      S.net.init(c.initMethod, c.seed);
      resetTraining(false);
      renderAll(true);
      status('已按 ' + $('initMethod').selectedOptions[0].textContent + '（种子 ' + c.seed + '）重新初始化全部权重与偏置。');
      toast('权重与偏置已重新初始化');
    }
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    fillSelect($('outAct'), ACT_KEYS, E.ACT, true, 'sigmoid');
    fillSelect($('lossFn'), LOSS_KEYS, E.LOSS, true, 'bce');
    // fillSelect 对 LOSS 字典同样适用（含 label 字段），但会跳过 softmax 键，这里显式重建
    $('lossFn').innerHTML = LOSS_KEYS.map(function (k) {
      return '<option value="' + k + '"' + (k === 'bce' ? ' selected' : '') + '>' + esc(E.LOSS[k].label) + '</option>';
    }).join('');
    var c = readConfig();
    S.net = new E.Network({ sizes: c.sizes, activations: c.activations, loss: c.loss, initMethod: c.initMethod, seed: c.seed });
    renderHidden();
    initLogTable();
    bind();
    renderTheory();
    resetTraining(false);
    renderAll(true);
    status('默认载入 XOR 示例。可直接开始训练，或用下方的传播全景与逐环节演示观察完整的 BP 过程。');
  }

  /* 供 js/visualizer.js 使用的只读接口（计算快照由可视化模块自行生成） */
  window.BPApp = {
    state: S,
    net: function () { return S.net; },
    config: readConfig,
    dataset: function () { return S.dataset; },
    collect: collectDatasetSafely,
    fmt: fmt, sup: sup, esc: esc, chips: chips, paramStr: paramStr,
    toast: toast, status: status
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
