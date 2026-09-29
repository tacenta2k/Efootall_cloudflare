import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from './supabaseConfig';

const config = supabaseConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  'VITE_',
  import.meta.env.PROD,
);
export const authConfigurationError = config.error;
// Capture callback denial before the SDK cleans OAuth parameters from the URL.
export const oauthCallbackError =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('error') ||
    new URLSearchParams(window.location.hash.slice(1)).has('error'))
    ? 'Google sign-in was not completed. Please try again.'
    : '';
export const wasAuthCallback =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('code') ||
    new URLSearchParams(window.location.hash.slice(1)).has('access_token'));
export const auth =
  config.error === null
    ? createClient(config.url, config.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) }),
        },
      })
    : null;

export function signInError(error: unknown): string {
  const e = error as { status?: number; message?: string; name?: string; code?: string } | null;
  if (e?.status === 429 || e?.code === 'over_email_send_rate_limit')
    return 'Too many sign-in requests. Wait a few minutes before trying again.';
  if (e?.status === 401 || e?.status === 403)
    return 'Supabase rejected the sign-in request. The site owner should verify the public API key, Google provider, and signup settings.';
  if ((e?.status && e.status >= 500) || e?.code === 'unexpected_failure')
    return 'The sign-in service is temporarily unavailable. Try again later; the site owner should check Supabase Auth logs and Google provider configuration.';
  if (
    e?.name === 'AbortError' ||
    e?.name === 'TimeoutError' ||
    e?.name === 'AuthRetryableFetchError' ||
    /fetch|network|load failed/i.test(e?.message ?? '')
  )
    return 'Unable to reach Supabase sign-in. Check your connection. If this persists, the site owner should verify VITE_SUPABASE_URL, the project status, and the site’s Content Security Policy, then redeploy.';
  return e?.message || 'Unable to start Google sign-in. Please try again.';
}

export async function signInWithGoogle(): Promise<void> {
  if (!auth) throw new Error(authConfigurationError ?? 'Sign-in is not configured.');
  if (!navigator.onLine) throw new Error('You are offline. Reconnect before signing in.');
  if (import.meta.env.PROD && location.protocol !== 'https:')
    throw new Error('Open the deployed HTTPS site before signing in.');
  try {
    const { error } = await auth.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/auth/callback' },
    });
    if (error) throw error;
  } catch (error) {
    throw new Error(signInError(error));
  }
}
