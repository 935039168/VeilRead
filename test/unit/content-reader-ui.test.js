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

async function loadContentHarness({ mode = 'float', readySnapshot = null } = {}) {
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
    openBook: async () => {}, openWeb: async () => {},
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
  };
  context.window = context;
  context.globalThis = context;

  const store = {
    async getSettings() { settingsReads += 1; return structuredClone(currentSettings); },
    async getCurrent() { currentReads += 1; return { bookId: null }; },
    onSettingsChanged(listener) { settingsListener = listener; return () => {}; },
    patchSettings: async () => {}, getProgress: async () => null, saveProgress: async () => {},
    getWebProgress: async () => null, saveWebProgress: async () => {}, saveWebBook: async () => {},
  };
  context.VeilRead = {
    store,
    readerSession: ui,
    extractor: { findRules: () => null },
    online: {},
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
        if (message.type === 'readerUi.ready') callback({ ok: true, data: readySnapshot });
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
