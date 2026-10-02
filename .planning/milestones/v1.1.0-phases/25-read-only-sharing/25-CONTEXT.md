# Phase 25: Read-Only Sharing - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area answers proposed + auto-accepted (no clients yet; decisions taken autonomously). Most areas are pre-locked by the ROADMAP success criteria + the carried v1.1.0 risk gate ("Phase 25 RLS leak is the highest-cost silent failure: snapshot don't reference; token-scoped SECURITY DEFINER read; assert on cross-tenant *content*; reuse PR #477 `security_invoker` + REVOKE PUBLIC pattern").

<domain>
## Phase Boundary

An allocator generates a **revocable, read-only share link** for a *saved* scenario. A recipient (anonymous, no account, or any other tenant) opens the link and sees the scenario's **projection + correlation** (PROJECTED / hypothetical framing intact) — and **nothing else**: never the allocator's live book, holdings, AUM dollar amounts, `api_keys`, peer/percentile panels, or any other tenant's content. Resolution happens only for the draft-referenced strategies through a **token-scoped SECURITY DEFINER** read path (never `getMyAllocationDashboard`). Revocation takes effect immediately (route is dynamic / never cached).

In scope: `scenario_shares` table + RLS/REVOKE + generate/revoke RPCs + a token-scoped SECURITY DEFINER read RPC; the allocator-side generate/copy/revoke UX on the saved-scenarios list; the public `/scenario-share/[token]` page + its data route; the cross-tenant **content** leak test (anon + different-tenant assert zero sensitive fields).

