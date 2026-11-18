import { DicomViewerError, isAbortError } from './errors';
import type { CreateRenderer, RendererConfig, StackRenderer, ViewerTool, ViewportStatus } from './renderer';
import { scanFiles, type ScanOptions, type SkippedFile } from './scanFiles';
import type { LocalSeries, LocalStudy, SeriesSummary, StudySummary } from './studyModel';

/**
 * Viewer lifecycle:
 *
 *   idle ──openFiles──▶ scanning ──▶ loading ──▶ displayed
 *     ▲                    │            │  ▲          │
 *     │                 cancel       cancel └selectSeries┘
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
  /** Header scan progress while `phase === 'scanning'`. */
  progress?: ViewerProgress;
  studies: StudySummary[];
  /** Files that were selected but could not be shown, with the reason. */
  skipped: SkippedFile[];
  selectedSeriesUid?: string;
  error?: DicomViewerError;
}

/**
 * Interactive view state, kept apart from `ViewerState` because it changes on every
 * scroll, drag or zoom step and the host rarely needs it.
 */
export interface ViewportState {
  /** Tool bound to the primary mouse button and the arrow keys. Kept across studies. */
  tool: ViewerTool;
  /** Present while a series is displayed. */
  status?: ViewportStatus;
}

export interface ViewerSessionEvents {
  onStateChange?: (state: ViewerState) => void;
  onStudiesLoaded?: (studies: StudySummary[]) => void;
  onSeriesDisplayed?: (series: SeriesSummary) => void;
  onError?: (error: DicomViewerError) => void;
}

export interface ViewerSessionOptions {
  createRenderer: CreateRenderer;
  rendererConfig: RendererConfig;
  /** Returns the latest event handlers (lets React update callbacks without recreating the session). */
  getEvents?: () => ViewerSessionEvents;
  scan?: (files: readonly Blob[], options: ScanOptions) => ReturnType<typeof scanFiles>;
  /** Minimum interval between progress notifications. */
  progressIntervalMs?: number;
  /** @default 'windowLevel' */
  initialTool?: ViewerTool;
}

export const INITIAL_VIEWER_STATE: ViewerState = Object.freeze({
  phase: 'idle',
  studies: [],
  skipped: [],
}) as ViewerState;

export class ViewerSession {
  private state: ViewerState = INITIAL_VIEWER_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly options: ViewerSessionOptions;

  private viewport: ViewportState;
  private readonly viewportListeners = new Set<() => void>();

  private element: HTMLDivElement | undefined;
  private rendererPromise: Promise<StackRenderer> | undefined;
  /** The resolved renderer, for synchronous view controls. */
  private renderer: StackRenderer | undefined;
  private studies: LocalStudy[] = [];
  private operation: AbortController | undefined;
  private generation = 0;

  constructor(options: ViewerSessionOptions) {
    this.options = options;
    this.viewport = { tool: options.initialTool ?? 'windowLevel' };
  }

  // ── Store ────────────────────────────────────────────────────────────────

