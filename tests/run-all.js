/* 一键运行全部测试：node tests/run-all.js  （或 npm test） */
const path = require('path');
const { spawnSync } = require('child_process');

const files = [
  ['引擎扩展与梯度检验', 'engine.test.js'],
  ['主功能回归', 'app.test.js'],
  ['极端网络结构', 'extreme.test.js'],
  ['播放器滚动修复', 'scroll.test.js'],
  ['拓展实验台', 'lab.test.js'],
  ['边界场景探测', 'edge.test.js']
];

let failed = 0;
console.log('=== BP 实验台 · 全量测试 ===\n');
for (const [name, file] of files) {
  process.stdout.write('▶ ' + name + ' ... ');
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], {
    encoding: 'utf8', timeout: 180000, cwd: path.join(__dirname, '..')
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0 && !/FAIL |ISSUE |Error:/.test(out);
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) {
    failed++;
    console.log(out.split('\n').filter(l => /FAIL|ISSUE|Error|not found|Cannot find/.test(l)).slice(0, 6).map(l => '    ' + l).join('\n'));
  } else if (process.env.VERBOSE) {
    console.log(out.split('\n').slice(-3).map(l => '    ' + l).join('\n'));
  }
}
console.log('\n=== ' + (files.length - failed) + '/' + files.length + ' 组通过 ===');
if (failed) {
  console.log('提示：若提示找不到 jsdom，请先执行 npm install');
  process.exitCode = 1;
}
