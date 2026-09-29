import { describe, expect, it } from 'vitest';
import { standings } from '../src/lib/engine';
import {
  finishLeague,
  reachFinal,
  statusAction,
  statusTournament,
} from './tournamentStatus.fixture';

describe('authoritative tournament completion', () => {
  it('starts ongoing and stays ongoing through unfinished matches, league and semifinals', () => {
    const initial = statusTournament();
    expect(initial.status).toBe('setup');
    expect(statusAction(initial, { type: 'start' }).status).toBe('league_active');
    expect(finishLeague(initial).status).toBe('league_complete');
    const final = reachFinal();
    expect(final.status).toBe('final');
    expect(final.champion).toBeNull();
  });
  it('completes automatically on the final score without changing prior data', () => {
    const t = reachFinal();
    const before = structuredClone(t);
    const m = t.matches.at(-1)!;
    const next = statusAction(t, {
      type: 'score',
      matchId: m.id,
      home: 2,
      away: 1,
      confirmEdit: false,
    });
    expect(next.status).toBe('completed');
    expect(next.champion).toBe(m.home);
    expect(next.players).toEqual(t.players);
    expect(next.settings).toEqual(t.settings);
    expect(next.matches.filter((x) => x.id !== m.id)).toEqual(
      t.matches.filter((x) => x.id !== m.id),
    );
    expect(next.ties.slice(0, -1)).toEqual(t.ties.slice(0, -1));
    expect(standings(next)).toEqual(standings(t));
    expect(t).toEqual(before);
    expect(
      statusAction(next, { type: 'resetMatch', matchId: m.id, confirmation: 'RESET' }).status,
    ).toBe('final');
  });
  it.each(['penalties', 'manual'] as const)(
    'waits for every final leg and its %s decider',
    (method) => {
      let t = reachFinal(2);
      const final = t.ties.at(-1)!;
      for (const m of t.matches.filter((m) => m.tieId === final.id)) {
        t = statusAction(t, { type: 'score', matchId: m.id, home: 1, away: 1, confirmEdit: false });
        expect(t.status).toBe('final');
        expect(t.champion).toBeNull();
      }
      expect(() =>
        statusAction(t, {
          type: 'resolveTie',
          tieId: final.id,
          winner: final.a,
          method: 'penalties',
          penaltiesA: 3,
          penaltiesB: 3,
          extraTime: false,
        }),
      ).toThrow();
      t = statusAction(t, {
        type: 'resolveTie',
        tieId: final.id,
        winner: final.a,
        method,
        penaltiesA: 5,
        penaltiesB: 4,
        extraTime: false,
      });
      expect(t.status).toBe('completed');
      expect(t.champion).toBe(final.a);
    },
  );
});
