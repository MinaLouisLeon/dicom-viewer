# Changelog

## Unreleased

- Open ZIP archives: select, drop or pass a `.zip` and the app opens the DICOM files inside it, in the browser, without uploading anything. Archives are read from their central directory, so streamed archives (data descriptors) and ZIP64 archives over 4 GB work. Stored entries are read straight from the archive and deflated entries are inflated with the browser's built-in `DecompressionStream`, so no new dependency is needed. Archives inside archives are opened up to two levels deep, and folders and clutter (`__MACOSX`, `._*`, `.DS_Store`, `Thumbs.db`) are ignored.
- Password-protected entries, unsupported compression methods, damaged archives and archives over the limits are reported in the status bar (and with the error, when nothing could be opened) instead of failing the whole selection.
- Added `features.archives` (default on) and `maxArchiveBytes` (default 4 GiB of uncompressed data, plus a limit of 100,000 entries). The progress screen shows "Opening ZIP…" while an archive is read.
- Exported `expandArchives`, `isZipArchive`, `DEFAULT_ARCHIVE_LIMITS` and the `ArchiveIssue`, `ArchiveIssueReason`, `ArchiveLimits` and `ExpandResult` types.

## 0.1.0 (unreleased)

First release of the ready app as its own package. It needs `@mihawksolutions/dicom-viewer` 0.5.0 as a peer.

- `<DicomWorkstation />`: the complete viewer app as one embeddable component, with **Viewer** and **Map** tabs and a typed ref handle.
- Map tab: a searchable DICOM tag map of the active image with nested sequences, private-tag filter, copy, JSON export and patient-data redaction.
- Layouts: viewport grids up to 3 × 3 plus "1 large on top + 2" and "1 large on the left + 2", one series per cell, drag-and-drop or thumbnail selection. Shrinking the grid keeps the active viewport.
- 3D / MPR per cell: five arrangements, a plane picker on every pane, thick slab AVG/MIP/MinIP (AVG 10 mm by default), orthogonal or oblique planes, view-direction badges, edge markers, an orientation cube and a 3D style picker. Cross-references show whatever tool is selected.
- Brightness and contrast: Auto, Default and CT presets with keys 1–9, and a custom width and level. Auto waits for a slice that is still decoding.
- Measurements (length, angle, Cobb angle, bidirectional, rectangle and ellipse ROI, probe, arrow note, eraser) with show/hide switches, magnify, invert, rotate, flip, cine with loop, PNG export and full screen.
- Linked scrolling, zoom/pan and window/level, and cross-references between viewports.
- Corner overlay with orientation markers. Patient details appear only after the user opts in, or never with `allowPatientInfo={false}`.
- Phone and tablet: a side menu from the right with Navigate, Contrast and Measure tabs, layouts, show/hide switches, a 2D / 3D switch and a Reset button, plus a thumbnail strip under the viewer.
- Host integration: `features`, `windowPresets`, `labels`, `theme`, `menuMode`, `headerStart` and `headerEnd`. `@mihawksolutions/dicom-workstation/vite` re-exports the viewer's Vite plugin.
