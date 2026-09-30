import { auth } from './auth';
export { auth } from './auth';
import type { Action, Player, Settings, Tournament } from './types';
import { mergeSnapshot, type TournamentRefresh } from './tournamentRefresh';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface Snapshot {
  tournament: Tournament;
  canEdit: boolean;
}
export class TournamentConflictError extends ApiError {
  constructor(public snapshot: Snapshot) {
    super(
      409,
      'This tournament changed on another device. Review the latest values before retrying.',
    );
  }
}
export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  options: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  if (!navigator.onLine)
    throw new ApiError(0, "You're offline. Your entry is still here. Reconnect and try again.");
  const session = await auth?.auth.getSession();
  const token = session?.data.session?.access_token;
  let response: Response;
  try {
    response = await fetch('/api/' + path, {
      method,
      headers: {
        ...options.headers,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      0,
      'Unable to reach the server. Your entry is preserved. Check your connection and try again.',
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      503,
      'The tournament API is unavailable. Run the full Netlify development server or finish deployment setup.',
    );
  }
  if (!response.ok)
    throw new ApiError(response.status, data.error ?? 'Something went wrong. Please try again.');
  return data;
}
export const getTournament = (code: string) =>
  request<Snapshot>(`tournaments/${encodeURIComponent(code)}`);
export async function refreshTournament(
  code: string,
  current: Snapshot | null,
  signal: AbortSignal,
) {
  const result = await request<TournamentRefresh>(
    `tournaments/${encodeURIComponent(code)}`,
    'GET',
    undefined,
    {
      signal,
      headers: current ? { 'X-Tournament-Version': String(current.tournament.version) } : undefined,
    },
  );
  return mergeSnapshot(current, result);
}
export const create = (settings: Settings, players: Player[]) =>
  request<Snapshot>('tournaments', 'POST', { settings, players });
export const change = (t: Tournament, action: Action, version = t.version) =>
  request<Snapshot>(`tournaments/${t.code}`, 'PATCH', { version, action });
export const getAudit = (code: string) =>
  request<{ history: { id: number; action: Action; created_at: string }[] }>(
    `tournaments/${code}/audit`,
  );

export interface OwnedTournament {
  status?: Tournament['status'];
  code: string;
  name: string;
  players: number;
  knockout: number;
}
export const getMyTournaments = () => request<{ tournaments: OwnedTournament[] }>('tournaments');
export const deleteTournament = (code: string, confirmation: string) =>
  request<{ deleted: boolean }>(`tournaments/${encodeURIComponent(code)}`, 'DELETE', {
    confirmation,
  });
