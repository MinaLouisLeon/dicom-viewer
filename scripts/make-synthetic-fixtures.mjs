#!/usr/bin/env node
/**
 * Generates synthetic DICOM fixtures. They contain computed test patterns only and
 * no data from any person. Re-running produces byte-identical files.
 *
 *   node scripts/make-synthetic-fixtures.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'fixtures', 'synthetic');
const require = createRequire(path.join(root, 'packages', 'dicom-viewer', 'package.json'));
const loaderRequire = createRequire(require.resolve('@cornerstonejs/dicom-image-loader'));

const TS = {
  explicitLE: '1.2.840.10008.1.2.1',
  jpeg2000Lossless: '1.2.840.10008.1.2.4.90',
  jpegLsLossless: '1.2.840.10008.1.2.4.80',
};
const SOP = {
  intraoral: '1.2.840.10008.5.1.4.1.1.1.3',
  ct: '1.2.840.10008.5.1.4.1.1.2',
  enhancedCt: '1.2.840.10008.5.1.4.1.1.2.1',
};

/** Deterministic UID under the 2.25 (UUID-derived) root. */
function uid(seed) {
  const hex = createHash('sha256').update(`mivo-labs-synthetic:${seed}`).digest('hex').slice(0, 32);
  return `2.25.${BigInt(`0x${hex}`).toString(10)}`;
}

// ── Minimal explicit VR little endian writer ──────────────────────────────────
const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);

function pad(buffer, vr) {
  if (buffer.length % 2 === 0) return buffer;
  const padByte = vr === 'UI' || vr === 'OB' ? 0x00 : 0x20;
  return Buffer.concat([buffer, Buffer.from([padByte])]);
}

function valueBytes(vr, value) {
  if (Buffer.isBuffer(value)) return value;
  if (vr === 'US') {
    const values = [].concat(value);
    const buffer = Buffer.alloc(values.length * 2);
    values.forEach((v, i) => buffer.writeUInt16LE(v, i * 2));
    return buffer;
  }
  if (vr === 'UL') {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value, 0);
    return buffer;
  }
  return Buffer.from([].concat(value).join('\\'), 'latin1');
}

function element(tag, vr, value, { undefinedLength = false } = {}) {
  const [group, elem] = tag;
  const data = undefinedLength ? value : pad(valueBytes(vr, value), vr);
  const long = LONG_VRS.has(vr);
  const header = Buffer.alloc(long ? 12 : 8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(elem, 2);
  header.write(vr, 4, 'latin1');
  if (long) header.writeUInt32LE(undefinedLength ? 0xffffffff : data.length, 8);
  else header.writeUInt16LE(data.length, 6);
  return Buffer.concat([header, data]);
}

function item(data) {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0xfffe, 0);
  header.writeUInt16LE(0xe000, 2);
  const padded = pad(data, 'OB');
  header.writeUInt32LE(padded.length, 4);
  return Buffer.concat([header, padded]);
}

/** Sequence of defined length whose items are lists of elements. */
function sequence(tag, items) {
  return element(tag, 'SQ', Buffer.concat(items.map((elements) => item(Buffer.concat(elements)))));
}

function sequenceDelimiter() {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt16LE(0xfffe, 0);
  buffer.writeUInt16LE(0xe0dd, 2);
  return buffer;
}

function part10({ sopClassUid, sopInstanceUid, transferSyntaxUid, dataset }) {
  const metaBody = Buffer.concat([
    element([0x0002, 0x0001], 'OB', Buffer.from([0x00, 0x01])),
    element([0x0002, 0x0002], 'UI', sopClassUid),
    element([0x0002, 0x0003], 'UI', sopInstanceUid),
    element([0x0002, 0x0010], 'UI', transferSyntaxUid),
    element([0x0002, 0x0012], 'UI', uid('implementation')),
    element([0x0002, 0x0013], 'SH', 'MIVO_SYNTH_1'),
  ]);
  const meta = Buffer.concat([element([0x0002, 0x0000], 'UL', metaBody.length), metaBody]);
  const preamble = Buffer.alloc(128);
  return Buffer.concat([preamble, Buffer.from('DICM', 'latin1'), meta, ...dataset]);
}

