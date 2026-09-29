import type { Action, Match, Player, Settings, Standing, Tie, Tournament } from './types';
import { actionSchema, setupSchema } from './validation';
const id = () => crypto.randomUUID();
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function fixtures(players: Player[], repetitions: number): Match[] {
  const rotation: (string | null)[] = players.map((p) => p.id);
  if (rotation.length % 2) rotation.push(null);
  const result: Match[] = [];
  for (let leg = 1; leg <= repetitions; leg++) {
    const ring = [...rotation];
    for (let day = 1; day < ring.length; day++) {
      for (let j = 0; j < ring.length / 2; j++) {
        let a = ring[j],
          b = ring[ring.length - 1 - j];
        if (!a || !b) continue;
        if ((day + j) % 2 === 0) [a, b] = [b, a];
        if (leg % 2 === 0) [a, b] = [b, a];
        result.push({
          id: id(),
          home: a,
          away: b,
          stage: 'league',
          round: 0,
          leg,
          matchday: day,
          tieId: null,
          homeScore: null,
          awayScore: null,
          updatedAt: null,
        });
      }
      ring.splice(1, 0, ring.pop()!);
    }
  }
  return result;
}
export const played = (m: Match) => m.homeScore !== null && m.awayScore !== null;
/** League points are never inferred from a shootout winner. */
function leagueOutcome(t: Tournament, m: Match) {
  if (m.homeScore === m.awayScore && t.settings.leagueDrawsAllowed === false) {
    requireThat(
      m.leaguePenalties && m.leaguePenalties.home !== m.leaguePenalties.away,
      'Tied league matches require a penalty shootout winner.',
    );
    const policy = t.settings.leaguePenaltyPoints;
    requireThat(
      policy,
      'League penalty points are not configured. This tied result cannot be finalized until an explicit points policy is configured.',
    );
    const homeWon = m.leaguePenalties.home > m.leaguePenalties.away;
    return {
      winner: homeWon ? m.home : m.away,
      homePoints: homeWon ? policy.winner : policy.loser,
      awayPoints: homeWon ? policy.loser : policy.winner,
    };
  }
  return {
    winner: m.homeScore === m.awayScore ? null : m.homeScore! > m.awayScore! ? m.home : m.away,
    homePoints:
      m.homeScore! > m.awayScore!
        ? t.settings.win
        : m.homeScore === m.awayScore
          ? t.settings.draw
          : t.settings.loss,
    awayPoints:
      m.awayScore! > m.homeScore!
        ? t.settings.win
        : m.homeScore === m.awayScore
          ? t.settings.draw
          : t.settings.loss,
  };
}
/** Every knockout round requires a winner using the configured decider. */
export function knockoutResolution(t: Tournament): Settings['resolution'] {
  return t.settings.resolution;
}
export function standings(t: Tournament): Standing[] {
  const rows: Standing[] = t.players.map((p) => ({
    ...p,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    points: 0,
    form: [],
    tied: false,
    rank: 0,
  }));
  const map = new Map(rows.map((r) => [r.id, r]));
  const matches = t.matches
    .filter((m) => m.stage === 'league' && played(m))
    .sort((a, b) => a.leg - b.leg || a.matchday - b.matchday || a.id.localeCompare(b.id));
  for (const m of matches) {
    const a = map.get(m.home)!,
      b = map.get(m.away)!;
    const h = m.homeScore!,
      v = m.awayScore!;
    a.played++;
    b.played++;
    a.gf += h;
    a.ga += v;
    b.gf += v;
    b.ga += h;
    const outcome = leagueOutcome(t, m);
    a.points += outcome.homePoints;
    b.points += outcome.awayPoints;
    if (!outcome.winner) {
      a.draws++;
      b.draws++;
      a.form.push('D');
      b.form.push('D');
    } else {
      const w = outcome.winner === a.id ? a : b,
        l = outcome.winner === a.id ? b : a;
      w.wins++;
      l.losses++;
      w.form.push('W');
      l.form.push('L');
    }
  }
  rows.forEach((r) => {
    r.gd = r.gf - r.ga;
    r.form = r.form.slice(-5);
  });
  // Partition equal groups at each rule. Head-to-head uses a mini-table for the
  // entire tied group, avoiding non-transitive pairwise comparisons.
  let groups: Standing[][] = [rows];
  for (const rule of t.settings.tieRules) {
    groups = groups.flatMap((group) => {
      const mini = new Map(group.map((r) => [r.id, { points: 0, gd: 0, gf: 0 }]));
      if (rule === 'h2h')
        for (const m of matches) {
          const a = mini.get(m.home),
            b = mini.get(m.away);
          if (!a || !b) continue;
          const h = m.homeScore!,
            v = m.awayScore!;
          const outcome = leagueOutcome(t, m);
          a.points += outcome.homePoints;
          b.points += outcome.awayPoints;
          a.gd += h - v;
          b.gd += v - h;
          a.gf += h;
          b.gf += v;
        }
      const value = (r: Standing): number[] =>
        rule === 'h2h' ? Object.values(mini.get(r.id)!) : [r[rule]];
      const sorted = [...group].sort((a, b) => {
        const av = value(a),
          bv = value(b);
        for (let i = 0; i < av.length; i++) {
          if (av[i] !== bv[i]) return bv[i] - av[i];
        }
        return a.id.localeCompare(b.id);
      });
      const partitions: Standing[][] = [];
      for (const r of sorted) {
        const prev = partitions.at(-1);
        if (prev && value(prev[0]).join(',') === value(r).join(',')) prev.push(r);
        else partitions.push([r]);
      }
      return partitions;
    });
  }
  let rank = 1;
  return groups.flatMap((group) => {
    const resolved = group.length > 1 && t.manualOrder.length === rows.length;
    if (resolved) group.sort((a, b) => t.manualOrder.indexOf(a.id) - t.manualOrder.indexOf(b.id));
    group.forEach((r, i) => {
      r.tied = group.length > 1 && !resolved;
      r.rank = resolved ? rank + i : rank;
    });
    rank += group.length;
    return group;
  });
}
export function createTournament(
  settings: Settings,
  players: Player[],
  code: string,
  now: string,
): Tournament {
  const valid = setupSchema.parse({ settings, players });
  return {
    id: id(),
    code,
    settings: valid.settings,
    players: valid.players,
    matches: [],
    ties: [],
    status: 'setup',
    champion: null,
    manualOrder: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
export function aggregate(t: Tournament, tie: Tie) {
  let a = 0,
    b = 0;
  const games = t.matches.filter((m) => m.tieId === tie.id);
  for (const m of games)
    if (played(m)) {
      a += m.home === tie.a ? m.homeScore! : m.awayScore!;
      b += m.home === tie.b ? m.homeScore! : m.awayScore!;
    }
  return { a, b, complete: games.length === t.settings.legs && games.every(played) };
}
function addRound(t: Tournament, pairs: string[][], round: number) {
  for (const [position, [a, b]] of pairs.entries()) {
    const tie: Tie = { id: id(), round, position, a, b, winner: null, resolution: null };
    t.ties.push(tie);
    for (let leg = 1; leg <= t.settings.legs; leg++)
      t.matches.push({
        id: id(),
        home: leg === 1 ? a : b,
        away: leg === 1 ? b : a,
        stage: 'knockout',
        round,
        leg,
        matchday: position + 1,
        tieId: tie.id,
        homeScore: null,
        awayScore: null,
        updatedAt: null,
      });
  }
  t.status = pairs.length === 1 ? 'final' : 'knockout_active';
}
function updateKnockout(t: Tournament) {
  const round = Math.max(...t.ties.map((t) => t.round));
  const current = t.ties
    .filter((tie) => tie.round === round)
    .sort((a, b) => a.position - b.position);
  for (const tie of current) {
    const agg = aggregate(t, tie);
    tie.winner = agg.complete
      ? agg.a > agg.b
        ? tie.a
        : agg.b > agg.a
          ? tie.b
          : (tie.resolution?.winner ?? null)
      : null;
  }
  if (!current.every((tie) => tie.winner)) return;
  if (current.length === 1) {
    t.champion = current[0].winner;
    t.status = 'completed';
    return;
  }
  const pairs: string[][] = [];
  for (let i = 0; i < current.length; i += 2)
    pairs.push([current[i].winner!, current[i + 1].winner!]);
  addRound(t, pairs, round + 1);
}
export function applyAction(original: Tournament, input: Action, now: string): Tournament {
  const action = actionSchema.parse(input);
  const t = structuredClone(original);
  if (action.type === 'settings') {
    requireThat(
      t.status === 'setup',
      'Settings and names are locked after kickoff. Reset the tournament to edit them.',
    );
    const valid = setupSchema.parse({ settings: action.settings, players: action.players });
    t.settings = valid.settings;
    t.players = valid.players;
  }
  if (action.type === 'avatar') {
    const p = t.players.find((p) => p.id === action.playerId);
    requireThat(p, 'Player not found.');
    p.avatar = action.avatar;
  }
  if (action.type === 'start') {
    requireThat(t.status === 'setup', 'This tournament has already started.');
    t.matches = fixtures(t.players, t.settings.repetitions);
    t.status = 'league_active';
  }
  if (action.type === 'score' || action.type === 'resetMatch') {
    const m = t.matches.find((m) => m.id === action.matchId);
    requireThat(m, 'Match not found in this tournament.');
    if (m.stage === 'league') {
      requireThat(
        ['league_active', 'league_complete'].includes(t.status) ||
          (t.status === 'completed' && !t.settings.knockout),
        'League results are locked. Reset the knockout stage before changing qualification.',
      );
      t.manualOrder = [];
      t.champion = null;
    } else {
      requireThat(
        !t.ties.some((tie) => tie.round > m.round),
        'A later knockout round exists. Reset the knockout stage to change this result.',
      );
      const tie = t.ties.find((tie) => tie.id === m.tieId)!;
      tie.resolution = null;
      tie.winner = null;
      t.champion = null;
      t.status =
        t.ties.filter((tie) => tie.round === m.round).length === 1 ? 'final' : 'knockout_active';
    }
    if (action.type === 'score') {
      requireThat(
        !played(m) || action.confirmEdit,
        'This match already has a result. Confirm the edit.',
      );
      m.homeScore = action.home;
      m.awayScore = action.away;
      const needsLeaguePenalties =
        m.stage === 'league' &&
        t.settings.leagueDrawsAllowed === false &&
        action.home === action.away;
      requireThat(
        !action.leaguePenalties || needsLeaguePenalties,
        'League penalties apply only to tied league matches with draws disallowed.',
      );
      m.leaguePenalties = needsLeaguePenalties ? (action.leaguePenalties ?? null) : null;
      if (m.stage === 'league') leagueOutcome(t, m); // Reject missing winner or unspecified points atomically.
    } else {
      m.homeScore = null;
      m.awayScore = null;
      m.leaguePenalties = null;
    }
    m.updatedAt = now;
    if (m.stage === 'league')
      t.status = t.matches.filter((m) => m.stage === 'league').every(played)
        ? 'league_complete'
        : 'league_active';
    else updateKnockout(t);
  }
  if (action.type === 'resolveOrder') {
    requireThat(t.status === 'league_complete', 'Finish the league before resolving ties.');
    requireThat(
      action.order.length === t.players.length &&
        new Set(action.order).size === t.players.length &&
        action.order.every((id) => t.players.some((p) => p.id === id)),
      'Include every player exactly once.',
    );
    const rows = standings({ ...t, manualOrder: [] });
    for (let i = 0; i < action.order.length; i++) {
      const r = rows.find((r) => r.id === action.order[i])!;
      requireThat(
        r.rank === rows[i].rank,
        'Only players in a completely tied group may be reordered.',
      );
    }
    t.manualOrder = action.order;
  }
  if (action.type === 'advance') {
    requireThat(t.status === 'league_complete', 'Record all league results before advancing.');
    const rows = standings(t);
    const count = t.settings.knockout || 1;
    requireThat(
      !rows.slice(0, count).some((r) => r.tied),
      'Resolve tied qualification positions before advancing.',
    );
    if (!t.settings.knockout) {
      t.champion = rows[0].id;
      t.status = 'completed';
    } else {
      const seeds =
        t.settings.knockout === 8
          ? [0, 7, 3, 4, 1, 6, 2, 5]
          : t.settings.knockout === 4
            ? [0, 3, 1, 2]
            : [0, 1];
      const pairs: string[][] = [];
      for (let i = 0; i < seeds.length; i += 2)
        pairs.push([rows[seeds[i]].id, rows[seeds[i + 1]].id]);
      addRound(t, pairs, 1);
    }
  }
  if (action.type === 'resolveTie') {
    const tie = t.ties.find((tie) => tie.id === action.tieId);
    requireThat(tie, 'Knockout tie not found.');
    requireThat(
      !t.ties.some((other) => other.round > tie.round),
      'A later knockout round already exists.',
    );
    const agg = aggregate(t, tie);
    requireThat(
      agg.complete && agg.a === agg.b,
      'Only a completed, tied aggregate needs a decider.',
    );
    requireThat([tie.a, tie.b].includes(action.winner), 'Winner must be a player in this tie.');
    const resolution = knockoutResolution(t);
    requireThat(
      resolution === 'either' || resolution === action.method,
      'This decider is not allowed by the tournament rules. Use the configured knockout resolution.',
    );
    if (action.method === 'penalties') {
      requireThat(
        action.penaltiesA !== undefined &&
          action.penaltiesB !== undefined &&
          action.penaltiesA !== action.penaltiesB,
        'Enter a non-tied penalty score.',
      );
      requireThat(
        action.winner === (action.penaltiesA > action.penaltiesB ? tie.a : tie.b),
        'Penalty winner does not match the score.',
      );
    }
    tie.resolution = {
      method: action.method,
      winner: action.winner,
      penaltiesA: action.penaltiesA,
      penaltiesB: action.penaltiesB,
      extraTime: action.extraTime,
    };
    updateKnockout(t);
  }
  if (action.type === 'reset') {
    t.champion = null;
    t.ties = [];
    t.manualOrder = [];
    t.matches = t.matches.filter((m) => m.stage === 'league');
    if (action.scope === 'tournament') {
      t.matches = [];
      t.status = 'setup';
    } else if (action.scope === 'league') {
      t.matches.forEach((m) => {
        m.homeScore = null;
        m.awayScore = null;
        m.leaguePenalties = null;
        m.updatedAt = now;
      });
      t.status = t.matches.length ? 'league_active' : 'setup';
    } else {
      requireThat(t.matches.length > 0, 'Start the league first.');
      t.status = t.matches.every(played) ? 'league_complete' : 'league_active';
    }
  }
  t.version++;
  t.updatedAt = now;
  return t;
}
