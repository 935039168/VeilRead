const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '../..');

function copySiteFixture(prefix, t) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'site'), path.join(fixture, 'site'), { recursive: true });
  return fixture;
}

function replaceProductStatuses(fixture, locale, markup) {
  const file = path.join(fixture, 'site', locale, 'index.html');
  const original = fs.readFileSync(file, 'utf8');
  const updated = original.replace(/<span class="status"[^>]*>[\s\S]*?<\/span><span class="status"[^>]*>[\s\S]*?<\/span>/, markup);
  assert.notEqual(updated, original, `${locale} fixture should replace both product statuses`);
  fs.writeFileSync(file, updated);
}

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
test('public site audit requires structured localized statuses even when old text remains in comments', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = copySiteFixture('veilread-status-', t);
  replaceProductStatuses(fixture, 'zh-CN', '<span class="status" data-browser="chrome" data-state="available">Chrome 现已上线</span><span class="status" data-browser="edge" data-state="available">Edge 现已上线</span><!-- <span class="status" data-browser="chrome" data-state="coming-soon">Chrome 即将上线</span><span class="status" data-browser="edge" data-state="coming-soon">Edge 即将上线</span> -->');
  replaceProductStatuses(fixture, 'en', '<span class="status" data-browser="chrome" data-state="available">Chrome · Available</span><span class="status" data-browser="edge" data-state="available">Edge · Available</span><!-- <span class="status" data-browser="chrome" data-state="coming-soon">Chrome · Coming soon</span><span class="status" data-browser="edge" data-state="coming-soon">Edge · Coming soon</span> -->');

  const output = auditPublicSite(fixture).join('\n');
  for (const [locale, browser] of [['zh-CN', 'Chrome'], ['zh-CN', 'Edge'], ['en', 'Chrome'], ['en', 'Edge']]) {
    assert.match(output, new RegExp(`site/${locale}/index\\.html: .*${browser}`));
  }
});
test('public site audit accepts localized coming-soon statuses with nested markup', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = copySiteFixture('veilread-nested-status-', t);
  replaceProductStatuses(fixture, 'zh-CN', '<span class="badge status featured" data-browser="chrome" data-state="coming-soon"><strong>Chrome</strong> <em>即将上线</em></span><span class="badge status featured" data-browser="edge" data-state="coming-soon"><strong>Edge</strong> <em>即将上线</em></span>');
  replaceProductStatuses(fixture, 'en', '<span class="badge status featured" data-browser="chrome" data-state="coming-soon"><strong>Chrome</strong> · <em>Coming soon</em></span><span class="badge status featured" data-browser="edge" data-state="coming-soon"><strong>Edge</strong> · <em>Coming soon</em></span>');

  assert.deepEqual(auditPublicSite(fixture), []);
});
test('public site audit ignores structured statuses in comments, scripts, styles, hidden, and aria-hidden subtrees', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = copySiteFixture('veilread-hidden-status-', t);
  replaceProductStatuses(fixture, 'zh-CN', '<span class="status" data-browser="chrome" data-state="coming-soon">Chrome 即将上线</span><span class="status" data-browser="edge" data-state="coming-soon">Edge 即将上线</span><!-- <span class="status" data-browser="chrome" data-state="coming-soon">Chrome 即将上线</span> --><script><span class="status" data-browser="edge" data-state="coming-soon">Edge 即将上线</span></script><style><span class="status" data-browser="chrome" data-state="coming-soon">Chrome 即将上线</span></style>');
  replaceProductStatuses(fixture, 'en', '<span class="status" data-browser="chrome" data-state="coming-soon">Chrome · Coming soon</span><span class="status" data-browser="edge" data-state="coming-soon">Edge · Coming soon</span><div hidden><span class="status" data-browser="chrome" data-state="coming-soon">Chrome · Coming soon</span></div><div aria-hidden="true"><span class="status" data-browser="edge" data-state="coming-soon">Edge · Coming soon</span></div><div style="display: none"><span class="status" data-browser="chrome" data-state="coming-soon">Chrome · Coming soon</span></div><div style="visibility: hidden"><span class="status" data-browser="edge" data-state="coming-soon">Edge · Coming soon</span></div>');

  assert.deepEqual(auditPublicSite(fixture), []);
});
test('public site audit respects greater-than signs inside quoted hidden attributes', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = copySiteFixture('veilread-quoted-status-', t);
  for (const [locale, chromeText, edgeText] of [
    ['zh-CN', 'Chrome 即将上线', 'Edge 即将上线'],
    ['en', 'Chrome · Coming soon', 'Edge · Coming soon'],
  ]) {
    replaceProductStatuses(fixture, locale, `<div title="gate > rollout" hidden="phase > launch"><span class="status" data-browser="chrome" data-state="coming-soon">${chromeText}</span><span class="status" data-browser="edge" data-state="coming-soon">${edgeText}</span></div>`);
  }

  const output = auditPublicSite(fixture).join('\n');
  for (const [locale, browser] of [['zh-CN', 'Chrome'], ['zh-CN', 'Edge'], ['en', 'Chrome'], ['en', 'Edge']]) {
    assert.match(output, new RegExp(`site/${locale}/index\\.html: .*${browser}`));
  }
});
test('public site audit ignores statuses that exist only in templates', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = copySiteFixture('veilread-template-status-', t);
  replaceProductStatuses(fixture, 'zh-CN', '<template><span class="status" data-browser="chrome" data-state="coming-soon">Chrome 即将上线</span><span class="status" data-browser="edge" data-state="coming-soon">Edge 即将上线</span></template>');
  replaceProductStatuses(fixture, 'en', '<template><span class="status" data-browser="chrome" data-state="coming-soon">Chrome · Coming soon</span><span class="status" data-browser="edge" data-state="coming-soon">Edge · Coming soon</span></template>');

  const output = auditPublicSite(fixture).join('\n');
  for (const [locale, browser] of [['zh-CN', 'Chrome'], ['zh-CN', 'Edge'], ['en', 'Chrome'], ['en', 'Edge']]) {
    assert.match(output, new RegExp(`site/${locale}/index\\.html: .*${browser}`));
  }
});
test('public site audit does not let one mixed status satisfy both browsers', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = copySiteFixture('veilread-mixed-status-', t);
  replaceProductStatuses(fixture, 'zh-CN', '<span class="status" data-browser="chrome" data-state="available">Chrome 现已上线；Edge 即将上线</span>');
  replaceProductStatuses(fixture, 'en', '<span class="status" data-browser="chrome" data-state="available">Chrome Available; Edge Coming soon</span>');

  const output = auditPublicSite(fixture).join('\n');
  for (const [locale, browser] of [['zh-CN', 'Chrome'], ['zh-CN', 'Edge'], ['en', 'Chrome'], ['en', 'Edge']]) {
    assert.match(output, new RegExp(`site/${locale}/index\\.html: .*${browser}`));
  }
});
test('public site audit rejects duplicate browser statuses with mixed states', (t) => {
  const { auditPublicSite } = require('../../tools/release/audit.js');
  const fixture = copySiteFixture('veilread-duplicate-status-', t);
  replaceProductStatuses(fixture, 'en', '<span class="status" data-browser="chrome" data-state="coming-soon">Chrome · Coming soon</span><span class="status" data-browser="chrome" data-state="available">Chrome · Available</span><span class="status" data-browser="edge" data-state="coming-soon">Edge · Coming soon</span>');

  assert.match(auditPublicSite(fixture).join('\n'), /site\/en\/index\.html: .*duplicate Chrome/i);
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
  assert.doesNotMatch(pages, /\benablement:\s*true\b/i);
  assert.doesNotMatch(pages, /\btoken:\s*\$\{\{\s*secrets\./i);
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
test('localized product homes publish one structured coming-soon status per browser', () => {
  for (const locale of ['zh-CN', 'en']) {
    const html = fs.readFileSync(path.join(root, 'site', locale, 'index.html'), 'utf8');
    for (const browser of ['chrome', 'edge']) {
      assert.ok(html.includes(`class="status" data-browser="${browser}" data-state="coming-soon"`), `${locale} should publish ${browser} coming-soon data attributes`);
    }
  }
});
