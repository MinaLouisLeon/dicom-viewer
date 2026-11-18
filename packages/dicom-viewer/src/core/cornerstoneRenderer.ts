import {
  Enums,
  RenderingEngine,
  cache,
  eventTarget,
  imageLoader,
  init as initCornerstoneCore,
  isCornerstoneInitialized,
  utilities,
  type Types,
} from '@cornerstonejs/core';
import { init as initDicomImageLoader, wadouri } from '@cornerstonejs/dicom-image-loader';
import {
  Enums as ToolEnums,
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  addTool,
  init as initTools,
} from '@cornerstonejs/tools';

import { DicomViewerError, abortError, throwIfAborted } from './errors';
import type {
  RendererCallbacks,
  RendererConfig,
  StackImage,
  StackRenderer,
  ViewerTool,
  ViewportStatus,
} from './renderer';

let initialization: Promise<void> | undefined;

/**
 * Initializes Cornerstone once per page. The first viewer's codec path and worker
 * count apply to every viewer on the page.
 */
function ensureInitialized(config: RendererConfig): Promise<void> {
  initialization ??= (async () => {
    if (!isCornerstoneInitialized()) {
      initCornerstoneCore();
    }
    initDicomImageLoader({
      maxWebWorkers: config.maxWebWorkers,
      wasmBasePath: config.codecBasePath,
      // Cornerstone 5.19's default (naturalized) metadata path does not decode local
      // dicomfile: images. The dataset-based provider does, and its per-file cache is
      // what releaseFiles() unloads. Revisit when upgrading Cornerstone.
      useLegacyMetadataProvider: true,
    });
    initTools();
    for (const Tool of [WindowLevelTool, PanTool, ZoomTool, StackScrollTool]) addTool(Tool);
  })().catch((error: unknown) => {
    initialization = undefined;
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  });
  return initialization;
}

const TOOL_NAMES: Record<ViewerTool, string> = {
  windowLevel: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  scroll: StackScrollTool.toolName,
};

const PRIMARY_BINDING = { mouseButton: ToolEnums.MouseBindings.Primary };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 40;
/** Window/level keyboard step as a fraction of the current window width. */
const WINDOW_STEP_FRACTION = 0.05;
/** Longest wait for the first frame after the image has decoded. */
const FIRST_FRAME_TIMEOUT_MS = 2000;

/** Element events after which the viewport status may have changed. */
const STATUS_EVENTS = [
  Enums.Events.PRE_STACK_NEW_IMAGE,
  Enums.Events.STACK_NEW_IMAGE,
  Enums.Events.VOI_MODIFIED,
  Enums.Events.CAMERA_MODIFIED,
] as const;

let instanceCounter = 0;

interface RegisteredFile {
  index: number;
  baseImageId: string;
}

function parseFileIndex(baseImageId: string): number {
  return Number.parseInt(baseImageId.slice('dicomfile:'.length), 10);
}

function imageIdsFor(file: RegisteredFile, numberOfFrames: number): string[] {
  if (numberOfFrames <= 1) return [file.baseImageId];
  return Array.from({ length: numberOfFrames }, (_, frame) => `${file.baseImageId}?frame=${frame + 1}`);
}

