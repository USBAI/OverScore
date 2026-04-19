/**
 * TheSportsDB client.
 *
 * Free v1 key is "3" (public). Can be overridden via VITE_SPORTSDB_KEY.
 * All functions return normalized app-domain types (Match, Team).
 */

import type { Match, MatchStatus, SdbEvent, SdbTeam } from './types';

const KEY = import.meta.env.VITE_SPORTSDB_KEY ?? '3';
const V1 = `https://www.thesportsdb.com/api/v1/json/${KEY}`;
const V2 = `https://www.thesportsdb.com/api/v2/json`;

/** A curated set of popular soccer leagues to show in the filter dropdown. */
export const POPULAR_LEAGUES: { id: string; name: string; short: string }[] = [
  { id: 'all', name: 'All popular leagues', short: 'All' },
  { id: '4328', name: 'English Premier League', short: 'Premier League' },
  { id: '4335', name: 'Spanish La Liga', short: 'La Liga' },
  { id: '4332', name: 'Italian Serie A', short: 'Serie A' },
  { id: '4331', name: 'German Bundesliga', short: 'Bundesliga' },
  { id: '4334', name: 'French Ligue 1', short: 'Ligue 1' },
  { id: '4480', name: 'UEFA Champions League', short: 'UCL' },
  { id: '4481', name: 'UEFA Europa League', short: 'UEL' },
  { id: '4329', name: 'English Championship', short: 'Championship' },
  { id: '4346', name: 'Major League Soccer', short: 'MLS' },
  { id: '4344', name: 'Portuguese Primeira Liga', short: 'Primeira' },
  { id: '4337', name: 'Dutch Eredivisie', short: 'Eredivisie' },
  { id: '4336', name: 'Turkish Süper Lig', short: 'Süper Lig' },
  { id: '4339', name: 'Saudi Pro League', short: 'Saudi PL' },
];

export const ALL_LEAGUE_IDS = POPULAR_LEAGUES.filter((l) => l.id !== 'all').map((l) => l.id);

// ---------- low-level fetch ----------

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`SportsDB ${res.status} ${res.statusText} — ${url}`);
  }
  return (await res.json()) as T;
}

// ---------- helpers ----------

