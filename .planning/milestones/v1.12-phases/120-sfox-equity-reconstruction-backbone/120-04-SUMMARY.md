---
phase: 120-sfox-equity-reconstruction-backbone
plan: 04
subsystem: ground-truth-parity
tags: [sfox, sfox-06, ground-truth, parity, p115, fail-loud, sanitize, founder-gated, api-verified]

# Dependency graph
requires:
  - phase: 120-02
    provides: broker_dailies.combine_sfox_balance_history (the reconstructed curve under test), sfox_read.crawl_sfox_balance_history / crawl_sfox_transactions / sfox_flows_by_day / _FLOW_SIGN / _ROTATION_ACTIONS / _utc_day_iso
  - phase: 67-deribit-ground-truth
    provides: scripts/deribit_ground_truth.py — the harness PATTERN + the REUSED sanitize_evidence / assert_sanitized / _redact_secret_values / ScopeViolationError primitives
  - phase: 118-sfox-read-client
    provides: SfoxClient (GET-only Bearer adapter, prod base URL, bounded aclose) + the test_sfox_client_live.py skipIf idiom
provides:
  - scripts/sfox_ground_truth.py — the committed P115-independent parity harness (reconstruct_equity_from_transactions oracle; check_parity cross-stream gate; A2/A3 evidence probes; exit codes 0/1/2/3)
  - tests/test_sfox_ground_truth.py — the CI-carrying fixture parity gate (consistent pass, two tamper fail-loud proofs, oracle-independence pins, sanitize-raise pin)
  - tests/test_sfox_ground_truth_live.py — the founder-gated live parity leg (skipIf no key; 121-egress documented; skip != pass)
affects: [121, 122]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "P115-independent oracle: reconstruct_equity_from_transactions takes ONLY the transactions rows (signature-enforced) and rolls the ledger's own running account_balance + typed cashflows by hand — never reads the usd_value series, never calls the module's own combine/chain_linked_twr (a self-referential oracle would pin the impl's formula)"
    - "cross-stream parity gate: two INDEPENDENT equity streams (balance-history usd_value vs transactions account_balance) compared on the level-change residual d_t = Δusd_value − Δaccount_balance under a rel(0.5%)+abs($1) materiality; material divergence RAISES (exit 1) — the wrong curve never displays"
    - "A2 discriminator: cash-only account_balance is piecewise-constant BETWEEN cashflow events; a material divergence with account_balance flat off-events is the A2 cash-vs-MTM ambiguity → FLAG requires_founder_decision (exit 0, at least one interpretation reconciles), NOT auto-fail"
    - "sanitization reuse (single import line from scripts.deribit_ground_truth): sanitize_evidence + assert_sanitized re-walk the whitelisted evidence (dates/floats/counts/residuals/flags) before print; every error path scrubbed via _redact_secret_values; the Bearer never reaches stdout/stderr"
    - "founder-gated live leg mirrors test_sfox_client_live.py: skipIf(no SFOX_GROUND_TRUTH_KEY) keeps CI green; a skip is documented as NOT a pass; no code path synthesizes a green"

key-files:
  created:
    - analytics-service/scripts/sfox_ground_truth.py
    - analytics-service/tests/test_sfox_ground_truth.py
    - analytics-service/tests/test_sfox_ground_truth_live.py
  modified: []

key-decisions:
  - "The tamper-B fixture models a HIDDEN deposit: present in balance-history (usd_value jumps) but absent from the transactions ledger (no row AND account_balance never rolls it). This is the only construction where a dropped deposit actually diverges — if account_balance still reflected the deposit, BOTH streams would book the same fake return and cross-parity could not catch it. It matches the plan's economic intent ('a hidden deposit would otherwise book as fake return')."
  - "Fixtures use a 100%-liquid-USD account so account_balance == usd_value when correct — the A2 cash-vs-MTM interpretations COINCIDE and any divergence is unambiguous corruption (raise). A separate cash-only fixture (account_balance flat off-events, usd_value daily-marked) exercises the A2 flag path (requires_founder_decision, no raise). This keeps the offline gate decisive while honestly surfacing the A2 unknown the founder run resolves."
  - "Materiality = |residual| > max($1 absolute floor, 0.5% relative). Chosen an order of magnitude below the tamper magnitudes (5% valuation bump / deposit-sized jump) so real corruption fails loud while float/settle-timing noise passes; the values + rationale are module constants echoed into the evidence run_meta."
  - "Divergence exits 1 (folded into deribit's '1 other'), not a new exit code, so the founder runbook's exit contract stays identical to the deribit harness (0 ok / 1 divergence-or-other / 2 scope / 3 missing creds)."
  - "SFOX-06 LIVE leg recorded human_needed (deferred): no real read-only sFOX key and no Phase-121 static egress exist in-session; the harness must never fabricate a pass (T-120-19). The committed harness + fixture parity carry the code-complete gate; the live prod-key parity is the founder's empirical gate on 121 (the 118-02 / 119-04 precedent — a skip is NOT a pass)."

