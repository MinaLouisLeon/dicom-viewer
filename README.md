# @mihawksolutions/dicom-viewer workspace

- `packages/dicom-viewer`: the npm package. See its [README](packages/dicom-viewer/README.md).
- `apps/demo`: standalone React + Vite demo that uses the package's public API.
- `fixtures/`: synthetic DICOM test data only. See [fixtures/README.md](fixtures/README.md).
- `scripts/`: fixture generator and clean-consumer smoke test.
- [Implementation plan](mivo-labs-dicom-viewer-implementation-plan.md)

```sh
npm install
npm run dev              # demo at http://localhost:5173
npm run check            # typecheck + tests + builds
npm run smoke:consumer   # tarball → clean Vite app → build checks
```
