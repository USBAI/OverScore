import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDaysAhead, useLeagueUpcoming, useLiveMatches, useTeamSearch } from './useMatchesQuery';
import { MatchCard } from './MatchCard';
import { MatchFilters, type DateFilter } from './MatchFilters';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { POPULAR_LEAGUES } from '@/api/sportsdb';
import type { Match } from '@/api/types';

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function withinDateFilter(m: Match, f: DateFilter, now: Date): boolean {
  if (!m.kickoffIso) return f === 'any';
  const d = new Date(m.kickoffIso);
  if (Number.isNaN(d.getTime())) return false;
  if (f === 'any') return true;
  if (f === 'today') return isSameDay(d, now);
  if (f === 'tomorrow') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return isSameDay(d, t);
  }
  const end = new Date(now);
  end.setDate(end.getDate() + (f === 'week' ? 7 : 30));
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return d >= start && d <= end;
}

function applyDateFilter(matches: Match[], f: DateFilter): Match[] {
  const now = new Date();
  return matches.filter((m) => withinDateFilter(m, f, now));
}

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

/** Decide how many days of the worldwide daily feed to pull for a given filter. */
function daysForFilter(f: DateFilter): number {
  if (f === 'today') return 1;
  if (f === 'tomorrow') return 2;
  if (f === 'week') return 7;
  if (f === 'month') return 14; // cap at 14 to keep to ~14 parallel daily requests
  return 7; // 'any' — default to next 7 days worldwide
}

