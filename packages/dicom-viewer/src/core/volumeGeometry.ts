import type { LocalInstance } from './studyModel';

export type Point3 = [number, number, number];

/** Why a series cannot be shown as a volume. Each reason has a translatable label. */
export type VolumeUnsupportedReason =
  /** Fewer images than a volume needs (for example a single radiograph). */
  | 'too-few-images'
  /** Colour (RGB) images. */
  | 'color-images'
  /** An image lacks position, orientation, pixel spacing or size. */
  | 'missing-geometry'
  /** Images differ in rows, columns or pixel spacing. */
  | 'mixed-dimensions'
  /** Images are not all parallel. */
  | 'mixed-orientation'
  /** Images belong to different frames of reference. */
  | 'mixed-frame-of-reference'
  /** Slices are offset sideways from each other (for example gantry tilt). */
  | 'tilted-slices'
  /** Two or more images share one slice position. */
  | 'duplicate-positions'
  /** A gap in slice positions: slices are missing from the selection. */
  | 'missing-slices'
  /** Slice spacing varies without a whole-slice gap. */
  | 'irregular-spacing';

/** Whether a series can be shown as a volume, with its geometry when it can. File-free and safe to expose. */
export type VolumeSupport =
  | {
      supported: true;
      /** Columns, rows, slices. */
      dimensions: Point3;
      /** Column spacing, row spacing, slice spacing, in mm. */
      spacing: Point3;
    }
  | { supported: false; reason: VolumeUnsupportedReason };

/** One slice of a volume: a single-frame file, or one frame of a multi-frame file. */
export interface VolumeFrame {
  instance: LocalInstance;
  /** One-based frame number inside a multi-frame file; undefined for single-frame files. */
  frame?: number;
}

export type VolumeAssessment =
  | { support: Extract<VolumeSupport, { supported: true }>; frames: VolumeFrame[] }
  | { support: Extract<VolumeSupport, { supported: false }>; frames?: undefined };

/** Fewest slices accepted as a volume. */
export const MIN_VOLUME_SLICES = 3;

/** Orientation cosines may differ by this much and still count as parallel. */
const ORIENTATION_TOLERANCE = 1e-3;
/** Relative tolerance for pixel spacing equality. */
const PIXEL_SPACING_TOLERANCE = 1e-3;
/** Slices closer than this (mm) count as the same position. */
const DUPLICATE_DISTANCE_MM = 1e-3;
/** A gap may differ from the typical spacing by this fraction plus `SPACING_ABSOLUTE_TOLERANCE_MM`. */
const SPACING_RELATIVE_TOLERANCE = 0.1;
const SPACING_ABSOLUTE_TOLERANCE_MM = 1e-3;
/** A gap this many times the typical spacing means slices are missing. */
const MISSING_SLICE_RATIO = 1.5;

interface FrameGeometry {
  frame: VolumeFrame;
  position: Point3;
}

const unsupported = (reason: VolumeUnsupportedReason): VolumeAssessment => ({ support: { supported: false, reason } });

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

function cross(a: readonly number[], b: readonly number[]): Point3 {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

function nearlyEqual(a: readonly number[], b: readonly number[], tolerance: number): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) <= tolerance);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Expands the instances into slices, each with its position. Undefined if any slice has no position. */
function frameGeometries(instances: readonly LocalInstance[]): FrameGeometry[] | undefined {
  const result: FrameGeometry[] = [];
  for (const instance of instances) {
    const { numberOfFrames, imagePositionPatient, framePositions } = instance.header;
    if (numberOfFrames <= 1) {
      if (!imagePositionPatient) return undefined;
      result.push({ frame: { instance }, position: imagePositionPatient });
      continue;
    }
    if (!framePositions || framePositions.length !== numberOfFrames) return undefined;
    framePositions.forEach((position, index) => result.push({ frame: { instance, frame: index + 1 }, position }));
  }
  return result;
}

