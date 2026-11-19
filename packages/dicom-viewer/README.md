# @mihawksolutions/dicom-viewer

React DICOM viewer for files the user selects on their own device. Built on [Cornerstone3D](https://www.cornerstonejs.org/).

Version 0.5.0 is the initial release. Earlier 2D and 3D browser checks used synthetic fixtures. Manual validation with representative studies, including large-study benchmarks, follows publication.

## Privacy model

- Files are read in the browser. Nothing is uploaded, and the viewer makes no remote requests. Codecs and workers are served by the host app.
- Only the header attributes needed to group and order images are read. Patient identifiers are not read by the grouping step.
- Selected files stay in memory for the session. Closing the study, unmounting, or calling `clear()` releases them. After a refresh the user selects the files again.
- Error objects carry a code only. They never include file names or DICOM values.
- Cornerstone stores GPU capability flags (`cornerstone3D.renderingCapabilities`) and a log level (`loglevel`) in `localStorage`. Neither holds clinical data.

## Install (Vite + React)

After publication, install the version from npm:

```sh
npm install @mihawksolutions/dicom-viewer@0.5.0
```

To build and pack locally from the repository root:

```sh
npm run build:package
npm pack --workspace @mihawksolutions/dicom-viewer
```

In your React + Vite consumer, install the generated tarball:

```sh
npm install /path/to/mihawksolutions-dicom-viewer-0.5.0.tgz
```

```ts
// vite.config.ts
import { mihawkDicomViewer } from '@mihawksolutions/dicom-viewer/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react(), mihawkDicomViewer()] });
```

```tsx
import { useRef } from 'react';
import '@mihawksolutions/dicom-viewer/styles.css';
import { DEFAULT_CODEC_BASE_PATH, DicomViewer, type DicomViewerHandle } from '@mihawksolutions/dicom-viewer';

export function ImagingPage({ logout }: { logout: () => void }) {
  const viewer = useRef<DicomViewerHandle>(null);
  const handleLogout = () => {
    viewer.current?.clear();
    logout();
  };
  return (
    <>
      <button onClick={handleLogout}>Sign out</button>
      <div style={{ height: 600 }}>
        <DicomViewer
          ref={viewer}
          codecBasePath={import.meta.env.BASE_URL + DEFAULT_CODEC_BASE_PATH.slice(1)}
        />
      </div>
    </>
  );
}
```

The viewer fills its container. Give the container a height.

### What the Vite plugin does

- Serves the codec `.wasm` files in development and emits them at `<base>mihawk-dicom-viewer/codecs/` in production builds.
- Keeps `@cornerstonejs/dicom-image-loader` out of dependency pre-bundling so Vite bundles its decode worker, and pre-bundles the CommonJS codec wrappers that the worker imports.
- Maps Node's `events` module to the browser `events` package. Cornerstone needs this because vtk.js uses xmlbuilder2.

If your app uses a non-root `base`, pass `codecBasePath={`${base}mihawk-dicom-viewer/codecs/`}`.

## API

### `<DicomViewer />` props

| Prop | Type | Description |
|---|---|---|
| `labels` | `Partial<DicomViewerLabels>` | Overrides for any user-visible text. See `defaultLabels`. |
| `files` | `readonly Blob[]` | Local files from the host, for example from its own drop target. The viewer opens them whenever a new array is passed. |
| `codecBasePath` | `string` | Where codec files are served. Defaults to `/mihawk-dicom-viewer/codecs/`. Applies to the whole page, and the first viewer's value wins. |
| `maxWebWorkers` | `number` | Maximum number of decode workers. Defaults to half the logical CPUs. |
| `initialTool` | `ViewerTool` | 2D tool for the primary mouse button and arrow keys on mount: `'windowLevel'` (default), `'pan'`, `'zoom'` or `'scroll'`. |
| `initialLayout` | `'2d' \| '3d'` | Preferred layout when a series opens. Default `'2d'`. Series that cannot form a volume always open in 2D. Read once. |
| `volumeRendering` | `boolean` | Set `false` to leave out the rotatable 3D view (for example on low-end devices). The 3D layout then shows only the cross-sections. Default `true`. Read once. |
| `maxVolumeBytes` | `number` | Largest decoded volume the 3D layout allocates. Default 2 GiB (`DEFAULT_MAX_VOLUME_BYTES`). Larger series fail with `VOLUME_TOO_LARGE` and still open in 2D. Read once. |
| `onStateChange` | `(state: ViewerState) => void` | Fires on every lifecycle change. `state.layout` is the current layout. |
| `onStudiesLoaded` | `(studies: StudySummary[]) => void` | Fires after headers are read and grouped. Each `SeriesSummary.volume` says whether the series can open in 3D, with its dimensions and spacing or the reason it cannot. |
| `onSeriesDisplayed` | `(series: SeriesSummary, layout: '2d' \| '3d') => void` | Fires once a series has been drawn: the first image in 2D, the whole volume in 3D. |
| `onError` | `(error: DicomViewerError) => void` | `error.code` is one of `NO_DICOM_FILES`, `FILE_READ_FAILED`, `RENDERER_INIT_FAILED`, `IMAGE_LOAD_FAILED`, `UNSUPPORTED_IMAGE`, `VOLUME_UNSUPPORTED`, `VOLUME_LOAD_FAILED`, `VOLUME_TOO_LARGE`. |
| `className`, `style` | | Applied to the root element. |

### `DicomViewerHandle` (ref)

`openFiles(files)`, `selectSeries(seriesInstanceUid, { layout? })`, `setLayout(layout)`, `cancel()`, `clear()`, `getState()`, `setTool(tool)`, `resetView()`.

`setLayout('3d')` is ignored when the selected series cannot form a volume. `selectSeries(uid, { layout: '3d' })` on such a series fails with `VOLUME_UNSUPPORTED`.

### 2D viewing controls

| Input | Action |
|---|---|
| Primary button drag | Selected tool: window/level, pan, zoom or scroll |
| Right button drag | Zoom |
| Middle button drag | Pan |
| Mouse wheel | Next or previous image |
| Toolbar | Select tool, zoom in or out, reset view |
| Slice bar (stacks only) | Previous and next buttons, slider, position |

When the image is focused (Tab or click), the keyboard works as follows. Arrow keys apply the selected tool. With window/level, Left and Right narrow or widen the window, and Up and Down raise or lower the level, in steps of 5% of the current width. With pan, the arrows move the image. With zoom, Up and Right zoom in. With scroll, the arrows change the image. Page Up and Page Down change the image, Home and End go to the first and last image, `+` and `-` zoom, and `R` resets zoom, pan and window/level. Shift makes each step larger. The image has an accessible description of these keys (`labels.imageViewportHelp`).

With the image or a cross-section focused, press `W` for Window/Level, `P` for Pan, `Z` for Zoom, and `S` for Scroll. Press `C` for Crosshairs in a cross-section. The toolbar has one Tab stop. Use Left and Right to move between enabled buttons, Home and End to jump to either end, and Enter or Space to activate a button.

On a touchscreen, drag with one finger to use the selected tool and pinch with two fingers to zoom. The same gestures work in the cross-sections. In the 3D pane, drag with one finger to rotate and pinch to zoom. On narrow screens, swipe over a pane heading to scroll between panes.

The status bar shows the DICOM window width and center and the zoom relative to fit. If one image in a stack cannot be decoded, the series stays open and a notice names that image (`labels.imageFailed`).

### 3D layout (CBCT and CT volumes)

The **2D / 3D** toolbar switch reopens the selected series as a volume. The volume code loads only when 3D is first used. The layout shows four panes: axial, sagittal and coronal cross-sections, plus a rotatable 3D view. Series that can open in 3D carry a **3D** badge in the series list. For other series the 3D button is disabled, and its description gives the reason.

| Input | Cross-sections | 3D view |
|---|---|---|
| Primary button drag | Selected tool: crosshairs (default), window/level, pan, zoom or scroll | Rotate |
| Right button drag | Zoom | Zoom |
| Middle button drag | Pan | Pan |
| Mouse wheel | Next or previous slice | Zoom |
| Slider under each pane | Slice position | — |

With the crosshairs tool, a click or drag in one cross-section moves the other two through that point. Coloured reference lines show where the other planes cut (axial red, sagittal yellow, coronal green). Crosshairs move but never rotate; oblique reformatting is out of scope. Window/level is shared by the three cross-sections.

Keyboard, when a pane has focus:

- **Cross-sections.** Page Up and Page Down change the slice, and Home and End go to the first and last slice. Arrow keys apply the selected tool. With crosshairs, the arrows move the linked position by one voxel in screen directions, so Right in the axial view moves the sagittal plane.
- **3D view.** The arrows rotate in 10° steps.
- **All panes.** `+` and `-` zoom the focused pane, and `R` resets every view: cross-sections centred, default window/level, fit zoom, and the 3D view facing the patient's front with superior up. Shift makes each step larger.

The toolbar zoom buttons act on the last pane used. Display follows the radiological convention: patient right on screen left in axial and coronal views, anterior on the left in sagittal views, and superior up. Slice numbers count from superior (axial), from patient right (sagittal) and from posterior (coronal).

**What opens in 3D.** At least 3 parallel greyscale slices of one size and pixel spacing, in one frame of reference, stacked along the slice normal at even spacing. Slices may come from single-frame files or from an enhanced multi-frame file with per-frame positions. Order comes from geometry, not file names or instance numbers. Anything else reports a reason (`VolumeUnsupportedReason`): `too-few-images`, `color-images`, `missing-geometry`, `mixed-dimensions`, `mixed-orientation`, `mixed-frame-of-reference`, `tilted-slices`, `duplicate-positions`, `missing-slices` or `irregular-spacing`. A gap at either end of the series cannot be detected from geometry.

**Failures.** If a slice fails to decode, the 3D load fails with `VOLUME_LOAD_FAILED` rather than showing an incomplete volume. If the 3D view cannot be created, the cross-sections stay usable and the 3D pane shows `labels.volumeRenderingUnavailable`. Every 3D error offers **Open in 2D**, where damaged slices are reported one at a time.

### Lifecycle

`idle → scanning → loading → displayed`. In 3D, `state.progress` counts files read plus slices decoded while loading. Switching layout or series aborts the current load and releases the other layout's data. Cancel returns to `idle` during scanning and to `ready` (study list kept) during loading. `error` keeps any studies already found. Each new operation aborts the previous one, and results from stale operations are discarded.

### Styling

When upgrading from 0.5.0, update named Vite imports to `mihawkDicomViewer`, use the `mihawk-dv` prefix for custom selectors and theme properties, and point any explicitly configured codec URL at the new asset location.

Every selector is scoped under `.mihawk-dv`. To theme the viewer, override the `--mihawk-dv-*` custom properties, such as `--mihawk-dv-accent`, `--mihawk-dv-bg` or `--mihawk-dv-font`.

## Inputs (current)

- DICOM Part 10 files with the `DICM` preamble. The user can select files individually or as a folder, and can drop files or folders.
- Verified with synthetic fixtures: Explicit VR Little Endian, JPEG 2000 lossless, and JPEG-LS lossless. Single-frame images and ordered stacks, including a stack with one damaged slice. 3D: a 96×96×64 CT phantom as single-frame files and as one Enhanced CT multi-frame file, plus a series with a missing slice (rejected).
- Not yet verified: real CBCT exports and compressed volumes. The 3D view uses Cornerstone's `CT-Bone` preset, which assumes Hounsfield units; uncalibrated CBCT grey values may need another mapping.
- Not supported: Deflated Explicit VR Little Endian, files without pixel data (DICOMDIR, SR), and files without Study or Series Instance UIDs. These are listed as skipped files with a reason.

The Windows browser and device matrix and real-study validation are pending. The 1 GB input size is a benchmark target. The default 2 GiB decoded-volume estimate is checked after reading the first file and before reading the rest of the series. Peak memory during loading includes source data, decoded images and graphics resources. Once the 3D volume is ready, the viewer releases its parsed source datasets and keeps the decoded slices and their geometry. A large single-file study is still read in full when its dataset is needed.

## Development

From the repository root:

```sh
npm install
npm run fixtures         # regenerate synthetic DICOM fixtures
npm run dev              # build the package and start the demo (http://localhost:5173)
npm run check            # typecheck + unit tests + build package and demo
npm run smoke:consumer   # pack tarball → install in a clean Vite app → build → check assets
```

For a browser exercise, run `npm run smoke:consumer -- --keep`, enter the generated `app` folder, and run `npx vite preview`. Open `/dicom-consumer/`. Select a synthetic fixture from `fixtures/synthetic` in the repository and confirm that it displays. Use `codecs` to exercise JPEG 2000 and JPEG-LS in 2D, and select the files in `cbct` or `cbct-multiframe` and click **Host 3D** to exercise linked cross-sections and volume rendering. Use **Host cancel** during a load and **Host reset** after display. Reset should return the viewer to `idle` and remove the study and images. Capture the browser network, console and application storage during the exercise to verify local-data handling on the test device.
