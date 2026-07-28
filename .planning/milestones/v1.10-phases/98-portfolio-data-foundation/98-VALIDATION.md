---
phase: 98
slug: portfolio-data-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-12
---

# Phase 98 — Validation Strategy

> Per-phase validation contract. The load-bearing risk is PI-07 (a cross-process
> concurrency fence) — it needs a REAL-Postgres integration test, not a mock.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | pytest (analytics-service, pinned `.venv/bin/python` Py3.12.13); psql SQL self-tests (`supabase/tests/test_*.sql`, `ON_ERROR_STOP=1`); vitest (TS read-layer) |
| **Config** | `analytics-service/pytest.ini`; `.github/workflows/ci.yml` sql-tests step (`ci.yml:663-803`); `vitest.config.ts` |
| **Model SQL test** | `supabase/tests/test_claim_compute_jobs_dedupe_partition.sql` (the partial-unique-index dedupe pattern to mirror) |
| **Offline quick** | `npx vitest run <read-layer test>` |
| **Live (needs test project)** | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_portfolio_recompute_inflight_unique.sql` — CI is the runtime gate; test project caught up via MCP before merge |

## Per-Requirement Test Map
| Req | Behavior | Type | Fails-without-fix |
|-----|----------|------|-------------------|
| PI-07 | Two concurrent recompute inserts for the same `portfolio_id` → exactly ONE `computing` row survives (UNIQUE partial index), the loser gets `23505` mapped to the existing 409/`in_flight` bucket (NOT a 500) | SQL integration (real PG) + a python/route test on the 23505→409 mapping | without the UNIQUE index both inserts land duplicate `computing` rows; without the 23505 handling the loser 500s |
| PI-07 (migration safety) | The `CREATE UNIQUE INDEX` succeeds even when a prod portfolio already has ≥2 live `computing` rows (dedupe-first step) | migration self-verify / SQL test | index build aborts on pre-existing duplicates |
| Read-layer (PI-01/02/03 foundation) | Exposure/net-exposure/allocation reads return owner-scoped, secretless data; honest-EMPTY (`[]`/null) when the allocator has no holdings; time-series gaps are MARKED, never zero-filled | vitest (read fns) | a fabricated/zero-filled series would read as real flat exposure (no-invented-data violation) |
| Read-layer (RLS) | An allocator cannot read another allocator's holdings via the new reads (RLS user-client, no SECDEF bypass) | SQL/vitest owner-fence | cross-tenant leak |

## Wave 0 (blocker)
- [ ] **PI-07 concurrency SQL test** in `supabase/tests/test_portfolio_recompute_inflight_unique.sql`: seed a portfolio, attempt two `computing` inserts (or the RPC/route equiv), assert exactly one survives + the second raises `23505`. Must be RED before the UNIQUE index, GREEN after. This is the only offline-provable signal that the fence works — without it the sole signal is a live CI race.

## Open decisions → delegated to the Fable planner (per user, 2026-07-12)
- **Exposure-by-Asset-Class taxonomy** for an all-crypto `allocator_holdings` book (venue always a crypto exchange, so crypto/traditional is degenerate). Real dimensions: `holding_type` (spot/derivative), `symbol`, `venue`. Researcher recommendation: expose the raw grouping dimensions in Phase 98, let Phase 99 pick the display axis. **Fable planner decides the exact read-shape + which dimension is the primary "class."**

## Sign-Off
- [ ] PI-07 UNIQUE partial index built (dedupe-first) + 23505→409 mapping wired
- [ ] Wave-0 concurrency SQL test RED→GREEN
- [ ] Read layer owner-scoped + secretless + honest-empty + coverage-mask gaps
- [ ] `nyquist_compliant: true`
