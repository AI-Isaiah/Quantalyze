---
phase: 42-peer-cohort-override-mandate
verified: 2026-06-26T12:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open /allocations in a logged-in allocator session, build a blend with >=252 observations. Confirm the peer-rank panel renders with a real cohort size (>=20) and shows decile-quantized percentiles; or, if the cohort is below the min-N floor, confirm the panel is absent (honest suppression)."
    expected: "Peer panel either shows cohortSize, sharpe_pct, sortino_pct, max_dd_pct (all multiples of 10) with disclosure text 'hypothetical blend · ranked vs verified strategies · sample/252 basis', or is completely absent when cohort < 20. No 'Demo' badge on scenario peer panel."
    why_human: "Requires authenticated allocator session with a real Supabase verified-universe cohort. With no current clients the cohort is almost certainly below the 20-strategy floor, so the panel suppresses honestly — the suppression path itself is the canary."
---

# Phase 42: Peer-Cohort Override & Mandate Verification Report

**Phase Goal:** Ship the real verified-cohort peer rank into the scenario factsheet (additive carve-out only — ingestSource stays 'csv'; no synthetic api panels unlock) plus constituent mandate chips and own-book delta disclosure.

**Verified:** 2026-06-26
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ADR exists documenting the additive carve-out decision; ingestSource is never flipped to "api" | VERIFIED | `docs/architecture/adr-0025-scenario-peer-carveout.md` Status: Accepted 2026-06-26. MetricsColumn gate (line 126-129) explicitly reads `payload.ingestSource === "api" \|\| (scenarioMode && payload.ingestSource === "csv" && payload.scenarioPeer != null)` — ingestSource stays "csv". |
| 2 | RPC is aggregate-only, min-N=20, identity-stripped, decile-quantized, and uses honest verified predicate (`status='published'`, not a tautology) | VERIFIED | Migration `20260626120000_get_verified_cohort_rank.sql`: predicate is `v.status = 'published'` (not `trust_tier IS NOT NULL`). `v_min_n CONSTANT INT := 20`. SELECT list contains ONLY `count(*)` aggregates — no `s.id`, `s.name`, `a.strategy_id`. Quantization: `round(round(100.0 * count(*) FILTER (...) / v_n) / 10.0) * 10`. SECURITY DEFINER + REVOKE ALL from PUBLIC/anon + auth.role() guard. |
| 3 | Route returns rank-only (`{ peer: PeerPercentilePayload \| null }`); peer rank uses sample/252 basis metrics from the engine | VERIFIED | `src/app/api/scenario/peer-rank/route.ts` success response (line 212-218) is exactly `{ peer: { cohortSize, sharpe, sortino, max_dd } }`. `buildScenarioPeerRankRequest` in `src/lib/scenario-peer-request.ts` gates on `n < 252` and forwards engine's own sample-basis sharpe/sortino/max_drawdown directly. `sampleBasisRatios` standalone replica (ddof=1) used only for own-book delta arm. |
| 4 | Mandate chips render from per-constituent real fields; own-book delta discloses dual observation counts (blend_n + book_n) | VERIFIED | `MandatePanels.tsx` ConstituentMandatePanel reads `deAliased.strategies` per-constituent `strategy_types[]`, `markets[]`, `leverage` — no fabricated aggregates. `OwnBookDeltaPayload` type (types.ts) includes `blend_n: number; book_n: number`. BatchDPanels.tsx OwnBookDeltaPanel renders `{delta.blend_n.toLocaleString()} obs blend · {delta.book_n.toLocaleString()} obs book`. |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` | SECDEF RPC, min-N=20, honest predicate, decile quantization, identity-stripped | VERIFIED | Confirmed: `v_min_n = 20`, `v.status = 'published'`, decile rounding, SELECT aggregates only, REVOKE/GRANT hardening, self-verifying DO block |
| `docs/architecture/adr-0025-scenario-peer-carveout.md` | ADR documenting ingestSource-no-flip decision | VERIFIED | Status: Accepted 2026-06-26. Documents three alternatives rejected. |
| `src/app/api/scenario/peer-rank/route.ts` | POST endpoint with security chain, returns `{ peer }` only | VERIFIED | Full chain: assertSameOrigin → auth → assertProfileApproved → parse → checkLimit(scenarioPeerLimiter) → RPC → `{ peer }`. NO_STORE_HEADERS on every path. |
| `src/lib/factsheet/types.ts` | `PeerPercentilePayload`, `ScenarioMandatePayload`, `OwnBookDeltaPayload` (with blend_n) | VERIFIED | All three types present. `OwnBookDeltaPayload` includes `blend_n: number; book_n: number` (WR-02 fix). |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` | Additive gate: `ingestSource === "api" \|\| (scenarioMode && ingestSource === "csv" && scenarioPeer != null)` | VERIFIED | Lines 126-129 match exactly. ingestSource never mutated. |
| `src/lib/scenario-peer-request.ts` | n < 252 guard, passes engine metrics, pure | VERIFIED | `PEER_RANK_MIN_OBS = 252`, null-return on non-finite or n < 252, dependency-free. |
| `src/lib/sample-basis-ratios.ts` | Standalone sample-basis replica (ddof=1) with parity golden test | VERIFIED | Standalone function, not extracted from frozen scenario.ts. Golden parity test confirms engine contract. |
| `src/app/factsheet/[id]/v2/BatchDPanels.tsx` | PeerPercentilePanel (dual-read api/csv arms), OwnBookDeltaPanel (blend_n + book_n), scenario disclosure text | VERIFIED | Dual-read via `payload.ingestSource === "api" ? payload.peerPercentile : (payload.scenarioPeer ?? null)`. Disclosure: `"hypothetical blend · ranked vs verified strategies · sample/252 basis"`. OwnBookDeltaPanel renders `blend_n.toLocaleString() obs blend · book_n.toLocaleString() obs book`. |
| `src/app/factsheet/[id]/v2/MandatePanels.tsx` | ConstituentMandatePanel reads per-constituent real fields, honest-empty when no metadata | VERIFIED | Reads `payload.ingestSource === "csv" ? (payload.scenarioMandate ?? null) : null`. Honest-empty "no mandate metadata" when strategy_types AND markets both empty. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | scenarioPeer fetch effect (AbortController + 350ms debounce), scenarioMandate memo, scenarioOwnBookDelta memo | VERIFIED | `PEER_RANK_DEBOUNCE_MS = 350` (WR-01). fetch effect lines 1567-1610: AbortController + clearTimeout cleanup. scenarioMandate memo from deAliased.strategies. scenarioOwnBookDelta memo derives book returns, runs sampleBasisRatios, subtracts from scenarioMetrics. |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | All three props accepted and passed to buildScenarioFactsheetPayload | VERIFIED | Lines 107, 115, 121: typed props. Lines 205-207: all three forwarded into buildScenarioFactsheetPayload memo. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| ScenarioComposer fetch effect | `/api/scenario/peer-rank` | POST, AbortController + 350ms debounce | WIRED | Lines 1567-1610. Request body: `{ sharpe, sortino, maxDD, n }`. Reads `response.peer`. |
| `/api/scenario/peer-rank` route | `get_verified_cohort_rank` RPC | `supabase.rpc(...)` cast-through-unknown | WIRED | Lines 167-176. Maps row → PeerPercentilePayload at lines 212-218. |
| ScenarioComposer | ScenarioFactsheetChart | Props `scenarioPeer`, `scenarioMandate`, `scenarioOwnBookDelta` | WIRED | Line 2471: `scenarioPeer={scenarioPeer ?? undefined}` and sibling props. |
| ScenarioFactsheetChart | buildScenarioFactsheetPayload | Memo dep array and forwarded args | WIRED | Lines 205-207, dep array line 209. |
| MetricsColumn | PeerPercentilePanel | Gate: `ingestSource === "api" \|\| (scenarioMode && ingestSource === "csv" && scenarioPeer != null)` | WIRED | Lines 126-129. carve-out condition is additive, not a flip. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| PeerPercentilePanel (csv arm) | `payload.scenarioPeer` | ScenarioComposer fetch → `/api/scenario/peer-rank` → `get_verified_cohort_rank` RPC → Supabase `allocator_metrics` + `strategy_verifications` join | Yes — live DB aggregate query, not static return | FLOWING |
| ConstituentMandatePanel | `payload.scenarioMandate` | ScenarioComposer memo from `deAliased.strategies[].strategy_types/markets/leverage` | Yes — reads live allocated strategy metadata | FLOWING |
| OwnBookDeltaPanel | `payload.scenarioOwnBookDelta` | ScenarioComposer memo from `baselineEquityDailyPoints` (live book levels) → `sampleBasisRatios(bookReturns)` → delta vs `scenarioMetrics` | Yes — derives from live equity curve, not hardcoded | FLOWING |

