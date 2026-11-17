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
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc
});
const w = dom.window, d = w.document;
w.addEventListener('error', e => errors.push('window.error: ' + e.message));
const $ = id => d.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// —— 给页面级滚动 API 打桩计数 ——
let pageScrollCalls = 0;
w.HTMLElement.prototype.scrollIntoView = function () { pageScrollCalls++; };
w.scrollTo = function () { pageScrollCalls++; };
w.scrollBy = function () { pageScrollCalls++; };

(async function () {
  await sleep(250);

  // 给两个横向容器伪造可滚动尺寸与坐标，让 scrollWithin 真正执行横向滚动逻辑
  function fakeScroll(container) {
    Object.defineProperty(container, 'scrollWidth', { configurable: true, get: () => 2000 });
    Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => 500 });
    container.scrollLeft = 0;
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300 });
  }
  function fakeCardRect() { return { left: 1500, top: 0, right: 1650, bottom: 100, width: 150, height: 100 }; }
  fakeScroll($('vizStepper'));
  fakeScroll($('flowCanvas'));

  // 让所有 step-chip 与 flow-card 报告一个远离视口的 x 坐标
  d.querySelectorAll('.step-chip').forEach(c => { c.getBoundingClientRect = fakeCardRect; });
  d.querySelectorAll('.flow-card').forEach(c => { c.getBoundingClientRect = fakeCardRect; });

  const before = pageScrollCalls;

  // 连续推进多个环节（模拟自动播放），并真正触发一次自动播放
  $('vizNext').click();
  $('vizNext').click();
  $('vizLast').click();
  $('vizFirst').click();
  $('vizPlay').click();          // 开始自动播放
  await sleep(1200);             // 让多个 tick 推进
  $('vizPlay').click();          // 暂停

  const after = pageScrollCalls;

  const results = [];
  function chk(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra === undefined ? '' : String(extra) }); }

  chk('自动播放/跳转全程未调用页面级滚动 API', after === before, '调用次数 ' + (after - before));
  chk('横向容器在容器内滚动(时间轴 scrollLeft>0)', $('vizStepper').scrollLeft > 0, $('vizStepper').scrollLeft);
  chk('横向容器在容器内滚动(全景图 scrollLeft>0)', $('flowCanvas').scrollLeft > 0, $('flowCanvas').scrollLeft);
  chk('无 JS 报错', errors.length === 0, errors.join(' | '));

  results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')));
  const failed = results.filter(r => !r.ok).length;
  console.log('\n=== ' + (results.length - failed) + '/' + results.length + ' passed ===');
  process.exitCode = failed ? 1 : 0;
})();
