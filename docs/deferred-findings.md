# Deferred audit findings (audit-2026-05-07 campaign)

The 2026-05-07 audit campaign closed 300+ findings across ~70 PRs. This file is
the **durable, tracked record of what remains deliberately deferred** — so the
deferral rationale (and, critically, the "do NOT implement" warnings) survives
even if the working machinery on a single developer's laptop is lost.

The full working queue lives in `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md`
(formerly `.planning/audit-2026-05-07/FIX-LIST.md`). That directory is
**gitignored / per-developer** by design — it is the campaign's scratch space,
not a deliverable. The decisions below are the deliverable. Regenerate this file
from the working queue at campaign milestones (`grep '^#### ' <queue>`).

As of the 2026-06-09 tech-debt audit (finding #6) there are **22 open deferred
findings**: 1 HIGH, plus MEDIUM/LOW (several downgraded on re-verification) and 2
special-prefix migration-reviewer IDs. None are correctness regressions on the
hot path; all were deferred with a recorded reason.

---

## ⚠️ Do NOT implement — 4 landmine findings

These four have an **obvious-looking "fix" that is actively wrong** — unsound,
structurally impossible, or data-losing. A future agent or dev who re-discovers
the underlying observation must NOT apply the naive remedy. This is
negative-knowledge: its whole value is preventing a harmful change.

### M-0892 · `analytics-service/services/bridge_scoring.py:76` · performance
Observation: the candidate-scoring loop recomputes `df.corr()` per candidate.
**Do NOT implement the "precompute the correlation block once" fix.** Each
candidate's `all_returns.dropna()` yields a *distinct* correlation window, so a
`remaining_df`-window corr block ≠ the candidate-window sub-block. It also
conflicts with the landed M-0893 per-candidate-window correctness fix (which
recomputes `_avg_corr` per candidate window). Only a no-gain concat→join
micro-opt is sound; premature opt on a bounded loop, no clients.

### M-0703 · `analytics-service/services/portfolio_optimizer.py:997-1023` · performance
Twin of M-0892 in `find_improvement_candidates`. **Do NOT implement the
"pre-concat all candidates once + precompute `port_df.corr()` outside the loop"
fix.** After the v0.24.15.101 correctness fix reslices the incumbent baseline
(sharpe/avg_corr/max_dd) PER CANDIDATE to that candidate's `aligned` overlap
window, the precompute is **structurally impossible**, not merely unsound — the
baseline is now window-dependent per candidate and cannot be hoisted. A
200-candidate / 8-strategy / 500-day run measured 547ms; the per-candidate
metric recomputes are dwarfed by the pre-existing concat.

### M-0938 · `analytics-service/services/position_reconstruction.py:385` · performance
Observation: `_attribute_funding` uses OFFSET-based pagination instead of keyset.
**Do NOT "just raise `_PAGE_SIZE` to 10000" — that is a silent data-loss bug.**
`supabase/config.toml max_rows=1000` caps every PostgREST response, so
`.range(0, 9999)` returns ≤1000 rows and the `len(chunk) < _PAGE_SIZE`
terminator declares the funding window complete after page 1, **silently
undercounting `funding_pnl`**. The only sound fix is keyset pagination on
`(timestamp, id)`, deferred until post-clients.

### L-0051 · `supabase/migrations/20260416081039_funding_fees.sql:96` · data-migration
Observation: `funding_fees.raw_data JSONB` is unbounded with no retention policy.
**Do NOT add a retention/delete sweep.** `funding_fees` is deliberately
PRESERVE/Historical (`sanitize_user.sql:132`) and feeds `positions.funding_pnl`;
a time-based delete would **corrupt funding-P&L attribution**. At zero clients +
8h-bucketed volume this is a non-issue; the only safe guard would be a per-row
`pg_column_size` CHECK, which is speculative now. Defer as capacity-review.

---

## The 22 deferred findings

| ID | File | Sev | One-line | Defer reason |
|----|------|-----|----------|--------------|
| **M-0892** | `bridge_scoring.py` | M | corr() recomputed per candidate | ⚠️ DO NOT precompute — unsound (see above) |
| **M-0703** | `portfolio_optimizer.py` | M | full concat per candidate | ⚠️ DO NOT precompute — structurally impossible (see above) |
| **M-0938** | `position_reconstruction.py` | M | OFFSET funding pagination | ⚠️ DO NOT raise `_PAGE_SIZE` — data loss (see above) |
| **L-0051** | `funding_fees.sql` | L | `raw_data` JSONB unbounded | ⚠️ DO NOT add retention sweep — corrupts funding_pnl (see above) |
| H-0460 | `metrics-parity-helper.ts` | H | `FROZEN_TRADE_METRICS_KEYS` not `keyof`-derived | `satisfies keyof TradeMetrics` would not compile (31 Python keys vs 25 TS by design); real fix = shared `types.ts` ↔ Python reconciliation |
| H-0414 | `analytics-schemas.ts` | H→Low | `TickJobsResponseSchema` lacks per-job error array | dormant scaffolding (no producer/consumer); a multi-runtime alerting feature, not a point-fix |
| H-1237 | `claim_dedupe_partition_keys.sql` | H | dedupe CTE scans full pending/failed_retry before LIMIT | needs design (two-pass vs candidate-gate) + EXPLAIN ANALYZE vs prod queue depth |
| H-1153 | `.gitignore` | H→Low | `.planning/` rule is a no-op for already-tracked files | repo-policy HUMAN decision (`git rm --cached` vs drop rule); zero runtime/security impact |
| M-0988 | `next.config.ts` | M | CSP uses `unsafe-inline`/`unsafe-eval` | nonce-based CSP is a large architectural change (proxy.ts injection); tracked hardening item |
| M-0352 | `finalize-wizard/route.ts` | M | legacy `runLegacyFinalize` under flag | deletion blocked until 3 Python side-effects ported to the unified path (multi-runtime) |
| M-0552 | `queries.ts` | M | `computeScenario` eager-eval at SSR every load | documented deliberate trade; premature perf, post-clients; ripples 25 refs across 9 test files |
| M-0560 | `queries.ts` | M | full `daily_returns` shipped across SSR boundary | client needs the series (correlation/scenario math); durable fix is a large refactor, trim risks silent math truncation |
| M-1127 | `claim_dedupe_partition_keys.sql` | M | dedupe drops failed_retry losers silently | clean signal needs a risky CREATE OR REPLACE of the heavily-layered claim fn; worker-side proxy is noisy — a misleading signal is worse than none |
| M-1126 | `test_main_worker.py` | M | partial-batch dedupe not log-asserted | closing it needs a PROD observability change, out of a test-only batch's scope |
| M-0865 | `discovery-prefs-isolation.spec.ts` | M | `HAS_SEED_ENV` predicate duplicated across 11 specs | test-infra helper extraction (`e2e/helpers/env.ts`), folded into the PR-5 test-cleanup lane |
| M-0530 | `migration-028-tenant-check.test.ts` | M | UPDATE-of-other-columns short-circuit untested | needs a live-DB trigger test (skip-in-CI) for a perf short-circuit |
| M-0944 | `proxy.test.ts` | M | hand-rolled `^matcher$` regex, not Next's compiled matcher | empirically agrees with path-to-regexp on every tested path; marginal value |
| M-1107 | `CHANGELOG.md` | M→Low | pixel-parity claim has zero snapshot coverage | needs a Playwright screenshot spec + committed Linux-CI baselines (Mac↔Linux sub-pixel drift); visual-regression infra pass |
| L-0064 | `equity_reconstruction.py` | L | no e2e equity-replay regression on real OKX payloads | needs sanitized OKX cassettes (SPOT/SWAP/FUTURES/inverse) |
| L-0042 | `mandate-form.spec.ts` | L | header cites unstable commit SHA `73a3a5b` | comment cleanup; convert to a relative pointer |
| G23-193-mig-04 | `migration-policy.yml` | M | no e2e test for the backdate-guard REJECT path | low-value test infra; the guard's positive path is exercised on every migration PR |
| G23-182-mig-07 | `retention_crons_..._probe.sql` | M | `_assert_retention_columns` ACL/COMMENT mismatch | softening a COMMENT on an already-applied migration needs a new no-op migration; nothing is broken |

Severity shown as `audit→reverify` where a 2026-06-04 re-verification pass
downgraded the finding. Full per-finding evidence, fix text, and the dated
re-verification trail live in the gitignored working queue.
