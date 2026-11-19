import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
  base: '/dicom-viewer/',
  preview: { port: 4321 },
});
