/**
 * TheSportsDB JSON shapes (fields we actually use).
 * The API returns many more fields; we keep only what we need, typed.
 */

export interface SdbEvent {
  idEvent: string;
  idLeague: string;
  strLeague: string;
  idHomeTeam: string;
  idAwayTeam: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strStatus?: string | null;
  strProgress?: string | null; // live minute, e.g. "67"
  dateEvent?: string | null;   // YYYY-MM-DD
  strTime?: string | null;     // HH:MM:SS
  strTimestamp?: string | null; // ISO-ish
  strVenue?: string | null;
  strSeason?: string | null;
  strThumb?: string | null;
  strPostponed?: string | null;
}

export interface SdbTeam {
  idTeam: string;
  strTeam: string;
  strTeamBadge?: string | null;
  strLeague?: string | null;
  idLeague?: string | null;
  strCountry?: string | null;
}

export interface SdbLeague {
  idLeague: string;
  strLeague: string;
  strSport?: string;
  strCountry?: string;
  strBadge?: string | null;
}

// Our normalized shapes

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'halftime'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'unknown';

export interface Match {
  id: string;
  leagueId: string;
  leagueName: string;
  home: { id: string; name: string; badge: string | null };
  away: { id: string; name: string; badge: string | null };
  kickoffIso: string | null;   // best-effort ISO timestamp
  status: MatchStatus;
  minute: number | null;       // live minute if status === live
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  season: string | null;
}

export interface TeamFormGame {
  eventId: string;
  date: string | null;
  opponent: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  result: 'W' | 'D' | 'L';
}

export interface TeamForm {
  teamId: string;
  teamName: string;
  games: TeamFormGame[];
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  over25Rate: number;
  bttsRate: number;
  cleanSheetRate: number;
  sampleSize: number;
}

export type BetMarket = 'OU 1.5' | 'OU 2.5' | 'OU 3.5' | 'BTTS';
export type BetSelection = 'Over' | 'Under' | 'Yes' | 'No';

export interface VerdictPick {
  market: BetMarket;
  selection: BetSelection;
  confidencePct: number;
  rationale: string;
}

export interface Verdict {
  picks: VerdictPick[];
  overallConfidence: number;
  keyFactors: string[];
  warning?: string;
  modelId: string;
}

export type StageStatus = 'pending' | 'running' | 'done' | 'error' | 'aborted';

export interface StageResult {
  id: string;
  title: string;
  status: StageStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
  summary?: string;
}

export interface CachedPrediction {
  eventId: string;
  createdAt: number;
  liveAtAnalysis: boolean;
  pipeline: StageResult[];
  poisson: { lambdaTotal: number; pOver25: number; pOver15: number; pOver35: number };
  homeForm: TeamForm;
  awayForm: TeamForm;
  h2h: { sampleSize: number; avgGoals: number; over25Rate: number; bttsRate: number };
  verdict: Verdict;
}
