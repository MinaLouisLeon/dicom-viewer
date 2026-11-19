import { DicomViewerError } from './errors';

/**
 * Renderer boundary. The session controller depends only on this interface, so the
 * Cornerstone implementation can be lazy-loaded and replaced with a fake in tests.
 */
export interface RendererConfig {
  /** URL (absolute path or full URL) of the directory that serves codec `.wasm` files. */
  codecBasePath: string;
  /** Upper bound on decode workers. Defaults to half the logical CPU count. */
  maxWebWorkers?: number;
  /** Set false to skip the rotatable 3D view (cross-sections still work). @default true */
  volumeRendering?: boolean;
  /** Largest decoded volume, in bytes, the 3D layout will allocate. */
  maxVolumeBytes?: number;
  /** Initial 3D view preset. @default 'CT-Bone' */
  volumePreset?: string;
}

/** Default cap on decoded voxel memory for one volume (2 GiB). */
export const DEFAULT_MAX_VOLUME_BYTES = 2 * 1024 ** 3;

/**
 * What the primary mouse button (and the arrow keys) do in the image viewports.
 * `crosshairs` exists only in the 3D layout, where it moves the linked cross-section position.
 */
export type ViewerTool = 'windowLevel' | 'pan' | 'zoom' | 'scroll' | 'crosshairs';

/** Tools offered in the 2D layout. */
export const VIEWER_TOOLS: readonly ViewerTool[] = ['windowLevel', 'pan', 'zoom', 'scroll'];
/** Tools offered for the cross-sections of the 3D layout. The 3D view always rotates on the primary button. */
export const VOLUME_TOOLS: readonly ViewerTool[] = ['crosshairs', 'windowLevel', 'pan', 'zoom', 'scroll'];

/** 2D shows one image or stack; 3D shows linked cross-sections and a rotatable volume. */
export type ViewerLayout = '2d' | '3d';

/** Read-only description of what the viewport currently shows. Holds no pixel or patient data. */
export interface ViewportStatus {
  /** Zero-based index of the displayed image in the stack. */
  imageIndex: number;
  imageCount: number;
  windowWidth?: number;
  windowCenter?: number;
  /** Magnification relative to fit-to-viewport (1 = fit). */
  zoom: number;
  /** True when the image at `imageIndex` failed to decode; the viewport still shows the previous image. */
  imageFailed: boolean;
}

export interface RendererCallbacks {
  /** Called (coalesced per task) when the displayed image, window/level or camera changes. */
  onViewportChange?: (status: ViewportStatus | undefined) => void;
}

export interface StackImage {
  file: Blob;
  /** Number of frames in the file. Multi-frame files contribute one image per frame. */
  numberOfFrames: number;
}

export interface StackRenderer {
  /**
   * Displays the images as a stack and resolves once the first image has been drawn.
   * Rejects with an `AbortError` if `signal` aborts first.
   */
  showStack(images: readonly StackImage[], signal: AbortSignal): Promise<void>;
  /** Binds `tool` to the primary mouse button. Wheel scrolls, right-drag zooms and middle-drag pans regardless. */
  setTool(tool: ViewerTool): void;
  /** Shows the image at `index` (clamped to the stack). */
  setImageIndex(index: number): void;
  /** Moves `delta` images through the stack (clamped). */
  scrollBy(delta: number): void;
  /** Multiplies the current zoom by `factor`. */
  zoomBy(factor: number): void;
  /** Moves the image by canvas pixels. */
  panBy(dx: number, dy: number): void;
  /**
   * Changes window width and center by a number of steps. A step is a fixed fraction of
   * the current window width, so it scales with the image's value range.
   */
  adjustWindowLevel(widthSteps: number, centerSteps: number): void;
  /** Restores the initial zoom, pan and window/level. Keeps the current image. */
  resetView(): void;
  getViewportStatus(): ViewportStatus | undefined;
  /** Removes the displayed stack and releases decoded and cached data for it. */
  clear(): void;
  /** Releases every resource held by this renderer. The renderer is unusable afterwards. */
  destroy(): void;
}

export type CreateRenderer = (
  element: HTMLDivElement,
  config: RendererConfig,
  callbacks?: RendererCallbacks,
) => Promise<StackRenderer>;

// ── 3D layout ───────────────────────────────────────────────────────────────

export type VolumePlane = 'axial' | 'sagittal' | 'coronal';
export const VOLUME_PLANES: readonly VolumePlane[] = ['axial', 'sagittal', 'coronal'];
/** A cross-section, or `volume` for the rotatable 3D view. */
export type VolumeView = VolumePlane | 'volume';
export const VOLUME_VIEWS: readonly VolumeView[] = ['axial', 'sagittal', 'coronal', 'volume'];

export interface VolumeImage {
  file: Blob;
  /** One-based frame of a multi-frame file; undefined for single-frame files. */
  frame?: number;
}

export interface PlaneStatus {
  /** Zero-based slice index shown in this cross-section. */
  index: number;
  count: number;
}

