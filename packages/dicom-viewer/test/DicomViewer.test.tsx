import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateRenderer, CreateVolumeRenderer } from '../src/core/renderer';
import { DicomViewerError } from '../src/core/errors';
import { createFakeRenderer, createFakeVolumeRenderer } from './fakeRenderer';
import { fixtureFile, fixturePaths } from './fixtures';

const fake = vi.hoisted(() => ({ current: undefined as ReturnType<typeof createFakeRenderer> | undefined }));
const fakeVolume = vi.hoisted(() => ({ current: undefined as ReturnType<typeof createFakeVolumeRenderer> | undefined }));

vi.mock(import('../src/core/renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  createCornerstoneRenderer: (...args: Parameters<CreateRenderer>) => fake.current!.createRenderer(...args),
  createCornerstoneVolumeRenderer: (...args: Parameters<CreateVolumeRenderer>) =>
    fakeVolume.current!.createVolumeRenderer(...args),
}));

const { DicomViewer, defaultLabels } = await import('../src/index');
type Handle = import('../src/index').DicomViewerHandle;

beforeEach(() => {
  fake.current = createFakeRenderer({ autoFinish: true });
  fakeVolume.current = createFakeVolumeRenderer({ autoFinish: true });
});

describe('<DicomViewer />', () => {
  it('uses one toolbar tab stop and moves focus with arrow and boundary keys', async () => {
    const user = userEvent.setup();
    render(<DicomViewer />);
    const files = screen.getByRole('button', { name: 'Open files' });
    const folder = screen.getByRole('button', { name: 'Open folder' });
    await user.tab();
    expect(files).toHaveFocus();
    expect(folder).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowRight}');
    expect(folder).toHaveFocus();
    await user.keyboard('{Home}');
    expect(files).toHaveFocus();
    await user.keyboard('{End}');
    expect(folder).toHaveFocus();
  });

  it('selects the pan tool using a shortcut in the image viewport', async () => {
    const user = userEvent.setup();
    render(<DicomViewer />);
    await user.upload(screen.getByTestId('mihawk-dv-file-input'), fixturePaths('single').map(fixtureFile));
    const pane = screen.getByTestId('mihawk-dv-viewport');
    await waitFor(() => expect(pane).toHaveAttribute('data-visible', 'true'));
    pane.focus();
    await user.keyboard('p');
    expect(screen.getByRole('button', { name: 'Pan' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the drop zone and privacy note before files are opened', () => {
    render(<DicomViewer />);
    expect(screen.getByRole('region', { name: 'DICOM viewer' })).toBeInTheDocument();
    expect(screen.getByText(defaultLabels.dropZoneTitle)).toBeInTheDocument();
    expect(screen.getByText(defaultLabels.privacyNote)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument();
  });

  it('opens files through the built-in picker and lists studies and series', async () => {
    const user = userEvent.setup();
    const onSeriesDisplayed = vi.fn();
    render(<DicomViewer onSeriesDisplayed={onSeriesDisplayed} />);

    const files = [...fixturePaths('single'), ...fixturePaths('codecs'), 'invalid/not-dicom.txt'].map(fixtureFile);
    await user.upload(screen.getByTestId('mihawk-dv-file-input'), files);

    await waitFor(() => expect(onSeriesDisplayed).toHaveBeenCalled());
    const nav = screen.getByRole('navigation', { name: 'Studies' });
    expect(within(nav).getByText('Synthetic intraoral study')).toBeInTheDocument();
    const seriesButtons = within(nav).getAllByRole('button');
    expect(seriesButtons).toHaveLength(3);
    expect(seriesButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(seriesButtons[0]).toHaveTextContent('#1 · IO · Uncompressed');
    expect(screen.getByText('1 file was skipped.')).toBeInTheDocument();
    expect(screen.getByTestId('mihawk-dv-viewport')).toHaveAttribute('data-visible', 'true');
  });

  it('switches series when another is selected', async () => {
    const user = userEvent.setup();
    render(<DicomViewer />);
    await user.upload(screen.getByTestId('mihawk-dv-file-input'), [...fixturePaths('single'), ...fixturePaths('codecs')].map(fixtureFile));
    const nav = await screen.findByRole('navigation', { name: 'Studies' });
    const [, j2k] = within(nav).getAllByRole('button');
    await user.click(j2k!);
    await waitFor(() => expect(j2k).toHaveAttribute('aria-pressed', 'true'));
    expect(fake.current!.renderer.shown).toHaveLength(2);
  });

  it('shows an actionable error for non-DICOM selections', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<DicomViewer onError={onError} />);
    await user.upload(screen.getByTestId('mihawk-dv-file-input'), [fixtureFile('invalid/not-dicom.txt')]);
    expect(await screen.findByRole('alert')).toHaveTextContent(defaultLabels.errors.NO_DICOM_FILES);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_DICOM_FILES' }));
  });

  it('closes the study and returns to the drop zone', async () => {
    const user = userEvent.setup();
    render(<DicomViewer />);
    await user.upload(screen.getByTestId('mihawk-dv-file-input'), fixturePaths('single').map(fixtureFile));
    await user.click(await screen.findByRole('button', { name: 'Close study' }));
    expect(screen.getByText(defaultLabels.dropZoneTitle)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows cancel while busy and cancels with Escape', async () => {
    fake.current = createFakeRenderer();
    const user = userEvent.setup();
    render(<DicomViewer />);
    await user.upload(screen.getByTestId('mihawk-dv-file-input'), fixturePaths('single').map(fixtureFile));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(screen.getByRole('status')).toHaveTextContent(defaultLabels.loadingSeries);
    cancel.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Studies' })).toBeInTheDocument();
  });

  it('accepts files from the host and exposes an imperative clear for logout', async () => {
    const ref = createRef<Handle>();
    const onStudiesLoaded = vi.fn();
    const files = fixturePaths('stack').map(fixtureFile);
    render(<DicomViewer ref={ref} files={files} onStudiesLoaded={onStudiesLoaded} />);
    await waitFor(() => expect(ref.current?.getState().phase).toBe('displayed'));
    expect(onStudiesLoaded).toHaveBeenCalledOnce();
    act(() => ref.current?.clear());
    expect(ref.current?.getState().phase).toBe('idle');
  });

  it('applies translated labels', async () => {
    const user = userEvent.setup();
    render(
      <DicomViewer
        labels={{
          openFiles: 'Ouvrir des fichiers',
          errors: { ...defaultLabels.errors, NO_DICOM_FILES: 'Aucune image DICOM.' },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ouvrir des fichiers' })).toBeInTheDocument();
    await user.upload(screen.getByTestId('mihawk-dv-file-input'), [fixtureFile('invalid/not-dicom.txt')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Aucune image DICOM.');
  });

  describe('2D tools', () => {
    async function openStack() {
      const ref = createRef<Handle>();
      const user = userEvent.setup();
      render(<DicomViewer ref={ref} files={fixturePaths('stack').map(fixtureFile)} />);
      await waitFor(() => expect(ref.current?.getState().phase).toBe('displayed'));
      return { ref, user, renderer: fake.current!.renderer };
    }

    it('shows tool buttons with the selected tool pressed', async () => {
      const { user, renderer } = await openStack();
      const group = screen.getByRole('group', { name: defaultLabels.toolGroup });
      const wl = within(group).getByRole('button', { name: 'Window/level' });
      const pan = within(group).getByRole('button', { name: 'Pan' });
      expect(wl).toHaveAttribute('aria-pressed', 'true');
      await user.click(pan);
      expect(pan).toHaveAttribute('aria-pressed', 'true');
      expect(wl).toHaveAttribute('aria-pressed', 'false');
      expect(renderer.setTool).toHaveBeenLastCalledWith('pan');
    });

    it('disables view controls while a series is loading', async () => {
      fake.current = createFakeRenderer();
      const user = userEvent.setup();
      render(<DicomViewer />);
      await user.upload(screen.getByTestId('mihawk-dv-file-input'), fixturePaths('stack').map(fixtureFile));
      await screen.findByRole('button', { name: 'Cancel' });
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Pan' })).toBeDisabled();
      expect(screen.getByTestId('mihawk-dv-viewport')).toHaveAttribute('tabindex', '-1');
    });

    it('zooms and resets from the toolbar', async () => {
      const { user, renderer, ref } = await openStack();
      await user.click(screen.getByRole('button', { name: 'Zoom in' }));
      await user.click(screen.getByRole('button', { name: 'Zoom out' }));
      await user.click(screen.getByRole('button', { name: 'Reset view' }));
      expect(renderer.zoomBy).toHaveBeenNthCalledWith(1, 1.2);
      expect(renderer.zoomBy).toHaveBeenNthCalledWith(2, 1 / 1.2);
      expect(renderer.resetView).toHaveBeenCalledOnce();
      act(() => ref.current?.resetView());
      expect(renderer.resetView).toHaveBeenCalledTimes(2);
    });

    it('navigates a stack with the slice controls', async () => {
      const { user, renderer } = await openStack();
      const nav = screen.getByRole('group', { name: defaultLabels.sliceControls });
      expect(screen.getByTestId('mihawk-dv-slice-position')).toHaveTextContent('1 / 12');
      expect(within(nav).getByRole('button', { name: 'Previous image' })).toBeDisabled();
      const slider = within(nav).getByRole('slider', { name: 'Image' });
      expect(slider).toHaveAttribute('aria-valuetext', 'Image 1 of 12');

      await user.click(within(nav).getByRole('button', { name: 'Next image' }));
      expect(renderer.scrollBy).toHaveBeenCalledWith(1);

      act(() => renderer.emit({ imageIndex: 11 }));
      expect(screen.getByTestId('mihawk-dv-slice-position')).toHaveTextContent('12 / 12');
      expect(slider).toHaveAttribute('aria-valuetext', 'Image 12 of 12');
      expect(within(nav).getByRole('button', { name: 'Next image' })).toBeDisabled();
    });

    it('has no slice controls for a single image', async () => {
      const ref = createRef<Handle>();
      render(<DicomViewer ref={ref} files={fixturePaths('single').map(fixtureFile)} />);
      await waitFor(() => expect(ref.current?.getState().phase).toBe('displayed'));
      expect(screen.queryByRole('group', { name: defaultLabels.sliceControls })).not.toBeInTheDocument();
    });

    it('maps arrow keys to the selected tool', async () => {
      const { user, renderer, ref } = await openStack();
      const image = screen.getByRole('application', { name: defaultLabels.imageViewport });
      expect(image).toHaveAccessibleDescription(defaultLabels.imageViewportHelp);
      image.focus();

      await user.keyboard('{ArrowRight}{ArrowUp}{Shift>}{ArrowDown}{/Shift}');
      expect(renderer.adjustWindowLevel.mock.calls).toEqual([
        [1, 0],
        [0, 1],
        [0, -5],
      ]);

      act(() => ref.current?.setTool('pan'));
      await user.keyboard('{ArrowLeft}{Shift>}{ArrowDown}{/Shift}');
      expect(renderer.panBy.mock.calls).toEqual([
        [-20, 0],
        [0, 100],
      ]);

      act(() => ref.current?.setTool('zoom'));
      await user.keyboard('{ArrowUp}{ArrowDown}');
      expect(renderer.zoomBy.mock.calls).toEqual([[1.2], [1 / 1.2]]);

      act(() => ref.current?.setTool('scroll'));
      await user.keyboard('{ArrowDown}{ArrowLeft}');
      expect(renderer.scrollBy.mock.calls).toEqual([[1], [-1]]);
    });

    it('supports tool-independent keyboard shortcuts', async () => {
      const { user, renderer } = await openStack();
      screen.getByRole('application').focus();
      await user.keyboard('{PageDown}{PageUp}{Shift>}{PageDown}{/Shift}{End}{Home}+-r');
      expect(renderer.scrollBy.mock.calls).toEqual([[1], [-1], [1]]);
      expect(renderer.setImageIndex.mock.calls).toEqual([[11], [0]]);
      expect(renderer.zoomBy.mock.calls).toEqual([[1.2], [1 / 1.2]]);
      expect(renderer.resetView).toHaveBeenCalledOnce();
    });

    it('shows window/level and zoom in the status bar', async () => {
      const { renderer } = await openStack();
      const readout = screen.getByTestId('mihawk-dv-readout');
      expect(readout).toHaveTextContent('W 400 · L 40');
      expect(readout).toHaveTextContent('Zoom 100%');
      act(() => renderer.emit({ windowWidth: 1500.4, windowCenter: -600.6, zoom: 2.5 }));
      expect(readout).toHaveTextContent('W 1500 · L -601');
      expect(readout).toHaveTextContent('Zoom 250%');
    });

    it('reports an image in the stack that cannot be decoded without leaving the series', async () => {
      const { renderer, ref } = await openStack();
      act(() => renderer.emit({ imageIndex: 4, imageFailed: true }));
      expect(screen.getByRole('alert')).toHaveTextContent(defaultLabels.imageFailed(5, 12));
      expect(ref.current?.getState().phase).toBe('displayed');
      act(() => renderer.emit({ imageIndex: 5, imageFailed: false }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('starts with the tool given by initialTool', async () => {
      const ref = createRef<Handle>();
      render(<DicomViewer ref={ref} initialTool="scroll" files={fixturePaths('stack').map(fixtureFile)} />);
      await waitFor(() => expect(ref.current?.getState().phase).toBe('displayed'));
      expect(screen.getByRole('button', { name: 'Scroll' })).toHaveAttribute('aria-pressed', 'true');
      expect(fake.current!.renderer.setTool).toHaveBeenCalledWith('scroll');
    });
  });

  describe('3D layout', () => {
    async function openCbct(props: Partial<import('../src/index').DicomViewerProps> = {}) {
      const ref = createRef<Handle>();
      const user = userEvent.setup();
      const files = [...fixturePaths('cbct'), ...fixturePaths('cbct-missing-slice')].map(fixtureFile);
      render(<DicomViewer ref={ref} files={files} {...props} />);
      await waitFor(() => expect(ref.current?.getState().phase).toBe('displayed'));
      return { ref, user, volume: fakeVolume.current!.renderer };
    }

    it('marks volume-capable series and switches to linked cross-sections and a 3D view', async () => {
      const { user, volume, ref } = await openCbct();
      const nav = screen.getByRole('navigation', { name: 'Studies' });
      expect(within(nav).getAllByTestId('mihawk-dv-volume-badge')).toHaveLength(1);

      const layout = screen.getByRole('group', { name: defaultLabels.layoutGroup });
      await user.click(within(layout).getByRole('button', { name: '3D' }));
      await waitFor(() => expect(ref.current?.getState().layout).toBe('3d'));
      expect(within(layout).getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
      expect(volume.shown[0]).toHaveLength(64);

      for (const name of ['Axial', 'Sagittal', 'Coronal']) {
        expect(screen.getByRole('application', { name })).toHaveAccessibleDescription(defaultLabels.planeViewportHelp);
      }
      expect(screen.getByRole('application', { name: '3D' })).toHaveAccessibleDescription(
        defaultLabels.volumeViewportHelp,
      );
      expect(screen.queryByRole('application', { name: defaultLabels.imageViewport })).not.toBeInTheDocument();
      expect(screen.getByTestId('mihawk-dv-slice-axial')).toHaveTextContent('33 / 64');
      expect(screen.getByRole('button', { name: 'Crosshairs' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('disables 3D with the reason for a series that cannot form a volume', async () => {
      const { user } = await openCbct();
      const nav = screen.getByRole('navigation', { name: 'Studies' });
      await user.click(within(nav).getAllByRole('button')[1]!);
      const threeD = screen.getByTestId('mihawk-dv-layout-3d');
      await waitFor(() => expect(threeD).toBeDisabled());
      expect(threeD).toHaveAccessibleDescription(defaultLabels.volumeUnsupportedReasons['missing-slices']);
    });

    it('moves each cross-section with its slider and the keyboard', async () => {
      const { user, volume } = await openCbct({ initialLayout: '3d' });
      const slider = screen.getByRole('slider', { name: 'Sagittal slice' });
      expect(slider).toHaveAttribute('aria-valuetext', 'Slice 49 of 96');
      fireEvent.change(slider, { target: { value: '50' } });
      expect(volume.setSliceIndex).toHaveBeenLastCalledWith('sagittal', 49);

      const axial = screen.getByRole('application', { name: 'Axial' });
      act(() => axial.focus());
      await user.keyboard('{ArrowRight}{Shift>}{ArrowUp}{/Shift}{PageDown}{End}{Home}');
      expect(volume.moveCrosshair.mock.calls).toEqual([
        ['axial', 1, 0],
        ['axial', 0, -5],
      ]);
      expect(volume.scrollBy).toHaveBeenCalledWith('axial', 1);
      expect(volume.setSliceIndex.mock.calls.slice(-2)).toEqual([
        ['axial', 63],
        ['axial', 0],
      ]);

      act(() => volume.emit({ planes: { ...volume.status!.planes, axial: { index: 63, count: 64 } } }));
      expect(screen.getByTestId('mihawk-dv-slice-axial')).toHaveTextContent('64 / 64');
    });

    it('rotates and zooms the 3D view from the keyboard and toolbar', async () => {
      const { user, volume } = await openCbct({ initialLayout: '3d' });
      const view = screen.getByRole('application', { name: '3D' });
      await user.click(view);
      await user.keyboard('{ArrowLeft}{Shift>}{ArrowDown}{/Shift}+r');
      expect(volume.rotateBy.mock.calls).toEqual([
        [-10, 0],
        [0, 30],
      ]);
      expect(volume.zoomBy).toHaveBeenCalledWith('volume', 1.2);
      expect(volume.resetView).toHaveBeenCalledOnce();

      await user.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(volume.zoomBy).toHaveBeenLastCalledWith('volume', 1 / 1.2);
      expect(screen.getByTestId('mihawk-dv-readout')).toHaveTextContent('3D · Zoom 100%');
    });

    it('shows a notice in the 3D pane when volume rendering is unavailable', async () => {
      fakeVolume.current = createFakeVolumeRenderer({ autoFinish: true, volumeRendering: false });
      await openCbct({ initialLayout: '3d' });
      expect(screen.getByRole('note')).toHaveTextContent(defaultLabels.volumeRenderingUnavailable);
      expect(screen.getByTestId('mihawk-dv-pane-volume')).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('application', { name: 'Axial' })).toHaveAttribute('tabindex', '0');
    });

    it('shows volume progress and offers to open the series in 2D after a 3D failure', async () => {
      fakeVolume.current = createFakeVolumeRenderer();
      const ref = createRef<Handle>();
      const user = userEvent.setup();
      render(<DicomViewer ref={ref} initialLayout="3d" files={fixturePaths('cbct').map(fixtureFile)} />);
      await waitFor(() => expect(fakeVolume.current!.renderer.shown).toHaveLength(1));
      act(() => fakeVolume.current!.renderer.progress(32, 128));
      expect(await screen.findByRole('progressbar', { name: 'Loading volume… 25%' })).toBeInTheDocument();
      act(() => fakeVolume.current!.renderer.failWith(new DicomViewerError('VOLUME_LOAD_FAILED')));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(defaultLabels.errors.VOLUME_LOAD_FAILED);
      await user.click(within(alert).getByRole('button', { name: defaultLabels.openIn2d }));
      await waitFor(() => expect(ref.current?.getState()).toMatchObject({ phase: 'displayed', layout: '2d' }));
    });
  });

  it('releases renderer resources on unmount', async () => {
    const files = fixturePaths('single').map(fixtureFile);
    const ref = createRef<Handle>();
    const { unmount } = render(<DicomViewer ref={ref} files={files} />);
    await waitFor(() => expect(ref.current?.getState().phase).toBe('displayed'));
    unmount();
    await waitFor(() => expect(fake.current!.renderer.destroy).toHaveBeenCalledOnce());
  });
});
