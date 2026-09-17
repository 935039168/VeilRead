// VeilRead — popup
'use strict';
const store = globalThis.VeilRead.store;
const db = globalThis.VeilRead.db;
const txt = globalThis.VeilRead.txt;
const popupMode = globalThis.VeilRead.popupMode;

const $ = (id) => document.getElementById(id);
let activeTabId = null;
let activeTabUrl = '';
let busy = false;
let currentBookId = null;
let popupSettings = null;

function hint(msg, ms) {
  const h = $('hint');
  h.textContent = msg;
  h.hidden = false;
  if (ms) setTimeout(() => { h.hidden = true; }, ms);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

// 经后台路由到标签页：内容脚本未注入时由后台补注入后重试
function tabSendViaSW(tabId, tabUrl, msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'tabSend', tabId, url: tabUrl, msg }, (res) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (res && res.ok === false) reject(new Error(res.error || '发送失败'));
      else resolve(res ? res.data : null);
    });
  });
}

function pctOf(meta, prog) {
  if (!prog) return 0;
  const c = meta.chapterCount || 1;
  return Math.min(100, Math.round(((prog.chapter + (prog.ratio || 0)) / c) * 100));
}

function applyTheme(settings) {
  document.documentElement.dataset.theme = (settings.ui && settings.ui.theme) === 'night' ? 'night' : 'day';
}

function renderDisplayMode() {
  if (!popupSettings) return;
  const view = popupMode.getPopupModeView(popupSettings.display && popupSettings.display.mode);
  $('btnModeFloat').classList.toggle('active', view.floatPressed);
  $('btnModeFloat').setAttribute('aria-pressed', String(view.floatPressed));
  $('btnModeEdge').classList.toggle('active', view.edgePressed);
  $('btnModeEdge').setAttribute('aria-pressed', String(view.edgePressed));
  $('modeTip').textContent = view.tip;
}

async function selectDisplayMode(mode) {
  if (!popupSettings || popupSettings.display.mode === mode) return;
  try {
    popupSettings = await store.patchSettings({ display: { mode } });
    renderDisplayMode();
    hint(mode === 'float' ? '已切换为自由悬浮窗' : '已切换为贴边面板', 1800);
  } catch (e) {
    hint('打开方式未能保存，请稍后重试', 3000);
  }
}

async function render() {
  const [cur, metas, progMap, webProgMap, webBooks] = await Promise.all([
    store.getCurrent(),
    db.listMetas(),
    store.getProgressMap(),
    store.getWebProgressMap(),
    store.getWebBooks(),
  ]);

  // 当前书（仅本地 TXT）
  const curMeta = cur.bookId ? metas.find((m) => m.id === cur.bookId) : null;
  currentBookId = curMeta ? curMeta.id : null;
  if (curMeta) {
    const p = progMap[cur.bookId];
    $('current').hidden = false;
    $('curTitle').textContent = curMeta.title;
    $('curSub').textContent = p && p.chapterTitle
      ? `${p.chapterTitle} · ${pctOf(curMeta, p)}%`
      : `共 ${curMeta.chapterCount} 章`;
  } else {
    $('current').hidden = true;
  }

  // 书库（本地 TXT + 在线书）
  const list = $('bookList');
  list.textContent = '';
  $('bookEmpty').hidden = metas.length > 0;
  for (const m of metas.slice(0, 12)) {
    const isWeb = m.type === 'web';
    const p = progMap[m.id];
    const webBook = isWeb ? webBooks[m.url] : null;
    const webChapter = store.resolveWebChapter(m, webBook);
    const pct = isWeb
      ? (webProgMap[webChapter] ? Math.round((webProgMap[webChapter].ratio || 0) * 100) : 0)
      : pctOf(m, p);
    const row = document.createElement('div');
    row.className = 'book';
    const bt = document.createElement('div');
    bt.className = 'bt';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = (isWeb ? '[在线] ' : '') + m.title;
    const sub = document.createElement('span');
    sub.className = 'p';
    if (isWeb) {
      let host = '';
      try { host = new URL(m.url).hostname; } catch (e) { host = m.url; }
      sub.textContent = `在线小说 · ${host} · ${pct}%`;
    } else {
      sub.textContent = `${m.chapterCount} 章 · ${(m.size / 10000).toFixed(0)} 万字`;
    }
    bt.append(n, sub);
    const bar = document.createElement('span');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    const pctEl = document.createElement('span');
    pctEl.className = 'pct';
    pctEl.textContent = pct + '%';
    row.append(bt, bar, pctEl);
    row.onclick = () => (isWeb ? openWebBook(m) : openBook(m.id));
    list.appendChild(row);
  }
}

