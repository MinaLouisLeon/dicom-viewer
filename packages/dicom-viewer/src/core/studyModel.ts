import type { DicomInstanceHeader } from './dicomHeader';
import { assessVolume, type VolumeFrame, type VolumeSupport } from './volumeGeometry';

/** A locally selected DICOM file with its parsed header. Held in memory only. */
export interface LocalInstance {
  /** Position in the user's selection; used as a stable tie-breaker. */
  selectionIndex: number;
  file: Blob;
  header: DicomInstanceHeader;
}

/** Public, file-free description of a series. */
export interface SeriesSummary {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  description?: string;
  modality?: string;
  seriesNumber?: number;
  /** Number of DICOM files in the series. */
  instanceCount: number;
  /** Number of displayable images (frames) across all files. */
  imageCount: number;
  rows?: number;
  columns?: number;
  /** Whether the series can be opened in the 3D layout, decided from header geometry. */
  volume: VolumeSupport;
}

/** Public, file-free description of a study. */
export interface StudySummary {
  studyInstanceUid: string;
  description?: string;
  /** DICOM DA value (YYYYMMDD) when present. */
  date?: string;
  series: SeriesSummary[];
}

export interface LocalSeries {
  summary: SeriesSummary;
  /** Instances in display order. */
  instances: LocalInstance[];
  /** Slices ordered along the slice normal, when `summary.volume.supported`. */
  volumeFrames?: VolumeFrame[];
}

export interface LocalStudy {
  summary: StudySummary;
  series: LocalSeries[];
}

function sliceNormal(orientation: readonly number[]): [number, number, number] {
  const [rx = 0, ry = 0, rz = 0, cx = 0, cy = 0, cz = 0] = orientation;
  return [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
}

function sameOrientation(a: readonly number[], b: readonly number[], tolerance = 1e-3): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - (b[index] ?? NaN)) <= tolerance);
}

function compareOptional(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

/**
 * Orders the instances of one series for stack display.
 * Uses the projection of Image Position (Patient) onto the slice normal when every
 * instance shares one orientation, otherwise Instance Number, otherwise selection order.
 * Axial stacks (slice normal closest to the head–feet axis) run head first, as scanners
 * and most viewers present them. Sagittal and coronal stacks run along the normal.
 */
export function orderInstances(instances: readonly LocalInstance[]): LocalInstance[] {
  const first = instances[0]?.header.imageOrientationPatient;
  const canUseGeometry =
    instances.length > 1 &&
    first !== undefined &&
    instances.every(
      ({ header }) =>
        header.imagePositionPatient !== undefined &&
        header.imageOrientationPatient !== undefined &&
        sameOrientation(header.imageOrientationPatient, first),
    );

  const normal = canUseGeometry && first ? sliceNormal(first) : undefined;
  // LPS: +z is superior, so an axial stack sorts by descending z (head first).
  const axial = normal !== undefined && Math.abs(normal[2]) >= Math.abs(normal[0]) && Math.abs(normal[2]) >= Math.abs(normal[1]);
  const direction = axial ? (normal![2] > 0 ? -1 : 1) : 1;
  const distance = (instance: LocalInstance): number | undefined => {
    const position = instance.header.imagePositionPatient;
    if (!normal || !position) return undefined;
    return direction * (position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2]);
  };

  return [...instances].sort(
    (a, b) =>
      compareOptional(distance(a), distance(b)) ||
      compareOptional(a.header.instanceNumber, b.header.instanceNumber) ||
      a.selectionIndex - b.selectionIndex,
  );
}

/** Groups instances into studies and series. Duplicate SOP Instance UIDs are kept once. */
export function groupInstances(instances: readonly LocalInstance[]): LocalStudy[] {
  const studies = new Map<string, Map<string, LocalInstance[]>>();
  const seen = new Set<string>();

  for (const instance of instances) {
    const { studyInstanceUid, seriesInstanceUid, sopInstanceUid } = instance.header;
    if (sopInstanceUid) {
      const key = `${seriesInstanceUid}|${sopInstanceUid}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    let seriesMap = studies.get(studyInstanceUid);
    if (!seriesMap) {
      seriesMap = new Map();
      studies.set(studyInstanceUid, seriesMap);
    }
    const list = seriesMap.get(seriesInstanceUid);
    if (list) list.push(instance);
    else seriesMap.set(seriesInstanceUid, [instance]);
  }

  const result: LocalStudy[] = [];
  for (const [studyInstanceUid, seriesMap] of studies) {
    const series: LocalSeries[] = [];
    for (const [seriesInstanceUid, members] of seriesMap) {
      const ordered = orderInstances(members);
      const head = ordered[0]?.header;
      const volume = assessVolume(ordered);
      series.push({
        instances: ordered,
        volumeFrames: volume.frames,
        summary: {
          studyInstanceUid,
          seriesInstanceUid,
          description: head?.seriesDescription,
          modality: head?.modality,
          seriesNumber: head?.seriesNumber,
          instanceCount: ordered.length,
          imageCount: ordered.reduce((total, item) => total + item.header.numberOfFrames, 0),
          rows: head?.rows,
          columns: head?.columns,
          volume: volume.support,
        },
      });
    }
    series.sort(
      (a, b) =>
        compareOptional(a.summary.seriesNumber, b.summary.seriesNumber) ||
        (a.instances[0]?.selectionIndex ?? 0) - (b.instances[0]?.selectionIndex ?? 0),
    );
    const head = series[0]?.instances[0]?.header;
    result.push({
      series,
      summary: {
        studyInstanceUid,
        description: head?.studyDescription,
        date: head?.studyDate,
        series: series.map((item) => item.summary),
      },
    });
  }
  return result;
}
