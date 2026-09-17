(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VeilReadSite = api;
})(globalThis, function () {
  'use strict';

  function languageEntry(language) {
    return /^zh(?:-|$)/i.test(String(language || '')) ? './zh-CN/' : './en/';
  }

  return { languageEntry };
});
