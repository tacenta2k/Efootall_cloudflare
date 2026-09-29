import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAuthEndpoint, supabaseConfig } from '../src/lib/supabaseConfig';
import { databaseConfigured, serverAuthConfig, serverEnv } from '../server/config';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
const key = 'sb_publishable_example';
const jwt = (role: string, ref = 'abcdefghijklmnopqrst') =>
  `e30.${btoa(JSON.stringify({ role, ref }))}.signature`;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('checks the Auth endpoint without an OTP request or private credentials', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ external: { google: true } }), { status: 200 }),
    );
  vi.stubGlobal('fetch', fetcher);
  await checkAuthEndpoint(supabaseConfig(url, key));
  expect(fetcher.mock.calls[0][0]).toBe(`${url}/auth/v1/settings`);
  expect(fetcher.mock.calls[0][1].headers).toEqual({ apikey: key });
  expect(fetcher.mock.calls[0][1].method).toBeUndefined();
});
it.each([401, 403, 503])(
  'reports Auth preflight HTTP %s without echoing the key',
  async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(checkAuthEndpoint(supabaseConfig(url, key))).rejects.toThrow(`HTTP ${status}`);
  },
);
it('rejects disabled Google sign-in in the deployment preflight', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ external: { google: false } }))),
  );
  await expect(checkAuthEndpoint(supabaseConfig(url, key))).rejects.toThrow(
    'Enable the Supabase Google',
  );
});
describe('Supabase public configuration', () => {
  it.each([undefined, ''])('explains missing browser configuration (%s)', (value) => {
    expect(supabaseConfig(value, key).error).toContain('Builds');
    expect(supabaseConfig(url, value).error).toContain('VITE_SUPABASE_ANON_KEY');
  });
  it.each([
    'not a url',
    'https://short.supabase.co',
    'http://localhost:54321',
    'https://localhost',
    'http://example.com',
    `${url}/auth/v1`,
    `${url}?key=secret`,
    'https://user:password@example.com',
  ])('rejects invalid production origin %s', (value) => {
    expect(supabaseConfig(value, key).error).toBeTruthy();
  });
  it.each(['YOUR_PUBLIC_ANON_KEY', 'sb_secret_private', jwt('service_role')])(
    'rejects placeholders/private keys without echoing them',
    (value) => {
      const config = supabaseConfig(url, value);
      expect(config.error).toBeTruthy();
      expect(JSON.stringify(config)).not.toContain(value);
    },
  );
  it('accepts publishable and legacy anon keys, and detects mismatched JWT projects', () => {
    expect(supabaseConfig(url, key).error).toBeNull();
    expect(supabaseConfig(url, jwt('anon')).error).toBeNull();
    expect(supabaseConfig(url, jwt('anon', 'different')).error).toContain('different');
    expect(supabaseConfig('http://localhost:54321', key, 'VITE_', false).error).toBeNull();
  });
});
it('reads Netlify runtime server variables and does not fall back to browser variables', () => {
  vi.stubEnv('SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_ANON_KEY', '');
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
  expect(serverAuthConfig().error).toContain('Functions');
  const values: Record<string, string> = {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: key,
    DATABASE_URL: 'postgresql://user:private@db.example.com:6543/postgres',
  };
  vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
  expect(serverAuthConfig().error).toBeNull();
  expect(serverEnv('DATABASE_URL')).toBe(values.DATABASE_URL);
  expect(databaseConfigured()).toBe(true);
});
it.each(['', 'not-a-url', 'https://db.example.com', 'postgresql://user@db.example.com/postgres'])(
  'rejects invalid database configuration %s',
  (value) => {
    vi.stubEnv('DATABASE_URL', value);
    expect(databaseConfigured()).toBe(false);
  },
);
