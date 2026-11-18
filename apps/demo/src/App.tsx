import {
  DicomViewer,
  defaultLabels,
  type DicomViewerHandle,
  type DicomViewerLabels,
  type ViewerState,
} from '@mivo-labs/dicom-viewer';
import { useCallback, useRef, useState } from 'react';

/** Synthetic sample sets served from ../../fixtures (no patient data). */
const SAMPLES: Record<string, string[]> = {
  'Intraoral (3 encodings)': [
    'synthetic/single/intraoral-explicit-le.dcm',
    'synthetic/codecs/intraoral-jpeg2000-lossless.dcm',
    'synthetic/codecs/intraoral-jpegls-lossless.dcm',
  ],
  'CT stack (12 slices)': Array.from(
    { length: 12 },
    (_, index) => `synthetic/stack/ct-${String(index + 1).padStart(3, '0')}.dcm`,
  ),
  'CT with damaged slice 4': Array.from(
    { length: 6 },
    (_, index) => `synthetic/damaged-stack/ct-${String(index + 1).padStart(3, '0')}.dcm`,
  ),
  'Invalid files': ['synthetic/invalid/not-dicom.txt', 'synthetic/invalid/truncated-pixel-data.dcm'],
};

const frenchLabels: Partial<DicomViewerLabels> = {
  viewerRegion: 'Visionneuse DICOM',
  openFiles: 'Ouvrir des fichiers',
  openFolder: 'Ouvrir un dossier',
  clear: "Fermer l'examen",
  cancel: 'Annuler',
  dropZoneTitle: 'Ouvrir des fichiers DICOM',
  dropZoneHint: 'Déposez des fichiers ou un dossier ici, ou utilisez les boutons ci-dessus.',
  privacyNote: 'Les fichiers sont lus dans ce navigateur et ne sont pas envoyés.',
  studiesHeading: 'Examens',
  seriesList: 'Séries',
  imageCount: (count) => (count === 1 ? '1 image' : `${count} images`),
  scanning: (processed, total) => `Lecture des fichiers… ${processed} sur ${total}`,
  loadingSeries: 'Chargement des images…',
  skippedFiles: (count) => (count === 1 ? '1 fichier ignoré.' : `${count} fichiers ignorés.`),
  errors: {
    ...defaultLabels.errors,
    NO_DICOM_FILES: 'Aucune image DICOM trouvée dans les fichiers sélectionnés.',
  },
};

interface LogEntry {
  id: number;
  time: string;
  text: string;
}

export function App() {
  const viewerRef = useRef<DicomViewerHandle>(null);
  const [files, setFiles] = useState<File[] | undefined>();
  const [locale, setLocale] = useState<'en' | 'fr'>('en');
  const [phase, setPhase] = useState<ViewerState['phase']>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);

  // Logs only counts and codes: never file names or DICOM values.
  const addLog = useCallback((text: string) => {
    setLog((entries) =>
      [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), text }, ...entries].slice(0, 50),
    );
  }, []);

  const loadSample = async (name: string) => {
    const paths = SAMPLES[name] ?? [];
    const loaded = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
        return new File([await response.blob()], path.split('/').pop() ?? 'sample.dcm');
      }),
    );
    setFiles(loaded);
  };

  return (
    <div className="demo">
      <header className="demo-header">
        <div>
          <h1>@mivo-labs/dicom-viewer</h1>
          <p>Development demo · local files only · phase: <code data-testid="phase">{phase}</code></p>
        </div>
        <div className="demo-actions">
          {Object.keys(SAMPLES).map((name) => (
            <button key={name} type="button" onClick={() => void loadSample(name)}>
              Sample: {name}
            </button>
          ))}
          <button type="button" onClick={() => viewerRef.current?.clear()}>
            Simulate logout (clear)
          </button>
          <label>
            Labels{' '}
            <select value={locale} onChange={(event) => setLocale(event.target.value as 'en' | 'fr')}>
              <option value="en">English (default)</option>
              <option value="fr">Français</option>
            </select>
          </label>
        </div>
      </header>

      <main className="demo-main">
        <div className="demo-viewer">
          <DicomViewer
            ref={viewerRef}
            files={files}
            labels={locale === 'fr' ? frenchLabels : undefined}
            onStateChange={(state) => setPhase(state.phase)}
            onStudiesLoaded={(studies) =>
              addLog(`studies loaded: ${studies.length} study, ${studies.reduce((n, s) => n + s.series.length, 0)} series`)
            }
            onSeriesDisplayed={(series) => addLog(`series displayed: ${series.imageCount} images`)}
            onError={(error) => {
              addLog(`error: ${error.code}`);
              // Development aid only. The cause comes from the decoder and holds no file names.
              if (import.meta.env.DEV) console.error('[demo] viewer error cause', error.cause);
            }}
          />
        </div>
        <aside className="demo-log" aria-label="Event log">
          <h2>Events</h2>
          <ol>
            {log.map((entry) => (
              <li key={entry.id}>
                <time>{entry.time}</time> {entry.text}
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}
