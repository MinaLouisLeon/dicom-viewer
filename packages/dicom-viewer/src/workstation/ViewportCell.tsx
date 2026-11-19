import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';

import { VOLUME_VIEWS, type VolumePlane, type VolumeView } from '../core/renderer';
import { useWorkstation } from './context';
import { SERIES_DRAG_TYPE } from './controls';
import { Icon } from './icons';
import { OrientationCube } from './OrientationCube';
import { directionLabel, formatDicomDate, formatDicomTime, orientationMarkers, readImageInfo, type ImageInfo } from './imageInfo';
import type { CellState, CellViewState } from './workstationSession';
import { visibleViews } from './workstationSession';

const ZOOM_STEP = 1.2;
const PAN_STEP_PX = 20;
const LARGE_STEP = 5;
const ROTATE_STEP_DEG = 10;

const ARROWS: Partial<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function useImageInfo(file: Blob | undefined): ImageInfo | undefined {
  const [info, setInfo] = useState<{ file: Blob; info?: ImageInfo }>();
  useEffect(() => {
    if (!file) return undefined;
    let live = true;
    void readImageInfo(file).then((value) => {
      if (live) setInfo({ file, info: value });
    });
    return () => {
      live = false;
    };
  }, [file]);
  return info && info.file === file ? info.info : undefined;
}

