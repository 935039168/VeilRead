#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeRoots } = require('./config.js');
const { auditRepository, walkFiles } = require('./audit.js');
const { createZip, listZipEntries } = require('./zip.js');

function collectRuntimeEntries(root) {
  return runtimeRoots.flatMap((relative) => walkFiles(root, relative))
    .sort()
    .map((name) => ({ name, data: fs.readFileSync(path.join(root, name)) }));
}

function manifestReferences(manifest) {
  const files = new Set();
  const add = (value) => { if (typeof value === 'string') files.add(value); };
  Object.values(manifest.icons || {}).forEach(add);
  add(manifest.action && manifest.action.default_popup);
  Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(add);
  add(manifest.options_ui && manifest.options_ui.page);
  add(manifest.background && manifest.background.service_worker);
  add(manifest.side_panel && manifest.side_panel.default_path);
  for (const script of manifest.content_scripts || []) {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  }
  return [...files].sort();
}

function verifyPackageEntries(root, names) {
  const errors = [];
  const set = new Set(names);
  if (!set.has('manifest.json')) errors.push('manifest.json: missing from ZIP root');
  const forbidden = /^(?:\.git|\.claude|docs|site|store|test|tools)(?:\/|$)|^(?:package\.json|README(?:\.md)?)(?:$)|\.map$/i;
  for (const name of names) {
    if (forbidden.test(name)) errors.push(`${name}: development file must not be packaged`);
  }
  const manifestFile = path.join(root, 'manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    for (const reference of manifestReferences(manifest)) {
      if (!set.has(reference)) errors.push(`${reference}: referenced by manifest but missing from ZIP`);
    }
  }
  return errors.sort();
}

function buildPackage(root) {
  const auditErrors = auditRepository(root);
  if (auditErrors.length) throw new Error(`release audit failed:\n${auditErrors.join('\n')}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const entries = collectRuntimeEntries(root);
  const zip = createZip(entries);
  const names = listZipEntries(zip);
  const packageErrors = verifyPackageEntries(root, names);
  if (packageErrors.length) throw new Error(`package verification failed:\n${packageErrors.join('\n')}`);
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const output = path.join(dist, `VeilRead-v${manifest.version}.zip`);
  fs.writeFileSync(output, zip);
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  console.log(`Created ${path.relative(root, output)}: ${names.length} files, ${zip.length} bytes, sha256 ${hash}`);
  return { output, names, bytes: zip.length, sha256: hash };
}

module.exports = { collectRuntimeEntries, manifestReferences, verifyPackageEntries, buildPackage };

if (require.main === module) {
  try {
    buildPackage(path.resolve(__dirname, '../..'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
