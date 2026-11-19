// Extracted to dist/styles.css by the library build; apps import '@mihawksolutions/dicom-workstation/styles.css'.
import './styles/workstation.css';

/** The complete viewer app as one component. */
export { DicomWorkstation } from './DicomWorkstation';
export type { DicomWorkstationHandle, DicomWorkstationProps } from './DicomWorkstation';
export { defaultWorkstationLabels } from './labels';
export type { WorkstationLabels } from './labels';
export { DEFAULT_FEATURES } from './context';
export type { WorkstationFeatures } from './context';
export type {
  CellMode,
  CellPhase,
  CellState,
  CellViewState,
  WorkstationPhase,
  WorkstationState,
  WorkstationTab,
} from './workstationSession';
export type { AnnotationVisibility, CellStatus, CellTransform, SyncOptions, WorkstationTool } from './gridRenderer';
export { GRID_LAYOUTS, MPR_LAYOUTS } from './layouts';
export { DEFAULT_ARCHIVE_LIMITS, expandArchives, isZipArchive } from './archive';
export type { ArchiveIssue, ArchiveIssueReason, ArchiveLimits, ExpandResult } from './archive';
export type { GridLayout, MprLayout } from './layouts';

// Commonly used with the workstation; re-exported so an app needs only this package's import.
export { DEFAULT_CODEC_BASE_PATH, DEFAULT_WINDOW_PRESETS, DicomViewerError } from '@mihawksolutions/dicom-viewer';
export type {
  DicomViewerErrorCode,
  SeriesSummary,
  StudySummary,
  WindowPreset,
  WindowValue,
} from '@mihawksolutions/dicom-viewer';
