import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { lookupEvent } from '@/api/sportsdb';
import type { CachedPrediction, StageResult } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AbortConfirmDialog } from '@/components/AbortConfirmDialog';
import { formatKickoffDate, formatKickoffTime, formatRelative, formatTimeZone } from '@/lib/utils';
import { storageDel, storageGet, storageSet } from '@/lib/storage';
import { useNavigationGuard } from '@/hooks/useNavigationGuard';
import { useTeamBadge } from '@/hooks/useTeamBadge';
import { runPredictionPipeline } from './pipeline';
import { PipelineTimeline } from './PipelineTimeline';
import { StatsCharts } from './StatsCharts';
import { VerdictTable } from './VerdictTable';

const INITIAL_STAGES: StageResult[] = [
  { id: 's1-match', title: 'Load match context', status: 'pending' },
  { id: 's2-home-form', title: 'Analyze home-team form (last 10)', status: 'pending' },
  { id: 's3-away-form', title: 'Analyze away-team form (last 10)', status: 'pending' },
  { id: 's4-h2h', title: 'Compute head-to-head history', status: 'pending' },
  { id: 's5-live', title: 'Snapshot live state', status: 'pending' },
  { id: 's6-poisson', title: 'Run Poisson goal model', status: 'pending' },
  { id: 's7-summary', title: 'Summarize signals for AI', status: 'pending' },
  { id: 's8-llm', title: 'AI synthesis (OpenRouter)', status: 'pending' },
];

const cacheKey = (id: string) => `predictions:${id}`;

function teamInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function MatchDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  const { data: match, isLoading, error } = useQuery({
    queryKey: ['event', id],
    queryFn: ({ signal }) => lookupEvent(id, signal),
    enabled: Boolean(id),
  });

  const homeBadge = useTeamBadge(match?.home.id ?? '', match?.home.badge ?? null);
  const awayBadge = useTeamBadge(match?.away.id ?? '', match?.away.badge ?? null);

  const [stages, setStages] = useState<StageResult[]>(INITIAL_STAGES);
  const [prediction, setPrediction] = useState<CachedPrediction | null>(() => storageGet<CachedPrediction>(cacheKey(id)));
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const blocker = useNavigationGuard(running);

  useEffect(() => {
    setPrediction(storageGet<CachedPrediction>(cacheKey(id)));
    setStages(INITIAL_STAGES);
    setRunError(null);
  }, [id]);

  const handleEmit = useCallback((stage: StageResult) => {
    setStages((prev) => {
      const idx = prev.findIndex((s) => s.id === stage.id);
      if (idx < 0) return [...prev, stage];
      const next = [...prev];
      next[idx] = { ...next[idx], ...stage };
      return next;
    });
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!id) return;
    setPrediction(null);
    setRunError(null);
    setStages(INITIAL_STAGES);
    setRunning(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await runPredictionPipeline(id, handleEmit, controller.signal);
      storageSet(cacheKey(id), result);
      setPrediction(result);
      toast.success('AI verdict ready');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        toast('Analysis cancelled.');
      } else {
        setRunError((err as Error).message);
        toast.error('Analysis failed', { description: (err as Error).message });
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  }, [id, handleEmit]);

  const handleAbort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const handleClearCache = useCallback(() => {
    storageDel(cacheKey(id));
    setPrediction(null);
    setStages(INITIAL_STAGES);
    toast('Cached analysis cleared for this match.');
  }, [id]);

  const cacheAgeMin = useMemo(() => {
    if (!prediction) return null;
    return Math.round((Date.now() - prediction.createdAt) / 60000);
  }, [prediction]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/matches">← Back to matches</Link>
      </Button>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error || !match ? (
        <Card className="p-6">
          <div className="font-medium text-emerald-950">Match not found</div>
          <div className="text-sm text-muted-foreground">
            {(error as Error | undefined)?.message ?? 'The event id may be invalid.'}
          </div>
        </Card>
      ) : (
        <>
          {/* Match header */}
          <Card className="p-6">
            <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
              <span>{match.leagueName}</span>
              {(match.status === 'live' || match.status === 'halftime') && (
                <Badge variant="live">
                  LIVE {match.minute ? `${match.minute}'` : match.status === 'halftime' ? 'HT' : ''}
                </Badge>
              )}
              {match.status === 'finished' && <Badge variant="secondary">FT</Badge>}
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <div className="flex flex-col items-center gap-2 text-center">
                {homeBadge ? (
                  <img src={homeBadge} className="h-16 w-16 object-contain" alt={match.home.name} />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-lg bg-emerald-50 text-lg font-semibold tracking-tight text-emerald-700">
                    {teamInitials(match.home.name)}
                  </div>
                )}
                <div className="text-sm font-semibold text-emerald-950">{match.home.name}</div>
              </div>

              <div className="text-center">
                {match.status === 'live' || match.status === 'halftime' || match.status === 'finished' ? (
                  <div className="font-mono text-5xl font-bold tabular-nums text-emerald-950">
                    {match.homeScore ?? 0}
                    <span className="mx-2 text-muted-foreground">–</span>
                    {match.awayScore ?? 0}
                  </div>
                ) : match.kickoffIso ? (
                  <div className="flex flex-col items-center gap-1">
                    <div className="font-mono text-4xl font-bold tabular-nums tracking-tight text-emerald-950">
                      {formatKickoffTime(match.kickoffIso)}
                    </div>
                    <div className="text-[11px] uppercase tracking-wider text-emerald-700/80">
                      {formatTimeZone(match.kickoffIso)}
                    </div>
                  </div>
                ) : (
                  <div className="font-display text-3xl font-semibold text-muted-foreground">vs</div>
                )}
                {match.kickoffIso && (
                  <div className="mt-2 flex flex-col items-center gap-1">
                    <div className="text-xs font-medium text-emerald-900/90">
                      {formatKickoffDate(match.kickoffIso)}
                    </div>
                    {match.status !== 'live' &&
                      match.status !== 'halftime' &&
                      match.status !== 'finished' && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 animate-pulse-live rounded-full bg-emerald-500"
                          />
                          {formatRelative(match.kickoffIso)}
                        </span>
                      )}
                  </div>
                )}
                {match.venue && (
                  <div className="mt-1 text-[11px] text-muted-foreground/80">{match.venue}</div>
                )}
              </div>

              <div className="flex flex-col items-center gap-2 text-center">
                {awayBadge ? (
                  <img src={awayBadge} className="h-16 w-16 object-contain" alt={match.away.name} />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-lg bg-emerald-50 text-lg font-semibold tracking-tight text-emerald-700">
                    {teamInitials(match.away.name)}
                  </div>
                )}
                <div className="text-sm font-semibold text-emerald-950">{match.away.name}</div>
              </div>
            </div>
          </Card>

          {/* Analysis area */}
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500"
                />
                <span className="font-display font-semibold text-emerald-950">AI Over / Under analysis</span>
                {prediction && cacheAgeMin != null && (
                  <span className="text-xs text-muted-foreground">
                    · cached {cacheAgeMin < 1 ? 'just now' : `${cacheAgeMin}m ago`}
                    {prediction.liveAtAnalysis && ' · during live play'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {prediction ? (
                  <>
                    <Button variant="outline" size="sm" onClick={runAnalysis} disabled={running}>
                      {running ? 'Running…' : 'Re-run'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleClearCache} disabled={running}>
                      Clear cache
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={runAnalysis} disabled={running}>
                    {running ? 'Running…' : 'Run analysis'}
                  </Button>
                )}
                {running && (
                  <Button variant="destructive" size="sm" onClick={handleAbort}>
                    Stop
                  </Button>
                )}
              </div>
            </div>

            {(running || runError || !prediction) && (
              <div className="mt-5">
                <PipelineTimeline stages={stages} />
              </div>
            )}

            {runError && (
              <div className="mt-4 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {runError}
              </div>
            )}
          </Card>

          {prediction && !running && (
            <div className="animate-fade-up space-y-6">
              <StatsCharts p={prediction} />
              <Card className="p-6">
                <VerdictTable verdict={prediction.verdict} />
              </Card>
            </div>
          )}
        </>
      )}

      <AbortConfirmDialog
        open={blocker.state === 'blocked'}
        onStay={() => blocker.state === 'blocked' && blocker.reset()}
        onLeave={() => {
          controllerRef.current?.abort();
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}
