---
phase: "171"
slug: "readceiling-an-account-above-the-trade-read-ceiling-is-read"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-27"
---

# Phase 171 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 171-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest + pytest-asyncio (analytics-service); vitest for the TS census; PL/pgSQL `DO` gates for SQL |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`, `scripts/mutation-floors.mjs` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_trade_pages.py tests/test_trade_read_resume.py tests/test_trade_read_store.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py tests/test_reconstruct_whole_account.py tests/test_bybit_two_year_window.py -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && python3 -m pytest -q` plus `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~60 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite and mypy; for the SQL wave the mutation runner and the TS census tests
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

### Phase Requirements -> Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-2 | A FINITE book of 10,500 trades in one 7-day window is read whole (RED at base: raises after 100 calls, reproduced) | unit | `pytest tests/test_trade_read_resume.py -k over_ceiling_window -x` | Wave 0 |
| SC-1 | A finite a6-shaped book read across N claims with a tiny deadline equals the single-pass `_compute_daily_equity` rows exactly | unit (oracle) | `pytest tests/test_trade_read_resume.py -k equals_single_pass -x` | Wave 0 |
| SC-1 | Claim 1 stores complete windows and raises `TradeReadDeferred`; claim 2 completes; the allocator's snapshot table is untouched until the end | unit | `pytest tests/test_trade_read_resume.py -k defers_then_completes -x` | Wave 0 |
| SC-1 | Handler returns DEFERRED, calls `defer_compute_job` with the claim token and a static counts-only reason, burns no attempt, writes no audit failure | unit | `pytest tests/test_reconstruct_whole_account.py -k deferred -x` | Wave 0 |
| SC-1 | A window too big for any claim stalls: three stalled claims refuse `account_key_read_stalled`, state kept; job older than 24 h refuses the same | unit | `pytest tests/test_trade_read_resume.py -k stalled -x` | Wave 0 |
| SC-1 | A venue that never runs out terminates loudly (constant-timestamp endless fake; strictly-decreasing-timestamp endless fake hits the segment ceiling) | unit | `pytest tests/test_trade_pages.py -k never_runs_out -x` | pin moves |
| SC-1 | A sibling's refusal beats a Bybit member's deferral; a deferral is not classified as an unknown fault | unit | `pytest tests/test_reconstruct_whole_account.py -k precedence -x` | Wave 0 |
| SC-1 | Stale state (other `read_version`, expired, `since` earlier than origin) is discarded; duplicate writers of one window leave one identical row | unit | `pytest tests/test_trade_read_store.py -x` | Wave 0 |
| SC-1 | Projection round trip: float equality through JSON, append order preserved, fee dict vs number replay-equal | unit | `pytest tests/test_trade_read_store.py -k projection -x` | Wave 0 |
| SC-1 | The token set: 16 tokens, raise-site scan, probe vocabulary | unit | `pytest tests/test_reconstruct_force_rebuild.py -k closed_set -x` | pin moves |
| D-01 | The probe records `truncated_site`, `last_window_age_bucket`, `read_elapsed_s`; unknown values refused by the emitter | unit | `pytest tests/test_allocator_history_probe.py -x` | pin moves + Wave 0 |
| SC-3 | Probe stays read-only: no writer, names only the two tables it reads, sets no scope | static | `pytest tests/test_allocator_history_probe.py -k source -x` | exists |
| Migration | Tables, cascade from key and user, privilege matrix, CHECKs, RLS forced with zero policies | SQL gate | `node scripts/mutation-runner/run.mjs` (full) / the CI `sql-tests` job | Wave 0 |
| SC-3 | After deploy the probe re-reads a6; outcome recorded as counts and tokens | operator | the orchestrator runs it on the backfill worker | n/a |

Every gate for data integrity must be seen to fail: for each new test, neuter the production line it guards, observe RED, restore from a byte backup (never `git checkout`/`stash` on uncommitted work).

*Every data-integrity gate is neutered, seen RED, and restored from a byte backup.*

---

## Wave 0 Requirements

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_trade_read_resume.py` - resumable read, oracle, stall, never-ending venue (SC-1, SC-2)
- [ ] `analytics-service/tests/test_trade_read_store.py` - store mapping on the fake client (extend `FakeSupabaseClient` with `lt`, or purge with `lte`)
- [ ] `analytics-service/tests/test_allocator_history_probe.py` - new record keys and site derivation
- [ ] `supabase/tests/test_allocator_trade_reads.sql` - the SQL gate with `RED-UNDER` twins
- [ ] Census pins listed in section 8 (their values are measured at PR time)
- [ ] Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| a6 re-probe (raise site, calls, elapsed) | D-01 | PROD read on the Railway backfill worker | Orchestrator runs the probe via the start-command path; counts and tokens only |
| a6 re-read after deploy | SC-3 | PROD read | Orchestrator re-runs the probe after deploy and records the outcome |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
