import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ otp: vi.fn(), client: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
  vi.stubEnv('PROD', true);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', {
    origin: 'https://cup.netlify.app',
    pathname: '/create',
    protocol: 'https:',
  });
  mocks.client.mockReturnValue({ auth: { signInWithOAuth: mocks.otp } });
  mocks.otp.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('starts Google OAuth through Supabase with the HTTPS callback', async () => {
  const { signInWithGoogle } = await import('../src/lib/auth');
  await signInWithGoogle();
  expect(mocks.otp).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: 'https://cup.netlify.app/auth/callback' },
  });
});
it.each([
  [new TypeError('Failed to fetch'), 'Unable to reach Supabase'],
  [
    { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
    'Unable to reach Supabase',
  ],
  [{ status: 429 }, 'Too many sign-in'],
  [{ status: 401 }, 'public API key'],
  [{ status: 500 }, 'Google provider'],
])('explains auth failures without reporting success (%s)', async (error, message) => {
  mocks.otp.mockResolvedValue({ error });
  const { signInWithGoogle } = await import('../src/lib/auth');
  await expect(signInWithGoogle()).rejects.toThrow(message as string);
});
it('handles thrown network errors too', async () => {
  mocks.otp.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect((await import('../src/lib/auth')).signInWithGoogle()).rejects.toThrow(
    'Unable to reach',
  );
});
it('does not initialize auth or send a request with missing/invalid configuration', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://short.supabase.co');
  const { auth, signInWithGoogle } = await import('../src/lib/auth');
  expect(auth).toBeNull();
  expect(mocks.client).not.toHaveBeenCalled();
  await expect(signInWithGoogle()).rejects.toThrow('project reference');
});
it('blocks offline requests and insecure production redirects', async () => {
  const { signInWithGoogle } = await import('../src/lib/auth');
  vi.stubGlobal('navigator', { onLine: false });
  await expect(signInWithGoogle()).rejects.toThrow('offline');
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { protocol: 'http:' });
  await expect(signInWithGoogle()).rejects.toThrow('HTTPS');
  expect(mocks.otp).not.toHaveBeenCalled();
});

it('explicitly persists and refreshes sessions and detects PKCE callbacks', async () => {
  await import('../src/lib/auth');
  expect(mocks.client.mock.calls[0][2].auth).toEqual({
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  });
});
