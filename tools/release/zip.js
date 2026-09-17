'use strict';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function normalizeName(name) {
  const normalized = String(name).replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || parts.some((part) => !part || part === '..' || part === '.')) {
    throw new Error(`unsafe ZIP path: ${name}`);
  }
  return normalized;
}

function createZip(entries) {
  const sorted = entries.map((entry) => ({ name: normalizeName(entry.name), data: Buffer.from(entry.data) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function listZipEntries(buffer) {
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error('ZIP end record not found');
  const count = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const names = [];
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid ZIP central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const checksum = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const centralName = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = centralName.toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`invalid ZIP local header for ${name}`);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localChecksum = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (localMethod !== method) throw new Error(`ZIP method mismatch for ${name}`);
    if (localChecksum !== checksum) throw new Error(`ZIP CRC mismatch for ${name}`);
    if (localCompressedSize !== compressedSize) throw new Error(`ZIP compressed size mismatch for ${name}`);
    if (localUncompressedSize !== uncompressedSize) throw new Error(`ZIP uncompressed size mismatch for ${name}`);
    if (!localName.equals(centralName)) throw new Error(`ZIP filename mismatch for ${name}`);
    if (method !== 0) throw new Error(`unsupported ZIP compression for ${name}`);
    if (compressedSize !== uncompressedSize) throw new Error(`ZIP STORE size mismatch for ${name}`);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length || crc32(buffer.subarray(dataStart, dataEnd)) !== checksum) throw new Error(`CRC mismatch for ${name}`);
    names.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

module.exports = { crc32, createZip, listZipEntries };
