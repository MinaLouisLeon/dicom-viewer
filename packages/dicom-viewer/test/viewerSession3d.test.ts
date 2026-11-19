import { describe, expect, it, vi } from 'vitest';

import { DicomViewerError } from '../src/core/errors';
import type { ViewerLayout, VolumeView } from '../src/core/renderer';
import { ViewerSession, type ViewerSessionEvents } from '../src/core/viewerSession';
import { createFakeRenderer, createFakeVolumeRenderer, flush, volumeStatusFor } from './fakeRenderer';
import { fixtureFile, fixturePaths } from './fixtures';

function setup(options: { autoFinish?: boolean; initialLayout?: ViewerLayout; withVolume?: boolean } = {}) {
  const stack = createFakeRenderer({ autoFinish: true });
  const volume = createFakeVolumeRenderer({ autoFinish: options.autoFinish });
  const events: Required<ViewerSessionEvents> = {
    onStateChange: vi.fn(),
    onStudiesLoaded: vi.fn(),
    onSeriesDisplayed: vi.fn(),
    onError: vi.fn(),
  };
  const session = new ViewerSession({
    createRenderer: stack.createRenderer,
    createVolumeRenderer: options.withVolume === false ? undefined : volume.createVolumeRenderer,
    rendererConfig: { codecBasePath: '/codecs/' },
    getEvents: () => events,
    progressIntervalMs: 0,
    initialLayout: options.initialLayout,
  });
  session.attach(document.createElement('div'));
  const elements = Object.fromEntries(
    (['axial', 'sagittal', 'coronal', 'volume'] as VolumeView[]).map((view) => [view, document.createElement('div')]),
  ) as Record<VolumeView, HTMLDivElement>;
  session.attachVolume(elements);
  return { session, events, stack: stack.renderer, volume: volume.renderer, createVolumeRenderer: volume.createVolumeRenderer };
}

const cbct = () => fixturePaths('cbct').map(fixtureFile);
const enhanced = () => fixturePaths('cbct-multiframe').map(fixtureFile);
const single = () => [fixtureFile('single/intraoral-explicit-le.dcm')];
const missing = () => fixturePaths('cbct-missing-slice').map(fixtureFile);

