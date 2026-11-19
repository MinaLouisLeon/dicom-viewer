import { Enums, RenderingEngine, eventTarget, imageLoader, utilities, type Types } from '@cornerstonejs/core';
import {
  AngleTool,
  ArrowAnnotateTool,
  BidirectionalTool,
  CobbAngleTool,
  EllipticalROITool,
  EraserTool,
  Enums as ToolEnums,
  LengthTool,
  MagnifyTool,
  PanTool,
  ProbeTool,
  RectangleROITool,
  ReferenceLinesTool,
  StackScrollTool,
  SynchronizerManager,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  addTool,
  annotation,
  state as toolsState,
  synchronizers,
} from '@cornerstonejs/tools';

import { FileRegistry, PINCH_ZOOM_BINDING, PINCH_ZOOM_TOOL, classifyLoadError, ensureInitialized } from '../core/cornerstoneSetup';
import { DicomViewerError, abortError, throwIfAborted } from '../core/errors';
import type { RendererConfig, StackImage } from '../core/renderer';
import {
  IDENTITY_TRANSFORM,
  type CellStatus,
  type AnnotationVisibility,
  type CellTransform,
  type GridRenderer,
  type GridRendererCallbacks,
  type SyncOptions,
  type WindowRequest,
  type WorkstationTool,
} from './gridRenderer';
import { computeAutoWindow } from './windowPresets';

type ToolGroup = NonNullable<ReturnType<typeof ToolGroupManager.createToolGroup>>;

/** Tools that own the primary button when selected. `crosshairs` has no meaning in 2D. */
const TOOL_NAMES: Record<Exclude<WorkstationTool, 'crosshairs'>, string> = {
  windowLevel: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  scroll: StackScrollTool.toolName,
  magnify: MagnifyTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  cobbAngle: CobbAngleTool.toolName,
  bidirectional: BidirectionalTool.toolName,
  rectangleRoi: RectangleROITool.toolName,
  ellipticalRoi: EllipticalROITool.toolName,
  probe: ProbeTool.toolName,
  arrow: ArrowAnnotateTool.toolName,
  eraser: EraserTool.toolName,
};

const ANNOTATION_TOOLS = [
  LengthTool,
  AngleTool,
  CobbAngleTool,
  BidirectionalTool,
  RectangleROITool,
  EllipticalROITool,
  ProbeTool,
  ArrowAnnotateTool,
];

const PRIMARY_BINDING = { mouseButton: ToolEnums.MouseBindings.Primary };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 40;
const WINDOW_STEP_FRACTION = 0.05;
const FIRST_FRAME_TIMEOUT_MS = 2000;

const STATUS_EVENTS = [
  Enums.Events.PRE_STACK_NEW_IMAGE,
  Enums.Events.STACK_NEW_IMAGE,
  Enums.Events.VOI_MODIFIED,
  Enums.Events.CAMERA_MODIFIED,
] as const;

let instanceCounter = 0;
let toolsRegistered = false;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function registerWorkstationTools(): void {
  if (toolsRegistered) return;
  toolsRegistered = true;
  const tools = [MagnifyTool, EraserTool, ReferenceLinesTool, ...ANNOTATION_TOOLS];
  for (const Tool of tools) {
    if (toolsState.tools[Tool.toolName]) continue;
    addTool(Tool);
  }
}

interface CellEntry {
  element: HTMLDivElement;
  viewportId: string;
  files: FileRegistry;
  imageIds: string[];
  imageIndexById: Map<string, number>;
  failed: Set<number>;
  shown: boolean;
  invert: boolean;
}

