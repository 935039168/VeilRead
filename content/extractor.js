// VeilRead — 网页正文提取（readability 简化版 + 站点自定义规则）
// 在 content script 中运行，纯只读，不修改页面 DOM
(globalThis.VeilRead = globalThis.VeilRead || {}).extractor = (function () {
  'use strict';

  const NEGATIVE_RE = /(comment|commb|footer|foot\b|widget|sidebar|promote|promo|related|recommend|share|advert|ads\b|banner|nav\b|menu|header|breadcrumb|pagination|pager|toolbar|login|signup|copyright|repost|social|feed|popup|modal)/i;
  const POSITIVE_RE = /(article|body|content|entry|main|post|text|chapter|txt|novel|read|book)/i;

  const NEXT_RE = /^(?:下一[章页回部分节]|下章|后一章|next(?:\s*(?:chapter|page))?|›{1,3}|»{1,3}|>{2})[\s :：（）()›»>]*$/i;
  const PREV_RE = /^(?:上一[章页回部分节]|上章|前一章|prev(?:iou)?(?:\s*(?:chapter|page))?|‹{1,3}|«{1,3}|<{2})[\s :：（）()‹«<]*$/i;
  const CATALOG_RE = /^(?:返回目录|回到目录|查看目录|章节目录|全部章节|目录页|章节列表|作品目录|目录|catalog)[\s :：（）()›»>]*$/i;
  const NAV_NOISE_RE = /^(?:首页|下一页|上一页|返回|下一章|上一章|末页|尾页|顶页|首页|登录|注册|书架|设置|繁體|繁体|简体|展开|收起|全部|\d+\/\d+|继续阅读|开始阅读|加入书签|推荐票|下载APP|手机阅读)$/;

  function classIdScore(el) {
    const s = (el.className && String(el.className)) + ' ' + (el.id || '');
    if (!s.trim()) return 0;
    let score = 0;
    if (NEGATIVE_RE.test(s)) score -= 60;
    if (POSITIVE_RE.test(s)) score += 30;
    return score;
  }

  function textLen(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().length;
  }

  function linkDensity(el) {
    const total = textLen(el);
    if (!total) return 1;
    let linkText = 0;
    for (const a of el.querySelectorAll('a')) linkText += textLen(a);
    return Math.min(1, linkText / total);
  }

  // ---------- 打分选正文容器 ----------
  function pickContainer(doc) {
    const body = doc.body;
    if (!body) return null;

    const paras = body.querySelectorAll('p, div, blockquote, td');
    const scores = new Map(); // el -> score

    function add(el, v) {
      if (!el || el === doc || el === doc.documentElement) return;
      scores.set(el, (scores.get(el) || 0) + v);
    }

    for (const p of paras) {
      // 只把“自身直接持有文本”的块当段落
      let own = 0;
      for (const n of p.childNodes) {
        if (n.nodeType === 3) own += (n.textContent || '').trim().length;
        else if (n.nodeType === 1 && /^(A|SPAN|B|I|EM|STRONG|U|SMALL|SUB|SUP|FONT)$/.test(n.tagName)) own += textLen(n);
      }
      if (own < 25) continue;

      const pTag = p.tagName;
      let base = pTag === 'P' ? 1.2 : pTag === 'BLOCKQUOTE' ? 1 : pTag === 'TD' ? 0.6 : 0.9;
      const s = (1 + Math.min(own, 400) / 25) * base * (1 - linkDensity(p));
      if (s <= 0) continue;
      add(p, s);
      add(p.parentElement, s);
      add(p.parentElement && p.parentElement.parentElement, s * 0.4);
    }

    let best = null, bestScore = 0;
    for (const [el, v] of scores) {
      const tag = el.tagName;
      let adj = v;
      if (tag === 'ARTICLE' || tag === 'MAIN') adj += 60;
      adj += classIdScore(el);
      if (adj > bestScore) { bestScore = adj; best = el; }
    }
    if (!best) return null;

    // 若最优者是段落本身，取其父容器
    if (/^(P|BLOCKQUOTE)$/.test(best.tagName) && best.parentElement && best.parentElement !== body) {
      best = best.parentElement;
    }
    // 兄弟节点扩充：相邻且分数不低的块一起收入
    const wrap = doc.createElement('div');
    const parent = best.parentElement || body;
    const bestAdj = (scores.get(best) || 0) + classIdScore(best);
    for (const sib of Array.from(parent.children)) {
      if (sib === best) { wrap.appendChild(sib.cloneNode(true)); continue; }
      const sc = (scores.get(sib) || 0) + classIdScore(sib);
      const tl = textLen(sib);
      if (sc >= bestAdj * 0.2 && tl > 80 && linkDensity(sib) < 0.5) {
        wrap.appendChild(sib.cloneNode(true));
      }
    }
    // 返回克隆正文 + 原始节点（用于就近找标题 / 上下章链接）
    return { wrap, best };
  }

  // ---------- 白名单序列化 ----------
  const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'BLOCKQUOTE', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'IMG', 'PRE', 'CODE']);
  const UNWRAP = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'SPAN', 'FONT', 'FIGURE', 'TD', 'TR', 'TABLE', 'TBODY', 'THEAD', 'A', 'BUTTON', 'LABEL', 'SMALL', 'SUB', 'SUP', 'CENTER', 'RUBY', 'RT', 'RP', 'NOBR', 'TIME', 'ABBR', 'CITE', 'Q', 'DFN', 'VAR', 'KBD', 'SAMP', 'MARK', 'INS', 'DEL']);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pickImgSrc(img, baseUrl) {
    const cands = ['data-src', 'data-original', 'data-lazy-src', 'data-echo', '_src', 'data-actualsrc', 'src'];
    for (const attr of cands) {
      const v = img.getAttribute && img.getAttribute(attr);
      if (v && !/^data:image\/svg/i.test(v)) {
        try { return new URL(v, baseUrl || undefined).href; } catch (e) { /* skip */ }
      }
    }
    return null;
  }

  function isHidden(el) {
    if (!el.getAttribute) return false;
    if (el.getAttribute('hidden') != null) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const style = el.getAttribute('style') || '';
    return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
  }

  // 返回白名单 HTML 字符串（限长，防止超大输出）
  function sanitize(root, baseUrl) {
    let out = '';
    let count = 0;
    const LIMIT = 400000;

    function hasBlockChild(el) {
      for (const c of el.children) {
        if (ALLOWED.has(c.tagName) || c.tagName === 'DIV') return true;
      }
      return false;
    }

    function walk(node) {
      if (out.length > LIMIT || count > 4000) return;
      if (node.nodeType === 3) {
        const t = node.textContent;
        if (t.trim()) { out += escapeHtml(t); count++; }
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (isHidden(node)) return;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'FORM' || tag === 'INPUT' ||
          tag === 'NAV' || tag === 'ASIDE' || tag === 'FOOTER' || tag === 'HEADER' || tag === 'SVG' ||
          tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;

      if (tag === 'IMG') {
        const src = pickImgSrc(node, baseUrl);
        if (src && /^https?:|^data:image\//i.test(src)) {
          const alt = node.getAttribute('alt') || '';
          out += `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`;
          count++;
        }
        return;
      }

      if (tag === 'BR') { out += '<br>'; return; }
      if (tag === 'HR') { out += '<hr>'; count++; return; }

      if (ALLOWED.has(tag)) {
        if (tag === 'UL' || tag === 'OL') {
          out += `<${tag.toLowerCase()}>`;
          for (const c of node.children) if (c.tagName === 'LI') { out += '<li>'; walkChildren(c); out += '</li>'; }
          out += `</${tag.toLowerCase()}>`;
          count++;
          return;
        }
        const t = tag.toLowerCase();
        out += `<${t}>`;
        walkChildren(node);
        out += `</${t}>`;
        count++;
        return;
      }

      // div/td/span 等：无块级子节点时视为一个段落，否则解包
      if (UNWRAP.has(tag) && !hasBlockChild(node)) {
        const own = (node.textContent || '').trim();
        if (own) {
          out += '<p>';
          walkChildren(node);
          out += '</p>';
          count++;
        }
        return;
      }
      walkChildren(node);
    }

    function walkChildren(node) {
      for (const c of Array.from(node.childNodes)) walk(c);
    }

    walk(root);
    return out;
  }

  // ---------- 标题 ----------
  function findHeading(scope) {
    if (!scope || !scope.querySelectorAll) return null;
    for (const h of scope.querySelectorAll('h1, h2, h3')) {
      const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && t.length <= 60) return t;
    }
    return null;
  }

  function guessTitle(doc, contentNode) {
    // 正文内或紧邻容器优先（章节标题通常在正文旁）
    const fromContent = findHeading(contentNode) ||
      (contentNode && contentNode.parentElement ? findHeading(contentNode.parentElement) : null);
    if (fromContent) return fromContent;

    const meta = doc.querySelector('meta[property="og:title"], meta[name="og:title"]');
    if (meta && meta.content && meta.content.trim()) return meta.content.trim().slice(0, 80);

    const dt = (doc.title || '').replace(/\s+/g, ' ').trim();
    return dt ? dt.slice(0, 80) : '网页正文';
  }

  // ---------- 上一章 / 下一章 ----------
  function resolveHref(a, baseUrl) {
    const href = a && a.getAttribute('href');
    if (!href || href === '#' || /^javascript:/i.test(href)) return null;
    try { return new URL(href, baseUrl || undefined).href; } catch (e) { return null; }
  }

  function scanLinks(doc, contentNode, baseUrl) {
    let prev = null, next = null;
    const scope = contentNode && contentNode.parentElement ? contentNode.parentElement : doc.body || doc.documentElement;
    const links = [
      ...scope.querySelectorAll('a[href]'),
      ...((doc.body || doc).querySelectorAll('a[rel="next"], a[rel="prev"]')),
    ];
    for (const a of links) {
      if (prev && next) break;
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12);
      const title = (a.getAttribute('title') || '').trim().slice(0, 12);
      const href = resolveHref(a, baseUrl);
      if (!href) continue;
      if (!next && (rel === 'next' || NEXT_RE.test(text) || NEXT_RE.test(title))) next = href;
      else if (!prev && (rel === 'prev' || PREV_RE.test(text) || PREV_RE.test(title))) prev = href;
    }
    return { prev, next };
  }

  // 找“目录”链接（章节列表页）
  function findCatalog(doc, contentNode, baseUrl) {
    const scope = contentNode && contentNode.parentElement
      ? contentNode.parentElement
      : (doc.body || doc.documentElement);
    const links = [
      ...scope.querySelectorAll('a[href]'),
      ...(doc.body ? doc.body.querySelectorAll('a[rel="contents"]') : []),
    ];
    for (const a of links) {
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12);
      if (rel === 'contents' || CATALOG_RE.test(text)) {
        const href = resolveHref(a, baseUrl);
        if (href) return href;
      }
    }
    return null;
  }

  // 解析目录页：返回 [{t, url}]
  // 启发式：把链接按“归属容器”（最近的包含 ≥3 个链接的祖先）分组，链接最多的组即章节列表
  function extractCatalog(doc, baseUrl) {
    const all = Array.from(doc.querySelectorAll('a[href]'));
    if (!all.length) return null;

    const groups = new Map(); // 容器 -> 链接数
    const linkCounts = new Map();
    const countLinks = (el) => {
      if (!linkCounts.has(el)) linkCounts.set(el, el.querySelectorAll('a').length);
      return linkCounts.get(el);
    };
    for (const a of all) {
      let p = a.parentElement;
      let key = doc.body || doc.documentElement;
      while (p && p !== doc.documentElement) {
        if (countLinks(p) >= 3) { key = p; break; }
        p = p.parentElement;
      }
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    let scope = null, bestCount = 0;
    for (const [el, n] of groups) {
      if (n > bestCount) { bestCount = n; scope = el; }
    }
    if (!scope) scope = doc.body || doc.documentElement;

    const out = [];
    const seen = new Set();
    for (const a of scope.querySelectorAll('a[href]')) {
      const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 2 || t.length > 60) continue;
      if (NAV_NOISE_RE.test(t)) continue;
      const href = resolveHref(a, baseUrl);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      out.push({ t, url: href });
      if (out.length >= 4000) break;
    }
    return out.length ? out : null;
  }

  // ---------- 规则匹配 ----------
  function findRules(sites, hostname) {
    if (!sites || !hostname) return null;
    let best = null;
    for (const r of sites) {
      const d = (r.domain || '').trim().toLowerCase();
      if (!d) continue;
      if (hostname === d || hostname.endsWith('.' + d)) {
        // 子域规则比父域规则更具体，应优先使用。
        if (!best || d.length > String(best.domain || '').trim().length) best = r;
      }
    }
    return best;
  }

  // ---------- 主入口 ----------
  // doc: Document（页面或 DOMParser 结果）；baseUrl 用于补全链接
  // 返回 {title, html, prev, next} 或 null
  function extract(doc, rules, baseUrl) {
    if (!doc || !doc.body) return null;

    // 自定义规则优先
    if (rules && rules.content) {
      let node = null;
      try { node = doc.querySelector(rules.content); } catch (e) { node = null; }
      if (node) {
        const clone = node.cloneNode(true);
        if (rules.remove) {
          for (const sel of String(rules.remove).split(',')) {
            const s = sel.trim();
            if (s) { try { clone.querySelectorAll(s).forEach((n) => n.remove()); } catch (e) { /* 非法选择器忽略 */ } }
          }
        }
        let title = null;
        if (rules.title) {
          let t = null;
          try { t = doc.querySelector(rules.title); } catch (e) { t = null; }
          if (t) title = (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        }
        const html = sanitize(clone, baseUrl);
        if (html.replace(/<[^>]+>/g, '').trim().length >= 40) {
          const links = { prev: null, next: null };
          if (rules.prev) { try { links.prev = resolveHref(doc.querySelector(rules.prev), baseUrl); } catch (e) { /* fallback */ } }
          if (rules.next) { try { links.next = resolveHref(doc.querySelector(rules.next), baseUrl); } catch (e) { /* fallback */ } }
          if (!links.prev || !links.next) {
            const auto = scanLinks(doc, clone, baseUrl);
            links.prev = links.prev || auto.prev;
            links.next = links.next || auto.next;
          }
          let catalog = null;
          if (rules.catalog) {
            try { catalog = resolveHref(doc.querySelector(rules.catalog), baseUrl); } catch (e) { /* fallback */ }
          }
          catalog = catalog || findCatalog(doc, clone, baseUrl);
          return { title: title || guessTitle(doc, clone), html, prev: links.prev, next: links.next, catalog };
        }
      }
      // 规则未命中，回退自动提取
    }

    const picked = pickContainer(doc);
    if (!picked) return null;
    const html = sanitize(picked.wrap, baseUrl);
    const plain = html.replace(/<[^>]+>/g, '').trim();
    if (plain.length < 60) return null;

    const title = guessTitle(doc, picked.best);
    const links = scanLinks(doc, picked.best, baseUrl);
    const catalog = findCatalog(doc, picked.best, baseUrl);
    return { title, html, prev: links.prev, next: links.next, catalog };
  }

  return { extract, findRules, guessTitle, extractCatalog };
})();
