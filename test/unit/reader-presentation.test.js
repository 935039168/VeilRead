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
  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener);
  }
  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners[type] || [])]) listener(event);
  }
  setAttribute(name, value) { this[name] = String(value); }
  querySelector() { return null; }
  contains(node) { return this === node || this.children.some((child) => child.contains && child.contains(node)); }
  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left);
    const top = Number.parseFloat(this.style.top);
    const width = this.classList.contains('vr-bead') ? 40 : (Number.parseFloat(this.style.width) || this.offsetWidth);
    const height = this.classList.contains('vr-bead') ? 40 : (Number.parseFloat(this.style.height) || this.offsetHeight);
    const x = Number.isFinite(left) ? left : 100;
    const y = Number.isFinite(top) ? top : 80;
    return { left: x, top: y, width, height, right: x + width, bottom: y + height };
  }
  setPointerCapture() {}
}

function loadReaderContext(viewport = {}) {
  let now = Date.now();
  class FakeDate extends Date {
    static now() { return now; }
  }
  const document = {
    head: new FakeElement('head'),
    createElement: (tag) => new FakeElement(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  const context = {
    document, console, setTimeout, clearTimeout, Date: FakeDate,
    innerWidth: viewport.width || 1200,
    innerHeight: viewport.height || 900,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('reader/reader-core.js', 'utf8'), context);
  context.advanceTime = (milliseconds) => { now += milliseconds; };
  return context;
}

function loadReaderApi() {
  return loadReaderContext().VeilRead;
}

function createReaderHarness(hostOverrides = {}, viewport = {}) {
  const context = loadReaderContext(viewport);
  const api = context.VeilRead;
  const mount = new FakeElement('div');
  const events = [];
  const host = {
    patchSettings() {},
    onPresentationChanged(event) { events.push({ ...event }); },
    ...hostOverrides,
  };
  const reader = api.createReader({ mount, env: 'content', host });
  return {
    api, reader, events,
    setViewport(width, height) {
      context.innerWidth = width;
      context.innerHeight = height;
    },
    advanceTime(milliseconds) { context.advanceTime(milliseconds); },
  };
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

test('bead anchors keep right and bottom offsets across viewport changes', () => {
  const {
    normalizeBeadAnchor,
    beadAnchorToPoint,
    pointToBeadAnchor,
  } = loadReaderApi().readerUtils;
  const viewport = { width: 1200, height: 900 };

  assert.deepEqual({ ...normalizeBeadAnchor(null, viewport) }, { right: 8, bottom: 8 });
  assert.deepEqual(
    { ...normalizeBeadAnchor({ right: 260, bottom: 210 }, viewport) },
    { right: 260, bottom: 210 }
  );
  assert.deepEqual(
    { ...beadAnchorToPoint({ right: 500, bottom: 400 }, { width: 320, height: 240 }) },
    { x: 8, y: 8 }
  );
  assert.deepEqual(
    { ...normalizeBeadAnchor({ x: 900, y: 650 }, viewport) },
    { right: 260, bottom: 210 }
  );

  const anchor = pointToBeadAnchor({ x: 900, y: 650 }, viewport);
  assert.deepEqual({ ...anchor }, { right: 260, bottom: 210 });
  assert.deepEqual(
    { ...beadAnchorToPoint(anchor, { width: 1000, height: 700 }) },
    { x: 700, y: 450 }
  );
  assert.deepEqual(
    { ...pointToBeadAnchor({ x: 8, y: 8 }, { width: 1000, height: 700 }) },
    { right: 952, bottom: 652 }
  );
});

test('invalid dragged bead points fall back to the default bottom-right anchor', () => {
  const { pointToBeadAnchor } = loadReaderApi().readerUtils;
  const viewport = { width: 1200, height: 900 };

  for (const point of [null, {}, { x: NaN, y: 650 }, { x: 900, y: Infinity }]) {
    assert.deepEqual({ ...pointToBeadAnchor(point, viewport) }, { right: 8, bottom: 8 });
  }
});

test('out-of-range legacy bead points fall back as one invalid anchor', () => {
  const { normalizeBeadAnchor } = loadReaderApi().readerUtils;
  const viewport = { width: 1200, height: 900 };

  for (const anchor of [
    { x: 7, y: 650 },
    { x: 1153, y: 650 },
    { x: 900, y: 7 },
    { x: 900, y: 853 },
  ]) {
    assert.deepEqual({ ...normalizeBeadAnchor(anchor, viewport) }, { right: 8, bottom: 8 });
  }
});

test('visual clamping does not overwrite the stored bead anchor', () => {
  const { beadAnchorToPoint } = loadReaderApi().readerUtils;
  const anchor = { right: 500, bottom: 400 };

  assert.deepEqual(
    { ...beadAnchorToPoint(anchor, { width: 320, height: 240 }) },
    { x: 8, y: 8 }
  );
  assert.deepEqual(anchor, { right: 500, bottom: 400 });
  assert.deepEqual(
    { ...beadAnchorToPoint(anchor, { width: 1200, height: 900 }) },
    { x: 660, y: 460 }
  );
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

test('a synchronized bead places default, canonical, and legacy anchors on a fresh page', () => {
  for (const { saved, left, top } of [
    { saved: null, left: 1152, top: 852 },
    { saved: { right: 260, bottom: 210 }, left: 900, top: 650 },
    { saved: { x: 222, y: 333 }, left: 222, top: 333 },
  ]) {
    const { reader } = createReaderHarness();
    const settings = settingsFor('float');
    settings.display.float.bead = saved;
    reader.applySettings(settings);

    reader.showBead(null, { notify: false, reason: 'sync' });

    const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
    assert.equal(bead.style.left, `${left}px`);
    assert.equal(bead.style.top, `${top}px`);
  }
});

test('reapplying settings redraws a visible bead without changing its canonical anchor', () => {
  const { reader, setViewport } = createReaderHarness();
  const settings = settingsFor('float');
  const anchor = { right: 500, bottom: 400 };
  settings.display.float.bead = anchor;
  reader.applySettings(settings);
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));

  setViewport(320, 240);
  reader.applySettings(settings);
  assert.equal(bead.style.left, '8px');
  assert.equal(bead.style.top, '8px');
  assert.deepEqual(anchor, { right: 500, bottom: 400 });

  setViewport(1200, 900);
  reader.applySettings(settings);
  assert.equal(bead.style.left, '660px');
  assert.equal(bead.style.top, '460px');
  assert.deepEqual(anchor, { right: 500, bottom: 400 });
});

test('a legacy bead is migrated once and keeps its anchor when old settings are reapplied', () => {
  const { reader, setViewport } = createReaderHarness();
  const settings = settingsFor('float');
  settings.display.float.bead = { x: 900, y: 650 };
  reader.applySettings(settings);
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));

  setViewport(1000, 700);
  reader.applySettings(settings);

  assert.equal(bead.style.left, '700px');
  assert.equal(bead.style.top, '450px');
});

test('stale settings do not overwrite a dragged anchor but a new synchronized anchor does', () => {
  const { reader } = createReaderHarness();
  const staleSettings = settingsFor('float');
  reader.applySettings(staleSettings);
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));

  bead.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 1162, clientY: 862, preventDefault() {},
  });
  bead.dispatch('pointermove', { clientX: 910, clientY: 660 });
  bead.dispatch('pointerup', { clientX: 910, clientY: 660 });
  reader.applySettings(staleSettings);
  assert.equal(bead.style.left, '900px');
  assert.equal(bead.style.top, '650px');

  const synchronizedSettings = settingsFor('float');
  synchronizedSettings.display.float.bead = { right: 100, bottom: 100 };
  reader.applySettings(synchronizedSettings);
  assert.equal(bead.style.left, '1060px');
  assert.equal(bead.style.top, '760px');
});

