# Tab-Synchronized Reader UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the page reader obey one authoritative display mode, synchronize the minimized floating-reader bead across every injected browser page, and hide a full reader when its tab stops being active.

**Architecture:** Keep the durable user preference in `vr.settings.display.mode`, but move ephemeral cross-tab presentation state into a small pure reducer persisted in `chrome.storage.session`. The service worker owns that reducer and distributes revisioned snapshots to registered content-script documents; each content script owns only its local `hidden | panel | bead` DOM projection. The reader core exposes explicit presentation operations, while edge and sidebar modes are structurally unable to create the float bead.

**Tech Stack:** Manifest V3, vanilla JavaScript, `chrome.storage.local`, `chrome.storage.session`, `chrome.tabs`, Node.js built-in test runner, VM-based Chrome API stubs.

---

## File map and fixed interfaces

- Create `lib/reader-session.js`: dependency-free normalization and reducer functions shared by the service worker, content script, and Node tests.
- Create `test/unit/reader-session.test.js`: reducer and projection tests for modes, revisions, navigation, activation, and registration cleanup.
- Modify `reader/reader-core.js`: explicit `hidden | panel | bead` API and float-only bead enforcement.
- Modify `test/unit/reader-regressions.test.js`: auto-hide and presentation normalization regressions.
- Modify `content/content.js`: ready handshake, revisioned snapshot application, presentation event reporting, and sidebar suppression.
- Create `test/unit/content-reader-ui.test.js`: pure content-policy tests loaded from `lib/reader-session.js`; keep browser DOM assertions in manual acceptance.
- Modify `background/service-worker.js`: session persistence, registered-document coordination, broadcast, activation, navigation, storage-mode reconciliation, and failed-recipient cleanup.
- Modify `test/unit/service-worker.test.js`: deterministic worker harness for ready, broadcast, activation, restart, navigation, and send failures.
- Modify `manifest.json`: load `lib/reader-session.js` before reader/content code.
- Modify `package.json`: syntax-check the new runtime modules and popup helper.
- Create `popup/popup-mode.js`: pure three-mode popup view model.
- Modify `popup/popup.html`: load `popup-mode.js` before `popup.js`.
- Modify `popup/popup.js`: stop rendering `sidebar` as `edge`.
- Create `test/unit/popup-mode.test.js`: popup mode view-model tests.
- Modify `README.md`, `docs/manual-acceptance.md`, `docs/releasing.md`, and the four files under `store/review/`: document cross-tab behavior and reviewer steps.
- Create `test/unit/reader-ui-docs.test.js`: executable documentation contract.

The shared state and message names are fixed for all tasks:

```js
// chrome.storage.session['vr.readerUiSession']
{
  mode: 'float' | 'edge' | 'sidebar',
  presentation: 'hidden' | 'panel' | 'bead',
  panelTabId: number | null,
  tabDocuments: { [tabId]: documentId },
  revision: number,
}

// content -> service worker
{ type: 'readerUi.ready' }
{ type: 'readerUi.event', event: 'panel-opened' | 'panel-hidden' | 'float-collapsed' | 'bead-restored' }

// service worker -> content
{ type: 'readerUi.sync', snapshot: { mode, presentation, panelTabId, revision } }
{ type: 'readerUi.hidePanel', revision }
{ type: 'readerUi.openPanel', revision }
```

`vr.settings.display.mode` remains authoritative. The `mode` in session state is only the last reconciled copy used to invalidate incompatible transient UI after a worker restart.

### Task 1: Build the pure session-state reducer

