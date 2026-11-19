import { DicomViewerError, isAbortError } from '@mihawksolutions/dicom-viewer/internal';
import {
  VOLUME_VIEWS,
  type CreateVolumeRenderer,
  type RendererConfig,
  type ViewerTool,
  type VolumePlane,
  type VolumeRenderer,
  type VolumeStatus,
  type VolumeSlab,
  type VolumeView,
} from '@mihawksolutions/dicom-viewer/internal';
import { scanFiles, type ScanOptions, type SkippedFile } from '@mihawksolutions/dicom-viewer/internal';
import type { LocalInstance, LocalSeries, LocalStudy, SeriesSummary, StudySummary } from '@mihawksolutions/dicom-viewer/internal';
import type { ViewerProgress } from '@mihawksolutions/dicom-viewer/internal';
import {
  IDENTITY_TRANSFORM,
  NO_SYNC,
  type CellStatus,
  type CreateGridRenderer,
  type GridRenderer,
  type SyncOptions,
  type WorkstationTool,
} from './gridRenderer';
import { expandArchives, type ArchiveIssue, type ArchiveLimits } from './archive';
import { MPR_SLOTS, cellCount, clampGrid, type GridLayout, type MprLayout } from './layouts';
import { DEFAULT_WINDOW_PRESETS, autoWindowOptionsFor, type WindowPreset, type WindowValue } from '@mihawksolutions/dicom-viewer/internal';

export type WorkstationPhase = 'idle' | 'scanning' | 'ready' | 'error';
export type WorkstationTab = 'viewer' | 'map';
/** 2D shows a stack; 3D shows linked cross-sections and the rotatable volume (MPR). */
export type CellMode = '2d' | '3d';
export type CellPhase = 'empty' | 'loading' | 'displayed' | 'error';

export interface CellState {
  id: string;
  seriesInstanceUid?: string;
  mode: CellMode;
  mprLayout: MprLayout;
  /** Which plane fills each MPR slot, in slot order (a permutation of the four views). */
  mprViews: VolumeView[];
  /** Thick-slab rendering of this cell's cross-sections in 3D. */
  slab: VolumeSlab;
  /** True when the crosshairs may tilt the planes (oblique MPR). */
  oblique: boolean;
  /** Look of the 3D pane (a Cornerstone volume preset name). */
  volumePreset: string;
  phase: CellPhase;
  error?: DicomViewerError;
  /** Volume load progress while a 3D cell loads. */
  progress?: ViewerProgress;
  /** Id of the window preset last applied, until the window is changed by hand. */
  presetId?: string;
  /** Cine playback of this cell. */
  playing: boolean;
}

export interface WorkstationState {
  phase: WorkstationPhase;
  /**
   * Progress while scanning: bytes of ZIP archives read while `progressStage` is
   * `archive`, then files whose headers were read (`headers`).
   */
  progress?: ViewerProgress;
  progressStage?: 'archive' | 'headers';
  /** Problems with ZIP archives in the last selection (encrypted, damaged, too large…). */
  archiveIssues: ArchiveIssue[];
  studies: StudySummary[];
  skipped: SkippedFile[];
  error?: DicomViewerError;
  grid: GridLayout;
  /** One entry per grid position, row by row. */
  cells: CellState[];
  activeCellId: string;
  tool: WorkstationTool;
  sync: SyncOptions;
  referenceLines: boolean;
  /** Corner text over each viewport. */
  overlay: boolean;
  /** Show patient name, ID, birth date and similar in the overlay. */
  patientInfo: boolean;
  tab: WorkstationTab;
  /** Frames per second for cine playback. */
  cineFps: number;
  /** Cine restarts from the first image (true) or stops at the last one (false). */
  cineLoop: boolean;
  /** Show measurements (lengths, angles, ROIs, probes). */
  showMeasurements: boolean;
  /** Show arrow notes. */
  showAnnotations: boolean;
}

/** Fast-changing view state of one cell, kept apart from `WorkstationState`. */
export interface CellViewState {
  status?: CellStatus;
  volumeStatus?: VolumeStatus;
  /** 3D pane the zoom buttons, cine and readout apply to. */
  activeView: VolumeView;
}

export interface WorkstationEvents {
  onStateChange?: (state: WorkstationState) => void;
  onStudiesLoaded?: (studies: StudySummary[]) => void;
  onSeriesDisplayed?: (series: SeriesSummary, cellId: string, mode: CellMode) => void;
  onError?: (error: DicomViewerError, cellId?: string) => void;
}

export interface WorkstationSessionOptions {
  createGridRenderer: CreateGridRenderer;
  createVolumeRenderer?: CreateVolumeRenderer;
  rendererConfig: RendererConfig;
  getEvents?: () => WorkstationEvents;
  scan?: (files: readonly Blob[], options: ScanOptions) => ReturnType<typeof scanFiles>;
  progressIntervalMs?: number;
  initialGrid?: GridLayout;
  initialTool?: WorkstationTool;
  windowPresets?: readonly WindowPreset[];
  /** Fills empty cells with the next series when files open or the grid grows. @default true */
  autoFill?: boolean;
  cineFps?: number;
  /** Slab of new 3D cells. @default { mode: 'avg', thickness: 10 } */
  defaultSlab?: VolumeSlab;
  /** 3D look of new 3D cells. @default 'CT-Bone' */
  defaultVolumePreset?: string;
  /** Open ZIP archives in the selection (with these limits), or `false` to treat them as other files. */
  archives?: ArchiveLimits | false;
}

const VOLUME_TOOL_FALLBACK: ViewerTool = 'crosshairs';
const VOLUME_TOOLS = new Set<WorkstationTool>(['windowLevel', 'pan', 'zoom', 'scroll', 'crosshairs']);

/** Maps a workstation tool to the tool a 3D cell's cross-sections use. */
export function volumeToolFor(tool: WorkstationTool): ViewerTool {
  return VOLUME_TOOLS.has(tool) ? (tool as ViewerTool) : VOLUME_TOOL_FALLBACK;
}

export const DEFAULT_SLAB: VolumeSlab = Object.freeze({ mode: 'avg', thickness: 10 }) as VolumeSlab;
export const DEFAULT_VOLUME_PRESET = 'CT-Bone';

