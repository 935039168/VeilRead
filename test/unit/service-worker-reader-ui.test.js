const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const online = require('../../lib/online.js');
const readerSession = require('../../lib/reader-session.js');

const UI_KEY = 'vr.readerUiSession';

function loadWorker({
  mode = 'float',
  local: seededLocal,
  session: seededSession = {},
  queryResults = [],
  failedTabs: seededFailures = [],
  errorResponses: seededErrorResponses = [],
} = {}) {
  const calls = [];
  const session = seededSession;
  const local = seededLocal || { 'vr.settings': { display: { mode } } };
  const failedTabs = new Set(seededFailures);
  const errorResponses = new Set(seededErrorResponses);
  let messageListener = null;
  let updatedListener = null;
  let activatedListener = null;
  let removedListener = null;
  let storageChangedListener = null;
  const chrome = {
    storage: {
      session: {
        async get(key) { calls.push(['session.get', key]); return { [key]: session[key] }; },
        async set(values) { calls.push(['session.set', structuredClone(values)]); Object.assign(session, structuredClone(values)); },
        async remove(key) { calls.push(['session.remove', key]); delete session[key]; },
      },
      local: {
        async get(key) { calls.push(['local.get', key]); return { [key]: local[key] }; },
        async set(values) { calls.push(['local.set', structuredClone(values)]); Object.assign(local, structuredClone(values)); },
        async remove(key) { calls.push(['local.remove', key]); delete local[key]; },
      },
      onChanged: { addListener(listener) { storageChangedListener = listener; } },
    },
    tabs: {
      query: async (query) => {
        calls.push(['tabs.query', structuredClone(query)]);
        return structuredClone(queryResults);
      },
      create: async (options) => ({ id: 42, ...options }),
      update: async (id, options) => ({ id, ...options }),
      sendMessage(tabId, message, callback) {
        calls.push(['tabs.sendMessage', tabId, structuredClone(message)]);
        if (failedTabs.has(tabId)) {
          chrome.runtime.lastError = { message: 'Receiving end does not exist' };
          callback();
          delete chrome.runtime.lastError;
          return;
        }
        if (errorResponses.has(`${tabId}:${message.type}`)) {
          callback({ ok: false, error: 'Content handler failed' });
          return;
        }
        callback({ ok: true });
      },
      onUpdated: { addListener(listener) { updatedListener = listener; } },
      onRemoved: { addListener(listener) { removedListener = listener; } },
      onActivated: { addListener(listener) { activatedListener = listener; } },
    },
    runtime: {
      lastError: null,
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } },
    },
    scripting: { async executeScript(options) { calls.push(['scripting.executeScript', options]); } },
    contextMenus: { removeAll() {}, create() {}, onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
  };
  const store = {
    async getSettings() { return local['vr.settings'] || { display: { mode } }; },
    _local: {},
  };
  const context = { chrome, console, URL, setTimeout, clearTimeout, Promise, Object, String, RegExp };
  context.globalThis = context;
  context.importScripts = () => {
    context.VeilRead = { db: {}, store, online, readerSession };
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('background/service-worker.js', 'utf8'), context);

  async function send(message, sender = {}) {
    return new Promise((resolve) => messageListener(message, sender, resolve));
  }

  return {
    calls, local, session, failedTabs, errorResponses,
    send,
    ready(tabId, documentId, documentLifecycle) {
      return send(
        { type: 'readerUi.ready' },
        { tab: { id: tabId }, documentId, documentLifecycle },
      );
    },
    state() { return structuredClone(session[UI_KEY]); },
    sent(type) {
      return calls.filter(([name, , message]) => name === 'tabs.sendMessage' && (!type || message.type === type));
    },
    updated(tabId, changeInfo, tab) { updatedListener(tabId, changeInfo, tab); },
    activated(activeInfo) { return activatedListener(activeInfo); },
    removed(tabId, removeInfo = {}) { return removedListener(tabId, removeInfo); },
    storageChanged(changes, areaName = 'local') { return storageChangedListener(changes, areaName); },
  };
}

