# PR-X5 Handover — Prereqs for PR-B (kill-switch flip) to succeed

**Created:** 2026-05-15
**Last touched:** 2026-05-15 (session 2 — pre-flight recon, scope re-scoped, framing corrected)
**Branch:** `prep/phase-19-pr-x5-teaser-on-process-key` (created off main @7dec6c48 after PR-X4a merged 2026-05-15T07:07Z — files on disk, no commits yet)
**Replaces:** the closed-unmerged PR-X4 (#160) walk-back.

## Framing correction (2026-05-15 session 2)

Earlier framing called PR-X5 "the missing PR-B from the unified path." That is wrong and conflates two things. The Phase 19 entry-gate doc (`19-01-entry-gate-docs-PLAN.md`) defines the **4-PR VIEW-shim sequence** for BACKBONE-04:

- **PR-A**: Repoint `verify-strategy/route.ts` writes from `verification_requests` → `strategy_verifications`. Migration 106 sentinel. Built and shipped.
- **PR-B**: Flip kill-switch `process_key_unified_backbone='on'`. Records `flag_flipped_at` in `.planning/phase-19/stability-log.md`. **Attempted twice on 2026-05-14, both auto-rolled-back** within minutes. Still pending a successful attempt.
- *(168h soak window after a successful PR-B)*
- **PR-D**: Migration 107 — rename `verification_requests` → `_legacy` + VIEW + INSTEAD OF triggers. Built and shipped.

PR-X5 is **not** PR-B. PR-X5 is the prereqs that unblock PR-B from auto-rolling-back. The two PR-B failures were caused by teaser submissions hitting `/process-key` and returning `MISSING_STRATEGY_ID` 422 — the unified backend had no story for teaser flow_type without a strategy_id. PR-X3 tried `step='validate'` as a workaround; it routed teaser into `_run_validate_only` which doesn't return `verification_id`, so the TS handler 502'd instead. PR-X4 tried to walk back the unified path entirely; wrong direction, closed.

**PR-X5 minimum set:** sentinel anchor strategy (migration 132) + one-line dispatch injection in `process_key.py` + universal `find_matched_strategy` call inside the unified pipeline + TS-side cleanup (strip `step='validate'`, use anchor constant). After PR-X5 lands and deploys, PR-B is then a tiny separate PR — flip the flag, record `flag_flipped_at`, watch the soak window.

The synchronous pipeline at `process_key.py:647-761` (validate → fetch → compute → state-machine walk → published) was already built. PR-X5 doesn't build the pipeline. It removes the two paper cuts that prevent teaser from using it.

## 2026-05-15 session 2 update — scope re-scoped after reading the code

**The synchronous pipeline is already built.** `analytics-service/routers/process_key.py:647-761` does the full state-machine walk (validate → validated → fetch → compute_metrics → metrics_captured → encrypt → encrypted → fingerprint write → report_queued → reconstruct_positions → published) for `flow_type ∈ {teaser, csv, internal_report}`. It returns `{verification_id, status:'published', metrics_snapshot, ...}`.

What's actually missing for teaser:

1. **Strategy_id gate** (line 502): teaser hits `/process-key` without a `strategy_id`, so it short-circuits at the `strategy_id is None` branch (returns 422 MISSING_STRATEGY_ID) before reaching line 647.
2. **Fingerprint write-back** (line 719-721) writes the caller's fingerprint onto `strategies` row — for a teaser flow anchored to a sentinel, every teaser submission would overwrite the sentinel. Cross-submission data leak.
3. **No `matched_strategy_id` correlation** — the existing pipeline computes `metrics_snapshot` but doesn't run the 95%-corr correlation against published strategies. The legacy `verify_strategy` at `portfolio.py:1024-1051` does. Teaser needs it (public-status page surfaces it).
4. **`adapter.reconstruct_positions(trades)`** (line 733) — BACKBONE-09 wiring for ongoing position tracking. Not applicable to teaser semantics.

**D6 (locked 2026-05-15 session 2): PR-X5 approach — Reuse + extract shared compute helpers.** Reuse the existing pipeline as the spine. Extract `find_matched_strategy(returns, supabase)` from `portfolio.py:1024-1051` into a shared service so both the legacy verify_strategy endpoint AND the teaser path call the same helper.

**D7 (locked 2026-05-15 session 2 — revision after the "unify the path" reminder): drop the flow_type guards. The backend is ONE path; the UI differs but the backend doesn't.** Earlier draft had `if body.flow_type != 'teaser':` guards around the fingerprint write (line 719-721) and `reconstruct_positions` (line 733). That's branching dressed up as unification. Revised plan:

- **Fingerprint write to `strategies.fingerprint`** — leave unguarded. Sentinel overwrites are harmless (no external reader of sentinel.fingerprint; teaser is rate-limited).
- **`adapter.reconstruct_positions(trades)`** — leave unguarded. The current call discards the return value (P8 persistence is downstream and not wired yet). Zero side effects for teaser today.
- **`find_matched_strategy` runs for ALL flow_types**, not just teaser. Insert the call between `compute_metrics` and the `metrics_captured` transition. Attach `matched_strategy_id` to `metrics_snapshot` so it flows through the existing transition payload. Onboard + csv also benefit (knowing a newly-onboarded strategy correlates 95%+ with an existing published one is useful regardless of flow).
- **Top-level response shape** — process_key.py returns `{matched_strategy_id, metrics_snapshot, ...}` at the top level for ALL flows, matching the legacy `verify_strategy` shape. Same contract from both endpoints.
- **Dispatch injection** is the only flow_type-specific code path: when `flow_type == 'teaser' and strategy_id is None`, set `strategy_id = TEASER_ANCHOR_STRATEGY_ID` and let the pipeline run unmodified.

Net effect: **zero `if flow_type ==/!= 'teaser':` branches in the unified backend.** The pipeline behaves identically for every flow_type. The only thing that differs is the input `strategy_id` (real strategy vs sentinel), which is a data difference, not a code branch. The UI surface (TS handler) does differ — public landing form vs wizard step — but the `/process-key` request shape is the same contract for everyone.

PR-X5 effective scope: ~25% of the original handover. No new helper. No guards. Pure unification.

## Schema pre-flight findings (2026-05-15 session 2)

Read `strategies` table NOT NULL columns from migrations 001, 012, 031:

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | PK — override with sentinel UUID in INSERT |
| `user_id` | UUID NOT NULL | none | **BLOCKER** — FK `REFERENCES profiles ON DELETE CASCADE`; profiles.id FK to `auth.users` |
| `name` | TEXT NOT NULL | none | Use `'phase-19-teaser-anchor'` |
| `strategy_types` | TEXT[] NOT NULL | `'{}'` | OK |
| `subtypes` | TEXT[] NOT NULL | `'{}'` | OK |
| `markets` | TEXT[] NOT NULL | `'{}'` | OK |
| `supported_exchanges` | TEXT[] NOT NULL | `'{}'` | OK |
| `status` | TEXT NOT NULL | `'draft'` | CHECK in `('draft','pending_review','published','archived')` — `'archived'` is valid ✓ |
| `is_example` | BOOLEAN NOT NULL | `false` | OK |
| `benchmark` | TEXT NOT NULL | `'BTC'` | OK |
| `created_at` | TIMESTAMPTZ NOT NULL | `now()` | OK |
| `disclosure_tier` | TEXT NOT NULL | `'exploratory'` (from 012) | OK (default works) |
| `source` | TEXT NOT NULL | `'legacy'` (from 031) | OK (default works) — or override to `'system'`/`'phase-19'` if there's a CHECK |

**No `updated_at` column on `strategies`.** Strip from the handover's draft INSERT.

**The `user_id` sentinel problem.** No existing system/sentinel profile or auth.users row. Migration 062 has a *temporary* sentinel-user precedent (created mid-DO-block, deleted at end). No *permanent* sentinel precedent. Three candidate resolutions, all need a decision before migration 132 is written:

- **(a) Seed both `auth.users` and `profiles` for `00000000-0000-0000-0000-000000000000`** in migration 132. Pros: keeps the all-zeros owner from the handover; sentinel is permanent and self-contained. Cons: writing to `auth.users` from a regular migration is unusual (Supabase Auth owns that schema); migration becomes touchier across environments.

- **(b) Use an existing admin profile as the sentinel owner.** Pros: no auth.users edits. Cons: that admin's `auth.uid()` would match the owner-select RLS policy — the admin would see every teaser SV row in their dashboard (privacy leak in reverse — admin sees everything).

- **(c) Add a partial RLS bypass via a `is_sentinel` boolean** on `strategies` and policy update. Pros: clean conceptual separation. Cons: scope creep — touches the strategies RLS surface; harder to audit; reuses existing all-zeros pattern from migration 062 but flips it from temporary to permanent.

Recommendation pending user decision: probably (a). The migration 132 + a tiny one-row seed in `auth.users` is the cleanest. Easy down-migration. The all-zeros UUID never matches `auth.uid()` for real users.

## Why this PR exists (original handover — keep for context; see scope re-scope above)

Phase 19's `19-04-process-key-router-PLAN.md:19` promised:

> `flow_type ∈ {teaser, onboard, internal_report, csv, resync}` … **teaser/csv/internal_report run synchronously**

The `/process-key` implementation never built the teaser-specific branch. The dispatch at `analytics-service/routers/process_key.py:503-575` has three no-`strategy_id` branches:

1. `step='validate'` → `_run_validate_only` (no persist, no `verification_id`)
2. `flow_type='csv' AND step='finalize'` → `finalize_csv_strategy` RPC (returns `strategy_id`, not `verification_id`)
3. else → 422 `MISSING_STRATEGY_ID`

None of these match the teaser semantics: "validate keys → fetch trades → compute metrics → persist a verification row → return `verification_id`."

Two abortive kill-switch flip attempts on 2026-05-14 (3m43s and 1m33s on-time) confirmed the gap:
- PR-X3 added `step='validate'` to clear the 422 → routed teaser into branch 1 → no `verification_id` → TS handler 502 "Verification service returned an invalid response."
- The unified handler at `src/app/api/verify-strategy/route.ts:113-122` hard-requires `verification_id`.

PR-X5 builds the missing branch.

## Sequence context (where things stand)

| PR | Title | State | What it did |
|---|---|---|---|
| #145 | PR-X1 — M-5 preflight relax | ✅ MERGED 2026-05-12 | Narrowed migration 107 M-5 preflight to `WHERE flow_type<>'teaser' AND public_token IS NOT NULL`. Live prod count: 0. |
| #146 | PR-X2 — Python VR writes removed | ✅ MERGED 2026-05-12 | Removed `verification_requests` INSERT/UPDATE from `analytics-service/routers/portfolio.py`'s `verify_strategy`. Endpoint generates `verification_id` locally via `uuid.uuid4()`; returns `results` + `matched_strategy_id`. |
| #159 | PR-X3 — teaser context step=validate | ✅ MERGED 2026-05-14 | 1-line TS fix: `context: { ...body, step: "validate" }`. Got past `MISSING_STRATEGY_ID` but exposed deeper bug. |
| ~~#160~~ | ~~PR-X4 — walk back unified for teaser~~ | 🔒 CLOSED unmerged | Wrong direction. User correctly framed it as missing build-out, not walk-back. |
| **#161** | PR-X4a — legacy SV terminal+metrics | 📬 OPEN (pragma-fix pushed, CI re-running) | Small safety net for the rollback target. Fixes the pre-existing "metrics never reach SV" bug on the legacy path. `status='validated'` → `'published'` + `metrics_snapshot` from Python `results`. |
| **PR-X5 (this)** | Build teaser branch in /process-key | 📋 not started | The real fix. |

**Production state**: kill-switch (`feature_flags.process_key_unified_backbone.value`) is `off`, last touched 2026-05-14T19:57:14Z (auto-rollback from the second abortive flip). Vercel env `PROCESS_KEY_UNIFIED_BACKBONE=on` + `PHASE_19_STABILITY_CACHE_TTL_S=5` still set. Railway env same. Both surfaces deployed on the latest main. `flag_flipped_at` in `.planning/phase-19/stability-log.md` is still `TODO` — the 168h soak window has NOT started.

## Locked design decisions (from the 2026-05-15 conversation)

These were settled via AskUserQuestion. Don't relitigate; build to them.

**D1 — PR-X4 fate**: closed unmerged with a comment explaining the walk-back was wrong direction.

**D2 — PR-X5 scope**: single end-to-end PR. The compute helpers exist already (legacy `verify_strategy` endpoint, post-PR-X2 against memory only). Refactor extracts them into shared code.

**D3 — Teaser FK anchor**: **sentinel `teaser-anchor` strategy + migration**. Provision a singleton via migration 132 (or next slot). Deterministic UUID, owned by a system pseudo-user (`00000000-0000-0000-0000-000000000000` — no auth.uid() ever matches, so the owner-select RLS policy never returns it). Admin-only SELECT, archived/private visibility. Replaces the documented privacy-leak hack ("most recent strategies row") that migration 107's DM-3 commentary called out.

**D4 — State-machine walk**: walk through all 6 states sequentially via the `transition_strategy_verification` RPC: `draft → validated → metrics_captured → encrypted → report_queued → published`. ~5 RPC roundtrips, ~50ms latency tax on a 1-5s exchange API flow — acceptable. Keeps the state machine's hard-coded legal-pair table intact; no RPC changes needed.

**D5 — TS anchor cleanup**: clean up in PR-X5 (don't defer). Add a shared `TEASER_ANCHOR_STRATEGY_ID` constant (TS in `src/lib/phase-19-constants.ts`, Python in `analytics-service/services/teaser_anchor.py` or similar). The TS legacy handler swaps `most recent strategies` SELECT → the constant. Removes the privacy concern globally in one PR.

## File-by-file plan

### 1. `supabase/migrations/132_teaser_anchor_strategy.sql` (new)

Provision the sentinel `teaser-anchor` strategy. Suggested shape:

```sql
-- Migration 132: Phase 19 / PR-X5 — teaser-anchor sentinel strategy.
--
-- The teaser flow (POST /api/verify-strategy from the public landing page)
-- creates a strategy_verifications row when the user submits exchange keys
-- for verification. strategy_verifications.strategy_id is NOT NULL FK to
-- strategies(id), but the teaser user has no caller-owned strategy by
-- design (they're probing keys against the universe of existing
-- strategies; no strategy exists yet). Migration 107's DM-3 commentary
-- flagged the existing 'most recent strategies row' anchor hack as a
-- privacy concern (the SV row inherits the random strategy's RLS user_id).
--
-- This migration provisions a singleton sentinel strategy that all
-- teaser SV rows anchor to. Owned by the all-zeros system UUID so
-- auth.uid() never matches; admin-only SELECT policy; archived status
-- so it never surfaces in marketplace / allocator dashboards.
--
-- PR-X5 picks this row up by deterministic UUID:
--   src/lib/phase-19-constants.ts             : TEASER_ANCHOR_STRATEGY_ID
--   analytics-service/services/teaser_anchor.py : TEASER_ANCHOR_STRATEGY_ID
-- Both refer to '00000000-0000-0000-0000-000000000001' (or chosen value
-- below). Keep these in sync.

BEGIN;
SET lock_timeout = '3s';

-- Deterministic UUID for grep-ability and idempotency.
INSERT INTO public.strategies (
    id,
    user_id,
    name,
    status,
    -- include other NOT NULL columns from the migration 010 + later ALTERs
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'phase-19-teaser-anchor',
    'archived',  -- TODO: verify this is a valid status value
    now(),
    now()
)
ON CONFLICT (id) DO NOTHING;

-- Self-verify the row landed.
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.strategies
     WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
  ) THEN
    RAISE EXCEPTION 'Migration 132: teaser-anchor sentinel row missing post-INSERT';
  END IF;
  RAISE NOTICE 'Migration 132: teaser-anchor strategy provisioned.';
END $$;

COMMIT;
```

**Caveat**: this PR was paused before I could read the full `strategies` schema. Before writing the migration, confirm:
- Which columns on `strategies` are NOT NULL beyond the ones in migration 010? Migrations to check: 006, 012, 014, 016, 031, 100, 101, 105.
- What's the valid `status` value for "never surface to users"? Check the strategies status CHECK constraint. `'archived'` is a guess. If invalid, may need `'pending_review'` or a new enum value.
- Does `strategies` have `visibility` or `is_public` columns? Set them appropriately so the row stays admin-only.
- Are there any RLS policies on `strategies` that would block a service-role INSERT? Service-role bypasses RLS by default, so probably no, but verify.

Down migration: `down/132-rollback.sql` — `DELETE FROM strategies WHERE id = '00000000-0000-0000-0000-000000000001'`.

### 2. `src/lib/phase-19-constants.ts` (new)

```typescript
/**
 * Phase 19 / PR-X5 — shared constants for the teaser flow.
 */

/**
 * Sentinel strategy_id for the teaser flow's strategy_verifications rows.
 * Provisioned by supabase/migrations/132_teaser_anchor_strategy.sql.
 *
 * The teaser submission has no caller-owned strategy by design (the user
 * is probing keys against the universe of strategies; no strategy exists
 * yet). This sentinel satisfies the strategy_verifications.strategy_id
 * NOT NULL FK constraint without the documented privacy leak that the
 * 'most recent strategies row' hack carried (migration 107 DM-3 comment).
 *
 * Owned by the all-zeros system UUID so auth.uid() never matches.
 * Admin-only RLS. Never appears in marketplace / allocator queries.
 *
 * Keep in sync with analytics-service/services/teaser_anchor.py.
 */
export const TEASER_ANCHOR_STRATEGY_ID =
  "00000000-0000-0000-0000-000000000001" as const;
```

### 3. `analytics-service/services/teaser_anchor.py` (new)

```python
"""Phase 19 / PR-X5 — shared constants for the teaser flow.

Mirrors src/lib/phase-19-constants.ts. Keep both in sync.
"""

# Sentinel strategy_id provisioned by migration 132.
# See src/lib/phase-19-constants.ts for the full rationale.
TEASER_ANCHOR_STRATEGY_ID = "00000000-0000-0000-0000-000000000001"
```

### 4. `analytics-service/routers/process_key.py` (modify)

Add a new dispatch branch + helper. The branch fires BEFORE the existing `step='validate'` check so PR-X3's `step='validate'` no-ops out for teaser.

```python
# ABOVE the existing `if strategy_id is None:` block at line ~491:
if body.flow_type == "teaser":
    # Phase 19 / PR-X5 — teaser flow runs the full compute pipeline
    # synchronously and writes a terminal strategy_verifications row
    # anchored to the sentinel teaser-anchor strategy (migration 132).
    return await _run_teaser_full_pipeline(
        body=body,
        correlation_id=correlation_id,
        started_at=started_at,
        supabase=supabase,
    )

# Existing dispatch unchanged from here:
step = body.context.get("step")
strategy_id = body.context.get("strategy_id")
if strategy_id is None:
    if step == "validate":
        return await _run_validate_only(...)
    ...
```

Helper signature:

```python
async def _run_teaser_full_pipeline(
    *,
    body: "_ProcessKeyBody",
    correlation_id: str,
    started_at: float,
    supabase,
) -> dict:
    """Teaser flow: validate keys + fetch trades + compute metrics +
    persist SV row + walk state machine to 'published' + return
    verification_id + results + matched_strategy_id.

    Mirrors the post-PR-X2 legacy verify_strategy endpoint behavior but
    writes the SV row instead of just returning metrics. Shares the
    compute helpers extracted from portfolio.py.
    """
    # 1. KEK + encrypt credentials
    # 2. adapter.validate (key permissions) → reject 400 on failure
    # 3. adapter.fetch_raw (trades + balance) → reject 400 on insufficient history
    # 4. adapter.compute_metrics → twr, sharpe, period_returns, equity_curve
    # 5. Correlation match against published strategies → matched_strategy_id
    # 6. INSERT strategy_verifications with:
    #      - id: uuid.uuid4()
    #      - strategy_id: TEASER_ANCHOR_STRATEGY_ID
    #      - wizard_session_id: uuid.uuid4()  (idempotency not meaningful for teaser)
    #      - status: 'draft'
    #      - trust_tier: 'self_reported'
    #      - flow_type: 'teaser'
    #      - source: body.source (exchange)
    #      - encrypted_credentials: from step 1
    #      - correlation_id: correlation_id
    # 7. Walk state machine via transition_strategy_verification RPC:
    #      draft → validated (after step 2 success)
    #      validated → metrics_captured (with metadata.metrics_snapshot = results)
    #      metrics_captured → encrypted (no-op metadata)
    #      encrypted → report_queued (no-op metadata)
    #      report_queued → published
    # 8. Return:
    #      {
    #        "ok": True,
    #        "verification_id": <uuid>,
    #        "results": <metrics blob>,
    #        "matched_strategy_id": <uuid or None>,
    #        "status": "published",
    #        "correlation_id": correlation_id,
    #      }
```

**Shared compute helpers** (extract from `analytics-service/routers/portfolio.py:937` legacy `verify_strategy`):
- `validate_key_permissions` — already in `services/exchange.py`
- `fetch_all_trades` / `fetch_usdt_balance` — already in `services/exchange.py`
- `trades_to_daily_returns` — already in `services/transforms.py`
- `compute_period_returns` / `compute_twr` — already in `services/portfolio_metrics.py`
- `sanitize_metrics` — already in `services/metrics.py`
- **NEW**: extract the correlation-match block (portfolio.py:1021-1050) into `services/strategy_matching.py::find_matched_strategy(returns, supabase)` so both `_run_teaser_full_pipeline` AND legacy `verify_strategy` call it.

### 5. `analytics-service/routers/portfolio.py` (refactor)

The legacy `verify_strategy` endpoint stays (rollback target). Refactor its body to call the same shared helpers as `_run_teaser_full_pipeline` so they don't drift. Specifically:
- Use the new `services/strategy_matching.find_matched_strategy` helper for the correlation block.
- Behavior unchanged — just deduplicated.

### 6. `src/app/api/verify-strategy/route.ts` (modify)

**Strip the now-redundant `step: "validate"` from PR-X3** (PR-X5's new teaser branch in `/process-key` fires before the step check). New unified handler context:

```typescript
const result = await postProcessKey({
    flow_type: "teaser",
    source: exchange,
    // PR-X5: the /process-key teaser branch (process_key.py:_run_teaser_full_pipeline)
    // dispatches on flow_type='teaser' BEFORE the step check, so the
    // PR-X3 step='validate' workaround is no longer needed (and would
    // route to _run_validate_only which doesn't return verification_id).
    context: { ...body },
    routeTag: "verify-strategy",
    userId: "public",
});
```

The unified path now expects /process-key to return `{ok, verification_id, results, matched_strategy_id, status='published', correlation_id}`. The TS handler:
- Mints `public_token` + `expires_at` (existing CT-3 logic)
- UPDATE `strategy_verifications` to add `public_token` + `expires_at` (existing)
- Returns `{...upstream, verification_id, public_token, expires_at}` to the landing page (existing)

**TS legacy handler cleanup** (also in this PR per D5): replace the "most recent strategies row" SELECT at `route.ts:251-254` with:

```typescript
import { TEASER_ANCHOR_STRATEGY_ID } from "@/lib/phase-19-constants";

// Was: const { data: anchorStrategy } = await admin.from("strategies")...
// Now:
const { error: upsertError } = await admin
    .from("strategy_verifications")
    .upsert(
      {
        id: verificationId,
        strategy_id: TEASER_ANCHOR_STRATEGY_ID,
        wizard_session_id: crypto.randomUUID(),
        status: "published",
        trust_tier: "self_reported",
        flow_type: "teaser",
        source: exchange,
        public_token: publicToken,
        expires_at: expiresAt,
        metrics_snapshot: metricsSnapshot,  // from PR-X4a
      },
      { onConflict: "id" },
    );
```

The legacy handler no longer needs the strategiesAnchorReturned mock variable in tests — it's gone.

### 7. Tests

#### `tests/integration/process-key-thin-adapters.test.ts`

Restore the 4 deleted unified-path tests (the ones removed by PR-X4):
- `verify-strategy: flow_type=teaser, source from body.exchange`
- `verify-strategy unified path forwards X-User-Id='public' (CT-4)`
- `verify-strategy unified path mints public_token + expires_at (CT-3)`
- `I-T3a: verify-strategy missing token → 503, no /process-key call`

The PR-X3 test (`teaser context forwards step='validate'`) should be **deleted permanently** — PR-X5 strips the `step='validate'` from the context. Replace with a new test asserting the context does NOT include `step` for teaser:

```typescript
it("verify-strategy: teaser context does NOT include step='validate' (PR-X5)", async () => {
  // PR-X5 stripped the step='validate' because the new /process-key
  // teaser branch dispatches on flow_type='teaser' before the step
  // check. Sending step='validate' would route to _run_validate_only
  // which doesn't return verification_id.
  vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
  const { POST } = await import("@/app/api/verify-strategy/route");
  await POST(jsonReq("/api/verify-strategy", { email: "...", exchange: "okx", api_key: "k", api_secret: "s" }));
  const call = findProcessKeyCall();
  const body = parseFetchBody(call);
  const context = body!.context as Record<string, unknown>;
  expect(context.step).toBeUndefined();
});
```

#### `analytics-service/tests/test_process_key.py`

New test for the teaser branch end-to-end. Pattern: mock the IngestionAdapter Protocol, hit /process-key with `flow_type=teaser`, assert:
- 200 response with `{ok: true, verification_id, results, matched_strategy_id, status: 'published'}`
- strategy_verifications INSERT was called with `strategy_id=TEASER_ANCHOR_STRATEGY_ID`
- The 5 `transition_strategy_verification` RPC calls fired in order
- No `verification_requests` INSERT/UPDATE (post-PR-X2 invariant)

#### `analytics-service/tests/test_migration_132.py`

Static-AST test: read the migration file, assert it INSERTs the sentinel strategy_id `00000000-0000-0000-0000-000000000001` with the system user_id `00000000-0000-0000-0000-000000000000`. Same pattern as `test_legacy_table_rls.py` (already in the repo).

#### `tests/integration/phase-19-pra-write.test.ts`

The mock `strategiesAnchorReturned` variable goes away. Update the SV upsert assertion to expect `strategy_id: TEASER_ANCHOR_STRATEGY_ID` (the constant) instead of the dynamic `ANCHOR_STRATEGY_ID` test-only UUID.

## Deferred / out of scope for PR-X5

- **`analytics-service/routers/portfolio.py` legacy verify_strategy removal** — keep it as the rollback target. Remove in a follow-up PR ~30 days after PR-D's stability window proves unified is healthy.
- **Email-based rate limit on the TS legacy handler** — already a no-op post-PR-D (the VR VIEW maps email to NULL). Don't touch in PR-X5; clean up alongside the legacy handler removal.
- **Sentinel strategy on test environments** — migration 132 runs on `qmnijlgmdhviwzwfyzlc` (test) and `khslejtfbuezsmvmtsdn` (prod) via `supabase db push` once PR-X5 ships. No special test-only fixture needed; the migration is idempotent (`ON CONFLICT (id) DO NOTHING`).

## Pre-flight before starting PR-X5

1. Confirm PR-X4a (#161) is merged. If not, merge it first.
2. Confirm both surfaces (Vercel + Railway) auto-deployed the merge.
3. Read the strategies schema fully before writing migration 132. Specifically check:
   - All NOT NULL columns (mig 010, 012, 014, 016, 031, 100, 101, 105)
   - Status enum values (the CHECK constraint)
   - RLS policies that might block a service-role INSERT
4. Read `analytics-service/routers/process_key.py:1-200` for the imports, `_envelope_error`, `_verify_internal_token`, `is_unified_backbone_active`, audit-log RPC pattern — the new helper needs to mirror these.

## After PR-X5 lands + deploys: kill-switch flip re-attempt

This is the moment of truth. Sequence:

1. `vercel ls quantalyze --scope ai-isaiahs-projects --prod` → confirm latest deploy is PR-X5's merge commit.
2. `railway status --json` → confirm Railway is on the same commit.
3. **With kill-switch still OFF**: `curl -X POST https://quantalyze-rho.vercel.app/api/verify-strategy ... -d '{"email":"...", "exchange":"okx", "api_key":"smoke", "api_secret":"smoke"}'` → expect 502 with legacy `{"error":"Authentication failed..."}` envelope. Confirms no regression on the legacy path.
4. Flip Supabase: `UPDATE feature_flags SET value='on', updated_at=now(), updated_by='phase-19-pr-b-flag-flip-2026-05-XX-attempt-3-post-pr-x5' WHERE flag_key='process_key_unified_backbone';`
5. Wait 8s (5s cache TTL + slack).
6. Smoke-test with bogus creds: `curl POST /api/verify-strategy ...` → expect unified envelope shape `{ok: false, code, human_message, ...}` with `code` NOT `MISSING_STRATEGY_ID` and NOT `INVALID_RESPONSE`. The expected error is whatever the Python `validate_key_permissions` returns for bogus creds (probably `INVALID_API_KEY` or similar — see `services/exchange.py`).
7. **Only if step 6 passes**, record `flag_flipped_at: 2026-05-XXTHH:MM:SSZ` in `.planning/phase-19/stability-log.md` and start the 168h soak clock.
8. If step 6 fails: flip Supabase row back to `off`, debug, write PR-X6.

## Notes from the 2026-05-15 session

- The `.planning/STATE.md` UU is pre-existing (from an old unfinished merge). Resolving with `git checkout HEAD -- .planning/STATE.md` is a content no-op — just clears the conflict marker. Do this once before any commit on the PR-X5 branch.
- The `tests/cassettes/` untracked directory is also leftover from old runs; ignore it.
- The audit-coverage grep gate at `src/__tests__/audit-coverage.test.ts:562` requires `@audit-skip` pragmas to sit within 8 lines of their mutation. PR-X4a's first commit failed this; the fix was to hoist the explanation block ABOVE the pragma. Apply the same pattern when adding the `metrics_snapshot` line to the unified handler (or any other new audit-skip-needing mutation in PR-X5).
- `.planning/` is in `.gitignore` but `stability-log.md` and this file are already tracked (early adds before the gitignore). They'll commit fine with `git add` by name.
- The Python `verifyStrategy()` response schema uses `.passthrough()` so adding new fields to the Python response is backward-compatible at the TS parse layer. Confirmed in `src/lib/analytics-schemas.ts`.
- The `[id]/status` route at `verify-strategy/[id]/status/route.ts:107` already accepts both `'complete'` (legacy VR shape) and `'published'` (canonical SV terminal). PR-X5 doesn't need to touch it.

## Final pre-merge checklist for PR-X5

- [ ] Migration 132 ships with `down/132-rollback.sql`
- [ ] Migration 132 self-verify DO block asserts the sentinel row exists
- [ ] Migration 132 applies cleanly against `qmnijlgmdhviwzwfyzlc` (test) and `khslejtfbuezsmvmtsdn` (prod) — dry-run with `--dry-run` flag if Supabase CLI supports it, else stage on test first
- [ ] `TEASER_ANCHOR_STRATEGY_ID` constant exists in both `src/lib/phase-19-constants.ts` and `analytics-service/services/teaser_anchor.py` and matches the migration's INSERT
- [ ] `_run_teaser_full_pipeline` walks all 5 state-machine transitions
- [ ] The legacy `verify_strategy` endpoint in `portfolio.py` shares compute helpers with `_run_teaser_full_pipeline` (no logic duplication)
- [ ] TS unified handler strips `step: 'validate'`
- [ ] TS legacy handler uses `TEASER_ANCHOR_STRATEGY_ID` constant instead of "most recent strategies" SELECT
- [ ] All 4 deleted unified-path tests restored in `process-key-thin-adapters.test.ts` with updated assertions
- [ ] Old PR-X3 `step='validate'` test replaced with the inverse "does NOT include step" test
- [ ] `test_process_key.py` has a new end-to-end teaser test
- [ ] `test_migration_132.py` static-asserts the sentinel INSERT
- [ ] `phase-19-pra-write.test.ts` updated to use `TEASER_ANCHOR_STRATEGY_ID`
- [ ] `audit-coverage.test.ts` passes — all new mutations have `@audit-skip` within 8 lines
- [ ] `npm run typecheck` clean
- [ ] Python `pytest analytics-service/tests/` clean
- [ ] CHANGELOG entry written
- [ ] VERSION bumped to whatever the next slot is at PR creation time
- [ ] PR description includes the re-attempt smoke sequence from above
