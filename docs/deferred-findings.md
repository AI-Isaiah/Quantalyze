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

---

## 2026-06-09 tech-debt audit — deferred findings

A separate audit (`.planning/tech-debt/TECH-DEBT-AUDIT-2026-06-09.md`, 42 ranked
findings) is being fixed in priority-ordered batches. Most landed; these are the
deliberate deferrals (rationale recorded here so it survives beyond one machine).

### #24 · CI shared test-DB serialization · ⚠️ DO NOT apply the naive fix

Observation: only the `python` CI job carries the `shared-test-db` concurrency
group; `sql-tests` and `e2e` do not, so concurrent PRs share the test Supabase
project (qmnijlgmdhviwzwfyzlc) un-serialized.

**Do NOT add `sql-tests` / `e2e` to the existing `shared-test-db` group.** Two
reasons: (1) the **sql-tests half is refuted** — those tests are deliberately
engineered for shared-project concurrency (BEGIN/ROLLBACK + `gen_random_uuid`-
scoped fixtures, with in-file red-team notes), so serializing them is needless.
(2) A GitHub concurrency group permits at most **one running + one pending**;
adding more jobs to `shared-test-db` with `cancel-in-progress: false` *worsens*
the cross-PR pending-run cancellation that **already caused a Railway-deploy
skip during B3b** (a newer run cancelled an older pending python run → CI
"failure" → Railway skipped the analytics deploy). The only real residual risk
is e2e-vs-e2e across PRs, and `scripts/seed-demo-data.ts` is delete-then-reseed
idempotent (a clobbered run self-heals on its own seed step, which runs before
its specs). If ever justified by observed e2e flakes, add e2e to its **own
distinct** group (e.g. `shared-test-db-e2e`) — never widen `shared-test-db`
membership. Defer: low real-world impact vs. a documented footgun. Root-cause
fix remains the ephemeral-CI-DB recipe (PR #316, reverted for image-pull time).

### #18 · Auto-apply migrations to the TEST project before PROD · blocked on secrets

Genuine debt (migrations auto-apply to prod on merge but the shared test project
is caught up only by hand via MCP — recurring toil + a sometimes-stale e2e
signal). Remediation needs a `test-apply` job in `supabase-migrate.yml` gated on
two new secrets — `TEST_SUPABASE_ACCESS_TOKEN` + `TEST_SUPABASE_DB_PASSWORD` —
that **only the repo owner can create**. Deferred until those secrets exist;
surface as a user action when the owner is available.

### #23 date-bomb half · already fixed (do not re-fix)

The audit's "9 phase19-error-rollup test failures are Node-version skew" claim
was refuted: they were a date-bomb (a fixture pinned to a fixed `updated_at`),
**already fixed in PR #471 (v0.24.15.117)** via `vi.setSystemTime`. The pin
half of #23 (`.nvmrc` + `package.json` engines) was landed; this note exists so
the date-bomb isn't re-investigated.

### #2 full-schema half · functions shipped, tables/columns/policies/triggers deferred

The canonical-SQL-snapshot finding (#2, P32) was landed for **functions only**:
`scripts/dump-sql-functions.ts` replays the migrations and commits each
function's latest body to `supabase/schema/functions/`, gated by
`.github/workflows/sql-function-snapshot.yml`. That covers the dominant redefine
class (200 `CREATE OR REPLACE FUNCTION`) and the regression that actually shipped
(G23-187, a function-body silent revert).

**Deferred: a full-schema snapshot covering tables/columns/policies/triggers.**
Functions are text-replayable because they are wholesale `CREATE OR REPLACE`;
tables evolve via incremental `ALTER TABLE ADD/DROP COLUMN` etc., which a text
replay can't faithfully reconstruct. A correct full-schema dump needs the
**Supabase local stack (Docker) in CI** (`supabase db start` → apply migrations →
`supabase db dump --schema-only`), which is net-new CI infra (no current job runs
a local stack) and carries docker flake + per-change-regenerate-via-docker cost.
Until then, the **B5b near-miss class (a reverted COLUMN, `pre_terminus_balance_unknown`)
is NOT gated** — only function bodies are. Revisit when the docker-in-CI cost is
justified (or fold into #18's test-project work, which already needs a live DB).

### #14 live-schema half · types-drift detection deferred (regen automation + hand-patch guard shipped)

The generated-DB-types finding (#14, P24) was landed for the parts with a sound,
credential-free fix:
- The **stale orphan twin** `supabase/types.generated.ts` is gone (deleted in
  B4 / #13, PR #497) — the dangerous "agent opens the stale file as the schema"
  landmine is closed.
- The **regen procedure** is documented (CONTRIBUTING "Workflow") and the
  hand-written sections a regen wipes are guarded: the `[#14]` block in
  `critical-regressions.test.ts` fails CI if the GENERATED-FILE header preamble,
  the `for_quants_leads` HAND-PATCHED migration-115 tripwire comment, or the
  `notify_*` columns are lost. The realized regression class (a regen silently
  reverting columns) also breaks `tsc` at the call site, so it is double-covered.

**Deferred: automated live-schema drift detection** (the audit's proposed
"regenerate at PR time and diff" remediation, which it flagged ADJUSTED/unsound).
Two reasons it is not a clean win:
1. **Unsound against the test project.** Migrations auto-apply to PROD on merge,
   but the TEST project lags (manual catch-up) — so a PR-time regen-and-diff
   against test false-positives on every not-yet-applied migration (this is
   finding #18). It would have to run against PROD, needing prod creds in the
   gate.
2. **A naive diff false-positives nightly.** `supabase gen types` output has
   neither our hand-written header preamble nor the HAND-PATCHED comment block, so
   a bare `git diff` reports drift every run regardless of actual schema change. A
   sound probe needs a comment/header-agnostic structural normalizer (parse both
   sides to `(table, column, type)` triples).

Revisit if type/schema drift recurs despite the guard + tsc coverage; the sound
shape is a **scheduled** (not PR-blocking) probe that regenerates against prod,
structurally normalizes, and files a dedup'd issue on real drift (mirroring
`analytics-deploy-verify.yml`), explicitly exiting 0 so it never red-checks HEAD
(the #9b deploy-monitor self-block lesson).
