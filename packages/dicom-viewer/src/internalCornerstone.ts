/**
 * Cornerstone rendering internals shared with @mihawksolutions/dicom-workstation, at
 * `@mihawksolutions/dicom-viewer/internal/cornerstone`. Import it only from lazily
 * loaded code: it pulls in Cornerstone. Not a stable API.
 *
 * Sharing these (instead of copying them) keeps one Cornerstone initialization and one
 * file registry per page.
 */
export {
  FileRegistry,
  PINCH_ZOOM_BINDING,
  PINCH_ZOOM_TOOL,
  TranslateCrosshairsTool,
  classifyLoadError,
  ensureInitialized,
  releaseImages,
} from './core/cornerstoneSetup';
