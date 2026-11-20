// 纯 JS 标准 ZIP 打包（store 模式，不压缩），零第三方依赖。
// 结构：本地文件头 0x04034b50 + 文件数据 → 中央目录 0x02014b50 → EOCD 0x06054b50。
// 文件名按 UTF-8 编码并置通用标志位 0x0800；时间戳固定为 1980-01-01 00:00（可复现，便于测试）。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01
const FLAG_UTF8 = 0x0800;
const VERSION_STORE = 20; // 2.0

/**
 * @param {{ name: string, bytes: Uint8Array }[]} files
 * @returns {Uint8Array}
 */
export function buildZip(files) {
  const encoder = new TextEncoder();
  const entries = (files || []).map((f) => {
    const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    return { nameBytes: encoder.encode(f.name), bytes, crc: crc32(bytes), localOffset: 0 };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.nameBytes.length + e.bytes.length;
    centralSize += 46 + e.nameBytes.length;
  }

  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let p = 0;
  let offset = 0;

  // 本地文件头 + 文件数据
  for (const e of entries) {
    dv.setUint32(p, 0x04034b50, true); p += 4;
    dv.setUint16(p, VERSION_STORE, true); p += 2;
    dv.setUint16(p, FLAG_UTF8, true); p += 2;
    dv.setUint16(p, 0, true); p += 2; // 0 = store（不压缩）
    dv.setUint16(p, DOS_TIME, true); p += 2;
    dv.setUint16(p, DOS_DATE, true); p += 2;
    dv.setUint32(p, e.crc, true); p += 4;
    dv.setUint32(p, e.bytes.length, true); p += 4;
    dv.setUint32(p, e.bytes.length, true); p += 4;
    dv.setUint16(p, e.nameBytes.length, true); p += 2;
    dv.setUint16(p, 0, true); p += 2; // extra 长度
    out.set(e.nameBytes, p); p += e.nameBytes.length;
    out.set(e.bytes, p); p += e.bytes.length;
    e.localOffset = offset;
    offset = p;
  }

  // 中央目录
  const cdStart = p;
  for (const e of entries) {
    dv.setUint32(p, 0x02014b50, true); p += 4;
    dv.setUint16(p, VERSION_STORE, true); p += 2; // 生成版本
    dv.setUint16(p, VERSION_STORE, true); p += 2; // 解压所需版本
    dv.setUint16(p, FLAG_UTF8, true); p += 2;
    dv.setUint16(p, 0, true); p += 2;
    dv.setUint16(p, DOS_TIME, true); p += 2;
    dv.setUint16(p, DOS_DATE, true); p += 2;
    dv.setUint32(p, e.crc, true); p += 4;
    dv.setUint32(p, e.bytes.length, true); p += 4;
    dv.setUint32(p, e.bytes.length, true); p += 4;
    dv.setUint16(p, e.nameBytes.length, true); p += 2;
    dv.setUint16(p, 0, true); p += 2; // extra
    dv.setUint16(p, 0, true); p += 2; // comment
    dv.setUint16(p, 0, true); p += 2; // 起始磁盘号
    dv.setUint16(p, 0, true); p += 2; // 内部属性
    dv.setUint32(p, 0, true); p += 4; // 外部属性
    dv.setUint32(p, e.localOffset, true); p += 4;
    out.set(e.nameBytes, p); p += e.nameBytes.length;
  }

  // EOCD
  const cdSize = p - cdStart;
  dv.setUint32(p, 0x06054b50, true); p += 4;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, entries.length, true); p += 2;
  dv.setUint16(p, entries.length, true); p += 2;
  dv.setUint32(p, cdSize, true); p += 4;
  dv.setUint32(p, cdStart, true); p += 4;
  dv.setUint16(p, 0, true); p += 2;

  return out;
}
