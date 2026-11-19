import { vi, type Mock } from 'vitest';

import { abortError } from '@mihawksolutions/dicom-viewer/internal';
import type {
  CreateRenderer,
  CreateVolumeRenderer,
  RendererCallbacks,
  StackImage,
  StackRenderer,
  ViewerTool,
  ViewportStatus,
  VolumeImage,
  VolumeLoadProgress,
  VolumePlane,
  VolumeRenderer,
  VolumeRendererCallbacks,
  VolumeStatus,
  VolumeView,
} from '@mihawksolutions/dicom-viewer/internal';

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

export interface FakeVolumeRenderer extends VolumeRenderer {
  shown: VolumeImage[][];
  /** Resolves the most recent pending showVolume call. */
  finish(): void;
  failWith(error: unknown): void;
  /** Reports load progress for the pending showVolume call. */
  progress(processed: number, total: number): void;
  emit(patch: Partial<VolumeStatus>): void;
  status: VolumeStatus | undefined;
  setTool: Mock<(tool: ViewerTool) => void>;
  setSliceIndex: Mock<(plane: VolumePlane, index: number) => void>;
  scrollBy: Mock<(plane: VolumePlane, delta: number) => void>;
  moveCrosshair: Mock<(plane: VolumePlane, dx: number, dy: number) => void>;
  zoomBy: Mock<(view: VolumeView, factor: number) => void>;
  panBy: Mock<(view: VolumeView, dx: number, dy: number) => void>;
  rotateBy: Mock<(yaw: number, pitch: number) => void>;
  adjustWindowLevel: Mock<(widthSteps: number, centerSteps: number) => void>;
  resetView: Mock<() => void>;
  setSlab: Mock<NonNullable<VolumeRenderer['setSlab']>>;
  setOblique: Mock<(oblique: boolean) => void>;
  setVolumePreset: Mock<(preset: string) => void>;
  setCrosshairsVisible: Mock<(visible: boolean) => void>;
  clear: Mock<() => void>;
  destroy: Mock<() => void>;
}

export function volumeStatusFor(slices: number, volumeRendering = true): VolumeStatus {
  return {
    planes: {
      axial: { index: Math.floor(slices / 2), count: slices },
      sagittal: { index: 48, count: 96 },
      coronal: { index: 48, count: 96 },
    },
    windowWidth: 2000,
    windowCenter: 400,
    zoom: { axial: 1, sagittal: 1, coronal: 1, volume: 1 },
    volumeRendering,
  };
}

/** A volume renderer whose showVolume calls stay pending until the test settles them. */
export function createFakeVolumeRenderer(options: { autoFinish?: boolean; volumeRendering?: boolean } = {}): {
  renderer: FakeVolumeRenderer;
  createVolumeRenderer: Mock<CreateVolumeRenderer>;
} {
  let pending:
    | { resolve: () => void; reject: (error: unknown) => void; onProgress?: (p: VolumeLoadProgress) => void }
    | undefined;
  let callbacks: VolumeRendererCallbacks = {};
  const renderer: FakeVolumeRenderer = {
    shown: [],
    status: undefined,
    showVolume: (images, signal, onProgress) =>
      new Promise<void>((resolve, reject) => {
        renderer.shown.push([...images]);
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
        const succeed = () => {
          renderer.status = volumeStatusFor(images.length, options.volumeRendering ?? true);
          resolve();
        };
        if (options.autoFinish) succeed();
        else pending = { resolve: succeed, reject, onProgress };
      }),
    finish: () => pending?.resolve(),
    failWith: (error) => pending?.reject(error),
    progress: (processed, total) => pending?.onProgress?.({ processed, total }),
    emit: (patch) => {
      renderer.status = { ...renderer.status!, ...patch };
      callbacks.onStatusChange?.(renderer.status);
    },
    getStatus: () => renderer.status,
    setTool: vi.fn<(tool: ViewerTool) => void>(),
    setSliceIndex: vi.fn<(plane: VolumePlane, index: number) => void>(),
    scrollBy: vi.fn<(plane: VolumePlane, delta: number) => void>(),
    moveCrosshair: vi.fn<(plane: VolumePlane, dx: number, dy: number) => void>(),
    zoomBy: vi.fn<(view: VolumeView, factor: number) => void>(),
    panBy: vi.fn<(view: VolumeView, dx: number, dy: number) => void>(),
    rotateBy: vi.fn<(yaw: number, pitch: number) => void>(),
    adjustWindowLevel: vi.fn<(widthSteps: number, centerSteps: number) => void>(),
    resetView: vi.fn<() => void>(),
    setSlab: vi.fn<NonNullable<VolumeRenderer['setSlab']>>(),
    setOblique: vi.fn<(oblique: boolean) => void>(),
    setVolumePreset: vi.fn<(preset: string) => void>(),
    setCrosshairsVisible: vi.fn<(visible: boolean) => void>(),
    clear: vi.fn<() => void>(() => {
      renderer.status = undefined;
    }),
    destroy: vi.fn<() => void>(),
  };
  const createVolumeRenderer = vi.fn<CreateVolumeRenderer>(async (_elements, _config, rendererCallbacks) => {
    callbacks = rendererCallbacks ?? {};
    return renderer;
  });
  return { renderer, createVolumeRenderer };
}
