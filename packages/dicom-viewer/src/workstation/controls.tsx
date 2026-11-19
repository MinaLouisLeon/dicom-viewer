import { useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';

import { useWorkstation } from './context';
import { MEASUREMENT_TOOLS, type WorkstationTool } from './gridRenderer';
import { Icon, TOOL_ICONS, type IconName } from './icons';
import { GRID_LAYOUTS, MPR_LAYOUTS, gridId, type GridLayout, type MprLayout } from './layouts';
import { presetApplies } from './windowPresets';

/** A labelled button with an icon, used in toolbars, popovers and the side menu. */
export function ActionButton(props: {
  icon?: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  shortcut?: string;
  iconOnly?: boolean;
  testId?: string;
  className?: string;
}): ReactElement {
  const { icon, label, onClick, pressed, disabled, title, shortcut, iconOnly, testId, className } = props;
  return (
    <button
      type="button"
      className={['mihawk-ws-action', iconOnly ? 'mihawk-ws-action-icon' : '', className].filter(Boolean).join(' ')}
      aria-pressed={pressed}
      aria-label={iconOnly ? label : undefined}
      aria-keyshortcuts={shortcut}
      title={title ?? (iconOnly ? (shortcut ? `${label} (${shortcut})` : label) : undefined)}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {!iconOnly && <span className="mihawk-ws-action-label">{label}</span>}
      {!iconOnly && shortcut && <kbd className="mihawk-ws-kbd">{shortcut}</kbd>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const id = useId();
  return (
    <section className="mihawk-ws-section" aria-labelledby={id}>
      <h3 className="mihawk-ws-section-title" id={id}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function useActiveCell() {
  const { session, state, views } = useWorkstation();
  const cell = state.cells.find((item) => item.id === state.activeCellId) ?? state.cells[0]!;
  const view = views[cell.id];
  const displayed = cell.phase === 'displayed';
  const series = session.getSeries(cell.seriesInstanceUid);
  return { cell, view, displayed, series };
}

// ── Files ────────────────────────────────────────────────────────────────

export function FileControls(): ReactElement | null {
  const { labels, features, openFilePicker, openFolderPicker, session, state, afterAction } = useWorkstation();
  if (!features.openFiles && state.phase === 'idle') return null;
  const busy = state.phase === 'scanning';
  return (
    <div className="mihawk-ws-row">
      {features.openFiles && (
        <>
          <ActionButton icon="file" label={labels.openFiles} onClick={() => { openFilePicker(); afterAction(); }} />
          <ActionButton icon="folder" label={labels.openFolder} onClick={() => { openFolderPicker(); afterAction(); }} />
        </>
      )}
      {busy && <ActionButton icon="close" label={labels.cancel} onClick={() => session.cancel()} />}
      {!busy && (state.studies.length > 0 || state.phase === 'error') && (
        <ActionButton icon="trash" label={labels.clear} onClick={() => { session.clear(); afterAction(); }} />
      )}
    </div>
  );
}

// ── Series ───────────────────────────────────────────────────────────────

export const SERIES_DRAG_TYPE = 'application/x-mihawk-series';

export function SeriesList(): ReactElement | null {
  const { session, state, labels, afterAction, size } = useWorkstation();
  const headingId = useId();
  if (state.studies.length === 0) return null;
  const shownIn = new Map<string, number[]>();
  state.cells.forEach((cell, index) => {
    if (!cell.seriesInstanceUid) return;
    shownIn.set(cell.seriesInstanceUid, [...(shownIn.get(cell.seriesInstanceUid) ?? []), index + 1]);
  });
  const activeUid = state.cells.find((cell) => cell.id === state.activeCellId)?.seriesInstanceUid;
  return (
    <nav className="mihawk-ws-series-panel" aria-labelledby={headingId}>
      <h2 className="mihawk-ws-section-title" id={headingId}>
        {labels.studiesHeading}
      </h2>
      {state.studies.map((study) => (
        <div className="mihawk-ws-study" key={study.studyInstanceUid}>
          <div className="mihawk-ws-study-title">
            <span>{study.description ?? labels.untitledStudy}</span>
            {study.date && <span className="mihawk-ws-muted">{labels.formatStudyDate(study.date)}</span>}
          </div>
          <ul className="mihawk-ws-series-list" aria-label={labels.seriesList}>
            {study.series.map((series) => {
              const cells = shownIn.get(series.seriesInstanceUid);
              return (
                <li key={series.seriesInstanceUid}>
                  <button
                    type="button"
                    className="mihawk-ws-series"
                    aria-pressed={series.seriesInstanceUid === activeUid}
                    draggable={size === 'desktop'}
                    data-testid="mihawk-ws-series"
                    onDragStart={(event) => {
                      event.dataTransfer.setData(SERIES_DRAG_TYPE, series.seriesInstanceUid);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => {
                      void session.loadSeries(series.seriesInstanceUid);
                      afterAction();
                    }}
                  >
                    <span className="mihawk-ws-series-thumb" aria-hidden="true">
                      {series.modality ?? 'IMG'}
                    </span>
                    <span className="mihawk-ws-series-text">
                      <span className="mihawk-ws-series-name">
                        {labels.seriesLabel({ number: series.seriesNumber, description: series.description }) ||
                          labels.untitledSeries}
                      </span>
                      <span className="mihawk-ws-muted">
                        {labels.imageCount(series.imageCount)}
                        {series.volume.supported && <span className="mihawk-ws-badge">{labels.volumeBadge}</span>}
                        {cells && <span className="mihawk-ws-badge mihawk-ws-badge-cell">{cells.join(', ')}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────

function GridPreview({ grid }: { grid: GridLayout }): ReactElement {
  return (
    <span
      className="mihawk-ws-grid-preview"
      aria-hidden="true"
      style={{ gridTemplateColumns: `repeat(${grid.columns}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)` }}
    >
      {Array.from({ length: grid.rows * grid.columns }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  );
}

function MprPreview({ layout }: { layout: MprLayout }): ReactElement {
  return (
    <span className="mihawk-ws-mpr-preview" data-mpr-layout={layout} aria-hidden="true">
      <span data-view="axial" />
      <span data-view="sagittal" />
      <span data-view="coronal" />
      <span data-view="volume" />
    </span>
  );
}

export function LayoutControls(): ReactElement {
  const { session, state, labels, features, afterAction } = useWorkstation();
  const { cell, series } = useActiveCell();
  const canVolume = features.mpr && session.canShowVolume(cell.seriesInstanceUid);
  const volumeReason =
    series && !series.volume.supported ? labels.volumeUnsupportedReasons[series.volume.reason] : undefined;
  return (
    <div className="mihawk-ws-layout-controls">
      {features.layouts && (
        <Section title={labels.gridLayouts}>
          <div className="mihawk-ws-grid-options" role="group" aria-label={labels.gridLayouts}>
            {GRID_LAYOUTS.map((grid) => {
              const selected = grid.rows === state.grid.rows && grid.columns === state.grid.columns;
              const name = labels.gridLayoutName(grid.rows, grid.columns);
              return (
                <button
                  key={gridId(grid)}
                  type="button"
                  className="mihawk-ws-grid-option"
                  aria-pressed={selected}
                  aria-label={name}
                  title={name}
                  data-testid={`mihawk-ws-grid-${gridId(grid)}`}
                  onClick={() => {
                    session.setGrid(grid);
                    afterAction();
                  }}
                >
                  <GridPreview grid={grid} />
                </button>
              );
            })}
          </div>
        </Section>
      )}
      {features.mpr && (
        <Section title={labels.cellMode}>
          <div className="mihawk-ws-row" role="group" aria-label={labels.cellMode}>
            <ActionButton
              label={labels.modes['2d']}
              pressed={cell.mode === '2d'}
              onClick={() => void session.setCellMode('2d')}
              testId="mihawk-ws-mode-2d"
            />
            <ActionButton
              icon="cube"
              label={labels.modes['3d']}
              pressed={cell.mode === '3d'}
              disabled={!canVolume && !!cell.seriesInstanceUid}
              title={volumeReason}
              onClick={() => void session.setCellMode('3d')}
              testId="mihawk-ws-mode-3d"
            />
          </div>
          {volumeReason && <p className="mihawk-ws-hint">{volumeReason}</p>}
        </Section>
      )}
      {features.mpr && cell.mode === '3d' && (
        <Section title={labels.mprLayouts}>
          <div className="mihawk-ws-mpr-options" role="group" aria-label={labels.mprLayouts}>
            {MPR_LAYOUTS.map((layout) => (
              <button
                key={layout}
                type="button"
                className="mihawk-ws-mpr-option"
                aria-pressed={cell.mprLayout === layout}
                data-testid={`mihawk-ws-mpr-${layout}`}
                onClick={() => {
                  session.setMprLayout(layout);
                  afterAction();
                }}
              >
                <MprPreview layout={layout} />
                <span>{labels.mprLayoutNames[layout]}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Tools ────────────────────────────────────────────────────────────────

function ToolButton({ tool, iconOnly }: { tool: WorkstationTool; iconOnly?: boolean }): ReactElement {
  const { session, state, labels, afterAction } = useWorkstation();
  return (
    <ActionButton
      icon={TOOL_ICONS[tool]}
      label={labels.tools[tool]}
      shortcut={labels.toolShortcuts[tool]}
      pressed={state.tool === tool}
      iconOnly={iconOnly}
      testId={`mihawk-ws-tool-${tool}`}
      onClick={() => {
        session.setTool(tool);
        afterAction();
      }}
    />
  );
}

export function navigationToolList(hasMpr: boolean): WorkstationTool[] {
  const tools: WorkstationTool[] = ['windowLevel', 'pan', 'zoom', 'scroll', 'magnify'];
  if (hasMpr) tools.push('crosshairs');
  return tools;
}

export function NavigationTools({ iconOnly }: { iconOnly?: boolean }): ReactElement {
  const { state, labels } = useWorkstation();
  const hasMpr = state.cells.some((cell) => cell.mode === '3d');
  return (
    <div className="mihawk-ws-row" role="group" aria-label={labels.navigationTools}>
      {navigationToolList(hasMpr).map((tool) => (
        <ToolButton key={tool} tool={tool} iconOnly={iconOnly} />
      ))}
    </div>
  );
}

export function MeasurementTools(): ReactElement {
  const { session, labels, afterAction } = useWorkstation();
  return (
    <div className="mihawk-ws-measure">
      <div className="mihawk-ws-tool-grid" role="group" aria-label={labels.measurementTools}>
        {MEASUREMENT_TOOLS.map((tool) => (
          <ToolButton key={tool} tool={tool} />
        ))}
      </div>
      <ActionButton
        icon="trash"
        label={labels.clearMeasurements}
        onClick={() => {
          session.clearMeasurements();
          afterAction();
        }}
      />
    </div>
  );
}

// ── Brightness and contrast ──────────────────────────────────────────────

export function WindowControls(): ReactElement {
  const { session, labels, afterAction } = useWorkstation();
  const { cell, view, displayed, series } = useActiveCell();
  const width = view?.status?.windowWidth ?? view?.volumeStatus?.windowWidth;
  const center = view?.status?.windowCenter ?? view?.volumeStatus?.windowCenter;
  const [custom, setCustom] = useState({ width: '', center: '' });
  useEffect(() => {
    setCustom({
      width: width !== undefined ? String(Math.round(width)) : '',
      center: center !== undefined ? String(Math.round(center)) : '',
    });
    // Refresh the fields when another cell becomes active or a preset is applied.
  }, [cell.id, cell.presetId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mihawk-ws-window-controls">
      <div className="mihawk-ws-preset-grid" role="group" aria-label={labels.windowGroup}>
        {session.windowPresets.map((preset) => {
          const applies = presetApplies(preset, series?.modality);
          const name = labels.presets[preset.id] ?? preset.id;
          const hint = applies ? labels.presetHint[preset.id] : labels.presetUnavailable;
          const value = preset.window ? `${preset.window.width} / ${preset.window.center}` : undefined;
          return (
            <button
              key={preset.id}
              type="button"
              className="mihawk-ws-preset"
              aria-pressed={cell.presetId === preset.id}
              disabled={!displayed || !applies}
              title={[hint, preset.shortcut ? `(${preset.shortcut})` : undefined].filter(Boolean).join(' ')}
              aria-keyshortcuts={preset.shortcut}
              data-testid={`mihawk-ws-preset-${preset.id}`}
              onClick={() => {
                session.applyPreset(preset.id);
                afterAction();
              }}
            >
              {preset.id === 'auto' && <Icon name="wand" size={16} />}
              <span className="mihawk-ws-preset-name">{name}</span>
              {value && <span className="mihawk-ws-preset-value">{value}</span>}
            </button>
          );
        })}
      </div>
      <form
        className="mihawk-ws-custom-window"
        aria-label={labels.customWindow}
        onSubmit={(event) => {
          event.preventDefault();
          const nextWidth = Number.parseFloat(custom.width);
          const nextCenter = Number.parseFloat(custom.center);
          if (Number.isFinite(nextWidth) && Number.isFinite(nextCenter) && nextWidth > 0) {
            session.setWindow({ width: nextWidth, center: nextCenter });
          }
        }}
      >
        <label>
          <span>{labels.windowWidth}</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            value={custom.width}
            disabled={!displayed}
            onChange={(event) => setCustom((value) => ({ ...value, width: event.currentTarget.value }))}
          />
        </label>
        <label>
          <span>{labels.windowCenter}</span>
          <input
            type="number"
            inputMode="decimal"
            value={custom.center}
            disabled={!displayed}
            onChange={(event) => setCustom((value) => ({ ...value, center: event.currentTarget.value }))}
          />
        </label>
        <button type="submit" className="mihawk-ws-action" disabled={!displayed}>
          {labels.apply}
        </button>
      </form>
    </div>
  );
}

// ── Image ────────────────────────────────────────────────────────────────

export function ImageControls(): ReactElement {
  const { session, labels, features } = useWorkstation();
  const { cell, view, displayed } = useActiveCell();
  const is2d = cell.mode === '2d';
  const invert = is2d ? view?.status?.invert : view?.volumeStatus?.invert;
  return (
    <div className="mihawk-ws-image-controls">
      <div className="mihawk-ws-row" role="group" aria-label={labels.imageGroup}>
        <ActionButton icon="invert" label={labels.invert} shortcut="I" pressed={Boolean(invert)} disabled={!displayed} onClick={() => session.toggleInvert()} />
        {features.transforms && (
          <>
            <ActionButton icon="rotateLeft" label={labels.rotateLeft} shortcut="[" disabled={!displayed || !is2d} onClick={() => session.rotate(-90)} />
            <ActionButton icon="rotateRight" label={labels.rotateRight} shortcut="]" disabled={!displayed || !is2d} onClick={() => session.rotate(90)} />
            <ActionButton icon="flipH" label={labels.flipHorizontal} shortcut="H" pressed={Boolean(view?.status?.flipHorizontal)} disabled={!displayed || !is2d} onClick={() => session.flip('horizontal')} />
            <ActionButton icon="flipV" label={labels.flipVertical} shortcut="V" pressed={Boolean(view?.status?.flipVertical)} disabled={!displayed || !is2d} onClick={() => session.flip('vertical')} />
          </>
        )}
        <ActionButton icon="zoom" label={labels.zoomIn} shortcut="+" disabled={!displayed} onClick={() => session.zoomBy(1.2)} />
        <ActionButton icon="zoomOut" label={labels.zoomOut} shortcut="-" disabled={!displayed} onClick={() => session.zoomBy(1 / 1.2)} />
        <ActionButton icon="reset" label={labels.resetView} shortcut="R" disabled={!displayed} onClick={() => session.resetView()} />
      </div>
    </div>
  );
}

export function CineControls(): ReactElement {
  const { session, state, labels } = useWorkstation();
  const { cell, displayed } = useActiveCell();
  const id = useId();
  return (
    <div className="mihawk-ws-cine">
      <ActionButton
        icon={cell.playing ? 'pause' : 'play'}
        label={cell.playing ? labels.pause : labels.play}
        shortcut="Space"
        pressed={cell.playing}
        disabled={!displayed}
        testId="mihawk-ws-cine-toggle"
        onClick={() => session.toggleCine()}
      />
      <label className="mihawk-ws-fps" htmlFor={id}>
        <span>{labels.framesPerSecond}</span>
        <input
          id={id}
          type="range"
          min={1}
          max={60}
          value={state.cineFps}
          aria-valuetext={labels.fpsValue(state.cineFps)}
          onChange={(event) => session.setCineFps(Number(event.currentTarget.value))}
        />
        <output>{labels.fpsValue(state.cineFps)}</output>
      </label>
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────

function Toggle({ label, checked, onChange, icon, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; icon?: IconName; disabled?: boolean }): ReactElement {
  return (
    <label className="mihawk-ws-toggle">
      {icon && <Icon name={icon} />}
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} />
    </label>
  );
}

export function ViewControls(): ReactElement {
  const { session, state, labels, features, allowPatientInfo } = useWorkstation();
  return (
    <div className="mihawk-ws-view-controls">
      {features.sync && (
        <div role="group" aria-label={labels.syncGroup}>
          <Toggle icon="scroll" label={labels.syncScroll} checked={state.sync.scroll} onChange={(scroll) => session.setSync({ scroll })} />
          <Toggle icon="zoom" label={labels.syncZoomPan} checked={state.sync.zoomPan} onChange={(zoomPan) => session.setSync({ zoomPan })} />
          <Toggle icon="contrast" label={labels.syncWindowLevel} checked={state.sync.windowLevel} onChange={(windowLevel) => session.setSync({ windowLevel })} />
        </div>
      )}
      {features.referenceLines && (
        <Toggle icon="lines" label={labels.referenceLines} checked={state.referenceLines} onChange={(value) => session.setReferenceLines(value)} />
      )}
      {features.overlay && (
        <Toggle icon="info" label={labels.overlay} checked={state.overlay} onChange={(value) => session.setOverlay(value)} />
      )}
      {allowPatientInfo && (
        <Toggle icon="user" label={labels.patientInfo} checked={state.patientInfo} onChange={(value) => session.setPatientInfo(value)} />
      )}
    </div>
  );
}

export function OutputControls(): ReactElement {
  const { labels, features, exportImage, toggleFullscreen, isFullscreen, afterAction } = useWorkstation();
  const { displayed } = useActiveCell();
  return (
    <div className="mihawk-ws-row">
      {features.export && (
        <ActionButton
          icon="download"
          label={labels.exportImage}
          disabled={!displayed}
          testId="mihawk-ws-export"
          onClick={() => {
            void exportImage();
            afterAction();
          }}
        />
      )}
      {features.fullscreen && (
        <ActionButton
          icon={isFullscreen ? 'exitFullscreen' : 'fullscreen'}
          label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
          shortcut="F"
          onClick={() => {
            toggleFullscreen();
            afterAction();
          }}
        />
      )}
    </div>
  );
}

/** Every option of the app, grouped, for the phone and tablet side menu. */
export function AllControls(): ReactElement {
  const { labels, features, state } = useWorkstation();
  const hasStudies = state.studies.length > 0;
  return (
    <div className="mihawk-ws-all-controls">
      <MenuGroup title={labels.fileGroup} icon="file" open>
        <FileControls />
      </MenuGroup>
      {features.seriesPanel && hasStudies && (
        <MenuGroup title={labels.studiesHeading} icon="series" open>
          <SeriesList />
        </MenuGroup>
      )}
      {(features.layouts || features.mpr) && (
        <MenuGroup title={labels.layoutSelector} icon="layout">
          <LayoutControls />
        </MenuGroup>
      )}
      <MenuGroup title={labels.navigationTools} icon="tool">
        <NavigationTools />
      </MenuGroup>
      {features.measurements && (
        <MenuGroup title={labels.measurementTools} icon="ruler">
          <MeasurementTools />
        </MenuGroup>
      )}
      {features.presets && (
        <MenuGroup title={labels.windowGroup} icon="sun">
          <WindowControls />
        </MenuGroup>
      )}
      <MenuGroup title={labels.imageGroup} icon="invert">
        <ImageControls />
      </MenuGroup>
      {features.cine && (
        <MenuGroup title={labels.cine} icon="play">
          <CineControls />
        </MenuGroup>
      )}
      <MenuGroup title={labels.viewGroup} icon="info">
        <ViewControls />
        <OutputControls />
      </MenuGroup>
    </div>
  );
}

function MenuGroup({ title, icon, open, children }: { title: string; icon: IconName; open?: boolean; children: ReactNode }): ReactElement {
  return (
    <details className="mihawk-ws-menu-group" open={open}>
      <summary>
        <Icon name={icon} />
        <span>{title}</span>
        <Icon name="chevronDown" size={16} />
      </summary>
      <div className="mihawk-ws-menu-group-body">{children}</div>
    </details>
  );
}
