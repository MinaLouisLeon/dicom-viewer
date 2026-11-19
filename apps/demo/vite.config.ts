import { mivoDicomViewer } from '@mihawksolutions/dicom-viewer/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.DEMO_BASE_PATH ?? '/',
  plugins: [react(), mivoDicomViewer()],
});