test('a panel collapse keeps its derived anchor when null settings are reapplied after resize', () => {
  const { reader, setViewport } = createReaderHarness();
  const settings = settingsFor('float');
  settings.display.float.x = 0;
  settings.display.float.y = 100;
  reader.applySettings(settings);
  reader.show();
  reader.collapse();
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
  assert.equal(bead.style.left, '8px');
  assert.equal(bead.style.top, '114px');

  setViewport(1000, 700);
  reader.applySettings(settings);
  assert.equal(bead.style.left, '8px');
  assert.equal(bead.style.top, '8px');

  setViewport(1200, 900);
  reader.applySettings(settings);
  assert.equal(bead.style.left, '8px');
  assert.equal(bead.style.top, '114px');
});

test('a delayed local bead reset cannot clear an anchor created by a later collapse', () => {
  const geometryResets = [];
  const { reader, advanceTime } = createReaderHarness({
    onGeometry(geometry) { geometryResets.push({ ...geometry }); },
  });
  const settings = settingsFor('float');
  settings.display.float.bead = { right: 260, bottom: 210 };
  reader.applySettings(settings);
  reader.show();

  const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));
  grab.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 700, clientY: 160, preventDefault() {},
  });
  grab.dispatch('pointermove', { clientX: 104, clientY: 110 });
  grab.dispatch('pointerup', { clientX: 104, clientY: 110 });
  assert.equal(geometryResets.length, 1);
  assert.equal(geometryResets[0].bead, null);
  assert.equal(typeof geometryResets[0].beadClearToken, 'string');

  reader.collapse();
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
  assert.equal(bead.style.left, '532px');
  assert.equal(bead.style.top, '652px');

  const delayedAcknowledgement = settingsFor('float');
  Object.assign(delayedAcknowledgement.display.float, geometryResets[0]);
  advanceTime(60_000);
  reader.applySettings(delayedAcknowledgement);
  assert.equal(bead.style.left, '532px');
  assert.equal(bead.style.top, '652px');

  const externalAnchor = settingsFor('float');
  externalAnchor.display.float.bead = { right: 100, bottom: 100 };
  reader.applySettings(externalAnchor);
  assert.equal(bead.style.left, '1060px');
  assert.equal(bead.style.top, '760px');

  const externalClear = settingsFor('float');
  reader.applySettings(externalClear);
  assert.equal(bead.style.left, '1152px');
  assert.equal(bead.style.top, '852px');
});

