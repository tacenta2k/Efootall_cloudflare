import { deleteOwned, type Tx } from '../server/store';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import type { Match, Settings } from '../src/lib/types';
import { defaultSettings } from '../src/lib/types';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const forwardMigration = new URL(
  '../supabase/migrations/20260927010000_league_penalties.sql',
  import.meta.url,
);

it('upgrades an existing schema without changing its settings or ordinary results', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;',
    );
    await db.exec(
      await readFile(
        new URL('../supabase/migrations/20260927000000_initial_tournament.sql', import.meta.url),
        'utf8',
      ),
    );
    const owner = crypto.randomUUID(),
      tournament = crypto.randomUUID();
    const home = crypto.randomUUID(),
      away = crypto.randomUUID();
    await db.query('insert into auth.users values ($1)', [owner]);
    await db.query(
      "insert into tournaments (id,public_code,owner_id,name,settings,status) values ($1,'EFC-ABCDEFGH',$2,'Existing cup',$3,'league_active')",
      [tournament, owner, JSON.stringify(defaultSettings)],
    );
    for (const [id, name] of [
      [home, 'One'],
      [away, 'Two'],
    ]) {
      await db.query("insert into players values ($1,$2,$3,'⚽',0)", [id, tournament, name]);
    }
    await db.query(
      "insert into matches (id,tournament_id,home_player_id,away_player_id,stage,round,leg,matchday,home_score,away_score) values (gen_random_uuid(),$1,$2,$3,'league',0,1,1,3,2)",
      [tournament, home, away],
    );
    await db.exec(await readFile(forwardMigration, 'utf8'));
    expect(
      (await db.query('select home_score,away_score,league_penalties from matches')).rows,
    ).toEqual([{ home_score: 3, away_score: 2, league_penalties: null }]);
    expect((await db.query('select settings from tournaments')).rows).toEqual([
      { settings: defaultSettings },
    ]);
  } finally {
    await db.close();
  }
}, 30000);

