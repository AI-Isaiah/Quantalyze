---
phase: 92
slug: composite-metric-blow-up-annualization-honesty
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-11
---

# Phase 92 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `92-RESEARCH.md` § "Validation Architecture". The repro
> fixtures are pure/offline — they must NOT touch the shared Supabase test
> project (shared-test-DB fragility, see research Pitfall 6).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) + vitest (optional TS per-key-contribution pin) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && .venv/bin/python -m pytest tests/test_native_nav.py tests/test_stitch_composite_job.py -x -q -p no:randomly` (pinned venv — local Py3.14 SIGSEGVs on pandas) |
| **Full suite command** | `cd analytics-service && .venv/bin/python -m pytest -n auto --dist loadgroup -q` |
| **Estimated runtime** | ~20s quick / full suite minutes |

---

## Sampling Rate

- **After every task commit:** Run the quick command (native NAV + stitch repro).
- **After every plan wave:** Run the full suite.
- **Before `/gsd:verify-work`:** Full suite green AND the repro fixture demonstrably fails on the pre-fix commit (evidence, not reasoning — repro gate).
- **Max feedback latency:** ~20s.

---

## Per-Task Verification Map

> Planner fills exact task IDs. The two non-negotiable pins:

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 92-01-T1 | 01 | 1 | HARD-01 | unit (repro, strict-xfail) | `pytest tests/test_native_nav.py -k pnl_dominated -q` | ⬜ pending |
| 92-01-T2 | 01 | 1 | HARD-01 | unit (b1/b2 branch selector) | `pytest tests/test_native_nav.py -k valuation_matches_hand_model -q` | ⬜ pending |
| 92-02-T1 | 02 | 2 | HARD-01 | unit (source fix, xfail promoted) | `pytest tests/test_native_nav.py tests/test_nav_twr.py -q` | ⬜ pending |
| 92-02-T2 | 02 | 2 | HARD-01 | integration (offline persist) + byte-identity gate | `pytest tests/test_metrics.py tests/test_stitch_composite_job.py tests/test_nav_twr.py tests/test_native_nav_sc4_identity.py tests/test_golden_parity.py tests/test_metrics_parity.py -q` | ⬜ pending |
| 92-03-T1 | 03 | 3 | HARD-04 | unit (flag, value-unchanged pin) | `pytest tests/test_metrics.py -k insufficient_window -q` | ⬜ pending |
| 92-03-T2 | 03 | 3 | HARD-04 | integration (both-caller lifts, drop-stale) | `pytest tests/test_stitch_composite_job.py tests/test_analytics_runner.py -k insufficient_window -q` | ⬜ pending |
| 92-03-T3 | 03 | 3 | HARD-04 | vitest (existing-surface render) | `npx vitest run src/lib/factsheet/composite-read-path.test.ts "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx" "src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx"` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements — `test_native_nav.py`,
  `test_stitch_composite_job.py` and their offline `_FakeSupabase`/patched-ledger
  harness already exist (research § f). No new framework install.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live composite factsheet renders finite metrics on re-stitch | HARD-01 | Needs a live Deribit-inverse composite / re-onboard | Re-stitch the fixture-equivalent composite in prod, confirm no millions-of-% contribution and non-zero CAGR while curve rises. The offline fixture is the primary evidence; this is corroboration. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Repro fixture FAILS on pre-fix, PASSES on post-fix (repro gate evidence)
- [ ] Shared-path byte-identity pins (SC-4) stay green — `nav_twr.py` / `metrics.py` are shared
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