export function MatchesPage() {
  const qc = useQueryClient();
  const [leagueId, setLeagueId] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('week');
  const [liveOnly, setLiveOnly] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');

  // Debounce search 300ms
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const searching = debouncedSearch.trim().length >= 2;

  const isAllLeagues = leagueId === 'all';
  const daysToFetch = daysForFilter(dateFilter);

  // Data sources
  const liveQ = useLiveMatches(true);
  // Worldwide daily feed — used as PRIMARY source when leagueId === 'all',
  // and as a SUPPLEMENT for specific leagues so we always have fixtures even when
  // `eventsnextleague.php` is patchy on the free key.
  const needsDayFeed = !liveOnly && !searching;
  const dayFeedQ = useDaysAhead(daysToFetch, needsDayFeed);
  // Per-league upcoming list — only when a specific league is selected
  const upcomingQ = useLeagueUpcoming(leagueId, !liveOnly && !searching && !isAllLeagues);
  const searchQ = useTeamSearch(debouncedSearch, searching);

  const { matches, liveCount } = useMemo(() => {
    const live = liveQ.data ?? [];

    // 1) Live-only mode
    if (liveOnly) {
      const sorted = [...live].sort((a, b) => (b.minute ?? 0) - (a.minute ?? 0));
      return { matches: sorted, liveCount: live.length };
    }

    // 2) Team search mode — league filter ignored, date filter still applies
    if (searching) {
      const sr = searchQ.data?.matches ?? [];
      const filtered = applyDateFilter(sr, dateFilter);
      return { matches: sortMatches(dedup(filtered)), liveCount: live.length };
    }

    // 3) Build the pool from day-feed and/or league-upcoming
    let pool: Match[] = [];
    if (isAllLeagues) {
      // Primary: worldwide daily feed
      pool = [...(dayFeedQ.data ?? [])];
    } else {
      // Merge BOTH: per-league next events AND day-feed filtered to this league.
      // The league-next endpoint misses many fixtures on the free key, while the
      // day-feed sometimes misses the league label for some events — using both
      // together makes the specific-league view reliable.
      pool = [...(upcomingQ.data ?? [])];
      for (const m of dayFeedQ.data ?? []) {
        if (m.leagueId === leagueId) pool.push(m);
      }
    }

    // Merge in live matches (overwrite upcoming entry with live one on same team-pair)
    const liveByPair = new Map(live.map((m) => [`${m.home.id}-${m.away.id}`, m]));
    pool = pool.map((m) => liveByPair.get(`${m.home.id}-${m.away.id}`) ?? m);
    const poolIds = new Set(pool.map((m) => m.id));
    for (const m of live) {
      if (poolIds.has(m.id)) continue;
      if (!isAllLeagues && m.leagueId !== leagueId) continue;
      pool.push(m);
    }

    // Belt-and-braces: when a specific league is selected, drop anything that
    // somehow snuck in from another league. This guarantees the league filter
    // is always honored regardless of upstream API quirks.
    const leagueFiltered = isAllLeagues ? pool : pool.filter((m) => m.leagueId === leagueId);
    const deduped = dedup(leagueFiltered);
    const filtered = applyDateFilter(deduped, dateFilter);
    return { matches: sortMatches(filtered), liveCount: live.length };
  }, [
    upcomingQ.data,
    liveQ.data,
    dayFeedQ.data,
    searchQ.data,
    dateFilter,
    liveOnly,
    leagueId,
    isAllLeagues,
    searching,
    needsDayFeed,
  ]);

  // Pre-seed each visible match into the ['event', id] cache so the detail page
  // has instant data and is resilient to lookupevent.php failures.
  useEffect(() => {
    for (const m of matches) {
      const key = ['event', m.id] as const;
      if (!qc.getQueryData(key)) {
        qc.setQueryData(key, m);
      }
    }
  }, [matches, qc]);

  // For a specific league we now ALWAYS run both upcomingQ + dayFeedQ. Only show
  // the skeleton if BOTH are loading (and neither has data yet) — so as soon as
  // one source returns, we can render.
  const isLoading = liveOnly
    ? liveQ.isLoading
    : searching
      ? searchQ.isLoading
      : isAllLeagues
        ? dayFeedQ.isLoading
        : upcomingQ.isLoading && dayFeedQ.isLoading;

  const error = (liveOnly
    ? liveQ.error
    : searching
      ? searchQ.error
      : isAllLeagues
        ? dayFeedQ.error
        : upcomingQ.error && dayFeedQ.error
          ? upcomingQ.error
          : null) as Error | null;

  const isFetching = liveOnly
    ? liveQ.isFetching
    : searching
      ? searchQ.isFetching
      : isAllLeagues
        ? dayFeedQ.isFetching
        : upcomingQ.isFetching || dayFeedQ.isFetching;

  const handleRefresh = () => {
    liveQ.refetch();
    if (searching) searchQ.refetch();
    else if (isAllLeagues) dayFeedQ.refetch();
    else {
      upcomingQ.refetch();
      dayFeedQ.refetch();
    }
  };

  const leagueLabel = useMemo(
    () => POPULAR_LEAGUES.find((l) => l.id === leagueId)?.name ?? '',
    [leagueId],
  );

  const resultHeading = searching
    ? `Results for “${debouncedSearch.trim()}”`
    : liveOnly
      ? 'Live matches worldwide'
      : isAllLeagues
        ? `All worldwide soccer · next ${daysToFetch} day${daysToFetch === 1 ? '' : 's'}`
        : leagueLabel;

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

      <MatchFilters
        leagueId={leagueId}
        onLeagueChange={setLeagueId}
        dateFilter={dateFilter}
        onDateChange={setDateFilter}
        liveOnly={liveOnly}
        onLiveOnlyChange={setLiveOnly}
        search={search}
        onSearchChange={setSearch}
      />

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
            {liveOnly
              ? 'No soccer matches are live right now.'
              : searching
                ? 'No fixtures found for that search.'
                : 'No matches for this filter.'}
          </div>
          <div className="text-sm text-muted-foreground">
            {liveOnly
              ? 'Turn off “Live only” to see scheduled fixtures.'
              : searching
                ? 'Try a different team name, or clear the date filter.'
                : 'Try widening the date range, selecting a specific league, or searching a team.'}
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