export async function createCornerstoneGridRenderer(
  config: RendererConfig,
  callbacks: GridRendererCallbacks = {},
): Promise<GridRenderer> {
  await ensureInitialized(config);
  registerWorkstationTools();

  instanceCounter += 1;
  const id = instanceCounter;
  const engineId = `mihawk-ws-engine-${id}`;
  const toolGroupId = `mihawk-ws-tools-${id}`;
  const syncIds = {
    zoomPan: `mihawk-ws-sync-zoompan-${id}`,
    windowLevel: `mihawk-ws-sync-voi-${id}`,
  };

  let engine: RenderingEngine | undefined;
  let toolGroup: ToolGroup | undefined;
  try {
    engine = new RenderingEngine(engineId);
    toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
    if (!toolGroup) throw new Error('Tool group exists');
  } catch (error) {
    engine?.destroy();
    throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
  }
  const group = toolGroup;

  // ── Tools ──────────────────────────────────────────────────────────────
  for (const name of [WindowLevelTool.toolName, PanTool.toolName, StackScrollTool.toolName, MagnifyTool.toolName, EraserTool.toolName]) {
    group.addTool(name);
  }
  group.addTool(ZoomTool.toolName, { pinchToZoom: false });
  group.addToolInstance(PINCH_ZOOM_TOOL, ZoomTool.toolName, { pinchToZoom: true });
  group.addTool(ReferenceLinesTool.toolName);
  for (const Tool of ANNOTATION_TOOLS) {
    group.addTool(Tool.toolName);
    // Passive: drawn and editable, but not created, until selected.
    group.setToolPassive(Tool.toolName);
  }
  group.setToolActive(PINCH_ZOOM_TOOL, { bindings: [PINCH_ZOOM_BINDING] });
  group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] });
  group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
  group.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });

  let primaryTool: keyof typeof TOOL_NAMES | undefined;
  let visibility: AnnotationVisibility = { measurements: true, annotations: true };
  const annotationNames = new Set(ANNOTATION_TOOLS.map((Tool) => Tool.toolName));
  const isHidden = (name: string | undefined) =>
    name === ArrowAnnotateTool.toolName ? !visibility.annotations : name !== undefined && annotationNames.has(name) && !visibility.measurements;

  /** Puts every tool in the state that matches the selected tool and the visibility settings. */
  const applyToolStates = (): void => {
    const primaryName = primaryTool ? TOOL_NAMES[primaryTool] : undefined;
    for (const name of Object.values(TOOL_NAMES)) {
      if (name === primaryName) continue;
      if (name === EraserTool.toolName || name === MagnifyTool.toolName) group.setToolDisabled(name);
      // Passive keeps the fixed bindings (wheel, right and middle button) and annotation editing.
      else group.setToolPassive(name);
    }
    if (primaryName) group.setToolActive(primaryName, { bindings: [PRIMARY_BINDING] });
    // Re-assert the fixed bindings, which passive/disabled calls on the same tool may have dropped.
    if (primaryTool !== 'scroll') group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] });
    if (primaryTool !== 'zoom') group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
    if (primaryTool !== 'pan') group.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });
    engine?.render();
  };

  /** Hides or shows existing annotations by kind (they stay in memory). */
  const applyAnnotationVisibility = (): void => {
    for (const item of annotation.state.getAllAnnotations()) {
      if (!item.annotationUID) continue;
      annotation.visibility.setAnnotationVisibility(item.annotationUID, !isHidden(item.metadata?.toolName));
    }
    engine?.render();
  };
  // New annotations follow the current setting.
  const onAnnotationAdded = (event: Event): void => {
    const added = (event as CustomEvent<{ annotation?: { annotationUID?: string; metadata?: { toolName?: string } } }>).detail?.annotation;
    if (added?.annotationUID && isHidden(added.metadata?.toolName)) {
      annotation.visibility.setAnnotationVisibility(added.annotationUID, false);
    }
  };
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_ADDED, onAnnotationAdded);

  const setTool = (requested: WorkstationTool): void => {
    const tool = requested === 'crosshairs' ? 'windowLevel' : requested;
    if (tool === primaryTool) return;
    primaryTool = tool;
    applyToolStates();
  };
  setTool('windowLevel');

  // ── Cells ──────────────────────────────────────────────────────────────
  const cells = new Map<string, CellEntry>();
  let referenceSource: string | undefined;
  let destroyed = false;

  const createSynchronizers = () => {
    const zoomPan = synchronizers.createZoomPanSynchronizer(syncIds.zoomPan);
    const voi = synchronizers.createVOISynchronizer(syncIds.windowLevel, { syncInvertState: false, syncColormap: false });
    return { zoomPan, windowLevel: voi };
  };
  const syncs = createSynchronizers();
  for (const synchronizer of Object.values(syncs)) synchronizer.setEnabled(false);

  const viewportOf = (cell: CellEntry | undefined): Types.IStackViewport | undefined =>
    cell ? (engine?.getViewport(cell.viewportId) as Types.IStackViewport | undefined) : undefined;

  const statusOf = (cellId: string): CellStatus | undefined => {
    const cell = cells.get(cellId);
    const viewport = viewportOf(cell);
    if (!cell || !viewport || !cell.shown || cell.imageIds.length === 0) return undefined;
    const imageIndex = viewport.getCurrentImageIdIndex();
    const { voiRange, invert } = viewport.getProperties();
    const windowLevel = voiRange ? utilities.windowLevel.toWindowLevel(voiRange.lower, voiRange.upper) : undefined;
    const presentation = viewport.getViewPresentation({ rotation: true, flipHorizontal: true, flipVertical: true });
    return {
      imageIndex,
      imageCount: cell.imageIds.length,
      windowWidth: windowLevel?.windowWidth,
      windowCenter: windowLevel?.windowCenter,
      zoom: viewport.getZoom(),
      imageFailed: cell.failed.has(imageIndex),
      rotation: (((Math.round(presentation.rotation ?? 0) % 360) + 360) % 360),
      flipHorizontal: Boolean(presentation.flipHorizontal),
      flipVertical: Boolean(presentation.flipVertical),
      invert: Boolean(invert ?? cell.invert),
    };
  };

  const queued = new Set<string>();
  const scheduleStatus = (cellId: string): void => {
    if (!callbacks.onCellChange || destroyed || queued.has(cellId)) return;
    queued.add(cellId);
    queueMicrotask(() => {
      queued.delete(cellId);
      if (!destroyed && cells.has(cellId)) callbacks.onCellChange?.(cellId, statusOf(cellId));
    });
  };

  const listeners = new Map<string, () => void>();

  const onImageLoadFailed = (event: Event): void => {
    const { imageId } = (event as CustomEvent<{ imageId?: string }>).detail ?? {};
    if (!imageId) return;
    for (const [cellId, cell] of cells) {
      const index = cell.imageIndexById.get(imageId);
      if (index === undefined) continue;
      cell.failed.add(index);
      scheduleStatus(cellId);
    }
  };
  eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, onImageLoadFailed);

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (!destroyed) engine?.resize(true, true);
        });

  /** (Re)creates a cell's viewport and connects it to the tools and synchronizers. */
  const enable = (cell: CellEntry): void => {
    engine?.enableElement({
      viewportId: cell.viewportId,
      type: Enums.ViewportType.STACK,
      element: cell.element,
      defaultOptions: { background: [0, 0, 0] as Types.Point3 },
    });
    group.addViewport(cell.viewportId, engineId);
    const target = { renderingEngineId: engineId, viewportId: cell.viewportId };
    for (const synchronizer of Object.values(syncs)) synchronizer.add(target);
  };

  const disable = (cell: CellEntry): void => {
    const target = { renderingEngineId: engineId, viewportId: cell.viewportId };
    for (const synchronizer of Object.values(syncs)) {
      try {
        synchronizer.remove(target);
      } catch {
        // Not registered.
      }
    }
    try {
      group.removeViewports(engineId, cell.viewportId);
    } catch {
      // Not registered.
    }
    try {
      engine?.disableElement(cell.viewportId);
    } catch {
      // Already detached.
    }
  };

  const removeAnnotationsFor = (imageIds: ReadonlySet<string> | undefined): void => {
    const all = annotation.state.getAllAnnotations();
    for (const item of all) {
      const referenced = item.metadata?.referencedImageId;
      if (imageIds && (!referenced || !imageIds.has(referenced))) continue;
      if (item.annotationUID) annotation.state.removeAnnotation(item.annotationUID);
    }
  };

  const clearCell = (cellId: string): void => {
    const cell = cells.get(cellId);
    if (!cell || destroyed) return;
    const hadStack = cell.shown;
    const previous = cell.imageIds;
    cell.shown = false;
    cell.imageIds = [];
    cell.imageIndexById = new Map();
    cell.failed.clear();
    cell.invert = false;
    if (previous.length) removeAnnotationsFor(new Set(previous));
    // Detach the previous stack so the canvas no longer shows released pixels.
    disable(cell);
    try {
      enable(cell);
    } catch {
      // Element gone.
    }
    cell.files.release(previous);
    cell.files = new FileRegistry();
    if (hadStack) callbacks.onCellChange?.(cellId, undefined);
    applyReferenceLines();
  };

  const applyReferenceLines = (): void => {
    const source = referenceSource ? cells.get(referenceSource) : undefined;
    if (!source || !source.shown) {
      group.setToolDisabled(ReferenceLinesTool.toolName);
      return;
    }
    group.setToolConfiguration(ReferenceLinesTool.toolName, { sourceViewportId: source.viewportId });
    group.setToolEnabled(ReferenceLinesTool.toolName);
    engine?.render();
  };

  const nextFrame = (element: HTMLDivElement): { promise: Promise<void>; dispose: () => void } => {
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

  const withViewport = (cellId: string, operation: (viewport: Types.IStackViewport, cell: CellEntry) => void): void => {
    const cell = cells.get(cellId);
    const viewport = viewportOf(cell);
    if (destroyed || !cell?.shown || !viewport) return;
    operation(viewport, cell);
    viewport.render();
  };

  const setImageIndex = (cellId: string, index: number): void => {
    const cell = cells.get(cellId);
    const viewport = viewportOf(cell);
    if (destroyed || !cell?.shown || !viewport) return;
    const target = clamp(Math.round(index), 0, cell.imageIds.length - 1);
    if (target === viewport.getCurrentImageIdIndex()) return;
    viewport.setImageIdIndex(target).catch(() => undefined);
  };

  /** Modality values of the displayed image, or undefined for colour images. */
  const modalityValues = (viewport: Types.IStackViewport): ArrayLike<number> | undefined => {
    const image = viewport.getCornerstoneImage() as
      | (Types.IImage & { preScale?: { scaled?: boolean }; color?: boolean })
      | undefined;
    if (!image || image.color || (image.numberOfComponents ?? 1) > 1) return undefined;
    const pixels = image.getPixelData() as ArrayLike<number> | undefined;
    if (!pixels?.length) return undefined;
    if (image.preScale?.scaled) return pixels;
    const slope = image.slope ?? 1;
    const intercept = image.intercept ?? 0;
    if (slope === 1 && intercept === 0) return pixels;
    const maxSamples = 262_144;
    const stride = Math.max(1, Math.floor(pixels.length / maxSamples));
    const values = new Float32Array(Math.ceil(pixels.length / stride));
    for (let index = 0, out = 0; index < pixels.length; index += stride, out += 1) {
      values[out] = pixels[index]! * slope + intercept;
    }
    return values;
  };

  /** The window stored in the file, or the image's value range. */
  const defaultRange = (viewport: Types.IStackViewport): { lower: number; upper: number } | undefined => {
    const image = viewport.getCornerstoneImage() as
      | (Types.IImage & { windowCenter?: number | number[]; windowWidth?: number | number[]; preScale?: { scaled?: boolean } })
      | undefined;
    if (!image) return undefined;
    const first = (value: number | number[] | undefined) => (Array.isArray(value) ? value[0] : value);
    const center = first(image.windowCenter);
    const width = first(image.windowWidth);
    if (Number.isFinite(center) && Number.isFinite(width) && width! > 0) {
      return utilities.windowLevel.toLowHighRange(width!, center!);
    }
    const scaled = image.preScale?.scaled;
    const slope = scaled ? 1 : image.slope ?? 1;
    const intercept = scaled ? 0 : image.intercept ?? 0;
    const lower = image.minPixelValue * slope + intercept;
    const upper = image.maxPixelValue * slope + intercept;
    return upper > lower ? { lower, upper } : undefined;
  };

  const renderer: GridRenderer = {
    attachCell(cellId, element) {
      if (destroyed) return;
      const existing = cells.get(cellId);
      if (existing?.element === element) return;
      if (existing) renderer.detachCell(cellId);
      const cell: CellEntry = {
        element,
        viewportId: `mihawk-ws-${id}-${cellId}`,
        files: new FileRegistry(),
        imageIds: [],
        imageIndexById: new Map(),
        failed: new Set(),
        shown: false,
        invert: false,
      };
      cells.set(cellId, cell);
      try {
        enable(cell);
      } catch (error) {
        cells.delete(cellId);
        throw new DicomViewerError('RENDERER_INIT_FAILED', { cause: error });
      }
      const listener = () => scheduleStatus(cellId);
      listeners.set(cellId, listener);
      for (const name of STATUS_EVENTS) element.addEventListener(name, listener);
      resizeObserver?.observe(element);
    },

    detachCell(cellId) {
      const cell = cells.get(cellId);
      if (!cell) return;
      clearCell(cellId);
      const listener = listeners.get(cellId);
      if (listener) for (const name of STATUS_EVENTS) cell.element.removeEventListener(name, listener);
      listeners.delete(cellId);
      resizeObserver?.unobserve(cell.element);
      disable(cell);
      cell.files.release();
      cells.delete(cellId);
      if (referenceSource === cellId) referenceSource = undefined;
      applyReferenceLines();
    },

    async showStack(cellId, images: readonly StackImage[], signal) {
      if (destroyed) throw abortError();
      throwIfAborted(signal);
      const cell = cells.get(cellId);
      if (!cell) throw new DicomViewerError('RENDERER_INIT_FAILED');
      clearCell(cellId);
      const imageIds = images.flatMap((image) => cell.files.imageIds(image.file, image.numberOfFrames));
      if (imageIds.length === 0) throw new DicomViewerError('NO_DICOM_FILES');
      cell.imageIds = imageIds;
      cell.imageIndexById = new Map(imageIds.map((imageId, index) => [imageId, index]));

      let onAbort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError());
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      aborted.catch(() => undefined);
      const firstFrame = nextFrame(cell.element);
      try {
        await Promise.race([imageLoader.loadAndCacheImage(imageIds[0]!), aborted]);
        const viewport = viewportOf(cell);
        if (!viewport || cells.get(cellId) !== cell) throw abortError();
        await Promise.race([viewport.setStack(imageIds, 0), aborted]);
        if (!viewport.getCornerstoneImage()) throw new Error('Image not displayed');
        viewport.render();
        await Promise.race([firstFrame.promise, aborted]);
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof DicomViewerError) throw error;
        throw classifyLoadError(error);
      } finally {
        signal.removeEventListener('abort', onAbort);
        firstFrame.dispose();
      }
      throwIfAborted(signal);
      cell.shown = true;
      applyReferenceLines();
      scheduleStatus(cellId);
    },

    clearCell,

    setTool,

    setImageIndex,

    scrollBy(cellId, delta, wrap = false) {
      const cell = cells.get(cellId);
      const viewport = viewportOf(cell);
      if (destroyed || !cell?.shown || !viewport || delta === 0) return;
      const count = cell.imageIds.length;
      let target = viewport.getCurrentImageIdIndex() + delta;
      if (wrap) target = ((target % count) + count) % count;
      setImageIndex(cellId, target);
    },

    zoomBy(cellId, factor) {
      withViewport(cellId, (viewport) => viewport.setZoom(clamp(viewport.getZoom() * factor, MIN_ZOOM, MAX_ZOOM)));
    },

    panBy(cellId, dx, dy) {
      withViewport(cellId, (viewport) => {
        const [x, y] = viewport.getPan();
        viewport.setPan([x + dx, y + dy]);
      });
    },

    adjustWindowLevel(cellId, widthSteps, centerSteps) {
      withViewport(cellId, (viewport) => {
        const { voiRange } = viewport.getProperties();
        if (!voiRange) return;
        const { windowWidth, windowCenter } = utilities.windowLevel.toWindowLevel(voiRange.lower, voiRange.upper);
        const step = Math.max(1, windowWidth * WINDOW_STEP_FRACTION);
        const width = Math.max(2, windowWidth + widthSteps * step);
        viewport.setProperties({ voiRange: utilities.windowLevel.toLowHighRange(width, windowCenter + centerSteps * step) });
      });
    },

    setWindow(cellId, request: WindowRequest) {
      let applied = false;
      withViewport(cellId, (viewport) => {
        let range: { lower: number; upper: number } | undefined;
        if (request === 'default') range = defaultRange(viewport);
        else if (request === 'auto') {
          const values = modalityValues(viewport);
          const window = values ? computeAutoWindow(values) : undefined;
          range = window ? utilities.windowLevel.toLowHighRange(window.width, window.center) : undefined;
        } else range = utilities.windowLevel.toLowHighRange(Math.max(1, request.width), request.center);
        if (!range) return;
        viewport.setProperties({ voiRange: range });
        applied = true;
      });
      return applied;
    },

    setTransform(cellId, patch: Partial<CellTransform>) {
      withViewport(cellId, (viewport, cell) => {
        if (patch.invert !== undefined) {
          cell.invert = patch.invert;
          viewport.setProperties({ invert: patch.invert });
        }
        const presentation: Types.ViewPresentation = {};
        if (patch.flipHorizontal !== undefined) presentation.flipHorizontal = patch.flipHorizontal;
        if (patch.flipVertical !== undefined) presentation.flipVertical = patch.flipVertical;
        let zoomFactor = 1;
        if (patch.rotation !== undefined) {
          const rotation = ((Math.round(patch.rotation) % 360) + 360) % 360;
          presentation.rotation = rotation;
          const previous = viewport.getViewPresentation({ rotation: true }).rotation ?? 0;
          // A quarter turn swaps the image's width and height: keep the zoom relative to fit.
          if (Math.round(previous / 90) % 2 !== Math.round(rotation / 90) % 2) {
            const image = viewport.getCornerstoneImage();
            const canvas = viewport.canvas;
            if (image && canvas.clientWidth && canvas.clientHeight) {
              const fit = (w: number, h: number) => Math.min(canvas.clientWidth / w, canvas.clientHeight / h);
              const before = Math.round(previous / 90) % 2 ? fit(image.rows, image.columns) : fit(image.columns, image.rows);
              const after = Math.round(rotation / 90) % 2 ? fit(image.rows, image.columns) : fit(image.columns, image.rows);
              zoomFactor = after / before;
            }
          }
        }
        if (Object.keys(presentation).length) viewport.setViewPresentation(presentation);
        if (zoomFactor !== 1) viewport.setZoom(clamp(viewport.getZoom() * zoomFactor, MIN_ZOOM, MAX_ZOOM));
      });
      scheduleStatus(cellId);
    },

    resetView(cellId) {
      withViewport(cellId, (viewport, cell) => {
        viewport.setViewPresentation({
          rotation: IDENTITY_TRANSFORM.rotation,
          flipHorizontal: IDENTITY_TRANSFORM.flipHorizontal,
          flipVertical: IDENTITY_TRANSFORM.flipVertical,
        });
        viewport.resetCamera();
        viewport.resetProperties();
        cell.invert = false;
      });
      scheduleStatus(cellId);
    },

    getStatus: statusOf,

    setSync(options: SyncOptions) {
      syncs.zoomPan.setEnabled(options.zoomPan);
      syncs.windowLevel.setEnabled(options.windowLevel);
    },

    setReferenceLines(sourceCellId) {
      referenceSource = sourceCellId;
      applyReferenceLines();
    },

    clearMeasurements(cellId) {
      if (cellId === undefined) {
        const all = new Set<string>();
        for (const cell of cells.values()) for (const imageId of cell.imageIds) all.add(imageId);
        removeAnnotationsFor(all);
      } else {
        const cell = cells.get(cellId);
        if (cell) removeAnnotationsFor(new Set(cell.imageIds));
      }
      engine?.render();
    },

    setAnnotationVisibility(next) {
      visibility = { ...next };
      applyAnnotationVisibility();
    },

    async renderThumbnail(file, frame, size) {
      if (destroyed) return undefined;
      const registry = new FileRegistry();
      const imageId = registry.imageId(file, frame);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        await utilities.loadImageToCanvas({ canvas, imageId, thumbnail: true, useCPURendering: true });
        return canvas.toDataURL('image/png');
      } catch {
        return undefined;
      } finally {
        registry.release([imageId]);
      }
    },

    measurementCount(cellId) {
      const cell = cells.get(cellId);
      if (!cell) return 0;
      const ids = new Set(cell.imageIds);
      return annotation.state
        .getAllAnnotations()
        .filter((item) => item.metadata?.referencedImageId && ids.has(item.metadata.referencedImageId)).length;
    },

    destroy() {
      if (destroyed) return;
      for (const cellId of [...cells.keys()]) renderer.detachCell(cellId);
      destroyed = true;
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, onImageLoadFailed);
      eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_ADDED, onAnnotationAdded);
      resizeObserver?.disconnect();
      for (const syncId of Object.values(syncIds)) SynchronizerManager.destroySynchronizer(syncId);
      ToolGroupManager.destroyToolGroup(toolGroupId);
      engine?.destroy();
      engine = undefined;
    },
  };
  return renderer;
}
