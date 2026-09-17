const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { readPngSize } = require('../../tools/release/audit.js');

const root = path.resolve(__dirname, '../..');

test('store asset manifest contains every required bilingual image at the required size', () => {
  const { ASSETS } = require('../../tools/release/render-assets.js');
  const names = [
    'chrome-icon-128.png', 'edge-logo-300.png',
    'promo-small-zh-CN.png', 'promo-small-en.png',
    'promo-large-zh-CN.png', 'promo-large-en.png',
    ...['zh-CN', 'en'].flatMap((locale) => [
      `screenshot-01-float-${locale}.png`,
      `screenshot-02-edge-${locale}.png`,
      `screenshot-03-sidebar-${locale}.png`,
      `screenshot-04-settings-${locale}.png`,
      `screenshot-05-library-${locale}.png`,
    ]),
  ];
  assert.deepEqual(ASSETS.map((asset) => asset.name).sort(), names.sort());
  for (const asset of ASSETS) {
    const file = path.join(root, 'store/assets/generated', asset.name);
    assert.ok(fs.existsSync(file), `${asset.name} should exist`);
    assert.deepEqual(readPngSize(fs.readFileSync(file)), { width: asset.width, height: asset.height });
  }
});
test('asset child process can fetch from the renderer HTTP server', async () => {
  const { runProcess } = require('../../tools/release/render-assets.js');
  const server = http.createServer((_request, response) => response.end('ready'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const result = await runProcess(process.execPath, ['-e', `fetch(${JSON.stringify(url)}).then(r=>r.text()).then(console.log)`], { timeout: 5000 });
    assert.equal(result.stdout.trim(), 'ready');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('asset CSS constrains the native side panel and compact promo copy', () => {
  const screenshots = fs.readFileSync(path.join(root, 'test/store-assets.css'), 'utf8');
  const promo = fs.readFileSync(path.join(root, 'store/assets/source/promo.css'), 'utf8');
  assert.match(screenshots, /\.sidebar-zone \.vr\s*\{[^}]*position:\s*absolute\s*!important/i);
  assert.match(promo, /body\[data-kind="small"\] \.copy\s*\{[^}]*max-width:\s*62%/i);
});
test('release audit reports missing store artwork by exact path', () => {
  const { auditStoreAssets } = require('../../tools/release/audit.js');
  assert.deepEqual(auditStoreAssets(root), []);
  const emptyRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'veilread-empty-assets-'));
  try {
    assert.match(auditStoreAssets(emptyRoot).join('\n'), /store\/assets\/generated\/chrome-icon-128\.png: missing/);
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});
