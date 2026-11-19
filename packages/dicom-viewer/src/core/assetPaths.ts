/** Directory, relative to the host app's base URL, where the Vite plugin serves codec files. */
export const CODEC_DIRECTORY = 'mihawk-dicom-viewer/codecs';

/** Default `codecBasePath` used by the viewer. Matches the Vite plugin with base `/`. */
export const DEFAULT_CODEC_BASE_PATH = `/${CODEC_DIRECTORY}/`;