test('ready persists document registration and returns an authoritative snapshot', async () => {
  const worker = loadWorker({ mode: 'edge' });
  const response = await worker.ready(7, 'doc-a');

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), {
    mode: 'edge', presentation: 'hidden', panelTabId: null, revision: 1,
  });
  assert.equal(worker.state().tabDocuments['7'], 'doc-a');
  assert.ok(worker.calls.some(([name]) => name === 'session.set'));
});

test('floating collapse broadcasts a bead to every registered page without injecting tabs', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  worker.calls.length = 0;

  const response = await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );

  assert.equal(response.data.presentation, 'bead');
  assert.deepEqual(worker.sent('readerUi.sync').map((call) => call[1]).sort(), [7, 8]);
  assert.ok(worker.sent('readerUi.sync').every((call) => call[2].snapshot.presentation === 'bead'));
  assert.equal(worker.calls.some(([name]) => name === 'scripting.executeScript'), false);
});

test('restoring any bead clears every bead before opening only the sender', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.calls.length = 0;

  const response = await worker.send(
    { type: 'readerUi.event', event: 'bead-restored' },
    { tab: { id: 8 }, documentId: 'doc-b' },
  );
  const messages = worker.sent().map(([, tabId, message]) => [tabId, message.type, message.snapshot && message.snapshot.presentation]);

  assert.deepEqual(messages, [
    [7, 'readerUi.sync', 'panel'],
    [8, 'readerUi.sync', 'panel'],
    [8, 'readerUi.openPanel', undefined],
  ]);
  assert.equal(response.data.presentation, 'panel');
  assert.equal(response.data.panelTabId, 8);
  assert.ok(worker.sent('readerUi.sync').every((call) => call[2].snapshot.revision === response.data.revision));
  assert.equal(worker.sent('readerUi.openPanel')[0][2].revision, response.data.revision);
});

test('opening a local panel clears remote beads without syncing the sender back to hidden', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.calls.length = 0;

  const response = await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 8 }, documentId: 'doc-b' },
  );

  assert.equal(response.data.presentation, 'panel');
  assert.equal(response.data.panelTabId, 8);
  assert.deepEqual(worker.sent('readerUi.sync').map((call) => call[1]), [7]);
});

test('opening a panel directly hides the previous owner even without tab activation', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.calls.length = 0;

  const response = await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 8 }, documentId: 'doc-b' },
  );

  assert.equal(response.data.panelTabId, 8);
  assert.deepEqual(worker.sent('readerUi.hidePanel').map((call) => call[1]), [7]);
  assert.equal(worker.sent('readerUi.hidePanel')[0][2].revision, response.data.revision);
});

test('panel takeover recovery never synchronizes the new owner back to hidden', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  await worker.ready(9, 'doc-c');
  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.errorResponses.add('7:readerUi.hidePanel');
  worker.calls.length = 0;

  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 8 }, documentId: 'doc-b' },
  );

  assert.equal(worker.state().panelTabId, 8);
  assert.equal(worker.sent('readerUi.sync').some((call) => call[1] === 8), false);
  assert.equal(worker.sent('readerUi.sync').some((call) => call[1] === 9), true);
});

test('same-document ready reconciles an authoritative mode change and persists its revision', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'edge', presentation: 'hidden', panelTabId: null,
      tabDocuments: { 7: 'doc-a' }, revision: 4,
    },
  };
  const worker = loadWorker({ mode: 'float', session });

  const response = await worker.ready(7, 'doc-a');

  assert.equal(response.data.mode, 'float');
  assert.equal(response.data.revision, 5);
  assert.equal(worker.state().revision, 5);
});

test('ready broadcasts a consumed mode reconciliation to existing pages', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'float', presentation: 'panel', panelTabId: 7,
      tabDocuments: { 7: 'doc-a' }, revision: 4,
    },
  };
  const worker = loadWorker({ mode: 'edge', session });

  const response = await worker.ready(8, 'doc-b');

  assert.equal(response.data.mode, 'edge');
  assert.equal(response.data.presentation, 'hidden');
  assert.ok(worker.sent('readerUi.sync').some((call) =>
    call[1] === 7 && call[2].snapshot.mode === 'edge' && call[2].snapshot.presentation === 'hidden'));
});

