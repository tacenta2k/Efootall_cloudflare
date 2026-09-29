import { describe, expect, it } from 'vitest';
import { reconcileSettings } from '../src/lib/settingsConflict';
import { defaultSettings } from '../src/lib/types';

const base = {
  settings: { ...defaultSettings, name: 'Original cup' },
  players: [{ id: 'player-a', name: 'Aswin', avatar: '⚽' }],
};

describe('settings conflict reconciliation', () => {
  it('keeps unrelated local edits and newer server values, including overlapping edits', () => {
    const draft = { ...base, settings: { ...base.settings, name: 'My cup', win: 5 } };
    const latest = { ...base, settings: { ...base.settings, name: 'Server cup', loss: 1 } };
    expect(reconcileSettings(base, draft, latest).settings).toEqual({
      ...latest.settings,
      win: 5,
    });
  });

  it('keeps local roster edits only if the server roster has not changed', () => {
    const draft = { ...base, players: [{ ...base.players[0], name: 'My edit' }] };
    expect(reconcileSettings(base, draft, base).players).toEqual(draft.players);
    const latest = { ...base, players: [{ ...base.players[0], avatar: '🔥' }] };
    expect(reconcileSettings(base, draft, latest).players).toEqual(latest.players);
  });

  it('does not replace newer rule arrays or points policies', () => {
    const draft = {
      ...base,
      settings: { ...base.settings, tieRules: [...base.settings.tieRules].reverse() },
    };
    const latest = {
      ...base,
      settings: {
        ...base.settings,
        tieRules: ['wins', 'points', 'gd', 'gf', 'h2h'] as typeof defaultSettings.tieRules,
        leaguePenaltyPoints: { winner: 4, loser: 2 },
      },
    };
    expect(reconcileSettings(base, draft, latest).settings).toEqual(latest.settings);
  });
});
