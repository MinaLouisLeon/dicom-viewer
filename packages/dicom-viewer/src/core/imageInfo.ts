import type { DataSet } from 'dicom-parser';

import { readHeaderDataSet, type ReadRange } from './dicomHeader';

/**
 * Attributes shown in the corner overlay of a viewport. Patient fields are read only
 * when the overlay asks for them, and only kept in memory for the session.
 */
export interface ImageInfo {
  patientName?: string;
  patientId?: string;
  patientSex?: string;
  patientAge?: string;
  patientBirthDate?: string;
  institutionName?: string;
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  seriesDescription?: string;
  seriesNumber?: string;
  instanceNumber?: string;
  modality?: string;
  manufacturer?: string;
  modelName?: string;
  bodyPart?: string;
  sliceThickness?: string;
  sliceLocation?: string;
  kvp?: string;
  exposure?: string;
  rows?: number;
  columns?: number;
  pixelSpacing?: [number, number];
  imageOrientationPatient?: number[];
  photometricInterpretation?: string;
  transferSyntaxUid?: string;
}

const str = (dataSet: DataSet, tag: string): string | undefined => {
  const value = dataSet.string(tag)?.trim();
  return value ? value : undefined;
};

function numbers(dataSet: DataSet, tag: string, count: number): number[] | undefined {
  const raw = str(dataSet, tag);
  if (!raw) return undefined;
  const values = raw.split('\\').map(Number.parseFloat);
  return values.length === count && values.every(Number.isFinite) ? values : undefined;
}

function nested(dataSet: DataSet, sequences: string[], tag: string, count: number): number[] | undefined {
  let current: DataSet | undefined = dataSet;
  for (const sequence of sequences) current = current?.elements[sequence]?.items?.[0]?.dataSet;
  return current ? numbers(current, tag, count) : undefined;
}

/** DICOM PN `Family^Given^Middle^Prefix^Suffix` → `Given Middle Family`. */
export function formatPersonName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [alphabetic = ''] = value.split('=');
  const [family = '', given = '', middle = '', prefix = '', suffix = ''] = alphabetic.split('^');
  const name = [prefix, given, middle, family, suffix].map((part) => part.trim()).filter(Boolean).join(' ');
  return name || undefined;
}

export function extractImageInfo(dataSet: DataSet): ImageInfo {
  const shared = 'x52009229';
  const perFrame = 'x52009230';
  const spacing =
    numbers(dataSet, 'x00280030', 2) ??
    nested(dataSet, [shared, 'x00289110'], 'x00280030', 2) ??
    nested(dataSet, [perFrame, 'x00289110'], 'x00280030', 2);
  const orientation =
    numbers(dataSet, 'x00200037', 6) ??
    nested(dataSet, [shared, 'x00209116'], 'x00200037', 6) ??
    nested(dataSet, [perFrame, 'x00209116'], 'x00200037', 6);
  return {
    patientName: formatPersonName(str(dataSet, 'x00100010')),
    patientId: str(dataSet, 'x00100020'),
    patientSex: str(dataSet, 'x00100040'),
    patientAge: str(dataSet, 'x00101010'),
    patientBirthDate: str(dataSet, 'x00100030'),
    institutionName: str(dataSet, 'x00080080'),
    studyDate: str(dataSet, 'x00080020'),
    studyTime: str(dataSet, 'x00080030'),
    studyDescription: str(dataSet, 'x00081030'),
    seriesDescription: str(dataSet, 'x0008103e'),
    seriesNumber: str(dataSet, 'x00200011'),
    instanceNumber: str(dataSet, 'x00200013'),
    modality: str(dataSet, 'x00080060'),
    manufacturer: str(dataSet, 'x00080070'),
    modelName: str(dataSet, 'x00081090'),
    bodyPart: str(dataSet, 'x00180015'),
    sliceThickness: str(dataSet, 'x00180050'),
    sliceLocation: str(dataSet, 'x00201041'),
    kvp: str(dataSet, 'x00180060'),
    exposure: str(dataSet, 'x00181152'),
    rows: dataSet.elements.x00280010 ? dataSet.uint16('x00280010') : undefined,
    columns: dataSet.elements.x00280011 ? dataSet.uint16('x00280011') : undefined,
    pixelSpacing: spacing as [number, number] | undefined,
    imageOrientationPatient: orientation,
    photometricInterpretation: str(dataSet, 'x00280004'),
    transferSyntaxUid: str(dataSet, 'x00020010'),
  };
}

const infoCache = new WeakMap<Blob, Promise<ImageInfo | undefined>>();

/**
 * Reads overlay attributes from a file's header (never its pixel data). Results are
 * cached per file for the lifetime of the Blob; only the small info object is kept.
 */
export function readImageInfo(file: Blob, options: { readRange?: ReadRange } = {}): Promise<ImageInfo | undefined> {
  let cached = infoCache.get(file);
  if (!cached) {
    cached = readHeaderDataSet(file, options).then(
      (dataSet) => (dataSet ? extractImageInfo(dataSet) : undefined),
      () => undefined,
    );
    infoCache.set(file, cached);
  }
  return cached;
}

/** DICOM DA `YYYYMMDD` → `YYYY-MM-DD`; other values unchanged. */
export function formatDicomDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}

/** DICOM TM `HHMMSS.frac` → `HH:MM:SS`. */
export function formatDicomTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{2})(\d{2})?(\d{2})?/.exec(value);
  if (!match) return value;
  return [match[1], match[2] ?? '00', match[3] ?? '00'].join(':');
}

// ── Orientation markers ────────────────────────────────────────────────────

/** Patient direction letters (L/R, A/P, S/I) of an LPS vector, strongest axis first (for example "LA"). */
export function directionLabel(vector: readonly number[], threshold = 0.25): string {
  const [x = 0, y = 0, z = 0] = vector;
  const axes: [number, string][] = [
    [x, x > 0 ? 'L' : 'R'],
    [y, y > 0 ? 'P' : 'A'],
    [z, z > 0 ? 'S' : 'I'],
  ];
  return axes
    .filter(([value]) => Math.abs(value) >= threshold)
    .sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))
    .map(([, letter]) => letter)
    .join('');
}

export interface OrientationMarkers {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface DisplayTransform {
  /** Clockwise rotation in degrees (multiples of 90). */
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

/**
 * Side labels for an image from Image Orientation (Patient), after the display
 * transform (flips are applied before rotation, as Cornerstone does).
 */
export function orientationMarkers(
  orientation: readonly number[] | undefined,
  transform: DisplayTransform = { rotation: 0, flipHorizontal: false, flipVertical: false },
): OrientationMarkers | undefined {
  if (!orientation || orientation.length !== 6) return undefined;
  const row = orientation.slice(0, 3); // direction of increasing column index (screen right)
  const column = orientation.slice(3, 6); // direction of increasing row index (screen down)
  const negate = (vector: number[]) => vector.map((value) => -value);
  let right = row;
  let down = column;
  if (transform.flipHorizontal) right = negate(right);
  if (transform.flipVertical) down = negate(down);
  const turns = (((Math.round(transform.rotation / 90) % 4) + 4) % 4);
  for (let index = 0; index < turns; index += 1) {
    // Rotating the image 90° clockwise: what was "up" is now on the right.
    const nextRight = negate(down);
    down = right;
    right = nextRight;
  }
  const markers = {
    right: directionLabel(right),
    left: directionLabel(negate(right)),
    bottom: directionLabel(down),
    top: directionLabel(negate(down)),
  };
  return markers.right || markers.bottom ? markers : undefined;
}
