import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import type { Tournament } from '../src/lib/types';
import { cloudflareBindings, databaseConfigured, serverEnv } from './config';
type Connection = ReturnType<typeof postgres>;
const requests = new AsyncLocalStorage<{ connection?: Connection }>();
// Retained only for the existing Netlify/Node entry point.
let connection: Connection | undefined;

export function withRequestDatabase<T>(run: () => Promise<T>): Promise<T> {
  return requests.run({}, async () => {
    const state = requests.getStore()!;
    try {
      return await run();
    } finally {
      // Close only this request's client; Hyperdrive owns the origin connection pool.
      // Cleanup must not turn an already committed mutation into an apparent failure.
      try {
        await state.connection?.end({ timeout: 1 });
      } catch {
        console.warn('Database client cleanup failed.');
      }
    }
  });
}

export function db() {
  if (!databaseConfigured()) throw new Error('SERVER_NOT_CONFIGURED');
  const state = requests.getStore();
  const cloudflare = cloudflareBindings();
  if (cloudflare && !state) throw new Error('DATABASE_REQUEST_SCOPE_REQUIRED');
  const create = () =>
    postgres(serverEnv('DATABASE_URL')!, {
      // Hyperdrive manages TLS to PostgreSQL; its Worker-facing connection is local.
      // Queries use scalar and JSON/JSONB values, not PostgreSQL array columns.
      ...(cloudflare ? { fetch_types: false } : { ssl: 'require' as const }),
      max: 2,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  if (state) return (state.connection ??= create());
  return (connection ??= create());
}
export type Tx = postgres.TransactionSql;
export async function deleteOwned(sql: Tx, code: string, owner: string): Promise<boolean> {
  // One owner-constrained statement; foreign keys cascade all tournament data.
  const rows =
    await sql`delete from tournaments where public_code=${code} and owner_id=${owner} returning id`;
  return rows.length > 0;
}
export async function load(
  sql: Tx,
  code: string,
  lock = false,
): Promise<{ t: Tournament; owner: string } | null> {
  const records = lock
    ? await sql`select * from tournaments where public_code=${code} for update`
    : await sql`select * from tournaments where public_code=${code}`;
  const r = records[0];
  if (!r) return null;
  const [players, matches, ties] = await Promise.all([
    sql`select * from players where tournament_id=${r.id} order by position`,
    sql`select * from matches where tournament_id=${r.id} order by stage desc,round,leg,matchday,id`,
    sql`select * from knockout_ties where tournament_id=${r.id} order by round,position`,
  ]);
  return {
    owner: r.owner_id,
    t: {
      id: r.id,
      code: r.public_code,
      settings: r.settings,
      status: r.status,
      champion: r.champion_id,
      manualOrder: r.manual_order,
      version: r.version,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      players: players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
      matches: matches.map((m) => ({
        id: m.id,
        home: m.home_player_id,
        away: m.away_player_id,
        stage: m.stage,
        round: m.round,
        leg: m.leg,
        matchday: m.matchday,
        tieId: m.tie_id,
        homeScore: m.home_score,
        awayScore: m.away_score,
        leaguePenalties: m.league_penalties ?? null,
        updatedAt: m.updated_at ? new Date(m.updated_at).toISOString() : null,
      })),
      ties: ties.map((k) => ({
        id: k.id,
        round: k.round,
        position: k.position,
        a: k.player_a_id,
        b: k.player_b_id,
        winner: k.winner_id,
        resolution: k.resolution,
      })),
    },
  };
}
export async function save(sql: Tx, t: Tournament, owner: string, isNew = false) {
  if (isNew)
    await sql`insert into tournaments (id,public_code,owner_id,name,settings,status,version) values (${t.id},${t.code},${owner},${t.settings.name},${sql.json(t.settings as never)},${t.status},${t.version})`;
  else
    await sql`update tournaments set name=${t.settings.name},settings=${sql.json(t.settings as never)},status=${t.status},champion_id=${t.champion},manual_order=${sql.json(t.manualOrder)},version=${t.version},updated_at=now() where id=${t.id}`;
  // Parent row is locked; the full normalized snapshot is replaced atomically.
  await sql`delete from matches where tournament_id=${t.id}`;
  await sql`delete from knockout_ties where tournament_id=${t.id}`;
  await sql`delete from players where tournament_id=${t.id}`;
  await sql`insert into players ${sql(t.players.map((p, position) => ({ id: p.id, tournament_id: t.id, name: p.name, avatar: p.avatar, position })))}`;
  if (t.ties.length)
    await sql`insert into knockout_ties ${sql(t.ties.map((k) => ({ id: k.id, tournament_id: t.id, round: k.round, position: k.position, player_a_id: k.a, player_b_id: k.b, winner_id: k.winner, resolution: k.resolution ? sql.json(k.resolution) : null })))}`;
  if (t.matches.length)
    await sql`insert into matches ${sql(t.matches.map((m) => ({ id: m.id, tournament_id: t.id, home_player_id: m.home, away_player_id: m.away, stage: m.stage, round: m.round, leg: m.leg, matchday: m.matchday, tie_id: m.tieId, home_score: m.homeScore, away_score: m.awayScore, league_penalties: m.leaguePenalties ? sql.json(m.leaguePenalties) : null, updated_at: m.updatedAt })))}`;
}

export async function listOwned(sql: Tx, owner: string) {
  const rows =
    await sql`select t.public_code as code, t.name, t.status, t.settings->>'knockout' as knockout,
    (select count(*)::int from players p where p.tournament_id=t.id) as players
    from tournaments t where t.owner_id=${owner} order by t.updated_at desc, t.id`;
  return rows.map((r) => ({
    code: r.code as string,
    name: r.name as string,
    status: r.status as Tournament['status'],
    knockout: Number(r.knockout),
    players: Number(r.players),
  }));
}