// ── Test patterns ────────────────────────────────────────────────────────────

/** 12-bit unsigned pattern: gradient, grid, a bright disc and an orientation marker. */
function intraoralPattern(width, height) {
  const pixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = Math.round((x / (width - 1)) * 2400 + (y / (height - 1)) * 800);
      if (x % 64 === 0 || y % 64 === 0) value = 3600;
      const dx = x - width * 0.62;
      const dy = y - height * 0.5;
      if (dx * dx + dy * dy < (height * 0.18) ** 2) value = 4000;
      // "L" marker in the top-left corner shows orientation.
      if ((x > 16 && x < 26 && y > 16 && y < 80) || (y > 70 && y < 80 && x > 16 && x < 60)) value = 4095;
      pixels[y * width + x] = value;
    }
  }
  return pixels;
}

/** Signed 16-bit CT-like slice: a sphere whose radius depends on the slice position. */
function ctSlice(size, z, depth) {
  const pixels = new Int16Array(size * size);
  const center = size / 2;
  const sphereRadius = size * 0.35;
  const dz = (z - (depth - 1) / 2) * (size / depth);
  const r2 = sphereRadius ** 2 - dz ** 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d2 = (x - center) ** 2 + (y - center) ** 2;
      let hu = -1000;
      if (d2 < (size * 0.45) ** 2) hu = 0;
      if (r2 > 0 && d2 < r2) hu = 1200;
      if (x < 12 && y < 12 + z * 2) hu = 2000; // slice-index bar
      pixels[y * size + x] = hu + 1024;
    }
  }
  return pixels;
}

/**
 * Synthetic CBCT phantom in patient coordinates (LPS: +x left, +y posterior, +z superior).
 * Voxel (i, j, k) sits at x = i·s, y = j·s, z = k·s relative to the volume origin.
 * Content is asymmetric on every axis so orientation errors are visible:
 *   - a soft-tissue cylinder along z;
 *   - a horseshoe "dental arch" of bone in the middle third of slices, open posteriorly;
 *   - a bone cube at the patient's right-anterior-superior corner;
 *   - a bone sphere at the left-posterior-inferior corner.
 */
function cbctVoxel(i, j, k, size, depth) {
  const c = (size - 1) / 2;
  const dx = i - c;
  const dy = j - c;
  let hu = -1000;
  if (dx * dx + dy * dy < (size * 0.46) ** 2) hu = 40;
  const r = Math.hypot(dx, dy);
  const inArchSlices = k >= depth / 3 && k < (2 * depth) / 3;
  const archRadius = size * 0.3;
  if (inArchSlices && Math.abs(r - archRadius) < size * 0.05 && dy <= 0) hu = 1500; // anterior curve
  if (inArchSlices && dy > 0 && dy < size * 0.25 && Math.abs(Math.abs(dx) - archRadius) < size * 0.05) hu = 1500; // arms
  // Right-anterior-superior cube (right = low i, anterior = low j, superior = high k).
  if (i >= size * 0.18 && i < size * 0.3 && j >= size * 0.18 && j < size * 0.3 && k >= depth * 0.78 && k < depth * 0.9) {
    hu = 2000;
  }
  // Left-posterior-inferior sphere.
  const sx = i - size * 0.74;
  const sy = j - size * 0.74;
  const sz = (k - depth * 0.16) * (size / depth);
  if (sx * sx + sy * sy + sz * sz < (size * 0.07) ** 2) hu = 2000;
  return hu;
}

function cbctSlice(size, depth, k) {
  const pixels = new Int16Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) pixels[j * size + i] = cbctVoxel(i, j, k, size, depth) + 1024;
  }
  return pixels;
}

