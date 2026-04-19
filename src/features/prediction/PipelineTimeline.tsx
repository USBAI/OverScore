import { useEffect, useRef, useState } from 'react';
import type { StageResult } from '@/api/types';
import { cn } from '@/lib/utils';

function dotLabel(status: StageResult['status']) {
  if (status === 'done') return '✓';
  if (status === 'error') return '!';
  if (status === 'aborted') return '×';
  return '';
}

/** Tracks the previous status of every stage so we can trigger one-shot
 *  animations on each transition (pending → running → done / error). */
function usePrevStatusMap(stages: StageResult[]) {
  const prev = useRef<Record<string, StageResult['status']>>({});
  const [transitions, setTransitions] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = {};
    let changed = false;
    for (const s of stages) {
      const was = prev.current[s.id];
      if (was !== s.status) changed = true;
      next[s.id] = (transitions[s.id] ?? 0) + (was !== s.status ? 1 : 0);
    }
    if (changed) {
      prev.current = Object.fromEntries(stages.map((s) => [s.id, s.status]));
      setTransitions(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages]);

  return transitions;
}

export function PipelineTimeline({ stages }: { stages: StageResult[] }) {
  const transitions = usePrevStatusMap(stages);

  return (
    <ol className="relative space-y-3 border-l border-emerald-200/70 pl-5">
      {stages.map((s, idx) => {
        const bumpKey = transitions[s.id] ?? 0;
        const running = s.status === 'running';
        const done = s.status === 'done';
        const errored = s.status === 'error';
        const aborted = s.status === 'aborted';

        return (
          <li
            key={s.id}
            className="stage-enter"
            style={{ animationDelay: `${Math.min(idx, 6) * 40}ms` }}
          >
            <span
              key={`dot-${s.id}-${bumpKey}`}
              aria-hidden
              className={cn(
                'absolute -left-[9px] grid h-4 w-4 place-items-center rounded-full border-2 border-white text-[10px] font-bold leading-none transition-colors',
                done && 'stage-pop bg-emerald-500 text-white',
                running && 'stage-ripple bg-gradient-to-br from-emerald-400 to-teal-500 text-white',
                errored && 'stage-shake bg-rose-500 text-white',
                aborted && 'bg-muted text-muted-foreground',
                s.status === 'pending' && 'bg-emerald-50 text-muted-foreground',
              )}
            >
              {dotLabel(s.status)}
            </span>

            <div className="flex flex-col gap-0.5 pl-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'flex items-center gap-2 text-sm font-medium transition-colors',
                    s.status === 'pending' ? 'text-muted-foreground' : 'text-emerald-950',
                    running && 'text-emerald-700',
                  )}
                >
                  {s.title}
                  {running && <RunningBadge />}
                </span>
                {s.durationMs != null && done && (
                  <span className="font-mono text-[10px] text-muted-foreground">{s.durationMs}ms</span>
                )}
              </div>

              {running && <RunningBar />}

              {s.summary && (
                <p
                  key={`sum-${s.id}-${bumpKey}`}
                  className={cn('text-xs text-muted-foreground', (done || errored) && 'stage-enter')}
                >
                  {s.summary}
                </p>
              )}

              {s.error && (
                <p className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  {s.error}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RunningBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 animate-pulse-live rounded-full bg-emerald-500"
      />
      running
    </span>
  );
}

function RunningBar() {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-emerald-50">
      <div
        className="stage-sweep h-full rounded-full"
        style={{
          background:
            'linear-gradient(90deg, rgba(16,185,129,0) 0%, rgba(16,185,129,0.85) 45%, rgba(20,184,166,0.85) 55%, rgba(16,185,129,0) 100%)',
        }}
      />
    </div>
  );
}
