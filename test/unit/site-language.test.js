const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('site language routing maps Chinese variants and defaults other languages to English', () => {
  const { languageEntry } = require('../../site/language.js');
  assert.equal(languageEntry('zh-CN'), './zh-CN/');
  assert.equal(languageEntry('zh-TW'), './zh-CN/');
  assert.equal(languageEntry('en'), './en/');
  assert.equal(languageEntry('de'), './en/');
  for (const entry of ['./zh-CN/', './en/']) {
    assert.equal(fs.existsSync(path.join(root, 'site', entry, 'index.html')), true, entry);
  }
});

test('product gateway loads the audited language router', () => {
  const gateway = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  assert.match(gateway, /src=["']\.\/language\.js["']/);
  assert.match(gateway, /languageEntry\(navigator\.language\)/);
});