const CBCT = { size: 96, depth: 64, spacing: 0.4 };

function cbctPosition(k, spacing = CBCT.spacing, size = CBCT.size) {
  const origin = -((size - 1) / 2) * spacing;
  return [origin.toFixed(3), origin.toFixed(3), (k * spacing - 12).toFixed(3)];
}

function cbctCommon({ seriesUid, seriesNumber, description }) {
  return [
    element([0x0008, 0x0020], 'DA', '20260103'),
    element([0x0008, 0x0060], 'CS', 'CT'),
    element([0x0008, 0x1030], 'LO', 'Synthetic CBCT phantom'),
    element([0x0008, 0x103e], 'LO', description),
    ...commonPatient(),
    element([0x0020, 0x000d], 'UI', uid('study-cbct')),
    element([0x0020, 0x000e], 'UI', seriesUid),
    element([0x0020, 0x0011], 'IS', String(seriesNumber)),
  ];
}

/** One classic CT slice of the CBCT phantom. */
function cbctFileSlice(k, { seriesKey, seriesNumber, description, size = CBCT.size, depth = CBCT.depth }) {
  const sopInstanceUid = uid(`${seriesKey}-instance-${k}`);
  const pixels = cbctSlice(size, depth, k);
  return part10({
    sopClassUid: SOP.ct,
    sopInstanceUid,
    transferSyntaxUid: TS.explicitLE,
    dataset: [
      element([0x0008, 0x0016], 'UI', SOP.ct),
      element([0x0008, 0x0018], 'UI', sopInstanceUid),
      ...cbctCommon({ seriesUid: uid(seriesKey), seriesNumber, description }),
      element([0x0018, 0x0050], 'DS', String(CBCT.spacing)),
      element([0x0020, 0x0013], 'IS', String(k + 1)),
      element([0x0020, 0x0032], 'DS', cbctPosition(k, CBCT.spacing, size)),
      element([0x0020, 0x0037], 'DS', ['1', '0', '0', '0', '1', '0']),
      element([0x0020, 0x0052], 'UI', uid('frame-of-reference-cbct')),
      element([0x0028, 0x0002], 'US', 1),
      element([0x0028, 0x0004], 'CS', 'MONOCHROME2'),
      element([0x0028, 0x0010], 'US', size),
      element([0x0028, 0x0011], 'US', size),
      element([0x0028, 0x0030], 'DS', [String(CBCT.spacing), String(CBCT.spacing)]),
      element([0x0028, 0x0100], 'US', 16),
      element([0x0028, 0x0101], 'US', 16),
      element([0x0028, 0x0102], 'US', 15),
      element([0x0028, 0x0103], 'US', 0),
      element([0x0028, 0x1050], 'DS', '400'),
      element([0x0028, 0x1051], 'DS', '2000'),
      element([0x0028, 0x1052], 'DS', '-1024'),
      element([0x0028, 0x1053], 'DS', '1'),
      element([0x7fe0, 0x0010], 'OW', Buffer.from(pixels.buffer)),
    ],
  });
}

/**
 * The same phantom as one Enhanced CT multi-frame file. Frames are stored superior to
 * inferior (the reverse of the classic series) so slice ordering from per-frame
 * positions is exercised.
 */
