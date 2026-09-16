// 测试专用：chrome API 桩（仅本地 harness 使用，不属于扩展运行时代码）
(function () {
  window.__errs = [];
  window.addEventListener('error', (e) => window.__errs.push('ERR: ' + e.message + ' @ ' + (e.filename || '') + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => window.__errs.push('REJ: ' + String(e.reason && e.reason.stack || e.reason)));

  if (window.chrome && window.chrome.storage) return;
  const mem = {};
  window.__chromeMem = mem;

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...mem };
          if (typeof keys === 'string') return keys in mem ? { [keys]: clone(mem[keys]) } : {};
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) if (k in mem) out[k] = clone(mem[k]);
            return out;
          }
          const out = {};
          for (const k of Object.keys(keys || {})) out[k] = k in mem ? clone(mem[k]) : clone(keys[k]);
          return out;
        },
        async set(items) { Object.assign(mem, JSON.parse(JSON.stringify(items))); },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete mem[k];
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        const res = { ok: true, data: null };
        setTimeout(() => cb && cb(res), 0);
      },
      openOptionsPage: async () => {},
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com/page.html', active: true, currentWindow: true }],
      sendMessage: (tabId, msg, cb) => setTimeout(() => cb && cb({ ok: true, data: null }), 0),
      create: async (o) => ({ id: 2, ...o }),
    },
    sidePanel: { open: async () => {} },
    contextMenus: { removeAll: async () => {}, create() {} },
    commands: { onCommand: { addListener() {} } },
  };
})();
