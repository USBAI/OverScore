/**
 * OpenRouter client — one function: predictOverUnder.
 *
 * Strategy:
 *   1. At call time, fetch /api/v1/models using the user's key and select
 *      every currently-available `:free` chat model (OpenRouter's free tier
 *      rotates constantly — hard-coding IDs doesn't work).
 *   2. Sort them by family + context length so bigger / smarter models
 *      come first.
 *   3. Try each in order:
 *        - on 429: wait 1.5s, retry that same model once.
 *        - on 402 ("API key USD spend limit exceeded"): abort the whole
 *          chain immediately — no amount of model switching will help.
 *        - on schema mismatch: re-prompt that same model once with a
 *          strict "repair" instruction before moving on.
 *   4. If every attempt fails, throw a typed error (OpenRouterExhausted)
 *      so the pipeline can fall back to its deterministic local verdict.
 */

import { z } from 'zod';
import type { Verdict } from './types';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_URL = `${OPENROUTER_BASE}/chat/completions`;
const MODELS_URL = `${OPENROUTER_BASE}/models`;

const MAX_ATTEMPTS = 8;

export class OpenRouterExhausted extends Error {
  readonly attempts: readonly { id: string; error: string; status?: number }[];
  readonly reason: 'spend-limit' | 'privacy-opt-in' | 'rate-limit' | 'schema' | 'mixed';

  constructor(
    message: string,
    attempts: readonly { id: string; error: string; status?: number }[],
    reason: OpenRouterExhausted['reason'],
  ) {
    super(message);
    this.name = 'OpenRouterExhausted';
    this.attempts = attempts;
    this.reason = reason;
  }
}

// --- Zod schema for the verdict shape we need back ---

const marketEnum = z.enum(['OU 1.5', 'OU 2.5', 'OU 3.5', 'BTTS']);
const selectionEnum = z.enum(['Over', 'Under', 'Yes', 'No']);

const VerdictSchema = z.object({
  picks: z
    .array(
      z.object({
        market: marketEnum,
        selection: selectionEnum,
        confidencePct: z.number().min(0).max(100),
        rationale: z.string().min(5).max(400),
      }),
    )
    .min(1)
    .max(8),
  overallConfidence: z.number().min(0).max(100),
  keyFactors: z.array(z.string()).min(1).max(10),
  warning: z.string().optional(),
});

const SYSTEM_PROMPT = `You are a rigorous quantitative football betting analyst specializing in the Over/Under goals market.

You will receive pre-computed statistics for a specific match. Your job is to weigh those numbers and produce a structured Over/Under verdict.

Methodology you must follow:
1. Start from the Poisson expected-total (lambdaTotal) as your baseline.
2. Cross-check against each team's 10-game Over 2.5 rate and BTTS rate.
3. Factor head-to-head history, but weight it lightly if sample size < 4.
4. If the match is live, respect the "remaining" probabilities — a 2-0 match at 70' with both teams defensively tight should trend Under 3.5 even if pre-match data was high-scoring.
5. Only mark confidence > 70% when at least THREE independent signals agree.
6. Confidence below 55% means lean — say so explicitly in the rationale.
7. Never invent player news, weather, or injury data that wasn't provided.

Output ONLY valid JSON matching this EXACT schema (no prose, no markdown fences):
{
  "picks": [
    { "market": "OU 1.5", "selection": "Over", "confidencePct": 68, "rationale": "..." },
    { "market": "OU 2.5", "selection": "Under", "confidencePct": 58, "rationale": "..." },
    { "market": "OU 3.5", "selection": "Under", "confidencePct": 72, "rationale": "..." },
    { "market": "BTTS", "selection": "Yes", "confidencePct": 60, "rationale": "..." }
  ],
  "overallConfidence": 64,
  "keyFactors": ["bullet", "bullet", "bullet"],
  "warning": "optional caveat if data is sparse"
}

Include ALL four markets (OU 1.5, OU 2.5, OU 3.5, BTTS) — no more, no less.
market MUST be one of: "OU 1.5" | "OU 2.5" | "OU 3.5" | "BTTS".
selection MUST be one of: "Over" | "Under" | "Yes" | "No".
confidencePct is a NUMBER between 0 and 100.`;

// --- OpenRouter model discovery ---

interface ORModel {
  id: string;
  context_length?: number;
  architecture?: { modality?: string; input_modalities?: string[] };
}

const discoveryCache: { key: string | null; models: string[] | null; at: number } = {
  key: null,
  models: null,
  at: 0,
};
const CACHE_TTL_MS = 10 * 60 * 1000;

async function discoverFreeModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const now = Date.now();
  if (
    discoveryCache.models &&
    discoveryCache.key === apiKey &&
    now - discoveryCache.at < CACHE_TTL_MS
  ) {
    return discoveryCache.models;
  }

  const res = await fetch(MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'OverScore',
    },
    signal,
  });
  if (!res.ok) throw new Error(`Could not list OpenRouter models (${res.status}).`);

  const body = (await res.json()) as { data?: ORModel[] };
  const all = body.data ?? [];

  const free = all.filter((m) => {
    if (!m.id?.endsWith(':free')) return false;
    const inputs = m.architecture?.input_modalities ?? [];
    if (inputs.length && !inputs.includes('text')) return false;
    const modality = m.architecture?.modality ?? '';
    if (modality && !modality.includes('text')) return false;
    return (m.context_length ?? 0) >= 4000;
  });

  const strong = /(gemini|deepseek|llama-3\.[23]|qwen-?2\.5|qwen3|mistral-large|gemma-2|gemma-3|kimi|glm)/i;
  // Deprioritize models we know don't follow schema well (e.g. Nemotron).
  const weak = /(nemotron)/i;
  free.sort((a, b) => {
    const wa = weak.test(a.id) ? 1 : 0;
    const wb = weak.test(b.id) ? 1 : 0;
    if (wa !== wb) return wa - wb;
    const sa = strong.test(a.id) ? 1 : 0;
    const sb = strong.test(b.id) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return (b.context_length ?? 0) - (a.context_length ?? 0);
  });

  const ids = free.map((m) => m.id);
  discoveryCache.models = ids;
  discoveryCache.key = apiKey;
  discoveryCache.at = now;
  return ids;
}

