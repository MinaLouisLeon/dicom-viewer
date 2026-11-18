import { vi, type Mock } from 'vitest';

import { abortError } from '../src/core/errors';
import type {
  CreateRenderer,
  RendererCallbacks,
  StackImage,
  StackRenderer,
  ViewerTool,
  ViewportStatus,
} from '../src/core/renderer';

export interface FakeRenderer extends StackRenderer {
  shown: StackImage[][];
  /** Resolves the most recent pending showStack call. */
  finish(): void;
  /** Rejects the most recent pending showStack call. */
  failWith(error: unknown): void;
  /** Simulates a viewport change reported by the rendering library. */
  emit(patch: Partial<ViewportStatus>): void;
  status: ViewportStatus | undefined;
  setTool: Mock<(tool: ViewerTool) => void>;
  setImageIndex: Mock<(index: number) => void>;
  scrollBy: Mock<(delta: number) => void>;
  zoomBy: Mock<(factor: number) => void>;
  panBy: Mock<(dx: number, dy: number) => void>;
  adjustWindowLevel: Mock<(widthSteps: number, centerSteps: number) => void>;
  resetView: Mock<() => void>;
  clear: Mock<() => void>;
  destroy: Mock<() => void>;
}

/** A renderer whose showStack calls stay pending until the test settles them. */
export function createFakeRenderer(options: { autoFinish?: boolean } = {}): {
  renderer: FakeRenderer;
  createRenderer: Mock<CreateRenderer>;
} {
  let pending: { resolve: () => void; reject: (error: unknown) => void } | undefined;
  let callbacks: RendererCallbacks = {};
  const renderer: FakeRenderer = {
    shown: [],
    status: undefined,
    showStack: (images, signal) =>
      new Promise<void>((resolve, reject) => {
        renderer.shown.push([...images]);
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
        const succeed = () => {
          const imageCount = images.reduce((sum, image) => sum + image.numberOfFrames, 0);
          renderer.status = { imageIndex: 0, imageCount, windowWidth: 400, windowCenter: 40, zoom: 1, imageFailed: false };
          resolve();
        };
        if (options.autoFinish) succeed();
        else pending = { resolve: succeed, reject };
      }),
    finish: () => pending?.resolve(),
    failWith: (error) => pending?.reject(error),
    emit: (patch) => {
      renderer.status = { ...renderer.status!, ...patch };
      callbacks.onViewportChange?.(renderer.status);
    },
    getViewportStatus: () => renderer.status,
    setTool: vi.fn<(tool: ViewerTool) => void>(),
    setImageIndex: vi.fn<(index: number) => void>(),
    scrollBy: vi.fn<(delta: number) => void>(),
    zoomBy: vi.fn<(factor: number) => void>(),
    panBy: vi.fn<(dx: number, dy: number) => void>(),
    adjustWindowLevel: vi.fn<(widthSteps: number, centerSteps: number) => void>(),
    resetView: vi.fn<() => void>(),
    clear: vi.fn<() => void>(() => {
      renderer.status = undefined;
    }),
    destroy: vi.fn<() => void>(),
  };
  const createRenderer = vi.fn<CreateRenderer>(async (_element, _config, rendererCallbacks) => {
    callbacks = rendererCallbacks ?? {};
    return renderer;
  });
  return { renderer, createRenderer };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
