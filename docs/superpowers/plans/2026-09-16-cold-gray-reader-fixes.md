# 冷灰配色与阅读器稳定性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make preset backgrounds visibly and consistently apply in the floating reader, add a cold-gray low-profile preset, restore sidebar scrolling, and prevent resize-driven edge-trigger popups.

**Architecture:** Per-mode appearance remains in display.styles. Reader core exports the only preset list and adds small pure helpers for appearance, fill layout, and edge-trigger arming. The content script owns browser events and uses the arming helper to require a post-resize leave-and-reenter gesture.

**Tech Stack:** Manifest V3, vanilla JavaScript, Shadow DOM, Node test runner.

---

### Task 1: Specify the regressions with failing reader-core tests

**Files:**
- Create: test/unit/reader-regressions.test.js
- Modify: reader/reader-core.js

- [x] **Step 1: Expose reader exports to the test loader and add three failing tests.**

~~~
function loadReaderApi() {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('reader/reader-core.js', 'utf8'), context);
  return context.VeilRead;
}
function loadReaderUtils() { return loadReaderApi().readerUtils; }

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
  const { getReaderLayout } = loadReaderUtils();
  assert.deepEqual({ ...getReaderLayout('fill') }, { panelInset: '0', scrollMinHeight: '0' });
  assert.deepEqual({ ...getReaderLayout('float') }, { panelInset: '', scrollMinHeight: '' });
});

test('edge trigger requires leaving and re-entering after a resize', () => {
  const { createEdgeTriggerState } = loadReaderUtils();
  const trigger = createEdgeTriggerState();
  assert.equal(trigger.observe(true), true);
  trigger.onResize();
  assert.equal(trigger.observe(true), false);
  assert.equal(trigger.observe(false), false);
  assert.equal(trigger.observe(true), true);
});
~~~

- [x] **Step 2: Run the focused test and verify RED.**

Run: node --test test/unit/reader-regressions.test.js

Expected: FAIL because the cold-gray preset and the three helpers do not yet exist.

- [x] **Step 3: Commit only the failing test.**

~~~
git add test/unit/reader-settings.test.js
git commit -m "test: cover reader appearance and resize regressions"
~~~

### Task 2: Implement shared presets, appearance rendering, and fill layout

**Files:**
- Modify: reader/reader-core.js:15-22,501-568
- Modify: options/options.js:12-19

- [x] **Step 1: Add cold gray to the reader-owned preset list and export it.**

~~~
const THEMES = [
  { name: '纯白', color: '#1a1a1a', bg: '#ffffff' },
  { name: '冷灰', color: '#2B3138', bg: '#F4F6F8' },
  // retain 米黄、纸白、墨绿、暗夜、纯黑
];

globalThis.VeilRead.FONTS = FONTS;
globalThis.VeilRead.THEMES = THEMES;
~~~

- [x] **Step 2: Add and export the pure helpers.**

~~~
function resolveReaderAppearance(display, modeKey) {
  const style = (display && display.styles && display.styles[modeKey]) || {};
  const bgColor = style.bgColor != null ? style.bgColor : (display && display.bgColor) || '#ffffff';
  const color = style.color != null ? style.color : (display && display.color) || '#2c2c2c';
  const rawOpacity = style.opacity != null ? style.opacity : display && display.opacity;
  const opacity = Math.min(1, Math.max(0.01, Number(rawOpacity) || 1));
  const rgb = hexToRgb(bgColor);
  return {
    color,
    bgColor,
    opacity,
    glass: style.glass != null ? style.glass : !(display && display.glass === false),
    panelBackground: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + opacity + ')',
    overlayBackground: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.96)',
    isDark: (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 < 128,
  };
}

function getReaderLayout(mode) {
  return mode === 'fill'
    ? { panelInset: '0', scrollMinHeight: '0' }
    : { panelInset: '', scrollMinHeight: '' };
}

function createEdgeTriggerState() {
  let armed = true;
  return {
    observe(inHotZone) { if (!inHotZone) armed = true; return armed && inHotZone; },
    onResize() { armed = false; },
  };
}
~~~

