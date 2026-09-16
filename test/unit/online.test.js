const test = require('node:test');
const assert = require('node:assert/strict');

const online = require('../../lib/online.js');

test('online navigation only allows same-origin chapter URLs', () => {
  assert.equal(online.validateReadableUrl('https://novel.example/c2', 'https://novel.example/c1'), 'https://novel.example/c2');
  assert.throws(
    () => online.validateReadableUrl('https://tracker.example/c2', 'https://novel.example/c1'),
    /同一网站/
  );
  assert.throws(
    () => online.validateReadableUrl('javascript:alert(1)', 'https://novel.example/c1'),
    /无效/
  );
});

test('online response guard rejects oversized documents before parsing', () => {
  assert.doesNotThrow(() => online.assertResponseSize('524288', 1024 * 1024));
  assert.throws(() => online.assertResponseSize('2097152', 1024 * 1024), /内容过大/);
  assert.doesNotThrow(() => online.assertResponseSize(null, 1024 * 1024));
});

test('online book config normalizes links and chooses a new tab only across origins', () => {
  const config = online.normalizeWebBookConfig({
    title: '  ',
    chapterUrl: 'https://read.example.test/book/1/chapter/3',
    bookUrl: 'https://www.example.test/book/1/catalog',
  });

  assert.deepEqual(config, {
    title: 'www.example.test',
    chapterUrl: 'https://read.example.test/book/1/chapter/3',
    bookUrl: 'https://www.example.test/book/1/catalog',
  });
  assert.equal(online.shouldOpenOnlineInNewTab(config.chapterUrl, 'https://news.example.test/'), true);
  assert.equal(online.shouldOpenOnlineInNewTab(config.chapterUrl, 'https://read.example.test/home'), false);
  assert.throws(() => online.normalizeWebBookConfig({ chapterUrl: 'file:///novel.txt' }), /HTTP/);
});
