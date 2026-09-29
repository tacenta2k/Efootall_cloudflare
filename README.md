# Touchline · E-Football Tournament Manager

A mobile-first tournament manager with a dark sports interface, real shared PostgreSQL storage, secure administrator authentication, automatic fixtures, standings, statistics and knockout progression. Built for friends running a competition from their phones.

**This is not a localStorage demo.** A Supabase project and Netlify Functions are required for creating or loading tournaments. In local development without configuration, the landing page and setup wizard work, but saving and administrator sign-in clearly report that the backend needs setup. Production builds require valid public Supabase configuration; Netlify builds also check Auth endpoint availability and the Google provider before publishing. No pretend tournaments or results are shown.

## Stack and architecture

- React 18 + TypeScript, Vite, custom responsive CSS and small Lucide SVG icons.
- Netlify Functions provide the only application data API.
- Supabase Auth verifies Google OAuth sessions on the server for every authenticated request.
- Supabase PostgreSQL stores normalized tournaments, players, matches, knockout ties and audit records.
- A shared pure TypeScript engine calculates results on the server and renders identical derived standings in the browser.
- Visible pages poll every 5 seconds; visibility changes and reconnection trigger immediate revalidation. Polls never cache tournament data in localStorage.
- Data writes lock the tournament row, check the authenticated owner and expected version, validate the action, write an audit snapshot, and commit normalized data in one transaction. Public multi-query reads use repeatable-read snapshots.
- All application tables have RLS enabled with **no permissive browser policies**. `anon` and `authenticated` are explicitly denied direct access. The server-only PostgreSQL connection handles database writes after authorization. Never expose this database password to the browser.

## Features

- Short, skippable CSS intro; reduced-motion support; lightweight CSS/SVG football artwork.
- Five-step wizard for 2–32 unique players with editable emoji avatars.
- 1–4 league matches per opponent, automatic round-robin schedules and internal byes.
- Custom league points, a separate league draw setting, and reorderable table tie-break rules.
- All four formats remain visible: league only; Top 2 → Final; Top 4 → Semi-finals → Final; Top 8 → Quarter-finals → Semi-finals → Final. Formats needing more players are disabled with an explanation. One or two legs, including the final.
- Standings, form, scoring/defence rankings, win rates and per-match statistics.
- Player profiles, filtered fixtures, fast score entry, confirmed editing and resets.
- Explicit league review before knockout qualification or league champion confirmation.
- Aggregate scores, separate penalties, extra-time indicator and configurable knockout deciders in all rounds; tied semi-finals and finals cannot advance without a winner.
- Public URLs, join codes, native sharing or clipboard fallback, recent tournament shortcuts.
- Authenticated admin tools, typed reset confirmations, audit history and optimistic concurrency checks.
- Connection status, loading/error/empty states, preserved inputs on failed saves, semantic forms and keyboard-accessible dialogs.

Optional PWA installation, QR codes, player photos, timers, live in-game tracking and comments are deliberately not implemented.

## Local development

Use Node **22** and npm. A Node 22 development dependency also supplies the required runtime to npm scripts in environments with an older system Node.

```sh
npm ci
cp .env.example .env
# Fill in .env using the configuration below.
npm install --global netlify-cli
npm run dev:full
```

Open the URL printed by Netlify Dev (normally `http://localhost:8888`). The full app needs this function-enabled server. `npm run dev` starts only Vite on port 5173 for frontend development. It does not emulate the backend; API actions report an unavailable-server error there.

```sh
npm run build       # Type-check browser, server and tests; output dist/
npm run preview     # Preview only the built static frontend
npm test            # Engine, API authorization and embedded PostgreSQL tests
npm run test:e2e:install # Install the Chromium build matching the pinned Playwright
npm run test:e2e     # Desktop and mobile browser tests with explicit API mocks
```

The committed lockfile pins dependencies. The browser test API fixtures are test-only; production code has no fake backend or seeded tournament.