let cellCounter = 0;
const newCell = (defaults: Pick<CellState, 'slab' | 'volumePreset'> = { slab: DEFAULT_SLAB, volumePreset: DEFAULT_VOLUME_PRESET }): CellState => {
  cellCounter += 1;
  return {
    id: `c${cellCounter}`,
    mode: '2d',
    mprLayout: 'grid',
    mprViews: [...VOLUME_VIEWS],
    slab: { ...defaults.slab },
    oblique: false,
    volumePreset: defaults.volumePreset,
    phase: 'empty',
    playing: false,
  };
};

/** Keeps existing cells by position and adds empty ones (or drops the extra ones). */
export function resizeCells(
  cells: readonly CellState[],
  count: number,
  defaults?: Pick<CellState, 'slab' | 'volumePreset'>,
): CellState[] {
  const next = cells.slice(0, count);
  while (next.length < count) next.push(newCell(defaults));
  return next;
}

interface CellRuntime {
  element?: HTMLDivElement;
  volumeElements?: Record<VolumeView, HTMLDivElement>;
  volumeRendererPromise?: Promise<VolumeRenderer>;
  volumeRenderer?: VolumeRenderer;
  operation?: AbortController;
  generation: number;
  /** Window right after a preset was applied; a different window clears `presetId`. */
  presetWindow?: { width?: number; center?: number };
}

export class WorkstationSession {
  private state: WorkstationState;
  private readonly listeners = new Set<() => void>();
  private views: Record<string, CellViewState> = {};
  private readonly viewListeners = new Set<() => void>();
  private readonly options: WorkstationSessionOptions;
  private readonly runtime = new Map<string, CellRuntime>();
  private studies: LocalStudy[] = [];
  private scanOperation: AbortController | undefined;
  private gridRendererPromise: Promise<GridRenderer> | undefined;
  private gridRenderer: GridRenderer | undefined;
  private cineTimer: ReturnType<typeof setInterval> | undefined;
  private thumbnails = new Map<string, Promise<string | undefined>>();
  private thumbnailQueue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(options: WorkstationSessionOptions) {
    this.options = options;
    const grid = clampGrid(options.initialGrid ?? { rows: 1, columns: 1 });
    const cells = resizeCells([], cellCount(grid), this.cellDefaults);
    this.state = {
      phase: 'idle',
      studies: [],
      skipped: [],
      archiveIssues: [],
      grid,
      cells,
      activeCellId: cells[0]!.id,
      tool: options.initialTool ?? 'windowLevel',
      sync: { ...NO_SYNC },
      referenceLines: true,
      overlay: true,
      patientInfo: false,
      tab: 'viewer',
      cineFps: options.cineFps ?? 10,
      cineLoop: true,
      showMeasurements: true,
      showAnnotations: true,
    };
  }

  private get cellDefaults(): Pick<CellState, 'slab' | 'volumePreset'> {
    return {
      slab: this.options.defaultSlab ?? DEFAULT_SLAB,
      volumePreset: this.options.defaultVolumePreset ?? DEFAULT_VOLUME_PRESET,
    };
  }

  // ── Stores ─────────────────────────────────────────────────────────────

  getState = (): WorkstationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getViews = (): Record<string, CellViewState> => this.views;

  subscribeViews = (listener: () => void): (() => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };

  get windowPresets(): readonly WindowPreset[] {
    return this.options.windowPresets ?? DEFAULT_WINDOW_PRESETS;
  }

  private events(): WorkstationEvents {
    return this.options.getEvents?.() ?? {};
  }

  private setState(patch: Partial<WorkstationState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
    this.events().onStateChange?.(this.state);
  }

  private patchCell(cellId: string, patch: Partial<CellState>): void {
    if (!this.state.cells.some((cell) => cell.id === cellId)) return;
    this.setState({ cells: this.state.cells.map((cell) => (cell.id === cellId ? { ...cell, ...patch } : cell)) });
  }

  private setView(cellId: string, patch: Partial<CellViewState>): void {
    const previous = this.views[cellId] ?? { activeView: 'axial' };
    const next = { ...previous, ...patch };
    if (
      next.activeView === previous.activeView &&
      sameCellStatus(next.status, previous.status) &&
      next.volumeStatus === previous.volumeStatus
    ) {
      return;
    }
    this.views = { ...this.views, [cellId]: next };
    for (const listener of this.viewListeners) listener();
    this.trackPresetWindow(cellId, next);
  }

  /** Clears a cell's preset highlight once its window is changed by hand. */
  private trackPresetWindow(cellId: string, view: CellViewState): void {
    const runtime = this.runtime.get(cellId);
    const cell = this.cell(cellId);
    if (!runtime || !cell?.presetId) return;
    const width = view.status?.windowWidth ?? view.volumeStatus?.windowWidth;
    const center = view.status?.windowCenter ?? view.volumeStatus?.windowCenter;
    if (!runtime.presetWindow) {
      runtime.presetWindow = { width, center };
      return;
    }
    const moved = (a: number | undefined, b: number | undefined) =>
      a !== undefined && b !== undefined && Math.abs(a - b) > Math.max(0.5, Math.abs(b) * 1e-3);
    if (moved(width, runtime.presetWindow.width) || moved(center, runtime.presetWindow.center)) {
      runtime.presetWindow = undefined;
      this.patchCell(cellId, { presetId: undefined });
    }
  }

  private cell(cellId: string): CellState | undefined {
    return this.state.cells.find((cell) => cell.id === cellId);
  }

  get activeCell(): CellState {
    return this.cell(this.state.activeCellId) ?? this.state.cells[0]!;
  }

  private runtimeOf(cellId: string): CellRuntime {
    let runtime = this.runtime.get(cellId);
    if (!runtime) {
      runtime = { generation: 0 };
      this.runtime.set(cellId, runtime);
    }
    return runtime;
  }

  // ── Elements ───────────────────────────────────────────────────────────

  /** Connects the element of a 2D cell; pass null when it unmounts. */
  attachCell(cellId: string, element: HTMLDivElement | null): void {
    const runtime = this.runtimeOf(cellId);
    if (runtime.element === element) return;
    if (runtime.element) this.gridRenderer?.detachCell(cellId);
    runtime.element = element ?? undefined;
    if (element && this.gridRenderer) this.gridRenderer.attachCell(cellId, element);
  }

