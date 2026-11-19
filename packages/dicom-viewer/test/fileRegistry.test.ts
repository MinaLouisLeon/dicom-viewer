import { Enums, metaData } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { expect, it } from 'vitest';

import { FileRegistry } from '../src/core/cornerstoneSetup';
import { fixtureFile } from './fixtures';

it('drops source bytes for an enhanced volume and keeps its per-frame geometry until close', async () => {
  const registry = new FileRegistry();
  const file = fixtureFile('cbct-multiframe/cbct-enhanced.dcm');
  const imageIds = [registry.imageId(file, 1), registry.imageId(file, 2)];
  const datasetKey = wadouri.parseImageId(imageIds[0]!).url;
  const { IMAGE_PLANE } = Enums.MetadataModules;
  const provider = (type: string, query: unknown) =>
    typeof query === 'string' ? wadouri.metaData.metaDataProvider(type, query) : undefined;
  metaData.addProvider(provider);
  try {
    await registry.loadDataset(file);
    const planes = imageIds.map((id) => metaData.get(IMAGE_PLANE, id));
    expect(planes[0]).toBeDefined();
    expect(planes[0]).not.toEqual(planes[1]);
    registry.releaseVolumeDatasets(imageIds);
    expect(wadouri.dataSetCacheManager.isLoaded(datasetKey)).toBe(false);
    expect(imageIds.map((id) => metaData.get(IMAGE_PLANE, id))).toEqual(planes);
    registry.release();
    expect(metaData.get(IMAGE_PLANE, imageIds[0]!)).toBeUndefined();
  } finally {
    registry.release();
    metaData.removeProvider(provider);
  }
});

it('releases a dataset that finishes loading after the registry is cleared', async () => {
  const registry = new FileRegistry();
  const file = fixtureFile('single/intraoral-explicit-le.dcm');
  const key = registry.imageId(file).slice('dicomfile:'.length);
  try {
    const pending = registry.loadDataset(file);
    registry.release();
    await pending;
    expect(wadouri.dataSetCacheManager.isLoaded(key)).toBe(false);
  } finally {
    wadouri.dataSetCacheManager.unload(key);
    registry.release();
  }
});