function classifyLoadError(error: unknown): DicomViewerError {
  const message = error instanceof Error ? error.message : String(error);
  if (/transfer syntax|no decoder|not supported/i.test(message)) {
    return new DicomViewerError('UNSUPPORTED_IMAGE', { cause: error });
  }
  return new DicomViewerError('IMAGE_LOAD_FAILED', { cause: error });
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export async function createCornerstoneStackRenderer(
  element: HTMLDivElement,
  config: RendererConfig,
  callbacks: RendererCallbacks = {},
): Promise<StackRenderer> {
  await ensureInitialized(config);

  instanceCounter += 1;
  const engineId = `mivo-dv-engine-${instanceCounter}`;
  const viewportId = `mivo-dv-stack-${instanceCounter}`;
  const toolGroupId = `mivo-dv-tools-${instanceCounter}`;
  let engine: RenderingEngine | undefined;
  try {
    engine = new RenderingEngine(engineId);
    engine.enableElement({ viewportId, type: Enums.ViewportType.STACK, element });
  } catch (error) {
    engine?.destroy();
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  // Fixed bindings: wheel scrolls, right-drag zooms, middle-drag pans. The selected
  // tool additionally owns the primary button.
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
  if (!toolGroup) {
    engine.destroy();
    throw new DicomViewerError('RENDERER_INIT_FAILED');
  }
  for (const name of Object.values(TOOL_NAMES)) toolGroup.addTool(name);
  toolGroup.setToolActive(TOOL_NAMES.scroll, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] });
  toolGroup.setToolActive(TOOL_NAMES.zoom, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
  toolGroup.setToolActive(TOOL_NAMES.pan, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });
  toolGroup.addViewport(viewportId, engineId);
  let primaryTool: ViewerTool | undefined;

  const setTool = (tool: ViewerTool): void => {
    if (tool === primaryTool) return;
    // Passive mode removes only the primary binding, so the fixed bindings above stay.
    if (primaryTool) toolGroup.setToolPassive(TOOL_NAMES[primaryTool]);
    toolGroup.setToolActive(TOOL_NAMES[tool], { bindings: [PRIMARY_BINDING] });
    primaryTool = tool;
  };
  setTool('windowLevel');

  // ── State ─────────────────────────────────────────────────────────────────
  const files = new Map<Blob, RegisteredFile>();
  let displayedImageIds: string[] = [];
  let imageIndexById = new Map<string, number>();
  const failedIndices = new Set<number>();
  /** True once the first image of the current stack is on screen. */
  let shown = false;
  let destroyed = false;

  const getViewport = (): Types.IStackViewport | undefined =>
    engine?.getViewport(viewportId) as Types.IStackViewport | undefined;

  const getViewportStatus = (): ViewportStatus | undefined => {
    const viewport = getViewport();
    if (!shown || !viewport || displayedImageIds.length === 0) return undefined;
    const imageIndex = viewport.getCurrentImageIdIndex();
    const { voiRange } = viewport.getProperties();
    // Report DICOM window width/center (the values in the file's header), not the raw range.
    const windowLevel = voiRange ? utilities.windowLevel.toWindowLevel(voiRange.lower, voiRange.upper) : undefined;
    return {
      imageIndex,
      imageCount: displayedImageIds.length,
      windowWidth: windowLevel?.windowWidth,
      windowCenter: windowLevel?.windowCenter,
      zoom: viewport.getZoom(),
      imageFailed: failedIndices.has(imageIndex),
    };
  };

  // Coalesce the bursts of events one interaction produces (a drag step fires several).
  // A microtask rather than an animation frame: frames are throttled in occluded windows,
  // which would leave the slice position and readout behind the user's input.
  let statusQueued = false;
  const scheduleStatus = (): void => {
    if (!callbacks.onViewportChange || statusQueued || destroyed) return;
    statusQueued = true;
    queueMicrotask(() => {
      statusQueued = false;
      if (!destroyed) callbacks.onViewportChange?.(getViewportStatus());
    });
  };

  const onImageLoadFailed = (event: Event): void => {
    const { imageId } = (event as CustomEvent<{ imageId?: string }>).detail ?? {};
    const index = imageId === undefined ? undefined : imageIndexById.get(imageId);
    if (index === undefined) return;
    failedIndices.add(index);
    scheduleStatus();
  };

  for (const name of STATUS_EVENTS) element.addEventListener(name, scheduleStatus);
  eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, onImageLoadFailed);

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (!destroyed) engine?.resize(true, true);
        });
  resizeObserver?.observe(element);

  // ── Resource release ──────────────────────────────────────────────────────
  const releaseImages = (imageIds: readonly string[]): void => {
    for (const imageId of imageIds) {
      if (cache.getImageLoadObject(imageId)) {
        try {
          cache.removeImageLoadObject(imageId, { force: true });
        } catch {
          // Already evicted.
        }
      }
    }
  };

  const releaseFiles = (): void => {
    for (const file of files.values()) {
      wadouri.dataSetCacheManager.unload(file.baseImageId);
      wadouri.fileManager.remove(file.index);
    }
    files.clear();
  };

  const register = (file: Blob): RegisteredFile => {
    const existing = files.get(file);
    if (existing) return existing;
    const baseImageId = wadouri.fileManager.add(file);
    const registered = { index: parseFileIndex(baseImageId), baseImageId };
    files.set(file, registered);
    return registered;
  };

  const clear = (): void => {
    if (destroyed) return;
    const hadStack = shown;
    shown = false;
    releaseImages(displayedImageIds);
    displayedImageIds = [];
    imageIndexById = new Map();
    failedIndices.clear();
    releaseFiles();
    try {
      // Detach the previous stack so the canvas no longer shows released pixels.
      engine?.disableElement(viewportId);
      engine?.enableElement({ viewportId, type: Enums.ViewportType.STACK, element });
      toolGroup.addViewport(viewportId, engineId);
    } catch {
      // Element already detached.
    }
    if (hadStack) callbacks.onViewportChange?.(undefined);
  };

  /** Resolves on the next rendered frame, or after a timeout if rendering is skipped. */
  const nextFrame = (): { promise: Promise<void>; dispose: () => void } => {
    let dispose = () => undefined as void;
    const promise = new Promise<void>((resolve) => {
      const done = () => {
        dispose();
        resolve();
      };
      const timer = setTimeout(done, FIRST_FRAME_TIMEOUT_MS);
      element.addEventListener(Enums.Events.IMAGE_RENDERED, done);
      dispose = () => {
        clearTimeout(timer);
        element.removeEventListener(Enums.Events.IMAGE_RENDERED, done);
      };
    });
    return { promise, dispose };
  };

  const setImageIndex = (index: number): void => {
    const viewport = getViewport();
    if (destroyed || !shown || !viewport) return;
    const target = clamp(Math.round(index), 0, displayedImageIds.length - 1);
    if (target === viewport.getCurrentImageIdIndex()) return;
    // Failures surface through IMAGE_LOAD_FAILED and the status' imageFailed flag.
    viewport.setImageIdIndex(target).catch(() => undefined);
  };

  /** Runs a view operation on the displayed stack, then redraws. */
  const withViewport = (operation: (viewport: Types.IStackViewport) => void): void => {
    const viewport = getViewport();
    if (destroyed || !shown || !viewport) return;
    operation(viewport);
    viewport.render();
  };

  return {
    async showStack(images: readonly StackImage[], signal: AbortSignal): Promise<void> {
      if (destroyed) throw abortError();
      throwIfAborted(signal);
      clear();

      const imageIds = images.flatMap((image) => imageIdsFor(register(image.file), image.numberOfFrames));
      displayedImageIds = imageIds;
      imageIndexById = new Map(imageIds.map((imageId, index) => [imageId, index]));
      if (imageIds.length === 0) throw new DicomViewerError('NO_DICOM_FILES');

      const aborted = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(abortError());
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
      aborted.catch(() => undefined);

      const firstFrame = nextFrame();
      try {
        // Load the first image explicitly: setStack does not reject when decoding fails.
        await Promise.race([imageLoader.loadAndCacheImage(imageIds[0]!), aborted]);
        const viewport = getViewport();
        if (!viewport) throw abortError();
        await Promise.race([viewport.setStack(imageIds, 0), aborted]);
        if (!viewport.getCornerstoneImage()) throw new Error('Image not displayed');
        viewport.render();
        // Report success only once pixels are on screen, not when decoding finishes.
        await Promise.race([firstFrame.promise, aborted]);
      } catch (error) {
        throwIfAborted(signal);
        throw classifyLoadError(error);
      } finally {
        firstFrame.dispose();
      }
      throwIfAborted(signal);
      shown = true;
      scheduleStatus();
    },

    setTool,

    setImageIndex,

    scrollBy(delta: number): void {
      const viewport = getViewport();
      if (destroyed || !shown || !viewport || delta === 0) return;
      setImageIndex(viewport.getCurrentImageIdIndex() + delta);
    },

    zoomBy(factor: number): void {
      withViewport((viewport) => viewport.setZoom(clamp(viewport.getZoom() * factor, MIN_ZOOM, MAX_ZOOM)));
    },

    panBy(dx: number, dy: number): void {
      withViewport((viewport) => {
        const [x, y] = viewport.getPan();
        viewport.setPan([x + dx, y + dy]);
      });
    },

    adjustWindowLevel(widthSteps: number, centerSteps: number): void {
      withViewport((viewport) => {
        const { voiRange } = viewport.getProperties();
        if (!voiRange) return;
        const { windowWidth, windowCenter } = utilities.windowLevel.toWindowLevel(voiRange.lower, voiRange.upper);
        const step = Math.max(1, windowWidth * WINDOW_STEP_FRACTION);
        const nextWidth = Math.max(2, windowWidth + widthSteps * step);
        const nextCenter = windowCenter + centerSteps * step;
        viewport.setProperties({ voiRange: utilities.windowLevel.toLowHighRange(nextWidth, nextCenter) });
      });
    },

    resetView(): void {
      withViewport((viewport) => {
        viewport.resetCamera();
        viewport.resetProperties();
      });
    },

    getViewportStatus,

    clear,

    destroy(): void {
      if (destroyed) return;
      clear();
      destroyed = true;
      for (const name of STATUS_EVENTS) element.removeEventListener(name, scheduleStatus);
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, onImageLoadFailed);
      resizeObserver?.disconnect();
      ToolGroupManager.destroyToolGroup(toolGroupId);
      engine?.destroy();
      engine = undefined;
    },
  };
}
