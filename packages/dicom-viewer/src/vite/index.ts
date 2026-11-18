/**
 * Vite integration for @mivo-labs/dicom-viewer.
 *
 * Cornerstone's DICOM image loader decodes images in module web workers that load
 * WebAssembly codecs. This plugin:
 *  - keeps the image loader out of dependency pre-bundling so Vite can bundle its worker,
 *  - pre-bundles the CommonJS codec wrappers the worker imports,
 *  - maps Node's `events` module to a browser polyfill that Cornerstone's dependencies need,
 *  - serves the codec `.wasm` files in dev and emits them into the production build,
 *    under `<base>mivo-dicom-viewer/codecs/`, which is where the viewer looks by default.
 *
 * Nothing in this plugin fetches remote resources; all codecs ship with the host app.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

import { CODEC_DIRECTORY } from '../core/assetPaths';

export interface MivoDicomViewerPluginOptions {
  /**
   * Directory (relative to Vite `base`) where codec files are served and emitted.
   * Change it only if it clashes with your app; then pass the same value to the
   * viewer's `codecBasePath` prop (prefixed with your `base`).
   * @default 'mivo-dicom-viewer/codecs'
   */
  codecDirectory?: string;
}

interface CodecFile {
  /** Name the decoder requests via `wasmBasePath`. */
  fileName: string;
  /** Package export that points at the file. */
  specifier: string;
}

const CODEC_FILES: readonly CodecFile[] = [
  { fileName: 'openjpegwasm_decode.wasm', specifier: '@cornerstonejs/codec-openjpeg/decodewasm' },
  { fileName: 'charlswasm_decode.wasm', specifier: '@cornerstonejs/codec-charls/decodewasm' },
  {
    fileName: 'libjpegturbowasm_decode.wasm',
    specifier: '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasm',
  },
  { fileName: 'openjphjs.wasm', specifier: '@cornerstonejs/codec-openjph/wasm' },
  { fileName: 'jpegxlwasm_decode.wasm', specifier: '@cornerstonejs/codec-libjxl/decodewasm' },
];

/** CommonJS codec wrappers imported by the decode worker. */
const CJS_WORKER_DEPS = [
  '@cornerstonejs/codec-charls/decodewasmjs',
  '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
  '@cornerstonejs/codec-openjpeg/decodewasmjs',
  '@cornerstonejs/codec-openjph/wasmjs',
];

const PACKAGE_NAME = '@mivo-labs/dicom-viewer';
const LOADER_NAME = '@cornerstonejs/dicom-image-loader';

function createCodecResolver(): (specifier: string) => string {
  // Resolve codecs the same way the image loader does: from the loader's own location.
  const fromHere = createRequire(import.meta.url);
  const loaderEntry = fromHere.resolve(LOADER_NAME);
  const fromLoader = createRequire(loaderEntry);
  return (specifier) => fromLoader.resolve(specifier);
}

/**
 * vtk.js (used by Cornerstone core) depends on xmlbuilder2, which extends Node's
 * `events.EventEmitter`. Vite externalizes Node built-ins for the browser, so map
 * `events` to the browser-compatible `events` package shipped with this library.
 */
function resolveEventsPolyfill(): string {
  return createRequire(import.meta.url).resolve('events/');
}

function normalizeDirectory(dir: string): string {
  return dir.replace(/^\/+|\/+$/g, '');
}

export function mivoDicomViewer(options: MivoDicomViewerPluginOptions = {}): Plugin {
  const codecDirectory = normalizeDirectory(options.codecDirectory ?? CODEC_DIRECTORY);
  const resolveCodec = createCodecResolver();
  let resolved: ResolvedConfig | undefined;

  const codecPaths = new Map<string, string>();
  for (const codec of CODEC_FILES) {
    const filePath = resolveCodec(codec.specifier);
    if (!existsSync(filePath)) {
      throw new Error(`[${PACKAGE_NAME}] Codec file not found: ${codec.specifier}`);
    }
    codecPaths.set(codec.fileName, filePath);
  }

  return {
    name: 'mivo-dicom-viewer',
    enforce: 'pre',

    config() {
      return {
        resolve: {
          alias: [{ find: /^events$/, replacement: resolveEventsPolyfill() }],
        },
        optimizeDeps: {
          exclude: [LOADER_NAME],
          include: [
            'dicom-parser',
            ...CJS_WORKER_DEPS.map((dep) => `${PACKAGE_NAME} > ${LOADER_NAME} > ${dep}`),
          ],
        },
        worker: {
          format: 'es' as const,
        },
      };
    },

    configResolved(config) {
      resolved = config;
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !resolved) return next();
        const base = resolved.base.endsWith('/') ? resolved.base : `${resolved.base}/`;
        const prefix = `${base}${codecDirectory}/`;
        const pathname = req.url.split('?')[0] ?? '';
        if (!pathname.startsWith(prefix)) return next();
        const fileName = pathname.slice(prefix.length);
        const filePath = codecPaths.get(fileName);
        if (!filePath) return next();
        res.setHeader('Content-Type', 'application/wasm');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(filePath));
      });
    },

    generateBundle() {
      if (resolved?.build.ssr) return;
      for (const [fileName, filePath] of codecPaths) {
        this.emitFile({
          type: 'asset',
          fileName: path.posix.join(codecDirectory, fileName),
          source: readFileSync(filePath),
        });
      }
    },
  };
}

export default mivoDicomViewer;
