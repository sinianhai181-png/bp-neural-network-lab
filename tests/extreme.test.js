const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path'); const base = path.join(__dirname, '..') + path.sep;
const html = fs.readFileSync(base + 'index.html', 'utf8');
const rd = f => fs.readFileSync(base + f, 'utf8');
const page = html
  .replace('<link rel="stylesheet" href="css/style.css">', '')
  .replace('<script src="js/engine.js"></script>', '<script>' + rd('js/engine.js') + '</script>')
  .replace('<script src="js/app.js"></script>', '<script>' + rd('js/app.js') + '</script>')
  .replace('<script src="js/visualizer.js"></script>', '<script>' + rd('js/visualizer.js') + '</script>');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(page, { url: require('url').pathToFileURL(base + 'index.html').href, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window, d = w.document, $ = id => d.getElementById(id);
w.addEventListener('error', e => errors.push('window.error: ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const change = el => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const out = [];
const chk = (n, ok, extra) => out.push((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + extra));

(async function () {
  await sleep(250);

  // 12 输入 + 5 个 12 节点隐藏层 + 12 输出
  $('inNodes').value = '12'; change($('inNodes'));
  $('outNodes').value = '12'; change($('outNodes'));
  for (let i = 0; i < 4; i++) $('btnAddLayer').click();
  d.querySelectorAll('#hiddenList .hn-n').forEach(el => { el.value = '12'; change(el); });
  await sleep(120);

  chk('极端结构：6 组权重层', d.querySelectorAll('#flowCanvas .flow-card.layer-card').length === 6, d.querySelectorAll('#flowCanvas .flow-card.layer-card').length);
  chk('极端结构：时间轴 27 环节', d.querySelectorAll('#vizStepper .step-chip').length === 27, d.querySelectorAll('#vizStepper .step-chip').length);
  chk('极端结构：热力图全部渲染', d.querySelectorAll('#flowCanvas .mini-heat td').length > 200, d.querySelectorAll('#flowCanvas .mini-heat td').length);
  chk('极端结构：数据集维度联动 12/12', d.querySelectorAll('#datasetWrap input.dx').length === 48 && d.querySelectorAll('#datasetWrap input.dt').length === 48);

  $('vizLast').click();
  chk('极端结构：末环节明细正常', $('vizDetail').textContent.includes('一次参数更新'), $('vizDetail').textContent.slice(0, 50));
  d.querySelectorAll('#vizStepper .step-chip')[5].click();
  chk('极端结构：隐藏层 z 明细正常', $('vizDetail').textContent.includes('加权求和'), $('vizDetail').textContent.slice(0, 50));

  // 输出层 Softmax + CE（非配对组合切换）
  $('outAct').value = 'softmax'; change($('outAct'));
  $('lossFn').value = 'ce'; change($('lossFn'));
  $('btnBuildViz').click();
  await sleep(80);
  chk('Softmax + CE：全景重建无异常', d.querySelectorAll('#flowCanvas .layer-card').length === 6 && $('vizDetail').textContent.length > 10);
  d.querySelectorAll('#vizStepper .step-chip')[13].click();
  chk('Softmax 输出层 δ 明细可展开', $('vizDetail').textContent.includes('δ') && $('vizDetail').textContent.length > 20);

  // 无隐藏层的纯线性网络
  $('preset').value = 'linear'; $('btnLoadPreset').click();
  await sleep(80);
  chk('无隐藏层：仅 1 张层卡', d.querySelectorAll('#flowCanvas .layer-card').length === 1, d.querySelectorAll('#flowCanvas .layer-card').length);
  chk('无隐藏层：时间轴 7 环节', d.querySelectorAll('#vizStepper .step-chip').length === 7, d.querySelectorAll('#vizStepper .step-chip').length);
  $('vizLast').click();
  chk('无隐藏层：更新明细正常', $('vizDetail').textContent.includes('一次参数更新'));

  chk('极端场景全程无 JS 报错', errors.length === 0, errors.join(' | '));
  out.forEach(x => console.log(x));
  const pass = out.filter(x => x.startsWith('PASS')).length;
  console.log('\n=== ' + pass + '/' + out.length + ' passed ===');
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  process.exit(pass === out.length ? 0 : 1);
})();
