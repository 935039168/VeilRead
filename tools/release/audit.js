'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('parse5');
const { locales, runtimeRoots, assetSpecs } = require('./config.js');

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

function elementAttribute(element, name) {
  const attribute = (element.attrs || []).find((item) => item.name === name);
  return attribute ? attribute.value : null;
}

function isHiddenElement(element) {
  if ((element.attrs || []).some((attribute) => attribute.name === 'hidden')) return true;
  if (/^true$/i.test(elementAttribute(element, 'aria-hidden') || '')) return true;
  const style = elementAttribute(element, 'style') || '';
  return /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/i.test(style)
    || /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)(?:\s*!important)?\s*(?:;|$)/i.test(style);
}

function visibleNodeText(node) {
  if (node.nodeName === '#text') return node.value;
  if (node.nodeName === '#comment') return '';
  if (node.tagName && (['script', 'style', 'template'].includes(node.tagName) || isHiddenElement(node))) return '';
  return (node.childNodes || []).map(visibleNodeText).join(' ');
}

function visibleStatusElements(html) {
  const statuses = [];
  function visit(node, hidden) {
    const elementHidden = hidden || Boolean(node.tagName && (['script', 'style', 'template'].includes(node.tagName) || isHiddenElement(node)));
    if (elementHidden) return;
    if (node.tagName) {
      const classes = (elementAttribute(node, 'class') || '').split(/\s+/).filter(Boolean);
      if (classes.includes('status')) {
        statuses.push({
          browser: (elementAttribute(node, 'data-browser') || '').trim(),
          state: (elementAttribute(node, 'data-state') || '').trim(),
          text: visibleNodeText(node).replace(/\s+/g, ' ').trim(),
        });
      }
    }
    for (const child of node.childNodes || []) visit(child, elementHidden);
  }
  visit(parse(String(html)), false);
  return statuses;
}

