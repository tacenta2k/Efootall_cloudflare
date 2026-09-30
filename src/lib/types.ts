export const tieRules = ['points', 'gd', 'gf', 'h2h', 'wins'] as const;
export type TieRule = (typeof tieRules)[number];
export type Status =
  | 'setup'
  | 'league_active'
  | 'league_complete'
  | 'knockout_active'
  | 'final'
  | 'completed';
export interface Settings {
  name: string;
  repetitions: number;
  win: number;
  draw: number;
  loss: number;
  // Missing fields in older tournaments preserve ordinary league draws.
  leagueDrawsAllowed?: boolean;
  leaguePenaltyPoints?: { winner: number; loser: number } | null;
  knockout: number;
  legs: number;
  tieRules: TieRule[];
  resolution: 'penalties' | 'manual' | 'either';
}
export interface Player {
  id: string;
  name: string;
  /** Existing emoji text or a compact logo:<owner>/<asset>.webp|png storage reference. */
  avatar: string;
}
export interface Match {
  id: string;
  home: string;
  away: string;
  stage: 'league' | 'knockout';
  round: number;
  leg: number;
  matchday: number;
  tieId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  leaguePenalties?: { home: number; away: number } | null;
  updatedAt: string | null;
}
export interface KnockoutResolution {
  method: 'penalties' | 'manual';
  winner: string;
  penaltiesA?: number;
  penaltiesB?: number;
  extraTime: boolean;
}
export interface Tie {
  id: string;
  round: number;
  position: number;
  a: string;
  b: string;
  winner: string | null;
  resolution: {
    method: 'penalties' | 'manual' | 'score';
    winner: string;
    penaltiesA?: number;
    penaltiesB?: number;
    extraTime: boolean;
  } | null;
}
export interface Tournament {
  id: string;
  code: string;
  settings: Settings;
  players: Player[];
  matches: Match[];
  ties: Tie[];
  status: Status;
  champion: string | null;
  manualOrder: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface Standing extends Player {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  form: ('W' | 'D' | 'L')[];
  tied: boolean;
  rank: number;
}
export type Action =
  | { type: 'start' }
  | { type: 'settings'; settings: Settings; players: Player[] }
  | { type: 'avatar'; playerId: string; avatar: string }
  | {
      type: 'score';
      matchId: string;
      home: number;
      away: number;
      confirmEdit: boolean;
      leaguePenalties?: { home: number; away: number };
      knockoutResolution?: KnockoutResolution;
      extraTime?: boolean;
    }
  | { type: 'resetMatch'; matchId: string; confirmation: 'RESET' }
  | { type: 'advance' }
  | { type: 'resolveOrder'; order: string[] }
  | {
      type: 'resolveTie';
      tieId: string;
      winner: string;
      method: 'penalties' | 'manual';
      penaltiesA?: number;
      penaltiesB?: number;
      extraTime: boolean;
    }
  | { type: 'reset'; scope: 'league' | 'tournament' | 'knockout'; confirmation: 'RESET' };
export const defaultSettings: Settings = {
  name: '',
  repetitions: 2,
  win: 3,
  draw: 1,
  loss: 0,
  leagueDrawsAllowed: true,
  leaguePenaltyPoints: null,
  knockout: 4,
  legs: 1,
  tieRules: [...tieRules],
  resolution: 'either',
};