**Files:**
- Create: `lib/reader-session.js`
- Create: `test/unit/reader-session.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing reducer tests**

Create tests that load the new module directly and pin the complete transition table:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('../../lib/reader-session.js');

test('authoritative mode normalization removes incompatible presentation', () => {
  const bead = { mode: 'float', presentation: 'bead', panelTabId: null, tabDocuments: {}, revision: 4 };
  assert.deepEqual(session.reconcileMode(bead, 'edge'), {
    mode: 'edge', presentation: 'hidden', panelTabId: null, tabDocuments: {}, revision: 5,
  });
  assert.equal(session.normalizeMode('sidebar'), 'sidebar');
  assert.equal(session.normalizeMode('unexpected'), 'float');
});

test('only float can reduce to bead', () => {
  const base = session.createState('float');
  assert.equal(session.reduce(base, { type: 'float-collapsed', tabId: 7 }).presentation, 'bead');
  assert.equal(session.reduce(session.createState('edge'), { type: 'float-collapsed', tabId: 7 }).presentation, 'hidden');
  assert.equal(session.reduce(session.createState('sidebar'), { type: 'float-collapsed', tabId: 7 }).presentation, 'hidden');
});

test('activation hides a full panel without clearing a synchronized bead', () => {
  const panel = session.reduce(session.createState('float'), { type: 'panel-opened', tabId: 7 });
  assert.equal(session.reduce(panel, { type: 'tab-activated', tabId: 8 }).presentation, 'hidden');
  const bead = session.reduce(session.createState('float'), { type: 'float-collapsed', tabId: 7 });
  assert.equal(session.reduce(bead, { type: 'tab-activated', tabId: 8 }).presentation, 'bead');
});

test('a new document in the owner tab clears its stale full panel', () => {
  let state = session.reduce(session.createState('edge'), { type: 'ready', tabId: 7, documentId: 'old' });
  state = session.reduce(state, { type: 'panel-opened', tabId: 7 });
  state = session.reduce(state, { type: 'ready', tabId: 7, documentId: 'new' });
  assert.equal(state.presentation, 'hidden');
  assert.equal(state.panelTabId, null);
  assert.equal(state.tabDocuments['7'], 'new');
});

test('failed and removed tabs leave no registered document or panel owner', () => {
  let state = session.reduce(session.createState('float'), { type: 'ready', tabId: 7, documentId: 'doc' });
  state = session.reduce(state, { type: 'panel-opened', tabId: 7 });
  for (const type of ['message-failed', 'tab-removed']) {
    const next = session.reduce(state, { type, tabId: 7 });
    assert.equal(next.tabDocuments['7'], undefined);
    assert.equal(next.panelTabId, null);
    assert.equal(next.presentation, 'hidden');
  }
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test test/unit/reader-session.test.js`

Expected: FAIL with `Cannot find module '../../lib/reader-session.js'`.

- [ ] **Step 3: Implement the minimal reducer**

Expose these exact functions from both `globalThis.VeilRead.readerSession` and CommonJS:

```js
const PRESENTATIONS = new Set(['hidden', 'panel', 'bead']);

function normalizeMode(mode) {
  return mode === 'edge' || mode === 'sidebar' ? mode : 'float';
}

function createState(mode) {
  return { mode: normalizeMode(mode), presentation: 'hidden', panelTabId: null, tabDocuments: {}, revision: 0 };
}

function normalizeState(raw, authoritativeMode) {
  const base = createState(authoritativeMode);
  const input = raw && typeof raw === 'object' ? raw : {};
  const mode = normalizeMode(authoritativeMode);
  const presentation = PRESENTATIONS.has(input.presentation) ? input.presentation : 'hidden';
  const compatible = presentation !== 'bead' || mode === 'float';
  return {
    mode,
    presentation: compatible ? presentation : 'hidden',
    panelTabId: compatible && presentation === 'panel' && Number.isInteger(input.panelTabId) ? input.panelTabId : null,
    tabDocuments: input.tabDocuments && typeof input.tabDocuments === 'object' ? { ...input.tabDocuments } : {},
    revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : base.revision,
  };
}
```

Implement `reconcileMode(state, mode)` and `reduce(state, event)` as immutable functions. Increment `revision` only when observable state changes. Enforce these invariants after every event:

```text
bead => mode === float and panelTabId === null
panel => panelTabId is an integer
hidden => panelTabId === null
sidebar => presentation === hidden
```

`ready` stores `sender.documentId`; when the same tab id reports a different document id and owned `panel`, clear it to `hidden`. `bead-restored` is accepted only in float mode and becomes `panel` owned by the sender. `panel-opened` is ignored in sidebar mode. `message-failed` and `tab-removed` delete registration and clear ownership if needed.

- [ ] **Step 4: Add the runtime syntax check and verify GREEN**

Add `node --check lib/reader-session.js` to `npm run check` before `reader/reader-core.js`.

Run: `node --test test/unit/reader-session.test.js && npm run check`

Expected: all reducer tests PASS and all syntax checks exit 0.

- [ ] **Step 5: Commit the reducer batch**

```bash
git add lib/reader-session.js test/unit/reader-session.test.js package.json
git commit -m "feat: define reader UI session state"
```

