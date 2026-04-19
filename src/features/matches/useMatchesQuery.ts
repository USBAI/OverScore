import { useQuery } from '@tanstack/react-query';
import {
  getEventsForDaysAhead,
  getLiveSoccer,
  getUpcomingByLeague,
  searchTeamFixtures,
} from '@/api/sportsdb';
import type { Match, SdbTeam } from '@/api/types';

export function useLeagueUpcoming(leagueId: string, enabled = true) {
  return useQuery<Match[]>({
    queryKey: ['upcoming', leagueId],
    queryFn: ({ signal }) => getUpcomingByLeague(leagueId, signal),
    staleTime: 1000 * 60 * 10,
    enabled: enabled && Boolean(leagueId) && leagueId !== 'all',
  });
}

export function useLiveMatches(enabled: boolean) {
  return useQuery<Match[]>({
    queryKey: ['live', 'soccer'],
    queryFn: ({ signal }) => getLiveSoccer(signal),
    refetchInterval: enabled ? 30_000 : false,
    enabled,
    staleTime: 10_000,
  });
}

/**
 * All soccer events worldwide in the next N days.
 * Uses TheSportsDB eventsday.php?d=YYYY-MM-DD&s=Soccer (free, no premium key required).
 * This is how we get ALL worldwide fixtures — not limited to the league list.
 */
export function useDaysAhead(days: number, enabled = true) {
  return useQuery<Match[]>({
    queryKey: ['days-ahead', days],
    queryFn: ({ signal }) => getEventsForDaysAhead(days, signal),
    staleTime: 1000 * 60 * 10,
    enabled,
  });
}

/** Team-search hook: fires only when query is at least 2 chars. */
export function useTeamSearch(query: string, enabled = true) {
  const q = query.trim();
  return useQuery<{ teams: SdbTeam[]; matches: Match[] }>({
    queryKey: ['team-search', q.toLowerCase()],
    queryFn: ({ signal }) => searchTeamFixtures(q, signal),
    staleTime: 1000 * 60 * 5,
    enabled: enabled && q.length >= 2,
  });
}
