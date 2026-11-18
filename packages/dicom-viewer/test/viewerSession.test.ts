import { describe, expect, it, vi } from 'vitest';

import { DicomViewerError } from '../src/core/errors';
import { ViewerSession, type ViewerSessionEvents } from '../src/core/viewerSession';
import { createFakeRenderer, flush } from './fakeRenderer';
import { fixtureFile, fixturePaths } from './fixtures';

function setup(options: { autoFinish?: boolean } = {}) {
  const fake = createFakeRenderer(options);
  const events: Required<ViewerSessionEvents> = {
    onStateChange: vi.fn(),
    onStudiesLoaded: vi.fn(),
    onSeriesDisplayed: vi.fn(),
    onError: vi.fn(),
  };
  const session = new ViewerSession({
    createRenderer: fake.createRenderer,
    rendererConfig: { codecBasePath: '/codecs/' },
    getEvents: () => events,
    progressIntervalMs: 0,
  });
  session.attach(document.createElement('div'));
  return { session, events, ...fake };
}

const stack = () => fixturePaths('stack').map(fixtureFile);
const single = () => [fixtureFile('single/intraoral-explicit-le.dcm')];

describe('ViewerSession', () => {
  it('scans, lists studies, and displays the first series', async () => {
    const { session, events, renderer } = setup({ autoFinish: true });
    await session.openFiles(stack());

    const state = session.getState();
    expect(state.phase).toBe('displayed');
    expect(state.studies).toHaveLength(1);
    expect(state.selectedSeriesUid).toBe(state.studies[0]?.series[0]?.seriesInstanceUid);
    expect(renderer.shown[0]).toHaveLength(12);
    expect(events.onStudiesLoaded).toHaveBeenCalledOnce();
    expect(events.onSeriesDisplayed).toHaveBeenCalledWith(expect.objectContaining({ imageCount: 12 }), '2d');
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('creates the renderer lazily and only once', async () => {
    const { session, createRenderer } = setup({ autoFinish: true });
    expect(createRenderer).not.toHaveBeenCalled();
    await session.openFiles(single());
    await session.openFiles(stack());
    expect(createRenderer).toHaveBeenCalledOnce();
  });

  it('aborts a stale load when a different study is opened', async () => {
    const { session, renderer, events } = setup();
    const first = session.openFiles(stack());
    await flush();
    await vi.waitFor(() => expect(session.getState().phase).toBe('loading'));

    const second = session.openFiles(single());
    await vi.waitFor(() => expect(renderer.shown).toHaveLength(2));
    renderer.finish();
    await Promise.all([first, second]);

    const state = session.getState();
    expect(state.phase).toBe('displayed');
    expect(state.studies[0]?.description).toBe('Synthetic intraoral study');
    expect(events.onSeriesDisplayed).toHaveBeenCalledOnce();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('cancel during scanning returns to idle', async () => {
    const { session } = setup();
    const pending = session.openFiles(stack());
    expect(session.getState().phase).toBe('scanning');
    session.cancel();
    await pending;
    expect(session.getState()).toMatchObject({ phase: 'idle', studies: [] });
  });

  it('cancel during series load keeps the study list', async () => {
    const { session, renderer } = setup();
    const pending = session.openFiles(stack());
    await vi.waitFor(() => expect(session.getState().phase).toBe('loading'));
    session.cancel();
    await pending;
    expect(session.getState()).toMatchObject({ phase: 'ready', selectedSeriesUid: undefined });
    expect(session.getState().studies).toHaveLength(1);
    expect(renderer.clear).toHaveBeenCalled();
  });

  it('reports a load failure but keeps studies so another series can be chosen', async () => {
    const { session, renderer, events } = setup();
    const pending = session.openFiles(stack());
    await vi.waitFor(() => expect(renderer.shown).toHaveLength(1));
    renderer.failWith(new DicomViewerError('UNSUPPORTED_IMAGE'));
    await pending;
    expect(session.getState().phase).toBe('error');
    expect(session.getState().error?.code).toBe('UNSUPPORTED_IMAGE');
    expect(session.getState().studies).toHaveLength(1);
    expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNSUPPORTED_IMAGE' }));
  });

  it('reports when no DICOM files were selected', async () => {
    const { session, events } = setup();
    await session.openFiles([fixtureFile('invalid/not-dicom.txt')]);
    expect(session.getState()).toMatchObject({ phase: 'error', studies: [] });
    expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_DICOM_FILES' }));
  });

  it('reports renderer start-up failure', async () => {
    const { session, createRenderer, events } = setup();
    createRenderer.mockRejectedValueOnce(new DicomViewerError('RENDERER_INIT_FAILED'));
    await session.openFiles(single());
    expect(session.getState().error?.code).toBe('RENDERER_INIT_FAILED');
    expect(events.onError).toHaveBeenCalledOnce();
  });

  it('clear releases displayed data and returns to idle', async () => {
    const { session, renderer } = setup({ autoFinish: true });
    await session.openFiles(single());
    renderer.clear.mockClear();
    session.clear();
    await flush();
    expect(session.getState()).toMatchObject({ phase: 'idle', studies: [], skipped: [] });
    expect(renderer.clear).toHaveBeenCalled();
  });

  it('detach destroys the renderer and drops in-flight results', async () => {
    const { session, renderer, events } = setup();
    const pending = session.openFiles(single());
    await vi.waitFor(() => expect(renderer.shown).toHaveLength(1));
    session.detach();
    renderer.finish();
    await pending;
    await flush();
    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(session.getState().phase).toBe('idle');
    expect(events.onSeriesDisplayed).not.toHaveBeenCalled();
  });

  describe('view controls', () => {
    it('defaults to window/level and applies the tool before the first stack is shown', async () => {
      const { session, renderer } = setup({ autoFinish: true });
      expect(session.getViewportState().tool).toBe('windowLevel');
      await session.openFiles(single());
      expect(renderer.setTool).toHaveBeenCalledWith('windowLevel');
    });

    it('keeps the selected tool across studies', async () => {
      const { session, renderer } = setup({ autoFinish: true });
      await session.openFiles(single());
      session.setTool('pan');
      expect(session.getViewportState().tool).toBe('pan');
      expect(renderer.setTool).toHaveBeenLastCalledWith('pan');
      session.clear();
      await session.openFiles(stack());
      expect(session.getViewportState().tool).toBe('pan');
      expect(renderer.setTool).toHaveBeenLastCalledWith('pan');
    });

    it('forwards view operations only while a series is displayed', async () => {
      const { session, renderer } = setup();
      session.zoomBy(2);
      const pending = session.openFiles(stack());
      await vi.waitFor(() => expect(session.getState().phase).toBe('loading'));
      session.scrollBy(1);
      session.resetView();
      expect(renderer.zoomBy).not.toHaveBeenCalled();
      expect(renderer.scrollBy).not.toHaveBeenCalled();
      expect(renderer.resetView).not.toHaveBeenCalled();

      renderer.finish();
      await pending;
      session.setImageIndex(5);
      session.scrollBy(-1);
      session.zoomBy(1.2);
      session.panBy(10, -10);
      session.adjustWindowLevel(1, -1);
      session.resetView();
      expect(renderer.setImageIndex).toHaveBeenCalledWith(5);
      expect(renderer.scrollBy).toHaveBeenCalledWith(-1);
      expect(renderer.zoomBy).toHaveBeenCalledWith(1.2);
      expect(renderer.panBy).toHaveBeenCalledWith(10, -10);
      expect(renderer.adjustWindowLevel).toHaveBeenCalledWith(1, -1);
      expect(renderer.resetView).toHaveBeenCalledOnce();
    });

    it('publishes viewport status without firing onStateChange', async () => {
      const { session, renderer, events } = setup({ autoFinish: true });
      const listener = vi.fn();
      session.subscribeViewport(listener);
      await session.openFiles(stack());
      expect(session.getViewportState().status).toMatchObject({ imageIndex: 0, imageCount: 12, zoom: 1 });

      vi.mocked(events.onStateChange).mockClear();
      listener.mockClear();
      renderer.emit({ imageIndex: 3, zoom: 2 });
      expect(session.getViewportState().status).toMatchObject({ imageIndex: 3, zoom: 2 });
      expect(listener).toHaveBeenCalledOnce();
      expect(events.onStateChange).not.toHaveBeenCalled();

      // Identical status does not notify again.
      renderer.emit({});
      expect(listener).toHaveBeenCalledOnce();
    });

    it('clears viewport status when switching series, failing or closing', async () => {
      const { session, renderer } = setup();
      const pending = session.openFiles(stack());
      await vi.waitFor(() => expect(renderer.shown).toHaveLength(1));
      renderer.finish();
      await pending;
      expect(session.getViewportState().status).toBeDefined();

      const uid = session.getState().selectedSeriesUid!;
      const reload = session.selectSeries(uid);
      expect(session.getViewportState().status).toBeUndefined();
      // Frames from the stack still loading are ignored.
      renderer.emit({ imageIndex: 2 });
      expect(session.getViewportState().status).toBeUndefined();
      await vi.waitFor(() => expect(renderer.shown).toHaveLength(2));
      renderer.failWith(new DicomViewerError('IMAGE_LOAD_FAILED'));
      await reload;
      expect(session.getViewportState().status).toBeUndefined();

      session.clear();
      expect(session.getViewportState()).toEqual({ tool: 'windowLevel', status: undefined });
    });
  });

  it('never puts file names or DICOM values in error messages', async () => {
    const { session, events } = setup();
    await session.openFiles([fixtureFile('invalid/not-dicom.txt')]);
    const error = vi.mocked(events.onError).mock.calls[0]?.[0];
    expect(error?.message).toBe('NO_DICOM_FILES');
  });
});
