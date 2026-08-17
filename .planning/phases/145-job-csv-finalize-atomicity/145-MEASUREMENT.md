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

## §1 — Payload size (RESEARCH §3 Half 1, re-run 2026-08-17 19:03 UTC)

RESEARCH's committed node one-liner re-run verbatim; figures reproduce exactly:

```
envelope alone: 235
5000-row series: 280001
envelope+series: 280260
```

## §2 — Step A: upload+parse cost (zero-DB harness on the REAL model, 2026-08-17 19:04 UTC)

Topology (adapted per §0): a scratchpad FastAPI harness importing the REAL
`routers.process_key._ProcessKeyBody` (import verified side-effect-free: fields
`context/flow_type/source`, extras ignored) and answering 401 immediately — the same
receive→pydantic-parse→401 path as `process_key.py:1136-1146`, with zero Supabase, zero
secrets, zero worker risk. Local uvicorn, port 8299, warmed up before timing. Two endpoints:

- `/process-key` — the model AT HEAD (`daily_returns_series` is an ignored extra → the
  measured delta is a LOWER bound: json-parse of 280 KB, no per-row validation)
- `/process-key-ia` — the shape an (i-a) implementation would declare
  (`daily_returns_series: list[dict] | None`) → per-row validation paid

Verbatim `size_upload time_total` lines (5 reps each):

```
process-key control.json 235 0.001085
process-key control.json 235 0.000997
process-key control.json 235 0.001230
process-key control.json 235 0.001574
process-key control.json 235 0.001263
process-key payload.json 280260 0.003734
process-key payload.json 280260 0.004303
process-key payload.json 280260 0.004062
process-key payload.json 280260 0.004820
process-key payload.json 280260 0.005071
process-key-ia control.json 235 0.001065
process-key-ia control.json 235 0.001013
process-key-ia control.json 235 0.001124
process-key-ia control.json 235 0.001086
process-key-ia control.json 235 0.001127
process-key-ia payload.json 280260 0.015875
process-key-ia payload.json 280260 0.040645
process-key-ia payload.json 280260 0.005419
process-key-ia payload.json 280260 0.005376
process-key-ia payload.json 280260 0.005461
```

| Variant | median(control) | median(payload) | marginal upload+parse |
|---|---|---|---|
| model at HEAD (extras ignored — lower bound) | 1.230 ms | 4.303 ms | **≈ 3.1 ms** |
| (i-a)-declared field (per-row validation) | 1.086 ms | 5.461 ms | **≈ 4.4 ms** |

(The two 15.9/40.6 ms `process-key-ia payload` lines are first-touch outliers; medians are
robust to them and all raw lines are recorded above.)

**Reading:** parsing the full-cap series costs single-digit milliseconds. The unmeasured
cross-provider network leg (§0) would add transfer time for 280 KB — even generously
bounded, tens of milliseconds on an intra-cloud hop — against route totals that run to
seconds (§3). Per RESEARCH §3 Step C's pre-registered decision rule: **the latency argument
is retired; the (i-a)/(i-b) choice is architectural.** Limiter note: the loop ran against a
local harness, consuming zero live limiter budget anywhere (limits at HEAD for reference:
tenant 100/hour, anon 30/hour, ceiling 500/hour — `process_key.py:100-114`).

## §3 — Step B: 10-row vs 5000-row live finalize on TEST (2026-08-17 19:39 UTC)

Two real finalizes through the full local stack (Next route → Python `/process-key` →
`finalize_csv_strategy` RPC → hop-4 persist → enqueue) against TEST. Verbatim:

```
FINALIZE[arm4-10row]   rows=10   status=200 wall=2966ms  strategy_id=824b0fe8-ff94-4578-827e-cd060b8bce68
FINALIZE[stepB-5000row] rows=5000 status=200 wall=2852ms  strategy_id=2979d948-e55e-4a60-b5c3-698a089de676
```

**5000−10 delta: −114 ms — i.e. NEGATIVE, inside noise.** (The 10-row call was the first
hit on a fresh `next dev` and paid route compilation; the delta's sign makes the point
regardless: a 500× larger series does not measurably move the ~2.9 s route total.) The
full-cap hop-4 persist cost — the cost the folded call inherits under (i-b) — is bounded by
run-to-run noise, well under 5% of the route total. Minted ids recorded in
145-REPRODUCTION.md arm 4 for Plan 06's archive step.

## §4 — The decision table (Step C)

| Quantity | Value | Source |
|---|---|---|
| Series payload (5000 rows, envelope+series) | **280,260 B** | §1, re-derived |
| (i-a) NEW seam crossings for the rows | **+1** (Next→Railway) | §0 topology |
| (i-b) NEW seam crossings for the rows | **0** (keeps today's single Next→PostgREST hop) | §0 topology |
| Upload+parse of the 280 KB body (HEAD model, lower bound) | **≈ 3.1 ms** | §2 |
| Upload+parse with (i-a)-declared per-row field | **≈ 4.4 ms** | §2 |
| (i-a) network leg (cross-provider, 280 KB) | **UNMEASURED** — no TEST Railway exists; PROD probing pre-banned | §0 |
| Full-cap persist delta (5000 vs 10 rows, live) | **≤ noise (−114 ms on a ~2.9 s total)** | §3 |
| Live route totals (10 / 5000 rows) | **2966 / 2852 ms** | §3 |

**Conclusion (the §3-Step-C pre-registered rule applied): the latency argument is RETIRED.**
Every measurable latency quantity is single-digit milliseconds against ~3-second route
totals. The one unmeasured quantity (the cross-provider network leg) exists ONLY under
(i-a) — the option that would need it to be small. The choice is therefore purely
architectural: **(i-a)** preserves Phase 106 Stage B's sole-finalize-path ruling but keeps
window A alive (downgraded to D, healed by 143) and grows the seam payload ~280 KB;
**(i-b)** removes window A outright and converges both writers on one route-side caller,
but reverses Phase 106 Stage B for this flow and obligates deleting the Python csv-finalize
branch (a live second writer otherwise). Founder decides (D-06).
