import type { DicomViewerErrorCode } from '../core/errors';
import type { ViewerLayout, ViewerTool, VolumeView } from '../core/renderer';
import type { SkippedReason } from '../core/scanFiles';
import type { VolumeUnsupportedReason } from '../core/volumeGeometry';

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

  // ── Image viewport (2D) ──
  /** Accessible name of the group of tool buttons. */
  toolGroup: string;
  tools: Record<ViewerTool, string>;
  zoomIn: string;
  zoomOut: string;
  resetView: string;
  /** Accessible name of the image area. */
  imageViewport: string;
  /** Read by screen readers when the image area is focused. */
  imageViewportHelp: string;
  sliceControls: string;
  previousImage: string;
  nextImage: string;
  /** Accessible name of the image slider. */
  imageSlider: string;
  /** `index` is one-based. */
  imagePosition: (index: number, count: number) => string;
  windowLevelValue: (width: number, center: number) => string;
  /** `zoom` is relative to fit-to-viewport (1 = fit). */
  zoomValue: (zoom: number) => string;
  /** Shown over the viewport when one image of a stack cannot be decoded. `index` is one-based. */
  imageFailed: (index: number, count: number) => string;

  // ── Layout and 3D ──
  /** Accessible name of the 2D/3D switch. */
  layoutGroup: string;
  layouts: Record<ViewerLayout, string>;
  /** Marks series that can open in 3D, in the series list. */
  volumeBadge: string;
  /** Explains why the selected series cannot open in 3D. */
  volumeUnsupportedReasons: Record<VolumeUnsupportedReason, string>;
  /** Pane titles of the 3D layout. */
  views: Record<VolumeView, string>;
  /** Read by screen readers when a cross-section is focused. */
  planeViewportHelp: string;
  /** Read by screen readers when the 3D view is focused. */
  volumeViewportHelp: string;
  /** Accessible name of a cross-section's slice slider. */
  sliceSlider: (view: string) => string;
  /** `index` is one-based. */
  slicePosition: (index: number, count: number) => string;
  /** `processed`/`total` count files read plus slices decoded. */
  loadingVolume: (processed: number, total: number) => string;
  /** Shown in the 3D pane when the browser cannot render it or the host turned it off. */
  volumeRenderingUnavailable: string;
  /** Button on a 3D error that reopens the series in 2D. */
  openIn2d: string;
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
    VOLUME_UNSUPPORTED: 'This series cannot be shown in 3D. Open it in 2D instead.',
    VOLUME_LOAD_FAILED:
      'Some slices of this series could not be decoded, so the 3D volume would be incomplete. Open it in 2D to view the readable slices, or re-export the study.',
    VOLUME_TOO_LARGE:
      'This series is too large to open in 3D on this device. Open it in 2D, or use a device with more memory.',
  },
  formatStudyDate: formatDicomDate,

  toolGroup: 'Mouse tool',
  tools: {
    windowLevel: 'Window/level',
    pan: 'Pan',
    zoom: 'Zoom',
    scroll: 'Scroll',
    crosshairs: 'Crosshairs',
  },
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
  imageViewport: 'Image',
  imageViewportHelp:
    'Arrow keys apply the selected tool. Page Up and Page Down change the image, Home and End go to the first and last image, plus and minus zoom, and R resets the view. Hold Shift for larger steps.',
  sliceControls: 'Image navigation',
  previousImage: 'Previous image',
  nextImage: 'Next image',
  imageSlider: 'Image',
  imagePosition: (index, count) => `Image ${index} of ${count}`,
  windowLevelValue: (width, center) => `W ${Math.round(width)} · L ${Math.round(center)}`,
  zoomValue: (zoom) => `Zoom ${Math.round(zoom * 100)}%`,
  imageFailed: (index, count) =>
    `Image ${index} of ${count} could not be displayed. The file may be damaged or use an unsupported encoding. The previous image is still shown.`,

  layoutGroup: 'Layout',
  layouts: { '2d': '2D', '3d': '3D' },
  volumeBadge: '3D',
  volumeUnsupportedReasons: {
    'too-few-images': '3D needs a series of at least 3 slices.',
    'color-images': '3D is not available for colour images.',
    'missing-geometry': '3D is not available: the images lack position or spacing information.',
    'mixed-dimensions': '3D is not available: the images differ in size or pixel spacing.',
    'mixed-orientation': '3D is not available: the images are not parallel.',
    'mixed-frame-of-reference': '3D is not available: the images come from different scans.',
    'tilted-slices': '3D is not available: the slices are tilted or offset.',
    'duplicate-positions': '3D is not available: several images share one slice position.',
    'missing-slices': '3D is not available: slices are missing. Select the complete series.',
    'irregular-spacing': '3D is not available: the slice spacing is uneven.',
  },
  views: { axial: 'Axial', sagittal: 'Sagittal', coronal: 'Coronal', volume: '3D' },
  planeViewportHelp:
    'Page Up and Page Down change the slice, Home and End go to the first and last slice. Arrow keys apply the selected tool; with Crosshairs they move the linked position. Plus and minus zoom, and R resets all views. Hold Shift for larger steps.',
  volumeViewportHelp: 'Arrow keys rotate the volume. Plus and minus zoom, and R resets all views. Hold Shift for larger steps.',
  sliceSlider: (view) => `${view} slice`,
  slicePosition: (index, count) => `Slice ${index} of ${count}`,
  loadingVolume: (processed, total) => `Loading volume… ${Math.round((processed / Math.max(1, total)) * 100)}%`,
  volumeRenderingUnavailable: '3D rendering is turned off or not available in this browser. The cross-sections still work.',
  openIn2d: 'Open in 2D',
};

export function resolveLabels(overrides?: Partial<DicomViewerLabels>): DicomViewerLabels {
  if (!overrides) return defaultLabels;
  return {
    ...defaultLabels,
    ...overrides,
    skippedReasons: { ...defaultLabels.skippedReasons, ...overrides.skippedReasons },
    errors: { ...defaultLabels.errors, ...overrides.errors },
    tools: { ...defaultLabels.tools, ...overrides.tools },
    layouts: { ...defaultLabels.layouts, ...overrides.layouts },
    views: { ...defaultLabels.views, ...overrides.views },
    volumeUnsupportedReasons: { ...defaultLabels.volumeUnsupportedReasons, ...overrides.volumeUnsupportedReasons },
  };
}