function cbctEnhanced() {
  const { size, depth, spacing } = CBCT;
  const seriesUid = uid('series-cbct-enhanced');
  const sopInstanceUid = uid('instance-cbct-enhanced');
  const order = Array.from({ length: depth }, (_, index) => depth - 1 - index);
  const pixels = Buffer.concat(order.map((k) => Buffer.from(cbctSlice(size, depth, k).buffer)));
  return part10({
    sopClassUid: SOP.enhancedCt,
    sopInstanceUid,
    transferSyntaxUid: TS.explicitLE,
    dataset: [
      element([0x0008, 0x0008], 'CS', ['ORIGINAL', 'PRIMARY', 'VOLUME', 'NONE']),
      element([0x0008, 0x0016], 'UI', SOP.enhancedCt),
      element([0x0008, 0x0018], 'UI', sopInstanceUid),
      ...cbctCommon({ seriesUid, seriesNumber: 2, description: 'Enhanced multi-frame (reversed frames)' }),
      element([0x0020, 0x0013], 'IS', '1'),
      element([0x0020, 0x0052], 'UI', uid('frame-of-reference-cbct')),
      element([0x0028, 0x0002], 'US', 1),
      element([0x0028, 0x0004], 'CS', 'MONOCHROME2'),
      element([0x0028, 0x0008], 'IS', String(depth)),
      element([0x0028, 0x0010], 'US', size),
      element([0x0028, 0x0011], 'US', size),
      element([0x0028, 0x0100], 'US', 16),
      element([0x0028, 0x0101], 'US', 16),
      element([0x0028, 0x0102], 'US', 15),
      element([0x0028, 0x0103], 'US', 0),
      sequence(
        [0x5200, 0x9229],
        [
          [
            sequence([0x0020, 0x9116], [[element([0x0020, 0x0037], 'DS', ['1', '0', '0', '0', '1', '0'])]]),
            sequence(
              [0x0028, 0x9110],
              [
                [
                  element([0x0018, 0x0050], 'DS', String(spacing)),
                  element([0x0028, 0x0030], 'DS', [String(spacing), String(spacing)]),
                ],
              ],
            ),
            sequence(
              [0x0028, 0x9132],
              [[element([0x0028, 0x1050], 'DS', '400'), element([0x0028, 0x1051], 'DS', '2000')]],
            ),
            sequence(
              [0x0028, 0x9145],
              [
                [
                  element([0x0028, 0x1052], 'DS', '-1024'),
                  element([0x0028, 0x1053], 'DS', '1'),
                  element([0x0028, 0x1054], 'LO', 'HU'),
                ],
              ],
            ),
          ],
        ],
      ),
      sequence(
        [0x5200, 0x9230],
        order.map((k) => [sequence([0x0020, 0x9113], [[element([0x0020, 0x0032], 'DS', cbctPosition(k))]])]),
      ),
      element([0x7fe0, 0x0010], 'OW', pixels),
    ],
  });
}

// ── Codecs (from the same packages the viewer decodes with) ──────────────────

async function encodeJ2K(pixels, width, height) {
  const factory = loaderRequire('@cornerstonejs/codec-openjpeg/wasmjs');
  const codec = await factory();
  const encoder = new codec.J2KEncoder();
  const decoded = encoder.getDecodedBuffer({
    width,
    height,
    bitsPerSample: 16,
    componentCount: 1,
    isSigned: false,
    isUsingColorTransform: false,
  });
  decoded.set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
  encoder.encode();
  const encoded = Buffer.from(encoder.getEncodedBuffer());
  encoder.delete();
  return encoded;
}

async function encodeJpegLs(pixels, width, height) {
  const factory = loaderRequire('@cornerstonejs/codec-charls/wasmjs');
  const codec = await factory();
  const encoder = new codec.JpegLSEncoder();
  const decoded = encoder.getDecodedBuffer({ width, height, bitsPerSample: 16, componentCount: 1 });
  decoded.set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
  encoder.setNearLossless(0);
  encoder.encode();
  const encoded = Buffer.from(encoder.getEncodedBuffer());
  encoder.delete();
  return encoded;
}

// ── Builders ─────────────────────────────────────────────────────────────────

function commonPatient() {
  return [
    element([0x0010, 0x0010], 'PN', 'SYNTHETIC^PHANTOM'),
    element([0x0010, 0x0020], 'LO', 'SYNTH-0001'),
  ];
}

