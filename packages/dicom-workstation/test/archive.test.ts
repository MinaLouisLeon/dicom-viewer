import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { expandArchives, isIgnoredEntry, isZipArchive, listZipEntries } from '../src/archive';
import { FIXTURES_DIR, fixtureFile, fixturePaths } from './fixtures';
import { buildZip, zipFile } from './zipBuilder';

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());
const fixtureBytes = (relative: string) => new Uint8Array(readFileSync(path.join(FIXTURES_DIR, relative)));

describe('isZipArchive', () => {
  it('recognises archives but not DICOM files or short files', async () => {
    expect(await isZipArchive(zipFile(buildZip([{ path: 'a.txt', data: 'hello' }])))).toBe(true);
    expect(await isZipArchive(fixtureFile('stack/ct-001.dcm'))).toBe(false);
    expect(await isZipArchive(new File(['PK'], 'x.zip'))).toBe(false);
    // A DICOM file whose preamble happens to start like a ZIP is still DICOM.
    const dicom = fixtureBytes('single/intraoral-explicit-le.dcm');
    dicom.set([0x50, 0x4b, 0x03, 0x04], 0);
    expect(await isZipArchive(new File([dicom as BlobPart], 'x.dcm'))).toBe(false);
  });
});

describe('listZipEntries', () => {
  it('reads the central directory, including streamed (data descriptor) and ZIP64 archives', async () => {
    for (const options of [{}, { zip64: true }]) {
      const bytes = buildZip(
        [
          { path: 'dir/one.txt', data: 'first', method: 0 },
          { path: 'dir/two.txt', data: 'second'.repeat(100), dataDescriptor: true },
        ],
        { ...options, comment: 'archive comment' },
      );
      const entries = await listZipEntries(zipFile(bytes));
      expect(entries.map((entry) => [entry.path, entry.method, entry.size])).toEqual([
        ['dir/one.txt', 0, 5],
        ['dir/two.txt', 8, 600],
      ]);
    }
  });

  it('rejects files that are not complete archives', async () => {
    const bytes = buildZip([{ path: 'a.txt', data: 'hello' }]);
    await expect(listZipEntries(zipFile(bytes.slice(0, bytes.length - 30)))).rejects.toThrow();
  });
});

describe('isIgnoredEntry', () => {
  it('skips folders and operating-system clutter', () => {
    for (const ignored of ['dir/', '__MACOSX/a/._b', 'x/._image', '.DS_Store', 'a/Thumbs.db', 'desktop.ini']) {
      expect(isIgnoredEntry(ignored)).toBe(true);
    }
    expect(isIgnoredEntry('data/abc/1')).toBe(false);
    expect(isIgnoredEntry('IMAGES/IM0001.dcm')).toBe(false);
  });
});

describe('expandArchives', () => {
  it('passes selections without archives through unchanged', async () => {
    const files = [fixtureFile('stack/ct-001.dcm'), fixtureFile('stack/ct-002.dcm')];
    const result = await expandArchives(files);
    expect(result.files).toEqual(files);
    expect(result).toMatchObject({ archives: 0, issues: [] });
  });

  it('replaces an archive with its files, in path order, in place', async () => {
    const zip = zipFile(
      buildZip([
        { path: 'study/IM10', data: 'ten', method: 0 },
        { path: 'study/IM2', data: 'two' },
        { path: 'study/', data: '', method: 0 },
        { path: '__MACOSX/study/._IM2', data: 'junk', method: 0 },
        { path: 'study/IM1', data: 'one', dataDescriptor: true },
      ]),
    );
    const before = new File(['before'], 'before.txt');
    const progress: number[] = [];
    const result = await expandArchives([before, zip], { onProgress: (processed) => progress.push(processed) });
    expect(result.archives).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.files[0]).toBe(before);
    expect(await Promise.all(result.files.slice(1).map(text))).toEqual(['one', 'two', 'ten']);
    expect((result.files[1] as File).name).toBe('IM1');
    expect(progress.at(-1)).toBe(zip.size);
  });

  it('extracts real DICOM files that the scanner can read', async () => {
    const paths = fixturePaths('stack').slice(0, 4);
    const zip = zipFile(buildZip(paths.map((relative, index) => ({ path: `export/${index}`, data: fixtureBytes(relative), method: index % 2 ? 8 : 0 }))));
    const { files } = await expandArchives([zip]);
    expect(files).toHaveLength(4);
    for (const [index, file] of files.entries()) {
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(fixtureBytes(paths[index]!));
    }
  });

  it('opens archives inside archives up to the depth limit', async () => {
    const inner = buildZip([{ path: 'inner.txt', data: 'inside' }]);
    const outer = zipFile(buildZip([{ path: 'nested.zip', data: inner, method: 0 }, { path: 'top.txt', data: 'top' }]));
    const deep = await expandArchives([outer]);
    expect(await Promise.all(deep.files.map(text))).toEqual(['inside', 'top']);
    expect(deep.archives).toBe(2);
    const shallow = await expandArchives([outer], { maxDepth: 1 });
    expect(shallow.files).toHaveLength(2);
    expect(await isZipArchive(shallow.files[0]!)).toBe(true);
  });

  it('reports encrypted, unsupported, damaged and oversized content without failing the rest', async () => {
    const zip = zipFile(
      buildZip([
        { path: 'ok.txt', data: 'fine' },
        { path: 'secret.txt', data: 'locked', method: 0, encrypted: true },
        { path: 'bzip2.bin', data: 'x', method: 12 },
      ]),
    );
    const broken = zipFile(buildZip([{ path: 'a', data: 'a' }]).slice(0, 40), 'broken.zip');
    const result = await expandArchives([zip, broken]);
    expect(await Promise.all(result.files.map(text))).toEqual(['fine']);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { reason: 'encrypted', count: 1 },
        { reason: 'unsupported-compression', count: 1 },
        { reason: 'unreadable', count: 1 },
      ]),
    );

    const many = zipFile(buildZip(Array.from({ length: 5 }, (_, index) => ({ path: `f${index}`, data: 'abcdef' }))));
    const limited = await expandArchives([many], { maxEntries: 3 });
    expect(limited.files).toHaveLength(3);
    expect(limited.issues).toEqual([{ reason: 'too-large', count: 2 }]);
    const bytesLimited = await expandArchives([many], { maxBytes: 13 });
    expect(bytesLimited.files).toHaveLength(2);
  });

  it('stops when the operation is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const zip = zipFile(buildZip([{ path: 'a', data: 'a' }]));
    await expect(expandArchives([zip], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
