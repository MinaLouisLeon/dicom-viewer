import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateRenderer } from '../src/core/renderer';
import { createFakeRenderer } from './fakeRenderer';
import { fixtureFile, fixturePaths } from './fixtures';

const fake = vi.hoisted(() => ({ current: undefined as ReturnType<typeof createFakeRenderer> | undefined }));

vi.mock('../src/core/renderer', () => ({
  createCornerstoneRenderer: (...args: Parameters<CreateRenderer>) => fake.current!.createRenderer(...args),
}));

const { DicomViewer, defaultLabels } = await import('../src/index');
type Handle = import('../src/index').DicomViewerHandle;

beforeEach(() => {
  fake.current = createFakeRenderer({ autoFinish: true });
});

describe('<DicomViewer />', () => {
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
    await user.upload(screen.getByTestId('mivo-dv-file-input'), files);

    await waitFor(() => expect(onSeriesDisplayed).toHaveBeenCalled());
    const nav = screen.getByRole('navigation', { name: 'Studies' });
    expect(within(nav).getByText('Synthetic intraoral study')).toBeInTheDocument();
    const seriesButtons = within(nav).getAllByRole('button');
    expect(seriesButtons).toHaveLength(3);
    expect(seriesButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(seriesButtons[0]).toHaveTextContent('#1 · IO · Uncompressed');
    expect(screen.getByText('1 file was skipped.')).toBeInTheDocument();
    expect(screen.getByTestId('mivo-dv-viewport')).toHaveAttribute('data-visible', 'true');
  });

  it('switches series when another is selected', async () => {
    const user = userEvent.setup();
    render(<DicomViewer />);
    await user.upload(screen.getByTestId('mivo-dv-file-input'), [...fixturePaths('single'), ...fixturePaths('codecs')].map(fixtureFile));
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
    await user.upload(screen.getByTestId('mivo-dv-file-input'), [fixtureFile('invalid/not-dicom.txt')]);
    expect(await screen.findByRole('alert')).toHaveTextContent(defaultLabels.errors.NO_DICOM_FILES);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_DICOM_FILES' }));
  });

  it('closes the study and returns to the drop zone', async () => {
    const user = userEvent.setup();
    render(<DicomViewer />);
    await user.upload(screen.getByTestId('mivo-dv-file-input'), fixturePaths('single').map(fixtureFile));
    await user.click(await screen.findByRole('button', { name: 'Close study' }));
    expect(screen.getByText(defaultLabels.dropZoneTitle)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows cancel while busy and cancels with Escape', async () => {
    fake.current = createFakeRenderer();
    const user = userEvent.setup();
    render(<DicomViewer />);
    await user.upload(screen.getByTestId('mivo-dv-file-input'), fixturePaths('single').map(fixtureFile));
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
    await user.upload(screen.getByTestId('mivo-dv-file-input'), [fixtureFile('invalid/not-dicom.txt')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Aucune image DICOM.');
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
