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
test('store documents cover listings, permissions, privacy, and reviewer guidance', () => {
  const { auditStoreDocuments } = require('../../tools/release/audit.js');
  assert.deepEqual(auditStoreDocuments(root), []);
});
test('release audit validates PNG dimensions and rejects malformed PNG data', () => {
  const { readPngSize } = require('../../tools/release/audit.js');
  assert.deepEqual(readPngSize(fs.readFileSync(path.join(root, 'icons/icon128.png'))), { width: 128, height: 128 });
  assert.throws(() => readPngSize(Buffer.from('not a png')), /PNG signature/);
});

test('release audit reports missing assets, permission gaps, and executable remote code', (t) => {
  const { auditRepository } = require('../../tools/release/audit.js');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'veilread-release-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(root, fixture, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source).replaceAll('\\', '/');
      return !relative.startsWith('.git') && !relative.startsWith('.claude') && !relative.startsWith('node_modules') && !relative.startsWith('dist');
    },
  });
  fs.rmSync(path.join(fixture, 'icons/icon16.png'));
  fs.writeFileSync(path.join(fixture, 'icons/icon48.png'), 'broken');
  fs.appendFileSync(path.join(fixture, 'content/content.js'), "\neval('blocked');\n");
  const permissions = path.join(fixture, 'store/compliance/permissions-zh-CN.md');
  fs.writeFileSync(permissions, fs.readFileSync(permissions, 'utf8').replace('`storage`', '`removed-storage`'));

  const output = auditRepository(fixture).join('\n');
  assert.match(output, /icons\/icon16\.png: missing/);
  assert.match(output, /icons\/icon48\.png: invalid PNG/);
  assert.match(output, /permissions-zh-CN\.md: missing permission storage/);
  assert.match(output, /content\/content\.js: prohibited eval/);
});

test('release audit passes for the repository', () => {
  const { auditRepository } = require('../../tools/release/audit.js');
  assert.deepEqual(auditRepository(root), []);
});
test('release documentation links every compliance resource and command', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const link of ['RIGHTS.md', 'store/README.md', 'docs/releasing.md', 'site/privacy/zh-CN/', 'site/privacy/en/', 'site/support/zh-CN/', 'site/support/en/']) {
    assert.ok(readme.includes(link), `README should link ${link}`);
  }
  const releasing = fs.readFileSync(path.join(root, 'docs/releasing.md'), 'utf8');
  for (const text of ['npm run release:check', 'npm run assets', 'npm run package', 'Chrome', 'Edge', '开发者模式', '人工提交', '版本', 'GitHub Actions', 'Git tag']) {
    assert.ok(releasing.includes(text), `release guide should contain ${text}`);
  }
});
test('workflow configuration verifies releases and deploys only the static site', () => {
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  for (const text of ['push:', 'pull_request:', 'actions/checkout@v4', 'actions/setup-node@v4', 'node-version: 20', 'npm run release:check', 'npm run package']) {
    assert.ok(ci.includes(text), `CI should contain ${text}`);
  }
  const pages = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  for (const text of ['actions/configure-pages@', 'actions/upload-pages-artifact@', 'actions/deploy-pages@', 'path: site', 'contents: read', 'pages: write', 'id-token: write']) {
    assert.ok(pages.includes(text), `Pages workflow should contain ${text}`);
  }
  assert.doesNotMatch(ci + pages, /CLIENT_SECRET|API_KEY|CHROME_WEB_STORE|EDGE_PRODUCT/i);
});
