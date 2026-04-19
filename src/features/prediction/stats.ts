/**
 * Deterministic statistical layer for the prediction engine.
 * No LLM calls here — just clean math over TheSportsDB data.
 */

import type { Match, TeamForm, TeamFormGame } from '@/api/types';

// ─── helpers ──────────────────────────────────────────────────────────────

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

/** Poisson PMF: P(X = k | λ). */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/** Probability of a total-goals Poisson variable being >= line+1. */
export function pOver(line: number, lambda: number): number {
  // Over X.5 means total >= X+1. Sum PMF from 0..X and subtract.
  const floor = Math.floor(line);
  let cdf = 0;
  for (let k = 0; k <= floor; k++) cdf += poissonPmf(k, lambda);
  return Math.max(0, Math.min(1, 1 - cdf));
}

/** Simple BTTS probability from two independent Poisson rates. */
export function pBtts(lambdaHome: number, lambdaAway: number): number {
  const pHomeZero = poissonPmf(0, lambdaHome);
  const pAwayZero = poissonPmf(0, lambdaAway);
  return Math.max(0, Math.min(1, 1 - pHomeZero - pAwayZero + pHomeZero * pAwayZero));
}

// ─── team form ────────────────────────────────────────────────────────────

export function computeTeamForm(teamId: string, teamName: string, recentMatches: Match[]): TeamForm {
  const games: TeamFormGame[] = recentMatches
    .filter((m) => m.status === 'finished' && m.homeScore != null && m.awayScore != null)
    .slice(0, 10)
    .map((m) => {
      const isHome = m.home.id === teamId;
      const gf = isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0);
      const ga = isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0);
      const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      return {
        eventId: m.id,
        date: m.kickoffIso,
        opponent: isHome ? m.away.name : m.home.name,
        isHome,
        goalsFor: gf,
        goalsAgainst: ga,
        result,
      };
    });

  const n = games.length;
  if (n === 0) {
    return {
      teamId,
      teamName,
      games: [],
      avgGoalsFor: 0,
      avgGoalsAgainst: 0,
      over25Rate: 0,
      bttsRate: 0,
      cleanSheetRate: 0,
      sampleSize: 0,
    };
  }

  const totalGF = games.reduce((s, g) => s + g.goalsFor, 0);
  const totalGA = games.reduce((s, g) => s + g.goalsAgainst, 0);
  const over25 = games.filter((g) => g.goalsFor + g.goalsAgainst > 2.5).length;
  const btts = games.filter((g) => g.goalsFor > 0 && g.goalsAgainst > 0).length;
  const cs = games.filter((g) => g.goalsAgainst === 0).length;

  return {
    teamId,
    teamName,
    games,
    avgGoalsFor: totalGF / n,
    avgGoalsAgainst: totalGA / n,
    over25Rate: over25 / n,
    bttsRate: btts / n,
    cleanSheetRate: cs / n,
    sampleSize: n,
  };
}

// ─── H2H ──────────────────────────────────────────────────────────────────

export interface H2HSummary {
  sampleSize: number;
  avgGoals: number;
  over25Rate: number;
  bttsRate: number;
  recent: Array<{ date: string | null; home: string; away: string; score: string }>;
}

export function computeH2H(
  homeId: string,
  awayId: string,
  homeRecent: Match[],
  awayRecent: Match[],
): H2HSummary {
  const meetings = new Map<string, Match>();
  for (const m of [...homeRecent, ...awayRecent]) {
    const inMatchup =
      (m.home.id === homeId && m.away.id === awayId) || (m.home.id === awayId && m.away.id === homeId);
    if (inMatchup && m.status === 'finished' && m.homeScore != null && m.awayScore != null) {
      meetings.set(m.id, m);
    }
  }
  const list = Array.from(meetings.values()).sort((a, b) => {
    const da = a.kickoffIso ? new Date(a.kickoffIso).getTime() : 0;
    const db = b.kickoffIso ? new Date(b.kickoffIso).getTime() : 0;
    return db - da;
  });

  const n = list.length;
  if (n === 0) {
    return { sampleSize: 0, avgGoals: 0, over25Rate: 0, bttsRate: 0, recent: [] };
  }

  const totalGoals = list.reduce((s, m) => s + (m.homeScore ?? 0) + (m.awayScore ?? 0), 0);
  const over25 = list.filter((m) => (m.homeScore ?? 0) + (m.awayScore ?? 0) > 2.5).length;
  const btts = list.filter((m) => (m.homeScore ?? 0) > 0 && (m.awayScore ?? 0) > 0).length;

  return {
    sampleSize: n,
    avgGoals: totalGoals / n,
    over25Rate: over25 / n,
    bttsRate: btts / n,
    recent: list.slice(0, 5).map((m) => ({
      date: m.kickoffIso,
      home: m.home.name,
      away: m.away.name,
      score: `${m.homeScore}-${m.awayScore}`,
    })),
  };
}

// ─── expected-goals proxy ─────────────────────────────────────────────────

export interface PoissonModel {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  pOver15: number;
  pOver25: number;
  pOver35: number;
  pBtts: number;
}

/**
 * Expected-goals proxy from team form.
 * Home λ  ≈ avg(HomeGF, AwayGA) — i.e. how much the home attack usually scores
 *            against the typical defense AND how many the away defense typically concedes.
 * Away λ  ≈ avg(AwayGF, HomeGA).
 * Total λ = home λ + away λ.
 *
 * Live-aware: if minute is known and > 0, we shrink lambda by the remaining share of the match
 * and add the current score back in, producing the expected final total.
 */
export function buildPoissonModel(
  homeForm: TeamForm,
  awayForm: TeamForm,
  live?: { minute: number | null; homeScore: number | null; awayScore: number | null } | null,
): PoissonModel {
  const baseHomeLambda = (homeForm.avgGoalsFor + awayForm.avgGoalsAgainst) / 2 || 1.3;
  const baseAwayLambda = (awayForm.avgGoalsFor + homeForm.avgGoalsAgainst) / 2 || 1.1;

  let lambdaHome = baseHomeLambda;
  let lambdaAway = baseAwayLambda;
  let currentHome = 0;
  let currentAway = 0;

  if (live && live.minute != null && live.minute > 0) {
    const remaining = Math.max(0, 90 - live.minute) / 90;
    lambdaHome = baseHomeLambda * remaining;
    lambdaAway = baseAwayLambda * remaining;
    currentHome = live.homeScore ?? 0;
    currentAway = live.awayScore ?? 0;
  }

  const lambdaTotal = lambdaHome + lambdaAway;
  const played = currentHome + currentAway;

  // If a match is in play, the "Over 2.5" probability is P(total_remaining >= 3 - played)
  const needOver15 = Math.max(0, 1.5 - played);
  const needOver25 = Math.max(0, 2.5 - played);
  const needOver35 = Math.max(0, 3.5 - played);

  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaTotal + played,
    pOver15: pOver(needOver15, lambdaTotal),
    pOver25: pOver(needOver25, lambdaTotal),
    pOver35: pOver(needOver35, lambdaTotal),
    pBtts:
      played > 0 && currentHome > 0 && currentAway > 0 ? 1 : pBtts(lambdaHome + currentHome, lambdaAway + currentAway),
  };
}

// ─── utility for UI ────────────────────────────────────────────────────────

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const round1 = (n: number) => Math.round(n * 10) / 10;
