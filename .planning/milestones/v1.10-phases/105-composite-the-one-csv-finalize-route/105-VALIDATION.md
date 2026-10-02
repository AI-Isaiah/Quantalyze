---
phase: 105
slug: composite-the-one-csv-finalize-route
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 105 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 105-RESEARCH.md §Validation Architecture + the locked CONTEXT.md decisions. Task IDs are assigned by the planner; the behaviors/Wave-0 gaps below are the coverage contract the plan must satisfy.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service), `--cov-fail-under=80` |
| **Config file** | `analytics-service/pytest.ini` (`testpaths = tests`) |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_basis_series.py tests/test_cash_basis_series_sc4.py tests/test_stitch_composite_job.py -x` |
| **Full suite command** | `cd analytics-service && python -m pytest --cov --cov-fail-under=80` |
| **Estimated runtime** | quick ~30s · full ~3–5 min |

---

## Sampling Rate

- **After every task commit:** the quick-run set above.
- **After every plan wave:** full analytics suite `--cov-fail-under=80`.
- **Before `/gsd:verify-work`:** full suite green + the SC-4 `check_exact=True` sweep (composite-member-guard-NaN + broker-guard-day + user-CSV-weekend + Zavara simple/active + ccxt-override) + `git grep _metrics_result_for` == 0.
- **Max feedback latency:** ~30s (quick) / ~5 min (wave gate). Frontend vitest unaffected — no frontend surface in 105.

---

## Requirement → Test Map (coverage contract; planner assigns task IDs)

| Behavior (must be proven) | Test Type | Automated Command | Covered By (plan-task) |
|---------------------------|-----------|-------------------|------------------------|
| Composite cash scalar byte-identical to legacy `_metrics_result_for` — **member-guard-NaN fixture** (the D1 `nan_dates` flagship case) | dual-run | `pytest tests/test_composite_headline_parity.py -x` (extend) | **105-05 T2** (in-test legacy oracle: `gap_fill(stitch)` → `compute_all_metrics`) |
| Single-key broker CSV byte-identical (guard-day fixture) | dual-run | `pytest tests/test_cash_basis_series_sc4.py -x` (extend) | **105-04 T2** `test_broker_guard_day` (runner level — the authoritative scalar site) |
| Single-key user-CSV byte-identical (**weekend-gap fixture** — broadest blast radius) | dual-run | `test_cash_basis_series_sc4.py::test_user_csv_weekend` (new) | **105-04 T2** (equality vs sparse-legacy AND explicit inequality vs gap-filled) |
| Round-trip guard VALID on all 3 surfaces incl. composite `zero_fill`+`nan_dates` reconstruction (`gap_fill(rows)` → reinstate NaN) | unit | `pytest tests/test_basis_series.py -k roundtrip -x` (extend) | **105-01 T2** (mechanism, 3 policies + edge-guard-NaN + nan_dates-drop RED) · wired: **105-03 T2** (seam), **105-05 T2** (composite payload) |
| `densify_policy` param default (`None`) leaves MTM + every current caller byte-invisible | unit | `pytest tests/test_basis_series.py -k densify -x` + `pytest tests/test_derive_broker_dailies_dualmode.py -x` | **105-01 T1** (explicit absent-key/None asserts; the ONLY pre-existing edits are the reader-invisible `schema` 1→2 pins at test_basis_series.py:309/:378 + test_derive_broker_dailies_dualmode.py:994) |
| Zavara simple/active byte-identical (5th sweep fixture) | dual-run | `test_cash_basis_series_sc4.py::test_zavara_simple_active` (new) | **105-04 T2** |
| #5 — the two `periods_per_year` rules resolve EQUAL on every existing composite fixture; fail-loud sanity assert retained | unit | `pytest tests/test_stitch_composite_job.py -k periods -x` | **105-05 T1** |
| MED-2 — ccxt-override round-trip holds (venue-agnostic `denominator_config`) | unit | seam wiring: `pytest tests/test_cash_basis_series_sc4.py -x`; mechanism: `pytest tests/test_basis_series.py -k denominator -x` | **105-03 T1** (wiring — ccxt echoes simple/active) + **105-01 T2** (simple/active round-trip mechanism) |
| MED-1 — stale cash row after a terminal-failure arm is NOT trusted (read-side status-gate); the harness itself respects the gate | unit | `npx vitest run src/lib/factsheet/composite-read-path.test.ts` + `pytest tests/test_cash_basis_series_sc4.py -x` | **105-02 T1** (predicate truth-table) + **105-03 T2** (heal-deletes + `_trusted_cash_payload` gate-respecting harness) |
| SC-5 — ordered-idempotent finalize: a `complete` scalar never exists without its series (kill-point ordering) | unit | `pytest tests/test_stitch_composite_job.py -x` (composite) + runner ordering test | **105-05 T3** (ordering + kill-point) + **105-04 T1** (runner series-before-scalar) |
| `git grep _metrics_result_for` == 0 (collapse #1 delete) | grep-gate | `! git grep -q _metrics_result_for` (in 105-05 verify + phase gate) | **105-05 T2** (incl. docstring :3335 / comment :4319 sweep) |

*Per-task map filled by the planner 2026-07-14. Note: the SC-4 5-fixture sweep = composite-member-guard-NaN (105-05 T2) + broker-guard-day, user-CSV-weekend, Zavara simple/active (105-04 T2) + ccxt-override (105-03 T1). "Wave 0" fixture-creation lands inside Wave-1 plan 105-01 (mechanism + guard fixtures) with surface fixtures co-located in the plan that wires each surface — every task carries `<automated>` verify (Nyquist).

---

## Wave 0 Requirements

- [ ] `derive_basis_series` `scalar_returns` + `densify_policy` params + composite `nan_dates` payload key + their unit tests (default path byte-invisible for MTM; `_PAYLOAD_SCHEMA_VERSION` bump). → **105-01 (Wave 1)**
- [ ] SC-4 sweep fixtures: **composite-member-guard-NaN** (105-05 T2), broker-guard-day / **user-CSV-weekend** / Zavara simple/active (105-04 T2), ccxt-override (105-03 T1).
- [ ] #5 equality assertion across existing composite fixtures + the retained fail-loud sanity assert. → **105-05 T1**
- [ ] MED-1 reader status-gate test (gate-respecting harness) → **105-02 T1 + 105-03 T2**; MED-2 ccxt-override round-trip test → **105-03 T1**.
- [ ] `_metrics_result_for` grep-gate wired into verification. → **105-05 T2/T3 verify + phase gate**
- No framework install needed.

---

## Manual-Only Verifications

*All phase behaviors have automated verification.* (Prod SC-4 corroboration on live composites is a ship-time / 106-flip concern, not a 105 gate — 105 is behind the flag.)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task in 105-01..05 carries `<automated>`)
- [x] Wave 0 covers all MISSING references (esp. the 5 SC-4 fixtures + the `nan_dates` reconstruction — see per-task map)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (quick)
- [x] `nyquist_compliant: true` set in frontmatter (per-task map filled)

**Approval:** planner sign-off 2026-07-14 (5 plans, 3 waves)
