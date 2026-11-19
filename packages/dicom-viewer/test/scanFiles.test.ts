import { describe, expect, it } from 'vitest';

import { DicomViewerError } from '../src/core/errors';
import { scanFiles } from '../src/core/scanFiles';
import { fixtureFile, fixturePaths } from './fixtures';

describe('scanFiles', () => {
  it('groups the synthetic fixture set into studies and reports skipped files', async () => {
    const paths = fixturePaths();
    const files = paths.map(fixtureFile);
    const progress: number[] = [];
    const result = await scanFiles(files, { onProgress: (processed) => progress.push(processed) });

    expect(result.studies).toHaveLength(3);
    const ct = result.studies.find((study) => study.summary.description === 'Synthetic CT phantom');
    expect(ct?.series[0]?.summary).toMatchObject({ modality: 'CT', instanceCount: 12, imageCount: 12 });
    // ct-012.dcm holds the first slice; geometric ordering must put it first.
    const firstSlice = ct?.series[0]?.instances[0];
    expect(paths[firstSlice?.selectionIndex ?? -1]).toMatch(/ct-012\.dcm$/);
    // The damaged slice still has a valid header, so it stays in its series and fails only at decode time.
    expect(ct?.series[1]?.summary).toMatchObject({ seriesNumber: 2, instanceCount: 6, imageCount: 6 });

    const intraoral = result.studies.find((study) => study.summary.description === 'Synthetic intraoral study');
    expect(intraoral?.summary.series.map((series) => series.seriesNumber)).toEqual([1, 2, 3, 9]);
    expect(intraoral?.summary.series.every((series) => !series.volume.supported)).toBe(true);

    // The classic and enhanced CBCT series form volumes; the one with a gap does not.
    const cbct = result.studies.find((study) => study.summary.description === 'Synthetic CBCT phantom');
    expect(cbct?.summary.series.map((series) => series.volume)).toEqual([
      { supported: true, dimensions: [96, 96, 64], spacing: [0.4, 0.4, expect.closeTo(0.4, 6)] },
      { supported: true, dimensions: [96, 96, 64], spacing: [0.4, 0.4, expect.closeTo(0.4, 6)] },
      { supported: false, reason: 'missing-slices' },
    ]);

    const textIndex = paths.findIndex((p) => p.endsWith('not-dicom.txt'));
    expect(result.skipped).toEqual([{ selectionIndex: textIndex, reason: 'not-dicom' }]);
    expect(progress.at(-1)).toBe(files.length);
  });

  it('rejects with NO_DICOM_FILES when nothing is displayable', async () => {
    const error = await scanFiles([fixtureFile('invalid/not-dicom.txt')]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DicomViewerError);
    expect((error as DicomViewerError).code).toBe('NO_DICOM_FILES');
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const files = fixturePaths('stack').map(fixtureFile);
    const pending = scanFiles(files, {
      signal: controller.signal,
      concurrency: 1,
      onProgress: (processed) => {
        if (processed === 2) controller.abort();
      },
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