async function intraoral({ name, transferSyntaxUid, seriesNumber, description, pattern = intraoralPattern }) {
  const width = 640;
  const height = 480;
  const pixels = pattern(width, height);
  const studyUid = uid('study-intraoral');
  const seriesUid = uid(`series-${name}`);
  const sopInstanceUid = uid(`instance-${name}`);

  let pixelElement;
  if (transferSyntaxUid === TS.explicitLE) {
    pixelElement = element([0x7fe0, 0x0010], 'OW', Buffer.from(pixels.buffer));
  } else {
    const frame =
      transferSyntaxUid === TS.jpeg2000Lossless
        ? await encodeJ2K(pixels, width, height)
        : await encodeJpegLs(pixels, width, height);
    pixelElement = element(
      [0x7fe0, 0x0010],
      'OB',
      Buffer.concat([item(Buffer.alloc(0)), item(frame), sequenceDelimiter()]),
      { undefinedLength: true },
    );
  }

  return part10({
    sopClassUid: SOP.intraoral,
    sopInstanceUid,
    transferSyntaxUid,
    dataset: [
      element([0x0008, 0x0016], 'UI', SOP.intraoral),
      element([0x0008, 0x0018], 'UI', sopInstanceUid),
      element([0x0008, 0x0020], 'DA', '20260101'),
      element([0x0008, 0x0060], 'CS', 'IO'),
      element([0x0008, 0x1030], 'LO', 'Synthetic intraoral study'),
      element([0x0008, 0x103e], 'LO', description),
      ...commonPatient(),
      element([0x0020, 0x000d], 'UI', studyUid),
      element([0x0020, 0x000e], 'UI', seriesUid),
      element([0x0020, 0x0011], 'IS', String(seriesNumber)),
      element([0x0020, 0x0013], 'IS', '1'),
      element([0x0028, 0x0002], 'US', 1),
      element([0x0028, 0x0004], 'CS', 'MONOCHROME2'),
      element([0x0028, 0x0010], 'US', height),
      element([0x0028, 0x0011], 'US', width),
      element([0x0028, 0x0030], 'DS', ['0.1', '0.1']),
      element([0x0028, 0x0100], 'US', 16),
      element([0x0028, 0x0101], 'US', 12),
      element([0x0028, 0x0102], 'US', 11),
      element([0x0028, 0x0103], 'US', 0),
      element([0x0028, 0x1050], 'DS', '2048'),
      element([0x0028, 0x1051], 'DS', '4096'),
      pixelElement,
    ],
  });
}

function demoDental(width, height) {
  const pixels = new Uint16Array(width * height);
  const teeth = [0.11, 0.27, 0.43, 0.59, 0.75, 0.91];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const texture = 36 * Math.sin(x * 0.36 + y * 0.24) + 24 * Math.cos(x * 0.91 - y * 0.65);
      let value = 450 + texture + Math.max(0, 1 - Math.abs(v - 0.56) * 3.5) * 510;
      for (const center of teeth) {
        const crownY = 0.69 + 0.12 * (center - 0.5) ** 2;
        const dx = u - center + (v - crownY) * (center - 0.5) * 0.27;
        const crown = (dx / 0.075) ** 4 + ((v - crownY) / 0.105) ** 4;
        const rootY = (v - crownY + 0.16) / 0.16;
        const root = ((Math.abs(dx) - 0.023) / 0.019) ** 2 + rootY ** 2;
        if (crown < 1) value = 2350 + 1050 * crown + texture;
        if (root < 1) value = Math.max(value, 1650 + 570 * root + texture);
        if (root < 0.09) value -= 520;
      }
      pixels[y * width + x] = Math.round(value);
    }
  }
  return pixels;
}

