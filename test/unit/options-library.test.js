const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function extractRenderBooks(source) {
  const start = source.indexOf('async function renderBooks()');
  const end = source.indexOf('// ---------- 外观字段回填', start);
  assert.notEqual(start, -1, 'renderBooks should exist');
  assert.notEqual(end, -1, 'renderBooks boundary should exist');
  return source.slice(start, end);
}

test('settings library renders management actions without an open action', () => {
  const source = fs.readFileSync('options/options.js', 'utf8');
  const renderBooks = extractRenderBooks(source);

  assert.doesNotMatch(renderBooks, /const open = document\.createElement\(['"]button['"]\)/);
  assert.doesNotMatch(renderBooks, /open\.textContent\s*=\s*['"]打开['"]/);
  assert.doesNotMatch(renderBooks, /openWebBook/);
  assert.match(renderBooks, /ops\.append\(rename, reset, del\)/);
});