### Task 2: Give the reader core an explicit presentation state

**Files:**
- Modify: `reader/reader-core.js:399-405,547-563,569-631,691-727,1177-1218,1311-1369`
- Modify: `test/unit/reader-regressions.test.js`

- [ ] **Step 1: Replace the old edge-collapse expectation with failing mode-safety tests**

Add these assertions before changing production code:

```js
test('only floating mode can present the recovery bead', () => {
  const { normalizeReaderPresentation } = loadReaderApi().readerUtils;
  assert.equal(normalizeReaderPresentation('float', 'bead'), 'bead');
  assert.equal(normalizeReaderPresentation('edge-right', 'bead'), 'hidden');
  assert.equal(normalizeReaderPresentation('fill', 'bead'), 'hidden');
  assert.equal(normalizeReaderPresentation('float', 'panel'), 'panel');
});

test('edge auto-hide never emits the floating recovery bead', () => {
  const { getPanelAutoHideAction } = loadReaderApi().readerUtils;
  const settings = {
    display: { float: { autoHide: true } },
    trigger: { autoHide: true, autoHideMode: 'collapse' },
  };
  assert.equal(getPanelAutoHideAction(settings, 'edge-left'), 'hide');
  assert.equal(getPanelAutoHideAction(settings, 'float'), 'collapse');
  assert.equal(getPanelAutoHideAction(settings, 'fill'), null);
});
```

Update the existing `edge auto-hide applies...` test so both edge `hide` and legacy edge `collapse` settings expect `hide`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="only floating mode|edge auto-hide" test/unit/reader-regressions.test.js`

Expected: FAIL because `normalizeReaderPresentation` does not exist and edge collapse still returns `collapse`.

- [ ] **Step 3: Implement explicit `hidden | panel | bead` transitions**

Add and export the pure guard:

```js
function normalizeReaderPresentation(mode, requested) {
  if (requested === 'bead' && mode !== 'float') return 'hidden';
  return requested === 'panel' || requested === 'bead' ? requested : 'hidden';
}
```

Replace `st.visible` as the source of truth with `st.presentation = 'hidden'`. Add one internal `setPresentation(requested, options)` that:

1. Normalizes against `wrap.dataset.mode`.
2. Flushes progress only when leaving `panel`.
3. Toggles `wrap.show` only for `panel`.
4. Toggles `bead.show` only for `bead`.
5. Calls `host.onPresentationChanged({ presentation, reason })` unless `options.notify === false`.

Keep compatibility methods but route all of them through the state machine:

```js
show(opts)              -> setPresentation('panel', { reason: 'show' })
hide(options)           -> setPresentation('hidden', { reason: 'hide', ...options })
showBead(position, opts)-> placeBead(...); setPresentation('bead', opts)
collapse()              -> only compute/place bead when data-mode is float
isVisible()             -> presentation === 'panel'
isCollapsed()           -> presentation === 'bead'
getPresentation()       -> presentation
```

When `applySettings()` changes mode, immediately normalize the current presentation. A float bead becoming edge or fill must become hidden before layout is applied. Change `getPanelAutoHideAction()` so any `edge-*` mode with auto-hide enabled returns `hide`; the old `collapse` preference is treated as a safe legacy value, not permission to show a float bead.

Change bead click/keyboard restore to call `host.onBeadRestoreRequested()` when provided. Only use local `show({})` as the sidebar/test-harness fallback. A drag must continue to save bead geometry without requesting restore.

- [ ] **Step 4: Run reader tests and syntax checks**

Run: `node --test test/unit/reader-regressions.test.js test/unit/reader-settings.test.js && node --check reader/reader-core.js`

Expected: all reader tests PASS and syntax check exits 0.

- [ ] **Step 5: Commit the reader-core batch**

```bash
git add reader/reader-core.js test/unit/reader-regressions.test.js
git commit -m "fix: make recovery bead float-only"
```

### Task 3: Make content scripts project authoritative mode and snapshots

**Files:**
- Modify: `manifest.json:43-55`
- Modify: `background/service-worker.js:13-19` (`CONTENT_FILES` only in this task)
- Modify: `content/content.js:8-23,95-130,132-175,197-272,306-450`
- Create: `test/unit/content-reader-ui.test.js`

- [ ] **Step 1: Write failing content-policy tests**

Test the shared projection helpers, not private DOM details:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../../lib/reader-session.js');

test('content render mode follows the current setting exactly', () => {
  assert.equal(ui.contentRenderMode({ display: { mode: 'float', edge: 'right' } }), 'float');
  assert.equal(ui.contentRenderMode({ display: { mode: 'edge', edge: 'left' } }), 'edge-left');
  assert.equal(ui.contentRenderMode({ display: { mode: 'sidebar', edge: 'right' } }), null);
});

test('snapshot projection only exposes a synchronized float bead', () => {
  assert.equal(ui.localPresentation({ mode: 'float', presentation: 'bead' }, 8), 'bead');
  assert.equal(ui.localPresentation({ mode: 'edge', presentation: 'bead' }, 8), 'hidden');
  assert.equal(ui.localPresentation({ mode: 'sidebar', presentation: 'panel', panelTabId: 8 }, 8), 'hidden');
  assert.equal(ui.localPresentation({ mode: 'float', presentation: 'panel', panelTabId: 7 }, 8), 'hidden');
  assert.equal(ui.localPresentation({ mode: 'float', presentation: 'panel', panelTabId: 8 }, 8), 'panel');
});

test('stale snapshots are ignored', () => {
  assert.equal(ui.shouldApplyRevision(4, 5), true);
  assert.equal(ui.shouldApplyRevision(5, 5), false);
  assert.equal(ui.shouldApplyRevision(6, 5), false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test test/unit/content-reader-ui.test.js`

