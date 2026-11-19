import { createContext, useContext } from 'react';

import type { CellViewState, WorkstationSession, WorkstationState } from './workstationSession';
import type { WorkstationLabels } from './labels';

/** Parts of the workstation a host can turn off. All default to true. */
export interface WorkstationFeatures {
  /** The Map tab (DICOM tag map). */
  map: boolean;
  /** Open files and folders, and drop them on the viewer. */
  openFiles: boolean;
  /** Series list (sidebar on desktop, side menu on phone and tablet). */
  seriesPanel: boolean;
  /** Viewport grid selector. */
  layouts: boolean;
  /** 3D / MPR viewports. */
  mpr: boolean;
  /** Measurement tools. */
  measurements: boolean;
  /** Brightness and contrast presets, including Auto. */
  presets: boolean;
  /** Invert, rotate and flip. */
  transforms: boolean;
  cine: boolean;
  /** Linked scrolling, zoom/pan and window/level between viewports. */
  sync: boolean;
  referenceLines: boolean;
  /** Corner information over each viewport. */
  overlay: boolean;
  /** Save the active viewport as a PNG image. */
  export: boolean;
  fullscreen: boolean;
}

export const DEFAULT_FEATURES: WorkstationFeatures = {
  map: true,
  openFiles: true,
  seriesPanel: true,
  layouts: true,
  mpr: true,
  measurements: true,
  presets: true,
  transforms: true,
  cine: true,
  sync: true,
  referenceLines: true,
  overlay: true,
  export: true,
  fullscreen: true,
};

export type SizeClass = 'phone' | 'tablet' | 'desktop';

export interface WorkstationContextValue {
  session: WorkstationSession;
  state: WorkstationState;
  views: Record<string, CellViewState>;
  labels: WorkstationLabels;
  features: WorkstationFeatures;
  allowPatientInfo: boolean;
  size: SizeClass;
  isFullscreen: boolean;
  openFilePicker: () => void;
  openFolderPicker: () => void;
  exportImage: () => Promise<void>;
  toggleFullscreen: () => void;
  /** Called after a control is used from the side menu (closes it on phones). */
  afterAction: () => void;
}

export const WorkstationContext = createContext<WorkstationContextValue | null>(null);

export function useWorkstation(): WorkstationContextValue {
  const value = useContext(WorkstationContext);
  if (!value) throw new Error('useWorkstation must be used inside <DicomWorkstation>');
  return value;
}
