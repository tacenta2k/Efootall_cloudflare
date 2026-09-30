import { AsyncLocalStorage } from 'node:async_hooks';
import { supabaseConfig } from '../src/lib/supabaseConfig';

export interface CloudflareBindings {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  HYPERDRIVE?: { connectionString: string };
}
const bindings = new AsyncLocalStorage<CloudflareBindings>();
export const cloudflareBindings = () => bindings.getStore();
export function withCloudflareBindings<T>(env: CloudflareBindings, run: () => T): T {
  return bindings.run(env, run);
}

type Variable = 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'DATABASE_URL';
export function serverEnv(name: Variable): string | undefined {
  const env = bindings.getStore();
  if (env) return name === 'DATABASE_URL' ? env.HYPERDRIVE?.connectionString : env[name];
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
    Boolean(bindings.getStore()) || process.env.NETLIFY_DEV !== 'true',
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
