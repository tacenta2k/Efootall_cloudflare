# Google authentication and tournament restoration verification

Implemented without schema changes, new dependencies, or changes to the league/knockout engine. Tournament data remains in PostgreSQL. Supabase browser storage is used for auth sessions only; the existing recent-links cache remains optional navigation history.

## Changes

- Google OAuth through Supabase, using PKCE, persistent sessions, automatic refresh and automatic callback detection/exchange.
- Explicit auth loading state, callback-denial feedback, and database-backed My Tournaments with Continue, Create Tournament, multiple rooms and retry on loading failure.
- Owner-only listing uses the Supabase user verified server-side. Creation never takes ownership from client fields; initialization/callbacks never create tournaments.
- Public links remain readable without login, including when an attached session has been revoked. Mutation and audit authorization remain enforced on the server; existing RLS/privileges remain unchanged.
- Each copy click attempts Clipboard API, then a selected-text fallback. Failed copies show the public URL; successful copies show confirmation. No auth query/hash values are shared.
- All existing knockout formats, seeding, legs, aggregates, deciders and separate league draw/penalty-points behavior are preserved.

## Exact files changed

| File                               | Change                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| `.env.example`                     | Confirmed project URL and existing scope guidance               |
| `README.md`                        | Google, session, ownership and deployment setup                 |
| `VERIFICATION.md`                  | This verification report                                        |
| `playwright.config.ts`             | Mobile profile uses Android Pixel 7 emulation                   |
| `server/api.ts`                    | Authenticated owner listing; revoked-token public read fallback |
| `server/store.ts`                  | Parameterized owner-filtered tournament summaries               |
| `src/App.tsx`                      | Auth initialization and callback/account routing                |
| `src/components/Auth.tsx`          | Google sign-in UI                                               |
| `src/components/MyTournaments.tsx` | Database-backed tournament selection (new)                      |
| `src/components/Dashboard.tsx`     | Copy fallback integration and status clearing                   |
| `src/lib/api.ts`                   | Owner-list API and summary type                                 |
| `src/lib/auth.ts`                  | Supabase Google PKCE initiation and explicit session options    |
| `src/lib/clipboard.ts`             | Clipboard and selected-text fallback helper (new)               |
| `src/lib/supabaseConfig.ts`        | Deployment preflight requires Google provider                   |
| `tests/api.test.ts`                | Ownership/list/create/revoked-session authorization             |
| `tests/auth.test.ts`               | Google initiation, persistence options and errors               |
| `tests/authConfig.test.ts`         | Google provider preflight                                       |
| `tests/browser/app.spec.ts`        | Sign-in entry and repeated copy paths                           |
| `tests/browser/auth.spec.ts`       | OAuth, restoration, refresh, logout and list states             |
| `tests/netlify.test.ts`            | Invalid-token rejection on protected audit route                |
| `tests/store.integration.test.ts`  | Real database multiple-room ownership round-trip                |

**Migrations:** none added or changed. Neither `database/` nor `supabase/migrations/` was modified. The linked integration test applies the existing league-penalties migration inside its rollback transaction; this does not deploy a migration or leave test data behind.

## Results

Results recorded on 2026-09-28 against the final implementation.

| Check              | Command / result                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated suite    | `npm test`: **189 passed, 1 skipped**, 8 test files passed; skipped opt-in linked database test ran separately                                                                                                                                                                                        |
| Real database      | `PES_VERIFY_LINKED_DB=1 node_modules/.bin/node --env-file=.env node_modules/vitest/vitest.mjs run tests/store.integration.test.ts`: **1 passed**, 36.07 seconds; settings, avatars/players, fixtures, shootouts, owner filtering and two rooms verified; transaction rolled back                      |
| Browser suite      | `npm run test:e2e`: **58 passed** in 3.3 minutes: **29 desktop + 29 Android Pixel 7 emulation**, zero failures                                                                                                                                                                                        |
| TypeScript         | `npx tsc --noEmit`: passed; also included in production build                                                                                                                                                                                                                                         |
| Formatting         | `npm run format:check`: passed                                                                                                                                                                                                                                                                        |
| Lint               | Not configured; no lint script or linter dependency                                                                                                                                                                                                                                                   |
| Production bundle  | `npm run build`: passed with confirmed existing project configuration; Vite 6.4.3, 1663 modules, 9.55 seconds                                                                                                                                                                                         |
| Netlify-mode build | `NETLIFY=true npm run build`: **blocked as intended** with “Enable the Supabase Google authentication provider before deploying Google sign-in.”                                                                                                                                                      |
| Security           | Targeted scan of 67 tracked/new source and bundle files checked against actual server credential/password values, non-anon JWTs, private-key patterns and database connection strings; no findings. No `.env`/`.env.save` tracked or present in Git history. No new secrets or credentials committed. |

