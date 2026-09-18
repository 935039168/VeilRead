// VeilRead — 阅读器核心 UI
// 不依赖 chrome.*，通过 host 回调与宿主环境（content script / sidebar）通信
// 挂载点：content script 的 shadow root，或 sidebar 的容器元素
(globalThis.VeilRead = globalThis.VeilRead || {}).createReader = (function () {
  'use strict';

  const FONTS = {
    sans: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", -apple-system, sans-serif',
    serif: 'Georgia, "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif',
    kai: '"KaiTi", "STKaiti", "Kaiti SC", "DFKai-SB", serif',
    system: 'system-ui, sans-serif',
    mono: '"Cascadia Mono", Consolas, "Courier New", monospace',
  };

  const THEMES = [
    { name: '纯白', color: '#1a1a1a', bg: '#ffffff' },
    { name: '冷灰', color: '#2B3138', bg: '#F4F6F8' },
    { name: '米黄', color: '#4a4234', bg: '#f0e2c4' },
    { name: '纸白', color: '#2c2c2c', bg: '#f6f1e5' },
    { name: '墨绿', color: '#c8d8c0', bg: '#1f2a22' },
    { name: '暗夜', color: '#c9c9cf', bg: '#23232b' },
    { name: '纯黑', color: '#b8b8b8', bg: '#0a0a0c' },
  ];

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return { r: 255, g: 255, b: 255 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function resolveReaderAppearance(display, modeKey) {
    const style = (display && display.styles && display.styles[modeKey]) || {};
    const bgColor = style.bgColor != null ? style.bgColor : (display && display.bgColor) || '#ffffff';
    const color = style.color != null ? style.color : (display && display.color) || '#2c2c2c';
    const rawOpacity = style.opacity != null ? style.opacity : display && display.opacity;
    const opacity = Math.min(1, Math.max(0.01, Number(rawOpacity) || 1));
    const rgb = hexToRgb(bgColor);
    return {
      color,
      bgColor,
      opacity,
      glass: style.glass != null ? style.glass : !(display && display.glass === false),
      panelBackground: `rgba(${rgb.r},${rgb.g},${rgb.b},${opacity})`,
      overlayBackground: `rgba(${rgb.r},${rgb.g},${rgb.b},0.96)`,
      isDark: (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 < 128,
    };
  }

  function getReaderLayout(mode) {
    return mode === 'fill'
      ? { panelInset: '0', scrollMinHeight: '0' }
      : { panelInset: '', scrollMinHeight: '' };
  }

  function applyReaderLayout(mode, panelStyle, scrollStyle) {
    const layout = getReaderLayout(mode);
    panelStyle.inset = layout.panelInset;
    scrollStyle.minHeight = layout.scrollMinHeight;
  }

  function createEdgeTriggerState() {
    let armed = true;
    return {
      observe(inHotZone) { if (!inHotZone) armed = true; return armed && inHotZone; },
      onResize() { armed = false; },
    };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  globalThis.VeilRead.FONTS = FONTS;
  globalThis.VeilRead.THEMES = THEMES;

  const CSS = `
:host, .vr { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.vr {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  pointer-events: none;
  color-scheme: light dark;
}
.vr * { box-sizing: border-box; }
.vr-panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--vr-surface-bg, #ffffff);
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(24px);
  transition: opacity .16s ease, transform .16s cubic-bezier(.2, .7, .3, 1), visibility 0s linear .16s;
}
.vr[data-mode="edge-left"] .vr-panel { transform: translateX(-24px); }
.vr[data-mode="edge-top"] .vr-panel { transform: translateY(-24px); }
.vr[data-mode="edge-bottom"] .vr-panel { transform: translateY(24px); }
.vr.show .vr-panel {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translate(0, 0);
  transition: opacity .16s ease, transform .16s cubic-bezier(.2, .7, .3, 1);
}

.vr[data-mode^="edge-"] .vr-panel {
  top: 0; bottom: 0; left: 0; right: 0; border-radius: 0;
}
.vr[data-mode="edge-right"] .vr-panel { left: auto; border-right: none; }
.vr[data-mode="edge-left"] .vr-panel { right: auto; border-left: none; }
.vr[data-mode="edge-top"] .vr-panel { bottom: auto; border-top: none; border-bottom: 1px solid rgba(128,128,128,.18); }
.vr[data-mode="edge-bottom"] .vr-panel { top: auto; border-bottom: none; border-top: 1px solid rgba(128,128,128,.18); }
.vr[data-mode="fill"] .vr-panel { border: none; border-radius: 0; box-shadow: none; }

.vr-grab {
  position: absolute; top: 0; left: 0; right: 0; height: 26px;
  cursor: grab; z-index: 5; opacity: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,.05), transparent);
  transition: opacity .15s;
}
.vr-panel:hover .vr-grab { opacity: 1; }
.vr[data-mode="float"] .vr-grab { opacity: .55; }
.vr-grab::after {
  content: ""; position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  width: 34px; height: 3px; border-radius: 2px; background: currentColor; opacity: .25;
}
.vr[data-mode="fill"] .vr-grab, .vr[data-mode^="edge-"] .vr-grab { display: none; }

.vr-scroll {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(128,128,128,.35) transparent;
  padding: 34px 22px 56px;
}
.vr-scroll::-webkit-scrollbar { width: 5px; }
.vr-scroll::-webkit-scrollbar-thumb { background: rgba(128,128,128,.35); border-radius: 3px; }
.vr-scroll::-webkit-scrollbar-track { background: transparent; }

.vr-ctitle {
  font-size: .82em;
  font-weight: 400;
  opacity: .45;
  text-align: center;
  margin-bottom: 1.4em;
  letter-spacing: .05em;
}
.vr-body { font-size: var(--vr-fs, 17px); line-height: var(--vr-lh, 1.85); font-family: var(--vr-font, sans-serif); color: var(--vr-fg, #2c2c2c); }
.vr-body.vr-indent p { text-indent: 2em; }
.vr-body p { margin: 0 0 .9em; white-space: pre-wrap; word-break: break-word; }
.vr-body img { max-width: 100%; height: auto; border-radius: 4px; margin: .5em 0; }
.vr-body h1, .vr-body h2, .vr-body h3 { font-size: 1.05em; margin: 1.2em 0 .8em; font-weight: 600; }
.vr-body blockquote { border-left: 2px solid currentColor; opacity: .8; padding-left: 1em; margin: .8em 0; }
.vr-body hr { border: none; border-top: 1px solid currentColor; opacity: .2; margin: 1.2em auto; width: 40%; }

.vr-bar {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; gap: 2px;
  padding: 4px 8px;
  background: linear-gradient(to top, var(--vr-barbg, rgba(0,0,0,.06)), transparent);
  opacity: 0; transition: opacity .18s;
  z-index: 6;
}
.vr-panel:hover .vr-bar, .vr-bar:focus-within { opacity: 1; }
.vr-bar button {
  all: unset; cursor: pointer;
  font: 13px/1 system-ui, sans-serif;
  color: var(--vr-fg, #2c2c2c);
  opacity: .55;
  padding: 5px 7px;
  border-radius: 5px;
  transition: opacity .12s, background .12s;
}
.vr-bar button:hover { opacity: 1; background: rgba(128,128,128,.15); }
.vr-bar button:focus-visible, .vr-style button:focus-visible, .vr-toc button:focus-visible, .vr-empty button:focus-visible {
  outline: 2px solid currentColor; outline-offset: 2px; opacity: 1;
}
.vr-bar button:disabled { opacity: .18; cursor: default; }
.vr-bar button:disabled:hover { background: none; }
.vr-info {
  flex: 1; text-align: center;
  font-size: 11px; letter-spacing: .04em;
  color: var(--vr-fg, #2c2c2c);
  opacity: .4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 0 6px;
  cursor: pointer;
}

.vr-resize {
  position: absolute; width: 18px; height: 18px;
  z-index: 7; opacity: 0;
  cursor: nwse-resize;
}
.vr-resize::after {
  content: ""; position: absolute; right: 5px; bottom: 5px;
  width: 7px; height: 7px; border-radius: 50%;
  background: currentColor;
}
.vr-panel:hover .vr-resize { opacity: .45; }
.vr-resize-nw { left: 0; top: 0; cursor: nwse-resize; }
.vr-resize-ne { right: 0; top: 0; cursor: nesw-resize; }
.vr-resize-sw { left: 0; bottom: 0; cursor: nesw-resize; }
.vr-resize-se { right: 0; bottom: 0; cursor: nwse-resize; }
.vr[data-mode="fill"] .vr-resize, .vr[data-mode^="edge-"] .vr-resize { display: none; }
.vr[data-mode="fill"] .vr-close { display: none; }

/* 贴边面板的宽度/厚度拖拽条 */
.vr-edge-drag {
  position: absolute; z-index: 7;
  cursor: ew-resize;
}
.vr[data-mode="edge-right"] .vr-edge-drag { left: 0; top: 0; bottom: 0; width: 10px; }
.vr[data-mode="edge-left"] .vr-edge-drag { right: 0; top: 0; bottom: 0; width: 10px; }
.vr[data-mode="edge-top"] .vr-edge-drag { left: 0; right: 0; bottom: 0; height: 10px; cursor: ns-resize; }
.vr[data-mode="edge-bottom"] .vr-edge-drag { left: 0; right: 0; top: 0; height: 10px; cursor: ns-resize; }
.vr-edge-drag::after {
  content: ""; position: absolute; opacity: 0; transition: opacity .15s;
}
.vr[data-mode="edge-right"] .vr-edge-drag::after, .vr[data-mode="edge-left"] .vr-edge-drag::after {
  top: 50%; transform: translateY(-50%); width: 3px; height: 46px; border-radius: 2px; background: currentColor;
}
.vr[data-mode="edge-right"] .vr-edge-drag::after { left: 3px; }
.vr[data-mode="edge-left"] .vr-edge-drag::after { right: 3px; }
.vr[data-mode="edge-top"] .vr-edge-drag::after, .vr[data-mode="edge-bottom"] .vr-edge-drag::after {
  left: 50%; transform: translateX(-50%); height: 3px; width: 46px; border-radius: 2px; background: currentColor;
}
.vr[data-mode="edge-top"] .vr-edge-drag::after { bottom: 3px; }
.vr[data-mode="edge-bottom"] .vr-edge-drag::after { top: 3px; }
.vr-panel:hover .vr-edge-drag::after { opacity: .35; }
.vr:not([data-mode^="edge-"]) .vr-edge-drag { display: none; }

/* 收起为小图标 */
.vr-bead {
  position: absolute; width: 40px; height: 40px; border-radius: 50%;
  background: rgba(28, 28, 38, 0.78); color: #cdbcff;
  display: flex; align-items: center; justify-content: center;
  font: 600 15px/1 system-ui, sans-serif;
  cursor: pointer; z-index: 9; pointer-events: auto;
  opacity: 0; transform: scale(.5); visibility: hidden;
  transition: opacity .15s ease, transform .15s ease, visibility 0s linear .15s;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.32);
  user-select: none; touch-action: none;
}
.vr-bead.show {
  opacity: 1; transform: scale(1); visibility: visible;
  transition: opacity .15s ease, transform .15s ease;
}
.vr-bead:hover { background: rgba(48, 44, 72, 0.9); }

.vr-progress {
  position: absolute; left: 0; bottom: 0; height: 2px;
  background: currentColor; opacity: .25;
  width: 0; z-index: 8; pointer-events: none;
  transition: width .2s ease;
}

/* 目录 */
.vr-toc {
  position: absolute; inset: 0; z-index: 20;
  background: var(--vr-overlay-bg, rgba(250,250,248,.98));
  display: none; flex-direction: column;
  backdrop-filter: blur(6px);
}
.vr-toc.open { display: flex; }
.vr-toc-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(128,128,128,.15);
}
.vr-toc-head input {
  all: unset; flex: 1;
  font-size: 13px; padding: 6px 10px;
  border-radius: 6px;
  background: rgba(128,128,128,.12);
  color: var(--vr-fg, #2c2c2c);
}
.vr-toc-head input:focus { background: rgba(128,128,128,.18); }
.vr-toc-list { flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.vr-toc-list button {
  all: unset; display: block; width: 100%;
  font-size: 13px; line-height: 1.5;
  padding: 7px 14px;
  color: var(--vr-fg, #2c2c2c); opacity: .75;
  cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vr-toc-list button:hover { background: rgba(128,128,128,.1); opacity: 1; }
.vr-toc-list button.cur { opacity: 1; font-weight: 600; }
.vr-toc-hint { padding: 10px 14px; font-size: 11px; opacity: .4; text-align: center; }

/* 快捷样式 */
.vr-style {
  position: absolute; right: 8px; bottom: 40px; z-index: 20;
  display: none; flex-direction: column; gap: 10px;
  padding: 12px;
  min-width: 168px;
  background: var(--vr-overlay-bg, rgba(250,250,248,.98));
  border: 1px solid rgba(128,128,128,.18);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
  font-size: 12px; color: var(--vr-fg, #2c2c2c);
}
.vr-style.open { display: flex; }
.vr-style .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vr-style .row .lbl { opacity: .55; }
.vr-style button {
  all: unset; cursor: pointer; padding: 3px 9px; border-radius: 5px;
  background: rgba(128,128,128,.12); font-size: 13px; color: inherit;
}
.vr-style button:hover { background: rgba(128,128,128,.22); }
.vr-style .val { min-width: 2.2em; text-align: center; opacity: .8; }
.vr-style input[type="range"] { accent-color: currentColor; width: 92px; cursor: pointer; }
.vr-style .hint { font-size: 10.5px; opacity: .42; line-height: 1.55; }
.vr-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.vr-swatches button {
  width: 26px; height: 26px; padding: 0;
  border: 1px solid rgba(128,128,128,.3); border-radius: 6px;
}
.vr-swatches button:hover, .vr-swatches button.active { border-color: currentColor; box-shadow: 0 0 0 2px currentColor; }
.vr-style .more { opacity: .55; cursor: pointer; text-align: center; padding-top: 2px; border-top: 1px solid rgba(128,128,128,.15); }
.vr-style .more:hover { opacity: 1; }

/* 空状态 */
.vr-empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  color: var(--vr-fg, #2c2c2c); opacity: .6;
  font-size: 13px; padding: 20px; text-align: center;
}
.vr-empty button {
  all: unset; cursor: pointer;
  font-size: 13px; padding: 7px 16px;
  border: 1px solid currentColor; border-radius: 999px;
  color: var(--vr-fg, #2c2c2c); opacity: .8;
}
.vr-empty button:hover { opacity: 1; background: rgba(128,128,128,.1); }

.vr-toast {
  position: absolute; bottom: 44px; left: 50%; transform: translateX(-50%);
  z-index: 30; pointer-events: none;
  font-size: 12px; padding: 6px 14px; border-radius: 999px;
  background: rgba(30,30,34,.85); color: #eee;
  opacity: 0; transition: opacity .18s;
  white-space: nowrap;
}
.vr.toast .vr-toast { opacity: 1; }
`;

  function injectStyles(root, env) {
    const style = document.createElement('style');
    if (env === 'shadow') {
      style.textContent = CSS;
      root.appendChild(style);
    } else {
      style.textContent = CSS.replace(':host, .vr { all: initial; }', '.vr { all: initial; }');
      document.head.appendChild(style);
    }
  }

  function snapFloatGeometry(geometry, viewport, threshold = 16) {
    const g = { ...geometry };
    const vw = Number(viewport && viewport.width) || 0;
    const vh = Number(viewport && viewport.height) || 0;
    if (!vw || !vh) return g;
    if (Math.abs(g.x) <= threshold) g.x = 0;
    else if (Math.abs(vw - (g.x + g.w)) <= threshold) g.x = vw - g.w;
    if (Math.abs(g.y) <= threshold) g.y = 0;
    else if (Math.abs(vh - (g.y + g.h)) <= threshold) g.y = vh - g.h;
    return g;
  }

  function shouldFloatAutoHide(settings, mode) {
    return mode === 'float' &&
      !(settings && settings.display && settings.display.float && settings.display.float.autoHide === false);
  }

  function normalizeReaderPresentation(mode, requested) {
    if (requested === 'bead' && mode !== 'float') return 'hidden';
    if (requested === 'panel' && mode === 'disabled') return 'hidden';
    return requested === 'panel' || requested === 'bead' ? requested : 'hidden';
  }

  function getPanelAutoHideAction(settings, mode) {
    if (mode === 'float') return shouldFloatAutoHide(settings, mode) ? 'collapse' : null;
    if (!String(mode || '').startsWith('edge-') || !settings || !settings.trigger || !settings.trigger.autoHide) {
      return null;
    }
    return 'hide';
  }

  function createCancelableDelay(timerApi) {
    const timers = timerApi || globalThis;
    let timer = null;
    function cancel() {
      if (timer === null) return;
      timers.clearTimeout(timer);
      timer = null;
    }
    return {
      cancel,
      schedule(callback, delay) {
        cancel();
        timer = timers.setTimeout(() => {
          timer = null;
          callback();
        }, delay);
      },
    };
  }
  function isFloatGeometryPatch(patch) {
    const geometry = patch && patch.display && patch.display.float;
    return !!geometry && ['x', 'y', 'w', 'h'].some((key) =>
      Object.prototype.hasOwnProperty.call(geometry, key));
  }

  function styleHintForMode(modeKey) {
    if (modeKey === 'float') return '悬浮窗：拖顶部移动 · 拖四个角缩放 · Ctrl+滚轮调透明度';
    if (modeKey === 'edge') return '贴边面板：拖内侧边缘调整大小 · Ctrl+滚轮调透明度';
    return 'Ctrl+滚轮调透明度';
  }

  function stepReaderSetting(current, fallback, delta, min, max) {
    const value = Number.isFinite(current) ? current : fallback;
    return Math.max(min, Math.min(max, value + delta));
  }

  function shouldDeferAppearanceSync(activeId) {
    return ['styleTarget', 'font', 'fontSize', 'lineHeight', 'color', 'bgColor', 'opacity', 'glass']
      .includes(activeId || '');
  }

  function didPointerMove(startX, startY, endX, endY, threshold = 4) {
    return Math.hypot(endX - startX, endY - startY) > threshold;
  }

  function getCollapseBeadPosition(geometry, viewport) {
    const g = geometry || {};
    const vw = Number(viewport && viewport.width) || 0;
    const vh = Number(viewport && viewport.height) || 0;
    const w = Number(g.w) || 0;
    const h = Number(g.h) || 0;
    const x0 = Number(g.x) || 0;
    const y0 = Number(g.y) || 0;
    const inset = 8;
    const bead = 40;
    const clampToViewport = (value, max) => Math.max(inset, Math.min(Math.max(inset, max), value));
    const maxX = vw - bead - inset;
    const maxY = vh - bead - inset;
    const attached = (value) => Math.abs(value) <= 2;
    let side = null;
    let x = x0 + w - bead - inset;
    let y = y0 + h - bead - inset;

    // 角落同时贴边时优先沿水平方向收起，顺序固定为右、左、上、下。
    if (attached(vw - (x0 + w))) {
      side = 'right'; x = maxX; y = y0 + 14;
    } else if (attached(x0)) {
      side = 'left'; x = inset; y = y0 + 14;
    } else if (attached(y0)) {
      side = 'top'; x = x0 + 14; y = inset;
    } else if (attached(vh - (y0 + h))) {
      side = 'bottom'; x = x0 + 14; y = maxY;
    }
    return {
      x: Math.round(clampToViewport(x, maxX)),
      y: Math.round(clampToViewport(y, maxY)),
      side,
    };
  }

  const BEAD_SIZE = 40;
  const BEAD_SAFE_INSET = 8;

  function clampBeadCoordinate(value, viewportSize) {
    const max = Math.max(BEAD_SAFE_INSET, viewportSize - BEAD_SIZE - BEAD_SAFE_INSET);
    return Math.round(Math.max(BEAD_SAFE_INSET, Math.min(max, value)));
  }

  function pointToBeadAnchor(point, viewport) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return { right: BEAD_SAFE_INSET, bottom: BEAD_SAFE_INSET };
    }
    const vw = Number(viewport && viewport.width) || 0;
    const vh = Number(viewport && viewport.height) || 0;
    const x = clampBeadCoordinate(point.x, vw);
    const y = clampBeadCoordinate(point.y, vh);
    return {
      right: Math.max(BEAD_SAFE_INSET, Math.round(vw - BEAD_SIZE - x)),
      bottom: Math.max(BEAD_SAFE_INSET, Math.round(vh - BEAD_SIZE - y)),
    };
  }

  function normalizeBeadAnchor(anchor, viewport) {
    const right = anchor && anchor.right;
    const bottom = anchor && anchor.bottom;
    if (Number.isFinite(right) && right >= 0 && Number.isFinite(bottom) && bottom >= 0) {
      return { right, bottom };
    }
    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      const vw = Number(viewport && viewport.width) || 0;
      const vh = Number(viewport && viewport.height) || 0;
      const maxX = Math.max(BEAD_SAFE_INSET, vw - BEAD_SIZE - BEAD_SAFE_INSET);
      const maxY = Math.max(BEAD_SAFE_INSET, vh - BEAD_SIZE - BEAD_SAFE_INSET);
      if (anchor.x < BEAD_SAFE_INSET || anchor.x > maxX ||
          anchor.y < BEAD_SAFE_INSET || anchor.y > maxY) {
        return { right: BEAD_SAFE_INSET, bottom: BEAD_SAFE_INSET };
      }
      return pointToBeadAnchor(anchor, viewport);
    }
    return { right: BEAD_SAFE_INSET, bottom: BEAD_SAFE_INSET };
  }

  function beadAnchorToPoint(anchor, viewport) {
    const normalized = normalizeBeadAnchor(anchor, viewport);
    const vw = Number(viewport && viewport.width) || 0;
    const vh = Number(viewport && viewport.height) || 0;
    return {
      x: clampBeadCoordinate(vw - BEAD_SIZE - normalized.right, vw),
      y: clampBeadCoordinate(vh - BEAD_SIZE - normalized.bottom, vh),
    };
  }

  function beadSettingKey(bead) {
    if (bead == null) return 'none';
    if (Number.isFinite(bead.right) && Number.isFinite(bead.bottom)) {
      return `anchor:${bead.right}:${bead.bottom}`;
    }
    if (Number.isFinite(bead.x) && Number.isFinite(bead.y)) {
      return `point:${bead.x}:${bead.y}`;
    }
    return 'invalid';
  }

  globalThis.VeilRead.readerUtils = {
    snapFloatGeometry, shouldFloatAutoHide, isFloatGeometryPatch, styleHintForMode, stepReaderSetting,
    shouldDeferAppearanceSync, didPointerMove, getCollapseBeadPosition, resolveReaderAppearance,
    getReaderLayout, applyReaderLayout, normalizeReaderPresentation, getPanelAutoHideAction,
    createCancelableDelay, createEdgeTriggerState,
    normalizeBeadAnchor, beadAnchorToPoint, pointToBeadAnchor,
  };

  return function createReader(opts) {
    const { mount, env = 'content', host } = opts;

    // mount 可能是 shadow root（有 appendChild）或普通元素
    const root = mount;

    const wrap = el('div', 'vr');
    const panel = el('div', 'vr-panel');
    const grab = el('div', 'vr-grab');
    const scroll = el('div', 'vr-scroll');
    const bar = el('div', 'vr-bar');
    const progress = el('div', 'vr-progress');
    const toc = el('div', 'vr-toc');
    const stylePop = el('div', 'vr-style');
    const toastEl = el('div', 'vr-toast');

    const resizeHandleMap = {};
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      resizeHandleMap[c] = el('div', 'vr-resize vr-resize-' + c);
    }
    const edgeDrag = el('div', 'vr-edge-drag');
    edgeDrag.title = '拖动调整宽度';
    const bead = el('div', 'vr-bead', 'V');
    bead.title = '拖动调整位置；点击恢复阅读';
    bead.setAttribute('role', 'button');
    bead.setAttribute('aria-label', '恢复阅读；可拖动调整位置');
    bead.tabIndex = 0;

    const btnPrev = el('button', null, '‹');
    const btnNext = el('button', null, '›');
    const info = el('div', 'vr-info', '');
    const btnToc = el('button', null, '目录');
    const btnAa = el('button', null, 'Aa');
    const btnClose = el('button', 'vr-close', '✕');
    btnPrev.title = '上一章（Alt+↑）';
    btnNext.title = '下一章（Alt+↓）';
    btnToc.title = '目录';
    btnAa.title = '阅读样式';
    btnClose.title = '隐藏阅读器 (Esc)';
    btnPrev.setAttribute('aria-label', '上一章');
    btnNext.setAttribute('aria-label', '下一章');
    btnToc.setAttribute('aria-label', '打开目录');
    btnAa.setAttribute('aria-label', '调整阅读样式');
    btnClose.setAttribute('aria-label', '隐藏阅读器');
    bar.append(btnPrev, btnNext, info, btnToc, btnAa, btnClose);

    panel.append(grab, scroll, bar, resizeHandleMap.nw, resizeHandleMap.ne,
      resizeHandleMap.sw, resizeHandleMap.se, edgeDrag, progress, toc, stylePop, toastEl);
    wrap.appendChild(panel);
    wrap.appendChild(bead);
    root.appendChild(wrap);

    injectStyles(root, env === 'content' ? 'shadow' : 'page');

    // ---------- 状态 ----------
    const st = {
      presentation: 'hidden',  // hidden | panel | bead
      kind: null,             // 'txt' | 'web'
      bookId: null,
      chapter: -1, count: 0,
      chapterTitle: '',
      web: null,              // {bookUrl,url,title,prev,next,catalog}
      ratio: 0,
      viaHover: false,
      settings: null,
      modeKey: 'edge',          // 当前 UI 形态（float | edge | sidebar），样式按形态独立
      emptyShown: false,
      webCatalog: null,        // 在线书目录 [{t,url}]
      beadAnchor: null,        // 用户拖动后的恢复圆点右/下间距；null 时自动跟随悬浮窗
      beadSettingKey: undefined, // 最近一次接收的外部圆点设置，用于忽略异步旧值重放
      beadAnchorGeneration: 0,
      pendingBeadClearGeneration: null,
    };
    let saveTimer = null;
    let toastTimer = null;
    let webRequestId = 0;

    // ---------- 样式应用 ----------
    function applySettings(s) {
      // 样式改变会引起重排，先记录阅读位置
      const keepRatio = (st.presentation === 'panel' && scroll.querySelector('.vr-body')) ? getRatio() : null;
      st.settings = s;
      const d = s.display;
      const storedBead = d.float && d.float.bead;
      const storedBeadKey = beadSettingKey(storedBead);
      const supersededLocalClear = storedBead == null &&
        st.pendingBeadClearGeneration != null &&
        st.beadAnchorGeneration !== st.pendingBeadClearGeneration;
      if (storedBead == null && st.pendingBeadClearGeneration != null) {
        st.pendingBeadClearGeneration = null;
      }
      if (storedBeadKey !== st.beadSettingKey) {
        st.beadSettingKey = storedBeadKey;
        if (!supersededLocalClear) {
          setBeadAnchor(storedBead == null ? null : normalizeBeadAnchor(storedBead, {
            width: window.innerWidth, height: window.innerHeight,
          }));
        }
      }
      // 页面内无法主动创建原生侧边栏；它由 popup/设置页的用户手势打开。
      let mode;
      if (env === 'sidebar') mode = 'fill';
      else if (d.mode === 'float') mode = 'float';
      else if (d.mode === 'edge') mode = `edge-${d.edge}`;
      else mode = 'disabled';
      wrap.dataset.mode = mode;
      setPresentation(st.presentation, { notify: false, reason: 'mode-change' });
      // 三种 UI 形态各自独立的外观配置（按实际渲染形态取）
      st.modeKey = mode === 'float' ? 'float' : (mode.startsWith('edge-') ? 'edge' : 'sidebar');
      const appearance = resolveReaderAppearance(d, st.modeKey);
      if (mode !== 'fill') applyReaderLayout(mode, panel.style, scroll.style);
      // 毛玻璃（可按 UI 形态分别关闭，关闭则为纯透明）
      panel.style.backdropFilter = (appearance.opacity < 0.98 && appearance.glass !== false)
        ? 'blur(10px) saturate(1.15)' : 'none';
      wrap.style.setProperty('--vr-surface-bg', appearance.panelBackground);
      wrap.style.setProperty('--vr-overlay-bg', appearance.overlayBackground);
      wrap.style.setProperty('--vr-barbg', appearance.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
      wrap.style.setProperty('--vr-fg', appearance.color);
      wrap.style.setProperty('--vr-fs', d.fontSize + 'px');
      wrap.style.setProperty('--vr-lh', String(d.lineHeight));
      wrap.style.setProperty('--vr-font', FONTS[d.font] || FONTS.sans);

      if (mode === 'float') {
        applyGeometry(d.float);
      } else if (mode.indexOf('edge-') === 0) {
        // 四向贴边：left/right 控宽度，top/bottom 控高度
        panel.style.left = '';
        panel.style.top = '';
        panel.style.width = '';
        panel.style.height = '';
        const side = mode.slice(5);
        const maxDim = (side === 'top' || side === 'bottom') ? window.innerHeight : window.innerWidth;
        const size = clamp(d.width, 200, Math.max(200, Math.floor(maxDim * 0.95)));
        if (side === 'left' || side === 'right') panel.style.width = size + 'px';
        else panel.style.height = size + 'px';
      } else { // fill
        panel.style.left = '';
        panel.style.top = '';
        panel.style.width = '';
        panel.style.height = '';
        // fill 需要在清理历史几何之后再写入 inset，否则清空 left/top 会破坏固定高度。
        applyReaderLayout(mode, panel.style, scroll.style);
      }

      // 视口尺寸可能已经变化；即使展示状态未变化，也要按保存的边距重新定位。
      if (st.presentation === 'bead') placeBead(st.beadAnchor);

      const body = scroll.querySelector('.vr-body');
      if (body) {
        body.classList.toggle('vr-indent', !!d.indent);
        body.style.maxWidth = d.maxWidth > 0 ? d.maxWidth + 'px' : 'none';
      }
      if (keepRatio != null) {
        afterLayout(() => setRatio(keepRatio));
      }
    }

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function setBeadAnchor(anchor) {
      st.beadAnchor = anchor;
      st.beadAnchorGeneration += 1;
    }

    // rAF 在后台标签页不触发，用 setTimeout 保证位置恢复
    function afterLayout(fn) { setTimeout(fn, 16); }

    // ---------- 快速外观调整（按当前 UI 形态独立保存）----------
    function patchMyStyles(obj) {
      if (!st.settings) return;
      if (!st.settings.display.styles) st.settings.display.styles = { float: {}, edge: {}, sidebar: {} };
      const mk = st.modeKey || 'edge';
      if (!st.settings.display.styles[mk]) st.settings.display.styles[mk] = {};
      Object.assign(st.settings.display.styles[mk], obj);
      applySettings(st.settings);
      host.patchSettings({ display: { styles: { [mk]: obj } } });
    }

    const commitMyStyle = debounce((key, v) => {
      const mk = st.modeKey || 'edge';
      host.patchSettings({ display: { styles: { [mk]: { [key]: v } } } });
    }, 250);

    function setOpacity(v) {
      v = Math.round(clamp(v, 0.01, 1) * 100) / 100;
      if (!st.settings) return;
      if (!st.settings.display.styles) st.settings.display.styles = { float: {}, edge: {}, sidebar: {} };
      const mk = st.modeKey || 'edge';
      if (!st.settings.display.styles[mk]) st.settings.display.styles[mk] = {};
      st.settings.display.styles[mk].opacity = v;
      applySettings(st.settings);
      commitMyStyle('opacity', v);
    }

    function applyGeometry(g) {
      const w = Math.max(80, g.w || 480);
      const h = Math.max(60, g.h || 600);
      let x = g.x, y = g.y;
      if (x == null) x = w >= window.innerWidth - 16 ? 8 : window.innerWidth - w - 24;
      if (y == null) y = Math.max(8, Math.floor((window.innerHeight - h) / 2));
      // 至少保留 60px 在屏幕内可抓取
      const xMin = 8 - w + 60;
      x = clamp(x, xMin, Math.max(xMin + 1, window.innerWidth - 60));
      y = clamp(y, 0, Math.max(0, window.innerHeight - 40));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    }

    function placeBeadPoint(position) {
      const maxX = Math.max(8, window.innerWidth - 48);
      const maxY = Math.max(8, window.innerHeight - 48);
      const x = clamp(Math.round(Number(position && position.x) || 8), 8, maxX);
      const y = clamp(Math.round(Number(position && position.y) || 8), 8, maxY);
      bead.style.left = x + 'px';
      bead.style.top = y + 'px';
      return { x, y };
    }

    function placeBead(anchor) {
      return placeBeadPoint(beadAnchorToPoint(anchor, {
        width: window.innerWidth, height: window.innerHeight,
      }));
    }

    // ---------- 显示 / 隐藏 / 收起 ----------
    function setPresentation(requested, options) {
      const o = options || {};
      const previous = st.presentation;
      const next = normalizeReaderPresentation(wrap.dataset.mode, requested);
      if (next === previous) return false;

      st.presentation = next;
      if (previous === 'panel' && next !== 'panel') flushProgress();
      if (next !== 'panel') closeOverlays();
      wrap.classList.toggle('show', next === 'panel');
      bead.classList.toggle('show', next === 'bead');

      if (next === 'panel') host.onShown && host.onShown({ viaHover: st.viaHover });
      else if (previous === 'panel') host.onHidden && host.onHidden();
      if (o.notify !== false && host.onPresentationChanged) {
        host.onPresentationChanged({ presentation: next, reason: o.reason || 'set' });
      }
      return true;
    }

    function show(opts2) {
      const o = opts2 || {};
      st.viaHover = !!o.viaHover;
      return setPresentation('panel', { notify: o.notify, reason: o.reason || 'show' });
    }
    function hide(options) {
      const o = options || {};
      return setPresentation('hidden', { notify: o.notify, reason: o.reason || 'hide' });
    }
    function showBead(position, options) {
      if (normalizeReaderPresentation(wrap.dataset.mode, 'bead') !== 'bead') {
        return setPresentation('hidden', options);
      }
      placeBead(position || st.beadAnchor);
      const o = options || {};
      return setPresentation('bead', { notify: o.notify, reason: o.reason || 'show-bead' });
    }
    function hideBead(options) {
      if (st.presentation !== 'bead') return false;
      const o = options || {};
      return setPresentation('hidden', { notify: o.notify, reason: o.reason || 'hide-bead' });
    }
    // 收起为小圆点：内容与进度保留，点击圆点恢复
    function collapse() {
      if (st.presentation !== 'panel' || wrap.dataset.mode !== 'float') return false;
      const r = panel.getBoundingClientRect();
      const position = getCollapseBeadPosition({
        x: r.left, y: r.top, w: r.width, h: r.height,
      }, { width: window.innerWidth, height: window.innerHeight });
      const anchor = pointToBeadAnchor(position, {
        width: window.innerWidth, height: window.innerHeight,
      });
      if (!st.beadAnchor) setBeadAnchor(anchor);
      return showBead(st.beadAnchor, { reason: 'collapse' });
    }
    function toggle(opts2) { return st.presentation === 'panel' ? hide() : show(opts2); }

    // ---------- 进度 ----------
    function getRatio() {
      const max = scroll.scrollHeight - scroll.clientHeight;
      return max > 4 ? scroll.scrollTop / max : 0;
    }
    function setRatio(r) {
      const max = scroll.scrollHeight - scroll.clientHeight;
      scroll.scrollTop = max > 4 ? r * max : 0;
    }
    function queueSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushProgress, 600);
    }
    function flushProgress() {
      clearTimeout(saveTimer);
      if (st.kind === 'txt' && st.bookId && st.chapter >= 0) {
        st.ratio = getRatio();
        host.saveProgress(st.bookId, {
          chapter: st.chapter, ratio: st.ratio, chapterTitle: st.chapterTitle,
        });
      } else if (st.kind === 'web' && st.web && st.web.url) {
        st.ratio = getRatio();
        host.saveWebProgress(st.web.url, {
          title: st.web.title,
          ratio: st.ratio,
          bookUrl: st.web.bookUrl || st.web.url,
        });
      }
    }

    // ---------- TXT ----------
    async function openBook(bookId, opts2) {
      const requestId = ++webRequestId;
      const o = opts2 || {};
      st.kind = 'txt';
      st.bookId = bookId;
      st.web = null;
      let index = o.index;
      let ratio = null;
      if (index == null) {
        const p = await host.getProgress(bookId);
        if (p && p.chapter != null) { index = p.chapter; ratio = p.ratio || 0; }
        else index = 0;
      }
      if (requestId !== webRequestId || st.kind !== 'txt' || st.bookId !== bookId) return false;
      return loadChapter(index, ratio, requestId);
    }

    async function loadChapter(index, restoreRatio, existingRequestId) {
      const requestId = Number.isInteger(existingRequestId) ? existingRequestId : ++webRequestId;
      const bookId = st.bookId;
      let ch = null;
      try { ch = await host.getChapter(bookId, index); }
      catch (e) { ch = null; }
      if (requestId !== webRequestId || st.kind !== 'txt' || st.bookId !== bookId) return false;
      if (!ch) { toast('无法读取该章节'); return false; }
      st.chapter = ch.index;
      st.count = ch.count;
      st.chapterTitle = ch.title;
      st.ratio = 0;
      renderBody(ch.title, ch.text, 'txt');
      scroll.scrollTop = 0;
      if (restoreRatio) afterLayout(() => {
        if (requestId === webRequestId && st.kind === 'txt' && st.bookId === bookId) setRatio(restoreRatio);
      });
      updateBar();
      flushProgress();
      return true;
    }

    function renderBody(title, content, kind) {
      closeOverlays();
      scroll.textContent = '';
      const h = el('h2', 'vr-ctitle', title || '');
      const body = el('div', 'vr-body');
      if (kind === 'txt') {
        for (const para of content.split('\n')) {
          const t = para.trim();
          if (t) body.appendChild(el('p', null, t));
        }
      } else {
        body.innerHTML = content; // 由提取器按白名单构建
      }
      if (st.settings) {
        body.classList.toggle('vr-indent', !!st.settings.display.indent);
        body.style.maxWidth = st.settings.display.maxWidth > 0 ? st.settings.display.maxWidth + 'px' : 'none';
      }
      scroll.append(h, body);
      st.emptyShown = false;
    }

    function renderEmpty() {
      webRequestId++;
      st.kind = null;
      st.emptyShown = true;
      scroll.textContent = '';
      const empty = el('div', 'vr-empty');
      empty.appendChild(el('div', null, '暂无阅读内容'));
      const bImport = el('button', null, '导入 TXT 小说');
      bImport.onclick = () => host.openImport && host.openImport();
      empty.appendChild(bImport);
      if (host.extractCurrentPage) {
        const bPage = el('button', null, '读取当前网页正文');
        bPage.onclick = () => host.extractCurrentPage();
        empty.appendChild(bPage);
      }
      scroll.appendChild(empty);
      updateBar();
    }

    // ---------- 网页正文 ----------
    async function openWeb(data, opts2) {
      const o = opts2 || {};
      const requestId = o.requestId == null ? ++webRequestId : o.requestId;
      if (requestId !== webRequestId) return;
      const previous = st.kind === 'web' ? st.web : null;
      const catalog = data.catalog || (previous && previous.catalog) || null;
      const bookUrl = data.bookUrl || catalog || (previous && previous.bookUrl) || data.url || '';
      const isNewBook = !previous || previous.bookUrl !== bookUrl || previous.catalog !== catalog;
      st.kind = 'web';
      st.bookId = null;
      if (isNewBook) st.webCatalog = null;
      st.web = {
        url: data.url || '',
        bookUrl,
        title: data.title || '网页正文',
        prev: data.prev || null,
        next: data.next || null,
        catalog,
      };
      // 记入书库（在线书），供书库列表展示与继续阅读
      if (st.web.url && host.noteWebBook) {
        host.noteWebBook({
          bookUrl,
          chapterUrl: st.web.url,
          title: st.web.title,
        });
      }
      if (bookUrl && host.saveWebBook) {
        Promise.resolve(host.saveWebBook(bookUrl, { lastChapter: st.web.url, title: st.web.title })).catch(() => {});
      }
      let ratio = 0;
      if (data.url) {
        const p = await host.getWebProgress(data.url);
        if (p && p.ratio > 0.005) ratio = p.ratio;
      }
      if (requestId !== webRequestId) return;
      renderBody(st.web.title, data.html, 'web');
      scroll.scrollTop = 0;
      afterLayout(() => setRatio(ratio));
      updateBar();
    }

    async function loadWebUrl(url) {
      const requestId = ++webRequestId;
      toast('正在加载…');
      try {
        const data = await host.loadWeb(url);
        if (requestId !== webRequestId) return;
        if (!data) { toast('加载失败'); return; }
        await openWeb(Object.assign({ url }, data), { requestId }); // 提取结果不含 url，在此补上以记录进度
        if (requestId !== webRequestId) return;
        scroll.scrollTop = 0;
      } catch (e) {
        if (requestId === webRequestId) toast((e && e.message) || '加载失败');
      }
    }

    // ---------- 导航 ----------
    function nextChapter() {
      if (st.kind === 'txt') {
        if (st.chapter >= st.count - 1) { toast('已是最后一章'); return; }
        loadChapter(st.chapter + 1);
      } else if (st.kind === 'web') {
        if (!st.web.next) { toast('未找到下一章链接'); return; }
        loadWebUrl(st.web.next);
      }
    }
    function prevChapter() {
      if (st.kind === 'txt') {
        if (st.chapter <= 0) { toast('已是第一章'); return; }
        loadChapter(st.chapter - 1);
      } else if (st.kind === 'web') {
        if (!st.web.prev) { toast('未找到上一章链接'); return; }
        loadWebUrl(st.web.prev);
      }
    }
    function pageDown() {
      const step = (st.settings && st.settings.reading.scrollStep) || 0.9;
      const max = scroll.scrollHeight - scroll.clientHeight;
      if (max > 4 && scroll.scrollTop < max - 4) {
        scroll.scrollTop = Math.min(max, scroll.scrollTop + scroll.clientHeight * step);
      } else nextChapter();
    }
    function pageUp() {
      const step = (st.settings && st.settings.reading.scrollStep) || 0.9;
      if (scroll.scrollTop > 4) {
        scroll.scrollTop = Math.max(0, scroll.scrollTop - scroll.clientHeight * step);
      } else prevChapter();
    }

    function updateBar() {
      if (st.kind === 'txt') {
        btnPrev.disabled = st.chapter <= 0;
        btnNext.disabled = st.chapter >= st.count - 1;
        info.textContent = `${st.chapterTitle} · ${st.chapter + 1}/${st.count}`;
        info.title = '打开目录';
      } else if (st.kind === 'web') {
        btnPrev.disabled = !st.web.prev;
        btnNext.disabled = !st.web.next;
        info.textContent = st.web.title;
        info.title = st.web.url;
      } else {
        btnPrev.disabled = true;
        btnNext.disabled = true;
        info.textContent = '';
      }
      updateProgress();
    }

    function updateProgress() {
      let p = 0;
      if (st.kind === 'txt' && st.count > 0) p = (st.chapter + getRatio()) / st.count;
      else if (st.kind === 'web') p = getRatio();
      progress.style.width = (clamp(p, 0, 1) * 100) + '%';
    }

    // ---------- 目录（TXT 章节 / 在线书章节列表）----------
    // items: [{label, cur}]；onPick(item, 原始索引)
    function buildTocItems(items, onPick) {
      toc.textContent = '';
      const head = el('div', 'vr-toc-head');
      const input = el('input');
      input.placeholder = '搜索章节…';
      const closeBtn = el('button', null, '✕');
      const list = el('div', 'vr-toc-list');
      head.append(input, closeBtn);
      toc.append(head, list);

      let hint = null;
      function render(filter) {
        list.textContent = '';
        if (hint) hint.remove();
        hint = null;
        const f = (filter || '').trim().toLowerCase();
        let shown = 0;
        for (let i = 0; i < items.length; i++) {
          if (f && !items[i].label.toLowerCase().includes(f)) continue;
          if (++shown > 400) {
            hint = el('div', 'vr-toc-hint', '结果过多，请输入关键词缩小范围');
            list.appendChild(hint);
            break;
          }
          const b = el('button', null, `${i + 1}. ${items[i].label}`);
          if (items[i].cur) b.classList.add('cur');
          b.onclick = () => { closeOverlays(); onPick(items[i], i); };
          list.appendChild(b);
        }
        if (!shown && !hint) list.appendChild(el('div', 'vr-toc-hint', '没有匹配的章节'));
      }
      input.oninput = () => render(input.value);
      closeBtn.onclick = closeOverlays;
      render('');
      const cur = list.querySelector('.cur');
      if (cur) cur.scrollIntoView({ block: 'center' });
    }

    async function openToc() {
      if (st.kind === 'txt' && st.bookId) {
        let titles = null;
        try { titles = await host.getToc(st.bookId); } catch (e) { /* ignore */ }
        if (!titles) { toast('目录不可用'); return; }
        buildTocItems(
          titles.map((t, i) => ({ label: t, cur: i === st.chapter })),
          (item, i) => loadChapter(i)
        );
        toc.classList.add('open');
      } else if (st.kind === 'web' && st.web) {
        if (!st.web.catalog) { toast('该页未找到目录链接'); return; }
        if (!st.webCatalog) {
          toast('正在加载目录…');
          try {
            st.webCatalog = await host.loadCatalog(st.web.catalog);
          } catch (e) { st.webCatalog = null; }
          if (!st.webCatalog || !st.webCatalog.length) {
            st.webCatalog = null;
            toast('目录加载失败');
            return;
          }
        }
        const curUrl = st.web.url;
        const catalog = st.webCatalog;
        buildTocItems(
          catalog.map((c) => ({ label: c.t, cur: c.url === curUrl })),
          (item, i) => loadWebUrl(catalog[i].url)
        );
        toc.classList.add('open');
      }
    }

    // ---------- 快捷样式 ----------
    function buildStylePop() {
      stylePop.textContent = '';
      const d = st.settings ? { ...st.settings.display } : {};
      const my = (d.styles && d.styles[st.modeKey]) || {};

      const row = (label, key, val, fmt, min, max, step) => {
        const r = el('div', 'row');
        r.appendChild(el('span', 'lbl', label));
        const box = el('div', 'row');
        const minus = el('button', null, '−');
        const v = el('span', 'val', fmt(d[key]));
        const plus = el('button', null, '+');
        minus.onclick = () => change(-step);
        plus.onclick = () => change(step);
        function change(delta) {
          const nv = stepReaderSetting(d[key], val, delta, min, max);
          d[key] = nv;
          v.textContent = fmt(nv);
          if (st.settings) {
            st.settings.display[key] = nv;
            applySettings(st.settings);
          }
          host.patchSettings({ display: { [key]: nv } });
        }
        box.append(minus, v, plus);
        r.appendChild(box);
        return r;
      };

      stylePop.appendChild(row('字号', 'fontSize', 17, x => x + 'px', 12, 28, 1));
      stylePop.appendChild(row('行距', 'lineHeight', 1.85, x => x.toFixed(2), 1.2, 2.8, 0.05));

      // 透明度滑杆（最低 1%，按当前 UI 形态保存）
      const opRow = el('div', 'row');
      opRow.appendChild(el('span', 'lbl', '透明度'));
      const opBox = el('div', 'row');
      const slider = el('input');
      slider.type = 'range';
      slider.min = '0.01';
      slider.max = '1';
      slider.step = '0.01';
      slider.value = my.opacity != null ? my.opacity : (d.opacity != null ? d.opacity : 0.9);
      const opVal = el('span', 'val', Math.round(slider.value * 100) + '%');
      slider.oninput = () => {
        const v = parseFloat(slider.value);
        opVal.textContent = Math.round(v * 100) + '%';
        setOpacity(v);
      };
      opBox.append(slider, opVal);
      opRow.appendChild(opBox);
      stylePop.appendChild(opRow);

      // 毛玻璃开关（按当前 UI 形态保存）
      const glassOn = my.glass != null ? my.glass : d.glass !== false;
      const glassRow = el('div', 'row');
      glassRow.appendChild(el('span', 'lbl', '毛玻璃'));
      const gBtn = el('button', null, glassOn ? '开' : '关');
      gBtn.onclick = () => {
        const nv = gBtn.textContent !== '开';
        gBtn.textContent = nv ? '开' : '关';
        patchMyStyles({ glass: nv });
      };
      glassRow.appendChild(gBtn);
      stylePop.appendChild(glassRow);

      const swRow = el('div', 'row');
      swRow.appendChild(el('span', 'lbl', '配色'));
      const swatches = el('div', 'vr-swatches');
      for (const t of THEMES) {
        const b = el('button');
        b.style.background = t.bg;
        b.title = t.name;
        b.setAttribute('aria-label', `应用${t.name}配色`);
        const active = my.color === t.color && my.bgColor === t.bg;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
        b.onclick = () => {
          patchMyStyles({ color: t.color, bgColor: t.bg });
          buildStylePop();
        };
        swatches.appendChild(b);
      }
      swRow.appendChild(swatches);
      stylePop.appendChild(swRow);

      stylePop.appendChild(el('div', 'hint', styleHintForMode(st.modeKey)));

      if (st.modeKey === 'float') {
        const reset = el('div', 'more', '重置悬浮窗位置与大小');
        reset.onclick = () => {
          if (!st.settings) return;
          st.settings.display.float = {
            ...st.settings.display.float,
            x: null, y: null, w: 480, h: 600, bead: null,
          };
          setBeadAnchor(null);
          st.pendingBeadClearGeneration = null;
          host.patchSettings({ display: { float: st.settings.display.float } });
          applySettings(st.settings);
          closeOverlays();
        };
        stylePop.appendChild(reset);
      }

      const more = el('div', 'more', '更多设置…');
      more.onclick = () => host.openOptions && host.openOptions();
      stylePop.appendChild(more);
    }

    function closeOverlays() {
      toc.classList.remove('open');
      stylePop.classList.remove('open');
    }

    // ---------- Toast ----------
    function toast(msg) {
      toastEl.textContent = msg;
      wrap.classList.add('toast');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => wrap.classList.remove('toast'), 1400);
    }

    // ---------- 拖拽 / 缩放 ----------
    // setPointerCapture 在部分场景不可用，失败时回退到 document 监听
    function makeDrag(handle, onStart, onMove, onEnd, options) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const ctx = onStart(e);
        const move = (ev) => onMove(ev, ctx);
        const up = (ev) => {
          detach();
          onEnd && onEnd(ctx, ev);
          if (!options || options.emitGeometry !== false) emitGeometry();
        };
        const detach = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
        };
        let captured = false;
        try { handle.setPointerCapture(e.pointerId); captured = true; } catch (err) { captured = false; }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
        if (!captured) {
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        }
      });
    }

    makeDrag(bead,
      (e) => {
        const rect = bead.getBoundingClientRect();
        return {
          ox: e.clientX - rect.left,
          oy: e.clientY - rect.top,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
      },
      (ev, ctx) => {
        ctx.moved = ctx.moved || didPointerMove(ctx.startX, ctx.startY, ev.clientX, ev.clientY);
        placeBeadPoint({ x: ev.clientX - ctx.ox, y: ev.clientY - ctx.oy });
      },
      (ctx, ev) => {
        if (ev && Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) {
          ctx.moved = ctx.moved || didPointerMove(ctx.startX, ctx.startY, ev.clientX, ev.clientY);
          if (ctx.moved) placeBeadPoint({ x: ev.clientX - ctx.ox, y: ev.clientY - ctx.oy });
        }
        if (!ctx.moved) {
          if (host.onBeadRestoreRequested) host.onBeadRestoreRequested();
          else show({});
          return;
        }
        const point = {
          x: Math.round(parseFloat(bead.style.left) || 8),
          y: Math.round(parseFloat(bead.style.top) || 8),
        };
        setBeadAnchor(pointToBeadAnchor(point, {
          width: window.innerWidth, height: window.innerHeight,
        }));
        // 一并保存最新窗口几何，取消可能尚未落盘的旧坐标，避免它随后把圆点位置重置。
        const rect = panel.getBoundingClientRect();
        host.patchSettings({ display: { float: {
          x: Math.round(rect.left), y: Math.round(rect.top),
          w: Math.round(rect.width), h: Math.round(rect.height),
          bead: st.beadAnchor,
        } } });
      },
      { emitGeometry: false }
    );
    bead.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (host.onBeadRestoreRequested) host.onBeadRestoreRequested();
      else show({});
    });

    makeDrag(grab,
      (e) => {
        const rect = panel.getBoundingClientRect();
        grab.style.cursor = 'grabbing';
        return { rect, ox: e.clientX - rect.left, oy: e.clientY - rect.top };
      },
      (ev, { rect, ox, oy }) => {
        const xMin = 8 - rect.width + 60;
        panel.style.left = clamp(ev.clientX - ox, xMin, Math.max(xMin + 1, window.innerWidth - 60)) + 'px';
        panel.style.top = clamp(ev.clientY - oy, 0, Math.max(0, window.innerHeight - 40)) + 'px';
      },
      () => {
        grab.style.cursor = 'grab';
        snapFloatingPanel();
      }
    );
    grab.addEventListener('dblclick', () => {
      applyGeometry({ x: null, y: null, w: panel.offsetWidth, h: panel.offsetHeight });
      emitGeometry();
    });

    // 四角缩放：不限制最大尺寸，最小 80×60 防止缩没
    const MIN_W = 80, MIN_H = 60;
    const cornerMoves = {
      se: (r, x, y) => ({ left: r.left, top: r.top, right: Math.max(r.left + MIN_W, x), bottom: Math.max(r.top + MIN_H, y) }),
      sw: (r, x, y) => ({ left: Math.min(r.right - MIN_W, x), top: r.top, right: r.right, bottom: Math.max(r.top + MIN_H, y) }),
      ne: (r, x, y) => ({ left: r.left, top: Math.min(r.bottom - MIN_H, y), right: Math.max(r.left + MIN_W, x), bottom: r.bottom }),
      nw: (r, x, y) => ({ left: Math.min(r.right - MIN_W, x), top: Math.min(r.bottom - MIN_H, y), right: r.right, bottom: r.bottom }),
    };
    for (const corner of Object.keys(resizeHandleMap)) {
      makeDrag(resizeHandleMap[corner],
        () => panel.getBoundingClientRect(),
        (ev, rect) => {
          const b = cornerMoves[corner](rect, ev.clientX, ev.clientY);
          panel.style.left = b.left + 'px';
          panel.style.top = b.top + 'px';
          panel.style.width = (b.right - b.left) + 'px';
          panel.style.height = (b.bottom - b.top) + 'px';
        }
      );
    }

    // 贴边模式：拖内侧边缘调整宽度/厚度
    makeDrag(edgeDrag,
      () => null,
      (ev) => {
        const side = (wrap.dataset.mode || '').slice(5);
        if (!side) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        let size;
        if (side === 'right') size = vw - ev.clientX;
        else if (side === 'left') size = ev.clientX;
        else if (side === 'top') size = ev.clientY;
        else size = vh - ev.clientY;
        const maxDim = (side === 'top' || side === 'bottom') ? vh : vw;
        size = clamp(size, 200, Math.max(200, Math.floor(maxDim * 0.95)));
        if (side === 'left' || side === 'right') panel.style.width = size + 'px';
        else panel.style.height = size + 'px';
      },
      () => {
        if (!st.settings) return;
        const side = (wrap.dataset.mode || '').slice(5);
        if (!side) return;
        const size = (side === 'left' || side === 'right') ? panel.offsetWidth : panel.offsetHeight;
        st.settings.display.width = size;
        host.patchSettings({ display: { width: size } });
      }
    );

    function emitGeometry() {
      if (wrap.dataset.mode !== 'float') return;
      const rect = panel.getBoundingClientRect();
      // 悬浮窗重新移动或缩放后，恢复圆点应重新依附它的最新位置。
      setBeadAnchor(null);
      st.pendingBeadClearGeneration = host.onGeometry ? st.beadAnchorGeneration : null;
      host.onGeometry && host.onGeometry({
        x: Math.round(rect.left), y: Math.round(rect.top),
        w: Math.round(rect.width), h: Math.round(rect.height),
        bead: null,
      });
    }

    function snapFloatingPanel() {
      if (wrap.dataset.mode !== 'float' || !st.settings || !st.settings.display.float.snap) return;
      const rect = panel.getBoundingClientRect();
      const g = snapFloatGeometry({
        x: Math.round(rect.left), y: Math.round(rect.top),
        w: Math.round(rect.width), h: Math.round(rect.height),
      }, { width: window.innerWidth, height: window.innerHeight });
      panel.style.left = g.x + 'px';
      panel.style.top = g.y + 'px';
    }

    // ---------- 事件 ----------
    scroll.addEventListener('scroll', () => {
      if (st.presentation !== 'panel' || st.emptyShown) return;
      updateProgress();
      queueSave();
    }, { passive: true });

    // Ctrl + 滚轮：快速调节面板透明度（拦截浏览器缩放，按当前 UI 形态保存）
    panel.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const d = st.settings && st.settings.display;
      const my = d && d.styles && d.styles[st.modeKey];
      const cur = my && my.opacity != null ? my.opacity : ((d && d.opacity) || 0.9);
      setOpacity(cur + (e.deltaY < 0 ? 0.04 : -0.04));
    }, { passive: false });

    btnPrev.onclick = prevChapter;
    btnNext.onclick = nextChapter;
    btnClose.onclick = hide;
    btnToc.onclick = () => {
      if (toc.classList.contains('open')) closeOverlays();
      else { closeOverlays(); openToc(); }
    };
    btnAa.onclick = () => {
      if (stylePop.classList.contains('open')) closeOverlays();
      else { closeOverlays(); buildStylePop(); stylePop.classList.add('open'); }
    };
    info.onclick = () => btnToc.onclick();

    // 点击面板外部关闭弹层
    panel.addEventListener('pointerdown', (e) => {
      if (!toc.classList.contains('open') && !stylePop.classList.contains('open')) return;
      if (!toc.contains(e.target) && !stylePop.contains(e.target) &&
          e.target !== btnToc && e.target !== btnAa && e.target !== info) {
        closeOverlays();
      }
    }, true);

    // ---------- 对外 API ----------
    return {
      el: wrap,
      panel,
      show,
      hide,
      showBead,
      hideBead,
      collapse,
      toggle,
      isVisible: () => st.presentation === 'panel',
      isCollapsed: () => st.presentation === 'bead',
      getPresentation: () => st.presentation,
      openedViaHover: () => st.viaHover,
      openBook,
      openWeb,
      renderEmpty,
      nextChapter,
      prevChapter,
      pageDown,
      pageUp,
      applySettings,
      flushProgress,
      toast,
      getState: () => ({
        kind: st.kind, bookId: st.bookId, chapter: st.chapter, count: st.count,
        web: st.web ? { url: st.web.url } : null,
      }),
    };
  };
})();