Out of scope (deferred / other phases): editing or saving from the shared view; comments/collaboration; share analytics; email delivery of the link; expiry-based auto-revoke (revoke is the control — optional TTL is planner discretion, not required); stress/VaR/Monte-Carlo/optimizer (phases 26–28).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Share token & data model
- **New `scenario_shares` table**, token **separate from the scenario row PK** (success criterion 1). Columns (planner finalizes): `id UUID PK DEFAULT gen_random_uuid()`, `scenario_id UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE`, `created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `token_hash TEXT NOT NULL` (or `bytea`), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `revoked_at TIMESTAMPTZ`.
- **Token = high-entropy random ≥128-bit, hashed at rest.** Generate in the Node route via `crypto.randomBytes(32)` → base64url (256-bit), store **only `sha256(token)`**; the raw token lives only in the URL. Decisively clears the ≥128-bit bar; a DB-read leak does not expose usable live links (security-critical phase → this is the "don't simplify away security" exception, not gold-plating). Mirrors the repo's existing opaque-secret discipline (`demo-pdf-token.ts`, `alert-ack-token.ts` use HMAC + constant-time compare; here we use stored-hash because revocation, not statelessness, is the requirement).
- **Revocation via `revoked_at` timestamp** (not row delete) — preserves audit trail; the read RPC requires `revoked_at IS NULL`. Re-sharing a revoked scenario mints a **new** token (old one stays dead).
- **No mandatory expiry.** Revoke is the control. (Planner may add an optional TTL column; not required by the criteria.)
- **At most one active (non-revoked) share per scenario** — simplest mental model; "Generate link" revokes any prior active share and mints a new one. (Avoids a list-of-links UX this phase doesn't need.)

### Area 2 — Token-scoped read path (the RLS-leak guard)
- **One SECURITY DEFINER RPC** keyed on the raw token (hashes internally, looks up by `token_hash`, requires `revoked_at IS NULL`, joins to `scenarios`), `SET search_path = public, pg_temp`, then **`REVOKE ALL ... FROM PUBLIC, anon`** and self-verify with `_assert_no_public_execute(...)` (canonical pattern: `supabase/migrations/20260515205431_sec_def_public_execute_guard.sql:70-116,136-141`).
- The RPC returns **only**: the scenario `name`, `draft` JSONB, `schema_version`, and the **referenced strategies' `daily_returns`** (resolved by `addedStrategies[].id` from the draft) — i.e. exactly what the projection/correlation math needs. It must **never** read `getMyAllocationDashboard`, live holdings, AUM, or `api_keys`. (Snapshot-don't-reference: the draft is the snapshot; series are re-resolved only for its referenced strategies.)
- `scenario_shares` itself: `REVOKE ALL FROM anon`; `authenticated` may read/insert/update only own rows (`created_by = auth.uid()`), mirroring `scenarios_owner` (success-criterion isolation; the public read goes exclusively through the SECURITY DEFINER RPC, never a direct table select).

### Area 3 — Recipient view scope & UX
- Recipient sees: **equity/projection curve, KPI strip, correlation heatmap, benchmark overlay**, all with the **PROJECTED — hypothetical** framing, methodology line, and coverage caveats intact.
- Recipient does **NOT** see: live book / current holdings, **absolute AUM dollar values**, `api_keys`, allocator/peer-percentile panels, Save/Update/Open/edit controls, the dashboard nav/tabs. → Render **return/percentage form only** (no USD-scaled drawdown), since AUM is sensitive book size.
- **Owner privacy:** show the scenario **name** only; do **not** display the allocator's identity/email. Header framing: scenario name + "Shared scenario · PROJECTED — hypothetical, not a live book."
- **Read-only render reuses the presentational components** (`ScenarioBenchmarkSection`, `CorrelationHeatmap`, `EquityChart`) fed by **server-resolved** data — do **not** mount the full editable `ScenarioComposer`. Build a dedicated read-only `/scenario-share/[token]` page.

### Area 4 — Generate / revoke UX (allocator side)
- Entry point: a **"Share"** action per row in `SavedScenariosList` (alongside rename/delete). Generate → returns full URL, copy-to-clipboard with a confirmation toast; shows "Revoke" + "Copy link" when an active share exists.
- Honest failure surfacing on generate/revoke mirrors the existing list mutations (canonical `role="alert"` "Couldn't …" copy; `onMutated` not fired on failure — the T_SL7b/T_SL7c pattern).

### Area 5 — Honesty / safety invariants on the public path
- **`export const dynamic = "force-dynamic"` + `Cache-Control: no-store, must-revalidate`** on the route (revoke must be immediate; an edge cache would extend a dead link). Mirror `src/app/api/demo/portfolio-pdf/[id]/route.ts:115`.
- **Invalid / revoked / unknown token → 404** (`notFound()`), never a partial or a different scenario.
- **Degenerate / missing data → the same honest empty states + em-dash** the composer uses; never a fabricated 0.
- **Undecodable / version-ahead / dangling-ref draft → honest-absence** ("this shared scenario can't be displayed"), **never a silent live-book substitution** — on a public page there is no live book to substitute, so the DI-23-01 landmine (codec `version_ahead` returning `defaultDraft`) MUST resolve to honest absence here.
- **Rate-limit the public route** with the existing `publicIpLimiter` (demo-pdf precedent), limit-first.

### Claude's Discretion
- Exact column types/names of `scenario_shares`; whether token resolution is one RPC or two (metadata + series); optional TTL; the precise read-only page layout. All deferred to the planner within the locked invariants above.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Persistence spine:** `scenarios` table + owner RLS — `supabase/migrations/20260621120000_scenarios_table_and_rls.sql` (`id`, `allocator_id`, `name`, `draft JSONB`, `schema_version`, RLS `scenarios_owner` USING/WITH CHECK `allocator_id=auth.uid()`, `REVOKE ALL ON scenarios FROM anon`).
- **Allocator CRUD routes** to mirror auth/error shape: `src/app/api/allocator/scenario/saved/route.ts` (GET list / POST create, `allocator_id` from auth never body) + `.../saved/[id]/route.ts` (PATCH/PUT/DELETE, 400 bad UUID → 404 non-owned).
- **Draft codec + schema:** `src/app/(dashboard)/allocations/lib/scenario-state.ts` (`ScenarioDraft`, `scenarioDraftSchema`, `scenarioDraftCodec.decode` ok/readonly/reset trichotomy — the readonly precedent for a share read).
- **Projection math (frozen engine):** `src/lib/scenario.ts` `computeScenario` → `ComputedMetrics` incl. `portfolio_daily_returns`, `correlation_matrix`, `avg_pairwise_correlation`, `equity_curve`; `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` `computeScenarioBenchmark` (TE/IR/alpha/beta, 252-annualized).
- **Presentational (props-only, no fetch):** `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx` (3 honest empty states), `src/components/portfolio/CorrelationHeatmap.tsx` (never computes its own average; <2 / <10-day empty states), `EquityChart`.
- **SECURITY DEFINER + REVOKE PUBLIC canon:** `supabase/migrations/20260515205431_sec_def_public_execute_guard.sql` (`_assert_no_public_execute`, `REVOKE ALL ... FROM PUBLIC, anon`, self-verify `DO $$` block); token-fencing RPC shape `supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql` (`SECURITY DEFINER SET search_path = public, pg_temp`, token param + `WHERE token = ...`).
- **Token discipline:** `src/lib/demo-pdf-token.ts` + `src/lib/alert-ack-token.ts` (HMAC-SHA256, 64-char hex sig, `timingSafeEqual` constant-time compare) — adapt to a stored-hash opaque token here.
- **Public route conventions:** `src/app/demo/page.tsx` (`export const dynamic = "force-dynamic"`, `createAdminClient()`, allowlist-scoped reads), `src/app/factsheet/[id]/v2/page.tsx` (two-layer visibility, `notFound()` on gate fail), `src/app/api/demo/portfolio-pdf/[id]/route.ts` (limit-first `publicIpLimiter`, `Cache-Control: ...no-store`).
- **Cross-tenant content RLS test template:** `supabase/tests/test_scenarios_rls.sql` (Assertion 2 own-row-only, Assertion 3 cross-tenant write → 0 rows, Assertion 5 anon SELECT → 42501) — mirror for the share read RPC (anon + different-tenant assert zero sensitive fields).
- **List mutation failure UX:** the T_SL7b/T_SL7c pattern in `SavedScenariosList.test.tsx` (`role="alert"` "Couldn't …", `onMutated` not fired on failure).

### Established Patterns
- Allocator routes wrap `withAllocatorAuth`; `allocator_id` always sourced from auth, never the request body. Bad UUID → 400; non-owned id → 404 (not 403).
- SECURITY DEFINER functions: `SET search_path = public, pg_temp`, defensive `REVOKE ALL ... FROM PUBLIC, anon`, `_assert_no_public_execute` self-verification block.
- Public pages: `force-dynamic`, admin/service-role client used **only** behind an allowlist/token gate, `notFound()` on any gate failure.
- Honesty invariants: degenerate metric → em-dash "—" not 0; empty-state heading must match its body; never a silent live-book substitution.

### Integration Points
- `SavedScenariosList` (Scenario tab) gains the per-row Share action + generate/revoke calls.
- New allocator routes under `src/app/api/allocator/scenario/...` for generate/revoke; new **public** route + page under `src/app/scenario-share/[token]/` (page) and its data route.
- New migration adds `scenario_shares` + the SECURITY DEFINER read RPC + generate/revoke RPCs (or thin routes over direct owner-scoped inserts). `schema_version` already exists on `scenarios` so the share read can honestly reject version-ahead drafts.
</code_context>

<specifics>
## Specific Ideas

- Token: `crypto.randomBytes(32)` base64url, store `sha256` only; URL form `/scenario-share/<token>`.
- One SECURITY DEFINER RPC `get_shared_scenario(p_token text)` hashing internally; REVOKE + `_assert_no_public_execute` self-verify.
- Recipient view in **return/percentage form** (no USD AUM); scenario name only, no allocator identity.
- The cross-tenant **content** assertion is load-bearing: RLS/SECURITY DEFINER fails *silently*, so the test must assert specific sensitive fields are absent (holdings, AUM, api_keys, other-tenant rows), not just that a 200 came back.
</specifics>

<deferred>
## Deferred Ideas

- Optional share-link expiry (TTL) — revoke is the control; planner discretion only.
- Multiple concurrent links per scenario / per-recipient links — one active link per scenario this phase.
- Share analytics (view counts), email delivery of links, comments/collaboration — out of scope.
- Editing/saving from the shared view — read-only only.
</deferred>
