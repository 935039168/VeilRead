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
  const { getReaderLayout } = loadReaderApi().readerUtils;

  assert.deepEqual({ ...getReaderLayout('fill') }, { panelInset: '0', scrollMinHeight: '0' });
  assert.deepEqual({ ...getReaderLayout('float') }, { panelInset: '', scrollMinHeight: '' });
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