function demoHead(size, index, depth) {
  const pixels = new Uint16Array(size * size);
  const z = (index - depth / 2) / (depth / 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x - size / 2) / (size / 2);
      const v = (y - size / 2) / (size / 2);
      const skull = (u / 0.75) ** 2 + (v / 0.87) ** 2 + (z / 1.35) ** 2;
      const orbit = ((Math.abs(u) - 0.29) / 0.18) ** 2
        + ((v + 0.58) / 0.15) ** 2 + ((z + 0.38) / 0.3) ** 2;
      const ventricle = ((Math.abs(u) - 0.1) / 0.08) ** 2
        + (v / 0.28) ** 2 + ((z - 0.17) / 0.52) ** 2;
      let hu = -1000;
      if (skull < 1.12) hu = -80;
      if (skull < 1) hu = 1050 + 160 * Math.cos(x * 0.25 + y * 0.12);
      if (skull < 0.86) hu = 40 + 10 * Math.sin(x * 0.33 + y * 0.26 + index * 0.17);
      if (orbit < 1 && skull < 1.12) hu = orbit > 0.8 ? 450 : -40;
      if (ventricle < 1) hu = 8;
      pixels[y * size + x] = Math.round(hu + 1024);
    }
  }
  return pixels;
}

function ctStackSlice(
  index,
  depth,
  size,
  { seriesKey = 'series-ct-stack', instanceKey = 'instance-ct', seriesNumber = 1,
    description = 'Sphere phantom axial', pattern = ctSlice, frameUid, window = [400, 2000] } = {},
) {
  const studyUid = uid('study-ct');
  const seriesUid = uid(seriesKey);
  const sopInstanceUid = uid(`${instanceKey}-${index}`);
  const pixels = pattern(size, index, depth);
  const zPosition = (index * 2.5).toFixed(2);
  return part10({
    sopClassUid: SOP.ct,
    sopInstanceUid,
    transferSyntaxUid: TS.explicitLE,
    dataset: [
      element([0x0008, 0x0016], 'UI', SOP.ct),
      element([0x0008, 0x0018], 'UI', sopInstanceUid),
      element([0x0008, 0x0020], 'DA', '20260102'),
      element([0x0008, 0x0060], 'CS', 'CT'),
      element([0x0008, 0x1030], 'LO', 'Synthetic CT phantom'),
      element([0x0008, 0x103e], 'LO', description),
      ...commonPatient(),
      element([0x0020, 0x000d], 'UI', studyUid),
      element([0x0020, 0x000e], 'UI', seriesUid),
      element([0x0020, 0x0011], 'IS', String(seriesNumber)),
      element([0x0020, 0x0013], 'IS', String(index + 1)),
      element([0x0020, 0x0032], 'DS', ['-64', '-64', zPosition]),
      element([0x0020, 0x0037], 'DS', ['1', '0', '0', '0', '1', '0']),
      ...(frameUid ? [element([0x0020, 0x0052], 'UI', frameUid)] : []),
      element([0x0028, 0x0002], 'US', 1),
      element([0x0028, 0x0004], 'CS', 'MONOCHROME2'),
      element([0x0028, 0x0010], 'US', size),
      element([0x0028, 0x0011], 'US', size),
      element([0x0028, 0x0030], 'DS', ['0.5', '0.5']),
      element([0x0028, 0x0100], 'US', 16),
      element([0x0028, 0x0101], 'US', 16),
      element([0x0028, 0x0102], 'US', 15),
      element([0x0028, 0x0103], 'US', 0),
      element([0x0028, 0x1050], 'DS', String(window[0])),
      element([0x0028, 0x1051], 'DS', String(window[1])),
      element([0x0028, 0x1052], 'DS', '-1024'),
      element([0x0028, 0x1053], 'DS', '1'),
      element([0x7fe0, 0x0010], 'OW', Buffer.from(pixels.buffer)),
    ],
  });
}