Expected: FAIL because the projection helpers do not exist.

- [ ] **Step 3: Add projection helpers to `lib/reader-session.js`**

Implement and export:

```js
function contentRenderMode(settings) {
  const display = settings && settings.display || {};
  if (display.mode === 'sidebar') return null;
  if (display.mode === 'edge') return `edge-${display.edge || 'right'}`;
  return 'float';
}

function localPresentation(snapshot, tabId) {
  const mode = normalizeMode(snapshot && snapshot.mode);
  if (mode === 'sidebar') return 'hidden';
  if (snapshot.presentation === 'bead') return mode === 'float' ? 'bead' : 'hidden';
  if (snapshot.presentation === 'panel' && snapshot.panelTabId === tabId) return 'panel';
  return 'hidden';
}

function shouldApplyRevision(nextRevision, currentRevision) {
  return Number.isInteger(nextRevision) && nextRevision > currentRevision;
}
```

- [ ] **Step 4: Load the module in every content injection path**

Insert `lib/reader-session.js` immediately after `lib/store.js` in both:

```json
"content_scripts": [{ "js": ["lib/store.js", "lib/reader-session.js", ...] }]
```

```js
const CONTENT_FILES = [
  'lib/store.js',
  'lib/reader-session.js',
  // existing files
];
```

- [ ] **Step 5: Wire the content lifecycle**

In `content/content.js`:

1. Read settings before creating the reader, as today; derive the actual content mode with `contentRenderMode(settings)`.
2. If the mode is `sidebar`, keep the page reader hidden, disable edge hot-zone and tray opening, and do not silently render an edge panel.
3. After reader initialization, send `{type:'readerUi.ready'}` and apply its returned snapshot.
4. Track `lastUiRevision = -1`; apply only strictly newer `readerUi.sync` messages.
5. Apply snapshots with non-reporting reader calls: `reader.hide({notify:false})`, `reader.showBead(null,{notify:false})`, or `reader.show({notify:false})`.
6. Handle `readerUi.hidePanel` by hiding only a full `panel`; never clear an existing synchronized bead on tab deactivation.
7. Handle `readerUi.openPanel` by bootstrapping content if necessary and showing the panel only when current mode is float/edge.
8. Map local reader callbacks to `readerUi.event`: panel show, panel hide, float collapse, and bead restore request.
9. On `visibilitychange`, retain progress flush and additionally hide/report only when `reader.getPresentation() === 'panel'`; this is the fallback for delayed SW activation delivery.
10. In the storage listener, apply settings first, then wait for SW reconciliation; never manufacture a bead locally.

Ensure `openReader()` re-reads `store.getSettings()` before an explicit open when the cached mode is unavailable or sidebar, so newly injected pages and delayed messages cannot use an obsolete mode. It must not reset the user's persisted mode.

- [ ] **Step 6: Verify focused behavior**

Run: `node --test test/unit/content-reader-ui.test.js test/unit/reader-regressions.test.js && npm run check`

