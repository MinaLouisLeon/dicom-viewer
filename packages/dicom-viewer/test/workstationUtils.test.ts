import { describe, expect, it } from 'vitest';

import { formatPersonName, orientationMarkers, readImageInfo } from '../src/workstation/imageInfo';
import { GRID_LAYOUTS, cellCount, clampGrid, parseGrid } from '../src/workstation/layouts';
import { formatTag, isPrivateTag, lookupTag, normalizeTag } from '../src/workstation/tagDictionary';
import { countTagNodes, filterTagNodes, readTagMap, tagNodesToJson } from '../src/workstation/tagMap';
import { DEFAULT_WINDOW_PRESETS, autoWindowOptionsFor, computeAutoWindow, presetApplies } from '../src/workstation/windowPresets';
import { matchSlice } from '../src/workstation/workstationSession';
import { fixtureFile } from './fixtures';

describe('computeAutoWindow', () => {
  it('maps the low and high percentiles to the window edges', () => {
    const values = Array.from({ length: 1001 }, (_, index) => index);
    const window = computeAutoWindow(values, { lowPercentile: 0, highPercentile: 100 })!;
    expect(window.width).toBe(1000);
    expect(window.center).toBe(500);
  });

  it('ignores a dominant background value', () => {
    // 60% air at -1000, tissue spread between 0 and 100.
    const values = [...Array.from({ length: 600 }, () => -1000), ...Array.from({ length: 400 }, (_, index) => index / 4)];
    const window = computeAutoWindow(values, { lowPercentile: 0, highPercentile: 100 })!;
    expect(window.center - window.width / 2).toBeGreaterThanOrEqual(0);
    expect(window.center + window.width / 2).toBeLessThanOrEqual(100);
  });

  it('gives a narrow window for a flat image and nothing for no data', () => {
    expect(computeAutoWindow([5, 5, 5, 5])).toEqual({ width: 2, center: 5 });
    expect(computeAutoWindow([])).toBeUndefined();
    expect(computeAutoWindow([Number.NaN])).toBeUndefined();
  });

  it('samples large inputs', () => {
    const values = new Float32Array(2_000_000).map((_, index) => index / 2000);
    const window = computeAutoWindow(values, { maxSamples: 10_000 })!;
    expect(window.width).toBeGreaterThan(900);
  });
});

describe('autoWindowOptionsFor', () => {
  it('leaves out air and lung on CT and keeps the generic settings elsewhere', () => {
    expect(autoWindowOptionsFor('CT')).toEqual({ lowPercentile: 5, highPercentile: 95, ignoreBelow: -500 });
    expect(autoWindowOptionsFor('IO')).toEqual({});
    // A CT slice: 40% air, fat around -100, soft tissue around 40, some bone at 700.
    const values = [
      ...Array.from({ length: 400 }, (_, i) => -1000 + (i % 7)),
      ...Array.from({ length: 200 }, (_, i) => -120 + (i % 40)),
      ...Array.from({ length: 330 }, (_, i) => 20 + (i % 50)),
      ...Array.from({ length: 18 }, (_, i) => 600 + i * 10),
    ];
    const window = computeAutoWindow(values, autoWindowOptionsFor('CT'))!;
    expect(window.center).toBeGreaterThan(-100);
    expect(window.center).toBeLessThan(150);
    expect(window.width).toBeLessThan(1000);
  });
});

