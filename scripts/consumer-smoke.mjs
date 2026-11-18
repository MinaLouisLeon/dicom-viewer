#!/usr/bin/env node
/**
 * Clean-consumer smoke test.
 *
 * Packs @mivo-labs/dicom-viewer into a tarball, installs it into a fresh React + Vite
 * project outside this workspace, type-checks and builds that project, and checks
 * the production output for the worker and codec assets the viewer needs.
 *
 *   npm run smoke:consumer            # build + checks
 *   npm run smoke:consumer -- --keep  # keep the temp project and print its path
 *
 * Exits non-zero on any failure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'packages', 'dicom-viewer');
const keep = process.argv.includes('--keep');
const isWindows = process.platform === 'win32';

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}   (${path.relative(root, cwd) || '.'})`);
  // npm is a .cmd shim on Windows, which needs a shell.
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], shell: isWindows, encoding: 'utf8' });
}

function versions() {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const v = (name) => lock.packages[`node_modules/${name}`]?.version;
  return { react: v('react'), reactDom: v('react-dom'), vite: v('vite'), pluginReact: v('@vitejs/plugin-react'), typescript: v('typescript'), typesReact: v('@types/react'), typesReactDom: v('@types/react-dom'), typesNode: v('@types/node') };
}

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

const work = mkdtempSync(path.join(tmpdir(), 'mivo-dv-consumer-'));
try {
  run('npm', ['run', 'build'], pkgDir);
  const packJson = run('npm', ['pack', '--json', '--pack-destination', work], pkgDir);
  const [packInfo] = JSON.parse(packJson.slice(packJson.indexOf('[')));
  const tarball = path.join(work, packInfo.filename);
  console.log(`Packed ${packInfo.filename}: ${packInfo.entryCount} files, ${packInfo.size} bytes`);

  const files = packInfo.files.map((file) => file.path);
  check('tarball contains dist/index.js, dist/vite.js, dist/styles.css and declarations', ['dist/index.js', 'dist/vite.js', 'dist/styles.css', 'dist/types/index.d.ts', 'dist/types/vite/index.d.ts'].every((f) => files.includes(f)));
  check('tarball contains no .dcm fixtures, tests or sources', !files.some((f) => /\.dcm$|^test\/|^src\//.test(f)));

  const app = path.join(work, 'app');
  mkdirSync(path.join(app, 'src'), { recursive: true });
  const v = versions();
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    name: 'mivo-dv-clean-consumer',
    private: true,
    type: 'module',
    scripts: { build: 'tsc --noEmit && vite build' },
    dependencies: { '@mivo-labs/dicom-viewer': `file:${tarball.replaceAll('\\', '/')}`, react: v.react, 'react-dom': v.reactDom },
    devDependencies: { vite: v.vite, '@vitejs/plugin-react': v.pluginReact, typescript: v.typescript, '@types/react': v.typesReact, '@types/react-dom': v.typesReactDom, '@types/node': v.typesNode },
  }, null, 2));
  writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({
    // skipLibCheck is off on purpose so the package's published declarations are checked.
  compilerOptions: { target: 'ES2022', lib: ['ES2023', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: false, noEmit: true, types: ['vite/client', 'node'] },
    include: ['src', 'vite.config.ts'],
  }, null, 2));
  writeFileSync(path.join(app, 'vite.config.ts'), [
    "import { mivoDicomViewer } from '@mivo-labs/dicom-viewer/vite';",
    "import react from '@vitejs/plugin-react';",
    "import { defineConfig } from 'vite';",
    '',
    'export default defineConfig({ plugins: [react(), mivoDicomViewer()] });',
    '',
  ].join('\n'));
  writeFileSync(path.join(app, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>consumer</title></head><body><div id="root" style="height:100vh"></div><script type="module" src="/src/main.tsx"></script></body></html>\n');
  writeFileSync(path.join(app, 'src', 'main.tsx'), [
    "import '@mivo-labs/dicom-viewer/styles.css';",
    "import { DicomViewer, type DicomViewerHandle, type ViewerState } from '@mivo-labs/dicom-viewer';",
    "import { useRef } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    '',
    'function App() {',
    '  const ref = useRef<DicomViewerHandle>(null);',
    '  const onState = (state: ViewerState) => { document.title = state.phase; };',
    '  return <DicomViewer ref={ref} onStateChange={onState} labels={{ openFiles: "Open" }} />;',
    '}',
    '',
    "createRoot(document.getElementById('root')!).render(<App />);",
    '',
  ].join('\n'));

  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], app);
  run('npm', ['run', 'build'], app);

  const dist = path.join(app, 'dist');
  const listAll = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listAll(path.join(dir, d.name)) : [path.relative(dist, path.join(dir, d.name)).replaceAll('\\', '/')]));
  const out = listAll(dist);
  for (const codec of ['openjpegwasm_decode.wasm', 'charlswasm_decode.wasm', 'libjpegturbowasm_decode.wasm', 'openjphjs.wasm', 'jpegxlwasm_decode.wasm']) {
    check(`build emits mivo-dicom-viewer/codecs/${codec}`, out.includes(`mivo-dicom-viewer/codecs/${codec}`));
  }
  check('build emits the decode worker', out.some((f) => /decodeImageFrameWorker.*\.js$/.test(f)));
  check('build emits viewer CSS', out.some((f) => f.endsWith('.css') && readFileSync(path.join(dist, f), 'utf8').includes('.mivo-dv')));
  check('Cornerstone is code-split from the entry chunk', out.some((f) => /cornerstoneRenderer.*\.js$/.test(f)));
  check('3D volume code is a separate lazy chunk', out.some((f) => /cornerstoneVolumeRenderer.*\.js$/.test(f)));

  if (keep) console.log(`\nConsumer project kept at: ${app}\nPreview with: npx vite preview (in that folder)`);
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nClean consumer smoke test passed.');
