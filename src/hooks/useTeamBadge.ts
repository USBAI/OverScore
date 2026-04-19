import { useQuery } from '@tanstack/react-query';
import { lookupTeam } from '@/api/sportsdb';

/**
 * Returns a team badge URL, either the one already on the event or
 * the one from lookupteam.php if the event didn't include it.
 *
 * React Query dedupes by teamId, so rendering N cards that share a team
 * triggers at most one request per team.
 */
export function useTeamBadge(teamId: string, fallbackBadge: string | null): string | null {
  const existing = fallbackBadge && fallbackBadge.trim() !== '' ? fallbackBadge : null;

  const { data } = useQuery({
    queryKey: ['team', teamId],
    queryFn: ({ signal }) => lookupTeam(teamId, signal),
    enabled: Boolean(teamId) && !existing,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
  });

  return existing ?? data?.strTeamBadge ?? null;
}
