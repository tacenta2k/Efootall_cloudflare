import { describe, expect, it } from 'vitest';
import {
  aggregate,
  applyAction,
  createTournament,
  fixtures,
  played,
  standings,
} from '../src/lib/engine';
import { defaultSettings, type Action, type Player, type Tournament } from '../src/lib/types';
import { setupSchema, actionSchema } from '../src/lib/validation';
const now = '2026-09-27T10:00:00.000Z';
const players = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: crypto.randomUUID(),
    name: `Player ${i + 1}`,
    avatar: '⚽',
  }));
const make = (n = 4, knockout = 0, legs = 1) =>
  createTournament(
    { ...defaultSettings, name: 'Test cup', knockout, legs },
    players(n),
    'EFC-ABCDEFGH',
    now,
  );
const act = (t: Tournament, a: Action) => applyAction(t, a, now);
function complete(t: Tournament, draw = false) {
  t = act(t, { type: 'start' });
  for (const m of t.matches)
    t = act(t, {
      type: 'score',
      matchId: m.id,
      home: draw ? 0 : t.players.findIndex((p) => p.id === m.home) + 1,
      away: draw ? 0 : t.players.findIndex((p) => p.id === m.away) + 1,
      confirmEdit: false,
    });
  return t;
}
describe('round-robin scheduling', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 31, 32])
    for (const reps of [1, 2, 3, 4])
      it(`${n} players / ${reps} rounds: unique pair coverage, byes, and one match per day`, () => {
        const p = players(n),
          matches = fixtures(p, reps);
        expect(matches).toHaveLength(((n * (n - 1)) / 2) * reps);
        const pairs = new Map<string, number>();
        for (const m of matches) {
          expect(m.home).not.toBe(m.away);
          expect(p.some((p) => p.id === m.home)).toBe(true);
          expect(p.some((p) => p.id === m.away)).toBe(true);
          const key = [m.home, m.away].sort().join();
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
          const same = matches.filter((x) => x.leg === m.leg && x.matchday === m.matchday);
          const ids = same.flatMap((m) => [m.home, m.away]);
          expect(new Set(ids).size).toBe(ids.length);
        }
        expect(pairs.size).toBe((n * (n - 1)) / 2);
        for (const count of pairs.values()) expect(count).toBe(reps);
        if (reps >= 2)
          for (const m of matches.filter((m) => m.leg === 1))
            expect(
              matches.some(
                (x) =>
                  x.leg === 2 &&
                  x.home === m.away &&
                  x.away === m.home &&
                  x.matchday === m.matchday,
              ),
            ).toBe(true);
      });
});
describe('standings and results', () => {
  it('calculates GF, GA, GD, W/D/L, points and form, excluding knockout matches', () => {
    let t = act(make(2), { type: 'start' });
    const m = t.matches[0];
    t = act(t, { type: 'score', matchId: m.id, home: 3, away: 1, confirmEdit: false });
    let rows = standings(t);
    expect(rows[0]).toMatchObject({
      id: m.home,
      played: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      gf: 3,
      ga: 1,
      gd: 2,
      points: 3,
      form: ['W'],
    });
    expect(rows[1]).toMatchObject({ losses: 1, gf: 1, ga: 3, gd: -2, points: 0, form: ['L'] });
    const next = t.matches[1];
    t = act(t, { type: 'score', matchId: next.id, home: 0, away: 0, confirmEdit: false });
    rows = standings(t);
    expect(rows[0].points).toBe(4);
    expect(rows[1].points).toBe(1);
    expect(rows.every((r) => r.played === 2 && r.draws === 1)).toBe(true);
  });
  it('accepts a large score and repeated confirmed edits without double-counting', () => {
    let t = act(make(2), { type: 'start' });
    const m = t.matches[0];
    for (let i = 0; i < 5; i++)
      t = act(t, { type: 'score', matchId: m.id, home: 999 - i, away: 0, confirmEdit: i > 0 });
    expect(standings(t)[0].gf).toBe(995);
    expect(standings(t)[0].played).toBe(1);
    expect(t.version).toBe(7);
  });
  it('requires edit confirmation, handles zero-zero, and reverses deleted results', () => {
    let t = act(make(2), { type: 'start' });
    const m = t.matches[0];
    t = act(t, { type: 'score', matchId: m.id, home: 0, away: 0, confirmEdit: false });
    expect(standings(t).every((r) => r.points === 1 && r.tied)).toBe(true);
    expect(() =>
      act(t, { type: 'score', matchId: m.id, home: 4, away: 2, confirmEdit: false }),
    ).toThrow('Confirm');
    t = act(t, { type: 'resetMatch', matchId: m.id, confirmation: 'RESET' });
    expect(standings(t).every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });
  it('flags complete ties deterministically without inventing a champion', () => {
    const t = complete(make(4), true);
    const rows = standings(t);
    expect(rows.every((r) => r.tied && r.rank === 1)).toBe(true);
    expect(standings(t).map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(() => act(t, { type: 'advance' })).toThrow('Resolve tied');
  });
  it('only permits manual ordering inside complete-tie groups', () => {
    let t = complete(make(4), true);
    const order = [...t.players].reverse().map((p) => p.id);
    t = act(t, { type: 'resolveOrder', order });
    expect(standings(t).map((r) => r.id)).toEqual(order);
    t = act(t, { type: 'advance' });
    expect(t.champion).toBe(order[0]);
    const other = complete(make(4));
    expect(() =>
      act(other, {
        type: 'resolveOrder',
        order: standings(other)
          .map((r) => r.id)
          .reverse(),
      }),
    ).toThrow('Only players');
  });
  it('clears manual order after a league result is changed', () => {
    let t = complete(make(3), true);
    t = act(t, { type: 'resolveOrder', order: t.players.map((p) => p.id) });
    t = act(t, { type: 'score', matchId: t.matches[0].id, home: 1, away: 0, confirmEdit: true });
    expect(t.manualOrder).toEqual([]);
  });
  it('uses configurable scoring and tie-break order', () => {
    let t = make(2);
    t.settings = {
      ...t.settings,
      win: 5,
      draw: 2,
      loss: 1,
      tieRules: ['wins', 'points', 'gf', 'gd', 'h2h'],
    };
    t = act(t, { type: 'start' });
    t = act(t, { type: 'score', matchId: t.matches[0].id, home: 1, away: 0, confirmEdit: false });
    expect(standings(t).map((r) => r.points)).toEqual([5, 1]);
  });
  it('uses a tied-group head-to-head mini-table rather than non-transitive pair comparisons', () => {
    let t = make(3);
    t.settings = { ...t.settings, repetitions: 1, tieRules: ['points', 'h2h', 'gd', 'gf', 'wins'] };
    t = act(t, { type: 'start' });
    const [a, b, c] = t.players.map((p) => p.id);
    const outcomes = [
      { home: a, away: b, h: 2, v: 0 },
      { home: b, away: c, h: 1, v: 0 },
      { home: c, away: a, h: 1, v: 0 },
    ];
    for (const o of outcomes) {
      const m = t.matches.find(
        (m) => [m.home, m.away].includes(o.home) && [m.home, m.away].includes(o.away),
      )!;
      t = act(t, {
        type: 'score',
        matchId: m.id,
        home: m.home === o.home ? o.h : o.v,
        away: m.home === o.home ? o.v : o.h,
        confirmEdit: false,
      });
    }
    expect(standings(t).map((r) => r.id)).toEqual([a, c, b]);
    expect(standings(t).map((r) => r.points)).toEqual([3, 3, 3]);
  });
});
describe('knockout stage integrity', () => {
  for (const size of [2, 4, 8])
    for (const legs of [1, 2])
      it(`seeds top ${size} and advances ${legs}-leg ties to champion`, () => {
        let t = complete(make(size, size, legs));
        expect(t.status).toBe('league_complete');
        expect(t.ties).toHaveLength(0);
        const rows = standings(t);
        t = act(t, { type: 'advance' });
        const seeds =
          size === 8
            ? [
                [0, 7],
                [3, 4],
                [1, 6],
                [2, 5],
              ]
            : size === 4
              ? [
                  [0, 3],
                  [1, 2],
                ]
              : [[0, 1]];
        expect(t.ties.map((tie) => [tie.a, tie.b])).toEqual(
          seeds.map(([a, b]) => [rows[a].id, rows[b].id]),
        );
        while (t.status !== 'completed') {
          const m = t.matches.find((m) => m.stage === 'knockout' && !played(m))!;
          expect(m).toBeTruthy();
          t = act(t, {
            type: 'score',
            matchId: m.id,
            home: m.leg === 1 ? 2 : 0,
            away: m.leg === 1 ? 0 : 1,
            confirmEdit: false,
          });
        }
        expect(t.champion).toBe(rows[0].id);
        for (let round = 2; round <= Math.log2(size); round++) {
          const previous = t.ties.filter((tie) => tie.round === round - 1);
          const next = t.ties.filter((tie) => tie.round === round);
          expect(next.map((tie) => [tie.a, tie.b])).toEqual(
            Array.from({ length: previous.length / 2 }, (_, i) => [
              previous[i * 2].winner,
              previous[i * 2 + 1].winner,
            ]),
          );
        }
        expect(t.ties).toHaveLength(size - 1);
        expect(t.matches.filter((m) => m.stage === 'knockout')).toHaveLength((size - 1) * legs);
        expect(standings(t)).toEqual(rows);
      });
  it('calculates reversed-leg aggregate and requires a valid penalty decider on a draw', () => {
    let t = act(complete(make(2, 2, 2)), { type: 'advance' });
    const tie = t.ties[0];
    const games = t.matches.filter((m) => m.tieId === tie.id);
    t = act(t, { type: 'score', matchId: games[0].id, home: 2, away: 1, confirmEdit: false });
    t = act(t, { type: 'score', matchId: games[1].id, home: 2, away: 1, confirmEdit: false });
    expect(aggregate(t, t.ties[0])).toEqual({ a: 3, b: 3, complete: true });
    expect(t.status).toBe('final');
    expect(t.champion).toBeNull();
    expect(() =>
      act(t, {
        type: 'resolveTie',
        tieId: tie.id,
        winner: tie.a,
        method: 'penalties',
        penaltiesA: 3,
        penaltiesB: 4,
        extraTime: true,
      }),
    ).toThrow('winner');
    t = act(t, {
      type: 'resolveTie',
      tieId: tie.id,
      winner: tie.a,
      method: 'penalties',
      penaltiesA: 4,
      penaltiesB: 3,
      extraTime: true,
    });
    expect(t.champion).toBe(tie.a);
    expect(t.status).toBe('completed');
  });
  it('supports a manual quarter-final winner, rejects arbitrary players, and enforces its decider', () => {
    let t = act(complete(make(8, 8)), { type: 'advance' });
    const tie = t.ties[0],
      m = t.matches.find((m) => m.tieId === tie.id)!;
    t = act(t, { type: 'score', matchId: m.id, home: 0, away: 0, confirmEdit: false });
    expect(() =>
      act(t, {
        type: 'resolveTie',
        tieId: tie.id,
        winner: crypto.randomUUID(),
        method: 'manual',
        extraTime: false,
      }),
    ).toThrow('player');
    t.settings.resolution = 'penalties';
    expect(() =>
      act(t, {
        type: 'resolveTie',
        tieId: tie.id,
        winner: tie.a,
        method: 'manual',
        extraTime: false,
      }),
    ).toThrow('not allowed');
    t.settings.resolution = 'manual';
    t = act(t, {
      type: 'resolveTie',
      tieId: tie.id,
      winner: tie.b,
      method: 'manual',
      extraTime: false,
    });
    expect(t.ties.find((item) => item.id === tie.id)?.winner).toBe(tie.b);
    expect(t.champion).toBeNull();
  });
  it('locks league results after qualification and earlier knockout rounds after advancement', () => {
    let t = act(complete(make(4, 4)), { type: 'advance' });
    expect(() =>
      act(t, { type: 'score', matchId: t.matches[0].id, home: 4, away: 0, confirmEdit: true }),
    ).toThrow('locked');
    for (const m of t.matches.filter((m) => m.stage === 'knockout'))
      t = act(t, { type: 'score', matchId: m.id, home: 1, away: 0, confirmEdit: false });
    expect(t.status).toBe('final');
    const prior = t.matches.find((m) => m.stage === 'knockout')!;
    expect(() => act(t, { type: 'resetMatch', matchId: prior.id, confirmation: 'RESET' })).toThrow(
      'later',
    );
    t = act(t, { type: 'reset', scope: 'knockout', confirmation: 'RESET' });
    expect(t.status).toBe('league_complete');
    expect(t.ties).toEqual([]);
    expect(t.matches.every((m) => m.stage === 'league' && played(m))).toBe(true);
  });
  it('resetting a final clears champion and decider; league reset clears downstream state', () => {
    let t = act(complete(make(2, 2)), { type: 'advance' });
    const m = t.matches.find((m) => m.stage === 'knockout')!;
    t = act(t, { type: 'score', matchId: m.id, home: 1, away: 0, confirmEdit: false });
    expect(t.champion).not.toBeNull();
    t = act(t, { type: 'resetMatch', matchId: m.id, confirmation: 'RESET' });
    expect(t.champion).toBeNull();
    expect(t.status).toBe('final');
    t = act(t, { type: 'reset', scope: 'league', confirmation: 'RESET' });
    expect(t.ties).toEqual([]);
    expect(t.matches.every((m) => !played(m))).toBe(true);
    expect(t.status).toBe('league_active');
  });
});
describe('atomic knockout scoring', () => {
  it('saves semifinal and final penalties atomically and seeds only known winners', () => {
    let t = act(complete(make(4, 4)), { type: 'advance' });
    t.settings.resolution = 'penalties';
    const semis = [...t.ties];
    const scoreTie = (tie: (typeof t.ties)[number]) => {
      const match = t.matches.find((m) => m.tieId === tie.id)!;
      return act(t, {
        type: 'score', matchId: match.id, home: 2, away: 2, confirmEdit: false,
        knockoutResolution: {
          method: 'penalties', winner: tie.b, penaltiesA: 3, penaltiesB: 4, extraTime: true,
        },
      });
    };
    const version = t.version;
    t = scoreTie(semis[0]);
    expect(t.version).toBe(version + 1);
    expect(t.ties).toHaveLength(2);
    expect(t.ties[0].winner).toBe(semis[0].b);
    expect(t.champion).toBeNull();
    t = scoreTie(semis[1]);
    const final = t.ties.at(-1)!;
    expect([final.a, final.b]).toEqual(semis.map((tie) => tie.b));
    expect(t.status).toBe('final');
    t = scoreTie(final);
    expect(t.status).toBe('completed');
    expect(t.champion).toBe(final.b);
    expect(t.ties.at(-1)?.resolution).toMatchObject({ method: 'penalties', extraTime: true });
  });
  it('keeps a missing decider pending even after every semifinal score is saved', () => {
    let t = act(complete(make(4, 4)), { type: 'advance' });
    for (const match of t.matches.filter((m) => m.stage === 'knockout'))
      t = act(t, { type: 'score', matchId: match.id, home: 0, away: 0, confirmEdit: false });
    expect(t.ties).toHaveLength(2);
    expect(t.ties.every((tie) => tie.winner === null)).toBe(true);
    expect(t.status).toBe('knockout_active');
    expect(t.champion).toBeNull();
  });
  it('validates complete aggregates and tie-oriented penalties on a reversed second leg atomically', () => {
    let t = act(complete(make(2, 2, 2)), { type: 'advance' });
    const tie = t.ties[0];
    const games = t.matches.filter((m) => m.tieId === tie.id);
    const decider = { method: 'penalties' as const, winner: tie.b, penaltiesA: 3, penaltiesB: 4, extraTime: false };
    const first: Extract<Action, { type: 'score' }> = {
      type: 'score', matchId: games[0].id, home: 2, away: 1, confirmEdit: false,
    };
    expect(() => act(t, { ...first, knockoutResolution: decider })).toThrow('completed, tied aggregate');
    expect(t.matches.find((m) => m.id === games[0].id)?.homeScore).toBeNull();
    t = act(t, first);
    const second = { ...first, matchId: games[1].id };
    const before = structuredClone(t);
    expect(games[1].home).toBe(tie.b);
    expect(() => act(t, { ...second, home: 1, knockoutResolution: decider })).toThrow('completed, tied aggregate');
    for (const invalid of [
      { ...decider, winner: tie.a },
      { ...decider, winner: crypto.randomUUID() },
      { ...decider, penaltiesA: 4 },
      { ...decider, penaltiesB: undefined },
    ]) expect(() => act(t, { ...second, knockoutResolution: invalid })).toThrow();
    t.settings.resolution = 'manual';
    expect(() => act(t, { ...second, knockoutResolution: decider })).toThrow('not allowed');
    t.settings.resolution = before.settings.resolution;
    expect(t).toEqual(before);
    t = act(t, { ...second, knockoutResolution: decider });
    expect(aggregate(t, t.ties[0])).toEqual({ a: 3, b: 3, complete: true });
    expect(t.champion).toBe(tie.b);
  });
  it('clears deciders on edits/reset and stores extra time for the actual aggregate winner', () => {
    let t = act(complete(make(2, 2, 2)), { type: 'advance' });
    const tie = t.ties[0];
    const games = t.matches.filter((m) => m.tieId === tie.id);
    t = act(t, { type: 'score', matchId: games[0].id, home: 2, away: 0, confirmEdit: false });
    const second: Extract<Action, { type: 'score' }> = {
      type: 'score', matchId: games[1].id, home: 1, away: 0, confirmEdit: false, extraTime: true,
    };
    t = act(t, second);
    expect(t.champion).toBe(tie.a);
    expect(t.ties[0].resolution).toEqual({ method: 'score', winner: tie.a, extraTime: true });
    t = act(t, { ...second, home: 2, confirmEdit: true, extraTime: false });
    expect(t.ties[0].resolution).toBeNull();
    expect(t.ties[0].winner).toBeNull();
    expect(t.champion).toBeNull();
    t = act(t, { ...second, home: 2, confirmEdit: true,
      knockoutResolution: { method: 'manual', winner: tie.b, extraTime: true },
    });
    expect(t.champion).toBe(tie.b);
    const reset = act(t, { type: 'resetMatch', matchId: games[0].id, confirmation: 'RESET' });
    expect(reset.ties[0]).toMatchObject({ resolution: null, winner: null });
    expect(reset.champion).toBeNull();
    t = act(t, { ...second, home: 0, confirmEdit: true, extraTime: undefined });
    expect(t.ties[0].resolution).toBeNull();
    expect(t.champion).toBe(tie.a);
  });
  it('rejects knockout-only fields on league scores, including extraTime false', () => {
    const t = act(make(2), { type: 'start' });
    const score: Extract<Action, { type: 'score' }> = {
      type: 'score', matchId: t.matches[0].id, home: 1, away: 1, confirmEdit: false,
    };
    expect(() => act(t, { ...score, extraTime: false })).toThrow('only to knockout');
    expect(() => act(t, { ...score, knockoutResolution: {
      method: 'manual', winner: t.players[0].id, extraTime: false,
    } })).toThrow('only to knockout');
    expect(t.matches.every((m) => !played(m))).toBe(true);
  });
});
describe('validation and setup', () => {
  it.each([-1, 1.1, 1000, NaN, Infinity, '2', null])('rejects invalid score %s', (home) => {
    expect(
      actionSchema.safeParse({
        type: 'score',
        matchId: crypto.randomUUID(),
        home,
        away: 0,
        confirmEdit: false,
      }).success,
    ).toBe(false);
  });
  it('rejects empty, duplicate, normalized duplicate player names and duplicate IDs', () => {
    const t = make(2);
    for (const names of [
      ['', 'B'],
      ['Aswin', ' aswin '],
      ['Ａ', 'A'],
    ])
      expect(
        setupSchema.safeParse({
          settings: t.settings,
          players: t.players.map((p, i) => ({ ...p, name: names[i] })),
        }).success,
      ).toBe(false);
    expect(
      setupSchema.safeParse({
        settings: t.settings,
        players: [t.players[0], { ...t.players[1], id: t.players[0].id }],
      }).success,
    ).toBe(false);
  });
  it('rejects invalid knockout sizes, repeated tie rules, noninteger player counts and unconfirmed resets', () => {
    const t = make(2);
    expect(
      setupSchema.safeParse({ settings: { ...t.settings, knockout: 4 }, players: t.players })
        .success,
    ).toBe(false);
    expect(
      setupSchema.safeParse({
        settings: { ...t.settings, tieRules: ['points', 'points', 'gf', 'gd', 'wins'] },
        players: t.players,
      }).success,
    ).toBe(false);
    expect(
      actionSchema.safeParse({ type: 'reset', scope: 'tournament', confirmation: 'yes' }).success,
    ).toBe(false);
  });
  it('allows player/settings changes before start and locks them after', () => {
    let t = make();
    t = act(t, {
      type: 'settings',
      settings: { ...t.settings, name: 'Renamed' },
      players: t.players.slice(0, 3),
    });
    expect(t.players).toHaveLength(3);
    t = act(t, { type: 'start' });
    expect(() => act(t, { type: 'settings', settings: t.settings, players: t.players })).toThrow(
      'locked',
    );
    t = act(t, { type: 'avatar', playerId: t.players[0].id, avatar: '🔥' });
    expect(t.players[0].avatar).toBe('🔥');
  });
  it('cannot score an unknown match or advance early; reset preserves roster', () => {
    let t = make();
    expect(() => act(t, { type: 'advance' })).toThrow('all league');
    expect(() =>
      act(t, { type: 'score', matchId: crypto.randomUUID(), home: 1, away: 0, confirmEdit: false }),
    ).toThrow('not found');
    t = complete(t);
    const p = t.players;
    t = act(t, { type: 'reset', scope: 'tournament', confirmation: 'RESET' });
    expect(t.players).toEqual(p);
    expect(t.status).toBe('setup');
    expect(t.matches).toEqual([]);
  });
});

it('reopens league-only champion review when a completed result is corrected', () => {
  let t = act(complete(make(2)), { type: 'advance' });
  expect(t.champion).not.toBeNull();
  t = act(t, { type: 'score', matchId: t.matches[0].id, home: 8, away: 0, confirmEdit: true });
  expect(t.champion).toBeNull();
  expect(t.status).toBe('league_complete');
});

describe('separate league and knockout tie rules', () => {
  const scoreAction = (
    t: Tournament,
    extra: Partial<Extract<Action, { type: 'score' }>> = {},
  ): Extract<Action, { type: 'score' }> => ({
    type: 'score',
    matchId: t.matches[0].id,
    home: 2,
    away: 2,
    confirmEdit: false,
    ...extra,
  });
  const league = () => act(make(2), { type: 'start' });
  it('defaults old tournament settings to draws allowed and no penalty points policy', () => {
    const t = make(2);
    delete t.settings.leagueDrawsAllowed;
    delete t.settings.leaguePenaltyPoints;
    const settings = setupSchema.parse({ settings: t.settings, players: t.players }).settings;
    expect(settings.leagueDrawsAllowed).toBe(true);
    expect(settings.leaguePenaltyPoints).toBeNull();
    const active = act(t, { type: 'start' });
    const saved = act(active, scoreAction(active));
    expect(standings(saved).every((r) => r.draws === 1 && r.points === 1)).toBe(true);
  });
  it('an allowed 2–2 uses normal draw points and ignores knockout decider configuration', () => {
    const t = league();
    t.settings.draw = 2;
    t.settings.resolution = 'penalties';
    const saved = act(t, scoreAction(t));
    expect(
      standings(saved).every((r) => r.draws === 1 && r.points === 2 && r.gf === 2 && r.ga === 2),
    ).toBe(true);
    expect(saved.matches[0].leaguePenalties).toBeNull();
  });
  it('rejects a disallowed league draw without a penalty winner, atomically', () => {
    const t = league();
    t.settings.leagueDrawsAllowed = false;
    t.settings.leaguePenaltyPoints = { winner: 4, loser: 2 };
    const before = structuredClone(t);
    expect(() => act(t, scoreAction(t))).toThrow('penalty shootout winner');
    expect(() => act(t, scoreAction(t, { leaguePenalties: { home: 3, away: 3 } }))).toThrow(
      'determine a winner',
    );
    expect(t).toEqual(before);
  });
  it.each([null, undefined])('never assumes league penalty points when policy is %s', (policy) => {
    const t = league();
    t.settings.leagueDrawsAllowed = false;
    t.settings.leaguePenaltyPoints = policy;
    const before = structuredClone(t);
    expect(() => act(t, scoreAction(t, { leaguePenalties: { home: 5, away: 4 } }))).toThrow(
      'points are not configured',
    );
    expect(t).toEqual(before);
    expect(standings(t).every((r) => r.played === 0 && r.points === 0)).toBe(true);
    // Ordinary wins still work without a penalty-points policy.
    const saved = act(t, scoreAction(t, { home: 3, away: 1 }));
    expect(standings(saved).map((r) => r.points)).toEqual([3, 0]);
  });
  it('uses only explicitly configured shootout points, with correct W/L, form and goals', () => {
    let t = league();
    t.settings.leagueDrawsAllowed = false;
    t.settings.leaguePenaltyPoints = { winner: 4, loser: 2 };
    t.settings.tieRules = ['h2h', 'points', 'gd', 'gf', 'wins'];
    const original = t.matches[0];
    t = act(t, scoreAction(t, { leaguePenalties: { home: 4, away: 5 } }));
    const [winner, loser] = standings(t);
    expect(winner).toMatchObject({
      id: original.away,
      points: 4,
      wins: 1,
      draws: 0,
      losses: 0,
      gf: 2,
      ga: 2,
      gd: 0,
      form: ['W'],
    });
    expect(loser).toMatchObject({
      id: original.home,
      points: 2,
      wins: 0,
      draws: 0,
      losses: 1,
      gf: 2,
      ga: 2,
      gd: 0,
      form: ['L'],
    });
    t = act(t, scoreAction(t, { confirmEdit: true, leaguePenalties: { home: 6, away: 5 } }));
    expect(standings(t)[0]).toMatchObject({ id: original.home, points: 4, played: 1 });
    t = act(t, scoreAction(t, { confirmEdit: true, home: 3, away: 0 }));
    expect(t.matches[0].leaguePenalties).toBeNull();
    expect(standings(t)[0].points).toBe(3);
  });
  it('clears league shootouts on individual and league resets', () => {
    let t = league();
    t.settings.leagueDrawsAllowed = false;
    t.settings.leaguePenaltyPoints = { winner: 5, loser: 1 };
    t = act(t, scoreAction(t, { leaguePenalties: { home: 4, away: 3 } }));
    const reset = act(t, { type: 'resetMatch', matchId: t.matches[0].id, confirmation: 'RESET' });
    expect(reset.matches[0].leaguePenalties).toBeNull();
    expect(reset.matches[0].homeScore).toBeNull();
    const resetAll = act(t, { type: 'reset', scope: 'league', confirmation: 'RESET' });
    expect(resetAll.matches.every((m) => !m.leaguePenalties && !played(m))).toBe(true);
  });
  it('rejects league penalty metadata on ordinary wins or allowed draws', () => {
    const t = league();
    expect(() => act(t, scoreAction(t, { leaguePenalties: { home: 5, away: 3 } }))).toThrow(
      'only to tied league',
    );
    t.settings.leagueDrawsAllowed = false;
    expect(() =>
      act(t, scoreAction(t, { home: 1, away: 0, leaguePenalties: { home: 5, away: 3 } })),
    ).toThrow('only to tied league');
  });
  for (const size of [2, 4, 8])
    for (const legs of [1, 2]) {
      it(`requires penalties in ${size === 2 ? 'final' : 'semi-final'} (${size} qualifiers, ${legs} legs), when penalties are configured`, () => {
        let t = act(complete(make(size, size, legs)), { type: 'advance' });
        if (size === 8) {
          for (const m of t.matches.filter((m) => m.stage === 'knockout')) {
            t = act(t, {
              type: 'score',
              matchId: m.id,
              home: m.leg === 1 ? 2 : 0,
              away: m.leg === 1 ? 0 : 1,
              confirmEdit: false,
            });
          }
        }
        t.settings.resolution = 'penalties';
        const round = Math.max(...t.ties.map((k) => k.round));
        const tie = t.ties.find((k) => k.round === round)!;
        for (const m of t.matches.filter((m) => m.tieId === tie.id)) {
          t = act(t, { type: 'score', matchId: m.id, home: 2, away: 2, confirmEdit: false });
        }
        expect(t.status).not.toBe('completed');
        expect(t.champion).toBeNull();
        expect(t.ties.find((k) => k.id === tie.id)?.winner).toBeNull();
        expect(t.ties.some((k) => k.round > round)).toBe(false);
        expect(() =>
          act(t, {
            type: 'resolveTie',
            tieId: tie.id,
            winner: tie.a,
            method: 'manual',
            extraTime: false,
          }),
        ).toThrow('not allowed');
        expect(() =>
          act(t, {
            type: 'resolveTie',
            tieId: tie.id,
            winner: tie.a,
            method: 'penalties',
            penaltiesA: 3,
            penaltiesB: 3,
            extraTime: false,
          }),
        ).toThrow('non-tied penalty');
        expect(() =>
          act(t, {
            type: 'resolveTie',
            tieId: tie.id,
            winner: tie.a,
            method: 'penalties',
            extraTime: false,
          }),
        ).toThrow('non-tied penalty');
        t = act(t, {
          type: 'resolveTie',
          tieId: tie.id,
          winner: tie.b,
          method: 'penalties',
          penaltiesA: 3,
          penaltiesB: 4,
          extraTime: false,
        });
        expect(t.ties.find((k) => k.id === tie.id)?.winner).toBe(tie.b);
        if (size === 2) expect(t.champion).toBe(tie.b);
      });
    }
  it('keeps two-leg score draws separate from aggregate outcomes', () => {
    let t = act(complete(make(2, 2, 2)), { type: 'advance' });
    const tie = t.ties[0],
      games = t.matches.filter((m) => m.tieId === tie.id);
    t.settings.leagueDrawsAllowed = false;
    t = act(t, { type: 'score', matchId: games[0].id, home: 2, away: 0, confirmEdit: false });
    t = act(t, { type: 'score', matchId: games[1].id, home: 1, away: 1, confirmEdit: false });
    expect(t.champion).toBe(tie.a);
    expect(aggregate(t, t.ties[0])).toEqual({ a: 3, b: 1, complete: true });
  });
  it('rejects league penalties as a shortcut around knockout resolution', () => {
    const t = act(complete(make(2, 2)), { type: 'advance' });
    const m = t.matches.find((m) => m.stage === 'knockout')!;
    expect(() =>
      act(t, {
        type: 'score',
        matchId: m.id,
        home: 2,
        away: 2,
        leaguePenalties: { home: 4, away: 3 },
        confirmEdit: false,
      }),
    ).toThrow('only to tied league');
    expect(t.matches.find((game) => game.id === m.id)?.homeScore).toBeNull();
  });
});

// The same stored resolution applies to quarter-finals, semi-finals and finals.
for (const size of [2, 4, 8])
  for (const legs of [1, 2])
    for (const resolution of ['penalties', 'manual', 'either'] as const)
      it(`Top ${size}, ${legs} leg(s), ${resolution}: tied rounds require the configured decider through the final`, () => {
        let t = act(complete(make(size, size, legs)), { type: 'advance' });
        t.settings.resolution = resolution;
        t.settings.leagueDrawsAllowed = false;
        while (t.status !== 'completed') {
          const tie = t.ties.find((candidate) => !candidate.winner)!;
          const games = t.matches.filter((m) => m.tieId === tie.id);
          for (const [i, game] of games.entries()) {
            t = act(t, { type: 'score', matchId: game.id, home: 1, away: 1, confirmEdit: false });
            expect(t.ties.find((candidate) => candidate.id === tie.id)?.winner).toBeNull();
            expect(t.champion).toBeNull();
            if (legs === 2 && i === 0)
              expect(() =>
                act(t, {
                  type: 'resolveTie',
                  tieId: tie.id,
                  method: 'manual',
                  winner: tie.a,
                  extraTime: false,
                }),
              ).toThrow('completed, tied aggregate');
          }
          const method = resolution === 'penalties' ? 'penalties' : 'manual';
          if (resolution !== 'either') {
            expect(() =>
              act(t, {
                type: 'resolveTie',
                tieId: tie.id,
                winner: tie.a,
                method: method === 'manual' ? 'penalties' : 'manual',
                penaltiesA: 4,
                penaltiesB: 3,
                extraTime: false,
              }),
            ).toThrow('not allowed');
          }
          t = act(t, {
            type: 'resolveTie',
            tieId: tie.id,
            winner: tie.a,
            method,
            ...(method === 'penalties' ? { penaltiesA: 4, penaltiesB: 3 } : {}),
            extraTime: false,
          });
          expect(t.ties.find((candidate) => candidate.id === tie.id)?.winner).toBe(tie.a);
        }
        expect(t.ties).toHaveLength(size - 1);
        expect(t.champion).toBe(t.ties.at(-1)!.winner);
      });
