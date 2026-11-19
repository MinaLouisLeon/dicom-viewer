import { describe, expect, it } from 'vitest';

import type { DicomInstanceHeader } from '../src/core/dicomHeader';
import { scanFiles } from '../src/core/scanFiles';
import type { LocalInstance } from '../src/core/studyModel';
import { assessVolume, type VolumeAssessment } from '../src/core/volumeGeometry';
import { fixtureFile, fixturePaths } from './fixtures';

const AXIAL: DicomInstanceHeader['imageOrientationPatient'] = [1, 0, 0, 0, 1, 0];

function slice(z: number, overrides: Partial<DicomInstanceHeader> = {}, selectionIndex = 0): LocalInstance {
  return {
    selectionIndex,
    file: new Blob([]),
    header: {
      transferSyntaxUid: '1.2.840.10008.1.2.1',
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
      sopInstanceUid: `sop-${z}-${selectionIndex}`,
      studyInstanceUid: 'study',
      seriesInstanceUid: 'series',
      rows: 64,
      columns: 80,
      numberOfFrames: 1,
      imagePositionPatient: [-10, -12, z],
      imageOrientationPatient: AXIAL,
      pixelSpacing: [0.3, 0.25],
      frameOfReferenceUid: 'for',
      samplesPerPixel: 1,
      bitsAllocated: 16,
      hasPixelData: true,
      ...overrides,
    },
  };
}

const series = (positions: number[], overrides: (index: number) => Partial<DicomInstanceHeader> = () => ({})) =>
  positions.map((z, index) => slice(z, overrides(index), index));

const reasonOf = (assessment: VolumeAssessment) => (assessment.support.supported ? 'supported' : assessment.support.reason);

describe('assessVolume', () => {
  it('accepts an evenly spaced axial series and orders it along the normal', () => {
    const result = assessVolume(series([4, 0, 2, 6, 1, 3, 5]));
    expect(result.support).toEqual({ supported: true, dimensions: [80, 64, 7], spacing: [0.25, 0.3, 1] });
    expect(result.frames?.map(({ instance }) => instance.header.imagePositionPatient![2])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('orders by projection on the normal for oblique and sagittal stacks', () => {
    // Sagittal: rows along +y, columns along −z, so the normal is [0,1,0] × [0,0,−1] = [−1,0,0].
    const orientation: DicomInstanceHeader['imageOrientationPatient'] = [0, 1, 0, 0, 0, -1];
    const instances = [3, 1, 2].map((x, index) =>
      slice(0, { imageOrientationPatient: orientation, imagePositionPatient: [x, 0, 0] }, index),
    );
    const result = assessVolume(instances);
    expect(result.support.supported).toBe(true);
    // Increasing distance along [-1,0,0] means decreasing x.
    expect(result.frames?.map(({ instance }) => instance.header.imagePositionPatient![0])).toEqual([3, 2, 1]);
  });

  it('tolerates rounding in written positions', () => {
    expect(reasonOf(assessVolume(series([0, 0.4, 0.8000001, 1.2, 1.5999])))).toBe('supported');
  });

  it.each([
    ['too-few-images', series([0, 1])],
    ['color-images', series([0, 1, 2], (i) => (i === 1 ? { samplesPerPixel: 3 } : {}))],
    ['missing-geometry', series([0, 1, 2], (i) => (i === 2 ? { imagePositionPatient: undefined } : {}))],
    ['missing-geometry', series([0, 1, 2], () => ({ pixelSpacing: undefined }))],
    ['missing-geometry', series([0, 1, 2], () => ({ imageOrientationPatient: undefined }))],
    ['mixed-dimensions', series([0, 1, 2], (i) => (i === 1 ? { rows: 65 } : {}))],
    ['mixed-dimensions', series([0, 1, 2], (i) => (i === 1 ? { pixelSpacing: [0.3, 0.3] } : {}))],
    ['mixed-orientation', series([0, 1, 2], (i) => (i === 2 ? { imageOrientationPatient: [1, 0, 0, 0, 0.98, 0.2] } : {}))],
    ['mixed-frame-of-reference', series([0, 1, 2], (i) => (i === 2 ? { frameOfReferenceUid: 'other' } : {}))],
    ['tilted-slices', series([0, 1, 2, 3], (i) => ({ imagePositionPatient: [-10, -12 + i * 0.5, i] }))],
    ['duplicate-positions', series([0, 1, 1, 2])],
    ['missing-slices', series([0, 1, 2, 4, 5, 6])],
    ['irregular-spacing', series([0, 1, 2, 3.3, 4.3, 5.3])],
  ])('rejects with %s', (reason, instances) => {
    expect(reasonOf(assessVolume(instances))).toBe(reason);
  });

  it('expands enhanced multi-frame images into frames ordered by per-frame position', () => {
    const framePositions: [number, number, number][] = [3, 2, 1, 0].map((z) => [0, 0, z]);
    const result = assessVolume([slice(3, { numberOfFrames: 4, framePositions })]);
    expect(result.support).toMatchObject({ supported: true, dimensions: [80, 64, 4] });
    expect(result.frames?.map(({ frame }) => frame)).toEqual([4, 3, 2, 1]);
  });

  it('rejects multi-frame images without per-frame positions', () => {
    expect(reasonOf(assessVolume([slice(0, { numberOfFrames: 10 })]))).toBe('missing-geometry');
  });

  describe('synthetic CBCT fixtures', () => {
    const scan = async (dir: string) => (await scanFiles(fixturePaths(dir).map(fixtureFile))).studies[0]!.series[0]!;

    it('orders the classic series inferior to superior despite reversed file names', async () => {
      const result = await scan('cbct');
      expect(result.summary.volume).toMatchObject({ supported: true, dimensions: [96, 96, 64] });
      const z = result.volumeFrames!.map(({ instance }) => instance.header.imagePositionPatient![2]);
      expect(z[0]).toBeCloseTo(-12);
      expect(z.at(-1)).toBeCloseTo(-12 + 63 * 0.4);
      expect(z.every((value, index) => index === 0 || value > z[index - 1]!)).toBe(true);
    });

    it('reads per-frame geometry of the enhanced multi-frame file and reverses its frames', async () => {
      const result = await scan('cbct-multiframe');
      expect(result.summary).toMatchObject({ instanceCount: 1, imageCount: 64 });
      expect(result.summary.volume).toMatchObject({ supported: true, dimensions: [96, 96, 64] });
      expect(result.volumeFrames!.map(({ frame }) => frame)).toEqual(Array.from({ length: 64 }, (_, i) => 64 - i));
    });

    it('reports missing slices', async () => {
      expect((await scan('cbct-missing-slice')).summary.volume).toEqual({ supported: false, reason: 'missing-slices' });
    });
  });
});
