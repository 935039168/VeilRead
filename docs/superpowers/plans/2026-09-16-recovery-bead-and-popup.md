# Recovery Bead and Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the collapsed recovery bead draggable and make popup opening-mode controls clear and fast.

**Architecture:** Persist a float-only bead override separately from float geometry, resetting it whenever the window geometry changes. Keep pointer intent in the reader core and use the existing settings writer for persistence. The popup remains a lightweight controller that switches only page-reader display modes, while side panel opening remains an explicit browser action.

**Tech Stack:** Manifest V3, vanilla JavaScript, Shadow DOM, `chrome.storage.local`, Node test runner.

---

### Task 1: Define the persisted recovery-bead behavior

**Files:**
- Modify: `lib/store.js`
- Modify: `reader/reader-core.js`
- Modify: `test/unit/store.test.js`
- Modify: `test/unit/reader-settings.test.js`

- [x] Write failing tests for empty `display.float.bead` defaults and for treating pointer movement at or below 4px as a click.
- [x] Run the focused tests and confirm they fail because the bead setting and pointer helper are absent.
- [x] Add the default model and pure reader helpers.
- [x] Run focused tests and confirm they pass.

### Task 2: Drag and persist the recovery bead

**Files:**
- Modify: `reader/reader-core.js`
- Modify: `content/content.js`

- [x] Add a no-geometry-emission drag path for the bead, clamp its position to the viewport, and restore only on a non-drag click.
- [x] Save the override through `display.float.bead`; clear it whenever float geometry is saved after moving or resizing the panel.
- [x] Reuse the override on future collapses, otherwise use the existing snapped-edge/right-bottom placement.
- [x] Run reader tests and syntax checks.

### Task 3: Simplify popup opening controls

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`
- Modify: `popup/popup.js`

- [x] Add a two-button opening-mode chooser for float and edge modes, with selected state and a concise contextual explanation.
- [x] Make selection patch `display.mode`, reflect storage changes while the popup is open, and retain the explicit native side-panel action.
- [x] Rename actions for clarity and show the common keyboard shortcuts.
- [x] Run popup syntax checks and inspect ids against bindings.

### Task 4: Document and verify

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-acceptance.md`

- [x] Document draggable recovery-bead behavior and popup mode switching.
- [x] Add manual checks for drag-versus-click, persistence, geometry reset, mode switching, and shortcuts.
- [x] Run `npm test`, `npm run check`, and manifest JSON parsing.
