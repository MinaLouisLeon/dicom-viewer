# @mivo-labs/dicom-viewer — Implementation Plan

**Status:** Plan approved 18 November 2026 · **Implementation:** P01 and P02 ready for review · **Plan date:** 17 November 2026

**Organization:** mivo-labs · **npm package:** @mivo-labs/dicom-viewer
Build and publish a reusable React DICOM viewer with **both 2D and 3D viewing** in its first npm release. The [Dental Clinic SaaS plan](dental-clinic-saas-implementation-plan.md) depends on that tested release. Begin SaaS implementation after publication and clean-install verification. Use a standalone React + Vite demo to develop and test the package first.

## First release scope

| Area | Deliverable |
|---|---|
| 2D | Open a single DICOM image or scroll an ordered image stack. Provide pan, zoom, window and level, reset, and loading and error states. |
| 3D | Load a supported CBCT series as a volume. Show linked axial, sagittal, and coronal cross-sections with synchronized position controls, plus a rotatable 3D volume viewport. |
| Sources | Open local DICOM files directly from the user’s device in both the demo and consuming apps. Include single-file and multi-file study selection. Document input shapes and tested transfer syntaxes and series types. |
| UI | Complete ready-to-use React UI including file selection, study and series selection, 2D/3D layout switching, toolbars, slice controls, progress, cancel, clear/close, and actionable errors. Provide TypeScript components, viewer styles that stay scoped to the component, accessible controls, and text labels that consumers can translate. |
| Integration | The host app embeds the complete viewer and controls application access. The package handles local file selection and rendering. DICOM content and metadata stay in the browser session. |

The initial scope excludes scanner and PACS integration, segmentation, implant planning, persistent annotations, and converting flat images into volumes. Any intended diagnostic use and associated validation require a separate decision.

## Proposed technical design

