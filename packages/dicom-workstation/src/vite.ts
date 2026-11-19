/**
 * Vite integration. The workstation uses the viewer's plugin unchanged; it is re-exported
 * here so an app only needs to import from one package.
 */
export { mihawkDicomViewer, mihawkDicomViewer as default } from '@mihawksolutions/dicom-viewer/vite';
export type { MihawkDicomViewerPluginOptions } from '@mihawksolutions/dicom-viewer/vite';