test('concurrent local clear acknowledgements each preserve a newer collapse anchor', () => {
  const geometryResets = [];
  const { reader } = createReaderHarness({
    onGeometry(geometry) { geometryResets.push({ ...geometry }); },
  });
  const settings = settingsFor('float');
  settings.display.float.bead = { right: 260, bottom: 210 };
  reader.applySettings(settings);
  reader.show();
  const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));

  for (const clientX of [104, 204]) {
    const rect = reader.panel.getBoundingClientRect();
    grab.dispatch('pointerdown', {
      button: 0, pointerId: 1, clientX: rect.left + 4, clientY: rect.top + 10, preventDefault() {},
    });
    grab.dispatch('pointermove', { clientX, clientY: 110 });
    grab.dispatch('pointerup', { clientX, clientY: 110 });
  }
  reader.collapse();
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
  assert.equal(bead.style.left, '632px');
  assert.equal(bead.style.top, '652px');

  for (const reset of geometryResets) {
    const acknowledgement = settingsFor('float');
    Object.assign(acknowledgement.display.float, reset);
    reader.applySettings(acknowledgement);
    assert.equal(bead.style.left, '632px');
    assert.equal(bead.style.top, '652px');
  }
});

test('a replayed base anchor does not discard its pending local clear acknowledgement', () => {
  const geometryResets = [];
  const { reader } = createReaderHarness({
    onGeometry(geometry) { geometryResets.push({ ...geometry }); },
  });
  const baseSettings = settingsFor('float');
  baseSettings.display.float.bead = { right: 260, bottom: 210 };
  reader.applySettings(baseSettings);
  reader.show();
  const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));
  grab.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 700, clientY: 160, preventDefault() {},
  });
  grab.dispatch('pointermove', { clientX: 104, clientY: 110 });
  grab.dispatch('pointerup', { clientX: 104, clientY: 110 });
  reader.collapse();
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
  assert.equal(bead.style.left, '532px');
  assert.equal(bead.style.top, '652px');

  reader.applySettings(baseSettings);
  const acknowledgement = settingsFor('float');
  Object.assign(acknowledgement.display.float, geometryResets[0]);
  reader.applySettings(acknowledgement);
  assert.equal(bead.style.left, '532px');
  assert.equal(bead.style.top, '652px');
});

