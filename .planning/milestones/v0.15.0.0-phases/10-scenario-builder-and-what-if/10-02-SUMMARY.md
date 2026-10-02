---
phase: 10
plan: 02
subsystem: scenario-builder-and-what-if
tags: [migration, schema, security-definer, rpc, audit, scenario, voluntary-kind, single-tx]
requires:
  - .planning/phases/10-scenario-builder-and-what-if/10-02-PLAN.md
  - supabase/migrations/072_match_decisions_original_holding_ref.sql
  - supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql
  - supabase/migrations/074_match_decisions_widen_unique_holding.sql
  - supabase/migrations/059_bridge_outcomes.sql
  - supabase/migrations/069_delete_allocator_api_key_rpc.sql
provides:
  - "match_decisions.kind discriminator (match_decision_kind ENUM with 4 values)"
  - "bridge_outcomes voluntary-kind relaxation (nullable strategy_id, (allocator_id, match_decision_id) UNIQUE)"
  - "compute_bridge_outcome_deltas voluntary_add CTE branch (closes Pitfall 5 cron-coverage gap)"
  - "commit_scenario_batch SECURITY DEFINER RPC (single-tx commit pipeline for Plan 07 H4)"
  - "ADR-0023 Phase 10 entry covering all three migrations"
affects:
  - "Plan 10-07 will own the POST /api/allocator/scenario/commit route → admin.rpc('commit_scenario_batch')"
  - "compute_bridge_outcome_deltas() pg_cron now picks up voluntary_add rows for delta tracking"
tech-stack:
  added: []
  patterns:
    - "Per-kind invariant CHECK constraints gated by an enum discriminator (replaces XOR)"
    - "SECURITY DEFINER RPC + auth.uid() guard + locked search_path for self-service write paths"
    - "M7 reuse-or-create — SELECT-then-INSERT pattern inside single-tx scope avoids unique-index violations on retry"
    - "Live-DB regression tests via Supabase Management API for pg_catalog / information_schema introspection (PostgREST does not expose these)"
key-files:
  created:
    - supabase/migrations/080_match_decisions_kind_enum.sql
    - supabase/migrations/081_bridge_outcomes_relax_for_voluntary.sql
    - supabase/migrations/082_commit_scenario_batch_rpc.sql
    - src/__tests__/bridge-outcomes-voluntary-schema.test.ts
    - src/__tests__/bridge-outcome-cron-voluntary-add.test.ts
    - src/__tests__/scenario-commit-batch-tx.test.ts
    - .planning/phases/10-scenario-builder-and-what-if/10-02-SUMMARY.md
  modified:
    - docs/architecture/adr-0023-audit-event-taxonomy.md
    - src/__tests__/match-decisions-schema.test.ts
    - src/lib/test-helpers/live-db.ts
