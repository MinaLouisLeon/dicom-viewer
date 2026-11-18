import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { expect, it } from 'vitest';

import { FileRegistry } from '../src/core/cornerstoneSetup';
import { fixtureFile } from './fixtures';

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
