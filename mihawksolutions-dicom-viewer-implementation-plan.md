# @mihawksolutions/dicom-viewer — Implementation Plan

**Status:** 0.5.0 release candidate · **Publication:** npm scope access and release license pending · **Validation:** manual testing after publication · **Plan date:** 17 November 2026

**npm organization:** mihawksolutions · **npm package:** @mihawksolutions/dicom-viewer
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
| P03 · 3D CBCT viewer | P02 | Ready for review — P03-01 to P03-03 done; P03-04 orientation and ordering verified, comparison with acceptance limits waits on P00-02 | Branch `feat/3D-CBCT-viewer-q`; see progress log 2026-11-18 |
| P04 · Compatibility and release candidate | P03 | Implementation ready for 0.5.0 packaging | PR #4 established synthetic compatibility. Manual lifecycle checks and large-study validation follow publication. |
| P05 · npm publication and SaaS handoff | P04 | Blocked | npm authentication and owner decisions on license and visibility pending. |

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

- [x] P03-01 Read supported series, validate geometry, and assemble the volume from a correctly ordered set of slices.
- [x] P03-02 Implement linked axial, sagittal, and coronal views and synchronized cross-section position controls.
- [x] P03-03 Implement the rotatable 3D viewport and reset controls. Handle incomplete series and unavailable GPU features.
- [ ] P03-04 Verify orientation and slice ordering with known fixtures and compare rendering and resource use with the approved acceptance limits. *(Orientation and ordering verified with synthetic fixtures; resource comparison needs the P00-02 limits and real CBCT fixtures.)*

**Acceptance:** A supported CBCT study opens in linked cross-sections and a rotatable volume. Repeated loads and disposal pass the approved tests, and unsupported series fail clearly.

### P04 · Compatibility and release candidate

- [x] P04-01 Test both modes in a clean Vite consumer using the generated npm tarball. Verify CSS, workers, codecs, declarations, and production build assets.
- [ ] P04-02 Manually verify cancellation during an active 2D decode, logout reset, resource disposal, and browser storage, network and console behavior after publication. The 0.5.0 code handles late 2D dataset reads during cleanup and strips decoder error causes from host callbacks and viewer state.
- [x] P04-03 Write the quick start, API and compatibility documentation, sample integrations, known limitations, and changelog. The 0.5.0 archive omits source maps and uses the package file allowlist.
- [ ] P04-04 Manually benchmark representative single-file and multi-file inputs up to 1 GB after publication. Record hardware, peak resource use, cancellation responsiveness, repeated open and close behavior and network observations. The 0.5.0 renderer checks the decoded-size estimate after the first dataset and before reading the remaining files. The supported input size still needs measurement.

**2026-11-18 initial evidence.** A clean React + Vite production build installed the npm tarball and passed declaration, CSS, decode worker, WASM and lazy-chunk checks under `/dicom-consumer/`. Headless Chrome 157 on Windows with SwiftShader displayed the synthetic JPEG 2000 and JPEG-LS images and both the classic and enhanced CBCT fixtures. Host reset returned to idle and hid the images after each display. Cancelling a deliberately delayed header scan returned to idle. Observed requests were local GETs, with no console errors. Local storage contained only Cornerstone GPU capability and log-level keys. Session storage, IndexedDB, Cache Storage and service worker registrations were empty.

**2026-11-18 review of merged `dev` (7faa269).** `npm run check` passed package and demo builds, workspace type checks and all 94 tests. `npm run smoke:consumer` installed the development tarball in a fresh React 19 / Vite 8 app, checked declarations with `skipLibCheck: false`, and verified nested-base asset URLs, viewer CSS, the decode worker, five WASM codecs and separate lazy renderer chunks. The browser results above are from PR #4. The fresh runs verified the build and unit tests.

**2026-11-18 pre-release packaging.** The package and demo builds passed. The local npm archive contained 28 allowlisted text files. Inspection found no source maps, sample studies, DICOM file signatures or common credential token formats. Runtime tests and benchmarks are deferred to the owner's manual validation pass.

**Post-publication validation:** Install 0.5.0 from npm and exercise both modes on the supported Windows matrix. Record the large-study benchmark, cleanup and local-only network results, and track any fixes found during this pass.

### P05 · npm publication and SaaS handoff

- [ ] P05-01 Confirm authenticated npm scope access and record the package license and publication visibility.
- [ ] P05-02 Publish `@mihawksolutions/dicom-viewer@0.5.0` to npm and record release evidence.
- [ ] P05-03 Install `@mihawksolutions/dicom-viewer@0.5.0` from npm in a clean React + Vite project and smoke-test both modes. Record the version and results in SaaS task M00-03 before starting SaaS implementation.

