import { cache, init as initCornerstoneCore, isCornerstoneInitialized } from '@cornerstonejs/core';
import { init as initDicomImageLoader, wadouri } from '@cornerstonejs/dicom-image-loader';
import {
  CrosshairsTool,
  PanTool,
  StackScrollTool,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool,
  addTool,
  init as initTools,
} from '@cornerstonejs/tools';

import { DicomViewerError } from './errors';
import type { RendererConfig } from './renderer';

/** Shared by the 2D and 3D renderers. */

/**
 * Crosshairs that move but never rotate or change slab thickness: oblique reformatting
 * is out of scope. Cornerstone only lets a click or line drag move a cross-section whose
 * reference line is "draggable/rotatable", so lines stay draggable while the rotation
 * handles are never hit-tested and are drawn with zero size.
 */
export class TranslateCrosshairsTool extends CrosshairsTool {
  static override toolName = 'MivoTranslateCrosshairs';

  override _getRotationHandleNearImagePoint(): null {
    return null;
  }
}

let initialization: Promise<void> | undefined;

/**
 * Initializes Cornerstone once per page. The first viewer's codec path and worker
 * count apply to every viewer on the page.
 */
export function ensureInitialized(config: RendererConfig): Promise<void> {
  initialization ??= (async () => {
    if (!isCornerstoneInitialized()) {
      initCornerstoneCore();
    }
    initDicomImageLoader({
      maxWebWorkers: config.maxWebWorkers,
      wasmBasePath: config.codecBasePath,
      // Cornerstone 5.19's default (naturalized) metadata path does not decode local
      // dicomfile: images. The dataset-based provider does, and its per-file cache is
      // what FileRegistry.release() unloads. Revisit when upgrading Cornerstone.
      useLegacyMetadataProvider: true,
    });
    initTools();
    for (const Tool of [WindowLevelTool, PanTool, ZoomTool, StackScrollTool, TranslateCrosshairsTool, TrackballRotateTool]) {
      addTool(Tool);
    }
  })().catch((error: unknown) => {
    initialization = undefined;
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  });
  return initialization;
}

export function classifyLoadError(error: unknown): DicomViewerError {
  const message = error instanceof Error ? error.message : String(error);
  if (/transfer syntax|no decoder|not supported/i.test(message)) {
    return new DicomViewerError('UNSUPPORTED_IMAGE', { cause: error });
  }
  return new DicomViewerError('IMAGE_LOAD_FAILED', { cause: error });
}

/** Removes decoded images from Cornerstone's cache. Their decache also releases the file datasets. */
export function releaseImages(imageIds: readonly string[]): void {
  for (const imageId of imageIds) {
    if (cache.getImageLoadObject(imageId)) {
      try {
        cache.removeImageLoadObject(imageId, { force: true });
      } catch {
        // Already evicted.
      }
    }
  }
}

interface RegisteredFile {
  /** `dicomfile:<n>`; the base of every image ID for this file. */
  baseImageId: string;
  /** `<n>`: the key of the file's parsed dataset in the loader's dataset cache. */
  datasetKey: string;
}

/**
 * Maps selected Blobs to `dicomfile:` image IDs and releases them again. A file is
 * registered once per registry, so repeated frames of a multi-frame file share it.
 */
export class FileRegistry {
  private readonly files = new Map<Blob, RegisteredFile>();

  private register(file: Blob): RegisteredFile {
    let entry = this.files.get(file);
    if (!entry) {
      const baseImageId = wadouri.fileManager.add(file);
      entry = { baseImageId, datasetKey: baseImageId.slice('dicomfile:'.length) };
      this.files.set(file, entry);
    }
    return entry;
  }

  /** Image ID of a whole file (frame undefined) or of one frame (one-based). */
  imageId(file: Blob, frame?: number): string {
    const { baseImageId } = this.register(file);
    return frame === undefined ? baseImageId : `${baseImageId}?frame=${frame}`;
  }

  /** Image IDs for every frame of a file. */
  imageIds(file: Blob, numberOfFrames: number): string[] {
    if (numberOfFrames <= 1) return [this.imageId(file)];
    return Array.from({ length: numberOfFrames }, (_, index) => this.imageId(file, index + 1));
  }

  /**
   * Reads and parses a file into the loader's dataset cache, so its metadata is available
   * synchronously (the volume loader needs every slice's geometry up front).
   */
  async loadDataset(file: Blob): Promise<void> {
    const entry = this.register(file);
    await wadouri.dataSetCacheManager.load(entry.datasetKey, wadouri.loadFileRequest, entry.baseImageId);
    if (this.files.get(file) !== entry) {
      // A FileReader already in flight can populate the cache after release().
      this.unloadDataset(entry.datasetKey);
    }
  }

  /**
   * Drops the parsed datasets and file registrations of every file in this registry.
   *
   * The loader reference-counts a dataset once per image load (so once per frame of a
   * multi-frame file), and not every frame load is released through image decache. The
   * key belongs to this registry alone (`fileManager.add` issues a fresh index per
   * registration), so the dataset is unloaded until it is gone.
   */
  release(imageIds: readonly string[] = []): void {
    const pendingKeys = new Set<string>();
    for (const imageId of imageIds) {
      if (!cache.getImageLoadObject(imageId)) continue;
      pendingKeys.add(wadouri.parseImageId(imageId).url);
    }
    releaseImages(imageIds);
    const { dataSetCacheManager } = wadouri;
    for (const entry of this.files.values()) {
      if (pendingKeys.has(entry.datasetKey) && !dataSetCacheManager.isLoaded(entry.datasetKey)) {
        // Join an existing read without starting one. A late read can populate
        // the dataset cache after Cornerstone's image cache entry is removed.
        void dataSetCacheManager.load(entry.datasetKey, () => Promise.reject(), entry.baseImageId)
          .then(() => this.unloadDataset(entry.datasetKey), () => undefined);
      }
      this.unloadDataset(entry.datasetKey);
      wadouri.fileManager.remove(Number.parseInt(entry.datasetKey, 10));
    }
    this.files.clear();
  }

  private unloadDataset(key: string): void {
    const { dataSetCacheManager } = wadouri;
    for (let guard = 0; dataSetCacheManager.isLoaded(key) && guard < 100_000; guard += 1) {
      dataSetCacheManager.unload(key);
    }
  }
}