function parseKickoffIso(e: SdbEvent): string | null {
  if (e.strTimestamp) {
    const d = new Date(e.strTimestamp);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (e.dateEvent && e.strTime) {
    const d = new Date(`${e.dateEvent}T${e.strTime}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (e.dateEvent) {
    const d = new Date(`${e.dateEvent}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function parseStatus(e: SdbEvent): { status: MatchStatus; minute: number | null } {
  const raw = (e.strStatus ?? '').toUpperCase();
  if (e.strPostponed === 'yes') return { status: 'postponed', minute: null };
  if (raw === 'FT' || raw === 'MATCH FINISHED' || raw === 'FINISHED' || raw === 'AET' || raw === 'PEN') {
    return { status: 'finished', minute: null };
  }
  if (raw === 'HT' || raw === 'HALF TIME') return { status: 'halftime', minute: 45 };
  if (raw === '1H' || raw === '2H' || raw === 'ET' || raw === 'LIVE' || raw === 'IN PLAY') {
    const min = Number(e.strProgress ?? '');
    return { status: 'live', minute: Number.isFinite(min) ? min : null };
  }
  if (raw === 'NS' || raw === '' || raw === 'SCHEDULED') return { status: 'scheduled', minute: null };
  if (raw === 'CANC' || raw === 'CANCELLED') return { status: 'cancelled', minute: null };
  return { status: 'unknown', minute: null };
}

export function toMatch(e: SdbEvent): Match {
  const { status, minute } = parseStatus(e);
  return {
    id: e.idEvent,
    leagueId: e.idLeague,
    leagueName: e.strLeague,
    home: { id: e.idHomeTeam, name: e.strHomeTeam, badge: e.strHomeTeamBadge ?? null },
    away: { id: e.idAwayTeam, name: e.strAwayTeam, badge: e.strAwayTeamBadge ?? null },
    kickoffIso: parseKickoffIso(e),
    status,
    minute,
    homeScore: e.intHomeScore != null && e.intHomeScore !== '' ? Number(e.intHomeScore) : null,
    awayScore: e.intAwayScore != null && e.intAwayScore !== '' ? Number(e.intAwayScore) : null,
    venue: e.strVenue ?? null,
    season: e.strSeason ?? null,
  };
}

// ---------- public API ----------

export async function getUpcomingByLeague(leagueId: string, signal?: AbortSignal): Promise<Match[]> {
  const data = await getJson<{ events: SdbEvent[] | null }>(`${V1}/eventsnextleague.php?id=${leagueId}`, { signal });
  return (data.events ?? []).map(toMatch);
}

export async function getPastByLeague(leagueId: string, signal?: AbortSignal): Promise<Match[]> {
  const data = await getJson<{ events: SdbEvent[] | null }>(`${V1}/eventspastleague.php?id=${leagueId}`, { signal });
  return (data.events ?? []).map(toMatch);
}

export async function lookupEvent(eventId: string, signal?: AbortSignal): Promise<Match | null> {
  const data = await getJson<{ events: SdbEvent[] | null }>(`${V1}/lookupevent.php?id=${eventId}`, { signal });
  const first = data.events?.[0];
  return first ? toMatch(first) : null;
}

export async function getNextByTeam(teamId: string, signal?: AbortSignal): Promise<Match[]> {
  const data = await getJson<{ events: SdbEvent[] | null }>(`${V1}/eventsnext.php?id=${teamId}`, { signal });
  return (data.events ?? []).map(toMatch);
}

export async function getLastByTeam(teamId: string, signal?: AbortSignal): Promise<Match[]> {
  const data = await getJson<{ results: SdbEvent[] | null; events?: SdbEvent[] | null }>(
    `${V1}/eventslast.php?id=${teamId}`,
    { signal },
  );
  return (data.results ?? data.events ?? []).map(toMatch);
}

export async function lookupTeam(teamId: string, signal?: AbortSignal): Promise<SdbTeam | null> {
  const data = await getJson<{ teams: SdbTeam[] | null }>(`${V1}/lookupteam.php?id=${teamId}`, { signal });
  return data.teams?.[0] ?? null;
}

/**
 * v2 livescore/soccer — returns ALL currently-live soccer matches.
 * Note: CORS policy from browser prevents using X-API-KEY header,
 * so we use query parameter instead for the public key.
 */
export async function getLiveSoccer(signal?: AbortSignal): Promise<Match[]> {
  try {
    const url = KEY === '3' ? `${V2}/livescore/soccer?key=123` : `${V2}/livescore/soccer`;
    const res = await fetch(url, {
      ...(KEY !== '3' && { headers: { 'X-API-KEY': KEY } }),
      signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { livescore: SdbEvent[] | null };
    return (data.livescore ?? []).map(toMatch);
  } catch {
    return [];
  }
}

/** All soccer events on a given calendar day (YYYY-MM-DD). */
export async function getEventsOnDay(dateYmd: string, signal?: AbortSignal): Promise<Match[]> {
  const data = await getJson<{ events: SdbEvent[] | null }>(
    `${V1}/eventsday.php?d=${dateYmd}&s=Soccer`,
    { signal },
  );
  return (data.events ?? []).map(toMatch);
}

/** Fetch upcoming events from multiple leagues in parallel and return the union, deduplicated. */
export async function getUpcomingForLeagues(leagueIds: string[], signal?: AbortSignal): Promise<Match[]> {
  const results = await Promise.allSettled(
    leagueIds.map((id) => getUpcomingByLeague(id, signal)),
  );
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const m of r.value) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** Search teams by free-text name (TheSportsDB searchteams.php). */
export async function searchTeams(query: string, signal?: AbortSignal): Promise<SdbTeam[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await getJson<{ teams: SdbTeam[] | null }>(
    `${V1}/searchteams.php?t=${encodeURIComponent(q)}`,
    { signal },
  );
  return (data.teams ?? []).filter((t) => (t as unknown as { strSport?: string }).strSport !== undefined
    ? (t as unknown as { strSport?: string }).strSport === 'Soccer'
    : true,
  );
}

/** Search events by free-text (team or event name). Limited by TheSportsDB. */
export async function searchEvents(query: string, signal?: AbortSignal): Promise<Match[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await getJson<{ event: SdbEvent[] | null }>(
    `${V1}/searchevents.php?e=${encodeURIComponent(q)}&s=Soccer`,
    { signal },
  );
  return (data.event ?? []).map(toMatch);
}

/** Combined team search: returns future + recent matches for any team whose name matches. */
export async function searchTeamFixtures(
  query: string,
  signal?: AbortSignal,
): Promise<{ teams: SdbTeam[]; matches: Match[] }> {
  const teams = await searchTeams(query, signal);
  if (teams.length === 0) return { teams: [], matches: [] };
  const soccerTeams = teams.slice(0, 5); // cap to limit requests
  const all = await Promise.allSettled(
    soccerTeams.flatMap((t) => [getNextByTeam(t.idTeam, signal), getLastByTeam(t.idTeam, signal)]),
  );
  const seen = new Set<string>();
  const matches: Match[] = [];
  for (const r of all) {
    if (r.status !== 'fulfilled') continue;
    for (const m of r.value) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      matches.push(m);
    }
  }
  return { teams: soccerTeams, matches };
}

/** Helper: returns today's and the next N days' events, merged + deduplicated. */
export async function getEventsForDaysAhead(days: number, signal?: AbortSignal): Promise<Match[]> {
  const today = new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(ymd(d));
  }
  const res = await Promise.allSettled(dates.map((d) => getEventsOnDay(d, signal)));
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const r of res) {
    if (r.status !== 'fulfilled') continue;
    for (const m of r.value) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}
