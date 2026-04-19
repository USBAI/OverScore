/**
 * Deterministic verdict synthesized from the Poisson model + form.
 *
 * Used as a fallback when every OpenRouter free model is rate-limited,
 * 404'd, or returns malformed JSON. That way the pipeline ALWAYS ends
 * with results the user can act on — the LLM just adds nuance when it
 * happens to be reachable.
 *
 * Math:
 *   For a market with probability p, the "confidence" of the majority
 *   selection is |p - 0.5| × 200, clamped to [45, 92]. The floor of 45
 *   reflects the fact that even a 50/50 Poisson call is mildly informed
 *   by the form inputs that produced it; the ceiling of 92 prevents the
 *   deterministic model from pretending to be over-certain.
 */

import type { TeamForm, Verdict, VerdictPick } from '@/api/types';

interface LocalInputs {
  poisson: {
    lambdaTotal: number;
    pOver15: number;
    pOver25: number;
    pOver35: number;
    pBtts: number;
  };
  homeForm: TeamForm;
  awayForm: TeamForm;
  h2h: { sampleSize: number; avgGoals: number; over25Rate: number; bttsRate: number };
  live: { minute: number | null; homeScore: number | null; awayScore: number | null } | null;
}

function confidenceFromP(p: number): number {
  const raw = Math.abs(p - 0.5) * 200;
  return Math.round(Math.max(45, Math.min(92, raw)));
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function r1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function makeOverUnderPick(
  market: 'OU 1.5' | 'OU 2.5' | 'OU 3.5',
  p: number,
  context: string,
): VerdictPick {
  const over = p >= 0.5;
  return {
    market,
    selection: over ? 'Over' : 'Under',
    confidencePct: confidenceFromP(p),
    rationale: `P(Over ${market.split(' ')[1]}) = ${pct(p)} from Poisson on ${context}.`,
  };
}

function makeBttsPick(p: number, context: string): VerdictPick {
  const yes = p >= 0.5;
  return {
    market: 'BTTS',
    selection: yes ? 'Yes' : 'No',
    confidencePct: confidenceFromP(p),
    rationale: `Independent-Poisson BTTS = ${pct(p)} given ${context}.`,
  };
}

export function buildLocalVerdict(inputs: LocalInputs, reason?: string): Verdict {
  const { poisson, homeForm, awayForm, h2h, live } = inputs;

  const lambdaContext = `λ=${r1(poisson.lambdaTotal)}`;
  const bttsContext =
    `${homeForm.teamName ?? 'home'} BTTS rate ${pct(homeForm.bttsRate)} · ` +
    `${awayForm.teamName ?? 'away'} BTTS rate ${pct(awayForm.bttsRate)}`;

  const picks: VerdictPick[] = [
    makeOverUnderPick('OU 1.5', poisson.pOver15, lambdaContext),
    makeOverUnderPick('OU 2.5', poisson.pOver25, lambdaContext),
    makeOverUnderPick('OU 3.5', poisson.pOver35, lambdaContext),
    makeBttsPick(poisson.pBtts, bttsContext),
  ];

  const overall = Math.round(picks.reduce((s, p) => s + p.confidencePct, 0) / picks.length);

  const keyFactors: string[] = [
    `Poisson λ total = ${r1(poisson.lambdaTotal)}`,
    `${homeForm.teamName ?? 'Home'} 10-game O2.5 rate ${pct(homeForm.over25Rate)}`,
    `${awayForm.teamName ?? 'Away'} 10-game O2.5 rate ${pct(awayForm.over25Rate)}`,
  ];
  if (h2h.sampleSize > 0) {
    keyFactors.push(`H2H avg goals ${r1(h2h.avgGoals)} over ${h2h.sampleSize} meetings`);
  } else {
    keyFactors.push('No recent H2H sample — discounted');
  }
  if (live?.minute != null) {
    keyFactors.push(
      `Live: ${live.homeScore ?? 0}–${live.awayScore ?? 0} @ ${live.minute}′, λ scaled by remaining share`,
    );
  }

  const warning =
    (reason ? `${reason} ` : '') +
    'This verdict comes from the local Poisson model — no LLM nuance applied. Treat high-confidence picks with extra scrutiny.';

  return {
    picks,
    overallConfidence: overall,
    keyFactors,
    warning,
    modelId: 'local-poisson-v1',
  };
}