- Build a React and TypeScript library around [Cornerstone3D](https://www.cornerstonejs.org/docs/getting-started/installation/). Use its core, DICOM image loader, and tools. Validate workers, codecs, GPU rendering, and packaged asset resolution in a separate Vite consumer.
- Public API should include a viewer component, typed image and series sources, local File/Blob sources and the built-in file-selection UI, viewer mode and layout configuration, translation labels, and load and error callbacks. Finalize the shape after testing both modes. Keep React a peer dependency and document the tested runtime and browser versions.
- For volume reconstruction, verify series membership, orientation, slice positions, spacing, and ordering from metadata. Clearly report unsupported or incomplete volumes and show loading progress. Test representative CBCT series before documenting support.
- Lazy-load volumetric code, cancel stale loads when switching studies, and clean up caches, workers or rendering resources as appropriate on switch and unmount. Keep DICOM bytes and patient metadata out of logs, persistent browser storage, and service-worker caches. Use only synthetic or approved de-identified public fixtures in the repo, demo, CI, and npm artifact.
- Proposed build output is ESM, TypeScript declarations, and documented styles. Record publish access to the npm scope, the license, and dependency notice requirements before releasing. Publish under the exact package name after package-owner approval.

## Large-study and local-data requirements

- Target representative single-file and multi-file studies up to 1 GB of on-disk input. Decoded volumes and GPU textures can require substantially more memory. Record browser, RAM, GPU, load time, peak memory, and tested study geometry before claiming compatibility.
- Read files progressively where the decoder permits, avoid redundant full copies, bound decoding concurrency and image caches, and keep the UI responsive with progress and cancellation. Release object URLs, decoded data, and rendering resources on close or switch.
- Detect unsupported geometry, formats, and resource limits with useful messages. Document the supported hardware and study envelope from measured results.
- Use no upload endpoint or remote study retrieval in the first release. Serve codecs and workers with the consuming application. Verify zero outbound transmission of selected files, patient metadata, or filenames through network capture.
- Keep selected files in session memory only. Reopening after refresh requires selecting the originals again.

## Milestone tracker

| Milestone | Depends on | Status | Evidence / review |
|---|---|---|---|
| P00 · Plan and compatibility baseline | — | In progress — plan approved 2026-11-18; P00-01 and P00-02 open | Plan approval recorded in decision log |
| P01 · Package foundation and demo | P00 (plan approval) | Ready for review | Branch `feat/p01-package-foundation`; see progress log 2026-11-18 |
| P02 · 2D viewer | P01 | Ready for review | Branch `feat/2d-viewer`; see progress log 2026-11-18 |
| P03 · 3D CBCT viewer | P02 | Not started | — |
| P04 · Compatibility and release candidate | P03 | Not started | — |
| P05 · npm publication and SaaS handoff | P04 | Not started | — |

### P00 · Plan and compatibility baseline

- [ ] P00-01 Record package owner approval, repository, npm scope access, and license decision.
- [ ] P00-02 Define the Windows test devices and browsers, supported input and codec matrix, approved fixtures, and performance acceptance limits for CBCT studies.

**Acceptance:** The first release scope and test matrix cover single images, stacks, and CBCT volumes, with fixture provenance recorded.

### P01 · Package foundation and demo

- [x] P01-01 Create the TypeScript package, export map, build, checking and test commands, and standalone React + Vite demo.
- [x] P01-02 Prove Cornerstone initialization, worker and codec loading, and loading from local files through the packaged selection UI.
- [x] P01-03 Define component lifecycle and error states. Confirm switching studies aborts stale loads.

**Acceptance:** A built package works in a clean consumer app on Windows. The demo exercises the same public API intended for the SaaS.

### P02 · 2D viewer

- [x] P02-01 Render a single dental X-ray and an image stack with slice navigation.
- [x] P02-02 Implement pan, zoom, window and level, reset, and keyboard-accessible controls.
- [x] P02-03 Verify unsupported inputs, corrupted files, cancelled reads, and study switching.

**Acceptance:** Approved 2D fixtures display and all required tools work. A corrupt or unsupported image produces an actionable error.

### P03 · 3D CBCT viewer

- [ ] P03-01 Read supported series, validate geometry, and assemble the volume from a correctly ordered set of slices.
- [ ] P03-02 Implement linked axial, sagittal, and coronal views and synchronized cross-section position controls.
- [ ] P03-03 Implement the rotatable 3D viewport and reset controls. Handle incomplete series and unavailable GPU features.
- [ ] P03-04 Verify orientation and slice ordering with known fixtures and compare rendering and resource use with the approved acceptance limits.

**Acceptance:** A supported CBCT study opens in linked cross-sections and a rotatable volume. Repeated loads and disposal pass the approved tests, and unsupported series fail clearly.

### P04 · Compatibility and release candidate

- [ ] P04-01 Test both modes in a clean Vite consumer using the generated npm tarball. Verify CSS, workers, codecs, declarations, and production build assets.
- [ ] P04-02 Verify cancellation, host-requested reset on logout, resource disposal, and absence of persistent clinical data or sensitive logging.
- [ ] P04-04 Benchmark representative inputs up to 1 GB, including both a large file and multi-file series. Capture resource use, cancellation responsiveness, repeated open/close behavior, and network evidence. Record supported limits and resolve release-blocking crashes.
- [ ] P04-03 Write quick start, API and compatibility documentation, sample integrations, known limitations, and a changelog. Inspect the tarball for credentials and patient data.

**Acceptance:** The complete packaged UI and both modes pass the approved Windows test matrix from the tarball. The documented large-study benchmark and local-only network checks pass. Document the results and resolve release-blocking issues.

### P05 · npm publication and SaaS handoff

- [ ] P05-01 Confirm npm scope access and obtain package-owner approval for the tested release candidate and publication visibility.
- [ ] P05-02 Publish @mivo-labs/dicom-viewer to npm and record the version and release evidence.
- [ ] P05-03 Install that exact version from npm in a clean React + Vite project and smoke-test both modes. Record the version and results in SaaS task M00-03 before starting SaaS implementation.

**Acceptance:** The published version is installable and both viewer modes pass the clean-install smoke test.

## Progress log

Use **Not started**, **In progress**, **Blocked**, **Ready for review**, and **Accepted**. Keep task IDs stable. Update the tracker at each implementation pass and attach verification before checking a task.

| Date | Milestone / task IDs | Status and change | Commit / PR | Verification evidence | Blocker / next step |
|---|---|---|---|---|---|
| 2026-11-18 | P00 | Plan approved by package owner. P00-01 (npm scope access, license) and P00-02 (test matrix, fixtures, limits) remain open. | — | Owner approval in conversation | Close P00-01/P00-02 before P04 |
| 2026-11-18 | P01-01 – P01-03 | Ready for review. npm workspace with `packages/dicom-viewer` (ESM + declarations + `styles.css` + `/vite` plugin) and `apps/demo` (React + Vite, StrictMode). Built-in file and folder picker with drag and drop, progressive header scan, study and series grouping, geometric stack ordering, lazy-loaded Cornerstone stack renderer, lifecycle with abort/cancel/clear, translatable labels, scoped CSS. Synthetic fixture generator. | 7647b62, PR #1 | `npm run check`: typecheck, 37/37 unit tests, package and demo builds pass. `npm run smoke:consumer`: tarball (25 files, no sources or fixtures) installs into a clean Vite 8 + React 19 app, type-checks with `skipLibCheck: false`, and builds with worker, 5 codecs and CSS emitted. Chrome on Windows 11: demo dev server and clean-consumer production build render Explicit VR LE, JPEG 2000 lossless, JPEG-LS lossless and a 12-slice CT stack (canvas pixel check); truncated file shows IMAGE_LOAD_FAILED; non-DICOM file is skipped with a reason; switching studies discards the stale load (unit-tested); logout `clear()` returns to idle; all resource requests stayed on the app origin; no service worker; localStorage holds only Cornerstone GPU flags and log level. | Owner review of P01. Follow-ups below. |
| 2026-11-18 | P02-01 – P02-03 | Ready for review. Cornerstone tools (window/level, pan, zoom, stack scroll) in one tool group per viewer: selected tool on primary button, fixed right-drag zoom, middle-drag pan, wheel scroll. Toolbar tool selection (`aria-pressed`), zoom in/out, reset. Slice bar for stacks (prev/next, slider with `aria-valuetext`, position). Focusable image (`role="application"`, described key help): arrow keys follow the selected tool; Page Up/Down, Home/End, `+`/`-`, `R`; Shift for larger steps. Status bar readout of DICOM W/L and zoom. Viewport state is a separate store, so drag steps do not fire `onStateChange`. A damaged image inside a stack shows a non-blocking notice and keeps the series open. `onSeriesDisplayed` now waits for the first rendered frame (closes P01 follow-up 5). New public API: `initialTool` prop, handle `setTool()`/`resetView()`, `ViewerTool` and `ViewportStatus` types, new labels. New synthetic fixture `damaged-stack/` (6 slices, slice 4 truncated); existing fixtures byte-identical. Root `npm run check` now builds the package first, so it passes on a fresh checkout. | Uncommitted on `feat/2d-viewer` | `npm run check`: typecheck, 52/52 unit tests (15 new), package and demo builds pass. `npm run smoke:consumer` passes. Chrome on Windows 11, demo dev server: 12-slice CT stack — wheel scroll, mouse W/L drag, Pan tool drag, keyboard W/L (2000→2100→2205), level (+110), zoom (144%), End (12/12), R reset to W 2000 · L 400 · 100% keeping image 12; click focuses the image. Damaged stack: slices 1–3, 5–6 display, notice appears only on slice 4 (also on revisit), phase stays `displayed`. Intraoral Explicit LE, JPEG 2000 and JPEG-LS display with no slice bar; invalid sample shows IMAGE_LOAD_FAILED plus 1 skipped file; logout clear returns to idle. No off-origin requests; localStorage holds only Cornerstone GPU flags and log level. | Owner review of P02. Follow-ups below. |
| 2026-11-18 | P02 follow-ups | Open. (1) Lazy Cornerstone chunk grew from ~3.3 MB to ~3.7 MB minified with `@cornerstonejs/tools`; measure in P04. (2) No touch bindings yet (one-finger tool, pinch zoom); decide whether tablets are in the P00-02 device matrix. (3) Toolbar does not use roving tabindex; every button is a Tab stop. Revisit in the P04 accessibility pass. (4) Window/level presets (for example bone or soft tissue) and invert are not in scope; add if the SaaS needs them. | — | — | Track in P03 and P04 |
| 2026-11-18 | P01 follow-ups | Open. (1) Cornerstone 5.19 default metadata path does not decode `dicomfile:` images; legacy provider used, revisit on upgrade. (2) Vite 8 also resolves Cornerstone's codec URLs itself, so production builds contain each codec twice (~2 MB on disk, only one copy downloaded); decide in P04. (3) Cornerstone chunk is ~3.3 MB minified (vtk.js/xmlbuilder2); measure in P04. (4) `npm audit`: high-severity adm-zip advisories via `dcmjs` (no fix available; Node-only ZIP code, not on the browser path); re-check before release. (5) ~~`onSeriesDisplayed` fires a few hundred ms before the first GPU frame paints; tighten in P02.~~ Fixed in P02. | — | — | Track in P02 and P04 |

## Decision log

| Date | Decision |
|---|---|
| 2026-11-17 | First release provides the full React UI with 2D and 3D viewing of locally selected DICOM files. Validate studies up to 1 GB and document the supported hardware envelope. Publish and clean-install-test before SaaS implementation. |
| 2026-11-18 | Plan approved. P01 may start before P00-01/P00-02 close; both must close before the P04 release candidate. |
| 2026-11-18 | Toolchain: npm workspaces, Node 22, Vite 8.3.8, React 19.3.1 (peer range `>=18.2 <20`), TypeScript 6.0.3 (TypeScript 7 not used yet because its compiler API is not needed and tooling support is unverified), Vitest 5.1. Cornerstone3D packages pinned to exactly 5.19.4. |
| 2026-11-18 | Integration: consumers add the `mivoDicomViewer()` Vite plugin from `@mivo-labs/dicom-viewer/vite`, which serves the codecs, configures the worker build, and aliases `events` to a browser polyfill. Codec path is a prop (`codecBasePath`). |
| 2026-11-18 | Package stays `private: true` and `UNLICENSED` until P00-01 records the license and P05 approves publication, so it cannot be published by accident. |
