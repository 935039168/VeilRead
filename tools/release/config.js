'use strict';

module.exports = Object.freeze({
  locales: ['zh_CN', 'en'],
  runtimeRoots: ['manifest.json', '_locales', 'icons', 'background', 'content', 'lib', 'options', 'popup', 'reader', 'sidebar'],
  permissionKeys: ['storage', 'unlimitedStorage', 'sidePanel', 'contextMenus', 'scripting', 'http://*/*', 'https://*/*'],
  publicUrls: Object.freeze({
    home: 'https://935039168.github.io/VeilRead/',
    privacyZh: 'https://935039168.github.io/VeilRead/privacy/zh-CN/',
    privacyEn: 'https://935039168.github.io/VeilRead/privacy/en/',
    supportZh: 'https://935039168.github.io/VeilRead/support/zh-CN/',
    supportEn: 'https://935039168.github.io/VeilRead/support/en/',
    rights: 'https://935039168.github.io/VeilRead/rights/',
  }),
});
