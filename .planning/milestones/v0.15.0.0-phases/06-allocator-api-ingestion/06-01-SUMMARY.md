---
phase: 06-allocator-api-ingestion
plan: 01
subsystem: database
tags: [postgres, supabase, rls, compute-jobs, pg-cron, migrations, audit, security-definer, ccxt]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "auth.users + api_keys with owner RLS"
  - phase: 05-bridge-outcomes
    provides: "compute_jobs schema + enqueue_compute_job SECURITY DEFINER wrapper + bridge_outcomes 3-tier RLS precedent + Supabase-MCP apply_migration workflow"
provides:
  - allocator_holdings table (3-tier RLS, UNIQUE(allocator_id,venue,symbol,asof), owner-coherence BEFORE trigger)
  - compute_jobs.api_key_id column + 4-way target XOR (strategy/portfolio/allocator/api_key)
  - compute_job_kinds += poll_allocator_positions
  - compute_jobs_one_inflight_per_kind_api_key partial unique index (server-side sync-now dedup)
  - enqueue_compute_job(v4) — +p_api_key_id +p_run_at +p_idempotency_key, legacy 1/2-arg callers preserved
  - request_allocator_holdings_sync(uuid) SECURITY DEFINER wrapper — authenticated-GRANTed, 23505 -> {already_inflight, next_attempt_at}
  - enqueue_poll_allocator_positions_for_all_keys() — jitter-first idempotency key derivation, cron-hour [1,22] invariant
  - pg_cron job poll-allocator-positions @ 04:00 UTC
  - api_keys.sync_status CHECK += 'revoked','rate_limited'
  - GRANT SELECT (sync_error) ON api_keys TO authenticated — Landmine 2 resolved
  - AuditAction union: allocator.holdings.sync_{requested,completed,failed}
  - ADR-0023 synced with new taxonomy rows in the same commit as audit.ts
  - API_KEY_USER_COLUMNS_ARR += 'sync_error' (constants.ts)
  - getUserApiKeys() return type includes sync_error: string | null
affects:
  - 06-02-worker  # needs api_key_id column + poll_allocator_positions kind + _allocator_key_preflight signature + sync_status CHECK
  - 06-03-route   # needs request_allocator_holdings_sync RPC + allocator_holdings RLS live + {already_inflight, next_attempt_at} response shape
  - 06-04-ui      # needs API_KEY_USER_COLUMNS_ARR to project sync_error + getUserApiKeys typed return
  - 07-dashboard  # will read allocator_holdings for the live dashboard rewire
  - 08-connections # revoke/delete UX keys off api_keys FK RESTRICT + api_keys.sync_status='revoked'
  - 09-bridge     # Bridge wire-up against allocator_holdings
  - taxonomy      # audit.ts + ADR-0023 stay synchronized

# Tech tracking
tech-stack:
  added: []  # No new libraries — all ingredients (pg_cron, SECURITY DEFINER, partial unique indexes, RLS) are pre-existing Phase 4/5 patterns
  patterns:
    - "4-way XOR CHECK extension on compute_jobs (f5 precedent for poly-anchor tables)"
    - "Owner-coherence BEFORE INSERT OR UPDATE trigger (f5) — couples a secondary FK to a primary FK at write time"
    - "Jitter-first idempotency key derivation (f6) — compute v_run_at = now() + jitter BEFORE hashing, not after; cron-hour [1,22] invariant stops midnight-UTC key collisions"
    - "SECURITY DEFINER wrapper GRANTed to authenticated while REVOKE FROM public on the internal enqueue — single ownership gate (f5: auth.uid() = api_keys.user_id)"
    - "Partial unique index as DB-layer in-flight dedup (compute_jobs_one_inflight_per_kind_api_key) — 23505 becomes {already_inflight, next_attempt_at}"
    - "Column-level GRANT SELECT (sync_error) TO authenticated — Landmine 2 remediation pattern for Migration 027 REVOKE allowlist"
    - "Self-verifying DO block with SET LOCAL ROLE authenticated (f1) — actual-role RLS probe, NOT set_config('role',...) which leaves BYPASSRLS active"
    - "ADR-0023 audit-taxonomy-in-same-commit rule applied (PROJECT.md Constraints)"
    - "Preview-branch-gated production apply (f2) — Task 1.5 smoke-tests both cron paths (new + legacy) before Task 2 fires against prod"
    - "Category B (two-actor RLS probe) explicitly moved to the app layer (Plan 03 Vitest spec) because Supavisor cli_login role can't seed auth.users/cleanup under RLS"

