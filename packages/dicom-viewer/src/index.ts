// Extracted to dist/styles.css by the library build; consumers import '@mihawksolutions/dicom-viewer/styles.css'.
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

// ── Building blocks: brightness and contrast, DICOM tags, overlay information ──
export { DEFAULT_WINDOW_PRESETS, autoWindowOptionsFor, computeAutoWindow, presetApplies } from './core/windowPresets';
export type { AutoWindowOptions, WindowPreset, WindowValue } from './core/windowPresets';
export { readTagMap, filterTagNodes, countTagNodes, tagNodesToJson, PATIENT_IDENTIFYING_TAGS } from './core/tagMap';
export type { TagNode, TagMapOptions } from './core/tagMap';
export { lookupTag, formatTag } from './core/tagDictionary';
export { readImageInfo, orientationMarkers, directionLabel, formatPersonName } from './core/imageInfo';
export type { ImageInfo, OrientationMarkers, DisplayTransform } from './core/imageInfo';
export { VOLUME_PRESETS } from './core/renderer';
export type { SlabMode, VolumeSlab } from './core/renderer';
