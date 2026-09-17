// VeilRead — 后台 service worker
// 无状态：所有数据在 chrome.storage / IndexedDB，事件驱动，空闲即休眠
importScripts('../lib/db.js', '../lib/store.js', '../lib/reader-session.js', '../lib/online.js');

'use strict';

const db = globalThis.VeilRead.db;
const store = globalThis.VeilRead.store;
const readerSession = globalThis.VeilRead.readerSession;
const online = globalThis.VeilRead.online;
const SIDEBAR_TAB_KEY = 'vr.sidebarTabId';
const PENDING_ONLINE_OPEN_PREFIX = 'vr.pendingOnlineOpen:';
const READER_UI_KEY = 'vr.readerUiSession';

const CONTENT_FILES = [
  'lib/store.js',
  'lib/reader-session.js',
  'lib/online.js',
  'reader/reader-core.js',
  'content/extractor.js',
  'content/content.js',
];

// service worker 没有窗口上下文，currentWindow 不可靠，逐级回退
async function getActiveTab() {
  for (const q of [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
    { active: true },
  ]) {
    const tabs = await chrome.tabs.query(q);
    if (tabs && tabs[0]) return tabs[0];
  }
  return null;
}

async function getSidebarTab() {
  const area = chrome.storage.session || chrome.storage.local;
  const saved = await area.get(SIDEBAR_TAB_KEY);
  const tabId = saved[SIDEBAR_TAB_KEY];
  if (tabId != null) {
    try { return await chrome.tabs.get(tabId); } catch (e) { /* tab closed */ }
  }
  return getActiveTab();
}

function sessionArea() { return chrome.storage.session || chrome.storage.local; }
function pendingOnlineOpenKey(tabId) { return PENDING_ONLINE_OPEN_PREFIX + tabId; }

async function queueOnlineOpen(tabId, data) {
  await sessionArea().set({ [pendingOnlineOpenKey(tabId)]: data });
}

async function takeOnlineOpen(tabId) {
  const area = sessionArea();
  const key = pendingOnlineOpenKey(tabId);
  const saved = await area.get(key);
  const data = saved[key];
  if (data) await area.remove(key);
  return data || null;
}

let readerUiQueue = Promise.resolve();

function withReaderUi(work) {
  const next = readerUiQueue.then(work, work);
  readerUiQueue = next.catch(() => {});
  return next;
}

function publicReaderUiSnapshot(state) {
  return {
    mode: state.mode,
    presentation: state.presentation,
    panelTabId: state.panelTabId,
    revision: state.revision,
  };
}

async function loadReaderUiState() {
  const area = sessionArea();
  const [settings, saved] = await Promise.all([
    store.getSettings(),
    area.get(READER_UI_KEY),
  ]);
  const authoritativeMode = settings && settings.display && settings.display.mode;
  const raw = saved[READER_UI_KEY];
  const persistedMode = raw && raw.mode;
  const normalized = readerSession.normalizeState(raw, persistedMode || authoritativeMode);
  return readerSession.reconcileMode(normalized, authoritativeMode);
}

async function saveReaderUiState(state) {
  await sessionArea().set({ [READER_UI_KEY]: state });
  return state;
}

async function sendRegisteredReaderUi(state, message, { excludeTabId = null } = {}) {
  let tabIds = Object.keys(state.tabDocuments)
    .map(Number)
    .filter((tabId) => Number.isInteger(tabId) && tabId !== excludeTabId);
  let outgoing = message;

  while (tabIds.length) {
    const results = await Promise.allSettled(tabIds.map((tabId) => readerUiTabsSend(tabId, outgoing)));
    const healthyTabIds = [];
    let next = state;
    results.forEach((result, index) => {
      const tabId = tabIds[index];
      if (result.status === 'rejected') {
        next = readerSession.reduce(next, { type: 'message-failed', tabId });
      } else {
        healthyTabIds.push(tabId);
      }
    });
    if (next.revision === state.revision) return state;

    state = next;
    await saveReaderUiState(state);
    tabIds = healthyTabIds;
    outgoing = {
      ...message,
      snapshot: publicReaderUiSnapshot(state),
    };
  }
  return state;
}

function requireReaderUiSender(sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  const documentId = sender && sender.documentId;
  if (!Number.isInteger(tabId) || typeof documentId !== 'string' || !documentId) {
    throw new Error('阅读器 UI 消息缺少标签页或文档标识');
  }
  return { tabId, documentId, documentLifecycle: sender.documentLifecycle };
}

async function handleReaderUiReady(sender) {
  const { tabId, documentId, documentLifecycle } = requireReaderUiSender(sender);
  return withReaderUi(async () => {
    let state = await loadReaderUiState();
    if (documentLifecycle && documentLifecycle !== 'active') {
      await saveReaderUiState(state);
      return publicReaderUiSnapshot(state);
    }
    state = readerSession.reduce(state, { type: 'ready', tabId, documentId });
    await saveReaderUiState(state);
    return publicReaderUiSnapshot(state);
  });
}

