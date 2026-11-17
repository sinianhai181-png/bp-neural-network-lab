const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
let fails = 0;
function chk(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); if (!cond) fails++; }
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 1) Dropout 梯度检验（固定 mask，保证扰动权重时前向随机性不变）
{
  const net = new E.Network({ sizes: [2, 4, 3, 2], activations: ['tanh', 'relu', 'sigmoid'], loss: 'mse', seed: 7 });
  const x = [0.3, -0.7], t = [0.8, -0.2], p = 0.35;
  const cache = net.forward(x, { dropout: p, rnd: seeded(99) });
  const bk = net.backward(cache, t);
  const h = 1e-6;
  let maxErr = 0, count = 0;
  const lossWithFixedMask = () => net.lossOf(net.forward(x, { dropout: p, masks: cache.masks }).a[net.L], t);
  for (let k = 0; k < net.L; k++) {
    for (let j = 0; j < net.sizes[k + 1]; j++) {
      for (let i = 0; i < net.sizes[k]; i++) {
        const o = net.weights[k][j][i];
        net.weights[k][j][i] = o + h; const lp = lossWithFixedMask();
        net.weights[k][j][i] = o - h; const lm = lossWithFixedMask();
        net.weights[k][j][i] = o;
        maxErr = Math.max(maxErr, Math.abs((lp - lm) / (2 * h) - bk.gradW[k][j][i])); count++;
      }
      const ob = net.biases[k][j];
      net.biases[k][j] = ob + h; const lp = lossWithFixedMask();
      net.biases[k][j] = ob - h; const lm = lossWithFixedMask();
      net.biases[k][j] = ob;
      maxErr = Math.max(maxErr, Math.abs((lp - lm) / (2 * h) - bk.gradB[k][j])); count++;
    }
  }
  chk('Dropout 梯度检验 (固定 mask)', maxErr < 1e-5, 'maxErr=' + maxErr.toExponential(2) + ', n=' + count);
}

// 2) L2 梯度检验
{
  const net = new E.Network({ sizes: [2, 3, 1], activations: ['sigmoid', 'linear'], loss: 'mse', seed: 5 });
  const data = [{ x: [0.2, 0.9], t: [0.4] }, { x: [-0.5, 0.3], t: [0.7] }];
  const lambda = 0.5;
  const acc = net.accumulate(data, { l2: lambda });
  const h = 1e-6;
  const total = () => {
    let d = 0, r = 0;
    for (const smp of data) d += net.lossOf(net.predict(smp.x), smp.t);
    for (let k = 0; k < net.L; k++) for (const row of net.weights[k]) for (const w of row) r += 0.5 * lambda * w * w;
    return d / data.length + r; // 标准约定：数据损失按样本平均，正则项不随 batch 平均
  };
  let maxErr = 0;
  for (let k = 0; k < net.L; k++) {
    for (let j = 0; j < net.sizes[k + 1]; j++) {
      for (let i = 0; i < net.sizes[k]; i++) {
        const o = net.weights[k][j][i];
        net.weights[k][j][i] = o + h; const lp = total();
        net.weights[k][j][i] = o - h; const lm = total();
        net.weights[k][j][i] = o;
        maxErr = Math.max(maxErr, Math.abs((lp - lm) / (2 * h) - acc.gradW[k][j][i]));
      }
    }
  }
  chk('L2 梯度检验', maxErr < 1e-5, 'maxErr=' + maxErr.toExponential(2));
}