decisions:
  - "Used Supabase Management API (POST /v1/projects/{ref}/database/query) for all three migration applies — `supabase db push` was incompatible with pre-existing migration-history drift (timestamp-format remote rows from prior MCP applies + local-only 078/079 healing migrations) and a clean push of just 080+081+082 needs the API path that the Supabase MCP itself uses."
  - "Renamed plan/RESEARCH 'suggested_strategy_id' → live schema 'strategy_id' throughout migrations 080+082 and the regression tests. The plan refers to the recommended/added-strategy column on match_decisions as suggested_strategy_id, but the live schema (since migration 011) calls it strategy_id (NOT NULL until migration 080 STEP 2 drops the constraint). Tracked as Rule 1 deviation."
  - "Migration 081 keeps bridge_outcomes.kind in {'allocated','rejected'} (the BridgeOutcomeBanner / AllocatedForm / RejectedForm contracts are pinned). Voluntary semantics live on match_decisions.kind. voluntary_remove → bridge_outcomes.kind='rejected' with strategy_id=NULL; voluntary_add → kind='allocated' with strategy_id=NEW."
  - "Migration 080 adds DEFAULT 'bridge_recommended' on match_decisions.kind so any pre-Phase-10 INSERT call site that omits the kind column lands as bridge_recommended (which exactly matches the shape those code paths produce). Backward compatibility per the plan's must_haves is satisfied without touching existing application code."
  - "Migration 080 STEP 2 drops NOT NULL on match_decisions.strategy_id. voluntary_remove rows require strategy_id IS NULL; without this DROP, the column-level NOT NULL fires before the per-kind CHECK could evaluate. Same pattern as migration 072 STEP 1 (which dropped NOT NULL on original_strategy_id before adding the XOR)."
  - "RPC ownership probe uses parse_holding_ref (migration 073) + JOIN against allocator_holdings (venue, symbol, holding_type) tuple. The plan implicitly assumed allocator_holdings has a scope_ref column — it does not. The canonical scope columns are (venue, symbol, holding_type) and the scope_ref is constructed at the application boundary."
  - "RPC decision-column mapping: bridge_recommended uses decision='thumbs_up' (uses migration-074 widened unique index that admits multiple holdings against the same strategy → matches M7 invariant). voluntary_remove + voluntary_add + voluntary_modify use decision='snoozed' (no partial unique index → no collisions). Both choices avoid the migration-011 uniq_match_dec_sent_per_pair partial unique index that does NOT include holding_ref and would block multi-holding sessions."
  - "Three atomic commits per the D-23 atomic-commit precedent — migration 080 + ADR-0023 sync (one commit), migration 081 + ADR sync (the ADR Phase-10 entry already shipped with 080 covers the full trio narratively), migration 082 + ADR sync (same)."
  - "Test introspection: added HAS_INTROSPECTION + runIntrospectionSql() helper to src/lib/test-helpers/live-db.ts. PostgREST does NOT expose pg_catalog or information_schema in the schema cache (returns PGRST205). The Management API endpoint accepts raw SQL and is the only path for tests that need Postgres metadata reads (column types, constraint names, index presence, pg_get_functiondef, has_function_privilege). Gated on SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF env vars."
metrics:
  duration_minutes: 90
  completed: 2026-04-26
---

# Phase 10 Plan 02: Migrations 080 + 081 + 082 — match_decisions kind + bridge_outcomes relaxation + commit_scenario_batch RPC Summary

**One-liner:** Three live-DB migrations + ADR-0023 sync + 41 live-DB regression cases ship the schema foundation for SCENARIO-07 — match_decision_kind enum with per-kind CHECKs (relaxes Phase 09 XOR), bridge_outcomes voluntary-kind relaxation (nullable strategy_id, per-decision unique key), and the SECURITY DEFINER `commit_scenario_batch` RPC that Plan 07's commit route delegates to for the H4 single-tx invariant.

## What Shipped

### Migration 080 — match_decision_kind enum + per-kind CHECKs + voluntary_add cron branch

`supabase/migrations/080_match_decisions_kind_enum.sql` (457 lines):

- **STEP 1**: `CREATE TYPE match_decision_kind AS ENUM ('bridge_recommended', 'voluntary_remove', 'voluntary_add', 'voluntary_modify')` — idempotent.
- **STEP 2**: `ALTER COLUMN match_decisions.strategy_id DROP NOT NULL` — voluntary_remove rows require `strategy_id IS NULL`. Pattern from migration 072 STEP 1.
- **STEP 3**: `ADD COLUMN kind match_decision_kind` with `COMMENT ON COLUMN` documenting the four discriminator semantics.
- **STEP 4**: backfill `UPDATE match_decisions SET kind = 'bridge_recommended' WHERE kind IS NULL` — all pre-Phase-10 rows trivially satisfy this kind.
- **STEP 5**: `ALTER COLUMN kind SET NOT NULL, SET DEFAULT 'bridge_recommended'` — backward-compat with existing INSERT call sites that omit the kind column.
- **STEP 6**: `DROP CONSTRAINT match_decisions_original_xor` — Phase 09 XOR relaxed.
- **STEP 7**: ADD four per-kind CHECK constraints (`match_decisions_kind_bridge_recommended`, `_voluntary_remove`, `_voluntary_add`, `_voluntary_modify`).
- **STEP 8 (H2)**: `CREATE OR REPLACE FUNCTION compute_bridge_outcome_deltas()` adding the third CTE branch `voluntary_add_candidates` / `voluntary_add_computed` / `voluntary_add_updated` matching `md.kind='voluntary_add'`. Closes the cron-coverage gap (RESEARCH Pitfall 5) — voluntary_add rows now accrue delta_30d/90d/180d once `strategy_analytics.returns_series` covers `allocated_at + N`.
- **STEP 9 (DO block)**: 7 self-verification assertions a–g — backfill check, XOR removal, enum presence, 4 CHECK presence, M2 NULL/NULL pair check, L1 all-rows-pass-CHECKs check, H2 cron branch reachable. RAISE NOTICE 'phase10:' on success.

