import { mivoDicomViewer } from '@mivo-labs/dicom-viewer/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), mivoDicomViewer()],
  // Synthetic fixtures only (see fixtures/README.md); served as same-origin samples.
  publicDir: '../../fixtures',
});
