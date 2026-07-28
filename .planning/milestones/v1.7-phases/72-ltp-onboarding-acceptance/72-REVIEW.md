---
phase: 72-ltp-onboarding-acceptance
reviewed: 2026-07-05T14:10:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - analytics-service/routers/process_key.py
  - analytics-service/services/ingestion/long_fetch.py
  - analytics-service/services/job_worker.py
  - src/lib/strategyGate.ts
  - src/app/api/admin/strategy-review/route.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 72: Code Review Report

**Reviewed:** 2026-07-05T14:10:00Z
**Depth:** deep
**Files Reviewed:** 6 (+ 6 test files traced)
**Status:** issues_found (no blockers)

## Summary

Phase 72 wires Deribit strategy onboarding through the ledger (`derive_broker_dailies`)
path instead of the fill-based pipeline. I traced the venue-aware `isLedgerBacked`
fix (commit `62b2d825`) across every decision point, the Python skip logic in
`run_process_key_long_job`, and every deribit permanent-FAIL branch in
`run_derive_broker_dailies_job`. I verified claims by running the P72 test suite
(43 TS + 4 targeted Python tests all pass) and `tsc --noEmit` (exit 0).

**The Finding-1 fix is correct AND complete.** `isLedgerBacked` is threaded to all
four places the daily-returns branch is decided, the perp-funding leak is closed in
every one, and the regression tests are genuinely revert-proof. No blockers.

The remaining findings are a real-but-fail-closed silent-failure in the admin
route's new `api_keys` read, and minor robustness/clarity notes.

### Fix verification (a) — threaded to EVERY decision point: CONFIRMED

The daily-returns branch is decided in exactly these places, all venue-aware:
1. `src/lib/strategyGate.ts:140-143` — `(!input.apiKeyId || input.isLedgerBacked === true)`.
2. `src/app/(dashboard)/.../SyncPreviewStep.tsx:472` — `isLedgerBacked: isLedgerBackedExchange(keyRow?.exchange)`.
3. `src/app/api/admin/strategy-review/route.ts:152` — first-pass gate input.
4. `src/app/api/admin/strategy-review/route.ts:228-231` — TOCTOU re-check mirror predicate.

`grep` for `checkStrategyGate` confirms only two non-test callers exist (admin route +
wizard); both pass `isLedgerBacked`. `finalize-wizard` promotes to `pending_review`
without an independent trade-count gate, so it is not a fourth decision point. The
first-pass gate and re-check use identical predicate operands
(`apiKeyId`/`approveApiKeyId` are the same `strategy.api_key_id ?? null`, and both use
the same `isLedgerBacked` local) — they cannot diverge. **Complete.**

### Fix verification (c) — tests are revert-proof: CONFIRMED

- `strategyGate.test.ts` "keyed FILL-based (perp) … must NOT publish → INSUFFICIENT_TRADES":
  omits `isLedgerBacked` (false), `csvRowCount:30`. Reverting the venue term (back to
  bare `tradeCount===0 && csvRowCount>0`) routes the perp to the CSV branch and PASSES →
  test fails. Guards the exact Finding-1 defect.
- `route.test.ts` "keyed FILL-based (perp) … → 409 trade count": same construction on the
  re-check; without the venue term the perp 200s → test fails.
- `test_long_fetch_deribit_enqueues_derive_broker_dailies_and_skips_fills`: fill methods
  are `AssertionError` side-effects; reverting the `is_ledger_backed` skip calls
  `fetch_raw` → test fails. Also asserts `p_kind == "derive_broker_dailies"`.
- Ran all four + the gate/route suites: pass.

## Warnings

### WR-01: Admin `api_keys` exchange read swallows its error — silent venue misclassification

