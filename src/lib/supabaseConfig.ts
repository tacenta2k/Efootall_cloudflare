export type SupabaseConfig =
  | { url: string; key: string; error: null }
  | { url: null; key: null; error: string };

/** Netlify build preflight: validate reachability/key without initiating sign-in. */
export async function checkAuthEndpoint(config: SupabaseConfig): Promise<void> {
  if (config.error !== null) throw new Error(config.error);
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.key },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      'Cannot reach the configured Supabase Auth endpoint. Copy the exact VITE_SUPABASE_URL from the project dashboard, check project availability, and retry the Netlify build.',
    );
  }
  if (!response.ok)
    throw new Error(
      `Supabase Auth configuration check returned HTTP ${response.status}. Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY belong to the same active project.`,
    );
  let settings;
  try {
    settings = await response.json();
  } catch {
    throw new Error('Supabase Auth returned an invalid settings response. Verify the project URL.');
  }
  if (settings.external?.google !== true)
    throw new Error(
      'Enable the Supabase Google authentication provider before deploying Google sign-in.',
    );
}

/** Validate public credentials without ever including their values in errors. */
export function supabaseConfig(
  rawUrl: string | undefined,
  rawKey: string | undefined,
  prefix = 'VITE_',
  production = true,
): SupabaseConfig {
  const invalid = (error: string): SupabaseConfig => ({ url: null, key: null, error });
  const urlName = `${prefix}SUPABASE_URL`,
    keyName = `${prefix}SUPABASE_ANON_KEY`;
  if (!rawUrl?.trim() || !rawKey?.trim())
    return invalid(
      `Sign-in is not configured. Set ${urlName} and ${keyName} in Netlify's ${prefix ? 'Builds' : 'Functions'} scope, then redeploy.`,
    );
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return invalid(
      `${urlName} must be the Supabase project URL copied from the project dashboard.`,
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (production && local) ||
    (url.protocol !== 'https:' && !(local && !production && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    return invalid(
      `${urlName} must be an HTTPS project origin, without an API path, credentials, or query string. Localhost is only allowed during local development.`,
    );
  if (url.hostname.endsWith('.supabase.co') && !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname))
    return invalid(
      `${urlName} has an invalid Supabase project reference. Copy the exact project URL from Supabase and redeploy.`,
    );
  const key = rawKey.trim();
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      publicKey = payload.role === 'anon';
      if (
        publicKey &&
        payload.ref &&
        url.hostname.endsWith('.supabase.co') &&
        url.hostname !== `${payload.ref}.supabase.co`
      )
        return invalid(`${urlName} and ${keyName} belong to different Supabase projects.`);
    } catch {
      /* Invalid public key. */
    }
  }
  if (!publicKey)
    return invalid(
      `${keyName} must be a public publishable or anon key from the same Supabase project. Secret and service-role keys are not allowed.`,
    );
  return { url: url.origin, key, error: null };
}