---

### Security / Probe-Resistance Verification

| Control | Location | Status |
|---------|----------|--------|
| SECURITY DEFINER + search_path lock | Migration line ~35 | VERIFIED |
| REVOKE ALL FROM PUBLIC, anon + GRANT to authenticated, service_role | Migration | VERIFIED |
| auth.role() = 'anon' guard inside RPC body | Migration — RAISE 42501 | VERIFIED |
| Identity-strip: no strategy id/name in SELECT | Migration SELECT list — aggregates only | VERIFIED |
| Decile quantization (round to 10) | Migration quantization expression | VERIFIED |
| min-N = 20 floor (RPC + route belt-and-suspenders) | Migration `v_min_n = 20`; route `MIN_COHORT_N = 20` | VERIFIED |
| scenarioPeerLimiter (60 req/60s) + validate-before-limit B15 ordering | route.ts lines 127-155 | VERIFIED |
| NO_STORE_HEADERS on every response path | route.ts — all return branches | VERIFIED |

---

### Frozen Spine Invariant (SCENARIO-05)

| Claim | Status | Evidence |
|-------|--------|---------|
| `scenario.ts` zero-diff (frozen-spine guards must pass) | VERIFIED | Phase 42-05 took the alternative path (standalone `sampleBasisRatios` replica) specifically because extracting from scenario.ts would violate the freeze. The SUMMARY documents frozen-spine CI guards (phases 29-32) are green. No modification to scenario.ts appears in any phase 42 plan or summary. |
| `sampleBasisRatios` is a standalone replica, not an extraction | VERIFIED | `src/lib/sample-basis-ratios.ts` is a new file; it does not import from scenario.ts. |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| peer-rank route file exists and exports POST | `ls src/app/api/scenario/peer-rank/route.ts` | File present, `export async function POST` confirmed | PASS |
| RPC migration file exists | `ls supabase/migrations/20260626120000_get_verified_cohort_rank.sql` | Present | PASS |
| ADR file exists | `ls docs/architecture/adr-0025-scenario-peer-carveout.md` | Present | PASS |
| sample-basis-ratios module exists | `ls src/lib/sample-basis-ratios.ts` | Present | PASS |
| ingestSource not mutated in ScenarioComposer | `grep -n "ingestSource" ScenarioComposer.tsx` (no assignment) | Not set; only read via payload type narrowing | PASS |