function auditPublicSite(root) {
  const languageRouter = path.join(root, 'site/language.js');
  const languageError = fs.existsSync(languageRouter) ? [] : ['site/language.js: missing language router'];
  const errors = [...languageError];
  const pages = [
    'site/index.html',
    'site/zh-CN/index.html',
    'site/en/index.html',
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

  const storeStatuses = [
    ['site/zh-CN/index.html', { chrome: 'Chrome 即将上线', edge: 'Edge 即将上线' }],
    ['site/en/index.html', { chrome: 'Chrome · Coming soon', edge: 'Edge · Coming soon' }],
  ];
  for (const [relative, expectedTexts] of storeStatuses) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const statuses = visibleStatusElements(fs.readFileSync(file, 'utf8'));
    for (const browser of ['chrome', 'edge']) {
      const label = browser[0].toUpperCase() + browser.slice(1);
      const matches = statuses.filter((status) => status.browser === browser);
      if (matches.length === 0) {
        errors.push(`${relative}: missing ${label} status ${expectedTexts[browser]}`);
        continue;
      }
      if (matches.length > 1) {
        errors.push(`${relative}: duplicate ${label} status elements`);
        continue;
      }
      if (matches[0].state !== 'coming-soon') errors.push(`${relative}: ${label} status data-state must be coming-soon`);
      if (matches[0].text !== expectedTexts[browser]) errors.push(`${relative}: ${label} status text must be ${expectedTexts[browser]}`);
    }
    for (const status of statuses.filter((item) => item.browser !== 'chrome' && item.browser !== 'edge')) {
      errors.push(`${relative}: status element has invalid data-browser ${status.browser || '(missing)'}`);
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

function auditStoreDocuments(root) {
  const errors = [];
  const files = [
    'store/README.md',
    'store/listing/chrome-zh-CN.md',
    'store/listing/chrome-en.md',
    'store/listing/edge-zh-CN.md',
    'store/listing/edge-en.md',
    'store/compliance/permissions-zh-CN.md',
    'store/compliance/permissions-en.md',
    'store/compliance/privacy-questionnaire-zh-CN.md',
    'store/compliance/privacy-questionnaire-en.md',
    'store/review/chrome-notes-zh-CN.md',
    'store/review/chrome-notes-en.md',
    'store/review/edge-notes-zh-CN.md',
    'store/review/edge-notes-en.md',
    'store/release-checklist.md',
  ];
  const contents = new Map();
  for (const relative of files) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      errors.push(`${relative}: missing store document`);
      continue;
    }
    contents.set(relative, fs.readFileSync(file, 'utf8'));
  }

  const { permissionKeys, publicUrls } = require('./config.js');
  for (const relative of ['store/compliance/permissions-zh-CN.md', 'store/compliance/permissions-en.md']) {
    const text = contents.get(relative);
    if (!text) continue;
    for (const permission of permissionKeys) {
      if (!text.includes(`\`${permission}\``)) errors.push(`${relative}: missing permission ${permission}`);
    }
  }

  for (const relative of files.filter((item) => /listing|privacy-questionnaire|review/.test(item))) {
    const text = contents.get(relative);
    if (!text) continue;
    const english = relative.endsWith('-en.md');
    const privacy = english ? publicUrls.privacyEn : publicUrls.privacyZh;
    const support = english ? publicUrls.supportEn : publicUrls.supportZh;
    if (!text.includes(privacy)) errors.push(`${relative}: missing privacy URL`);
    if (!text.includes(support)) errors.push(`${relative}: missing support URL`);
  }

  const banned = [/隐蔽/u, /摸鱼/u, /躲避监控/u, /\bbest\b/i, /#1\b/i, /officially certified/i];
  for (const [relative, text] of contents) {
    for (const pattern of banned) {
      if (pattern.test(text)) errors.push(`${relative}: contains prohibited claim ${pattern.source}`);
    }
  }

  for (const relative of files.filter((item) => item.startsWith('store/review/'))) {
    const text = contents.get(relative);
    if (!text) continue;
    const concepts = relative.endsWith('-en.md')
      ? ['floating', 'edge panel', 'side panel', 'TXT', 'online', 'Settings', 'emergency hide']
      : ['自由悬浮窗', '贴边面板', '侧边栏', 'TXT', '在线', '设置', '紧急隐藏'];
    for (const concept of concepts) {
      if (!text.toLowerCase().includes(concept.toLowerCase())) errors.push(`${relative}: missing review step ${concept}`);
    }
  }
  return errors;
}

function readPngSize(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('invalid PNG signature');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG is missing IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function walkFiles(root, relative) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [relative.replaceAll('\\', '/')];
  return fs.readdirSync(target, { withFileTypes: true })
    .flatMap((entry) => walkFiles(root, path.join(relative, entry.name)))
    .sort();
}

function auditIcons(root) {
  const errors = [];
  for (const size of [16, 48, 128]) {
    const relative = `icons/icon${size}.png`;
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      errors.push(`${relative}: missing`);
      continue;
    }
    try {
      const actual = readPngSize(fs.readFileSync(file));
      if (actual.width !== size || actual.height !== size) errors.push(`${relative}: expected ${size}x${size}, got ${actual.width}x${actual.height}`);
    } catch (error) {
      errors.push(`${relative}: invalid PNG (${error.message})`);
    }
  }
  return errors;
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let value = '';
      let dynamic = false;
      index++;
      while (index < source.length) {
        const current = source[index++];
        if (current === '\\') {
          value += current;
          if (index < source.length) value += source[index++];
          continue;
        }
        if (quote === '`' && current === '$' && source[index] === '{') dynamic = true;
        if (current === quote) break;
        value += current;
      }
      tokens.push({ type: quote === '`' ? 'template' : 'string', value, dynamic });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index++;
      tokens.push({ type: 'identifier', value: source.slice(start, index) });
      continue;
    }
    tokens.push({ type: 'punctuator', value: char });
    index++;
  }
  return tokens;
}

function isLocalModuleArgument(tokens) {
  if (tokens.length !== 1) return false;
  const token = tokens[0];
  if (token.type !== 'string' && token.type !== 'template') return false;
  if (token.dynamic) return false;
  return token.value.startsWith('./') || token.value.startsWith('../');
}