/** Read-only description of the 3D layout. Holds no pixel or patient data. */
export interface VolumeStatus {
  planes: Record<VolumePlane, PlaneStatus>;
  /** Window of the cross-sections (they share one). */
  windowWidth?: number;
  windowCenter?: number;
  /** Zoom of each view relative to fit (1 = fit). */
  zoom: Record<VolumeView, number>;
  /** False when the 3D view is turned off or the browser cannot render it; cross-sections still work. */
  volumeRendering: boolean;
  /** True when the cross-sections are shown inverted. */
  invert?: boolean;
  /** Thick-slab rendering of the cross-sections. */
  slab?: VolumeSlab;
  /** True when the crosshairs may rotate the planes (oblique MPR). */
  oblique?: boolean;
  /** Name of the transfer-function preset of the 3D view. */
  volumePreset?: string;
  /**
   * Screen directions of each view in patient LPS coordinates: `right` and `down` on
   * screen, and `normal` pointing towards the viewer.
   */
  orientation?: Partial<Record<VolumeView, { right: [number, number, number]; down: [number, number, number]; normal: [number, number, number] }>>;
}

/** Thick-slab projection of the cross-sections. `none` shows thin slices. */
export type SlabMode = 'none' | 'avg' | 'mip' | 'minip';

export interface VolumeSlab {
  mode: SlabMode;
  /** Slab thickness in mm (ignored for `none`). */
  thickness: number;
}

/** 3D view styles offered to users, mapped to Cornerstone transfer-function presets. */
export const VOLUME_PRESETS = ['CT-Bone', 'CT-Soft-Tissue', 'CT-MIP', 'CT-Lung', 'CT-AAA', 'CT-Muscle'] as const;

export interface VolumeLoadProgress {
  processed: number;
  total: number;
}

export interface VolumeRenderer {
  /**
   * Builds a volume from the slices (in slice order) and shows it in every view.
   * Resolves once the whole volume has loaded and been drawn. Rejects with an
   * `AbortError` if `signal` aborts first.
   */
  showVolume(
    images: readonly VolumeImage[],
    signal: AbortSignal,
    onProgress?: (progress: VolumeLoadProgress) => void,
  ): Promise<void>;
  /** Binds `tool` to the primary button in the cross-sections. */
  setTool(tool: ViewerTool): void;
  setSliceIndex(plane: VolumePlane, index: number): void;
  scrollBy(plane: VolumePlane, delta: number): void;
  /**
   * Moves the linked position within a cross-section by whole voxels in screen
   * directions (`dx` right, `dy` down), which moves the other two cross-sections.
   */
  moveCrosshair(plane: VolumePlane, dx: number, dy: number): void;
  zoomBy(view: VolumeView, factor: number): void;
  panBy(view: VolumeView, dx: number, dy: number): void;
  /** Rotates the 3D view by degrees about the screen's vertical (`yaw`) and horizontal (`pitch`) axes. */
  rotateBy(yaw: number, pitch: number): void;
  /** Same step semantics as `StackRenderer.adjustWindowLevel`; applies to all cross-sections. */
  adjustWindowLevel(widthSteps: number, centerSteps: number): void;
  /**
   * Sets the window of every cross-section: a width and center, the file's own window
   * (`default`), or one computed from the voxel values (`auto`). Returns false when it
   * cannot be applied. Optional for custom renderers.
   */
  setWindow?(
    request: { width: number; center: number } | 'default' | 'auto',
    autoOptions?: { lowPercentile?: number; highPercentile?: number; ignoreBelow?: number },
  ): boolean;
  /** Inverts the grey scale of the cross-sections. Optional for custom renderers. */
  setInvert?(invert: boolean): void;
  /** Average, maximum or minimum intensity over a slab of the given thickness. Optional. */
  setSlab?(slab: VolumeSlab): void;
  /** Lets the crosshairs rotate the planes (true) or keeps them orthogonal (false). Optional. */
  setOblique?(oblique: boolean): void;
  /** Shows the crosshair reference lines while another tool is selected. Optional. */
  setCrosshairsVisible?(visible: boolean): void;
  /** Changes the look of the 3D view (a Cornerstone volume preset name). Optional. */
  setVolumePreset?(preset: string): void;
  /** Centres the cross-sections and restores zoom, pan, window/level and the 3D orientation. */
  resetView(): void;
  getStatus(): VolumeStatus | undefined;
  /** Removes the volume and releases its decoded, cached and GPU data. */
  clear(): void;
  destroy(): void;
}

export interface VolumeRendererCallbacks {
  /** Called (coalesced per task) when slices, window/level or cameras change. */
  onStatusChange?: (status: VolumeStatus | undefined) => void;
}

export type CreateVolumeRenderer = (
  elements: Record<VolumeView, HTMLDivElement>,
  config: RendererConfig,
  callbacks?: VolumeRendererCallbacks,
) => Promise<VolumeRenderer>;

async function importRenderer<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    // The rendering library failed to load or evaluate (for example a bundler misconfiguration).
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }
}

/** Default factory: loads Cornerstone only when the first series is displayed. */
export const createCornerstoneRenderer: CreateRenderer = async (element, config, callbacks) => {
  const module = await importRenderer(() => import('./cornerstoneRenderer'));
  return module.createCornerstoneStackRenderer(element, config, callbacks);
};

/** Default 3D factory: loads the volume code only when a series is first opened in 3D. */
export const createCornerstoneVolumeRenderer: CreateVolumeRenderer = async (elements, config, callbacks) => {
  const module = await importRenderer(() => import('./cornerstoneVolumeRenderer'));
  return module.createCornerstoneVolumeRenderer(elements, config, callbacks);
};
