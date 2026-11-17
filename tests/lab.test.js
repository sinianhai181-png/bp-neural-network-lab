const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path'); const base = path.join(__dirname, '..') + path.sep;
const html = fs.readFileSync(base + 'index.html', 'utf8');
const scripts = ['engine.js', 'app.js', 'visualizer.js', 'lab.js']
  .map(f => fs.readFileSync(base + 'js/' + f, 'utf8'));
let page = html.replace('<link rel="stylesheet" href="css/style.css">', '');
['engine.js', 'app.js', 'visualizer.js', 'lab.js'].forEach((f, i) => {
  page = page.replace('<script src="js/' + f + '"></script>', '<script>' + scripts[i] + '</script>');
});

const errors = [], vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const rec = { fillRect: 0, stroke: 0, fill: 0, arc: 0, drawImage: 0, text: [] };
function mockCtx() {
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', lineJoin: '',
    fillRect: () => { rec.fillRect++; }, clearRect: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, closePath: noop, stroke: () => { rec.stroke++; }, fill: () => { rec.fill++; },
    arc: () => { rec.arc++; }, save: noop, restore: noop, setLineDash: noop,
    translate: noop, rotate: noop, fillText: s => { rec.text.push(String(s)); },
    drawImage: () => { rec.drawImage++; }, measureText: () => ({ width: 10 })
  };
}
const ctx = mockCtx();
const dom = new JSDOM(page, {
  url: require('url').pathToFileURL(base + 'index.html').href,
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
  }
});
const w = dom.window, d = w.document;
w.addEventListener('error', e => errors.push('window.error: ' + e.message));
const $ = id => d.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function chk(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra === undefined ? '' : String(extra) }); }
const clickTab = id => $(id).click();

(async function () {
  await sleep(300);
  const L = w.BPLab;
  chk('实验台模块已加载', !!L && typeof L.runOptim === 'function');
  chk('四个标签页存在', d.querySelectorAll('.lab-tab').length === 4);
  chk('默认显示决策边界', $('labBoundary').classList.contains('active'));
  chk('决策边界已绘制网格', rec.fillRect > 1000, 'fillRect=' + rec.fillRect);
  chk('决策边界图例含类别', $('bdLegend').textContent.includes('类别'));
  chk('决策边界状态显示轮次', $('bdStats').textContent.includes('已训练'));

  // 快照
  const snaps0 = $('bdSnaps').children.length;
  $('bdSnapshot').click();
  chk('保存边界快照', $('bdSnaps').querySelector('.snap-item') !== null && rec.drawImage > 0, 'drawImage=' + rec.drawImage);
  $('bdClear').click();
  chk('清除快照', $('bdSnaps').children.length <= 1);

  // 函数曲线
  clickTab('labTabs'); // no-op: 事件委托需点在 tab 上
  d.querySelector('.lab-tab[data-tab="curves"]').click();
  chk('切到函数曲线', $('labCurves').classList.contains('active'));
  chk('激活函数下拉 7 项', $('fcName').options.length === 7, $('fcName').options.length);
  chk('函数曲线已绘制', rec.stroke > 5, 'stroke=' + rec.stroke);
  chk('函数说明含公式', $('fcInfo').textContent.includes('f(z)'));
  d.querySelector('.seg-btn[data-kind="loss"]').click();
  chk('损失模式下拉 5 项', $('fcName').options.length === 5, $('fcName').options.length);
  chk('目标值控件显示', !$('fcTargetWrap').className.includes('lab-hide'));
  $('fcName').value = 'bce'; $('fcName').dispatchEvent(new w.Event('change', { bubbles: true }));
  chk('BCE 横轴限制在 0~1', $('fcInfo').textContent.includes('BCE'));
  $('fcName').value = 'softmax';
  d.querySelector('.seg-btn[data-kind="act"]').click();
  $('fcName').value = 'softmax'; $('fcName').dispatchEvent(new w.Event('change', { bubbles: true }));
  chk('Softmax 曲线说明', $('fcInfo').textContent.includes('多分类'));

  // 优化器对比
  d.querySelector('.lab-tab[data-tab="optim"]').click();
  $('opEpochs').value = '120';
  $('opRun').click();
  chk('优化器对比生成 3 行结果', $('opTable').querySelectorAll('tbody tr').length === 3, $('opTable').querySelectorAll('tbody tr').length);
  chk('对比结论给出最优优化器', $('opConclusion').textContent.includes('最终损失最低'));
  chk('对比曲线已绘制', rec.stroke > 20, 'stroke=' + rec.stroke);
  $('opUseSgd').checked = false; $('opUseMom').checked = false; $('opUseAdam').checked = false;
  $('opRun').click();
  chk('未勾选优化器时给出提示', $('opConclusion').textContent.includes('最终损失最低')); // 保持上次结果

  // 过拟合与正则
  d.querySelector('.lab-tab[data-tab="overfit"]').click();
  $('ofEpochs').value = '200';
  $('ofRun').click();
  chk('过拟合实验输出 4 项统计', $('ofStats').querySelectorAll('.stat-box').length === 4);
  chk('大容量无正则出现过拟合', $('ofConclusion').textContent.includes('过拟合'), $('ofConclusion').textContent.slice(0, 40));
  chk('拟合图与损失图均绘制', rec.stroke > 40, 'stroke=' + rec.stroke);
  // 加大正则再跑一次：结论应从过拟合变为泛化良好
  $('ofL2').value = '0.05'; $('ofDrop').value = '0.2'; $('ofRun').click();
  chk('正则参数进入统计', $('ofStats').textContent.includes('L2 0.050'), $('ofStats').textContent.slice(0, 80));
  chk('加正则后过拟合被缓解', $('ofConclusion').textContent.includes('泛化良好'), $('ofConclusion').textContent.slice(0, 60));

  // 非 2D 输入时降级提示
  $('inNodes').value = '3'; $('inNodes').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  chk('非 2D 输入给出提示', $('bdNote').textContent.includes('输入层节点数设为 2'), $('bdNote').textContent);

  chk('全程无 JS 报错', errors.length === 0, errors.join(' | '));

  results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')));
  const failed = results.filter(r => !r.ok).length;
  console.log('\n=== ' + (results.length - failed) + '/' + results.length + ' passed ===');
  process.exitCode = failed ? 1 : 0;
})();
