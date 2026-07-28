# Phase 96: Draft & Key Hygiene + Onboarding Polish — Research

**Researched:** 2026-07-12
**Domain:** Postgres data-deletion crons (Vercel Cron + SECURITY DEFINER RPC), FK-topology safety, React icon map, client→server correlation-id threading
**Confidence:** HIGH (all claims verified against repo source; no external packages)

> No `CONTEXT.md` exists for this phase yet (discuss step has not run). This research is unconstrained by locked decisions — everything below is `[VERIFIED: repo source]` or `[ASSUMED]` and flagged for the planner / discuss-phase.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLEAN-01 (#35) | Cron ATOMICALLY deletes stale wizard drafts (`source='wizard' AND status='draft' AND created_at < now()-24h`) as a SINGLE DELETE — no SELECT-then-DELETE race with concurrent finalize. Race semantics test-pinned. | Existing `/api/cron/cleanup-wizard-drafts` route (currently SELECT-then-DELETE, 30-day window) + `finalize_wizard_strategy` RPC's `FOR UPDATE`/`status='draft'` guard. Single atomic DELETE + Postgres READ-COMMITTED EPQ re-check is the proof. |
| CLEAN-02 (#36) | AFTER draft cleanup, `api_keys` sweep removes rows not referenced by any surviving strategy. 3 hard safety constraints (sanitize GUC exemption, published-composite guard, BOTH `strategies.api_key_id` + `strategy_keys.api_key_id`). | Full FK topology mapped (7 referencing tables). Existing `delete_api_key_if_unreferenced` RPC is **INCOMPLETE** (checks only `strategies`, not `strategy_keys`). Correct predicate written out below. |
| UX-01 (#6) | Deribit keys render the Deribit icon in `ApiKeyManager`, not "?". | Root cause: `ApiKeyManager.tsx:290` local `exchangeIcon` map lacks a `deribit` key → `?? "?"` fallback at L347. |
| UX-02 (#30) | Wizard fetches include an `X-Correlation-Id` header so a user-copied correlation id matches the server-side id in logs. | Full correlation infrastructure exists (`src/lib/correlation-id.ts` `server-only`, `getCorrelationId()` already prefers inbound header). Gap: client wizard fetches never SEND the header. |
</phase_requirements>

## Summary

This phase is **two DB-hygiene crons that delete rows** plus **two small onboarding UI polish items**. The danger is concentrated entirely in **CLEAN-02**: `api_keys` is referenced by **seven** FKs with mixed `ON DELETE` behaviour (SET NULL / CASCADE / RESTRICT), and migrations **auto-apply to prod on the milestone merge** ([VERIFIED: `project_supabase_migrate_auto_on_push`, ci `supabase-migrate`]). A naive "delete every unreferenced key" sweep will either **abort** (an `allocator_holdings` key is `ON DELETE RESTRICT` → 23503 kills the whole statement) or **silently cascade** live per-key data (`csv_daily_returns`, `compute_jobs`). The requirement's own definition of "orphaned" (only `strategies` + `strategy_keys`) is **necessary but not sufficient** for a safe DELETE — the predicate must additionally exclude `allocator_holdings` references to be provably non-aborting.

CLEAN-01 is well-scaffolded: a Vercel Cron route already exists (`/api/cron/cleanup-wizard-drafts`), and the finalize path already flips `draft→pending_review` under a `SELECT … FOR UPDATE` row lock with a `status='draft'` guard. Converting the route's current SELECT-then-DELETE into a **single atomic `DELETE … WHERE status='draft' … RETURNING`** makes the finalize race provably corruption-free via Postgres READ-COMMITTED EvalPlanQual (EPQ) re-check.

UX-01 and UX-02 are low-risk: a one-line icon-map entry and threading a client-generated `X-Correlation-Id` header into the existing (already inbound-aware) server correlation pipeline.

**Primary recommendation:** Ship CLEAN-01 + CLEAN-02 as **one atomic `SECURITY DEFINER` RPC** (`cleanup_abandoned_wizard_drafts()`) invoked from the **existing Vercel Cron route** (keep its `CRON_SECRET` auth + schedule precedent). The RPC does the draft DELETE and the key sweep in one transaction with a **conservative, reference-complete predicate** (both `strategies` + `strategy_keys`, plus an `allocator_holdings` exclusion to avoid the RESTRICT abort). Scope the key sweep to **keys formerly attached to the just-deleted drafts** (single-key `api_key_id` ∪ composite `strategy_keys` member ids) — a full "all orphaned keys" sweep additionally nukes freshly-added-but-unattached keys mid-onboarding and must be gated behind an age threshold if chosen.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stale-draft delete (CLEAN-01) | Database (atomic DELETE / RPC) | Vercel Cron route (scheduler + auth) | The atomicity/race guarantee is a DB property (row locks, EPQ). The route only authenticates + schedules. |
| Orphaned-key sweep (CLEAN-02) | Database (SECURITY DEFINER RPC + BEFORE DELETE guard trigger) | Vercel Cron route | Reference-completeness + guard interplay are DB-layer; must fire for service-role writers (BYPASSRLS skips RLS, not triggers). |
| Deribit icon (UX-01) | Browser / Client (React) | — | Pure client render map in `ApiKeyManager.tsx`. |
| Correlation-id threading (UX-02) | Browser / Client (generate + send header) | API routes (read inbound via `getCorrelationId()`) | Client owns id generation per wizard session; server already prefers the inbound header. |

## Standard Stack

**No new external packages.** This phase uses only in-repo primitives:

| Tool | Where | Purpose |
|------|-------|---------|
| Vercel Cron | `vercel.json` `crons[]` | Schedules `/api/cron/cleanup-wizard-drafts` (already registered, `0 2 * * 0`) [VERIFIED: `vercel.json`] |
| `CRON_SECRET` Bearer + `safeCompare` | `src/lib/timing-safe-compare` | Cron auth precedent [VERIFIED: `cleanup-wizard-drafts/route.ts:42-46`] |
| `createAdminClient()` | `@/lib/supabase/admin` | service_role client for the cron [VERIFIED] |
| SECURITY DEFINER plpgsql RPC | `supabase/migrations/*` | Atomic single-transaction delete+sweep |
| `crypto.randomUUID()` | browser global (Node/Vercel runtime) | Client correlation id [VERIFIED: pattern in `correlation-id.ts:22`] |

## Package Legitimacy Audit

**Not applicable** — this phase installs **zero** external packages. All work is in-repo TypeScript + SQL. No `npm install` / `pip install` step exists in scope.

## Where CLEAN-01 / CLEAN-02 Crons Live (precedent + auth)

There are **two** cron precedents in this repo:

1. **Vercel Cron → Next.js route** — `src/app/api/cron/*` dispatched by `vercel.json` `crons[]`, authed with `Bearer ${CRON_SECRET}` (timing-safe). The **existing wizard-draft cleanup already uses this** (`/api/cron/cleanup-wizard-drafts`, schedule `0 2 * * 0`). [VERIFIED: `vercel.json`, `cleanup-wizard-drafts/route.ts`]
2. **pg_cron (in-database)** — `supabase/migrations/20260417110539_retention_crons.sql` registers 6 `cron.schedule(...)` jobs (audit archive, retention deletes) that run as the `postgres` superuser (bypasses RLS + REVOKEs). [VERIFIED]

**Recommendation: keep the Vercel Cron route** (`/api/cron/cleanup-wizard-drafts`) as the entry point — it is the direct precedent, already authed, already scheduled, and Vercel surfaces run failures (a non-2xx marks the run FAILED and alerts). **But move the delete+sweep body into a single SECURITY DEFINER RPC** so the whole operation is one transaction (atomic + snapshot-consistent), then have the route just `await admin.rpc('cleanup_abandoned_wizard_drafts')` and report counts. The RPC ships via a migration (auto-applied to prod on merge). This gives Vercel's observability AND DB-level atomicity. pg_cron is the fallback if the team prefers no HTTP entry point, but it loses Vercel's failure alerting and can't be manually POST-triggered for incident response (which the current route supports at `POST`).

**Auth (unchanged):** `Bearer ${CRON_SECRET}` via `safeCompare`; GET (Vercel) + POST (manual). [VERIFIED: `cleanup-wizard-drafts/route.ts:30-31,42-46,174-175`]

⚠️ **Window + schedule discrepancy (planner must reconcile):** The existing route uses `ABANDON_DAYS = 30` and a **weekly** schedule (`0 2 * * 0`). CLEAN-01 specifies **24h**. A 24h cutoff on a weekly cron means drafts live up to 7 days regardless. If 24h is the intent, the **schedule must move to daily** (`0 2 * * *`). See Pitfall 2 for the resumability tension this creates. `[ASSUMED]` that daily is desired — confirm in discuss.

## CLEAN-01: the exact atomic single-DELETE + race proof

### The transition being raced against

`finalize_wizard_strategy` (the finalize RPC) promotes `draft → pending_review` under a **row lock**: [VERIFIED: `20260521185008_wizard_finalize_inserts_verification.sql:77-121`]

```sql
-- inside finalize_wizard_strategy(p_strategy_id, p_user_id, …)
SELECT status, source, user_id, api_key_id
  INTO v_current_status, …
  FROM strategies
  WHERE id = p_strategy_id
  FOR UPDATE;                              -- (1) locks the row
IF v_current_status IS NULL THEN
  RAISE EXCEPTION 'strategy % not found';  -- (2) row gone → clean fail (SQLSTATE P0002/02000 → 404 GATE_DRAFT_GONE)
IF v_current_status <> 'draft' THEN
  RAISE EXCEPTION '… status=% (expected draft)' USING …;  -- SQLSTATE 22023 → 409
UPDATE strategies SET … status = 'pending_review' WHERE id = p_strategy_id;
```

The route maps `P0002/02000 → 404 {code:"GATE_DRAFT_GONE"}` and `22023 → 409 {code:"draft_state_invalid"}` [VERIFIED: `finalize-wizard/route.ts:737-767`]. The unified-backbone path also lands the strategy at `pending_review` [VERIFIED: `finalize-wizard/route.ts:995,1170-1182`].

### The atomic single-DELETE (replaces the current SELECT-then-DELETE)

**Today** the route does a `SELECT id, api_key_id …` then a separate `.delete()` (with a belt-and-suspenders re-filter) [VERIFIED: `cleanup-wizard-drafts/route.ts:55-108`]. CLEAN-01 collapses this to ONE statement whose `RETURNING` also feeds the key sweep:

```sql
DELETE FROM strategies
 WHERE source = 'wizard'
   AND status = 'draft'                       -- load-bearing: EPQ re-checks this on a concurrent UPDATE
   AND review_note IS NULL                    -- M-0255 carry-forward: NEVER delete rejected drafts (see Pitfall 3)
   AND created_at < (now() - interval '24 hours')
 RETURNING id, api_key_id;                    -- api_key_id feeds the single-key arm of the sweep
```

(In supabase-js: `admin.from('strategies').delete().eq('source','wizard').eq('status','draft').is('review_note',null).lt('created_at',cutoff).select('id, api_key_id')` — `.select()` after `.delete()` returns the deleted rows atomically. Prefer the RPC form so composite member ids can be captured in the same transaction — see CLEAN-02.)

### Why it provably cannot delete a row mid-finalize (READ COMMITTED EvalPlanQual)

Two transactions contend for the same draft row; Postgres serializes them on the row lock and re-evaluates the predicate against the latest committed tuple (EvalPlanQual):

| Ordering | What happens | Outcome |
|----------|--------------|---------|
| **Finalize commits first** | `UPDATE … status='pending_review'` commits. The cron's `DELETE … WHERE status='draft'` was blocked on the row lock; on unblock, EPQ re-fetches the tuple, sees `status='pending_review'`, predicate **no longer matches** → row **skipped**. | Draft safely promoted; cron does not touch it. **Finalize wins.** |
| **Cron commits first** | `DELETE` removes the row + cascades (`strategy_analytics`, `trades`, `strategy_keys`). Finalize's `SELECT … FOR UPDATE` then finds **no row** → `v_current_status IS NULL` → `RAISE 'not found'` (P0002) → route returns **404 `GATE_DRAFT_GONE`** (a state the wizard already handles). | Draft gone; finalize fails **loud and clean**. No torn/half-published state. **Cron wins, no corruption.** |

**Guarantee:** the single atomic DELETE + `status='draft'` predicate makes a torn state **impossible**. The residual is a rare, non-corrupting "cron wins → finalize 404s" — only reachable if a draft is BOTH >24h old AND being finalized in the same instant.

**Honest limitation:** The atomic DELETE guarantees *no corruption*, not *finalize always wins*. Strictly guaranteeing "finalize always wins" is **not achievable from the cron alone** without a coordinating lock, because `strategies` has **no `updated_at` column** [VERIFIED: `initial_schema.sql:47-66` — only `created_at`], so the cron cannot distinguish "created 25h ago, actively being finalized" from "abandoned." The recommended posture: accept the clean-404 residual (recoverable, fail-loud) and **test-pin the semantics** (both orderings) so a future regression that introduces a torn state reddens. If discuss demands strict finalize-win, the only robust option is adding a `strategies.updated_at` (touched by finalize) and adding `AND <no recent touch>` to the cron — a schema change out of the current requirement's letter; flag it.

### Load-bearing note for the planner

The cron's `status='draft'` predicate is the guarantee — it holds **regardless** of whether finalize uses `FOR UPDATE`, as long as the promotion is a **committed UPDATE of that row** (EPQ protects the DELETE side). Confirm the **unified-backbone** promotion path (`/process-key flow_type=onboard`) also flips `draft→pending_review` via a committed row UPDATE (it returns `pending_review` [VERIFIED: L1170-1182], but the actual flip lives in the backbone RPC — verify it is a guarded UPDATE, not a delete+insert). `[ASSUMED]` the unified flip is a guarded UPDATE.

## CLEAN-02: the api_keys sweep predicate (the crux — written out)

### FK topology of `api_keys` (every referencing table — a destructive-sweep must account for ALL)

| Referencing table | Column | `ON DELETE` | Effect of deleting the key | Source |
|-------------------|--------|-------------|-----------------------------|--------|
| `strategies` | `api_key_id` | **SET NULL** | Single-key link nulled | `initial_schema.sql:51` |
| `strategy_keys` | `api_key_id` | **CASCADE** | Composite membership row removed → **holes the composite** | `strategy_keys.sql:33` |
| `allocator_holdings` | `api_key_id` | **RESTRICT** | **DELETE ABORTS (23503)** — kills the whole set-based statement | `allocator_holdings.sql:95` |
| `csv_daily_returns` | `api_key_id` | **CASCADE** | Per-key returns series silently deleted | `20260624120000_csv_daily_returns_per_key_axis.sql:39` |
| `compute_jobs` | `api_key_id` | **CASCADE** | Poll/queue rows deleted | `allocator_holdings.sql:242` |
| `key_permission_audit` | `api_key_id` | **CASCADE** | Audit rows deleted (observability — acceptable) | `20260416125433_key_permission_audit.sql:35` |

**Consequences for the sweep:**
- The `strategy_keys` CASCADE is exactly why the requirement demands counting `strategy_keys.api_key_id`: a composite member key has **NULL `strategies.api_key_id`** but a **live `strategy_keys` row**. Missing this sweeps live members → holes composites.
- The `allocator_holdings` **RESTRICT** is a landmine the requirement does NOT mention: a set-based `DELETE` that hits even one holdings-referenced key raises 23503 and **aborts the entire sweep** (no keys swept). The predicate MUST exclude these.

### The existing RPC is INCOMPLETE — do not reuse as-is

`delete_api_key_if_unreferenced(p_api_key_id)` checks only `NOT EXISTS (SELECT 1 FROM strategies WHERE api_key_id = …)` [VERIFIED: `20260602183000_b5b_api_key_delete_atomicity.sql:188-190`]. It does **NOT** check `strategy_keys` and does **NOT** check `allocator_holdings`. Using it for the CLEAN-02 sweep would delete draft-composite member keys (published ones are saved by the guard trigger; draft/pending_review ones are NOT). **CLEAN-02 requires a new/extended predicate.**

### The correct sweep predicate (both references + RESTRICT guard + guard/GUC interplay)

```sql
-- Sweep ONLY keys formerly attached to the just-deleted drafts (candidate set),
-- deleting each IFF it is now referenced by NOTHING that matters.
DELETE FROM public.api_keys k
 WHERE k.id = ANY(p_candidate_key_ids)                                -- scoped to deleted drafts' keys
   AND NOT EXISTS (SELECT 1 FROM public.strategies    s  WHERE s.api_key_id  = k.id)  -- single-key link
   AND NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.api_key_id = k.id)  -- composite membership (published OR draft)
   AND NOT EXISTS (SELECT 1 FROM public.allocator_holdings h WHERE h.api_key_id = k.id); -- RESTRICT-abort guard
```

**Candidate set (`p_candidate_key_ids`)** = union of, for the doomed drafts:
- `strategies.api_key_id` (single-key drafts — captured by the CLEAN-01 `RETURNING`), AND
- `strategy_keys.api_key_id` for composite drafts (**composite drafts have `api_key_id = NULL`**, so their member keys are invisible to the current per-draft sweep — **this is the accumulation gap CLEAN-02 actually closes**). These member ids **must be captured BEFORE the strategies DELETE cascades `strategy_keys` away** — which is why the whole thing belongs in **one plpgsql RPC** (collect member ids into an array, delete drafts, then sweep the candidate array in the same transaction).

**Guard / GUC interplay — why this is provably safe:**
- The **published-composite BEFORE DELETE guard** (`enforce_api_keys_published_composite_integrity`, `20260710160000`) RAISEs `foreign_key_violation` if you delete a key that is a `strategy_keys` member of a `status='published'` strategy [VERIFIED: migration body L75-90]. Because the sweep predicate excludes **any** key with **any** `strategy_keys` row (`NOT EXISTS strategy_keys` — a superset of the guard's published-only protected set), the sweep's delete set **never contains a guarded key**, so the guard **never fires** during the sweep. Predicate ⊇ guard-protected set → no abort. Defense-in-depth: even if the predicate regressed, the guard aborts the statement for published members (fail-loud, not silent hole).
- The **sanitize GUC exemption**: the guard exempts deletes when `current_setting('quantalyze.sanitize_in_progress',true)='on'` [VERIFIED: migration L67-69]. The sweep runs as an ordinary service_role cron and **must NOT set that GUC** — so the guard stays ACTIVE for the sweep (correct). `sanitize_user` sets the GUC itself via `set_config('quantalyze.sanitize_in_progress','on',true)` [VERIFIED: `20260513073518_sanitize_user_hardening.sql:249`] and `DELETE FROM api_keys WHERE user_id = p_user_id` BEFORE archiving strategies [VERIFIED: `20260417110538_sanitize_user.sql:316`] — the exemption is what lets GDPR account deletion complete. The sweep and sanitize are **independent transactions**; the sweep does not touch the GUC, so it cannot break sanitize. This is the "sanitize-in-progress path unaffected" invariant to test.

⚠️ **Full-sweep alternative (NOT recommended without a guard):** dropping `k.id = ANY(p_candidate_key_ids)` to sweep *all* orphaned keys additionally deletes **freshly-added-but-unattached keys** (a user who added a key seconds ago but hasn't attached it to a strategy has zero `strategies`/`strategy_keys` rows → swept). If a full sweep is desired, gate it with `AND k.created_at < (now() - interval '<N> hours')`. `[ASSUMED]` the scoped (candidate-set) approach is preferred; confirm in discuss.

## Runtime State Inventory

Not a rename/rebrand phase — no string identifiers move. The only "runtime state" concerns are DB rows (covered by the FK topology table above) and the auto-apply-to-prod migration behaviour (Pitfall 5). No OS-registered state, secrets, or build artifacts are renamed. **None — verified by scope review (new cron/RPC/migration + 2 UI edits; no identifier rename).**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Race-free draft delete | A SELECT-then-DELETE with app-side re-check | A single atomic `DELETE … WHERE status='draft' … RETURNING` | Postgres EPQ re-check is the guarantee; app-side TOCTOU logic is strictly weaker |
| Atomic "delete key iff unreferenced" | New count-then-delete | Extend the single-statement `NOT EXISTS` pattern already in `delete_api_key_if_unreferenced` | The b5b migration closed this exact TOCTOU class (M-0347/M-1020) |
| Cron auth | New secret / bearer scheme | `Bearer ${CRON_SECRET}` + `safeCompare` (existing) | Timing-safe precedent already wired in every `/api/cron/*` |
| Correlation id read | New header parsing | `getCorrelationId()` (already inbound-aware + shape-validated) | Already trims, allowlists, and falls back to UUID |
| Published-composite protection | New sweep-side check | The existing BEFORE DELETE guard trigger | It already fires for service-role (BYPASSRLS skips RLS, not triggers) |

**Key insight:** Nearly every safety primitive this phase needs already exists (`FOR UPDATE` finalize guard, atomic-delete RPC pattern, published-composite trigger, sanitize GUC exemption, correlation pipeline). The work is **composing them correctly with a reference-complete predicate**, not building new machinery.

## UX-01: the Deribit icon fix (root cause)

**Root cause:** `ApiKeyManager.tsx` has its **own local** icon map missing `deribit`:
```ts
// src/components/strategy/ApiKeyManager.tsx:290-294  [VERIFIED]
const exchangeIcon: Record<string, string> = { binance: "B", okx: "O", bybit: "By" };
// L347:  {exchangeIcon[key.exchange] ?? "?"}   ← deribit falls through to "?"
```
The richer canonical map in `AllocatorExchangeManager.tsx:111-115` **already includes** `deribit: { label: "DRB", … }` [VERIFIED]. **Minimal surgical fix** (CLAUDE.md Rule 3): add `deribit: "D"` (or `"DRB"` to match the sibling) to the `ApiKeyManager` map. **Better (optional):** extract a shared `EXCHANGE_ICON` constant so the two maps can't drift again — flag as discretion; the surgical add satisfies the requirement. Also note the map currently omits any exchange beyond the three listed; only `deribit` is in scope.

## UX-02: correlation-id threading plan

**What exists** [VERIFIED]:
- `src/lib/correlation-id.ts` (`server-only`): `CORRELATION_HEADER = "x-correlation-id"`; `getCorrelationId()` reads the inbound header, trims, shape-validates (`/^[A-Za-z0-9._:-]{1,128}$/`), falls back to a fresh UUID.
- `instrumentation.ts:52` surfaces `x-correlation-id` into `compute_jobs.metadata.correlation_id`.
- `layout.tsx` renders a per-request `<meta name="x-correlation-id">`.
- Server routes (`csv-finalize`, `intro`, `keys/sync`, email) already generate/echo the id.

**The gap:** the **client** wizard fetches never SEND an `X-Correlation-Id`, so the server generates its own per-request id the user can't reproduce.

**Plan:**
1. `correlation-id.ts` is `server-only` → the client cannot import it. Add a tiny **client** helper (e.g., `src/lib/wizard/wizard-correlation.ts`) that generates ONE id per wizard session: `` `wizard:${crypto.randomUUID()}` `` (matches the documented `<wizard>:<uuid>` shape and passes the server allowlist — verify total length ≤128; `wizard:`+36 = 43 ✓).
2. Thread it as the `X-Correlation-Id` header into **every** wizard fetch: create-with-key, `keys/sync`, set-members, the sync-progress poll, and `finalize-wizard`. Entry points: `WizardClient.tsx`, `steps/MultiKeyConnectStep.tsx`, `steps/ConnectKeyStep.tsx`, `steps/SyncPreviewStep.tsx`, `steps/SubmitStep.tsx` [VERIFIED: these issue `fetch(`].
3. **Surface it to the user** — render the id (copyable) in `WizardErrorEnvelope.tsx` so a user reporting a failure copies an id that MATCHES server logs + `compute_jobs.metadata.correlation_id`.
4. **No server change needed** IF each target wizard route resolves via `getCorrelationId()` (which prefers the inbound header). **Verify** each route does (`keys/sync` and `csv-finalize` do per their tests; confirm `finalize-wizard` + create-with-key). Where a route hard-generates instead of reading inbound, switch it to `getCorrelationId()`.

Reuse precedent: `src/lib/process-key-client.ts:99` already sends a `correlationId` (defaulting to `getCorrelationId()`), so a shared `wizardFetch(url, init, correlationId)` wrapper is the clean pattern.

## Common Pitfalls

### Pitfall 1: Set-based sweep aborts on an `allocator_holdings` RESTRICT
**What goes wrong:** `DELETE FROM api_keys WHERE NOT EXISTS(strategies) AND NOT EXISTS(strategy_keys)` raises 23503 for any key referenced by `allocator_holdings` (`ON DELETE RESTRICT`), aborting the WHOLE statement → zero keys swept, cron 500s forever.
**How to avoid:** add `AND NOT EXISTS (SELECT 1 FROM allocator_holdings WHERE api_key_id = k.id)` to the predicate. **Warning sign:** cron returns 500 with SQLSTATE 23503.

### Pitfall 2: 24h window vs Phase 94 wizard resumability (data-loss UX regression)
**What goes wrong:** Phase 94 added draft resumability. `strategies` has **no `updated_at`** — a 24h `created_at` cutoff deletes a draft a user is actively resuming on day 2. The 30-day window did not have this problem.
**How to avoid:** confirm 24h is intended for *truly abandoned* drafts; if resumability matters, either keep a longer window or add `strategies.updated_at` and cut on last-touch. **This is a cross-phase conflict — must be reconciled in discuss.**

### Pitfall 3: Nuking rejected drafts (M-0255 carry-forward)
**What goes wrong:** An admin rejection sets `review_note` but leaves `status='draft'` and never resets `created_at`. Dropping the `review_note IS NULL` filter deletes a user's rejected-but-editable draft (with its trades/analytics) 24h after original submission.
**How to avoid:** the DELETE predicate MUST keep `AND review_note IS NULL` [VERIFIED: current route L60-63,100-103]. Do not lose it in the rewrite.

### Pitfall 4: Freshly-added unattached key swept by a full sweep
**What goes wrong:** A "delete all orphaned keys" sweep deletes a key the user added seconds ago but hasn't attached yet (zero refs). **How to avoid:** scope the sweep to the deleted-drafts' candidate key set (recommended), or gate a full sweep on `created_at < now()-interval`.

### Pitfall 5: Migration auto-applies to prod on merge
**What goes wrong:** merging `supabase/migrations/**` to `main` auto-applies to PROD [VERIFIED: `project_supabase_migrate_auto_on_push`]. A wrong sweep predicate deletes prod keys irreversibly.
**How to avoid:** ship the sweep RPC with a self-verifying `DO $$ … $$` block (repo convention) that seeds the 5 safety cases and RAISEs on any wrong deletion at apply time; land the SQL safety tests (below) in the SAME PR; only turn on the sweep call after the RPC is proven. Get the predicate provably safe before merge.

### Pitfall 6: Shared test-DB fragility for concurrency tests
**What goes wrong:** SQL tests run single-session (`psql -v ON_ERROR_STOP=1 -f`, BEGIN/ROLLBACK) against a **shared** test project [VERIFIED: `ci.yml` runner L800-806; `project_shared_testdb_concurrent_ci_flake`]. A true two-session race is **not expressible**; concurrent CI runs sharing the project can flake fence-style tests.
**How to avoid:** pin the race **sequentially** (simulate each ordering — see Validation Architecture), not with real concurrency. Keep seed rows uniquely keyed (fresh UUIDs) and BEGIN/ROLLBACK-scoped.

## Code Examples

### Atomic draft delete capturing composite member ids (RPC skeleton)
```sql
-- Source: composed from finalize_wizard_strategy (FOR UPDATE guard) +
-- b5b_api_key_delete_atomicity (single-statement NOT EXISTS) + retention_crons (idempotent DELETE).
CREATE OR REPLACE FUNCTION public.cleanup_abandoned_wizard_drafts()
  RETURNS TABLE(deleted_drafts int, swept_keys int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  SET lock_timeout = '3s'
AS $$
DECLARE v_candidate_keys uuid[];
BEGIN
  -- 1. Capture composite member key ids BEFORE the CASCADE removes strategy_keys.
  SELECT array_agg(DISTINCT sk.api_key_id)
    INTO v_candidate_keys
    FROM strategy_keys sk
    JOIN strategies s ON s.id = sk.strategy_id
   WHERE s.source='wizard' AND s.status='draft' AND s.review_note IS NULL
     AND s.created_at < now() - interval '24 hours';

  -- 2. Atomic single DELETE of the drafts; RETURNING adds single-key api_key_ids.
  WITH doomed AS (
    DELETE FROM strategies
     WHERE source='wizard' AND status='draft' AND review_note IS NULL
       AND created_at < now() - interval '24 hours'
     RETURNING id, api_key_id
  )
  SELECT count(*)::int,
         v_candidate_keys || array_remove(array_agg(api_key_id), NULL)
    INTO deleted_drafts, v_candidate_keys
    FROM doomed;

  -- 3. Reference-complete, RESTRICT-safe sweep (published-composite guard never fires).
  WITH swept AS (
    DELETE FROM api_keys k
     WHERE k.id = ANY(v_candidate_keys)
       AND NOT EXISTS (SELECT 1 FROM strategies        s  WHERE s.api_key_id  = k.id)
       AND NOT EXISTS (SELECT 1 FROM strategy_keys     sk WHERE sk.api_key_id = k.id)
       AND NOT EXISTS (SELECT 1 FROM allocator_holdings h WHERE h.api_key_id = k.id)
     RETURNING 1
  )
  SELECT count(*)::int INTO swept_keys FROM swept;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_wizard_drafts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_wizard_drafts() TO service_role;
```
*(Illustrative — the planner should add the standard self-verifying `DO` block + `COMMENT ON` + REVOKE/GRANT asserts per repo convention. `array_remove`/`array_agg` on an empty doomed set yields `NULL`/`{}`; guard the array concat for the zero-draft case.)*

### Client wizard fetch wrapper (UX-02)
```ts
// src/lib/wizard/wizard-correlation.ts  (client-safe; NOT server-only)
export function newWizardCorrelationId(): string { return `wizard:${crypto.randomUUID()}`; }
export function wizardFetch(url: string, init: RequestInit, correlationId: string) {
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), "X-Correlation-Id": correlationId } });
}
```

## Validation Architecture

**Offline-first.** All DB safety is pinned as `supabase/tests/test_*.sql` (run in CI via `psql -v ON_ERROR_STOP=1 -f`, BEGIN/ROLLBACK, `RAISE EXCEPTION` = fail; **no psql meta-commands** — CI preflight rejects them) [VERIFIED: `ci.yml:722,789-806`]. UI pinned as vitest.

### Test Framework
| Property | Value |
|----------|-------|
| DB tests | plain `psql` self-tests in `supabase/tests/test_*.sql`, BEGIN/ROLLBACK, `RAISE EXCEPTION` on failure (model: `test_retention_crons_safe.sql`, `test_api_key_delete_atomicity.sql`, `test_strategy_keys_publish_integrity.sql`) |
| DB test command | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_<name>.sql` |
| UI tests | Vitest + `@vitest/coverage-v8` (repo gate: lines 82 / stmts 80 / fns 74 / branches 72) |
| UI quick run | `npx vitest run src/components/strategy/ApiKeyManager.test.tsx` |
| Full suite | `npm test` (sharded in CI) / `npm run test:coverage` |

### Phase Requirements → Test Map
| Req | Behavior | Type | Command | Exists? |
|-----|----------|------|---------|---------|
| CLEAN-01 | Finalize-first ordering → draft survives as `pending_review`, sweep deletes 0 | SQL (sequential sim) | `psql … -f supabase/tests/test_cleanup_wizard_drafts_race.sql` | ❌ Wave 0 |
| CLEAN-01 | Cron-first ordering → draft gone, `finalize_wizard_strategy` RAISEs P0002, cascades clean | SQL | same file | ❌ Wave 0 |
| CLEAN-01 | Structural: finalize RPC body has `FOR UPDATE` + `status <> 'draft'`; cron/RPC body has `status = 'draft'` + `review_note IS NULL` + 24h | SQL (prosrc grep) | same file | ❌ Wave 0 |
| CLEAN-02 | Orphaned key (no refs) → SWEPT | SQL | `test_cleanup_orphaned_api_keys_sweep.sql` | ❌ Wave 0 |
| CLEAN-02 | Composite-member key (draft composite, live `strategy_keys`) → SPARED | SQL | same | ❌ Wave 0 |
| CLEAN-02 | Published-composite member key → SPARED (guard exists as backstop) | SQL | same | ❌ Wave 0 |
| CLEAN-02 | Single-key strategy key (`strategies.api_key_id`) → SPARED | SQL | same | ❌ Wave 0 |
| CLEAN-02 | `allocator_holdings` (RESTRICT) key → SPARED, no 23503 abort | SQL | same | ❌ Wave 0 |
| CLEAN-02 | Sweep does NOT set `sanitize_in_progress`; a normal `sanitize_user` still deletes keys (path unaffected) | SQL | same (assert prosrc lacks GUC set; run sanitize seed) | ❌ Wave 0 |
| UX-01 | `deribit` renders its icon, not `?` | vitest | `npx vitest run …/ApiKeyManager.test.tsx` | ⚠️ extend existing |
| UX-02 | Wizard fetch includes `X-Correlation-Id`; id surfaced to user | vitest (mock fetch, assert header) | wizard step/client test | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the touched test (`psql … -f <one file>` or `vitest run <one file>`).
- **Per wave merge:** all `supabase/tests/test_*.sql` + `npm test`.
- **Phase gate:** full suite green before `/gsd:verify-work`; migration self-verify `DO` block green at apply.

### Wave 0 Gaps
- [ ] `supabase/tests/test_cleanup_wizard_drafts_race.sql` — CLEAN-01 (both orderings + structural)
- [ ] `supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql` — CLEAN-02 (5 safety cases + sanitize-unaffected)
- [ ] `src/lib/wizard/wizard-correlation.ts` + its test — UX-02
- [ ] Extend `ApiKeyManager.test.tsx` — UX-01 deribit case
- [ ] The migration's own self-verifying `DO` block seeding the 5 CLEAN-02 cases (belt-and-suspenders at apply time, since it auto-applies to prod)

## Security Domain

| ASVS Category | Applies | Standard Control (in-repo) |
|---------------|---------|-----------------------------|
| V4 Access Control | yes | SECURITY DEFINER + baked `search_path`; REVOKE from PUBLIC/anon/authenticated; GRANT EXECUTE to service_role only (RPC). BEFORE DELETE guard fires for service-role (BYPASSRLS skips RLS, not triggers). |
| V5 Input Validation | minor | `getCorrelationId()` shape-allowlist already blocks CR/LF/header-split injection via the inbound `X-Correlation-Id`; client id is `wizard:<uuid>` (safe). |
| V7 Error/Logging | yes | Least-disclosure error messages (ADR-0020) — the guard's client-facing error is a constant literal (no owner-id leak). Preserve on any new RAISE. |
| V6 Cryptography | no | — |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Cron endpoint abuse | Spoofing/Elevation | `Bearer ${CRON_SECRET}` timing-safe compare |
| Header-split via correlation id | Tampering | Existing allowlist regex in `getCorrelationId()` |
| Cross-tenant key disclosure via failed DELETE oracle | Information Disclosure | Guard error is a constant literal (no id interpolation) — preserve |
| Silent composite holing | Tampering | `NOT EXISTS strategy_keys` predicate + published guard trigger |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Daily schedule intended for the 24h window (vs weekly) | CLEAN-01 / Pitfall 2 | Drafts persist up to 7d; requirement's "24h" not met in practice |
| A2 | Scoped (candidate-set) sweep preferred over full-orphan sweep | CLEAN-02 | Full sweep nukes freshly-added unattached keys |
| A3 | Unified-backbone finalize flips `draft→pending_review` via a committed guarded UPDATE (not delete+insert) | CLEAN-01 load-bearing note | If it deletes+reinserts, the EPQ argument needs re-examination for that path |
| A4 | `deribit: "D"`/`"DRB"` label is acceptable (no dedicated logo asset required) | UX-01 | May want a real logo, not a letter badge |
| A5 | Every targeted wizard route already resolves correlation via `getCorrelationId()` (prefers inbound) | UX-02 | A route that hard-generates ignores the client id → still un-joinable |
| A6 | Keeping the Vercel Cron route (vs pg_cron) is acceptable | Cron home | Team may prefer in-DB scheduling |

## Open Questions

1. **24h window vs resumability (A1/Pitfall 2)** — Known: no `strategies.updated_at`. Unclear: is 24h meant for untouched drafts only? Recommendation: reconcile in discuss; if strict, add `updated_at`.
2. **Scoped vs full sweep (A2)** — Recommendation: ship scoped (candidate-set) — provably safe; revisit full sweep with an age gate later.
3. **Unified finalize flip shape (A3)** — Verify the backbone RPC's promotion is a guarded UPDATE. One targeted read of the `/process-key onboard` promotion.
4. **Icon: letter vs logo (A4)** — Confirm the `DRB` badge suffices vs a Deribit SVG.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase (prod + test project) | migrations, SQL tests | ✓ | — | — |
| `TEST_SUPABASE_DB_URL` in CI | SQL self-tests | ✓ | — | — (SQL tests skip if unset — do NOT let them silently skip) |
| Vercel Cron | scheduling | ✓ | — | pg_cron |
| `CRON_SECRET` env | cron auth | ✓ (existing) | — | — |

**No blocking gaps.** All infra exists. `pg_cron` may not be installed in local dev (retention migration handles that gracefully) — irrelevant if using the Vercel route.

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| SELECT-then-DELETE drafts + app-side re-filter | Single atomic `DELETE … RETURNING` (EPQ-protected) | Removes the TOCTOU window entirely |
| `delete_api_key_if_unreferenced` (strategies-only) | New predicate: `strategies` + `strategy_keys` + `allocator_holdings` | Closes composite-member accumulation + RESTRICT abort |
| Per-draft key sweep (misses NULL-`api_key_id` composites) | Capture `strategy_keys` member ids pre-cascade | Composite drafts' member keys now collectible |

## Sources

### Primary (HIGH — repo source, verified this session)
- `src/app/api/cron/cleanup-wizard-drafts/route.ts` — existing Vercel cron, auth, current SELECT-then-DELETE + per-key sweep
- `vercel.json` — cron registrations + schedules
- `src/app/api/strategies/finalize-wizard/route.ts` — finalize flow, error mapping, unified path
- `supabase/migrations/20260521185008_wizard_finalize_inserts_verification.sql` — `finalize_wizard_strategy` `FOR UPDATE` + `status='draft'` guard
- `supabase/migrations/20260710160000_api_keys_published_composite_delete_guard.sql` — published-composite BEFORE DELETE guard + sanitize GUC exemption
- `supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql` — `delete_api_key_if_unreferenced` (strategies-only) + atomic-delete pattern
- `supabase/migrations/20260710120000_strategy_keys.sql` — `strategy_keys` FK (CASCADE) + owner-coherence
- `supabase/migrations/20260405061911_initial_schema.sql` — `strategies`/`api_keys` schema, SET NULL FK, no `updated_at`
- `supabase/migrations/20260420073003_allocator_holdings.sql` — `allocator_holdings` RESTRICT + `compute_jobs` CASCADE
- `supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql`, `20260416125433_key_permission_audit.sql` — CASCADE refs
- `supabase/migrations/20260417110538_sanitize_user.sql` + `20260513073518_sanitize_user_hardening.sql` — api_keys purge order + GUC set
- `supabase/migrations/20260417110539_retention_crons.sql` — pg_cron precedent, idempotent DELETE pattern
- `src/components/strategy/ApiKeyManager.tsx` (icon map) + `src/components/exchanges/AllocatorExchangeManager.tsx` (canonical deribit icon)
- `src/lib/correlation-id.ts`, `src/instrumentation.ts`, `src/lib/process-key-client.ts` — correlation pipeline
- `.github/workflows/ci.yml` — SQL self-test runner (single-session, meta-command preflight)

### Secondary (MEDIUM — project memory)
- `project_supabase_migrate_auto_on_push`, `reference_sanitize_user_delete_guard_exemption`, `project_shared_testdb_concurrent_ci_flake`, `reference_db_test_ci_wiring`

## Nyquist Validation-Gate Readiness

- **`nyquist_validation: true`** [VERIFIED: `.planning/config.json`] — Validation Architecture section is REQUIRED and included above.
- All four requirements map to **automated, offline-first** commands (SQL self-tests + vitest) — no manual-only gates.
- The CLEAN-01 race is **sequentially simulatable** (both orderings) and **structurally pinnable** (prosrc asserts) within the single-session `psql` harness — no real concurrency needed → CI-expressible and deterministic.
- CLEAN-02's five safety cases + sanitize-unaffected are single-session seed-and-assert → CI-expressible.
- **Live-corroboration gate:** any prod verification (running the cron against real prod data, watching a real 24h-old draft delete) is **NON-BLOCKING** — the offline SQL/vitest suite + the migration's self-verifying `DO` block are the gate. Flag any "observed on prod" step as advisory, never a blocker.
- **Sampling adequacy:** per-commit = touched test; per-wave = full SQL + vitest; phase-gate = full suite green + migration self-verify green at apply. Sufficient to catch a destructive-predicate regression before the auto-apply-to-prod merge.

## Metadata

**Confidence breakdown:**
- Cron home + auth: HIGH — direct precedent read
- CLEAN-01 atomicity + race proof: HIGH — RPC guard + EPQ semantics verified against source
- CLEAN-02 predicate + FK topology: HIGH — all 7 FKs enumerated from migrations; RESTRICT/CASCADE confirmed
- UX-01/UX-02: HIGH — root cause + infra located in source
- Window/schedule + unified-flip shape: MEDIUM — flagged as assumptions (A1/A3)

**Research date:** 2026-07-12
**Valid until:** ~2026-08-11 (30d; stable — schema + migration conventions are slow-moving)
