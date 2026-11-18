import {
  Enums,
  RenderingEngine,
  cache,
  imageLoader,
  init as initCornerstoneCore,
  isCornerstoneInitialized,
  type Types,
} from '@cornerstonejs/core';
import { init as initDicomImageLoader, wadouri } from '@cornerstonejs/dicom-image-loader';

import { DicomViewerError, abortError, throwIfAborted } from './errors';
import type { RendererConfig, StackImage, StackRenderer } from './renderer';

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
  })().catch((error: unknown) => {
    initialization = undefined;
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  });
  return initialization;
}

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

export async function createCornerstoneStackRenderer(
  element: HTMLDivElement,
  config: RendererConfig,
): Promise<StackRenderer> {
  await ensureInitialized(config);

  instanceCounter += 1;
  const engineId = `mivo-dv-engine-${instanceCounter}`;
  const viewportId = `mivo-dv-stack-${instanceCounter}`;
  let engine: RenderingEngine | undefined;
  try {
    engine = new RenderingEngine(engineId);
    engine.enableElement({ viewportId, type: Enums.ViewportType.STACK, element });
  } catch (error) {
    engine?.destroy();
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }

  const files = new Map<Blob, RegisteredFile>();
  let displayedImageIds: string[] = [];
  let destroyed = false;

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (!destroyed) engine?.resize(true, true);
        });
  resizeObserver?.observe(element);

  const getViewport = (): Types.IStackViewport =>
    engine!.getViewport(viewportId) as Types.IStackViewport;

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
    releaseImages(displayedImageIds);
    displayedImageIds = [];
    releaseFiles();
    try {
      // Detach the previous stack so the canvas no longer shows released pixels.
      engine?.disableElement(viewportId);
      engine?.enableElement({ viewportId, type: Enums.ViewportType.STACK, element });
    } catch {
      // Element already detached.
    }
  };

  return {
    async showStack(images: readonly StackImage[], signal: AbortSignal): Promise<void> {
      if (destroyed) throw abortError();
      throwIfAborted(signal);
      clear();

      const imageIds = images.flatMap((image) => imageIdsFor(register(image.file), image.numberOfFrames));
      displayedImageIds = imageIds;
      if (imageIds.length === 0) throw new DicomViewerError('NO_DICOM_FILES');

      const aborted = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(abortError());
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
      aborted.catch(() => undefined);

      try {
        // Load the first image explicitly: setStack does not reject when decoding fails.
        await Promise.race([imageLoader.loadAndCacheImage(imageIds[0]!), aborted]);
        await Promise.race([getViewport().setStack(imageIds, 0), aborted]);
        if (!getViewport().getCornerstoneImage()) throw new Error('Image not displayed');
      } catch (error) {
        throwIfAborted(signal);
        throw classifyLoadError(error);
      }
      throwIfAborted(signal);
      getViewport().render();
    },

    clear,

    destroy(): void {
      if (destroyed) return;
      clear();
      destroyed = true;
      resizeObserver?.disconnect();
      engine?.destroy();
      engine = undefined;
    },
  };
}
