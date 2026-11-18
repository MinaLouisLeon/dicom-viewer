import { parseDicom, type DataSet } from 'dicom-parser';

import { throwIfAborted } from './errors';

/**
 * The subset of DICOM header attributes the viewer needs to group and order files.
 * Patient identifiers are deliberately not read.
 */
export interface DicomInstanceHeader {
  transferSyntaxUid: string;
  sopClassUid: string;
  sopInstanceUid: string;
  studyInstanceUid: string;
  seriesInstanceUid: string;
  studyDescription?: string;
  studyDate?: string;
  seriesDescription?: string;
  modality?: string;
  seriesNumber?: number;
  instanceNumber?: number;
  rows?: number;
  columns?: number;
  numberOfFrames: number;
  imagePositionPatient?: [number, number, number];
  imageOrientationPatient?: [number, number, number, number, number, number];
  hasPixelData: boolean;
}

export type HeaderReadResult =
  | { kind: 'dicom'; header: DicomInstanceHeader }
  | { kind: 'not-dicom' }
  | { kind: 'unsupported'; reason: UnsupportedReason };

export type UnsupportedReason = 'no-pixel-data' | 'deflated-transfer-syntax' | 'missing-uids';

const PIXEL_DATA_TAG = 'x7fe00010';
const DEFLATED_TRANSFER_SYNTAX = '1.2.840.10008.1.2.1.99';
const INITIAL_READ_BYTES = 64 * 1024;
/** Headers above this size are treated as unreadable rather than reading huge files twice. */
const MAX_HEADER_BYTES = 64 * 1024 * 1024;

/** Reads the byte range of a Blob. Overridable for tests. */
export type ReadRange = (blob: Blob, start: number, end: number) => Promise<ArrayBuffer>;

const defaultReadRange: ReadRange = (blob, start, end) => blob.slice(start, end).arrayBuffer();

function hasPart10Preamble(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 132 &&
    bytes[128] === 0x44 && // D
    bytes[129] === 0x49 && // I
    bytes[130] === 0x43 && // C
    bytes[131] === 0x4d // M
  );
}

function str(dataSet: DataSet, tag: string): string | undefined {
  const value = dataSet.string(tag)?.trim();
  return value ? value : undefined;
}

function int(dataSet: DataSet, tag: string): number | undefined {
  const raw = str(dataSet, tag);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function uint16(dataSet: DataSet, tag: string): number | undefined {
  return dataSet.elements[tag] ? dataSet.uint16(tag) : undefined;
}

function decimals<N extends number>(dataSet: DataSet, tag: string, count: N): number[] | undefined {
  const raw = str(dataSet, tag);
  if (!raw) return undefined;
  const values = raw.split('\\').map((part) => Number.parseFloat(part));
  if (values.length !== count || values.some((value) => !Number.isFinite(value))) return undefined;
  return values;
}

/** True when every element the parser saw lies fully inside the bytes it was given. */
function elementsWithinBuffer(dataSet: DataSet, byteLength: number): boolean {
  for (const [tag, element] of Object.entries(dataSet.elements)) {
    if (tag === PIXEL_DATA_TAG || element.hadUndefinedLength) continue;
    if (element.dataOffset + element.length > byteLength) return false;
  }
  return true;
}

export function extractHeader(dataSet: DataSet): HeaderReadResult {
  const transferSyntaxUid = str(dataSet, 'x00020010') ?? '';
  const sopClassUid = str(dataSet, 'x00080016') ?? str(dataSet, 'x00020002') ?? '';
  const sopInstanceUid = str(dataSet, 'x00080018') ?? str(dataSet, 'x00020003') ?? '';
  const studyInstanceUid = str(dataSet, 'x0020000d');
  const seriesInstanceUid = str(dataSet, 'x0020000e');
  const hasPixelData = Boolean(dataSet.elements[PIXEL_DATA_TAG]);

  if (transferSyntaxUid === DEFLATED_TRANSFER_SYNTAX) {
    return { kind: 'unsupported', reason: 'deflated-transfer-syntax' };
  }
  if (!hasPixelData) return { kind: 'unsupported', reason: 'no-pixel-data' };
  if (!studyInstanceUid || !seriesInstanceUid) return { kind: 'unsupported', reason: 'missing-uids' };

  const position = decimals(dataSet, 'x00200032', 3);
  const orientation = decimals(dataSet, 'x00200037', 6);

  return {
    kind: 'dicom',
    header: {
      transferSyntaxUid,
      sopClassUid,
      sopInstanceUid,
      studyInstanceUid,
      seriesInstanceUid,
      studyDescription: str(dataSet, 'x00081030'),
      studyDate: str(dataSet, 'x00080020'),
      seriesDescription: str(dataSet, 'x0008103e'),
      modality: str(dataSet, 'x00080060'),
      seriesNumber: int(dataSet, 'x00200011'),
      instanceNumber: int(dataSet, 'x00200013'),
      rows: uint16(dataSet, 'x00280010'),
      columns: uint16(dataSet, 'x00280011'),
      numberOfFrames: Math.max(1, int(dataSet, 'x00280008') ?? 1),
      imagePositionPatient: position as DicomInstanceHeader['imagePositionPatient'],
      imageOrientationPatient: orientation as DicomInstanceHeader['imageOrientationPatient'],
      hasPixelData,
    },
  };
}

/**
 * Reads the header of a DICOM Part 10 file, stopping before Pixel Data.
 * Starts with a small slice and grows it only when the header does not fit, so large
 * files are never copied in full just to be grouped.
 */
export async function readDicomHeader(
  blob: Blob,
  options: { signal?: AbortSignal; readRange?: ReadRange } = {},
): Promise<HeaderReadResult> {
  const { signal, readRange = defaultReadRange } = options;
  let length = Math.min(blob.size, INITIAL_READ_BYTES);

  for (;;) {
    throwIfAborted(signal);
    const buffer = await readRange(blob, 0, length);
    throwIfAborted(signal);
    const bytes = new Uint8Array(buffer);
    if (!hasPart10Preamble(bytes)) return { kind: 'not-dicom' };

    const isWholeFile = length >= blob.size;
    let dataSet: DataSet | undefined;
    try {
      dataSet = parseDicom(bytes, { untilTag: PIXEL_DATA_TAG });
    } catch {
      // Either not parseable, or parsing ran past the end of the slice and needs more bytes.
      if (isWholeFile) return { kind: 'not-dicom' };
    }

    if (dataSet) {
      const reachedPixelData = Boolean(dataSet.elements[PIXEL_DATA_TAG]);
      if (isWholeFile || (reachedPixelData && elementsWithinBuffer(dataSet, bytes.length))) {
        return extractHeader(dataSet);
      }
    }

    if (length >= MAX_HEADER_BYTES) return { kind: 'not-dicom' };
    length = Math.min(blob.size, length * 4, MAX_HEADER_BYTES);
  }
}

