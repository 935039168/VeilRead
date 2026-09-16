const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('settings exposes the public privacy and permissions page safely', () => {
  const html = fs.readFileSync('options/options.html', 'utf8');
  assert.match(html, /为了在你打开的普通网页上提供边缘呼出和正文提取/);
  assert.match(html, /<a[^>]+href="https:\/\/935039168\.github\.io\/VeilRead\/privacy\/zh-CN\/"[^>]*>查看隐私政策与权限说明<\/a>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
