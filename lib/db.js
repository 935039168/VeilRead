// VeilRead — 书库 IndexedDB（仅在扩展上下文加载：popup / options / sidebar / service worker）
// meta 与 text 分两个 store，书单列表不加载全文
(globalThis.VeilRead = globalThis.VeilRead || {}).db = (function () {
  'use strict';

  const DB_NAME = 'veilread';
  const DB_VERSION = 1;
  const META = 'books';
  const TEXT = 'texts';

  let opening = null;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(TEXT)) db.createObjectStore(TEXT, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // meta: {id, title, size, addedAt, chapterCount, chapters:[{t,o}]}
  async function putBook(meta, text) {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([META, TEXT], 'readwrite');
      tx.objectStore(META).put(meta);
      tx.objectStore(TEXT).put({ id: meta.id, text });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return meta;
  }

  async function getMeta(id) {
    const db = await open();
    return wrap(db.transaction(META).objectStore(META).get(id));
  }

  async function listMetas() {
    const db = await open();
    const metas = await wrap(db.transaction(META).objectStore(META).getAll());
    metas.sort((a, b) => (b.lastOpenAt || b.addedAt) - (a.lastOpenAt || a.addedAt));
    return metas;
  }

  async function getText(id) {
    const db = await open();
    const rec = await wrap(db.transaction(TEXT).objectStore(TEXT).get(id));
    return rec ? rec.text : null;
  }

  async function getChapter(id, index) {
    const db = await open();
    const meta = await wrap(db.transaction(META).objectStore(META).get(id));
    if (!meta || !Array.isArray(meta.chapters)) return null; // 在线书等无章节数据的记录
    const chs = meta.chapters;
    if (index == null || index < 0 || index >= chs.length) return null;
    const rec = await wrap(db.transaction(TEXT).objectStore(TEXT).get(id));
    if (!rec) return null;
    // 第 i 章正文 = text.slice(chs[i].o, chs[i+1].s)
    const start = chs[index].o;
    const end = index + 1 < chs.length ? chs[index + 1].s : rec.text.length;
    const body = rec.text.slice(start, end).replace(/^\n+/, '');
    return { title: chs[index].t, text: body, index, count: chs.length };
  }

  async function renameBook(id, title) {
    const db = await open();
    const store = db.transaction(META, 'readwrite').objectStore(META);
    const meta = await wrap(store.get(id));
    if (!meta) return;
    meta.title = title;
    await wrap(store.put(meta));
  }

  async function touchBook(id) {
    const db = await open();
    const store = db.transaction(META, 'readwrite').objectStore(META);
    const meta = await wrap(store.get(id));
    if (!meta) return;
    meta.lastOpenAt = Date.now();
    await wrap(store.put(meta));
  }

  async function deleteBook(id) {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([META, TEXT], 'readwrite');
      tx.objectStore(META).delete(id);
      tx.objectStore(TEXT).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- 在线书 ----------
  function legacyWebId(url) {
    let h = 5381;
    for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
    return 'w' + h.toString(36);
  }
  // 使用 URL 本身作为键，避免 32 位哈希碰撞把两本在线书合并。
  function webId(url) { return 'w:' + url; }

  const WEB_BOOK_LIMIT = 60;

  // 以书页/目录 URL 为身份记录在线书；LRU 限量
  async function upsertWeb(bookUrl, chapterUrl, title) {
    const db = await open();
    const id = webId(bookUrl);
    const oldId = legacyWebId(bookUrl);
    const now = Date.now();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META, 'readwrite');
      const store = tx.objectStore(META);
      const getReq = store.get(id);
      const legacyReq = oldId === id ? null : store.get(oldId);
      let current = null;
      let legacy = null;
      let gotCurrent = false;
      let gotLegacy = !legacyReq;
      let resolved = false;
      const update = () => {
        if (resolved) return;
        if (!gotCurrent || !gotLegacy) return;
        resolved = true;
        const existing = current || legacy;
        if (existing) {
          existing.id = id;
          existing.lastOpenAt = now;
          if (title) existing.title = title;
          if (chapterUrl) existing.lastChapter = chapterUrl;
          store.put(existing);
          if (legacyReq && legacyReq.result && oldId !== id) store.delete(oldId);
        } else {
          store.put({
            id, type: 'web', url: bookUrl,
            lastChapter: chapterUrl || bookUrl,
            title: title || bookUrl,
            addedAt: now, lastOpenAt: now,
          });
        }
      };
      getReq.onsuccess = () => { current = getReq.result; gotCurrent = true; update(); };
      if (legacyReq) legacyReq.onsuccess = () => { legacy = legacyReq.result; gotLegacy = true; update(); };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    // LRU 精简
    const all = await wrap(db.transaction(META).objectStore(META).getAll());
    const webs = all.filter((m) => m.type === 'web').sort((a, b) => (b.lastOpenAt || 0) - (a.lastOpenAt || 0));
    const excess = webs.slice(WEB_BOOK_LIMIT);
    if (excess.length) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(META, 'readwrite');
        for (const m of excess) tx.objectStore(META).delete(m.id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  return { putBook, getMeta, listMetas, getText, getChapter, renameBook, touchBook, deleteBook, upsertWeb };
})();
