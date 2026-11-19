import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { DicomWorkstation, defaultWorkstationLabels, type DicomWorkstationHandle } from '../src/index';
import { createFakeVolumeRenderer } from './fakeRenderer';
import { createFakeGridRenderer } from './fakeGridRenderer';
import { fixtureFile, fixturePaths } from './fixtures';

let grid: ReturnType<typeof createFakeGridRenderer>;
let volume: ReturnType<typeof createFakeVolumeRenderer>;

beforeEach(() => {
  grid = createFakeGridRenderer();
  volume = createFakeVolumeRenderer({ autoFinish: true });
});

function renderWorkstation(props: Partial<React.ComponentProps<typeof DicomWorkstation>> = {}) {
  const ref = createRef<DicomWorkstationHandle>();
  const view = render(
    <div style={{ width: 1400, height: 800 }}>
      <DicomWorkstation
        ref={ref}
        createGridRenderer={grid.createGridRenderer}
        createVolumeRenderer={volume.createVolumeRenderer}
        {...props}
      />
    </div>,
  );
  return { ref, ...view };
}

const stack = () => fixturePaths('stack').map(fixtureFile);

describe('<DicomWorkstation />', () => {
  it('shows the drop zone with file buttons and the Viewer and Map tabs', () => {
    renderWorkstation();
    expect(screen.getByText(defaultWorkstationLabels.dropZoneTitle)).toBeInTheDocument();
    expect(screen.getByTestId('mihawk-ws-open-files')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Viewer' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Map' })).toBeInTheDocument();
  });

  it('opens files, lists series and shows the tag map of the active image', async () => {
    const user = userEvent.setup();
    const { ref } = renderWorkstation();
    await act(() => ref.current!.openFiles(stack()));
    await waitFor(() => expect(screen.getByTestId('mihawk-ws-cell')).toHaveAttribute('data-phase', 'displayed'));
    expect(screen.getAllByTestId('mihawk-ws-series')).toHaveLength(1);
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    const map = await screen.findByTestId('mihawk-ws-map');
    await waitFor(() => expect(within(map).getByText('Modality')).toBeInTheDocument());
    // Patient data is hidden until the user turns on patient details.
    const nameRow = within(map).queryByText("Patient's Name")?.closest('tr');
    if (nameRow) expect(nameRow).toHaveTextContent(defaultWorkstationLabels.mapRedacted);
    await user.type(within(map).getByRole('searchbox'), 'rows');
    await waitFor(() => expect(within(map).getAllByRole('row')).toHaveLength(2));
  });

  it('changes the viewport grid from the layout selector', async () => {
    const user = userEvent.setup();
    const { ref } = renderWorkstation();
    await act(() => ref.current!.openFiles(stack()));
    await user.click(screen.getByTestId('mihawk-ws-layout-menu'));
    await user.click(screen.getByTestId('mihawk-ws-grid-2x2'));
    expect(screen.getAllByTestId('mihawk-ws-cell')).toHaveLength(4);
    expect(ref.current!.getState().grid).toEqual({ rows: 2, columns: 2 });
  });

  it('applies brightness and contrast presets from the menu and keyboard', async () => {
    const user = userEvent.setup();
    const { ref } = renderWorkstation();
    await act(() => ref.current!.openFiles(stack()));
    await waitFor(() => expect(ref.current!.getState().cells[0]!.phase).toBe('displayed'));
    await user.click(screen.getByTestId('mihawk-ws-window-menu'));
    await user.click(screen.getByTestId('mihawk-ws-preset-lung'));
    expect(grid.renderer.setWindow).toHaveBeenLastCalledWith(expect.any(String), { width: 1500, center: -600 });
    expect(screen.getByTestId('mihawk-ws-preset-lung')).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    screen.getByTestId('mihawk-ws-cell-viewport').focus();
    await user.keyboard('1');
    expect(grid.renderer.setWindow).toHaveBeenLastCalledWith(expect.any(String), 'auto');
    await user.keyboard('i');
    expect(grid.renderer.setTransform).toHaveBeenLastCalledWith(expect.any(String), { invert: true });
    await user.keyboard('l');
    expect(grid.renderer.setTool).toHaveBeenLastCalledWith('length');
  });

  it('uses a side menu with every option on phones and tablets', async () => {
    const user = userEvent.setup();
    const { ref } = renderWorkstation({ menuMode: 'sidemenu' });
    await act(() => ref.current!.openFiles(stack()));
    const menu = screen.getByTestId('mihawk-ws-sidemenu');
    expect(menu).not.toHaveAttribute('data-open');
    await user.click(screen.getByTestId('mihawk-ws-menu-button'));
    expect(menu).toHaveAttribute('data-open');
    for (const title of ['Files', 'Studies', 'Layout', 'Tools', 'Measure', 'Brightness & contrast', 'Image', 'Cine', 'View']) {
      expect(within(menu).getByText(title, { selector: 'summary span' })).toBeInTheDocument();
    }
    await user.keyboard('{Escape}');
    expect(menu).not.toHaveAttribute('data-open');
  });

  it('respects turned-off features and hides patient details when not allowed', async () => {
    const { ref } = renderWorkstation({ features: { map: false, measurements: false }, allowPatientInfo: false });
    await act(() => ref.current!.openFiles(stack()));
    expect(screen.queryByRole('tab', { name: 'Map' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('mihawk-ws-measure-menu')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId('mihawk-ws-view-menu'));
    expect(screen.queryByLabelText(defaultWorkstationLabels.patientInfo)).not.toBeInTheDocument();
  });

  it('clears everything through the handle', async () => {
    const { ref } = renderWorkstation();
    await act(() => ref.current!.openFiles(stack()));
    act(() => ref.current!.clear());
    expect(ref.current!.getState().phase).toBe('idle');
    expect(screen.getByText(defaultWorkstationLabels.dropZoneTitle)).toBeInTheDocument();
  });
});
