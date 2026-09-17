// VeilRead — 跨标签页阅读器 UI 会话状态（纯函数，无 chrome.* 依赖）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VeilRead = root.VeilRead || {};
  root.VeilRead.readerSession = api;
})(globalThis, function () {
  'use strict';

  const PRESENTATIONS = new Set(['hidden', 'panel', 'bead']);

  function normalizeMode(mode) {
    return mode === 'edge' || mode === 'sidebar' ? mode : 'float';
  }

  function createState(mode) {
    return {
      mode: normalizeMode(mode),
      presentation: 'hidden',
      panelTabId: null,
      tabDocuments: {},
      revision: 0,
    };
  }

  function normalizeState(raw, authoritativeMode) {
    const base = createState(authoritativeMode);
    const input = raw && typeof raw === 'object' ? raw : {};
    const mode = normalizeMode(authoritativeMode);
    const requested = PRESENTATIONS.has(input.presentation) ? input.presentation : 'hidden';
    const validPanel = requested === 'panel' && Number.isInteger(input.panelTabId);
    const compatible = mode !== 'sidebar' && (requested !== 'bead' || mode === 'float');
    const presentation = compatible && (requested !== 'panel' || validPanel) ? requested : 'hidden';
    return {
      mode,
      presentation,
      panelTabId: presentation === 'panel' ? input.panelTabId : null,
      tabDocuments: input.tabDocuments && typeof input.tabDocuments === 'object' && !Array.isArray(input.tabDocuments)
        ? { ...input.tabDocuments }
        : {},
      revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : base.revision,
    };
  }

  function sameDocuments(left, right) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
  }

  function finish(current, next) {
    const changed = current.mode !== next.mode ||
      current.presentation !== next.presentation ||
      current.panelTabId !== next.panelTabId ||
      !sameDocuments(current.tabDocuments, next.tabDocuments);
    return { ...next, revision: changed ? current.revision + 1 : current.revision };
  }

  function reconcileMode(state, mode) {
    const current = normalizeState(state, state && state.mode);
    const nextMode = normalizeMode(mode);
    const presentation = nextMode === 'sidebar' || (current.presentation === 'bead' && nextMode !== 'float')
      ? 'hidden'
      : current.presentation;
    return finish(current, {
      ...current,
      mode: nextMode,
      presentation,
      panelTabId: presentation === 'panel' ? current.panelTabId : null,
      tabDocuments: { ...current.tabDocuments },
    });
  }

  function reduce(state, event) {
    const current = normalizeState(state, state && state.mode);
    const input = event && typeof event === 'object' ? event : {};
    const tabId = input.tabId;
    if (!Number.isInteger(tabId)) return current;

    const next = { ...current, tabDocuments: { ...current.tabDocuments } };
    const key = String(tabId);

    switch (input.type) {
      case 'ready': {
        if (typeof input.documentId !== 'string' || !input.documentId) return current;
        const previousDocument = current.tabDocuments[key];
        next.tabDocuments[key] = input.documentId;
        if (previousDocument && previousDocument !== input.documentId &&
            current.presentation === 'panel' && current.panelTabId === tabId) {
          next.presentation = 'hidden';
          next.panelTabId = null;
        }
        break;
      }
      case 'panel-opened':
        if (current.mode === 'sidebar') return current;
        next.presentation = 'panel';
        next.panelTabId = tabId;
        break;
      case 'panel-hidden':
        if (current.presentation !== 'panel' || current.panelTabId !== tabId) return current;
        next.presentation = 'hidden';
        next.panelTabId = null;
        break;
      case 'float-collapsed':
        if (current.mode !== 'float') return current;
        next.presentation = 'bead';
        next.panelTabId = null;
        break;
      case 'bead-restored':
        if (current.mode !== 'float') return current;
        next.presentation = 'panel';
        next.panelTabId = tabId;
        break;
      case 'tab-activated':
        if (current.presentation !== 'panel' || current.panelTabId === tabId) return current;
        next.presentation = 'hidden';
        next.panelTabId = null;
        break;
      case 'message-failed':
      case 'tab-removed':
        delete next.tabDocuments[key];
        if (current.presentation === 'panel' && current.panelTabId === tabId) {
          next.presentation = 'hidden';
          next.panelTabId = null;
        }
        break;
      default:
        return current;
    }

    return finish(current, next);
  }

  function contentRenderMode(settings) {
    const display = settings && settings.display || {};
    if (display.mode === 'sidebar') return null;
    if (display.mode === 'edge') return `edge-${display.edge || 'right'}`;
    return 'float';
  }

  function snapshotPresentation(snapshot) {
    const mode = normalizeMode(snapshot && snapshot.mode);
    return mode === 'float' && snapshot && snapshot.presentation === 'bead' ? 'bead' : 'hidden';
  }

  function shouldApplyRevision(nextRevision, currentRevision) {
    return Number.isInteger(nextRevision) && nextRevision > currentRevision;
  }

  return {
    PRESENTATIONS, normalizeMode, createState, normalizeState, reconcileMode, reduce,
    contentRenderMode, snapshotPresentation, shouldApplyRevision,
  };
});
