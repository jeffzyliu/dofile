// A minimal .zip writer: every entry stored (no compression), names in UTF-8, no ZIP64. Used by store.js for
// "Download all (.zip)", in the page, with no engine. The parts go straight into a Blob, so the files are not copied
// into one big buffer.

const TABLE = new Uint32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS time and date, local time (the format has no time zone); nothing before 1980
function dosTime(ms) {
  const d = new Date(ms), year = Math.max(d.getFullYear(), 1980);
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

// entries: [{ name, data, mtime }]; a folder's name ends in "/" and it has no data. Returns the parts of the file, in
// order, for `new Blob(parts)`.
export function zipParts(entries) {
  if (entries.length > 0xffff) throw new Error("too many files for a .zip (65,535 at most)");
  const parts = [], central = [], encoder = new TextEncoder();
  let offset = 0;
  for (const { name, data, mtime } of entries) {
    const dir = name.endsWith("/"), bytes = dir ? new Uint8Array(0) : data, nameBytes = encoder.encode(name);
    const [time, date] = dosTime(mtime ?? Date.now()), crc = crc32(bytes);
    if (bytes.length > 0xfffffffe || offset > 0xfffffffe) throw new Error("too big for a .zip (4 GB at most)");
    // what the local header and the central record share: version needed, flags (bit 11: UTF-8 names), method 0
    // (stored), time, date, CRC, both sizes, the name's length, no extra field
    const shared = new DataView(new ArrayBuffer(26));
    [[0, 20], [2, 0x0800], [4, 0], [6, time], [8, date]].forEach(([at, v]) => shared.setUint16(at, v, true));
    shared.setUint32(10, crc, true);
    shared.setUint32(14, bytes.length, true);
    shared.setUint32(18, bytes.length, true);
    shared.setUint16(22, nameBytes.length, true);
    const local = new DataView(new ArrayBuffer(4));
    local.setUint32(0, 0x04034b50, true);
    parts.push(local.buffer, shared.buffer, nameBytes, bytes);
    // central record: signature, version made by, the shared part, then comment length, disk, internal attributes,
    // external attributes (0x10: a folder) and the local header's offset
    const head = new DataView(new ArrayBuffer(6)), tail = new DataView(new ArrayBuffer(14));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    tail.setUint32(6, dir ? 0x10 : 0, true);
    tail.setUint32(10, offset, true);
    central.push(head.buffer, shared.buffer, tail.buffer, nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  }
  const centralSize = central.reduce((n, p) => n + p.byteLength, 0);
  if (offset + centralSize > 0xfffffffe) throw new Error("too big for a .zip (4 GB at most)");
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return [...parts, ...central, end.buffer];
}