async function handleReaderUiEvent(message, sender) {
  const { tabId, documentId } = requireReaderUiSender(sender);
  return withReaderUi(async () => {
    let state = await loadReaderUiState();
    if (state.tabDocuments[String(tabId)] !== documentId) return publicReaderUiSnapshot(state);

    const eventTypes = {
      'panel-opened': 'panel-opened',
      'panel-hidden': 'panel-hidden',
      'float-collapsed': 'float-collapsed',
      'bead-restored': 'bead-restored',
    };
    const type = eventTypes[message.event];
    if (!type) throw new Error('不支持的阅读器 UI 事件');

    const previous = state;
    state = readerSession.reduce(state, { type, tabId });
    await saveReaderUiState(state);

    const clearsBeads = type === 'bead-restored' ||
      (type === 'panel-opened' && previous.presentation === 'bead');
    if (type === 'float-collapsed' || clearsBeads) {
      state = await sendRegisteredReaderUi(state, {
        type: 'readerUi.sync',
        snapshot: publicReaderUiSnapshot(state),
      }, type === 'panel-opened' ? { excludeTabId: tabId } : undefined);
    }

    if (type === 'bead-restored' && state.presentation === 'panel' &&
        state.panelTabId === tabId && state.tabDocuments[String(tabId)] === documentId) {
      try {
        const response = await tabsSend(tabId, { type: 'readerUi.openPanel', revision: state.revision });
        if (response && response.ok === false) {
          state = readerSession.reduce(state, { type: 'panel-hidden', tabId });
          await saveReaderUiState(state);
          state = await sendRegisteredReaderUi(state, {
            type: 'readerUi.sync',
            snapshot: publicReaderUiSnapshot(state),
          });
        }
      } catch (err) {
        state = readerSession.reduce(state, { type: 'message-failed', tabId });
        await saveReaderUiState(state);
        state = await sendRegisteredReaderUi(state, {
          type: 'readerUi.sync',
          snapshot: publicReaderUiSnapshot(state),
        });
      }
    }
    return publicReaderUiSnapshot(state);
  });
}

function tabsSend(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

async function readerUiTabsSend(tabId, msg) {
  const response = await tabsSend(tabId, msg);
  if (response && response.ok === false) {
    throw new Error(response.error || '阅读器 UI 消息处理失败');
  }
  return response;
}

// 发消息到标签页；内容脚本未注入（如扩展安装前就打开的页面）时补注入后重试
async function sendOrInject(tab, msg) {
  if (!tab || tab.id == null) return null;
  try {
    return await tabsSend(tab.id, msg);
  } catch (e) {
    const url = tab.url || tab.pendingUrl || '';
    if (!/^https?:/.test(url)) return null; // 浏览器内部页无法注入
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_FILES,
      });
      return await tabsSend(tab.id, msg);
    } catch (e2) {
      return null;
    }
  }
}

async function openOnlineBook(tab, message) {
  const config = online.normalizeWebBookConfig({
    title: message.bookTitle,
    chapterUrl: message.url,
    bookUrl: message.bookUrl,
  });
  const launch = {
    type: 'openWebBook',
    url: config.chapterUrl,
    bookUrl: config.bookUrl,
    bookTitle: config.title,
  };
  const currentUrl = tab && (tab.url || tab.pendingUrl || '');
  if (!online.shouldOpenOnlineInNewTab(config.chapterUrl, currentUrl)) {
    const res = await sendOrInject(tab, launch);
    if (!res) throw new Error('当前页面暂不支持注入');
    return res;
  }

  // 在线书的 Cookie 与页面解析都必须运行在目标站点，因此跨站时保留当前页并新开目标页。
  // 先创建空白页并落盘任务，再导航，避免极速缓存页在任务写入前就完成加载。
  const targetTab = await chrome.tabs.create({ url: 'about:blank', active: true });
  if (!targetTab || targetTab.id == null) throw new Error('无法打开在线书页面');
  try {
    await queueOnlineOpen(targetTab.id, config);
    await chrome.tabs.update(targetTab.id, { url: config.chapterUrl });
  } catch (err) {
    await sessionArea().remove(pendingOnlineOpenKey(targetTab.id)).catch(() => {});
    try { await chrome.tabs.remove(targetTab.id); } catch (closeErr) { /* 空白标签页由用户决定是否保留 */ }
    throw err;
  }
  return { ok: true, openedInNewTab: true };
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  (async () => {
    const pageUrl = tab && (tab.url || tab.pendingUrl || '');
    // 新标签页的 about:blank 也会完成加载；此时不能提前消费待打开任务。
    if (!/^https?:/.test(pageUrl)) return;
    const pending = await takeOnlineOpen(tabId);
    if (!pending) return;
    const res = await sendOrInject({ id: tabId, url: pageUrl }, {
      type: 'openWebBook',
      useCurrentPage: true,
      url: pageUrl,
      bookUrl: pending.bookUrl,
      bookTitle: pending.title,
    });
    if (!res || !res.ok) console.warn('VeilRead 在线书自动打开失败', res && res.error);
  })().catch((err) => console.warn('VeilRead 在线书启动失败', err));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessionArea().remove(pendingOnlineOpenKey(tabId)).catch(() => {});
});

