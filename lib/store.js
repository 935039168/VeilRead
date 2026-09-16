// VeilRead — 设置 / 进度存储（chrome.storage.local）
// 可在 content script / popup / options / sidebar / service worker 中加载
(globalThis.VeilRead = globalThis.VeilRead || {}).store = (function () {
  'use strict';

  const KEYS = {
    settings: 'vr.settings',
    current: 'vr.current',
    progress: 'vr.progress',
    webProgress: 'vr.webProgress',
    webBooks: 'vr.webBooks',
  };

  const DEFAULTS = {
    display: {
      mode: 'float',             // float | edge | sidebar
      edge: 'right',             // left | right | top | bottom
      width: 440,                // 贴边面板厚度（左右贴边=宽度，上下贴边=高度）
      float: {
        x: null, y: null, w: 480, h: 600,
        snap: true,              // 拖动结束时吸附到视口边缘
        autoHide: true,          // 鼠标移出悬浮窗后按全局收起策略处理
        bead: null,              // 收起恢复圆点的手动位置；null 时跟随悬浮窗位置
      },
      font: 'sans',              // sans | serif | kai | system | mono
      fontSize: 17,
      lineHeight: 1.85,
      maxWidth: 0,               // 正文最大宽度 px，0 = 撑满
      indent: true,              // 中文段首缩进 2em
      // 三种 UI 形态各自的样式（互不影响）
      styles: {
        float: { color: '#1a1a1a', bgColor: '#ffffff', opacity: 0.9, glass: true },
        edge: { color: '#1a1a1a', bgColor: '#ffffff', opacity: 0.9, glass: true },
        sidebar: { color: '#1a1a1a', bgColor: '#ffffff', opacity: 1, glass: false },
      },
    },
    trigger: {
      hover: true,               // 边缘悬浮触发
      edge: 'right',             // left | right | top | bottom
      thickness: 10,             // 触发热区厚度 px
      vLimit: 0.15,              // 边缘两端忽略比例
      showDelay: 100,            // 停留多少 ms 后显示
      autoHide: true,            // 鼠标离开后自动隐藏/收起
      autoHideMode: 'hide',      // hide=完全隐藏 | collapse=收起为小图标
      autoHideDelay: 800,        // 鼠标离开多少 ms 后隐藏
      tray: true,                // 边缘小把手（低存在感图标）
      trayEdge: 'right',
      trayPos: 0.5,              // 0~1 垂直位置
    },
    reading: {
      scrollStep: 0.9,           // 翻页键滚动的视口比例
    },
    ui: {
      theme: 'day',              // 设置界面的白天/夜间模式：day | night
    },
    sites: [],                   // [{domain,content,title,prev,next,remove,catalog}]
  };

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }
  function deepMerge(base, over) {
    if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
    const out = {};
    for (const k of Object.keys(base)) out[k] = k in over ? deepMerge(base[k], over[k]) : base[k];
    for (const k of Object.keys(over)) if (!(k in out)) out[k] = over[k];
    return out;
  }

  // 所有内容脚本 / popup / options 的写操作经 service worker 串行化，
  // 避免多个页面同时“读-改-写”时覆盖彼此的字段。
  let writeQueue = Promise.resolve();
  function enqueueWrite(work) {
    const next = writeQueue.then(work, work);
    writeQueue = next.catch(() => {});
    return next;
  }
  function hasWriter() {
    return typeof window !== 'undefined' && !!(chrome.runtime && chrome.runtime.sendMessage);
  }
  function delegate(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'store.mutate', action, payload }, (res) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!res || res.ok === false) { reject(new Error((res && res.error) || '存储失败')); return; }
        resolve(res.data);
      });
    });
  }

  async function getSettings() {
    const o = await chrome.storage.local.get(KEYS.settings);
    const raw = o[KEYS.settings] || {};
    const s = deepMerge(DEFAULTS, raw);
    // 旧版本迁移：单一样式 → 三种 UI 各自独立（沿用用户已调好的值）
    if (raw.display && raw.display.color != null && !raw.display.styles) {
      const src = {
        color: raw.display.color,
        bgColor: raw.display.bgColor,
        opacity: raw.display.opacity != null ? raw.display.opacity : 0.9,
        glass: raw.display.glass !== false,
      };
      s.display.styles = { float: { ...src }, edge: { ...src }, sidebar: { ...src } };
      // 只在内存中迁移；下一次正常设置写入会由 service worker 原子落盘，
      // 避免每个已打开标签页同时初始化时反复写同一个旧设置。
    }
    return s;
  }

  async function patchSettingsLocal(patch) {
    return enqueueWrite(async () => {
      const cur = await getSettings();
      const next = deepMerge(cur, patch);
      await chrome.storage.local.set({ [KEYS.settings]: next });
      return next;
    });
  }
  async function patchSettings(patch) {
    if (hasWriter()) return delegate('patchSettings', { patch });
    return patchSettingsLocal(patch);
  }

  // 订阅设置变化（返回取消函数）
  function onSettingsChanged(cb) {
    const listener = (changes, area) => {
      if (area === 'local' && changes[KEYS.settings]) {
        cb(deepMerge(DEFAULTS, changes[KEYS.settings].newValue || {}));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // ---- 当前书 ----
  async function getCurrent() {
    const o = await chrome.storage.local.get(KEYS.current);
    return o[KEYS.current] || { bookId: null };
  }
  async function setCurrent(bookId) {
    await chrome.storage.local.set({ [KEYS.current]: { bookId } });
  }

  // ---- TXT 阅读进度：{ [bookId]: {chapter, ratio, ts, title} } ----
  async function getProgressMap() {
    const o = await chrome.storage.local.get(KEYS.progress);
    return o[KEYS.progress] || {};
  }
  async function saveProgressLocal(bookId, data) {
    return enqueueWrite(async () => {
      const map = await getProgressMap();
      map[bookId] = { ...data, ts: Date.now() };
      const ids = Object.keys(map);
      if (ids.length > 200) {
        ids.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
        for (const id of ids.slice(0, ids.length - 200)) delete map[id];
      }
      await chrome.storage.local.set({ [KEYS.progress]: map });
    });
  }
  async function saveProgress(bookId, data) {
    if (hasWriter()) return delegate('saveProgress', { bookId, data });
    return saveProgressLocal(bookId, data);
  }
  async function getProgress(bookId) {
    const map = await getProgressMap();
    return map[bookId] || null;
  }
  async function clearProgressLocal(bookId) {
    return enqueueWrite(async () => {
      const map = await getProgressMap();
      delete map[bookId];
      await chrome.storage.local.set({ [KEYS.progress]: map });
    });
  }
  async function clearProgress(bookId) {
    if (hasWriter()) return delegate('clearProgress', { bookId });
    return clearProgressLocal(bookId);
  }

  // ---- 在线阅读进度：{ [url]: {title, ratio, ts} } ----
  async function getWebProgressMap() {
    const o = await chrome.storage.local.get(KEYS.webProgress);
    return o[KEYS.webProgress] || {};
  }
  async function saveWebProgressLocal(url, data) {
    return enqueueWrite(async () => {
      const map = await getWebProgressMap();
      map[url] = { ...data, ts: Date.now() };
      const keys = Object.keys(map);
      if (keys.length > 300) {
        keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
        for (const k of keys.slice(0, keys.length - 300)) delete map[k];
      }
      await chrome.storage.local.set({ [KEYS.webProgress]: map });
    });
  }
  async function saveWebProgress(url, data) {
    if (hasWriter()) return delegate('saveWebProgress', { url, data });
    return saveWebProgressLocal(url, data);
  }
  async function getWebProgress(url) {
    const map = await getWebProgressMap();
    return map[url] || null;
  }
  async function clearWebProgressLocal(url) {
    return enqueueWrite(async () => {
      const map = await getWebProgressMap();
      delete map[url];
      await chrome.storage.local.set({ [KEYS.webProgress]: map });
    });
  }
  async function clearWebProgress(url) {
    if (hasWriter()) return delegate('clearWebProgress', { url });
    return clearWebProgressLocal(url);
  }

  // 在线书的稳定身份（通常是目录 URL）。章节进度仍按章节 URL 保存。
  async function getWebBooks() {
    const o = await chrome.storage.local.get(KEYS.webBooks);
    return o[KEYS.webBooks] || {};
  }
  async function getWebBook(bookUrl) {
    const books = await getWebBooks();
    const book = books[bookUrl];
    return book ? { lastChapter: book.lastChapter || '', title: book.title || '' } : null;
  }
  function resolveWebChapter(meta, savedBook) {
    return (savedBook && savedBook.lastChapter) ||
      (meta && meta.lastChapter) || (meta && meta.url) || '';
  }
  async function saveWebBookLocal(bookUrl, data) {
    if (!bookUrl) return;
    return enqueueWrite(async () => {
      const books = await getWebBooks();
      books[bookUrl] = { ...(books[bookUrl] || {}), ...data, updatedAt: Date.now() };
      await chrome.storage.local.set({ [KEYS.webBooks]: books });
    });
  }
  async function saveWebBook(bookUrl, data) {
    if (hasWriter()) return delegate('saveWebBook', { bookUrl, data });
    return saveWebBookLocal(bookUrl, data);
  }
  async function clearWebBookLocal(bookUrl, legacyChapterUrl) {
    return enqueueWrite(async () => {
      const [books, progress] = await Promise.all([getWebBooks(), getWebProgressMap()]);
      const knownChapter = (books[bookUrl] && books[bookUrl].lastChapter) || legacyChapterUrl;
      delete books[bookUrl];
      for (const [chapterUrl, value] of Object.entries(progress)) {
        if ((value && value.bookUrl === bookUrl) || chapterUrl === knownChapter) delete progress[chapterUrl];
      }
      await chrome.storage.local.set({ [KEYS.webBooks]: books, [KEYS.webProgress]: progress });
    });
  }
  async function clearWebBook(bookUrl, legacyChapterUrl) {
    if (hasWriter()) return delegate('clearWebBook', { bookUrl, legacyChapterUrl });
    return clearWebBookLocal(bookUrl, legacyChapterUrl);
  }

  return {
    DEFAULTS,
    KEYS,
    deepMerge,
    getSettings,
    patchSettings,
    patchSettingsLocal,
    onSettingsChanged,
    getCurrent,
    setCurrent,
    saveProgress,
    getProgress,
    getProgressMap,
    clearProgress,
    saveWebProgress,
    getWebProgress,
    getWebProgressMap,
    clearWebProgress,
    getWebBooks,
    getWebBook,
    resolveWebChapter,
    saveWebBook,
    clearWebBook,
    // service worker 专用入口；不通过 runtime message 回环。
    _local: {
      patchSettings: patchSettingsLocal,
      saveProgress: saveProgressLocal,
      clearProgress: clearProgressLocal,
      saveWebProgress: saveWebProgressLocal,
      clearWebProgress: clearWebProgressLocal,
      saveWebBook: saveWebBookLocal,
      clearWebBook: clearWebBookLocal,
    },
  };
})();
