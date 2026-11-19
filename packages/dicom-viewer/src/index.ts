// Extracted to dist/styles.css by the library build; consumers import '@mihawksolutions/dicom-viewer/styles.css'.
import './styles/viewer.css';
import './styles/workstation.css';

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

// ── Workstation: the full app (tabs, viewport grid, side menu, presets, measurements, tag map) ──
export { DicomWorkstation } from './workstation/DicomWorkstation';
export type { DicomWorkstationHandle, DicomWorkstationProps } from './workstation/DicomWorkstation';
export { defaultWorkstationLabels } from './workstation/labels';
export type { WorkstationLabels } from './workstation/labels';
export { DEFAULT_FEATURES } from './workstation/context';
export type { WorkstationFeatures } from './workstation/context';
export type {
  CellMode,
  CellPhase,
  CellState,
  CellViewState,
  WorkstationPhase,
  WorkstationState,
  WorkstationTab,
} from './workstation/workstationSession';
export type { CellStatus, CellTransform, SyncOptions, WorkstationTool } from './workstation/gridRenderer';
export { GRID_LAYOUTS, MPR_LAYOUTS } from './workstation/layouts';
export type { GridLayout, MprLayout } from './workstation/layouts';
export { DEFAULT_WINDOW_PRESETS, computeAutoWindow, presetApplies } from './workstation/windowPresets';
export type { AutoWindowOptions, WindowPreset, WindowValue } from './workstation/windowPresets';
export { readTagMap, filterTagNodes, PATIENT_IDENTIFYING_TAGS } from './workstation/tagMap';
export type { TagNode, TagMapOptions } from './workstation/tagMap';
