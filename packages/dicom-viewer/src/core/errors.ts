/** Stable error codes. Messages shown to users come from translatable labels. */
export type DicomViewerErrorCode =
  | 'NO_DICOM_FILES'
  | 'FILE_READ_FAILED'
  | 'RENDERER_INIT_FAILED'
  | 'IMAGE_LOAD_FAILED'
  | 'UNSUPPORTED_IMAGE'
  /** The series cannot be assembled into a volume (see `SeriesSummary.volume.reason`). */
  | 'VOLUME_UNSUPPORTED'
  /** One or more slices failed to decode, so the volume would be incomplete. */
  | 'VOLUME_LOAD_FAILED'
  /** The decoded volume would exceed the memory this viewer allows, or allocation failed. */
  | 'VOLUME_TOO_LARGE';

export class DicomViewerError extends Error {
  readonly code: DicomViewerErrorCode;

  constructor(code: DicomViewerErrorCode, options?: { cause?: unknown }) {
    // Message is the code only: never include file names or DICOM values, so errors are safe to log.
    super(code, options);
    this.name = 'DicomViewerError';
    this.code = code;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError();
  }
}

export function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}