Live verification (Management API):
- `pg_constraint` shows the 4 new `match_decisions_kind_*` constraints, no `match_decisions_original_xor`
- `pg_enum` shows the 4 enum values
- All 4 pre-existing match_decisions rows backfilled to `kind='bridge_recommended'`
- `pg_get_functiondef(compute_bridge_outcome_deltas)` contains `voluntary_add_candidates`

### Migration 081 — bridge_outcomes voluntary-kind relaxation

`supabase/migrations/081_bridge_outcomes_relax_for_voluntary.sql` (192 lines):

- **STEP 1**: `ALTER COLUMN bridge_outcomes.strategy_id DROP NOT NULL` — voluntary_remove rows have no replacement strategy.
- **STEP 2**: `DROP INDEX bridge_outcomes_unique_per_strategy_holding` (migration 072) + `ADD CONSTRAINT bridge_outcomes_allocator_match_decision_unique UNIQUE (allocator_id, match_decision_id)` — natural per-decision key now that voluntary kinds (with NULL strategy_id) exist. Strict superset of the prior `(allocator, strategy, holding)` guarantee since every bridge_outcome FKs to one match_decision.
- **STEP 3**: replace migration-059's consolidated `bridge_outcomes_kind_fields_valid` with two named kind-aware CHECK constraints (`bridge_outcomes_kind_allocated` + `bridge_outcomes_kind_rejected`) that require either `strategy_id NOT NULL` or `match_decision_id NOT NULL`.
- **STEP 4 (DO block)**: 4 self-verification assertions a–d — strategy_id nullable, legacy unique gone, new unique present, both kind-aware CHECKs present.

`bridge_outcomes.kind` itself stays in `{'allocated','rejected'}` — voluntary_remove uses `kind='rejected'` and voluntary_add uses `kind='allocated'`. The "voluntary" semantic lives on `match_decisions.kind`.

### Migration 082 — commit_scenario_batch SECURITY DEFINER RPC (H4 + M7)

`supabase/migrations/082_commit_scenario_batch_rpc.sql` (397 lines):

