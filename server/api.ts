import { reserveLogo, retireDraft, cleanupLogos } from './logos';
import { logoPattern } from '../src/lib/logos';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { z, ZodError } from 'zod';
import { applyAction, createTournament } from '../src/lib/engine';
import { actionSchema, setupSchema } from '../src/lib/validation';
import { db, load, save, listOwned, deleteOwned } from './store';
import { cloudflareBindings, databaseConfigured, serverAuthConfig } from './config';
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function user(request: Request) {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to manage a tournament.');
  const config = serverAuthConfig();
  if (config.error !== null) throw new HttpError(503, config.error);
  const auth = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
  let result;
  try {
    result = await auth.auth.getUser(token);
  } catch {
    throw new HttpError(
      503,
      'Unable to reach Supabase authentication. Try again later; the site owner should verify the Functions environment and project availability.',
    );
  }
  const { data, error } = result;
  if (error && (error.name === 'AuthRetryableFetchError' || !error.status || error.status >= 500))
    throw new HttpError(503, 'Supabase authentication is temporarily unavailable. Please retry.');
  if (error || !data.user)
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  return data.user.id;
}
async function body(request: Request) {
  const raw = await request.text();
  if (raw.length > 40000) throw new HttpError(413, 'Request is too large.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid request.');
  }
}
export async function handler(
  request: Request,
  defer?: (task: () => Promise<void>) => void,
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname
      .replace(/^\/(?:\.netlify\/functions\/api|api)\/?/, '')
      .split('/')
      .filter(Boolean);
    if (path[0] === 'health') {
      const auth = serverAuthConfig(),
        database = databaseConfigured();
      const configured = auth.error === null && database;
      return json(
        {
          configured,
          checks: { authentication: auth.error === null, database },
          errors: [
            auth.error,
            database
              ? null
              : cloudflareBindings()
                ? 'Configure the HYPERDRIVE binding for this Worker.'
                : 'Set a valid DATABASE_URL in Netlify Functions scope and redeploy.',
          ].filter(Boolean),
        },
        configured ? 200 : 503,
      );
    }
    if (path[0] === 'logos' && path.length === 1) {
      const owner = await user(request);
      if (request.method === 'POST') {
        const { extension } = z
          .object({ extension: z.enum(['webp', 'png']) })
          .strict()
          .parse(await body(request));
        await cleanupLogos(owner, request);
        return json({ path: await reserveLogo(owner, extension) }, 201);
      }
      if (request.method === 'DELETE') {
        const { path: logo } = z
          .object({ path: z.string().refine((p) => logoPattern.test('logo:' + p)) })
          .strict()
          .parse(await body(request));
        await retireDraft(owner, logo);
        await cleanupLogos(owner, request);
        return json({ deleted: true });
      }
      throw new HttpError(405, 'This request method is not supported.');
    }
    if (path[0] !== 'tournaments') throw new HttpError(404, 'Page not found.');
    if (request.method === 'POST' && path.length === 1) {
      const owner = await user(request),
        input = setupSchema.parse(await body(request));
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code =
        'EFC-' + Array.from(randomBytes(8), (n) => alphabet[n % alphabet.length]).join('');
      const t = createTournament(input.settings, input.players, code, new Date().toISOString());
      await db().begin(async (sql) => {
        await save(sql, t, owner, true);
      });
      return json({ tournament: t, canEdit: true }, 201);
    }
    if (request.method === 'GET' && path.length === 1) {
      const owner = await user(request);
      const tournaments = await db().begin(async (sql) => listOwned(sql, owner));
      if (defer) defer(() => cleanupLogos(owner, request));
      else await cleanupLogos(owner, request);
      return json({ tournaments });
    }
    const code = path[1]?.toUpperCase();
    if (!/^EFC-[A-Z2-9]{8}$/.test(code ?? ''))
      throw new HttpError(404, 'Tournament not found. Check the code and try again.');
    if (request.method === 'DELETE' && path.length === 2) {
      const owner = await user(request);
      z.object({ confirmation: z.literal('DELETE') })
        .strict()
        .parse(await body(request));
      const deleted = await db().begin(async (sql) => deleteOwned(sql, code, owner));
      if (!deleted)
        throw new HttpError(404, 'Tournament not found or you are not its administrator.');
      await cleanupLogos(owner, request);
      return json({ deleted: true });
    }
    if (request.method === 'GET') {
      let owner: string | null = null;
      if (request.headers.has('Authorization')) {
        try {
          owner = await user(request);
        } catch (error) {
          // A revoked session must not make an otherwise public link inaccessible.
          if (!(error instanceof HttpError && error.status === 401 && path.length === 2))
            throw error;
        }
      }
      const knownVersion = request.headers.get('X-Tournament-Version');
      const result = await db().begin('isolation level repeatable read read only', async (sql) => {
        // The client version is only a transfer hint. Ownership is always read from
        // the database after the normal authentication checks above.
        if (path.length === 2 && knownVersion && /^[1-9]\d{0,9}$/.test(knownVersion)) {
          const [current] =
            await sql`select version, owner_id from tournaments where public_code=${code}`;
          if (!current)
            throw new HttpError(404, 'Tournament not found. Check the code and try again.');
          if (current.version === Number(knownVersion))
            return {
              unchanged: true,
              version: current.version,
              canEdit: owner === current.owner_id,
            };
        }
        const found = await load(sql, code);
        if (!found) throw new HttpError(404, 'Tournament not found. Check the code and try again.');
        if (path[2] === 'audit') {
          if (owner !== found.owner)
            throw new HttpError(
              403,
              'Only the tournament administrator can view its audit history.',
            );
          const history =
            await sql`select id,action,created_at from audit_log where tournament_id=${found.t.id} order by id desc limit 50`;
          return { history };
        }
        return { tournament: found.t, canEdit: owner === found.owner };
      });
      return json(result);
    }
    if (request.method === 'PATCH' && path.length === 2) {
      const owner = await user(request);
      const payload = z
        .object({ version: z.number().int().positive(), action: actionSchema })
        .strict()
        .parse(await body(request));
      const t = await db().begin(async (sql) => {
        const found = await load(sql, code, true);
        if (!found) throw new HttpError(404, 'Tournament not found.');
        if (found.owner !== owner)
          throw new HttpError(403, 'Only the tournament administrator can make changes.');
        if (found.t.version !== payload.version)
          throw new HttpError(
            409,
            'This tournament changed on another device. Your entry is preserved. Review the latest result before saving again.',
          );
        let next;
        try {
          next = applyAction(found.t, payload.action, new Date().toISOString());
        } catch (e) {
          throw new HttpError(422, e instanceof Error ? e.message : 'Invalid action.');
        }
        await sql`insert into audit_log (tournament_id,actor_id,action,previous_state) values (${found.t.id},${owner},${sql.json(payload.action as never)},${sql.json(found.t as never)})`;
        await save(sql, next, owner);
        return next;
      });
      if (['avatar', 'settings'].includes(payload.action.type)) await cleanupLogos(owner, request);
      return json({ tournament: t, canEdit: true });
    }
    throw new HttpError(405, 'This request method is not supported.');
  } catch (e) {
    if (e instanceof Error && e.message === 'TOO_MANY_LOGOS')
      return json({ error: 'Too many unused logos. Save your teams or try again tomorrow.' }, 429);
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof ZodError)
      return json({ error: e.issues.map((i) => i.message).join(' ') }, 422);
    if (e instanceof Error && e.message === 'SERVER_NOT_CONFIGURED')
      return json(
        {
          error:
            'Shared storage is not configured yet. Connect Supabase using the README setup instructions.',
        },
        503,
      );
    console.error('Tournament API failed', e instanceof Error ? e.name : 'Unknown error');
    return json(
      {
        error:
          'Unable to complete the request. Your previous data is safe. Check your connection and try again.',
      },
      500,
    );
  }
}
