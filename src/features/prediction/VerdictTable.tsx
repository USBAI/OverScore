import type { Verdict } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function selectionTone(sel: Verdict['picks'][number]['selection']) {
  return sel === 'Over' || sel === 'Yes' ? 'over' : 'under';
}

export function VerdictTable({ verdict }: { verdict: Verdict }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-emerald-950">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500" />
          AI verdict
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Overall confidence</span>
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono font-semibold text-emerald-700">
            {verdict.overallConfidence}%
          </span>
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px]">{verdict.modelId}</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-emerald-100/70 bg-white/60">
        <table className="w-full text-sm">
          <thead className="border-b border-emerald-100/70 bg-emerald-50/60 text-left text-[11px] uppercase tracking-wide text-emerald-900/80">
            <tr>
              <th className="px-4 py-2 font-medium">Market</th>
              <th className="px-4 py-2 font-medium">Pick</th>
              <th className="px-4 py-2 text-right font-medium">Confidence</th>
              <th className="px-4 py-2 font-medium">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emerald-100/60">
            {verdict.picks.map((p) => {
              const tone = selectionTone(p.selection);
              return (
                <tr key={p.market + p.selection} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-emerald-950">{p.market}</td>
                  <td className="px-4 py-3">
                    <Badge variant={tone}>{p.selection}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex min-w-[54px] flex-col items-end">
                      <span className="font-mono text-sm tabular-nums text-emerald-950">{p.confidencePct}%</span>
                      <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-emerald-50">
                        <div
                          className={cn('h-full rounded-full', tone === 'over' ? 'bg-over' : 'bg-under')}
                          style={{ width: `${Math.max(0, Math.min(100, p.confidencePct))}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{p.rationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {verdict.keyFactors.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Key factors</div>
          <div className="flex flex-wrap gap-1.5">
            {verdict.keyFactors.map((k, i) => (
              <Badge key={i} variant="secondary" className="font-normal">
                {k}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {verdict.warning && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900">
          <span className="font-semibold">Heads up:</span> {verdict.warning}
        </div>
      )}
    </div>
  );
}
