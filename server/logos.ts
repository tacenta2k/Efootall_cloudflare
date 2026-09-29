import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { db } from './store';
import { serverAuthConfig } from './config';
import { LOGO_BUCKET } from '../src/lib/logos';

export async function reserveLogo(owner: string, extension: 'png' | 'webp') {
  return db().begin(async (sql) => {
    // Serialize reservations per account to bound abandoned uploads.
    await sql`select id from auth.users where id=${owner} for update`;
    const [row] =
      await sql`select count(*)::int as count from team_logo_assets where owner_id=${owner} and state='pending'`;
    if (row.count >= 64) throw new Error('TOO_MANY_LOGOS');
    const path = `${owner}/${randomUUID()}.${extension}`;
    await sql`insert into team_logo_assets(path,owner_id) values(${path},${owner})`;
    return path;
  });
}
export async function retireDraft(owner: string, path: string) {
  await db().begin(async (sql) => {
    await sql`select path from team_logo_assets where path=${path} and owner_id=${owner} for update`;
    // Active references cannot be discarded by a manipulated client.
    await sql`update team_logo_assets set state='retired' where path=${path} and owner_id=${owner} and state='pending'`;
  });
}
export async function cleanupLogos(owner: string, request: Request) {
  try {
    const paths = await db().begin(async (sql) => {
      await sql`update team_logo_assets set state='retired' where owner_id=${owner} and state='pending' and created_at < now() - interval '24 hours'`;
      return sql`select path from team_logo_assets where owner_id=${owner} and state='retired' limit 100`;
    });
    if (!paths.length) return;
    const config = serverAuthConfig();
    if (config.error) return;
    const storage = createClient(config.url!, config.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: request.headers.get('Authorization')! },
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    }).storage.from(LOGO_BUCKET);
    const { error } = await storage.remove(paths.map((p) => p.path));
    if (error) throw error;
    // Storage removal is idempotent. Prune only confirmed-absent objects; keep failed
    // removals retired so they cannot be reattached and cleanup can retry.
    await db().begin(async (sql) => {
      await sql`delete from team_logo_assets where owner_id=${owner} and state='retired' and path in ${sql(paths.map((p) => p.path))} and not exists(select 1 from storage.objects where bucket_id=${LOGO_BUCKET} and name=team_logo_assets.path)`;
    });
  } catch {
    // The tournament mutation has committed. Retry cleanup on the next logo/list/delete action.
    console.warn('Team logo cleanup deferred; retry on next authenticated action.');
  }
}
