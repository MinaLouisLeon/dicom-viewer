import type { DicomViewerErrorCode } from '../core/errors';
import type { SkippedReason } from '../core/scanFiles';

/**
 * Every user-visible string in the viewer. Pass a partial object through the
 * `labels` prop to translate or reword any of them.
 */
export interface DicomViewerLabels {
  viewerRegion: string;
  toolbar: string;
  openFiles: string;
  openFolder: string;
  clear: string;
  cancel: string;
  dropZoneTitle: string;
  dropZoneHint: string;
  privacyNote: string;
  studiesHeading: string;
  seriesList: string;
  untitledStudy: string;
  untitledSeries: string;
  /** Return an empty string to fall back to `untitledSeries`. */
  seriesLabel: (series: { number?: number; description?: string; modality?: string }) => string;
  imageCount: (count: number) => string;
  scanning: (processed: number, total: number) => string;
  loadingSeries: string;
  cancelled: string;
  skippedFiles: (count: number) => string;
  skippedReasons: Record<SkippedReason, string>;
  errors: Record<DicomViewerErrorCode, string>;
  formatStudyDate: (dicomDate: string) => string;
}

const formatDicomDate = (value: string): string =>
  /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;

export const defaultLabels: DicomViewerLabels = {
  viewerRegion: 'DICOM viewer',
  toolbar: 'Viewer actions',
  openFiles: 'Open files',
  openFolder: 'Open folder',
  clear: 'Close study',
  cancel: 'Cancel',
  dropZoneTitle: 'Open DICOM files',
  dropZoneHint: 'Drop files or a folder here, or use the buttons above.',
  privacyNote: 'Files are read in this browser and are not uploaded.',
  studiesHeading: 'Studies',
  seriesList: 'Series',
  untitledStudy: 'Untitled study',
  untitledSeries: 'Untitled series',
  seriesLabel: ({ number, description, modality }) =>
    [number !== undefined ? `#${number}` : undefined, modality, description].filter(Boolean).join(' · '),
  imageCount: (count) => (count === 1 ? '1 image' : `${count} images`),
  scanning: (processed, total) => `Reading files… ${processed} of ${total}`,
  loadingSeries: 'Loading images…',
  cancelled: 'Cancelled.',
  skippedFiles: (count) => (count === 1 ? '1 file was skipped.' : `${count} files were skipped.`),
  skippedReasons: {
    'not-dicom': 'Not a DICOM file',
    'read-failed': 'Could not be read',
    'no-pixel-data': 'Contains no image',
    'deflated-transfer-syntax': 'Deflated encoding is not supported',
    'missing-uids': 'Missing study or series identifiers',
  },
  errors: {
    NO_DICOM_FILES: 'No DICOM images were found in the selected files. Choose DICOM (.dcm) files or a folder that contains them.',
    FILE_READ_FAILED: 'The selected files could not be read. Check that they are still available and try again.',
    RENDERER_INIT_FAILED: 'The viewer could not start in this browser. Make sure hardware acceleration is enabled, then reload the page.',
    IMAGE_LOAD_FAILED: 'These images could not be displayed. The file may be damaged. Try another series or re-export the study.',
    UNSUPPORTED_IMAGE: 'This image uses an encoding the viewer does not support. Try another series or re-export the study.',
  },
  formatStudyDate: formatDicomDate,
};

export function resolveLabels(overrides?: Partial<DicomViewerLabels>): DicomViewerLabels {
  if (!overrides) return defaultLabels;
  return {
    ...defaultLabels,
    ...overrides,
    skippedReasons: { ...defaultLabels.skippedReasons, ...overrides.skippedReasons },
    errors: { ...defaultLabels.errors, ...overrides.errors },
  };
}
