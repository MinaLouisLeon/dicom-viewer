# @mihawksolutions/dicom-viewer workspace

Release target: **0.5.0**.

- [Live documentation](https://mihawk-solutions.github.io/dicom-viewer/)
- [Live demo](https://mihawk-solutions.github.io/dicom-viewer/demo/)

- `packages/dicom-viewer`: the npm package. See its [README](packages/dicom-viewer/README.md).
- `apps/demo`: standalone React + Vite web app. It renders `<DicomWorkstation />`, the full viewer app (tabs, viewport grid, side menu, presets, measurements, DICOM tag map), which other React apps can embed as one component.
- `apps/docs`: Astro Starlight documentation for the package.
- `fixtures/`: synthetic DICOM test data only. See [fixtures/README.md](fixtures/README.md).
- `scripts/`: fixture generator and clean-consumer smoke test.

```sh
npm install
npm run dev              # demo at http://localhost:5173
npm run check            # typecheck + tests + builds
npm run build:pages      # docs and standalone demo in apps/docs/dist
npm run preview:pages    # serve the built Pages site locally
npm run smoke:consumer   # tarball → clean Vite app → build checks
```

The demo generates its synthetic dental and head CT samples before startup and build.
Run `npm run dev -w @mihawksolutions/dicom-viewer-docs` to preview the docs separately.

To preview what GitHub Pages will serve, run `npm run build:pages` followed by
`npm run preview:pages` and open <http://localhost:4321/dicom-viewer/>.
Use **Open demo** to launch the built viewer in a separate tab.

The Pages workflow builds with Node.js 24 and deploys from `main` when the repository's Pages source is set to GitHub Actions. The docs and standalone demo are served from the same artifact.
