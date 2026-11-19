import { vi } from 'vitest';

import { abortError } from '../src/core/errors';
import type { StackImage } from '../src/core/renderer';
import {
  IDENTITY_TRANSFORM,
  type CellStatus,
  type CreateGridRenderer,
  type GridRenderer,
  type GridRendererCallbacks,
} from '../src/workstation/gridRenderer';

export interface FakeGridRenderer extends GridRenderer {
  shown: Map<string, StackImage[]>;
  statuses: Map<string, CellStatus>;
  attached: Set<string>;
  emit(cellId: string, patch: Partial<CellStatus>): void;
}

/** A grid renderer that "displays" stacks immediately and records every call. */
export function createFakeGridRenderer(): { renderer: FakeGridRenderer; createGridRenderer: CreateGridRenderer } {
  let callbacks: GridRendererCallbacks = {};
  const statuses = new Map<string, CellStatus>();
  const update = (cellId: string, patch: Partial<CellStatus>) => {
    const current = statuses.get(cellId);
    if (!current) return;
    const next = { ...current, ...patch };
    statuses.set(cellId, next);
    callbacks.onCellChange?.(cellId, next);
  };
  const renderer: FakeGridRenderer = {
    shown: new Map(),
    statuses,
    attached: new Set(),
    emit: update,
    attachCell: vi.fn((cellId: string) => {
      renderer.attached.add(cellId);
    }),
    detachCell: vi.fn((cellId: string) => {
      renderer.attached.delete(cellId);
      statuses.delete(cellId);
    }),
    showStack: vi.fn(async (cellId: string, images: readonly StackImage[], signal: AbortSignal) => {
      if (signal.aborted) throw abortError();
      renderer.shown.set(cellId, [...images]);
      const imageCount = images.reduce((sum, image) => sum + image.numberOfFrames, 0);
      statuses.set(cellId, { imageIndex: 0, imageCount, windowWidth: 400, windowCenter: 40, zoom: 1, imageFailed: false, ...IDENTITY_TRANSFORM });
    }),
    clearCell: vi.fn((cellId: string) => {
      statuses.delete(cellId);
    }),
    setTool: vi.fn(),
    setImageIndex: vi.fn((cellId: string, index: number) => {
      const status = statuses.get(cellId);
      if (status) update(cellId, { imageIndex: Math.max(0, Math.min(status.imageCount - 1, index)) });
    }),
    scrollBy: vi.fn((cellId: string, delta: number, wrap?: boolean) => {
      const status = statuses.get(cellId);
      if (!status) return;
      let next = status.imageIndex + delta;
      next = wrap ? ((next % status.imageCount) + status.imageCount) % status.imageCount : Math.max(0, Math.min(status.imageCount - 1, next));
      update(cellId, { imageIndex: next });
    }),
    zoomBy: vi.fn(),
    panBy: vi.fn(),
    adjustWindowLevel: vi.fn(),
    setWindow: vi.fn((cellId: string, request) => {
      if (typeof request === 'object') update(cellId, { windowWidth: request.width, windowCenter: request.center });
      else if (request === 'auto') update(cellId, { windowWidth: 1234, windowCenter: 567 });
      else update(cellId, { windowWidth: 400, windowCenter: 40 });
      return true;
    }),
    setTransform: vi.fn((cellId: string, patch) => update(cellId, patch)),
    resetView: vi.fn((cellId: string) => update(cellId, { ...IDENTITY_TRANSFORM, windowWidth: 400, windowCenter: 40 })),
    getStatus: (cellId: string) => statuses.get(cellId),
    setSync: vi.fn(),
    setReferenceLines: vi.fn(),
    clearMeasurements: vi.fn(),
    measurementCount: () => 0,
    setAnnotationVisibility: vi.fn(),
    renderThumbnail: vi.fn(async () => 'data:image/png;base64,AAAA'),
    destroy: vi.fn(),
  };
  return {
    renderer,
    createGridRenderer: vi.fn(async (_config, cbs) => {
      callbacks = cbs ?? {};
      return renderer;
    }),
  };
}