Expected: all focused tests PASS; manifest, content, reader, and worker syntax checks exit 0.

- [ ] **Step 7: Commit the content projection batch**

```bash
git add lib/reader-session.js manifest.json background/service-worker.js content/content.js test/unit/content-reader-ui.test.js
git commit -m "feat: project reader UI state into content tabs"
```

### Task 4: Add service-worker ready, persistence, and broadcast coordination

**Files:**
- Modify: `background/service-worker.js:1-87,123-144,173-268`
- Modify: `test/unit/service-worker.test.js`

- [ ] **Step 1: Extend the worker harness before production code**

Change `loadWorker(options = {})` so tests can provide initial `local` settings, initial session state, query results, and per-tab send failures. Capture listeners for `tabs.onActivated`, `tabs.onRemoved`, and `storage.onChanged`; pass `{ tab: { id }, documentId }` as the sender in `send(message, sender)`.

The message stub must set and clear `chrome.runtime.lastError` exactly around the callback:

```js
sendMessage(tabId, msg, cb) {
  calls.push(['tabs.sendMessage', tabId, msg]);
  if (failedTabs.has(tabId)) {
    chrome.runtime.lastError = { message: 'Receiving end does not exist' };
    cb();
    delete chrome.runtime.lastError;
    return;
  }
  cb({ ok: true });
}
```

- [ ] **Step 2: Write failing ready and synchronized-bead tests**

Add tests with these exact outcomes:

```js
test('ready registers the document and returns authoritative hidden state', async () => {
  const worker = loadWorker({ mode: 'edge' });
  const response = await worker.send({ type: 'readerUi.ready' }, { tab: { id: 7 }, documentId: 'doc-a' });
  assert.equal(response.data.mode, 'edge');
  assert.equal(response.data.presentation, 'hidden');
  assert.equal(worker.sessionState().tabDocuments['7'], 'doc-a');
});

test('floating collapse broadcasts a bead to every registered document', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'a');
  await worker.ready(8, 'b');
  worker.calls.length = 0;
  await worker.send({ type: 'readerUi.event', event: 'float-collapsed' }, { tab: { id: 7 }, documentId: 'a' });
  const targets = worker.sent('readerUi.sync').map((call) => call[1]).sort();
  assert.deepEqual(targets, [7, 8]);
  assert.equal(worker.sessionState().presentation, 'bead');
});

test('restoring a bead clears all beads and opens only the sender tab', async () => {
  // register tabs 7 and 8, collapse from 7, then send bead-restored from 8
  // assert sync(hidden/panel projection) reaches both and readerUi.openPanel targets only tab 8
});
```

Replace the comment-only final test body with explicit assertions on message type, tab id, snapshot revision, `presentation === 'panel'`, and `panelTabId === 8`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="ready registers|floating collapse|restoring a bead" test/unit/service-worker.test.js`

Expected: FAIL because the new listeners and message cases do not exist.

- [ ] **Step 4: Implement serialized coordinator access**

Import `../lib/reader-session.js` in the worker. Add:

```js
const READER_UI_KEY = 'vr.readerUiSession';
let readerUiQueue = Promise.resolve();

function withReaderUi(work) {
  const next = readerUiQueue.then(work, work);
  readerUiQueue = next.catch(() => {});
  return next;
}
```

Each transaction must:

1. Read current `vr.settings` through `store.getSettings()` for the authoritative mode.
2. Read `READER_UI_KEY` from `storage.session`.
3. Call `normalizeState(saved, settings.display.mode)`.
4. Apply one reducer event.
5. Persist the complete new state before sending effects.

Never hold correctness only in worker globals; MV3 may suspend the worker between events.

- [ ] **Step 5: Implement ready and event routing**

Add `readerUi.ready` and `readerUi.event` cases to `handle()`:

- Reject missing `sender.tab.id` or `sender.documentId` with a clear error.
- `ready`: reduce `{type:'ready', tabId, documentId}` and return the complete public snapshot.
- Ignore events from a document id that no longer matches `tabDocuments[tabId]`.
- `float-collapsed`: reduce and broadcast one revisioned sync to every registered tab.
- `bead-restored`: reduce, broadcast the new snapshot, then send `readerUi.openPanel` only to the sender.
- `panel-opened` and `panel-hidden`: update owner/presentation and persist; broadcast only when needed to clear an existing bead.

Create `sendRegistered(state, message)` using `tabsSend`, not `sendOrInject`: synchronization must target already-injected pages and must not inject the extension into unrelated existing tabs. Use `Promise.allSettled`, reduce `message-failed` for rejected recipients, and persist the pruned state once.

- [ ] **Step 6: Verify worker coordination tests**

Run: `node --test test/unit/service-worker.test.js`

Expected: all existing online-book tests and new reader UI tests PASS.

- [ ] **Step 7: Commit the core worker coordination**

```bash
git add background/service-worker.js test/unit/service-worker.test.js
git commit -m "feat: coordinate reader UI across tabs"
```

### Task 5: Cover activation, navigation, worker restart, mode changes, and failures

**Files:**
- Modify: `background/service-worker.js:123-144` and listener registration area
- Modify: `test/unit/service-worker.test.js`

- [ ] **Step 1: Write failing lifecycle tests**

Add separate tests for each boundary:

```js
test('activating another tab hides the old full panel but preserves a global bead', async () => {
  // panel owned by 7 -> activate 8 -> readerUi.hidePanel sent to 7 and state hidden
  // bead state -> activate 8 -> no hide-bead broadcast and state remains bead
});