test('a delayed replay of a locally persisted bead does not override a later collapse', () => {
  const patches = [];
  const geometryResets = [];
  const { reader } = createReaderHarness({
    patchSettings(patch) { patches.push(patch); },
    onGeometry(geometry) { geometryResets.push({ ...geometry }); },
  });
  const initialSettings = settingsFor('float');
  initialSettings.display.float.bead = { right: 260, bottom: 210 };
  reader.applySettings(initialSettings);
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));

  bead.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 910, clientY: 660, preventDefault() {},
  });
  bead.dispatch('pointerup', { clientX: 1010, clientY: 710 });
  const persistedBead = { ...patches.at(-1).display.float.bead };
  assert.deepEqual(persistedBead, { right: 160, bottom: 160 });

  reader.show();
  const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));
  const panelRect = reader.panel.getBoundingClientRect();
  grab.dispatch('pointerdown', {
    button: 0, pointerId: 1,
    clientX: panelRect.left + 4, clientY: panelRect.top + 10,
    preventDefault() {},
  });
  grab.dispatch('pointermove', { clientX: 104, clientY: 110 });
  grab.dispatch('pointerup', { clientX: 104, clientY: 110 });
  assert.equal(geometryResets.length, 1);

  reader.collapse();
  assert.equal(bead.style.left, '532px');
  assert.equal(bead.style.top, '652px');

  const delayedLocalPersistence = settingsFor('float');
  Object.assign(delayedLocalPersistence.display.float, geometryResets[0], {
    bead: persistedBead,
    beadClearToken: null,
  });
  reader.applySettings(delayedLocalPersistence);
  assert.equal(bead.style.left, '532px');
  assert.equal(bead.style.top, '652px');

  const clearAcknowledgement = settingsFor('float');
  Object.assign(clearAcknowledgement.display.float, geometryResets[0]);
  reader.applySettings(clearAcknowledgement);
  assert.equal(bead.style.left, '532px');
  assert.equal(bead.style.top, '652px');

  const externalSettings = settingsFor('float');
  externalSettings.display.float.bead = { right: 100, bottom: 100 };
  reader.applySettings(externalSettings);
  assert.equal(bead.style.left, '1060px');
  assert.equal(bead.style.top, '760px');
});

test('an external anchor after a local clear does not make the following null look stale', () => {
  const geometryResets = [];
  const { reader } = createReaderHarness({
    onGeometry(geometry) { geometryResets.push({ ...geometry }); },
  });
  const settings = settingsFor('float');
  settings.display.float.bead = { right: 260, bottom: 210 };
  reader.applySettings(settings);
  reader.show();

  const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));
  grab.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 700, clientY: 160, preventDefault() {},
  });
  grab.dispatch('pointermove', { clientX: 104, clientY: 110 });
  grab.dispatch('pointerup', { clientX: 104, clientY: 110 });
  assert.equal(geometryResets.length, 1);

  const externalAnchor = settingsFor('float');
  externalAnchor.display.float.bead = { right: 100, bottom: 100 };
  reader.applySettings(externalAnchor);
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
  assert.equal(bead.style.left, '1060px');
  assert.equal(bead.style.top, '760px');

  const delayedClear = settingsFor('float');
  Object.assign(delayedClear.display.float, geometryResets[0]);
  reader.applySettings(delayedClear);
  assert.equal(bead.style.left, '1152px');
  assert.equal(bead.style.top, '852px');
});

test('an unmatched external null clears a pending local reset with or without a token', () => {
  for (const externalToken of ['external-clear', undefined]) {
    const { reader } = createReaderHarness({ onGeometry() {} });
    const settings = settingsFor('float');
    reader.applySettings(settings);
    reader.show();

    const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));
    grab.dispatch('pointerdown', {
      button: 0, pointerId: 1, clientX: 700, clientY: 160, preventDefault() {},
    });
    grab.dispatch('pointermove', { clientX: 104, clientY: 110 });
    grab.dispatch('pointerup', { clientX: 104, clientY: 110 });
    reader.collapse();
    const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
    assert.equal(bead.style.left, '532px');
    assert.equal(bead.style.top, '652px');

    const externalClear = settingsFor('float');
    if (externalToken) externalClear.display.float.beadClearToken = externalToken;
    reader.applySettings(externalClear);
    assert.equal(bead.style.left, '1152px');
    assert.equal(bead.style.top, '852px');
  }
});

