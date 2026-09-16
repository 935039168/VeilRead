// VeilRead — 原生侧边栏（chrome.sidePanel）
'use strict';
const store = globalThis.VeilRead.store;
const db = globalThis.VeilRead.db;

function send(type, data) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(Object.assign({ type }, data || {}), (res) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (res && res.ok === false) reject(new Error(res.error || '后台错误'));
      else resolve(res ? res.data : null);
    });
  });
}

async function openOptions(page) {
  if (page) await chrome.storage.local.set({ 'vr.openSection': page });
  chrome.runtime.openOptionsPage();
}

const host = {
  getChapter: (bookId, index) => db.getChapter(bookId, index),
  getToc: async (bookId) => {
    const meta = await db.getMeta(bookId);
    return meta && Array.isArray(meta.chapters) ? meta.chapters.map((c) => c.t) : null;
  },
  getProgress: (id) => store.getProgress(id),
  saveProgress: (id, d) => store.saveProgress(id, d).catch(() => {}),
  getWebProgress: (u) => store.getWebProgress(u),
  saveWebProgress: (u, d) => store.saveWebProgress(u, d).catch(() => {}),
  saveWebBook: (bookUrl, d) => store.saveWebBook(bookUrl, d).catch(() => {}),
  patchSettings: (p) => store.patchSettings(p).catch(() => {}),
  loadWeb: (url) => send('sidebar.fetch', { url }),
  loadCatalog: (url) => send('sidebar.fetchCatalog', { url }),
  noteWebBook: (info) => { send('book.noteWeb', info).catch(() => {}); },
  onGeometry: () => {},
  onShown: () => {},
  onHidden: () => {},
  openOptions: (page) => openOptions(page),
  openImport: () => openOptions('books'),
  extractCurrentPage: async () => {
    try {
      const data = await send('sidebar.extract');
      if (data) await reader.openWeb(data);
      else reader.toast('未能识别该页正文');
    } catch (e) {
      reader.toast('当前页面无法提取正文');
    }
  },
};

const reader = globalThis.VeilRead.createReader({
  mount: document.getElementById('mount'),
  env: 'sidebar',
  host,
});

async function refreshBooks(selectId) {
  const metas = await db.listMetas();
  const sel = document.getElementById('bookSelect');
  sel.textContent = '';
  for (const m of metas) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.title;
    sel.appendChild(opt);
  }
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = metas.length ? '— 切换书籍 —' : '书库为空';
  sel.appendChild(empty);
  sel.value = selectId || '';
}

document.getElementById('bookSelect').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) return;
  try {
    const meta = await db.getMeta(id);
    if (meta && meta.type === 'web') {
      const savedBook = await store.getWebBook(meta.url);
      const url = store.resolveWebChapter(meta, savedBook);
      if (!url) throw new Error('缺少可打开的章节链接');
      const data = await host.loadWeb(url);
      if (data) await reader.openWeb(Object.assign({ url, bookUrl: meta.url }, data));
      else reader.toast('章节加载失败');
    } else {
      await store.setCurrent(id);
      db.touchBook(id).catch(() => {});
      await reader.openBook(id);
    }
  } catch (err) {
    reader.toast('打开失败');
  }
  reader.show();
});

document.getElementById('btnExtract').addEventListener('click', () => host.extractCurrentPage());

window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  switch (e.key) {
    case 'PageDown':
    case ' ':
      e.preventDefault(); reader.pageDown(); break;
    case 'PageUp':
      e.preventDefault(); reader.pageUp(); break;
    case 'ArrowRight':
      e.preventDefault(); reader.nextChapter(); break;
    case 'ArrowLeft':
      e.preventDefault(); reader.prevChapter(); break;
  }
});

(async function init() {
  const settings = await store.getSettings();
  reader.applySettings(settings);
  store.onSettingsChanged((s) => {
    reader.applySettings(s);
    document.documentElement.dataset.theme = (s.ui && s.ui.theme) === 'night' ? 'night' : 'day';
  });
  document.documentElement.dataset.theme = (settings.ui && settings.ui.theme) === 'night' ? 'night' : 'day';

  const cur = await store.getCurrent();
  await refreshBooks(cur.bookId);
  if (cur.bookId) {
    try { await reader.openBook(cur.bookId); } catch (e) { /* 书不存在 */ }
  }
  if (!reader.getState().kind) reader.renderEmpty();
  reader.show();

  // 书库变化时刷新下拉（popup 导入后切回来能看到）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[store.KEYS.current]) {
      const v = changes[store.KEYS.current].newValue;
      if (v && v.bookId) refreshBooks(v.bookId);
    }
  });
})();
