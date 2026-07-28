---
phase: 115
slug: e2-allocator-equity-reconstruction-scope-gated-verify-first
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-17
---

# Phase 115 — Validation Strategy

> Per-phase validation contract. Derived from `115-RESEARCH.md` → Validation Architecture, CORRECTED for the RESOLVED scope gate (census did NOT clear → STITCH-02 store retirement DEFERRED; read-endpoint DROPPED as flow-blind; display-repoint SPLIT into Phase 115.1). This phase = additive derivation core + all-deribit dogfooding gap-closure. The legacy store + both its jobs stay running untouched (`test_e1_delete_gate.py` stays GREEN, unedited).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service); config `analytics-service/pyproject.toml` / `pytest.ini` in-tree |
| **Quick run** | `cd analytics-service && python -m pytest tests/test_e1_delete_gate.py tests/test_match_router.py -q` |
| **Full suite** | `cd analytics-service && python -m pytest -q` (~3687 tests; serial in CI; coverage gate `--cov-fail-under=80`, actual 89.00% per P114) |
| **Golden regen** | `UPDATE_GOLDEN=1 python -m pytest tests/test_e2_match_score_golden.py` — rewrites the JSON and FAILS loud ("golden regenerated, rerun") so a regen never silently passes CI |

---

## Sampling Rate
- **Per task commit:** the task's own test file + `tests/test_e1_delete_gate.py` (the permanent P114 gate; proves the store stayed untouched).
- **Per wave merge:** `cd analytics-service && python -m pytest -q` (full analytics suite).
- **Phase gate:** full analytics suite green (+ full TS suite only if `queries.ts` is touched — it is NOT in this phase; the display-repoint is Phase 115.1) before `/gsd:verify-work`.

---

## Per-Task Verification Map

| Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 115-01 (this) | 0 | STITCH-02 | Deferral + BACKBONE 115/115.1 mapping + A1 by-venue recorded; store untouched; delete-gate green | gate/doc | `python -m pytest tests/test_e1_delete_gate.py -q` | ✅ | ⬜ pending |
| 115-01 | 0 | match parity | `score_candidates` byte-stable golden captured GREEN (insurance — match input path UNCHANGED this phase; NOT correctness proof) | integration | `python -m pytest tests/test_e2_match_score_golden.py -q` | ❌→✅ W0 | ⬜ pending |
| 115-01 | 0 | fixtures | Shared E2 derivation fixtures importable + deterministic (2 concurrent keys + 1 rotated seam + flow days + anchor/None + deribit variant) | unit | `python -c "import tests.e2_fixtures"` | ❌→✅ W0 | ⬜ pending |
| 115-02 | 1 | STITCH-01 | Canonical Python per-key blend (D1/D2/D3 port); concurrent days = capital-weighted BLEND (never `assert_windows_disjoint` on live siblings, L1); D3 eligibility filters stale/disconnected keys | unit | `python -m pytest tests/test_e2_allocator_blend.py -q` | ❌ W0 | ⬜ pending |
| 115-03 | 1 | STITCH-03/04 | perf-curve ≠ equity-curve; zero-flow equivalence pin; backward replay from anchor; honest degradation w/o anchor (no invented $-curve) | unit | `python -m pytest tests/test_e2_equity_curve_layer.py -q` | ❌ W0 | ⬜ pending |
| 115-03 | 1 | STITCH-05/06 | real + synthetic-seam flows enter ONE dated ledger `(utc_day_iso, usd_signed)`; TWR seam-clean; $-curve steps by the seam jump | unit | `python -m pytest tests/test_e2_seam_ledger.py -q` | ❌ W0 | ⬜ pending |
| 115-04 | 1 | STITCH-01 | deribit allocator keys produce per-key `csv_daily_returns` so the EXISTING Phase-36 blend renders (closes the all-deribit dogfooding gap) | unit | `python -m pytest tests/test_derive_broker_dailies_dualmode.py -q` (extended) | ✅ (extend) | ⬜ pending |
| 115-05 | final | oracle | independent numpy/pandas re-derivation of blend/curve (114-01/111-01 pattern) — the REAL correctness proof; + `scripts/e2_allocator_ground_truth.py` | unit | `python -m pytest tests/test_e2_parity_oracle.py -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Read-endpoint row from RESEARCH DROPPED (plan-check flagged it flow-blind; the flow-aware repoint is Phase 115.1).*

---

## Wave 0 Requirements (Plan 115-01)

- [ ] `115-STITCH-02-DEFERRAL.md` — verdict + residual-blocker ledger + BACKBONE-02/03 → 115/115.1 mapping + A1 by-venue table.
- [ ] `115-VALIDATION.md` — this file, in the phase 109–113 convention.
- [ ] `tests/test_e2_match_score_golden.py` + `tests/fixtures/e2_match_score_golden.json` — byte-stable `score_candidates` golden (insurance pin; UPDATE_GOLDEN fails loud; docstring carries insurance-not-correctness framing). MUST land before any derivation code.
- [ ] `tests/e2_fixtures.py` — shared deterministic builders consumed read-only by plans 02/03/04/05 (concurrent pair + rotated seam + real-flow days + anchor/None + deribit-flavored variant).
- [ ] A1 verification: per-key `csv_daily_returns` coverage for eligible allocator keys, split BY VENUE (TEST recorded; PROD pending approval).
- [ ] No new framework install — pytest present (RESEARCH Package Legitimacy Audit: none).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-allocator anchor consistency (new derivation terminal equity ≈ live exchange current equity, same-day drift) | BACKBONE-02 | Needs a real read-only allocator key via Railway env (founder action, deribit_ground_truth runbook) | `railway ssh "cd /app && python -m scripts.e2_allocator_ground_truth"` after founder sets the read-only key env (plan 05) |
| PROD A1 by-venue coverage (esp. deribit-with-0-rows) | STITCH-01 / plan 04 sizing | Prod DB read blocked in auto mode; needs approved run | COUNTS-ONLY query per `115-STITCH-02-DEFERRAL.md` §(d), via approved Supabase MCP or prod-approved run |

---

## Validation Sign-Off
- [x] Every task has an automated verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (delete-gate rides every commit)
- [x] Wave 0 covers all MISSING references (golden + fixtures land in plan 115-01)
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set
- [x] `wave_0_complete: true` — Plan 115-01 lands the golden (GREEN, byte-stable, honestly framed), shared fixtures, deferral record + A1, and this VALIDATION.md; legacy store + `test_e1_delete_gate.py` untouched.

**Approval:** approved 2026-07-17
