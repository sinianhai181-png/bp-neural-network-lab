const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path'); const base = path.join(__dirname, '..') + path.sep;
const html = fs.readFileSync(base + 'index.html', 'utf8');
const files = ['engine.js', 'app.js', 'visualizer.js', 'lab.js'];
let page = html.replace('<link rel="stylesheet" href="css/style.css">', '');
files.forEach(f => { page = page.replace('<script src="js/' + f + '"></script>', '<script>' + fs.readFileSync(base + 'js/' + f, 'utf8') + '</script>'); });

const errors = [], vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
const rec = { fillRect: 0 };
const ctx = new Proxy({}, { get: (t, k) => {
  if (k === 'fillRect') return () => rec.fillRect++;
  if (k === 'fillText' || k === 'measureText') return () => ({ width: 10 });
  return () => {};
}, set: () => true });
const dom = new JSDOM(page, {
  url: require('url').pathToFileURL(base + 'index.html').href, runScripts: 'dangerously',
  pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = () => ctx; }
});
const w = dom.window, d = w.document;
const $ = id => d.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
function log(n, ok, x) { out.push((ok ? 'OK   ' : 'ISSUE') + ' ' + n + (x ? '  [' + x + ']' : '')); }
function change(id, v) { $(id).value = v; $(id).dispatchEvent(new w.Event('change', { bubbles: true })); }

(async function () {
  await sleep(300);

  // 1) 恒定输入坐标（x1 全相同）时决策边界是否产生 NaN / 崩溃
  const net = w.BPApp.net(), data = w.BPApp.dataset();
  data.forEach(s => { s.x[0] = 0.5; });
  let crashed = false;
  try { w.BPLab.drawBoundary(); } catch (e) { crashed = true; log('恒定输入边界崩溃', false, e.message); }
  if (!crashed) log('恒定输入边界不崩溃', true);
  // 恢复数据
  data.forEach((s, i) => { s.x[0] = [0, 0, 1, 1][i]; });

  // 2) 3 分类 Softmax+CE 下用「当前主数据集」做优化器对比
  d.querySelector('#presetSel') && (() => {
    const sel = $('presetSel');
    const opt = Array.from(sel.options).find(o => /三分类|Softmax|3.?class/i.test(o.textContent));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new w.Event('change', { bubbles: true })); }
  })();
  await sleep(120);
  change('opData', 'current');
  change('opEpochs', '30');
  let crashed2 = false;
  try { w.BPLab.runOptim(); } catch (e) { crashed2 = true; log('3分类主数据集优化器对比崩溃', false, e.message); }
  if (!crashed2) log('3分类主数据集优化器对比不崩溃', true, $('opConclusion').textContent.slice(0, 40));

  // 3) 极大学习率导致 loss 发散时，对比表是否仍可显示（不能 NaN 刷屏）
  change('opData', 'xor'); change('opLr', '5'); change('opEpochs', '50');
  let crashed3 = false;
  try { w.BPLab.runOptim(); } catch (e) { crashed3 = true; log('极大学习率对比崩溃', false, e.message); }
  if (!crashed3) {
    const t = $('opTable').textContent;
    log('极大学习率对比不崩溃', true, '含NaN=' + /NaN/.test(t));
  }

  // 4) 过拟合实验：样本数下限 + 零噪声 + 最小轮数
  change('ofN', '10'); change('ofNoise', '0'); change('ofEpochs', '50'); change('ofCap', '3');
  let crashed4 = false;
  try { w.BPLab.runOverfit(); } catch (e) { crashed4 = true; log('过拟合实验最小参数崩溃', false, e.message); }
  if (!crashed4) log('过拟合实验最小参数不崩溃', true, $('ofStats').textContent.slice(0, 50));

  // 5) 函数曲线所有函数切换不报错
  let crashFn = 0;
  for (const kind of ['act', 'loss']) {
    d.querySelector('.seg-btn[data-kind="' + kind + '"]').click();
    for (const opt of Array.from($('fcName').options)) {
      change('fcName', opt.value);
      if (/NaN|undefined/.test($('fcInfo').textContent)) { crashFn++; log('函数曲线 ' + opt.value + ' 显示异常', false); }
    }
  }
  if (!crashFn) log('全部 12 个函数曲线显示正常', true);

  // 6) README / GitHub Pages 部署相关文件
  const hasNoJekyll = fs.existsSync(base + '.nojekyll');
  log('存在 .nojekyll（Pages 更稳）', hasNoJekyll);
  const testsInRepo = fs.existsSync(base + 'tests') || fs.existsSync(base + 'test');
  log('测试脚本纳入仓库', testsInRepo);

  log('全程无 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 120));
  out.forEach(l => console.log(l));
  console.log('\n=== 探测完成 ===');
})();
