const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('reader UI synchronization is documented for users and reviewers', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  const manual = fs.readFileSync('docs/manual-acceptance.md', 'utf8');
  const release = fs.readFileSync('docs/releasing.md', 'utf8');

  assert.match(readme, /所有已注入.*恢复圆点/);
  assert.match(readme, /切换标签页.*完整阅读窗/);
  assert.match(readme, /storage\.session/);
  assert.match(readme, /storage\.session.*不(?:复制|保存).*?(?:书籍|正文)/s);
  assert.doesNotMatch(readme, /贴边面板可选.*收起为小圆点/);
  assert.match(manual, /A、B、C/);
  assert.doesNotMatch(manual, /扩展管理页重启扩展/);
  assert.match(manual, /service worker.*inactive/i);
  assert.match(release, /跨标签页.*恢复圆点/);

  for (const path of [
    'store/review/chrome-notes-zh-CN.md',
    'store/review/edge-notes-zh-CN.md',
  ]) {
    const text = fs.readFileSync(path, 'utf8');
    assert.match(text, /切换标签页/);
    assert.match(text, /导航/);
    assert.match(text, /service worker.*重启/i);
    assert.match(text, /关闭.*标签页/);
    assert.match(text, /只在 A .*缩小.*A、B、C/);
    assert.deepEqual([...text.matchAll(/^(\d+)\./gm)].map((match) => Number(match[1])), [1, 2, 3, 4, 5, 6, 7, 8]);
  }
  for (const path of [
    'store/review/chrome-notes-en.md',
    'store/review/edge-notes-en.md',
  ]) {
    const text = fs.readFileSync(path, 'utf8');
    assert.match(text, /switch tabs/i);
    assert.match(text, /navigate/i);
    assert.match(text, /restart the service worker/i);
    assert.match(text, /close.*tab/i);
    assert.match(text, /minimize.*only on A.*A, B, and C/i);
    assert.deepEqual([...text.matchAll(/^(\d+)\./gm)].map((match) => Number(match[1])), [1, 2, 3, 4, 5, 6, 7, 8]);
  }
});