  /** Connects the four pane elements of a cell's 3D layout; pass null when they unmount. */
  attachVolume(cellId: string, elements: Record<VolumeView, HTMLDivElement> | null): void {
    const runtime = this.runtimeOf(cellId);
    if (elements === null) {
      this.destroyVolumeRenderer(runtime);
      runtime.volumeElements = undefined;
      return;
    }
    const current = runtime.volumeElements;
    if (current && (Object.keys(elements) as VolumeView[]).every((view) => current[view] === elements[view])) return;
    this.destroyVolumeRenderer(runtime);
    runtime.volumeElements = elements;
  }

  private destroyVolumeRenderer(runtime: CellRuntime): void {
    const promise = runtime.volumeRendererPromise;
    runtime.volumeRendererPromise = undefined;
    runtime.volumeRenderer = undefined;
    promise?.then((renderer) => renderer.destroy(), () => undefined);
  }

  /** Releases every renderer. The session can be attached again afterwards. */
  dispose(): void {
    this.clear();
    this.disposed = true;
    for (const runtime of this.runtime.values()) this.destroyVolumeRenderer(runtime);
    const grid = this.gridRendererPromise;
    this.gridRendererPromise = undefined;
    this.gridRenderer = undefined;
    grid?.then((renderer) => renderer.destroy(), () => undefined);
  }

  /** Reverses `dispose` (React StrictMode mounts twice). */
  revive(): void {
    this.disposed = false;
  }

  private getGridRenderer(): Promise<GridRenderer> {
    if (this.gridRendererPromise) return this.gridRendererPromise;
    const promise = this.options.createGridRenderer(this.options.rendererConfig, {
      onCellChange: (cellId, status) => {
        if (this.gridRendererPromise !== promise) return;
        const cell = this.cell(cellId);
        if (!cell || cell.mode !== '2d' || cell.phase !== 'displayed') return;
        const previous = this.views[cellId]?.status?.imageIndex;
        this.setView(cellId, { status });
        if (status && previous !== undefined && status.imageIndex !== previous) this.syncScroll(cellId, status.imageIndex);
      },
    });
    this.gridRendererPromise = promise;
    promise.then(
      (renderer) => {
        if (this.gridRendererPromise !== promise) return;
        this.gridRenderer = renderer;
        for (const [cellId, runtime] of this.runtime) {
          if (runtime.element) renderer.attachCell(cellId, runtime.element);
        }
        renderer.setTool(this.state.tool);
        renderer.setSync(this.state.sync);
        renderer.setAnnotationVisibility({ measurements: this.state.showMeasurements, annotations: this.state.showAnnotations });
      },
      () => {
        if (this.gridRendererPromise === promise) this.gridRendererPromise = undefined;
      },
    );
    return promise;
  }

  private getVolumeRenderer(cellId: string): Promise<VolumeRenderer> {
    const runtime = this.runtimeOf(cellId);
    if (runtime.volumeRendererPromise) return runtime.volumeRendererPromise;
    const create = this.options.createVolumeRenderer;
    const elements = runtime.volumeElements;
    if (!create || !elements) return Promise.reject(new DicomViewerError('RENDERER_INIT_FAILED'));
    const promise = create(elements, this.options.rendererConfig, {
      onStatusChange: (volumeStatus) => {
        if (runtime.volumeRendererPromise !== promise) return;
        const cell = this.cell(cellId);
        if (!cell || cell.mode !== '3d' || cell.phase !== 'displayed') return;
        this.setView(cellId, { volumeStatus });
      },
    });
    runtime.volumeRendererPromise = promise;
    promise.then(
      (renderer) => {
        if (runtime.volumeRendererPromise === promise) runtime.volumeRenderer = renderer;
      },
      () => {
        if (runtime.volumeRendererPromise === promise) runtime.volumeRendererPromise = undefined;
      },
    );
    return promise;
  }

  // ── Files ──────────────────────────────────────────────────────────────

  /** Reads the files, lists their studies and fills the grid with their series. */
  async openFiles(files: readonly Blob[]): Promise<void> {
    this.scanOperation?.abort();
    const controller = new AbortController();
    this.scanOperation = controller;
    this.releaseAllCells();
    this.studies = [];
    this.thumbnails.clear();
    this.setState({
      phase: 'scanning',
      progress: { processed: 0, total: files.length },
      progressStage: 'headers',
      studies: [],
      skipped: [],
      archiveIssues: [],
      error: undefined,
      cells: this.state.cells.map((cell) => ({ ...cell, seriesInstanceUid: undefined, phase: 'empty', error: undefined, presetId: undefined, playing: false, progress: undefined })),
    });
    const isCurrent = () => this.scanOperation === controller && !controller.signal.aborted;
    const interval = this.options.progressIntervalMs ?? 50;
    let lastEmit = 0;
    const onProgress = (processed: number, total: number) => {
      const now = Date.now();
      if (!isCurrent() || (processed < total && now - lastEmit < interval)) return;
      lastEmit = now;
      this.setState({ progress: { processed, total } });
    };
    let result: Awaited<ReturnType<typeof scanFiles>>;
    try {
      let selection = files;
      if (this.options.archives !== false) {
        // ZIP archives are opened here, in the browser, and replaced by their files.
        const expanded = await expandArchives(files, {
          ...(this.options.archives ?? {}),
          signal: controller.signal,
          onProgress: (processed, total) => {
            if (!isCurrent()) return;
            if (this.state.progressStage !== 'archive') this.setState({ progressStage: 'archive' });
            onProgress(processed, total);
          },
        });
        if (!isCurrent()) return;
        selection = expanded.files;
        if (expanded.archives > 0 || expanded.issues.length) {
          lastEmit = 0;
          this.setState({ archiveIssues: expanded.issues, progressStage: 'headers', progress: { processed: 0, total: selection.length } });
        }
      }
      result = await (this.options.scan ?? scanFiles)(selection, { signal: controller.signal, onProgress });
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return;
      const viewerError = new DicomViewerError(error instanceof DicomViewerError ? error.code : 'FILE_READ_FAILED');
      this.setState({ phase: 'error', progress: undefined, progressStage: undefined, error: viewerError });
      this.events().onError?.(viewerError);
      return;
    }
    if (!isCurrent()) return;
    this.studies = result.studies;
    const studies = result.studies.map((study) => study.summary);
    this.setState({ phase: 'ready', progress: undefined, progressStage: undefined, studies, skipped: result.skipped });
    this.events().onStudiesLoaded?.(studies);
    if (this.options.autoFill !== false) await this.fillEmptyCells();
  }

