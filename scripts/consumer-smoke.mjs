#!/usr/bin/env node
/**
 * Clean-consumer smoke test.
 *
 * Packs @mihawksolutions/dicom-viewer into a tarball, installs it into a fresh React + Vite
 * project outside this workspace, type-checks and builds that project, and checks
 * the production output for the worker and codec assets the viewer needs.
 *
 *   npm run smoke:consumer            # build + checks
 *   npm run smoke:consumer -- --keep  # keep the temp project and print its path
 *
 * Exits non-zero on any failure.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'packages', 'dicom-viewer');
const keep = process.argv.includes('--keep');
const base = '/dicom-consumer/';
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
  const expectedFiles = /^(?:package\.json|README\.md|CHANGELOG\.md|dist\/(?:styles\.css|(?:index|vite|chunks\/[\w-]+)\.js(?:\.map)?|types\/(?:[\w-]+\/)*[\w-]+\.d\.ts))$/;
  const unexpectedFiles = files.filter((file) => !expectedFiles.test(file));
  check('tarball contains only expected package and build files', unexpectedFiles.length === 0);
  if (unexpectedFiles.length) console.error(`Unexpected package file count: ${unexpectedFiles.length}`);

  const app = path.join(work, 'app');
  mkdirSync(path.join(app, 'src'), { recursive: true });
  const v = versions();
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    name: 'mivo-dv-clean-consumer',
    private: true,
    type: 'module',
    scripts: { build: 'tsc --noEmit && vite build' },
    dependencies: { '@mihawksolutions/dicom-viewer': `file:${tarball.replaceAll('\\', '/')}`, react: v.react, 'react-dom': v.reactDom },
    devDependencies: { vite: v.vite, '@vitejs/plugin-react': v.pluginReact, typescript: v.typescript, '@types/react': v.typesReact, '@types/react-dom': v.typesReactDom, '@types/node': v.typesNode },
  }, null, 2));
  writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({
    // skipLibCheck is off on purpose so the package's published declarations are checked.
    compilerOptions: { target: 'ES2022', lib: ['ES2023', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: false, noEmit: true, types: ['vite/client', 'node'] },
    include: ['src', 'vite.config.ts'],
  }, null, 2));
  writeFileSync(path.join(app, 'vite.config.ts'), [
    "import { mivoDicomViewer } from '@mihawksolutions/dicom-viewer/vite';",
    "import react from '@vitejs/plugin-react';",
    "import { defineConfig } from 'vite';",
    '',
    `export default defineConfig({ base: '${base}', plugins: [react(), mivoDicomViewer()] });`,
    '',
  ].join('\n'));
  writeFileSync(path.join(app, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><link rel="icon" href="data:," /><title>consumer</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n');
  writeFileSync(path.join(app, 'src', 'main.tsx'), [
    "import '@mihawksolutions/dicom-viewer/styles.css';",
    "import { DEFAULT_CODEC_BASE_PATH, DicomViewer, type DicomViewerHandle, type ViewerLayout, type ViewerState } from '@mihawksolutions/dicom-viewer';",
    "import { useRef, useState } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    '',
    'function App() {',
    '  const ref = useRef<DicomViewerHandle>(null);',
    "  const [status, setStatus] = useState('idle');",
    '  const onState = (state: ViewerState) => setStatus(`${state.phase} (${state.layout})`);',
    '  const setLayout = (layout: ViewerLayout) => ref.current?.setLayout(layout);',
    '  return <>',
    '    <button onClick={() => setLayout("2d")}>Host 2D</button>',
    '    <button onClick={() => setLayout("3d")}>Host 3D</button>',
    '    <button onClick={() => ref.current?.cancel()}>Host cancel</button>',
    '    <button onClick={() => ref.current?.clear()}>Host reset</button>',
    '    <output aria-label="Viewer state">{status}</output>',
    '    <div style={{ height: "90vh" }}>',
    '      <DicomViewer ref={ref} onStateChange={onState}',
    '        codecBasePath={import.meta.env.BASE_URL + DEFAULT_CODEC_BASE_PATH.slice(1)} />',
    '    </div>',
    '  </>;',
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
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(([, url]) => url)
    .filter((url) => !url.startsWith('data:'));
  check('HTML references emitted assets under the Vite base', assetUrls.length >= 2 && assetUrls.every((url) => url.startsWith(base) && out.includes(url.slice(base.length))));
  for (const codec of ['openjpegwasm_decode.wasm', 'charlswasm_decode.wasm', 'libjpegturbowasm_decode.wasm', 'openjphjs.wasm', 'jpegxlwasm_decode.wasm']) {
    check(`build emits mivo-dicom-viewer/codecs/${codec}`, out.includes(`mivo-dicom-viewer/codecs/${codec}`));
  }
  check('build emits the decode worker', out.some((f) => /decodeImageFrameWorker.*\.js$/.test(f)));
  check('build emits viewer CSS', out.some((f) => f.endsWith('.css') && readFileSync(path.join(dist, f), 'utf8').includes('.mivo-dv')));
  check('Cornerstone is code-split from the entry chunk', out.some((f) => /cornerstoneRenderer.*\.js$/.test(f)));
  check('3D volume code is a separate lazy chunk', out.some((f) => /cornerstoneVolumeRenderer.*\.js$/.test(f)));
} finally {
  if (keep) console.log(`\nConsumer files kept at: ${work}\nFrom the app folder, run npx vite preview and open ${base}`);
  else rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nClean consumer smoke test passed.');