export function ViewportCell({ cell, index, style }: { cell: CellState; index: number; style?: CSSProperties }): ReactElement {
  const { session, state, views, labels, features } = useWorkstation();
  const view: CellViewState | undefined = views[cell.id];
  const active = state.activeCellId === cell.id;
  const is3d = cell.mode === '3d';
  const displayed = cell.phase === 'displayed';
  const status = displayed && !is3d ? view?.status : undefined;
  const volumeStatus = displayed && is3d ? view?.volumeStatus : undefined;
  const series = session.getSeries(cell.seriesInstanceUid);
  const [dropActive, setDropActive] = useState(false);

  // ── Element registration ──
  const stackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    session.attachCell(cell.id, stackRef.current);
    return () => session.attachCell(cell.id, null);
  }, [session, cell.id]);

  const paneRefs = {
    axial: useRef<HTMLDivElement>(null),
    sagittal: useRef<HTMLDivElement>(null),
    coronal: useRef<HTMLDivElement>(null),
    volume: useRef<HTMLDivElement>(null),
  } satisfies Record<VolumeView, RefObject<HTMLDivElement | null>>;
  useLayoutEffect(() => {
    if (!is3d) return undefined;
    const { axial, sagittal, coronal, volume } = paneRefs;
    if (axial.current && sagittal.current && coronal.current && volume.current) {
      session.attachVolume(cell.id, {
        axial: axial.current,
        sagittal: sagittal.current,
        coronal: coronal.current,
        volume: volume.current,
      });
    }
    return () => session.attachVolume(cell.id, null);
    // Pane refs are stable objects.
  }, [session, cell.id, is3d]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Overlay ──
  const image = displayed ? session.getCellImage(cell.id) : undefined;
  const info = useImageInfo(state.overlay && features.overlay ? image?.instance.file : undefined);

  // ── Keyboard (2D) ──
  const onStackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!status || event.altKey || event.ctrlKey || event.metaKey) return;
    const multiplier = event.shiftKey ? LARGE_STEP : 1;
    const count = status.imageCount;
    const pageStep = event.shiftKey ? Math.max(1, Math.round(count / 10)) : 1;
    const direction = ARROWS[event.key];
    if (direction) {
      const [x, y] = direction;
      switch (state.tool) {
        case 'pan':
          session.panBy(x * PAN_STEP_PX * multiplier, y * PAN_STEP_PX * multiplier, cell.id);
          break;
        case 'zoom':
          session.zoomBy((x > 0 || y < 0 ? ZOOM_STEP : 1 / ZOOM_STEP) ** (event.shiftKey ? 3 : 1), cell.id);
          break;
        case 'scroll':
          session.scrollBy((x + y) * pageStep, cell.id);
          break;
        case 'windowLevel':
          session.adjustWindowLevel(x * multiplier, -y * multiplier, cell.id);
          break;
        default:
          session.scrollBy((x + y) * pageStep, cell.id);
      }
    } else {
      switch (event.key) {
        case 'PageUp':
          session.scrollBy(-pageStep, cell.id);
          break;
        case 'PageDown':
          session.scrollBy(pageStep, cell.id);
          break;
        case 'Home':
          session.setImageIndex(0, cell.id);
          break;
        case 'End':
          session.setImageIndex(count - 1, cell.id);
          break;
        default:
          return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // ── Keyboard (3D panes) ──
  const onPaneKeyDown = (paneView: VolumeView, event: KeyboardEvent<HTMLDivElement>) => {
    if (!volumeStatus || event.altKey || event.ctrlKey || event.metaKey) return;
    const multiplier = event.shiftKey ? LARGE_STEP : 1;
    const direction = ARROWS[event.key];
    if (paneView === 'volume') {
      if (!direction) return;
      const [x, y] = direction;
      const step = ROTATE_STEP_DEG * (event.shiftKey ? 3 : 1);
      session.rotateVolume(x * step, y * step, cell.id);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const plane: VolumePlane = paneView;
    const count = volumeStatus.planes[plane].count;
    const pageStep = event.shiftKey ? Math.max(1, Math.round(count / 10)) : 1;
    if (direction) {
      const [x, y] = direction;
      switch (state.tool) {
        case 'windowLevel':
          session.adjustWindowLevel(x * multiplier, -y * multiplier, cell.id);
          break;
        case 'pan':
          session.panBy(x * PAN_STEP_PX * multiplier, y * PAN_STEP_PX * multiplier, cell.id);
          break;
        case 'zoom':
          session.zoomBy((x > 0 || y < 0 ? ZOOM_STEP : 1 / ZOOM_STEP) ** (event.shiftKey ? 3 : 1), cell.id);
          break;
        case 'scroll':
          session.scrollBy((x + y) * pageStep, cell.id);
          break;
        default:
          session.moveCrosshair(plane, x * multiplier, y * multiplier, cell.id);
      }
    } else if (event.key === 'PageUp') session.scrollBy(-pageStep, cell.id);
    else if (event.key === 'PageDown') session.scrollBy(pageStep, cell.id);
    else if (event.key === 'Home') session.setSliceIndex(plane, 0, cell.id);
    else if (event.key === 'End') session.setSliceIndex(plane, count - 1, cell.id);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  // ── Drop a series from the list ──
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(SERIES_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const uid = event.dataTransfer.getData(SERIES_DRAG_TYPE);
    setDropActive(false);
    if (!uid) return;
    event.preventDefault();
    event.stopPropagation();
    session.setActiveCell(cell.id);
    void session.loadSeries(uid, cell.id);
  };

  const seriesLabel = series
    ? labels.seriesLabel({ number: series.seriesNumber, description: series.description, modality: series.modality }) ||
      labels.untitledSeries
    : undefined;
  const visible = visibleViews(cell.mprLayout, cell.mprViews);
  const markers = status && info ? orientationMarkers(info.imageOrientationPatient, status) : undefined;
  const windowWidth = status?.windowWidth ?? volumeStatus?.windowWidth;
  const windowCenter = status?.windowCenter ?? volumeStatus?.windowCenter;
  const zoom = status?.zoom ?? (volumeStatus ? volumeStatus.zoom[view?.activeView ?? 'axial'] : undefined);

  return (
    <div
      className="mihawk-ws-cell"
      data-cell-id={cell.id}
      data-active={active || undefined}
      data-mode={cell.mode}
      data-phase={cell.phase}
      data-drop-active={dropActive || undefined}
      role="group"
      aria-label={active ? labels.activeCell(index + 1) : labels.cellRegion(index + 1)}
      data-testid="mihawk-ws-cell"
      style={style}
      onPointerDownCapture={() => session.setActiveCell(cell.id)}
      onFocusCapture={() => session.setActiveCell(cell.id)}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div className="mihawk-ws-cell-stage">
        <div
          ref={stackRef}
          className="mihawk-ws-cell-viewport"
          data-visible={!is3d || undefined}
          data-testid="mihawk-ws-cell-viewport"
          role="application"
          aria-label={seriesLabel ?? labels.emptyCell}
          aria-roledescription={labels.imageViewport}
          aria-hidden={is3d || undefined}
          tabIndex={displayed && !is3d ? 0 : -1}
          onKeyDown={onStackKeyDown}
          onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
          onContextMenu={(event) => event.preventDefault()}
        />

        {is3d && (
          <div className="mihawk-ws-mpr" data-mpr-layout={cell.mprLayout}>
            {VOLUME_VIEWS.map((paneView) => {
              const plane = paneView === 'volume' ? undefined : paneView;
              const planeStatus = plane ? volumeStatus?.planes[plane] : undefined;
              const renderingOff = paneView === 'volume' && volumeStatus?.volumeRendering === false;
              const slot = visible.indexOf(paneView);
              const shown = slot >= 0;
              const orientation = plane ? volumeStatus?.orientation?.[plane] : undefined;
              const direction = orientation ? directionLabel(orientation.normal).charAt(0) : undefined;
              const paneMarkers = orientation
                ? {
                    top: directionLabel(orientation.down.map((value) => -value)),
                    bottom: directionLabel(orientation.down),
                    left: directionLabel(orientation.right.map((value) => -value)),
                    right: directionLabel(orientation.right),
                  }
                : undefined;
              const slabText = plane && volumeStatus?.slab ? labels.slabValue(volumeStatus.slab.mode, volumeStatus.slab.thickness) : '';
              return (
                <div
                  key={paneView}
                  className="mihawk-ws-pane"
                  data-view={paneView}
                  data-shown={shown || undefined}
                  data-active={(view?.activeView ?? 'axial') === paneView || undefined}
                  aria-hidden={!shown || undefined}
                  style={shown ? { gridArea: `s${slot + 1}` } : undefined}
                >
                  <div className="mihawk-ws-pane-header">
                    {shown && visible.length > 1 ? (
                      <select
                        className="mihawk-ws-pane-picker"
                        value={paneView}
                        aria-label={labels.choosePlane(slot + 1)}
                        data-testid={`mihawk-ws-plane-picker-${slot + 1}`}
                        onChange={(event) => session.setMprView(slot, event.currentTarget.value as VolumeView, cell.id)}
                      >
                        {VOLUME_VIEWS.map((option) => (
                          <option key={option} value={option} disabled={option === 'volume' && volumeStatus?.volumeRendering === false}>
                            {labels.views[option]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="mihawk-ws-pane-title">{labels.views[paneView]}</span>
                    )}
                    {planeStatus && planeStatus.count > 0 && (
                      <span className="mihawk-ws-pane-position">
                        {planeStatus.index + 1} / {planeStatus.count}
                      </span>
                    )}
                    {direction && (
                      <span className="mihawk-ws-pane-direction" title={labels.viewedFrom(direction)}>
                        {direction}
                      </span>
                    )}
                  </div>
                  <div
                    ref={paneRefs[paneView]}
                    className="mihawk-ws-pane-viewport"
                    role="application"
                    aria-label={labels.views[paneView]}
                    tabIndex={volumeStatus && shown && !renderingOff ? 0 : -1}
                    data-testid={`mihawk-ws-pane-${paneView}`}
                    onKeyDown={(event) => onPaneKeyDown(paneView, event)}
                    onFocus={() => session.setActiveView(paneView, cell.id)}
                    onPointerDown={(event) => {
                      session.setActiveView(paneView, cell.id);
                      event.currentTarget.focus({ preventScroll: true });
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                  />
                  {plane && volumeStatus && state.overlay && features.overlay && (
                    <div className="mihawk-ws-pane-overlay" aria-hidden="true">
                      {volumeStatus.windowWidth !== undefined && volumeStatus.windowCenter !== undefined && (
                        <span className="mihawk-ws-pane-wl">{labels.windowLevelValue(volumeStatus.windowWidth, volumeStatus.windowCenter)}</span>
                      )}
                      {slabText && <span className="mihawk-ws-pane-slab">{slabText}</span>}
                      {paneMarkers && (
                        <>
                          <span className="mihawk-ws-marker mihawk-ws-marker-top">{paneMarkers.top}</span>
                          <span className="mihawk-ws-marker mihawk-ws-marker-right">{paneMarkers.right}</span>
                          <span className="mihawk-ws-marker mihawk-ws-marker-bottom">{paneMarkers.bottom}</span>
                          <span className="mihawk-ws-marker mihawk-ws-marker-left">{paneMarkers.left}</span>
                        </>
                      )}
                    </div>
                  )}
                  {paneView === 'volume' && shown && volumeStatus?.orientation?.volume && (
                    <OrientationCube {...volumeStatus.orientation.volume} />
                  )}
                  {renderingOff && <div className="mihawk-ws-pane-notice">{labels.volumeRenderingUnavailable}</div>}
                  {plane && planeStatus && planeStatus.count > 1 && shown && (
                    <input
                      type="range"
                      className="mihawk-ws-slider mihawk-ws-pane-slider"
                      min={1}
                      max={planeStatus.count}
                      value={planeStatus.index + 1}
                      aria-label={labels.sliceSlider(labels.views[paneView])}
                      aria-valuetext={labels.slicePosition(planeStatus.index + 1, planeStatus.count)}
                      onChange={(event) => session.setSliceIndex(plane, Number(event.currentTarget.value) - 1, cell.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {state.overlay && features.overlay && displayed && !is3d && (
          <div className="mihawk-ws-overlay" aria-hidden="true" data-testid="mihawk-ws-overlay">
            <div className="mihawk-ws-corner mihawk-ws-corner-tl">
              {state.patientInfo && info?.patientName && <span>{info.patientName}</span>}
              {state.patientInfo && info?.patientId && <span>ID {info.patientId}</span>}
              {state.patientInfo && (info?.patientSex || info?.patientAge) && (
                <span>{[info?.patientSex, info?.patientAge].filter(Boolean).join(' · ')}</span>
              )}
              {state.patientInfo && info?.institutionName && <span>{info.institutionName}</span>}
              {!is3d && seriesLabel && <span className="mihawk-ws-overlay-strong">{seriesLabel}</span>}
            </div>
            <div className="mihawk-ws-corner mihawk-ws-corner-tr">
              {info?.studyDescription && <span>{info.studyDescription}</span>}
              {info?.studyDate && (
                <span>{[formatDicomDate(info.studyDate), formatDicomTime(info.studyTime)].filter(Boolean).join(' ')}</span>
              )}
              {[info?.manufacturer, info?.modelName].some(Boolean) && (
                <span>{[info?.manufacturer, info?.modelName].filter(Boolean).join(' ')}</span>
              )}
            </div>
            <div className="mihawk-ws-corner mihawk-ws-corner-bl">
              {status && <span>{labels.overlayImage(status.imageIndex + 1, status.imageCount)}</span>}
              {info?.sliceThickness && <span>{labels.overlayThickness(info.sliceThickness)}</span>}
              {!is3d && info?.sliceLocation && <span>{labels.overlayLocation(info.sliceLocation)}</span>}
              {info?.rows && info.columns && <span>{`${info.columns} × ${info.rows}`}</span>}
            </div>
            <div className="mihawk-ws-corner mihawk-ws-corner-br">
              {windowWidth !== undefined && windowCenter !== undefined && (
                <span>{labels.windowLevelValue(windowWidth, windowCenter)}</span>
              )}
              {zoom !== undefined && <span>{labels.zoomValue(zoom)}</span>}
              {status && status.rotation !== 0 && <span>{labels.overlayRotation(status.rotation)}</span>}
              {status && (status.flipHorizontal || status.flipVertical) && <span>{labels.overlayFlipped}</span>}
              {(status?.invert || volumeStatus?.invert) && <span>{labels.overlayInverted}</span>}
            </div>
            {markers && !is3d && (
              <>
                <span className="mihawk-ws-marker mihawk-ws-marker-top">{markers.top}</span>
                <span className="mihawk-ws-marker mihawk-ws-marker-right">{markers.right}</span>
                <span className="mihawk-ws-marker mihawk-ws-marker-bottom">{markers.bottom}</span>
                <span className="mihawk-ws-marker mihawk-ws-marker-left">{markers.left}</span>
              </>
            )}
          </div>
        )}

        {status?.imageFailed && (
          <div className="mihawk-ws-cell-banner" role="alert">
            {labels.imageFailed(status.imageIndex + 1, status.imageCount)}
          </div>
        )}

        {cell.phase === 'empty' && state.phase !== 'idle' && (
          <div className="mihawk-ws-cell-message">
            <Icon name="layout" size={28} />
            <p>{labels.emptyCell}</p>
            <p className="mihawk-ws-muted">{labels.emptyCellHint}</p>
          </div>
        )}

        {cell.phase === 'loading' && (
          <div className="mihawk-ws-cell-message" role="status">
            {cell.progress ? (
              <progress
                className="mihawk-ws-progress"
                max={Math.max(1, cell.progress.total)}
                value={cell.progress.processed}
                aria-label={labels.loadingVolume(cell.progress.processed, cell.progress.total)}
              />
            ) : (
              <progress className="mihawk-ws-progress" aria-label={labels.loadingSeries} />
            )}
            <p>{cell.progress ? labels.loadingVolume(cell.progress.processed, cell.progress.total) : labels.loadingSeries}</p>
          </div>
        )}

        {cell.phase === 'error' && cell.error && (
          <div className="mihawk-ws-cell-message mihawk-ws-cell-error" role="alert">
            <p>{labels.errors[cell.error.code]}</p>
            {cell.error.code === 'VOLUME_UNSUPPORTED' && series && !series.volume.supported && (
              <p className="mihawk-ws-muted">{labels.volumeUnsupportedReasons[series.volume.reason]}</p>
            )}
            {cell.error.code.startsWith('VOLUME_') && is3d && (
              <button type="button" className="mihawk-ws-action" onClick={() => void session.setCellMode('2d', cell.id)}>
                {labels.openIn2d}
              </button>
            )}
          </div>
        )}

        {dropActive && <div className="mihawk-ws-cell-drop">{labels.dropSeriesHint}</div>}

        {cell.seriesInstanceUid && state.cells.length > 1 && (
          <button
            type="button"
            className="mihawk-ws-cell-close"
            aria-label={labels.closeCell}
            title={labels.closeCell}
            onClick={() => session.closeCell(cell.id)}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {status && status.imageCount > 1 && (
        <div className="mihawk-ws-slicebar" role="group" aria-label={labels.sliceControls}>
          {features.cine && (
            <button
              type="button"
              className="mihawk-ws-action mihawk-ws-action-icon mihawk-ws-action-small"
              aria-label={cell.playing ? labels.pause : labels.play}
              aria-pressed={cell.playing}
              title={cell.playing ? labels.pause : labels.play}
              onClick={() => session.toggleCine(cell.id)}
            >
              <Icon name={cell.playing ? 'pause' : 'play'} size={16} />
            </button>
          )}
          <input
            type="range"
            className="mihawk-ws-slider"
            min={1}
            max={status.imageCount}
            value={status.imageIndex + 1}
            aria-label={labels.imageSlider}
            aria-valuetext={labels.imagePosition(status.imageIndex + 1, status.imageCount)}
            onChange={(event) => session.setImageIndex(Number(event.currentTarget.value) - 1, cell.id)}
          />
          <span className="mihawk-ws-slice-position" data-testid="mihawk-ws-slice-position">
            {status.imageIndex + 1} / {status.imageCount}
          </span>
        </div>
      )}
    </div>
  );
}
