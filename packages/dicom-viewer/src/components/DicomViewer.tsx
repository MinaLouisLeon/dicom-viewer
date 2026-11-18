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
} from 'react';

import { DEFAULT_CODEC_BASE_PATH } from '../core/assetPaths';
import { collectDroppedFiles, sortByPath } from '../core/collectFiles';
import type { DicomViewerError } from '../core/errors';
import {
  VIEWER_TOOLS,
  VOLUME_TOOLS,
  VOLUME_VIEWS,
  createCornerstoneRenderer,
  createCornerstoneVolumeRenderer,
  type ViewerLayout,
  type ViewerTool,
  type VolumePlane,
  type VolumeView,
} from '../core/renderer';
import type { SeriesSummary, StudySummary } from '../core/studyModel';
import { ViewerSession, type ViewerSessionEvents, type ViewerState } from '../core/viewerSession';
import { resolveLabels, type DicomViewerLabels } from '../i18n/labels';

export interface DicomViewerProps {
  /** Extra class names for the root element. */
  className?: string;
  style?: CSSProperties;
  /** Overrides for any user-visible text. */
  labels?: Partial<DicomViewerLabels>;
  /**
   * Where the codec `.wasm` files are served. The `mivoDicomViewer()` Vite plugin serves
   * them at `<base>mivo-dicom-viewer/codecs/`. Applies page-wide; the first viewer wins.
   * @default '/mivo-dicom-viewer/codecs/'
   */
  codecBasePath?: string;
  /** Upper bound on decode workers. Defaults to half the logical CPU count. */
  maxWebWorkers?: number;
  /**
   * Tool bound to the primary mouse button and the arrow keys when the viewer mounts.
   * Read once; use the handle's `setTool` to change it later.
   * @default 'windowLevel'
   */
  initialTool?: ViewerTool;
  /**
   * Preferred layout when a series opens. Series that cannot form a volume (for
   * example single radiographs) always open in 2D. Read once; use the layout buttons
   * or the handle's `setLayout` later.
   * @default '2d'
   */
  initialLayout?: ViewerLayout;
  /**
   * Set false to leave out the rotatable 3D view on low-end devices. The 3D layout then
   * shows only the linked cross-sections. Read once.
   * @default true
   */
  volumeRendering?: boolean;
  /**
   * Largest decoded volume, in bytes, the 3D layout will allocate. Larger series fail
   * with `VOLUME_TOO_LARGE` and can still open in 2D. Read once.
   * @default 2 GiB
   */
  maxVolumeBytes?: number;
  /**
   * Local files supplied by the host app (for example from its own drop target).
   * Opened whenever a new array is passed. The built-in buttons work without this.
   */
  files?: readonly Blob[];
  onStateChange?: (state: ViewerState) => void;
  onStudiesLoaded?: (studies: StudySummary[]) => void;
  onSeriesDisplayed?: (series: SeriesSummary, layout: ViewerLayout) => void;
  onError?: (error: DicomViewerError) => void;
}

/** Imperative controls, for example to close the study when the user logs out. */
export interface DicomViewerHandle {
  openFiles(files: readonly Blob[]): Promise<void>;
  /** Opens a series, in `layout` if given (3D fails with `VOLUME_UNSUPPORTED` for series that cannot form a volume). */
  selectSeries(seriesInstanceUid: string, options?: { layout?: ViewerLayout }): Promise<void>;
  /** Switches the preferred layout and reopens the selected series in it. Ignored for 3D when unsupported. */
  setLayout(layout: ViewerLayout): Promise<void>;
  cancel(): void;
  /** Closes the current files and releases their data. */
  clear(): void;
  getState(): ViewerState;
  /** Selects the tool for the primary mouse button and the arrow keys. */
  setTool(tool: ViewerTool): void;
  /** Restores the initial view of the displayed series. In 3D this also centres the cross-sections. */
  resetView(): void;
}

const directoryInputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;

const ZOOM_STEP = 1.2;
const PAN_STEP_PX = 20;
/** Multiplier applied to keyboard steps while Shift is held. */
const LARGE_STEP = 5;
/** Degrees the 3D view turns per arrow key press. */
const ROTATE_STEP_DEG = 10;

const LAYOUTS: readonly ViewerLayout[] = ['2d', '3d'];

