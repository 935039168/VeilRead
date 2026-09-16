'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { locales } = require('./config.js');

function readJson(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${path.relative(process.cwd(), file)}: ${error.message}`);
    return null;
  }
}

function messageKey(value) {
  const match = /^__MSG_([A-Za-z0-9_]+)__$/.exec(String(value || ''));
  return match ? match[1] : null;
}

function auditManifestAndLocales(root) {
  const errors = [];
  const manifest = readJson(path.join(root, 'manifest.json'), errors);
  const pkg = readJson(path.join(root, 'package.json'), errors);
  if (!manifest || !pkg) return errors;

  if (manifest.manifest_version !== 3) errors.push('manifest.json: manifest_version must be 3');
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) errors.push('manifest.json: version must use MAJOR.MINOR.PATCH');
  if (manifest.version !== pkg.version) errors.push('manifest.json: version must match package.json');
  if (manifest.default_locale !== 'zh_CN') errors.push('manifest.json: default_locale must be zh_CN');

  const keys = ['name', 'description'].map((field) => {
    const key = messageKey(manifest[field]);
    if (!key) errors.push(`manifest.json: ${field} must use a __MSG_*__ reference`);
    return [field, key];
  });

  for (const locale of locales) {
    const file = path.join(root, '_locales', locale, 'messages.json');
    const messages = readJson(file, errors);
    if (!messages) continue;
    for (const [field, key] of keys) {
      if (!key) continue;
      const value = messages[key] && messages[key].message;
      if (typeof value !== 'string' || !value.trim()) errors.push(`${path.relative(root, file)}: missing non-empty message for ${field} (${key})`);
    }
  }
  return errors;
}

function auditPublicSite(root) {
  const errors = [];
  const pages = [
    'site/index.html',
    'site/privacy/zh-CN/index.html',
    'site/privacy/en/index.html',
    'site/support/zh-CN/index.html',
    'site/support/en/index.html',
    'site/rights/index.html',
  ];
  for (const relative of pages) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      errors.push(`${relative}: missing public page`);
      continue;
    }
    const html = fs.readFileSync(file, 'utf8');
    const requirements = [
      ['UTF-8 charset', /<meta\s+charset=["']?UTF-8/i],
      ['viewport', /<meta\s+name=["']viewport["']/i],
      ['home link', /href=["']\/VeilRead\/["']/i],
      ['Chinese link', /zh-CN/i],
      ['English link', /\/en\//i],
    ];
    for (const [label, pattern] of requirements) {
      if (!pattern.test(html)) errors.push(`${relative}: missing ${label}`);
    }
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
      const clean = href.split(/[?#]/, 1)[0];
      let target;
      if (clean.startsWith('/VeilRead/')) target = path.join(root, 'site', clean.slice('/VeilRead/'.length));
      else target = path.resolve(path.dirname(file), clean);
      if (clean.endsWith('/')) target = path.join(target, 'index.html');
      if (!fs.existsSync(target)) errors.push(`${relative}: broken local link ${href}`);
    }
  }

  const privacyFiles = ['site/privacy/zh-CN/index.html', 'site/privacy/en/index.html'];
  const privacyFacts = ['2026-09-16', 'chrome.storage.local', 'IndexedDB', 'github.com/935039168/VeilRead/issues'];
  for (const relative of privacyFiles) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    for (const fact of privacyFacts) {
      if (!html.includes(fact)) errors.push(`${relative}: missing privacy fact ${fact}`);
    }
    const normalized = html.toLowerCase();
    const concepts = relative.includes('zh-CN')
      ? ['本地', '网页', '同一网站', '广告', '遥测', '分析', '出售', '跨站跟踪', '卸载']
      : ['local', 'web page', 'same website', 'advertising', 'telemetry', 'analytics', 'sale', 'cross-site tracking', 'uninstall'];
    for (const concept of concepts) {
      if (!normalized.includes(concept.toLowerCase())) errors.push(`${relative}: missing privacy concept ${concept}`);
    }
  }
  return errors;
}

module.exports = { auditManifestAndLocales, auditPublicSite };
