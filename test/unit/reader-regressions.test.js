const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadReaderApi() {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('reader/reader-core.js', 'utf8'), context);
  return context.VeilRead;
}

test('cold-gray preset resolves a visibly cool floating background', () => {
  const api = loadReaderApi();
  const coldGray = api.THEMES.find((theme) => theme.name === '冷灰');
  const appearance = api.readerUtils.resolveReaderAppearance({
    styles: { float: { color: coldGray.color, bgColor: coldGray.bg, opacity: 0.9, glass: true } },
  }, 'float');

  assert.deepEqual({ ...coldGray }, { name: '冷灰', color: '#2B3138', bg: '#F4F6F8' });
  assert.equal(appearance.panelBackground, 'rgba(244,246,248,0.9)');
  assert.equal(appearance.overlayBackground, 'rgba(244,246,248,0.96)');
});

test('fill reader layout gives sidebar text a bounded scrolling area', () => {
  const { applyReaderLayout, getReaderLayout } = loadReaderApi().readerUtils;
  const panelStyle = { inset: '', left: '', top: '', width: '', height: '' };
  const scrollStyle = { minHeight: '' };

  assert.deepEqual({ ...getReaderLayout('fill') }, { panelInset: '0', scrollMinHeight: '0' });
  assert.deepEqual({ ...getReaderLayout('float') }, { panelInset: '', scrollMinHeight: '' });
  applyReaderLayout('fill', panelStyle, scrollStyle);
  assert.equal(panelStyle.inset, '0');
  assert.equal(scrollStyle.minHeight, '0');
});

test('edge auto-hide applies to every visible edge panel, regardless of how it opened', () => {
  const { getPanelAutoHideAction } = loadReaderApi().readerUtils;
  const base = {
    display: { float: { autoHide: true } },
    trigger: { autoHide: true, autoHideMode: 'hide' },
  };

  assert.equal(getPanelAutoHideAction(base, 'edge-right'), 'hide');
  assert.equal(getPanelAutoHideAction({ ...base, trigger: { ...base.trigger, autoHideMode: 'collapse' } }, 'edge-left'), 'collapse');
  assert.equal(getPanelAutoHideAction({ ...base, trigger: { ...base.trigger, autoHide: false } }, 'edge-right'), null);
  assert.equal(getPanelAutoHideAction(base, 'float'), 'collapse');
  assert.equal(getPanelAutoHideAction({ ...base, display: { float: { autoHide: false } } }, 'float'), null);
  assert.equal(getPanelAutoHideAction(base, 'fill'), null);
});

test('pending auto-hide delay can be canceled before a panel is reopened', () => {
  const { createCancelableDelay } = loadReaderApi().readerUtils;
  const callbacks = new Map();
  let nextId = 0;
  const delay = createCancelableDelay({
    setTimeout(callback) { nextId += 1; callbacks.set(nextId, callback); return nextId; },
    clearTimeout(id) { callbacks.delete(id); },
  });
  let calls = 0;

  delay.schedule(() => { calls += 1; }, 800);
  assert.equal(callbacks.size, 1);
  delay.cancel();
  assert.equal(callbacks.size, 0);
  assert.equal(calls, 0);

  delay.schedule(() => { calls += 1; }, 800);
  callbacks.values().next().value();
  assert.equal(calls, 1);
});
test('edge trigger requires leaving and re-entering after a resize', () => {
  const { createEdgeTriggerState } = loadReaderApi().readerUtils;
  const trigger = createEdgeTriggerState();

  assert.equal(trigger.observe(true), true);
  trigger.onResize();
  assert.equal(trigger.observe(true), false);
  assert.equal(trigger.observe(false), false);
  assert.equal(trigger.observe(true), true);
});
