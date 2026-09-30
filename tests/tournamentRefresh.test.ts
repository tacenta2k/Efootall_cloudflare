import { expect, it } from 'vitest';
import { mergeSnapshot } from '../src/lib/tournamentRefresh';
import { createTournament } from '../src/lib/engine';
import { defaultSettings } from '../src/lib/types';
const current = () => ({
  tournament: createTournament(
    { ...defaultSettings, name: 'Refresh cup', knockout: 0 },
    ['One', 'Two'].map((name) => ({ id: crypto.randomUUID(), name, avatar: '⚽' })),
    'EFC-ABCDEFGH',
    '2026-10-01T00:00:00.000Z',
  ),
  canEdit: true,
});
it('preserves both snapshot and tournament references for unchanged refreshes', () => {
  const s = current();
  expect(mergeSnapshot(s, { unchanged: true, version: s.tournament.version, canEdit: true })).toBe(
    s,
  );
  expect(mergeSnapshot(s, structuredClone(s))).toBe(s);
});
it('applies permission changes without replacing the tournament', () => {
  const s = current();
  const next = mergeSnapshot(s, { unchanged: true, version: s.tournament.version, canEdit: false });
  expect(next).not.toBe(s);
  expect(next.tournament).toBe(s.tournament);
  expect(next.canEdit).toBe(false);
  expect(mergeSnapshot(next, { ...structuredClone(s), canEdit: true }).canEdit).toBe(true);
});
it('accepts changed snapshots but never rolls back a newer mutation to an older poll', () => {
  const s = current();
  const next = { ...s, tournament: { ...s.tournament, version: s.tournament.version + 1 } };
  expect(mergeSnapshot(s, next)).toBe(next);
  expect(mergeSnapshot(next, s)).toBe(next);
  expect(mergeSnapshot(null, next)).toBe(next);
});
it('rejects incomplete refreshes without the matching local snapshot', () => {
  const s = current();
  expect(() => mergeSnapshot(null, { unchanged: true, version: 1, canEdit: false })).toThrow();
  expect(() => mergeSnapshot(s, { unchanged: true, version: 99, canEdit: false })).toThrow();
});