  private allSeries(): LocalSeries[] {
    return this.studies.flatMap((study) => study.series);
  }

  private findSeries(uid: string | undefined): LocalSeries | undefined {
    if (!uid) return undefined;
    return this.allSeries().find((series) => series.summary.seriesInstanceUid === uid);
  }

  /** Puts series not yet shown into empty cells, in order. With one series, only the first cell. */
  private async fillEmptyCells(): Promise<void> {
    const shown = new Set(this.state.cells.map((cell) => cell.seriesInstanceUid).filter(Boolean));
    const queue = this.allSeries().filter((series) => !shown.has(series.summary.seriesInstanceUid));
    const loads: Promise<void>[] = [];
    for (const cell of this.state.cells) {
      if (cell.seriesInstanceUid) continue;
      const next = queue.shift();
      if (!next) break;
      loads.push(this.loadSeries(next.summary.seriesInstanceUid, cell.id));
    }
    await Promise.all(loads);
  }

  /** True when the series can be shown in 3D. */
  canShowVolume(seriesInstanceUid: string | undefined): boolean {
    const series = this.findSeries(seriesInstanceUid);
    return Boolean(this.options.createVolumeRenderer && series?.summary.volume.supported && series.volumeFrames);
  }

  /**
   * Shows a series in a cell (the active cell by default). `mode` defaults to the cell's
   * current mode when the series supports it, otherwise 2D.
   */
  async loadSeries(seriesInstanceUid: string, cellId = this.state.activeCellId, options: { mode?: CellMode } = {}): Promise<void> {
    const series = this.findSeries(seriesInstanceUid);
    const cell = this.cell(cellId);
    if (!series || !cell || this.disposed) return;
    const canVolume = this.canShowVolume(seriesInstanceUid);
    const mode: CellMode = options.mode ?? (cell.mode === '3d' && canVolume ? '3d' : '2d');
    const runtime = this.runtimeOf(cellId);
    runtime.operation?.abort();
    const controller = new AbortController();
    runtime.operation = controller;
    const generation = ++runtime.generation;
    const isCurrent = () => runtime.generation === generation && !controller.signal.aborted;
    runtime.presetWindow = undefined;

    this.releaseCellDisplay(cellId, runtime);
    this.setView(cellId, { status: undefined, volumeStatus: undefined });
    this.patchCell(cellId, {
      seriesInstanceUid,
      mode,
      phase: 'loading',
      error: undefined,
      progress: undefined,
      presetId: undefined,
      playing: false,
    });
    this.updateCine();

    const fail = (error: unknown, fallback: DicomViewerError['code']) => {
      const viewerError = new DicomViewerError(error instanceof DicomViewerError ? error.code : fallback);
      this.setView(cellId, { status: undefined, volumeStatus: undefined });
      this.patchCell(cellId, { phase: 'error', error: viewerError, progress: undefined });
      this.events().onError?.(viewerError, cellId);
    };

    if (mode === '3d' && !canVolume) {
      fail(new DicomViewerError('VOLUME_UNSUPPORTED'), 'VOLUME_UNSUPPORTED');
      return;
    }
    // Let React mount the cell's elements for the new mode before rendering into them.
    await Promise.resolve();
    try {
      if (mode === '3d') {
        const renderer = await this.waitFor(() => this.getVolumeRenderer(cellId), () => Boolean(runtime.volumeElements));
        if (!isCurrent()) return;
        renderer.setTool(volumeToolFor(this.state.tool));
        const settings = this.cell(cellId);
        if (settings) {
          renderer.setSlab?.(settings.slab);
          renderer.setOblique?.(settings.oblique);
          renderer.setVolumePreset?.(settings.volumePreset);
        }
        renderer.setCrosshairsVisible?.(this.state.referenceLines);
        let lastEmit = 0;
        await renderer.showVolume(
          series.volumeFrames!.map(({ instance, frame }) => ({ file: instance.file, frame })),
          controller.signal,
          ({ processed, total }) => {
            const now = Date.now();
            if (!isCurrent() || (processed < total && now - lastEmit < (this.options.progressIntervalMs ?? 50))) return;
            lastEmit = now;
            this.patchCell(cellId, { progress: { processed, total } });
          },
        );
        if (!isCurrent()) return;
        this.patchCell(cellId, { phase: 'displayed', progress: undefined });
        this.setView(cellId, { volumeStatus: renderer.getStatus() });
      } else {
        const renderer = await this.waitFor(() => this.getGridRenderer(), () => Boolean(runtime.element));
        if (!isCurrent()) return;
        if (runtime.element) renderer.attachCell(cellId, runtime.element);
        await renderer.showStack(
          cellId,
          series.instances.map((instance) => ({ file: instance.file, numberOfFrames: instance.header.numberOfFrames })),
          controller.signal,
        );
        if (!isCurrent()) return;
        this.patchCell(cellId, { phase: 'displayed' });
        this.setView(cellId, { status: renderer.getStatus(cellId) });
        this.applyReferenceLines();
      }
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return;
      fail(error, mode === '3d' ? 'VOLUME_LOAD_FAILED' : 'IMAGE_LOAD_FAILED');
      return;
    }
    this.events().onSeriesDisplayed?.(series.summary, cellId, mode);
  }