Use Playwright's installed Chromium for verification. An arbitrary browser supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may not support Playwright's context lifecycle reliably; leave that override unset for the standard suite. Run the install command again after updating Playwright. Both commands use the project's Node runtime through npm.

## Environment variables

| Variable                 | Used by               | Description                                           |
| ------------------------ | --------------------- | ----------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Browser/build         | Supabase project URL                                  |
| `VITE_SUPABASE_ANON_KEY` | Browser/build         | Public Supabase publishable or anon key               |
| `SUPABASE_URL`           | Netlify Function      | Same Supabase project URL                             |
| `SUPABASE_ANON_KEY`      | Netlify Function      | Same public key, used to verify Auth tokens           |
| `DATABASE_URL`           | Netlify Function only | Supabase transaction-pooler PostgreSQL connection URL |

**Never prefix `DATABASE_URL`, a service-role key, or a private credential with `VITE_`.** No service-role API key is needed. `.env` is ignored by version control. Configure server variables in Netlify's environment settings with Functions scope, not just Build scope. Vite variables need Build scope.

## Database setup

1. Create a Supabase project and retain the database password privately.
2. In its SQL editor, run [`database/001_initial.sql`](database/001_initial.sql), then [`database/002_league_penalties.sql`](database/002_league_penalties.sql), once each in that order. If the initial schema is already installed, run only `002_league_penalties.sql` before deploying the updated app. Neither migration should be rerun against an already-migrated database.
3. Under **Connect**, select the **transaction pooler** connection string (normally port 6543). Use its exact host and username, URL-encode special characters in the password, and set `DATABASE_URL`.
4. Set the public project URL and anon key in the environment variables above.
5. The PostgreSQL client uses TLS, disables prepared statements for the transaction pooler, and caps each function instance at two connections.

For Supabase CLI deployments, apply the files in `supabase/migrations/` in timestamp order. The forward migration `20260927010000_league_penalties.sql` adds nullable `matches.league_penalties` JSONB and its validation constraint. Apply it to existing CLI installations before deploying this server version. It is safe to rerun and also accepts installations that already ran `database/002_league_penalties.sql`; it preserves existing results. The original migrations are unchanged. League draw rules and shootout points remain in `tournaments.settings`, while `matches.league_penalties` stores only `{ home, away }` shootout scores.

An opt-in database check exercises the real server store against the configured database, including the forward migration, settings edits, fixture generation and shootout save/load. It wraps everything in a transaction and rolls back both schema changes and test records. It needs a database role able to apply the migration and insert a temporary Auth user, and briefly takes a table lock (with a three-second lock timeout):

```sh
PES_VERIFY_LINKED_DB=1 node_modules/.bin/node --env-file=.env node_modules/vitest/vitest.mjs run tests/store.integration.test.ts
```

This check does not deploy the migration or verify Google sign-in. Normal `npm test` skips the linked-database check unless explicitly enabled.

Database constraints enforce paired nonnegative integer scores, non-self matches, same-tournament player references, one league pairing per leg, one match per knockout leg, and valid champion state. The validated server engine additionally enforces configuration, stage transitions, allowed deciders and seeded qualification. Calculated standings and aggregate scores are derived from match results, not independently mutable database columns.

The `audit_log.previous_state` JSON preserves the prior full tournament for each mutation. Recovery from audit snapshots is an operator/database task; there is no one-click restore UI. Configure database backups according to your hosting plan, export data before schema changes, and monitor audit growth over time.

## Google authentication setup

1. In Google Cloud, configure the OAuth consent screen (audience, application name, support email and required domains), then create an **OAuth client ID → Web application**. Publish the consent app when ready, or add test users while it is in Testing.
2. Add **Authorized JavaScript origin** `https://pes-tournament.netlify.app` and **Authorized redirect URI** `https://agyevuhestarzxatpzzd.supabase.co/auth/v1/callback`. This is the corrected project URL confirmed by the owner. It matches the existing environment.
3. In **Supabase → Authentication → Sign In / Providers → Google**, enable Google and enter the Google client ID and client secret. Keep that secret exclusively in Supabase; never add it to browser or Netlify build variables.
4. In **Supabase → Authentication → URL Configuration**, set **Site URL** to `https://pes-tournament.netlify.app` and add **Redirect URL** `https://pes-tournament.netlify.app/auth/callback`. Development/preview redirects must be separately allowlisted only if used; no localhost redirect is needed for production.
5. Test a real sign-in on the deployed site. Provider configuration and Google consent cannot be proven by mocked browser tests or a successful build.

