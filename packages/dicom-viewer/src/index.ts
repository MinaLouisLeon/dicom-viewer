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
export type { ViewerPhase, ViewerProgress, ViewerState } from './core/viewerSession';
export type { ViewerTool, ViewportStatus } from './core/renderer';
