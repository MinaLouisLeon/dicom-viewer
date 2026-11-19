import { deflateRawSync } from 'node:zlib';

export interface ZipInput {
  path: string;
  data: Uint8Array | string;
  /** 0 stored, 8 deflate, anything else written as-is (unsupported). @default 8 */
  method?: number;
  encrypted?: boolean;
  /** Write sizes after the data (streamed archives) instead of in the local header. */
  dataDescriptor?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a ZIP archive in memory. With `zip64`, sizes and offsets use ZIP64 records. */
export function buildZip(inputs: readonly ZipInput[], options: { zip64?: boolean; comment?: string } = {}): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (part: Uint8Array) => {
    parts.push(part);
    offset += part.byteLength;
  };

  for (const input of inputs) {
    const raw = typeof input.data === 'string' ? encoder.encode(input.data) : input.data;
    const method = input.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = encoder.encode(input.path);
    const crc = crc32(raw);
    const flags = (input.encrypted ? 0x0001 : 0) | (input.dataDescriptor ? 0x0008 : 0) | 0x0800;
    const localOffset = offset;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, input.dataDescriptor ? 0 : crc, true);
    local.setUint32(18, input.dataDescriptor ? 0 : body.byteLength, true);
    local.setUint32(22, input.dataDescriptor ? 0 : raw.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    push(new Uint8Array(local.buffer));
    push(name);
    push(body);
    if (input.dataDescriptor) {
      const descriptor = new DataView(new ArrayBuffer(16));
      descriptor.setUint32(0, 0x08074b50, true);
      descriptor.setUint32(4, crc, true);
      descriptor.setUint32(8, body.byteLength, true);
      descriptor.setUint32(12, raw.byteLength, true);
      push(new Uint8Array(descriptor.buffer));
    }

    const extra = options.zip64 ? new DataView(new ArrayBuffer(28)) : undefined;
    if (extra) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(raw.byteLength), true);
      extra.setBigUint64(12, BigInt(body.byteLength), true);
      extra.setBigUint64(20, BigInt(localOffset), true);
    }
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 45, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, flags, true);
    header.setUint16(10, method, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, extra ? 0xffffffff : body.byteLength, true);
    header.setUint32(24, extra ? 0xffffffff : raw.byteLength, true);
    header.setUint16(28, name.byteLength, true);
    header.setUint16(30, extra ? extra.byteLength : 0, true);
    header.setUint32(42, extra ? 0xffffffff : localOffset, true);
    central.push(new Uint8Array(header.buffer), name);
    if (extra) central.push(new Uint8Array(extra.buffer));
  }

  const directoryOffset = offset;
  for (const part of central) push(part);
  const directorySize = offset - directoryOffset;

  if (options.zip64) {
    const zip64EndOffset = offset;
    const end64 = new DataView(new ArrayBuffer(56));
    end64.setUint32(0, 0x06064b50, true);
    end64.setBigUint64(4, 44n, true);
    end64.setUint16(12, 45, true);
    end64.setUint16(14, 45, true);
    end64.setBigUint64(24, BigInt(inputs.length), true);
    end64.setBigUint64(32, BigInt(inputs.length), true);
    end64.setBigUint64(40, BigInt(directorySize), true);
    end64.setBigUint64(48, BigInt(directoryOffset), true);
    push(new Uint8Array(end64.buffer));
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(zip64EndOffset), true);
    locator.setUint32(16, 1, true);
    push(new Uint8Array(locator.buffer));
  }

  const comment = encoder.encode(options.comment ?? '');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, options.zip64 ? 0xffff : inputs.length, true);
  end.setUint16(10, options.zip64 ? 0xffff : inputs.length, true);
  end.setUint32(12, options.zip64 ? 0xffffffff : directorySize, true);
  end.setUint32(16, options.zip64 ? 0xffffffff : directoryOffset, true);
  end.setUint16(20, comment.byteLength, true);
  push(new Uint8Array(end.buffer));
  push(comment);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export const zipFile = (bytes: Uint8Array, name = 'study.zip'): File => new File([bytes as BlobPart], name, { type: 'application/zip' });