  /** Waits (a few frames at most) for an element to mount, then creates the renderer. */
  private async waitFor<T>(create: () => Promise<T>, ready: () => boolean): Promise<T> {
    for (let attempt = 0; attempt < 20 && !ready(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    if (!ready()) throw new DicomViewerError('RENDERER_INIT_FAILED');
    return create();
  }

  private releaseCellDisplay(cellId: string, runtime: CellRuntime): void {
    this.gridRenderer?.clearCell(cellId);
    runtime.volumeRenderer?.clear();
  }

  private releaseAllCells(): void {
    for (const [cellId, runtime] of this.runtime) {
      runtime.operation?.abort();
      runtime.generation += 1;
      this.releaseCellDisplay(cellId, runtime);
    }
    this.views = {};
    for (const listener of this.viewListeners) listener();
    this.stopCineTimer();
  }

  /** Empties a cell. */
  closeCell(cellId = this.state.activeCellId): void {
    const runtime = this.runtime.get(cellId);
    if (runtime) {
      runtime.operation?.abort();
      runtime.generation += 1;
      this.releaseCellDisplay(cellId, runtime);
    }
    this.setView(cellId, { status: undefined, volumeStatus: undefined });
    this.patchCell(cellId, { seriesInstanceUid: undefined, phase: 'empty', error: undefined, presetId: undefined, playing: false, progress: undefined });
    this.updateCine();
  }

  /** Stops the scan or the active cell's load. */
  cancel(): void {
    if (this.state.phase === 'scanning') {
      this.scanOperation?.abort();
      this.scanOperation = undefined;
      this.setState({ phase: this.studies.length ? 'ready' : 'idle', progress: undefined });
      return;
    }
    for (const cell of this.state.cells) if (cell.phase === 'loading') this.closeCell(cell.id);
  }

  /** Closes every file and returns to `idle`. Use on logout or patient switch. */
  clear(): void {
    this.scanOperation?.abort();
    this.scanOperation = undefined;
    this.releaseAllCells();
    this.gridRenderer?.clearMeasurements();
    this.studies = [];
    this.thumbnails.clear();
    this.setState({
      phase: 'idle',
      progress: undefined,
      progressStage: undefined,
      studies: [],
      skipped: [],
      archiveIssues: [],
      error: undefined,
      tab: 'viewer',
      cells: this.state.cells.map((cell) => ({ ...cell, seriesInstanceUid: undefined, phase: 'empty', error: undefined, presetId: undefined, playing: false, progress: undefined, mode: '2d' })),
    });
  }

  // ── Grid ───────────────────────────────────────────────────────────────

  setGrid(grid: GridLayout): void {
    const next = clampGrid(grid);
    const count = cellCount(next);
    // Keep the viewport the user is working in: move it into the last remaining position.
    let current = this.state.cells;
    const activeIndex = current.findIndex((cell) => cell.id === this.state.activeCellId);
    if (activeIndex >= count) {
      current = [...current];
      [current[count - 1], current[activeIndex]] = [current[activeIndex]!, current[count - 1]!];
      this.state = { ...this.state, cells: current };
    }
    const removed = current.slice(count);
    for (const cell of removed) {
      const runtime = this.runtime.get(cell.id);
      runtime?.operation?.abort();
      if (runtime) runtime.generation += 1;
    }
    const cells = resizeCells(current, count, this.cellDefaults);
    const activeCellId = cells.some((cell) => cell.id === this.state.activeCellId) ? this.state.activeCellId : cells[0]!.id;
    this.setState({ grid: next, cells, activeCellId });
    for (const cell of removed) {
      const runtime = this.runtime.get(cell.id);
      if (runtime) this.releaseCellDisplay(cell.id, runtime);
      const { [cell.id]: _removed, ...views } = this.views;
      this.views = views;
    }
    this.updateCine();
    this.applyReferenceLines();
    if (this.options.autoFill !== false && this.studies.length) void this.fillEmptyCells();
  }

  setActiveCell(cellId: string): void {
    if (cellId === this.state.activeCellId || !this.cell(cellId)) return;
    this.setState({ activeCellId: cellId });
    this.applyReferenceLines();
  }

  /** Switches a cell between 2D and 3D, reloading its series. */
  async setCellMode(mode: CellMode, cellId = this.state.activeCellId): Promise<void> {
    const cell = this.cell(cellId);
    if (!cell) return;
    if (mode === '3d' && cell.seriesInstanceUid && !this.canShowVolume(cell.seriesInstanceUid)) return;
    if (!cell.seriesInstanceUid) {
      this.patchCell(cellId, { mode });
      return;
    }
    if (mode === cell.mode && cell.phase !== 'error') return;
    await this.loadSeries(cell.seriesInstanceUid, cellId, { mode });
  }

  setMprLayout(layout: MprLayout, cellId = this.state.activeCellId): void {
    const cell = this.cell(cellId);
    if (!cell) return;
    this.patchCell(cellId, { mprLayout: layout });
    this.keepActiveViewVisible(cellId);
  }

  /** Shows `view` in MPR slot `slot` of a cell; the plane it replaces moves to `view`'s old slot. */
  setMprView(slot: number, view: VolumeView, cellId = this.state.activeCellId): void {
    const cell = this.cell(cellId);
    if (!cell || slot < 0 || slot >= cell.mprViews.length) return;
    const views = [...cell.mprViews];
    const from = views.indexOf(view);
    if (from === slot) return;
    [views[slot], views[from]] = [view, views[slot]!];
    this.patchCell(cellId, { mprViews: views });
    this.setView(cellId, { activeView: view });
  }

  private keepActiveViewVisible(cellId: string): void {
    const cell = this.cell(cellId);
    const view = this.views[cellId];
    if (!cell) return;
    const visible = visibleViews(cell.mprLayout, cell.mprViews);
    if (!view || !visible.includes(view.activeView)) this.setView(cellId, { activeView: visible[0]! });
  }

  /** Average, maximum or minimum intensity over a slab, for a 3D cell. */
  setSlab(slab: VolumeSlab, cellId = this.state.activeCellId): void {
    const next = { mode: slab.mode, thickness: Math.min(100, Math.max(0.5, slab.thickness)) };
    this.patchCell(cellId, { slab: next });
    this.runtime.get(cellId)?.volumeRenderer?.setSlab?.(next);
  }

  /** Lets the crosshairs tilt the planes of a 3D cell (true), or keeps them orthogonal. */
  setOblique(oblique: boolean, cellId = this.state.activeCellId): void {
    this.patchCell(cellId, { oblique });
    this.runtime.get(cellId)?.volumeRenderer?.setOblique?.(oblique);
  }

  /** Changes the look of a 3D cell's volume pane. */
  setVolumePreset(preset: string, cellId = this.state.activeCellId): void {
    this.patchCell(cellId, { volumePreset: preset });
    this.runtime.get(cellId)?.volumeRenderer?.setVolumePreset?.(preset);
  }

  setActiveView(view: VolumeView, cellId = this.state.activeCellId): void {
    this.setView(cellId, { activeView: view });
  }

  setTab(tab: WorkstationTab): void {
    if (tab !== this.state.tab) this.setState({ tab });
  }

  // ── Tools and view ─────────────────────────────────────────────────────

  setTool(tool: WorkstationTool): void {
    // Drawing a measurement or note makes that kind visible again.
    if (tool === 'arrow' && !this.state.showAnnotations) this.setAnnotationVisibility({ annotations: true });
    else if (MEASURING_TOOLS.has(tool) && !this.state.showMeasurements) this.setAnnotationVisibility({ measurements: true });
    this.setState({ tool });
    this.gridRenderer?.setTool(tool);
    for (const runtime of this.runtime.values()) runtime.volumeRenderer?.setTool(volumeToolFor(tool));
  }

  private displayed(cellId: string): { cell: CellState; runtime: CellRuntime } | undefined {
    const cell = this.cell(cellId);
    const runtime = this.runtime.get(cellId);
    if (!cell || !runtime || cell.phase !== 'displayed') return undefined;
    return { cell, runtime };
  }

  private activePlane(cellId: string): VolumePlane {
    const view = this.views[cellId]?.activeView ?? 'axial';
    return view === 'volume' ? 'axial' : view;
  }

  scrollBy(delta: number, cellId = this.state.activeCellId, wrap = false): void {
    const target = this.displayed(cellId);
    if (!target) return;
    if (target.cell.mode === '2d') {
      this.gridRenderer?.scrollBy(cellId, delta, wrap);
      return;
    }
    const plane = this.activePlane(cellId);
    const renderer = target.runtime.volumeRenderer;
    const status = this.views[cellId]?.volumeStatus?.planes[plane];
    if (!renderer || !status) return;
    if (wrap && status.count > 0) {
      renderer.setSliceIndex(plane, (((status.index + delta) % status.count) + status.count) % status.count);
    } else renderer.scrollBy(plane, delta);
  }

  setImageIndex(index: number, cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target) return;
    if (target.cell.mode === '2d') this.gridRenderer?.setImageIndex(cellId, index);
    else target.runtime.volumeRenderer?.setSliceIndex(this.activePlane(cellId), index);
  }

  setSliceIndex(plane: VolumePlane, index: number, cellId = this.state.activeCellId): void {
    this.displayed(cellId)?.runtime.volumeRenderer?.setSliceIndex(plane, index);
  }

  zoomBy(factor: number, cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target) return;
    if (target.cell.mode === '2d') this.gridRenderer?.zoomBy(cellId, factor);
    else target.runtime.volumeRenderer?.zoomBy(this.views[cellId]?.activeView ?? 'axial', factor);
  }