test('navigation replaces a registered document and never reopens its old panel', async () => {
  // ready(7, old), panel-opened(7), ready(7, new)
  // state hidden; ready response hidden; tabDocuments[7] === new
});

test('worker restart restores session coordination and reconciles local mode', async () => {
  // seed session with float bead revision 9
  // restart with mode float -> ready returns bead
  // restart with mode edge -> ready returns hidden at a newer revision
});

test('settings mode change clears incompatible UI in every registered tab', async () => {
  // seed float bead, emit storage.onChanged display.mode=edge
  // assert session hidden/mode edge and both tabs receive newer sync
});

test('failed broadcast recipients are pruned without blocking healthy tabs', async () => {
  // tabs 7,8 registered; fail 7; collapse from 8
  // 8 receives sync; tabDocuments no longer contains 7
});
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `node --test --test-name-pattern="activating another|navigation replaces|worker restart|settings mode change|failed broadcast" test/unit/service-worker.test.js`

Expected: FAIL because activation and storage listeners are absent and failed recipients are not pruned.

- [ ] **Step 3: Implement activation and removal**

Register `chrome.tabs.onActivated`. In a serialized transaction, reduce `{type:'tab-activated', tabId}`. If the previous state was `panel` owned by another tab, persist first and send `readerUi.hidePanel` to the previous owner. Do not alter `bead` on activation.

Extend the existing `tabs.onRemoved` listener to reduce `{type:'tab-removed', tabId}` in addition to deleting pending online-book state. Do both cleanups even if one rejects.

- [ ] **Step 4: Implement storage-mode reconciliation**

Register `chrome.storage.onChanged`. On a local `vr.settings` change:

1. Extract normalized `display.mode` from the new settings.
2. Reconcile session state to that mode.
3. Clear `panel` and `bead` whenever the mode changes.
4. Persist before broadcasting.
5. Send the revisioned hidden snapshot to all registered tabs.

This listener is the only cross-tab mode-change coordinator; popup and options continue writing settings through the existing store API.

- [ ] **Step 5: Make restart and navigation deterministic**

On every coordinator transaction, normalize persisted session state against current settings before applying the event. A new `documentId` for an already-known tab is navigation and clears a stale owned panel. A same-document `ready` after a delayed response is idempotent and must not increment revision.

- [ ] **Step 6: Run lifecycle and full worker tests**

Run: `node --test test/unit/service-worker.test.js test/unit/reader-session.test.js`

Expected: all tests PASS, including both pre-existing online-book launch tests.

- [ ] **Step 7: Commit the lifecycle batch**

```bash
git add background/service-worker.js test/unit/service-worker.test.js
git commit -m "fix: reconcile reader UI across tab lifecycle"
```

### Task 6: Render sidebar truthfully in the popup

**Files:**
- Create: `popup/popup-mode.js`
- Create: `test/unit/popup-mode.test.js`
- Modify: `popup/popup.html`
- Modify: `popup/popup.js:47-67`
- Modify: `package.json`

- [ ] **Step 1: Write a failing pure view-model test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPopupModeView } = require('../../popup/popup-mode.js');

