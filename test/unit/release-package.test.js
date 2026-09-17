const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('ZIP output is deterministic, sorted, and uses valid CRC32 values', () => {
  const { crc32, createZip, listZipEntries } = require('../../tools/release/zip.js');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const entries = [
    { name: 'nested/data.bin', data: Buffer.from([0, 1, 2, 3]) },
    { name: 'manifest.json', data: Buffer.from('{"manifest_version":3}') },
  ];
  const first = createZip(entries);
  const second = createZip(entries.slice().reverse());
  assert.equal(crypto.createHash('sha256').update(first).digest('hex'), crypto.createHash('sha256').update(second).digest('hex'));
  assert.deepEqual(listZipEntries(first), ['manifest.json', 'nested/data.bin']);
});

test('ZIP writer rejects absolute and parent-traversal paths', () => {
  const { createZip } = require('../../tools/release/zip.js');
  assert.throws(() => createZip([{ name: '/manifest.json', data: Buffer.alloc(0) }]), /unsafe ZIP path/);
  assert.throws(() => createZip([{ name: '../secret.txt', data: Buffer.alloc(0) }]), /unsafe ZIP path/);
  assert.throws(() => createZip([{ name: 'C:\\secret.txt', data: Buffer.alloc(0) }]), /unsafe ZIP path/);
});

test('runtime package entries contain extension files and exclude development files', () => {
  const { collectRuntimeEntries, verifyPackageEntries } = require('../../tools/release/package.js');
  const entries = collectRuntimeEntries(root);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.includes('manifest.json'));
  assert.ok(names.includes('_locales/en/messages.json'));
  assert.ok(names.includes('reader/reader-core.js'));
  assert.equal(names.some((name) => /^(?:docs|site|store|test|tools)\//.test(name)), false);
  assert.deepEqual(verifyPackageEntries(root, names), []);
});
