# 145-02 — The (i-a)/(i-b) measurement memo (founder ruling 2, D-06)

**Status: IN PROGRESS — one plan precondition falsified before any timing ran; recorded first
so the numbers that follow are read against the real topology, not the assumed one.**

## §0 — Precondition falsified: there is NO TEST Railway deployment (measured 2026-08-17)

The plan (145-02 Task 2) and RESEARCH §3 Half 2 both direct Step A at "TEST Railway
`/process-key`". Measured via the Railway API this session: the workspace holds exactly ONE
project (`quantalyze-analytics`, id `dedf7fc5-b3f8-450f-b16c-6734722f5b52`) with exactly ONE
environment (`production`) and two services (`quantalyze-analytics`, `mt5-gateway`).
**A "TEST Railway URL" does not exist to be curled.** The phrase entered the ledger by
assumption, not measurement — same defect class as the census "6" and the jobid-continuity
claim (both corrected in Phase 144).

Consequences for the three steps:

- **Step A (marginal seam cost)** cannot be run as written. The only live `/process-key` is
  PROD's, and RESEARCH §3 pre-registers ⛔ "do not run Step A against PROD" (limiter
  consumption + junk 401 Sentry noise). Adaptation: run the identical control/payload curl
  loop against a LOCAL uvicorn (`analytics-service` on localhost, the sanctioned dev
  topology per `.env.local`'s `ANALYTICS_SERVICE_URL=http://localhost:8002`). This isolates
  the upload+pydantic-parse cost the seam adds. ⚠️ The cross-provider network leg
  (Vercel→Railway, ~280 KB) is thereby UNMEASURED — recorded as such, not estimated. No
  number is invented for it.
- **Step B / arm 4 (live TEST finalize)**: unaffected in substance — the finalize path is
  Next route → Supabase (TEST project `qmnijlgmdhviwzwfyzlc`); the sanctioned topology is
  the e2e-seeded one (local Next against TEST Supabase, prod-refusal guards in
  `src/lib/test-safety.ts` asserted at call time). ⚠️ Sequencing constraint: the shared
  TEST DB is in use by main CI at the time of writing (python/sql-tests/e2e post-merge of
  PR #688, plus a pending e2e-seeded rerun) — the live finalize waits for that to drain
  (standing rule: never run local work concurrently with CI against the shared TEST DB).
- **Step C (the memo table)**: the "marginal Next→Railway seam cost" column becomes
  "upload+parse cost (local, network leg unmeasured)". The decision-relevant asymmetry is
  unchanged and is worth stating plainly: **(i-b) moves ZERO new bytes across any seam**
  (the rows keep their existing single Next→PostgREST crossing); only (i-a) pays the new
  ~280 KB hop whose network leg cannot be measured without PROD noise. If anything, the
  measurement gap argues AGAINST the only option that depends on the gap being small.

## §1 — Payload size (RESEARCH §3 Half 1, re-run pending)

<!-- Half-1 node one-liner re-run + figures land here -->

## §2 — Step A: upload+parse cost, local uvicorn (5 reps control / 5 reps payload)

<!-- verbatim size_upload/time_total lines + medians land here -->

## §3 — Step B: 10-row vs 5000-row live finalize on TEST (also SC#1 arm 4 + SC#3 baseline)

<!-- wall-clocks + minted strategy ids + baseline row states land here -->

## §4 — The decision table (Step C)

<!-- payload bytes | upload+parse (local) | full-cap persist delta (B) | route totals (B) -->
