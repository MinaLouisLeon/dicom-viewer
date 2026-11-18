import { describe, expect, it } from 'vitest';

import type { DicomInstanceHeader } from '../src/core/dicomHeader';
import { groupInstances, orderInstances, type LocalInstance } from '../src/core/studyModel';

function instance(selectionIndex: number, header: Partial<DicomInstanceHeader>): LocalInstance {
  return {
    selectionIndex,
    file: new Blob([]),
    header: {
      transferSyntaxUid: '1.2.840.10008.1.2.1',
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
      sopInstanceUid: `sop-${selectionIndex}`,
      studyInstanceUid: 'study-1',
      seriesInstanceUid: 'series-1',
      numberOfFrames: 1,
      hasPixelData: true,
      ...header,
    },
  };
}

const axial: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];

describe('orderInstances', () => {
  it('orders by position along the slice normal, not by selection or instance number', () => {
    const ordered = orderInstances([
      instance(0, { imagePositionPatient: [0, 0, 5], imageOrientationPatient: axial, instanceNumber: 1 }),
      instance(1, { imagePositionPatient: [0, 0, -5], imageOrientationPatient: axial, instanceNumber: 3 }),
      instance(2, { imagePositionPatient: [0, 0, 0], imageOrientationPatient: axial, instanceNumber: 2 }),
    ]);
    expect(ordered.map((item) => item.selectionIndex)).toEqual([1, 2, 0]);
  });

  it('falls back to instance number when geometry is missing or mixed', () => {
    const ordered = orderInstances([
      instance(0, { instanceNumber: 3 }),
      instance(1, { instanceNumber: 1, imagePositionPatient: [0, 0, 9], imageOrientationPatient: axial }),
      instance(2, { instanceNumber: 2 }),
    ]);
    expect(ordered.map((item) => item.selectionIndex)).toEqual([1, 2, 0]);
  });

  it('keeps selection order when nothing else distinguishes instances', () => {
    const ordered = orderInstances([instance(2, {}), instance(0, {}), instance(1, {})]);
    expect(ordered.map((item) => item.selectionIndex)).toEqual([0, 1, 2]);
  });
});

describe('groupInstances', () => {
  it('groups by study and series, sorts series by number, and counts frames', () => {
    const studies = groupInstances([
      instance(0, { seriesInstanceUid: 'b', seriesNumber: 2, numberOfFrames: 4 }),
      instance(1, { seriesInstanceUid: 'a', seriesNumber: 1, studyDescription: 'Exam' }),
      instance(2, { studyInstanceUid: 'study-2', seriesInstanceUid: 'c' }),
      instance(3, { seriesInstanceUid: 'b', seriesNumber: 2 }),
    ]);
    expect(studies).toHaveLength(2);
    const [first] = studies;
    expect(first?.summary.series.map((series) => series.seriesInstanceUid)).toEqual(['a', 'b']);
    expect(first?.summary.series[1]).toMatchObject({ instanceCount: 2, imageCount: 5 });
  });

  it('drops duplicate SOP instances selected twice', () => {
    const studies = groupInstances([instance(0, { sopInstanceUid: 'same' }), instance(1, { sopInstanceUid: 'same' })]);
    expect(studies[0]?.summary.series[0]?.instanceCount).toBe(1);
  });
});
