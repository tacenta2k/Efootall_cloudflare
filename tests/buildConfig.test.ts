import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const env = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock('vite', async (original) => ({
  ...(await original<typeof import('vite')>()),
  loadEnv: () => env.values,
}));
import config from '../vite.config';
const buildConfig = () => {
  if (typeof config !== 'function') throw new Error('Expected Vite config factory');
  return config({ command: 'build', mode: 'production' });
};
beforeEach(() => {
  env.values = {
    VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_test',
  };
});
it('accepts valid public production configuration', async () => {
  expect(await buildConfig()).toBeTruthy();
});
it('stops the observed unreachable deployed hostname during a Netlify build', async () => {
  vi.stubEnv('NETLIFY', 'true');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  env.values.VITE_SUPABASE_URL = 'https://agyevuehestarxatpzzd.supabase.co';
  await expect(buildConfig()).rejects.toThrow('Cannot reach');
});
it('stops missing browser configuration at build time', async () => {
  delete env.values.VITE_SUPABASE_ANON_KEY;
  await expect(buildConfig()).rejects.toThrow('Builds');
});
it('rejects database credentials exposed under a browser prefix', async () => {
  env.values.VITE_DATABASE_URL = 'private';
  await expect(buildConfig()).rejects.toThrow('Private credentials');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
