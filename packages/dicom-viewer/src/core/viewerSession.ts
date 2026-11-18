import { DicomViewerError, isAbortError } from './errors';
import type { CreateRenderer, RendererConfig, StackRenderer } from './renderer';
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

  private element: HTMLDivElement | undefined;
  private rendererPromise: Promise<StackRenderer> | undefined;
  private studies: LocalStudy[] = [];
  private operation: AbortController | undefined;
  private generation = 0;

  constructor(options: ViewerSessionOptions) {
    this.options = options;
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
    this.setState({ phase: 'loading', selectedSeriesUid: seriesInstanceUid, error: undefined });

    try {
      const renderer = await this.getRenderer();
      if (!op.isCurrent()) return;
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
    this.setState({ phase: 'ready', selectedSeriesUid: undefined });
  }

  /** Closes the current files and releases their data. Use on logout or patient switch. */
  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.begin();
    this.studies = [];
    this.releaseDisplayed();
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
    const promise = this.options.createRenderer(element, this.options.rendererConfig);
    this.rendererPromise = promise;
    promise.catch(() => {
      if (this.rendererPromise === promise) this.rendererPromise = undefined;
    });
    return promise;
  }
}