async function openWebBook(meta) {
  if (busy) return;
  busy = true;
  try {
    const savedBook = await store.getWebBook(meta.url);
    const url = store.resolveWebChapter(meta, savedBook);
    if (!url) throw new Error('缺少可打开的章节链接');
    if (activeTabId != null) {
      const res = await tabSendViaSW(activeTabId, activeTabUrl, {
        type: 'openWebBook', url, bookUrl: meta.url, bookTitle: meta.title,
      });
      if (res && res.ok) { window.close(); return; }
      throw new Error((res && res.error) || '发送失败');
    }
    throw new Error('没有活动标签页');
  } catch (e) {
    busy = false;
    hint('打开在线书失败：' + String(e && e.message || e || '未知错误'), 4500);
  }
}

async function openBook(bookId, viaContinue) {
  if (busy) return;
  busy = true;
  try {
    await store.setCurrent(bookId);
    if (activeTabId != null) {
      const res = await tabSendViaSW(activeTabId, activeTabUrl, { type: 'open', bookId });
      if (!res || !res.ok) throw new Error((res && res.error) || '发送失败');
      window.close();
      return;
    }
    throw new Error('没有活动标签页');
  } catch (e) {
    busy = false;
    hint('当前页面无法使用（浏览器内部页不受支持），请切换到普通网页后重试', 3500);
  }
}

async function init() {
  popupSettings = await store.getSettings();
  applyTheme(popupSettings);
  renderDisplayMode();
  store.onSettingsChanged((settings) => {
    popupSettings = settings;
    applyTheme(settings);
    renderDisplayMode();
  });
  const tab = await getActiveTab();
  activeTabId = tab ? tab.id : null;
  activeTabUrl = tab ? (tab.url || '') : '';
  await render();

  $('btnContinue').onclick = () => {
    if (currentBookId) openBook(currentBookId, true);
  };

  $('btnSettings').onclick = () => chrome.runtime.openOptionsPage();

  $('btnModeFloat').onclick = () => selectDisplayMode('float');
  $('btnModeEdge').onclick = () => selectDisplayMode('edge');

  $('btnReadPage').onclick = async () => {
    if (activeTabId == null) return;
    try {
      const res = await tabSendViaSW(activeTabId, activeTabUrl, { type: 'openWeb' });
      if (res && res.ok) window.close();
      else hint('未能识别此页正文，可尝试在设置中添加站点规则', 3000);
    } catch (e) {
      hint('当前页面无法使用', 3000);
    }
  };

  $('btnSidebar').onclick = async () => {
    try {
      if (activeTabId != null) {
        await chrome.sidePanel.open({ tabId: activeTabId });
        chrome.runtime.sendMessage({ type: 'sidebar.track', tabId: activeTabId });
        window.close();
      }
    } catch (e) {
      hint('此浏览器不支持侧边栏', 3000);
    }
  };

  $('btnEmergency').onclick = async () => {
    if (activeTabId == null) return;
    try { await tabSendViaSW(activeTabId, activeTabUrl, { type: 'emergency' }); } catch (e) { /* ignore */ }
    window.close();
  };

  $('fileInput').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    hint('正在导入…');
    try {
      const buf = await file.arrayBuffer();
      const { meta, text } = txt.importFile(file.name, buf);
      await db.putBook(meta, text);
      await store.setCurrent(meta.id);
      await render();
      hint(`已导入《${meta.title}》（${meta.chapterCount} 章）`, 2500);
      openBook(meta.id);
    } catch (err) {
      hint('导入失败：' + (err && err.message ? err.message : err), 3500);
    }
    e.target.value = '';
  };
}

init();
