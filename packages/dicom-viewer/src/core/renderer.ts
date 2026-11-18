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
}

/** What the primary mouse button (and the arrow keys) do in the image viewport. */
export type ViewerTool = 'windowLevel' | 'pan' | 'zoom' | 'scroll';

export const VIEWER_TOOLS: readonly ViewerTool[] = ['windowLevel', 'pan', 'zoom', 'scroll'];

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

/** Default factory: loads Cornerstone only when the first series is displayed. */
export const createCornerstoneRenderer: CreateRenderer = async (element, config, callbacks) => {
  let module: typeof import('./cornerstoneRenderer');
  try {
    module = await import('./cornerstoneRenderer');
  } catch (error) {
    // The rendering library failed to load or evaluate (for example a bundler misconfiguration).
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }
  return module.createCornerstoneStackRenderer(element, config, callbacks);
};
