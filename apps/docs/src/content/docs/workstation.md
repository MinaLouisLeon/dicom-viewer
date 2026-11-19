---
title: Workstation (full app)
description: Embed the complete DICOM viewer app, with tabs, a viewport grid, a side menu, presets, measurements and a DICOM tag map, as one React component.
---

`<DicomWorkstation />` is the whole viewer app as one component. Drop it into any React + Vite app to get the same experience as the standalone demo. `<DicomViewer />` is still available for hosts that want a single, minimal viewport.

```tsx
import { useRef } from 'react';
import '@mihawksolutions/dicom-viewer/styles.css';
import { DEFAULT_CODEC_BASE_PATH, DicomWorkstation, type DicomWorkstationHandle } from '@mihawksolutions/dicom-viewer';

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

Set up Vite with the `mihawkDicomViewer()` plugin, as described in the [Quickstart](../quickstart/). The component fills its container, so give the container a height.

## What it includes

| Area | Features |
| --- | --- |
| Tabs | **Viewer** and **Map**. The Map tab is a searchable DICOM tag map of the image in the active viewport, with nested sequences, a file picker, copy and JSON export. |
| Layout selector | Viewport grids from 1 × 1 to 3 × 3, plus "1 large on top + 2" and "1 large on the left + 2". Each cell shows its own series; drag a series from the list onto a cell, or select a cell and tap a series thumbnail. Shrinking the grid keeps the viewport you are working in. Cells that hold a CT or CBCT volume can switch to **3D / MPR**. |
| 3D / MPR | Five arrangements (2 × 2, 1 large on top + 2, 1 large on the left + 3, three side by side, single pane). Each pane has a plane picker (axial, sagittal, coronal or 3D), a coloured border, a view-direction badge (for example **I** for an axial view seen from the feet) and L/R/A/P/S/I edge markers. Thick slab: **AVG**, **MIP** or **MinIP** from 1 to 50 mm (AVG 10 mm by default). **Orthogonal planes** can be turned off to tilt the planes with the crosshair handles. The 3D pane has an orientation cube and a **3D style** picker: bone, soft tissue, MIP (grey), lung, angio, muscle. Cross-reference lines show in every pane whatever tool is selected. |
| Brightness & contrast | **Auto** (computed from the image's pixel values), **Default** (the window stored in the file), and Hounsfield presets: soft tissue, lungs, bones, brain, abdomen, mediastinum, teeth, liver, stroke, subdural, angio and temporal bone. A custom width and level can be typed in. Keys `1` to `9` apply the first nine. |
| Tools | Window/level, pan, zoom, scroll, magnify, and crosshairs in 3D cells. |
| Measurements | Length, angle, Cobb angle, bidirectional, rectangle and ellipse ROI (with statistics), probe, arrow note and eraser. Measurements are for the session only and are never saved. |
| Image | Invert, rotate left and right, flip horizontally and vertically, zoom and reset. |
| Cine | Play a stack (or the active 3D plane) at 1 to 60 frames per second, looping or stopping at the last image. |
| Link viewports | Linked scrolling (by patient position when series share a frame of reference, otherwise by relative position), linked zoom and pan, linked window/level, and cross-references (on by default). |
| Show / hide | Switches for measurements, arrow notes and cross-references. Hidden measurements are kept; drawing a new one shows them again. |
| Overlay | Corner information (series, study, image number, slice thickness and location, window, zoom, transforms) and orientation markers. Patient name, ID, sex, age and institution are shown only after the user turns on **Show patient details**. |
| Output | Save the active viewport (with measurements and overlay) as a PNG, and full screen. |

## Phone, tablet and desktop

The workstation measures its own width, not the window, so it adapts wherever it is embedded.

- **Desktop** (1024 px and wider): a toolbar with drop-down panels and a series sidebar. Panel labels appear from 1680 px; narrower widths show icons with tooltips.
- **Tablet** (640–1023 px): the menu button at the end of the header opens a side menu from the right with every option, and the header keeps quick buttons for the main tools and Auto contrast. A strip of real series thumbnails with image counts runs under the viewer.
- **Phone** (below 640 px): the header holds the tabs and the menu button; the thumbnail strip sits under the viewer. The side menu holds everything else and closes after layout and series choices.

The side menu starts with three tool tabs: **Navigate** (tools, linking, cine, rotate and flip), **Contrast** (invert, presets, custom window) and **Measure** (measurement tools). Below them come the layout icons, 3D settings, show/hide switches, the **2D / 3D** switch for the active viewport and the files section. A large **Reset** button stays at the bottom and restores every viewport's view.

Set `menuMode="sidemenu"` or `menuMode="toolbar"` to force one presentation.

## Props

| Prop | Purpose |
| --- | --- |
| `files` | Open a new array of local `Blob` objects supplied by your app. |
| `codecBasePath`, `maxWebWorkers`, `volumeRendering`, `maxVolumeBytes` | As for `<DicomViewer />`. |
| `initialGrid` | Grid on mount, for example `{ rows: 2, columns: 2 }`. |
| `initialTool` | Any workstation tool, for example `'length'`. |
| `windowPresets` | Replace the brightness and contrast presets. Each preset has an `id`, an optional fixed `window` (`{ width, center }`), optional `modalities`, and an optional digit `shortcut`. Name it through `labels.presets[id]`. |
| `features` | Turn parts off: `map`, `openFiles`, `seriesPanel`, `layouts`, `mpr`, `measurements`, `presets`, `transforms`, `cine`, `sync`, `referenceLines`, `overlay`, `export`, `fullscreen`. |
| `allowPatientInfo` | Set `false` to never show patient details. The overlay and tag map hide them and the toggle disappears. |
| `title`, `headerStart`, `headerEnd` | Brand the header and add host controls (a back button, an account menu). |
| `theme` | `dark` (default), `light` or `auto`. Override the `--mihawk-ws-*` custom properties for your own colours. |
| `menuMode` | `auto` (default), `sidemenu` or `toolbar`. |
| `labels` | Override any text. See `defaultWorkstationLabels`. |
| `onStateChange`, `onStudiesLoaded`, `onSeriesDisplayed`, `onError` | Follow the app's state. `onSeriesDisplayed` and `onError` also receive the cell ID. |

## Handle

`openFiles(files)`, `loadSeries(uid, cellIndex?, { mode? })`, `setGrid(grid)`, `setTool(tool)`, `applyPreset(id)`, `setTab('viewer' | 'map')`, `exportImage({ download? })`, `resetView()`, `cancel()`, `clear()`, `getState()`.

Call `clear()` on logout or patient switch to release every file.

## Keyboard

| Key | Action |
| --- | --- |
| `W` `P` `Z` `S` `M` `C` | Window/level, pan, zoom, scroll, magnify, crosshairs (3D) |
| `L` `A` `E` | Length, angle, eraser |
| `1`–`9` | Brightness and contrast presets (`1` is Auto) |
| `I`, `[`, `]`, `H`, `V` | Invert, rotate left, rotate right, flip horizontal, flip vertical |
| Space | Play or pause cine |
| `+` `-` `R` `F` | Zoom, reset, full screen |
| Arrows, Page Up/Down, Home/End | In a focused viewport: apply the tool, change the image or slice |

## Privacy

The workstation follows the package's privacy model. Files are read in the browser and never uploaded. The overlay and the tag map read header attributes from the local file on demand, and patient details stay hidden until the user asks for them. PNG and JSON exports are created in the browser and saved by the user.