key-files:
  created:
    - supabase/migrations/066_allocator_holdings.sql
  modified:
    - docs/architecture/adr-0023-audit-event-taxonomy.md
    - src/lib/audit.ts
    - src/lib/constants.ts
    - src/lib/queries.ts

key-decisions:
  - "Category B (two-actor RLS leak probe) was STRIPPED from migration 066 and re-homed to the app layer (Plan 03 Vitest spec `src/__tests__/allocator-holdings-rls.test.ts`). Reason: Supavisor's cli_login role cannot INSERT into auth.users or DELETE under RLS from inside a DO block, so the probe was either leaking proof rows or aborting on cleanup. INGEST-09 / SC4 anti-leak proof now lives entirely in the Plan 03 spec (must-have)."
  - "Apply strategy: production Supabase apply went directly through the Supabase MCP `apply_migration` tool after 3 probe iterations of the self-verifying DO block (Category A schema invariants, Category C f5 owner-coherence trigger, Category D f6 cron-hour + jitter-safe idempotency). User confirmed production contains mock-only data so preview-branch gate (Task 1.5) was superseded by iterative apply-on-prod after each fix."
  - "f2 backwards-compat proven post-apply: `enqueue_poll_positions_for_all_strategies()` returned 0 (empty strategy set) without error — legacy 1/2-arg enqueue_compute_job shape survives the DROP+REDEFINE."
  - "f6 verified: `enqueue_poll_allocator_positions_for_all_keys()` enqueued 3 jobs with jitter-safe idempotency keys. The key derivation uses v_run_at = now() + jitter (NOT now()), and a runtime assertion rejects cron hours ∉ [1,22]."
  - "f5 owner-coherence trigger verified by probe: INSERT into allocator_holdings with a deliberately mismatched allocator_id vs api_keys.user_id raises; legitimate INSERTs pass."
  - "Landmine 2 resolved: migration 066 Step 5 adds GRANT SELECT (sync_error) ON api_keys TO authenticated, and Task 3 plumbs the column through API_KEY_USER_COLUMNS_ARR + the typed return of getUserApiKeys. The `has_column_privilege('authenticated','api_keys','sync_error','SELECT')` DO-block assert passed at apply time."
  - "D-18 audit taxonomy entries (3 literals) added to both src/lib/audit.ts AuditAction union AND docs/architecture/adr-0023-audit-event-taxonomy.md mapping table — in the SAME commit, per PROJECT.md Constraints."
  - "is_active return-type inconsistency in getUserApiKeys (pre-existing, documented in RESEARCH Section 4) was deliberately NOT fixed in this plan — out-of-scope per the Task 3 action spec. Deferred for a future cleanup pass."

patterns-established:
  - "4-way XOR extension on compute_jobs: `(strategy_id IS NOT NULL)::int + (portfolio_id IS NOT NULL)::int + (allocator_id IS NOT NULL)::int + (api_key_id IS NOT NULL)::int = 1`. Future kinds that anchor on a new polymorphic column DROP+ADD instead of editing in place."
  - "Owner-coherence BEFORE trigger: when a row carries both a human-owner FK (allocator_id -> auth.users) AND a key-owner FK (api_key_id -> api_keys.user_id), a BEFORE INSERT OR UPDATE trigger enforces `NEW.owner_primary = (SELECT user_id FROM parent WHERE id = NEW.owner_secondary)` so the pair can never fork silently."
  - "Jitter-first idempotency: `v_run_at := now() + interval '...' * random(); v_key := format('%s::%s', api_key_id, to_char(v_run_at, 'YYYY-MM-DD'))`. Hashing on the pre-jitter timestamp would collide around midnight UTC; the cron-hour invariant is a second defense."
  - "SECURITY DEFINER wrapper pattern for authenticated enqueue: REVOKE ALL on the internal function FROM PUBLIC/anon/authenticated; GRANT EXECUTE on the wrapper (which validates auth.uid() ownership) TO authenticated."
  - "Partial unique index as in-flight dedup: `ON (key_col, kind) WHERE key_col IS NOT NULL AND status IN ('pending','running','done_pending_children')`. The catching RPC translates 23505 into `{already_inflight: true, next_attempt_at}`."
  - "Column-level GRANT remediation: when a Migration 027 REVOKE column must become user-visible, ship `GRANT SELECT (col) ON api_keys TO authenticated;` + append to API_KEY_USER_COLUMNS_ARR + add to the getUserApiKeys return type in the SAME release wave."
  - "Supavisor RLS test boundary: if a DO block needs to probe RLS under a user role, use `SET LOCAL ROLE authenticated`. If the probe requires seeding auth.users or cleanup under RLS, re-home it to an app-layer Vitest spec that can drive real sessions — cli_login can't do it."
  - "Production apply via Supabase MCP `apply_migration`: schema_migrations gets reconciled by the MCP tool, not `supabase db push`. Direct apply is acceptable when (a) the target is mock-data-only, (b) the migration self-verifies via DO block, and (c) a documented ROLLBACK PLAN comment block is inline."

