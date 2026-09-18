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
  fs.rmSync(path.join(fixture, 'site', 'language.js'), { force: true });
  const output = auditPublicSite(fixture).join('\n');
  assert.match(output, /site\/index\.html: broken local link \.\/missing-page\//);
  assert.match(output, /site\/language\.js: missing language router/);
});
test('public site audit requires every public page', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'veilread-pages-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'site'), path.join(fixture, 'site'), { recursive: true });
  const requiredPages = [
    'site/index.html',
    'site/zh-CN/index.html',
    'site/en/index.html',
    'site/privacy/zh-CN/index.html',
    'site/privacy/en/index.html',
    'site/support/zh-CN/index.html',
    'site/support/en/index.html',
    'site/rights/index.html',
  ];
  for (const relative of requiredPages) fs.rmSync(path.join(fixture, relative));

  const output = auditPublicSite(fixture).join('\n');
  for (const relative of requiredPages) {
    assert.match(output, new RegExp(`${relative.replaceAll('.', '\\.')}: missing public page`));
  }
});
test('public site audit requires localized Chrome and Edge coming-soon statuses', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'veilread-status-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'site'), path.join(fixture, 'site'), { recursive: true });
  const zhProduct = path.join(fixture, 'site/zh-CN/index.html');
  const enProduct = path.join(fixture, 'site/en/index.html');
  fs.writeFileSync(zhProduct, fs.readFileSync(zhProduct, 'utf8').replaceAll('即将上线', '现已上线'));
  fs.writeFileSync(enProduct, fs.readFileSync(enProduct, 'utf8').replaceAll('Coming soon', 'Available now'));

  const output = auditPublicSite(fixture).join('\n');
  assert.match(output, /site\/zh-CN\/index\.html: missing Chrome status 即将上线/);
  assert.match(output, /site\/zh-CN\/index\.html: missing Edge status 即将上线/);
  assert.match(output, /site\/en\/index\.html: missing Chrome status Coming soon/);
  assert.match(output, /site\/en\/index\.html: missing Edge status Coming soon/);
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
  fs.appendFileSync(path.join(fixture, 'content/content.js'), "\neval('blocked');\nimport 'https://cdn.example.test/module.js';\nimportScripts('https://cdn.example.test/worker.js');\n");
  const permissions = path.join(fixture, 'store/compliance/permissions-zh-CN.md');
  fs.writeFileSync(permissions, fs.readFileSync(permissions, 'utf8').replace('`storage`', '`removed-storage`'));

  const output = auditRepository(fixture).join('\n');
  assert.match(output, /icons\/icon16\.png: missing/);
  assert.match(output, /icons\/icon48\.png: invalid PNG/);
  assert.match(output, /permissions-zh-CN\.md: missing permission storage/);
  assert.match(output, /content\/content\.js: prohibited eval/);
  assert.match(output, /content\/content\.js: prohibited remote module import/);
  assert.match(output, /content\/content\.js: prohibited remote importScripts/);
});

test('runtime audit rejects non-local module loading syntax and permits static relative paths', (t) => {
  const { auditRepository } = require('../../tools/release/audit.js');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'veilread-import-audit-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(root, fixture, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source).replaceAll('\\', '/');
      return !relative.startsWith('.git') && !relative.startsWith('.claude') && !relative.startsWith('node_modules') && !relative.startsWith('dist');
    },
  });
  const cases = new Map([
    ['remote-dynamic-comment.js', "import(/* reviewer */ `https://cdn.example.test/module.js`);"],
    ['dynamic-variable.js', 'import(moduleSpecifier);'],
    ['bare-static.js', "import 'https://cdn.example.test/bare.js';"],
    ['export-from.js', "export * from 'https://cdn.example.test/export.js';"],
    ['import-scripts-template.js', 'importScripts(`https://cdn.example.test/worker.js`);'],
    ['local-imports.js', "import './one.js';\nimport value from '../two.js';\nexport { value } from './three.js';\nimport(/* local */ `./four.js`);\nimportScripts('../five.js', './six.js');"],
  ]);
  for (const [name, source] of cases) fs.writeFileSync(path.join(fixture, 'content', name), source);

  const output = auditRepository(fixture).join('\n');
  for (const name of ['remote-dynamic-comment.js', 'dynamic-variable.js', 'bare-static.js', 'export-from.js', 'import-scripts-template.js']) {
    assert.match(output, new RegExp(`content/${name.replace('.', '\\.')}.*: prohibited remote`));
  }
  assert.doesNotMatch(output, /content\/local-imports\.js/);
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
  assert.match(pages, /uses:\s*actions\/configure-pages@v5\s*\r?\n\s*with:\s*\r?\n\s*enablement:\s*true/);
  assert.doesNotMatch(ci + pages, /CLIENT_SECRET|API_KEY|CHROME_WEB_STORE|EDGE_PRODUCT/i);
});
test('product home selects a localized entry and both languages remain switchable', () => {
  const gateway = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  assert.match(gateway, /navigator\.language/i);
  assert.match(gateway, /location\.replace/);
  const zh = fs.readFileSync(path.join(root, 'site/zh-CN/index.html'), 'utf8');
  const en = fs.readFileSync(path.join(root, 'site/en/index.html'), 'utf8');
  assert.match(zh, /href="\/VeilRead\/en\/"/);
  assert.match(en, /href="\/VeilRead\/zh-CN\/"/);
  assert.match(gateway, /href="\.\/zh-CN\/"/);
  assert.match(gateway, /href="\.\/en\/"/);
});
