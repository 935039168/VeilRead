const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('../../lib/reader-session.js');

test('authoritative mode normalization removes incompatible presentation', () => {
  const bead = { mode: 'float', presentation: 'bead', panelTabId: null, tabDocuments: {}, revision: 4 };
  assert.deepEqual(session.reconcileMode(bead, 'edge'), {
    mode: 'edge', presentation: 'hidden', panelTabId: null, tabDocuments: {}, revision: 5,
  });
  const panel = { mode: 'float', presentation: 'panel', panelTabId: 7, tabDocuments: { 7: 'doc' }, revision: 8 };
  assert.deepEqual(session.reconcileMode(panel, 'edge'), {
    mode: 'edge', presentation: 'hidden', panelTabId: null, tabDocuments: { 7: 'doc' }, revision: 9,
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

test('bead restore opens one floating panel while sidebar rejects page panels', () => {
  const bead = session.reduce(session.createState('float'), { type: 'float-collapsed', tabId: 7 });
  const restored = session.reduce(bead, { type: 'bead-restored', tabId: 8 });
  assert.equal(restored.presentation, 'panel');
  assert.equal(restored.panelTabId, 8);

  const sidebar = session.reduce(session.createState('sidebar'), { type: 'panel-opened', tabId: 8 });
  assert.equal(sidebar.presentation, 'hidden');
  assert.equal(sidebar.panelTabId, null);
});

test('idempotent events keep the same revision and never mutate their input', () => {
  const initial = session.createState('float');
  const ready = session.reduce(initial, { type: 'ready', tabId: 7, documentId: 'doc' });
  const repeated = session.reduce(ready, { type: 'ready', tabId: 7, documentId: 'doc' });

  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.tabDocuments, {});
  assert.equal(ready.revision, 1);
  assert.equal(repeated.revision, ready.revision);
});

test('normalization repairs malformed persisted state without sharing nested objects', () => {
  const documents = { 7: 'doc' };
  const normalized = session.normalizeState({
    mode: 'float', presentation: 'panel', panelTabId: '7', tabDocuments: documents, revision: -1,
  }, 'float');

  assert.deepEqual(normalized, {
    mode: 'float', presentation: 'hidden', panelTabId: null, tabDocuments: { 7: 'doc' }, revision: 0,
  });
  documents[8] = 'later';
  assert.equal(normalized.tabDocuments[8], undefined);
});
