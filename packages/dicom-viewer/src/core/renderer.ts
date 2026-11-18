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

export interface StackImage {
  file: Blob;
  /** Number of frames in the file. Multi-frame files contribute one image per frame. */
  numberOfFrames: number;
}

export interface StackRenderer {
  /**
   * Displays the images as a stack and resolves once the first image is rendered.
   * Rejects with an `AbortError` if `signal` aborts first.
   */
  showStack(images: readonly StackImage[], signal: AbortSignal): Promise<void>;
  /** Removes the displayed stack and releases decoded and cached data for it. */
  clear(): void;
  /** Releases every resource held by this renderer. The renderer is unusable afterwards. */
  destroy(): void;
}

export type CreateRenderer = (element: HTMLDivElement, config: RendererConfig) => Promise<StackRenderer>;

/** Default factory: loads Cornerstone only when the first series is displayed. */
export const createCornerstoneRenderer: CreateRenderer = async (element, config) => {
  let module: typeof import('./cornerstoneRenderer');
  try {
    module = await import('./cornerstoneRenderer');
  } catch (error) {
    // The rendering library failed to load or evaluate (for example a bundler misconfiguration).
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }
  return module.createCornerstoneStackRenderer(element, config);
};
