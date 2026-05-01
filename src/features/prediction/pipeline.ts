/**
 * 8-stage prediction pipeline.
 *
 * Stages 1–7 are deterministic (no LLM → no rate limit).
 * Stage 8 is one LLM synthesis call.
 *
 * The whole run is abortable via a single AbortController — every HTTP
 * request is wired to it, and between stages we check signal.aborted.
 */

import { getLastByTeam, getLiveSoccer, lookupEvent } from '@/api/sportsdb';
import { OpenRouterExhausted, predictOverUnder } from '@/api/openrouter';
import type { CachedPrediction, Match, StageResult, TeamForm, Verdict } from '@/api/types';
import { buildPoissonModel, computeH2H, computeTeamForm, pct, round1 } from './stats';
import { buildLocalVerdict } from './localVerdict';

export interface PipelineContext {
  match: Match;
  homeForm: TeamForm;
  awayForm: TeamForm;
}

export type StageId =
  | 's1-match'
  | 's2-home-form'
  | 's3-away-form'
  | 's4-h2h'
  | 's5-live'
  | 's6-poisson'
  | 's7-summary'
  | 's8-llm';

const STAGE_TITLES: Record<StageId, string> = {
  's1-match': 'Load match context',
  's2-home-form': 'Analyze home-team form (last 10)',
  's3-away-form': 'Analyze away-team form (last 10)',
  's4-h2h': 'Compute head-to-head history',
  's5-live': 'Snapshot live state',
  's6-poisson': 'Run Poisson goal model',
  's7-summary': 'Summarize signals for AI',
  's8-llm': 'AI synthesis (OpenRouter)',
};

export type StageEmit = (stage: StageResult) => void;

function mkStage(id: StageId, status: StageResult['status'] = 'pending'): StageResult {
  return { id, title: STAGE_TITLES[id], status };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Pipeline aborted', 'AbortError');
}

function reasonToHuman(reason: OpenRouterExhausted['reason']): string {
  switch (reason) {
    case 'spend-limit':
      return 'API key spend limit reached';
    case 'privacy-opt-in':
      return 'no free endpoints — check OpenRouter privacy setting';
    case 'rate-limit':
      return 'all free models rate-limited';
    case 'schema':
      return 'models returned malformed JSON';
    default:
      return 'every free model attempt failed';
  }
}

