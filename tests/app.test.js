const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const path = require('path'); const base = path.join(__dirname, '..') + path.sep;
const html = fs.readFileSync(base + 'index.html', 'utf8');
const engine = fs.readFileSync(base + 'js/engine.js', 'utf8');
const app = fs.readFileSync(base + 'js/app.js', 'utf8');
const vizSrc = fs.readFileSync(base + 'js/visualizer.js', 'utf8');
const page = html
  .replace('<link rel="stylesheet" href="css/style.css">', '')
  .replace('<script src="js/engine.js"></script>', '<script>' + engine + '</script>')
  .replace('<script src="js/app.js"></script>', '<script>' + app + '</script>')
  .replace('<script src="js/visualizer.js"></script>', '<script>' + vizSrc + '</script>');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(page, {
  url: require('url').pathToFileURL(base + 'index.html').href,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const w = dom.window, d = w.document;
w.addEventListener('error', e => errors.push('window.error: ' + e.message));
const $ = id => d.getElementById(id);
const results = [];
function chk(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra === undefined ? '' : String(extra) }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const change = id => $(id).dispatchEvent(new w.Event('change', { bubbles: true }));

(async function () {
  await sleep(250); // 等待 DOMContentLoaded / init()

  chk('初始化：网络图节点数 = 6', d.querySelectorAll('#netSvgWrap circle').length === 6, d.querySelectorAll('#netSvgWrap circle').length);
  chk('初始化：连线数 = 9', d.querySelectorAll('#netSvgWrap line').length === 9, d.querySelectorAll('#netSvgWrap line').length);
  chk('初始化：隐藏层 1 行', d.querySelectorAll('#hiddenList .hidden-row').length === 1);
  chk('初始化：4 个样本', d.querySelectorAll('#datasetWrap tr[data-row]').length === 4);
  chk('初始化：权重输入 9 项', d.querySelectorAll('#paramEditor input.pw').length === 9, d.querySelectorAll('#paramEditor input.pw').length);
  chk('初始化：理论表已生成', d.querySelectorAll('#actTable tr').length >= 7 && d.querySelectorAll('#lossTable tr').length >= 5);
  chk('初始化：曲线空态', $('curveSvgWrap').textContent.includes('开始训练'));
  chk('初始化：推荐组合徽章', $('pairBadge').textContent.includes('δ = a − t'), $('pairBadge').textContent);

  /* ===== 新增：传播全景图 + 逐环节播放器 ===== */
  chk('全景：每层一张层卡 + 输入/损失/更新卡',
    d.querySelectorAll('#flowCanvas .flow-card.layer-card').length === 2 &&
    d.querySelectorAll('#flowCanvas .flow-card.input-card').length === 1 &&
    d.querySelectorAll('#flowCanvas .flow-card.loss-card').length === 1 &&
    d.querySelectorAll('#flowCanvas .flow-card.upd-card').length === 3,
    d.querySelectorAll('#flowCanvas .flow-card').length);
  chk('全景：前向/反向双向流光箭头', d.querySelectorAll('#flowCanvas .fa.fwd').length >= 3 && d.querySelectorAll('#flowCanvas .fa.bwd').length >= 3);
  chk('全景：权重与梯度热力图已渲染', d.querySelectorAll('#flowCanvas .mini-heat td').length > 10, d.querySelectorAll('#flowCanvas .mini-heat td').length);
  chk('全景：每层含 z / a / δ / ∂W / ΔW', d.querySelectorAll('#flowCanvas .fc-line[data-line]').length === 6, d.querySelectorAll('#flowCanvas .fc-line[data-line]').length);
  chk('时间轴：默认 11 个环节', d.querySelectorAll('#vizStepper .step-chip').length === 11, d.querySelectorAll('#vizStepper .step-chip').length);
  chk('动态网络图：节点 + 损失盒', d.querySelectorAll('#vizSvgWrap circle').length >= 6 && $('vizSvgWrap').textContent.includes('损失 L'));
  chk('首环节明细：输入样本', $('vizDetail').textContent.includes('输入样本'), $('vizDetail').textContent.slice(0, 50));
  chk('首环节：对应全景卡片高亮', d.querySelectorAll('#flowCanvas .flow-card.active').length === 1);

  $('vizNext').click();
  chk('下一步：进入加权求和', $('vizCount').textContent === '2 / 11' && $('vizDetail').textContent.includes('加权求和'), $('vizCount').textContent);
  chk('下一步：流光连线动画', d.querySelectorAll('#vizSvgWrap .flow-line').length >= 1);
  $('vizLast').click();
  chk('末环节：参数更新明细', $('vizCount').textContent === '11 / 11' && $('vizDetail').textContent.includes('一次参数更新'), $('vizCount').textContent);
  $('vizFirst').click();
  chk('回到开头', $('vizCount').textContent === '1 / 11');
  d.querySelectorAll('#vizStepper .step-chip')[3].click();
  chk('时间轴跳转：第 2 层 z', $('vizCount').textContent === '4 / 11' && $('vizDetail').textContent.includes('第 2 层'), $('vizCount').textContent);
  d.querySelector('#flowCanvas .layer-card[data-layer="1"] .bwd-part').click();
  chk('全景卡片点击反向区 → 跳到 δ 环节', $('vizDetail').textContent.includes('回传误差'), $('vizCount').textContent + ' ' + $('vizDetail').textContent.slice(0, 40));
  $('vizFirst').click();
  $('vizSpeed').value = '5';
  $('vizSpeed').dispatchEvent(new w.Event('input', { bubbles: true }));
  $('vizPlay').click();
  await sleep(900);
  chk('自动播放连续推进', +$('vizCount').textContent.split('/')[0].trim() >= 2, $('vizCount').textContent);
  $('vizPlay').click();
  chk('暂停播放按钮复位', $('vizPlay').textContent.includes('自动播放'));
  $('vizFirst').click();

  $('btnForward').click();
  chk('① 前向传播渲染 z / a', $('stepView').textContent.includes('前向传播') && $('stepView').textContent.includes('z⁽¹⁾'), $('stepView').textContent.slice(0, 60));
  chk('① 后启用反向按钮', $('btnBackward').disabled === false);
  chk('① 后演示切为仅前向环节', d.querySelectorAll('#vizStepper .step-chip').length === 6, d.querySelectorAll('#vizStepper .step-chip').length);
  chk('① 后全景图仍展示完整结构', d.querySelectorAll('#flowCanvas .layer-card').length === 2);

  $('btnBackward').click();
  chk('② 反向传播渲染 δ 与梯度', $('stepView').textContent.includes('δ⁽') && $('stepView').textContent.includes('∂L/∂W'), $('stepView').textContent.slice(0, 60));
  chk('② 后启用更新按钮', $('btnApplyStep').disabled === false);
  chk('② 后演示跳到输出层 δ 环节', d.querySelectorAll('#vizStepper .step-chip').length === 11 && $('vizDetail').textContent.includes('输出层'), $('vizCount').textContent);

  $('btnApplyStep').click();
  chk('③ 应用更新写入权重', $('mEpoch').textContent === '1' && $('stepView').textContent.includes('参数已更新'), $('mEpoch').textContent);
  chk('③ 后曲线有数据', $('curveSvgWrap').querySelectorAll('polyline').length === 1);

  $('btnStepEpoch').click();
  chk('单步一轮追加日志', $('mEpoch').textContent === '2' && d.querySelectorAll('#logTable tbody tr').length === 2, $('mEpoch').textContent);

  $('btnAddLayer').click();
  chk('添加隐藏层后结构图重建', d.querySelectorAll('#hiddenList .hidden-row').length === 2 && d.querySelectorAll('#netSvgWrap circle').length === 9, d.querySelectorAll('#netSvgWrap circle').length);
  chk('添加隐藏层后权重编辑器重建', d.querySelectorAll('#paramEditor .param-layer').length === 3);

  $('inNodes').value = '3'; change('inNodes');
  chk('输入层维度联动数据集', d.querySelectorAll('#datasetWrap input.dx').length === 12, d.querySelectorAll('#datasetWrap input.dx').length);

  $('preset').value = 'multi';
  $('btnLoadPreset').click();
  chk('载入三分类预设：输出层 3', $('outNodes').value === '3' && $('outAct').value === 'softmax');
  chk('载入三分类预设：CE + Adam', $('lossFn').value === 'ce' && $('optimizer').value === 'adam');
  chk('载入三分类预设：目标 3 维', d.querySelectorAll('#datasetWrap input.dt').length === 12, d.querySelectorAll('#datasetWrap input.dt').length);
  chk('三分类预设：全景图同步重建', d.querySelectorAll('#flowCanvas .layer-card').length === 2 && d.querySelectorAll('#vizStepper .step-chip').length === 11);
  d.querySelectorAll('#vizStepper .step-chip')[4].click();
  chk('Softmax 输出层激活明细可展开', $('vizDetail').textContent.includes('e^') || $('vizDetail').textContent.includes('Softmax'), $('vizDetail').textContent.slice(0, 60));

  const pw = d.querySelector('#paramEditor input.pw');
  pw.value = '0.123';
  $('btnApplyParams').click();
  chk('手工权重应用成功', $('toast').textContent.includes('已应用到网络'), $('toast').textContent);

  $('btnImport').click();
  const cfg = {
    version: 1, sizes: [2, 3, 1], hidden: [{ n: 3, act: 'sigmoid' }], outAct: 'sigmoid',
    loss: 'bce', lr: 0.5, epochs: 30, speed: 5, optimizer: 'sgd', initMethod: 'xavier', seed: 7, gradClip: 5,
    dataset: [{ x: [0, 0], t: [0] }, { x: [1, 1], t: [1] }],
    weights: [[[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]], [[0.7, 0.8, 0.9]]],
    biases: [[0, 0, 0], [0]]
  };
  $('importText').value = JSON.stringify(cfg);
  $('btnModalOk').click();
  chk('导入配置恢复结构', $('inNodes').value === '2' && $('seed').value === '7' && d.querySelectorAll('#datasetWrap tr[data-row]').length === 2, $('seed').value);
  chk('导入配置恢复权重', d.querySelector('#paramEditor input.pw').value === '0.1', d.querySelector('#paramEditor input.pw').value);
  chk('导入配置关闭弹窗', $('modalMask').hidden === true);

  $('btnReset').click();
  $('btnTrain').click();
  await sleep(1600);
  chk('自动训练跑满 30 轮', $('mEpoch').textContent === '30', $('mEpoch').textContent);
  chk('训练完成展示预测结果', $('predWrap').textContent.includes('预测'), $('predWrap').textContent.slice(0, 40));
  chk('训练完成后曲线与权重表刷新', $('curveSvgWrap').querySelectorAll('circle').length >= 1 && d.querySelectorAll('#paramEditor input.pw').length === 9);
  chk('训练完成后按钮复位', $('btnTrain').disabled === false && $('btnPause').disabled === true);
  chk('训练完成后传播快照已同步', $('flowStats').textContent.includes('环节') && d.querySelectorAll('#vizStepper .step-chip').length === 11, $('flowStats').textContent);

  chk('全程无 JS 报错', errors.length === 0, errors.join(' | '));

  const pass = results.filter(r => r.ok).length;
  results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  -> ' + r.extra)));
  console.log('\n=== ' + pass + '/' + results.length + ' passed ===');
  if (errors.length) console.log('ERRORS:', errors.join('\n'));
  process.exit(pass === results.length ? 0 : 1);
})();
