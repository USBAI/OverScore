# OverScore — AI Over/Under Football Predictor

Local-only React app that uses TheSportsDB (free) + OpenRouter (free models) to
produce AI-assisted Over/Under goals predictions, with a visible step-by-step
reasoning pipeline and `localStorage` caching.

## Quick start

```bash
npm install
cp .env.example .env.local    # paste your OpenRouter key inside
npm run dev
```

Open http://localhost:5173.

## Requirements

- Node 20+ (tested on Node 22)
- A free OpenRouter API key from https://openrouter.ai/keys

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start Vite dev server on :5173 |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview the built app |

## Tech

Vite · React 18 · TypeScript · Tailwind · shadcn-style UI · React Query ·
Zustand · React Router · Zod · date-fns.

## Structure

See `src/` — organized by feature (`features/matches`, `features/prediction`)
with shared primitives in `components/ui`.
# OverScore
