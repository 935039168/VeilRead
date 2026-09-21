# Mode-Aware Reader Closing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reader close control, side-edge activation, and mode switching consistently follow the currently selected reading mode.

**Architecture:** Add one reader-core `closeForCurrentMode()` action: floating panels collapse to their bead and edge panels hide. The content script permits browser-edge hot zones and side trays only for edge mode, resetting armed and delayed activation when the mode changes. The existing presentation normalizer remains the single rule that removes a bead after leaving floating mode.

**Tech Stack:** Manifest V3 extension JavaScript, Node.js built-in test runner, VM-based DOM test harnesses.

---

### Task 1: Add the core mode-aware close action

**Files:**
- Modify: `reader/reader-core.js:875-910,1539-1542,1564-1574`
- Test: `test/unit/reader-presentation.test.js`

- [x] **Step 1: Write the failing reader-presentation test**

Add this test after `mode changes clear incompatible beads and page panels`:

```js
test('the close action collapses only a floating panel and hides every other panel', () => {
  const { reader, events } = createReaderHarness();
  reader.applySettings(settingsFor('float'));
  reader.show();
  assert.equal(reader.closeForCurrentMode(), true);
  assert.equal(reader.getPresentation(), 'bead');
  assert.equal(events.at(-1).reason, 'collapse');

  reader.applySettings(settingsFor('edge'));
  reader.show();
  assert.equal(reader.closeForCurrentMode(), true);
  assert.equal(reader.getPresentation(), 'hidden');
  assert.equal(events.at(-1).reason, 'close');
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/unit/reader-presentation.test.js`

Expected: FAIL because `reader.closeForCurrentMode` does not exist.

- [x] **Step 3: Implement the minimal core action and wire the close button**

Insert this function after `collapse()` in `reader/reader-core.js`:

```js
function closeForCurrentMode() {
  if (wrap.dataset.mode === 'float') return collapse();
  return hide({ reason: 'close' });
}
```

Replace the binding with `btnClose.onclick = closeForCurrentMode;` and expose `closeForCurrentMode` after `collapse` in the returned API.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/unit/reader-presentation.test.js`

Expected: PASS, including floating collapse and edge hide assertions.

- [x] **Step 5: Commit the core behavior**

Run: `git add reader/reader-core.js test/unit/reader-presentation.test.js; git commit -m "fix: close readers by active display mode"`

### Task 2: Gate browser-edge activation by edge-panel mode

**Files:**
- Modify: `content/content.js:51-53,361-379,382-412,645-653`
- Modify: `test/unit/content-reader-ui.test.js:139-143,182-224`
- Test: `test/unit/content-reader-ui.test.js`

- [x] **Step 1: Write failing content-script integration tests**

Extend `loadContentHarness()` with a `showDelay = 0` option, apply it to every `makeSettings()` result used by the harness, and expose the stored mousemove listeners:

```js
async mousemove(clientX, clientY) {
  for (const listener of documentListeners.mousemove || []) listener({ clientX, clientY });
  await new Promise((resolve) => setTimeout(resolve, 0));
},
```

Make fake `createEdgeTriggerState()` use rising-edge semantics:

```js
createEdgeTriggerState: () => {
  let armed = true;
  return {
    observe(inHotZone) { if (!inHotZone) armed = true; return armed && inHotZone; },
    onResize() { armed = false; },
  };
},
```

Then add this test:

```js
test('only edge mode can reopen a hidden reader from the browser side', async () => {
  const floating = await loadContentHarness({ mode: 'float' });
  await floating.mousemove(1199, 450);
  assert.equal(floating.calls.some(([name]) => name === 'show'), false);

  const edge = await loadContentHarness({ mode: 'edge' });
  await edge.mousemove(1199, 450);
  assert.equal(edge.calls.some(([name]) => name === 'show'), true);
});
```

Add this test after it:

```js
test('changing away from edge mode cancels a pending side-edge activation', async () => {
  const harness = await loadContentHarness({ mode: 'edge', showDelay: 50 });
  await harness.mousemove(1199, 450);
  harness.emitSettings('float');
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(harness.reader.el.dataset.mode, 'float');
  assert.equal(harness.calls.some(([name]) => name === 'show'), false);
});
```

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `node --test test/unit/content-reader-ui.test.js`

Expected: FAIL because floating mode still opens from the old mousemove handler.

- [x] **Step 3: Implement the mode gate and reset stale side triggers**

Insert after `pageReaderEnabled()`:

```js
function edgePanelTriggerEnabled() {
  return pageReaderEnabled() && settings.display && settings.display.mode === 'edge';
}
```

Use `edgePanelTriggerEnabled()` in the initial mousemove guard and tray-creation guard. Replace the mode-change block in the settings listener with:

```js
if (previousMode !== nextMode) {
  cancelPendingOpen();
  edgeTrigger.onResize();
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
}
```

This leaves explicit extension commands intact while suppressing float/sidebar browser-side activation.

- [x] **Step 4: Run the focused tests to verify they pass**

Run: `node --test test/unit/content-reader-ui.test.js`

Expected: PASS; hidden float stays bead-only, edge reopens an edge panel, and mode switching cannot leak a delayed open.

- [x] **Step 5: Commit the side-trigger policy**

Run: `git add content/content.js test/unit/content-reader-ui.test.js; git commit -m "fix: limit side triggers to edge reader mode"`

### Task 3: Document and verify the complete behavior

**Files:**
- Modify: `docs/manual-acceptance.md`
- Test: `test/unit/reader-presentation.test.js`
- Test: `test/unit/content-reader-ui.test.js`
- Test: `test/unit/reader-regressions.test.js`

- [x] **Step 1: Add manual acceptance instructions**

Append this section to `docs/manual-acceptance.md`:

```markdown
### 阅读窗口关闭与切换

- 自由悬浮窗：点击右下角叉号后，正文窗口收为小圆点；移到浏览器侧边不会重新打开正文窗口。
- 贴边面板：点击右下角叉号后，正文窗口隐藏；移入已配置的浏览器侧边热区或侧边托盘，会重新显示贴边面板。
- 在自由悬浮窗显示小圆点时切换到贴边面板、侧边栏或关闭阅读器，小圆点立即消失。
- 在贴边面板等待侧边延迟打开时切换到自由悬浮窗，小圆点和正文窗口均不会意外出现。
```

- [x] **Step 2: Run focused regressions**

Run: `node --test test/unit/reader-presentation.test.js test/unit/content-reader-ui.test.js test/unit/reader-regressions.test.js`

Expected: PASS with zero failures.

- [x] **Step 3: Run the release verification**

Run: `npm run release:check`

Expected: PASS with the complete unit suite reporting zero failures.

- [x] **Step 4: Commit documentation**

Run: `git add docs/manual-acceptance.md; git commit -m "docs: cover mode-aware reader closing"`

### Review follow-up: Guard authoritative settings races

The Task 2 review uncovered two asynchronous cases beyond the initial hot-zone test: a stale tray-open request and a delayed, old `store.getSettings()` result. Both were covered by failing integration regressions before the production guard was added. The final implementation invalidates a cached authoritative-settings read when settings change and applies a read result only when it belongs to the current settings generation.