  panBy(dx: number, dy: number, cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target) return;
    if (target.cell.mode === '2d') this.gridRenderer?.panBy(cellId, dx, dy);
    else target.runtime.volumeRenderer?.panBy(this.views[cellId]?.activeView ?? 'axial', dx, dy);
  }

  rotateVolume(yaw: number, pitch: number, cellId = this.state.activeCellId): void {
    this.displayed(cellId)?.runtime.volumeRenderer?.rotateBy(yaw, pitch);
  }

  moveCrosshair(plane: VolumePlane, dx: number, dy: number, cellId = this.state.activeCellId): void {
    this.displayed(cellId)?.runtime.volumeRenderer?.moveCrosshair(plane, dx, dy);
  }

  adjustWindowLevel(widthSteps: number, centerSteps: number, cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target) return;
    if (target.cell.mode === '2d') this.gridRenderer?.adjustWindowLevel(cellId, widthSteps, centerSteps);
    else target.runtime.volumeRenderer?.adjustWindowLevel(widthSteps, centerSteps);
  }

  /** Applies a window preset (by id) to a cell. Returns false when it could not be applied. */
  applyPreset(presetId: string, cellId = this.state.activeCellId): boolean {
    const preset = this.windowPresets.find((item) => item.id === presetId);
    const target = this.displayed(cellId);
    if (!preset || !target) return false;
    const request = preset.window ?? (preset.id === 'auto' ? 'auto' : 'default');
    const autoOptions = request === 'auto' ? autoWindowOptionsFor(this.findSeries(target.cell.seriesInstanceUid)?.summary.modality) : undefined;
    const applied =
      target.cell.mode === '2d'
        ? this.gridRenderer?.setWindow(cellId, request, autoOptions) ?? false
        : target.runtime.volumeRenderer?.setWindow?.(request, autoOptions) ?? false;
    if (applied) {
      // Remember the window the preset produced; a later, different window clears the highlight.
      const status =
        target.cell.mode === '2d' ? this.gridRenderer?.getStatus(cellId) : target.runtime.volumeRenderer?.getStatus();
      target.runtime.presetWindow = status ? { width: status.windowWidth, center: status.windowCenter } : undefined;
      this.patchCell(cellId, { presetId });
    }
    return applied;
  }

  /** Applies a custom window (width and center) to a cell. */
  setWindow(window: WindowValue, cellId = this.state.activeCellId): boolean {
    const target = this.displayed(cellId);
    if (!target) return false;
    const applied =
      target.cell.mode === '2d'
        ? this.gridRenderer?.setWindow(cellId, window) ?? false
        : target.runtime.volumeRenderer?.setWindow?.(window) ?? false;
    if (applied) this.patchCell(cellId, { presetId: undefined });
    return applied;
  }

  toggleInvert(cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target) return;
    if (target.cell.mode === '2d') {
      const current = this.views[cellId]?.status?.invert ?? false;
      this.gridRenderer?.setTransform(cellId, { invert: !current });
    } else {
      const current = this.views[cellId]?.volumeStatus?.invert ?? false;
      target.runtime.volumeRenderer?.setInvert?.(!current);
    }
  }

  /** Rotates a 2D cell by a multiple of 90° (positive is clockwise). */
  rotate(degrees: number, cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target || target.cell.mode !== '2d') return;
    const current = this.views[cellId]?.status?.rotation ?? 0;
    this.gridRenderer?.setTransform(cellId, { rotation: (((current + degrees) % 360) + 360) % 360 });
  }

  flip(direction: 'horizontal' | 'vertical', cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target || target.cell.mode !== '2d') return;
    const status = this.views[cellId]?.status ?? { ...IDENTITY_TRANSFORM };
    this.gridRenderer?.setTransform(
      cellId,
      direction === 'horizontal' ? { flipHorizontal: !status.flipHorizontal } : { flipVertical: !status.flipVertical },
    );
  }

  resetView(cellId = this.state.activeCellId): void {
    const target = this.displayed(cellId);
    if (!target) return;
    if (target.cell.mode === '2d') this.gridRenderer?.resetView(cellId);
    else target.runtime.volumeRenderer?.resetView();
    this.patchCell(cellId, { presetId: undefined });
  }

  clearMeasurements(cellId?: string): void {
    this.gridRenderer?.clearMeasurements(cellId);
  }

  // ── Sync, overlays and cine ────────────────────────────────────────────

  setSync(patch: Partial<SyncOptions>): void {
    const sync = { ...this.state.sync, ...patch };
    this.setState({ sync });
    this.gridRenderer?.setSync(sync);
  }

  /** Moves the other 2D cells to the image matching `imageIndex` of the active cell. */
  private syncScroll(sourceCellId: string, imageIndex: number): void {
    if (!this.state.sync.scroll || sourceCellId !== this.state.activeCellId) return;
    const source = this.cell(sourceCellId);
    const sourceSeries = this.findSeries(source?.seriesInstanceUid);
    if (!sourceSeries) return;
    const sourceGeometry = sliceGeometry(sourceSeries);
    const sourceCount = this.views[sourceCellId]?.status?.imageCount ?? 1;
    for (const cell of this.state.cells) {
      if (cell.id === sourceCellId || cell.mode !== '2d' || cell.phase !== 'displayed') continue;
      const series = this.findSeries(cell.seriesInstanceUid);
      const count = this.views[cell.id]?.status?.imageCount ?? 0;
      if (!series || count < 2) continue;
      const target = matchSlice(sourceGeometry, imageIndex, sourceCount, sliceGeometry(series), count);
      if (target !== this.views[cell.id]?.status?.imageIndex) this.gridRenderer?.setImageIndex(cell.id, target);
    }
  }

  setReferenceLines(enabled: boolean): void {
    this.setState({ referenceLines: enabled });
    this.applyReferenceLines();
  }

  private applyReferenceLines(): void {
    for (const runtime of this.runtime.values()) runtime.volumeRenderer?.setCrosshairsVisible?.(this.state.referenceLines);
    const renderer = this.gridRenderer;
    if (!renderer) return;
    const active = this.activeCell;
    renderer.setReferenceLines(this.state.referenceLines && active.mode === '2d' ? active.id : undefined);
  }

  /** Shows or hides measurements and arrow notes without deleting them. */
  setAnnotationVisibility(patch: { measurements?: boolean; annotations?: boolean }): void {
    const showMeasurements = patch.measurements ?? this.state.showMeasurements;
    const showAnnotations = patch.annotations ?? this.state.showAnnotations;
    this.setState({ showMeasurements, showAnnotations });
    this.gridRenderer?.setAnnotationVisibility({ measurements: showMeasurements, annotations: showAnnotations });
  }

  setCineLoop(loop: boolean): void {
    this.setState({ cineLoop: loop });
  }

  /** Restores the view of every displayed viewport (measurements are kept). */
  resetAll(): void {
    for (const cell of this.state.cells) if (cell.phase === 'displayed') this.resetView(cell.id);
  }

  setOverlay(enabled: boolean): void {
    this.setState({ overlay: enabled });
  }

  setPatientInfo(enabled: boolean): void {
    this.setState({ patientInfo: enabled });
  }

  /** Starts or stops cine playback of a cell. */
  toggleCine(cellId = this.state.activeCellId, playing?: boolean): void {
    const cell = this.cell(cellId);
    if (!cell) return;
    const next = playing ?? !cell.playing;
    if (next && cell.phase !== 'displayed') return;
    this.patchCell(cellId, { playing: next });
    this.updateCine();
  }

  setCineFps(fps: number): void {
    const cineFps = Math.min(60, Math.max(1, Math.round(fps)));
    this.setState({ cineFps });
    if (this.cineTimer) {
      this.stopCineTimer();
      this.updateCine();
    }
  }

  private updateCine(): void {
    const anyPlaying = this.state.cells.some((cell) => cell.playing && cell.phase === 'displayed');
    if (!anyPlaying) {
      this.stopCineTimer();
      return;
    }
    if (this.cineTimer) return;
    this.cineTimer = setInterval(() => {
      for (const cell of this.state.cells) {
        if (!cell.playing || cell.phase !== 'displayed') continue;
        if (!this.state.cineLoop && this.atLastImage(cell)) {
          this.toggleCine(cell.id, false);
          continue;
        }
        this.scrollBy(1, cell.id, true);
      }
    }, 1000 / this.state.cineFps);
  }

  private atLastImage(cell: CellState): boolean {
    const view = this.views[cell.id];
    if (cell.mode === '2d') return Boolean(view?.status && view.status.imageIndex >= view.status.imageCount - 1);
    const plane = this.activePlane(cell.id);
    const status = view?.volumeStatus?.planes[plane];
    return Boolean(status && status.index >= status.count - 1);
  }

  private stopCineTimer(): void {
    if (this.cineTimer) clearInterval(this.cineTimer);
    this.cineTimer = undefined;
  }

  /**
   * A PNG data URL of the middle image of a series, for the series list. Rendered one
   * at a time and kept for the session.
   */
  getThumbnail(seriesInstanceUid: string, size = 128): Promise<string | undefined> {
    const cached = this.thumbnails.get(seriesInstanceUid);
    if (cached) return cached;
    const series = this.findSeries(seriesInstanceUid);
    if (!series || this.disposed) return Promise.resolve(undefined);
    const frames = series.instances.flatMap((instance) =>
      instance.header.numberOfFrames > 1
        ? Array.from({ length: instance.header.numberOfFrames }, (_, frame) => ({ instance, frame: frame + 1 }))
        : [{ instance, frame: undefined as number | undefined }],
    );
    const middle = frames[Math.floor(frames.length / 2)];
    if (!middle) return Promise.resolve(undefined);
    const studies = this.studies;
    const task = this.thumbnailQueue
      .then(async () => {
        if (this.disposed || this.studies !== studies) return undefined;
        const renderer = await this.getGridRenderer();
        return renderer.renderThumbnail(middle.instance.file, middle.frame, size);
      })
      .catch(() => undefined);
    this.thumbnailQueue = task;
    this.thumbnails.set(seriesInstanceUid, task);
    return task;
  }

  // ── Queries ────────────────────────────────────────────────────────────

  getSeries(seriesInstanceUid: string | undefined): SeriesSummary | undefined {
    return this.findSeries(seriesInstanceUid)?.summary;
  }

  /** The file (and frame) of the image a cell is showing: for the overlay and the tag map. */
  getCellImage(cellId = this.state.activeCellId): { instance: LocalInstance; frame?: number; series: SeriesSummary } | undefined {
    const cell = this.cell(cellId);
    const series = this.findSeries(cell?.seriesInstanceUid);
    if (!cell || !series) return undefined;
    const view = this.views[cellId];
    if (cell.mode === '3d') {
      const frames = series.volumeFrames;
      const axial = view?.volumeStatus?.planes.axial;
      if (!frames?.length) return undefined;
      const entry = frames[Math.min(frames.length - 1, Math.max(0, axial?.index ?? 0))]!;
      return { instance: entry.instance, frame: entry.frame, series: series.summary };
    }
    const index = view?.status?.imageIndex ?? 0;
    let remaining = index;
    for (const instance of series.instances) {
      const frames = instance.header.numberOfFrames;
      if (remaining < frames) return { instance, frame: frames > 1 ? remaining + 1 : undefined, series: series.summary };
      remaining -= frames;
    }
    const last = series.instances[series.instances.length - 1];
    return last ? { instance: last, series: series.summary } : undefined;
  }

  /** Every instance of a series, for the tag map's file picker. */
  getInstances(seriesInstanceUid: string | undefined): LocalInstance[] {
    return this.findSeries(seriesInstanceUid)?.instances ?? [];
  }

  measurementCount(cellId = this.state.activeCellId): number {
    return this.gridRenderer?.measurementCount(cellId) ?? 0;
  }
}

