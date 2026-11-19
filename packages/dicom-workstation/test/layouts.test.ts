import { describe, expect, it } from 'vitest';

import { GRID_LAYOUTS, cellCount, clampGrid, parseGrid } from '../src/layouts';
import { matchSlice } from '../src/workstationSession';

describe('layouts', () => {
  it('parses and clamps grids', () => {
    expect(parseGrid('2x3')).toEqual({ rows: 2, columns: 3 });
    expect(parseGrid('9x9')).toEqual({ rows: 4, columns: 4 });
    expect(parseGrid('nope')).toBeUndefined();
    expect(parseGrid('2x2-top')).toEqual({ rows: 2, columns: 2, primary: 'top' });
    expect(clampGrid({ rows: 1, columns: 3, primary: 'top' })).toEqual({ rows: 1, columns: 3 });
    expect(cellCount({ rows: 2, columns: 2, primary: 'top' })).toBe(3);
    expect(cellCount({ rows: 3, columns: 2, primary: 'left' })).toBe(4);
    expect(cellCount({ rows: 2, columns: 3 })).toBe(6);
    expect(clampGrid({ rows: 0, columns: 2.6 })).toEqual({ rows: 1, columns: 3 });
    expect(GRID_LAYOUTS.length).toBeGreaterThan(5);
  });
});

describe('matchSlice', () => {
  const geometry = (locations: number[], frame = 'f1', normal: [number, number, number] = [0, 0, 1]) => ({
    frameOfReferenceUid: frame,
    normal,
    locations,
  });

  it('matches by position in a shared frame of reference', () => {
    const source = geometry([0, 2, 4, 6, 8]);
    const target = geometry([1, 3, 5, 7, 9, 11, 13]);
    expect(matchSlice(source, 2, 5, target, 7)).toBe(1);
    expect(matchSlice(source, 4, 5, target, 7)).toBe(3);
  });

  it('handles opposite normals', () => {
    const source = geometry([0, 2, 4]);
    const target = geometry([0, -2, -4], 'f1', [0, 0, -1]);
    expect(matchSlice(source, 2, 3, target, 3)).toBe(2);
  });

  it('falls back to the relative position', () => {
    const source = geometry([0, 2, 4, 6, 8], 'f1');
    const target = geometry([0, 1, 2], 'f2');
    expect(matchSlice(source, 4, 5, target, 3)).toBe(2);
    expect(matchSlice(source, 2, 5, target, 3)).toBe(1);
    expect(matchSlice({}, 0, 1, {}, 9)).toBe(0);
  });
});