metrics:
  duration: ~35m
  completed: 2026-07-19
  tasks: 2
  files_changed: 3
---

# Phase 120 Plan 04: sFOX Ground-Truth Parity Harness (SFOX-06) Summary

`scripts/sfox_ground_truth.py` — the P115-independent economic oracle behind the
`api_verified` trust stamp. It validates the RECONSTRUCTED sFOX equity curve (the
`combine_sfox_balance_history` output derived from `/v1/account/balance/history`'s daily
`usd_value`) against an INDEPENDENT oracle reconstructed SOLELY from
`/v1/account/transactions`' running `account_balance` anchors + typed cashflows. The two
streams are computed by sFOX independently of each other, so a material divergence is
evidence one is corrupt — and the harness FAILS LOUD (raise → exit 1) rather than ever
display the wrong curve. The two live-data unknowns (A2 account_balance semantics, A3
day-0 inception) are surfaced as explicit evidence residuals with a
`requires_founder_decision` flag, never silently guessed. A fixture parity suite carries
CI (consistent account passes; two tampered accounts PROVE fail-loud); the live prod-key
run is founder-gated on Phase-121 egress.

## What shipped

**Task 1 — `scripts/sfox_ground_truth.py` (`feat` commit):**
- `reconstruct_equity_from_transactions(transactions)` — THE P115-independent oracle. Its
  ONLY parameter is the transactions row list (signature-enforced); its body rolls the
  ledger's own end-of-day running `account_balance` forward and removes typed
  deposit/withdraw/credit/charge cashflows from the numerator by hand
  (`r_t = (B_t − B_{t-1} − F_t) / B_{t-1}`, buy/sell excluded as rotations). It never
  reads `usd_value`/balance-history and never calls the module's own
  `combine_sfox_balance_history`/`chain_linked_twr` (a self-referential oracle would pin
  the impl's formula, not the economics).
- `check_parity(balance_rows, transactions)` — the cross-stream gate: compares the two
  independent equity streams on the level-change residual under a rel(0.5%)+abs($1)
  materiality, computes cumulative reconciliation, and emits the A2 (both interpretations)
  and A3 (inception) residual probes. Material divergence NOT attributable to the A2
  cash-vs-MTM ambiguity → `raise ParityDivergenceError`; a cash-only pattern
  (account_balance flat off cashflow events) → flag `requires_founder_decision`, exit 0.
- `run()`/`main()` — structural read-only assert (isinstance `SfoxClient` → else
  `ScopeViolationError` exit 2) BEFORE any fetch; bounded `crawl_sfox_balance_history` +
  `crawl_sfox_transactions`; ONE sanitized JSON to stdout (`sanitize_evidence` +
  `assert_sanitized` re-walk); exit codes 0/1/2/3 mirroring deribit; creds via
  `SFOX_GROUND_TRUTH_KEY` env only (missing → exit 3), optional
  `SFOX_GROUND_TRUTH_PROXY` for the 121 egress. Sanitization primitives IMPORTED from
  `scripts.deribit_ground_truth` (single import line — reused, never forked).

**Task 2 — fixture parity suite + live skipIf leg (`test` commit, TDD):**
- `test_sfox_ground_truth.py` (9 tests): consistent liquid-USD fixture holds (A2 resolves
  total-MTM, A3 prev0 holds); the oracle's hand-derived cashflow-neutral returns (deposit
  day ~0.495%, not ~50%); **tamper A** (usd_value point inflated 5%) → `pytest.raises`;
  **tamper B** (deposit hidden from the transactions ledger) → `pytest.raises`; cash-only
  A2 fixture flags `requires_founder_decision` without raising; oracle-independence pins
  (signature = `["transactions"]`; comment-stripped source scan = 0
  `usd_value`/`balance_history`); sanitize-clean evidence + a planted 48-char token makes
  `assert_sanitized` RAISE. Every fixture number hand-derived in comments (P115).
