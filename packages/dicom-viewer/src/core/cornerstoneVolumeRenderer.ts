import {
  Enums,
  RenderingEngine,
  cache,
  eventTarget,
  metaData,
  setVolumesForViewports,
  utilities,
  volumeLoader,
  type Types,
} from '@cornerstonejs/core';
import {
  Enums as ToolEnums,
  PanTool,
  StackScrollTool,
  SynchronizerManager,
  ToolGroupManager,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool,
  synchronizers,
} from '@cornerstonejs/tools';

import {
  FileRegistry,
  TranslateCrosshairsTool,
  classifyLoadError,
  ensureInitialized,
  releaseImages,
} from './cornerstoneSetup';
import { DicomViewerError, abortError, throwIfAborted } from './errors';
import {
  DEFAULT_MAX_VOLUME_BYTES,
  VOLUME_PLANES,
  type PlaneStatus,
  type RendererConfig,
  type ViewerTool,
  type VolumeImage,
  type VolumeLoadProgress,
  type VolumePlane,
  type VolumeRenderer,
  type VolumeRendererCallbacks,
  type VolumeStatus,
  type VolumeView,
} from './renderer';

type Vec3 = Types.Point3;
type ToolGroup = NonNullable<ReturnType<typeof ToolGroupManager.createToolGroup>>;

const ORIENTATIONS: Record<VolumePlane, Enums.OrientationAxis> = {
  axial: Enums.OrientationAxis.AXIAL,
  sagittal: Enums.OrientationAxis.SAGITTAL,
  coronal: Enums.OrientationAxis.CORONAL,
};

/** Colour of each cross-section's reference line, matched by the pane labels in the stylesheet. */
const PLANE_COLORS: Record<VolumePlane, string> = {
  axial: 'rgb(230, 80, 80)',
  sagittal: 'rgb(230, 200, 60)',
  coronal: 'rgb(80, 200, 110)',
};

const TOOL_NAMES: Record<ViewerTool, string> = {
  windowLevel: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  scroll: StackScrollTool.toolName,
  crosshairs: TranslateCrosshairsTool.toolName,
};

const PRIMARY_BINDING = { mouseButton: ToolEnums.MouseBindings.Primary };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 40;
const WINDOW_STEP_FRACTION = 0.05;
const VOLUME_PRESET = 'CT-Bone';
/** Files read in parallel while collecting slice headers. */
const READ_CONCURRENCY = 4;
const FIRST_FRAME_TIMEOUT_MS = 2000;

const STATUS_EVENTS = [
  Enums.Events.CAMERA_MODIFIED,
  Enums.Events.VOI_MODIFIED,
  Enums.Events.VOLUME_NEW_IMAGE,
] as const;

let instanceCounter = 0;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1;
  return scale(a, 1 / length);
};

/** Rodrigues rotation of `v` about unit `axis` by `radians`. */
function rotate(v: Vec3, axis: Vec3, radians: number): Vec3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return add(add(scale(v, cos), scale(cross(axis, v), sin)), scale(axis, dot(axis, v) * (1 - cos)));
}

function bytesPerVoxel(imageId: string): number {
  const pixel = metaData.get('imagePixelModule', imageId) as { bitsAllocated?: number } | undefined;
  const scaling = metaData.get('modalityLutModule', imageId) as
    | { rescaleSlope?: number; rescaleIntercept?: number }
    | undefined;
  const fractional =
    scaling !== undefined &&
    (!Number.isInteger(scaling.rescaleSlope ?? 1) || !Number.isInteger(scaling.rescaleIntercept ?? 0));
  if (fractional) return 4;
  return Math.max(1, Math.ceil((pixel?.bitsAllocated ?? 16) / 8));
}

/**
 * Points a 3D camera at the patient's face: viewed from anterior (−y in LPS) with
 * superior up, then refits the zoom (resetCamera keeps the orientation).
 */
function faceAnterior(viewport: Types.IVolumeViewport): void {
  const { focalPoint, position } = viewport.getCamera();
  if (!focalPoint || !position) return;
  const distance = Math.hypot(...sub(position, focalPoint)) || 1;
  viewport.setCamera({
    focalPoint,
    position: [focalPoint[0], focalPoint[1] - distance, focalPoint[2]],
    viewUp: [0, 0, 1],
  });
  viewport.resetCamera();
}

