import { DicomViewerError, isAbortError } from './errors';
import {
  VIEWER_TOOLS,
  VOLUME_TOOLS,
  type CreateRenderer,
  type CreateVolumeRenderer,
  type RendererConfig,
  type StackRenderer,
  type ViewerLayout,
  type ViewerTool,
  type ViewportStatus,
  type VolumePlane,
  type VolumeRenderer,
  type VolumeStatus,
  type VolumeView,
} from './renderer';
import { scanFiles, type ScanOptions, type SkippedFile } from './scanFiles';
import type { LocalSeries, LocalStudy, SeriesSummary, StudySummary } from './studyModel';

/**
 * Viewer lifecycle:
 *
 *   idle ──openFiles──▶ scanning ──▶ loading ──▶ displayed
 *     ▲                    │            │  ▲          │
 *     │                 cancel       cancel └selectSeries / setLayout┘
 *     │                    ▼            ▼
 *     └──────clear───── idle         ready ◀── any phase with studies
 *
 * `error` keeps any studies already found, so the user can pick another series.
 * Every operation aborts the one before it; results from stale operations are dropped.
 */
export type ViewerPhase = 'idle' | 'scanning' | 'ready' | 'loading' | 'displayed' | 'error';

export interface ViewerProgress {
  processed: number;
  total: number;
}

export interface ViewerState {
  phase: ViewerPhase;
  /**
   * Header scan progress while `phase === 'scanning'`, and volume load progress
   * (files read plus slices decoded) while a series loads in the 3D layout.
   */
  progress?: ViewerProgress;
  studies: StudySummary[];
  /** Files that were selected but could not be shown, with the reason. */
  skipped: SkippedFile[];
  selectedSeriesUid?: string;
  /** Layout of the selected series (or the preferred layout when none is selected). */
  layout: ViewerLayout;
  error?: DicomViewerError;
}

/**
 * Interactive view state, kept apart from `ViewerState` because it changes on every
 * scroll, drag or zoom step and the host rarely needs it.
 */
export interface ViewportState {
  /** Tool bound to the primary mouse button and the arrow keys in the current layout. Kept across studies. */
  tool: ViewerTool;
  /** Present while a series is displayed in 2D. */
  status?: ViewportStatus;
  /** Present while a series is displayed in 3D. */
  volumeStatus?: VolumeStatus;
}

export interface ViewerSessionEvents {
  onStateChange?: (state: ViewerState) => void;
  onStudiesLoaded?: (studies: StudySummary[]) => void;
  onSeriesDisplayed?: (series: SeriesSummary, layout: ViewerLayout) => void;
  onError?: (error: DicomViewerError) => void;
}

export interface ViewerSessionOptions {
  createRenderer: CreateRenderer;
  /** Required for the 3D layout. Without it, every series opens in 2D. */
  createVolumeRenderer?: CreateVolumeRenderer;
  rendererConfig: RendererConfig;
  /** Returns the latest event handlers (lets React update callbacks without recreating the session). */
  getEvents?: () => ViewerSessionEvents;
  scan?: (files: readonly Blob[], options: ScanOptions) => ReturnType<typeof scanFiles>;
  /** Minimum interval between progress notifications. */
  progressIntervalMs?: number;
  /** Tool for the 2D layout. @default 'windowLevel' */
  initialTool?: ViewerTool;
  /**
   * Preferred layout. Series that cannot form a volume always open in 2D.
   * @default '2d'
   */
  initialLayout?: ViewerLayout;
}

export const INITIAL_VIEWER_STATE: ViewerState = Object.freeze({
  phase: 'idle',
  studies: [],
  skipped: [],
  layout: '2d',
}) as ViewerState;

export class ViewerSession {
  private state: ViewerState;
  private readonly listeners = new Set<() => void>();
  private readonly options: ViewerSessionOptions;

  private viewport: ViewportState;
  private readonly viewportListeners = new Set<() => void>();
  private readonly tools: Record<ViewerLayout, ViewerTool>;
  /** The layout the user last chose; applied to every series that supports it. */
  private preferredLayout: ViewerLayout;

