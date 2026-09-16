const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadExtractor() {
  const context = { globalThis: {}, Set, Map, Array, String, RegExp, URL };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('content/extractor.js', 'utf8'), context);
  return context.VeilRead.extractor;
}

test('more specific site rule wins over its parent-domain rule', () => {
  const extractor = loadExtractor();
  const rule = extractor.findRules([
    { domain: 'example.com', content: '#generic' },
    { domain: 'novel.example.com', content: '#novel' },
  ], 'novel.example.com');
  assert.equal(rule.content, '#novel');
});

test('invalid custom selector falls back to automatic extraction instead of throwing', () => {
  const extractor = loadExtractor();
  const article = {
    tagName: 'ARTICLE',
    className: '', id: '', parentElement: null,
    textContent: '这是一段足够长的正文内容。'.repeat(10),
    querySelectorAll: () => [],
    children: [], childNodes: [],
  };
  const body = {
    querySelector: (selector) => { if (selector === '[') throw new SyntaxError('bad selector'); return null; },
    querySelectorAll: () => [article],
    children: [article],
    textContent: article.textContent,
  };
  article.parentElement = body;
  const doc = {
    body,
    documentElement: body,
    title: '测试页',
    createElement: () => ({ appendChild() {}, children: [], childNodes: [], querySelectorAll: () => [] }),
    querySelector: body.querySelector,
  };
  assert.doesNotThrow(() => extractor.extract(doc, { content: '[' }, 'https://example.com/a'));
});

test('catalog extraction counts a shared link container once instead of once per chapter', () => {
  const extractor = loadExtractor();
  const root = {};
  const body = { parentElement: root };
  const list = {
    parentElement: body,
    calls: 0,
    querySelectorAll(selector) {
      if (selector === 'a') { this.calls++; return links; }
      if (selector === 'a[href]') return links;
      return [];
    },
  };
  const links = Array.from({ length: 12 }, (_, i) => {
    const item = { parentElement: list, querySelectorAll: () => [] };
    return {
      parentElement: item,
      textContent: `第 ${i + 1} 章`,
      getAttribute: (name) => name === 'href' ? `/chapter/${i + 1}` : '',
    };
  });
  const doc = {
    body,
    documentElement: root,
    querySelectorAll: (selector) => selector === 'a[href]' ? links : [],
  };

  const items = extractor.extractCatalog(doc, 'https://novel.example/catalog');
  assert.equal(items.length, 12);
  assert.ok(list.calls <= 2, `shared catalog list was counted ${list.calls} times`);
});