// ---------- 安装 ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'veilread-read-page',
      title: '用 VeilRead 阅读此页正文',
      contexts: ['page'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'veilread-read-page' || !tab) return;
  try {
    await sendOrInject(tab, { type: 'openWeb' });
  } catch (e) { /* 页面不支持注入 */ }
});

// ---------- 快捷键 ----------
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    await sendOrInject(tab, { type: 'command', command });
  } catch (e) { /* 页面不支持注入 */ }
});

// ---------- 消息 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  handle(msg, sender)
    .then((data) => sendResponse({ ok: true, data: data === undefined ? null : data }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});

async function handle(msg, sender) {
  switch (msg.type) {
    case 'readerUi.ready': return handleReaderUiReady(sender);
    case 'readerUi.event': return handleReaderUiEvent(msg, sender);

    // ---- 集中式 storage 写入：规避多标签页读-改-写竞争 ----
    case 'store.mutate': {
      const local = store._local;
      const payload = msg.payload || {};
      switch (msg.action) {
        case 'patchSettings': return local.patchSettings(payload.patch || {});
        case 'saveProgress': return local.saveProgress(payload.bookId, payload.data || {});
        case 'clearProgress': return local.clearProgress(payload.bookId);
        case 'saveWebProgress': return local.saveWebProgress(payload.url, payload.data || {});
        case 'clearWebProgress': return local.clearWebProgress(payload.url);
        case 'saveWebBook': return local.saveWebBook(payload.bookUrl, payload.data || {});
        case 'clearWebBook': return local.clearWebBook(payload.bookUrl, payload.legacyChapterUrl);
        default: throw new Error('不支持的存储操作');
      }
    }
    // ---- 书库数据（来自 content script / sidebar）----
    case 'book.getChapter': {
      const ch = await db.getChapter(msg.bookId, msg.index);
      if (!ch) throw new Error('章节不存在');
      return ch;
    }
    case 'book.getToc': {
      const meta = await db.getMeta(msg.bookId);
      if (!meta || !Array.isArray(meta.chapters)) throw new Error('书籍不存在');
      return meta.chapters.map((c) => c.t);
    }

    // ---- 在线书记入书库 ----
    case 'book.noteWeb': {
      if (!msg.bookUrl) return null;
      await db.upsertWeb(msg.bookUrl, msg.chapterUrl || '', msg.title || '');
      return null;
    }

    // ---- 打开设置页 ----
    case 'openOptions': {
      if (msg.page) await chrome.storage.local.set({ 'vr.openSection': msg.page });
      await chrome.runtime.openOptionsPage();
      return null;
    }

    // ---- 通用：发消息到标签页（含未注入页面的补注入回退），供 popup / options 使用 ----
    case 'tabSend': {
      if (msg.msg && msg.msg.type === 'openWebBook') {
        return openOnlineBook({ id: msg.tabId, url: msg.url || '' }, msg.msg);
      }
      const res = await sendOrInject({ id: msg.tabId, url: msg.url || '' }, msg.msg);
      if (!res) throw new Error('该页面暂不支持（浏览器内部页或注入失败）');
      return res;
    }

    // ---- 原生侧边栏与其关联的标签页 ----
    case 'sidebar.track': {
      if (msg.tabId == null) throw new Error('没有活动标签页');
      const area = chrome.storage.session || chrome.storage.local;
      await area.set({ [SIDEBAR_TAB_KEY]: msg.tabId });
      return null;
    }

    // ---- 侧边栏：借道当前标签页提取正文 ----
    case 'sidebar.extract': {
      const tab = await getSidebarTab();
      if (!tab) throw new Error('没有活动标签页');
      const res = await sendOrInject(tab, { type: 'extractPage' });
      if (!res || !res.ok) throw new Error((res && res.error) || '当前页面无法提取正文');
      return res.data;
    }
    case 'sidebar.fetch': {
      const tab = await getSidebarTab();
      if (!tab) throw new Error('没有活动标签页');
      const res = await sendOrInject(tab, { type: 'fetchAndExtract', url: msg.url });
      if (!res || !res.ok) throw new Error((res && res.error) || '章节加载失败');
      return res.data;
    }
    case 'sidebar.fetchCatalog': {
      const tab = await getSidebarTab();
      if (!tab) throw new Error('没有活动标签页');
      const res = await sendOrInject(tab, { type: 'fetchCatalog', url: msg.url });
      if (!res || !res.ok) throw new Error((res && res.error) || '目录加载失败');
      return res.data;
    }

    default:
      return null;
  }
}
