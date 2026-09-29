vi.mock('../server/logos', () => ({
  cleanupLogos: vi.fn(),
  reserveLogo: vi.fn(),
  retireDraft: vi.fn(),
}));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../server/store', () => ({
  load: store.load,
  save: store.save,
  db: () => ({
    begin: async (...args: unknown[]) => (args.at(-1) as (tx: unknown) => unknown)({}),
  }),
}));
import handler from '../netlify/functions/api';
const url = 'https://abcdefghijklmnopqrst.supabase.co';
const key = 'sb_publishable_function_test';
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SUPABASE_URL', url);
  vi.stubEnv('SUPABASE_ANON_KEY', key);
  vi.stubEnv('DATABASE_URL', 'postgresql://admin:private-password@db.example.com/postgres');
  vi.stubGlobal('fetch', fetchMock);
  store.load.mockResolvedValue({
    owner: 'owner',
    t: { id: 't', code: 'EFC-ABCDEFGH', version: 1 },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const request = (path: string, token?: string) =>
  new Request(`https://cup.netlify.app${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
it.each(['/api/health', '/.netlify/functions/api/health'])(
  'serves the actual Netlify entry at %s without exposing credentials',
  async (path) => {
    const response = await handler(request(path));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      checks: { authentication: true, database: true },
      errors: [],
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DATABASE_URL'])(
  'reports missing Functions variable %s',
  async (name) => {
    vi.stubEnv(name, '');
    const response = await handler(request('/api/health'));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain(name);
    expect(body).toContain('Functions');
    expect(body).not.toContain('private-password');
    expect(body).not.toContain(key);
  },
);
it('validates protected requests with Supabase getUser using server credentials', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'owner' }), { status: 200 }));
  const response = await handler(
    request('/.netlify/functions/api/tournaments/EFC-ABCDEFGH', 'session-token'),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).canEdit).toBe(true);
  const [target, init] = fetchMock.mock.calls[0];
  expect(String(target)).toBe(`${url}/auth/v1/user`);
  const headers = new Headers(init.headers);
  expect(headers.get('apikey')).toBe(key);
  expect(headers.get('authorization')).toBe('Bearer session-token');
});
it('rejects invalid sessions for private audit access before accessing storage', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ msg: 'Invalid JWT', code: 'bad_jwt' }), { status: 401 }),
  );
  expect((await handler(request('/api/tournaments/EFC-ABCDEFGH/audit', 'bad'))).status).toBe(401);
  expect(store.load).not.toHaveBeenCalled();
});
it('returns 503 for authentication transport failures without bypassing verification', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  const response = await handler(request('/api/tournaments/EFC-ABCDEFGH', 'session'));
  expect(response.status).toBe(503);
  expect(store.load).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});
it('rejects a malformed server URL before any network or storage call', async () => {
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
  expect((await handler(request('/api/tournaments/EFC-ABCDEFGH', 'session'))).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(store.load).not.toHaveBeenCalled();
});
