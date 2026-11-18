// Extracted to dist/styles.css by the library build; consumers import '@mivo-labs/dicom-viewer/styles.css'.
import './styles/viewer.css';

export { DicomViewer } from './components/DicomViewer';
export type { DicomViewerHandle, DicomViewerProps } from './components/DicomViewer';

export { defaultLabels } from './i18n/labels';
export type { DicomViewerLabels } from './i18n/labels';

export { DicomViewerError } from './core/errors';
export type { DicomViewerErrorCode } from './core/errors';

export { DEFAULT_CODEC_BASE_PATH } from './core/assetPaths';
export type { SeriesSummary, StudySummary } from './core/studyModel';
export type { SkippedFile, SkippedReason } from './core/scanFiles';
export type { ViewerPhase, ViewerProgress, ViewerState, ViewportState } from './core/viewerSession';
export { DEFAULT_MAX_VOLUME_BYTES } from './core/renderer';
export type {
  PlaneStatus,
  ViewerLayout,
  ViewerTool,
  ViewportStatus,
  VolumePlane,
  VolumeStatus,
  VolumeView,
} from './core/renderer';
export type { VolumeSupport, VolumeUnsupportedReason } from './core/volumeGeometry';