/** Panes shown by an MPR arrangement, in slot order (primary pane first). */
export function visibleViews(layout: MprLayout, order: readonly VolumeView[] = VOLUME_VIEWS): VolumeView[] {
  return order.slice(0, MPR_SLOTS[layout] ?? 4);
}

const MEASURING_TOOLS = new Set<WorkstationTool>(['length', 'angle', 'cobbAngle', 'bidirectional', 'rectangleRoi', 'ellipticalRoi', 'probe']);

function sameCellStatus(a: CellStatus | undefined, b: CellStatus | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.imageIndex === b.imageIndex &&
    a.imageCount === b.imageCount &&
    a.windowWidth === b.windowWidth &&
    a.windowCenter === b.windowCenter &&
    a.zoom === b.zoom &&
    a.imageFailed === b.imageFailed &&
    a.rotation === b.rotation &&
    a.flipHorizontal === b.flipHorizontal &&
    a.flipVertical === b.flipVertical &&
    a.invert === b.invert
  );
}

interface SliceGeometry {
  frameOfReferenceUid?: string;
  normal?: [number, number, number];
  /** Position of each image along the normal, in display order; undefined when unknown. */
  locations?: number[];
}

const geometryCache = new WeakMap<LocalSeries, SliceGeometry>();

/** Slice positions of a series along its normal, from the headers read at scan time. */
export function sliceGeometry(series: LocalSeries): SliceGeometry {
  const cached = geometryCache.get(series);
  if (cached) return cached;
  const head = series.instances[0]?.header;
  const orientation = head?.imageOrientationPatient;
  let result: SliceGeometry = { frameOfReferenceUid: head?.frameOfReferenceUid };
  if (orientation) {
    const [rx, ry, rz, cx, cy, cz] = orientation;
    const normal: [number, number, number] = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
    const locations: number[] = [];
    let complete = true;
    for (const instance of series.instances) {
      const frames = instance.header.numberOfFrames;
      for (let frame = 0; frame < frames; frame += 1) {
        const position = instance.header.framePositions?.[frame] ?? (frames === 1 ? instance.header.imagePositionPatient : undefined);
        if (!position) {
          complete = false;
          break;
        }
        locations.push(position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2]);
      }
      if (!complete) break;
    }
    result = { ...result, normal, locations: complete ? locations : undefined };
  }
  geometryCache.set(series, result);
  return result;
}

/**
 * Index in the target stack that matches `index` in the source: the nearest slice by
 * position when both share a frame of reference and are parallel, otherwise the same
 * relative position.
 */
export function matchSlice(
  source: SliceGeometry,
  index: number,
  sourceCount: number,
  target: SliceGeometry,
  targetCount: number,
): number {
  const parallel =
    source.normal &&
    target.normal &&
    Math.abs(source.normal[0] * target.normal[0] + source.normal[1] * target.normal[1] + source.normal[2] * target.normal[2]) > 0.99;
  const location = source.locations?.[index];
  if (
    parallel &&
    location !== undefined &&
    target.locations?.length === targetCount &&
    source.frameOfReferenceUid &&
    source.frameOfReferenceUid === target.frameOfReferenceUid
  ) {
    const sign = source.normal!.reduce((sum, value, axis) => sum + value * target.normal![axis]!, 0) < 0 ? -1 : 1;
    let best = 0;
    let bestDistance = Infinity;
    target.locations.forEach((value, candidate) => {
      const distance = Math.abs(value * sign - location);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    });
    return best;
  }
  if (sourceCount <= 1) return 0;
  return Math.round((index / (sourceCount - 1)) * (targetCount - 1));
}
