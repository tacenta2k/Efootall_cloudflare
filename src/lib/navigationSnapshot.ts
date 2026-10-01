import type { Snapshot } from './api';

let authGeneration = 0;

/** App calls this synchronously whenever its auth revision changes. */
export function invalidateNavigationSnapshots() {
  authGeneration++;
}

/** Capture before starting the request, never after awaiting its response. */
export function captureNavigationAuth() {
  return authGeneration;
}

export interface SnapshotHandoff {
  snapshot: Snapshot;
  authGeneration: number;
}

export function makeSnapshotHandoff(snapshot: Snapshot, generation: number): SnapshotHandoff {
  return { snapshot, authGeneration: generation };
}

/** Validate at mount as well: auth may change while the dashboard chunk loads. */
export function readNavigationSnapshot(handoff: SnapshotHandoff | undefined, code: string) {
  return handoff?.authGeneration === authGeneration && handoff.snapshot.tournament.code === code
    ? handoff.snapshot
    : null;
}