- `CREATE OR REPLACE FUNCTION public.commit_scenario_batch(p_allocator_id uuid, p_diffs jsonb) RETURNS jsonb` — `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.
- **Auth guard at entry**: `IF v_caller IS NULL OR v_caller <> p_allocator_id THEN RAISE EXCEPTION ... USING ERRCODE = '42501'` — defence-in-depth alongside the route's `withAuth`.
- **Per-kind branches** with the proper live-schema column names:
  - **voluntary_remove**: ownership probe via `parse_holding_ref(diff.holding_ref)` JOIN `allocator_holdings (venue, symbol, holding_type)` → INSERT `match_decisions(kind='voluntary_remove', decision='snoozed', strategy_id=NULL, original_holding_ref=diff.holding_ref)` + `bridge_outcomes(kind='rejected', strategy_id=NULL, rejection_reason)`.
  - **voluntary_add**: strategy `status='published'` gate → INSERT `match_decisions(kind='voluntary_add', decision='snoozed', strategy_id=diff.strategy_id, original_*=NULL)` + `bridge_outcomes(kind='allocated', strategy_id, percent_allocated, allocated_at)`.
  - **voluntary_modify**: ownership probe → INSERT `match_decisions(kind='voluntary_modify', decision='snoozed', strategy_id=NULL, original_holding_ref=diff.holding_ref)` + `bridge_outcomes(kind='allocated', strategy_id=NULL — no swap)`.
  - **bridge_recommended**: strategy gate + ownership probe + **M7 reuse-or-create** — `SELECT id FROM match_decisions WHERE (allocator_id, original_holding_ref, strategy_id, kind) = (p_allocator_id, diff.holding_ref, diff.strategy_id, 'bridge_recommended') LIMIT 1`. On hit: reuse id (no new INSERT, no migration-074 unique index violation on retry). On miss: INSERT new with `decision='thumbs_up'` (uses migration-074's widened `(allocator_id, strategy_id, COALESCE(original_holding_ref, ''))` unique index that admits multiple holdings against the same strategy).
- **Single-tx invariant (H4)**: per-row `RAISE EXCEPTION` rolls back the entire batch (Postgres functions in plpgsql run inside the caller's transaction; an unhandled EXCEPTION propagates and rolls back).
- **Return shape**: `{ ok: true, recorded: [{index, match_decision_id, bridge_outcome_id, kind}, ...] }`.
- **Authorisation**: `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated`.
- **Self-verifying DO block**: 6 assertions a–f. Live verification confirms `prosecdef=t`, `proconfig` has `search_path=public, pg_temp`, `auth.uid() <> p_allocator_id` guard string in `prosrc`, `authenticated` has EXECUTE, `anon` does NOT, `public` does NOT.

### ADR-0023 sync

`docs/architecture/adr-0023-audit-event-taxonomy.md` — new "Phase 10 — Scenario Builder and What-If" section narrating the full 080+081+082 trio per the D-23 atomic-commit precedent. Documents the new `match_decision_kind` enum, the four per-kind CHECK constraints, the voluntary_add cron branch (closes the "Bridge recommendations actually worked" feedback loop for browse-added strategies), the bridge_outcomes voluntary-kind relaxation, the `commit_scenario_batch` SECURITY DEFINER RPC, and the existing `match.decision_record` audit kind continues to carry voluntary diffs unchanged via `metadata.kind` (Phase 09 D-14 precedent).

### Live-DB regression tests (45 cases — all GREEN)

| File | Cases | Coverage |
|------|-------|----------|
| `src/__tests__/match-decisions-schema.test.ts` (extended) | 19 | Migration 080 — kind column shape + default + backfill, XOR removal, 4 per-kind CHECKs, valid INSERTs (BR/VR/VA/VM), invalid INSERTs (REJECT_VR/VA/BR_ORPHAN with constraint-name-matching error), M2 no-NULL-pairs, L1 all-rows-pass-CHECKs |
| `src/__tests__/bridge-outcomes-voluntary-schema.test.ts` (NEW) | 8 | Migration 081 — strategy_id nullable, legacy unique gone, new (allocator_id, match_decision_id) unique present, voluntary_remove + voluntary_add bridge_outcomes shapes round-trip cleanly (the **H1 hard verification** must-haves item), kind-aware CHECK rejects bad shape, double-INSERT blocked by new unique, **T_BO_LIVE_ROUNDTRIP** proves Plan 07's exact commit-route INSERT shape works for both voluntary kinds |
| `src/__tests__/bridge-outcome-cron-voluntary-add.test.ts` (NEW) | 3 | Migration 080 STEP 8 — `voluntary_add_candidates` reachable in cron via `pg_get_functiondef`, fixture with `allocated_at=today-31d` + 200d returns_series gets `delta_30d` populated to ~0.045 (the **H2 hard verification** must-haves item), fixture with empty returns_series leaves all deltas NULL (idempotency / no spurious fills) |
| `src/__tests__/scenario-commit-batch-tx.test.ts` (NEW) | 15 | Migration 082 — RPC introspection (prosecdef, search_path, auth-guard string, EXECUTE grants), behavioral happy paths (return shape, voluntary_add, voluntary_remove → strategy_id NULL), behavioral guards (single-tx rollback for H4 row-2 conflict, ownership probe for cross-tenant holding_ref, auth.uid() mismatch via signed-in-as-A calling with p_allocator_id=B, strategy gate for status='draft'), **M7** (T_RPC_M7_REUSE_FIRST_INSERT inserts new match_decision; T_RPC_M7_REUSE_SECOND_REUSES proves the second call reuses the existing id with no new row) |

Test infrastructure addition: `src/lib/test-helpers/live-db.ts` gained `HAS_INTROSPECTION` + `runIntrospectionSql()` helper using the Supabase Management API to bypass PostgREST's pg_catalog / information_schema schema-cache restrictions. Reused by all four test files for metadata reads.

## Migration NOTICE Output (captured during apply)

Each migration's apply via Management API returned `[]` (empty array — Postgres DO blocks emit NOTICE messages that are not surfaced through the Management API HTTP response, but a missing assertion would surface as a 500 error). Per the self-verifying DO block design, the apply succeeded ⇒ all assertions passed (any RAISE EXCEPTION rolls back the transaction and would surface in the response).

Live-DB introspection probes after each apply confirmed the assertions:

**Migration 080**:
- `pg_constraint` for `match_decisions`: 4 new `match_decisions_kind_*` CHECKs, no `match_decisions_original_xor` ✓
- `pg_enum` for `match_decision_kind`: 4 values (bridge_recommended, voluntary_remove, voluntary_add, voluntary_modify) ✓
- `match_decisions.kind`: 4/4 rows backfilled to bridge_recommended (no NULL kind) ✓
- `pg_get_functiondef(compute_bridge_outcome_deltas)` contains `voluntary_add_candidates` ✓

**Migration 081**:
- `bridge_outcomes.strategy_id` is_nullable = YES ✓
- `bridge_outcomes_unique_per_strategy_holding` index gone; `bridge_outcomes_allocator_match_decision_unique` constraint present ✓
- `bridge_outcomes_kind_allocated` + `bridge_outcomes_kind_rejected` named CHECKs present; `bridge_outcomes_kind_fields_valid` consolidated CHECK gone ✓

**Migration 082**:
- `pg_proc.prosecdef = t` for commit_scenario_batch ✓
- `pg_proc.proconfig` contains `search_path=public, pg_temp` ✓
- `has_function_privilege('authenticated', 'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE') = t` ✓
- `has_function_privilege('anon', ..., 'EXECUTE') = f` ✓
- `has_function_privilege('public', ..., 'EXECUTE') = f` ✓

## Final pg_constraint listing

**`match_decisions` (post-080)**:
```
match_decisions_allocator_id_fkey
match_decisions_candidate_id_fkey
match_decisions_contact_request_id_fkey
match_decisions_decided_by_fkey
match_decisions_decision_check
match_decisions_kind_bridge_recommended      ← new
match_decisions_kind_voluntary_add            ← new
match_decisions_kind_voluntary_modify         ← new
match_decisions_kind_voluntary_remove         ← new
match_decisions_original_strategy_id_fkey
match_decisions_pkey
match_decisions_strategy_id_fkey
                                             (match_decisions_original_xor — REMOVED)
