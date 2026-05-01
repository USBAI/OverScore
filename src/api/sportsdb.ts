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

/** Sleep helper that respects AbortSignal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch wrapper with retries for transient failures.
 * Safari often returns "Load failed" (a bare TypeError) when bursts of parallel
 * requests to thesportsdb hit the network layer — retrying with backoff recovers.
 */
async function getJson<T>(url: string, init?: RequestInit, retries = 2): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      // Never leak the raw API URL into user-facing errors — it contains a
      // third-party endpoint path like `eventsday.php` that has nothing to do
      // with our app. Keep only the HTTP status so messages stay clean.
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        throw new Error(`SportsDB ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        throw new Error(`SportsDB ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      lastErr = err;
      if (attempt < retries) {
        const backoff = 300 * Math.pow(2, attempt); // 300ms, 600ms
        await sleep(backoff, init?.signal ?? undefined);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Run `tasks` with at most `concurrency` in-flight at once. Preserves input order. */
async function runThrottled<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = Array.from({ length: tasks.length });
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      try {
        const v = await tasks[i]();
        results[i] = { status: 'fulfilled', value: v };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  const n = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------- helpers ----------

/**
 * Normalize an assumed-UTC timestamp string into one `new Date(...)` accepts
 * on every browser (Safari rejects 'YYYY-MM-DD HH:MM:SS' — the space breaks it).
 */
function normalizeUtcIso(raw: string): string {
  let s = raw.trim();
  // Replace the date/time separator space with 'T'
  s = s.replace(' ', 'T');
  // Ensure a timezone designator is present (treat as UTC if absent)
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) s = `${s}Z`;
  return s;
}

function parseKickoffIso(e: SdbEvent): string | null {
  if (e.strTimestamp) {
    const d = new Date(normalizeUtcIso(e.strTimestamp));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (e.dateEvent && e.strTime) {
    // strTime may arrive as "HH:MM" or "HH:MM:SS", UTC per TheSportsDB docs.
    const time = e.strTime.length === 5 ? `${e.strTime}:00` : e.strTime;
    const d = new Date(normalizeUtcIso(`${e.dateEvent} ${time}`));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (e.dateEvent) {
    const d = new Date(`${e.dateEvent}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function parseStatus(e: SdbEvent): { status: MatchStatus; minute: number | null } {
  const rawStatus = (e.strStatus ?? '').trim();
  const rawProgress = (e.strProgress ?? '').trim();
  const upper = rawStatus.toUpperCase();

  if (e.strPostponed === 'yes') return { status: 'postponed', minute: null };

  if (upper === 'FT' || upper === 'MATCH FINISHED' || upper === 'FINISHED' || upper === 'AET' || upper === 'PEN') {
    return { status: 'finished', minute: null };
  }
  if (upper === 'HT' || upper === 'HALF TIME' || upper === 'HALFTIME') {
    return { status: 'halftime', minute: 45 };
  }

  // Pull a minute out of something that's supposed to carry one.
  // Accepts "82", "82'", "45+2", "90+3 ".
  // REJECTS half-indicators like "1H" / "2H" (those must not parse to 1/2).
  const extractMinute = (s: string): number | null => {
    if (!s) return null;
    const trimmed = s.trim();
    // Valid if the string is purely a number (optionally with ' or + suffix).
    // Anything with a letter like H/E/T/etc. is a status keyword, not a minute.
    if (!/^\d+(\s*\+\s*\d+)?\s*[' ]?\s*$/.test(trimmed)) return null;
    const match = trimmed.match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!match) return null;
    const base = Number(match[1]);
    const added = match[2] ? Number(match[2]) : 0;
    if (!Number.isFinite(base)) return null;
    return base + (Number.isFinite(added) ? added : 0);
  };

  const progressMin = extractMinute(rawProgress);
  const statusMin = extractMinute(rawStatus);

  const isLiveKeyword =
    upper === '1H' ||
    upper === '2H' ||
    upper === 'ET' ||
    upper === 'LIVE' ||
    upper === 'IN PLAY' ||
    upper === 'INPLAY' ||
    upper === 'PLAYING' ||
    upper === 'INPROGRESS';

  // If either field gives us a plausible minute (1–130), treat the match as
  // live — even if strStatus is a bare number like "82" that doesn't match
  // any textual keyword. We prefer strProgress when it's non-zero, because
  // "0" in strProgress often just means "API didn't populate this field yet".
  const firstValid = [progressMin, statusMin].find((m) => m != null && m > 0 && m <= 130);
  const aMinute = firstValid ?? progressMin ?? statusMin ?? null;

  if (isLiveKeyword || (firstValid != null)) {
    // Drop a bogus 0 — we'd rather render "?'" than "0'".
    const reportedMinute = aMinute != null && aMinute > 0 ? aMinute : null;
    return { status: 'live', minute: reportedMinute };
  }

  if (upper === 'NS' || upper === '' || upper === 'SCHEDULED' || upper === 'NOT STARTED') {
    return { status: 'scheduled', minute: null };
  }
  if (upper === 'CANC' || upper === 'CANCELLED' || upper === 'CANCELED') {
    return { status: 'cancelled', minute: null };
  }
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
  if (!first) return null;
  // TheSportsDB's free key ("3") sometimes returns a sample event (historically a
  // 2014 Liverpool vs Swansea match at Anfield) regardless of the requested id.
  // Reject any response whose idEvent doesn't match the one we asked for.
  if (String(first.idEvent) !== String(eventId)) return null;
  return toMatch(first);
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
 *
 * Strategy:
 *   1) Try v2 livescore/soccer (the purpose-built endpoint).
 *   2) If that returns nothing or errors, fall back to today's eventsday.php
 *      filtered to matches currently in play — so live-only is never falsely empty.
 */
export async function getLiveSoccer(signal?: AbortSignal): Promise<Match[]> {
  const v2Url = KEY === '3' ? `${V2}/livescore/soccer?key=123` : `${V2}/livescore/soccer`;

  // Attempt 1: v2 endpoint with retry/backoff
  const tryV2 = async (): Promise<Match[] | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(v2Url, {
          ...(KEY !== '3' && { headers: { 'X-API-KEY': KEY } }),
          signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { livescore?: SdbEvent[] | null; events?: SdbEvent[] | null };
          const arr = data.livescore ?? data.events ?? [];
          return arr.map(toMatch);
        }
        if (res.status === 429 || res.status >= 500) {
          await sleep(400 * (attempt + 1), signal);
          continue;
        }
        return null;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        await sleep(400 * (attempt + 1), signal);
      }
    }
    return null;
  };

  // Attempt 2: today's soccer events, keep only the ones currently in play
  const tryDayFallback = async (): Promise<Match[]> => {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    try {
      const events = await getEventsOnDay(ymd, signal);
      return events.filter((m) => m.status === 'live' || m.status === 'halftime');
    } catch {
      return [];
    }
  };

  const v2 = await tryV2();
  if (v2 && v2.length > 0) return v2;
  const fallback = await tryDayFallback();
  // Merge v2 (possibly empty) with fallback, dedup by id, so we never lose data.
  const pool = [...(v2 ?? []), ...fallback];
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of pool) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
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
  const tasks = soccerTeams.flatMap((t) => [
    () => getNextByTeam(t.idTeam, signal),
    () => getLastByTeam(t.idTeam, signal),
  ]);
  const all = await runThrottled(tasks, 3);
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
  // Throttle concurrency to 3 to keep Safari + thesportsdb happy
  const res = await runThrottled(dates.map((d) => () => getEventsOnDay(d, signal)), 3);
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