// --- JSON extraction + coercion ---

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

// --- HTTP call ---

interface CallResult {
  verdict: Verdict;
}

async function httpCall(
  modelId: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'OverScore',
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`OpenRouter ${res.status}: ${txt.slice(0, 240)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: number | string };
  };
  if (body.error) throw new Error(`OpenRouter error: ${body.error.message ?? 'unknown'}`);

  const content = body.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('Model returned an empty response.');
  return content;
}

function parseVerdict(raw: string, modelId: string): Verdict {
  const jsonStr = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Model did not return valid JSON.');
  }
  const validated = VerdictSchema.parse(parsed);
  return { ...validated, modelId };
}

async function callOnceWithRepair(
  modelId: string,
  payload: unknown,
  apiKey: string,
  signal?: AbortSignal,
): Promise<CallResult> {
  const userMessage =
    'Analyze this match and return the JSON verdict. The data is pre-computed — do not re-derive it.\n\n' +
    JSON.stringify(payload, null, 2);

  const baseMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userMessage },
  ];

  const first = await httpCall(modelId, baseMessages, apiKey, signal);
  try {
    return { verdict: parseVerdict(first, modelId) };
  } catch (err) {
    // Second attempt: show the model its broken output and ask for a strict repair.
    if (signal?.aborted) throw err;
    const repair = await httpCall(
      modelId,
      [
        ...baseMessages,
        { role: 'assistant' as const, content: first },
        {
          role: 'user' as const,
          content:
            'Your previous response did not match the required schema. Return ONLY a single JSON object with keys: picks (array of 4 objects with market, selection, confidencePct, rationale), overallConfidence (number), keyFactors (array of strings), warning (optional string). No prose, no markdown.',
        },
      ],
      apiKey,
      signal,
    );
    return { verdict: parseVerdict(repair, modelId) };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

// --- Public API ---

export async function predictOverUnder(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Verdict> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'VITE_OPENROUTER_API_KEY is missing. Copy .env.example to .env.local, paste your OpenRouter key, and restart the dev server.',
    );
  }

  const chain: string[] = [];
  const envPrimary = import.meta.env.VITE_OPENROUTER_MODEL;
  const envFallback = import.meta.env.VITE_OPENROUTER_FALLBACK_MODEL;
  if (envPrimary) chain.push(envPrimary);
  if (envFallback && envFallback !== envPrimary) chain.push(envFallback);

  let discovered: string[] = [];
  try {
    discovered = await discoverFreeModels(apiKey, signal);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
  }
  for (const id of discovered) if (!chain.includes(id)) chain.push(id);

  if (chain.length === 0) {
    throw new OpenRouterExhausted(
      'No free models are currently available on OpenRouter for this key. Enable free-model publication at https://openrouter.ai/settings/privacy.',
      [],
      'privacy-opt-in',
    );
  }

  const attempts: { id: string; error: string; status?: number }[] = [];
  const maxAttempts = Math.min(chain.length, MAX_ATTEMPTS);

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const modelId = chain[i];

    try {
      const { verdict } = await callOnceWithRepair(modelId, payload, apiKey, signal);
      return verdict;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      const e = err as Error & { status?: number };
      const status = e.status;
      attempts.push({ id: modelId, error: e.message, status });

      // 402: key spend limit reached — no amount of model switching helps.
      if (status === 402) {
        throw new OpenRouterExhausted(
          'Your OpenRouter API key has hit its configured USD spend limit. Raise or remove the limit at https://openrouter.ai/settings/keys, then try again.',
          attempts,
          'spend-limit',
        );
      }

      // 429: one short retry, then give up on this model.
      if (status === 429) {
        try {
          await sleep(1500, signal);
          const retry = await callOnceWithRepair(modelId, payload, apiKey, signal);
          return retry.verdict;
        } catch (err2) {
          if ((err2 as Error)?.name === 'AbortError') throw err2;
          const e2 = err2 as Error & { status?: number };
          attempts.push({ id: modelId + ' (retry)', error: e2.message, status: e2.status });
          if (e2.status === 402) {
            throw new OpenRouterExhausted(
              'Your OpenRouter API key has hit its configured USD spend limit. Raise or remove the limit at https://openrouter.ai/settings/keys, then try again.',
              attempts,
              'spend-limit',
            );
          }
        }
      }
    }
  }

  const statuses = new Set(attempts.map((a) => a.status));
  let reason: OpenRouterExhausted['reason'] = 'mixed';
  if (statuses.size === 1 && statuses.has(404)) reason = 'privacy-opt-in';
  else if (statuses.size === 1 && statuses.has(429)) reason = 'rate-limit';
  else if (attempts.every((a) => !a.status)) reason = 'schema';

  const summary = attempts.map((a) => `  • ${a.id} → ${a.error}`).join('\n');
  throw new OpenRouterExhausted(
    `All ${attempts.length} OpenRouter model attempts failed.\n\nTried:\n${summary}`,
    attempts,
    reason,
  );
}
