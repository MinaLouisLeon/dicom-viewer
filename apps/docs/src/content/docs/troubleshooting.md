---
title: Troubleshooting
description: Diagnose layout, codec, and volume loading issues.
---

**The viewport is blank.** Give the viewer's parent an explicit height and import the package stylesheet. Try the dental sample to check a single uncompressed image first.

**Compressed images fail.** Check that the Vite plugin is enabled and the worker bundle and codec files load. For apps served under a path such as GitHub Pages, prefix `codecBasePath` with Vite's `import.meta.env.BASE_URL` as shown in the quickstart.

**The 3D button is disabled.** Choose a series with at least three parallel grayscale slices of matching size and pixel spacing. The slices need consistent geometry and even spacing. The viewer explains why a series is ineligible.

**A volume is too large.** Open it in 2D or load a smaller series. The demo sets a 256 MiB decoded-volume limit to bound allocations on phones.