The first completed browser run had 55 passes and one Android auth test blocked by the browser reporting offline; tests now explicitly set network state and cover offline sign-in separately. The initial sandbox database run failed DNS; the authorized network-enabled retry passed. Initial browser attempts could not start the local server in the sandbox, then lacked Chromium. The pinned Playwright Chromium was installed and the entire suite rerun. These setup failures are not counted as successful verification.

The browser suite uses mocked Supabase/API endpoints for auth and tournament data, with the actual Supabase browser SDK and real React UI. Clipboard tests include the actual browser Clipboard API as well as controlled failure/fallback paths. A new browser context with saved storage verifies the persistence path; this is not a physical browser restart or a live Google login. Mobile tests use Chromium Android emulation, not physical Android or Safari.

## Confirmed production configuration and remaining setup

The project owner corrected the originally supplied hostname to **`https://agyevuhestarzxatpzzd.supabase.co`**. Existing browser/server environment URLs already match it; `.env` was not changed. The earlier 21-character hostname failed validation and DNS and must not be used.

Read-only checks against the confirmed project returned Auth settings HTTP 200 with **Google disabled**. The existing production `/api/health` returned HTTP 200 with `configured: true`; that is configuration validation, not proof of OAuth or a database transaction. No hosted settings or production deployment were changed.

1. In Google Cloud, configure the consent screen/audience, create a **Web application** OAuth client and add `https://pes-tournament.netlify.app` as its authorized JavaScript origin.
2. Add the exact Google authorized redirect URI **`https://agyevuhestarzxatpzzd.supabase.co/auth/v1/callback`**.
3. In Supabase Authentication → Sign In / Providers → Google, enable Google and enter the Google client ID and client secret. Keep the secret in Supabase only. Publish the Google consent app for the intended audience, or explicitly allow test users during testing.
4. Supabase Authentication → URL Configuration: Site URL **`https://pes-tournament.netlify.app`**; allowlisted Redirect URL **`https://pes-tournament.netlify.app/auth/callback`**.
5. Netlify **Builds scope**: `VITE_SUPABASE_URL=https://agyevuhestarzxatpzzd.supabase.co` and `VITE_SUPABASE_ANON_KEY` from that project. **Functions scope**: `SUPABASE_URL` with the same URL, `SUPABASE_ANON_KEY` with the same public key, and the server-only transaction-pooler `DATABASE_URL`. No service-role key is required.
6. Keep build command `npm run build`, publish directory `dist`, functions directory `netlify/functions`, Node 22. Redeploy after configuring Google and verifying environment scopes. Existing Netlify SPA routing supports the callback and tournament deep links.

See [Supabase's Google OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-google) and the project README for setup details.

## Remaining manual checks and limitations

- Complete real Google consent/callback on the final Netlify deployment. Verify a new account can create two rooms and that the same account can continue both later.
- Close/reopen a physical desktop and Android browser, including next-day token refresh. Supabase expiry/revocation and browser privacy/storage rules can legitimately require reauthentication.
- With two accounts, verify owner writes succeed and non-owner writes return 403; anonymously open a shared link and verify reads and live updates while writes return 401.
- Verify repeated copying on physical Android and iOS/Safari. When both browser copy mechanisms reject, the app displays the public URL for manual copying.
- Unsaved wizard inputs are not stored across full OAuth navigation. The normal home flow authenticates before the wizard; persisted tournaments always come from the database.
- Existing league shootout policy is unchanged: no special points allocation is invented. A tied league result with draws disabled remains blocked until an explicit points policy is configured. Existing UI does not select such a policy; the settings JSON/API hook remains supported.
- Every existing room is public to people who hold its link; no private-room feature was added. Owner identifiers and audit snapshots are excluded from public responses.

**Not production-ready yet:** Google is disabled on the confirmed Supabase project, and real Google authentication on the deployed application has not been tested. Enable/configure the provider and complete the live checks before deployment acceptance.
