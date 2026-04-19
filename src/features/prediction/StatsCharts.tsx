import type { CachedPrediction } from '@/api/types';
import { pct, round1 } from './stats';
import { cn } from '@/lib/utils';

/** Horizontal bar whose width is the value. Max is customizable. */
function Bar({
  label,
  value,
  max = 1,
  suffix = '',
  tone = 'primary',
  subtext,
}: {
  label: string;
  value: number;
  max?: number;
  suffix?: string;
  tone?: 'primary' | 'over' | 'under' | 'muted';
  subtext?: string;
}) {
  const pctWidth = Math.max(0, Math.min(100, (value / max) * 100));
  const color =
    tone === 'over'
      ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
      : tone === 'under'
        ? 'bg-gradient-to-r from-rose-400 to-rose-600'
        : tone === 'muted'
          ? 'bg-muted-foreground/30'
          : 'bg-gradient-to-r from-emerald-500 to-teal-600';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-emerald-900/80">{label}</span>
        <span className="font-mono text-xs tabular-nums text-emerald-950">
          {typeof value === 'number' && value < 10 ? round1(value) : Math.round(value)}
          {suffix}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-emerald-50">
        <div className={cn('h-full rounded-full transition-all duration-700 ease-out', color)} style={{ width: `${pctWidth}%` }} />
      </div>
      {subtext && <div className="mt-0.5 text-[10px] text-muted-foreground">{subtext}</div>}
    </div>
  );
}

export function StatsCharts({ p }: { p: CachedPrediction }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-4 rounded-2xl border border-emerald-100/70 bg-white/70 p-5 shadow-sm shadow-emerald-500/5 backdrop-blur-sm">
        <h3 className="font-display text-sm font-semibold tracking-tight text-emerald-950">
          Team form (last {p.homeForm.sampleSize || 0}/10)
        </h3>
        <div className="space-y-3">
          <Bar label={`${p.homeForm.teamName} · Goals for`} value={p.homeForm.avgGoalsFor} max={3} suffix=" / game" tone="over" />
          <Bar label={`${p.awayForm.teamName} · Goals for`} value={p.awayForm.avgGoalsFor} max={3} suffix=" / game" tone="over" />
          <Bar label={`${p.homeForm.teamName} · Goals against`} value={p.homeForm.avgGoalsAgainst} max={3} suffix=" / game" tone="under" />
          <Bar label={`${p.awayForm.teamName} · Goals against`} value={p.awayForm.avgGoalsAgainst} max={3} suffix=" / game" tone="under" />
          <Bar label={`${p.homeForm.teamName} · Over 2.5 rate`} value={p.homeForm.over25Rate * 100} max={100} suffix="%" />
          <Bar label={`${p.awayForm.teamName} · Over 2.5 rate`} value={p.awayForm.over25Rate * 100} max={100} suffix="%" />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-emerald-100/70 bg-white/70 p-5 shadow-sm shadow-emerald-500/5 backdrop-blur-sm">
        <h3 className="font-display text-sm font-semibold tracking-tight text-emerald-950">AI model inputs</h3>
        <div className="space-y-3">
          <Bar
            label="Poisson λ (expected total goals)"
            value={p.poisson.lambdaTotal}
            max={5}
            suffix=""
            tone="primary"
            subtext="Above 2.6 supports Over 2.5"
          />
          <Bar label="P(Over 1.5)" value={p.poisson.pOver15 * 100} max={100} suffix="%" tone="over" />
          <Bar label="P(Over 2.5)" value={p.poisson.pOver25 * 100} max={100} suffix="%" tone="over" />
          <Bar label="P(Over 3.5)" value={p.poisson.pOver35 * 100} max={100} suffix="%" tone="over" />
          <Bar
            label={`H2H avg goals (${p.h2h.sampleSize} meetings)`}
            value={p.h2h.avgGoals}
            max={5}
            subtext={p.h2h.sampleSize === 0 ? 'No history — discounted' : `O2.5 rate ${pct(p.h2h.over25Rate)}`}
            tone={p.h2h.sampleSize === 0 ? 'muted' : 'primary'}
          />
          <Bar label="AI overall confidence" value={p.verdict.overallConfidence} max={100} suffix="%" tone="primary" subtext={`Model: ${p.verdict.modelId}`} />
        </div>
      </section>
    </div>
  );
}
