import { throwIfAborted } from '@mihawksolutions/dicom-viewer/internal';

/**
 * Opens ZIP archives in the browser. Nothing is uploaded: the archive is read from the
 * local file, entries are listed from its central directory (so streamed archives with
 * data descriptors and ZIP64 archives work), stored entries become slices of the original
 * file without copying, and deflated entries are inflated with the browser's built-in
 * `DecompressionStream`.
 */

/** Why an archive, or some of its entries, could not be opened. */
export type ArchiveIssueReason =
  /** Not a readable ZIP (damaged or truncated). */
  | 'unreadable'
  /** Entries are password protected. */
  | 'encrypted'
  /** Entries use a compression method other than stored or deflate. */
  | 'unsupported-compression'
  /** The browser cannot inflate deflated entries. */
  | 'unsupported-browser'
  /** The archive holds more data or entries than the configured limits. */
  | 'too-large';

export interface ArchiveIssue {
  reason: ArchiveIssueReason;
  /** Number of entries affected (1 for archive-wide problems). */
  count: number;
}

export interface ArchiveLimits {
  /** Largest total uncompressed size read from archives. @default 4 GiB */
  maxBytes?: number;
  /** Most entries read from archives. @default 100000 */
  maxEntries?: number;
  /** How deep archives inside archives are opened. @default 2 */
  maxDepth?: number;
}

export interface ExpandOptions extends ArchiveLimits {
  signal?: AbortSignal;
  /** Called as archives are read; values are bytes of archive input processed. */
  onProgress?: (processed: number, total: number) => void;
}

export interface ExpandResult {
  /** The selection with every archive replaced by its files, in path order. */
  files: Blob[];
  /** Number of archives that were opened. */
  archives: number;
  issues: ArchiveIssue[];
}

export const DEFAULT_ARCHIVE_LIMITS: Required<ArchiveLimits> = {
  maxBytes: 4 * 1024 ** 3,
  maxEntries: 100_000,
  maxDepth: 2,
};

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END = 0x06064b50;
const MAX_COMMENT = 0xffff;
const CHUNK = 4 * 1024 * 1024;

const readRange = async (blob: Blob, start: number, end: number): Promise<DataView> =>
  new DataView(await blob.slice(start, end).arrayBuffer());

const u64 = (view: DataView, offset: number): number =>
  view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;

/**
 * True when a file is a ZIP archive: it starts with a ZIP signature and is not a DICOM
 * Part 10 file (whose 128-byte preamble could, in theory, start with the same bytes).
 */
export async function isZipArchive(file: Blob): Promise<boolean> {
  if (file.size < 22) return false;
  const bytes = new Uint8Array(await file.slice(0, 132).arrayBuffer());
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
  const dicom = bytes.length >= 132 && bytes[128] === 0x44 && bytes[129] === 0x49 && bytes[130] === 0x43 && bytes[131] === 0x4d;
  return zip && !dicom;
}

export interface ZipEntry {
  /** Path inside the archive, with `/` separators. */
  path: string;
  method: number;
  encrypted: boolean;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

class ZipFormatError extends Error {}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try {
    // Many tools write UTF-8 without setting the flag.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Names in old archives are CP437; Latin-1 keeps ASCII paths intact.
    return new TextDecoder('latin1').decode(bytes);
  }
}

/** Lists the entries of a ZIP archive from its central directory. */
export async function listZipEntries(zip: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, zip.size - (MAX_COMMENT + 22));
  const tail = await readRange(zip, tailStart, zip.size);
  let end = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (tail.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new ZipFormatError('No end of central directory');

  let entryCount = tail.getUint16(end + 10, true);
  let directorySize = tail.getUint32(end + 12, true);
  let directoryOffset = tail.getUint32(end + 16, true);

  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    // ZIP64: the locator sits just before the classic end record.
    const locatorAt = end - 20;
    if (locatorAt < 0 || tail.getUint32(locatorAt, true) !== ZIP64_LOCATOR) throw new ZipFormatError('Missing ZIP64 locator');
    const zip64EndOffset = u64(tail, locatorAt + 8);
    const zip64End = await readRange(zip, zip64EndOffset, zip64EndOffset + 56);
    if (zip64End.getUint32(0, true) !== ZIP64_END) throw new ZipFormatError('Bad ZIP64 end record');
    entryCount = u64(zip64End, 32);
    directorySize = u64(zip64End, 40);
    directoryOffset = u64(zip64End, 48);
  }
  if (directoryOffset + directorySize > zip.size) throw new ZipFormatError('Central directory outside the file');

  const directory = await readRange(zip, directoryOffset, directoryOffset + directorySize);
  const bytes = new Uint8Array(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== CENTRAL_HEADER) {
      throw new ZipFormatError('Bad central directory entry');
    }
    const flags = directory.getUint16(at + 8, true);
    const method = directory.getUint16(at + 10, true);
    let compressedSize = directory.getUint32(at + 20, true);
    let size = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let localHeaderOffset = directory.getUint32(at + 42, true);
    const nameStart = at + 46;
    const path = decodeName(bytes.subarray(nameStart, nameStart + nameLength), (flags & 0x0800) !== 0).replaceAll('\\', '/');

    // ZIP64 extra field: only the values stored as 0xFFFFFFFF are present, in this order.
    let extra = nameStart + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) { size = u64(directory, field); field += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(directory, field); field += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = u64(directory, field); }
      }
      extra += 4 + length;
    }

    entries.push({ path, method, encrypted: (flags & 0x0001) !== 0, compressedSize, size, localHeaderOffset });
    at = extraEnd + commentLength;
  }
  return entries;
}