describe('window presets', () => {
  it('limits Hounsfield presets to CT', () => {
    const bone = DEFAULT_WINDOW_PRESETS.find((preset) => preset.id === 'bone')!;
    const auto = DEFAULT_WINDOW_PRESETS.find((preset) => preset.id === 'auto')!;
    expect(presetApplies(bone, 'CT')).toBe(true);
    expect(presetApplies(bone, 'ct')).toBe(true);
    expect(presetApplies(bone, 'IO')).toBe(false);
    expect(presetApplies(bone, undefined)).toBe(false);
    expect(presetApplies(auto, 'IO')).toBe(true);
  });

  it('has unique ids and shortcuts', () => {
    const ids = DEFAULT_WINDOW_PRESETS.map((preset) => preset.id);
    const shortcuts = DEFAULT_WINDOW_PRESETS.map((preset) => preset.shortcut).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
});

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

describe('tag dictionary', () => {
  it('normalises, formats and looks up tags', () => {
    expect(normalizeTag('x00100010')).toBe('00100010');
    expect(normalizeTag('(0010,0010)')).toBe('00100010');
    expect(formatTag('x7fe00010')).toBe('(7FE0,0010)');
    expect(lookupTag('x00100010')).toEqual({ vr: 'PN', name: "Patient's Name" });
    expect(lookupTag('00180000')?.name).toBe('Group Length');
    expect(lookupTag('00290010')?.name).toBe('Private Creator');
    expect(isPrivateTag('00291010')).toBe(true);
    expect(isPrivateTag('00100010')).toBe(false);
  });
});

describe('tag map', () => {
  it('reads every attribute of a local file with names and VRs', async () => {
    const nodes = await readTagMap(fixtureFile('stack/ct-001.dcm'));
    const modality = nodes.find((node) => node.tag === '(0008,0060)');
    expect(modality).toMatchObject({ name: 'Modality', vr: 'CS', value: 'CT' });
    const rows = nodes.find((node) => node.tag === '(0028,0010)');
    expect(rows?.vr).toBe('US');
    expect(Number(rows?.value)).toBeGreaterThan(0);
    const pixels = nodes.find((node) => node.tag === '(7FE0,0010)');
    expect(pixels?.value).toMatch(/pixel data/);
    expect(countTagNodes(nodes)).toBeGreaterThan(20);
    expect(nodes.map((node) => node.tag)).toEqual([...nodes.map((node) => node.tag)].sort());
  });

  it('redacts patient-identifying values on request', async () => {
    const nodes = await readTagMap(fixtureFile('stack/ct-001.dcm'), { redactPatientData: true });
    const name = nodes.find((node) => node.tag === '(0010,0010)');
    if (name) {
      expect(name.redacted).toBe(true);
      expect(name.value).not.toMatch(/[A-Za-z]{2}/);
    }
    expect(nodes.find((node) => node.tag === '(0008,0060)')?.redacted).toBeUndefined();
  });

  it('filters by name, tag, VR or value and keeps matching sequence items', async () => {
    // Enhanced multi-frame: has nested functional group sequences.
    const nodes = await readTagMap(fixtureFile(await firstFile('cbct-multiframe')));
    expect(filterTagNodes(nodes, 'modality').some((node) => node.name === 'Modality')).toBe(true);
    expect(filterTagNodes(nodes, '0008,0060')).toHaveLength(1);
    expect(filterTagNodes(nodes, '00080060')).toHaveLength(1);
    const positions = filterTagNodes(nodes, 'Image Position');
    const sequence = positions.find((node) => node.items);
    if (sequence) expect(sequence.items!.some((item) => item.length > 0)).toBe(true);
    expect(filterTagNodes(nodes, 'zzzz-nothing')).toHaveLength(0);
    expect(JSON.stringify(tagNodesToJson(nodes))).toContain('"Modality"');
  });

  it('rejects files that are not DICOM', async () => {
    await expect(readTagMap(new File([new Uint8Array(300)], 'x.bin'))).rejects.toThrow('NOT_DICOM');
  });
});

async function firstFile(dir: string): Promise<string> {
  const { readdirSync } = await import('node:fs');
  const { FIXTURES_DIR } = await import('./fixtures');
  const path = await import('node:path');
  return `${dir}/${readdirSync(path.join(FIXTURES_DIR, dir))[0]}`;
}

describe('image info and orientation', () => {
  it('formats person names', () => {
    expect(formatPersonName('Doe^Jane^Q^Dr')).toBe('Dr Jane Q Doe');
    expect(formatPersonName('Doe^Jane=ドウ^ジェーン')).toBe('Jane Doe');
    expect(formatPersonName(undefined)).toBeUndefined();
  });

  it('reads overlay attributes and caches them per file', async () => {
    const file = fixtureFile('stack/ct-001.dcm');
    const info = await readImageInfo(file);
    expect(info?.modality).toBe('CT');
    expect(info?.rows).toBeGreaterThan(0);
    expect(readImageInfo(file)).toBe(readImageInfo(file));
  });

  it('labels the sides of an axial image and follows rotation and flips', () => {
    const axial = [1, 0, 0, 0, 1, 0];
    expect(orientationMarkers(axial)).toEqual({ right: 'L', left: 'R', bottom: 'P', top: 'A' });
    expect(orientationMarkers(axial, { rotation: 90, flipHorizontal: false, flipVertical: false })).toEqual({
      right: 'A',
      left: 'P',
      bottom: 'L',
      top: 'R',
    });
    expect(orientationMarkers(axial, { rotation: 0, flipHorizontal: true, flipVertical: false })).toMatchObject({
      right: 'R',
      left: 'L',
    });
    expect(orientationMarkers(axial, { rotation: 180, flipHorizontal: false, flipVertical: false })).toMatchObject({
      top: 'P',
      right: 'R',
    });
    expect(orientationMarkers([0.7, 0.7, 0, 0, 0, -1])?.right).toBe('LP');
    expect(orientationMarkers(undefined)).toBeUndefined();
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
