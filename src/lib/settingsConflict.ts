import type { Tournament } from './types';

type Setup = Pick<Tournament, 'settings' | 'players'>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Retain local edits only where the server has not changed since editing began. */
export function reconcileSettings(base: Setup, draft: Setup, latest: Setup): Setup {
  const settings = { ...latest.settings };
  for (const key of Object.keys(draft.settings) as (keyof Setup['settings'])[]) {
    if (same(base.settings[key], latest.settings[key])) {
      Object.assign(settings, { [key]: draft.settings[key] });
    }
  }
  // Treat the roster atomically: merging additions/removals or renames by index
  // could replace a newer roster or introduce duplicate names.
  const players = same(base.players, latest.players) ? draft.players : latest.players;
  return { settings, players };
}