const ARROW_DIRECTIONS: Partial<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export const DicomViewer = forwardRef<DicomViewerHandle, DicomViewerProps>(function DicomViewer(props, ref) {
  const { className, style, files, codecBasePath = DEFAULT_CODEC_BASE_PATH, maxWebWorkers } = props;
  const { volumeRendering, maxVolumeBytes } = props;
  const labels = useMemo(() => resolveLabels(props.labels), [props.labels]);

  const eventsRef = useRef<ViewerSessionEvents>({});
  eventsRef.current = {
    onStateChange: props.onStateChange,
    onStudiesLoaded: props.onStudiesLoaded,
    onSeriesDisplayed: props.onSeriesDisplayed,
    onError: props.onError,
  };

  const [session] = useState(
    () =>
      new ViewerSession({
        createRenderer: createCornerstoneRenderer,
        createVolumeRenderer: createCornerstoneVolumeRenderer,
        rendererConfig: { codecBasePath, maxWebWorkers, volumeRendering, maxVolumeBytes },
        getEvents: () => eventsRef.current,
        initialTool: props.initialTool,
        initialLayout: props.initialLayout,
      }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const viewport = useSyncExternalStore(session.subscribeViewport, session.getViewportState, session.getViewportState);

  const viewportRef = useRef<HTMLDivElement>(null);
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    const axial = axialRef.current;
    const sagittal = sagittalRef.current;
    const coronal = coronalRef.current;
    const volume = volumeRef.current;
    if (!element) return undefined;
    session.attach(element);
    if (axial && sagittal && coronal && volume) session.attachVolume({ axial, sagittal, coronal, volume });
    return () => session.detach();
  }, [session]);

  useEffect(() => {
    if (files && files.length > 0) void session.openFiles(files);
  }, [files, session]);

  useImperativeHandle(
    ref,
    () => ({
      openFiles: (selected) => session.openFiles(selected),
      selectSeries: (uid, options) => session.selectSeries(uid, options),
      setLayout: (layout) => session.setLayout(layout),
      cancel: () => session.cancel(),
      clear: () => session.clear(),
      getState: () => session.getState(),
      setTool: (tool) => session.setTool(tool),
      resetView: () => session.resetView(),
    }),
    [session],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const openSelection = useCallback(
    (list: FileList | readonly File[] | null) => {
      const selected = sortByPath(Array.from(list ?? []));
      if (selected.length > 0) void session.openFiles(selected);
    },
    [session],
  );

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      openSelection(await collectDroppedFiles(event.dataTransfer));
    },
    [openSelection],
  );

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };

  const busy = state.phase === 'scanning' || state.phase === 'loading';
  const hasStudies = state.studies.length > 0;
  const is3d = state.layout === '3d';
  const showViewport = state.phase === 'displayed' || state.phase === 'loading';
  const displayed = state.phase === 'displayed';
  const status = displayed && !is3d ? viewport.status : undefined;
  const volumeStatus = displayed && is3d ? viewport.volumeStatus : undefined;
  const imageCount = status?.imageCount ?? 0;
  const selectedSeries = state.studies
    .flatMap((study) => study.series)
    .find((series) => series.seriesInstanceUid === state.selectedSeriesUid);
  const volumeSupport = selectedSeries?.volume;
  const volumeUnsupportedText =
    volumeSupport && !volumeSupport.supported ? labels.volumeUnsupportedReasons[volumeSupport.reason] : undefined;
  /** The 3D pane the zoom buttons and readout refer to: the last one used. */
  const [activeView, setActiveView] = useState<VolumeView>('axial');
  const volumeRefs: Record<VolumeView, typeof axialRef> = {
    axial: axialRef,
    sagittal: sagittalRef,
    coronal: coronalRef,
    volume: volumeRef,
  };
  const zoomBy = (factor: number) => (is3d ? session.zoomView(activeView, factor) : session.zoomBy(factor));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && busy) {
      event.stopPropagation();
      session.cancel();
    }
  };

  const onViewportKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!displayed || event.altKey || event.ctrlKey || event.metaKey) return;
    const multiplier = event.shiftKey ? LARGE_STEP : 1;
    const pageStep = event.shiftKey ? Math.max(1, Math.round(imageCount / 10)) : 1;
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      const [x, y] = direction;
      switch (viewport.tool) {
        case 'windowLevel':
          // Right/left widens/narrows the window; up/down raises/lowers the level.
          session.adjustWindowLevel(x * multiplier, (0 - y) * multiplier);
          break;
        case 'pan':
          session.panBy(x * PAN_STEP_PX * multiplier, y * PAN_STEP_PX * multiplier);
          break;
        case 'zoom': {
          const zoomIn = x > 0 || y < 0;
          session.zoomBy((zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP) ** (event.shiftKey ? 3 : 1));
          break;
        }
        case 'scroll':
          session.scrollBy((x + y) * pageStep);
          break;
      }
    } else {
      switch (event.key) {
        case 'PageUp':
          session.scrollBy(-pageStep);
          break;
        case 'PageDown':
          session.scrollBy(pageStep);
          break;
        case 'Home':
          session.setImageIndex(0);
          break;
        case 'End':
          session.setImageIndex(imageCount - 1);
          break;
        case '+':
        case '=':
          session.zoomBy(ZOOM_STEP);
          break;
        case '-':
        case '_':
          session.zoomBy(1 / ZOOM_STEP);
          break;
        case 'r':
        case 'R':
          session.resetView();
          break;
        default:
          return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onPaneKeyDown = (view: VolumeView, event: KeyboardEvent<HTMLDivElement>) => {
    if (!volumeStatus || event.altKey || event.ctrlKey || event.metaKey) return;
    const multiplier = event.shiftKey ? LARGE_STEP : 1;
    const direction = ARROW_DIRECTIONS[event.key];
    if (view === 'volume') {
      if (direction) {
        const [x, y] = direction;
        const step = ROTATE_STEP_DEG * (event.shiftKey ? 3 : 1);
        session.rotateVolume(x * step, y * step);
      } else if (event.key === '+' || event.key === '=') session.zoomView(view, ZOOM_STEP);
      else if (event.key === '-' || event.key === '_') session.zoomView(view, 1 / ZOOM_STEP);
      else if (event.key === 'r' || event.key === 'R') session.resetView();
      else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const plane: VolumePlane = view;
    const count = volumeStatus.planes[plane].count;
    const pageStep = event.shiftKey ? Math.max(1, Math.round(count / 10)) : 1;
    if (direction) {
      const [x, y] = direction;
      switch (viewport.tool) {
        case 'crosshairs':
          session.moveCrosshair(plane, x * multiplier, y * multiplier);
          break;
        case 'windowLevel':
          session.adjustWindowLevel(x * multiplier, (0 - y) * multiplier);
          break;
        case 'pan':
          session.panView(plane, x * PAN_STEP_PX * multiplier, y * PAN_STEP_PX * multiplier);
          break;
        case 'zoom': {
          const zoomIn = x > 0 || y < 0;
          session.zoomView(plane, (zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP) ** (event.shiftKey ? 3 : 1));
          break;
        }
        case 'scroll':
          session.scrollPlane(plane, (x + y) * pageStep);
          break;
      }
    } else {
      switch (event.key) {
        case 'PageUp':
          session.scrollPlane(plane, -pageStep);
          break;
        case 'PageDown':
          session.scrollPlane(plane, pageStep);
          break;
        case 'Home':
          session.setSliceIndex(plane, 0);
          break;
        case 'End':
          session.setSliceIndex(plane, count - 1);
          break;
        case '+':
        case '=':
          session.zoomView(plane, ZOOM_STEP);
          break;
        case '-':
        case '_':
          session.zoomView(plane, 1 / ZOOM_STEP);
          break;
        case 'r':
        case 'R':
          session.resetView();
          break;
        default:
          return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const ids = {
    status: useId(),
    studies: useId(),
    viewportHelp: useId(),
    planeHelp: useId(),
    volumeHelp: useId(),
    layoutHint: useId(),
  };
  const toolList = is3d ? VOLUME_TOOLS : VIEWER_TOOLS;
  const activeZoom = is3d ? volumeStatus?.zoom[activeView] : status?.zoom;
  const windowWidth = is3d ? volumeStatus?.windowWidth : status?.windowWidth;
  const windowCenter = is3d ? volumeStatus?.windowCenter : status?.windowCenter;
  const progressValue = state.progress;
  const rootClass = ['mivo-dv', className].filter(Boolean).join(' ');

  return (
    <section className={rootClass} style={style} aria-label={labels.viewerRegion} onKeyDown={onKeyDown}>
      <div className="mivo-dv-toolbar" role="toolbar" aria-label={labels.toolbar}>
        <div className="mivo-dv-toolbar-group">
          <button type="button" className="mivo-dv-button" onClick={() => fileInputRef.current?.click()}>
            {labels.openFiles}
          </button>
          <button type="button" className="mivo-dv-button" onClick={() => folderInputRef.current?.click()}>
            {labels.openFolder}
          </button>
          {busy && (
            <button type="button" className="mivo-dv-button" onClick={() => session.cancel()}>
              {labels.cancel}
            </button>
          )}
          {(hasStudies || state.phase === 'error') && !busy && (
            <button type="button" className="mivo-dv-button" onClick={() => session.clear()}>
              {labels.clear}
            </button>
          )}
        </div>
        {hasStudies && (
          <>
            <div className="mivo-dv-toolbar-group" role="group" aria-label={labels.layoutGroup}>
              {LAYOUTS.map((layout) => {
                const unavailable = layout === '3d' && !!state.selectedSeriesUid && !volumeSupport?.supported;
                return (
                  <button
                    key={layout}
                    type="button"
                    className="mivo-dv-button"
                    aria-pressed={state.layout === layout}
                    disabled={state.phase === 'scanning' || unavailable}
                    title={unavailable ? volumeUnsupportedText : undefined}
                    aria-describedby={unavailable ? ids.layoutHint : undefined}
                    data-testid={`mivo-dv-layout-${layout}`}
                    onClick={() => void session.setLayout(layout)}
                  >
                    {labels.layouts[layout]}
                  </button>
                );
              })}
              {volumeUnsupportedText && (
                <span id={ids.layoutHint} className="mivo-dv-visually-hidden">
                  {volumeUnsupportedText}
                </span>
              )}
            </div>
            <div className="mivo-dv-toolbar-group" role="group" aria-label={labels.toolGroup}>
              {toolList.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className="mivo-dv-button"
                  aria-pressed={viewport.tool === tool}
                  disabled={!displayed}
                  onClick={() => session.setTool(tool)}
                >
                  {labels.tools[tool]}
                </button>
              ))}
            </div>
            <div className="mivo-dv-toolbar-group">
              <button
                type="button"
                className="mivo-dv-button"
                disabled={!displayed}
                onClick={() => zoomBy(ZOOM_STEP)}
              >
                {labels.zoomIn}
              </button>
              <button
                type="button"
                className="mivo-dv-button"
                disabled={!displayed}
                onClick={() => zoomBy(1 / ZOOM_STEP)}
              >
                {labels.zoomOut}
              </button>
              <button type="button" className="mivo-dv-button" disabled={!displayed} onClick={() => session.resetView()}>
                {labels.resetView}
              </button>
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          className="mivo-dv-hidden-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          data-testid="mivo-dv-file-input"
          onChange={(event) => {
            openSelection(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={folderInputRef}
          className="mivo-dv-hidden-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          data-testid="mivo-dv-folder-input"
          {...directoryInputProps}
          onChange={(event) => {
            openSelection(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </div>

      <div className="mivo-dv-body">
        {hasStudies && (
          <nav className="mivo-dv-sidebar" aria-labelledby={ids.studies}>
            <h2 className="mivo-dv-heading" id={ids.studies}>
              {labels.studiesHeading}
            </h2>
            {state.studies.map((study) => (
              <div className="mivo-dv-study" key={study.studyInstanceUid}>
                <div className="mivo-dv-study-title">
                  <span>{study.description ?? labels.untitledStudy}</span>
                  {study.date && <span className="mivo-dv-muted">{labels.formatStudyDate(study.date)}</span>}
                </div>
                <ul className="mivo-dv-series-list" aria-label={labels.seriesList}>
                  {study.series.map((series) => {
                    const selected = series.seriesInstanceUid === state.selectedSeriesUid;
                    return (
                      <li key={series.seriesInstanceUid}>
                        <button
                          type="button"
                          className="mivo-dv-series"
                          aria-pressed={selected}
                          onClick={() => void session.selectSeries(series.seriesInstanceUid)}
                        >
                          <span>
                            {labels.seriesLabel({
                              number: series.seriesNumber,
                              description: series.description,
                              modality: series.modality,
                            }) || labels.untitledSeries}
                          </span>
                          <span className="mivo-dv-muted">
                            {labels.imageCount(series.imageCount)}
                            {series.volume.supported && (
                              <span className="mivo-dv-badge" data-testid="mivo-dv-volume-badge">
                                {labels.volumeBadge}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        )}

        <div className="mivo-dv-main">
          <div
            className="mivo-dv-stage"
            data-drag-active={dragActive || undefined}
            onDragOver={onDragOver}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => void onDrop(event)}
          >
            <div
              ref={viewportRef}
              className="mivo-dv-viewport"
              data-visible={(showViewport && !is3d) || undefined}
              data-testid="mivo-dv-viewport"
              role="application"
              aria-label={labels.imageViewport}
              aria-describedby={ids.viewportHelp}
              tabIndex={displayed && !is3d ? 0 : -1}
              aria-hidden={is3d || undefined}
              onKeyDown={onViewportKeyDown}
              // The rendering library may cancel mousedown, which would otherwise focus the image.
              onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
              onContextMenu={(event) => event.preventDefault()}
            />
            <span id={ids.viewportHelp} className="mivo-dv-visually-hidden">
              {labels.imageViewportHelp}
            </span>

            <div
              className="mivo-dv-volume-grid"
              data-visible={(showViewport && is3d) || undefined}
              aria-hidden={!is3d || undefined}
            >
              {VOLUME_VIEWS.map((view) => {
                const plane = view === 'volume' ? undefined : view;
                const planeStatus = plane ? volumeStatus?.planes[plane] : undefined;
                const renderingOff = view === 'volume' && volumeStatus?.volumeRendering === false;
                return (
                  <div className="mivo-dv-pane" key={view} data-view={view} data-active={activeView === view || undefined}>
                    <div className="mivo-dv-pane-header">
                      <span className="mivo-dv-pane-title">{labels.views[view]}</span>
                      {planeStatus && planeStatus.count > 0 && (
                        <span className="mivo-dv-pane-position" data-testid={`mivo-dv-slice-${view}`}>
                          {planeStatus.index + 1} / {planeStatus.count}
                        </span>
                      )}
                    </div>
                    <div className="mivo-dv-pane-canvas">
                      <div
                        ref={volumeRefs[view]}
                        className="mivo-dv-pane-viewport"
                        data-testid={`mivo-dv-pane-${view}`}
                        role="application"
                        aria-label={labels.views[view]}
                        aria-describedby={plane ? ids.planeHelp : ids.volumeHelp}
                        tabIndex={volumeStatus && !renderingOff ? 0 : -1}
                        onKeyDown={(event) => onPaneKeyDown(view, event)}
                        onFocus={() => setActiveView(view)}
                        onPointerDown={(event) => {
                          setActiveView(view);
                          event.currentTarget.focus({ preventScroll: true });
                        }}
                        onContextMenu={(event) => event.preventDefault()}
                      />
                      {renderingOff && (
                        <div className="mivo-dv-pane-notice" role="note">
                          {labels.volumeRenderingUnavailable}
                        </div>
                      )}
                    </div>
                    {plane && planeStatus && planeStatus.count > 1 && (
                      <input
                        type="range"
                        className="mivo-dv-slider mivo-dv-pane-slider"
                        min={1}
                        max={planeStatus.count}
                        step={1}
                        value={planeStatus.index + 1}
                        aria-label={labels.sliceSlider(labels.views[view])}
                        aria-valuetext={labels.slicePosition(planeStatus.index + 1, planeStatus.count)}
                        onChange={(event) => session.setSliceIndex(plane, Number(event.currentTarget.value) - 1)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <span id={ids.planeHelp} className="mivo-dv-visually-hidden">
              {labels.planeViewportHelp}
            </span>
            <span id={ids.volumeHelp} className="mivo-dv-visually-hidden">
              {labels.volumeViewportHelp}
            </span>

            {status?.imageFailed && (
              <div className="mivo-dv-banner" role="alert">
                {labels.imageFailed(status.imageIndex + 1, status.imageCount)}
              </div>
            )}

            {state.phase === 'idle' && (
              <div className="mivo-dv-overlay mivo-dv-dropzone">
                <p className="mivo-dv-title">{labels.dropZoneTitle}</p>
                <p>{labels.dropZoneHint}</p>
                <p className="mivo-dv-muted">{labels.privacyNote}</p>
              </div>
            )}

            {busy && (
              <div className="mivo-dv-overlay" aria-describedby={ids.status}>
                {state.phase === 'scanning' && progressValue ? (
                  <progress
                    className="mivo-dv-progress"
                    max={Math.max(1, progressValue.total)}
                    value={progressValue.processed}
                    aria-label={labels.scanning(progressValue.processed, progressValue.total)}
                  />
                ) : state.phase === 'loading' && is3d && progressValue ? (
                  <progress
                    className="mivo-dv-progress"
                    max={Math.max(1, progressValue.total)}
                    value={progressValue.processed}
                    aria-label={labels.loadingVolume(progressValue.processed, progressValue.total)}
                  />
                ) : (
                  <progress className="mivo-dv-progress" aria-label={labels.loadingSeries} />
                )}
              </div>
            )}

            {state.phase === 'error' && state.error && (
              <div className="mivo-dv-overlay mivo-dv-error" role="alert">
                <p>{labels.errors[state.error.code]}</p>
                {state.error.code === 'VOLUME_UNSUPPORTED' && volumeUnsupportedText && (
                  <p className="mivo-dv-muted">{volumeUnsupportedText}</p>
                )}
                {state.error.code.startsWith('VOLUME_') && is3d && state.selectedSeriesUid && (
                  <button
                    type="button"
                    className="mivo-dv-button mivo-dv-error-action"
                    onClick={() => void session.setLayout('2d')}
                  >
                    {labels.openIn2d}
                  </button>
                )}
              </div>
            )}
          </div>

          {status && imageCount > 1 && (
            <div className="mivo-dv-slicebar" role="group" aria-label={labels.sliceControls}>
              <button
                type="button"
                className="mivo-dv-button mivo-dv-icon-button"
                aria-label={labels.previousImage}
                title={labels.previousImage}
                disabled={status.imageIndex <= 0}
                onClick={() => session.scrollBy(-1)}
              >
                <span aria-hidden="true">{'‹'}</span>
              </button>
              <input
                type="range"
                className="mivo-dv-slider"
                min={1}
                max={imageCount}
                step={1}
                value={status.imageIndex + 1}
                aria-label={labels.imageSlider}
                aria-valuetext={labels.imagePosition(status.imageIndex + 1, imageCount)}
                onChange={(event) => session.setImageIndex(Number(event.currentTarget.value) - 1)}
              />
              <button
                type="button"
                className="mivo-dv-button mivo-dv-icon-button"
                aria-label={labels.nextImage}
                title={labels.nextImage}
                disabled={status.imageIndex >= imageCount - 1}
                onClick={() => session.scrollBy(1)}
              >
                <span aria-hidden="true">{'›'}</span>
              </button>
              <span className="mivo-dv-slice-position" data-testid="mivo-dv-slice-position">
                {status.imageIndex + 1} / {imageCount}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mivo-dv-status" id={ids.status} role="status" aria-live="polite">
        {state.phase === 'scanning' && state.progress && (
          <span>{labels.scanning(state.progress.processed, state.progress.total)}</span>
        )}
        {state.phase === 'loading' && (
          <span>
            {is3d && progressValue ? labels.loadingVolume(progressValue.processed, progressValue.total) : labels.loadingSeries}
          </span>
        )}
        {state.skipped.length > 0 && !busy && (
          <details className="mivo-dv-skipped">
            <summary>{labels.skippedFiles(state.skipped.length)}</summary>
            <ul>
              {summarizeSkipped(state, labels).map(([reason, count]) => (
                <li key={reason}>
                  {reason}: {count}
                </li>
              ))}
            </ul>
          </details>
        )}
        {(status || volumeStatus) && (
          // Not announced: it changes on every drag step.
          <span className="mivo-dv-readout" aria-live="off" data-testid="mivo-dv-readout">
            {windowWidth !== undefined && windowCenter !== undefined && (
              <span>{labels.windowLevelValue(windowWidth, windowCenter)}</span>
            )}
            {activeZoom !== undefined && (
              <span>
                {is3d && `${labels.views[activeView]} · `}
                {labels.zoomValue(activeZoom)}
              </span>
            )}
          </span>
        )}
      </div>
    </section>
  );
});

function summarizeSkipped(state: ViewerState, labels: DicomViewerLabels): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of state.skipped) {
    const label = labels.skippedReasons[item.reason];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts];
}
