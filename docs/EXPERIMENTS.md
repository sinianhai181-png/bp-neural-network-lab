# 可复现实验

这份文档给出可以直接运行的实验代码，以及预期结果。所有实验都固定随机种子，重复运行结果一致。计算引擎不依赖浏览器，以下脚本在 Node 中运行。

## 准备

在项目根目录执行：

```bash
node -e "const {Network} = require('./js/engine.js'); console.log(typeof Network)"
```

输出 `function` 即可。不需要 npm install。

## 实验一：XOR

两输入、单隐藏层（3 个 Sigmoid 单元）、Sigmoid 输出、BCE 损失。

```js
const { Network } = require('./js/engine.js');
const data = [
  { x: [0, 0], t: [0] }, { x: [0, 1], t: [1] },
  { x: [1, 0], t: [1] }, { x: [1, 1], t: [0] }
];
const net = new Network({
  sizes: [2, 3, 1],
  activations: ['sigmoid', 'sigmoid'],
  loss: 'bce',
  seed: 3
});
for (let e = 0; e < 1500; e++) net.epoch(data, 0.8, { optimizer: 'sgd' });
console.log(net.evaluate(data));                  // { loss, acc, n }
console.log(data.map(s => net.predict(s.x)[0]));  // 四个预测值
```

预期：损失约 0.012，准确率 100%，四个输出接近 0 / 1 / 1 / 0。若把 seed 换成其他值，仍能收敛，但最终数值会有差异。

**为什么隐藏层至少要有 2 个单元**：XOR 不是线性可分的，隐藏层要先把平面折成两块。单隐藏单元只能给出一条直线分界，无法解决 XOR。

## 实验二：线性回归

无隐藏层、Linear 输出、MSE 损失，拟合 y = 2x + 1。

```js
const { Network } = require('./js/engine.js');
const data = [{x:[0],t:[1]}, {x:[1],t:[3]}, {x:[2],t:[5]}, {x:[3],t:[7]}];
const net = new Network({ sizes:[1,1], activations:['linear'], loss:'mse', seed:9 });
for (let e = 0; e < 800; e++) net.epoch(data, 0.05, { optimizer:'sgd' });
console.log(data.map(s => net.predict(s.x)[0].toFixed(2)));  // 1.00 3.00 5.00 7.00
```

学习率超过约 0.1 会发散（Linear + MSE 的二阶曲率较大）。这是观察学习率影响最简单的例子。

## 实验三：三分类

Tanh 隐藏层、Softmax 输出、CE 损失，one-hot 目标。

```js
const { Network } = require('./js/engine.js');
const data = [
  { x:[0,0], t:[1,0,0] }, { x:[0,1], t:[0,1,0] },
  { x:[1,0], t:[0,0,1] }, { x:[1,1], t:[1,0,0] }
];
const net = new Network({
  sizes:[2,5,3], activations:['tanh','softmax'], loss:'ce',
  seed:11, opt:'adam'
});
for (let e = 0; e < 800; e++) net.epoch(data, 0.05, { optimizer:'adam' });
console.log(net.evaluate(data));
console.log(data.map(s => net.predict(s.x).map(v => v.toFixed(2))));
```

这个例子启用 Softmax + CE 的解析化简 δ = a − t。预期损失约 0.0001，准确率 100%，每个输出是接近 one-hot 的概率分布。

## 实验四：优化器对比

同一初始化下比较三种优化器的收敛速度。注意每次要重建网络，保证起点相同。

```js
const { Network } = require('./js/engine.js');
const data = [
  { x:[0,0], t:[0] }, { x:[0,1], t:[1] },
  { x:[1,0], t:[1] }, { x:[1,1], t:[0] }
];
for (const [name, lr] of [['sgd',0.8], ['momentum',0.3], ['adam',0.05]]) {
  const net = new Network({
    sizes:[2,4,1], activations:['tanh','sigmoid'], loss:'bce', seed:7
  });
  const curve = [];
  for (let e = 0; e < 400; e++) {
    curve.push(net.epoch(data, lr, { optimizer:name }).loss);
  }
  console.log(name, '初始', curve[0].toFixed(4), '-> 最终', curve[399].toFixed(5));
}
```

