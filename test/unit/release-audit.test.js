const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('manifest metadata is localized and versions stay aligned', () => {
  const { auditManifestAndLocales } = require('../../tools/release/audit.js');
  assert.deepEqual(auditManifestAndLocales(root), []);
});