Expose all three from VeilRead.readerUtils.

- [x] **Step 3: Apply the resolved values to every reader surface and use the fill layout.**

~~~
const appearance = resolveReaderAppearance(d, st.modeKey);
const layout = getReaderLayout(mode);
panel.style.inset = layout.panelInset;
scroll.style.minHeight = layout.scrollMinHeight;
wrap.style.setProperty('--vr-surface-bg', appearance.panelBackground);
wrap.style.setProperty('--vr-overlay-bg', appearance.overlayBackground);
wrap.style.setProperty('--vr-fg', appearance.color);
wrap.style.setProperty('--vr-barbg', appearance.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
panel.style.backdropFilter = (appearance.opacity < 0.98 && appearance.glass !== false)
  ? 'blur(10px) saturate(1.15)' : 'none';
~~~

Use var(--vr-surface-bg, #ffffff) for .vr-panel and var(--vr-overlay-bg, rgba(250,250,248,.98)) for .vr-toc and .vr-style.

- [x] **Step 4: Remove duplicate preset data from the options page.**

~~~
const THEMES = globalThis.VeilRead.THEMES;
~~~

- [x] **Step 5: Run focused tests and verify GREEN.**

Run: node --test test/unit/reader-regressions.test.js

Expected: all reader-settings tests PASS.

- [x] **Step 6: Commit the implementation.**

~~~
git add reader/reader-core.js options/options.js
git commit -m "fix: apply reader presets consistently"
~~~

### Task 3: Prevent resize-driven edge opening

**Files:**
- Modify: content/content.js:10-17,206-224,439-442

- [x] **Step 1: Instantiate the reader-core edge-trigger state.**

~~~
const edgeTrigger = globalThis.VeilRead.readerUtils.createEdgeTriggerState();
~~~

- [x] **Step 2: Gate existing mousemove behavior through the state helper.**

~~~
const inHotZone = inEdgeStrip(e.clientX, e.clientY, t);
if (!edgeTrigger.observe(inHotZone)) {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  return;
}
if (!showTimer) {
  showTimer = setTimeout(() => {
    showTimer = null;
    openReader({ viaHover: true });
  }, t.showDelay);
}
~~~

- [x] **Step 3: Disarm and cancel pending edge activation during resize.**

~~~
window.addEventListener('resize', () => {
  edgeTrigger.onResize();
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (reader) reader.applySettings(settings);
  positionTray();
}, { passive: true });
~~~

- [x] **Step 4: Verify syntax and focused regression tests.**

Run: node --check content/content.js && node --test test/unit/reader-regressions.test.js

Expected: exit code 0.

- [x] **Step 5: Commit the resize guard.**

~~~
git add content/content.js
git commit -m "fix: ignore edge trigger during resize"
~~~

### Task 4: Add acceptance checks and verify the complete change

**Files:**
- Modify: docs/manual-acceptance.md
- Modify: README.md

- [x] **Step 1: Document cold-gray behavior.**

~~~
- 自由悬浮窗选择“冷灰”后，正文面板、目录和 Aa 浮层均为冷灰背景；透明度和毛玻璃仍沿用该形态原有设置。
~~~

- [x] **Step 2: Add manual checks for scrolling and resize suppression.**

~~~
- 原生侧边栏打开长章节后，滚轮只滚动正文区域，顶部书籍选择条保持可见。
- 阅读器隐藏时拖动浏览器窗口任意边框调整尺寸；停在触发边缘不得打开。鼠标先离开再重新进入热区后，仍应按延迟正常打开。
~~~

- [x] **Step 3: Run full verification.**

Run: npm test && npm run check && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"

Expected: 0 failed tests, syntax checks pass, and manifest parses.

- [x] **Step 4: Inspect and commit only the documentation.**

~~~
git diff --check
git status --short
git add README.md docs/manual-acceptance.md
git commit -m "docs: cover reader stability fixes"
~~~

## Plan review

The plan covers all approved requirements while preserving per-mode user appearance, transparency, normal edge-trigger behavior, and the untracked .claude directory. The user requested Inline Execution, so the next step is to execute Tasks 1-4 in this session.
