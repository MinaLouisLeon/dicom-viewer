# @mihawksolutions/dicom-workstation

The complete Mihawk DICOM viewer app as one React component. Add it to a React + Vite app and you get the whole viewer: tabs, a viewport grid, 3D / MPR, brightness and contrast presets, measurements, a DICOM tag map and a side menu for phones and tablets.

It is built on the free [`@mihawksolutions/dicom-viewer`](../dicom-viewer/README.md) package, which it needs as a peer. Teams that would rather build their own interface can use that package directly.

> **License.** This package is commercial and is not covered by the viewer package's license. Licence terms are to be added before publication.

## Install

```sh
npm install @mihawksolutions/dicom-workstation @mihawksolutions/dicom-viewer
```

Both packages must be installed so the app has a single copy of the viewer and of Cornerstone. npm 7 and later install the peers automatically.

```ts
// vite.config.ts
import { mihawkDicomViewer } from '@mihawksolutions/dicom-workstation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react(), mihawkDicomViewer()] });
```

```tsx
import { useRef } from 'react';
import '@mihawksolutions/dicom-workstation/styles.css';
import { DEFAULT_CODEC_BASE_PATH, DicomWorkstation, type DicomWorkstationHandle } from '@mihawksolutions/dicom-workstation';

export function ImagingPage({ logout }: { logout: () => void }) {
  const workstation = useRef<DicomWorkstationHandle>(null);
  return (
    <div style={{ height: '100vh' }}>
      <DicomWorkstation
        ref={workstation}
        codecBasePath={import.meta.env.BASE_URL + DEFAULT_CODEC_BASE_PATH.slice(1)}
        title="Imaging"
        headerEnd={<button onClick={() => { workstation.current?.clear(); logout(); }}>Sign out</button>}
      />
    </div>
  );
}
```

The component fills its container, so give the container a height. Files are read in the browser and never uploaded.

## What it includes

- **Tabs:** Viewer and Map (a searchable DICOM tag map of the active image).
- **Layouts:** grids from 1 × 1 to 3 × 3 and "1 large + 2" layouts, one series per cell.
- **3D / MPR:** five arrangements, a plane picker per pane, thick slab (AVG/MIP/MinIP), oblique planes, an orientation cube and 3D styles.
- **Brightness and contrast:** Auto, Default, CT presets (lungs, bones, brain, soft tissue, abdomen, teeth and more) and custom values.
- **Tools:** window/level, pan, zoom, scroll, magnify, crosshairs and nine measurement tools.
- **Image:** invert, rotate, flip, cine with loop, PNG export, full screen.
- **Linking:** scrolling, zoom/pan, window/level and cross-references between viewports.
- **Phone and tablet:** a side menu with every option and a thumbnail strip, sized from the component's own width.
- **ZIP archives:** pick or drop a `.zip` and the DICOM files inside open directly, unpacked in the browser. Streamed and ZIP64 archives are supported. Picking a ZIP with **Open files** also avoids the browser's folder-upload warning on phones.

## Customise

| Prop | Purpose |
| --- | --- |
| `features` | Turn parts off: `map`, `openFiles`, `seriesPanel`, `layouts`, `mpr`, `measurements`, `presets`, `transforms`, `cine`, `sync`, `referenceLines`, `overlay`, `export`, `fullscreen`, `archives`. |
| `windowPresets` | Replace the brightness and contrast presets. |
| `labels` | Translate or reword any text (`defaultWorkstationLabels`). |
| `theme` | `dark`, `light` or `auto`; override `--mihawk-ws-*` properties for your colours. |
| `menuMode` | `auto`, `sidemenu` or `toolbar`. |
| `allowPatientInfo` | `false` never shows patient details. |
| `title`, `headerStart`, `headerEnd` | Brand the header and add your own controls. |
| `initialGrid`, `initialTool`, `files` | Starting grid, tool and files. `files` may include ZIP archives. |
| `maxArchiveBytes` | Largest total uncompressed size read from ZIP archives (default 4 GiB). Turn ZIP support off with `features={{ archives: false }}`. |

The ref handle offers `openFiles`, `loadSeries`, `setGrid`, `setTool`, `applyPreset`, `setTab`, `exportImage`, `resetView`, `cancel`, `clear` and `getState`. Call `clear()` on logout or patient switch.

The full reference is in the documentation under **Workstation**.

## Development

From the repository root, `npm run build:package` builds both packages, `npm run test` tests both, and `npm run smoke:consumer` installs both tarballs into a clean Vite app. This package's tests run against the viewer's sources, so they need no build first.
