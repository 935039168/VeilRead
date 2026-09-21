// VeilRead — 内容脚本：把阅读层挂进当前页面
// 职责：shadow DOM 挂载、边缘悬浮触发、托盘、紧急隐藏、消息路由、键盘
(function () {
  'use strict';
  if (window.__veilreadLoaded) return;
  window.__veilreadLoaded = true;

  const store = globalThis.VeilRead.store;
  const readerSession = globalThis.VeilRead.readerSession;
  const extractor = globalThis.VeilRead.extractor;
  const online = globalThis.VeilRead.online;

  let settings = null;
  let reader = null;
  let emergency = false;        // 紧急隐藏：禁用一切悬浮自动出现
  let contentBootstrapped = false;
  let firstOpenSettingsPromise = null;
  let settingsGeneration = 0;
  let openRequestId = 0;
  let lastUiRevision = -1;
  let readerUiRegistrationPromise = null;
  let readerUiRegistrationQueued = false;
  let readerUiRegistrationScheduled = false;
  let showTimer = null;
  const hideDelay = globalThis.VeilRead.readerUtils.createCancelableDelay();
  const edgeTrigger = globalThis.VeilRead.readerUtils.createEdgeTriggerState();
  let pointerInPanel = false;
  let trayEl = null;
  let resolveReaderReady;
  const readerReady = new Promise((resolve) => { resolveReaderReady = resolve; });
  let readerInitError = null;

  // ---------- 挂载 ----------
  const hostEl = document.createElement('div');
  hostEl.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = hostEl.attachShadow({ mode: 'closed' });

  function send(type, data) {
    return new Promise((resolve, reject) => {
      const msg = Object.assign({ type }, data || {});
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (res && res.ok === false) reject(new Error(res.error || '后台错误'));
        else resolve(res ? res.data : null);
      });
    });
  }

  function pageReaderEnabled() {
    return !!settings && readerSession.contentRenderMode(settings) !== null;
  }

  function edgePanelTriggerEnabled() {
    return pageReaderEnabled() && settings.display.mode === 'edge';
  }

  function reportReaderUi(event) {
    return send('readerUi.event', { event }).catch(() => null);
  }

  function beginOpenRequest() {
    openRequestId += 1;
    return openRequestId;
  }

  function cancelPendingOpen() {
    openRequestId += 1;
  }

  function canFinishOpen(requestId) {
    return requestId === openRequestId && !document.hidden && pageReaderEnabled();
  }

  function registerReaderUi() {
    if (readerUiRegistrationPromise) {
      readerUiRegistrationQueued = true;
      return readerUiRegistrationPromise;
    }
    const presentationAtStart = reader && reader.getPresentation();
    const task = send('readerUi.ready')
      .catch(() => null)
      .then((snapshot) => {
        if (reader && reader.getPresentation() !== presentationAtStart) {
          if (snapshot && readerSession.shouldApplyRevision(snapshot.revision, lastUiRevision)) {
            lastUiRevision = snapshot.revision;
          }
        } else {
          applyUiSnapshot(snapshot);
        }
        return snapshot;
      })
      .finally(() => {
        if (readerUiRegistrationPromise !== task) return;
        readerUiRegistrationPromise = null;
        if (readerUiRegistrationQueued) {
          readerUiRegistrationQueued = false;
          registerReaderUi();
        }
      });
    readerUiRegistrationPromise = task;
    return task;
  }

  function scheduleReaderUiRegistration() {
    if (readerUiRegistrationScheduled) return;
    readerUiRegistrationScheduled = true;
    Promise.resolve().then(() => {
      readerUiRegistrationScheduled = false;
      registerReaderUi();
    });
  }

  function applyUiSnapshot(snapshot) {
    if (!snapshot || !readerSession.shouldApplyRevision(snapshot.revision, lastUiRevision)) return false;
    lastUiRevision = snapshot.revision;
    const localMode = settings && settings.display && settings.display.mode;
    if (snapshot.mode && snapshot.mode !== localMode) cancelPendingOpen();
    const presentation = readerSession.snapshotPresentation({
      ...snapshot,
      mode: settings && settings.display && settings.display.mode,
    });
    if (presentation === 'bead' && pageReaderEnabled()) {
      reader.showBead(null, { notify: false, reason: 'sync' });
    } else {
      reader.hide({ notify: false, reason: 'sync' });
    }
    return true;
  }

  function acceptUiCommandRevision(revision) {
    if (!Number.isInteger(revision) || revision < lastUiRevision) return false;
    if (revision > lastUiRevision) lastUiRevision = revision;
    return true;
  }

  async function loadAuthoritativeSettingsBeforeFirstOpen() {
    if (!firstOpenSettingsPromise) {
      const generation = settingsGeneration;
      let task;
      task = store.getSettings().then((latest) => {
        if (generation !== settingsGeneration) return settings;
        settings = latest;
        hideDelay.cancel();
        reader.applySettings(latest);
        buildTray();
        return latest;
      }).catch((err) => {
        if (firstOpenSettingsPromise === task) firstOpenSettingsPromise = null;
        throw err;
      });
      firstOpenSettingsPromise = task;
    }
    return firstOpenSettingsPromise;
  }

  // ---------- 正文提取 ----------
  function rulesFor(hostname) {
    return extractor.findRules(settings.sites, hostname);
  }

  async function extractCurrentPage() {
    const rules = rulesFor(location.hostname);
    const data = extractor.extract(document, rules, location.href);
    if (!data) {
      if (!reader.getState().kind) reader.renderEmpty();
      reader.toast('未能识别该页正文，可在设置中添加站点规则');
      return null;
    }
    // 提取结果不含 url，补上以记录进度与在线书
    await reader.openWeb(Object.assign({ url: location.href }, data));
    return data;
  }

  function extractLoadedPage() {
    const rules = rulesFor(location.hostname);
    const data = extractor.extract(document, rules, location.href);
    if (!data) throw new Error('未能识别目标页面正文，可在设置中添加站点规则');
    return data;
  }

  async function fetchAndExtract(url) {
    const data = await fetchPage(url);
    if (!data) throw new Error('未解析到正文');
    return data;
  }

  async function fetchPage(url) {
    const safeUrl = online.validateReadableUrl(url, location.href);
    let rules = null;
    try { rules = rulesFor(new URL(safeUrl).hostname); } catch (e) { /* ignore */ }
    if (!rules) rules = rulesFor(location.hostname);
    const html = await online.fetchText(safeUrl);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return extractor.extract(doc, rules, safeUrl);
  }

  // 抓取目录页并解析章节链接
  async function fetchCatalog(url) {
    const safeUrl = online.validateReadableUrl(url, location.href);
    const html = await online.fetchText(safeUrl);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const list = extractor.extractCatalog(doc, safeUrl);
    if (!list) throw new Error('目录为空');
    return list;
  }

  // ---------- 阅读器宿主接口 ----------
  const hostAPI = {
    getChapter: (bookId, index) => send('book.getChapter', { bookId, index }),
    getToc: (bookId) => send('book.getToc', { bookId }),
    getProgress: (bookId) => store.getProgress(bookId),
    saveProgress: (bookId, data) => { store.saveProgress(bookId, data).catch(() => {}); },
    getWebProgress: (url) => store.getWebProgress(url),
    saveWebProgress: (url, data) => { store.saveWebProgress(url, data).catch(() => {}); },
    saveWebBook: (bookUrl, data) => { store.saveWebBook(bookUrl, data).catch(() => {}); },
    patchSettings: (patch) => {
      // “重置位置”一类几何写入必须取消尚未执行的拖动落盘，避免旧坐标反写回来。
      if (globalThis.VeilRead.readerUtils.isFloatGeometryPatch(patch)) {
        clearTimeout(geoTimer);
        geoTimer = null;
      }
      store.patchSettings(patch).catch(() => {});
    },
    loadWeb: (url) => fetchAndExtract(url),
    loadCatalog: (url) => fetchCatalog(url),
    noteWebBook: (info) => { send('book.noteWeb', info).catch(() => {}); },
    onGeometry: null, // 下方赋值（含防抖）
    onShown: () => { if (trayEl) trayEl.style.display = 'none'; },
    onHidden: () => { if (trayEl) trayEl.style.display = ''; },
    onPresentationChanged: ({ presentation, reason }) => {
      if (presentation !== 'panel') cancelPendingOpen();
      let event = null;
      if (presentation === 'panel') event = 'panel-opened';
      else if (presentation === 'bead' && reason === 'collapse') event = 'float-collapsed';
      else if (presentation === 'hidden') event = 'panel-hidden';
      if (event) reportReaderUi(event);
    },
    onBeadRestoreRequested: () => {
      reportReaderUi('bead-restored').then((snapshot) => {
        // 与尚未实现协调协议的旧 worker 共存；有 revision 的响应由 worker 另发 openPanel。
        if (!snapshot || !Number.isInteger(snapshot.revision)) reader.show({ reason: 'bead-fallback' });
      }).catch(() => reader.show({ reason: 'bead-fallback' }));
    },
    openOptions: (page) => { chrome.runtime.sendMessage({ type: 'openOptions', page: page || '' }); },
    openImport: () => { chrome.runtime.sendMessage({ type: 'openOptions', page: 'books' }); },
    extractCurrentPage: () => extractCurrentPage().then(() => {}),
  };

  let geoTimer = null;
  hostAPI.onGeometry = (g) => {
    clearTimeout(geoTimer);
    geoTimer = setTimeout(() => {
      geoTimer = null;
      store.patchSettings({ display: { float: g } }).catch(() => {});
    }, 300);
  };

  // ---------- 打开 / 隐藏 ----------
  async function bootstrapContent() {
    contentBootstrapped = true;
    const cur = await store.getCurrent();
    if (cur.bookId) {
      try {
        const ch = await send('book.getChapter', { bookId: cur.bookId, index: 0 });
        if (ch) {
          await reader.openBook(cur.bookId);
          return;
        }
      } catch (e) { /* 书已不存在，回退空状态 */ }
    }
    reader.renderEmpty();
  }

  async function openReader(opts, existingRequestId) {
    const requestId = Number.isInteger(existingRequestId) ? existingRequestId : beginOpenRequest();
    await loadAuthoritativeSettingsBeforeFirstOpen();
    if (!canFinishOpen(requestId) || (opts.viaHover && !edgePanelTriggerEnabled())) {
      if (!pageReaderEnabled()) reader.hide({ notify: false, reason: 'sidebar-mode' });
      return false;
    }
    emergency = false; // 主动打开即解除紧急隐藏
    hideDelay.cancel();
    if (!contentBootstrapped) await bootstrapContent();
    if (!canFinishOpen(requestId)) return false;
    reader.show(opts);
    return true;
  }

  async function toggleReader() {
    if (reader.isVisible()) {
      cancelPendingOpen();
      hideDelay.cancel();
      reader.hide();
    } else await openReader({});
  }

  function emergencyHide() {
    cancelPendingOpen();
    emergency = true;
    clearTimeout(showTimer);
    showTimer = null;
    hideDelay.cancel();
    reader.hide();
  }

  async function openBookMessage(bookId) {
    const requestId = beginOpenRequest();
    await loadAuthoritativeSettingsBeforeFirstOpen();
    if (!canFinishOpen(requestId)) return false;
    contentBootstrapped = true;
    emergency = false;
    await reader.openBook(bookId);
    if (!canFinishOpen(requestId)) return false;
    return openReader({}, requestId);
  }

  async function openWebBookMessage(msg) {
    const requestId = beginOpenRequest();
    try {
      await loadAuthoritativeSettingsBeforeFirstOpen();
      if (!canFinishOpen(requestId)) return false;
      contentBootstrapped = true; // 内容由在线书提供，跳过书库自动加载
      const data = msg.useCurrentPage ? extractLoadedPage() : await fetchAndExtract(msg.url);
      if (!data) throw new Error('未解析到正文');
      if (!canFinishOpen(requestId)) return false;
      const url = msg.useCurrentPage ? location.href : msg.url;
      await reader.openWeb(Object.assign({}, data, {
        url,
        bookUrl: msg.bookUrl || null,
        title: msg.bookTitle || data.title,
      }));
      if (!canFinishOpen(requestId)) return false;
      return openReader({}, requestId);
    } catch (err) {
      if (!canFinishOpen(requestId)) return false;
      reader.renderEmpty();
      await openReader({}, requestId);
      reader.toast('打开在线书失败：' + String(err && err.message || err));
      throw err;
    }
  }

  async function openCurrentPageMessage() {
    const requestId = beginOpenRequest();
    await loadAuthoritativeSettingsBeforeFirstOpen();
    if (!canFinishOpen(requestId)) return false;
    contentBootstrapped = true;
    const data = await extractCurrentPage();
    if (!data || !canFinishOpen(requestId)) return false;
    return openReader({}, requestId);
  }

  // ---------- 悬浮触发 ----------
  function inEdgeStrip(x, y, t) {
    const W = window.innerWidth, H = window.innerHeight;
    const th = Math.max(4, t.thickness);
    const vLim = H * t.vLimit;
    const hLim = W * t.vLimit;
    switch (t.edge) {
      case 'left': return x <= th && y > vLim && y < H - vLim;
      case 'top': return y <= th && x > hLim && x < W - hLim;
      case 'bottom': return y >= H - th && x > hLim && x < W - hLim;
      default: return x >= W - th && y > vLim && y < H - vLim; // right
    }
  }

  document.addEventListener('mousemove', (e) => {
    if (!settings || !reader || !edgePanelTriggerEnabled()) return;
    const t = settings.trigger;
    if (!t.hover || emergency || reader.isVisible() || reader.isCollapsed()) {
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      return;
    }
    const inHotZone = inEdgeStrip(e.clientX, e.clientY, t);
    if (!edgeTrigger.observe(inHotZone)) {
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      return;
    }
    if (!showTimer) {
      showTimer = setTimeout(() => {
        showTimer = null;
        openReader({ viaHover: true }).catch(() => {});
      }, t.showDelay);
    }
  }, { passive: true, capture: true });

  // ---------- 托盘 ----------
  function buildTray() {
    if (trayEl) { trayEl.remove(); trayEl = null; }
    if (!settings || !settings.trigger.tray || !edgePanelTriggerEnabled()) return;
    trayEl = document.createElement('div');
    const t = settings.trigger;
    Object.assign(trayEl.style, {
      position: 'fixed',
      width: '5px',
      height: '44px',
      borderRadius: '3px',
      background: 'rgba(128,128,132,0.28)',
      cursor: 'pointer',
      zIndex: '2147483646',
      transition: 'background .15s, width .15s',
    });
    positionTray();
    trayEl.addEventListener('pointerenter', () => {
      trayEl.style.background = 'rgba(128,128,132,0.55)';
      if (emergency) return; // 紧急隐藏时悬浮不得触发
      openReader({ viaHover: true }).catch(() => {});
    });
    trayEl.addEventListener('pointerleave', () => {
      trayEl.style.background = 'rgba(128,128,132,0.28)';
    });
    trayEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleReader().catch(() => {});
    });
    shadow.appendChild(trayEl);
  }

  function positionTray() {
    if (!trayEl) return;
    const t = settings.trigger;
    const top = Math.round(window.innerHeight * Math.min(0.95, Math.max(0.05, t.trayPos)));
    trayEl.style.top = top + 'px';
    trayEl.style.transform = 'translateY(-50%)';
    if (t.trayEdge === 'left') { trayEl.style.left = '0'; trayEl.style.right = 'auto'; }
    else { trayEl.style.right = '0'; trayEl.style.left = 'auto'; }
    trayEl.style.display = reader && reader.isVisible() ? 'none' : '';
  }

  // ---------- 键盘 ----------
  document.addEventListener('keydown', (e) => {
    if (!reader || e.repeat) return;
    const active = reader.isVisible() || reader.isCollapsed();
    if (!active) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    const t0 = path[0];
    if (t0 && t0 !== document && t0 !== document.body) {
      const tag = t0.tagName || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || t0.isContentEditable) return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideDelay.cancel();
      reader.hide(); // 面板或小圆点都会被清除
      return;
    }
    if (!reader.isVisible() || !pointerInPanel) return;
    switch (e.key) {
      case 'PageDown':
      case ' ':
        e.preventDefault(); e.stopPropagation(); reader.pageDown(); break;
      case 'PageUp':
        e.preventDefault(); e.stopPropagation(); reader.pageUp(); break;
      case 'ArrowRight':
        e.preventDefault(); e.stopPropagation(); reader.nextChapter(); break;
      case 'ArrowLeft':
        e.preventDefault(); e.stopPropagation(); reader.prevChapter(); break;
    }
  }, true);

  // ---------- 消息 ----------
  function dispatchMessage(msg, sender, sendResponse) {
    switch (msg.type) {
      case 'command': {
        (async () => {
          if (msg.command === 'toggle-reader') await toggleReader();
          else if (msg.command === 'emergency-hide') emergencyHide();
          else if (msg.command === 'next-chapter' && reader.isVisible()) reader.nextChapter();
          else if (msg.command === 'prev-chapter' && reader.isVisible()) reader.prevChapter();
          sendResponse({ ok: true });
        })().catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;
      }

      case 'toggle':
        toggleReader()
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;

      case 'emergency':
        emergencyHide();
        sendResponse({ ok: true });
        return false;

      case 'open':
        openBookMessage(msg.bookId)
          .then((opened) => sendResponse({
            ok: opened,
            error: opened ? undefined : '当前打开方式不使用页面阅读窗',
          }))
          .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;

      case 'openWeb':
        openCurrentPageMessage()
          .then((opened) => sendResponse({
            ok: opened,
            error: opened ? undefined : '当前页面未打开阅读窗',
          }))
          .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;

      case 'readerUi.sync':
        applyUiSnapshot(msg.snapshot);
        sendResponse({ ok: true });
        return false;

      case 'readerUi.hidePanel':
        if (acceptUiCommandRevision(msg.revision)) {
          cancelPendingOpen();
          if (reader.getPresentation() === 'panel') {
            reader.hide({ notify: false, reason: 'sync-hide' });
          }
        }
        sendResponse({ ok: true });
        return false;

      case 'readerUi.openPanel':
        if (!acceptUiCommandRevision(msg.revision)) {
          sendResponse({ ok: true });
          return false;
        }
        openReader({ notify: false, reason: 'sync-open' })
          .then((opened) => sendResponse({
            ok: opened,
            error: opened ? undefined : '阅读窗打开已取消',
          }))
          .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;

      case 'getState':
        sendResponse({
          ok: true,
          data: {
            visible: reader.isVisible(),
            emergency,
            state: reader.getState(),
          },
        });
        return false;

      case 'extractPage': // 供侧边栏 / 后台调用
        (async () => {
          try {
            const rules = rulesFor(location.hostname);
            const data = extractor.extract(document, rules, location.href);
            sendResponse({ ok: !!data, data: data ? Object.assign({ url: location.href }, data) : null });
          } catch (err) {
            sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true;

      case 'fetchAndExtract':
        fetchAndExtract(msg.url)
          .then((data) => sendResponse({ ok: true, data }))
          .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;

      case 'fetchCatalog':
        fetchCatalog(msg.url)
          .then((data) => sendResponse({ ok: true, data }))
          .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;

      case 'openWebBook': // 从书库打开在线书
        openWebBookMessage(msg)
          .then((opened) => sendResponse({
            ok: opened,
            error: opened ? undefined : '当前打开方式不使用页面阅读窗',
          }))
          .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
        return true;

      default:
        return false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (!reader) {
      // 注入后立刻收到快捷键/按钮消息时，等待异步初始化完成而非静默丢弃。
      readerReady.then(() => {
        if (!reader) sendResponse({ ok: false, error: readerInitError || '阅读器初始化失败' });
        else dispatchMessage(msg, sender, sendResponse);
      });
      return true;
    }
    return dispatchMessage(msg, sender, sendResponse);
  });

  // ---------- 进度落盘时机 ----------
  window.addEventListener('pagehide', () => {
    cancelPendingOpen();
    reader && reader.flushProgress();
  });
  document.addEventListener('visibilitychange', () => {
    if (!reader) return;
    if (!document.hidden) {
      scheduleReaderUiRegistration();
      return;
    }
    cancelPendingOpen();
    reader.flushProgress();
    if (reader.getPresentation() === 'panel') reader.hide({ reason: 'visibility' });
  });
  window.addEventListener('pageshow', () => { if (reader) scheduleReaderUiRegistration(); });

  // ---------- 初始化 ----------
  (async function init() {
    try {
    settings = await store.getSettings();

    reader = globalThis.VeilRead.createReader({
      mount: shadow,
      env: 'content',
      host: hostAPI,
    });
    reader.applySettings(settings);

    // 面板进入/离开：自动隐藏或收起为小图标
    reader.panel.addEventListener('pointerenter', () => {
      pointerInPanel = true;
      hideDelay.cancel();
    });
    reader.panel.addEventListener('pointerleave', () => {
      pointerInPanel = false;
      hideDelay.cancel();
      const action = globalThis.VeilRead.readerUtils.getPanelAutoHideAction(settings, reader.el.dataset.mode);
      if (!action) return;
      hideDelay.schedule(() => {
        if (action === 'collapse') reader.collapse();
        else reader.hide();
      }, settings.trigger.autoHideDelay);
    });

    document.documentElement.appendChild(hostEl);
    buildTray();

    // 窗口尺寸变化后重新约束面板位置与宽度
    window.addEventListener('resize', () => {
      edgeTrigger.onResize();
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      if (reader) reader.applySettings(settings);
      positionTray();
    }, { passive: true });

    store.onSettingsChanged((s) => {
      const previousMode = settings && settings.display && settings.display.mode;
      const nextMode = s && s.display && s.display.mode;
      settingsGeneration += 1;
      firstOpenSettingsPromise = null;
      if (previousMode !== nextMode) {
        cancelPendingOpen();
        edgeTrigger.onResize();
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      }
      settings = s;
      hideDelay.cancel();
      reader.applySettings(s);
      buildTray();
    });

    await registerReaderUi();
    } catch (err) {
      readerInitError = '读取设置失败';
    } finally {
      resolveReaderReady();
    }
  })();
})();
