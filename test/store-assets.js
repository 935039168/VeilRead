'use strict';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'en' ? 'en' : 'zh-CN';
const scene = params.get('scene') || 'float';
const copy = {
  'zh-CN': {
    float: ['冷灰自由悬浮窗', '覆盖网页、位置与大小可调'],
    edge: ['贴边面板', '碰边呼出，鼠标移开自动收起'],
    sidebar: ['浏览器原生侧边栏', '长文独立滚动，网页仍然可见'],
    settings: ['按显示方式独立定制', '配色、字体、透明度与呼出行为'],
    library: ['TXT 与在线书库', '本地保存书籍、设置和阅读进度'],
  },
  en: {
    float: ['Cool-gray floating reader', 'Read over a page with adjustable size and position'],
    edge: ['Edge panel', 'Open at the edge and hide automatically'],
    sidebar: ['Browser-native side panel', 'Scroll long text while the page stays visible'],
    settings: ['Independent display styles', 'Colors, type, opacity, and activation behavior'],
    library: ['TXT and online library', 'Books, settings, and progress stay local'],
  },
};

const [title, subtitle] = copy[locale][scene];
document.getElementById('shotTitle').textContent = title;
document.getElementById('shotSub').textContent = subtitle;
const stage = document.getElementById('stage');

function articleMarkup() {
  return '<div class="webpage"><div class="crumb">ESSAYS / READING</div><h1>在安静的页面里，留一点专注的空间</h1><p>浏览器承载了工作、资料和阅读。VeilRead 把长文本整理成清晰的阅读层，同时保留原网页作为背景。</p><p>冷灰配色接近常见网页底色，字体、行距、透明度和窗口位置都可以按习惯调整。</p><div class="ghost"><i></i><i></i><i></i></div></div>';
}

const chapters = Array.from({ length: 18 }, (_, index) => ({
  title: `第${index + 1}章 风从北方来`,
  text: Array.from({ length: 24 }, (_, p) => `这是第${p + 1}段。旧历三百年秋，北境第一场雪比往年来得早，远处的灯火沿着山道缓缓靠近。`).join('\n'),
}));

const settings = {
  display: {
    mode: scene === 'float' ? 'float' : scene === 'sidebar' ? 'sidebar' : 'edge', edge: 'right', width: 430,
    float: { x: 745, y: 145, w: 470, h: 590, snap: true, autoHide: true },
    font: 'serif', fontSize: 17, lineHeight: 1.9, maxWidth: 0, indent: true,
    styles: {
      float: { color: '#273039', bgColor: '#eef1f3', opacity: .96, glass: false },
      edge: { color: '#273039', bgColor: '#eef1f3', opacity: .98, glass: false },
      sidebar: { color: '#273039', bgColor: '#eef1f3', opacity: 1, glass: false },
    },
  },
  reading: { scrollStep: .9 },
};

const host = {
  getChapter: async (_id, index) => index >= 0 && index < chapters.length ? { ...chapters[index], index, count: chapters.length } : null,
  getToc: async () => chapters.map((chapter) => chapter.title),
  getProgress: async () => ({ chapter: 0, ratio: .1 }),
  saveProgress() {}, getWebProgress: async () => null, saveWebProgress() {}, patchSettings() {},
  loadWeb: async () => null, loadCatalog: async () => [], noteWebBook() {}, onGeometry() {}, onShown() {}, onHidden() {},
  openOptions() {}, openImport() {}, extractCurrentPage() {},
};

async function mountReader(target, env) {
  const reader = VeilRead.createReader({ mount: target, env, host });
  reader.applySettings(settings);
  await reader.openBook('store-demo');
  reader.show();
  return reader;
}

async function renderReaderScene() {
  if (scene === 'sidebar') {
    stage.innerHTML = '<div class="browser-shell"><div class="browser-bar"><i></i><i></i><i></i><div class="browser-url">https://example.test/articles/reading</div></div><div class="browser-body"><div class="article"><h2>普通网页仍在左侧</h2><p>侧边栏使用浏览器提供的固定区域，正文拥有自己的滚动空间。切换标签或继续浏览时，阅读内容保持在手边。</p><p>顶部书籍选择栏始终可见，正文区域可以独立上下滚动。</p></div><div class="sidebar-zone"><div class="reader-mount"></div></div></div></div>';
    await mountReader(stage.querySelector('.reader-mount'), 'sidebar');
    return;
  }
  stage.innerHTML = articleMarkup() + '<div class="reader-mount"></div>' + (scene === 'edge' ? `<div class="scene-note">${locale === 'en' ? 'Auto-hide after pointer leaves' : '鼠标移开后自动收起'}</div>` : '');
  await mountReader(stage.querySelector('.reader-mount'), 'content');
}

function renderOptionsScene() {
  stage.innerHTML = '<div class="options-shell"><iframe title="VeilRead settings"></iframe></div>';
  const frame = stage.querySelector('iframe');
  frame.src = '/test/options-harness.html';
  frame.addEventListener('load', () => setTimeout(() => {
    const harness = frame.contentDocument;
    const inner = harness && harness.getElementById('f');
    const doc = inner && inner.contentDocument;
    if (!doc) return;
    const target = doc.querySelector(scene === 'library' ? '[data-sec="books"]' : '[data-sec="appearance"]');
    if (target) target.click();
  }, 500), { once: true });
}

if (scene === 'settings' || scene === 'library') renderOptionsScene();
else renderReaderScene();
