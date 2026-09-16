const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadReaderUtils() {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('reader/reader-core.js', 'utf8'), context);
  return context.VeilRead.readerUtils;
}

test('floating geometry snaps to every viewport edge inside the threshold', () => {
  const { snapFloatGeometry } = loadReaderUtils();
  const viewport = { width: 1000, height: 800 };

  assert.deepEqual({ ...snapFloatGeometry({ x: 11, y: 200, w: 400, h: 300 }, viewport) }, { x: 0, y: 200, w: 400, h: 300 });
  assert.deepEqual({ ...snapFloatGeometry({ x: 591, y: 200, w: 400, h: 300 }, viewport) }, { x: 600, y: 200, w: 400, h: 300 });
  assert.deepEqual({ ...snapFloatGeometry({ x: 200, y: 12, w: 400, h: 300 }, viewport) }, { x: 200, y: 0, w: 400, h: 300 });
  assert.deepEqual({ ...snapFloatGeometry({ x: 200, y: 487, w: 400, h: 300 }, viewport) }, { x: 200, y: 500, w: 400, h: 300 });
});

test('floating geometry remains free when it is outside the snap threshold', () => {
  const { snapFloatGeometry } = loadReaderUtils();
  const geometry = { x: 120, y: 80, w: 400, h: 300 };

  assert.deepEqual({ ...snapFloatGeometry(geometry, { width: 1000, height: 800 }) }, geometry);
});

test('float auto-hide uses its own setting instead of the edge-panel policy', () => {
  const { shouldFloatAutoHide } = loadReaderUtils();
  const base = { display: { float: { autoHide: true } }, trigger: { autoHide: true } };

  assert.equal(shouldFloatAutoHide(base, 'float'), true);
  assert.equal(shouldFloatAutoHide({ ...base, display: { float: { autoHide: false } } }, 'float'), false);
  assert.equal(shouldFloatAutoHide({ ...base, trigger: { autoHide: false } }, 'float'), true);
  assert.equal(shouldFloatAutoHide(base, 'edge-right'), false);
});

test('only geometry writes invalidate a pending floating-window position save', () => {
  const { isFloatGeometryPatch } = loadReaderUtils();

  assert.equal(isFloatGeometryPatch({ display: { float: { x: 10, y: 20, w: 480, h: 600 } } }), true);
  assert.equal(isFloatGeometryPatch({ display: { float: { snap: false } } }), false);
  assert.equal(isFloatGeometryPatch({ display: { styles: { float: { opacity: 0.7 } } } }), false);
});

test('style guidance only advertises controls available to the current reader mode', () => {
  const { styleHintForMode } = loadReaderUtils();

  assert.match(styleHintForMode('float'), /拖顶部移动/);
  assert.match(styleHintForMode('edge'), /内侧边缘/);
  assert.match(styleHintForMode('sidebar'), /Ctrl\+滚轮/);
  assert.doesNotMatch(styleHintForMode('sidebar'), /悬浮窗/);
});

test('quick typography adjustments use the current value and respect configured bounds', () => {
  const { stepReaderSetting } = loadReaderUtils();

  assert.equal(stepReaderSetting(17, 17, 1, 12, 28), 18);
  assert.equal(stepReaderSetting(undefined, 17, -10, 12, 28), 12);
  assert.equal(stepReaderSetting(28, 17, 1, 12, 28), 28);
});

test('only active appearance controls defer a settings-page appearance refresh', () => {
  const { shouldDeferAppearanceSync } = loadReaderUtils();

  assert.equal(shouldDeferAppearanceSync('color'), true);
  assert.equal(shouldDeferAppearanceSync('fontSize'), true);
  assert.equal(shouldDeferAppearanceSync('site-0-content'), false);
  assert.equal(shouldDeferAppearanceSync('floatSnap'), false);
  assert.equal(shouldDeferAppearanceSync(''), false);
});

test('floating collapse follows the snapped edge with right-left-top-bottom priority', () => {
  const { getCollapseBeadPosition } = loadReaderUtils();
  const viewport = { width: 1000, height: 800 };

  assert.deepEqual({ ...getCollapseBeadPosition({ x: 600, y: 120, w: 400, h: 300 }, viewport) }, { x: 952, y: 134, side: 'right' });
  assert.deepEqual({ ...getCollapseBeadPosition({ x: 0, y: 120, w: 400, h: 300 }, viewport) }, { x: 8, y: 134, side: 'left' });
  assert.deepEqual({ ...getCollapseBeadPosition({ x: 240, y: 0, w: 400, h: 300 }, viewport) }, { x: 254, y: 8, side: 'top' });
  assert.deepEqual({ ...getCollapseBeadPosition({ x: 240, y: 500, w: 400, h: 300 }, viewport) }, { x: 254, y: 752, side: 'bottom' });
  assert.deepEqual({ ...getCollapseBeadPosition({ x: 120, y: 160, w: 400, h: 300 }, viewport) }, { x: 472, y: 412, side: null });
});

test('recovery bead pointer movement distinguishes a click from a drag', () => {
  const { didPointerMove } = loadReaderUtils();

  assert.equal(didPointerMove(10, 10, 14, 10), false);
  assert.equal(didPointerMove(10, 10, 13, 14), true);
  assert.equal(didPointerMove(10, 10, 15, 10), true);
});