test('event broadcasts mode reconciliation before it can strand an old panel', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'float', presentation: 'panel', panelTabId: 7,
      tabDocuments: { 7: 'doc-a', 8: 'doc-b' }, revision: 4,
    },
  };
  const worker = loadWorker({ mode: 'edge', session });

  const response = await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 8 }, documentId: 'doc-b' },
  );

  assert.equal(response.data.mode, 'edge');
  assert.equal(response.data.panelTabId, 8);
  assert.ok(worker.sent('readerUi.sync').some((call) =>
    call[1] === 7 && call[2].snapshot.mode === 'edge'));
});

test('ready can advance once for mode reconciliation and once for a new registration', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'edge', presentation: 'hidden', panelTabId: null,
      tabDocuments: {}, revision: 4,
    },
  };
  const worker = loadWorker({ mode: 'float', session });

  const response = await worker.ready(7, 'doc-a');

  assert.equal(response.data.mode, 'float');
  assert.equal(response.data.revision, 6);
  assert.equal(worker.state().revision, 6);
});

test('event can advance once for mode reconciliation and once for its own state change', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'edge', presentation: 'hidden', panelTabId: null,
      tabDocuments: { 7: 'doc-a' }, revision: 8,
    },
  };
  const worker = loadWorker({ mode: 'float', session });

  const response = await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );

  assert.equal(response.data.mode, 'float');
  assert.equal(response.data.presentation, 'bead');
  assert.equal(response.data.revision, 10);
  assert.equal(worker.state().revision, 10);
  assert.equal(worker.sent('readerUi.sync')[0][2].snapshot.revision, response.data.revision);
});

test('a delayed ready from an inactive old document cannot replace the active document', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-new', 'active');

  const response = await worker.ready(7, 'doc-old', 'pending_deletion');

  assert.equal(worker.state().tabDocuments['7'], 'doc-new');
  assert.equal(response.data.revision, 1);
});

test('broadcast failures prune dead registrations without blocking healthy pages', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  worker.failedTabs.add(7);
  worker.calls.length = 0;

  const response = await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 8 }, documentId: 'doc-b' },
  );

  assert.equal(worker.sent('readerUi.sync').some((call) => call[1] === 8), true);
  assert.equal(worker.state().tabDocuments['7'], undefined);
  assert.equal(worker.state().tabDocuments['8'], 'doc-b');
  assert.equal(response.data.revision, worker.state().revision);
  const healthySnapshots = worker.sent('readerUi.sync')
    .filter((call) => call[1] === 8)
    .map((call) => call[2].snapshot);
  assert.equal(healthySnapshots.length, 2);
  assert.deepEqual(healthySnapshots[1], JSON.parse(JSON.stringify(response.data)));
});

test('a normal error response prunes the failed broadcast recipient', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  worker.errorResponses.add('7:readerUi.sync');

  const response = await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 8 }, documentId: 'doc-b' },
  );

  assert.equal(worker.state().tabDocuments['7'], undefined);
  assert.equal(worker.state().tabDocuments['8'], 'doc-b');
  assert.equal(response.data.revision, worker.state().revision);
});

test('a failed openPanel response rolls back panel ownership and keeps the live sender registered', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.errorResponses.add('7:readerUi.openPanel');

  const response = await worker.send(
    { type: 'readerUi.event', event: 'bead-restored' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );

  assert.equal(response.data.presentation, 'hidden');
  assert.equal(response.data.panelTabId, null);
  assert.equal(worker.state().presentation, 'hidden');
  assert.equal(worker.state().panelTabId, null);
  assert.equal(worker.state().tabDocuments['7'], 'doc-a');
  const snapshots = worker.sent('readerUi.sync').map((call) => call[2].snapshot);
  assert.equal(snapshots.at(-1).presentation, 'hidden');
  assert.equal(snapshots.at(-1).revision, response.data.revision);
});

