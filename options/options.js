// VeilRead — 设置中心
'use strict';
const store = globalThis.VeilRead.store;
const db = globalThis.VeilRead.db;
const txt = globalThis.VeilRead.txt;
const online = globalThis.VeilRead.online;
const FONTS = globalThis.VeilRead.FONTS;

const $ = (id) => document.getElementById(id);
let settings = null;

const THEMES = globalThis.VeilRead.THEMES;


// ---------- 工具 ----------
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function set(patch) {
  store.patchSettings(patch).catch(() => {
    const hint = $('siteRuleHint');
    if (hint) hint.textContent = '设置暂未保存，请稍后重试。';
  });
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 40, g: 40, b: 40 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function bindRange(id, path, fmt, onCommit) {
  const input = $(id);
  const val = $(id + 'Val');
  const commit = debounce(() => {
    const v = parseFloat(input.value);
    const [a, b] = path.split('.');
    set({ [a]: { [b]: v } });
    onCommit && onCommit(v);
  }, 150);
  input.addEventListener('input', () => {
    if (val) val.textContent = fmt(parseFloat(input.value));
    commit();
  });
  input.value = getPath(settings, path);
  if (val) val.textContent = fmt(parseFloat(input.value));
}

function bindSelect(id, path) {
  const sel = $(id);
  sel.addEventListener('change', () => {
    const [a, b] = path.split('.');
    set({ [a]: { [b]: sel.value } });
  });
  sel.value = getPath(settings, path);
}

function bindCheck(id, path, onToggle) {
  const c = $(id);
  c.addEventListener('change', () => {
    const [a, b] = path.split('.');
    set({ [a]: { [b]: c.checked } });
    onToggle && onToggle(c.checked);
  });
  c.checked = !!getPath(settings, path);
  onToggle && onToggle(c.checked);
}

// ---------- 外观：三种 UI 形态各自独立的样式 ----------
let styleTarget = 'edge'; // float | edge | sidebar

function myStyle() {
  if (!settings.display.styles) settings.display.styles = { float: {}, edge: {}, sidebar: {} };
  if (!settings.display.styles[styleTarget]) settings.display.styles[styleTarget] = {};
  return settings.display.styles[styleTarget];
}

function setMyStyle(patchObj) {
  Object.assign(myStyle(), patchObj);
  set({ display: { styles: { [styleTarget]: patchObj } } });
  updatePreview();
}

function refreshStyleControls() {
  const m = myStyle();
  const d = settings.display;
  $('color').value = m.color != null ? m.color : (d.color || '#1a1a1a');
  $('bgColor').value = m.bgColor != null ? m.bgColor : (d.bgColor || '#ffffff');
  const op = m.opacity != null ? m.opacity : (d.opacity != null ? d.opacity : 0.9);
  $('opacity').value = op;
  $('opacityVal').textContent = Math.round(op * 100) + '%';
  $('glass').checked = m.glass != null ? m.glass : d.glass !== false;
  for (const chip of document.querySelectorAll('#themeChips .chip')) {
    const th = THEMES.find((item) => item.name === chip.dataset.theme);
    const active = !!th && m.color === th.color && m.bgColor === th.bg;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

// ---------- 预览 ----------
const updatePreview = debounce(function updatePreviewNow() {
  const d = settings.display;
  const m = myStyle();
  const p = $('preview');
  p.style.fontFamily = FONTS[d.font] || FONTS.sans;
  p.style.fontSize = d.fontSize + 'px';
  p.style.lineHeight = d.lineHeight;
  p.style.color = m.color != null ? m.color : d.color;
  const bg = m.bgColor != null ? m.bgColor : d.bgColor;
  const op = m.opacity != null ? m.opacity : d.opacity;
  const rgb = hexToRgb(bg);
  p.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(1, Math.max(0.01, op))})`;
  const glass = m.glass != null ? m.glass : d.glass;
  p.style.backdropFilter = (op < 0.98 && glass !== false) ? 'blur(8px)' : 'none';
  for (const para of p.querySelectorAll('p')) {
    para.style.textIndent = d.indent ? '2em' : '0';
  }
}, 40);

// ---------- 界面主题（白天 / 夜间）----------
function applyUiTheme(theme) {
  const night = theme === 'night';
  document.documentElement.dataset.theme = night ? 'night' : 'day';
  const b = $('btnTheme');
  if (b) b.textContent = night ? '☾ 夜间模式' : '☀ 白天模式';
}

// ---------- 分区切换 ----------
function switchSection(name) {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.sec === name);
  });
  document.querySelectorAll('.sec').forEach((s) => {
    s.classList.toggle('active', s.id === 'sec-' + name);
  });
}

// ---------- 站点规则 ----------
const SITE_FIELDS = [
  { key: 'domain', label: '域名', ph: 'example.com', req: true },
  { key: 'content', label: '正文', ph: '.novel-text, #content', req: true },
  { key: 'title', label: '标题', ph: 'h1（可选）' },
  { key: 'prev', label: '上一章', ph: 'a.prev（可选）' },
  { key: 'next', label: '下一章', ph: 'a.next（可选）' },
  { key: 'catalog', label: '目录', ph: 'a.catalog（可选）' },
  { key: 'remove', label: '移除', ph: '.ads, .recommend（可选，逗号分隔）' },
];

function siteCard(rule, index) {
  const card = document.createElement('div');
  card.className = 'site-card';
  card.dataset.index = index;

  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const f of SITE_FIELDS) {
    const lab = document.createElement('label');
    lab.textContent = f.label;
    if (f.req) {
      const r = document.createElement('span');
      r.className = 'req';
      r.textContent = '必填';
      lab.appendChild(r);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = f.ph;
    input.value = (rule && rule[f.key]) || '';
    input.dataset.key = f.key;
    input.id = `site-${index}-${f.key}`;
    lab.htmlFor = input.id;
    grid.append(lab, input);
  }
  card.appendChild(grid);

  const ops = document.createElement('div');
  ops.className = 'ops';
  const del = document.createElement('button');
  del.className = 'btn danger';
  del.textContent = '删除此规则';
  del.onclick = () => {
    const rules = readSiteRules();
    rules.splice(index, 1);
    set({ sites: rules.filter((r) => r.domain && r.content) });
    renderSites(rules);
  };
  ops.appendChild(del);
  card.appendChild(ops);
  return card;
}

function readSiteRules() {
  const rules = [];
  for (const card of document.querySelectorAll('#siteList .site-card')) {
    const rule = {};
    for (const input of card.querySelectorAll('input[data-key]')) {
      rule[input.dataset.key] = input.value.trim();
    }
    rules.push(rule);
  }
  return rules;
}

const commitSites = debounce(() => {
  const rules = readSiteRules();
  const errors = [];
  for (const card of document.querySelectorAll('#siteList .site-card')) {
    for (const input of card.querySelectorAll('input[data-key]')) {
      const value = input.value.trim();
      const isSelector = input.dataset.key !== 'domain' && value;
      let error = '';
      if (isSelector) {
        for (const part of (input.dataset.key === 'remove' ? value.split(',') : [value])) {
          const selector = part.trim();
          if (!selector) continue;
          try { document.createDocumentFragment().querySelector(selector); }
          catch (e) { error = '存在无效的 CSS 选择器'; break; }
        }
      }
      input.setCustomValidity(error);
      input.classList.toggle('invalid', !!error);
      if (error) errors.push(error);
    }
  }
  $('siteRuleHint').textContent = errors.length ? `${errors[0]}；修正后才会保存。` : '';
  if (!errors.length) set({ sites: rules.filter((r) => r.domain && r.content) });
}, 400);

function renderSites(rules) {
  const list = $('siteList');
  list.textContent = '';
  if (!rules.length) {
    const empty = document.createElement('p');
    empty.className = 'tip';
    empty.textContent = '暂无自定义规则。内置算法会自动识别大多数小说站与普通网页的正文。';
    list.appendChild(empty);
    return;
  }
  rules.forEach((rule, i) => list.appendChild(siteCard(rule, i)));
}

// ---------- 书库 ----------
function pctOf(meta, prog) {
  if (!prog) return 0;
  return Math.min(100, Math.round(((prog.chapter + (prog.ratio || 0)) / (meta.chapterCount || 1)) * 100));
}

function tabSendViaSW(tab, msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'tabSend', tabId: tab.id, url: tab.url || '', msg }, (res) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (res && res.ok === false) reject(new Error(res.error || '发送失败'));
      else resolve(res ? res.data : null);
    });
  });
}

function webBookInputs(values) {
  const fields = document.createElement('div');
  fields.className = 'web-book-fields';
  const make = (label, value, placeholder) => {
    const field = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder;
    field.append(text, input);
    fields.appendChild(field);
    return input;
  };
  return {
    fields,
    title: make('书名', values.title, '可选；留空时使用网站域名'),
    chapterUrl: make('起始章节链接', values.chapterUrl, 'https://example.com/book/1/chapter/1'),
    bookUrl: make('目录 / 书籍链接', values.bookUrl, '可选；留空时使用起始章节链接'),
  };
}

async function saveWebBookConfig(values, original) {
  const config = online.normalizeWebBookConfig(values);
  const changingIdentity = original && original.bookUrl !== config.bookUrl;
  if (changingIdentity && !window.confirm('修改目录 / 书籍链接会将其视为另一本书，并清除旧书的阅读进度。继续吗？')) {
    return null;
  }
  await db.upsertWeb(config.bookUrl, config.chapterUrl, config.title);
  await store.saveWebBook(config.bookUrl, { lastChapter: config.chapterUrl, title: config.title });
  if (changingIdentity) {
    await db.deleteBook(original.id);
    await store.clearWebBook(original.bookUrl, original.chapterUrl);
  }
  return config;
}

function appendWebBookEditor(row, meta, chapterUrl) {
  const editor = document.createElement('div');
  editor.className = 'web-book-editor';
  const inputs = webBookInputs({ title: meta.title, chapterUrl, bookUrl: meta.url });
  editor.appendChild(inputs.fields);
  const status = document.createElement('span');
  status.className = 'editor-status';
  const actions = document.createElement('div');
  actions.className = 'editor-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn plain';
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.onclick = () => editor.remove();
  const save = document.createElement('button');
  save.className = 'btn';
  save.type = 'button';
  save.textContent = '保存';
  save.onclick = async () => {
    status.textContent = '';
    try {
      const config = await saveWebBookConfig({
        title: inputs.title.value,
        chapterUrl: inputs.chapterUrl.value,
        bookUrl: inputs.bookUrl.value,
      }, { id: meta.id, bookUrl: meta.url, chapterUrl });
      if (!config) return;
      renderBooks();
    } catch (err) {
      status.textContent = String(err && err.message || err);
    }
  };
  actions.append(status, cancel, save);
  editor.appendChild(actions);
  row.appendChild(editor);
  inputs.title.focus();
}

async function renderBooks() {
  const [metas, progMap, webProgMap, webBooks] = await Promise.all([
    db.listMetas(), store.getProgressMap(), store.getWebProgressMap(), store.getWebBooks(),
  ]);
  const list = $('bookList');
  list.textContent = '';

  for (const m of metas) {
    const isWeb = m.type === 'web';
    const prog = progMap[m.id];
    const webBook = isWeb ? webBooks[m.url] : null;
    const webChapter = store.resolveWebChapter(m, webBook);
    const pct = isWeb
      ? (webProgMap[webChapter] ? Math.round((webProgMap[webChapter].ratio || 0) * 100) : 0)
      : pctOf(m, prog);
    const row = document.createElement('div');
    row.className = 'book-row';

    const info = document.createElement('div');
    info.className = 'info';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = (isWeb ? '[在线] ' : '') + m.title;
    const s = document.createElement('div');
    s.className = 's';
    if (isWeb) {
      let host = '';
      try { host = new URL(m.url).hostname; } catch (e) { host = m.url; }
      s.textContent = `在线小说 · ${host} · 已读 ${pct}%` +
        (webProgMap[webChapter] && webProgMap[webChapter].title ? ` · ${webProgMap[webChapter].title}` : '');
    } else {
      s.textContent = `${m.chapterCount} 章 · ${(m.size / 10000).toFixed(1)} 万字 · 已读 ${pct}%` +
        (prog && prog.chapterTitle ? ` · ${prog.chapterTitle}` : '');
    }
    info.append(t, s);

    const ops = document.createElement('div');
    ops.className = 'ops';

    const open = document.createElement('button');
    open.className = 'btn';
    open.textContent = '打开';
    open.onclick = async () => {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = tabs && tabs[0];
      if (tab && tab.id != null) {
        try {
          const msg = isWeb
            ? { type: 'openWebBook', url: webChapter, bookUrl: m.url, bookTitle: m.title }
            : { type: 'open', bookId: m.id };
          if (!isWeb) await store.setCurrent(m.id);
          const res = await tabSendViaSW(tab, msg);
          if (res && res.ok) return;
          throw new Error((res && res.error) || '打开请求未完成');
        } catch (e) {
          window.alert((isWeb ? '打开在线书失败：' : '打开书籍失败：') + String(e && e.message || e || '未知错误'));
          return;
        }
      }
      window.alert('当前标签页不支持注入（浏览器内部页）。请先切换到任意普通网页，再点“打开”。');
    };

    const rename = document.createElement('button');
    rename.className = 'btn plain';
    if (isWeb) {
      rename.textContent = '编辑关键信息';
      rename.onclick = () => {
        const opened = row.querySelector('.web-book-editor');
        if (opened) opened.remove();
        else appendWebBookEditor(row, m, webChapter);
      };
    } else {
      rename.textContent = '重命名';
      rename.onclick = async () => {
        const name = window.prompt('新的书名', m.title);
        if (name && name.trim()) {
          await db.renameBook(m.id, name.trim());
          renderBooks();
        }
      };
    }

    const reset = document.createElement('button');
    reset.className = 'btn plain';
    reset.textContent = '重置进度';
    reset.onclick = async () => {
      if (isWeb) await store.clearWebBook(m.url, webChapter);
      else await store.clearProgress(m.id);
      renderBooks();
    };

    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = '删除';
    del.onclick = async () => {
      if (!window.confirm(`确定删除《${m.title}》？阅读进度将一并清除。`)) return;
      await db.deleteBook(m.id);
      if (isWeb) await store.clearWebBook(m.url, webChapter);
      else await store.clearProgress(m.id);
      const cur = await store.getCurrent();
      if (cur.bookId === m.id) await store.setCurrent(null);
      renderBooks();
    };

    ops.append(open, rename, reset, del);
    row.append(info, ops);
    list.appendChild(row);
  }

  if (!metas.length) {
    const empty = document.createElement('p');
    empty.className = 'tip';
    empty.textContent = '书库为空。导入本地 TXT，或在任意小说网页上用“阅读此页”，在线书会自动记录到这里。';
    list.appendChild(empty);
  }
}

// ---------- 外观字段回填（阅读器快捷样式改动后保持同步） ----------
function isEditing() {
  const ae = document.activeElement;
  return globalThis.VeilRead.readerUtils.shouldDeferAppearanceSync(ae && ae.id);
}

function syncAppearanceInputs() {
  if (isEditing()) return;
  const d = settings.display;
  $('fontSize').value = d.fontSize;
  $('fontSizeVal').textContent = d.fontSize + ' px';
  $('lineHeight').value = d.lineHeight;
  $('lineHeightVal').textContent = Number(d.lineHeight).toFixed(2);
  $('font').value = d.font;
  refreshStyleControls();
}

function bindFloatCheck(id, key) {
  const control = $(id);
  control.addEventListener('change', () => {
    settings.display.float = settings.display.float || {};
    settings.display.float[key] = control.checked;
    set({ display: { float: { [key]: control.checked } } });
  });
  control.checked = !settings.display.float || settings.display.float[key] !== false;
}

// ---------- 初始化 ----------
(async function init() {
  settings = await store.getSettings();
  applyUiTheme(settings.ui && settings.ui.theme);
  $('btnTheme').addEventListener('click', () => {
    const next = (settings.ui && settings.ui.theme) === 'night' ? 'day' : 'night';
    settings.ui = settings.ui || {};
    settings.ui.theme = next;
    applyUiTheme(next);
    set({ ui: { theme: next } });
  });

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.addEventListener('click', () => switchSection(b.dataset.sec));
  });
  const open = await chrome.storage.local.get('vr.openSection');
  if (open && open['vr.openSection']) {
    switchSection(open['vr.openSection']);
    chrome.storage.local.remove('vr.openSection');
  }

  // —— 通用 ——
  const syncModeUI = () => {
    const isEdge = settings.display.mode === 'edge';
    const isFloat = settings.display.mode === 'float';
    const edge = $('fieldEdge');
    const floating = $('fieldFloat');
    if (edge) edge.style.display = isEdge ? '' : 'none';
    if (floating) floating.style.display = isFloat ? '' : 'none';
  };
  for (const r of document.querySelectorAll('#displayMode input[name="mode"]')) {
    r.checked = r.value === settings.display.mode;
    r.addEventListener('change', () => {
      set({ display: { mode: r.value } });
      settings.display.mode = r.value;
      syncModeUI();
    });
  }
  syncModeUI();
  $('btnOpenSidebar').onclick = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tabs[0] || tabs[0].id == null) throw new Error('没有活动标签页');
      await chrome.sidePanel.open({ tabId: tabs[0].id });
      chrome.runtime.sendMessage({ type: 'sidebar.track', tabId: tabs[0].id });
    } catch (e) {
      window.alert('无法打开侧边栏。请切换到普通网页后重试，并确认浏览器支持侧边栏。');
    }
  };
  bindSelect('edgeSide', 'display.edge');
  bindRange('edgeWidth', 'display.width', (v) => v + ' px');
  bindRange('maxWidth', 'display.maxWidth', (v) => (v === 0 ? '不限' : v + ' px'));
  bindCheck('indent', 'display.indent', updatePreview);
  bindFloatCheck('floatSnap', 'snap');
  bindFloatCheck('floatAutoHide', 'autoHide');

  // —— 外观（字体/字号/行距三种形态共用）——
  bindSelect('font', 'display.font');
  bindRange('fontSize', 'display.fontSize', (v) => v + ' px', updatePreview);
  bindRange('lineHeight', 'display.lineHeight', (v) => Number(v).toFixed(2), updatePreview);

  // —— 外观（配色/透明度/毛玻璃：按形态独立）——
  styleTarget = settings.display.mode === 'sidebar' ? 'sidebar' : (settings.display.mode === 'float' ? 'float' : 'edge');
  $('styleTarget').value = styleTarget;
  $('styleTarget').addEventListener('change', () => {
    styleTarget = $('styleTarget').value;
    refreshStyleControls();
    updatePreview();
  });

  for (const [id, key] of [['color', 'color'], ['bgColor', 'bgColor']]) {
    const c = $(id);
    c.addEventListener('input', debounce(() => {
      setMyStyle({ [key]: c.value });
    }, 120));
  }

  $('opacity').addEventListener('input', () => {
    const v = parseFloat($('opacity').value);
    $('opacityVal').textContent = Math.round(v * 100) + '%';
    setMyStyle({ opacity: v });
  });

  $('glass').addEventListener('change', () => {
    setMyStyle({ glass: $('glass').checked });
  });

  const chips = $('themeChips');
  for (const th of THEMES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.theme = th.name;
    chip.textContent = th.name;
    chip.setAttribute('aria-label', `应用${th.name}配色`);
    chip.style.background = th.bg;
    chip.style.color = th.color;
    chip.onclick = () => {
      setMyStyle({ color: th.color, bgColor: th.bg });
      refreshStyleControls();
    };
    chips.appendChild(chip);
  }
  refreshStyleControls();
  updatePreview();

  // —— 触发与隐藏 ——
  bindCheck('hover', 'trigger.hover', (v) => { $('hoverGroup').style.opacity = v ? 1 : 0.35; });
  bindSelect('triggerEdge', 'trigger.edge');
  bindRange('thickness', 'trigger.thickness', (v) => v + ' px');
  bindRange('showDelay', 'trigger.showDelay', (v) => v + ' ms');
  bindCheck('autoHide', 'trigger.autoHide', (v) => { $('autoHideGroup').style.opacity = v ? 1 : 0.35; });
  bindSelect('autoHideMode', 'trigger.autoHideMode');
  bindRange('autoHideDelay', 'trigger.autoHideDelay', (v) => v + ' ms');
  bindCheck('tray', 'trigger.tray', (v) => { $('trayGroup').style.opacity = v ? 1 : 0.35; });
  bindSelect('trayEdge', 'trigger.trayEdge');
  bindRange('trayPos', 'trigger.trayPos', (v) => Math.round(v * 100) + '%');

  $('btnShortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

  // —— 站点规则 ——
  renderSites(settings.sites || []);
  $('siteList').addEventListener('input', commitSites);
  $('btnAddSite').onclick = () => {
    const rules = readSiteRules();
    rules.push({ domain: '', content: '', title: '', prev: '', next: '', catalog: '', remove: '' });
    renderSites(rules);
    const first = $('siteList').querySelector('.site-card:last-child input');
    if (first) first.focus();
  };

  // —— 书库 ——
  renderBooks();
  $('btnAddWebBook').onclick = async () => {
    const status = $('webBookMsg');
    status.textContent = '';
    try {
      const config = await saveWebBookConfig({
        title: $('webBookTitle').value,
        chapterUrl: $('webBookChapterUrl').value,
        bookUrl: $('webBookUrl').value,
      });
      if (!config) return;
      $('webBookTitle').value = '';
      $('webBookChapterUrl').value = '';
      $('webBookUrl').value = '';
      status.textContent = `已添加《${config.title}》`;
      renderBooks();
    } catch (err) {
      status.textContent = '添加失败：' + String(err && err.message || err);
    }
  };
  $('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    $('importMsg').textContent = '正在导入…';
    try {
      const buf = await file.arrayBuffer();
      const { meta, text } = txt.importFile(file.name, buf);
      await db.putBook(meta, text);
      await store.setCurrent(meta.id);
      $('importMsg').textContent = `已导入《${meta.title}》（${meta.chapterCount} 章）`;
      renderBooks();
    } catch (err) {
      $('importMsg').textContent = '导入失败：' + (err && err.message ? err.message : err);
    }
    e.target.value = '';
  });

  // 其他入口（阅读器快捷样式 / 侧边栏）改动设置时同步
  store.onSettingsChanged((s) => {
    settings = s;
    applyUiTheme(s.ui && s.ui.theme);
    for (const r of document.querySelectorAll('#displayMode input[name="mode"]')) {
      r.checked = r.value === s.display.mode;
    }
    $('fieldEdge').style.display = s.display.mode === 'edge' ? '' : 'none';
    $('fieldFloat').style.display = s.display.mode === 'float' ? '' : 'none';
    $('floatSnap').checked = !s.display.float || s.display.float.snap !== false;
    $('floatAutoHide').checked = !s.display.float || s.display.float.autoHide !== false;
    syncAppearanceInputs();
    updatePreview();
  });
})();
