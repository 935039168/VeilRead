# Floating Reader Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the free floating reader the default and keep its appearance and visibility behaviors synchronized with the options page.

**Architecture:** Extend the persisted display model with two float-only behavior flags, retain per-mode appearance in `display.styles`, and route every reader change through the existing serialized settings writer. The reader owns pointer behavior while the options page only renders and edits the persisted model.

**Tech Stack:** Manifest V3, vanilla JavaScript, Shadow DOM, `chrome.storage.local`, Node test runner.

---

### Task 1: Define and test float defaults

**Files:**
- Modify: `lib/store.js`
- Modify: `test/unit/store.test.js`

- [x] **Step 1: Write a failing test** asserting `store.getSettings()` returns `display.mode === 'float'`, `display.float.snap === true`, and `display.float.autoHide === true` when storage is empty.
- [x] **Step 2: Run** `npm test -- --test-name-pattern="floating defaults"` and confirm it fails because the default is still `edge` and flags are absent.
- [x] **Step 3: Implement the minimum default model** in `DEFAULTS.display`.
- [x] **Step 4: Run** `npm test -- --test-name-pattern="floating defaults"` and confirm it passes.

### Task 2: Persist and test geometry snapping

**Files:**
- Modify: `reader/reader-core.js`
- Modify: `test/unit/reader-settings.test.js`

- [x] **Step 1: Write failing pure-helper tests** for `snapFloatGeometry`: it aligns a left/right/top/bottom edge within 16px and leaves an out-of-range geometry unchanged.
- [x] **Step 2: Run** `node --test test/unit/reader-settings.test.js` and confirm the helper is unavailable.
- [x] **Step 3: Implement the small geometry helper** in the reader module and expose it as a namespaced testable reader utility.
- [x] **Step 4: Call the helper after a free-window drag ends**, update `display.float`, and persist through `host.patchSettings` only when snapping is enabled.
- [x] **Step 5: Run** `node --test test/unit/reader-settings.test.js` and confirm all snapping cases pass.

### Task 3: Add reader appearance controls and float auto-hide

**Files:**
- Modify: `reader/reader-core.js`
- Modify: `reader/reader-core.css` or embedded reader styles in `reader/reader-core.js`

- [x] **Step 1: Write failing helper tests** for the active color preset and float auto-hide eligibility.
- [x] **Step 2: Add a compact `Aa` style popover** containing pre-existing preset colors, opacity, and glass controls; every change calls the existing style patch path.
- [x] **Step 3: Make the popover visually show the active preset**, retain keyboard focus visibility, and prevent its pointer activity from triggering hide.
- [x] **Step 4: Hook `pointerleave` / `pointerenter` on the floating panel** to the existing delay, hide, and collapse behavior when the float-specific auto-hide flag permits it.
- [x] **Step 5: Run the focused tests** and inspect syntax with `node --check reader/reader-core.js`.

### Task 4: Synchronize the options UI and expose float behavior

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`
- Modify: `options/options.css`

- [x] **Step 1: Make the “free floating window” radio card the default state from storage** and add a float-only settings group for edge snapping and mouse-leave auto-hide.
- [x] **Step 2: Bind the two controls to `display.float.snap` and `display.float.autoHide`**, and show the group whenever the selected default mode is `float`.
- [x] **Step 3: Extend storage-change rendering to update mode cards, float controls, chips, opacity, and glass without replacing an actively edited field.
- [x] **Step 4: Run** `node --check options/options.js` and manually verify the HTML identifiers match their bindings.

### Task 5: Update guidance and verify all behavior

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-acceptance.md`
- Modify: `docs/superpowers/plans/2026-09-16-floating-reader-sync.md`

- [x] **Step 1: Document free floating window as the default** and explain the per-mode appearance and float-only visibility options.
- [x] **Step 2: Add manual acceptance scenarios** for reader-to-options synchronization, all four snap targets, hide, and collapse.
- [x] **Step 3: Run** `npm test`, `npm run check`, and a manifest JSON parse; record the results in the final handoff.

## Plan review

The plan covers default state, persistence, reader behavior, settings UI, documentation, and automated/manual verification. The workspace has no Git repository, so commit steps are intentionally omitted.