**File:** `src/app/api/admin/strategy-review/route.ts:135-142`
**Issue:** The new first-pass fetch destructures only `data`, never `error`:
```ts
const { data: keyRow } = await admin
  .from("api_keys").select("exchange").eq("id", approveApiKeyId).maybeSingle();
isLedgerBacked = isLedgerBackedExchange(keyRow?.exchange);
```
On a transient read failure `keyRow` is `undefined` → `isLedgerBacked` silently becomes
`false`. A legitimate keyed **Deribit** strategy (0 `trades` by construction) then falls
to the trade branch and is rejected with a misleading `400 "…only 0 trade(s)…
INSUFFICIENT_TRADES"`. This is **fail-closed** (it can never wrongly publish a perp —
`isLedgerBacked=true` requires a *successful* read returning `"deribit"`), so it is not a
data-integrity or security risk. But it is a silent failure that directly contradicts the
fail-loud guard *one block above* (the `csvCountError` read returns a 503 rather than
coercing to 0, L120-126) for the same class of problem. Project convention (CLAUDE.md
Rule 12 "Fail loud") is violated here.
**Fix:** Destructure and fail loud, mirroring the adjacent csv-count guard:
```ts
const { data: keyRow, error: keyErr } = await admin
  .from("api_keys").select("exchange").eq("id", approveApiKeyId).maybeSingle();
if (keyErr) {
  console.error("[admin/strategy-review] api_keys exchange read failed:", keyErr);
  return NextResponse.json(
    { error: "Cannot verify strategy data source. Please try again." },
    { status: 503 },
  );
}
isLedgerBacked = isLedgerBackedExchange(keyRow?.exchange);
```
Note: the wizard's mirror read (`SyncPreviewStep.tsx:440-446`) also ignores the error,
but there the whole `Promise.all` is already wrapped in the heavy-fetch escalation
try/catch, so a throw is surfaced — the admin route has no such wrapper.

### WR-02: TOCTOU re-check reuses first-pass `isLedgerBacked` yet stamps the mirror "must never diverge" — divergence is silent if the read fails

**File:** `src/app/api/admin/strategy-review/route.ts:228-231` (with L135-142)
**Issue:** The re-check predicate intentionally reuses `approveApiKeyId` + `isLedgerBacked`
captured in the first pass (the `strategies.api_key_id` re-read was dropped, L192-195).
That is acceptable within a single request. But combined with WR-01, a failed `api_keys`
read makes `isLedgerBacked=false` for BOTH the first-pass gate and the re-check, so a real
Deribit strategy is rejected *consistently* rather than caught — the "must never diverge"
invariant (L226-227) holds, but at the cost of both paths being wrong together. Fixing
WR-01 (fail loud) resolves this: no request ever proceeds with an unverified exchange.
**Fix:** Fix WR-01. No separate change needed; this note documents the coupling so the
re-check's stale-value reuse is not later "hardened" by re-reading only one side.

## Info

### IN-01: Double redaction of the ledger-error stamp message

**File:** `analytics-service/services/job_worker.py:1902-1905, 1864`
**Issue:** The ledger-incomplete branch builds the message with
`str(scrub_freeform_string(str(exc)))`, then `_stamp_deribit_analytics_failed` scrubs the
whole message again (`scrubbed = str(scrub_freeform_string(message))`). Redaction is
idempotent so this is harmless, just redundant.
**Fix:** Pass the raw `str(exc)` to the helper and let the single scrub inside it handle
redaction, matching the material-equity branch (L1926-1929) which passes a plain string.

### IN-02: `assert trades is not None` used as control-flow in the ledger skip

**File:** `analytics-service/services/ingestion/long_fetch.py:389, 419` (approx; the
`assert trades is not None and metrics is not None` and `assert trades is not None` guards)
**Issue:** Python `assert` is stripped under `-O`. The invariant holds by construction (the
`if not is_ledger_backed` guard guarantees `trades`/`metrics` are set on that path), so
stripping is currently harmless — but asserts-as-invariant on a P&L critical path are
fragile if the branch structure later changes.
**Fix:** Optional — leave as documentation-of-invariant, or promote to an explicit
`raise RuntimeError(...)` if you want the guard to survive `-O`.

### IN-03: `metrics_captured` transition emits empty `{}` metadata for the ledger path

**File:** `analytics-service/services/ingestion/long_fetch.py:372-382`
**Issue:** The ledger branch advances the state machine to `metrics_captured` with
`p_metadata: {}` (no `metrics_snapshot` key), whereas the fill path writes
`{"metrics_snapshot": …}`. I found no consumer that requires `metrics_snapshot` (the wizard
polls `strategy_analytics.computation_status`, not this metadata), so this is safe. Flagging
only to confirm no `strategy_verifications` metadata consumer dereferences
`metrics_snapshot` unguarded.
**Fix:** None required; verify no downstream reader assumes the key exists.

---

## Bottom line

**No BLOCKERS before ship.** The Finding-1 venue-aware fix is correct, complete across all
four decision points, and revert-proof-tested; every deribit permanent-FAIL branch in the
derive job stamps a terminal `failed` so the wizard poller cannot spin; the Python fill-skip
never invokes the `NotImplementedError` fill methods and routes the factsheet through
`derive_broker_dailies`. Recommend fixing **WR-01** (swallowed `api_keys` read error →
fail-loud 503) before ship for convention parity and to avoid a misleading "0 trades"
rejection of a legitimate Deribit onboarding on a transient DB blip — but it is fail-closed,
so it is not release-blocking.

---

_Reviewed: 2026-07-05T14:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
