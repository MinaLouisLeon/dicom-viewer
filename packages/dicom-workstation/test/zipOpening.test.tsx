import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { DicomWorkstation, defaultWorkstationLabels, type DicomWorkstationHandle } from '../src/index';
import { WorkstationSession } from '../src/workstationSession';
import { createFakeGridRenderer } from './fakeGridRenderer';
import { createFakeVolumeRenderer } from './fakeVolumeRenderer';
import { FIXTURES_DIR, fixturePaths } from './fixtures';
import { buildZip, zipFile, type ZipInput } from './zipBuilder';

const stackEntries = (): ZipInput[] =>
  fixturePaths('stack').map((relative, index) => ({
    path: `Patient/Study/Series/${String(index).padStart(3, '0')}`,
    data: new Uint8Array(readFileSync(path.join(FIXTURES_DIR, relative))),
    dataDescriptor: index % 2 === 0,
  }));

function session(options: Partial<ConstructorParameters<typeof WorkstationSession>[0]> = {}) {
  const grid = createFakeGridRenderer();
  const value = new WorkstationSession({
    createGridRenderer: grid.createGridRenderer,
    rendererConfig: { codecBasePath: '/' },
    progressIntervalMs: 0,
    ...options,
  });
  for (const cell of value.getState().cells) value.attachCell(cell.id, document.createElement('div'));
  return value;
}

describe('opening ZIP archives', () => {
  it('opens a DICOM study inside a ZIP and shows its series', async () => {
    const workstation = session();
    const stages: (string | undefined)[] = [];
    workstation.subscribe(() => stages.push(workstation.getState().progressStage));
    await workstation.openFiles([zipFile(buildZip(stackEntries()))]);
    const state = workstation.getState();
    expect(state.phase).toBe('ready');
    expect(state.studies[0]?.series[0]?.imageCount).toBe(12);
    expect(state.cells[0]?.phase).toBe('displayed');
    expect(state.archiveIssues).toEqual([]);
    expect(stages).toContain('archive');
    expect(state.progressStage).toBeUndefined();
  });

  it('keeps the readable files and reports the rest', async () => {
    const workstation = session();
    await workstation.openFiles([zipFile(buildZip([...stackEntries(), { path: 'locked.dcm', data: 'x', method: 0, encrypted: true }]))]);
    expect(workstation.getState().phase).toBe('ready');
    expect(workstation.getState().archiveIssues).toEqual([{ reason: 'encrypted', count: 1 }]);
  });

  it('treats a ZIP as an ordinary file when archives are turned off', async () => {
    const workstation = session({ archives: false });
    await workstation.openFiles([zipFile(buildZip(stackEntries()))]);
    expect(workstation.getState()).toMatchObject({ phase: 'error', error: expect.objectContaining({ code: 'NO_DICOM_FILES' }) });
  });

  it('opens a ZIP through the component and lists ZIP problems in the status bar', async () => {
    const ref = createRef<DicomWorkstationHandle>();
    const grid = createFakeGridRenderer();
    const volume = createFakeVolumeRenderer({ autoFinish: true });
    render(
      <div style={{ height: 600 }}>
        <DicomWorkstation ref={ref} createGridRenderer={grid.createGridRenderer} createVolumeRenderer={volume.createVolumeRenderer} />
      </div>,
    );
    expect(screen.getByText(/ZIP archive/)).toBeInTheDocument();
    const zip = zipFile(buildZip([...stackEntries(), { path: 'old.bin', data: 'x', method: 12 }]));
    await act(() => ref.current!.openFiles([zip]));
    await waitFor(() => expect(screen.getByTestId('mihawk-ws-cell')).toHaveAttribute('data-phase', 'displayed'));
    expect(screen.getByTestId('mihawk-ws-archive-issue')).toHaveTextContent(defaultWorkstationLabels.archiveIssues['unsupported-compression'](1));
  });
});
