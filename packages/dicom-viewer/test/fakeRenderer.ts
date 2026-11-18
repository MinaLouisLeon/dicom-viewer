import { vi, type Mock } from 'vitest';

import { abortError } from '../src/core/errors';
import type { CreateRenderer, StackImage, StackRenderer } from '../src/core/renderer';

export interface FakeRenderer extends StackRenderer {
  shown: StackImage[][];
  /** Resolves the most recent pending showStack call. */
  finish(): void;
  /** Rejects the most recent pending showStack call. */
  failWith(error: unknown): void;
  clear: Mock<() => void>;
  destroy: Mock<() => void>;
}

/** A renderer whose showStack calls stay pending until the test settles them. */
export function createFakeRenderer(options: { autoFinish?: boolean } = {}): {
  renderer: FakeRenderer;
  createRenderer: Mock<CreateRenderer>;
} {
  let pending: { resolve: () => void; reject: (error: unknown) => void } | undefined;
  const renderer: FakeRenderer = {
    shown: [],
    showStack: (images, signal) =>
      new Promise<void>((resolve, reject) => {
        renderer.shown.push([...images]);
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
        if (options.autoFinish) resolve();
        else pending = { resolve, reject };
      }),
    finish: () => pending?.resolve(),
    failWith: (error) => pending?.reject(error),
    clear: vi.fn<() => void>(),
    destroy: vi.fn<() => void>(),
  };
  const createRenderer = vi.fn<CreateRenderer>(async () => renderer);
  return { renderer, createRenderer };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
