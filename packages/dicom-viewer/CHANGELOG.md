# Changelog

## Unreleased

- Added `<DicomWorkstation />`, the complete viewer app as one embeddable component, with **Viewer** and **Map** tabs.
- Added the Map tab: a searchable DICOM tag map of the active image with nested sequences, private-tag filter, copy, JSON export and patient-data redaction.
- Added a layout selector with viewport grids up to 3 × 3, one series per cell, drag-and-drop from the series list, and per-cell 3D / MPR with eight pane arrangements.
- Added brightness and contrast presets: Auto (percentile-based, ignores background), Default, and CT presets for soft tissue, lungs, bones, brain, abdomen, mediastinum, teeth, liver, stroke, subdural, angio and temporal bone, plus custom width and level.
- Added measurement tools (length, angle, Cobb angle, bidirectional, rectangle and ellipse ROI, probe, arrow note, eraser), magnify, invert, rotate, flip, cine, PNG export and full screen.
- Added linked scrolling, zoom/pan and window/level across viewports, and reference lines.
- Added a corner overlay with orientation markers. Patient details appear only after the user opts in.
- Added a side menu that holds every option on phones and tablets, sized from the component's own width.
- Added optional `setWindow` and `setInvert` to the volume renderer interface; the Cornerstone volume renderer implements both.
- The demo app now renders `<DicomWorkstation />`, with a light and dark theme switch and a multi-series sample.
- Reorganised the phone and tablet side menu around Navigate, Contrast and Measure tabs, opened from the right, with layout icons, show/hide switches, a 2D / 3D switch and a sticky Reset that restores every viewport.
- Added a strip of real series thumbnails with image counts under the viewer on phones and tablets; the desktop series list shows the same thumbnails.
- Added "1 large on top + 2" and "1 large on the left + 2" grids. Shrinking the grid keeps the active viewport.
- Added MPR arrangements with a plane picker on every pane, thick-slab AVG/MIP/MinIP (AVG 10 mm by default), an orthogonal/oblique switch, view-direction badges and edge markers, an orientation cube and a 3D style picker. Cross-references show in MPR whatever tool is selected and are on by default.
- Added show/hide switches for measurements and arrow notes, and a cine loop switch.
- Auto contrast on CT leaves out air and lung (below −500 HU) and uses the 5th–95th percentiles, which gives a soft-tissue window that adapts to each image. Auto now waits for a slice that is still decoding instead of measuring the previous one. Checked on a real abdomen–pelvis CT (48 axial and 25 coronal slices).
- The volume renderer gains optional `setSlab`, `setOblique`, `setVolumePreset` and `setCrosshairsVisible`, and reports slab, oblique, preset and per-view orientation in its status. The crosshairs tool rotates only when `allowRotation` is configured.

## 0.5.0

- Added local DICOM file and folder selection, study and series grouping, and a React viewer with a typed host API.
- Added 2D image and stack navigation, pan, zoom, window and level, keyboard controls, and recovery from damaged slices.
- Added linked axial, sagittal and coronal views and a rotatable volume for eligible CT and CBCT series.
- Added a Vite plugin for same-origin codec assets and scoped viewer styles.
- Added a packed-consumer build check for nested Vite deployments and host controls for exercising layout changes, cancellation and logout reset.
- Fixed a 3D cleanup race that could retain a dataset when its read finished after cancellation or reset.
- Added cleanup for pending 2D file reads when the viewer closes or switches studies.
- Kept decoder error details out of viewer state and host callbacks.
- Moved the 3D decoded-size check ahead of the bulk series read.