/** Entries that are folders or operating-system clutter rather than content. */
export function isIgnoredEntry(path: string): boolean {
  if (path.endsWith('/')) return true;
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? '';
  return parts.includes('__MACOSX') || name.startsWith('._') || name === '.DS_Store' || name.toLowerCase() === 'thumbs.db' || name === 'desktop.ini';
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A readable stream of a Blob, read in chunks (works where `Blob.stream` is missing). */
function blobStream(blob: Blob): ReadableStream<Uint8Array> {
  let position = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (position >= blob.size) {
        controller.close();
        return;
      }
      const next = Math.min(blob.size, position + CHUNK);
      const chunk = new Uint8Array(await blob.slice(position, next).arrayBuffer());
      position = next;
      controller.enqueue(chunk);
    },
  });
}

/** Reads one entry's data. Stored entries are slices of the archive; deflated ones are inflated. */
async function extractEntry(zip: Blob, entry: ZipEntry, signal: AbortSignal | undefined): Promise<Blob> {
  const header = await readRange(zip, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (header.getUint32(0, true) !== LOCAL_HEADER) throw new ZipFormatError('Bad local header');
  const dataStart = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const compressed = zip.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;

  const inflated = blobStream(compressed).pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = inflated.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    // Guard against archives that lie about their sizes.
    if (length > entry.size + 1024) {
      await reader.cancel();
      throw new ZipFormatError('Entry larger than declared');
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[]);
}

const canInflate = () => typeof DecompressionStream === 'function' && (() => {
  try {
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
})();

function addIssue(issues: ArchiveIssue[], reason: ArchiveIssueReason, count = 1): void {
  const existing = issues.find((issue) => issue.reason === reason);
  if (existing) existing.count += count;
  else issues.push({ reason, count });
}

/**
 * Replaces every ZIP archive in a selection with the files it contains (archives inside
 * archives too, up to `maxDepth`). Other files pass through unchanged and in place.
 * Problems are reported as issues instead of failing the whole selection.
 */
export async function expandArchives(files: readonly Blob[], options: ExpandOptions = {}): Promise<ExpandResult> {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options };
  const { signal, onProgress } = options;
  const issues: ArchiveIssue[] = [];
  let archives = 0;
  let totalBytes = 0;
  let totalEntries = 0;

  const flags = await Promise.all(files.map((file) => isZipArchive(file).catch(() => false)));
  if (!flags.some(Boolean)) return { files: [...files], archives: 0, issues };
  const inputTotal = files.reduce((sum, file, index) => sum + (flags[index] ? file.size : 0), 0);
  let inputDone = 0;
  onProgress?.(0, inputTotal);

  const open = async (zip: Blob, depth: number, weight: number): Promise<Blob[]> => {
    throwIfAborted(signal);
    archives += 1;
    let entries: ZipEntry[];
    try {
      entries = await listZipEntries(zip);
    } catch (error) {
      throwIfAborted(signal);
      if (!(error instanceof ZipFormatError) && !(error instanceof RangeError)) throw error;
      addIssue(issues, 'unreadable');
      return [];
    }
    const content = entries.filter((entry) => !isIgnoredEntry(entry.path)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    const out: Blob[] = [];
    const share = content.length ? weight / content.length : 0;
    for (const entry of content) {
      throwIfAborted(signal);
      if (entry.encrypted) {
        addIssue(issues, 'encrypted');
        continue;
      }
      if (entry.method !== 0 && entry.method !== 8) {
        addIssue(issues, 'unsupported-compression');
        continue;
      }
      if (entry.method === 8 && !canInflate()) {
        addIssue(issues, 'unsupported-browser');
        continue;
      }
      if (totalEntries + 1 > limits.maxEntries || totalBytes + entry.size > limits.maxBytes) {
        addIssue(issues, 'too-large', content.length - content.indexOf(entry));
        break;
      }
      totalEntries += 1;
      totalBytes += entry.size;
      let data: Blob;
      try {
        data = await extractEntry(zip, entry, signal);
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        addIssue(issues, 'unreadable');
        continue;
      }
      inputDone += share;
      onProgress?.(Math.min(inputTotal, Math.round(inputDone)), inputTotal);
      if (depth < limits.maxDepth && (await isZipArchive(data).catch(() => false))) {
        inputDone -= share;
        out.push(...(await open(data, depth + 1, share)));
        continue;
      }
      out.push(new File([data], baseName(entry.path), { type: '' }));
    }
    return out;
  };

  const result: Blob[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (flags[index]) result.push(...(await open(file, 1, file.size)));
    else result.push(file);
  }
  onProgress?.(inputTotal, inputTotal);
  return { files: result, archives, issues };
}
