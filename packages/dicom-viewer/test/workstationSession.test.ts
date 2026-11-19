import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkstationSession, resizeCells, visibleViews, volumeToolFor } from '../src/workstation/workstationSession';
import { createFakeVolumeRenderer } from './fakeRenderer';
import { createFakeGridRenderer } from './fakeGridRenderer';
import { fixtureFile, fixturePaths } from './fixtures';

const stackFiles = () => fixturePaths('stack').map(fixtureFile);
const allFiles = () => [...fixturePaths('single'), ...fixturePaths('stack'), ...fixturePaths('cbct')].map(fixtureFile);

function setup(options: Partial<ConstructorParameters<typeof WorkstationSession>[0]> = {}) {
  const grid = createFakeGridRenderer();
  const volume = createFakeVolumeRenderer({ autoFinish: true });
  const session = new WorkstationSession({
    createGridRenderer: grid.createGridRenderer,
    createVolumeRenderer: volume.createVolumeRenderer,
    rendererConfig: { codecBasePath: '/codecs/' },
    progressIntervalMs: 0,
    ...options,
  });
  // Elements normally come from React; register one per cell.
  const attachAll = () => {
    for (const cell of session.getState().cells) session.attachCell(cell.id, document.createElement('div'));
  };
  attachAll();
  return { session, grid: grid.renderer, volume: volume.renderer, attachAll };
}

const attachVolume = (session: WorkstationSession, cellId: string) =>
  session.attachVolume(cellId, {
    axial: document.createElement('div'),
    sagittal: document.createElement('div'),
    coronal: document.createElement('div'),
    volume: document.createElement('div'),
  });

afterEach(() => vi.useRealTimers());

