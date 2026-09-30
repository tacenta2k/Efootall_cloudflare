import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const clients = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('postgres', () => ({ default: clients.create }));
import worker, { type Env } from '../worker';
import { withCloudflareBindings, serverEnv } from '../server/config';
import { db, withRequestDatabase } from '../server/store';
const env = (name = 'one'): Env => ({
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  HYPERDRIVE: { connectionString: `postgres://test:placeholder@${name}.invalid/test` },
  ASSETS: { fetch: vi.fn(async () => new Response('SPA')) },
});
beforeEach(() => {
  clients.create.mockReset();
  clients.create.mockImplementation(() => ({ end: vi.fn().mockResolvedValue(undefined) }));
});
afterEach(() => vi.unstubAllEnvs());
it('isolates overlapping requests and reuses a client only within its request', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withCloudflareBindings(env('one'), () =>
    withRequestDatabase(async () => {
      const sql = db();
      await gate;
      expect(db()).toBe(sql);
      expect(serverEnv('DATABASE_URL')).toContain('one.invalid');
      return sql;
    }),
  );
  const second = await withCloudflareBindings(env('two'), () =>
    withRequestDatabase(async () => {
      const sql = db();
      expect(db()).toBe(sql);
      expect(serverEnv('DATABASE_URL')).toContain('two.invalid');
      return sql;
    }),
  );
  expect(second.end).toHaveBeenCalledOnce();
  release();
  const firstClient = await first;
  expect(firstClient).not.toBe(second);
  expect(firstClient.end).toHaveBeenCalledOnce();
  expect(clients.create).toHaveBeenCalledTimes(2);
  expect(clients.create.mock.calls[0][1]).toMatchObject({
    max: 2,
    prepare: false,
    fetch_types: false,
  });
  expect(clients.create.mock.calls[0][1]).not.toHaveProperty('ssl');
});
it('closes the client when request processing fails', async () => {
  const end = vi.fn().mockResolvedValue(undefined);
  clients.create.mockReturnValue({ end });
  await expect(
    withCloudflareBindings(env(), () =>
      withRequestDatabase(async () => {
        db();
        throw new Error('request failed');
      }),
    ),
  ).rejects.toThrow('request failed');
  expect(end).toHaveBeenCalledWith({ timeout: 1 });
});
it('does not mask a committed response when client cleanup fails', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  clients.create.mockReturnValue({ end: vi.fn().mockRejectedValue(new Error('close failed')) });
  try {
    await expect(
      withCloudflareBindings(env(), () =>
        withRequestDatabase(async () => {
          db();
          return 'committed';
        }),
      ),
    ).resolves.toBe('committed');
  } finally {
    warn.mockRestore();
  }
});
it('refuses a Cloudflare database call outside request scope', () => {
  expect(() => withCloudflareBindings(env(), () => db())).toThrow(
    'DATABASE_REQUEST_SCOPE_REQUIRED',
  );
  expect(clients.create).not.toHaveBeenCalled();
});
it('serves API health without opening a database connection or leaking bindings', async () => {
  const bindings = env();
  const response = await worker.fetch(new Request('https://site.example/api/health'), bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    configured: true,
    checks: { authentication: true, database: true },
    errors: [],
  });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(clients.create).not.toHaveBeenCalled();
  expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
});
it('fails closed for missing Hyperdrive even when a Node database URL exists', async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:placeholder@fallback.invalid/test');
  const bindings = env();
  delete bindings.HYPERDRIVE;
  const response = await worker.fetch(new Request('https://site.example/api/health'), bindings);
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(body).toContain('HYPERDRIVE');
  expect(body).not.toContain('placeholder');
  expect(clients.create).not.toHaveBeenCalled();
});
it('does not inherit process auth variables when Worker bindings are missing', async () => {
  vi.stubEnv('SUPABASE_URL', env().SUPABASE_URL!);
  vi.stubEnv('SUPABASE_ANON_KEY', env().SUPABASE_ANON_KEY!);
  const bindings = env();
  delete bindings.SUPABASE_URL;
  delete bindings.SUPABASE_ANON_KEY;
  expect(
    (await worker.fetch(new Request('https://site.example/api/health'), bindings)).status,
  ).toBe(503);
});
it.each(['/api', '/api/unknown', '/api/tournaments'])(
  'keeps %s in the API, not the SPA',
  async (path) => {
    const bindings = env();
    const response = await worker.fetch(new Request(`https://site.example${path}`), bindings);
    expect(response.status).toBe(path === '/api/tournaments' ? 401 : 404);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  },
);
it.each(['/auth/callback', '/t/EFC-ABCDEFGH', '/create', '/apiary'])(
  'delegates %s to static assets',
  async (path) => {
    const bindings = env();
    const request = new Request(`https://site.example${path}`);
    expect(await (await worker.fetch(request, bindings)).text()).toBe('SPA');
    expect(bindings.ASSETS.fetch).toHaveBeenCalledWith(request);
    expect(clients.create).not.toHaveBeenCalled();
  },
);
