import { applyAction, createTournament } from '../src/lib/engine';
import { defaultSettings, type Action, type Tournament } from '../src/lib/types';
export const statusNow = '2026-09-30T12:00:00.000Z';
export const statusAction = (t: Tournament, action: Action) => applyAction(t, action, statusNow);
export function statusTournament(legs = 1) {
  return createTournament(
    { ...defaultSettings, name: 'Status Cup', repetitions: 1, knockout: 4, legs },
    ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name) => ({
      id: crypto.randomUUID(),
      name,
      avatar: '⚽',
    })),
    'EFC-ABCDEFGH',
    statusNow,
  );
}
export function finishLeague(t = statusTournament()) {
  t = statusAction(t, { type: 'start' });
  for (const m of t.matches)
    t = statusAction(t, {
      type: 'score',
      matchId: m.id,
      home: t.players.findIndex((p) => p.id === m.home),
      away: t.players.findIndex((p) => p.id === m.away),
      confirmEdit: false,
    });
  return t;
}
export function reachFinal(legs = 1) {
  let t = statusAction(finishLeague(statusTournament(legs)), { type: 'advance' });
  for (const m of t.matches.filter((m) => m.stage === 'knockout')) {
    t = statusAction(t, {
      type: 'score',
      matchId: m.id,
      home: m.leg === 1 ? 2 : 0,
      away: m.leg === 1 ? 0 : 1,
      confirmEdit: false,
    });
  }
  return t;
}
