/* =============================================================
 * BP 神经网络核心计算引擎  (无第三方依赖)
 * 浏览器: window.BPEngine   /   Node: require('./engine.js')
 * 提供: 任意层数/宽度、多种激活与损失函数、完整前向/反向中间量
 * ============================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BPEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPS = 1e-9;
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var zcap = function (z) { return clamp(z, -60, 60); };
  var finite = function (v) { return Number.isFinite(v) ? v : 0; };

  /* 可复现的伪随机数发生器 */
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- 激活函数 ---------------- */
  var ACT = {
    sigmoid: {
      label: 'Sigmoid', desc: '1 / (1 + e⁻ᶻ)，输出 (0,1)',
      f: function (z) { return 1 / (1 + Math.exp(-zcap(z))); },
      df: function (z, a) { return a * (1 - a); }
    },
    tanh: {
      label: 'Tanh', desc: 'tanh(z)，输出 (−1,1)',
      f: function (z) { return Math.tanh(zcap(z)); },
      df: function (z, a) { return 1 - a * a; }
    },
    relu: {
      label: 'ReLU', desc: 'max(0, z)',
      f: function (z) { return Math.max(0, z); },
      df: function (z) { return z > 0 ? 1 : 0; }
    },
    lrelu: {
      label: 'Leaky ReLU', desc: 'z > 0 ? z : 0.01z',
      f: function (z) { return z > 0 ? z : 0.01 * z; },
      df: function (z) { return z > 0 ? 1 : 0.01; }
    },
    elu: {
      label: 'ELU', desc: 'z > 0 ? z : eᶻ − 1',
      f: function (z) { return z > 0 ? z : Math.exp(zcap(z)) - 1; },
      df: function (z, a) { return z > 0 ? 1 : a + 1; }
    },
    linear: {
      label: 'Linear', desc: 'f(z) = z，回归输出',
      f: function (z) { return z; },
      df: function () { return 1; }
    },
    softmax: {
      label: 'Softmax', desc: '向量归一化，多分类输出', vector: true
    }
  };

  function softmaxVec(z) {
    var m = -Infinity, i;
    for (i = 0; i < z.length; i++) if (z[i] > m) m = z[i];
    var ex = z.map(function (v) { return Math.exp(clamp(v - m, -60, 60)); });
    var s = ex.reduce(function (p, c) { return p + c; }, 0) + EPS;
    return ex.map(function (v) { return v / s; });
  }

  function activate(name, z) {
    if (name === 'softmax') return softmaxVec(z);
    return z.map(function (v) { return finite(ACT[name].f(v)); });
  }

  /* ---------------- 损失函数 ----------------
   * loss(a, t) -> 标量；d(a, t) -> ∂L/∂a 向量
   * ------------------------------------------- */
  var LOSS = {
    mse: {
      label: 'MSE 均方误差', desc: '½ Σ(tᵢ − aᵢ)²',
      loss: function (a, t) {
        var s = 0;
        for (var i = 0; i < a.length; i++) s += (a[i] - t[i]) * (a[i] - t[i]);
        return 0.5 * s;
      },
      d: function (a, t) { return a.map(function (v, i) { return v - t[i]; }); }
    },
    mae: {
      label: 'MAE 平均绝对误差', desc: 'Σ |tᵢ − aᵢ|',
      loss: function (a, t) {
        var s = 0;
        for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - t[i]);
        return s;
      },
      d: function (a, t) { return a.map(function (v, i) { return v === t[i] ? 0 : (v > t[i] ? 1 : -1); }); }
    },
    huber: {
      label: 'Huber 平滑误差', desc: 'δ=1，小误差平方 / 大误差线性',
      loss: function (a, t) {
        var s = 0;
        for (var i = 0; i < a.length; i++) {
          var r = Math.abs(a[i] - t[i]);
          s += r <= 1 ? 0.5 * r * r : r - 0.5;
        }
        return s;
      },
      d: function (a, t) { return a.map(function (v, i) { return clamp(v - t[i], -1, 1); }); }
    },
    bce: {
      label: 'BCE 二元交叉熵', desc: '−Σ[t·ln a + (1−t)·ln(1−a)]',
      loss: function (a, t) {
        var s = 0;
        for (var i = 0; i < a.length; i++) {
          var p = clamp(a[i], EPS, 1 - EPS);
          s += t[i] * Math.log(p) + (1 - t[i]) * Math.log(1 - p);
        }
        return -s;
      },
      d: function (a, t) {
        return a.map(function (v, i) {
          var p = clamp(v, EPS, 1 - EPS);
          return (p - t[i]) / (p * (1 - p));   // 与 sigmoid 导数相乘后化简为 a − t
        });
      }
    },
    ce: {
      label: 'CE 多分类交叉熵', desc: '−Σ tᵢ·ln aᵢ（配合 Softmax）',
      loss: function (a, t) {
        var s = 0;
        for (var i = 0; i < a.length; i++) s += t[i] * Math.log(clamp(a[i], EPS, 1));
        return -s;
      },
      d: function (a, t) {
        return a.map(function (v, i) { return -t[i] / clamp(v, EPS, 1); });
      }
    }
  };

  /* 经典解析化简: δ⁽ᴸ⁾ = a − t，数值更稳定、也是教材标准写法 */
  function isPaired(loss, act) {
    return (loss === 'bce' && act === 'sigmoid') || (loss === 'ce' && act === 'softmax');
  }

  /* ---------------- 网络 ---------------- */
  function Network(cfg) {
    this.sizes = cfg.sizes.map(Number);
    this.acts = cfg.activations.slice();
    this.loss = cfg.loss || 'mse';
    this.L = this.sizes.length - 1;
    if (this.L < 1) throw new Error('网络至少需要一层连接（输入层 + 输出层）');
    if (this.acts.length !== this.L) throw new Error('激活函数数量与层数不匹配');
    for (var k = 0; k < this.acts.length; k++) {
      if (!ACT[this.acts[k]]) throw new Error('未知激活函数: ' + this.acts[k]);
    }
    if (!LOSS[this.loss]) throw new Error('未知损失函数: ' + this.loss);
    this.init(cfg.initMethod || 'xavier', cfg.seed == null ? 42 : Number(cfg.seed));
    if (cfg.weights && cfg.biases) this.setParams(cfg.weights, cfg.biases);
  }

  Network.prototype.init = function (method, seed) {
    var rnd = mulberry32(seed);
    var W = [], B = [], k, j, i;
    for (k = 0; k < this.L; k++) {
      var nin = this.sizes[k], nout = this.sizes[k + 1];
      var xavier = Math.sqrt(6 / (nin + nout));
      var heSd = Math.sqrt(2 / nin);
      var M = [], b = [];
      for (j = 0; j < nout; j++) {
        var row = [];
        for (i = 0; i < nin; i++) {
          var v;
          switch (method) {
            case 'zeros': v = 0; break;
            case 'ones': v = 1; break;
            case 'uniform': v = rnd() * 2 - 1; break;
            case 'normal': v = (rnd() + rnd() + rnd() + rnd() - 2) * 0.7; break;
            case 'he': v = (rnd() + rnd() + rnd() + rnd() + rnd() + rnd() - 3) * heSd; break;
            default: v = (rnd() * 2 - 1) * xavier;
          }
          row.push(v);
        }
        M.push(row);
        b.push(method === 'ones' ? 1 : 0);
      }
      W.push(M); B.push(b);
    }
    this.weights = W; this.biases = B;
    this.seed = seed; this.initMethod = method;
    this.resetOptimizer();
    return this;
  };

  Network.prototype.setParams = function (W, B) {
    if (!Array.isArray(W) || W.length !== this.L) throw new Error('权重矩阵层数不匹配');
    var w = [], b = [], k, j, i;
    for (k = 0; k < this.L; k++) {
      if (W[k].length !== this.sizes[k + 1]) throw new Error('第 ' + (k + 1) + ' 层权重行数不匹配');
      var M = [];
      for (j = 0; j < this.sizes[k + 1]; j++) {
        if (W[k][j].length !== this.sizes[k]) throw new Error('第 ' + (k + 1) + ' 层权重列数不匹配');
        var row = [];
        for (i = 0; i < this.sizes[k]; i++) {
          var v = Number(W[k][j][i]);
          if (!Number.isFinite(v)) throw new Error('权重含有非法数值');
          row.push(v);
        }
        M.push(row);
      }
      w.push(M);
      if (!B || !B[k] || B[k].length !== this.sizes[k + 1]) throw new Error('偏置维度不匹配');
      b.push(B[k].map(function (x) {
        var n = Number(x);
        if (!Number.isFinite(n)) throw new Error('偏置含有非法数值');
        return n;
      }));
    }
    this.weights = w; this.biases = b;
    this.resetOptimizer();
    return this;
  };

  Network.prototype.getParams = function () {
    return {
      weights: this.weights.map(function (M) { return M.map(function (r) { return r.slice(); }); }),
      biases: this.biases.map(function (v) { return v.slice(); })
    };
  };

  Network.prototype.resetOptimizer = function () {
    var self = this;
    var zerosW = this.weights.map(function (M) { return M.map(function (r) { return r.map(function () { return 0; }); }); });
    var zerosB = this.biases.map(function (v) { return v.map(function () { return 0; }); });
    this.t = 0;
    this.mW = zerosW; this.vW = zerosW.map(function (M) { return M.map(function (r) { return r.slice(); }); });
    this.mB = zerosB; this.vB = zerosB.map(function (v) { return v.slice(); });
    this.velW = zerosW; this.velB = zerosB;
    return self;
  };

  /* 前向传播: 返回每一层的 z 与 a，a[0] 即输入 x
   * opts.dropout: 隐藏层丢弃率(0~0.9)，采用 inverted dropout；输出层不丢弃
   * opts.rnd: 可复现随机源；opts.masks: 指定各层掩码(供数值梯度检验) */
  Network.prototype.forward = function (x, opts) {
    if (x.length !== this.sizes[0]) throw new Error('输入维度与输入层节点数不一致');
    opts = opts || {};
    var p = clamp(Number(opts.dropout) || 0, 0, 0.9);
    var rnd = opts.rnd || Math.random;
    var a = [x.slice()], z = [null], masks = [null], k, j, i;
    for (k = 0; k < this.L; k++) {
      var zv = [];
      for (j = 0; j < this.sizes[k + 1]; j++) {
        var s = this.biases[k][j];
        for (i = 0; i < this.sizes[k]; i++) s += this.weights[k][j][i] * a[k][i];
        zv.push(finite(s));
      }
      z.push(zv);
      var av = activate(this.acts[k], zv);
      if (p > 0 && k < this.L - 1) {           // 仅隐藏层
        var keep = 1 - p, m = new Array(av.length);
        var given = opts.masks && opts.masks[k + 1];
        for (j = 0; j < av.length; j++) {
          m[j] = given ? (given[j] ? 1 : 0) : (rnd() >= p ? 1 : 0);
          av[j] = finite(av[j] * m[j] / keep); // inverted dropout：期望不变
        }
        masks.push(m);
      } else {
        masks.push(null);
      }
      a.push(av);
    }
    return { a: a, z: z, x: x.slice(), masks: masks, keep: 1 - p };
  };

  /* 反向传播: 返回各层误差信号 δ 与梯度 ∂L/∂W、∂L/∂b */
  Network.prototype.backward = function (cache, t) {
    var L = this.L, k, j, i;
    if (t.length !== this.sizes[L]) throw new Error('目标维度与输出层节点数不一致');
    var aL = cache.a[L], zL = cache.z[L];
    var actOut = this.acts[L - 1];
    var deltas = new Array(L + 1).fill(null);
    var d;

    if (isPaired(this.loss, actOut)) {
      deltas[L] = aL.map(function (v, i) { return v - t[i]; });
    } else {
      d = LOSS[this.loss].d(aL, t);
      if (actOut === 'softmax') {
        /* Jᵀ·d : aᵢ(dᵢ − Σⱼ aⱼdⱼ) */
        var dot = 0;
        for (i = 0; i < aL.length; i++) dot += aL[i] * d[i];
        deltas[L] = aL.map(function (v, i) { return v * (d[i] - dot); });
      } else {
        deltas[L] = d.map(function (v, i) {
          return finite(v * ACT[actOut].df(zL[i], aL[i]));
        });
      }
    }

    for (var l = L - 1; l >= 1; l--) {
      var act = this.acts[l - 1];
      var zl = cache.z[l], al = cache.a[l], next = deltas[l + 1];
      var mk = cache.masks && cache.masks[l];
      var keep = cache.keep || 1;
      var dv = new Array(this.sizes[l]);
      for (i = 0; i < this.sizes[l]; i++) {
        var s = 0;
        for (j = 0; j < this.sizes[l + 1]; j++) s += this.weights[l][j][i] * next[j];
        // inverted dropout 隐藏层：a = f(z)·m/keep，故 ∂a/∂z 同样含 m/keep
        var factor = mk ? mk[i] / keep : 1;
        dv[i] = finite(s * ACT[act].df(zl[i], al[i]) * factor);
      }
      deltas[l] = dv;
    }

    var gW = [], gB = [];
    for (k = 0; k < L; k++) {
      var M = [], gv = [];
      for (j = 0; j < this.sizes[k + 1]; j++) {
        var row = [];
        for (i = 0; i < this.sizes[k]; i++) row.push(finite(deltas[k + 1][j] * cache.a[k][i]));
        M.push(row);
        gv.push(deltas[k + 1][j]);
      }
      gW.push(M); gB.push(gv);
    }
    return { deltas: deltas, gradW: gW, gradB: gB, paired: isPaired(this.loss, actOut), dOut: d || null };
  };

  Network.prototype.lossOf = function (a, t) { return LOSS[this.loss].loss(a, t); };
  Network.prototype.predict = function (x) { return this.forward(x).a[this.L]; };

  /* 全批量梯度: 所有样本梯度的平均
   * opts.dropout: 隐藏层丢弃率；opts.l2: L2 权重衰减系数；opts.rnd: 可复现随机源 */
  Network.prototype.accumulate = function (dataset, opts) {
    if (!dataset.length) throw new Error('数据集为空');
    opts = opts || {};
    var p = Number(opts.dropout) || 0;
    var l2 = Number(opts.l2) || 0;
    var rnd = opts.rnd;
    var gW = this.weights.map(function (M) { return M.map(function (r) { return r.map(function () { return 0; }); }); });
    var gB = this.biases.map(function (v) { return v.map(function () { return 0; }); });
    var total = 0, details = [], n;
    for (n = 0; n < dataset.length; n++) {
      var s = dataset[n];
      var cache = this.forward(s.x, { dropout: p, rnd: rnd });
      var bk = this.backward(cache, s.t);
      var lv = this.lossOf(cache.a[this.L], s.t);
      total += lv;
      for (var k = 0; k < this.L; k++) {
        for (var j = 0; j < this.sizes[k + 1]; j++) {
          gB[k][j] += bk.gradB[k][j];
          for (var i = 0; i < this.sizes[k]; i++) gW[k][j][i] += bk.gradW[k][j][i];
        }
      }
      details.push({ x: s.x.slice(), t: s.t.slice(), cache: cache, back: bk, loss: lv });
    }
    var N = dataset.length;
    for (var k2 = 0; k2 < this.L; k2++) {
      for (var j2 = 0; j2 < this.sizes[k2 + 1]; j2++) {
        gB[k2][j2] /= N;
        for (var i2 = 0; i2 < this.sizes[k2]; i2++) {
          gW[k2][j2][i2] /= N;
          if (l2 > 0) gW[k2][j2][i2] += l2 * this.weights[k2][j2][i2]; // L2 只作用于权重
        }
      }
    }
    return { gradW: gW, gradB: gB, loss: total / N, details: details };
  };

  /* 全局范数梯度裁剪，防止 ReLU / 交叉熵组合下梯度爆炸 */
  Network.prototype.clipGradients = function (gW, gB, maxNorm) {
    if (!(maxNorm > 0)) return 1;
    var sq = 0, k, j, i;
    for (k = 0; k < this.L; k++) {
      for (j = 0; j < gW[k].length; j++) {
        for (i = 0; i < gW[k][j].length; i++) sq += gW[k][j][i] * gW[k][j][i];
        sq += gB[k][j] * gB[k][j];
      }
    }
    var norm = Math.sqrt(sq);
    if (!Number.isFinite(norm) || norm <= maxNorm) return 1;
    var scale = maxNorm / norm;
    for (k = 0; k < this.L; k++) {
      for (j = 0; j < gW[k].length; j++) {
        for (i = 0; i < gW[k][j].length; i++) gW[k][j][i] *= scale;
        gB[k][j] *= scale;
      }
    }
    return scale;
  };

  /* 参数更新: sgd / momentum / adam */
  Network.prototype.apply = function (gW, gB, lr, optimizer) {
    optimizer = optimizer || 'sgd';
    this.t++;
    var b1 = 0.9, b2 = 0.999, eps = 1e-8, t = this.t;
    var mu = 0.9, k, j, i, g, delta;
    for (k = 0; k < this.L; k++) {
      for (j = 0; j < this.sizes[k + 1]; j++) {
        for (i = 0; i < this.sizes[k]; i++) {
          g = gW[k][j][i];
          if (optimizer === 'adam') {
            this.mW[k][j][i] = b1 * this.mW[k][j][i] + (1 - b1) * g;
            this.vW[k][j][i] = b2 * this.vW[k][j][i] + (1 - b2) * g * g;
            var mh = this.mW[k][j][i] / (1 - Math.pow(b1, t));
            var vh = this.vW[k][j][i] / (1 - Math.pow(b2, t));
            delta = -lr * mh / (Math.sqrt(vh) + eps);
          } else if (optimizer === 'momentum') {
            this.velW[k][j][i] = mu * this.velW[k][j][i] - lr * g;
            delta = this.velW[k][j][i];
          } else {
            delta = -lr * g;
          }
          this.weights[k][j][i] = finite(this.weights[k][j][i] + delta);
        }
        g = gB[k][j];
        if (optimizer === 'adam') {
          this.mB[k][j] = b1 * this.mB[k][j] + (1 - b1) * g;
          this.vB[k][j] = b2 * this.vB[k][j] + (1 - b2) * g * g;
          var mhb = this.mB[k][j] / (1 - Math.pow(b1, t));
          var vhb = this.vB[k][j] / (1 - Math.pow(b2, t));
          this.biases[k][j] = finite(this.biases[k][j] - lr * mhb / (Math.sqrt(vhb) + eps));
        } else if (optimizer === 'momentum') {
          this.velB[k][j] = mu * this.velB[k][j] - lr * g;
          this.biases[k][j] = finite(this.biases[k][j] + this.velB[k][j]);
        } else {
          this.biases[k][j] = finite(this.biases[k][j] - lr * g);
        }
      }
    }
    return this;
  };

  /* 训练一轮（全批量） */
  Network.prototype.epoch = function (dataset, lr, opts) {
    opts = opts || {};
    var acc = this.accumulate(dataset, { dropout: opts.dropout, l2: opts.l2, rnd: opts.rnd });
    var scale = this.clipGradients(acc.gradW, acc.gradB, opts.gradClip == null ? 5 : opts.gradClip);
    this.apply(acc.gradW, acc.gradB, lr, opts.optimizer || 'sgd');
    return { loss: acc.loss, details: acc.details, clipScale: scale };
  };

  /* 评估：返回平均损失与分类准确率（输出维度>1 或二值单输出时） */
  Network.prototype.evaluate = function (dataset) {
    if (!dataset.length) return { loss: 0, acc: 0, n: 0 };
    var total = 0, correct = 0;
    for (var n = 0; n < dataset.length; n++) {
      var s = dataset[n];
      var out = this.predict(s.x);
      total += this.lossOf(out, s.t);
      var pi = out.indexOf(Math.max.apply(null, out));
      var ti = s.t.indexOf(Math.max.apply(null, s.t));
      if (s.t.length === 1) { pi = out[0] >= 0.5 ? 1 : 0; ti = s.t[0] >= 0.5 ? 1 : 0; }
      if (pi === ti) correct++;
    }
    return { loss: total / dataset.length, acc: correct / dataset.length, n: dataset.length };
  };

  return {
    Network: Network,
    ACT: ACT,
    LOSS: LOSS,
    activate: activate,
    isPaired: isPaired
  };
});