  private element: HTMLDivElement | undefined;
  private volumeElements: Record<VolumeView, HTMLDivElement> | undefined;
  private rendererPromise: Promise<StackRenderer> | undefined;
  /** The resolved renderer, for synchronous view controls. */
  private renderer: StackRenderer | undefined;
  private volumeRendererPromise: Promise<VolumeRenderer> | undefined;
  private volumeRenderer: VolumeRenderer | undefined;
  private studies: LocalStudy[] = [];
  private operation: AbortController | undefined;
  private generation = 0;

  constructor(options: ViewerSessionOptions) {
    this.options = options;
    const initialTool = options.initialTool && VIEWER_TOOLS.includes(options.initialTool) ? options.initialTool : 'windowLevel';
    this.tools = { '2d': initialTool, '3d': 'crosshairs' };
    this.preferredLayout = options.initialLayout ?? '2d';
    this.state = { ...INITIAL_VIEWER_STATE, layout: this.preferredLayout };
    this.viewport = { tool: this.tools[this.preferredLayout] };
  }

  // ── Store ────────────────────────────────────────────────────────────────

  getState = (): ViewerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<ViewerState>, replace = false): void {
    this.state = replace
      ? { ...INITIAL_VIEWER_STATE, layout: this.preferredLayout, ...patch }
      : { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
    this.events().onStateChange?.(this.state);
  }

  getViewportState = (): ViewportState => this.viewport;

  subscribeViewport = (listener: () => void): (() => void) => {
    this.viewportListeners.add(listener);
    return () => this.viewportListeners.delete(listener);
  };

  private setViewport(patch: Partial<ViewportState>): void {
    const next = { ...this.viewport, ...patch };
    if (
      next.tool === this.viewport.tool &&
      sameStatus(next.status, this.viewport.status) &&
      sameVolumeStatus(next.volumeStatus, this.viewport.volumeStatus)
    ) {
      return;
    }
    this.viewport = next;
    for (const listener of this.viewportListeners) listener();
  }

  private clearViewportStatus(): void {
    this.setViewport({ status: undefined, volumeStatus: undefined });
  }

  private events(): ViewerSessionEvents {
    return this.options.getEvents?.() ?? {};
  }

  // ── Element lifecycle ────────────────────────────────────────────────────

  /** Connects the element that hosts the 2D canvas. */
  attach(element: HTMLDivElement): void {
    if (this.element === element) return;
    if (this.element) this.detach();
    this.element = element;
  }

  /** Connects the four elements of the 3D layout. */
  attachVolume(elements: Record<VolumeView, HTMLDivElement>): void {
    this.volumeElements = elements;
  }

  /** Releases everything and returns to `idle`. The session can be attached again. */
  detach(): void {
    this.reset();
    const renderer = this.rendererPromise;
    const volumeRenderer = this.volumeRendererPromise;
    this.rendererPromise = undefined;
    this.renderer = undefined;
    this.volumeRendererPromise = undefined;
    this.volumeRenderer = undefined;
    this.element = undefined;
    this.volumeElements = undefined;
    renderer?.then((instance) => instance.destroy(), () => undefined);
    volumeRenderer?.then((instance) => instance.destroy(), () => undefined);
  }

  // ── Operations ───────────────────────────────────────────────────────────

  private begin(): { signal: AbortSignal; isCurrent: () => boolean } {
    this.operation?.abort();
    const controller = new AbortController();
    this.operation = controller;
    const generation = ++this.generation;
    return {
      signal: controller.signal,
      isCurrent: () => generation === this.generation && !controller.signal.aborted,
    };
  }

  private fail(error: unknown, fallback: DicomViewerError['code']): void {
    // Decoder failures may carry parsed datasets in their cause. Expose only the code.
    const viewerError = new DicomViewerError(error instanceof DicomViewerError ? error.code : fallback);
    this.clearViewportStatus();
    this.setState({ phase: 'error', progress: undefined, error: viewerError });
    this.events().onError?.(viewerError);
  }

  private releaseDisplayed(): void {
    this.rendererPromise?.then((renderer) => renderer.clear(), () => undefined);
    this.volumeRendererPromise?.then((renderer) => renderer.clear(), () => undefined);
  }

  /** Reads the selected files, lists their studies, and displays the first series. */
  async openFiles(files: readonly Blob[]): Promise<void> {
    const op = this.begin();
    this.studies = [];
    this.releaseDisplayed();
    this.clearViewportStatus();
    this.setState({ phase: 'scanning', progress: { processed: 0, total: files.length } }, true);

    const throttle = this.progressThrottle(op.isCurrent);
    const scan = this.options.scan ?? scanFiles;

    let result: Awaited<ReturnType<typeof scanFiles>>;
    try {
      result = await scan(files, { signal: op.signal, onProgress: throttle });
    } catch (error) {
      if (!op.isCurrent() || isAbortError(error)) return;
      this.fail(error, 'FILE_READ_FAILED');
      return;
    }
    if (!op.isCurrent()) return;

    this.studies = result.studies;
    const studies = result.studies.map((study) => study.summary);
    this.setState({ phase: 'ready', progress: undefined, studies, skipped: result.skipped });
    this.events().onStudiesLoaded?.(studies);

    const first = result.studies[0]?.series[0];
    if (first) await this.selectSeries(first.summary.seriesInstanceUid);
  }

  /** Progress callback that publishes at most once per interval, plus the final value. */
  private progressThrottle(isCurrent: () => boolean): (processed: number, total: number) => void {
    const interval = this.options.progressIntervalMs ?? 50;
    let lastEmit = 0;
    return (processed, total) => {
      const now = Date.now();
      if (!isCurrent() || (processed < total && now - lastEmit < interval)) return;
      lastEmit = now;
      this.setState({ progress: { processed, total } });
    };
  }

  /** True when the series can open in 3D in this session. */
  canShowVolume(seriesInstanceUid: string): boolean {
    const series = this.findSeries(seriesInstanceUid);
    return Boolean(this.options.createVolumeRenderer && series?.summary.volume.supported && series.volumeFrames);
  }

  /**
   * Displays one series from the current study list. `layout` defaults to the preferred
   * layout when the series supports it, otherwise 2D. Requesting `'3d'` for a series
   * that cannot form a volume fails with `VOLUME_UNSUPPORTED`.
   */
  async selectSeries(seriesInstanceUid: string, options: { layout?: ViewerLayout } = {}): Promise<void> {
    const series = this.findSeries(seriesInstanceUid);
    if (!series) return;
    const canVolume = this.canShowVolume(seriesInstanceUid);
    const layout = options.layout ?? (this.preferredLayout === '3d' && canVolume ? '3d' : '2d');

    const op = this.begin();
    this.releaseDisplayed();
    this.setViewport({ status: undefined, volumeStatus: undefined, tool: this.tools[layout] });
    this.setState({
      phase: 'loading',
      selectedSeriesUid: seriesInstanceUid,
      layout,
      error: undefined,
      progress: undefined,
    });

    if (layout === '3d' && !canVolume) {
      this.fail(new DicomViewerError('VOLUME_UNSUPPORTED'), 'VOLUME_UNSUPPORTED');
      return;
    }

    try {
      if (layout === '3d') {
        const renderer = await this.getVolumeRenderer();
        if (!op.isCurrent()) return;
        renderer.setTool(this.tools['3d']);
        const throttle = this.progressThrottle(op.isCurrent);
        await renderer.showVolume(
          series.volumeFrames!.map(({ instance, frame }) => ({ file: instance.file, frame })),
          op.signal,
          ({ processed, total }) => throttle(processed, total),
        );
        if (!op.isCurrent()) return;
        this.setViewport({ volumeStatus: renderer.getStatus() });
      } else {
        const renderer = await this.getRenderer();
        if (!op.isCurrent()) return;
        renderer.setTool(this.tools['2d']);
        await renderer.showStack(
          series.instances.map((instance) => ({
            file: instance.file,
            numberOfFrames: instance.header.numberOfFrames,
          })),
          op.signal,
        );
        if (!op.isCurrent()) return;
        this.setViewport({ status: renderer.getViewportStatus() });
      }
    } catch (error) {
      if (!op.isCurrent() || isAbortError(error)) return;
      this.fail(error, 'IMAGE_LOAD_FAILED');
      return;
    }
    this.setState({ phase: 'displayed', progress: undefined });
    this.events().onSeriesDisplayed?.(series.summary, layout);
  }

  /**
   * Sets the preferred layout and reopens the selected series in it. Switching to 3D
   * is ignored when the selected series cannot form a volume.
   */
  async setLayout(layout: ViewerLayout): Promise<void> {
    const uid = this.state.selectedSeriesUid;
    if (layout === '3d' && uid && !this.canShowVolume(uid)) return;
    if (layout === '3d' && !this.options.createVolumeRenderer) return;
    this.preferredLayout = layout;
    if (!uid || this.state.phase === 'scanning') {
      this.setViewport({ tool: this.tools[layout] });
      this.setState({ layout });
      return;
    }
    if (layout === this.state.layout && this.state.phase !== 'error') return;
    await this.selectSeries(uid, { layout });
  }

  /** Stops the current scan or series load. */
  cancel(): void {
    const { phase } = this.state;
    if (phase !== 'scanning' && phase !== 'loading') return;
    this.begin();
    if (phase === 'scanning' || this.studies.length === 0) {
      this.reset();
      return;
    }
    this.releaseDisplayed();
    this.clearViewportStatus();
    this.setState({ phase: 'ready', selectedSeriesUid: undefined, progress: undefined });
  }

  // ── View controls (no-ops unless a series is displayed in the matching layout) ──

  /** Selects the tool for the primary mouse button and arrow keys in the current layout. */
  setTool(tool: ViewerTool): void {
    const layout = this.state.layout;
    const allowed = layout === '3d' ? VOLUME_TOOLS : VIEWER_TOOLS;
    if (!allowed.includes(tool)) return;
    this.tools[layout] = tool;
    this.setViewport({ tool });
    if (layout === '3d') this.volumeRenderer?.setTool(tool);
    else this.renderer?.setTool(tool);
  }

  setImageIndex(index: number): void {
    this.displayedRenderer()?.setImageIndex(index);
  }

  scrollBy(delta: number): void {
    this.displayedRenderer()?.scrollBy(delta);
  }

  zoomBy(factor: number): void {
    this.displayedRenderer()?.zoomBy(factor);
  }

  panBy(dx: number, dy: number): void {
    this.displayedRenderer()?.panBy(dx, dy);
  }

  /** Applies to the 2D image, or to every cross-section in 3D. */
  adjustWindowLevel(widthSteps: number, centerSteps: number): void {
    this.displayedRenderer()?.adjustWindowLevel(widthSteps, centerSteps);
    this.displayedVolumeRenderer()?.adjustWindowLevel(widthSteps, centerSteps);
  }

  /** Restores the initial view of the displayed series (in 3D: centres the cross-sections too). */
  resetView(): void {
    this.displayedRenderer()?.resetView();
    this.displayedVolumeRenderer()?.resetView();
  }

  setSliceIndex(plane: VolumePlane, index: number): void {
    this.displayedVolumeRenderer()?.setSliceIndex(plane, index);
  }

  scrollPlane(plane: VolumePlane, delta: number): void {
    this.displayedVolumeRenderer()?.scrollBy(plane, delta);
  }

  moveCrosshair(plane: VolumePlane, dx: number, dy: number): void {
    this.displayedVolumeRenderer()?.moveCrosshair(plane, dx, dy);
  }

  zoomView(view: VolumeView, factor: number): void {
    this.displayedVolumeRenderer()?.zoomBy(view, factor);
  }

  panView(view: VolumeView, dx: number, dy: number): void {
    this.displayedVolumeRenderer()?.panBy(view, dx, dy);
  }

  rotateVolume(yaw: number, pitch: number): void {
    this.displayedVolumeRenderer()?.rotateBy(yaw, pitch);
  }

  private displayedRenderer(): StackRenderer | undefined {
    return this.state.phase === 'displayed' && this.state.layout === '2d' ? this.renderer : undefined;
  }

  private displayedVolumeRenderer(): VolumeRenderer | undefined {
    return this.state.phase === 'displayed' && this.state.layout === '3d' ? this.volumeRenderer : undefined;
  }

  /** Closes the current files and releases their data. Use on logout or patient switch. */
  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.begin();
    this.studies = [];
    this.releaseDisplayed();
    this.setViewport({ status: undefined, volumeStatus: undefined, tool: this.tools[this.preferredLayout] });
    this.setState({}, true);
  }

  private findSeries(seriesInstanceUid: string): LocalSeries | undefined {
    for (const study of this.studies) {
      const match = study.series.find((series) => series.summary.seriesInstanceUid === seriesInstanceUid);
      if (match) return match;
    }
    return undefined;
  }

  private isDisplaying(layout: ViewerLayout): boolean {
    return this.state.phase === 'displayed' && this.state.layout === layout;
  }

  private getRenderer(): Promise<StackRenderer> {
    if (this.rendererPromise) return this.rendererPromise;
    const element = this.element;
    if (!element) return Promise.reject(new DicomViewerError('RENDERER_INIT_FAILED'));
    const promise = this.options.createRenderer(element, this.options.rendererConfig, {
      onViewportChange: (status) => {
        // Ignore a renderer that was replaced, and frames from a stack still loading.
        if (this.rendererPromise !== promise || !this.isDisplaying('2d')) return;
        this.setViewport({ status });
      },
    });
    this.rendererPromise = promise;
    promise.then(
      (renderer) => {
        if (this.rendererPromise === promise) this.renderer = renderer;
      },
      () => {
        if (this.rendererPromise === promise) this.rendererPromise = undefined;
      },
    );
    return promise;
  }

  private getVolumeRenderer(): Promise<VolumeRenderer> {
    if (this.volumeRendererPromise) return this.volumeRendererPromise;
    const elements = this.volumeElements;
    const create = this.options.createVolumeRenderer;
    if (!elements || !create) return Promise.reject(new DicomViewerError('RENDERER_INIT_FAILED'));
    const promise = create(elements, this.options.rendererConfig, {
      onStatusChange: (volumeStatus) => {
        if (this.volumeRendererPromise !== promise || !this.isDisplaying('3d')) return;
        this.setViewport({ volumeStatus });
      },
    });
    this.volumeRendererPromise = promise;
    promise.then(
      (renderer) => {
        if (this.volumeRendererPromise === promise) this.volumeRenderer = renderer;
      },
      () => {
        if (this.volumeRendererPromise === promise) this.volumeRendererPromise = undefined;
      },
    );
    return promise;
  }
}

function sameStatus(a: ViewportStatus | undefined, b: ViewportStatus | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.imageIndex === b.imageIndex &&
    a.imageCount === b.imageCount &&
    a.windowWidth === b.windowWidth &&
    a.windowCenter === b.windowCenter &&
    a.zoom === b.zoom &&
    a.imageFailed === b.imageFailed
  );
}

function sameVolumeStatus(a: VolumeStatus | undefined, b: VolumeStatus | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const planes = ['axial', 'sagittal', 'coronal'] as const;
  const views = [...planes, 'volume'] as const;
  return (
    a.windowWidth === b.windowWidth &&
    a.windowCenter === b.windowCenter &&
    a.volumeRendering === b.volumeRendering &&
    planes.every((plane) => a.planes[plane].index === b.planes[plane].index && a.planes[plane].count === b.planes[plane].count) &&
    views.every((view) => a.zoom[view] === b.zoom[view])
  );
}