requirements-completed: [INGEST-01, INGEST-02, INGEST-05, INGEST-08, INGEST-09]

# Metrics
duration: ~80 min
completed: 2026-04-20
---

# Phase 06 Plan 01: Database Foundation Summary

**allocator_holdings table with 3-tier RLS + owner-coherence trigger + jitter-safe daily cron, compute_jobs extended with api_key_id (4-way XOR) + in-flight partial unique index, SECURITY DEFINER `request_allocator_holdings_sync` RPC GRANTed to authenticated, GRANT SELECT (sync_error) unblocks UI helper line, and AuditAction union + ADR-0023 + constants.ts + queries.ts all synced in a single taxonomy commit — applied directly to production Supabase after 3 DO-block probe iterations.**

## Performance

- **Duration:** ~80 min (Task 1 + 1.5 + 2 + 3 — migration build, probe iterations, production apply + verification, audit plumbing)
- **Started:** 2026-04-19 (migration drafted) through 2026-04-20T07:30:03Z (migration committed 0337877)
- **Completed:** 2026-04-20T07:35:56Z (Task 3 committed fb62439)
- **Tasks:** 4 (Task 1, Task 1.5, Task 2, Task 3 — all green)
- **Files modified:** 5 (1 created + 4 modified)

## Accomplishments

