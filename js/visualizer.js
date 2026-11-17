/* =============================================================
 * BP 传播过程可视化
 *  1) 传播全景图：输入 → 每层(前向 z/a + 反向 δ/∂W) → 损失 → 参数更新
 *  2) 逐环节播放器：时间轴 + 动态网络 SVG + 当前步骤算式展开
 * 依赖 window.BPEngine / window.BPApp（由 engine.js、app.js 提供）
 * ============================================================= */
(function () {
  'use strict';

  var E = window.BPEngine, A = window.BPApp;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = A.fmt, sup = A.sup, esc = A.esc;
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  var V = {
    steps: [], idx: 0, playing: false, timer: null, scope: 'full',
    net: null, cfg: null, cache: null, back: null, sample: null
  };
  var SPEEDS = [1800, 1200, 850, 550, 320];
  var SPEED_LABELS = ['0.5×', '0.75×', '1.0×', '1.5×', '2.5×'];
  var PHASE_LABEL = { forward: '前向传播', loss: '损失计算', backward: '误差反传', grad: '梯度计算', update: '参数更新' };

  /* ---------------- 小工具 ---------------- */
  // 只让元素在其横向滚动容器内可见，绝不触碰页面(window)的滚动位置。
  // 用 scrollIntoView 会把整张页面拉到元素处，导致自动播放时跳回上方的全景图。
  function scrollWithin(container, el) {
    if (!container || !el || !el.getBoundingClientRect) return;
    if (typeof container.scrollWidth !== 'number' || container.scrollWidth <= container.clientWidth + 1) return;
    var cr = container.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    var left = er.left - cr.left + container.scrollLeft;
    var right = left + er.width;
    var pad = 14, target = null;
    if (left < container.scrollLeft + pad) target = left - pad;
    else if (right > container.scrollLeft + container.clientWidth - pad) target = right - container.clientWidth + pad;
    if (target !== null) container.scrollLeft = Math.max(0, target);
  }
  function miniChips(arr, cls) {
    return '<div class="chips">' + arr.map(function (v) {
      return '<span class="chip ' + (cls || '') + '">' + fmt(v, 3) + '</span>';
    }).join('') + '</div>';
  }
  function heat(M, mini) {
    var mx = 0;
    M.forEach(function (r) { r.forEach(function (v) { mx = Math.max(mx, Math.abs(v)); }); });
    mx = mx || 1;
    var h = '<table class="' + (mini ? 'mini-heat' : 'heat') + '">';
    if (!mini) h += '<thead><tr><th></th>' + M[0].map(function (_, i) { return '<th>i' + (i + 1) + '</th>'; }).join('') + '</tr></thead>';
    h += '<tbody>';
    M.forEach(function (row, j) {
      h += '<tr>' + (mini ? '' : '<th>j' + (j + 1) + '</th>') + row.map(function (v) {
        var alpha = Math.min(0.82, 0.07 + Math.abs(v) / mx * 0.7);
        var bg = v >= 0 ? 'rgba(59,130,246,' + alpha + ')' : 'rgba(249,115,22,' + alpha + ')';
        return '<td style="background:' + bg + '" title="' + fmt(v, 6) + '">' + fmt(v, mini ? 2 : 3) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table>';
  }
  function head(phase, title, formula, note) {
    return '<div class="calc-head"><span class="phase-tag ' + phase + '">' + PHASE_LABEL[phase] + '</span>' +
      '<h3>' + title + '</h3><div class="formula">' + formula + '</div>' +
      (note ? '<p>' + note + '</p>' : '') + '</div>';
  }
  function item(key, expr) {
    return '<div class="calc-item"><div class="calc-key">' + key + '</div><div class="calc-expr">' + expr + '</div></div>';
  }
  function result(label, arr, cls) {
    return '<div class="calc-result"><div class="lab">' + label + '</div>' + A.chips(arr, cls) + '</div>';
  }
  function note(txt) { return '<div class="calc-note">' + txt + '</div>'; }
  function findStep(kind, layer) {
    for (var i = 0; i < V.steps.length; i++) {
      if (V.steps[i].kind === kind && (layer == null || V.steps[i].layer === layer)) return i;
    }
    return 0;
  }

  /* ---------------- 生成阶段序列 ---------------- */
  function makeSteps(cfg, net, cache, back, s, scope) {
    var L = net.L, steps = [];
    function push(o) { o.i = steps.length; steps.push(o); }
    push({ kind: 'input', layer: 0, phase: 'forward', label: '输入 x' });
    for (var l = 1; l <= L; l++) {
      push({ kind: 'z', layer: l, phase: 'forward', label: sup(l) + ' · z' });
      push({ kind: 'a', layer: l, phase: 'forward', label: sup(l) + ' · a' });
    }
    push({ kind: 'loss', layer: L, phase: 'loss', label: '损失 L' });
    if (scope === 'full') {
      push({ kind: 'delta', layer: L, phase: 'backward', label: 'δ' + sup(L) + ' 输出层' });
      for (var l2 = L - 1; l2 >= 1; l2--) push({ kind: 'delta', layer: l2, phase: 'backward', label: 'δ' + sup(l2) });
      for (var k = 0; k < L; k++) push({ kind: 'grad', layer: k + 1, phase: 'grad', label: '∂W' + sup(k + 1) });
      push({ kind: 'update', layer: 0, phase: 'update', label: 'W ← W − ηg' });
    }
    return steps;
  }

  function build(scope, jump) {
    var net = A.net(); if (!net) return;
    var data = A.collect(); if (!data) return;
    var cfg = A.config(), L = net.L;
    var si = clamp(+$('sampleSel').value || 0, 0, data.length - 1);
    var s = data[si], cache, back;
    try { cache = net.forward(s.x); back = net.backward(cache, s.t); }
    catch (err) { if (window.console) console.error('[viz] ' + err.message); return; }
    V.net = net; V.cfg = cfg; V.cache = cache; V.back = back; V.sample = s;
    V.scope = scope === 'forward' ? 'forward' : 'full';
    V.steps = makeSteps(cfg, net, cache, back, s, V.scope);
    var idx = 0;
    if (typeof jump === 'number') idx = jump;
    else if (jump === 'delta-out') idx = findStep('delta', L);
    else if (jump === 'grad-first') idx = findStep('grad', 1);
    V.idx = clamp(idx, 0, V.steps.length - 1);
    stopPlay();
    buildFlow();
    buildStepper();
    render();
  }

  /* ---------------- 传播全景图 ---------------- */
  function fcLine(label, body, line) {
    return '<div class="fc-line"' + (line ? ' data-line="' + line + '"' : '') + '><span>' + label + '</span>' + body + '</div>';
  }
  function layerCard(l) {
    var net = V.net, cfg = V.cfg, cache = V.cache, back = V.back, L = net.L;
    var act = E.ACT[cfg.activations[l - 1]].label;
    var isOut = l === L;
    var title = (isOut ? '输出层' : '隐藏层 ' + l) + ' · ' + esc(act);
    var gW = back ? back.gradW[l - 1] : net.weights[l - 1].map(function (r) { return r.map(function () { return 0; }); });
    var dW = gW.map(function (r) { return r.map(function (v) { return -cfg.lr * v; }); });
    var h = '<div class="flow-card layer-card" data-kind="layer" data-layer="' + l + '" data-step="' + findStep('z', l) + '">' +
      '<div class="fc-head"><h4>' + title + '</h4><span class="fc-badge">' + net.sizes[l] + ' 节点</span></div>' +
      '<div class="fc-part fwd-part">';
    h += fcLine('W' + sup(l), heat(net.weights[l - 1], true));
    h += fcLine('b' + sup(l), miniChips(net.biases[l - 1]));
    h += fcLine('z' + sup(l), miniChips(cache.z[l]), 'z');
    h += fcLine('a' + sup(l), miniChips(cache.a[l], 'alt'), 'a');
    h += '</div><div class="fc-part bwd-part">';
    h += fcLine('δ' + sup(l), back ? miniChips(back.deltas[l], 'delta') : '<span class="fc-note">需反向快照</span>', 'delta');
    h += fcLine('∂W', heat(gW, true));
    h += fcLine('ΔW', heat(dW, true));
    h += '</div></div>';
    return h;
  }
  function buildFlow() {
    var net = V.net, cfg = V.cfg, cache = V.cache, back = V.back, L = net.L;
    var s = V.sample;
    var loss = net.lossOf(cache.a[L], s.t);
    var h = '';
    h += '<div class="flow-rail"><span class="rail-tag fwd">FORWARD 前向</span><span>输入 → 输出：逐层计算 z = W·a + b 与 a = f(z)　｜　← 蓝色箭头方向</span></div>';
    h += '<div class="flow-row">';

    /* 输入卡 */
    h += '<div class="flow-card input-card" data-kind="input" data-layer="0" data-step="' + findStep('input') + '">' +
      '<div class="fc-head"><h4>输入层 a⁽⁰⁾</h4><span class="fc-badge">样本</span></div>' +
      fcLine('x', miniChips(cache.a[0], 'gray')) +
      fcLine('t', miniChips(s.t, 'alt')) +
      '<div class="fc-note">共 ' + net.sizes[0] + ' 个输入项，' + net.sizes[L] + ' 个目标值</div></div>';

    h += '<div class="flow-arrows"><div class="fa fwd">→</div><div class="fa bwd">←</div></div>';
    for (var l = 1; l <= L; l++) {
      h += layerCard(l);
      h += '<div class="flow-arrows"><div class="fa fwd">→</div><div class="fa bwd">←</div></div>';
    }

    /* 损失卡 */
    h += '<div class="flow-card loss-card" data-kind="loss" data-layer="' + L + '" data-step="' + findStep('loss') + '">' +
      '<div class="fc-head"><h4>损失函数 L</h4><span class="fc-badge">' + esc(E.LOSS[cfg.loss].label) + '</span></div>' +
      fcLine('aᴸ', miniChips(cache.a[L])) +
      fcLine('t', miniChips(s.t, 'alt')) +
      '<div class="fc-line"><span>L =</span><span class="fc-big">' + fmt(loss, 5) + '</span></div>' +
      '<div class="fc-note">前向终点，也是反向传播的起点</div></div>';
    h += '</div>';

    /* 更新轨 */
    h += '<div class="flow-rail bwd-rail"><span class="rail-tag bwd">BACKWARD 反向</span><span>橙色区为各层 δ / ∂W / ΔW；δ 自输出层逐层回传</span></div>';
    h += '<div class="flow-rail"><span class="rail-tag upd">UPDATE 更新</span><span>W ← W − η·∂L/∂W（此处为 SGD 参考增量，实际由所选优化器执行）</span></div>';
    h += '<div class="flow-row upd-row">';
    for (var k = 0; k < L; k++) {
      var g = back ? back.gradW[k] : net.weights[k].map(function (r) { return r.map(function () { return 0; }); });
      var nw = net.weights[k].map(function (r, j) { return r.map(function (v, i) { return v - cfg.lr * g[j][i]; }); });
      h += '<div class="flow-card upd-card" data-kind="update" data-layer="' + (k + 1) + '" data-step="' +
        (V.scope === 'full' ? findStep('grad', k + 1) : V.steps.length - 1) + '">' +
        '<div class="fc-head"><h4>第 ' + (k + 1) + ' 层参数</h4><span class="fc-badge">' + net.sizes[k + 1] + '×' + net.sizes[k] + '</span></div>' +
        fcLine('W', heat(net.weights[k], true)) +
        fcLine('→', heat(nw, true)) +
        '<div class="fc-note">W − η·∂W；b 同步减去 η·δ</div></div>';
      if (k < L - 1) h += '<div class="flow-arrows"><div class="fa upd">→</div></div>';
    }
    h += '<div class="flow-arrows"><div class="fa upd">→</div></div>';
    h += '<div class="flow-card upd-card done-card" data-kind="done" data-layer="0" data-step="' +
      (V.scope === 'full' ? findStep('update') : V.steps.length - 1) + '">' +
      '<div class="fc-head"><h4>一次迭代完成</h4><span class="fc-badge">Epoch +1</span></div>' +
      '<div class="fc-line"><span>η =</span><span class="fc-big">' + fmt(cfg.lr, 4) + '</span></div>' +
      '<div class="fc-note">优化器：' + esc($('optimizer').selectedOptions[0].textContent) + '。点击「③ 应用这次更新」可把该样本梯度写入网络。</div></div>';
    h += '</div>';

    $('flowCanvas').innerHTML = h;
    $('flowStats').textContent = '样本 #' + ((+$('sampleSel').value || 0) + 1) + ' ｜ L = ' + fmt(loss, 6) + ' ｜ ' + V.steps.length + ' 个环节';
  }
  function highlightFlow(st) {
    $('flowCanvas').querySelectorAll('.flow-card').forEach(function (c) {
      var k = c.dataset.kind, l = +c.dataset.layer;
      var on = (st.kind === 'input' && k === 'input') ||
        (st.kind === 'loss' && k === 'loss') ||
        ((st.kind === 'z' || st.kind === 'a' || st.kind === 'delta') && k === 'layer' && l === st.layer) ||
        (st.kind === 'grad' && k === 'update' && l === st.layer) ||
        (st.kind === 'update' && (k === 'update' || k === 'done'));
      c.classList.toggle('active', !!on);
      c.classList.toggle('bwd-active', !!on && (st.kind === 'delta' || st.kind === 'grad' || st.kind === 'update'));
    });
    $('flowCanvas').querySelectorAll('.fc-line[data-line]').forEach(function (line) {
      line.classList.toggle('line-active', line.dataset.line === st.kind);
    });
    var active = $('flowCanvas').querySelector('.flow-card.active');
    if (active) scrollWithin($('flowCanvas'), active);
  }

  /* ---------------- 时间轴 ---------------- */
  function buildStepper() {
    $('vizStepper').innerHTML = V.steps.map(function (s, i) {
      return '<div class="step-chip" data-phase="' + s.phase + '" data-i="' + i + '" title="' + esc(PHASE_LABEL[s.phase]) + '">' +
        (i + 1) + '. ' + esc(s.label) + '</div>';
    }).join('');
  }
  function highlightStepper() {
    $('vizStepper').querySelectorAll('.step-chip').forEach(function (c, i) {
      c.classList.toggle('active', i === V.idx);
      c.classList.toggle('passed', i < V.idx);
    });
    var cur = $('vizStepper').querySelector('.step-chip.active');
    if (cur) scrollWithin($('vizStepper'), cur);
  }

  /* ---------------- 控制条 ---------------- */
  function renderControls() {
    var n = V.steps.length;
    $('vizCount').textContent = (V.idx + 1) + ' / ' + n;
    $('vizProgressBar').style.width = (n < 2 ? 0 : V.idx / (n - 1) * 100) + '%';
    $('vizPlay').textContent = V.playing ? '⏸ 暂停播放' : '▶ 自动播放';
    $('vizFirst').disabled = V.idx === 0;
    $('vizPrev').disabled = V.idx === 0;
    $('vizNext').disabled = V.idx >= n - 1;
    $('vizLast').disabled = V.idx >= n - 1;
    var sv = clamp(+$('vizSpeed').value || 3, 1, 5);
    $('vizSpeedLabel').textContent = SPEED_LABELS[sv - 1];
  }
  function renderStageHead(st) {
    var titleMap = {
      input: '输入样本 x', z: '第 ' + st.layer + ' 层 · 加权求和 z⁽' + sup(st.layer) + '⁾',
      a: '第 ' + st.layer + ' 层 · 激活输出 a⁽' + sup(st.layer) + '⁾', loss: '计算损失 L',
      delta: st.layer === V.net.L ? '输出层 · 误差信号 δ⁽' + sup(st.layer) + '⁾' : '第 ' + st.layer + ' 层 · 回传误差 δ⁽' + sup(st.layer) + '⁾',
      grad: '第 ' + st.layer + ' 层 · 梯度 ∂L/∂W⁽' + sup(st.layer) + '⁾', update: '参数更新 W ← W − η·∂W'
    };
    $('vizStageHead').innerHTML = '<span class="phase-tag ' + st.phase + '">' + PHASE_LABEL[st.phase] + '</span>' +
      '<strong>' + titleMap[st.kind] + '</strong><small>环节 ' + (V.idx + 1) + ' / ' + V.steps.length + '</small>';
  }

  /* ---------------- 动态网络 SVG ---------------- */
  function valueAt(st, l, i) {
    var cache = V.cache, back = V.back, L = V.net.L;
    if (st.kind === 'input') return l === 0 ? { v: cache.a[0][i], type: 'x' } : { v: null, type: 'idle' };
    if (st.kind === 'z' || st.kind === 'a') {
      if (l > st.layer) return { v: null, type: 'idle' };
      if (l === 0) return { v: cache.a[0][i], type: 'x' };
      if (l < st.layer) return { v: cache.a[l][i], type: 'a' };
      return { v: st.kind === 'z' ? cache.z[l][i] : cache.a[l][i], type: st.kind === 'z' ? 'z' : 'a' };
    }
    if (st.kind === 'loss') return l === 0 ? { v: cache.a[0][i], type: 'x' } : { v: cache.a[l][i], type: 'a' };
    if (st.kind === 'delta') {
      if (l === 0) return { v: cache.a[0][i], type: 'x' };
      if (l >= st.layer) return { v: back.deltas[l][i], type: 'delta' };
      return { v: cache.a[l][i], type: 'a' };
    }
    if (l === 0) return { v: cache.a[0][i], type: 'x' };
    return { v: back.deltas[l][i], type: 'delta' };
  }
  function edgeInfo(st) {
    var L = V.net.L;
    if (st.kind === 'z') return { k: st.layer - 1, dir: 'forward' };
    if (st.kind === 'delta' && st.layer < L) return { k: st.layer, dir: 'backward' };
    if (st.kind === 'grad') return { k: st.layer - 1, dir: 'grad' };
    if (st.kind === 'update') return { k: 'all', dir: 'update' };
    return null;
  }
  function renderVizSVG(st) {
    var net = V.net, cfg = V.cfg, sizes = net.sizes, L = net.L;
    var maxN = Math.max.apply(null, sizes);
    var w = Math.max(560, sizes.length * 175 + 90), h = Math.max(250, maxN * 48 + 112);
    var padX = 62, rightPad = 96, padTop = 50, padBottom = 46;
    var avail = h - padTop - padBottom;
    var xOf = function (l) { return padX + (w - padX - rightPad - padX) * l / L; };
    var pos = sizes.map(function (n, l) {
      var spacing = n > 1 ? Math.min(48, avail / (n - 1)) : 0;
      var start = padTop + (avail - spacing * (n - 1)) / 2;
      var arr = [];
      for (var i = 0; i < n; i++) arr.push({ x: xOf(l), y: start + i * spacing });
      return arr;
    });
    var ei = edgeInfo(st);
    var COLORS = { forward: '#4f46e5', backward: '#ea580c', grad: '#db2777', update: '#059669' };
    var out = [];
    out.push('<defs>');
    ['forward:arrowF:#4f46e5', 'backward:arrowB:#ea580c', 'grad:arrowG:#db2777', 'update:arrowU:#059669'].forEach(function (spec) {
      var p = spec.split(':');
      out.push('<marker id="' + p[1] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
        '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + p[2] + '"/></marker>');
    });
    out.push('</defs>');

    /* 方向条 */
    var dirTxt = st.phase === 'forward' || st.phase === 'loss' ? '前向传播：输入 → 输出' :
      (st.phase === 'update' ? '参数更新：W ← W − η·∂W' :
        (st.phase === 'grad' ? '梯度计算：∂W = δ · aᵀ' : '误差反向传播：输出 → 输入'));
    var dirColor = st.phase === 'forward' || st.phase === 'loss' ? COLORS.forward :
      (st.phase === 'update' ? COLORS.update : (st.phase === 'grad' ? COLORS.grad : COLORS.backward));
    out.push('<text x="' + (w / 2) + '" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="' + dirColor + '">' + dirTxt + '</text>');

    /* 连线 */
    for (var k = 0; k < L; k++) {
      for (var j = 0; j < sizes[k + 1]; j++) {
        for (var i = 0; i < sizes[k]; i++) {
          var p = pos[k][i], q = pos[k + 1][j], wv = net.weights[k][j][i];
          var active = ei && (ei.k === 'all' || ei.k === k);
          var isBack = st.phase === 'backward' || st.phase === 'grad';
          var passed = (st.kind === 'z' || st.kind === 'a' || st.kind === 'loss') ? k < st.layer - 1 :
            (st.kind === 'delta' ? k >= st.layer : (st.kind === 'grad' || st.kind === 'update'));
          var stroke = active ? COLORS[ei.dir] : (passed ? (isBack ? '#fed7aa' : '#c7d2fe') : '#e8edf4');
          var sw = active ? 2.4 : (passed ? 1.2 : 0.8);
          var extra = active ? ' class="flow-line' + (ei.dir === 'backward' ? ' rev' : '') + '" marker-end="url(#' +
            ({ forward: 'arrowF', backward: 'arrowB', grad: 'arrowG', update: 'arrowU' })[ei.dir] + ')"' : '';
          out.push('<line x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '" ' +
            'stroke="' + stroke + '" stroke-width="' + sw + '" stroke-opacity="' + (active ? 0.95 : 0.85) + '"' + extra + '>' +
            '<title>W' + sup(k + 1) + '[' + (j + 1) + '][' + (i + 1) + '] = ' + fmt(wv, 6) + '</title></line>');
        }
      }
    }

    /* 损失盒：体现「前向终点 / 反向起点」 */
    var loss = net.lossOf(V.cache.a[L], V.sample.t);
    var lossActive = st.kind === 'loss' || (st.kind === 'delta' && st.layer === L);
    var lx = w - 78, ly = h / 2 - 24;
    out.push('<rect x="' + lx + '" y="' + ly + '" width="70" height="48" rx="9" fill="#ffffff" stroke="' +
      (lossActive ? '#8b5cf6' : '#e2e8f0') + '" stroke-width="' + (lossActive ? 2.4 : 1.2) + '"/>');
    out.push('<text x="' + (lx + 35) + '" y="' + (ly + 19) + '" text-anchor="middle" font-size="10" fill="#94a3b8">损失 L</text>');
    out.push('<text x="' + (lx + 35) + '" y="' + (ly + 36) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#7c3aed">' + fmt(loss, 4) + '</text>');
    var outNode = pos[L][Math.floor(sizes[L] / 2)];
    out.push('<line x1="' + outNode.x + '" y1="' + outNode.y + '" x2="' + lx + '" y2="' + (ly + 24) + '" stroke="' +
      (lossActive ? '#8b5cf6' : '#e2e8f0') + '" stroke-width="' + (lossActive ? 2 : 1) + '" stroke-dasharray="4 4"/>');

    /* 节点 */
    var STYLE = {
      idle: { fill: '#f8fafc', stroke: '#e2e8f0', text: '#cbd5e1' },
      x: { fill: '#f1f5f9', stroke: '#94a3b8', text: '#475569' },
      a: { fill: '#eff6ff', stroke: '#93c5fd', text: '#1d4ed8' },
      z: { fill: '#eef2ff', stroke: '#6366f1', text: '#4338ca' },
      delta: { fill: '#fff7ed', stroke: '#fb923c', text: '#c2410c' }
    };
    for (var l = 0; l <= L; l++) {
      var isIn = l === 0, isOut = l === L;
      var label = isIn ? '输入层' : (isOut ? '输出层' : '隐藏层 ' + l);
      var actName = isIn ? 'x' : E.ACT[cfg.activations[l - 1]].label;
      var curLayer = (st.kind === 'update') || (l === st.layer);
      out.push('<text x="' + xOf(l) + '" y="35" text-anchor="middle" font-size="11" font-weight="700" fill="' +
        (curLayer ? dirColor : '#475569') + '">' + esc(label) + '</text>');
      out.push('<text x="' + xOf(l) + '" y="47" text-anchor="middle" font-size="9.5" fill="#94a3b8">' + esc(actName) + '</text>');
      for (var n = 0; n < sizes[l]; n++) {
        var pt = pos[l][n], cv = valueAt(st, l, n), sty = STYLE[cv.type];
        if (curLayer) out.push('<circle cx="' + pt.x + '" cy="' + pt.y + '" r="24" fill="' + dirColor +
          '" opacity="0.13" class="node-glow"/>');
        out.push('<circle cx="' + pt.x + '" cy="' + pt.y + '" r="18" fill="' + sty.fill + '" stroke="' +
          (curLayer ? dirColor : sty.stroke) + '" stroke-width="' + (curLayer ? 2.6 : 1.6) + '">' +
          '<title>' + esc(label) + ' 节点 ' + (n + 1) + ' · ' + cv.type + (cv.v == null ? '' : ' = ' + fmt(cv.v, 6)) + '</title></circle>');
        out.push('<text x="' + pt.x + '" y="' + (pt.y + 3.2) + '" text-anchor="middle" font-size="' +
          (cv.v == null ? 10 : 8.6) + '" font-weight="700" fill="' + (curLayer ? dirColor : sty.text) + '">' +
          (cv.v == null ? (n + 1) : fmt(cv.v, 2)) + '</text>');
      }
    }
    $('vizSvgWrap').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="当前传播环节的网络状态">' + out.join('') + '</svg>';
  }

  /* ---------------- 当前环节的计算明细 ---------------- */
  function lossTerm(cfg, a, t, i) {
    var v = a[i], tv = t[i], p = clamp(v, 1e-9, 1 - 1e-9);
    switch (cfg.loss) {
      case 'mse': return '½ (' + fmt(v, 3) + ' − ' + fmt(tv, 3) + ')² = <b>' + fmt(0.5 * (v - tv) * (v - tv), 5) + '</b>';
      case 'mae': return '|' + fmt(v, 3) + ' − ' + fmt(tv, 3) + '| = <b>' + fmt(Math.abs(v - tv), 5) + '</b>';
      case 'huber': var r = Math.abs(v - tv); return (r <= 1 ? '½r²' : 'r − ½') + '（r = ' + fmt(r, 3) + '）= <b>' + fmt(r <= 1 ? 0.5 * r * r : r - 0.5, 5) + '</b>';
      case 'bce': return '−[' + fmt(tv, 2) + '·ln(' + fmt(p, 3) + ') + (1−' + fmt(tv, 2) + ')·ln(1−' + fmt(p, 3) + ')] = <b>' + fmt(-(tv * Math.log(p) + (1 - tv) * Math.log(1 - p)), 5) + '</b>';
      case 'ce': return '−' + fmt(tv, 2) + '·ln(' + fmt(clamp(v, 1e-9, 1), 3) + ') = <b>' + fmt(-tv * Math.log(clamp(v, 1e-9, 1)), 5) + '</b>';
      default: return '';
    }
  }
  function renderDetail(st) {
    var net = V.net, cfg = V.cfg, cache = V.cache, back = V.back, s = V.sample, L = net.L;
    var h = '', cardCls = '';
    if (st.phase === 'backward') cardCls = 'bwd';
    if (st.phase === 'grad') cardCls = 'grad';
    if (st.phase === 'update') cardCls = 'upd';

    if (st.kind === 'input') {
      h += head('forward', '输入样本 x 与目标 t', 'a⁽⁰⁾ = x', '输入层不做计算，直接把样本数值送入第一层。');
      h += '<div class="calc-body">';
      cache.a[0].forEach(function (v, i) { h += item('x' + (i + 1), 'a' + (i + 1) + '⁽⁰⁾ = <b>' + fmt(v, 4) + '</b>'); });
      s.t.forEach(function (v, i) { h += item('t' + (i + 1), '目标值 = <b>' + fmt(v, 4) + '</b>'); });
      h += '</div>' + result('输入向量 a⁽⁰⁾', cache.a[0], 'gray') + result('目标向量 t', s.t, 'alt');
      h += note('从这里开始，逐层执行 z = W·a + b 与 a = f(z)，直到输出层产生预测。');
    }

    else if (st.kind === 'z') {
      var l = st.layer, W = net.weights[l - 1], b = net.biases[l - 1], prev = cache.a[l - 1], z = cache.z[l];
      h += head('forward', '第 ' + l + ' 层 · 加权求和', 'z⁽' + sup(l) + '⁾ = W⁽' + sup(l) + '⁾ · a⁽' + sup(l - 1) + '⁾ + b⁽' + sup(l) + '⁾',
        '每个神经元把上一层所有激活值按权重相加，再加上偏置。');
      h += '<div class="calc-body">';
      z.forEach(function (zv, j) {
        var terms = prev.map(function (pv, i) { return fmt(W[j][i], 3) + ' × ' + fmt(pv, 3); });
        h += item('z' + (j + 1) + '⁽' + sup(l) + '⁾',
          terms.join(' <span class="dim">+</span> ') + ' <span class="dim">+</span> ' + fmt(b[j], 3) + ' <span class="dim">=</span> <b>' + fmt(zv, 4) + '</b>');
      });
      h += '</div>' + result('净输入 z⁽' + sup(l) + '⁾', z);
      h += note('权重矩阵 W⁽' + sup(l) + '⁾ 形状为 ' + net.sizes[l] + ' × ' + net.sizes[l - 1] + '；共完成 ' + (net.sizes[l] * net.sizes[l - 1]) + ' 次乘加。');
    }

    else if (st.kind === 'a') {
      var la = st.layer, actKey = cfg.activations[la - 1], act = E.ACT[actKey], za = cache.z[la], aa = cache.a[la];
      h += head('forward', '第 ' + la + ' 层 · 激活函数 ' + esc(act.label), 'a⁽' + sup(la) + '⁾ = ' + esc(act.label) + '( z⁽' + sup(la) + '⁾ )',
        esc(act.desc));
      h += '<div class="calc-body">';
      if (actKey === 'softmax') {
        var mx = Math.max.apply(null, za), ex = za.map(function (v) { return Math.exp(clamp(v - mx, -60, 60)); });
        var sum = ex.reduce(function (p, c) { return p + c; }, 0);
        aa.forEach(function (v, i) {
          h += item('a' + (i + 1) + '⁽' + sup(la) + '⁾', 'e^(' + fmt(za[i] - mx, 3) + ') ÷ Σe^(z−max) = ' + fmt(ex[i], 4) + ' ÷ ' + fmt(sum, 4) + ' = <b>' + fmt(v, 4) + '</b>');
        });
      } else {
        aa.forEach(function (v, i) {
          h += item('a' + (i + 1) + '⁽' + sup(la) + '⁾', esc(act.label) + '(' + fmt(za[i], 4) + ') = <b>' + fmt(v, 4) + '</b>' +
            ' <span class="dim">｜ f′(z) = ' + fmt(act.df(za[i], v), 4) + '</span>');
        });
      }
      h += '</div>' + result('激活输出 a⁽' + sup(la) + '⁾', aa, 'alt');
      h += note('灰色的 f′(z) 是激活函数导数，稍后反向传播计算 δ 时会用到。' +
        (la === L ? ' 这一层的结果就是网络预测值 a⁽ᴸ⁾。' : ' 该向量将作为下一层的输入。'));
    }

    else if (st.kind === 'loss') {
      var aL = cache.a[L], loss = net.lossOf(aL, s.t);
      h += head('loss', '计算损失 L', 'L = ' + esc(E.LOSS[cfg.loss].desc), '把预测值与目标值代入损失函数。');
      h += '<div class="calc-body">';
      aL.forEach(function (v, i) { h += item('ℓ' + (i + 1) + '(a, t)', lossTerm(cfg, aL, s.t, i)); });
      h += '</div><div class="calc-result"><div class="lab">总损失</div><div class="fc-big" style="font-size:22px">L = ' + fmt(loss, 6) + '</div></div>';
      h += note('前向传播到此结束。接下来从 L 对输出 a⁽ᴸ⁾ 求导，误差信号 δ 沿网络反向回传。');
    }

    else if (st.kind === 'delta') {
      var ld = st.layer, d = back.deltas[ld], actOut = cfg.activations[L - 1];
      var isOut = ld === L;
      h += head('backward', isOut ? '输出层 · 误差信号 δ⁽ᴸ⁾' : '第 ' + ld + ' 层 · 回传误差 δ⁽' + sup(ld) + '⁾',
        isOut ? 'δ⁽ᴸ⁾ = ∂L/∂a⁽ᴸ⁾ ⊙ f′(z⁽ᴸ⁾)' : 'δ⁽ˡ⁾ = ( W⁽ˡ⁺¹⁾ᵀ · δ⁽ˡ⁺¹⁾ ) ⊙ f′(z⁽ˡ⁾)');
      h += '<div class="calc-body">';
      if (isOut) {
        if (E.isPaired(cfg.loss, actOut)) {
          d.forEach(function (v, i) {
            h += item('δ' + (i + 1) + '⁽' + sup(L) + '⁾', 'a' + (i + 1) + ' − t' + (i + 1) + ' = ' + fmt(cache.a[L][i], 4) + ' − ' + fmt(s.t[i], 4) + ' = <b>' + fmt(v, 4) + '</b>');
          });
        } else {
          var dOut = E.LOSS[cfg.loss].d(cache.a[L], s.t);
          if (actOut === 'softmax') {
            var dot = 0; cache.a[L].forEach(function (v, i) { dot += v * dOut[i]; });
            d.forEach(function (v, i) {
              h += item('δ' + (i + 1) + '⁽' + sup(L) + '⁾', 'a' + (i + 1) + ' × (d' + (i + 1) + ' − Σa·d) = ' +
                fmt(cache.a[L][i], 3) + ' × (' + fmt(dOut[i], 3) + ' − ' + fmt(dot, 3) + ') = <b>' + fmt(v, 4) + '</b>');
            });
          } else {
            var af = E.ACT[actOut];
            d.forEach(function (v, i) {
              var deriv = af.df(cache.z[L][i], cache.a[L][i]);
              h += item('δ' + (i + 1) + '⁽' + sup(L) + '⁾', '∂L/∂a × f′(z) = ' + fmt(dOut[i], 4) + ' × ' + fmt(deriv, 4) + ' = <b>' + fmt(v, 4) + '</b>');
            });
          }
        }
      } else {
        var Wn = net.weights[ld], dn = back.deltas[ld + 1], zl = cache.z[ld], al = cache.a[ld];
        var hf = E.ACT[cfg.activations[ld - 1]];
        d.forEach(function (v, i) {
          var sum = 0, terms = [];
          for (var j = 0; j < dn.length; j++) { sum += Wn[j][i] * dn[j]; terms.push(fmt(Wn[j][i], 3) + '×' + fmt(dn[j], 3)); }
          var deriv = hf.df ? hf.df(zl[i], al[i]) : 1;
          h += item('δ' + (i + 1) + '⁽' + sup(ld) + '⁾',
            '(' + terms.join(' <span class="dim">+</span> ') + ') × f′(' + fmt(zl[i], 3) + ') = ' +
            fmt(sum, 4) + ' × ' + fmt(deriv, 4) + ' = <b>' + fmt(v, 4) + '</b>');
        });
      }
      h += '</div>' + result('误差信号 δ⁽' + sup(ld) + '⁾', d, 'delta');
      h += note(isOut
        ? (E.isPaired(cfg.loss, actOut) ? '当前 ' + esc(E.ACT[actOut].label) + ' + ' + esc(E.LOSS[cfg.loss].label) + ' 是经典组合，δ⁽ᴸ⁾ 化简为 a − t，无需再乘 f′(z)。' : '按通用链式法则计算输出层误差信号。')
        : '用下一层权重矩阵的转置把 δ 回传，再乘本层激活函数导数；这就是「反向」二字的含义。');
    }

    else if (st.kind === 'grad') {
      var k = st.layer - 1, g = back.gradW[k], gb = back.gradB[k], prevA = cache.a[k], dl = back.deltas[k + 1];
      h += head('grad', '第 ' + st.layer + ' 层 · 求梯度', '∂L/∂W⁽' + sup(st.layer) + '⁾ = δ⁽' + sup(st.layer) + '⁾ · (a⁽' + sup(k) + '⁾)ᵀ',
        '梯度是误差信号与上一层激活值的外积。');
      h += '<div class="calc-body">';
      var shown = 0, total = g.length * g[0].length;
      g.forEach(function (row, j) {
        row.forEach(function (v, i) {
          if (shown++ < 8) h += item('∂W' + (j + 1) + (i + 1), 'δ' + (j + 1) + ' × a' + (i + 1) + ' = ' +
            fmt(dl[j], 4) + ' × ' + fmt(prevA[i], 4) + ' = <b>' + fmt(v, 4) + '</b>');
        });
      });
      if (total > 8) h += item('…', '共 ' + total + ' 个权重梯度，完整矩阵见下方热力图');
      h += '</div>';
      h += '<div class="calc-result"><div class="lab">∂L/∂W⁽' + sup(st.layer) + '⁾（蓝正 / 橙负，颜色越深绝对值越大）</div>' + heat(g, false) + '</div>';
      h += '<div class="calc-result"><div class="lab">ΔW = −η·∂W，η = ' + fmt(cfg.lr, 5) + '</div>' +
        heat(g.map(function (r) { return r.map(function (v) { return -cfg.lr * v; }); }), false) + '</div>';
      h += result('偏置梯度 ∂L/∂b⁽' + sup(st.layer) + '⁾ = δ', gb, 'delta');
      h += note('ΔW 为 SGD 参考增量；若选 Momentum / Adam，实际写入量还会包含动量或自适应状态。');
    }

    else if (st.kind === 'update') {
      h += head('update', '一次参数更新', 'W ← W − η·∂L/∂W　｜　b ← b − η·∂L/∂b',
        '优化器：' + esc($('optimizer').selectedOptions[0].textContent) + '，η = ' + fmt(cfg.lr, 6));
      h += '<div class="calc-body">';
      for (var uk = 0; uk < L; uk++) {
        var Wk = net.weights[uk], gk = back.gradW[uk], bk = net.biases[uk], pairs = [];
        for (var uj = 0; uj < Wk.length && pairs.length < 4; uj++) {
          for (var ui = 0; ui < Wk[uj].length && pairs.length < 4; ui++) {
            pairs.push('<div class="upd-pair"><span class="old">' + fmt(Wk[uj][ui], 4) + '</span><span class="arw">→</span>' +
              '<span class="new">' + fmt(Wk[uj][ui] - cfg.lr * gk[uj][ui], 4) + '</span></div>');
          }
        }
        h += item('W⁽' + sup(uk + 1) + '⁾ / b⁽' + sup(uk + 1) + '⁾', pairs.join('') +
          '<div class="dim">b₁: ' + fmt(bk[0], 4) + ' → ' + fmt(bk[0] - cfg.lr * back.gradB[uk][0], 4) + '</div>');
      }
      h += '</div>';
      h += note('以上为按本样本梯度计算的 SGD 参考值；自动训练使用<b>全部样本梯度的平均</b>。' +
        '点击「③ 应用这次更新」才会真正把梯度写入网络。');
    }

    var card = $('vizDetail');
    card.className = 'calc-card ' + cardCls;
    card.innerHTML = h;
    card.scrollTop = 0;
  }

  /* ---------------- 渲染 / 播放 ---------------- */
  function render() {
    if (!V.steps.length) return;
    var st = V.steps[V.idx];
    renderControls();
    highlightStepper();
    highlightFlow(st);
    renderStageHead(st);
    renderVizSVG(st);
    renderDetail(st);
  }
  function goTo(i) {
    V.idx = clamp(i, 0, V.steps.length - 1);
    render();
  }
  function stopPlay() {
    if (V.timer) clearTimeout(V.timer);
    V.timer = null; V.playing = false;
    if ($('vizPlay')) $('vizPlay').textContent = '▶ 自动播放';
  }
  function tick() {
    if (!V.playing) return;
    if (V.idx >= V.steps.length - 1) { stopPlay(); renderControls(); return; }
    goTo(V.idx + 1);
    V.timer = setTimeout(tick, SPEEDS[clamp(+$('vizSpeed').value || 3, 1, 5) - 1]);
  }
  function togglePlay() {
    if (V.playing) { stopPlay(); renderControls(); return; }
    if (V.idx >= V.steps.length - 1) goTo(0);
    V.playing = true;
    renderControls();
    tick();
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('vizFirst').addEventListener('click', function () { stopPlay(); goTo(0); });
    $('vizPrev').addEventListener('click', function () { stopPlay(); goTo(V.idx - 1); });
    $('vizNext').addEventListener('click', function () { stopPlay(); goTo(V.idx + 1); });
    $('vizLast').addEventListener('click', function () { stopPlay(); goTo(V.steps.length - 1); });
    $('vizPlay').addEventListener('click', togglePlay);
    $('vizSpeed').addEventListener('input', renderControls);
    $('btnBuildViz').addEventListener('click', function () { build('full'); A.toast('已按当前网络与样本重新生成传播快照'); });
    $('vizStepper').addEventListener('click', function (e) {
      var chip = e.target.closest('.step-chip');
      if (chip) { stopPlay(); goTo(+chip.dataset.i); }
    });
    $('flowCanvas').addEventListener('click', function (e) {
      var part = e.target.closest('.bwd-part');
      var card = e.target.closest('.flow-card');
      if (!card) return;
      stopPlay();
      var l = +card.dataset.layer, kind = card.dataset.kind;
      if (part && kind === 'layer') { goTo(findStep('delta', l)); return; }
      if (kind === 'update') { goTo(findStep('grad', l)); return; }
      goTo(+card.dataset.step || 0);
    });
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') { stopPlay(); goTo(V.idx + 1); }
      else if (e.key === 'ArrowLeft') { stopPlay(); goTo(V.idx - 1); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    });
  }

  /* ---------------- 启动 ---------------- */
  var tries = 0;
  function init() {
    if (!A || !A.net || !A.net()) {
      if (tries++ < 20) setTimeout(init, 30);
      return;
    }
    bind();
    build('full');
  }
  window.BPViz = { build: build, goTo: goTo, state: V };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
