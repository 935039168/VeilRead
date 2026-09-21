const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
test('ZIP reader rejects payload corruption through CRC verification', () => {
  const { createZip, listZipEntries } = require('../../tools/release/zip.js');
  const zip = createZip([{ name: 'manifest.json', data: Buffer.from('payload-marker') }]);
  const corrupted = Buffer.from(zip);
  const dataOffset = corrupted.indexOf(Buffer.from('payload-marker'));
  assert.notEqual(dataOffset, -1);
  corrupted[dataOffset] ^= 0xff;
  assert.throws(() => listZipEntries(corrupted), /CRC mismatch for manifest\.json/);
});
test('ZIP reader rejects mismatched local and central metadata', () => {
  const { createZip, listZipEntries } = require('../../tools/release/zip.js');
  const original = createZip([{ name: 'manifest.json', data: Buffer.from('payload') }]);
  const centralOffset = original.readUInt32LE(original.length - 6);
  const mutations = [
    ['method', (zip) => zip.writeUInt16LE(8, 8)],
    ['CRC', (zip) => zip.writeUInt32LE((zip.readUInt32LE(14) + 1) >>> 0, 14)],
    ['compressed size', (zip) => zip.writeUInt32LE(zip.readUInt32LE(18) + 1, 18)],
    ['uncompressed size', (zip) => zip.writeUInt32LE(zip.readUInt32LE(22) + 1, 22)],
    ['filename', (zip) => { zip[30] ^= 1; }],
  ];
  for (const [label, mutate] of mutations) {
    const corrupted = Buffer.from(original);
    mutate(corrupted);
    assert.throws(() => listZipEntries(corrupted), new RegExp(`${label} mismatch`, 'i'), label);
    assert.equal(corrupted.readUInt32LE(centralOffset), 0x02014b50);
  }
});

function copyReleaseFixture(prefix, t) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(root, fixture, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source).replaceAll('\\', '/');
      return !relative.startsWith('.git') && !relative.startsWith('.claude') && !relative.startsWith('node_modules') && !relative.startsWith('dist');
    },
  });
  return fixture;
}

function fixtureReleaseOutput(fixture) {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'));
  return path.join(fixture, 'dist', `VeilRead-v${manifest.version}.zip`);
}

test('package staging preserves an existing release when staged bytes fail verification', (t) => {
  const { buildPackage } = require('../../tools/release/package.js');
  const fixture = copyReleaseFixture('veilread-package-atomic-', t);
  const dist = path.join(fixture, 'dist');
  const output = fixtureReleaseOutput(fixture);
  const temporary = output + '.tmp';
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(output, 'previous-valid-release');

  const originalRead = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    const data = originalRead.call(this, file, ...args);
    if (path.resolve(String(file)) !== path.resolve(temporary) || !Buffer.isBuffer(data)) return data;
    const corrupted = Buffer.from(data);
    corrupted[0] ^= 0xff;
    return corrupted;
  };
  t.after(() => { fs.readFileSync = originalRead; });

  assert.throws(() => buildPackage(fixture), /staged ZIP differs from generated ZIP/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous-valid-release');
  assert.equal(fs.existsSync(temporary), false);
});

test('package staging preserves an existing release when atomic rename fails', (t) => {
  const { buildPackage } = require('../../tools/release/package.js');
  const fixture = copyReleaseFixture('veilread-package-rename-', t);
  const dist = path.join(fixture, 'dist');
  const output = fixtureReleaseOutput(fixture);
  const temporary = output + '.tmp';
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(output, 'previous-valid-release');

  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated atomic rename failure'); };
  t.after(() => { fs.renameSync = originalRename; });

  assert.throws(() => buildPackage(fixture), /simulated atomic rename failure/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous-valid-release');
  assert.equal(fs.existsSync(temporary), false);
});
