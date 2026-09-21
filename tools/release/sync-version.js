#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function syncReleaseVersion(root) {
  const manifest = readJson(path.join(root, 'manifest.json'));
  const version = String(manifest.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('manifest.json: version must use MAJOR.MINOR.PATCH');

  const packageFile = path.join(root, 'package.json');
  const lockFile = path.join(root, 'package-lock.json');
  const pkg = readJson(packageFile);
  const lock = readJson(lockFile);
  if (!lock.packages || !lock.packages['']) throw new Error('package-lock.json: missing root package metadata');

  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  writeJson(packageFile, pkg);
  writeJson(lockFile, lock);
  return version;
}

module.exports = { syncReleaseVersion };

if (require.main === module) {
  try {
    const version = syncReleaseVersion(path.resolve(__dirname, '../..'));
    console.log(`Synchronized package metadata to ${version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
