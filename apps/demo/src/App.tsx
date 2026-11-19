import {
  DEFAULT_CODEC_BASE_PATH,
  DicomWorkstation,
  type DicomWorkstationHandle,
} from '@mihawksolutions/dicom-workstation';
import { useEffect, useRef, useState } from 'react';

const headPaths = Array.from({ length: 48 }, (_, index) => `head/ct-${String(index + 1).padStart(3, '0')}.dcm`);

const samples = [
  {
    name: 'Everything',
    detail: 'All samples at once in a 2 × 2 grid: compare series side by side, link them, and try 3D.',
    paths: ['dental.dcm', 'dental-jpeg2000.dcm', ...headPaths],
    grid: { rows: 2, columns: 2 },
  },
  {
    name: 'Head CT',
    detail: 'Scroll through 48 slices, try the Brain, Bones and Auto presets, then switch to 3D / MPR.',
    paths: headPaths,
    grid: { rows: 1, columns: 1 },
  },
  {
    name: 'Dental radiograph',
    detail: 'Measure lengths and angles, invert, rotate and use Auto contrast.',
    paths: ['dental.dcm'],
    grid: { rows: 1, columns: 1 },
  },
  {
    name: 'JPEG 2000 radiograph',
    detail: 'The same dental phantom encoded as lossless JPEG 2000.',
    paths: ['dental-jpeg2000.dcm'],
    grid: { rows: 1, columns: 1 },
  },
];

type Theme = 'dark' | 'light';

export function App() {
  const workstation = useRef<DicomWorkstationHandle>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('mihawk-demo-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('mihawk-demo-theme', theme);
    } catch {
      // Storage unavailable.
    }
  }, [theme]);

  async function loadSample(sample: (typeof samples)[number]) {
    const controller = new AbortController();
    request.current = controller;
    setLoading(sample.name);
    setError('');
    try {
      const files = await Promise.all(sample.paths.map(async (path) => {
        const response = await fetch(`${import.meta.env.BASE_URL}samples/${path}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Sample unavailable');
        return new File([await response.blob()], path.split('/').pop()!, { type: 'application/dicom' });
      }));
      if (controller.signal.aborted) return;
      picker.current?.close();
      workstation.current?.setGrid(sample.grid);
      void workstation.current?.openFiles(files);
    } catch {
      if (!controller.signal.aborted) {
        controller.abort();
        setError('The sample could not be downloaded. Please try again.');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(undefined);
      }
    }
  }

  return (
    <main className="demo">
      <DicomWorkstation
        ref={workstation}
        codecBasePath={import.meta.env.BASE_URL + DEFAULT_CODEC_BASE_PATH.slice(1)}
        maxVolumeBytes={256 * 1024 * 1024}
        theme={theme}
        title="Mihawk DICOM Viewer"
        headerEnd={
          <div className="demo-header-end">
            <button type="button" className="demo-button" onClick={() => picker.current?.showModal()}>
              Samples
            </button>
            <button
              type="button"
              className="demo-button demo-icon-button"
              aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        }
      />
      <dialog ref={picker} className="demo-picker" aria-labelledby="sample-title"
        onClose={() => {
          request.current?.abort();
          request.current = null;
          setLoading(undefined);
          setError('');
        }}>
        <header>
          <h2 id="sample-title">Sample studies</h2>
          <button type="button" className="demo-button" onClick={() => picker.current?.close()}>Close</button>
        </header>
        <p>These synthetic studies contain no patient data.</p>
        {samples.map((sample) => (
          <button className="demo-button demo-sample" key={sample.name} type="button"
            disabled={Boolean(loading)} onClick={() => void loadSample(sample)}>
            <strong>{sample.name}</strong>
            <span>{sample.detail}</span>
          </button>
        ))}
        {loading && <p role="status">Downloading {loading}…</p>}
        {error && <p role="alert">{error}</p>}
      </dialog>
    </main>
  );
}
