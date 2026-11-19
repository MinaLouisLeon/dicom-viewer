---
title: Quickstart
description: Set up the viewer in a React and Vite app.
---

Install the package from npm after publication.

```sh
npm install @mihawksolutions/dicom-viewer@0.5.0
```

To try a source checkout before publication, run `npm run build:package` and `npm pack --workspace @mihawksolutions/dicom-viewer` from the repository root. Install the resulting tarball in your app with `npm install /path/to/package.tgz`.

Add the viewer plugin to `vite.config.ts` so Vite can bundle the decode workers and serve the WASM codecs.

```ts
import { mivoDicomViewer } from '@mihawksolutions/dicom-viewer/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), mivoDicomViewer()],
});
```

Import the stylesheet and give the viewer a container with an explicit height.

```tsx
import { DEFAULT_CODEC_BASE_PATH, DicomViewer } from '@mihawksolutions/dicom-viewer';
import '@mihawksolutions/dicom-viewer/styles.css';

export function ImagingPage() {
  return (
    <div style={{ height: '75dvh' }}>
      <DicomViewer
        codecBasePath={import.meta.env.BASE_URL + DEFAULT_CODEC_BASE_PATH.slice(1)}
      />
    </div>
  );
}
```

Start your app and use **Open files** to select a DICOM image or all the files in a series. On touchscreens, drag with one finger to use the selected tool and pinch with two fingers to zoom. For a stack, use the slice slider to move between images.
