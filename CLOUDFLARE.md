# Cloudflare runtime

This copy serves the existing Vite build from `dist` and runs `/api` and `/api/*`
through `worker/index.ts`. Supabase remains the PostgreSQL, Auth, and Storage backend.
Netlify configuration and entry files are retained unchanged.

## Local verification

Use Node 22 (the project already includes it as a development dependency).

- `npm run typecheck`
- `npm test -- tests/cloudflare.test.ts tests/api.test.ts tests/authConfig.test.ts tests/netlify.test.ts tests/logoCleanup.test.ts tests/buildConfig.test.ts`
- `npm run build`
- `npm run check:cloudflare` bundles and validates the Worker without deploying.
- `npm run dev:cloudflare` builds the frontend and starts a local Workers runtime.

For local database testing, explicitly supply a disposable PostgreSQL connection via
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. Do not point automated
checks at production. Local Supabase Auth variables can be placed in ignored `.dev.vars`.
The browser still requires the two public Vite build variables below.

The Worker uses AsyncLocalStorage to isolate bindings and a lazily created PostgreSQL
client per request. All existing API and logo transactions share that request's client;
its connections are closed in `finally`. Hyperdrive maintains the origin pool. There
is no fallback to a process-level DATABASE_URL inside Worker requests. The existing
Netlify entry retains its original Node connection behavior.

## Configuration still required before any deployment

Nothing here creates Cloudflare or Supabase resources or configures real credentials.

1. Connect the private repository to a Worker named `efootall-cloudflare`, branch
   `main`, repository root. Use Node 22, build command `npm run build`, and deployment
   command `npx wrangler deploy` only when deployment is authorized.
2. Create a Hyperdrive configuration for the intended PostgreSQL database. For
   Supabase, use its direct connection endpoint and disable Hyperdrive query caching.
   Keep origin TLS enabled. Replace the all-zero placeholder ID in `wrangler.jsonc`.
   The binding must be named `HYPERDRIVE`. Store database credentials in Hyperdrive,
   never in this repository or browser variables.
3. Set build variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the public
   project URL and anon/publishable key. Set Worker runtime variables `SUPABASE_URL`
   and `SUPABASE_ANON_KEY` for that same project. No service-role key is needed.
   Production does not require a Worker `DATABASE_URL` secret.
4. Keep the existing schema, migrations, storage bucket, policies, and triggers in
   the selected database. This runtime adaptation does not apply migrations.
5. Allowlist the final HTTPS `/auth/callback` URL in Supabase Auth. Update Site URL
   if this becomes the primary site and add the new Google authorized JavaScript
   origin. Google's redirect URI remains the Supabase `/auth/v1/callback` URL.
6. Verify login, transactions, concurrent edits, and logo upload/cleanup against the
   intended backend before production use. Local mocks and bundle checks do not
   establish live database connectivity. `/api/health` checks configuration only.

Static security/cache headers are copied from the existing Netlify policy into
`public/_headers`. The Worker sets security headers on API responses and retains
`Cache-Control: no-store`. SPA fallback includes `/auth/callback` and tournament URLs.
The existing Vite build's network auth preflight remains Netlify-only; Cloudflare
builds still validate the public variable format but do not contact Supabase.
