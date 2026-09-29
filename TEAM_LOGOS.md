# Team logos: manual deployment setup

Apply these migrations **before deploying the logo feature**. Nothing in this change automatically applies migrations or modifies the hosted project.

Use the canonical Supabase CLI migrations: `supabase/migrations/20260930000000_team_logos.sql` and `supabase/migrations/20260930010000_team_logo_storage.sql`, through the normal reviewed deployment process. These migrations have already been applied to the current hosted project; do not rerun them there. The duplicate SQL-editor files have been removed.

The first migration preserves existing emoji strings and adds compact `logo:<owner UUID>/<asset UUID>.webp` or `.png` references to the existing `players.avatar` field. It creates `team_logo_assets` with RLS and no direct browser access. Triggers validate ownership and completed uploads, and retire unreferenced images after the existing snapshot transaction finishes. Tournament/player deletion uses the same foreign-key cascades as before.

The second migration creates a **public** `team-logos` Storage bucket with a 128 KiB object limit and WebP/PNG MIME allowlist. Public image retrieval is intentional: public tournament viewers need logos. Authenticated uploads require an owner-specific reservation created by the server. Overwriting is not permitted. Removal requires an owner-specific retired asset. No service-role key is used or needed; server cleanup calls the Storage API with the user's verified bearer token and the existing public Supabase key. Do not manually delete rows from `storage.objects`; that would leave the actual files behind.

Keep the existing server and browser Supabase variables and scopes. `netlify.toml` allows Supabase image URLs and local blob previews through `img-src`; secret-scanning settings are unchanged.

## Behavior and cleanup

- Existing emojis remain supported, including custom emoji entry and all previous default options. The picker groups more than 80 options into eight categories.
- The browser accepts JPG/PNG/WebP input up to 10 MiB and center-crops to a square no larger than 256×256. WebP quality is 0.82; browsers without WebP encoding can use the PNG fallback. Output must fit within 128 KiB. Decoding strips source metadata. There is no manual crop or focal-point editor.
- Upload happens only after **Use logo**. The preview is local until then. Team rows contain a reference, never image bytes or base64.
- Explicitly discarded pending uploads are retired. Saved logos are retired only when no current team references them; failed database changes roll back that retirement. Cleanup happens through Storage after successful logo/settings/tournament-delete actions, when reserving another upload, and when the owner opens My Tournaments.
- Failed cleanup remains tracked and is retried on the next such authenticated action. Abandoned pending uploads expire after 24 hours, also on those actions. At most 64 pending reservations per account are allowed. There is no scheduled worker: an owner who never returns may leave pending/retired files until a future authenticated cleanup or an operator's Storage API maintenance job. Cleanup never deletes a currently referenced logo.
- Old audit snapshots may reference a removed image; current team data, not historical snapshots, determines retention. The audit action/snapshot data itself is unchanged.
- The live Supabase Storage service and device photo libraries still need a deployment smoke test after the migrations are applied. Local tests exercise the SQL policies with a minimal Supabase-schema fixture and mock hosted requests in browser tests.
