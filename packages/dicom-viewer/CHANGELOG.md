# Changelog

## Unreleased

- Split the ready app into its own package, `@mihawksolutions/dicom-workstation`. This package keeps the free building blocks: `<DicomViewer />`, file scanning, the renderers and the helpers below.
- Added brightness and contrast helpers: `DEFAULT_WINDOW_PRESETS` (Auto, Default and CT presets), `presetApplies`, `computeAutoWindow` and `autoWindowOptionsFor`. Auto on CT leaves out air and lung (below −500 HU) and uses the 5th–95th percentiles.
- Added a DICOM tag reader: `readTagMap`, `filterTagNodes`, `countTagNodes`, `tagNodesToJson`, `lookupTag`, `formatTag` and `PATIENT_IDENTIFYING_TAGS`, with a compact built-in dictionary.
- Added overlay helpers: `readImageInfo`, `orientationMarkers`, `directionLabel` and `formatPersonName`.
- The volume renderer gains optional `setWindow`, `setInvert`, `setSlab`, `setOblique`, `setVolumePreset` and `setCrosshairsVisible`, and reports invert, slab, oblique, preset and per-view orientation in its status. The crosshairs tool rotates only when `allowRotation` is configured. Exported `VOLUME_PRESETS`, `SlabMode` and `VolumeSlab`.
- Axial stacks now open head first (most superior slice as image 1), whichever way the slice normal points. Sagittal and coronal stacks keep their geometric order.
- Added `@mihawksolutions/dicom-viewer/internal` and `@mihawksolutions/dicom-viewer/internal/cornerstone` for first-party add-ons such as the workstation. They are not a stable API.

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
