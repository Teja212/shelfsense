# ShelfSense

**Turns the movies and music you love into a book you can hold — from what's actually on the shelf.**

A taste-grounded, agentic bookseller for independent bookstores, built on [Qloo](https://qloo.com)'s
taste graph. Submission for the Qloo Agentic Hackathon — *"agents, but with taste."*

**Live demo:** _<add your deployed URL here>_

---

## For judges — how to test it in 2 minutes

1. **`/recommend`** — the main experience.
   - Leave the example favorites (*Interstellar, Radiohead, Gillian Flynn*), keep the $25 budget, hit **Find me a book**.
   - Watch the **agent reasoning stream** live: it resolves each favorite in Qloo (disambiguating as it goes), ranks what's in stock, and returns three picks — a close match, an overlooked gem, and a wildcard — each with a **grounded reason**.
   - Click **Mark out of stock** on the top pick → the agent re-plans and explains the swap.
   - Click a **Refine** chip (*Shorter*, *Less dark*) → the shortlist adapts.
   - Click **Already read it** → that book is set aside and replaced.
2. **`/compare`** — blind A/B: the same reader ranked by **Qloo** vs. by an **LLM alone**, columns hidden until you vote. Evidence that the taste layer earns its place.
3. **`/provenance`** — every Qloo call the app made, with params and latency. Nothing is invented.
4. **`/owner`** — the store side: edit stock/price/shelf, confirm a book's Qloo match, and **Reset demo data** to a clean slate.

Everything a pick shows — shelf, price, and the "why" — traces to real Qloo data and real inventory.

## How it works

1. A store imports its catalog (a plain CSV export — the universal format every POS/ILS produces).
2. ShelfSense maps each book to a Qloo entity; the owner confirms any uncertain match.
3. A customer shares a few favorites (movies, music, books) plus budget and preferences.
4. The **agent** resolves those favorites in Qloo, ranks the **in-stock** catalog against them, and returns three explained picks.
5. Feedback (*shorter*, *less dark*, *already read it*, *out of stock*) re-plans the shortlist live.

## Qloo integration (the heart)

- **Resolution** — `GET /search` turns each free-text favorite into a Qloo entity, across movies, music, authors and books.
- **Ranking** — `GET /v2/insights` with `filter.type=urn:entity:book`, the favorites as `signal.interests.entities`, and the **in-stock catalog as `filter.results.entities`**. Ranking is *always* constrained to real inventory — unconstrained book discovery skews to music/biography nonfiction (we verified this; see `qloo-smoketest.mjs`).
- **Grounded reasons** — `feature.explainability=true` returns per-favorite attribution scores, so every "why" names the favorite that actually drove the pick.

**Division of labor:** Qloo decides *taste* (ranking + attribution). The LLM (DeepSeek) only applies *soft constraints* ("shorter", "less dark") and phrases the reasons — it never invents books or overrides the taste signal. Remove the LLM key and the app still works deterministically.

## Architecture

- **Next.js (App Router) + TypeScript.** Qloo and DeepSeek calls run server-side only — keys never reach the browser.
- **Agent** — `lib/agent.ts`, an async generator streamed to the UI as newline-delimited JSON (`/api/agent`).
- **Store** — in-memory, seeded from the committed `data/inventory.json`; runtime edits persist for the life of the instance and reset on demand. Works on a read-only filesystem.
- **Provenance** — `lib/provenance.ts` logs every Qloo call for the transparency view.

## Quick start (local)

```bash
npm install
npm run import     # load the demo catalog -> data/inventory.json
# resolve each book to a Qloo entity (needs the key):
#   PowerShell:  $env:QLOO_API_KEY="..."; npm run resolve
#   bash/zsh:    QLOO_API_KEY="..." npm run resolve
npm run dev        # http://localhost:3000
```

Copy `.env.local.example` to `.env.local` and set the keys:

| Variable | Required | Purpose |
|---|---|---|
| `QLOO_API_KEY` | yes | Qloo hackathon key (server-side only) |
| `DEEPSEEK_API_KEY` | optional | Enables preference reasoning + phrased explanations |
| `UPSTASH_REDIS_REST_URL` | prod only | Persists inventory edits + A/B tally on serverless hosts |
| `UPSTASH_REDIS_REST_TOKEN` | prod only | — |

Locally, leave the Upstash vars unset — the store falls back to in-memory.

## Deploy (a URL judges can test)

**Vercel + Upstash Redis (both free, no card):**
1. Create a free Redis DB at [console.upstash.com](https://console.upstash.com) and copy its `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. Import the GitHub repo at [vercel.com](https://vercel.com) (it auto-detects Next.js — no config needed).
3. Add four environment variables: `QLOO_API_KEY`, `DEEPSEEK_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
4. Deploy → public `*.vercel.app` URL.

Redis is what lets owner edits and the out-of-stock re-plan persist across Vercel's serverless invocations; the agent routes set `maxDuration = 60` so the Qloo + LLM calls don't time out. Any single-instance Node host (Render, Railway, Fly.io) also works and doesn't need Redis — the in-memory store persists there on its own.

## Scripts

| Command | What it does |
|---|---|
| `npm run import` | Parse `data/catalog.csv` → `data/inventory.json` |
| `npm run resolve` | Map each book to a Qloo ID; flag weak matches |
| `npm run smoketest` | Re-run the original Qloo de-risk checks |
| `npm run dev` / `build` / `start` | Next.js dev / build / serve |

## License

MIT — see `LICENSE`.
