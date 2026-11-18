import { readDicomHeader, type ReadRange, type UnsupportedReason } from './dicomHeader';
import { DicomViewerError, isAbortError, throwIfAborted } from './errors';
import { groupInstances, type LocalInstance, type LocalStudy } from './studyModel';

export type SkippedReason = 'not-dicom' | 'read-failed' | UnsupportedReason;

/** A file left out of the study list. Only the reason is kept, not the name or contents. */
export interface SkippedFile {
  selectionIndex: number;
  reason: SkippedReason;
}

export interface ScanResult {
  studies: LocalStudy[];
  skipped: SkippedFile[];
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** Number of headers read in parallel. */
  concurrency?: number;
  onProgress?: (processed: number, total: number) => void;
  readRange?: ReadRange;
}

/**
 * Reads the headers of locally selected files and groups the DICOM images into studies.
 * Throws `DicomViewerError('NO_DICOM_FILES')` when nothing displayable was found.
 */
export async function scanFiles(files: readonly Blob[], options: ScanOptions = {}): Promise<ScanResult> {
  const { signal, concurrency = 4, onProgress, readRange } = options;
  const instances: LocalInstance[] = [];
  const skipped: SkippedFile[] = [];
  let next = 0;
  let processed = 0;

  onProgress?.(0, files.length);

  const worker = async (): Promise<void> => {
    while (next < files.length) {
      throwIfAborted(signal);
      const selectionIndex = next++;
      const file = files[selectionIndex];
      if (!file) continue;
      try {
        const result = await readDicomHeader(file, { signal, readRange });
        if (result.kind === 'dicom') instances.push({ selectionIndex, file, header: result.header });
        else if (result.kind === 'not-dicom') skipped.push({ selectionIndex, reason: 'not-dicom' });
        else skipped.push({ selectionIndex, reason: result.reason });
      } catch (error) {
        if (isAbortError(error)) throw error;
        skipped.push({ selectionIndex, reason: 'read-failed' });
      }
      processed += 1;
      onProgress?.(processed, files.length);
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker);
  await Promise.all(workers);
  throwIfAborted(signal);

  skipped.sort((a, b) => a.selectionIndex - b.selectionIndex);
  if (instances.length === 0) {
    throw new DicomViewerError(
      skipped.length > 0 && skipped.every((item) => item.reason === 'read-failed')
        ? 'FILE_READ_FAILED'
        : 'NO_DICOM_FILES',
    );
  }
  return { studies: groupInstances(instances), skipped };
}