test('application errors from existing content scripts do not trigger reinjection', async () => {
  const worker = loadWorker({
    queryResults: [{ id: 7, url: 'https://example.test/article' }],
    errorResponses: ['7:extractPage'],
  });

  const response = await worker.send({ type: 'sidebar.extract' });

  assert.equal(response.ok, false);
  assert.match(response.error, /Content handler failed/);
  assert.equal(worker.calls.some(([name]) => name === 'scripting.executeScript'), false);
});

test('activating another tab hides the old full panel but preserves a global bead', async () => {
  const panelWorker = loadWorker({ mode: 'float' });
  await panelWorker.ready(7, 'doc-a');
  await panelWorker.ready(8, 'doc-b');
  await panelWorker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  panelWorker.calls.length = 0;

  await panelWorker.activated({ tabId: 8 });

  assert.equal(panelWorker.state().presentation, 'hidden');
  assert.equal(panelWorker.state().panelTabId, null);
  assert.deepEqual(panelWorker.sent('readerUi.hidePanel').map((call) => call[1]), [7]);

  const beadWorker = loadWorker({ mode: 'float' });
  await beadWorker.ready(7, 'doc-a');
  await beadWorker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  beadWorker.calls.length = 0;

  await beadWorker.activated({ tabId: 8 });

  assert.equal(beadWorker.state().presentation, 'bead');
  assert.equal(beadWorker.sent('readerUi.hidePanel').length, 0);
});

test('activation persists and broadcasts mode reconciliation after worker restart', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'float', presentation: 'bead', panelTabId: null,
      tabDocuments: { 7: 'doc-a' }, revision: 4,
    },
  };
  const worker = loadWorker({ mode: 'edge', session });

  await worker.activated({ tabId: 8 });

  assert.equal(worker.state().mode, 'edge');
  assert.equal(worker.state().presentation, 'hidden');
  assert.equal(worker.state().revision, 5);
  assert.equal(worker.sent('readerUi.sync').at(-1)[2].snapshot.revision, 5);
});

test('hidePanel application failure keeps a live document registered and syncs hidden state', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.errorResponses.add('7:readerUi.hidePanel');
  worker.calls.length = 0;

  await worker.activated({ tabId: 8 });

  assert.equal(worker.state().tabDocuments['7'], 'doc-a');
  assert.equal(worker.state().presentation, 'hidden');
  assert.ok(worker.sent('readerUi.sync').some((call) => call[1] === 7 && call[2].snapshot.presentation === 'hidden'));
});

test('hidePanel transport failure prunes only the dead owner and updates healthy pages', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.failedTabs.add(7);
  worker.calls.length = 0;

  await worker.activated({ tabId: 8 });

  assert.equal(worker.state().tabDocuments['7'], undefined);
  assert.equal(worker.state().tabDocuments['8'], 'doc-b');
  assert.ok(worker.sent('readerUi.sync').some((call) => call[1] === 8 && call[2].snapshot.revision === worker.state().revision));
});

test('navigation replaces a registered document and never reopens its old panel', async () => {
  const worker = loadWorker({ mode: 'edge' });
  await worker.ready(7, 'doc-old');
  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-old' },
  );

  const response = await worker.ready(7, 'doc-new', 'active');

  assert.equal(response.data.presentation, 'hidden');
  assert.equal(response.data.panelTabId, null);
  assert.equal(worker.state().tabDocuments['7'], 'doc-new');
});

