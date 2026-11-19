import { cpSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const options = { cwd, stdio: 'inherit' };

execSync('npm run build:package', options);
execSync('npm run build -w @mihawksolutions/dicom-viewer-docs', options);
execSync('npm run build -w @mihawksolutions/dicom-viewer-demo', {
  ...options,
  env: { ...process.env, DEMO_BASE_PATH: '/dicom-viewer/demo/' },
});
cpSync(new URL('../apps/demo/dist/', import.meta.url), new URL('../apps/docs/dist/demo/', import.meta.url), {
  recursive: true,
});