/** Runs `task` over `items` with at most `limit` in flight, stopping on abort. */
async function runBounded<T>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      throwIfAborted(signal);
      const item = items[next++]!;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  throwIfAborted(signal);
}

export async function createCornerstoneVolumeRenderer(
  elements: Record<VolumeView, HTMLDivElement>,
  config: RendererConfig,
  callbacks: VolumeRendererCallbacks = {},
): Promise<VolumeRenderer> {
  await ensureInitialized(config);

  instanceCounter += 1;
  const id = instanceCounter;
  const engineId = `mivo-dv-volume-engine-${id}`;
  const viewportIds: Record<VolumeView, string> = {
    axial: `mivo-dv-axial-${id}`,
    sagittal: `mivo-dv-sagittal-${id}`,
    coronal: `mivo-dv-coronal-${id}`,
    volume: `mivo-dv-volume-${id}`,
  };
  const planeByViewportId = new Map(VOLUME_PLANES.map((plane) => [viewportIds[plane], plane]));
  const mprGroupId = `mivo-dv-mpr-tools-${id}`;
  const volumeGroupId = `mivo-dv-3d-tools-${id}`;
  const voiSyncId = `mivo-dv-voi-sync-${id}`;
  const maxVolumeBytes = config.maxVolumeBytes ?? DEFAULT_MAX_VOLUME_BYTES;
  const wantVolumeRendering = config.volumeRendering !== false;

  let engine: RenderingEngine | undefined;
  try {
    engine = new RenderingEngine(engineId);
  } catch (error) {
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let mprGroup: ToolGroup | undefined;
  let volumeGroup: ToolGroup | undefined;
  let primaryTool: ViewerTool = 'crosshairs';
  /** Whether the 3D view exists for the current volume. */
  let volumeRendering = false;
  let files = new FileRegistry();
  let volumeId: string | undefined;
  let volumeImageIds: string[] = [];
  let volumeGeneration = 0;
  /**
   * Camera of the 3D view right after the volume was set. Cornerstone's resetCamera on a
   * 3D viewport refits zoom but keeps the rotation, so reset restores this instead.
   */
  let initialVolumeCamera: Types.ICamera | undefined;
  let shown = false;
  let destroyed = false;

  const getViewport = (view: VolumeView): Types.IViewport | undefined => engine?.getViewport(viewportIds[view]);
  const getVolumeViewport = (view: VolumeView) => getViewport(view) as Types.IVolumeViewport | undefined;
  const getPlane = (plane: VolumePlane) => getVolumeViewport(plane);
  const presentViews = (): VolumeView[] => (volumeRendering ? [...VOLUME_PLANES, 'volume'] : [...VOLUME_PLANES]);

  // ── Viewports and tools ───────────────────────────────────────────────────

  const applyPrimaryTool = (): void => {
    if (!mprGroup) return;
    for (const tool of Object.keys(TOOL_NAMES) as ViewerTool[]) {
      if (tool !== primaryTool && mprGroup.getToolOptions(TOOL_NAMES[tool])?.bindings?.some((b) => b.mouseButton === PRIMARY_BINDING.mouseButton)) {
        mprGroup.setToolPassive(TOOL_NAMES[tool]);
      }
    }
    mprGroup.setToolActive(TOOL_NAMES[primaryTool], { bindings: [PRIMARY_BINDING] });
  };

  /** Creates the viewports and their tool groups. `withVolume` adds the 3D view. */
  const enableViewports = (withVolume: boolean): void => {
    if (!engine) return;
    const inputs: Types.PublicViewportInput[] = VOLUME_PLANES.map((plane) => ({
      viewportId: viewportIds[plane],
      type: Enums.ViewportType.ORTHOGRAPHIC,
      element: elements[plane],
      defaultOptions: { orientation: ORIENTATIONS[plane], background: [0, 0, 0] as Types.Point3 },
    }));
    if (withVolume) {
      inputs.push({
        viewportId: viewportIds.volume,
        type: Enums.ViewportType.VOLUME_3D,
        element: elements.volume,
        defaultOptions: { background: [0, 0, 0] as Types.Point3 },
      });
    }
    engine.setViewports(inputs);

    const group = ToolGroupManager.createToolGroup(mprGroupId);
    if (!group) throw new DicomViewerError('RENDERER_INIT_FAILED');
    mprGroup = group;
    group.addTool(WindowLevelTool.toolName);
    group.addTool(PanTool.toolName);
    group.addTool(ZoomTool.toolName);
    group.addTool(StackScrollTool.toolName);
    group.addTool(TranslateCrosshairsTool.toolName, {
      getReferenceLineColor: (viewportId: string) =>
        PLANE_COLORS[planeByViewportId.get(viewportId) ?? 'axial'],
      getReferenceLineControllable: () => true,
      // Required for click-to-jump and line dragging; rotation itself is disabled by the tool.
      getReferenceLineDraggableRotatable: () => true,
      getReferenceLineSlabThicknessControlsOn: () => false,
      handleRadius: 0,
      mobile: { enabled: false },
    });
    for (const plane of VOLUME_PLANES) group.addViewport(viewportIds[plane], engineId);
    group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] });
    group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
    group.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });
    applyPrimaryTool();

    const voiSync = synchronizers.createVOISynchronizer(voiSyncId, { syncInvertState: false, syncColormap: false });
    for (const plane of VOLUME_PLANES) voiSync.add({ renderingEngineId: engineId, viewportId: viewportIds[plane] });

    if (withVolume) {
      const group3d = ToolGroupManager.createToolGroup(volumeGroupId);
      if (!group3d) throw new DicomViewerError('RENDERER_INIT_FAILED');
      volumeGroup = group3d;
      group3d.addTool(TrackballRotateTool.toolName);
      group3d.addTool(ZoomTool.toolName);
      group3d.addTool(PanTool.toolName);
      group3d.addViewport(viewportIds.volume, engineId);
      group3d.setToolActive(TrackballRotateTool.toolName, { bindings: [PRIMARY_BINDING] });
      group3d.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }, { mouseButton: ToolEnums.MouseBindings.Wheel }],
      });
      group3d.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });
    }
  };

  const disableViewports = (): void => {
    SynchronizerManager.destroySynchronizer(voiSyncId);
    ToolGroupManager.destroyToolGroup(mprGroupId);
    ToolGroupManager.destroyToolGroup(volumeGroupId);
    mprGroup = undefined;
    volumeGroup = undefined;
    for (const viewportId of Object.values(viewportIds)) {
      try {
        if (engine?.getViewport(viewportId)) engine.disableElement(viewportId);
      } catch {
        // Already detached.
      }
    }
  };

  // ── Status ────────────────────────────────────────────────────────────────

  const planeStatus = (plane: VolumePlane): PlaneStatus => {
    const viewport = getPlane(plane);
    return { index: viewport?.getSliceIndex() ?? 0, count: viewport?.getNumberOfSlices() ?? 0 };
  };

  const getStatus = (): VolumeStatus | undefined => {
    if (!shown || destroyed) return undefined;
    const axial = getPlane('axial');
    const voiRange = axial?.getProperties()?.voiRange;
    const windowLevel = voiRange ? utilities.windowLevel.toWindowLevel(voiRange.lower, voiRange.upper) : undefined;
    const zoomOf = (view: VolumeView) => getViewport(view)?.getZoom() ?? 1;
    return {
      planes: { axial: planeStatus('axial'), sagittal: planeStatus('sagittal'), coronal: planeStatus('coronal') },
      windowWidth: windowLevel?.windowWidth,
      windowCenter: windowLevel?.windowCenter,
      zoom: { axial: zoomOf('axial'), sagittal: zoomOf('sagittal'), coronal: zoomOf('coronal'), volume: zoomOf('volume') },
      volumeRendering,
    };
  };

  let statusQueued = false;
  const scheduleStatus = (): void => {
    if (!callbacks.onStatusChange || statusQueued || destroyed) return;
    statusQueued = true;
    queueMicrotask(() => {
      statusQueued = false;
      if (!destroyed) callbacks.onStatusChange?.(getStatus());
    });
  };

  const views = Object.keys(elements) as VolumeView[];
  for (const view of views) {
    for (const name of STATUS_EVENTS) elements[view].addEventListener(name, scheduleStatus);
  }

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (!destroyed) engine?.resize(true, true);
        });
  for (const view of views) resizeObserver?.observe(elements[view]);

  // ── Release ───────────────────────────────────────────────────────────────

  const clear = (): void => {
    if (destroyed) return;
    const hadVolume = shown;
    shown = false;
    volumeGeneration += 1;
    disableViewports();
    if (volumeId) {
      const volume = cache.getVolume(volumeId) as (Types.IImageVolume & { cancelLoading?: () => void }) | undefined;
      volume?.cancelLoading?.();
      try {
        cache.removeVolumeLoadObject(volumeId);
      } catch {
        // Already removed.
      }
    }
    releaseImages(volumeImageIds);
    files.release();
    files = new FileRegistry();
    volumeId = undefined;
    volumeImageIds = [];
    volumeRendering = false;
    initialVolumeCamera = undefined;
    if (hadVolume) callbacks.onStatusChange?.(undefined);
  };

  /** Resolves on the next rendered frame of the axial view, or after a timeout. */
  const nextFrame = (): { promise: Promise<void>; dispose: () => void } => {
    let dispose = () => undefined as void;
    const promise = new Promise<void>((resolve) => {
      const done = () => {
        dispose();
        resolve();
      };
      const timer = setTimeout(done, FIRST_FRAME_TIMEOUT_MS);
      elements.axial.addEventListener(Enums.Events.IMAGE_RENDERED, done);
      dispose = () => {
        clearTimeout(timer);
        elements.axial.removeEventListener(Enums.Events.IMAGE_RENDERED, done);
      };
    });
    return { promise, dispose };
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  const showVolume = async (
    images: readonly VolumeImage[],
    signal: AbortSignal,
    onProgress?: (progress: VolumeLoadProgress) => void,
  ): Promise<void> => {
    if (destroyed) throw abortError();
    throwIfAborted(signal);
    clear();
    const generation = volumeGeneration;
    if (images.length === 0) throw new DicomViewerError('NO_DICOM_FILES');

    const registry = files;
    const imageIds = images.map((image) => registry.imageId(image.file, image.frame));
    volumeImageIds = imageIds;
    const uniqueFiles = [...new Set(images.map((image) => image.file))];
    const total = uniqueFiles.length + imageIds.length;
    let filesRead = 0;
    onProgress?.({ processed: 0, total });

    const loadDataset = async (file: Blob) => {
      if (generation !== volumeGeneration) throw abortError();
      await registry.loadDataset(file);
      throwIfAborted(signal);
      if (generation !== volumeGeneration) throw abortError();
      filesRead += 1;
      onProgress?.({ processed: filesRead, total });
    };

    // 1. Check the decoded size before reading the rest of the series into memory.
    try {
      throwIfAborted(signal);
      await loadDataset(uniqueFiles[0]!);
      const firstImageId = imageIds[0]!;
      const plane = metaData.get('imagePlaneModule', firstImageId) as { rows?: number; columns?: number } | undefined;
      const estimatedBytes = imageIds.length * (plane?.rows ?? 0) * (plane?.columns ?? 0) * bytesPerVoxel(firstImageId);
      if (estimatedBytes > maxVolumeBytes) throw new DicomViewerError('VOLUME_TOO_LARGE');
      // The volume loader needs synchronous access to every slice's metadata.
      await runBounded(uniqueFiles.slice(1), READ_CONCURRENCY, signal, loadDataset);
    } catch (error) {
      throwIfAborted(signal);
      if (generation !== volumeGeneration) throw abortError();
      if (error instanceof DicomViewerError) throw error;
      if (error instanceof RangeError) throw new DicomViewerError('VOLUME_TOO_LARGE', { cause: error });
      throw classifyLoadError(error);
    }
    if (generation !== volumeGeneration) throw abortError();

    // 2. Create viewports. A failing 3D view leaves the cross-sections usable.
    volumeRendering = false;
    if (wantVolumeRendering) {
      try {
        enableViewports(true);
        volumeRendering = true;
      } catch {
        disableViewports();
      }
    }
    if (!volumeRendering) {
      try {
        enableViewports(false);
      } catch (error) {
        disableViewports();
        throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
      }
    }

    // 3. Create and stream the volume.
    const currentVolumeId = `cornerstoneStreamingImageVolume:mivo-dv-${id}-${generation}`;
    volumeId = currentVolumeId;
    let volume: Types.IImageVolume & {
      load?: (callback: (event: { framesLoaded: number; totalNumFrames: number }) => void) => void;
    };
    type LoadEvent = { framesLoaded: number; totalNumFrames: number };
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    aborted.catch(() => undefined);
    try {
      volume = (await Promise.race([
        volumeLoader.createAndCacheVolume(currentVolumeId, { imageIds }),
        aborted,
      ])) as typeof volume;
    } catch (error) {
      signal.removeEventListener('abort', onAbort);
      throwIfAborted(signal);
      if (error instanceof RangeError) throw new DicomViewerError('VOLUME_TOO_LARGE', { cause: error });
      throw classifyLoadError(error);
    }

    const onModified = (event: Event): void => {
      const detail = (event as CustomEvent<{ volumeId?: string; framesProcessed?: number }>).detail;
      if (detail?.volumeId !== currentVolumeId || generation !== volumeGeneration) return;
      onProgress?.({ processed: filesRead + (detail.framesProcessed ?? 0), total });
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onModified);

    const firstFrame = nextFrame();
    try {
      const loaded = new Promise<void>((resolve, reject) => {
        volume.load?.((event: LoadEvent) => {
          if (event.framesLoaded < event.totalNumFrames) reject(new DicomViewerError('VOLUME_LOAD_FAILED'));
          else resolve();
        });
      });
      loaded.catch(() => undefined);

      await Promise.race([
        setVolumesForViewports(engine!, [{ volumeId: currentVolumeId }], VOLUME_PLANES.map((plane) => viewportIds[plane])),
        aborted,
      ]);
      if (volumeRendering) {
        try {
          await Promise.race([
            setVolumesForViewports(engine!, [{ volumeId: currentVolumeId }], [viewportIds.volume]),
            aborted,
          ]);
          const volume3d = getVolumeViewport('volume');
          if (volume3d) {
            volume3d.setProperties({ preset: VOLUME_PRESET });
            faceAnterior(volume3d);
            initialVolumeCamera = { ...volume3d.getCamera() };
          }
        } catch {
          throwIfAborted(signal);
          // The browser could not build the 3D view; keep the cross-sections.
          volumeRendering = false;
          ToolGroupManager.destroyToolGroup(volumeGroupId);
          volumeGroup = undefined;
          try {
            engine?.disableElement(viewportIds.volume);
          } catch {
            // Already detached.
          }
        }
      }

      await Promise.race([loaded, aborted]);
      engine?.renderViewports(presentViews().map((view) => viewportIds[view]));
      await Promise.race([firstFrame.promise, aborted]);
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof DicomViewerError) throw error;
      if (error instanceof RangeError) throw new DicomViewerError('VOLUME_TOO_LARGE', { cause: error });
      throw classifyLoadError(error);
    } finally {
      signal.removeEventListener('abort', onAbort);
      firstFrame.dispose();
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onModified);
    }
    throwIfAborted(signal);
    if (generation !== volumeGeneration) throw abortError();
    shown = true;
    scheduleStatus();
  };

  // ── View controls ─────────────────────────────────────────────────────────

  const setSliceIndex = (plane: VolumePlane, index: number): void => {
    const viewport = getPlane(plane);
    if (!shown || !viewport) return;
    const count = viewport.getNumberOfSlices();
    const target = clamp(Math.round(index), 0, count - 1);
    if (target === viewport.getSliceIndex()) return;
    void utilities.jumpToSlice(elements[plane], { imageIndex: target }).catch(() => undefined);
  };

  /** Moves a cross-section's camera so its plane passes through `point`. */
  const moveSliceThrough = (plane: VolumePlane, point: Vec3): void => {
    const viewport = getPlane(plane);
    if (!viewport) return;
    const camera = viewport.getCamera();
    const { focalPoint, position, viewPlaneNormal } = camera;
    if (!focalPoint || !position || !viewPlaneNormal) return;
    const shift = scale(viewPlaneNormal, dot(sub(point, focalPoint), viewPlaneNormal));
    viewport.setCamera({ focalPoint: add(focalPoint, shift), position: add(position, shift) });
    viewport.render();
  };

  const crosshairsTool = (): TranslateCrosshairsTool | undefined =>
    mprGroup?.getToolInstance(TranslateCrosshairsTool.toolName) as TranslateCrosshairsTool | undefined;

  const withView = (view: VolumeView, operation: (viewport: Types.IViewport) => void): void => {
    const viewport = getViewport(view);
    if (!shown || !viewport) return;
    operation(viewport);
    viewport.render();
  };

  return {
    showVolume,

    setTool(tool: ViewerTool): void {
      if (tool === primaryTool) return;
      primaryTool = tool;
      applyPrimaryTool();
    },

    setSliceIndex,

    scrollBy(plane: VolumePlane, delta: number): void {
      const viewport = getPlane(plane);
      if (!shown || !viewport || delta === 0) return;
      setSliceIndex(plane, viewport.getSliceIndex() + delta);
    },

    moveCrosshair(plane: VolumePlane, dx: number, dy: number): void {
      const viewport = getPlane(plane);
      if (!shown || !viewport || (dx === 0 && dy === 0) || !volumeId) return;
      const volume = cache.getVolume(volumeId);
      const { viewUp, viewPlaneNormal } = viewport.getCamera();
      if (!volume || !viewUp || !viewPlaneNormal) return;
      // Screen right is viewUp × normal; screen down is −viewUp.
      const right = normalize(cross(viewUp, viewPlaneNormal));
      const down = scale(normalize(viewUp), -1);
      const step = Math.min(...volume.spacing);
      const center = crosshairsTool()?.toolCenter ?? viewport.getCamera().focalPoint;
      if (!center) return;
      const target = add(add(center as Vec3, scale(right, dx * step)), scale(down, dy * step));
      for (const other of VOLUME_PLANES) if (other !== plane) moveSliceThrough(other, target);
    },

    zoomBy(view: VolumeView, factor: number): void {
      withView(view, (viewport) => viewport.setZoom(clamp(viewport.getZoom() * factor, MIN_ZOOM, MAX_ZOOM)));
    },

    panBy(view: VolumeView, dx: number, dy: number): void {
      withView(view, (viewport) => {
        const [x, y] = viewport.getPan();
        viewport.setPan([x + dx, y + dy]);
      });
    },

    rotateBy(yaw: number, pitch: number): void {
      withView('volume', (viewport) => {
        const { focalPoint, position, viewUp } = viewport.getCamera();
        if (!focalPoint || !position || !viewUp) return;
        let offset = sub(position, focalPoint);
        let up = normalize(viewUp);
        const yawAxis = up;
        offset = rotate(offset, yawAxis, (-yaw * Math.PI) / 180);
        const pitchAxis = normalize(cross(scale(offset, -1), up));
        offset = rotate(offset, pitchAxis, (pitch * Math.PI) / 180);
        up = normalize(rotate(up, pitchAxis, (pitch * Math.PI) / 180));
        viewport.setCamera({ position: add(focalPoint, offset), viewUp: up });
      });
    },

    adjustWindowLevel(widthSteps: number, centerSteps: number): void {
      const axial = getPlane('axial');
      const voiRange = axial?.getProperties()?.voiRange;
      if (!shown || !voiRange) return;
      const { windowWidth, windowCenter } = utilities.windowLevel.toWindowLevel(voiRange.lower, voiRange.upper);
      const step = Math.max(1, windowWidth * WINDOW_STEP_FRACTION);
      const next = utilities.windowLevel.toLowHighRange(
        Math.max(2, windowWidth + widthSteps * step),
        windowCenter + centerSteps * step,
      );
      for (const plane of VOLUME_PLANES) {
        const viewport = getPlane(plane);
        viewport?.setProperties({ voiRange: next });
        viewport?.render();
      }
    },

    resetView(): void {
      if (!shown) return;
      for (const plane of VOLUME_PLANES) {
        const viewport = getPlane(plane);
        viewport?.resetProperties();
        viewport?.resetCamera();
      }
      const volume3d = getVolumeViewport('volume');
      if (volume3d) {
        if (initialVolumeCamera) volume3d.setCamera({ ...initialVolumeCamera });
        else volume3d.resetCamera();
        volume3d.setProperties({ preset: VOLUME_PRESET });
      }
      crosshairsTool()?.resetCrosshairs?.();
      engine?.renderViewports(presentViews().map((view) => viewportIds[view]));
      scheduleStatus();
    },

    getStatus,

    clear,

    destroy(): void {
      if (destroyed) return;
      clear();
      destroyed = true;
      for (const view of views) {
        for (const name of STATUS_EVENTS) elements[view].removeEventListener(name, scheduleStatus);
      }
      resizeObserver?.disconnect();
      engine?.destroy();
      engine = undefined;
    },
  };
}

