/* =============================================================
 * 拓展实验台：决策边界 / 函数曲线 / 优化器对比 / 过拟合与正则
 * 依赖 window.BPEngine(engine.js) 与 window.BPApp(app.js)
 * ============================================================= */
(function () {
  'use strict';
  var E = window.BPEngine, A = window.BPApp;
  var $ = function (id) { return document.getElementById(id); };
  var EPS = 1e-9;
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  function fmt(v, d) {
    if (!Number.isFinite(v)) return '—';
    d = d == null ? 4 : d;
    return Number(v).toFixed(d);
  }
  function seeded(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function g2(id) {
    var c = $(id);
    if (!c || !c.getContext) return null;
    try { return c.getContext('2d'); } catch (e) { return null; }
  }
  function white(g, c) {
    if (!g) return;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
  }
  function poly(g, pts, color, width, dash) {
    if (!g || pts.length < 2) return;
    g.save();
    if (dash) g.setLineDash(dash);
    g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) g.moveTo(pts[i][0], pts[i][1]); else g.lineTo(pts[i][0], pts[i][1]);
    }
    g.strokeStyle = color; g.lineWidth = width || 2; g.lineJoin = 'round';
    g.stroke(); g.restore();
  }
  function txt(g, s, x, y, color, size, align) {
    if (!g) return;
    g.fillStyle = color || '#475569';
    g.font = (size || 11) + 'px -apple-system, "Microsoft YaHei", sans-serif';
    g.textAlign = align || 'left';
    g.fillText(s, x, y);
  }
  function axes(g, W, H, box, xt, yt, xlab, ylab) {
    if (!g) return;
    var l = box.l, t = box.t, r = box.l + box.w, b = box.t + box.h;
    g.strokeStyle = '#e2e8f0'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(l, t); g.lineTo(l, b); g.lineTo(r, b); g.stroke();
    g.strokeStyle = '#f1f5f9';
    for (var i = 0; i <= 4; i++) {
      var yy = t + box.h * i / 4, xx = l + box.w * i / 4;
      g.beginPath(); g.moveTo(l, yy); g.lineTo(r, yy); g.stroke();
      g.beginPath(); g.moveTo(xx, t); g.lineTo(xx, b); g.stroke();
    }
    for (var k = 0; k <= 4; k++) {
      txt(g, xt(k), l + box.w * k / 4, b + 16, '#94a3b8', 10, 'center');
      txt(g, yt(k), l - 6, b - box.h * k / 4 + 3, '#94a3b8', 10, 'right');
    }
    if (xlab) txt(g, xlab, l + box.w / 2, H - 4, '#94a3b8', 10, 'center');
    if (ylab) { g.save(); g.translate(11, t + box.h / 2); g.rotate(-Math.PI / 2); txt(g, ylab, 0, 0, '#94a3b8', 10, 'center'); g.restore(); }
  }
  var CLS = [[59, 130, 246], [249, 115, 22], [16, 185, 129], [168, 85, 247]];
  function mixColor(out) {
    var s = 0, i;
    for (i = 0; i < out.length; i++) s += Math.max(0, out[i]);
    if (!(s > 0)) return 'rgba(241,245,249,0.9)';
    var r = 0, gg = 0, b = 0;
    for (i = 0; i < CLS.length; i++) {
      var w = i < out.length ? Math.max(0, out[i]) / s : 0;
      r += w * CLS[i][0]; gg += w * CLS[i][1]; b += w * CLS[i][2];
    }
    return 'rgba(' + (r | 0) + ',' + (gg | 0) + ',' + (b | 0) + ',0.88)';
  }
  function heatColor(v, lo, hi) {
    var u = hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5;
    var r, g, b;
    if (u < 0.5) { var k = u * 2; r = 219 + (255 - 219) * k; g = 234 + (255 - 234) * k; b = 254 + (255 - 254) * k; }
    else { var q = (u - 0.5) * 2; r = 255 - (255 - 253) * q; g = 255 - (255 - 186) * q; b = 255 - (255 - 120) * q; }
    if (u > 0.85) { r = 253 - (u - 0.85) / 0.15 * 16; g = 186 - (u - 0.85) / 0.15 * 90; b = 120 - (u - 0.85) / 0.15 * 60; }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  /* ==================== ① 决策边界 ==================== */
  var bd = { grid: 48, tick: 0, range: null, classCnt: 2 };
  function isBinaryTargets(data) {
    return data.every(function (s) {
      return s.t.length === 1 ? (s.t[0] === 0 || s.t[0] === 1) :
        s.t.filter(function (v) { return v > 0.5; }).length === 1;
    });
  }
  function drawBoundary() {
    var c = $('bdCanvas'), g = g2('bdCanvas');
    if (!c || !g) return;
    var net = A.net(), data = A.dataset();
    if (!net || !data || !data.length) return;
    var W = c.width, H = c.height, pad = 26;
    white(g, c);
    if (net.sizes[0] !== 2) {
      txt(g, '决策边界需要 2 维输入', W / 2, H / 2, '#94a3b8', 15, 'center');
      txt(g, '当前输入层为 ' + net.sizes[0] + ' 个节点，可在左侧改为 2 后重新生成', W / 2, H / 2 + 24, '#cbd5e1', 11, 'center');
      $('bdNote').textContent = '提示：把输入层节点数设为 2，即可在此看到完整的分类 / 回归边界。';
      $('bdLegend').innerHTML = ''; $('bdStats').innerHTML = '';
      return;
    }
    var xs = data.map(function (s) { return s.x[0]; }), ys = data.map(function (s) { return s.x[1]; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    var px = (xmax - xmin) * 0.18 || 1, py = (ymax - ymin) * 0.18 || 1;
    xmin -= px; xmax += px; ymin -= py; ymax += py;
    bd.range = { xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax, pad: pad, w: W - pad * 2, h: H - pad * 2 };
    var ts = data.map(function (s) { return s.t[0]; });
    var vmin = Math.min.apply(null, ts), vmax = Math.max.apply(null, ts);
    var cls = isBinaryTargets(data) && net.sizes[net.L] > 1 || (net.sizes[net.L] === 1 && isBinaryTargets(data));
    bd.classCnt = net.sizes[net.L];
    var N = bd.grid, cw = bd.range.w / N, ch = bd.range.h / N;
    for (var i = 0; i < N; i++) {
      for (var j = 0; j < N; j++) {
        var x1 = xmin + (i + 0.5) / N * (xmax - xmin);
        var x2 = ymin + (j + 0.5) / N * (ymax - ymin);
        var out = net.predict([x1, x2]);
        g.fillStyle = cls ? mixColor(out) : heatColor(out[0], vmin, vmax);
        g.fillRect(pad + i * cw, pad + (N - 1 - j) * ch, cw + 1, ch + 1);
      }
    }
    // 样本点
    data.forEach(function (s) {
      var sx = pad + (s.x[0] - xmin) / (xmax - xmin) * bd.range.w;
      var sy = pad + (H - pad * 2) - (s.x[1] - ymin) / (ymax - ymin) * bd.range.h;
      var ci = s.t.length === 1 ? (s.t[0] >= 0.5 ? 1 : 0) : s.t.indexOf(Math.max.apply(null, s.t));
      g.beginPath(); g.arc(sx, sy, 5.2, 0, Math.PI * 2);
      g.fillStyle = 'rgb(' + CLS[ci % CLS.length].join(',') + ')';
      g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
    });
    axes(g, W, H, { l: pad, t: pad, w: bd.range.w, h: bd.range.h },
      function (k) { return fmt(xmin + (xmax - xmin) * k / 4, 2); },
      function (k) { return fmt(ymin + (ymax - ymin) * k / 4, 2); }, 'x₁', 'x₂');
    // 图例与状态
    var lg = '';
    if (cls) {
      for (var q = 0; q < bd.classCnt; q++) {
        lg += '<div class="lg"><span class="sw" style="background:rgb(' + CLS[q % CLS.length].join(',') + ')"></span>类别 ' + q + '</div>';
      }
    } else {
      lg = '<div class="lg"><span class="sw" style="background:#dbeafe"></span>低预测值</div>' +
        '<div class="lg"><span class="sw" style="background:#fda878"></span>高预测值</div>';
    }
    lg += '<div class="lg"><span class="sw" style="background:#fff;border:2px solid #334155;border-radius:50%"></span>训练样本</div>';
    $('bdLegend').innerHTML = lg;
    var hist = A.state.history, last = hist.length ? hist[hist.length - 1] : null;
    $('bdStats').innerHTML = '输入维度：2<br>输出维度：' + net.sizes[net.L] + '<br>样本数：' + data.length +
      '<br>已训练：' + A.state.epoch + ' 轮<br>当前损失：' + (last ? fmt(last.loss, 5) : '—');
    $('bdNote').textContent = cls
      ? '色块为网络输出的概率分布（多类别按概率混合）；颜色越纯表示置信度越高。白边圆点是训练样本的真实类别。'
      : '色块为网络对平面各点的预测值（回归任务）；白边圆点是训练样本的真实值。';
  }
  function snapshotBoundary() {
    var src = $('bdCanvas'), c = document.createElement('canvas');
    if (!src) return;
    c.width = 160; c.height = 132;
    var g;
    try { g = c.getContext('2d'); } catch (e) { g = null; }
    if (g) { try { g.drawImage(src, 0, 0, c.width, c.height); } catch (e) { /* jsdom */ } }
    var wrap = $('bdSnaps');
    if (wrap.querySelector('.muted')) wrap.innerHTML = '';
    var item = document.createElement('div'); item.className = 'snap-item';
    item.appendChild(c);
    var lab = document.createElement('div'); lab.className = 'snap-label';
    var hist = A.state.history, last = hist.length ? hist[hist.length - 1] : null;
    lab.textContent = '第 ' + A.state.epoch + ' 轮 ｜ L = ' + (last ? fmt(last.loss, 4) : '—');
    item.appendChild(lab); wrap.insertBefore(item, wrap.firstChild);
    while (wrap.children.length > 6) wrap.removeChild(wrap.lastChild);
  }
  function onEpoch(epoch) {
    bd.tick++;
    if ($('bdFollow') && $('bdFollow').checked && bd.tick % 12 === 0) drawBoundary();
  }

  /* ==================== ② 函数曲线 ==================== */
  var ACT_FN = {
    sigmoid: { label: 'Sigmoid', f: function (z) { return 1 / (1 + Math.exp(-clamp(z, -60, 60))); } },
    tanh: { label: 'Tanh', f: function (z) { return Math.tanh(z); } },
    relu: { label: 'ReLU', f: function (z) { return Math.max(0, z); } },
    lrelu: { label: 'Leaky ReLU', f: function (z) { return z > 0 ? z : 0.01 * z; } },
    elu: { label: 'ELU', f: function (z) { return z > 0 ? z : Math.exp(clamp(z, -60, 60)) - 1; } },
    linear: { label: 'Linear', f: function (z) { return z; } }
  };
  var LOSS_FN = {
    mse: { label: 'MSE', f: function (a, t) { return 0.5 * (a - t) * (a - t); }, d: function (a, t) { return a - t; } },
    mae: { label: 'MAE', f: function (a, t) { return Math.abs(a - t); }, d: function (a, t) { return a > t ? 1 : (a < t ? -1 : 0); } },
    huber: { label: 'Huber', f: function (a, t) { var r = Math.abs(a - t); return r <= 1 ? 0.5 * r * r : r - 0.5; }, d: function (a, t) { return clamp(a - t, -1, 1); } },
    bce: { label: 'BCE', f: function (a, t) { var p = clamp(a, EPS, 1 - EPS); return -(t * Math.log(p) + (1 - t) * Math.log(1 - p)); }, d: function (a, t) { var p = clamp(a, EPS, 1 - EPS); return (p - t) / (p * (1 - p)); } },
    ce: { label: 'CE', f: function (a, t) { return -t * Math.log(clamp(a, EPS, 1)); }, d: function (a, t) { return -t / clamp(a, EPS, 1); } }
  };
  var fc = { kind: 'act', name: 'sigmoid', range: 3, target: 1, box: null, xmin: -3, xmax: 3, marker: null };
  function fillNames() {
    var names = fc.kind === 'act' ? ['sigmoid', 'tanh', 'relu', 'lrelu', 'elu', 'linear', 'softmax'] : ['mse', 'mae', 'huber', 'bce', 'ce'];
    $('fcName').innerHTML = names.map(function (n) {
      var label = fc.kind === 'act' ? (E.ACT[n] ? E.ACT[n].label : 'Softmax') : E.LOSS[n].label;
      return '<option value="' + n + '">' + label + '</option>';
    }).join('');
    fc.name = names[0];
    $('fcName').value = fc.name;
    $('fcTargetWrap').className = fc.kind === 'loss' ? '' : 'lab-hide';
  }
  function curveValue(x) {
    if (fc.name === 'softmax') {
      var e1 = Math.exp(clamp(x, -60, 60)), e2 = 1, e3 = 1, s = e1 + e2 + e3;
      return { y: e1 / s, d: (e1 / s) * (1 - e1 / s), extra: { a2: e2 / s, a3: e3 / s } };
    }
    if (fc.kind === 'act') {
      var F = ACT_FN[fc.name], a = F.f(x);
      var d;
      if (fc.name === 'relu' || fc.name === 'lrelu') d = x > 0 ? 1 : (fc.name === 'relu' ? 0 : 0.01);
      else if (fc.name === 'elu') d = x > 0 ? 1 : a + 1;
      else if (fc.name === 'linear') d = 1;
      else if (fc.name === 'sigmoid') d = a * (1 - a);
      else d = 1 - a * a;
      return { y: a, d: d };
    }
    var L = LOSS_FN[fc.name];
    return { y: L.f(x, fc.target), d: L.d(x, fc.target) };
  }
  function drawCurves(markerX) {
    var c = $('fcCanvas'), g = g2('fcCanvas');
    if (!c || !g) return;
    var W = c.width, H = c.height, pad = 42;
    white(g, c);
    var R = +$('fcRange').value || 3;
    var xmin = -R, xmax = R;
    if (fc.kind === 'loss' && (fc.name === 'bce' || fc.name === 'ce')) { xmin = 0; xmax = 1; }
    var box = { l: pad, t: 22, w: W - pad - 20, h: H - pad - 20 };
    fc.box = box; fc.xmin = xmin; fc.xmax = xmax;
    var N = 260, pts = [], dpts = [], extra = [], vals = [];
    for (var i = 0; i <= N; i++) {
      var x = xmin + (xmax - xmin) * i / N, v = curveValue(x);
      var px = box.l + box.w * i / N;
      pts.push([px, 0]); dpts.push([px, 0]); vals.push({ y: v.y, d: v.d, x: x });
      if (fc.name === 'softmax') extra.push([px, 0, v.extra.a2, v.extra.a3]);
    }
    var lo = Infinity, hi = -Infinity;
    vals.forEach(function (v) { lo = Math.min(lo, v.y, v.d); hi = Math.max(hi, v.y, v.d); });
    if (fc.name === 'softmax') extra.forEach(function (v) { lo = Math.min(lo, v[2], v[3]); hi = Math.max(hi, v[2], v[3]); });
    var m = (hi - lo) * 0.12 || 0.5; lo -= m; hi += m;
    var y2p = function (v) { return box.t + box.h - (v - lo) / (hi - lo) * box.h; };
    for (var k = 0; k <= N; k++) {
      pts[k][1] = y2p(vals[k].y); dpts[k][1] = y2p(vals[k].d);
      if (extra.length) { extra[k][1] = y2p(extra[k][2]); extra[k][4] = y2p(extra[k][3]); }
    }
    axes(g, W, H, box,
      function (i) { return fmt(xmin + (xmax - xmin) * i / 4, 1); },
      function (i) { return fmt(lo + (hi - lo) * i / 4, 2); },
      fc.kind === 'act' ? 'z（加权求和）' : 'a（预测值）', '函数值');
    // 零轴
    if (lo < 0 && hi > 0) {
      var zero = y2p(0);
      g.strokeStyle = '#cbd5e1'; g.setLineDash([4, 4]); g.beginPath();
      g.moveTo(box.l, zero); g.lineTo(box.l + box.w, zero); g.stroke(); g.setLineDash([]);
    }
    if (fc.name === 'softmax') {
      poly(g, pts, '#4f46e5', 2.4);
      poly(g, extra.map(function (v) { return [v[0], v[1]]; }), '#f97316', 2);
      poly(g, extra.map(function (v) { return [v[0], v[4]]; }), '#10b981', 2);
    } else {
      poly(g, dpts, '#f97316', 1.8, [6, 4]);
      poly(g, pts, '#4f46e5', 2.6);
      txt(g, '— f(·)', box.l + 8, box.t + 14, '#4f46e5', 11);
      txt(g, '-- f′(·)', box.l + 66, box.t + 14, '#f97316', 11);
    }
    if (markerX != null && markerX >= xmin && markerX <= xmax) {
      var mx = box.l + (markerX - xmin) / (xmax - xmin) * box.w;
      var mv = curveValue(markerX);
      g.strokeStyle = '#94a3b8'; g.setLineDash([3, 3]); g.beginPath();
      g.moveTo(mx, box.t); g.lineTo(mx, box.t + box.h); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(mx, y2p(mv.y), 4.5, 0, Math.PI * 2); g.fillStyle = '#4f46e5'; g.fill();
    }
    updateCurveInfo(markerX);
  }
  function updateCurveInfo(x) {
    var el = $('fcInfo');
    if (!el) return;
    var name = fc.name, label = fc.kind === 'act' ? (E.ACT[name] ? E.ACT[name].label : 'Softmax') : E.LOSS[name].label;
    var h = '<h4>' + label + '</h4>';
    var f, d, range;
    if (name === 'softmax') {
      f = 'aᵢ = eᶻⁱ / Σⱼ eᶻʲ'; d = '∂aᵢ/∂zᵢ = aᵢ(1 − aᵢ)';
      range = '输出向量，各分量 ∈ (0,1)，总和为 1';
      h += '<span class="formula">' + f + '</span><div>导数：<span class="formula">' + d + '</span></div>';
      h += '<div class="kv"><span>适用</span><b>多分类输出层</b></div>';
      if (x != null) {
        var v = curveValue(x);
        h += '<div class="kv"><span>z₁</span><b>' + fmt(x, 3) + '</b></div>' +
          '<div class="kv"><span>a₁</span><b>' + fmt(v.y, 4) + '</b></div>' +
          '<div class="kv"><span>a₂ = a₃</span><b>' + fmt(v.extra.a2, 4) + '</b></div>';
      }
      h += '<p class="hint">' + range + '。图中橙 / 绿线为另外两个分量（固定 z₂=z₃=0）。</p>';
      el.innerHTML = h; return;
    }
    if (fc.kind === 'act') {
      f = { sigmoid: 'f(z)=1/(1+e⁻ᶻ)', tanh: 'f(z)=tanh(z)', relu: 'f(z)=max(0,z)',
        lrelu: 'f(z)=z>0?z:0.01z', elu: 'f(z)=z>0?z:eᶻ−1', linear: 'f(z)=z' }[name];
      d = { sigmoid: 'f′=a(1−a)', tanh: 'f′=1−a²', relu: 'f′=z>0?1:0',
        lrelu: 'f′=z>0?1:0.01', elu: 'f′=z>0?1:a+1', linear: 'f′=1' }[name];
      range = { sigmoid: '输出 (0,1)，二分类 / 门控', tanh: '输出 (−1,1)，零中心',
        relu: '稀疏激活，隐藏层首选', lrelu: '缓解 ReLU 神经元死亡',
        elu: '负区平滑，缓解死亡 ReLU', linear: '恒等映射，回归输出' }[name];
    } else {
      f = { mse: 'L=½(a−t)²', mae: 'L=|a−t|', huber: '|r|≤1:½r²；否则 |r|−½',
        bce: 'L=−[t·ln a+(1−t)ln(1−a)]', ce: 'L=−t·ln a' }[name];
      d = { mse: '∂L/∂a=a−t', mae: '∂L/∂a=sign(a−t)', huber: '∂L/∂a=clip(a−t,−1,1)',
        bce: '∂L/∂a=(a−t)/(a(1−a))', ce: '∂L/∂a=−t/a' }[name];
      range = { mse: '平滑可导，对大误差敏感', mae: '对离群点鲁棒，零点不可导',
        huber: '兼顾 MSE 与 MAE 的优点', bce: '配合 Sigmoid 二分类', ce: '配合 Softmax 多分类' }[name];
      h += '<div class="kv"><span>目标值 t</span><b>' + fc.target + '</b></div>';
    }
    h += '<span class="formula">' + f + '</span><div>导数：<span class="formula">' + d + '</span></div>';
    if (x != null) {
      var val = curveValue(x);
      h += '<div class="kv"><span>' + (fc.kind === 'act' ? 'z' : 'a') + '</span><b>' + fmt(x, 3) + '</b></div>' +
        '<div class="kv"><span>函数值</span><b>' + fmt(val.y, 4) + '</b></div>' +
        '<div class="kv"><span>导数值</span><b>' + fmt(val.d, 4) + '</b></div>';
    }
    h += '<p class="hint">' + range + '。</p>';
    el.innerHTML = h;
  }

  /* ==================== ③ 优化器对比 ==================== */
  function presetData(kind) {
    if (kind === 'current') {
      var d = A.collect();
      if (!d) return null;
      var c = A.config();
      return { sizes: c.sizes, acts: c.activations, loss: c.loss, data: d.map(function (s) { return { x: s.x.slice(), t: s.t.slice() }; }) };
    }
    if (kind === 'xor') {
      return { sizes: [2, 4, 1], acts: ['tanh', 'sigmoid'], loss: 'bce', data: [
        { x: [0, 0], t: [0] }, { x: [0, 1], t: [1] }, { x: [1, 0], t: [1] }, { x: [1, 1], t: [0] }] };
    }
    if (kind === 'linear') {
      var dl = [];
      for (var i = 0; i <= 8; i++) dl.push({ x: [i / 4], t: [2 * i / 4 + 1] });
      return { sizes: [1, 1], acts: ['linear'], loss: 'mse', data: dl };
    }
    // 同心圆：内圈类别 0，外圈类别 1
    var dc = [], rnd = seeded(2026);
    for (var n = 0; n < 100; n++) {
      var outer = n % 2, rad = (outer ? 1.5 : 0.6) + (rnd() - 0.5) * 0.28, ang = rnd() * Math.PI * 2;
      dc.push({ x: [rad * Math.cos(ang), rad * Math.sin(ang)], t: [outer] });
    }
    return { sizes: [2, 8, 1], acts: ['tanh', 'sigmoid'], loss: 'bce', data: dc };
  }
  function runOptim() {
    var p = presetData($('opData').value);
    if (!p) { A.toast('当前主数据集不可用，请检查输入维度', true); return; }
    var epochs = clamp(+$('opEpochs').value || 400, 20, 3000);
    var lr = +$('opLr').value || 0.3;
    var scale = $('opAdamScale').checked ? 0.1 : 1;
    var defs = [
      { key: 'sgd', name: 'SGD', opt: 'sgd', lr: lr, use: $('opUseSgd').checked, color: '#3b82f6' },
      { key: 'mom', name: 'Momentum', opt: 'momentum', lr: lr, use: $('opUseMom').checked, color: '#f97316' },
      { key: 'adam', name: 'Adam', opt: 'adam', lr: lr * scale, use: $('opUseAdam').checked, color: '#10b981' }
    ].filter(function (d) { return d.use; });
    if (!defs.length) { A.toast('至少勾选一个优化器', true); return; }
    var results = defs.map(function (def) {
      var net = new E.Network({ sizes: p.sizes, activations: p.acts, loss: p.loss, seed: 1234 });
      var hist = [];
      for (var e = 0; e < epochs; e++) {
        var r = net.epoch(p.data, def.lr, { optimizer: def.opt, gradClip: 5 });
        hist.push(Number.isFinite(r.loss) ? r.loss : NaN);
      }
      return { def: def, hist: hist, ev: net.evaluate(p.data) };
    });
    drawOptim(results, epochs);
    renderOptimTable(results, p);
  }
  function drawOptim(results, epochs) {
    var c = $('opCanvas'), g = g2('opCanvas');
    if (!c || !g) return;
    var W = c.width, H = c.height, box = { l: 52, t: 24, w: W - 74, h: H - 68 };
    white(g, c);
    var lo = Infinity, hi = -Infinity;
    results.forEach(function (r) { r.hist.forEach(function (v) { if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    var logScale = hi / Math.max(lo, 1e-8) > 120;
    var tf = logScale ? function (v) { return Math.log10(Math.max(v, 1e-8)); } : function (v) { return v; };
    var tlo = tf(lo), thi = tf(hi); if (thi - tlo < 1e-9) thi = tlo + 1;
    var m = (thi - tlo) * 0.08; tlo -= m; thi += m;
    var y2p = function (v) { return box.t + box.h - (tf(v) - tlo) / (thi - tlo) * box.h; };
    axes(g, W, H, box,
      function (k) { return String(Math.round(epochs * k / 4)); },
      function (k) { var v = tlo + (thi - tlo) * k / 4; return logScale ? fmt(Math.pow(10, v), 4) : fmt(v, 3); },
      'Epoch', logScale ? 'Loss (log)' : 'Loss');
    results.forEach(function (r) {
      var pts = [];
      for (var i = 0; i < r.hist.length; i += Math.max(1, Math.floor(r.hist.length / 300))) {
        if (Number.isFinite(r.hist[i])) pts.push([box.l + box.w * i / Math.max(1, epochs - 1), y2p(r.hist[i])]);
      }
      poly(g, pts, r.def.color, 2.2);
      var lastX = box.l + box.w * (r.hist.length - 1) / Math.max(1, epochs - 1);
      txt(g, r.def.name, Math.min(lastX + 6, W - 68), y2p(r.hist[r.hist.length - 1]) + 3, r.def.color, 11);
    });
  }
  function renderOptimTable(results, p) {
    var sorted = results.slice().sort(function (a, b) {
      var av = a.hist[a.hist.length - 1], bv = b.hist[b.hist.length - 1];
      return (Number.isFinite(av) ? av : Infinity) - (Number.isFinite(bv) ? bv : Infinity);
    });
    var best = sorted.length ? sorted[0] : null;
    var h = '<table><thead><tr><th>优化器</th><th>η</th><th>初始 L</th><th>最终 L</th><th>降幅</th></tr></thead><tbody>';
    results.forEach(function (r) {
      var a = r.hist[0], b = r.hist[r.hist.length - 1];
      var drop = Number.isFinite(a) && a > 0 ? (1 - b / a) * 100 : 0;
      h += '<tr><th style="color:' + r.def.color + '">' + r.def.name + '</th><td>' + fmt(r.def.lr, 4) +
        '</td><td>' + fmt(a, 4) + '</td><td><b>' + fmt(b, 5) + '</b></td><td>' + fmt(drop, 1) + '%</td></tr>';
    });
    h += '</tbody></table>';
    $('opTable').innerHTML = h;
    if (best) {
      var n = best.def.name;
      var msg = '本组实验中 <b>' + n + '</b> 的最终损失最低。' +
        'SGD 更新方向最朴素、可能较慢；Momentum 累积动量可加速并抑制震荡；' +
        'Adam 自适应调节每个参数的学习率，通常收敛最快，常需把学习率调小一档。';
      if ($('opData').value === 'current') msg += ' 当前使用主数据集（' + p.sizes.join('→') + '）。';
      $('opConclusion').innerHTML = msg;
    }
  }

  /* ==================== ④ 过拟合与正则 ==================== */
  function genData(n, noise) {
    var rnd = seeded(4242), tr = [], va = [], split = Math.floor(n * 0.7);
    for (var i = 0; i < n; i++) {
      var x = rnd() * 2 - 1;
      var y = Math.sin(x * Math.PI * 1.4) + (rnd() * 2 - 1) * noise;
      (i < split ? tr : va).push({ x: [x], t: [y] });
    }
    return { tr: tr, va: va };
  }
  function runOverfit() {
    var n = clamp(+$('ofN').value || 40, 10, 200);
    var noise = clamp(+$('ofNoise').value || 0, 0, 1);
    var cap = +$('ofCap').value || 24;
    var l2 = clamp(+$('ofL2').value || 0, 0, 1);
    var drop = clamp(+$('ofDrop').value || 0, 0, 0.8);
    var epochs = clamp(+$('ofEpochs').value || 600, 50, 3000);
    var d = genData(n, noise);
    var net = new E.Network({ sizes: [1, cap, 1], activations: ['tanh', 'linear'], loss: 'mse', seed: 7 });
    var rnd = seeded(777), hist = [], every = Math.max(1, Math.floor(epochs / 220));
    for (var e = 0; e < epochs; e++) {
      net.epoch(d.tr, 0.04, { optimizer: 'adam', l2: l2, dropout: drop, rnd: rnd, gradClip: 5 });
      if (e % every === 0 || e === epochs - 1) {
        hist.push({ e: e, tr: net.evaluate(d.tr).loss, va: net.evaluate(d.va).loss });
      }
    }
    drawFit(net, d, noise);
    drawLossHist(hist);
    var last = hist[hist.length - 1], gap = last.va - last.tr;
    var over = gap > 0.06 || (hist.length > 8 && last.va > hist[Math.floor(hist.length / 2)].va * 1.15);
    $('ofStats').innerHTML =
      '<div class="stat-box">训练损失<b>' + fmt(last.tr, 4) + '</b></div>' +
      '<div class="stat-box">验证损失<b>' + fmt(last.va, 4) + '</b></div>' +
      '<div class="stat-box ' + (over ? 'warn' : 'ok') + '">泛化差距<b>' + fmt(gap, 4) + '</b></div>' +
      '<div class="stat-box">容量 / 正则<b>' + cap + ' / L2 ' + fmt(l2, 3) + ' / p ' + fmt(drop, 2) + '</b></div>';
    var msg = over
      ? '出现<b>过拟合</b>：验证损失明显高于训练损失（或中途回升），说明网络记住了噪声。可尝试减小隐藏层节点数、增大 L2 λ 或开启 Dropout。'
      : '泛化良好：验证损失与训练损失接近。当前容量与正则强度比较匹配。';
    if (l2 > 0) msg += ' L2 通过惩罚大权重限制模型复杂度；';
    if (drop > 0) msg += ' Dropout 随机关闭部分神经元，迫使网络学到更鲁棒的特征；';
    $('ofConclusion').innerHTML = msg;
  }
  function drawFit(net, d, noise) {
    var c = $('ofFitCanvas'), g = g2('ofFitCanvas');
    if (!c || !g) return;
    var W = c.width, H = c.height, box = { l: 38, t: 20, w: W - 58, h: H - 58 };
    white(g, c);
    var pts = [], lo = Infinity, hi = -Infinity;
    for (var i = 0; i <= 160; i++) {
      var x = -1 + 2 * i / 160, y = net.predict([x])[0];
      pts.push([box.l + box.w * i / 160, 0]); lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    d.tr.concat(d.va).forEach(function (s) { lo = Math.min(lo, s.t[0]); hi = Math.max(hi, s.t[0]); });
    lo = Math.min(lo, -1.4); hi = Math.max(hi, 1.4);
    var y2p = function (v) { return box.t + box.h - (v - lo) / (hi - lo) * box.h; };
    axes(g, W, H, box,
      function (k) { return fmt(-1 + 2 * k / 4, 1); },
      function (k) { return fmt(lo + (hi - lo) * k / 4, 1); }, 'x', 'y');
    for (var k = 0; k < pts.length; k++) pts[k][1] = y2p(net.predict([-1 + 2 * k / 160])[0]);
    poly(g, pts, '#4f46e5', 2.2);
    d.tr.forEach(function (s) {
      g.beginPath(); g.arc(box.l + (s.x[0] + 1) / 2 * box.w, y2p(s.t[0]), 3.4, 0, Math.PI * 2);
      g.fillStyle = 'rgba(59,130,246,.85)'; g.fill();
    });
    d.va.forEach(function (s) {
      g.beginPath(); g.arc(box.l + (s.x[0] + 1) / 2 * box.w, y2p(s.t[0]), 3.4, 0, Math.PI * 2);
      g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#f97316'; g.stroke();
    });
    txt(g, '— 网络拟合', box.l + 8, box.t + 12, '#4f46e5', 10);
    txt(g, '● 训练', box.l + 8, box.t + 26, '#3b82f6', 10);
    txt(g, '○ 验证', box.l + 68, box.t + 26, '#f97316', 10);
  }
  function drawLossHist(hist) {
    var c = $('ofLossCanvas'), g = g2('ofLossCanvas');
    if (!c || !g) return;
    var W = c.width, H = c.height, box = { l: 44, t: 20, w: W - 64, h: H - 58 };
    white(g, c);
    var lo = Infinity, hi = -Infinity;
    hist.forEach(function (v) { lo = Math.min(lo, v.tr, v.va); hi = Math.max(hi, v.tr, v.va); });
    lo = Math.max(0, lo - (hi - lo) * 0.1); hi = hi + (hi - lo) * 0.1 || 1;
    var y2p = function (v) { return box.t + box.h - (v - lo) / (hi - lo || 1) * box.h; };
    var maxE = hist[hist.length - 1].e || 1;
    axes(g, W, H, box,
      function (k) { return String(Math.round(maxE * k / 4)); },
      function (k) { return fmt(lo + (hi - lo) * k / 4, 2); }, 'Epoch', 'Loss');
    poly(g, hist.map(function (v) { return [box.l + box.w * v.e / maxE, y2p(v.tr)]; }), '#3b82f6', 2.2);
    poly(g, hist.map(function (v) { return [box.l + box.w * v.e / maxE, y2p(v.va)]; }), '#f97316', 2.2);
    txt(g, '— 训练损失', box.l + 8, box.t + 12, '#3b82f6', 10);
    txt(g, '— 验证损失', box.l + 90, box.t + 12, '#f97316', 10);
  }

  /* ==================== 事件与启动 ==================== */
  function bind() {
    $('labTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.lab-tab');
      if (!b) return;
      Array.prototype.forEach.call($('labTabs').children, function (x) { x.classList.toggle('active', x === b); });
      Array.prototype.forEach.call(document.querySelectorAll('.lab-pane'), function (p) {
        p.classList.toggle('active', p.id === 'lab' + b.dataset.tab.charAt(0).toUpperCase() + b.dataset.tab.slice(1));
      });
      if (b.dataset.tab === 'boundary') drawBoundary();
      if (b.dataset.tab === 'curves') drawCurves();
    });
    $('bdRefresh').addEventListener('click', drawBoundary);
    $('bdGrid').addEventListener('change', drawBoundary);
    $('bdSnapshot').addEventListener('click', snapshotBoundary);
    $('bdClear').addEventListener('click', function () { $('bdSnaps').innerHTML = '<span class="muted">点「保存当前快照」记录不同训练阶段的边界</span>'; });
    $('fcKind').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn');
      if (!b) return;
      Array.prototype.forEach.call($('fcKind').children, function (x) { x.classList.toggle('active', x === b); });
      fc.kind = b.dataset.kind; fillNames(); drawCurves();
    });
    $('fcName').addEventListener('change', function () { fc.name = $('fcName').value; drawCurves(); });
    $('fcRange').addEventListener('change', drawCurves);
    $('fcTarget').addEventListener('change', function () { fc.target = +$('fcTarget').value; drawCurves(); });
    $('fcCanvas').addEventListener('mousemove', function (e) {
      if (!fc.box) return;
      var rect = $('fcCanvas').getBoundingClientRect();
      if (!rect.width) return;
      var px = (e.clientX - rect.left) / rect.width * $('fcCanvas').width;
      if (px < fc.box.l || px > fc.box.l + fc.box.w) return;
      var x = fc.xmin + (px - fc.box.l) / fc.box.w * (fc.xmax - fc.xmin);
      drawCurves(x);
    });
    $('fcCanvas').addEventListener('mouseleave', function () { drawCurves(); });
    $('opRun').addEventListener('click', runOptim);
    $('ofRun').addEventListener('click', runOverfit);
  }

  function init() {
    if (!E || !A || !A.net()) { if ((init.n = (init.n || 0) + 1) < 20) setTimeout(init, 40); return; }
    fillNames();
    bind();
    drawBoundary();
    drawCurves();
  }
  window.BPLab = { onEpoch: onEpoch, drawBoundary: drawBoundary, drawCurves: drawCurves, runOptim: runOptim, runOverfit: runOverfit };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
