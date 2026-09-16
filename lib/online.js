// VeilRead — 在线章节加载的纯工具：同源校验、大小上限与超时
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VeilRead = root.VeilRead || {};
  root.VeilRead.online = api;
})(globalThis, function () {
  'use strict';

  const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
  const DEFAULT_TIMEOUT_MS = 15000;

  function validateReadableUrl(targetUrl, baseUrl) {
    let target, base;
    try {
      target = new URL(targetUrl, baseUrl);
      base = new URL(baseUrl);
    } catch (e) {
      throw new Error('章节链接无效');
    }
    if (!/^https?:$/.test(target.protocol)) throw new Error('章节链接无效');
    if (target.origin !== base.origin) throw new Error('为保护登录和隐私，只能自动加载同一网站的章节');
    return target.href;
  }

  function assertResponseSize(value, maxBytes) {
    const n = Number(value);
    if (Number.isFinite(n) && n > maxBytes) throw new Error('页面内容过大，已停止加载');
  }

  function normalizeHttpUrl(value, label) {
    let url;
    try { url = new URL(String(value || '').trim()); }
    catch (e) { throw new Error(`${label}无效`); }
    if (!/^https?:$/.test(url.protocol)) throw new Error(`${label}仅支持 HTTP(S)`);
    return url.href;
  }

  function normalizeWebBookConfig(input) {
    const source = input || {};
    const chapterUrl = normalizeHttpUrl(source.chapterUrl, '起始章节链接');
    const bookUrl = String(source.bookUrl || '').trim()
      ? normalizeHttpUrl(source.bookUrl, '目录/书籍链接')
      : chapterUrl;
    const title = String(source.title || '').trim() || new URL(bookUrl).hostname;
    return { title, chapterUrl, bookUrl };
  }

  function shouldOpenOnlineInNewTab(targetUrl, currentUrl) {
    try { return new URL(targetUrl).origin !== new URL(currentUrl).origin; }
    catch (e) { return true; }
  }

  async function fetchText(url, opts) {
    const o = opts || {};
    const maxBytes = o.maxBytes || DEFAULT_MAX_BYTES;
    const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await (o.fetchFn || fetch)(url, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('网站返回 HTTP ' + res.status);
      assertResponseSize(res.headers && res.headers.get('content-length'), maxBytes);
      if (!res.body || !res.body.getReader) return await res.text();

      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw new Error('页面内容过大，已停止加载');
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return new TextDecoder().decode(bytes);
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('加载超时，请稍后重试');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    validateReadableUrl, assertResponseSize, normalizeHttpUrl, normalizeWebBookConfig,
    shouldOpenOnlineInNewTab, fetchText, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS,
  };
});