结论依赖学习率：Adam 在 0.05 附近通常最稳，SGD 要更大学习率才追得上。界面里的「优化器对比」实验自动完成同样的比较并画图。

## 实验五：梯度检验

验证反向传播公式是否正确。中心差分近似导数：

```
(g(w+h) − g(w−h)) / (2h) ≈ ∂L/∂w
```

```js
const { Network } = require('./js/engine.js');
const net = new Network({ sizes:[2,3,1], activations:['sigmoid','sigmoid'], loss:'bce', seed:7 });
const x = [0.6, -0.3], t = [0.8], h = 1e-6;
const bk = net.backward(net.forward(x), t);
const loss = () => net.lossOf(net.forward(x).a[net.L], t);
let worst = 0;
for (let j = 0; j < 3; j++) {
  const o = net.weights[0][j][0];
  net.weights[0][j][0] = o + h; const lp = loss();
  net.weights[0][j][0] = o - h; const lm = loss();
  net.weights[0][j][0] = o;
  worst = Math.max(worst, Math.abs((lp - lm)/(2*h) - bk.gradW[0][j][0]));
}
console.log('最大误差', worst.toExponential(2));  // 约 1e-10
```

`npm test` 会把检验扩展到 21 组激活/损失搭配。数学推导见 [MATH.md](MATH.md)。

## 实验六：正则化与过拟合

引擎支持可选的 L2 与 inverted dropout，默认关闭。

```js
const net = new Network({ sizes:[1,24,1], activations:['tanh','linear'], loss:'mse', seed:5 });
// 训练时：
net.epoch(trainData, 0.05, { optimizer:'sgd', l2:0.01, dropout:0.2, rnd:myRng });
// 评估时不要传 dropout：
net.evaluate(validData);
```

`rnd` 必须是可复现的随机源（返回 [0,1) 的函数），否则每次前向的 mask 都不同，梯度检验无法进行。界面里的「过拟合与正则」实验自带带噪声数据生成和训练/验证划分，可直接调参观察。

## 参数速查

| 参数 | 位置 | 作用 | 调大后的效果 |
| --- | --- | --- | --- |
| `sizes` | 构造函数 | 各层神经元数 | 容量增大，更强的拟合能力，也更易过拟合 |
| `activations` | 构造函数 | 逐层激活函数 | 决定非线性形式与输出范围 |
| `loss` | 构造函数 | 损失函数 | 决定优化目标与输出层误差形式 |
| `seed` | 构造函数 | 初始化随机种子 | 相同种子保证结果可复现 |
| `lr` | `epoch()` 第二参数 | 学习率 | 收敛更快但过大导致发散 |
| `optimizer` | `epoch()` opts | sgd / momentum / adam | 改变更新方向与步长自适应 |
| `gradClip` | `epoch()` opts | 梯度范数上限，默认 5 | 防止梯度爆炸；过小会拖慢学习 |
| `dropout` | `epoch()` opts | 隐藏层丢弃率 | 正则化，抑制过拟合 |
| `l2` | `epoch()` opts | 权重衰减系数 | 正则化，压缩权重幅值 |
| `rnd` | `epoch()` opts | 可复现随机源 | 让 dropout 的 mask 可重复 |

## 常见现象

- **损失变成 NaN**：学习率过大，或某层输出溢出。先降低学习率，检查是否用了不匹配的损失与激活。
- **损失长期不降**：网络容量不足（尤其 XOR 用单隐藏单元）、学习率过小、或激活函数全用 Linear（此时整个网络等价于一个线性变换）。
- **训练损失低但验证损失高**：过拟合。减小网络、加大 L2 或 Dropout、增加样本。
- **准确率始终是 0**：检查目标格式——分类任务的 `t` 要用 one-hot（多类）或 0/1（单输出），不能是类别编号。