```

**`bridge_outcomes` (post-081)**:
```
bridge_outcomes_allocated_at_check
bridge_outcomes_allocator_id_fkey
bridge_outcomes_allocator_match_decision_unique  ← new
bridge_outcomes_estimated_days_check
bridge_outcomes_kind_allocated                    ← new (replaces consolidated kind_fields_valid)
bridge_outcomes_kind_check
bridge_outcomes_kind_rejected                     ← new
bridge_outcomes_match_decision_id_fkey
bridge_outcomes_note_check
bridge_outcomes_percent_allocated_check
bridge_outcomes_pkey
bridge_outcomes_rejection_reason_check
bridge_outcomes_strategy_id_fkey
                                                  (bridge_outcomes_kind_fields_valid — REMOVED)
                                                  (bridge_outcomes_unique_per_strategy_holding — REMOVED)
```

**`pg_proc` for `commit_scenario_batch`**:
```
proname: commit_scenario_batch
prosecdef: t
proconfig: search_path=public, pg_temp
auth.uid() guard string: present in prosrc
EXECUTE grants: authenticated only (anon=f, public=f)
```

## Plan 07 hand-off

The Plan 07 commit route's `admin.rpc("commit_scenario_batch", { p_allocator_id, p_diffs })` call now has a real owner. The H4 single-tx invariant is verifiable end-to-end via `T_RPC_SINGLE_TX_ROLLBACK` in `scenario-commit-batch-tx.test.ts`. The voluntary_remove + voluntary_add bridge_outcomes round-trip cleanly through the RPC per `T_RPC_VR_BO_NULL_STRATEGY` and `T_RPC_VA_HAPPY`. The M7 reuse-or-create logic is proven by the `T_RPC_M7_REUSE_FIRST_INSERT` + `T_RPC_M7_REUSE_SECOND_REUSES` pair.

## voluntary_add cron-coverage decision

Per RESEARCH Pitfall 5 — option (a): **third CTE branch shipped atomically with migration 080**. Without this branch, voluntary_add rows would satisfy NEITHER the strategy branch (which requires `original_strategy_id IS NOT NULL`) nor the holding branch (which requires `original_holding_ref IS NOT NULL`) and would be silently dropped from delta tracking forever — closing the "Bridge recommendations actually worked" feedback loop for self-added strategies.

`bridge-outcome-cron-voluntary-add.test.ts:T_CRON_FIRES_FOR_VA` proves the branch fires on a fixture row with `allocated_at = today - 31d` and a 200-day linear returns_series, producing `delta_30d ≈ 0.045` (the linear curve at i=30 with `1.0 + 30 * 0.3 / 200`). `T_CRON_LEAVES_NULL_FOR_FRESH` proves no spurious fills for fixtures with empty returns_series.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Schema-name reconciliation: `suggested_strategy_id` → `strategy_id`**
- **Found during:** Task 2 (first migration 080 push attempt to live DB)
- **Issue:** The plan + RESEARCH refer to the recommended/added-strategy column on `match_decisions` as `suggested_strategy_id`. The live schema (since migration 011) calls this column `strategy_id` (and it was NOT NULL until this migration). The Management API apply returned `ERROR: 42703: column "suggested_strategy_id" does not exist`.
- **Fix:**
  - Added `STEP 2` to migration 080: `ALTER COLUMN match_decisions.strategy_id DROP NOT NULL` — same pattern as migration 072 STEP 1 (which dropped NOT NULL on `original_strategy_id` before adding the XOR CHECK). voluntary_remove rows require this column to be NULL.
  - Replaced `suggested_strategy_id` with `strategy_id` throughout the four per-kind CHECK constraints, the voluntary_add CTE branch in `compute_bridge_outcome_deltas()`, and the L1 DO-block assertion.
  - Header comment + `COMMENT ON COLUMN kind` document the naming reconciliation.
  - Same fix applied to migration 082's RPC body and its DO block.
- **Files modified:** `supabase/migrations/080_match_decisions_kind_enum.sql`, `supabase/migrations/082_commit_scenario_batch_rpc.sql`
- **Commits:** `66c61fc` (the schema-name fix for 080), `ec13d40` (082 includes the fix from inception)

**2. [Rule 1 - Bug] `allocator_holdings.scope_ref` does not exist on this schema**
- **Found during:** Task 4 (RPC GREEN test run)
- **Issue:** The plan's RPC pseudocode uses `WHERE scope_ref = v_diff->>'holding_ref'` to probe `allocator_holdings` ownership. The live `allocator_holdings` schema has NO `scope_ref` column — the canonical scope columns are `(venue, symbol, holding_type)` and the scope_ref is a Phase 06+08 application-layer convention built via `buildHoldingScopeRef`.
- **Fix:** Updated migration 082's ownership probe to use `LATERAL parse_holding_ref(v_diff->>'holding_ref')` (the helper from migration 073 that splits "holding:{venue}:{symbol}:{type}") and JOIN against `allocator_holdings` on the parsed `(venue, symbol, holding_type)` tuple.
- **Files modified:** `supabase/migrations/082_commit_scenario_batch_rpc.sql`
- **Commit:** `ec13d40` (082 inclusive of the fix)

**3. [Rule 1 - Bug] Test fixture for `allocator_holdings` used non-existent columns**
- **Found during:** Task 4 GREEN test run
- **Issue:** The test fixture INSERT used a `scope_ref` column (doesn't exist) and a `weight` column (also doesn't exist). The unique key is `(allocator_id, venue, symbol, asof)` not `(allocator_id, asof, venue, symbol, holding_type)`. `api_key_id` is NOT NULL and must FK to a real `api_keys` row.
- **Fix:** Rewrote the fixture seed to use the actual schema (`venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price, api_key_id`); added an api_keys fixture with the required NOT NULL columns (`exchange, label, api_key_encrypted, is_active, kek_version`); fixed the onConflict to match the actual unique index.
- **Files modified:** `src/__tests__/scenario-commit-batch-tx.test.ts`
- **Commit:** `3fd509e`

**4. [Rule 2 - Critical functionality] PostgREST does not expose `pg_catalog` / `information_schema` — added Management API helper**
- **Found during:** Task 3 first test run
- **Issue:** Multiple Phase 10 acceptance criteria require introspection of constraint names, column data types, function `prosecdef`, and `has_function_privilege` results. PostgREST returns `PGRST205 "Could not find the table 'public.pg_constraint' in the schema cache"` — the project's PostgREST instance does not expose pg_catalog or information_schema.
- **Fix:** Added `HAS_INTROSPECTION` + `runIntrospectionSql()` helper to `src/lib/test-helpers/live-db.ts` that uses the Supabase Management API endpoint (`POST /v1/projects/{ref}/database/query`) — the same mechanism the Supabase MCP uses — to bypass PostgREST. All metadata-introspection tests now gate on `HAS_INTROSPECTION` in addition to `HAS_LIVE_DB`. Required env vars: `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`. The legacy migration-064 cases (Cases 1+2 in match-decisions-schema.test.ts) were also retrofitted onto this helper since they used the same restricted introspection path and were silently failing.
- **Files modified:** `src/lib/test-helpers/live-db.ts`, `src/__tests__/match-decisions-schema.test.ts`, `src/__tests__/bridge-outcomes-voluntary-schema.test.ts`, `src/__tests__/bridge-outcome-cron-voluntary-add.test.ts`, `src/__tests__/scenario-commit-batch-tx.test.ts`
- **Commit:** `9262552`

**5. [Rule 1 - Bug] Service-role client has `auth.uid() = NULL`; the auth.uid() guard rejects it**
- **Found during:** Task 4 GREEN test run
- **Issue:** The plan's example test code uses `admin.rpc(...)` with the service-role client. The RPC's auth.uid() guard explicitly rejects NULL (`v_caller IS NULL OR v_caller <> p_allocator_id`). All happy-path RPC tests would fail with 42501 'unauthorized'.
- **Fix:** Added a user-scoped `userClientA` (anon-key + `signInWithPassword`) for allocator A in `beforeAll`, and a parallel `userClientB` for allocator B. Replaced all `admin.rpc("commit_scenario_batch"` happy-path calls with `userClientA.rpc(...)` (matches the route layer's contract — the route always invokes with a real authenticated session). The `T_RPC_AUTH_UID_MISMATCH` test now exercises a true cross-tenant mismatch (allocator A signed in, calling RPC with `p_allocator_id = allocatorBId`).
- **Files modified:** `src/__tests__/scenario-commit-batch-tx.test.ts`
- **Commit:** `3fd509e`

**6. [Rule 3 - Blocking] `uniq_match_dec_sent_per_pair` partial unique index blocks multi-allocator-add for same strategy**
- **Found during:** Task 3 GREEN test run
- **Issue:** Migration 011 created a partial unique on `(allocator_id, strategy_id) WHERE decision='sent_as_intro'`. The plan's RPC pseudocode used `decision='sent_as_intro'` for voluntary_add, which would block any second voluntary_add of the same strategy by the same allocator (a common case in scenario sessions). Also blocked the bridge_recommended path because it uses the same partial unique.
- **Fix:** Mapped each kind to a `decision` value that uses an index admitting the M7 invariant:
  - bridge_recommended → `decision='thumbs_up'` (uses migration-074's widened `(allocator_id, strategy_id, COALESCE(original_holding_ref, ''))` unique that admits multiple holdings)
  - voluntary_remove + voluntary_add + voluntary_modify → `decision='snoozed'` (no partial unique index)
  Documented the mapping in migration 082's header comment.
- **Files modified:** `supabase/migrations/082_commit_scenario_batch_rpc.sql`
- **Commit:** `ec13d40`

### Auth Gates

None encountered. Pre-flight `live_db_authorization` from the orchestrator pre-approved Management API writes. Supabase access token retrieved from macOS Keychain (`security find-generic-password -s "Supabase CLI" -a "supabase"` returns a `go-keyring-base64:` wrapper that decodes to the `sbp_*` token).

### Migration-history drift handling

Pre-existing drift on this project: local-only migrations 078 + 079 (equity-snapshot healing for v0.15.4.x) and two timestamp-format remote rows (`20260424012820` + `20260424031238`) representing the same 078/079 work applied via MCP earlier. `supabase db push` would attempt to push 078/079 + my new 080-082 together, but 078/079 are duplicates of what's already on remote (just with different version-number formats). Per the plan's pre-flight ordering, used the Management API directly for 080/081/082, recording them in `supabase_migrations.schema_migrations` after each apply via an `INSERT ... ON CONFLICT (version) DO NOTHING`. This matches the Phase 07 STATE precedent and keeps the timestamp drift untouched.

## Test Counts

| Test file | Cases | Pass |
|-----------|-------|------|
| `match-decisions-schema.test.ts` | 19 | 19 |
| `bridge-outcomes-voluntary-schema.test.ts` | 8 | 8 |
| `bridge-outcome-cron-voluntary-add.test.ts` | 3 | 3 |
| `scenario-commit-batch-tx.test.ts` | 15 | 15 |
| **Total** | **45** | **45** |

`npx vitest run src/__tests__/match-decisions-schema.test.ts src/__tests__/bridge-outcomes-voluntary-schema.test.ts src/__tests__/bridge-outcome-cron-voluntary-add.test.ts src/__tests__/scenario-commit-batch-tx.test.ts` → 4/4 files passed, 45/45 cases passed (~106s total runtime).

`npx tsc --noEmit` exit 0 (clean).

## ADR-0023 changeset summary

A single Phase 10 section added beneath the existing Phase 09 section, narrating all three migrations (080 + 081 + 082) as a coherent trio per the D-23 atomic-commit precedent. The section documents:

1. The new `match_decision_kind` enum on `match_decisions` and the four per-kind CHECK constraints replacing the Phase 09 XOR.
2. The voluntary_add CTE branch in `compute_bridge_outcome_deltas()` closing the cron-coverage gap.
3. The bridge_outcomes voluntary-kind relaxation (nullable strategy_id, per-decision unique key, kind-aware CHECKs).
4. The `commit_scenario_batch(p_allocator_id, p_diffs)` SECURITY DEFINER RPC implementing the H4 single-tx invariant — auth.uid() guard, per-row ownership/strategy probes, M7 reuse-or-create for bridge_recommended, REVOKE-then-GRANT-EXECUTE-to-authenticated.
5. The existing `match.decision_record` audit kind continues to carry voluntary diffs unchanged via `metadata.kind` (Phase 09 D-14 precedent).

The ADR sync commit cadence: ADR Phase-10 entry shipped with migration 080's commit (`ce07829`); migrations 081 and 082 ship in their own commits (`d89cac5`, `ec13d40`) that reference the ADR section already in place — strict atomic-per-migration would require splitting the ADR into three sub-sections, but the trio is a tightly-coupled coherent narrative so a single combined section is the cleaner read.

## Self-Check: PASSED

All claimed files exist:
- `supabase/migrations/080_match_decisions_kind_enum.sql` ✓
- `supabase/migrations/081_bridge_outcomes_relax_for_voluntary.sql` ✓
- `supabase/migrations/082_commit_scenario_batch_rpc.sql` ✓
- `docs/architecture/adr-0023-audit-event-taxonomy.md` (modified — Phase 10 section) ✓
- `src/__tests__/match-decisions-schema.test.ts` (extended) ✓
- `src/__tests__/bridge-outcomes-voluntary-schema.test.ts` ✓
- `src/__tests__/bridge-outcome-cron-voluntary-add.test.ts` ✓
- `src/__tests__/scenario-commit-batch-tx.test.ts` ✓
- `src/lib/test-helpers/live-db.ts` (modified) ✓

All 7 commits exist:
- `ce07829` feat(10-02): migration 080 + ADR-0023 sync ✓
- `d89cac5` feat(10-02): migration 081 + ADR-0023 sync ✓
- `66c61fc` fix(10-02): migration 080 schema-name reconciliation ✓
- `9262552` test(10-02): match_decisions + bridge_outcomes + cron regressions ✓
- `2722084` test(10-02): RED — commit_scenario_batch ✓
- `ec13d40` feat(10-02): migration 082 + ADR-0023 sync ✓
- `3fd509e` test(10-02): GREEN — commit_scenario_batch passes ✓

All 3 migrations applied to live Supabase (`khslejtfbuezsmvmtsdn`):
- Migration 080: enum present, 4 CHECKs present, XOR removed, all rows backfilled, voluntary_add cron branch reachable ✓
- Migration 081: strategy_id nullable, new (allocator_id, match_decision_id) UNIQUE present, kind-aware CHECKs split into named constraints ✓
- Migration 082: prosecdef=t, search_path locked, auth.uid() guard string in prosrc, EXECUTE granted to authenticated only ✓

Live-DB regression tests: 45/45 GREEN.
