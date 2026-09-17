// VeilRead — popup 阅读模式视图模型（浏览器 / CommonJS 共用）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VeilRead = root.VeilRead || {};
  root.VeilRead.popupMode = api;
})(globalThis, function () {
  'use strict';

  function getPopupModeView(mode) {
    if (mode === 'edge') {
      return {
        floatPressed: false,
        edgePressed: true,
        tip: '贴边面板会从设置的浏览器边缘滑出，减少页面遮挡。',
      };
    }
    if (mode === 'sidebar') {
      return {
        floatPressed: false,
        edgePressed: false,
        tip: '当前使用浏览器原生侧边栏，不会在网页中显示悬浮窗或贴边面板。',
      };
    }
    return {
      floatPressed: true,
      edgePressed: false,
      tip: '自由悬浮窗可拖动、缩放，移出后可收起为恢复圆点。',
    };
  }

  return { getPopupModeView };
});