---

### Anti-Patterns Found

None. No TBD/FIXME/XXX markers in phase-42 files. No stubs (all handlers fetch real data, all empty states are honest-empty on real-empty input). The cast-through-unknown pattern on the RPC call is explicitly documented with a cleanup note (types regen is orchestrator-owned) — not a debt marker.

---

### Human Verification Required

#### 1. Authed Live Peer Panel — Real Cohort

**Test:** Sign in as an allocator. On /allocations, build a blend with >= 252 observations. After the peer-rank debounce fires, check the factsheet's peer panel.

**Expected:** Either (a) the peer panel shows `cohortSize`, `sharpe` (multiple of 10), `sortino` (multiple of 10), `max_dd` (multiple of 10), disclosure text "hypothetical blend · ranked vs verified strategies · sample/252 basis" with no "Demo" badge — or (b) the panel is completely absent because the verified-universe cohort is below the 20-strategy minimum-N floor (honest suppression, not an error).

**Why human:** Requires an authenticated allocator session. With no current clients on the platform, the verified-universe cohort is almost certainly < 20 strategies, so the expected outcome is (b) honest suppression. This is a non-blocking canary: the suppression path is the correct behaviour, not a failure.

---

### Gaps Summary

No gaps. All 4 must-haves are fully implemented in shipped code. The one human verification item (authed canary on real cohort) is explicitly non-blocking: the cohort-below-floor suppression path is the expected outcome given current platform scale, and that path is code-verified via the NULL-pct short-circuit in route.ts lines 201-208.

---

**Verdict.** All four phase-42 must-haves are fully implemented and wired end-to-end. The ADR is present and accepted. The RPC is aggregate-only, identity-stripped, decile-quantized, uses an honest `v.status = 'published'` predicate (not the tautological trust_tier check), enforces min-N=20 at both the RPC and route layers, and is hardened with SECDEF + REVOKE/GRANT + rate-limit. The ingestSource carve-out is additive: MetricsColumn reads the existing "csv" source and conditions on the presence of the new `scenarioPeer` field — it never flips ingestSource to "api". Mandate chips read live per-constituent metadata from the allocated strategies; own-book delta discloses both blend and book observation counts (WR-02). scenario.ts is untouched (frozen spine intact, standalone replica used instead). The only deferred item is an authed live canary that requires a real verified-universe cohort of >= 20 strategies; with no current clients this will honestly suppress, which is the correct behaviour.

---

_Verified: 2026-06-26T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
