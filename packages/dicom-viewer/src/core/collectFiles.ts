/**
 * Collects files from a drop, walking dropped folders recursively.
 * Uses the File System Entries API where the browser provides it.
 */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null));

  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Array.from(dataTransfer.files ?? []);
  }

  const files: File[] = [];
  for (const entry of entries) {
    if (entry) await collectEntry(entry, files);
  }
  return files;
}

async function collectEntry(entry: FileSystemEntry, files: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    files.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches; keep reading until an empty batch.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await collectEntry(child, files);
    }
  }
}

/** Stable, natural ordering by relative path so selection order is deterministic. */
export function sortByPath<T extends File>(files: readonly T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const key = (file: File) => file.webkitRelativePath || file.name;
  return [...files].sort((a, b) => collator.compare(key(a), key(b)));
}