/**
 * Decides whether the instances of one series form a regular volume, and orders its
 * slices along the slice normal. Works only from header values, so it runs before any
 * pixel data is read.
 *
 * Accepted: parallel slices of one size and pixel spacing, stacked along the slice normal
 * at even spacing, from single-frame files or enhanced multi-frame files with per-frame
 * positions. Everything else returns the first reason it fails.
 */
export function assessVolume(instances: readonly LocalInstance[]): VolumeAssessment {
  const totalFrames = instances.reduce((sum, instance) => sum + instance.header.numberOfFrames, 0);
  if (totalFrames < MIN_VOLUME_SLICES) return unsupported('too-few-images');

  const head = instances[0]!.header;
  if (instances.some(({ header }) => (header.samplesPerPixel ?? 1) !== 1)) return unsupported('color-images');

  const { rows, columns, imageOrientationPatient: orientation, pixelSpacing } = head;
  if (!rows || !columns || !orientation || !pixelSpacing || pixelSpacing.some((value) => !(value > 0))) {
    return unsupported('missing-geometry');
  }
  for (const { header } of instances) {
    if (!header.imageOrientationPatient || !header.pixelSpacing || !header.rows || !header.columns) {
      return unsupported('missing-geometry');
    }
    if (header.rows !== rows || header.columns !== columns) return unsupported('mixed-dimensions');
    const spacingTolerance = PIXEL_SPACING_TOLERANCE * Math.max(...pixelSpacing);
    if (!nearlyEqual(header.pixelSpacing, pixelSpacing, spacingTolerance)) return unsupported('mixed-dimensions');
    if (!nearlyEqual(header.imageOrientationPatient, orientation, ORIENTATION_TOLERANCE)) {
      return unsupported('mixed-orientation');
    }
  }

  const frameOfReference = new Set(instances.map(({ header }) => header.frameOfReferenceUid).filter(Boolean));
  if (frameOfReference.size > 1) return unsupported('mixed-frame-of-reference');

  const geometries = frameGeometries(instances);
  if (!geometries) return unsupported('missing-geometry');

  const normal = cross(orientation.slice(0, 3), orientation.slice(3, 6));
  const normalLength = Math.hypot(...normal);
  if (!(normalLength > 0.5)) return unsupported('missing-geometry');
  const unitNormal = normal.map((value) => value / normalLength) as Point3;

  const sorted = geometries
    .map((geometry) => ({ ...geometry, distance: dot(geometry.position, unitNormal) }))
    .sort((a, b) => a.distance - b.distance);

  // Each slice must sit on the line through the first slice along the normal.
  const origin = sorted[0]!;
  const sidewaysTolerance = 0.05 * Math.min(...pixelSpacing);
  for (const slice of sorted) {
    const along = slice.distance - origin.distance;
    const offset = slice.position.map((value, axis) => value - origin.position[axis]! - along * unitNormal[axis]!);
    if (Math.hypot(...offset) > sidewaysTolerance + 1e-3 * Math.abs(along)) return unsupported('tilted-slices');
  }

  const gaps = sorted.slice(1).map((slice, index) => slice.distance - sorted[index]!.distance);
  if (gaps.some((gap) => gap < DUPLICATE_DISTANCE_MM)) return unsupported('duplicate-positions');
  const typical = median(gaps);
  for (const gap of gaps) {
    if (gap > typical * MISSING_SLICE_RATIO) return unsupported('missing-slices');
    if (Math.abs(gap - typical) > typical * SPACING_RELATIVE_TOLERANCE + SPACING_ABSOLUTE_TOLERANCE_MM) {
      return unsupported('irregular-spacing');
    }
  }

  return {
    support: {
      supported: true,
      dimensions: [columns, rows, sorted.length],
      spacing: [pixelSpacing[1], pixelSpacing[0], typical],
    },
    frames: sorted.map((slice) => slice.frame),
  };
}
