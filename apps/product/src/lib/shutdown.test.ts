import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closePool } = vi.hoisted(() => ({ closePool: vi.fn() }));

vi.mock('@/lib/db', () => ({ closeDatabasePool: closePool }));

import { registerShutdownHandlers } from './shutdown';

type Handler = () => void | Promise<void>;

function fakeProcess() {
  const handlers = new Map<string, Handler[]>();
  return {
    handlers,
    on(signal: string, handler: Handler) {
      handlers.set(signal, [...(handlers.get(signal) ?? []), handler]);
      return this;
    },
    async raise(signal: string) {
      for (const handler of handlers.get(signal) ?? []) await handler();
    },
    exitCode: undefined as number | undefined,
  };
}

beforeEach(() => {
  closePool.mockReset();
  closePool.mockResolvedValue(undefined);
});

describe('registerShutdownHandlers', () => {
  it('drains the connection pool on SIGTERM', async () => {
    const proc = fakeProcess();

    registerShutdownHandlers(proc as never);
    await proc.raise('SIGTERM');

    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('also handles SIGINT, so local development drains the same way', async () => {
    const proc = fakeProcess();

    registerShutdownHandlers(proc as never);
    await proc.raise('SIGINT');

    expect(closePool).toHaveBeenCalledTimes(1);
  });

  // Orchestrators frequently send SIGTERM more than once before SIGKILL. A
  // second drain would run against an already-ended pool and throw during
  // shutdown, turning a clean stop into a crash-looking one.
  it('drains once even when signalled repeatedly', async () => {
    const proc = fakeProcess();

    registerShutdownHandlers(proc as never);
    await proc.raise('SIGTERM');
    await proc.raise('SIGTERM');
    await proc.raise('SIGINT');

    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed drain prevent shutdown', async () => {
    closePool.mockRejectedValue(new Error('pool already ended'));
    const proc = fakeProcess();

    registerShutdownHandlers(proc as never);

    await expect(proc.raise('SIGTERM')).resolves.toBeUndefined();
  });
});