**2026-11-19 release candidate verification.** All 97 tests passed, and the workspace checks and Pages build succeeded. A fresh React + Vite consumer installed the 28-file 0.5.0 tarball and passed declaration, CSS, worker, codec and lazy-chunk build checks.

**2026-11-19 release review.** `npm whoami` returned `ENEEDAUTH` and an unauthenticated lookup for 0.5.0 returned HTTP 404. The package currently declares `private: true`, `UNLICENSED`, and restricted publish access. P05-01 still requires authenticated scope access and an owner decision on the release license and visibility. P05-03 needs the published package before the 2D and 3D browser smoke tests and the M00-03 handoff.

**Acceptance:** The published version is installable and both viewer modes pass the clean-install smoke test.

## Viewer follow-up implementation

The `feat/viewer-touch-keyboard-memory` branch adds one-finger tools and pinch zoom in the 2D viewer and 3D cross-sections, plus touch rotation and pinch zoom in the volume pane. The toolbar uses a single Tab stop with arrow, Home and End navigation. Focused images and cross-sections accept tool shortcuts.

After 3D decoding completes, the viewer drops the source dataset buffers and retains decoded images and slice geometry. The loader still reads full datasets during loading. Chrome touch emulation at phone and tablet viewport sizes exercised the gestures, and both synthetic CBCT series displayed with zero source datasets in the loader cache. Physical-device testing and the large-study benchmark remain open.

## Progress log

Use **Not started**, **In progress**, **Blocked**, **Ready for review**, and **Accepted**. Keep task IDs stable. Update the tracker at each implementation pass and attach verification before checking a task.

