import type { Snapshot } from './api';

export type TournamentRefresh = Snapshot | { unchanged: true; version: number; canEdit: boolean };

export function mergeSnapshot(current: Snapshot | null, incoming: TournamentRefresh): Snapshot {
  if ('unchanged' in incoming) {
    if (!current || incoming.version !== current.tournament.version)
      throw new Error('Unable to refresh tournament. Please retry.');
    return current.canEdit === incoming.canEdit
      ? current
      : { ...current, canEdit: incoming.canEdit };
  }
  if (
    !current ||
    incoming.tournament.id !== current.tournament.id ||
    incoming.tournament.version > current.tournament.version
  )
    return incoming;
  // An older poll must not overwrite a newer mutation. Permissions may still
  // change without a tournament version change; callers guard auth generations.
  return current.canEdit === incoming.canEdit ? current : { ...current, canEdit: incoming.canEdit };
}