describe.each(['manual SQL', 'Supabase CLI'])('%s deployment migrations', (deployment) => {
  let db: PGlite;
  const ids = {
    owner: '00000000-0000-4000-8000-000000000001',
    t: '00000000-0000-4000-8000-000000000002',
    other: '00000000-0000-4000-8000-000000000003',
    a: '00000000-0000-4000-8000-000000000004',
    b: '00000000-0000-4000-8000-000000000005',
    foreign: '00000000-0000-4000-8000-000000000006',
  };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;',
    );
    const migrations =
      deployment === 'manual SQL'
        ? [
            '../database/001_initial.sql',
            '../database/002_league_penalties.sql',
            '../supabase/migrations/20260930000000_team_logos.sql',
          ]
        : (await readdir(new URL('../supabase/migrations/', import.meta.url)))
            .filter((name) => name.endsWith('.sql') && !name.includes('team_logo_storage'))
            .sort()
            .map((name) => '../supabase/migrations/' + name);
    for (const migration of migrations) {
      await db.exec(await readFile(new URL(migration, import.meta.url), 'utf8'));
    }
    await db.query('insert into auth.users values ($1)', [ids.owner]);
    for (const [id, code] of [
      [ids.t, 'EFC-ABCDEFGH'],
      [ids.other, 'EFC-ABCDEFGJ'],
    ])
      await db.query(
        "insert into tournaments (id,public_code,owner_id,name,settings,status) values ($1,$2,$3,'Test','{}','setup')",
        [id, code, ids.owner],
      );
    for (const [id, t, name] of [
      [ids.a, ids.t, 'Aswin'],
      [ids.b, ids.t, 'Rahul'],
      [ids.foreign, ids.other, 'Other'],
    ])
      await db.query(
        "insert into players (id,tournament_id,name,avatar,position) values ($1,$2,$3,'⚽',0)",
        [id, t, name],
      );
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  const insertMatch = (a = ids.a, b = ids.b, h: number | null = null, v: number | null = null) =>
    db.query(
      "insert into matches(id,tournament_id,home_player_id,away_player_id,stage,round,leg,matchday,home_score,away_score) values(gen_random_uuid(),$1,$2,$3,'league',0,1,1,$4,$5)",
      [ids.t, a, b, h, v],
    );
  describe('PostgreSQL migration, constraints and RLS', () => {
    it('enables RLS on every application table', async () => {
      const result = await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where relname in ('tournaments','players','matches','knockout_ties','audit_log')",
      );
      expect(result.rows).toHaveLength(5);
      expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
    });
    it('does not grant browser roles direct read or write access', async () => {
      for (const role of ['anon', 'authenticated'])
        for (const table of ['tournaments', 'players', 'matches', 'knockout_ties', 'audit_log']) {
          const result = await db.query<{ allowed: boolean }>(
            "select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,SELECT') as allowed",
            [role, table],
          );
          expect(result.rows[0].allowed).toBe(false);
        }
    });
    it('rejects negative scores, partial results, self matches and foreign tournament players', async () => {
      await expect(insertMatch(ids.a, ids.b, -1, 0)).rejects.toThrow();
      await expect(insertMatch(ids.a, ids.b, 1, null)).rejects.toThrow();
      await expect(insertMatch(ids.a, ids.a)).rejects.toThrow();
      await expect(insertMatch(ids.a, ids.foreign)).rejects.toThrow();
    });
    it('rejects duplicate fixtures in either direction', async () => {
      await insertMatch();
      await expect(insertMatch()).rejects.toThrow();
      await expect(insertMatch(ids.b, ids.a)).rejects.toThrow();
    });
    it('rejects duplicate names and out-of-tournament champions', async () => {
      await expect(
        db.query("insert into players values(gen_random_uuid(),$1,'aswin','⚽',2)", [ids.t]),
      ).rejects.toThrow();
      await expect(
        db.query("update tournaments set status='completed',champion_id=$1 where id=$2", [
          ids.foreign,
          ids.t,
        ]),
      ).rejects.toThrow();
    });
    it('requires a champion for completed state and rejects a champion in active states', async () => {
      await expect(
        db.query("update tournaments set status='completed' where id=$1", [ids.t]),
      ).rejects.toThrow();
      await expect(
        db.query('update tournaments set champion_id=$1 where id=$2', [ids.a, ids.t]),
      ).rejects.toThrow();
    });
    it('rejects a knockout match without its tie', async () => {
      await expect(
        db.query(
          "insert into matches(id,tournament_id,home_player_id,away_player_id,stage,round,leg,matchday) values(gen_random_uuid(),$1,$2,$3,'knockout',1,1,1)",
          [ids.t, ids.a, ids.b],
        ),
      ).rejects.toThrow();
    });
    it('rolls back failed transactions without losing prior scores', async () => {
      await db.query('update matches set home_score=4,away_score=2 where tournament_id=$1', [
        ids.t,
      ]);
      await expect(
        db.transaction(async (tx) => {
          await tx.query('delete from matches where tournament_id=$1', [ids.t]);
          await tx.query("insert into players values(gen_random_uuid(),$1,'Aswin','⚽',3)", [
            ids.t,
          ]);
        }),
      ).rejects.toThrow();
      const result = await db.query<{ home_score: number; away_score: number }>(
        'select home_score,away_score from matches where tournament_id=$1',
        [ids.t],
      );
      expect(result.rows).toEqual([{ home_score: 4, away_score: 2 }]);
    });
  });

  it('persists league shootouts separately and rejects malformed or misplaced shootout results', async () => {
    const id = crypto.randomUUID();
    await db.query(
      "insert into matches(id,tournament_id,home_player_id,away_player_id,stage,round,leg,matchday,home_score,away_score,league_penalties) values($1,$2,$3,$4,'league',0,2,1,2,2,$5)",
      [id, ids.t, ids.a, ids.b, JSON.stringify({ home: 4, away: 3 })],
    );
    const saved = await db.query<{ league_penalties: { home: number; away: number } }>(
      'select league_penalties from matches where id=$1',
      [id],
    );
    expect(saved.rows[0].league_penalties).toEqual({ home: 4, away: 3 });
    for (const invalid of [
      { home: 3, away: 3 },
      { home: -1, away: 0 },
      { home: 1.5, away: 2 },
      { home: 1000, away: 0 },
      { home: '4', away: 3 },
      { home: 4 },
      [],
    ]) {
      await expect(
        db.query('update matches set league_penalties=$1 where id=$2', [
          JSON.stringify(invalid),
          id,
        ]),
      ).rejects.toThrow();
    }
    await expect(db.query('update matches set home_score=3 where id=$1', [id])).rejects.toThrow();
    await expect(
      db.query('update matches set home_score=null,away_score=null where id=$1', [id]),
    ).rejects.toThrow();
    await db.query(
      'update matches set home_score=null,away_score=null,league_penalties=null where id=$1',
      [id],
    );
  });

  it('round-trips typed league settings and preserves shootouts when the forward migration is rerun', async () => {
    const settings: Settings = {
      ...defaultSettings,
      name: 'Migration cup',
      leagueDrawsAllowed: false,
      leaguePenaltyPoints: { winner: 4, loser: 2 },
    };
    await db.query('update tournaments set settings=$1 where id=$2', [
      JSON.stringify(settings),
      ids.t,
    ]);
    const shootout: Match['leaguePenalties'] = { home: 5, away: 3 };
    await db.query(
      'update matches set home_score=2,away_score=2,league_penalties=$1 where tournament_id=$2 and leg=2',
      [JSON.stringify(shootout), ids.t],
    );
    const migration = await readFile(forwardMigration, 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const saved = await db.query<{ settings: Settings }>(
      'select settings from tournaments where id=$1',
      [ids.t],
    );
    expect(saved.rows[0].settings).toEqual(settings);
    const matches = await db.query<{ league_penalties: Match['leaguePenalties'] }>(
      'select league_penalties from matches where tournament_id=$1 and leg=2',
      [ids.t],
    );
    expect(matches.rows).toEqual([{ league_penalties: shootout }]);
    const column = await db.query<{ data_type: string; is_nullable: string }>(
      "select data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='matches' and column_name='league_penalties'",
    );
    expect(column.rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }]);
    const constraints = await db.query(
      "select conname from pg_constraint where conrelid='public.matches'::regclass and conname='valid_league_penalties'",
    );
    expect(constraints.rows).toHaveLength(1);
  });
  it('owner-constrained deletion cascades completed tournament data without touching another tournament', async () => {
    // Adapt the production tagged query to PostgreSQL in PGlite, preserving parameters.
    const remove = (query: typeof db.query, owner: string) =>
      deleteOwned(
        (async (parts: TemplateStringsArray, ...values: unknown[]) => {
          const text = parts.reduce(
            (sql, part, index) => sql + (index ? `$${index}` : '') + part,
            '',
          );
          return (await query(text, values)).rows;
        }) as unknown as Tx,
        'EFC-ABCDEFGH',
        owner,
      );
    const tie = crypto.randomUUID();
    await db.query(
      'insert into knockout_ties(id,tournament_id,round,position,player_a_id,player_b_id,winner_id) values($1,$2,1,0,$3,$4,$3)',
      [tie, ids.t, ids.a, ids.b],
    );
    await db.query(
      "insert into matches(id,tournament_id,home_player_id,away_player_id,stage,round,leg,matchday,tie_id,home_score,away_score) values(gen_random_uuid(),$1,$2,$3,'knockout',1,1,1,$4,2,1)",
      [ids.t, ids.a, ids.b, tie],
    );
    await db.query(
      "insert into audit_log(tournament_id,actor_id,action,previous_state) values($1,$2,'{}','{}')",
      [ids.t, ids.owner],
    );
    await db.query("update tournaments set status='completed',champion_id=$1 where id=$2", [
      ids.a,
      ids.t,
    ]);
    expect(await remove(db.query.bind(db), crypto.randomUUID())).toBe(false);
    await expect(
      db.transaction(async (tx) => {
        expect(await remove(tx.query.bind(tx), ids.owner)).toBe(true);
        throw new Error('Rollback deletion');
      }),
    ).rejects.toThrow('Rollback deletion');
    expect((await db.query('select id from tournaments where id=$1', [ids.t])).rows).toHaveLength(
      1,
    );
    expect(
      (await db.query('select id from audit_log where tournament_id=$1', [ids.t])).rows,
    ).toHaveLength(1);
    expect(await db.transaction((tx) => remove(tx.query.bind(tx), ids.owner))).toBe(true);
    for (const table of ['players', 'matches', 'knockout_ties', 'audit_log']) {
      expect(
        (await db.query(`select * from ${table} where tournament_id=$1`, [ids.t])).rows,
      ).toEqual([]);
    }
    expect((await db.query('select id from tournaments')).rows).toEqual([{ id: ids.other }]);
    expect((await db.query('select id from players')).rows).toEqual([{ id: ids.foreign }]);
    expect(await remove(db.query.bind(db), ids.owner)).toBe(false);
  });
});
