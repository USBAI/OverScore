import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDaysAhead, useLiveMatches } from './useMatchesQuery';
import { storageSetTtl } from '@/lib/storage';
import { MatchCard } from './MatchCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { Match } from '@/api/types';

// How many days of worldwide fixtures to pull up-front. 14 ≈ two weeks of
// fixtures worldwide, which is the most we can realistically fetch with the
// free TheSportsDB key (14 parallel daily requests, throttled to 3 at a time).
const DAYS_AHEAD = 14;

function dedup(matches: Match[]): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of matches) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

function sortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    const aLive = a.status === 'live' || a.status === 'halftime' ? 0 : 1;
    const bLive = b.status === 'live' || b.status === 'halftime' ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    const ak = a.kickoffIso ? new Date(a.kickoffIso).getTime() : Infinity;
    const bk = b.kickoffIso ? new Date(b.kickoffIso).getTime() : Infinity;
    return ak - bk;
  });
}

/** Case-insensitive substring match against home name, away name, or league. */
function matchesSearch(m: Match, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    m.home.name.toLowerCase().includes(needle) ||
    m.away.name.toLowerCase().includes(needle) ||
    (m.leagueName ?? '').toLowerCase().includes(needle)
  );
}

export function MatchesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState<string>('');

  // Debounce the search so we don't re-filter the pool on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Always pull worldwide fixtures + live matches. No league / date / live-only
  // toggles — a single search box is the only control.
  const dayFeedQ = useDaysAhead(DAYS_AHEAD, true);
  const liveQ = useLiveMatches(true);

  const { matches, liveCount } = useMemo(() => {
    const live = liveQ.data ?? [];
    let pool: Match[] = [...(dayFeedQ.data ?? [])];

    // Replace the upcoming entry with its live counterpart if both exist (same
    // home/away pair), so live scores and minutes surface immediately.
    const liveByPair = new Map(live.map((m) => [`${m.home.id}-${m.away.id}`, m]));
    pool = pool.map((m) => liveByPair.get(`${m.home.id}-${m.away.id}`) ?? m);
    const poolIds = new Set(pool.map((m) => m.id));
    for (const m of live) {
      if (poolIds.has(m.id)) continue;
      pool.push(m);
    }

    const deduped = dedup(pool);
    const q = debouncedSearch.trim();
    const filtered = q ? deduped.filter((m) => matchesSearch(m, q)) : deduped;
    return { matches: sortMatches(filtered), liveCount: live.length };
  }, [dayFeedQ.data, liveQ.data, debouncedSearch]);

  // Pre-seed each visible match into the ['event', id] react-query cache and
  // localStorage so the detail page has instant data even after a hard refresh
  // and is resilient to individual lookup failures.
  useEffect(() => {
    for (const m of matches) {
      const key = ['event', m.id] as const;
      if (!qc.getQueryData(key)) qc.setQueryData(key, m);
      storageSetTtl(`match:${m.id}`, m, 24 * 60 * 60 * 1000);
    }
  }, [matches, qc]);

  const isLoading = dayFeedQ.isLoading && liveQ.isLoading;
  const error = (dayFeedQ.error ?? liveQ.error) as Error | null;
  const isFetching = dayFeedQ.isFetching || liveQ.isFetching;

  const handleRefresh = () => {
    dayFeedQ.refetch();
    liveQ.refetch();
  };

  const searching = debouncedSearch.trim().length > 0;
  const resultHeading = searching
    ? `Results for “${debouncedSearch.trim()}”`
    : `All worldwide soccer · next ${DAYS_AHEAD} days`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-emerald-950">Matches</h1>
          <p className="text-sm text-muted-foreground">
            Pick a fixture to run the AI Over / Under analysis.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      {/* Single search box — the only control on this page. */}
      <div className="rounded-2xl border border-emerald-100/70 bg-white/70 p-4 shadow-sm shadow-emerald-500/5 backdrop-blur-sm">
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-emerald-800/70">
          Search by game name
        </label>
        <div className="relative">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a team or league… e.g. “manchester”, “psg”, “serie a”"
            className="pl-9"
            aria-label="Search games"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-emerald-50 hover:text-emerald-900"
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.14em] text-emerald-800/70">
          {resultHeading}
          {isFetching && !isLoading && (
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 animate-pulse-live rounded-full bg-emerald-500"
              title="Refreshing"
            />
          )}
        </h2>
        <span className="text-xs text-muted-foreground">{matches.length} shown</span>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load matches: {error.message}
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[108px] w-full" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-emerald-300/60 bg-white/60 py-16 text-center">
          <div className="font-medium text-emerald-950">
            {searching ? 'No games match that search.' : 'No games available right now.'}
          </div>
          <div className="text-sm text-muted-foreground">
            {searching
              ? 'Try a different team or league name, or clear the search.'
              : 'Try refreshing in a moment.'}
          </div>
        </div>
      ) : (
        <div className="grid animate-fade-up grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      )}

      <div className="pt-2 text-center text-[11px] text-muted-foreground">
        {liveCount > 0
          ? `Live soccer matches worldwide right now: ${liveCount}`
          : 'No live soccer matches worldwide right now.'}
      </div>
    </div>
  );
}
