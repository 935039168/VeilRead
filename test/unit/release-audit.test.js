const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '../..');

test('manifest metadata is localized and versions stay aligned', () => {
  const { auditManifestAndLocales } = require('../../tools/release/audit.js');
  assert.deepEqual(auditManifestAndLocales(root), []);
});
test('public site provides complete bilingual privacy, support, and rights pages', () => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  assert.deepEqual(auditPublicSite(root), []);
});
test('public site audit reports broken local links', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'veilread-site-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'site'), path.join(fixture, 'site'), { recursive: true });
  const home = path.join(fixture, 'site', 'index.html');
  fs.appendFileSync(home, '<a href="./missing-page/">broken</a>');
  assert.match(auditPublicSite(fixture).join('\n'), /site\/index\.html: broken local link \.\/missing-page\//);
});
