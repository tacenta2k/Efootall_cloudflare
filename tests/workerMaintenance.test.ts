import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), cleanup: vi.fn(), getUser: vi.fn() }));
vi.mock('postgres', () => ({ default: mocks.create }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('../server/logos', () => ({
  cleanupLogos: mocks.cleanup,
  reserveLogo: vi.fn(),
  retireDraft: vi.fn(),
}));
import worker, { type Env } from '../worker';
import { db } from '../server/store';
import { serverEnv } from '../server/config';
const env: Env = {
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  HYPERDRIVE: { connectionString: 'postgres://test:placeholder@maintenance.invalid/test' },
  ASSETS: { fetch: vi.fn() },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  mocks.create.mockImplementation(() => ({
    begin: async (fn: (sql: unknown) => unknown) => fn(vi.fn().mockResolvedValue([])),
    end: vi.fn().mockResolvedValue(undefined),
  }));
});
it('returns the list while waitUntil owns cleanup and its distinct database client', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleanupClient: ReturnType<typeof db> | undefined;
  mocks.cleanup.mockImplementation(async () => {
    expect(serverEnv('DATABASE_URL')).toBe(env.HYPERDRIVE!.connectionString);
    cleanupClient = db();
    await gate;
    expect(db()).toBe(cleanupClient);
  });
  const tasks: Promise<unknown>[] = [];
  const req = new Request('https://site.example/api/tournaments', {
    headers: { Authorization: 'Bearer test-token' },
  });
  try {
    const response = await worker.fetch(req, env, {
      waitUntil: (task) => {
        tasks.push(task);
      },
    });
    expect(await response.json()).toEqual({ tournaments: [] });
    expect(tasks).toHaveLength(1);
    expect(mocks.cleanup).toHaveBeenCalledWith('owner', req);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const mainClient = mocks.create.mock.results[0].value;
    expect(mainClient).not.toBe(cleanupClient);
    expect(mainClient.end).toHaveBeenCalledOnce();
    expect(cleanupClient!.end).not.toHaveBeenCalled();
  } finally {
    release();
    await Promise.all(tasks);
  }
  expect(cleanupClient!.end).toHaveBeenCalledWith({ timeout: 1 });
});
it('retains awaited cleanup when no managed execution context exists', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.cleanup.mockReturnValue(gate);
  let returned = false;
  const response = worker
    .fetch(
      new Request('https://site.example/api/tournaments', {
        headers: { Authorization: 'Bearer test-token' },
      }),
      env,
    )
    .then((r) => {
      returned = true;
      return r;
    });
  await vi.waitFor(() => expect(mocks.cleanup).toHaveBeenCalledOnce());
  expect(returned).toBe(false);
  release();
  expect((await response).status).toBe(200);
});
it('contains deferred failures without rejecting an already returned response', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const tasks: Promise<unknown>[] = [];
  mocks.cleanup.mockImplementation(async () => {
    db();
    throw new Error('maintenance failure');
  });
  try {
    const response = await worker.fetch(
      new Request('https://site.example/api/tournaments', {
        headers: { Authorization: 'Bearer test-token' },
      }),
      env,
      {
        waitUntil: (task) => {
          tasks.push(task);
        },
      },
    );
    expect(response.status).toBe(200);
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    expect(mocks.create.mock.results[1].value.end).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  } finally {
    warn.mockRestore();
  }
});