test('consecutive local bead clears use distinct acknowledgement tokens', () => {
  const geometryResets = [];
  const { reader } = createReaderHarness({
    onGeometry(geometry) { geometryResets.push({ ...geometry }); },
  });
  reader.applySettings(settingsFor('float'));
  reader.show();
  const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));

  for (const clientX of [104, 204]) {
    const rect = reader.panel.getBoundingClientRect();
    grab.dispatch('pointerdown', {
      button: 0, pointerId: 1, clientX: rect.left + 4, clientY: rect.top + 10, preventDefault() {},
    });
    grab.dispatch('pointermove', { clientX, clientY: 110 });
    grab.dispatch('pointerup', { clientX, clientY: 110 });
  }

  assert.equal(geometryResets.length, 2);
  assert.equal(typeof geometryResets[0].beadClearToken, 'string');
  assert.equal(typeof geometryResets[1].beadClearToken, 'string');
  assert.notEqual(geometryResets[0].beadClearToken, geometryResets[1].beadClearToken);
});

test('evicted local clear tokens are treated as authoritative external clears', () => {
  const geometryResets = [];
  const { reader } = createReaderHarness({
    onGeometry(geometry) { geometryResets.push({ ...geometry }); },
  });
  reader.applySettings(settingsFor('float'));
  reader.show();
  const grab = reader.panel.children.find((child) => child.classList.contains('vr-grab'));
  for (let i = 0; i < 33; i += 1) grab.dispatch('dblclick');
  assert.equal(geometryResets.length, 33);
  assert.equal(new Set(geometryResets.map((item) => item.beadClearToken)).size, 33);

  reader.collapse();
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));
  const evictedClear = settingsFor('float');
  Object.assign(evictedClear.display.float, geometryResets[0]);
  reader.applySettings(evictedClear);
  assert.equal(bead.style.left, '1152px');
  assert.equal(bead.style.top, '852px');
});

test('a distant pointerup without pointermove drags the bead instead of restoring', () => {
  const patches = [];
  let restores = 0;
  const { reader } = createReaderHarness({
    patchSettings(patch) { patches.push(patch); },
    onBeadRestoreRequested() { restores += 1; },
  });
  reader.applySettings(settingsFor('float'));
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));

  bead.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 1162, clientY: 862, preventDefault() {},
  });
  bead.dispatch('pointerup', { clientX: 910, clientY: 660 });

  assert.equal(restores, 0);
  assert.equal(bead.style.left, '900px');
  assert.equal(bead.style.top, '650px');
  assert.deepEqual({ ...patches.at(-1).display.float.bead }, { right: 260, bottom: 210 });
});

test('bead dragging includes the final movement reported by pointerup', () => {
  const patches = [];
  const { reader } = createReaderHarness({
    patchSettings(patch) { patches.push(patch); },
  });
  reader.applySettings(settingsFor('float'));
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));

  bead.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 1162, clientY: 862, preventDefault() {},
  });
  bead.dispatch('pointermove', { clientX: 1010, clientY: 760 });
  bead.dispatch('pointerup', { clientX: 910, clientY: 660 });

  assert.equal(bead.style.left, '900px');
  assert.equal(bead.style.top, '650px');
  assert.deepEqual({ ...patches.at(-1).display.float.bead }, { right: 260, bottom: 210 });
});

test('dragging a bead persists a canonical anchor that survives viewport changes', () => {
  const patches = [];
  const { reader, setViewport } = createReaderHarness({
    patchSettings(patch) { patches.push(patch); },
  });
  const settings = settingsFor('float');
  reader.applySettings(settings);
  reader.showBead(null, { notify: false, reason: 'sync' });
  const bead = reader.el.children.find((child) => child.classList.contains('vr-bead'));

  bead.dispatch('pointerdown', {
    button: 0, pointerId: 1, clientX: 1162, clientY: 862, preventDefault() {},
  });
  bead.dispatch('pointermove', { clientX: 910, clientY: 660 });
  bead.dispatch('pointerup', { clientX: 910, clientY: 660 });

  assert.deepEqual({ ...patches.at(-1).display.float.bead }, { right: 260, bottom: 210 });
  setViewport(1000, 700);
  reader.showBead(null, { notify: false, reason: 'resize' });
  assert.equal(bead.style.left, '700px');
  assert.equal(bead.style.top, '450px');
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
