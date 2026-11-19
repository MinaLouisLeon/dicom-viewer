/**
 * Viewport grid of the workstation: rows and columns, optionally with one large
 * primary cell spanning the whole first row (`top`) or first column (`left`).
 */
export interface GridLayout {
  rows: number;
  columns: number;
  primary?: 'top' | 'left';
}

/** Grid presets offered by the layout selector, in menu order. */
export const GRID_LAYOUTS: readonly GridLayout[] = [
  { rows: 1, columns: 1 },
  { rows: 2, columns: 1 },
  { rows: 1, columns: 2 },
  { rows: 3, columns: 1 },
  { rows: 1, columns: 3 },
  { rows: 2, columns: 2, primary: 'top' },
  { rows: 2, columns: 2, primary: 'left' },
  { rows: 2, columns: 2 },
  { rows: 2, columns: 3 },
  { rows: 3, columns: 2 },
  { rows: 3, columns: 3 },
];

export const MAX_GRID_SIZE = 4;

export const gridId = ({ rows, columns, primary }: GridLayout): string =>
  `${rows}x${columns}${primary ? `-${primary}` : ''}`;

export const sameGrid = (a: GridLayout, b: GridLayout): boolean => gridId(a) === gridId(b);

/** Number of cells a grid holds (a primary cell takes a whole row or column). */
export function cellCount({ rows, columns, primary }: GridLayout): number {
  if (primary === 'top') return 1 + (rows - 1) * columns;
  if (primary === 'left') return 1 + rows * (columns - 1);
  return rows * columns;
}

/** Parses `"2x3"` or `"2x2-top"`-style ids. Returns undefined for anything else. */
export function parseGrid(value: string): GridLayout | undefined {
  const match = /^(\d)x(\d)(?:-(top|left))?$/.exec(value.trim());
  if (!match) return undefined;
  return clampGrid({ rows: Number(match[1]), columns: Number(match[2]), primary: match[3] as GridLayout['primary'] });
}

export function clampGrid({ rows, columns, primary }: GridLayout): GridLayout {
  const clamp = (value: number) => Math.min(MAX_GRID_SIZE, Math.max(1, Math.round(value) || 1));
  const grid: GridLayout = { rows: clamp(rows), columns: clamp(columns) };
  // A primary cell needs a second row (top) or column (left) to sit beside.
  if (primary === 'top' && grid.rows > 1 && grid.columns > 1) grid.primary = 'top';
  if (primary === 'left' && grid.columns > 1 && grid.rows > 1) grid.primary = 'left';
  return grid;
}

/**
 * Arrangement of the panes in a cell that shows a series in 3D (MPR). Each
 * arrangement has slots; which plane fills each slot is chosen per pane.
 */
export type MprLayout = 'grid' | 'primaryTop' | 'primaryLeft' | 'row' | 'single';

/** MPR arrangements offered by the layout selector, in menu order. */
export const MPR_LAYOUTS: readonly MprLayout[] = ['grid', 'primaryTop', 'primaryLeft', 'row', 'single'];

/** Number of panes each MPR arrangement shows. */
export const MPR_SLOTS: Record<MprLayout, number> = { grid: 4, primaryTop: 3, primaryLeft: 4, row: 3, single: 1 };
