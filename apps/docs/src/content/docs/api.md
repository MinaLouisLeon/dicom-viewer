---
title: Viewer API
description: Configure the viewer and control it from a host app.
---

## Props

| Prop | Purpose |
| --- | --- |
| `files` | Open a new array of local `Blob` objects supplied by your app. |
| `codecBasePath` | URL prefix for the WASM codecs. The first viewer on the page sets it. |
| `maxWebWorkers` | Limit the number of decoder workers. |
| `initialTool` | Choose `windowLevel`, `pan`, `zoom`, or `scroll`. |
| `initialLayout` | Prefer `2d` or `3d` when opening a supported series. |
| `volumeRendering` | Set to `false` to show cross-sections without a rotatable volume pane. |
| `maxVolumeBytes` | Bound decoded volume size. The package default is 2 GiB. |
| `labels` | Override visible labels and accessible descriptions. |
| `className`, `style` | Style the root. The stylesheet exposes `--mivo-dv-*` theme properties. |

Use `onStateChange` to follow scanning, loading, and display state. Use `onStudiesLoaded` to inspect series and their volume support, `onSeriesDisplayed` to react to a rendered series, and `onError` to handle failures by error code.

## Viewer ref

Pass a React ref typed as `DicomViewerHandle` to call `openFiles(files)`, `selectSeries(uid, { layout })`, `setLayout(layout)`, `cancel()`, `clear()`, `getState()`, `setTool(tool)`, or `resetView()`. Call `clear()` when closing a study or signing out.

The package README includes the full prop types, keyboard shortcuts, and format coverage. [Package reference](https://github.com/mihawk-solutions/dicom-viewer/blob/dev/packages/dicom-viewer/README.md)
