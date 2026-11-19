import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { DEFAULT_CODEC_BASE_PATH } from '../core/assetPaths';
import { collectDroppedFiles, sortByPath } from '../core/collectFiles';
import type { DicomViewerError } from '../core/errors';
import { createCornerstoneVolumeRenderer } from '../core/renderer';
import type { SeriesSummary, StudySummary } from '../core/studyModel';
import {
  DEFAULT_FEATURES,
  WorkstationContext,
  type SizeClass,
  type WorkstationContextValue,
  type WorkstationFeatures,
} from './context';
import {
  ActionButton,
  AllControls,
  CineControls,
  FileControls,
  ImageControls,
  LayoutControls,
  MeasurementTools,
  NavigationTools,
  SeriesList,
  ViewControls,
  WindowControls,
} from './controls';
import { captureViewport, downloadBlob } from './exportImage';
import { createCornerstoneGridRenderer, type CreateGridRenderer, type WorkstationTool } from './gridRenderer';
import { Icon, type IconName } from './icons';
import { resolveWorkstationLabels, type WorkstationLabels } from './labels';
import type { GridLayout } from './layouts';
import { TagMapPanel } from './TagMapPanel';
import { ViewportCell } from './ViewportCell';
import type { WindowPreset } from './windowPresets';
import {
  WorkstationSession,
  type CellMode,
  type WorkstationEvents,
  type WorkstationState,
  type WorkstationTab,
} from './workstationSession';

export interface DicomWorkstationProps {
  /** Overrides for any user-visible text. See `defaultWorkstationLabels`. */
  labels?: Partial<WorkstationLabels>;
  /** Local files from the host. Opened whenever a new array is passed. */
  files?: readonly Blob[];
  /** Where codec files are served. Defaults to `/mihawk-dicom-viewer/codecs/`. */
  codecBasePath?: string;
  maxWebWorkers?: number;
  /** Set false to leave out the rotatable 3D view in 3D viewports. Read once. */
  volumeRendering?: boolean;
  /** Largest decoded volume a 3D viewport allocates. Read once. */
  maxVolumeBytes?: number;
  /** Viewport grid on mount. Default 1 × 1. Read once. */
  initialGrid?: GridLayout;
  /** Tool on mount. Default window/level. Read once. */
  initialTool?: WorkstationTool;
  /** Brightness and contrast presets. Defaults to `DEFAULT_WINDOW_PRESETS`. Read once. */
  windowPresets?: readonly WindowPreset[];
  /** Turn parts of the app off. Every feature is on by default. */
  features?: Partial<WorkstationFeatures>;
  /** Set false to never show patient names, IDs or birth dates (the toggle is hidden). Default true. */
  allowPatientInfo?: boolean;
  /** Title in the header. Pass null to hide it. */
  title?: ReactNode;
  /** Content at the start of the header (for example a back button or logo). */
  headerStart?: ReactNode;
  /** Content at the end of the header (for example the host's account menu). */
  headerEnd?: ReactNode;
  /** `auto` follows the host's colour scheme. Default `dark`. */
  theme?: 'dark' | 'light' | 'auto';
  /**
   * `auto` switches to the side menu below 1024 px of component width. `sidemenu` and
   * `toolbar` force one presentation. Default `auto`.
   */
  menuMode?: 'auto' | 'sidemenu' | 'toolbar';
  onStateChange?: (state: WorkstationState) => void;
  onStudiesLoaded?: (studies: StudySummary[]) => void;
  onSeriesDisplayed?: (series: SeriesSummary, cellId: string, mode: CellMode) => void;
  onError?: (error: DicomViewerError, cellId?: string) => void;
  className?: string;
  style?: CSSProperties;
  /** @internal Test seam. */
  createGridRenderer?: CreateGridRenderer;
  /** @internal Test seam. */
  createVolumeRenderer?: typeof createCornerstoneVolumeRenderer;
}

/** Imperative API for hosts. */
export interface DicomWorkstationHandle {
  openFiles(files: readonly Blob[]): Promise<void>;
  /** Shows a series in a cell (by zero-based grid position; default: the active cell). */
  loadSeries(seriesInstanceUid: string, cellIndex?: number, options?: { mode?: CellMode }): Promise<void>;
  setGrid(grid: GridLayout): void;
  setTool(tool: WorkstationTool): void;
  /** Applies a brightness and contrast preset to the active cell. */
  applyPreset(presetId: string): boolean;
  setTab(tab: WorkstationTab): void;
  /** Saves the active viewport as a PNG, or returns it when `download` is false. */
  exportImage(options?: { download?: boolean }): Promise<Blob | undefined>;
  resetView(): void;
  cancel(): void;
  /** Closes every file and releases its data. Use on logout or patient switch. */
  clear(): void;
  getState(): WorkstationState;
}

const directoryInputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;

function useSizeClass(ref: RefObject<HTMLElement | null>, mode: DicomWorkstationProps['menuMode']): { size: SizeClass; wide: boolean } {
  const [size, setSize] = useState<SizeClass>('desktop');
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const width = element.getBoundingClientRect().width || window.innerWidth;
      setSize(width < 640 ? 'phone' : width < 1024 ? 'tablet' : 'desktop');
      setWide(width >= 1680);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  if (mode === 'toolbar') return { size: 'desktop', wide };
  if (mode === 'sidemenu' && size === 'desktop') return { size: 'tablet', wide: false };
  return { size, wide };
}

/** A toolbar button that opens a panel. Closes on Escape or a click outside. */
function Popover({ icon, label, children, testId, wide }: { icon: IconName; label: string; children: ReactNode; testId?: string; wide?: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);
  return (
    <div
      className="mihawk-ws-popover"
      ref={wrapper}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          wrapper.current?.querySelector<HTMLButtonElement>('button')?.focus();
        }
      }}
    >
      <button
        type="button"
        className="mihawk-ws-action mihawk-ws-popover-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} />
        <span className="mihawk-ws-action-label">{label}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div id={panelId} className="mihawk-ws-popover-panel" data-wide={wide || undefined} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

export const DicomWorkstation = forwardRef<DicomWorkstationHandle, DicomWorkstationProps>(function DicomWorkstation(props, ref) {
  const { files, codecBasePath = DEFAULT_CODEC_BASE_PATH, maxWebWorkers, volumeRendering, maxVolumeBytes } = props;
  const labels = useMemo(() => resolveWorkstationLabels(props.labels), [props.labels]);
  const features = useMemo<WorkstationFeatures>(() => ({ ...DEFAULT_FEATURES, ...props.features }), [props.features]);
  const allowPatientInfo = props.allowPatientInfo !== false;

  const eventsRef = useRef<WorkstationEvents>({});
  eventsRef.current = {
    onStateChange: props.onStateChange,
    onStudiesLoaded: props.onStudiesLoaded,
    onSeriesDisplayed: props.onSeriesDisplayed,
    onError: props.onError,
  };

  const [session] = useState(
    () =>
      new WorkstationSession({
        createGridRenderer: props.createGridRenderer ?? createCornerstoneGridRenderer,
        createVolumeRenderer: props.createVolumeRenderer ?? createCornerstoneVolumeRenderer,
        rendererConfig: { codecBasePath, maxWebWorkers, volumeRendering, maxVolumeBytes },
        getEvents: () => eventsRef.current,
        initialGrid: props.initialGrid,
        initialTool: props.initialTool,
        windowPresets: props.windowPresets,
      }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const views = useSyncExternalStore(session.subscribeViews, session.getViews, session.getViews);

  useEffect(() => {
    session.revive();
    return () => session.dispose();
  }, [session]);

  useEffect(() => {
    if (files && files.length > 0) void session.openFiles(files);
  }, [files, session]);

  useEffect(() => {
    if (!allowPatientInfo && state.patientInfo) session.setPatientInfo(false);
  }, [allowPatientInfo, state.patientInfo, session]);

  const rootRef = useRef<HTMLElement>(null);
  const { size, wide } = useSizeClass(rootRef, props.menuMode);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (size === 'desktop') setMenuOpen(false);
  }, [size]);

  // ── Files ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const openSelection = useCallback(
    (list: FileList | readonly File[] | null) => {
      const selected = sortByPath(Array.from(list ?? []));
      if (selected.length > 0) void session.openFiles(selected);
    },
    [session],
  );
  const [dragActive, setDragActive] = useState(false);
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!features.openFiles || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    setDragActive(false);
    if (features.openFiles) openSelection(await collectDroppedFiles(event.dataTransfer));
  };

  // ── Fullscreen ──
  const [isFullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    else void root.requestFullscreen?.().catch(() => undefined);
  }, []);

  // ── Export ──
  const captureActive = useCallback(async (): Promise<Blob | undefined> => {
    const root = rootRef.current;
    const cell = session.activeCell;
    const cellElement = root?.querySelector<HTMLElement>(`[data-cell-id="${cell.id}"]`);
    if (!cellElement || cell.phase !== 'displayed') return undefined;
    if (cell.mode === '3d') {
      const pane = views[cell.id]?.activeView ?? 'axial';
      const target = cellElement.querySelector<HTMLElement>(`[data-testid="mihawk-ws-pane-${pane}"]`);
      return target ? captureViewport(target) : undefined;
    }
    const target = cellElement.querySelector<HTMLElement>('.mihawk-ws-cell-viewport');
    return target ? captureViewport(target, cellElement.querySelector<HTMLElement>('.mihawk-ws-overlay')) : undefined;
  }, [session, views]);
  const exportImage = useCallback(async () => {
    const blob = await captureActive();
    const series = session.getSeries(session.activeCell.seriesInstanceUid);
    if (blob) downloadBlob(blob, labels.exportFileName(series?.seriesNumber));
  }, [captureActive, session, labels]);

  useImperativeHandle(
    ref,
    () => ({
      openFiles: (selected) => session.openFiles(selected),
      loadSeries: (uid, cellIndex, options) =>
        session.loadSeries(uid, cellIndex === undefined ? undefined : session.getState().cells[cellIndex]?.id, options),
      setGrid: (grid) => session.setGrid(grid),
      setTool: (tool) => session.setTool(tool),
      applyPreset: (presetId) => session.applyPreset(presetId),
      setTab: (tab) => session.setTab(tab),
      exportImage: async (options) => {
        const blob = await captureActive();
        if (blob && options?.download !== false) {
          downloadBlob(blob, labels.exportFileName(session.getSeries(session.activeCell.seriesInstanceUid)?.seriesNumber));
        }
        return blob;
      },
      resetView: () => session.resetView(),
      cancel: () => session.cancel(),
      clear: () => session.clear(),
      getState: () => session.getState(),
    }),
    [session, captureActive, labels],
  );

  // ── Keyboard shortcuts ──
  const shortcutTools = useMemo(() => {
    const map = new Map<string, WorkstationTool>();
    for (const [tool, key] of Object.entries(labels.toolShortcuts)) if (key) map.set(key.toLowerCase(), tool as WorkstationTool);
    return map;
  }, [labels.toolShortcuts]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (menuOpen) {
        setMenuOpen(false);
        event.stopPropagation();
      } else if (state.phase === 'scanning' || state.cells.some((cell) => cell.phase === 'loading')) {
        session.cancel();
      }
      return;
    }
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || state.tab !== 'viewer') return;
    if (target.closest('input, textarea, select, [contenteditable="true"], .mihawk-ws-sidemenu')) return;
    const key = event.key;
    const lower = key.toLowerCase();
    const tool = shortcutTools.get(lower);
    const preset = session.windowPresets.find((item) => item.shortcut === key);
    if (tool && (tool !== 'crosshairs' || session.activeCell.mode === '3d')) session.setTool(tool);
    else if (preset && features.presets) session.applyPreset(preset.id);
    else if (lower === 'i') session.toggleInvert();
    else if (key === '[' && features.transforms) session.rotate(-90);
    else if (key === ']' && features.transforms) session.rotate(90);
    else if (lower === 'h' && features.transforms) session.flip('horizontal');
    else if (lower === 'v' && features.transforms) session.flip('vertical');
    else if (key === ' ' && features.cine) session.toggleCine();
    else if (lower === 'f' && features.fullscreen) toggleFullscreen();
    else if (lower === 'r') session.resetView();
    else if (key === '+' || key === '=') session.zoomBy(1.2);
    else if (key === '-' || key === '_') session.zoomBy(1 / 1.2);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const context: WorkstationContextValue = {
    session,
    state,
    views,
    labels,
    features,
    allowPatientInfo,
    size,
    isFullscreen,
    openFilePicker: () => fileInputRef.current?.click(),
    openFolderPicker: () => folderInputRef.current?.click(),
    exportImage,
    toggleFullscreen,
    afterAction: () => {
      if (size === 'phone') setMenuOpen(false);
    },
  };

  const hasStudies = state.studies.length > 0;
  const compact = size !== 'desktop';
  const tabs: WorkstationTab[] = features.map ? ['viewer', 'map'] : ['viewer'];
  const title = props.title === undefined ? labels.appTitle : props.title;
  const rootClass = ['mihawk-ws', props.className].filter(Boolean).join(' ');
  const menuId = useId();
  const tabIds = { viewer: useId(), map: useId() };
  const activeCellIndex = state.cells.findIndex((cell) => cell.id === state.activeCellId);

  const tabList = tabs.length > 1 && (
    <div className="mihawk-ws-tabs" role="tablist" aria-label={labels.tabList}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={tabIds[tab]}
          className="mihawk-ws-tab"
          aria-selected={state.tab === tab}
          data-testid={`mihawk-ws-tab-${tab}`}
          onClick={() => session.setTab(tab)}
        >
          <Icon name={tab === 'viewer' ? 'layout' : 'map'} size={16} />
          <span>{labels.tabs[tab]}</span>
        </button>
      ))}
    </div>
  );

  return (
    <WorkstationContext.Provider value={context}>
      <section
        ref={rootRef}
        className={rootClass}
        style={props.style}
        data-size={size}
        data-wide={wide || undefined}
        data-theme={props.theme ?? 'dark'}
        aria-label={labels.viewerRegion}
        onKeyDown={onKeyDown}
      >
        <header className="mihawk-ws-header">
          {compact && (
            <button
              type="button"
              className="mihawk-ws-action mihawk-ws-action-icon"
              aria-label={labels.menu}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              data-testid="mihawk-ws-menu-button"
              onClick={() => setMenuOpen(true)}
            >
              <Icon name="menu" />
            </button>
          )}
          {props.headerStart}
          {title !== null && <div className="mihawk-ws-title">{title}</div>}
          {tabList}
          <div className="mihawk-ws-toolbar" role="toolbar" aria-label={labels.toolbar}>
            {size === 'desktop' && (
              <>
                {features.openFiles && (
                  <Popover icon="folder" label={labels.fileGroup} testId="mihawk-ws-files-menu">
                    <FileControls />
                  </Popover>
                )}
                {hasStudies && state.tab === 'viewer' && (
                  <>
                    {(features.layouts || features.mpr) && (
                      <Popover icon="layout" label={labels.layoutSelector} testId="mihawk-ws-layout-menu" wide>
                        <LayoutControls />
                      </Popover>
                    )}
                    <span className="mihawk-ws-toolbar-divider" />
                    <NavigationTools iconOnly />
                    {features.measurements && (
                      <Popover icon="ruler" label={labels.measurementTools} testId="mihawk-ws-measure-menu" wide>
                        <MeasurementTools />
                      </Popover>
                    )}
                    {features.presets && (
                      <Popover icon="sun" label={labels.windowGroup} testId="mihawk-ws-window-menu" wide>
                        <WindowControls />
                      </Popover>
                    )}
                    <Popover icon="invert" label={labels.imageGroup} testId="mihawk-ws-image-menu" wide>
                      <ImageControls />
                    </Popover>
                    {features.cine && (
                      <Popover icon="play" label={labels.cine} testId="mihawk-ws-cine-menu">
                        <CineControls />
                      </Popover>
                    )}
                    <Popover icon="info" label={labels.viewGroup} testId="mihawk-ws-view-menu">
                      <ViewControls />
                    </Popover>
                    {features.export && (
                      <ActionButton icon="download" label={labels.exportImage} iconOnly onClick={() => void exportImage()} testId="mihawk-ws-export" />
                    )}
                  </>
                )}
                {features.fullscreen && (
                  <ActionButton
                    icon={isFullscreen ? 'exitFullscreen' : 'fullscreen'}
                    label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
                    shortcut="F"
                    iconOnly
                    onClick={toggleFullscreen}
                  />
                )}
              </>
            )}
            {size === 'tablet' && hasStudies && state.tab === 'viewer' && (
              <>
                <NavigationTools iconOnly />
                {features.presets && (
                  <ActionButton
                    icon="wand"
                    label={labels.presets.auto ?? 'Auto'}
                    iconOnly
                    disabled={session.activeCell.phase !== 'displayed'}
                    onClick={() => session.applyPreset('auto')}
                  />
                )}
              </>
            )}
          </div>
          {props.headerEnd}
        </header>

        <div className="mihawk-ws-body">
          {size === 'desktop' && features.seriesPanel && hasStudies && (
            <aside className="mihawk-ws-sidebar">
              <SeriesList />
            </aside>
          )}
          <div
            className="mihawk-ws-main"
            role={tabs.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={tabs.length > 1 ? tabIds[state.tab] : undefined}
            data-drag-active={dragActive || undefined}
            onDragOver={onDragOver}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => void onDrop(event)}
          >
            <div
              className="mihawk-ws-grid"
              data-testid="mihawk-ws-grid"
              style={{
                gridTemplateColumns: `repeat(${state.grid.columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${state.grid.rows}, minmax(0, 1fr))`,
              }}
            >
              {state.cells.map((cell, index) => (
                <ViewportCell key={cell.id} cell={cell} index={index} />
              ))}
            </div>

            {state.phase === 'idle' && (
              <div className="mihawk-ws-dropzone">
                <Icon name="folder" size={40} />
                <p className="mihawk-ws-dropzone-title">{labels.dropZoneTitle}</p>
                {features.openFiles && <p>{labels.dropZoneHint}</p>}
                {features.openFiles && (
                  <div className="mihawk-ws-row mihawk-ws-row-center">
                    <ActionButton icon="file" label={labels.openFiles} onClick={() => fileInputRef.current?.click()} testId="mihawk-ws-open-files" />
                    <ActionButton icon="folder" label={labels.openFolder} onClick={() => folderInputRef.current?.click()} />
                  </div>
                )}
                <p className="mihawk-ws-muted">{labels.privacyNote}</p>
              </div>
            )}

            {state.phase === 'scanning' && (
              <div className="mihawk-ws-dropzone" role="status">
                <progress
                  className="mihawk-ws-progress"
                  max={Math.max(1, state.progress?.total ?? 1)}
                  value={state.progress?.processed ?? 0}
                  aria-label={labels.scanning(state.progress?.processed ?? 0, state.progress?.total ?? 0)}
                />
                <p>{labels.scanning(state.progress?.processed ?? 0, state.progress?.total ?? 0)}</p>
                <button type="button" className="mihawk-ws-action" onClick={() => session.cancel()}>
                  {labels.cancel}
                </button>
              </div>
            )}

            {state.phase === 'error' && state.error && (
              <div className="mihawk-ws-dropzone mihawk-ws-error" role="alert">
                <p>{labels.errors[state.error.code]}</p>
                {features.openFiles && (
                  <ActionButton icon="file" label={labels.openFiles} onClick={() => fileInputRef.current?.click()} />
                )}
              </div>
            )}

            {dragActive && <div className="mihawk-ws-drop-indicator">{labels.dropZoneTitle}</div>}

            {state.tab === 'map' && features.map && <TagMapPanel />}
          </div>
        </div>

        <footer className="mihawk-ws-status" role="status" aria-live="polite">
          {hasStudies && activeCellIndex >= 0 && state.cells.length > 1 && (
            <span>{labels.activeCell(activeCellIndex + 1)}</span>
          )}
          <span>{labels.tools[state.tool]}</span>
          {state.skipped.length > 0 && <span>{labels.skippedFiles(state.skipped.length)}</span>}
          <span className="mihawk-ws-status-spacer" />
          <span className="mihawk-ws-muted">{labels.privacyNote}</span>
        </footer>

        {compact && (
          <>
            <div className="mihawk-ws-backdrop" data-open={menuOpen || undefined} onClick={() => setMenuOpen(false)} />
            <aside
              id={menuId}
              className="mihawk-ws-sidemenu"
              data-open={menuOpen || undefined}
              aria-label={labels.menu}
              aria-hidden={!menuOpen || undefined}
              inert={!menuOpen || undefined}
              data-testid="mihawk-ws-sidemenu"
            >
              <div className="mihawk-ws-sidemenu-header">
                <span className="mihawk-ws-title">{title}</span>
                <button
                  type="button"
                  className="mihawk-ws-action mihawk-ws-action-icon"
                  aria-label={labels.closeMenu}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name="close" />
                </button>
              </div>
              <AllControls />
            </aside>
          </>
        )}

        <input
          ref={fileInputRef}
          className="mihawk-ws-hidden-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          data-testid="mihawk-ws-file-input"
          onChange={(event) => {
            openSelection(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={folderInputRef}
          className="mihawk-ws-hidden-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          data-testid="mihawk-ws-folder-input"
          {...directoryInputProps}
          onChange={(event) => {
            openSelection(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </section>
    </WorkstationContext.Provider>
  );
});
