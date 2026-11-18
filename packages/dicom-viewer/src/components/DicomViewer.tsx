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
import { createCornerstoneRenderer } from '../core/renderer';
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
   * Local files supplied by the host app (for example from its own drop target).
   * Opened whenever a new array is passed. The built-in buttons work without this.
   */
  files?: readonly Blob[];
  onStateChange?: (state: ViewerState) => void;
  onStudiesLoaded?: (studies: StudySummary[]) => void;
  onSeriesDisplayed?: (series: SeriesSummary) => void;
  onError?: (error: DicomViewerError) => void;
}

/** Imperative controls, for example to close the study when the user logs out. */
export interface DicomViewerHandle {
  openFiles(files: readonly Blob[]): Promise<void>;
  selectSeries(seriesInstanceUid: string): Promise<void>;
  cancel(): void;
  /** Closes the current files and releases their data. */
  clear(): void;
  getState(): ViewerState;
}

const directoryInputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;

export const DicomViewer = forwardRef<DicomViewerHandle, DicomViewerProps>(function DicomViewer(props, ref) {
  const { className, style, files, codecBasePath = DEFAULT_CODEC_BASE_PATH, maxWebWorkers } = props;
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
        rendererConfig: { codecBasePath, maxWebWorkers },
        getEvents: () => eventsRef.current,
      }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    session.attach(element);
    return () => session.detach();
  }, [session]);

  useEffect(() => {
    if (files && files.length > 0) void session.openFiles(files);
  }, [files, session]);

  useImperativeHandle(
    ref,
    () => ({
      openFiles: (selected) => session.openFiles(selected),
      selectSeries: (uid) => session.selectSeries(uid),
      cancel: () => session.cancel(),
      clear: () => session.clear(),
      getState: () => session.getState(),
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
  const showViewport = state.phase === 'displayed' || state.phase === 'loading';

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && busy) {
      event.stopPropagation();
      session.cancel();
    }
  };

  const ids = { status: useId(), studies: useId() };
  const rootClass = ['mivo-dv', className].filter(Boolean).join(' ');

  return (
    <section className={rootClass} style={style} aria-label={labels.viewerRegion} onKeyDown={onKeyDown}>
      <div className="mivo-dv-toolbar" role="toolbar" aria-label={labels.toolbar}>
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
                          <span className="mivo-dv-muted">{labels.imageCount(series.imageCount)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        )}

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
            data-visible={showViewport || undefined}
            data-testid="mivo-dv-viewport"
            onContextMenu={(event) => event.preventDefault()}
          />

          {state.phase === 'idle' && (
            <div className="mivo-dv-overlay mivo-dv-dropzone">
              <p className="mivo-dv-title">{labels.dropZoneTitle}</p>
              <p>{labels.dropZoneHint}</p>
              <p className="mivo-dv-muted">{labels.privacyNote}</p>
            </div>
          )}

          {busy && (
            <div className="mivo-dv-overlay" aria-describedby={ids.status}>
              {state.phase === 'scanning' && state.progress ? (
                <progress
                  className="mivo-dv-progress"
                  max={Math.max(1, state.progress.total)}
                  value={state.progress.processed}
                  aria-label={labels.scanning(state.progress.processed, state.progress.total)}
                />
              ) : (
                <progress className="mivo-dv-progress" aria-label={labels.loadingSeries} />
              )}
            </div>
          )}

          {state.phase === 'error' && state.error && (
            <div className="mivo-dv-overlay mivo-dv-error" role="alert">
              <p>{labels.errors[state.error.code]}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mivo-dv-status" id={ids.status} role="status" aria-live="polite">
        {state.phase === 'scanning' && state.progress && (
          <span>{labels.scanning(state.progress.processed, state.progress.total)}</span>
        )}
        {state.phase === 'loading' && <span>{labels.loadingSeries}</span>}
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