function readCallArguments(tokens, openIndex) {
  if (!tokens[openIndex] || tokens[openIndex].value !== '(') return null;
  const args = [[]];
  let depth = 0;
  for (let index = openIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.value === '(' || token.value === '[' || token.value === '{') {
      depth++;
      args[args.length - 1].push(token);
    } else if (token.value === ')' && depth === 0) {
      if (args.length === 1 && args[0].length === 0) return [];
      return args;
    } else if (token.value === ')' || token.value === ']' || token.value === '}') {
      depth--;
      args[args.length - 1].push(token);
    } else if (token.value === ',' && depth === 0) {
      args.push([]);
    } else {
      args[args.length - 1].push(token);
    }
  }
  return null;
}

function staticModuleSpecifier(tokens, start) {
  const first = tokens[start + 1];
  if (first && (first.type === 'string' || first.type === 'template')) return first;
  for (let index = start + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.value === ';' || (index > start + 1 && (token.value === 'import' || token.value === 'export'))) break;
    if (token.type === 'identifier' && token.value === 'from') return tokens[index + 1] || null;
  }
  return null;
}

function auditJavaScriptSource(source) {
  const tokens = tokenizeJavaScript(source);
  const violations = new Set();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    if (token.value === 'import') {
      if (tokens[index + 1] && tokens[index + 1].value === '.') continue;
      if (tokens[index + 1] && tokens[index + 1].value === '(') {
        const args = readCallArguments(tokens, index + 1);
        if (!args || args.length !== 1 || !isLocalModuleArgument(args[0])) violations.add('remote module import');
      } else {
        const specifier = staticModuleSpecifier(tokens, index);
        if (specifier && !isLocalModuleArgument([specifier])) violations.add('remote module import');
      }
    } else if (token.value === 'export') {
      const specifier = staticModuleSpecifier(tokens, index);
      if (specifier && !isLocalModuleArgument([specifier])) violations.add('remote module import');
    } else if (token.value === 'importScripts' && tokens[index + 1] && tokens[index + 1].value === '(') {
      const args = readCallArguments(tokens, index + 1);
      if (!args || args.some((argument) => !isLocalModuleArgument(argument))) violations.add('remote importScripts');
    }
  }
  return [...violations];
}

function auditRuntimeCode(root) {
  const errors = [];
  const patterns = [
    ['eval', /\beval\s*\(/],
    ['new Function', /\bnew\s+Function\s*\(/],
    ['remote script', /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i],
  ];
  const files = runtimeRoots.flatMap((relative) => walkFiles(root, relative));
  for (const relative of files.filter((file) => /\.(?:js|html)$/i.test(file))) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) errors.push(`${relative}: prohibited ${label}`);
    }
    for (const label of auditJavaScriptSource(text)) errors.push(`${relative}: prohibited ${label}`);
  }
  return errors;
}

function auditStoreAssets(root) {
  const errors = [];
  for (const asset of assetSpecs) {
    const relative = `store/assets/generated/${asset.name}`;
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      errors.push(`${relative}: missing`);
      continue;
    }
    try {
      const actual = readPngSize(fs.readFileSync(file));
      if (actual.width !== asset.width || actual.height !== asset.height) {
        errors.push(`${relative}: expected ${asset.width}x${asset.height}, got ${actual.width}x${actual.height}`);
      }
    } catch (error) {
      errors.push(`${relative}: invalid PNG (${error.message})`);
    }
  }
  return errors;
}

function auditRepository(root) {
  return [
    ...auditManifestAndLocales(root),
    ...auditPublicSite(root),
    ...auditStoreDocuments(root),
    ...auditIcons(root),
    ...auditRuntimeCode(root),
    ...auditStoreAssets(root),
  ].sort();
}

module.exports = {
  auditManifestAndLocales,
  auditPublicSite,
  auditStoreDocuments,
  readPngSize,
  walkFiles,
  auditStoreAssets,
  auditJavaScriptSource,
  auditRepository,
};