  getState = (): ViewerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<ViewerState>, replace = false): void {
    this.state = replace ? { ...INITIAL_VIEWER_STATE, ...patch } : { ...this.state, ...patch };
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
    if (next.tool === this.viewport.tool && sameStatus(next.status, this.viewport.status)) return;
    this.viewport = next;
    for (const listener of this.viewportListeners) listener();
  }

  private events(): ViewerSessionEvents {
    return this.options.getEvents?.() ?? {};
  }

  // ── Element lifecycle ────────────────────────────────────────────────────

  /** Connects the element that hosts the rendering canvas. */
  attach(element: HTMLDivElement): void {
    if (this.element === element) return;
    if (this.element) this.detach();
    this.element = element;
  }

  /** Releases everything and returns to `idle`. The session can be attached again. */
  detach(): void {
    this.reset();
    const renderer = this.rendererPromise;
    this.rendererPromise = undefined;
    this.renderer = undefined;
    this.element = undefined;
    renderer?.then((instance) => instance.destroy(), () => undefined);
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
    const viewerError = error instanceof DicomViewerError ? error : new DicomViewerError(fallback, { cause: error });
    this.setViewport({ status: undefined });
    this.setState({ phase: 'error', progress: undefined, error: viewerError });
    this.events().onError?.(viewerError);
  }

  private releaseDisplayed(): void {
    this.rendererPromise?.then((renderer) => renderer.clear(), () => undefined);
  }

  /** Reads the selected files, lists their studies, and displays the first series. */
  async openFiles(files: readonly Blob[]): Promise<void> {
    const op = this.begin();
    this.studies = [];
    this.releaseDisplayed();
    this.setState({ phase: 'scanning', progress: { processed: 0, total: files.length } }, true);

    const interval = this.options.progressIntervalMs ?? 50;
    let lastEmit = 0;
    const scan = this.options.scan ?? scanFiles;

    let result: Awaited<ReturnType<typeof scanFiles>>;
    try {
      result = await scan(files, {
        signal: op.signal,
        onProgress: (processed, total) => {
          const now = Date.now();
          if (!op.isCurrent() || (processed < total && now - lastEmit < interval)) return;
          lastEmit = now;
          this.setState({ progress: { processed, total } });
        },
      });
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

  /** Displays one series from the current study list. */
  async selectSeries(seriesInstanceUid: string): Promise<void> {
    const series = this.findSeries(seriesInstanceUid);
    if (!series) return;
    const op = this.begin();
    this.setViewport({ status: undefined });
    this.setState({ phase: 'loading', selectedSeriesUid: seriesInstanceUid, error: undefined });

    let renderer: StackRenderer;
    try {
      renderer = await this.getRenderer();
      if (!op.isCurrent()) return;
      renderer.setTool(this.viewport.tool);
      await renderer.showStack(
        series.instances.map((instance) => ({
          file: instance.file,
          numberOfFrames: instance.header.numberOfFrames,
        })),
        op.signal,
      );
    } catch (error) {
      if (!op.isCurrent() || isAbortError(error)) return;
      this.fail(error, 'IMAGE_LOAD_FAILED');
      return;
    }
    if (!op.isCurrent()) return;
    this.setViewport({ status: renderer.getViewportStatus() });
    this.setState({ phase: 'displayed' });
    this.events().onSeriesDisplayed?.(series.summary);
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
    this.setViewport({ status: undefined });
    this.setState({ phase: 'ready', selectedSeriesUid: undefined });
  }

  // ── View controls (no-ops unless a series is displayed) ──────────────────

  /** Selects the tool for the primary mouse button and arrow keys. */
  setTool(tool: ViewerTool): void {
    this.setViewport({ tool });
    this.renderer?.setTool(tool);
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

  adjustWindowLevel(widthSteps: number, centerSteps: number): void {
    this.displayedRenderer()?.adjustWindowLevel(widthSteps, centerSteps);
  }

  /** Restores the initial zoom, pan and window/level of the displayed series. */
  resetView(): void {
    this.displayedRenderer()?.resetView();
  }

  private displayedRenderer(): StackRenderer | undefined {
    return this.state.phase === 'displayed' ? this.renderer : undefined;
  }

  /** Closes the current files and releases their data. Use on logout or patient switch. */
  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.begin();
    this.studies = [];
    this.releaseDisplayed();
    this.setViewport({ status: undefined });
    this.setState({}, true);
  }

  private findSeries(seriesInstanceUid: string): LocalSeries | undefined {
    for (const study of this.studies) {
      const match = study.series.find((series) => series.summary.seriesInstanceUid === seriesInstanceUid);
      if (match) return match;
    }
    return undefined;
  }

  private getRenderer(): Promise<StackRenderer> {
    if (this.rendererPromise) return this.rendererPromise;
    const element = this.element;
    if (!element) return Promise.reject(new DicomViewerError('RENDERER_INIT_FAILED'));
    const promise = this.options.createRenderer(element, this.options.rendererConfig, {
      onViewportChange: (status) => {
        // Ignore a renderer that was replaced, and frames from a stack still loading.
        if (this.rendererPromise !== promise || this.state.phase !== 'displayed') return;
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
