import { supabaseConfig } from '../src/lib/supabaseConfig';

type Variable = 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'DATABASE_URL';
export function serverEnv(name: Variable): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Netlify?: { env?: { get(name: string): string | undefined } };
  };
  return runtime.Netlify?.env?.get(name) ?? process.env[name];
}
export const serverAuthConfig = () =>
  supabaseConfig(
    serverEnv('SUPABASE_URL'),
    serverEnv('SUPABASE_ANON_KEY'),
    '',
    process.env.NETLIFY_DEV !== 'true',
  );
export function databaseConfigured(): boolean {
  try {
    const url = new URL(serverEnv('DATABASE_URL') ?? '');
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      Boolean(url.hostname && url.username && url.password)
    );
  } catch {
    return false;
  }
}