export async function runPredictionPipeline(
  eventId: string,
  emit: StageEmit,
  signal?: AbortSignal,
  preloadedMatch?: Match | null,
): Promise<CachedPrediction> {
  const start = Date.now();

  // ─── Stage 1: match ────────────────────────────────────────────────────
  // Prefer the cached match we already have from the matches list, because
  // TheSportsDB's free-key `lookupevent.php` sometimes returns a stale sample
  // event (Liverpool vs Swansea 2014) instead of the requested id. Our
  // `lookupEvent` helper rejects those, which means it can return null — in
  // that case we fall back to the preloaded match the caller passed in.
  let match: Match | null = null;
  {
    const s: StageResult = { ...mkStage('s1-match'), status: 'running', startedAt: Date.now() };
    emit(s);
    try {
      // Try the authoritative lookup first (it may fail / return null for the
      // sample-event reasons above).
      let looked: Match | null = null;
      try {
        looked = await lookupEvent(eventId, signal);
      } catch {
        // Network / transient error — we'll fall back to preloadedMatch.
        looked = null;
      }
      match = looked ?? preloadedMatch ?? null;
      if (!match) throw new Error('Match not found in TheSportsDB.');
      s.status = 'done';
      s.endedAt = Date.now();
      s.durationMs = s.endedAt - (s.startedAt ?? s.endedAt);
      s.summary = `${match.home.name} vs ${match.away.name} — ${match.leagueName}`;
      emit({ ...s });
    } catch (err) {
      s.status = signal?.aborted ? 'aborted' : 'error';
      s.error = (err as Error).message;
      emit({ ...s });
      throw err;
    }
  }
  throwIfAborted(signal);

  // ─── Stages 2 & 3 (parallel): team form ────────────────────────────────
  let homeForm: TeamForm | null = null;
  let awayForm: TeamForm | null = null;
  let homeRecent: Match[] = [];
  let awayRecent: Match[] = [];
  {
    const s2: StageResult = { ...mkStage('s2-home-form'), status: 'running', startedAt: Date.now() };
    const s3: StageResult = { ...mkStage('s3-away-form'), status: 'running', startedAt: Date.now() };
    emit(s2);
    emit(s3);
    try {
      const [homeLast, awayLast] = await Promise.all([
        getLastByTeam(match.home.id, signal),
        getLastByTeam(match.away.id, signal),
      ]);
      homeRecent = homeLast;
      awayRecent = awayLast;
      homeForm = computeTeamForm(match.home.id, match.home.name, homeLast);
      awayForm = computeTeamForm(match.away.id, match.away.name, awayLast);

      s2.status = 'done';
      s2.endedAt = Date.now();
      s2.durationMs = s2.endedAt - (s2.startedAt ?? s2.endedAt);
      s2.summary = `${round1(homeForm.avgGoalsFor)} GF · ${round1(homeForm.avgGoalsAgainst)} GA · O2.5 ${pct(homeForm.over25Rate)}`;

      s3.status = 'done';
      s3.endedAt = Date.now();
      s3.durationMs = s3.endedAt - (s3.startedAt ?? s3.endedAt);
      s3.summary = `${round1(awayForm.avgGoalsFor)} GF · ${round1(awayForm.avgGoalsAgainst)} GA · O2.5 ${pct(awayForm.over25Rate)}`;

      emit({ ...s2 });
      emit({ ...s3 });
    } catch (err) {
      s2.status = signal?.aborted ? 'aborted' : 'error';
      s3.status = signal?.aborted ? 'aborted' : 'error';
      s2.error = (err as Error).message;
      emit({ ...s2 });
      emit({ ...s3 });
      throw err;
    }
  }
  throwIfAborted(signal);

  // ─── Stage 4: H2H (uses the lists already fetched above) ──────────────
  let h2h: ReturnType<typeof computeH2H> | null = null;
  {
    const s: StageResult = { ...mkStage('s4-h2h'), status: 'running', startedAt: Date.now() };
    emit(s);
    h2h = computeH2H(match.home.id, match.away.id, homeRecent, awayRecent);
    s.status = 'done';
    s.endedAt = Date.now();
    s.durationMs = s.endedAt - (s.startedAt ?? s.endedAt);
    s.summary =
      h2h.sampleSize > 0
        ? `${h2h.sampleSize} meetings · ${round1(h2h.avgGoals)} avg goals · O2.5 ${pct(h2h.over25Rate)}`
        : 'No recent H2H sample available — will discount in model.';
    emit({ ...s });
  }
  throwIfAborted(signal);

  // ─── Stage 5: live snapshot (only if match is in play) ────────────────
  let liveSnapshot: { minute: number | null; homeScore: number | null; awayScore: number | null } | null = null;
  {
    const s: StageResult = { ...mkStage('s5-live'), status: 'running', startedAt: Date.now() };
    emit(s);
    try {
      if (match.status === 'live' || match.status === 'halftime') {
        const liveList = await getLiveSoccer(signal);
        const found = liveList.find((m) => m.id === match!.id);
        if (found) {
          liveSnapshot = {
            minute: found.minute ?? match.minute,
            homeScore: found.homeScore,
            awayScore: found.awayScore,
          };
        } else {
          liveSnapshot = { minute: match.minute, homeScore: match.homeScore, awayScore: match.awayScore };
        }
        s.summary = `${liveSnapshot.homeScore ?? 0}–${liveSnapshot.awayScore ?? 0} at ${liveSnapshot.minute ?? '?'}′`;
      } else {
        s.summary = 'Pre-match — no live adjustments needed.';
      }
      s.status = 'done';
      s.endedAt = Date.now();
      s.durationMs = s.endedAt - (s.startedAt ?? s.endedAt);
      emit({ ...s });
    } catch (err) {
      s.status = 'error';
      s.error = (err as Error).message;
      emit({ ...s });
      // Non-fatal; we can keep going
    }
  }
  throwIfAborted(signal);

  // ─── Stage 6: Poisson model ────────────────────────────────────────────
  const poisson = buildPoissonModel(homeForm, awayForm, liveSnapshot);
  {
    const s: StageResult = { ...mkStage('s6-poisson'), status: 'running', startedAt: Date.now() };
    emit(s);
    s.status = 'done';
    s.endedAt = Date.now();
    s.durationMs = s.endedAt - (s.startedAt ?? s.endedAt);
    s.summary = `λ total ${round1(poisson.lambdaTotal)} · P(O2.5) ${pct(poisson.pOver25)} · P(BTTS) ${pct(poisson.pBtts)}`;
    emit({ ...s });
  }
  throwIfAborted(signal);

  // ─── Stage 7: summary payload for the LLM ─────────────────────────────
  const llmPayload: Record<string, unknown> = {
    match: {
      league: match.leagueName,
      kickoff: match.kickoffIso,
      status: match.status,
      minute: match.minute,
      score: match.homeScore != null ? `${match.homeScore}-${match.awayScore}` : null,
    },
    home: {
      name: match.home.name,
      sampleSize: homeForm.sampleSize,
      avgGoalsFor: round1(homeForm.avgGoalsFor),
      avgGoalsAgainst: round1(homeForm.avgGoalsAgainst),
      over25Rate: homeForm.over25Rate,
      bttsRate: homeForm.bttsRate,
      cleanSheetRate: homeForm.cleanSheetRate,
      lastResults: homeForm.games.map((g) => `${g.result} ${g.goalsFor}-${g.goalsAgainst} vs ${g.opponent}`),
    },
    away: {
      name: match.away.name,
      sampleSize: awayForm.sampleSize,
      avgGoalsFor: round1(awayForm.avgGoalsFor),
      avgGoalsAgainst: round1(awayForm.avgGoalsAgainst),
      over25Rate: awayForm.over25Rate,
      bttsRate: awayForm.bttsRate,
      cleanSheetRate: awayForm.cleanSheetRate,
      lastResults: awayForm.games.map((g) => `${g.result} ${g.goalsFor}-${g.goalsAgainst} vs ${g.opponent}`),
    },
    h2h: {
      sampleSize: h2h.sampleSize,
      avgGoals: round1(h2h.avgGoals),
      over25Rate: h2h.over25Rate,
      bttsRate: h2h.bttsRate,
      recent: h2h.recent,
    },
    poisson: {
      lambdaTotal: round1(poisson.lambdaTotal),
      pOver15: poisson.pOver15,
      pOver25: poisson.pOver25,
      pOver35: poisson.pOver35,
      pBtts: poisson.pBtts,
    },
    live: liveSnapshot,
  };
  {
    const s: StageResult = { ...mkStage('s7-summary'), status: 'running', startedAt: Date.now() };
    emit(s);
    s.status = 'done';
    s.endedAt = Date.now();
    s.durationMs = s.endedAt - (s.startedAt ?? s.endedAt);
    s.summary = 'Packaged stats into structured payload.';
    emit({ ...s });
  }
  throwIfAborted(signal);

  // ─── Stage 8: LLM synthesis (falls back to local Poisson if unreachable) ──
  let verdict: Verdict;
  {
    const s: StageResult = { ...mkStage('s8-llm'), status: 'running', startedAt: Date.now() };
    emit(s);
    try {
      verdict = await predictOverUnder(llmPayload, signal);
      s.status = 'done';
      s.endedAt = Date.now();
      s.durationMs = s.endedAt - (s.startedAt ?? s.endedAt);
      s.summary = `Verdict ready via ${verdict.modelId} · overall ${verdict.overallConfidence}%`;
      emit({ ...s });
    } catch (err) {
      // Abort stays an abort — do not paper over it.
      if ((err as Error).name === 'AbortError' || signal?.aborted) {
        s.status = 'aborted';
        s.error = (err as Error).message;
        emit({ ...s });
        throw err;
      }

      // Everything else (OpenRouterExhausted or unexpected network failure)
      // falls back to the deterministic local verdict so the user still gets
      // an actionable analysis.
      const isExhausted = err instanceof OpenRouterExhausted;
      const reasonText = isExhausted
        ? reasonToHuman((err as OpenRouterExhausted).reason)
        : 'LLM unreachable';

      verdict = buildLocalVerdict(
        {
          poisson: {
            lambdaTotal: poisson.lambdaTotal,
            pOver15: poisson.pOver15,
            pOver25: poisson.pOver25,
            pOver35: poisson.pOver35,
            pBtts: poisson.pBtts,
          },
          homeForm,
          awayForm,
          h2h: {
            sampleSize: h2h.sampleSize,
            avgGoals: h2h.avgGoals,
            over25Rate: h2h.over25Rate,
            bttsRate: h2h.bttsRate,
          },
          live: liveSnapshot,
        },
        `Falling back to local Poisson model (${reasonText}).`,
      );

      s.status = 'done';
      s.endedAt = Date.now();
      s.durationMs = s.endedAt - (s.startedAt ?? s.endedAt);
      s.summary = `LLM unavailable (${reasonText}) — used local Poisson model · overall ${verdict.overallConfidence}%`;
      s.error = (err as Error).message;
      emit({ ...s });
    }
  }

  const pipelineTrace: StageResult[] = [
    { ...mkStage('s1-match'), status: 'done' },
    { ...mkStage('s2-home-form'), status: 'done' },
    { ...mkStage('s3-away-form'), status: 'done' },
    { ...mkStage('s4-h2h'), status: 'done' },
    { ...mkStage('s5-live'), status: 'done' },
    { ...mkStage('s6-poisson'), status: 'done' },
    { ...mkStage('s7-summary'), status: 'done' },
    { ...mkStage('s8-llm'), status: 'done' },
  ];

  const result: CachedPrediction = {
    eventId,
    createdAt: start,
    liveAtAnalysis: match.status === 'live' || match.status === 'halftime',
    pipeline: pipelineTrace,
    poisson: {
      lambdaTotal: poisson.lambdaTotal,
      pOver25: poisson.pOver25,
      pOver15: poisson.pOver15,
      pOver35: poisson.pOver35,
    },
    homeForm,
    awayForm,
    h2h: { sampleSize: h2h.sampleSize, avgGoals: h2h.avgGoals, over25Rate: h2h.over25Rate, bttsRate: h2h.bttsRate },
    verdict,
  };
  return result;
}
