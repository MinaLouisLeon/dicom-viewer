import { describe, expect, it, vi } from 'vitest';

import { readDicomHeader, type ReadRange } from '../src/core/dicomHeader';
import { fixtureFile } from './fixtures';

const sliceReader = (): { readRange: ReadRange; ends: number[] } => {
  const ends: number[] = [];
  return {
    ends,
    readRange: (blob, start, end) => {
      ends.push(end);
      return blob.slice(start, end).arrayBuffer();
    },
  };
};

describe('readDicomHeader', () => {
  it('reads an uncompressed image header from the first slice only', async () => {
    const file = fixtureFile('single/intraoral-explicit-le.dcm');
    const { readRange, ends } = sliceReader();
    const result = await readDicomHeader(file, { readRange });

    expect(result.kind).toBe('dicom');
    if (result.kind !== 'dicom') return;
    expect(result.header).toMatchObject({
      transferSyntaxUid: '1.2.840.10008.1.2.1',
      modality: 'IO',
      rows: 480,
      columns: 640,
      numberOfFrames: 1,
      seriesNumber: 1,
      hasPixelData: true,
    });
    expect(ends).toEqual([64 * 1024]);
  });

  it('does not read patient identifiers', async () => {
    const result = await readDicomHeader(fixtureFile('single/intraoral-explicit-le.dcm'));
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC');
    expect(JSON.stringify(result)).not.toContain('SYNTH-0001');
  });

  it.each([
    ['codecs/intraoral-jpeg2000-lossless.dcm', '1.2.840.10008.1.2.4.90'],
    ['codecs/intraoral-jpegls-lossless.dcm', '1.2.840.10008.1.2.4.80'],
  ])('reads compressed header %s', async (path, transferSyntaxUid) => {
    const result = await readDicomHeader(fixtureFile(path));
    expect(result.kind === 'dicom' && result.header.transferSyntaxUid).toBe(transferSyntaxUid);
  });

  it('reads slice geometry for stacks', async () => {
    const result = await readDicomHeader(fixtureFile('stack/ct-012.dcm'));
    expect(result.kind === 'dicom' && result.header).toMatchObject({
      instanceNumber: 1,
      imagePositionPatient: [-64, -64, 0],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    });
  });

  it('grows the read when the header does not fit the first slice', async () => {
    const file = fixtureFile('single/intraoral-explicit-le.dcm');
    const ends: number[] = [];
    // Simulate a header larger than the first slice by returning only 300 bytes the first time.
    const readRange: ReadRange = async (blob, start, end) => {
      ends.push(end);
      return blob.slice(start, ends.length === 1 ? 300 : end).arrayBuffer();
    };
    const result = await readDicomHeader(file, { readRange });
    expect(result.kind).toBe('dicom');
    expect(ends).toHaveLength(2);
  });

  it('identifies non-DICOM files', async () => {
    expect(await readDicomHeader(fixtureFile('invalid/not-dicom.txt'))).toEqual({ kind: 'not-dicom' });
  });

  it('still reads the header of a file with truncated pixel data', async () => {
    const result = await readDicomHeader(fixtureFile('invalid/truncated-pixel-data.dcm'));
    expect(result.kind).toBe('dicom');
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const readRange = vi.fn<ReadRange>();
    await expect(
      readDicomHeader(fixtureFile('single/intraoral-explicit-le.dcm'), { signal: controller.signal, readRange }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(readRange).not.toHaveBeenCalled();
  });
});
