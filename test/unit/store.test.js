const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function loadStore() {
  let data = {};
  const listeners = [];
  const chrome = {
    storage: {
      local: {
        async get(key) {
          await delay(5);
          if (typeof key === 'string') return { [key]: data[key] };
          return { ...data };
        },
        async set(next) {
          await delay(5);
          const changes = {};
          for (const [key, value] of Object.entries(next)) {
            changes[key] = { oldValue: data[key], newValue: value };
            data[key] = value;
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
    },
  };
  const context = { chrome, globalThis: {}, setTimeout, clearTimeout, Promise, Object, Array, Date };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('lib/store.js', 'utf8'), context);
  return { store: context.VeilRead.store, dump: () => structuredClone(data) };
}

test('floating defaults enable snapping and mouse-leave auto-hide', async () => {
  const { store } = loadStore();
  const settings = await store.getSettings();

  assert.equal(settings.display.mode, 'float');
  assert.equal(settings.display.float.snap, true);
  assert.equal(settings.display.float.autoHide, true);
  assert.equal(settings.display.float.bead, null);
});

test('parallel settings patches retain independent fields', async () => {
  const { store, dump } = loadStore();
  await Promise.all([
    store.patchSettings({ display: { fontSize: 22 } }),
    store.patchSettings({ trigger: { autoHideDelay: 1400 } }),
  ]);
  const saved = dump()['vr.settings'];
  assert.equal(saved.display.fontSize, 22);
  assert.equal(saved.trigger.autoHideDelay, 1400);
});

test('online book progress is keyed by stable book URL while keeping chapter scroll state', async () => {
  const { store } = loadStore();
  const bookUrl = 'https://novel.example/book/42/catalog';
  const chapterUrl = 'https://novel.example/book/42/chapter/8';
  await store.saveWebProgress(chapterUrl, { title: '第八章', ratio: 0.42 });
  await store.saveWebBook(bookUrl, { lastChapter: chapterUrl, title: '第八章' });

  const book = await store.getWebBook(bookUrl);
  assert.equal(book.lastChapter, chapterUrl);
  assert.equal(book.title, '第八章');
  assert.equal((await store.getWebProgress(chapterUrl)).ratio, 0.42);
});

test('saved online-book progress takes priority over stale library metadata when reopening', () => {
  const { store } = loadStore();
  const meta = { url: 'https://novel.example/book/42/catalog', lastChapter: 'https://novel.example/book/42/chapter/3' };
  const saved = { lastChapter: 'https://novel.example/book/42/chapter/9' };

  assert.equal(store.resolveWebChapter(meta, saved), saved.lastChapter);
  assert.equal(store.resolveWebChapter(meta, null), meta.lastChapter);
});

test('clearing an online book clears book metadata and every tracked chapter progress', async () => {
  const { store } = loadStore();
  const bookUrl = 'https://novel.example/book/42/catalog';
  const chapterUrl = 'https://novel.example/book/42/chapter/8';
  await store.saveWebProgress(chapterUrl, { title: '第八章', ratio: 0.42, bookUrl });
  await store.saveWebBook(bookUrl, { lastChapter: chapterUrl, title: '第八章' });
  await store.clearWebBook(bookUrl);

  assert.equal(await store.getWebBook(bookUrl), null);
  assert.equal(await store.getWebProgress(chapterUrl), null);
});