- `test_sfox_ground_truth_live.py`: `skipIf(no SFOX_GROUND_TRUTH_KEY)` end-to-end
  `main([]) == 0`; the docstring carries the founder runbook + the Phase-121 egress gate
  and states a skip is NOT a pass.

## Verification

- `pytest tests/test_sfox_ground_truth.py tests/test_sfox_ground_truth_live.py -q -rs` →
  **9 passed, 1 skipped** (the live leg skips, founder-gated; the skip reason is verbose).
- Task-1 automated gate: module imports with no network side effects; a missing-creds run
  exits 3; `grep -c "from scripts.deribit_ground_truth import"` == 1 (sanitization reused,
  not forked); the oracle body's comment-stripped `usd_value`/`balance_history` count == 0;
  exit-code contract documented in the module docstring.
- **FULL analytics-service suite: 3945 passed, 96 skipped, 0 failed** (baseline 3936
  passed / 95 skipped from plan 120-03; this plan adds the 9-test fixture suite + the
  skipped live leg). The 1057 warnings are all pre-existing (unrelated resource/deprecation
  warnings in other suites).

## Deviations from Plan

None — plan executed as written. Task 1 built the harness against the verified 120-02
interfaces; the Task-2 fixtures agreed with the Task-1 API on first run (no harness fixes
needed), which is the desired GREEN state for hand-derived oracles. Two design choices
made within the plan's discretion are recorded in `key-decisions` above (the tamper-B
hidden-deposit construction and the liquid-USD-vs-cash-only fixture split) — both required
to make the parity gate decisive offline while honestly surfacing the A2/A3 unknowns the
founder run resolves.

## Checkpoint: Task 3 — FOUNDER live prod-key parity run (SFOX-06 live leg)

**Type:** checkpoint:human-action — DEFERRED → recorded `human_needed`.

The live leg needs a real read-only sFOX key and — for an IP-whitelisted key — the
Phase-121 Fly.io static egress, neither of which exists in-session. The harness must never
fabricate a pass (T-120-19), so the code-complete gate is carried by the committed harness
+ the fixture parity suite; the empirical SFOX-06 live gate stays `human_needed` (the
118-02 / 119-04 precedent — a skip is NOT a pass).

**Founder runbook (flip human_needed → green):**
1. After Phase 121's egress IP is VERIFIED (== the dedicated v4, measured from the
   machine), or immediately with a NON-whitelisted read-only key:
   `export SFOX_GROUND_TRUTH_KEY=<read-only sFOX token>` (env only, never a file;
   optional `export SFOX_GROUND_TRUTH_PROXY=<121 egress URL>` for a whitelisted key).
2. `cd analytics-service && python -m scripts.sfox_ground_truth > /tmp/sfox_parity.json; echo "exit=$?"`
   (or `python -m pytest tests/test_sfox_ground_truth_live.py -q`).
   - exit 0 → parity holds (or an A2/A3 ambiguity flagged). exit 1 → MATERIAL DIVERGENCE:
     STOP — the curve must not ship; file the divergence with the evidence JSON. exit 2 →
     read-only premise violated: revoke the key. exit 3 → key not exported.
3. Review the evidence `a2_account_balance_semantics` residuals (cash vs total-MTM — which
   interpretation reconciles?) and `a3_inception_convention` residual (does
   `prev0 = first usd_value` hold?). These RESOLVE assumptions A2/A3 with data.
4. If A2/A3 contradict the shipped conventions in `combine_sfox_balance_history` or the
   harness anchor logic, open a follow-up fix BEFORE Phase 122 badges anything.

## Known Stubs

None. The harness is end-to-end runnable (structural read-only assert → bounded crawls →
parity → sanitized JSON). The live prod parity is DELIBERATELY founder-gated on Phase-121
egress (recorded `human_needed` above), not a stub.

## Threat Flags

None. The harness's surface is entirely covered by the plan's threat register
(T-120-16..20): evidence is sanitize-re-walked and the Bearer never printed (info
disclosure); the oracle is transactions-only by construction and the tamper fixtures prove
divergence raises (economic tampering); expected values are hand-derived, independence
pinned by signature + source scan (P115 repudiation); the live leg is skipIf-gated + no
code path synthesizes a green (faked-live spoofing); the key is read-only + structural
GET-only client, revoke-on-exit-2 in the runbook (elevation, accepted residual).

## Self-Check: PASSED