async function main() {
  if (process.argv.includes('--demo')) {
    const sampleDir = path.join(root, 'apps', 'demo', 'public', 'samples');
    mkdirSync(path.join(sampleDir, 'head'), { recursive: true });
    for (const [file, transferSyntaxUid] of [
      ['dental.dcm', TS.explicitLE],
      ['dental-jpeg2000.dcm', TS.jpeg2000Lossless],
    ]) {
      writeFileSync(path.join(sampleDir, file), await intraoral({
        name: file, transferSyntaxUid, seriesNumber: 1, description: 'Dental radiograph phantom',
        pattern: demoDental,
      }));
    }
    const depth = 48;
    for (let index = 0; index < depth; index += 1) {
      const filename = `ct-${String(index + 1).padStart(3, '0')}.dcm`;
      writeFileSync(path.join(sampleDir, 'head', filename), ctStackSlice(index, depth, 160, {
        seriesKey: 'demo-head', instanceKey: 'demo-head', description: 'Head CT phantom',
        pattern: demoHead, frameUid: uid('demo-head-frame'), window: [65, 220],
      }));
    }
    return;
  }
  rmSync(outDir, { recursive: true, force: true });
  const write = (relative, data) => {
    const target = path.join(outDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
    console.log(`  ${path.relative(root, target)}  ${data.length} bytes`);
  };

  console.log('Writing synthetic fixtures:');
  write(
    'single/intraoral-explicit-le.dcm',
    await intraoral({ name: 'le', transferSyntaxUid: TS.explicitLE, seriesNumber: 1, description: 'Uncompressed' }),
  );
  write(
    'codecs/intraoral-jpeg2000-lossless.dcm',
    await intraoral({ name: 'j2k', transferSyntaxUid: TS.jpeg2000Lossless, seriesNumber: 2, description: 'JPEG 2000 lossless' }),
  );
  write(
    'codecs/intraoral-jpegls-lossless.dcm',
    await intraoral({ name: 'jls', transferSyntaxUid: TS.jpegLsLossless, seriesNumber: 3, description: 'JPEG-LS lossless' }),
  );

  const depth = 12;
  for (let index = 0; index < depth; index += 1) {
    // File names run opposite to slice position so ordering by geometry is exercised.
    write(`stack/ct-${String(depth - index).padStart(3, '0')}.dcm`, ctStackSlice(index, depth, 128));
  }

  // A second CT series whose fourth slice has its pixel data cut short: a damaged image inside
  // an otherwise valid stack. The viewer must keep the series open and report that one image.
  const damagedDepth = 6;
  for (let index = 0; index < damagedDepth; index += 1) {
    const slice = ctStackSlice(index, damagedDepth, 128, {
      seriesKey: 'series-ct-damaged',
      instanceKey: 'instance-ct-damaged',
      seriesNumber: 2,
      description: 'Damaged slice 4 of 6',
    });
    write(`damaged-stack/ct-${String(index + 1).padStart(3, '0')}.dcm`, index === 3 ? slice.subarray(0, slice.length - 16_000) : slice);
  }

  // CBCT phantom as 64 single-frame files. File names run opposite to slice position.
  for (let k = 0; k < CBCT.depth; k += 1) {
    write(
      `cbct/cbct-${String(CBCT.depth - k).padStart(3, '0')}.dcm`,
      cbctFileSlice(k, { seriesKey: 'series-cbct', seriesNumber: 1, description: 'CBCT phantom 96x96x64' }),
    );
  }
  write('cbct-multiframe/cbct-enhanced.dcm', cbctEnhanced());

  // A 16-slice series with slice 9 left out: must be rejected as incomplete for 3D.
  const shortDepth = 16;
  for (let k = 0; k < shortDepth; k += 1) {
    if (k === 8) continue;
    write(
      `cbct-missing-slice/cbct-${String(k + 1).padStart(3, '0')}.dcm`,
      cbctFileSlice(k, {
        seriesKey: 'series-cbct-missing',
        seriesNumber: 3,
        description: 'Slice 9 of 16 missing',
        size: 64,
        depth: shortDepth,
      }),
    );
  }

  write('invalid/not-dicom.txt', Buffer.from('This is not a DICOM file.\n'));
  const good = await intraoral({ name: 'corrupt', transferSyntaxUid: TS.explicitLE, seriesNumber: 9, description: 'Truncated' });
  write('invalid/truncated-pixel-data.dcm', good.subarray(0, good.length - 200_000));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