| Date | Milestone / task IDs | Status and change | Commit / PR | Verification evidence | Blocker / next step |
|---|---|---|---|---|---|
| 2026-11-18 | P00 | Plan approved by package owner. P00-01 (npm scope access, license) and P00-02 (test matrix, fixtures, limits) remain open. | — | Owner approval in conversation | Close P00-01/P00-02 before P04 |
| 2026-11-18 | P01-01 – P01-03 | Ready for review. npm workspace with `packages/dicom-viewer` (ESM + declarations + `styles.css` + `/vite` plugin) and `apps/demo` (React + Vite, StrictMode). Built-in file and folder picker with drag and drop, progressive header scan, study and series grouping, geometric stack ordering, lazy-loaded Cornerstone stack renderer, lifecycle with abort/cancel/clear, translatable labels, scoped CSS. Synthetic fixture generator. | 7647b62, PR #1 | `npm run check`: typecheck, 37/37 unit tests, package and demo builds pass. `npm run smoke:consumer`: tarball (25 files, no sources or fixtures) installs into a clean Vite 8 + React 19 app, type-checks with `skipLibCheck: false`, and builds with worker, 5 codecs and CSS emitted. Chrome on Windows 11: demo dev server and clean-consumer production build render Explicit VR LE, JPEG 2000 lossless, JPEG-LS lossless and a 12-slice CT stack (canvas pixel check); truncated file shows IMAGE_LOAD_FAILED; non-DICOM file is skipped with a reason; switching studies discards the stale load (unit-tested); logout `clear()` returns to idle; all resource requests stayed on the app origin; no service worker; localStorage holds only Cornerstone GPU flags and log level. | Owner review of P01. Follow-ups below. |
| 2026-11-18 | P02-01 – P02-03 | Ready for review. Cornerstone tools (window/level, pan, zoom, stack scroll) in one tool group per viewer: selected tool on primary button, fixed right-drag zoom, middle-drag pan, wheel scroll. Toolbar tool selection (`aria-pressed`), zoom in/out, reset. Slice bar for stacks (prev/next, slider with `aria-valuetext`, position). Focusable image (`role="application"`, described key help): arrow keys follow the selected tool; Page Up/Down, Home/End, `+`/`-`, `R`; Shift for larger steps. Status bar readout of DICOM W/L and zoom. Viewport state is a separate store, so drag steps do not fire `onStateChange`. A damaged image inside a stack shows a non-blocking notice and keeps the series open. `onSeriesDisplayed` now waits for the first rendered frame (closes P01 follow-up 5). New public API: `initialTool` prop, handle `setTool()`/`resetView()`, `ViewerTool` and `ViewportStatus` types, new labels. New synthetic fixture `damaged-stack/` (6 slices, slice 4 truncated); existing fixtures byte-identical. Root `npm run check` now builds the package first, so it passes on a fresh checkout. | ed457e8, PR #2 | `npm run check`: typecheck, 52/52 unit tests (15 new), package and demo builds pass. `npm run smoke:consumer` passes. Chrome on Windows 11, demo dev server: 12-slice CT stack — wheel scroll, mouse W/L drag, Pan tool drag, keyboard W/L (2000→2100→2205), level (+110), zoom (144%), End (12/12), R reset to W 2000 · L 400 · 100% keeping image 12; click focuses the image. Damaged stack: slices 1–3, 5–6 display, notice appears only on slice 4 (also on revisit), phase stays `displayed`. Intraoral Explicit LE, JPEG 2000 and JPEG-LS display with no slice bar; invalid sample shows IMAGE_LOAD_FAILED plus 1 skipped file; logout clear returns to idle. No off-origin requests; localStorage holds only Cornerstone GPU flags and log level. | Owner review of P02. Follow-ups below. |
| 2026-11-18 | P03-01 – P03-04 | Ready for review (P03-04 partial). **Geometry:** header parser now reads pixel spacing, frame of reference, samples per pixel, bits allocated, and enhanced multi-frame geometry (shared and per-frame functional groups). New pure `assessVolume` decides at scan time whether a series forms a volume: at least 3 parallel greyscale slices of one size and spacing, one frame of reference, stacked along the normal at even spacing, from single-frame files or enhanced multi-frame. It orders slices by projection on the normal and otherwise returns one of 10 reasons. Public `SeriesSummary.volume`. **3D layout:** lazy-loaded Cornerstone volume renderer (separate ~16 KB chunk) with one engine and four viewports: axial, sagittal and coronal orthographic views and a `VOLUME_3D` view (CT-Bone preset, default camera facing the patient's front). Translate-only crosshairs (rotation and slab handles disabled), VOI synchronizer across cross-sections, trackball rotate on the 3D view. Progress covers files read plus slices decoded. Cancel, layout and series switches abort and release the volume, its images and datasets. A slice decode failure fails the load (`VOLUME_LOAD_FAILED`) instead of showing an incomplete volume. A failing 3D view leaves the cross-sections usable. **UI:** 2D/3D toolbar switch (3D disabled with the reason for unsupported series), 3D badge in the series list, 2×2 pane grid with colour-coded titles, slice position and slider per cross-section, Crosshairs tool, per-pane keyboard (slice keys, crosshair arrows, 3D arrow rotation, zoom, R reset), "Open in 2D" on 3D errors, status readout per active pane. **Public API:** props `initialLayout`, `volumeRendering`, `maxVolumeBytes`; handle `setLayout()`, `selectSeries(uid, { layout })`; `onSeriesDisplayed(series, layout)`; `state.layout`; error codes `VOLUME_UNSUPPORTED`, `VOLUME_LOAD_FAILED`, `VOLUME_TOO_LARGE`; types `ViewerLayout`, `VolumeStatus`, `VolumeSupport`, `VolumeUnsupportedReason` and others; new labels. **Fixtures:** `cbct/` (96×96×64 phantom with asymmetric markers), `cbct-multiframe/` (same volume, Enhanced CT, frames reversed), `cbct-missing-slice/`; existing fixtures byte-identical. **Fixed on the way:** P01's dataset release used the wrong cache key (`dicomfile:N` instead of `N`), and multi-frame datasets stayed cached after close; `FileRegistry` now releases them fully. | 7628161, PR #3 | `npm run check`: typecheck, 93/93 unit tests (41 new: geometry validator incl. every rejection reason and fixture ordering, 3D session paths, 3D UI), package and demo builds pass. `npm run smoke:consumer` passes with a new check that the volume code is a separate chunk. Chrome on Windows 11, demo dev server, measured from canvas pixels: classic and enhanced series show the right-anterior-superior cube top-left in axial (0.22, 0.22), sagittal (0.17, 0.15) and coronal (0.16, 0.15), and the left-posterior-inferior sphere bottom-right in all three, so radiological orientation is confirmed on every axis for both. Crosshair click on a marker moves the other planes through it (sagittal 49→72, coronal 48→25). Crosshair arrows, Page keys, sliders, window/level sync (L 400→900 in all three cross-sections), 3D arrow rotation and reset (restores the exact initial camera) work. 64-slice volume opens in about 1 s. Missing-slice series opens in 2D with 3D disabled and the reason as tooltip and description. `volumeRendering={false}` shows cross-sections plus the notice. Disposal: after 3 rounds of 2D↔3D, an enhanced-series load, cancel mid-load and close, the Cornerstone image cache, volumes and datasets are at 0. The clean-consumer production build renders all four panes and lazy-loads the volume chunk on first 3D use. No off-origin requests and no service worker; localStorage holds only Cornerstone's GPU-capability cache (renderer and format info) and log level; no console errors. | Owner review of P03. P03-04 resource comparison after P00-02. Follow-ups below. |
| 2026-11-18 | P04-01 to P04-04 | In progress. Packed-consumer verification complete for synthetic fixtures. Lifecycle and documentation checks partially verified. Large-study benchmark pending. | e35cb17, 1269d50, PR #4 | 94 tests passed and a fresh Vite consumer built from the renamed tarball. See P04 for the browser evidence recorded in PR #4. | Close P00-01 and P00-02, then finish the approved Windows matrix, 2D decode cancellation, tarball contents review and 1 GB benchmark. |
| 2026-11-18 | P03 follow-ups | Open. (1) Only synthetic volumes tested. Real dental CBCT exports (multi-file and enhanced, compressed transfer syntaxes) are needed in the P00-02 fixture set. (2) The 3D view uses the `CT-Bone` preset, which assumes Hounsfield units; uncalibrated CBCT grey values may need a data-driven transfer function. Decide with real fixtures. (3) While 3D is open, the raw file bytes (dataset cache) stay in memory beside the decoded volume, about 2× file size. Release datasets after decode, or read progressively, in P04-04. (4) Every file is read in full before the volume is created (headers for geometry), with bounded concurrency of 4; measure on 1 GB studies in P04-04. (5) `maxVolumeBytes` default (2 GiB) is unmeasured; calibrate against the P00-02 device matrix. (6) `TranslateCrosshairsTool` overrides Cornerstone's internal `_getRotationHandleNearImagePoint`; re-verify on any Cornerstone upgrade. (7) No touch bindings in 3D (see P02 follow-up 2). (8) The 3D view's window/level is fixed by the preset. (9) A gap at either end of a series cannot be detected from geometry. (10) P04 fixed the late dataset read in the 3D preload path. Verify cleanup during an in-flight 2D decode in P04-02. | — | — | Track in P04 |
| 2026-11-18 | P02 follow-ups | Open. (1) Lazy Cornerstone chunk grew from ~3.3 MB to ~3.7 MB minified with `@cornerstonejs/tools`; measure in P04. (2) No touch bindings yet (one-finger tool, pinch zoom); decide whether tablets are in the P00-02 device matrix. (3) Toolbar does not use roving tabindex; every button is a Tab stop. Revisit in the P04 accessibility pass. (4) Window/level presets (for example bone or soft tissue) and invert are not in scope; add if the SaaS needs them. | — | — | Track in P03 and P04 |
| 2026-11-18 | P01 follow-ups | Open. (1) Cornerstone 5.19 default metadata path does not decode `dicomfile:` images; legacy provider used, revisit on upgrade. (2) Vite 8 also resolves Cornerstone's codec URLs itself, so production builds contain each codec twice (~2 MB on disk, only one copy downloaded); decide in P04. (3) Cornerstone chunk is ~3.3 MB minified (vtk.js/xmlbuilder2); measure in P04. (4) `npm audit`: high-severity adm-zip advisories via `dcmjs` (no fix available; Node-only ZIP code, not on the browser path); re-check before release. (5) ~~`onSeriesDisplayed` fires a few hundred ms before the first GPU frame paints; tighten in P02.~~ Fixed in P02. | — | — | Track in P02 and P04 |

## Decision log

| Date | Decision |
|---|---|
| 2026-11-17 | First release provides the full React UI with 2D and 3D viewing of locally selected DICOM files. Validate studies up to 1 GB and document the supported hardware envelope. Publish and clean-install-test before SaaS implementation. |
| 2026-11-18 | Plan approved. P01 may start before P00-01/P00-02 close; both must close before the P04 release candidate. |
| 2026-11-18 | Toolchain: npm workspaces, Node 22, Vite 8.3.8, React 19.3.1 (peer range `>=18.2 <20`), TypeScript 6.0.3 (TypeScript 7 not used yet because its compiler API is not needed and tooling support is unverified), Vitest 5.1. Cornerstone3D packages pinned to exactly 5.19.4. |
| 2026-11-18 | Integration: consumers add the `mivoDicomViewer()` Vite plugin from `@mihawksolutions/dicom-viewer/vite`, which serves the codecs, configures the worker build, and aliases `events` to a browser polyfill. Codec path is a prop (`codecBasePath`). |
| 2026-11-18 | Package stays `private: true` and `UNLICENSED` until P00-01 records the license and P05 approves publication, so it cannot be published by accident. |
| 2026-11-18 | Package owner requested preparing the initial release and doing manual compatibility and performance validation after publication. This supersedes the pre-publication test sequence. |
| 2026-11-19 | Package owner set the initial npm release target to 0.5.0. |
| 2026-11-18 | 3D scope: orthogonal cross-sections only. Crosshairs translate but never rotate, and slab thickness is off; oblique reformatting is out of scope for the first release. A series opens in 3D only if header geometry forms a regular volume; anything else opens in 2D with the reason. A slice that fails to decode fails the 3D load instead of showing a volume with holes. |
| 2026-11-18 | Layout is a sticky preference: the 2D/3D choice applies to every later series that supports it, and series that cannot form a volume fall back to 2D. Each layout keeps its own tool (3D defaults to Crosshairs). |
