/** Viewport grid of the workstation: how many cells, in rows and columns. */
export interface GridLayout {
  rows: number;
  columns: number;
}

/** Grid presets offered by the layout selector, in menu order. */
export const GRID_LAYOUTS: readonly GridLayout[] = [
  { rows: 1, columns: 1 },
  { rows: 1, columns: 2 },
  { rows: 2, columns: 1 },
  { rows: 2, columns: 2 },
  { rows: 1, columns: 3 },
  { rows: 3, columns: 1 },
  { rows: 2, columns: 3 },
  { rows: 3, columns: 2 },
  { rows: 3, columns: 3 },
];

export const MAX_GRID_SIZE = 4;

export const gridId = ({ rows, columns }: GridLayout): string => `${rows}x${columns}`;

/** Parses `"2x3"`-style ids. Returns undefined for anything else. */
export function parseGrid(value: string): GridLayout | undefined {
  const match = /^(\d)x(\d)$/.exec(value.trim());
  if (!match) return undefined;
  const rows = Number(match[1]);
  const columns = Number(match[2]);
  return clampGrid({ rows, columns });
}

export function clampGrid({ rows, columns }: GridLayout): GridLayout {
  const clamp = (value: number) => Math.min(MAX_GRID_SIZE, Math.max(1, Math.round(value) || 1));
  return { rows: clamp(rows), columns: clamp(columns) };
}

/**
 * Arrangement of the panes inside a cell that shows a series in 3D (multiplanar
 * reconstruction). The four panes are axial, sagittal and coronal cross-sections plus
 * the rotatable volume.
 */
export type MprLayout =
  | 'grid'
  | 'axialPrimary'
  | 'volumePrimary'
  | 'planes'
  | 'axial'
  | 'sagittal'
  | 'coronal'
  | 'volume';

/** MPR arrangements offered by the layout selector, in menu order. */
export const MPR_LAYOUTS: readonly MprLayout[] = [
  'grid',
  'axialPrimary',
  'volumePrimary',
  'planes',
  'axial',
  'sagittal',
  'coronal',
  'volume',
];