test('settings mode changes clear incompatible UI and synchronize registered pages', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.ready(8, 'doc-b');
  await worker.send(
    { type: 'readerUi.event', event: 'float-collapsed' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.calls.length = 0;
  worker.local['vr.settings'] = { display: { mode: 'edge' } };

  await worker.storageChanged({
    'vr.settings': { newValue: worker.local['vr.settings'] },
  });

  assert.equal(worker.state().mode, 'edge');
  assert.equal(worker.state().presentation, 'hidden');
  assert.deepEqual(worker.sent('readerUi.sync').map((call) => call[1]).sort(), [7, 8]);
  assert.ok(worker.sent('readerUi.sync').every((call) => call[2].snapshot.mode === 'edge'));
});

test('settings mode changes hide a full panel instead of carrying it into the new mode', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );
  worker.local['vr.settings'] = { display: { mode: 'edge' } };

  await worker.storageChanged({
    'vr.settings': { newValue: worker.local['vr.settings'] },
  });

  assert.equal(worker.state().mode, 'edge');
  assert.equal(worker.state().presentation, 'hidden');
  assert.equal(worker.state().panelTabId, null);
});

test('deleting settings reconciles the session to the default floating mode', async () => {
  const local = { 'vr.settings': { display: { mode: 'edge' } } };
  const worker = loadWorker({ mode: 'float', local });
  await worker.ready(7, 'doc-a');
  delete worker.local['vr.settings'];

  await worker.storageChanged({
    'vr.settings': { oldValue: { display: { mode: 'edge' } }, newValue: undefined },
  });

  assert.equal(worker.state().mode, 'float');
  assert.equal(worker.sent('readerUi.sync').at(-1)[2].snapshot.mode, 'float');
});

test('removed tabs leave no registration or stale panel ownership', async () => {
  const worker = loadWorker({ mode: 'float' });
  await worker.ready(7, 'doc-a');
  await worker.send(
    { type: 'readerUi.event', event: 'panel-opened' },
    { tab: { id: 7 }, documentId: 'doc-a' },
  );

  await worker.removed(7);

  assert.equal(worker.state().tabDocuments['7'], undefined);
  assert.equal(worker.state().presentation, 'hidden');
  assert.equal(worker.state().panelTabId, null);
});

test('first removal after worker restart persists mode reconciliation even for an unknown tab', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'float', presentation: 'bead', panelTabId: null,
      tabDocuments: { 7: 'doc-a' }, revision: 4,
    },
  };
  const worker = loadWorker({ mode: 'edge', session });

  await worker.removed(99);

  assert.equal(worker.state().mode, 'edge');
  assert.equal(worker.state().presentation, 'hidden');
  assert.equal(worker.state().revision, 5);
  assert.equal(worker.sent('readerUi.sync').at(-1)[2].snapshot.revision, 5);
});

test('worker restart restores the persisted session bead', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'float', presentation: 'bead', panelTabId: null,
      tabDocuments: { 7: 'doc-a' }, revision: 4,
    },
  };
  const restarted = loadWorker({ mode: 'float', session });
  const response = await restarted.ready(7, 'doc-a');

  assert.equal(response.data.presentation, 'bead');
  assert.equal(response.data.revision, 4);
  assert.equal(restarted.state().tabDocuments['7'], 'doc-a');
});

test('worker restart reconciles a persisted floating bead to the authoritative edge mode', async () => {
  const session = {
    [UI_KEY]: {
      mode: 'float', presentation: 'bead', panelTabId: null,
      tabDocuments: { 7: 'doc-a' }, revision: 4,
    },
  };
  const restarted = loadWorker({ mode: 'edge', session });

  const response = await restarted.ready(7, 'doc-a');

  assert.equal(response.data.mode, 'edge');
  assert.equal(response.data.presentation, 'hidden');
  assert.equal(response.data.revision, 5);
  assert.equal(restarted.state().revision, 5);
});

test('concurrent ready messages serialize without losing registrations or revisions', async () => {
  const worker = loadWorker({ mode: 'float' });
  const responses = await Promise.all([
    worker.ready(7, 'doc-a'),
    worker.ready(8, 'doc-b'),
  ]);

  assert.deepEqual(responses.map((response) => response.data.revision), [1, 2]);
  assert.deepEqual(worker.state().tabDocuments, { 7: 'doc-a', 8: 'doc-b' });
  assert.equal(worker.state().revision, 2);
});