The browser uses Supabase `signInWithOAuth({ provider: 'google' })` with PKCE. The SDK stores the verifier and automatically exchanges the callback code with `detectSessionInUrl: true`; the app does not exchange it twice. Both `persistSession` and `autoRefreshToken` are explicitly enabled. Browser storage holds the Supabase session, **never authoritative tournament data**. Session expiry, revocation, clearing browser storage, or browser privacy rules can require sign-in again.

Initialization waits for the SDK session before loading the owner-only `/api/tournaments` list. Successful authentication returns to **My Tournaments**, with Continue and Create new tournament. Loading errors offer retry rather than pretending the owner has no tournaments. Creation only happens after explicit wizard submission. Email initiation has been removed; existing persisted Supabase sessions remain usable. New sign-ins use Google.

Signing in does not grant access to another owner's tournaments. Every authenticated server operation verifies the token through Supabase `getUser`. The owner list filters by that verified user ID; no caller-supplied ID is accepted. Public URLs remain unauthenticated read-only views and omit owner IDs/audit history. There is no private-room feature: every existing tournament is public to anyone holding its code, as before.

Official setup: [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [PKCE sessions](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

## Netlify deployment

1. Push this folder to a Git repository and import it into Netlify.
2. Use build command **`npm run build`**, publish directory **`dist`**, and functions directory **`netlify/functions`**. `netlify.toml` already configures them, Node 22, API routing, SPA deep links and security headers.
3. Add the five variables above. Use the Supabase transaction-pooler URL for `DATABASE_URL`.
4. Apply the database migration and finish Google Auth redirect/provider configuration.
5. Deploy. Check `/api/health` reports `configured: true` (runtime configuration validation only, not a connectivity test). Missing/invalid Functions variables return HTTP 503 with their names and setup instructions; credentials are never returned.
6. Sign in, create a small tournament, and perform the live acceptance checks below.

The browser initiates OAuth directly with Supabase; Netlify Functions independently verify the returned session for admin operations. The API uses relative `/api/` URLs. Netlify SPA rewrites serve `/auth/callback` as well as `/t/**`.

Production configuration checklist:

- **Builds scope:** `VITE_SUPABASE_URL` (`https://agyevuhestarzxatpzzd.supabase.co`) and `VITE_SUPABASE_ANON_KEY` (public anon/publishable key from that same project).
- **Functions scope:** `SUPABASE_URL` (same confirmed project), `SUPABASE_ANON_KEY` (same public key), and `DATABASE_URL` (server-only transaction-pooler connection). No service-role key is required. Never add `DATABASE_URL` or Google/client secrets with a `VITE_` prefix.
- Use `npm run build`, publish `dist`, functions `netlify/functions`, Node 22. Redeploy after environment changes. No live Netlify settings were modified by this implementation.
- Netlify builds perform a read-only Auth settings preflight and require Google to be enabled. DNS/network errors, rejected keys and disabled providers intentionally block deployment. This cannot verify Google client credentials, consent settings or a completed sign-in.
- `/api/health` checks Functions runtime configuration only; verify authenticated saving after deployment. Default CSP allows Supabase HTTPS endpoints. Custom Supabase domains require a matching `connect-src` entry.

Redeploy after changing `VITE_` variables: they are substituted at build time. If using a Supabase custom API domain, adjust the `connect-src` Content Security Policy in `netlify.toml`. HTTPS is required for clipboard and native sharing support.

## First tournament and viewer access

1. Select **Create tournament**, then **Continue with Google**. OAuth returns to **My Tournaments**. Continue an existing room or select **Create Tournament**.
2. Enter its name and 2–32 player names/avatars; choose repetitions, knockout settings, scoring and tie-break order.
3. Review and explicitly create the tournament. Unsaved wizard inputs are not persisted across a full OAuth redirect; the normal home flow signs in before setup.
4. Review settings in Admin and select **Generate fixtures & start league**. Names/rules lock at kickoff; avatars remain editable.
5. Share `/t/EFC-XXXXXXXX`. Spectators need no account. The longer eight-character code reduces accidental guessing; tournament links are public, not private access credentials.
6. Open any fixture, enter scores, and save. An existing result requires selecting **Edit result**. If someone else changed data, the entry stays visible and the administrator must review the new saved score before retrying.
7. Once the league is complete, review standings. Resolve any complete ties, then explicitly confirm the knockout stage (or league champion).
8. Knockout winners advance automatically once all required legs and any tied-score decider are complete. The final crowns the champion.

## Tournament mathematics and edge cases

- Circle-method scheduling adds an internal bye for odd counts; no dummy players or bye matches are displayed. Even-numbered legs reverse the corresponding odd leg's home/away orientation.
- Normal league points default to 3/1/0. Win must exceed draw; draw must be at least loss. Values are integers from 0 to 20. Scores are integers from 0 to 999.
- League / normal match rules are separate from knockout rules. `settings.leagueDrawsAllowed` defaults to `true`, including for existing settings that omit it. An allowed 2–2 remains a draw using normal draw points.
- With league draws disallowed, a tied result requires non-tied `leaguePenalties` scores. These are stored in the nullable `matches.league_penalties` JSONB column and never added to GF/GA. The shootout determines W/L and form.
- **No league penalty-points policy is assumed.** `settings.leaguePenaltyPoints` is `null` by default. The future configuration hook accepts an explicitly supplied `{ winner, loser }` points policy in the existing settings JSON; neither normal win/loss points nor normal draw points are used as a fallback. There is intentionally no points split selected by the setup UI. Until a policy is explicitly configured, the server blocks finalizing tied league results and the UI explains why. Ordinary non-tied results still work. Failed finalization leaves existing results unchanged. Adding a points-policy UI later needs no database redesign.
- Defaults: points, goal difference, goals scored, head-to-head, wins. Every rule is configurable in priority. Head-to-head uses a mini-table across the entire still-tied group (points, GD, GF), avoiding inconsistent pairwise sorting.
- An unresolved complete tie shares a rank and displays `TIE`. UUID ordering gives stable display only, never qualification or a champion. Admin manual order can change only completely tied positions and is invalidated by league result changes.
- Qualification requires resolving all complete ties that affect qualifying seeds. Top 4 is 1–4 and 2–3. Top 8 is 1–8, 4–5, 2–7, 3–6, keeping top seeds on opposite bracket halves.
- Form is the last five completed **scheduled** league fixtures in leg/matchday order. Correcting an old score does not move it to the end of form. Recent activity instead uses server update timestamps.
- League stats exclude knockout games; profiles label this scope. Defence tables exclude players with no recorded games. Tied statistics remain equal values; their display order does not settle tournament ranking.
- Two legs use actual player identity when adding reversed scores. No away-goals rule. Penalties are recorded separately and do not inflate goals/aggregates. Match scores include any extra-time goals; extra time may be marked when recording a decider.
- Knockout ties can never finish as draws. A tied completed score/aggregate remains **awaiting a decider**, with no winner or advancement. Every round, including semi-finals and finals, uses `settings.resolution`: penalty scores, an administrator-selected winner, or either method, as configured. A drawn first leg does not require a decider on its own.
- League results lock after qualification. Earlier knockout rounds lock once a downstream round is created. Reset the knockout stage, correct league data and reseed if needed. Editing/resetting the final clears stale champion/decider state.
- Reset knockout retains the league. Reset all results retains league fixtures. Reset tournament returns to setup, retaining roster and settings. All require typing `RESET`.
- Polling pauses in hidden tabs and retries on visibility/reconnection. Saves are never optimistically reported as successful. Failed score input survives inside the open dialog. Closing a dirty score dialog requires a discard confirmation; browser navigation uses the standard unsaved-change warning. An unsubmitted draft is not a saved database result.

## Verification and remaining live acceptance

`tests/engine.test.ts` covers 2–32 player scheduling, odd/even counts, every supported repetition, exact pair coverage, reversed fixtures, standings, draws, large scores, repeated edits, custom scoring, ties, head-to-head, seeded brackets, aggregates, penalties, manual decisions, resets and invalid input.

`tests/api.test.ts` tests the real request handler with mocked Auth/storage boundaries: public reads, unauthenticated writes, foreign-owner writes, expired sessions, stale versions, invalid/foreign match input, not-found results and storage failure responses.

`tests/database.test.ts` executes the real migration on embedded PostgreSQL (PGlite), checking RLS/privileges, foreign keys, fixture uniqueness, champion integrity, score constraints and transaction rollback. It is not a hosted Supabase connection test.

`tests/browser/app.spec.ts` exercises real desktop/mobile UI using mocked API responses: home/join flow, wizard validation, viewer restrictions, refresh/poll updates, failed saves preserving inputs and explicit stale-score review. These are not proof of hosted multi-device persistence.

Before using a deployed tournament, perform these **live checks** with your own Supabase project:

- Device A signs in and creates a tournament. Refresh, close/reopen the browser and confirm it remains.
- Devices B and C open its public URL with no account. A records 4–2; both viewers show it within approximately five seconds. Refresh B; edit A to 5–2; confirm both update again.
- A second authenticated account attempts the same PATCH; expect 403. Without a session, expect 401. Direct Supabase browser table calls must be denied.
- Open two admin tabs, edit the same score, save one, then save the other. Expect a conflict and preserved inputs, not a silent overwrite.
- Disconnect A before saving; confirm no success notice and that scores remain. Reconnect and retry.
- Finish a small league and two-leg knockout, including aggregate draw and penalty winner. Confirm the champion and test a final correction.

No hosted credentials are included. Deployment, real Google authentication and live multi-device checks require your account configuration; they cannot be verified by a static build alone.

## Troubleshooting

- **Shared storage not configured:** set all environment variables and run Netlify Dev or deploy to Netlify. Vite alone has no API.
- **Google sign-in fails:** verify the Google provider credentials, consent audience and both redirect URLs above.
- **Connection errors:** check the pooler host/username, encoded password, TLS, project availability and Netlify Functions environment scope.
- **Tournament not found:** check all eight characters after `EFC-` and ensure both devices use the same deployed app/database.
- **Spectator after sign-in:** use the creator's Google account. Signing in does not grant access to tournaments created by others.
- **Data changed elsewhere:** review the latest result in the score dialog, enable save explicitly and retry. No result is overwritten with an outdated version.
- **Cannot change a past result:** reset knockout in Admin first. This removes downstream brackets so qualification cannot silently become inconsistent.
- **Local mobile browser issues:** serve over HTTPS for secure-context APIs, including UUID generation and clipboard. For development use localhost or an HTTPS tunnel.

## Source map

- `src/lib/engine.ts`: pure scheduling, standings and state transitions.
- `src/lib/validation.ts`: schemas shared by server and browser.
- `server/api.ts`: authenticated request handling and optimistic concurrency.
- `server/store.ts`: normalized PostgreSQL persistence and transactions.
- `database/001_initial.sql`: relational schema, constraints and RLS.
- `database/002_league_penalties.sql`: additive league-shootout storage and constraints; apply before deploying this update.
- `src/components/`: focused UI screens and workflows.
- `netlify.toml`: build, function routing, deep links and security headers.

Official references: [Netlify Functions](https://docs.netlify.com/build/functions/get-started/), [Supabase server-side user verification](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