describe('WorkstationSession', () => {
  it('starts idle with one empty cell', () => {
    const { session } = setup();
    const state = session.getState();
    expect(state.phase).toBe('idle');
    expect(state.cells).toHaveLength(1);
    expect(state.activeCellId).toBe(state.cells[0]!.id);
    expect(state.tab).toBe('viewer');
    expect(state.patientInfo).toBe(false);
  });

  it('opens files and fills the grid with one series per cell', async () => {
    const { session, grid, attachAll } = setup({ initialGrid: { rows: 2, columns: 2 } });
    attachAll();
    const onStudiesLoaded = vi.fn();
    await session.openFiles(allFiles());
    const state = session.getState();
    expect(state.phase).toBe('ready');
    const series = state.studies.flatMap((study) => study.series);
    expect(series.length).toBe(3);
    expect(state.cells.map((cell) => cell.phase)).toEqual(['displayed', 'displayed', 'displayed', 'empty']);
    expect(new Set(state.cells.slice(0, 3).map((cell) => cell.seriesInstanceUid)).size).toBe(3);
    expect(grid.shown.size).toBe(3);
    expect(onStudiesLoaded).not.toHaveBeenCalled();
  });

  it('keeps cells by position when the grid changes and fills new ones', async () => {
    const { session, attachAll } = setup();
    await session.openFiles(allFiles());
    const first = session.getState().cells[0]!;
    session.setGrid({ rows: 1, columns: 3 });
    attachAll();
    await vi.waitFor(() => expect(session.getState().cells.filter((cell) => cell.phase === 'displayed')).toHaveLength(3));
    expect(session.getState().cells[0]!.id).toBe(first.id);
    session.setGrid({ rows: 1, columns: 1 });
    expect(session.getState().cells).toHaveLength(1);
    expect(session.getState().activeCellId).toBe(first.id);
    expect(resizeCells(session.getState().cells, 2)[0]!.id).toBe(first.id);
  });

  it('loads a chosen series into the active cell', async () => {
    const { session, grid, attachAll } = setup({ initialGrid: { rows: 1, columns: 2 } });
    attachAll();
    await session.openFiles(allFiles());
    const [, second] = session.getState().cells;
    const uid = session.getState().studies[0]!.series[0]!.seriesInstanceUid;
    session.setActiveCell(second!.id);
    await session.loadSeries(uid);
    expect(session.getState().cells[1]!.seriesInstanceUid).toBe(uid);
    expect(grid.showStack).toHaveBeenLastCalledWith(second!.id, expect.any(Array), expect.any(AbortSignal));
  });

  it('applies presets, tracks them, and clears the highlight after a manual change', async () => {
    const { session, grid } = setup();
    await session.openFiles(stackFiles());
    const cellId = session.getState().activeCellId;
    expect(session.applyPreset('bone')).toBe(true);
    expect(grid.setWindow).toHaveBeenLastCalledWith(cellId, { width: 2000, center: 500 }, undefined);
    expect(session.getState().cells[0]!.presetId).toBe('bone');
    expect(session.applyPreset('auto')).toBe(true);
    expect(grid.setWindow).toHaveBeenLastCalledWith(cellId, 'auto', { lowPercentile: 5, highPercentile: 95, ignoreBelow: -500 });
    expect(session.getViews()[cellId]!.status?.windowWidth).toBe(1234);
    grid.emit(cellId, { windowWidth: 900, windowCenter: 100 });
    expect(session.getState().cells[0]!.presetId).toBeUndefined();
    expect(session.applyPreset('missing')).toBe(false);
    expect(session.setWindow({ width: 50, center: 10 })).toBe(true);
    expect(session.getViews()[cellId]!.status).toMatchObject({ windowWidth: 50, windowCenter: 10 });
  });

  it('inverts, rotates, flips and resets the active 2D cell', async () => {
    const { session, grid } = setup();
    await session.openFiles(stackFiles());
    const cellId = session.getState().activeCellId;
    session.toggleInvert();
    session.rotate(90);
    session.rotate(-180);
    session.flip('horizontal');
    expect(session.getViews()[cellId]!.status).toMatchObject({ invert: true, rotation: 270, flipHorizontal: true });
    session.resetView();
    expect(grid.resetView).toHaveBeenCalledWith(cellId);
    expect(session.getViews()[cellId]!.status).toMatchObject({ invert: false, rotation: 0, flipHorizontal: false });
  });

  it('plays cine with wrap-around and stops on close', async () => {
    vi.useFakeTimers();
    const { session, grid } = setup({ cineFps: 10 });
    await session.openFiles(stackFiles());
    const cellId = session.getState().activeCellId;
    session.toggleCine();
    expect(session.getState().cells[0]!.playing).toBe(true);
    vi.advanceTimersByTime(1250);
    expect(session.getViews()[cellId]!.status?.imageIndex).toBe(0); // 12 images, 12 ticks: wrapped to the start
    expect(grid.scrollBy).toHaveBeenCalledWith(cellId, 1, true);
    session.setCineFps(500);
    expect(session.getState().cineFps).toBe(60);
    session.closeCell();
    expect(session.getState().cells[0]!.playing).toBe(false);
    const calls = vi.mocked(grid.scrollBy).mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(vi.mocked(grid.scrollBy).mock.calls.length).toBe(calls);
  });

  it('links scrolling from the active cell to the others', async () => {
    const { session, grid, attachAll } = setup({ initialGrid: { rows: 1, columns: 2 } });
    attachAll();
    await session.openFiles(stackFiles());
    const [first, second] = session.getState().cells;
    await session.loadSeries(first!.seriesInstanceUid!, second!.id);
    session.setSync({ scroll: true });
    expect(grid.setSync).toHaveBeenLastCalledWith({ scroll: true, zoomPan: false, windowLevel: false });
    session.setActiveCell(first!.id);
    session.scrollBy(5);
    expect(session.getViews()[second!.id]!.status?.imageIndex).toBe(5);
    // Not linked from an inactive cell.
    grid.scrollBy(second!.id, 2);
    expect(session.getViews()[first!.id]!.status?.imageIndex).toBe(5);
  });

  it('shows reference lines from the active 2D cell only when enabled', async () => {
    const { session, grid } = setup();
    await session.openFiles(stackFiles());
    session.setReferenceLines(true);
    expect(grid.setReferenceLines).toHaveBeenLastCalledWith(session.getState().activeCellId);
    session.setReferenceLines(false);
    expect(grid.setReferenceLines).toHaveBeenLastCalledWith(undefined);
  });

  it('switches a volume series to 3D and maps tools for the cross-sections', async () => {
    const { session, volume } = setup();
    await session.openFiles(fixturePaths('cbct').map(fixtureFile));
    const cellId = session.getState().activeCellId;
    attachVolume(session, cellId);
    session.setTool('length');
    await session.setCellMode('3d');
    expect(session.getState().cells[0]).toMatchObject({ mode: '3d', phase: 'displayed' });
    expect(volume.setTool).toHaveBeenLastCalledWith('crosshairs');
    session.setTool('pan');
    expect(volume.setTool).toHaveBeenLastCalledWith('pan');
    expect(volume.setSlab).toHaveBeenCalledWith({ mode: 'avg', thickness: 10 });
    expect(volume.setOblique).toHaveBeenCalledWith(false);
    expect(volume.setVolumePreset).toHaveBeenCalledWith('CT-Bone');
    expect(volume.setCrosshairsVisible).toHaveBeenCalledWith(true);
    session.setMprLayout('single');
    session.setMprView(0, 'sagittal');
    expect(session.getState().cells[0]).toMatchObject({ mprLayout: 'single' });
    expect(session.getState().cells[0]!.mprViews).toEqual(['sagittal', 'axial', 'coronal', 'volume']);
    expect(session.getViews()[cellId]!.activeView).toBe('sagittal');
    session.setSlab({ mode: 'mip', thickness: 200 });
    expect(volume.setSlab).toHaveBeenLastCalledWith({ mode: 'mip', thickness: 100 });
    session.setOblique(true);
    expect(volume.setOblique).toHaveBeenLastCalledWith(true);
    session.setVolumePreset('CT-MIP');
    expect(session.getState().cells[0]!.volumePreset).toBe('CT-MIP');
    expect(volume.setVolumePreset).toHaveBeenLastCalledWith('CT-MIP');
    session.setReferenceLines(false);
    expect(volume.setCrosshairsVisible).toHaveBeenLastCalledWith(false);
    expect(session.getCellImage(cellId)?.instance).toBeDefined();
  });

  it('refuses 3D for a series that cannot form a volume', async () => {
    const { session } = setup();
    await session.openFiles(fixturePaths('single').map(fixtureFile));
    await session.setCellMode('3d');
    expect(session.getState().cells[0]!.mode).toBe('2d');
  });

  it('reports scan errors and resets on clear', async () => {
    const { session } = setup();
    const onError = vi.fn();
    const withEvents = new WorkstationSession({
      createGridRenderer: createFakeGridRenderer().createGridRenderer,
      rendererConfig: { codecBasePath: '/' },
      getEvents: () => ({ onError }),
    });
    await withEvents.openFiles([new File(['not dicom'], 'x.txt')]);
    expect(withEvents.getState()).toMatchObject({ phase: 'error' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_DICOM_FILES' }));

    await session.openFiles(stackFiles());
    session.setTab('map');
    session.clear();
    expect(session.getState()).toMatchObject({ phase: 'idle', studies: [], tab: 'viewer' });
    expect(session.getState().cells.every((cell) => cell.phase === 'empty')).toBe(true);
  });

  it('maps the displayed image to its file for the overlay and tag map', async () => {
    const { session, grid } = setup();
    await session.openFiles(stackFiles());
    const cellId = session.getState().activeCellId;
    const first = session.getCellImage(cellId)!.instance;
    grid.setImageIndex(cellId, 3);
    const fourth = session.getCellImage(cellId)!.instance;
    expect(fourth).not.toBe(first);
    expect(session.getInstances(session.getState().cells[0]!.seriesInstanceUid).indexOf(fourth)).toBe(3);
  });
});

describe('WorkstationSession: viewer options', () => {
  it('builds grids with a large primary cell and keeps the active cell when shrinking', async () => {
    const { session, attachAll } = setup({ initialGrid: { rows: 2, columns: 2 } });
    attachAll();
    await session.openFiles(allFiles());
    const third = session.getState().cells[2]!;
    session.setActiveCell(third.id);
    session.setGrid({ rows: 2, columns: 2, primary: 'top' });
    expect(session.getState().cells).toHaveLength(3);
    session.setGrid({ rows: 1, columns: 1 });
    expect(session.getState().cells.map((cell) => cell.id)).toEqual([third.id]);
    expect(session.getState().cells[0]!.seriesInstanceUid).toBe(third.seriesInstanceUid);
  });

  it('shows and hides measurements and notes, and reveals them when drawing', async () => {
    const { session, grid } = setup();
    await session.openFiles(stackFiles());
    session.setAnnotationVisibility({ measurements: false });
    expect(grid.setAnnotationVisibility).toHaveBeenLastCalledWith({ measurements: false, annotations: true });
    session.setAnnotationVisibility({ annotations: false });
    expect(session.getState()).toMatchObject({ showMeasurements: false, showAnnotations: false });
    session.setTool('length');
    expect(session.getState().showMeasurements).toBe(true);
    session.setTool('arrow');
    expect(session.getState().showAnnotations).toBe(true);
  });

  it('stops cine at the last image when looping is off', async () => {
    vi.useFakeTimers();
    const { session } = setup({ cineFps: 20 });
    await session.openFiles(stackFiles());
    const cellId = session.getState().activeCellId;
    session.setCineLoop(false);
    session.toggleCine();
    vi.advanceTimersByTime(2000);
    expect(session.getViews()[cellId]!.status?.imageIndex).toBe(11);
    expect(session.getState().cells[0]!.playing).toBe(false);
  });

  it('resets every displayed viewport', async () => {
    const { session, grid, attachAll } = setup({ initialGrid: { rows: 1, columns: 2 } });
    attachAll();
    await session.openFiles(allFiles());
    session.resetAll();
    expect(grid.resetView).toHaveBeenCalledTimes(2);
  });

  it('renders each series thumbnail once', async () => {
    const { session, grid } = setup();
    await session.openFiles(stackFiles());
    const uid = session.getState().studies[0]!.series[0]!.seriesInstanceUid;
    await expect(session.getThumbnail(uid)).resolves.toMatch(/^data:image\/png/);
    await session.getThumbnail(uid);
    expect(grid.renderThumbnail).toHaveBeenCalledTimes(1);
    expect(await session.getThumbnail('missing')).toBeUndefined();
  });
});

describe('helpers', () => {
  it('maps tools and MPR arrangements', () => {
    expect(volumeToolFor('windowLevel')).toBe('windowLevel');
    expect(volumeToolFor('angle')).toBe('crosshairs');
    expect(visibleViews('grid')).toEqual(['axial', 'sagittal', 'coronal', 'volume']);
    expect(visibleViews('row')).toEqual(['axial', 'sagittal', 'coronal']);
    expect(visibleViews('primaryTop', ['coronal', 'axial', 'sagittal', 'volume'])).toEqual(['coronal', 'axial', 'sagittal']);
    expect(visibleViews('single', ['volume', 'axial', 'sagittal', 'coronal'])).toEqual(['volume']);
  });
});
