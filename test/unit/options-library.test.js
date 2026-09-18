const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this._textContent = '';
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this.children.length
      ? this.children.map((child) => child.textContent).join('')
      : this._textContent;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  focus() {}

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    let matches = [this];
    for (const part of selector.trim().split(/\s+/)) {
      matches = matches.flatMap((root) => descendants(root).filter((node) => matchesPart(node, part)));
    }
    return matches;
  }
}

function descendants(root) {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function matchesPart(node, selector) {
  if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

async function renderBookActions(meta) {
  const bookList = new FakeElement();
  const webChapter = 'https://read.example.test/book/1/chapter/3';
  const store = {
    getSettings: () => new Promise(() => {}),
    async getProgressMap() {
      return meta.type === 'web' ? {} : { [meta.id]: { chapter: 0, ratio: 0.5 } };
    },
    async getWebProgressMap() {
      return meta.type === 'web' ? { [webChapter]: { ratio: 0.4, title: '第三章' } } : {};
    },
    async getWebBooks() {
      return meta.type === 'web' ? { [meta.url]: { lastChapter: webChapter } } : {};
    },
    resolveWebChapter(book, saved) {
      return (saved && saved.lastChapter) || book.lastChapter || book.url;
    },
  };
  const document = {
    getElementById(id) { return id === 'bookList' ? bookList : new FakeElement(); },
    createElement(tagName) { return new FakeElement(tagName); },
    querySelectorAll() { return []; },
  };
  const context = {
    console,
    document,
    setTimeout,
    clearTimeout,
    URL,
    VeilRead: {
      store,
      db: { async listMetas() { return [meta]; } },
      txt: {},
      online: {},
      FONTS: {},
      THEMES: [],
      readerUtils: { shouldDeferAppearanceSync() { return false; } },
    },
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync('options/options.js', 'utf8');
  vm.runInContext(source, context, { filename: 'options/options.js' });

  await context.renderBooks();

  const rows = bookList.querySelectorAll('.book-row');
  assert.equal(rows.length, 1);
  return rows[0].querySelectorAll('.ops button').map((button) => button.textContent);
}

test('local TXT rows render management actions only', async () => {
  const actions = await renderBookActions({
    id: 'local-book', title: '本地书', chapterCount: 2, size: 20000,
  });

  assert.deepEqual(actions, ['重命名', '重置进度', '删除']);
});

test('web book rows render management actions only', async () => {
  const actions = await renderBookActions({
    id: 'web-book', type: 'web', title: '在线书',
    url: 'https://read.example.test/book/1/catalog',
  });

  assert.deepEqual(actions, ['编辑关键信息', '重置进度', '删除']);
});

test('TXT import copy points readers to supported reading surfaces', () => {
  const html = fs.readFileSync('options/options.html', 'utf8');

  assert.doesNotMatch(html, /导入后自动开始阅读/);
  assert.match(html, /导入后可从 popup、网页阅读层或侧边栏继续阅读/);
});