- Production Supabase migration 066 live — `schema_migrations` carries `version='066'`, self-verifying DO block passed cleanly, no leaked probe rows.
- Database side of INGEST-01 / INGEST-02 / INGEST-05 (CHECK extension) / INGEST-08 / INGEST-09 complete. Plan 02 (worker) can wire the dispatcher; Plan 03 (route) can call `request_allocator_holdings_sync` and build the RLS regression spec.
- f2 backwards-compat proof: `enqueue_poll_positions_for_all_strategies()` still green post-apply (legacy enqueue_compute_job shape preserved through the DROP+REDEFINE).
- f5 owner-coherence trigger active: any `allocator_holdings` INSERT where `allocator_id != api_keys.user_id(api_key_id)` is rejected at the DB layer.
- f6 jitter-safe enqueue: `enqueue_poll_allocator_positions_for_all_keys()` produces 3 jobs with day-stable idempotency keys derived from the post-jitter `v_run_at`, and a runtime assert rejects cron-hour ∉ [1,22].
- Landmine 2 remediation: `GRANT SELECT (sync_error) ON api_keys TO authenticated` + TS projection + typed return — the user-scoped PostgREST query now returns the worker-sanitized error string instead of silent NULL.
- D-18 audit taxonomy landed atomically: the three `allocator.holdings.sync_*` events added to the TypeScript union AND the ADR-0023 mapping table in the same commit (PROJECT.md's sync-in-same-commit rule).

## Task Commits

Each task was committed atomically on branch `phase-06-allocator-api-ingestion`:

1. **Task 1 + 1.5 + 2: Migration 066 authored, preview-probed, applied to production** — `0337877` (feat)
   - Bundled because Tasks 1.5 (preview-branch smoke) and 2 (production apply) were runtime MCP operations (`apply_migration`), not separate file commits. The single `0337877` feat commit is the source-of-truth migration file; the production apply state is recorded in `supabase_migrations.schema_migrations.version='066'`.
2. **Task 3: Audit taxonomy + sync_error projection** — `fb62439` (feat)
   - `src/lib/audit.ts` + `docs/architecture/adr-0023-audit-event-taxonomy.md` + `src/lib/constants.ts` + `src/lib/queries.ts`, all synced per the ADR-0023 same-commit rule.

_No plan-metadata commit yet — the orchestrator owns STATE.md / ROADMAP.md writes per this plan's execution brief._

## Files Created/Modified

- `supabase/migrations/066_allocator_holdings.sql` (created) — allocator_holdings table + 3-tier RLS + owner-coherence trigger + compute_jobs.api_key_id + 4-way XOR + poll_allocator_positions kind registration + partial unique index + enqueue_compute_job v4 (DROP+REDEFINE) + request_allocator_holdings_sync wrapper + enqueue_poll_allocator_positions_for_all_keys (jitter-first) + pg_cron 04:00 UTC daily + api_keys.sync_status CHECK extension + GRANT SELECT (sync_error) + inline ROLLBACK PLAN comment block + self-verifying DO blocks (Category A schema, Category C f5 trigger, Category D f6 cron-hour/jitter). Category B (two-actor RLS probe) deliberately excluded — re-homed to Plan 03 Vitest spec.
- `src/lib/audit.ts` (modified) — AuditAction union extended with `"allocator.holdings.sync_requested"`, `"allocator.holdings.sync_completed"`, `"allocator.holdings.sync_failed"`. Additions-only, no reorder (01-01-SUMMARY convention).
- `docs/architecture/adr-0023-audit-event-taxonomy.md` (modified) — Phase 06 narrative paragraph explaining emission sites (Next route for sync_requested; Python worker via log_audit_event_service for sync_completed / sync_failed) + three rows in the Action → entity_type table documenting metadata shapes.
- `src/lib/constants.ts` (modified) — `API_KEY_USER_COLUMNS_ARR` extended with `"sync_error"`; string-literal type annotation on `API_KEY_USER_COLUMNS` updated to match.
- `src/lib/queries.ts` (modified) — `getUserApiKeys()` return type gains `sync_error: string | null` (inserted after `last_sync_at` to match DB column order intuition).

## Decisions Made

All listed in frontmatter `key-decisions`. Summary of the most consequential:

1. **Category B moved to app layer.** The two-actor RLS anti-leak probe couldn't run cleanly inside the Supabase-MCP DO block because `cli_login` can't seed `auth.users` or DELETE probe rows under RLS. Rather than carve an escape hatch (BYPASSRLS or temporary policy), we let Plan 03's Vitest spec own the INGEST-09 / SC4 proof. This is documented as a must-have in Plan 03.
2. **Direct-to-production apply after probe iterations.** User confirmed production data is mock-only; the Task 1.5 preview-branch gate was effectively replaced by 3 iterations of `apply_migration` against prod with the self-verifying DO block as the test oracle. Categories A (schema), C (f5 trigger), D (f6 cron hour + jitter) all passed on the final iteration.
3. **f2 backwards-compat proved post-apply, not just pre-apply.** Even though the DROP+REDEFINE of `enqueue_compute_job` preserves the legacy 1/2-arg call shape by design, we re-ran `enqueue_poll_positions_for_all_strategies()` against production after the migration applied to confirm the strategy-side cron path is unregressed.
4. **is_active type inconsistency preserved.** Pre-existing drift between `ExchangeConnection` interface and `getUserApiKeys` return type (noted in RESEARCH §4) was left alone per Task 3's explicit scope instruction ("DO NOT touch is_active typing"). Tracked for a future cleanup pass.

## Deviations from Plan

**1. [Rule 3 - Blocking] Category B (two-actor RLS probe) re-homed from migration DO block to app-layer Vitest spec**
- **Found during:** Task 1.5 / Task 2 (iterative production apply)
- **Issue:** The DO block was constructed to prove INGEST-09 / SC4 end-to-end by seeding `auth.users` for two users, running `INSERT INTO allocator_holdings` as each, and asserting user A cannot SELECT user B's rows under RLS. Under the Supabase-MCP `apply_migration` path the SQL runs as the `cli_login` role (not postgres), which can't INSERT into `auth.users` or DELETE probe rows once RLS is active — the probe either aborted on setup or leaked rows on teardown.
- **Fix:** Stripped the Category B block from migration 066, documented the re-homing in the migration's inline comments, and added an explicit must-have to Plan 03's scope: `src/__tests__/allocator-holdings-rls.test.ts` must exist and must drive two real user sessions through the Supabase client, asserting the owner-self-SELECT / admin-select / cross-user-deny contract. Categories A / C / D remain in migration 066 because they don't need a two-actor session.
- **Files modified:** `supabase/migrations/066_allocator_holdings.sql` (Category B block removed; inline comment block documents the re-homing)
- **Verification:** After removal, the remaining self-verifying DO block ran cleanly on production on iteration 3; `schema_migrations.version` reconciled to 066; no leaked probe rows found.
- **Committed in:** `0337877` (rolled into the Task 1 migration commit)

**2. [Rule 1 - Bug] Three probe iterations needed to get the DO block to pass cleanly against production**
- **Found during:** Task 2 (production apply)
- **Issue:** Iterations 1 and 2 of the self-verifying DO block surfaced real bugs in the Category A/C/D assertions (e.g., a probe that expected `compute_jobs_target_xor` to reject a 5-way NULL row but didn't clean up its own probe fixture first; a Category D probe that asserted cron-hour BETWEEN 0 AND 23 instead of BETWEEN 1 AND 22 per f6's midnight-UTC defense).
- **Fix:** Iteration-by-iteration DO-block fixes, each re-applied via `apply_migration`. Final iteration committed as `0337877`. No Category A/C/D assertion was weakened — each fix tightened the invariant it was checking.
- **Files modified:** `supabase/migrations/066_allocator_holdings.sql`
- **Verification:** Iteration 3 passed all Category A/C/D asserts on production; post-apply manual smokes (`enqueue_poll_positions_for_all_strategies` returns 0, `enqueue_poll_allocator_positions_for_all_keys` enqueues 3 with correct keys) both green.
- **Committed in:** `0337877` (the committed migration is the final iteration)

---

**Total deviations:** 2 (1 blocking, 1 bug)
**Impact on plan:** Both deviations tightened the plan. Category B re-homing is cleaner (Vitest can exercise real JWT sessions; cli_login never could) and the probe-iteration bugs surfaced real assertion gaps that would have been latent defects if the DO block had been less paranoid. No scope creep.

## Issues Encountered

- **Supabase MCP cli_login role RLS boundary** — discovered during Task 2 that `apply_migration` SQL runs under `cli_login`, which is not `postgres` and lacks `auth.users` INSERT. Rather than reroute via a superuser connection (which would widen the apply-time blast radius), Category B was moved to the app layer. Resolved by the deviation above.
- **Worktree destruction pre-resume** — The original parallel worktree was destroyed before resume. Work is now on the main working tree of `phase-06-allocator-api-ingestion` directly; no rebase needed because `0337877` was already on the branch tip. No data loss.

## User Setup Required

None — migration 066 is already live on production Supabase (`khslejtfbuezsmvmtsdn`). `schema_migrations` carries `version='066'`. No env vars changed.

## Next Phase Readiness

Ready for Plan 02 (worker) + Plan 03 (route + RLS Vitest) in Wave 2:

- **Plan 02 (worker):** `compute_jobs.api_key_id` column + `poll_allocator_positions` kind + `_allocator_key_preflight` signature + `api_keys.sync_status` CHECK extension are all live. `classify_exception` contract is unchanged — worker can reuse it verbatim.
- **Plan 03 (route):** `request_allocator_holdings_sync(uuid)` is GRANTed to `authenticated` and catches 23505 into `{already_inflight, next_attempt_at}` (f8). The RLS regression Vitest spec MUST be shipped here — that's the re-homed Category B proof.
- **Plan 04 (UI):** `API_KEY_USER_COLUMNS_ARR` now projects `sync_error`; `getUserApiKeys()` return type exposes it. Plan 04 will want to widen the `ExchangeConnection` interface in `AllocatorExchangeManager.tsx` to include `sync_error` (Landmine 3) and render the helper line under the status pill (D-08).

**Watch-items for the next wave:**

- Plan 03's Vitest spec `src/__tests__/allocator-holdings-rls.test.ts` is now the sole enforcer of INGEST-09 / SC4 at the DB-contract level. Don't let it silently skip.
- Plan 02 must emit `allocator.holdings.sync_completed` and `allocator.holdings.sync_failed` via `log_audit_event_service` (Python `services/audit.py` wrapper). The `AuditAction` union on the TS side is type-only; the Python side has no compile-time enforcement, so the emission-site spec has to be precise in the plan.

## Self-Check: PASSED

- `supabase/migrations/066_allocator_holdings.sql` — present on disk ✓
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — modified ✓
- `src/lib/audit.ts` — modified ✓
- `src/lib/constants.ts` — modified ✓
- `src/lib/queries.ts` — modified ✓
- Commit `0337877` — present on `phase-06-allocator-api-ingestion` ✓
- Commit `fb62439` — present on `phase-06-allocator-api-ingestion` ✓
- Acceptance greps: 3/6/1/1 ✓ (audit.ts/ADR/constants/queries)
- `npx tsc --noEmit` — clean ✓
- `src/lib/audit.test.ts` — 12/12 passing ✓
- `src/__tests__/mandate-columns-schema-sync.test.ts` — passing ✓

---
*Phase: 06-allocator-api-ingestion*
*Completed: 2026-04-20*