test('popup never presents sidebar as edge mode', () => {
  assert.deepEqual(getPopupModeView('float'), {
    floatPressed: true, edgePressed: false,
    tip: '自由悬浮窗可拖动、缩放，移出后可收起为恢复圆点。',
  });
  assert.equal(getPopupModeView('edge').edgePressed, true);
  const sidebar = getPopupModeView('sidebar');
  assert.equal(sidebar.floatPressed, false);
  assert.equal(sidebar.edgePressed, false);
  assert.match(sidebar.tip, /原生侧边栏/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/unit/popup-mode.test.js`

Expected: FAIL because `popup/popup-mode.js` does not exist.

- [ ] **Step 3: Implement and load the helper**

Create a browser/CommonJS helper that returns the exact structure above. Load it before `popup.js` in `popup/popup.html`. Rewrite `renderDisplayMode()` to use this view model, so sidebar selects neither page-overlay button and displays a truthful explanation. Keep the explicit “打开侧边栏” action unchanged.

Add `node --check popup/popup-mode.js` to `npm run check`.

- [ ] **Step 4: Verify popup behavior**

Run: `node --test test/unit/popup-mode.test.js && npm run check`

Expected: popup test PASS and syntax checks exit 0.

Open `test/popup-harness.html` through `node tools/serve.js`; with its storage stub set to `sidebar`, verify neither float nor edge has `active`/`aria-pressed=true`, and the native-side-panel tip is visible.

- [ ] **Step 5: Commit the popup batch**

```bash
git add popup/popup-mode.js popup/popup.html popup/popup.js test/unit/popup-mode.test.js package.json
git commit -m "fix: show sidebar mode truthfully in popup"
```

### Task 7: Update user, reviewer, and release documentation with an executable contract

**Files:**
- Create: `test/unit/reader-ui-docs.test.js`
- Modify: `README.md:47-67,79-119,126-146`
- Modify: `docs/manual-acceptance.md:27-31,49-72`
- Modify: `docs/releasing.md:26-35`
- Modify: `store/review/chrome-notes-zh-CN.md`
- Modify: `store/review/chrome-notes-en.md`
- Modify: `store/review/edge-notes-zh-CN.md`
- Modify: `store/review/edge-notes-en.md`

- [ ] **Step 1: Write a failing documentation contract test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('reader UI synchronization is documented for users and reviewers', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  const manual = fs.readFileSync('docs/manual-acceptance.md', 'utf8');
  const release = fs.readFileSync('docs/releasing.md', 'utf8');
  assert.match(readme, /所有已注入.*恢复圆点/);
  assert.match(readme, /切换标签页.*完整阅读窗/);
  assert.match(readme, /storage\.session/);
  assert.match(manual, /A、B、C/);
  assert.match(manual, /service worker.*重启/i);
  assert.match(release, /跨标签页.*恢复圆点/);
  for (const path of [
    'store/review/chrome-notes-zh-CN.md', 'store/review/edge-notes-zh-CN.md',
  ]) assert.match(fs.readFileSync(path, 'utf8'), /切换标签页/);
  for (const path of [
    'store/review/chrome-notes-en.md', 'store/review/edge-notes-en.md',
  ]) assert.match(fs.readFileSync(path, 'utf8'), /switch tabs/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/unit/reader-ui-docs.test.js`

Expected: FAIL because current docs say edge can collapse to a small icon and do not describe cross-tab synchronization.

- [ ] **Step 3: Correct the user-facing behavior contract**

Update `README.md` to state:

- Only a free-floating reader can minimize to the recovery bead.
- A minimized floating bead appears on every already-injected HTTP/HTTPS page.
- Restoring from one page removes the bead elsewhere and opens one full reader in that tab.
- Switching tabs hides the old tab's full reader by default; it does not auto-open a full reader in the destination tab.
- Edge mode auto-hide becomes fully hidden and never changes into the float bead.
- Sidebar mode uses only the browser-native side panel and creates no page overlay.
- `chrome.storage.session` stores only ephemeral coordination metadata (`mode`, presentation, tab/document ids, revision); books, text, and reading content are not copied there.

Remove the old README claim that edge `autoHideMode: collapse` creates a small icon. Describe it as a legacy stored value normalized to full hide for edge mode.

- [ ] **Step 4: Add precise manual and reviewer acceptance paths**

In `docs/manual-acceptance.md`, add the complete Chrome and Edge matrix:

1. Open injected pages A, B, and C.
2. In float mode, collapse in A; verify the bead on A/B/C.
3. Restore from B; verify beads disappear everywhere and only B has a full panel.
4. Switch B -> C; verify B's full panel hides and C does not auto-open.
5. Select edge; verify all beads clear, edge trigger opens an edge panel, and leaving fully hides it.
6. Select sidebar; verify page edge/tray cannot create a page overlay and the native side-panel button still works.
7. Navigate the owner tab; verify the new document starts hidden but follows current mode.
8. Reload the extension/service worker while a float bead is synchronized; verify registered pages recover from session state without opening a full panel.
9. Close one registered tab and include one unsupported/internal page; verify healthy pages still synchronize.

Add concise versions to all four store reviewer notes. Add these cases to `docs/releasing.md` as mandatory pre-upload regression coverage.

- [ ] **Step 5: Verify documentation**

Run: `node --test test/unit/reader-ui-docs.test.js test/unit/release-audit.test.js`

Expected: both documentation and release-audit tests PASS.

- [ ] **Step 6: Commit the documentation batch**

```bash
git add README.md docs/manual-acceptance.md docs/releasing.md store/review test/unit/reader-ui-docs.test.js
git commit -m "docs: explain synchronized reader UI"
```

### Task 8: Run full automated and browser release verification

**Files:**
- Verify only; fix failures in the task that owns the affected file.

- [ ] **Step 1: Run all unit tests**

Run: `npm test`

Expected: exit 0; no failed, skipped, cancelled, or todo tests.

- [ ] **Step 2: Run syntax checks**

Run: `npm run check`

Expected: exit 0 and explicit checks for `lib/reader-session.js` and `popup/popup-mode.js`.

- [ ] **Step 3: Run the repository release audit**

Run: `npm run release:check`

Expected: exit 0 and final line `Release check passed.`

- [ ] **Step 4: Build and verify the deterministic package**

Run: `npm run package`

Expected: exit 0, a reported file count and SHA-256, and `dist/VeilRead-v1.0.0.zip` containing `lib/reader-session.js` and `popup/popup-mode.js`.

List and validate the package with the project ZIP reader:

```powershell
node -e "const fs=require('fs'); const z=require('./tools/release/zip.js'); const b=fs.readFileSync('dist/VeilRead-v1.0.0.zip'); const e=z.listZipEntries(b); console.log(e.length); console.log(e.map(x=>x.name).filter(n=>n==='lib/reader-session.js'||n==='popup/popup-mode.js'))"
```

Expected: both runtime files are printed; parsing performs CRC and local/central metadata validation without throwing.

- [ ] **Step 5: Check repository whitespace and scope**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the intended reader UI implementation, tests, and documentation are changed. `.claude/` remains untracked and unstaged if present.

- [ ] **Step 6: Execute browser manual acceptance**

Load the same unpacked extension in Chrome and Edge. Execute every new A/B/C, tab-switch, edge, sidebar, navigation, worker-restart, tab-close, and unsupported-page step from `docs/manual-acceptance.md`. Record browser versions and pass/fail evidence in the release checklist; do not weaken an automated assertion to accommodate a manual failure.

- [ ] **Step 7: Request code review before integration**

Review the complete range for these invariants:

```text
local storage mode is authoritative
session state is ephemeral and restart-safe
only float can produce bead
only one tab can own a full panel
activation/navigation hides stale full panels
broadcast failures cannot block healthy tabs
sidebar never becomes an edge overlay
```

Run: `git diff --cached --check` immediately before the final implementation commit or merge.

Expected: no whitespace errors and reviewer verdict ready to integrate.

## Plan self-review

- Spec coverage: authoritative mode/new-page loading is covered in Tasks 1 and 3; explicit presentation and float-only bead in Task 2; session reducer and SW ready/broadcast/activation in Tasks 1, 4, and 5; navigation/restart/failure in Task 5; popup sidebar truth in Task 6; user/release docs and browser acceptance in Tasks 7 and 8.
- Dependency direction: `lib/reader-session.js` remains pure and Chrome-free; reader core remains Chrome-free; effects stay in content and service worker.
- Race policy: every snapshot is revisioned, storage is written before effects, stale document ids and stale revisions are rejected, and failed recipients are pruned.
- Scope policy: no third-party dependencies, no durable per-tab visibility in local storage, no auto-injection during synchronization, and no changes to book/progress persistence.
