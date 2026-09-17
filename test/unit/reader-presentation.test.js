const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : !!force;
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.listeners = {};
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.scrollTop = 0;
    this.offsetWidth = 480;
    this.offsetHeight = 600;
  }
  set className(value) {
    this.classList = new FakeClassList();
    String(value).split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }
  get className() { return [...this.classList.values].join(' '); }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener() {}
  setAttribute(name, value) { this[name] = String(value); }
  querySelector() { return null; }
  contains(node) { return this === node || this.children.some((child) => child.contains && child.contains(node)); }
  getBoundingClientRect() { return { left: 100, top: 80, width: 480, height: 600, right: 580, bottom: 680 }; }
  setPointerCapture() {}
}

function loadReaderApi() {
  const document = {
    head: new FakeElement('head'),
    createElement: (tag) => new FakeElement(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  const context = { document, console, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 900 };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('reader/reader-core.js', 'utf8'), context);
  return context.VeilRead;
}

function createReaderHarness(hostOverrides = {}) {
  const api = loadReaderApi();
  const mount = new FakeElement('div');
  const events = [];
  const host = {
    patchSettings() {},
    onPresentationChanged(event) { events.push({ ...event }); },
    ...hostOverrides,
  };
  const reader = api.createReader({ mount, env: 'content', host });
  return { api, reader, events };
}

function settingsFor(mode) {
  return {
    display: {
      mode, edge: 'right', width: 440,
      float: { x: null, y: null, w: 480, h: 600, bead: null },
      font: 'sans', fontSize: 17, lineHeight: 1.85, indent: true, maxWidth: 0,
      styles: {
        float: { color: '#111111', bgColor: '#ffffff', opacity: 1, glass: false },
        edge: { color: '#111111', bgColor: '#ffffff', opacity: 1, glass: false },
        sidebar: { color: '#111111', bgColor: '#ffffff', opacity: 1, glass: false },
      },
    },
    trigger: { autoHide: true, autoHideMode: 'collapse' },
    reading: { scrollStep: 0.9 },
  };
}

test('only floating mode can present the recovery bead', () => {
  const { normalizeReaderPresentation } = loadReaderApi().readerUtils;
  assert.equal(normalizeReaderPresentation('float', 'bead'), 'bead');
  assert.equal(normalizeReaderPresentation('edge-right', 'bead'), 'hidden');
  assert.equal(normalizeReaderPresentation('fill', 'bead'), 'hidden');
  assert.equal(normalizeReaderPresentation('disabled', 'panel'), 'hidden');
  assert.equal(normalizeReaderPresentation('float', 'panel'), 'panel');
});

test('edge and sidebar modes never collapse to the floating recovery bead', () => {
  const { getPanelAutoHideAction } = loadReaderApi().readerUtils;
  const settings = {
    display: { float: { autoHide: true } },
    trigger: { autoHide: true, autoHideMode: 'collapse' },
  };
  assert.equal(getPanelAutoHideAction(settings, 'edge-left'), 'hide');
  assert.equal(getPanelAutoHideAction(settings, 'float'), 'collapse');
  assert.equal(getPanelAutoHideAction(settings, 'fill'), null);
  assert.equal(getPanelAutoHideAction(settings, 'disabled'), null);
});

test('mode changes clear incompatible beads and page panels', () => {
  const { reader } = createReaderHarness();
  reader.applySettings(settingsFor('float'));
  reader.showBead({ x: 20, y: 30 });
  assert.equal(reader.getPresentation(), 'bead');

  reader.applySettings(settingsFor('edge'));
  assert.equal(reader.getPresentation(), 'hidden');

  reader.show();
  assert.equal(reader.getPresentation(), 'panel');
  reader.applySettings(settingsFor('sidebar'));
  assert.equal(reader.getPresentation(), 'hidden');
});

test('showBead and hideBead are idempotent', () => {
  const { reader, events } = createReaderHarness();
  reader.applySettings(settingsFor('float'));

  reader.showBead({ x: 20, y: 30 });
  reader.showBead({ x: 20, y: 30 });
  assert.equal(reader.getPresentation(), 'bead');
  assert.equal(events.filter((event) => event.presentation === 'bead').length, 1);

  reader.hideBead();
  reader.hideBead();
  assert.equal(reader.getPresentation(), 'hidden');
  assert.equal(events.filter((event) => event.presentation === 'hidden').length, 1);
});

test('a synchronized bead uses its stored position on a fresh page', () => {
  const { reader } = createReaderHarness();
  const settings = settingsFor('float');
  settings.display.float.bead = { x: 222, y: 333 };
  reader.applySettings(settings);

  reader.showBead(null, { notify: false, reason: 'sync' });

  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
  assert.equal(bead.style.left, '222px');
  assert.equal(bead.style.top, '333px');
});

test('a stale TXT open cannot overwrite the latest requested book', async () => {
  let resolveOldProgress;
  const { reader } = createReaderHarness({
    getProgress(bookId) {
      if (bookId !== 'old') return null;
      return new Promise((resolve) => { resolveOldProgress = resolve; });
    },
    async getChapter(bookId, index) {
      return { index, count: 5, title: `${bookId}-${index}`, text: `${bookId} text` };
    },
    saveProgress() {},
  });
  reader.applySettings(settingsFor('float'));

  const oldOpening = reader.openBook('old');
  await Promise.resolve();
  await reader.openBook('new', { index: 0 });
  resolveOldProgress({ chapter: 3, ratio: 0.5 });
  await oldOpening;

  const state = reader.getState();
  assert.equal(state.bookId, 'new');
  assert.equal(state.chapter, 0);
});
