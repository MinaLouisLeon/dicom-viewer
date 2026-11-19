# Changelog

## 1.0.0

- Added local DICOM file and folder selection, study and series grouping, and a React viewer with a typed host API.
- Added 2D image and stack navigation, pan, zoom, window and level, keyboard controls, and recovery from damaged slices.
- Added linked axial, sagittal and coronal views and a rotatable volume for eligible CT and CBCT series.
- Added a Vite plugin for same-origin codec assets and scoped viewer styles.
- Added a packed-consumer build check for nested Vite deployments and host controls for exercising layout changes, cancellation and logout reset.
- Fixed a 3D cleanup race that could retain a dataset when its read finished after cancellation or reset.
- Added cleanup for pending 2D file reads when the viewer closes or switches studies.
- Kept decoder error details out of viewer state and host callbacks.
- Moved the 3D decoded-size check ahead of the bulk series read.
