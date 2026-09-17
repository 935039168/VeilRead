const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const online = require('../../lib/online.js');
const readerSession = require('../../lib/reader-session.js');

function loadWorker() {
  const calls = [];
  const session = {};
  let messageListener = null;
  let updatedListener = null;
  const chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(values) { calls.push(['session.set', values]); Object.assign(session, values); },
        async remove(key) { calls.push(['session.remove', key]); delete session[key]; },
      },
      local: { async get() { return {}; }, async set() {}, async remove() {} },
      onChanged: { addListener() {} },
    },
    tabs: {
      query: async () => [],
      create: async (options) => { calls.push(['tabs.create', options]); return { id: 42, ...options }; },
      update: async (id, options) => { calls.push(['tabs.update', id, options]); return { id, ...options }; },
      sendMessage(tabId, msg, cb) {
        calls.push(['tabs.sendMessage', tabId, msg]);
        setTimeout(() => cb({ ok: true }), 0);
      },
      onUpdated: { addListener: (fn) => { updatedListener = fn; } },
      onRemoved: { addListener() {} },
      onActivated: { addListener() {} },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener: (fn) => { messageListener = fn; } },
    },
    scripting: { async executeScript() {} },
    contextMenus: { removeAll() {}, create() {}, onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
  };
  const context = { chrome, console, URL, setTimeout, clearTimeout, Promise, Object, String, RegExp };
  context.globalThis = context;
  context.importScripts = () => {
    context.VeilRead = {
      db: {},
      store: { async getSettings() { return { display: { mode: 'float' } }; }, _local: {} },
      online,
      readerSession,
    };
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('background/service-worker.js', 'utf8'), context);
  return {
    calls,
    async send(message) {
      return new Promise((resolve) => {
        messageListener(message, {}, resolve);
      });
    },
    updated(tabId, changeInfo, tab) { updatedListener(tabId, changeInfo, tab); },
  };
}

function delay() { return new Promise((resolve) => setTimeout(resolve, 8)); }

test('cross-origin online book launch queues before navigating its new tab', async () => {
  const worker = loadWorker();
  const response = await worker.send({
    type: 'tabSend',
    tabId: 7,
    url: 'https://news.example.test/article',
    msg: {
      type: 'openWebBook',
      url: 'https://read.example.test/book/1/chapter/3',
      bookUrl: 'https://read.example.test/book/1/catalog',
      bookTitle: '测试在线书',
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true, data: { ok: true, openedInNewTab: true } });
  assert.deepEqual(worker.calls.map(([name]) => name), ['tabs.create', 'session.set', 'tabs.update']);
  assert.deepEqual(JSON.parse(JSON.stringify(worker.calls[0][1])), { url: 'about:blank', active: true });
  assert.deepEqual(JSON.parse(JSON.stringify(worker.calls[2])), ['tabs.update', 42, { url: 'https://read.example.test/book/1/chapter/3' }]);
});

test('pending online book waits for the target page instead of consuming on about:blank', async () => {
  const worker = loadWorker();
  await worker.send({
    type: 'tabSend', tabId: 7, url: 'https://news.example.test/article',
    msg: { type: 'openWebBook', url: 'https://read.example.test/book/1/chapter/3', bookUrl: 'https://read.example.test/book/1/catalog' },
  });

  worker.updated(42, { status: 'complete' }, { id: 42, url: 'about:blank' });
  await delay();
  assert.equal(worker.calls.filter(([name]) => name === 'tabs.sendMessage').length, 0);

  worker.updated(42, { status: 'complete' }, { id: 42, url: 'https://read.example.test/book/1/chapter/3' });
  await delay();
  const sent = worker.calls.filter(([name]) => name === 'tabs.sendMessage');
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(JSON.stringify(sent[0][2])).useCurrentPage, true);
});
