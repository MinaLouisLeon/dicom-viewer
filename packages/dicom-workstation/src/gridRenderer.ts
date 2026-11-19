import { DicomViewerError } from '@mihawksolutions/dicom-viewer/internal';
import type { RendererConfig, StackImage, ViewportStatus } from '@mihawksolutions/dicom-viewer/internal';
import type { AutoWindowOptions, WindowValue } from '@mihawksolutions/dicom-viewer/internal';

/**
 * What the primary mouse button (or one finger) does in the workstation viewports.
 * Measurement tools draw session-only annotations; nothing is saved.
 * `crosshairs` applies to 3D (MPR) cells only.
 */
export type WorkstationTool =
  | 'windowLevel'
  | 'pan'
  | 'zoom'
  | 'scroll'
  | 'magnify'
  | 'crosshairs'
  | 'length'
  | 'angle'
  | 'cobbAngle'
  | 'bidirectional'
  | 'rectangleRoi'
  | 'ellipticalRoi'
  | 'probe'
  | 'arrow'
  | 'eraser';

export const NAVIGATION_TOOLS: readonly WorkstationTool[] = ['windowLevel', 'pan', 'zoom', 'scroll', 'magnify', 'crosshairs'];
export const MEASUREMENT_TOOLS: readonly WorkstationTool[] = [
  'length',
  'angle',
  'cobbAngle',
  'bidirectional',
  'rectangleRoi',
  'ellipticalRoi',
  'probe',
  'arrow',
  'eraser',
];

/** Display transform of a 2D cell. */
export interface CellTransform {
  /** Clockwise rotation in degrees: 0, 90, 180 or 270. */
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  invert: boolean;
}

export const IDENTITY_TRANSFORM: CellTransform = Object.freeze({
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  invert: false,
});

/** Read-only description of what a 2D cell shows. Holds no pixel or patient data. */
export interface CellStatus extends ViewportStatus, CellTransform {}

/** Which properties follow the active cell into the other 2D cells. */
export interface SyncOptions {
  /**
   * Scroll to the same position: by patient geometry when the series share a frame of
   * reference and orientation, otherwise to the same relative position in the stack.
   * Handled by the session, not the renderer.
   */
  scroll: boolean;
  zoomPan: boolean;
  windowLevel: boolean;
}

export interface AnnotationVisibility {
  /** Lengths, angles, ROIs and probes. */
  measurements: boolean;
  /** Arrow notes. */
  annotations: boolean;
}

export const NO_SYNC: SyncOptions = Object.freeze({ scroll: false, zoomPan: false, windowLevel: false });

export interface GridRendererCallbacks {
  /** Called (coalesced per task) when a cell's image, window, camera or transform changes. */
  onCellChange?: (cellId: string, status: CellStatus | undefined) => void;
}

/** A special window request: the file's own window (`default`) or one computed from the pixels (`auto`). */
export type WindowRequest = WindowValue | 'default' | 'auto';

/**
 * Renders the 2D cells of the viewport grid with one rendering engine, so the cells can
 * share tools, synchronizers and reference lines.
 */
export interface GridRenderer {
  /** Registers the element of a cell. Call before `showStack`. */
  attachCell(cellId: string, element: HTMLDivElement): void;
  /** Releases a cell's images and element. */
  detachCell(cellId: string): void;
  /** Displays images in a cell and resolves once the first image is drawn. */
  showStack(cellId: string, images: readonly StackImage[], signal: AbortSignal): Promise<void>;
  /** Removes the displayed images of a cell (and its measurements). */
  clearCell(cellId: string): void;
  setTool(tool: WorkstationTool): void;
  setImageIndex(cellId: string, index: number): void;
  /** Moves through the stack; with `wrap`, passing either end continues from the other (cine). */
  scrollBy(cellId: string, delta: number, wrap?: boolean): void;
  zoomBy(cellId: string, factor: number): void;
  panBy(cellId: string, dx: number, dy: number): void;
  adjustWindowLevel(cellId: string, widthSteps: number, centerSteps: number): void;
  /** Applies a window. Returns false when it cannot be applied (for example `auto` on colour images). */
  setWindow(cellId: string, request: WindowRequest, autoOptions?: AutoWindowOptions): boolean;
  setTransform(cellId: string, patch: Partial<CellTransform>): void;
  /** Restores zoom, pan, window, rotation, flips and invert. */
  resetView(cellId: string): void;
  getStatus(cellId: string): CellStatus | undefined;
  setSync(options: SyncOptions): void;
  /** Shows where `sourceCellId`'s image cuts the other cells; undefined turns them off. */
  setReferenceLines(sourceCellId: string | undefined): void;
  /** Removes measurements from one cell, or from every cell. */
  clearMeasurements(cellId?: string): void;
  /** Number of measurements drawn on a cell's images. */
  measurementCount(cellId: string): number;
  /** Shows or hides measurements and arrow notes without deleting them. */
  setAnnotationVisibility(visibility: AnnotationVisibility): void;
  /** Renders one image into a small PNG data URL, for series thumbnails. Undefined on failure. */
  renderThumbnail(file: Blob, frame: number | undefined, size: number): Promise<string | undefined>;
  destroy(): void;
}

export type CreateGridRenderer = (config: RendererConfig, callbacks?: GridRendererCallbacks) => Promise<GridRenderer>;

/** Default factory: loads Cornerstone only when the first cell displays a series. */
export const createCornerstoneGridRenderer: CreateGridRenderer = async (config, callbacks) => {
  let module: typeof import('./cornerstoneGridRenderer');
  try {
    module = await import('./cornerstoneGridRenderer');
  } catch (error) {
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }
  return module.createCornerstoneGridRenderer(config, callbacks);
};
