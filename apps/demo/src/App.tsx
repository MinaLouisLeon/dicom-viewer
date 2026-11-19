import {
  DEFAULT_CODEC_BASE_PATH,
  DicomViewer,
  type DicomViewerHandle,
  type ViewerState,
} from '@mihawksolutions/dicom-viewer';
import { useEffect, useRef, useState } from 'react';

const samples = [
  {
    name: 'Dental radiograph',
    detail: 'Compare enamel, roots, and fine detail with zoom and window/level.',
    paths: ['dental.dcm'],
  },
  {
    name: 'Head CT',
    detail: 'Scroll through 48 slices, then switch to 3D for linked cross-sections.',
    paths: Array.from({ length: 48 }, (_, index) => `head/ct-${String(index + 1).padStart(3, '0')}.dcm`),
  },
  {
    name: 'JPEG 2000 radiograph',
    detail: 'View the same dental phantom encoded as lossless JPEG 2000.',
    paths: ['dental-jpeg2000.dcm'],
  },
];

const volumePanes = [
  ['axial', 'Axial'],
  ['sagittal', 'Sagittal'],
  ['coronal', 'Coronal'],
  ['volume', '3D view'],
] as const;

export function App() {
  const viewer = useRef<DicomViewerHandle>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const viewerArea = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState('');
  const [state, setState] = useState<ViewerState>();
  const [seriesOpen, setSeriesOpen] = useState(false);

  useEffect(() => () => request.current?.abort(), []);

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
      void viewer.current?.openFiles(files);
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
    <main className={seriesOpen ? 'demo demo-series-open' : 'demo'}>
      <header className="demo-header">
        <h1>DICOM Viewer</h1>
        <div className="demo-actions">
          {Boolean(state?.studies.length) && (
            <button className="demo-series-toggle" type="button" aria-expanded={seriesOpen}
              onClick={() => setSeriesOpen(!seriesOpen)}>Series</button>
          )}
          <button type="button" onClick={() => {
            setSeriesOpen(false);
            picker.current?.showModal();
          }}>Try a sample</button>
        </div>
      </header>
      <div ref={viewerArea} className="demo-viewer" onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('.mivo-dv-series')) {
          setSeriesOpen(false);
        }
      }}>
        <DicomViewer
          ref={viewer}
          codecBasePath={import.meta.env.BASE_URL + DEFAULT_CODEC_BASE_PATH.slice(1)}
          maxVolumeBytes={256 * 1024 * 1024}
          onStateChange={setState}
        />
      </div>
      {state?.phase === 'displayed' && state.layout === '3d' && (
        <nav className="demo-volume-nav" aria-label="Volume views">
          {volumePanes.map(([view, label]) => (
            <button key={view} type="button" onClick={() => {
              const pane = viewerArea.current?.querySelector<HTMLElement>(`.mivo-dv-pane[data-view="${view}"]`);
              pane?.scrollIntoView({ block: 'nearest', inline: 'start' });
            }}>{label}</button>
          ))}
        </nav>
      )}
      <dialog ref={picker} className="demo-picker" aria-labelledby="sample-title"
        onClose={() => {
          request.current?.abort();
          request.current = null;
          setLoading(undefined);
          setError('');
        }}>
        <header>
          <h2 id="sample-title">Sample studies</h2>
          <button type="button" onClick={() => picker.current?.close()}>Close</button>
        </header>
        <p>These synthetic studies contain no patient data.</p>
        {samples.map((sample) => (
          <button className="demo-sample" key={sample.name} type="button"
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
