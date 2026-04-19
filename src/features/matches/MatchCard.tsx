import { Link } from 'react-router-dom';
import type { Match } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatKickoff, formatKickoffTime, formatRelative } from '@/lib/utils';
import { useTeamBadge } from '@/hooks/useTeamBadge';

function teamInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function TeamSide({
  teamId,
  name,
  badge,
  align = 'left',
}: {
  teamId: string;
  name: string;
  badge: string | null;
  align?: 'left' | 'right';
}) {
  const resolved = useTeamBadge(teamId, badge);
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 ${align === 'right' ? 'justify-end text-right' : ''}`}>
      {align === 'right' && <span className="truncate text-sm font-medium text-emerald-950">{name}</span>}
      {resolved ? (
        <img
          src={resolved}
          alt={name}
          loading="lazy"
          className="h-7 w-7 shrink-0 rounded-md bg-white/60 object-contain"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      ) : (
        <div
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-50 text-[10px] font-semibold tracking-tight text-emerald-700"
        >
          {teamInitials(name)}
        </div>
      )}
      {align === 'left' && <span className="truncate text-sm font-medium text-emerald-950">{name}</span>}
    </div>
  );
}

export function MatchCard({ match }: { match: Match }) {
  const isLive = match.status === 'live' || match.status === 'halftime';
  const isFinished = match.status === 'finished';
  const showScore = isLive || isFinished;

  return (
    <Link to={`/matches/${match.id}`} className="group block">
      <Card className="relative overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-500/10">
        <div className="mb-3 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className="truncate">{match.leagueName}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {!showScore && match.kickoffIso && match.status !== 'postponed' && (
              <span className="rounded-full border border-emerald-200/80 bg-emerald-50/70 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-normal text-emerald-800">
                {formatKickoffTime(match.kickoffIso)}
              </span>
            )}
            {isLive ? (
              <Badge variant="live" className="gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-white" />
                LIVE {match.minute ? `${match.minute}'` : match.status === 'halftime' ? 'HT' : ''}
              </Badge>
            ) : isFinished ? (
              <Badge variant="secondary">FT</Badge>
            ) : match.status === 'postponed' ? (
              <Badge variant="outline">Postponed</Badge>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <TeamSide teamId={match.home.id} name={match.home.name} badge={match.home.badge} align="left" />

          {showScore ? (
            <div className="font-mono text-lg font-semibold tabular-nums text-emerald-950">
              <span>{match.homeScore ?? 0}</span>
              <span className="mx-1.5 text-muted-foreground">–</span>
              <span>{match.awayScore ?? 0}</span>
            </div>
          ) : (
            <div className="shrink-0 text-xs font-medium text-muted-foreground">vs</div>
          )}

          <TeamSide teamId={match.away.id} name={match.away.name} badge={match.away.badge} align="right" />
        </div>

        {!showScore && match.kickoffIso && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50/70 px-2 py-0.5 text-emerald-800">
              <svg aria-hidden viewBox="0 0 24 24" className="h-3 w-3 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {formatKickoff(match.kickoffIso)}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="font-medium text-emerald-700/90">{formatRelative(match.kickoffIso)}</span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-400/0 via-emerald-400/70 to-emerald-400/0 opacity-0 transition-opacity group-hover:opacity-100" />
      </Card>
    </Link>
  );
}