describe('ViewerSession 3D layout', () => {
  it('opens in 2D by default and does not load the volume code', async () => {
    const { session, createVolumeRenderer, stack } = setup({ autoFinish: true });
    await session.openFiles(cbct());
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '2d' });
    expect(stack.shown).toHaveLength(1);
    expect(createVolumeRenderer).not.toHaveBeenCalled();
  });

  it('opens a volume series in 3D when 3D is preferred, with slices in geometric order', async () => {
    const { session, volume, events } = setup({ autoFinish: true, initialLayout: '3d' });
    await session.openFiles(cbct());
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '3d' });
    expect(volume.shown[0]).toHaveLength(64);
    expect(events.onSeriesDisplayed).toHaveBeenCalledWith(expect.objectContaining({ imageCount: 64 }), '3d');
    expect(session.getViewportState()).toMatchObject({ tool: 'crosshairs', volumeStatus: volumeStatusFor(64) });
  });

  it('passes one slice per frame for an enhanced multi-frame file', async () => {
    const { session, volume } = setup({ autoFinish: true, initialLayout: '3d' });
    await session.openFiles(enhanced());
    const frames = volume.shown[0]!;
    expect(frames).toHaveLength(64);
    expect(new Set(frames.map((frame) => frame.file)).size).toBe(1);
    // Frames are stored superior first, so slice order starts at the last frame.
    expect(frames[0]?.frame).toBe(64);
    expect(frames.at(-1)?.frame).toBe(1);
  });

  it('falls back to 2D for series that cannot form a volume, keeping the 3D preference', async () => {
    const { session, volume, stack } = setup({ autoFinish: true, initialLayout: '3d' });
    await session.openFiles(single());
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '2d' });
    expect(volume.shown).toHaveLength(0);
    expect(stack.shown).toHaveLength(1);

    await session.openFiles(cbct());
    expect(session.getState().layout).toBe('3d');
  });

  it('switches layouts for the selected series and releases the other renderer', async () => {
    const { session, volume, stack } = setup({ autoFinish: true });
    await session.openFiles(cbct());
    stack.clear.mockClear();

    await session.setLayout('3d');
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '3d' });
    expect(stack.clear).toHaveBeenCalled();
    expect(volume.shown).toHaveLength(1);

    volume.clear.mockClear();
    await session.setLayout('2d');
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '2d' });
    expect(volume.clear).toHaveBeenCalled();
    expect(stack.shown).toHaveLength(2);
  });

  it('ignores a switch to 3D for an unsupported series or without a volume renderer', async () => {
    const { session, volume } = setup({ autoFinish: true });
    await session.openFiles(missing());
    expect(session.canShowVolume(session.getState().selectedSeriesUid!)).toBe(false);
    await session.setLayout('3d');
    expect(session.getState().layout).toBe('2d');
    expect(volume.shown).toHaveLength(0);

    const without = setup({ autoFinish: true, withVolume: false });
    await without.session.openFiles(cbct());
    await without.session.setLayout('3d');
    expect(without.session.getState().layout).toBe('2d');
  });

  it('fails with VOLUME_UNSUPPORTED when 3D is requested explicitly for an unsupported series', async () => {
    const { session, events } = setup({ autoFinish: true });
    await session.openFiles(missing());
    await session.selectSeries(session.getState().selectedSeriesUid!, { layout: '3d' });
    expect(session.getState()).toMatchObject({ phase: 'error', layout: '3d', error: { code: 'VOLUME_UNSUPPORTED' } });
    expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'VOLUME_UNSUPPORTED' }));
    // Recover in 2D.
    await session.setLayout('2d');
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '2d', error: undefined });
  });

  it('publishes volume load progress while loading', async () => {
    const { session, volume } = setup({ initialLayout: '3d' });
    const pending = session.openFiles(cbct());
    await vi.waitFor(() => expect(volume.shown).toHaveLength(1));
    volume.progress(10, 128);
    expect(session.getState()).toMatchObject({ phase: 'loading', progress: { processed: 10, total: 128 } });
    volume.finish();
    await pending;
    expect(session.getState()).toMatchObject({ phase: 'displayed', progress: undefined });
  });

  it('keeps the studies after a volume decode failure so the series can open in 2D', async () => {
    const { session, volume } = setup({ initialLayout: '3d' });
    const pending = session.openFiles(cbct());
    await vi.waitFor(() => expect(volume.shown).toHaveLength(1));
    volume.failWith(new DicomViewerError('VOLUME_LOAD_FAILED'));
    await pending;
    expect(session.getState()).toMatchObject({ phase: 'error', layout: '3d', error: { code: 'VOLUME_LOAD_FAILED' } });
    expect(session.getState().studies).toHaveLength(1);
    await session.setLayout('2d');
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '2d' });
  });

  it('cancel during a volume load releases it and returns to the study list', async () => {
    const { session, volume } = setup({ initialLayout: '3d' });
    const pending = session.openFiles(cbct());
    await vi.waitFor(() => expect(volume.shown).toHaveLength(1));
    session.cancel();
    await pending;
    await flush();
    expect(session.getState()).toMatchObject({ phase: 'ready', selectedSeriesUid: undefined, progress: undefined });
    expect(volume.clear).toHaveBeenCalled();
  });

  it('opening another study aborts a pending volume load', async () => {
    const { session, volume, events } = setup({ initialLayout: '3d' });
    const first = session.openFiles(cbct());
    await vi.waitFor(() => expect(volume.shown).toHaveLength(1));
    const second = session.openFiles(single());
    await Promise.all([first, second]);
    expect(session.getState()).toMatchObject({ phase: 'displayed', layout: '2d' });
    expect(events.onSeriesDisplayed).toHaveBeenCalledOnce();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('keeps a tool per layout and routes view controls only to the displayed layout', async () => {
    const { session, volume, stack } = setup({ autoFinish: true, initialLayout: '3d' });
    await session.openFiles(cbct());
    expect(volume.setTool).toHaveBeenLastCalledWith('crosshairs');

    session.setTool('zoom');
    expect(volume.setTool).toHaveBeenLastCalledWith('zoom');
    session.setSliceIndex('sagittal', 10);
    session.scrollPlane('axial', -1);
    session.moveCrosshair('coronal', 1, 0);
    session.zoomView('volume', 2);
    session.panView('axial', 5, 0);
    session.rotateVolume(10, 0);
    session.adjustWindowLevel(1, 0);
    session.resetView();
    expect(volume.setSliceIndex).toHaveBeenCalledWith('sagittal', 10);
    expect(volume.scrollBy).toHaveBeenCalledWith('axial', -1);
    expect(volume.moveCrosshair).toHaveBeenCalledWith('coronal', 1, 0);
    expect(volume.zoomBy).toHaveBeenCalledWith('volume', 2);
    expect(volume.panBy).toHaveBeenCalledWith('axial', 5, 0);
    expect(volume.rotateBy).toHaveBeenCalledWith(10, 0);
    expect(volume.adjustWindowLevel).toHaveBeenCalledWith(1, 0);
    expect(volume.resetView).toHaveBeenCalledOnce();
    expect(stack.adjustWindowLevel).not.toHaveBeenCalled();
    expect(stack.resetView).not.toHaveBeenCalled();

    await session.setLayout('2d');
    expect(session.getViewportState().tool).toBe('windowLevel');
    session.setTool('crosshairs'); // not a 2D tool
    expect(session.getViewportState().tool).toBe('windowLevel');
    session.setSliceIndex('axial', 1);
    expect(volume.setSliceIndex).toHaveBeenCalledOnce();

    await session.setLayout('3d');
    expect(session.getViewportState().tool).toBe('zoom');
  });

  it('publishes volume status changes and clears them on close', async () => {
    const { session, volume, events } = setup({ autoFinish: true, initialLayout: '3d' });
    await session.openFiles(cbct());
    const stateChanges = vi.mocked(events.onStateChange).mock.calls.length;
    volume.emit({ planes: { ...volume.status!.planes, axial: { index: 3, count: 64 } } });
    expect(session.getViewportState().volumeStatus?.planes.axial.index).toBe(3);
    expect(events.onStateChange).toHaveBeenCalledTimes(stateChanges);

    session.clear();
    expect(session.getViewportState().volumeStatus).toBeUndefined();
    expect(session.getState()).toMatchObject({ phase: 'idle', layout: '3d' });
  });

  it('detach destroys both renderers', async () => {
    const { session, volume, stack } = setup({ autoFinish: true });
    await session.openFiles(cbct());
    await session.setLayout('3d');
    session.detach();
    await flush();
    expect(volume.destroy).toHaveBeenCalledOnce();
    expect(stack.destroy).toHaveBeenCalledOnce();
  });
});
