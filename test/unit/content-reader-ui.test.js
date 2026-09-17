const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ui = require('../../lib/reader-session.js');

function makeSettings(mode) {
  return {
    display: {
      mode, edge: 'right', width: 440,
      float: { x: null, y: null, w: 480, h: 600, bead: null },
    },
    trigger: {
      hover: true, edge: 'right', thickness: 10, vLimit: 0.15,
      showDelay: 0, autoHide: true, autoHideMode: 'hide', autoHideDelay: 0,
      tray: true, trayEdge: 'right', trayPos: 0.5,
    },
    reading: { scrollStep: 0.9 }, sites: [],
  };
}

class FakeElement {
  constructor() {
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.children = [];
  }
  attachShadow() { this.shadow = new FakeElement(); return this.shadow; }
  appendChild(node) { this.children.push(node); return node; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  remove() { this.removed = true; }
}

async function loadContentHarness({
  mode = 'float', readySnapshot = null, deferInitialReady = false, deferCurrent = false,
  deferBookOpen = false, deferFetch = false,
} = {}) {
  let currentSettings = makeSettings(mode);
  let settingsReads = 0;
  let currentReads = 0;
  let settingsListener = null;
  let messageListener = null;
  const documentListeners = {};
  const windowListeners = {};
  const sent = [];
  const calls = [];
  let presentation = 'hidden';
  let readerHost = null;
  let deferReady = deferInitialReady;
  let pendingReadyCallback = null;
  let resolveCurrentRead = null;
  let resolveBookOpen = null;
  let resolveFetchText = null;
  let rejectFetchText = null;

  const reader = {
    el: { dataset: { mode: mode === 'float' ? 'float' : (mode === 'edge' ? 'edge-right' : 'disabled') } },
    panel: new FakeElement(),
    applySettings(settings) {
      calls.push(['applySettings', settings.display.mode]);
      this.el.dataset.mode = settings.display.mode === 'float'
        ? 'float' : (settings.display.mode === 'edge' ? `edge-${settings.display.edge}` : 'disabled');
      if (this.el.dataset.mode === 'disabled' && presentation === 'panel') presentation = 'hidden';
      if (this.el.dataset.mode !== 'float' && presentation === 'bead') presentation = 'hidden';
    },
    show(options) { calls.push(['show', options]); presentation = 'panel'; },
    hide(options) { calls.push(['hide', options]); presentation = 'hidden'; },
    showBead(position, options) { calls.push(['showBead', position, options]); presentation = 'bead'; },
    hideBead(options) { calls.push(['hideBead', options]); if (presentation === 'bead') presentation = 'hidden'; },
    getPresentation: () => presentation,
    isVisible: () => presentation === 'panel',
    isCollapsed: () => presentation === 'bead',
    getState: () => ({ kind: null }),
    renderEmpty() { calls.push(['renderEmpty']); },
    openBook: async (...args) => {
      calls.push(['openBook', ...args]);
      if (deferBookOpen) {
        deferBookOpen = false;
        await new Promise((resolve) => { resolveBookOpen = resolve; });
      }
    },
    openWeb: async (...args) => { calls.push(['openWeb', ...args]); },
    flushProgress() { calls.push(['flushProgress']); },
    nextChapter() {}, prevChapter() {}, pageDown() {}, pageUp() {}, toast() {},
  };

  const document = {
    hidden: false,
    documentElement: new FakeElement(),
    body: new FakeElement(),
    createElement: () => new FakeElement(),
    addEventListener(type, listener) { (documentListeners[type] ||= []).push(listener); },
  };
  const context = {
    console, document, location: { hostname: 'example.test', href: 'https://example.test/page' },
    innerWidth: 1200, innerHeight: 900, setTimeout, clearTimeout,
    addEventListener(type, listener) { (windowListeners[type] ||= []).push(listener); },
    DOMParser: class {
      parseFromString(source) { return { source }; }
    },
  };
  context.window = context;
  context.globalThis = context;

  const store = {
    async getSettings() { settingsReads += 1; return structuredClone(currentSettings); },
    async getCurrent() {
      currentReads += 1;
      if (!deferCurrent) return { bookId: null };
      deferCurrent = false;
      return new Promise((resolve) => { resolveCurrentRead = resolve; });
    },
    onSettingsChanged(listener) { settingsListener = listener; return () => {}; },
    patchSettings: async () => {}, getProgress: async () => null, saveProgress: async () => {},
    getWebProgress: async () => null, saveWebProgress: async () => {}, saveWebBook: async () => {},
  };
  context.VeilRead = {
    store,
    readerSession: ui,
    extractor: {
      findRules: () => null,
      extract: (doc) => ({
        title: doc && doc.source ? doc.source : 'Current page',
        content: ['Paragraph'], html: '<p>Paragraph</p>', prev: null, next: null,
      }),
    },
    online: {
      validateReadableUrl: (url) => url,
      async fetchText() {
        if (!deferFetch) return 'Fetched page';
        deferFetch = false;
        return new Promise((resolve, reject) => {
          resolveFetchText = resolve;
          rejectFetchText = reject;
        });
      },
    },
    readerUtils: {
      isFloatGeometryPatch: () => false,
      createCancelableDelay: () => ({ cancel() {}, schedule(callback) { callback(); } }),
      createEdgeTriggerState: () => ({ observe: () => false, onResize() {} }),
      getPanelAutoHideAction: () => null,
    },
    createReader(options) { readerHost = options.host; return reader; },
  };
  context.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(message);
        if (message.type === 'readerUi.ready' && deferReady) {
          deferReady = false;
          pendingReadyCallback = callback;
        }
        else if (message.type === 'readerUi.ready') callback({ ok: true, data: readySnapshot });
        else callback({ ok: true, data: null });
      },
      onMessage: { addListener(listener) { messageListener = listener; } },
    },
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('content/content.js', 'utf8'), context);
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    calls, sent, reader, get readerHost() { return readerHost; },
    settingsReads: () => settingsReads, currentReads: () => currentReads,
    setSettings(nextMode) { currentSettings = makeSettings(nextMode); },
    emitSettings(nextMode) { currentSettings = makeSettings(nextMode); settingsListener(structuredClone(currentSettings)); },
    async message(message) {
      return new Promise((resolve) => {
        const async = messageListener(message, {}, resolve);
        if (!async) setTimeout(resolve, 0);
      });
    },
    async visibility(hidden) {
      document.hidden = hidden;
      for (const listener of documentListeners.visibilitychange || []) listener();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    async pageshow(persisted = true) {
      for (const listener of windowListeners.pageshow || []) listener({ persisted });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    async reactivate() {
      for (const listener of windowListeners.pageshow || []) listener({ persisted: true });
      document.hidden = false;
      for (const listener of documentListeners.visibilitychange || []) listener();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    deferNextReady() { deferReady = true; },
    resolveReady(snapshot = readySnapshot) {
      const callback = pendingReadyCallback;
      pendingReadyCallback = null;
      callback({ ok: true, data: snapshot });
    },
    resolveCurrent(value = { bookId: null }) {
      const resolve = resolveCurrentRead;
      resolveCurrentRead = null;
      resolve(value);
    },
    resolveBook() {
      const resolve = resolveBookOpen;
      resolveBookOpen = null;
      resolve();
    },
    resolveFetch(value = 'Old page') {
      const resolve = resolveFetchText;
      resolveFetchText = null;
      rejectFetchText = null;
      resolve(value);
    },
    rejectFetch(error = new Error('old request failed')) {
      const reject = rejectFetchText;
      resolveFetchText = null;
      rejectFetchText = null;
      reject(error);
    },
  };
}

test('content render mode follows the current setting exactly', () => {
  assert.equal(ui.contentRenderMode(makeSettings('float')), 'float');
  assert.equal(ui.contentRenderMode(makeSettings('edge')), 'edge-right');
  assert.equal(ui.contentRenderMode(makeSettings('sidebar')), null);
});

test('snapshot projection only exposes a synchronized float bead', () => {
  assert.equal(ui.snapshotPresentation({ mode: 'float', presentation: 'bead' }), 'bead');
  assert.equal(ui.snapshotPresentation({ mode: 'edge', presentation: 'bead' }), 'hidden');
  assert.equal(ui.snapshotPresentation({ mode: 'sidebar', presentation: 'panel' }), 'hidden');
  assert.equal(ui.snapshotPresentation({ mode: 'float', presentation: 'panel' }), 'hidden');
});

test('snapshot revisions only move forward', () => {
  assert.equal(ui.shouldApplyRevision(4, 3), true);
  assert.equal(ui.shouldApplyRevision(4, 4), false);
  assert.equal(ui.shouldApplyRevision(3, 4), false);
});

test('ready restores a float bead without preloading reading content and ignores stale snapshots', async () => {
  const harness = await loadContentHarness({
    mode: 'float', readySnapshot: { mode: 'float', presentation: 'bead', panelTabId: null, revision: 5 },
  });
  assert.equal(harness.reader.getPresentation(), 'bead');
  assert.equal(harness.currentReads(), 0);
  assert.equal(harness.sent[0].type, 'readerUi.ready');

  await harness.message({ type: 'readerUi.sync', snapshot: { mode: 'float', presentation: 'hidden', revision: 4 } });
  assert.equal(harness.reader.getPresentation(), 'bead');
  await harness.message({ type: 'readerUi.sync', snapshot: { mode: 'float', presentation: 'hidden', revision: 6 } });
  assert.equal(harness.reader.getPresentation(), 'hidden');
});

test('first explicit trigger reloads authoritative settings and sidebar disables the page overlay', async () => {
  const harness = await loadContentHarness({ mode: 'float' });
  harness.setSettings('sidebar');
  await harness.message({ type: 'toggle' });
  assert.equal(harness.settingsReads(), 2);
  assert.equal(harness.reader.getPresentation(), 'hidden');
  assert.equal(harness.currentReads(), 0);
  assert.equal(harness.calls.some(([name]) => name === 'show'), false);
});

test('edge and sidebar snapshots never show a floating bead', async () => {
  for (const mode of ['edge', 'sidebar']) {
    const harness = await loadContentHarness({
      mode, readySnapshot: { mode, presentation: 'bead', panelTabId: null, revision: 2 },
    });
    assert.equal(harness.sent[0].type, 'readerUi.ready');
    assert.equal(harness.reader.getPresentation(), 'hidden');
    assert.equal(harness.calls.some(([name]) => name === 'showBead'), false);
  }
});

test('visibility changes hide only a full panel and preserve a synchronized bead', async () => {
  const bead = await loadContentHarness({
    mode: 'float', readySnapshot: { mode: 'float', presentation: 'bead', panelTabId: null, revision: 2 },
  });
  await bead.visibility(true);
  assert.equal(bead.reader.getPresentation(), 'bead');

  const panel = await loadContentHarness({ mode: 'float' });
  await panel.message({ type: 'readerUi.openPanel', revision: 2 });
  await panel.visibility(true);
  assert.equal(panel.reader.getPresentation(), 'hidden');
});

test('an async open cannot show after its tab becomes hidden', async () => {
  const harness = await loadContentHarness({ mode: 'float', deferCurrent: true });
  const opening = harness.message({ type: 'toggle' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await harness.visibility(true);
  harness.resolveCurrent();
  await opening;

  assert.equal(harness.reader.getPresentation(), 'hidden');
  assert.equal(harness.calls.some(([name]) => name === 'show'), false);
});

test('a hide command cancels an open that is still bootstrapping', async () => {
  const harness = await loadContentHarness({ mode: 'float', deferCurrent: true });
  const opening = harness.message({ type: 'readerUi.openPanel', revision: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await harness.message({ type: 'readerUi.hidePanel', revision: 3 });
  harness.resolveCurrent();
  const response = await opening;

  assert.equal(response.ok, false);
  assert.equal(harness.reader.getPresentation(), 'hidden');
  assert.equal(harness.calls.some(([name]) => name === 'show'), false);
});

test('a local close cancels an in-flight book open', async () => {
  const harness = await loadContentHarness({ mode: 'float', deferBookOpen: true });
  await harness.message({ type: 'toggle' });
  const opening = harness.message({ type: 'open', bookId: 'book-1' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  harness.reader.hide({ reason: 'close' });
  harness.readerHost.onPresentationChanged({ presentation: 'hidden', reason: 'close' });
  harness.resolveBook();
  const response = await opening;

  assert.equal(response.ok, false);
  assert.equal(harness.reader.getPresentation(), 'hidden');
});

test('a stale online fetch cannot overwrite a newer visible book', async () => {
  const harness = await loadContentHarness({ mode: 'float', deferFetch: true });
  const oldOpening = harness.message({
    type: 'openWebBook', url: 'https://example.test/old', bookUrl: 'https://example.test/old-book',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const newer = await harness.message({
    type: 'openWebBook', useCurrentPage: true, bookTitle: 'New book',
    bookUrl: 'https://example.test/new-book',
  });
  assert.equal(newer.ok, true);

  harness.resolveFetch('Old book');
  await oldOpening;

  const opened = harness.calls.filter(([name]) => name === 'openWeb');
  assert.equal(opened.at(-1)[1].title, 'New book');
});

test('a stale online failure cannot clear newer content', async () => {
  const harness = await loadContentHarness({ mode: 'float', deferFetch: true });
  const oldOpening = harness.message({
    type: 'openWebBook', url: 'https://example.test/old', bookUrl: 'https://example.test/old-book',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.message({
    type: 'openWebBook', useCurrentPage: true, bookTitle: 'New book',
    bookUrl: 'https://example.test/new-book',
  });
  const emptyBefore = harness.calls.filter(([name]) => name === 'renderEmpty').length;

  harness.rejectFetch();
  await oldOpening;

  assert.equal(harness.calls.filter(([name]) => name === 'renderEmpty').length, emptyBefore);
});

test('a mode change cancels an in-flight open before hidden sync can be undone', async () => {
  const harness = await loadContentHarness({ mode: 'float', deferBookOpen: true });
  await harness.message({ type: 'toggle' });
  const opening = harness.message({ type: 'open', bookId: 'book-1' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  harness.emitSettings('edge');
  await harness.message({
    type: 'readerUi.sync',
    snapshot: { mode: 'edge', presentation: 'hidden', panelTabId: null, revision: 3 },
  });
  harness.resolveBook();
  const response = await opening;

  assert.equal(response.ok, false);
  assert.equal(harness.reader.getPresentation(), 'hidden');
});

test('openWeb waits for the authoritative mode and reports sidebar rejection', async () => {
  const harness = await loadContentHarness({ mode: 'sidebar' });

  const response = await harness.message({ type: 'openWeb' });

  assert.equal(response.ok, false);
  assert.equal(harness.reader.getPresentation(), 'hidden');
  assert.equal(harness.calls.some(([name]) => name === 'openWeb'), false);
});

test('book open messages report sidebar rejection instead of claiming success', async () => {
  const harness = await loadContentHarness({ mode: 'sidebar' });

  const local = await harness.message({ type: 'open', bookId: 'book-1' });
  const online = await harness.message({
    type: 'openWebBook', useCurrentPage: true, bookUrl: 'https://example.test/book',
  });

  assert.equal(local.ok, false);
  assert.equal(online.ok, false);
  assert.equal(harness.calls.some(([name]) => name === 'openBook' || name === 'openWeb'), false);
});

test('active pages re-register after BFCache restore and visibility activation', async () => {
  const harness = await loadContentHarness({ mode: 'float' });
  const readyCount = () => harness.sent.filter((message) => message.type === 'readerUi.ready').length;
  assert.equal(readyCount(), 1);

  await harness.reactivate();
  assert.equal(readyCount(), 2);
});

test('a delayed ready snapshot cannot hide a panel opened while registration is in flight', async () => {
  const harness = await loadContentHarness({ mode: 'float' });
  harness.deferNextReady();
  await harness.pageshow(true);
  harness.reader.show({ reason: 'user-open' });
  harness.readerHost.onPresentationChanged({ presentation: 'panel', reason: 'user-open' });

  harness.resolveReady({ mode: 'float', presentation: 'hidden', panelTabId: null, revision: 10 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.reader.getPresentation(), 'panel');
});

test('activation queues a trailing ready when the prerender registration is still in flight', async () => {
  const harness = await loadContentHarness({ mode: 'float', deferInitialReady: true });
  const readyCount = () => harness.sent.filter((message) => message.type === 'readerUi.ready').length;
  assert.equal(readyCount(), 1);

  await harness.reactivate();
  assert.equal(readyCount(), 1);

  harness.resolveReady({ mode: 'float', presentation: 'hidden', panelTabId: null, revision: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(readyCount(), 2);
});

test('local presentation changes report once while synchronized projections do not echo', async () => {
  const harness = await loadContentHarness({ mode: 'float' });
  harness.readerHost.onPresentationChanged({ presentation: 'panel', reason: 'show' });
  harness.readerHost.onPresentationChanged({ presentation: 'bead', reason: 'collapse' });
  harness.readerHost.onBeadRestoreRequested();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(harness.sent.filter((message) => message.type === 'readerUi.event').map((message) => message.event), [
    'panel-opened', 'float-collapsed', 'bead-restored',
  ]);
  const before = harness.sent.length;
  await harness.message({ type: 'readerUi.sync', snapshot: { mode: 'float', presentation: 'bead', revision: 8 } });
  assert.equal(harness.sent.length, before);
  const showBead = harness.calls.find(([name]) => name === 'showBead');
  assert.equal(showBead[2].notify, false);
});
