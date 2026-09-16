# VeilRead Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every actionable issue found in the code review while preserving existing reader data.

**Architecture:** Introduce focused helpers for serialized storage writes and online-book identity. Keep the current native-JS, MV3 architecture; make message delivery initialization-aware and make online requests safe, bounded, and latest-request-wins.

**Tech Stack:** Manifest V3, native JavaScript, chrome.storage.local, IndexedDB, Node `node:test`.

---

### Task 1: Add executable regression tests

**Files:**
- Create: `test/unit/store.test.js`
- Create: `test/unit/extractor.test.js`
- Modify: `package.json`

- [x] Write failing tests for storage write ordering, longest-domain rule selection, invalid selectors, and online-book progress identity.
- [x] Run `node --test test/unit/*.test.js` and verify failures demonstrate missing behavior.
- [x] Add the smallest production helpers and exports needed for the tests.
- [x] Run the test command and verify all tests pass.

### Task 2: Make storage and online-book progress reliable

**Files:**
- Modify: `lib/store.js`
- Modify: `lib/db.js`
- Modify: `reader/reader-core.js`
- Modify: `popup/popup.js`
- Modify: `options/options.js`

- [x] Implement serialized writes and book-level web metadata/progress semantics.
- [x] Preserve per-chapter scroll progress and migrate existing online-book records lazily.
- [x] Update listing, reset and deletion flows to use the stable online-book identity.
- [x] Verify with the Task 1 tests.

### Task 3: Harden online loading and command delivery

**Files:**
- Modify: `content/content.js`
- Modify: `background/service-worker.js`
- Modify: `reader/reader-core.js`

- [x] Add a content-script readiness promise and bounded retry-aware routing.
- [x] Restrict automatic chapter/TOC fetches to same-origin URLs, with timeout and response-size limits.
- [x] Add latest-request-wins handling and actionable error messages.
- [x] Preserve a catalog cache across chapters of the same online book.

### Task 4: Align settings, UI and accessibility

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`
- Modify: `popup/popup.html`
- Modify: `sidebar/sidebar.html`
- Modify: `reader/reader-core.js`

- [x] Make side-panel selection truthful and give users a direct native-panel action.
- [x] Add catalog selector support, field validation feedback, associated labels and ARIA labels.
- [x] Make focus states expose reader controls and make auto-hide wording match behavior.

### Task 5: Permissions, documentation and release verification

**Files:**
- Modify: `manifest.json`
- Modify: `README.md`
- Create: `docs/manual-acceptance.md`

- [x] Document broad host access and remove the unsupported file-URL content-script match.
- [x] Correct privacy, Shadow DOM and side-panel claims.
- [x] Add manual checks for Chrome and Edge shortcut injection, side panel, cross-origin behavior and storage continuity.
- [x] Run `node --test`, `node --check` for every JS file, and manifest JSON parsing.
