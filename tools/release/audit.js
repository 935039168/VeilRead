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

module.exports = { auditManifestAndLocales };
