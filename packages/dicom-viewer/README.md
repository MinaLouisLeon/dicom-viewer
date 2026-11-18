# @mivo-labs/dicom-viewer

React DICOM viewer for files the user selects on their own device. Built on [Cornerstone3D](https://www.cornerstonejs.org/).

> **Status: pre-release (P01 foundation).** File selection, study and series listing, and first-image display work. Pan, zoom, window and level, and slice navigation (P02) and the 3D CBCT viewer (P03) are not implemented yet. Not published to npm.

## Privacy model

- Files are read in the browser. Nothing is uploaded, and the viewer makes no remote requests. Codecs and workers are served by the host app.
- Only the header attributes needed to group and order images are read. Patient identifiers are not read by the grouping step.
- Selected files stay in memory for the session. Closing the study, unmounting, or calling `clear()` releases them. After a refresh the user selects the files again.
- Error objects carry a code only. They never include file names or DICOM values.
- Cornerstone stores GPU capability flags (`cornerstone3D.renderingCapabilities`) and a log level (`loglevel`) in `localStorage`. Neither holds clinical data.

## Install (Vite + React)

```ts
// vite.config.ts
import { mivoDicomViewer } from '@mivo-labs/dicom-viewer/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react(), mivoDicomViewer()] });
```

```tsx
import '@mivo-labs/dicom-viewer/styles.css';
import { DicomViewer, type DicomViewerHandle } from '@mivo-labs/dicom-viewer';

export function ImagingPage() {
  const viewer = useRef<DicomViewerHandle>(null);
  // e.g. on logout: viewer.current?.clear();
  return (
    <div style={{ height: 600 }}>
      <DicomViewer ref={viewer} onError={(error) => console.warn(error.code)} />
    </div>
  );
}
```

The viewer fills its container. Give the container a height.

### What the Vite plugin does

- Serves the codec `.wasm` files in development and emits them at `<base>mivo-dicom-viewer/codecs/` in production builds.
- Keeps `@cornerstonejs/dicom-image-loader` out of dependency pre-bundling so Vite bundles its decode worker, and pre-bundles the CommonJS codec wrappers that the worker imports.
- Maps Node's `events` module to the browser `events` package. Cornerstone needs this because vtk.js uses xmlbuilder2.

If your app uses a non-root `base`, pass `codecBasePath={`${base}mivo-dicom-viewer/codecs/`}`.

## API

### `<DicomViewer />` props

| Prop | Type | Description |
|---|---|---|
| `labels` | `Partial<DicomViewerLabels>` | Overrides for any user-visible text. See `defaultLabels`. |
| `files` | `readonly Blob[]` | Local files from the host, for example from its own drop target. The viewer opens them whenever a new array is passed. |
| `codecBasePath` | `string` | Where codec files are served. Defaults to `/mivo-dicom-viewer/codecs/`. Applies to the whole page, and the first viewer's value wins. |
| `maxWebWorkers` | `number` | Maximum number of decode workers. Defaults to half the logical CPUs. |
| `onStateChange` | `(state: ViewerState) => void` | Fires on every lifecycle change. |
| `onStudiesLoaded` | `(studies: StudySummary[]) => void` | Fires after headers are read and grouped. |
| `onSeriesDisplayed` | `(series: SeriesSummary) => void` | Fires when the first image of a series is shown. |
| `onError` | `(error: DicomViewerError) => void` | `error.code` is one of `NO_DICOM_FILES`, `FILE_READ_FAILED`, `RENDERER_INIT_FAILED`, `IMAGE_LOAD_FAILED`, `UNSUPPORTED_IMAGE`. |
| `className`, `style` | | Applied to the root element. |

### `DicomViewerHandle` (ref)

`openFiles(files)`, `selectSeries(seriesInstanceUid)`, `cancel()`, `clear()`, `getState()`.

### Lifecycle

`idle → scanning → loading → displayed`. Cancel returns to `idle` during scanning and to `ready` (study list kept) during loading. `error` keeps any studies already found. Each new operation aborts the previous one, and results from stale operations are discarded.

### Styling

Every selector is scoped under `.mivo-dv`. To theme the viewer, override the `--mivo-dv-*` custom properties, such as `--mivo-dv-accent`, `--mivo-dv-bg` or `--mivo-dv-font`.

## Inputs (current)

- DICOM Part 10 files with the `DICM` preamble. The user can select files individually or as a folder, and can drop files or folders.
- Verified with synthetic fixtures: Explicit VR Little Endian, JPEG 2000 lossless, and JPEG-LS lossless. Single-frame images and ordered stacks.
- Not supported: Deflated Explicit VR Little Endian, files without pixel data (DICOMDIR, SR), and files without Study or Series Instance UIDs. These are listed as skipped files with a reason.

The full compatibility matrix is defined in P00-02 and verified in P04.

## Development

From the repository root:

```sh
npm install
npm run fixtures         # regenerate synthetic DICOM fixtures
npm run dev              # build the package and start the demo (http://localhost:5173)
npm run check            # typecheck + unit tests + build package and demo
npm run smoke:consumer   # pack tarball → install in a clean Vite app → build → check assets
```
