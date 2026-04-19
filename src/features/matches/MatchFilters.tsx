import { POPULAR_LEAGUES } from '@/api/sportsdb';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export type DateFilter = 'any' | 'today' | 'tomorrow' | 'week' | 'month';

interface Props {
  leagueId: string;
  onLeagueChange: (id: string) => void;
  dateFilter: DateFilter;
  onDateChange: (d: DateFilter) => void;
  liveOnly: boolean;
  onLiveOnlyChange: (v: boolean) => void;
  search: string;
  onSearchChange: (v: string) => void;
}

export function MatchFilters({
  leagueId,
  onLeagueChange,
  dateFilter,
  onDateChange,
  liveOnly,
  onLiveOnlyChange,
  search,
  onSearchChange,
}: Props) {
  const searching = search.trim().length >= 2;
  return (
    <div className="rounded-2xl border border-emerald-100/70 bg-white/70 p-4 shadow-sm shadow-emerald-500/5 backdrop-blur-sm">
      <div className="mb-3">
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-emerald-800/70">
          Search team or match
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
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Try “manchester united”, “real madrid”, “psg”…"
            className="pl-9"
            aria-label="Search team or match"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-emerald-50 hover:text-emerald-900"
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-emerald-800/70">League</label>
          <Select value={leagueId} onValueChange={onLeagueChange} disabled={liveOnly || searching}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a league" />
            </SelectTrigger>
            <SelectContent>
              {POPULAR_LEAGUES.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[160px]">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-emerald-800/70">Date</label>
          <Select
            value={dateFilter}
            onValueChange={(v) => onDateChange(v as DateFilter)}
            disabled={liveOnly}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="tomorrow">Tomorrow</SelectItem>
              <SelectItem value="week">Next 7 days</SelectItem>
              <SelectItem value="month">Next 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 pb-2 pl-1 text-sm text-emerald-950">
          <Switch checked={liveOnly} onCheckedChange={onLiveOnlyChange} />
          <span>Live only</span>
        </label>
      </div>

      {searching && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Showing fixtures for teams matching <span className="font-semibold text-emerald-800">“{search.trim()}”</span>
          · league & date filters applied
        </p>
      )}
    </div>
  );
}
