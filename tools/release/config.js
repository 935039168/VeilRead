'use strict';

const assetSpecs = [
  { name: 'chrome-icon-128.png', width: 128, height: 128, source: 'copy' },
  { name: 'edge-logo-300.png', width: 300, height: 300, source: 'promo', kind: 'logo' },
  ...['zh-CN', 'en'].flatMap((locale) => [
    { name: `promo-small-${locale}.png`, width: 440, height: 280, source: 'promo', kind: 'small', locale },
    { name: `promo-large-${locale}.png`, width: 1400, height: 560, source: 'promo', kind: 'large', locale },
  ]),
  ...['zh-CN', 'en'].flatMap((locale) => [
    ['01', 'float'], ['02', 'edge'], ['03', 'sidebar'], ['04', 'settings'], ['05', 'library'],
  ].map(([number, scene]) => ({
    name: `screenshot-${number}-${scene}-${locale}.png`, width: 1280, height: 800, source: 'screenshot', scene, locale,
  }))),
];
module.exports = Object.freeze({
  locales: ['zh_CN', 'en'],
  assetSpecs,
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