// 3) 默认路径完全兼容：无 dropout / 无 l2 的梯度与旧实现一致
{
  const net = new E.Network({ sizes: [2, 3, 1], activations: ['sigmoid', 'sigmoid'], loss: 'bce', seed: 11 });
  const smp = { x: [0.6, -0.3], t: [0.8] };
  const a = net.accumulate([smp]), b = net.accumulate([smp], { dropout: 0, l2: 0 });
  let same = Math.abs(a.loss - b.loss) < 1e-12;
  for (let k = 0; k < net.L; k++) for (let j = 0; j < net.sizes[k + 1]; j++) {
    same = same && Math.abs(a.gradB[k][j] - b.gradB[k][j]) < 1e-12;
    for (let i = 0; i < net.sizes[k]; i++) same = same && Math.abs(a.gradW[k][j][i] - b.gradW[k][j][i]) < 1e-12;
  }
  chk('默认路径向后兼容', same);
}

// 4) Dropout 收敛仍有效
{
  const xor = [{ x: [0, 0], t: [0] }, { x: [0, 1], t: [1] }, { x: [1, 0], t: [1] }, { x: [1, 1], t: [0] }];
  const net = new E.Network({ sizes: [2, 6, 1], activations: ['tanh', 'sigmoid'], loss: 'bce', seed: 3, opt: 'adam' });
  const rnd = seeded(2026);
  let last = 0;
  for (let e = 0; e < 1200; e++) last = net.epoch(xor, 0.03, { optimizer: 'adam', dropout: 0.15, rnd }).loss;
  const ev = net.evaluate(xor);
  chk('Dropout 训练仍能收敛', last < 0.1 && ev.acc === 1, 'loss=' + last.toFixed(4) + ', acc=' + ev.acc);
}

// 5) 全搭配数值梯度检验：每种损失在其语义有效的输出激活下逐项校验 ∂L/∂W 与 ∂L/∂b
{
  // BCE 的导数假设输出是 (0,1) 概率，因此只在 sigmoid 输出下检验；
  // CE 只在 softmax 输出下检验；MSE/MAE/Huber 对任意输出激活都成立，逐一遍历。
  const plans = [];
  for (const outAct of ['sigmoid', 'tanh', 'relu', 'lrelu', 'elu', 'linear']) {
    for (const loss of ['mse', 'mae', 'huber']) plans.push({ outAct, loss });
    if (outAct === 'sigmoid') plans.push({ outAct, loss: 'bce' });
  }
  plans.push({ outAct: 'softmax', loss: 'ce' });
  plans.push({ outAct: 'softmax', loss: 'mse' }); // softmax 通用雅可比路径

  const targetFor = (loss) => loss === 'ce' ? [0, 1]
    : loss === 'bce' ? [0.8, 0.3] : [0.4, -0.25];
  let worst = 0, params = 0, bad = 0;
  for (const plan of plans) {
    const sizes = [3, 4, 2];
    const net = new E.Network({ sizes, activations: ['tanh', plan.outAct], loss: plan.loss, seed: 7 });
    const x = [0.2, 0.7, -0.5], t = targetFor(plan.loss), h = 1e-6;
    const bk = net.backward(net.forward(x), t);
    const L = () => net.lossOf(net.forward(x).a[net.L], t);
    for (let k = 0; k < net.L; k++) for (let j = 0; j < sizes[k + 1]; j++) {
      for (let i = 0; i < sizes[k]; i++) {
        const o = net.weights[k][j][i];
        net.weights[k][j][i] = o + h; const lp = L();
        net.weights[k][j][i] = o - h; const lm = L();
        net.weights[k][j][i] = o;
        worst = Math.max(worst, Math.abs((lp - lm) / (2 * h) - bk.gradW[k][j][i])); params++;
      }
      const ob = net.biases[k][j];
      net.biases[k][j] = ob + h; const lp = L();
      net.biases[k][j] = ob - h; const lm = L();
      net.biases[k][j] = ob;
      worst = Math.max(worst, Math.abs((lp - lm) / (2 * h) - bk.gradB[k][j])); params++;
    }
  }
  chk('全搭配数值梯度检验', worst < 1e-5,
    '搭配=' + plans.length + ', 参数=' + params + ', 最大误差=' + worst.toExponential(2));
}

console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
process.exitCode = fails ? 1 : 0;
