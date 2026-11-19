import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Vitest runs from the package directory.
export const FIXTURES_DIR = path.resolve(process.cwd(), '../../fixtures/synthetic');

export function fixturePaths(relativeDir = ''): string[] {
  const dir = path.join(FIXTURES_DIR, relativeDir);
  return readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? fixturePaths(path.join(relativeDir, name)) : [path.join(relativeDir, name)];
    })
    .sort();
}

export function fixtureFile(relativePath: string): File {
  const bytes = readFileSync(path.join(FIXTURES_DIR, relativePath));
  return new File([bytes], path.basename(relativePath), { type: 'application/dicom' });
}
