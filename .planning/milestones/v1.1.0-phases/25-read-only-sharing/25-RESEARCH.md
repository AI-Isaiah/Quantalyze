# Phase 25: Read-Only Sharing - Research

**Researched:** 2026-06-22
**Domain:** Token-scoped public read path over Supabase RLS + Next 16 dynamic public route (revocable share links)
**Confidence:** HIGH (every claim grounded in repo code anchors or the in-tree Next 16 docs; no external/training-only claims drive a decision)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Share token & data model**
- New `scenario_shares` table, token **separate from the scenario row PK**. Columns (planner finalizes): `id UUID PK DEFAULT gen_random_uuid()`, `scenario_id UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE`, `created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `token_hash TEXT NOT NULL` (or `bytea`), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `revoked_at TIMESTAMPTZ`.
- Token = high-entropy random ≥128-bit, **hashed at rest.** Generate in the Node route via `crypto.randomBytes(32)` → base64url (256-bit), store **only `sha256(token)`**; raw token lives only in the URL.
- Revocation via `revoked_at` timestamp (not row delete) — read RPC requires `revoked_at IS NULL`. Re-sharing a revoked scenario mints a **new** token (old one stays dead).
- No mandatory expiry. Revoke is the control. (Optional TTL column = planner discretion, not required.)
- At most one active (non-revoked) share per scenario — "Generate link" revokes any prior active share and mints a new one.

**Area 2 — Token-scoped read path (the RLS-leak guard)**
- One SECURITY DEFINER RPC keyed on the raw token (hashes internally, looks up by `token_hash`, requires `revoked_at IS NULL`, joins to `scenarios`), `SET search_path = public, pg_temp`, then `REVOKE ALL ... FROM PUBLIC, anon` and self-verify with `_assert_no_public_execute(...)`.
- The RPC returns **only**: the scenario `name`, `draft` JSONB, `schema_version`, and the **referenced strategies' `daily_returns`** (resolved by `addedStrategies[].id` from the draft). It must **never** read `getMyAllocationDashboard`, live holdings, AUM, or `api_keys`.
- `scenario_shares` itself: `REVOKE ALL FROM anon`; `authenticated` may read/insert/update only own rows (`created_by = auth.uid()`), mirroring `scenarios_owner`. Public read goes exclusively through the SECURITY DEFINER RPC, never a direct table select.

**Area 3 — Recipient view scope & UX**
- Recipient sees: equity/projection curve, KPI strip, correlation heatmap, benchmark overlay — all with PROJECTED — hypothetical framing, methodology line, coverage caveats.
- Recipient does NOT see: live book / current holdings, **absolute AUM dollar values**, `api_keys`, allocator/peer-percentile panels, Save/Update/Open/edit controls, dashboard nav/tabs. → Render **return/percentage form only** (no USD-scaled drawdown).
- Owner privacy: show scenario **name** only; never the allocator's identity/email. Header: name + "Shared scenario · PROJECTED — hypothetical, not a live book."
- Read-only render reuses presentational components (`ScenarioBenchmarkSection`, `CorrelationHeatmap`, `EquityChart`) fed by **server-resolved** data — NOT the editable `ScenarioComposer`. Dedicated read-only `/scenario-share/[token]` page.

**Area 4 — Generate / revoke UX (allocator side)**
- Entry point: a "Share" action per row in `SavedScenariosList` (alongside rename/delete). Generate → returns full URL, copy-to-clipboard with confirmation toast; shows "Revoke" + "Copy link" when an active share exists.
- Honest failure surfacing mirrors existing list mutations (`role="alert"` "Couldn't …"; `onMutated` not fired on failure — T_SL7b/T_SL7c).

**Area 5 — Honesty / safety invariants on the public path**
- `export const dynamic = "force-dynamic"` + `Cache-Control: no-store, must-revalidate` on the route (revoke must be immediate; an edge cache would extend a dead link).
- Invalid / revoked / unknown token → 404 (`notFound()`), never a partial or a different scenario.
- Degenerate / missing data → the same honest empty states + em-dash the composer uses; never a fabricated 0.
- Undecodable / version-ahead / dangling-ref draft → honest-absence ("this shared scenario can't be displayed"), **never a silent live-book substitution** (the DI-23-01 landmine MUST resolve to honest absence here).
- Rate-limit the public route with the existing `publicIpLimiter` (demo-pdf precedent), limit-first.

### Claude's Discretion
- Exact column types/names of `scenario_shares`; whether token resolution is one RPC or two (metadata + series); optional TTL; the precise read-only page layout. All deferred to the planner within the locked invariants above.

### Deferred Ideas (OUT OF SCOPE)
- Optional share-link expiry (TTL) — revoke is the control; planner discretion only.
- Multiple concurrent links per scenario / per-recipient links — one active link per scenario this phase.
- Share analytics (view counts), email delivery of links, comments/collaboration.
- Editing/saving from the shared view — read-only only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-01 | Allocator can generate a read-only share link for a saved scenario | New allocator route over an owner-scoped `scenario_shares` INSERT (mirror `scenario/saved/route.ts` auth/error shape); token minted in Node via `crypto.randomBytes(32)`→base64url, only `sha256(token)` persisted. UX = new per-row action in `SavedScenariosList`, reusing `ShareableLink.tsx`'s clipboard + `execCommand` fallback + audit-#43 honest-failure state machine. |
| SHARE-02 | Recipient views read-only without exposing live book / holdings / AUM / api_keys / other-tenant data (snapshot, token-scoped read) | One SECURITY DEFINER RPC `get_shared_scenario(p_token text)` hashing internally → `token_hash` lookup → `revoked_at IS NULL` → returns name + draft + schema_version + **only the `addedStrategies[].id` referenced** published-strategy `daily_returns` from `strategy_analytics`. The leak surface and its scoping are dissected in §Architecture Pattern 2 + §Common Pitfalls 1–3 + §Security Domain. |
| SHARE-03 | Allocator can revoke a share link | Owner-scoped UPDATE setting `revoked_at = now()`; read RPC's `revoked_at IS NULL` predicate makes revoke immediate; page is `force-dynamic` + `no-store` so no edge cache survives the revoke. |
</phase_requirements>

## Summary

This phase is a **security phase wearing a feature's clothing**. The visible deliverable is a "Share" button and a read-only page; the load-bearing work is a single token-scoped SECURITY DEFINER read path that must resolve a *snapshot* (the saved `draft` JSONB) plus a *strictly-scoped re-resolution* of referenced series — and nothing else — for an anonymous or cross-tenant caller. Every reusable primitive already exists in the tree: the `scenarios` table + owner RLS (Phase 23), the `_assert_no_public_execute` self-verify canon (mig 134), the token-fencing RPC shape (mig 117), the projection engine (`computeScenario`), the benchmark engine + public BTC route (Phase 24), the props-only presentational components, the `ShareableLink.tsx` copy state machine, and the public-route conventions (`force-dynamic`, `publicIpLimiter`, `createAdminClient` behind a gate). No new dependencies are required.

The single highest-risk decision the planner must lock is **what the share read path is allowed to re-resolve**. A saved scenario `draft` mixes two kinds of refs: (a) the allocator's **live holdings** (keyed `holding:{venue}:{symbol}:{type}`) whose return series ARE part of the allocator's live book, and (b) **added strategies** (keyed by `strategies.id`, which are published/example strategies). The CONTEXT locks resolution to **`addedStrategies[].id` only** — re-resolving holdings would leak the allocator's actual positions and is forbidden. This is not a detail; it is the phase's entire reason to exist. The recipient therefore sees a projection of the *added strategies* in the saved blend, in pure return/percentage form, with PROJECTED framing — never a reconstruction of the allocator's real book.

The token model is decided: a 256-bit random token, base64url in the URL, only `sha256(token)` at rest, validated by hashing inside the SECURITY DEFINER RPC. This clears ≥128-bit decisively and means a DB-read leak exposes no usable links. Revocation is a `revoked_at` timestamp the read RPC filters on; immediacy is guaranteed by `force-dynamic` + `no-store` (an edge-cached page is the documented way a revoked link stays alive — mirror the demo-PDF cache-control reasoning verbatim).

**Primary recommendation:** Build ONE migration adding `scenario_shares` (+ owner RLS + REVOKE anon) and ONE SECURITY DEFINER RPC `get_shared_scenario(p_token text)` that hashes internally, filters `revoked_at IS NULL`, and returns name/draft/schema_version + the `addedStrategies[].id`-scoped `strategy_analytics.daily_returns` (published-only). Mint/revoke via thin owner-scoped routes over the table (no SECURITY DEFINER needed for owner writes — RLS scopes them). Build the public `/scenario-share/[token]` page (`force-dynamic`) that calls the RPC via `createAdminClient` (the RPC is the gate; admin client is only the transport), resolves benchmark via the existing public `GET /api/benchmark/btc`, computes `computeScenario` + `computeScenarioBenchmark` server-side, and renders the reused presentational components. Prove the boundary with a two-tenant + anon **content** assertion mirroring `test_scenarios_rls.sql` and a revoke-immediacy assertion.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mint share token (random + hash) | API / Backend (Node route) | — | `crypto.randomBytes` is Node-only; the raw token must never touch the DB, so hashing happens at the route boundary on insert and inside the RPC on read. |
| Persist share record + revoke | Database (RLS owner-scoped table) | API (thin route) | Owner writes are scoped by RLS exactly like `scenarios` — no SECURITY DEFINER needed for the allocator side. |
| Token validation + scoped read | Database (SECURITY DEFINER RPC) | — | The whole point: a single trusted, self-verifying function is the ONLY path anon/cross-tenant data flows through. Validation (hash compare + `revoked_at IS NULL`) and scoping (only `addedStrategies[].id` series) live together so they cannot drift. |
| Recipient page render | Frontend Server (RSC, public segment) | — | Server-resolves via the RPC, computes metrics, feeds props-only components. Must live OUTSIDE the `(dashboard)` auth-gated segment. |
| Benchmark (BTC) series for recipient | API / Backend (existing public route) | CDN (cacheable) | `GET /api/benchmark/btc` is already public, shared market data, `public, s-maxage` cacheable — reuse verbatim; do NOT add a no-store header to it. |
| Projection + correlation + active-return math | Frontend Server (pure TS engine, run server-side) | — | `computeScenario` / `computeScenarioBenchmark` are pure and run identically server- or client-side; run them in the RSC so the recipient bundle ships data, not raw series of other tenants. |
| Share affordance state machine | Browser / Client (`SavedScenariosList`) | — | Clipboard + transient copied/error states are inherently client; reuse `ShareableLink.tsx`. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.9 [VERIFIED: node_modules/next/package.json] | App Router dynamic public page + (optional) route handler | Already the project framework; AGENTS.md mandates reading `node_modules/next/dist/docs` (done — see §State of the Art). |
| `@supabase/supabase-js` | in-tree (admin + ssr clients) [CITED: src/lib/supabase/admin.ts, server.ts] | RPC call transport + owner-scoped table writes | The SECURITY DEFINER RPC is the gate; the admin client is only the connection. |
| Postgres (Supabase) | project DB | `scenario_shares` table + RLS + SECURITY DEFINER RPC | RLS + SECURITY DEFINER + `_assert_no_public_execute` is the established tenant-isolation canon (migs 134, 117, 87). |
| Node `crypto` (built-in) | Node 18+ runtime | `randomBytes(32)` token, `createHash('sha256')`, `timingSafeEqual` | Native; the repo already uses `createHmac`/`timingSafeEqual` for opaque tokens (`demo-pdf-token.ts`, `alert-ack-token.ts`). NO new dependency. |
| `zod` | in-tree [CITED: scenario-state.ts] | Validate the decoded `draft` shape server-side before computing | `scenarioDraftSchema` already exists and is reused by the save route; reuse it to reject a malformed/oversized draft. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/lib/ratelimit` (`publicIpLimiter`, `checkLimit`, `getClientIp`, `rateLimitDenyJson`) | in-tree [CITED: src/lib/ratelimit.ts:106,238,278,338] | Limit-first DoS shield on the public path | `publicIpLimiter` = `makeLimiter(10, "60 s")`. Mirror demo-PDF ordering (rate-limit BEFORE any token/DB work). |
| `@/lib/scenario` `computeScenario` | in-tree [CITED: src/lib/scenario.ts:149] | Projection + correlation engine (frozen) | Server-side compute on the resolved series. |
| `@/app/(dashboard)/allocations/lib/scenario-benchmark` `computeScenarioBenchmark` | in-tree [CITED] | TE/IR/α/β/correlation vs BTC | Feed `portfolio_daily_returns` + BTC series. |
| `@/lib/sentry-capture` `captureToSentry` | in-tree | Redacted server-side error capture | Never echo DB error text to the recipient (F5a/F5b discipline). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stored-hash opaque token (LOCKED) | HMAC-stateless token (like `demo-pdf-token.ts`) | HMAC is stateless → **cannot be revoked** without a server-side denylist, which is itself stored state. Since revocation (SHARE-03) is a hard requirement, stored-hash is strictly correct. The repo's HMAC tokens are for *expiring* links, not *revocable* ones — different requirement. [VERIFIED: demo-pdf-token.ts header comment confirms "expiry is part of the signed payload" model]. |
| One RPC returning everything | Two RPCs (metadata, then series) | Planner discretion (CONTEXT Area 2). One RPC is simpler and atomic; two RPCs add a round-trip and a second REVOKE/assert surface. Recommend ONE unless payload size forces a split. |
| RSC page calling the RPC directly | A separate public route handler the page fetches | Both are valid. An RSC server component is simpler (no extra fetch hop) and is the demo-page precedent; a route handler is the demo-PDF precedent. Recommend the **RSC page** (one fewer surface) with `force-dynamic`; if a route handler is used, it also needs `no-store` + limiter. |
| Re-resolving holdings series | (forbidden) | Re-resolving the allocator's holding returns would leak the live book — the exact thing this phase prevents. Holdings refs in the draft are dropped from resolution. |

**Installation:**
```bash
# No new packages. All primitives are in-tree (Node crypto, Supabase, Next 16, zod).
```

**Version verification:** `next` confirmed at 16.2.9 via `node_modules/next/package.json` [VERIFIED]. No registry installs in this phase, so no `npm view` needed.

## Package Legitimacy Audit

> No external packages are installed in this phase. All capabilities use the Node.js standard library (`crypto`) and already-present in-tree dependencies (`next@16.2.9`, `@supabase/supabase-js`, `zod`). The Package Legitimacy Gate is **N/A** — there is nothing to slopcheck.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none — no new installs) | — | — | — | — | N/A | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
ALLOCATOR (authenticated)                         RECIPIENT (anon OR different tenant)
─────────────────────────                         ───────────────────────────────────
SavedScenariosList row                             GET /scenario-share/<rawToken>
  │  click "Share"                                   │  (public segment, NOT under (dashboard))
  ▼                                                  ▼
POST /api/allocator/scenario/share                 RSC page: export const dynamic="force-dynamic"
  │  withAllocatorAuth → user.id                      │  1. publicIpLimiter (LIMIT FIRST)
  │  1. rawToken = randomBytes(32).base64url          │  2. createAdminClient()  ← transport only
  │  2. token_hash = sha256(rawToken)                 ▼
  │  3. (revoke prior active share for scenario)    rpc('get_shared_scenario', { p_token: rawToken })
  │  4. INSERT scenario_shares (RLS owner-scoped)      │  SECURITY DEFINER, SET search_path=public,pg_temp
  ▼                                                    │  ── REVOKE ALL FROM PUBLIC, anon ──
returns { url: ORIGIN + "/scenario-share/" +         │  a. v_hash = sha256(p_token)
          rawToken }   ← raw token ONLY here          │  b. SELECT scenario_id FROM scenario_shares
  │  (clipboard write, copied/error state)            │       WHERE token_hash = v_hash
  ▼                                                    │         AND revoked_at IS NULL          ← REVOKE gate
DB: scenario_shares                                    │     (not found → RETURN NULL → page notFound())
  token_hash, scenario_id, created_by,                 │  c. SELECT name, draft, schema_version
  created_at, revoked_at                               │       FROM scenarios WHERE id = scenario_id
                                                       │  d. extract addedStrategies[].id from draft->'addedStrategies'
POST /api/allocator/scenario/share/revoke              │  e. SELECT strategy_id, daily_returns
  │  UPDATE ... SET revoked_at=now()  (RLS owner)       │       FROM strategy_analytics sa JOIN strategies s
  ▼                                                     │       WHERE s.id = ANY(added_ids)
revoked_at set → read RPC's (b) predicate                │         AND s.status='published'        ← published-only
fails immediately → recipient page 404s on next load     │     (holdings refs are NOT resolved — live book)
(force-dynamic + no-store → no edge cache to outlive it) ▼
                                                       returns { name, draft, schema_version,
                                                                 series: [{strategy_id, daily_returns}] }
                                                         │
                                                         ▼
                                                       RSC: decode draft (codec readonly/reset → honest-absence,
                                                            NEVER defaultDraft live-book substitution)
                                                         │  GET /api/benchmark/btc (public, cacheable)
                                                         ▼
                                                       computeScenario(series, state) + computeScenarioBenchmark(.,btc)
                                                         ▼
                                                       <EquityChart/> <CorrelationHeatmap/> <ScenarioBenchmarkSection/>
                                                       (return/% form only · PROJECTED framing · name only)
```

### Recommended Project Structure
```
supabase/migrations/
  └─ 2026XXXXXXXXXX_scenario_shares_and_read_rpc.sql   # table + owner RLS + REVOKE anon + get_shared_scenario RPC + _assert_no_public_execute self-verify
supabase/migrations/down/
  └─ 2026XXXXXXXXXX-rollback.sql                        # DROP FUNCTION get_shared_scenario; DROP TABLE scenario_shares CASCADE
supabase/tests/
  └─ test_scenario_shares_rls.sql                       # two-tenant + anon CONTENT leak + revoke-immediacy assertions (mirror test_scenarios_rls.sql)
src/lib/
  └─ scenario-share-token.ts                            # mintShareToken() → {raw, hash}; hashShareToken(raw) (sha256 base64/hex) — pure, unit-tested
src/app/api/allocator/scenario/share/
  ├─ route.ts                                           # POST generate (mirror scenario/saved/route.ts conventions)
  └─ revoke/route.ts          (or DELETE on [id])       # POST revoke
src/app/scenario-share/[token]/
  ├─ page.tsx                                           # force-dynamic public RSC; calls RPC; renders reused components
  └─ (server helper for resolve+compute, planner discretion)
src/app/(dashboard)/allocations/components/
  └─ SavedScenariosList.tsx                             # + per-row Share affordance (reuse ShareableLink.tsx state machine)
```

### Pattern 1: SECURITY DEFINER token-scoped read RPC (the leak guard)
**What:** A single `STABLE SECURITY DEFINER` function that hashes the raw token internally, gates on `token_hash` + `revoked_at IS NULL`, and returns ONLY the snapshot fields + the `addedStrategies[].id`-scoped published-strategy series.
**When to use:** This is the sole data path for anon/cross-tenant recipients.
**Example (shape — adapt to final columns):**
```sql
-- Source: synthesizes mig 117 (SET search_path, token param, SECURITY DEFINER)
--         + mig 134 (_assert_no_public_execute self-verify + REVOKE)
--         + mig 87 (search_path=public,pg_temp hardening on a read RPC)
CREATE OR REPLACE FUNCTION public.get_shared_scenario(p_token TEXT)
RETURNS TABLE (
  name           TEXT,
  draft          JSONB,
  schema_version INT,
  series         JSONB            -- [{ "strategy_id": uuid, "daily_returns": [...] }]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp     -- NOT pg_catalog (mig 87 H-B hardening)
AS $$
DECLARE
  v_hash       TEXT;
  v_scenario   scenarios%ROWTYPE;
  v_added_ids  UUID[];
BEGIN
  -- Defensive input guard: a NULL/empty token can never match.
  IF p_token IS NULL OR length(p_token) = 0 THEN RETURN; END IF;

  -- Hash INSIDE the function — the raw token never touches a column.
  v_hash := encode(digest(p_token, 'sha256'), 'hex');   -- pgcrypto digest()

  -- Gate: active (non-revoked) share only. Not found → RETURN (0 rows) → 404.
  SELECT s.* INTO v_scenario
    FROM scenario_shares sh
    JOIN scenarios s ON s.id = sh.scenario_id
   WHERE sh.token_hash = v_hash
     AND sh.revoked_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;

  -- Extract ONLY the added-strategy UUIDs from the draft snapshot.
  -- Holdings refs ("holding:...") are deliberately NOT resolved (live book).
  SELECT array_agg((elem->>'id')::uuid)
    INTO v_added_ids
    FROM jsonb_array_elements(COALESCE(v_scenario.draft->'addedStrategies','[]'::jsonb)) elem
   WHERE (elem->>'id') ~ '^[0-9a-f-]{36}$';   -- UUID-shaped only; drops poison

  RETURN QUERY
  SELECT v_scenario.name,
         v_scenario.draft,
         v_scenario.schema_version,
         COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                     'strategy_id', sa.strategy_id,
                     'daily_returns', sa.daily_returns))
              FROM strategy_analytics sa
              JOIN strategies st ON st.id = sa.strategy_id
             WHERE sa.strategy_id = ANY(COALESCE(v_added_ids, '{}'))
               AND st.status = 'published'),   -- published-only; never owned-but-unpublished
           '[]'::jsonb);
END;
$$;

-- Defense-in-depth: strip PUBLIC/anon grants, then SELF-VERIFY (mig 134 canon).
REVOKE ALL ON FUNCTION public.get_shared_scenario(TEXT) FROM PUBLIC, anon;
-- The page calls via createAdminClient (service_role), so grant service_role only;
-- do NOT GRANT anon (anon must never invoke it directly).
DO $$ BEGIN
  PERFORM public._assert_no_public_execute('public.get_shared_scenario(text)');
END $$;
```
> NOTE for planner: confirm `digest()` (pgcrypto) is available — the repo uses `gen_random_uuid()` (pgcrypto/pg ≥13) so pgcrypto is present; if `digest` is not enabled, hash in the Node route and pass the hash to the RPC instead (CONTEXT explicitly leaves "hash inside the function vs in the Node route then pass a row id" to the planner). Hashing-in-SQL keeps the raw token off the wire to the DB driver; hashing-in-Node keeps pgcrypto out of the dependency surface. **Recommend hash-in-SQL** so there is a single validation site and the route stays a thin transport. [ASSUMED: pgcrypto `digest` availability — verify at plan time with `SELECT digest('x','sha256')`.]

### Pattern 2: Snapshot-don't-reference, resolve-only-referenced (the central rule)
**What:** The `draft` JSONB IS the snapshot (composition + weights). Series are NOT snapshotted (they'd go stale and bloat the row); they are re-resolved at read time — but ONLY for `addedStrategies[].id`, never for holdings refs.
**Why this matters:** A draft's `toggleByScopeRef`/`weightOverrides` keys are a mix of `holding:{venue}:{symbol}:{type}` (the allocator's live positions) and `strategies.id` UUIDs (added strategies). Holdings series live in the allocator's book; added strategies are published. Resolving holdings would leak positions — forbidden. [VERIFIED: scenario-state.ts:79-80 ref shape; scenario-adapter.ts:100-144 holding vs added split].
**Consequence for the recipient projection:** the recipient sees a projection built from the *added strategies only*. If a saved draft had ZERO added strategies (a pure holdings reweight), the share has no resolvable series → the correlation/projection render their honest empty states. This is correct behavior, not a bug — surface it in the plan as an expected state.

### Pattern 3: Owner-side writes stay on RLS (no SECURITY DEFINER for generate/revoke)
**What:** Generate = `INSERT scenario_shares` and revoke = `UPDATE ... SET revoked_at` both run under the authenticated user-scoped client; the `scenario_shares_owner` policy (`created_by = auth.uid()`) scopes them exactly like `scenarios_owner`. No SECURITY DEFINER needed on the allocator side.
**When to use:** All allocator-facing mutations. Mirror `scenario/saved/route.ts` verbatim: `withAllocatorAuth`, `allocator_id`/`created_by` from auth never body, B15 limiter-ordering (validate → rate-limit → write), redacted error envelope, `NO_STORE_HEADERS` on every response. [CITED: src/app/api/allocator/scenario/saved/route.ts].
**"One active share per scenario":** the generate route should, in one transaction or one statement, set `revoked_at = now()` on any existing active share for the `scenario_id` before inserting the new one (or use a partial unique index `UNIQUE (scenario_id) WHERE revoked_at IS NULL` and an upsert). Recommend the **partial unique index** as the structural guarantee + an explicit pre-revoke UPDATE, so a race cannot leave two active shares.

### Pattern 4: Public page placement + uncached guarantee (Next 16)
**What:** The page lives at `src/app/scenario-share/[token]/page.tsx` — a sibling of `(dashboard)`, NOT inside it, so it inherits no auth layout. `export const dynamic = "force-dynamic"`. `params` is a Promise — `await params`.
**Example:**
```tsx
// Source: node_modules/next/dist/docs/.../dynamic-routes.md (await params)
//       + node_modules/next/dist/docs/.../15-route-handlers.md (not cached by default)
//       + src/app/demo/page.tsx (force-dynamic + createAdminClient public precedent)
export const dynamic = "force-dynamic";   // never prerender/ISR; revoke must be instant

export default async function ScenarioSharePage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 1. publicIpLimiter (limit-first)  2. createAdminClient().rpc('get_shared_scenario', { p_token: token })
  // 3. if no row → notFound()         4. decode draft → honest-absence on readonly/reset
  // 5. compute + render reused components
}
```
> If a route handler is used instead of (or in addition to) the page for the data fetch, it is **not cached by default** in Next 16 [VERIFIED: route-handlers.md:51] — but still add `Cache-Control: no-store` on its response and `export const dynamic = "force-dynamic"` so a future `force-static` or Cache-Components rollout cannot silently cache it.

### Anti-Patterns to Avoid
- **Calling `getMyAllocationDashboard` (or any of its queries) from the share path.** It returns holdings, AUM, `api_keys`, peer panels — the entire forbidden set. The CONTEXT names this explicitly. [CITED: queries.ts:1493-1599 `MyAllocationDashboardPayload`].
- **Resolving holdings refs.** Only `addedStrategies[].id` may be resolved (Pattern 2).
- **Returning the codec's `version_ahead → defaultDraft` value on the public page.** On the dashboard, `defaultDraft` = the allocator's current live holdings; on a PUBLIC page substituting that would surface SOMEONE'S live book under a recipient's eyes — the DI-23-01 landmine. The share path must treat `outcome: "readonly"` (version_ahead) and `"reset"` as **honest-absence** ("This shared scenario can't be displayed"), never render the fallback draft. [CITED: scenario-state.ts:578-608].
- **A direct anon `SELECT` on `scenario_shares` or `scenarios`.** Both `REVOKE ALL FROM anon`; the only public path is the RPC. A direct select is both blocked (42501) and wrong-shaped.
- **`GRANT EXECUTE ... TO anon` on the read RPC.** The page calls via `createAdminClient` (service_role); anon must never invoke the RPC directly. Grant service_role only.
- **Adding a `no-store` header to `GET /api/benchmark/btc`.** That route is intentionally `public, s-maxage` cacheable shared market data; do not "harden" it. [CITED: benchmark/btc/route.ts:14-22].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Opaque revocable token | A custom JWT / signed-payload scheme | `crypto.randomBytes(32)`→base64url, store `sha256` | The repo's HMAC tokens can't be revoked; random+stored-hash is the correct primitive and is one-liner native crypto. |
| Constant-time compare | Manual `===` on the hash | DB equality on `token_hash` (already constant-domain) / `timingSafeEqual` if comparing in Node | Hash lookup is an indexed equality, not a secret comparison; if you ever compare in Node, reuse `timingSafeEqual` (demo-pdf-token.ts precedent). |
| PUBLIC-EXECUTE leak detection | Re-inventing `has_function_privilege('public',…)` | `_assert_no_public_execute('public.get_shared_scenario(text)')` | mig 134 documents why the naive check is brittle; the helper is the canon. [CITED: mig 20260515205431:70-141]. |
| Projection math | Re-deriving TWR/correlation server-side | `computeScenario` (frozen) | Regression-pinned engine; re-implementing risks drift + the catastrophic-loss / NaN guards. [CITED: scenario.ts]. |
| Active-return math | Hand-rolling TE/IR/α/β | `computeScenarioBenchmark` + `innerJoinByDate` | Phase 24 engine with the constant-benchmark/IR float-residue null guards already proven. [CITED: scenario-benchmark.ts]. |
| BTC series | A new benchmark read | `GET /api/benchmark/btc` | Already public, cacheable, honest-empty-on-error. [CITED: benchmark/btc/route.ts]. |
| Clipboard copy + fallback + honest failure | A fresh copy handler | Reuse `ShareableLink.tsx` state machine | The audit-#43 lesson (success badge must fire only on real success) is already encoded. [CITED: ShareableLink.tsx]. |
| Rate-limit envelope | A custom 429 | `publicIpLimiter` + `rateLimitDenyJson` | Limiter-misconfig → 503 not misleading 429; demo-pdf ordering pinned by `limiter-ordering.test.ts`. [CITED: demo/portfolio-pdf route]. |
| RLS-presence "proof" | Asserting `pg_policies` rows exist | Two-tenant + anon CONTENT assertion | RLS fails SILENTLY — a content-by-row-id test is the only honest proof. [CITED: test_scenarios_rls.sql header]. |

**Key insight:** In this domain a custom solution is almost always a *new leak surface*. Every primitive needed already exists and is hardened; the planner's job is composition and the boundary test, not invention.

## Runtime State Inventory

> This phase is **additive greenfield** (a new table, a new RPC, a new page) — it renames/migrates nothing. The categories below are answered explicitly per the rename/refactor protocol because the phase touches a security boundary and stored data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | The `draft` JSONB stored in `scenarios` (Phase 23) is the snapshot the share reads — no new stored series. `scenario_shares.token_hash` is the only new stored secret-derived value (a hash, not the secret). | None beyond the new table. Verified: series are NOT stored (scenario-state.ts header: "NEVER the raw equity series — series are recomputed on reopen"). |
| Live service config | None. No external service (n8n, Datadog, Tailscale, Cloudflare) holds a share token or scenario reference. | None — verified: shares are entirely in-DB; the URL is the only externalized artifact and it lives in the recipient's clipboard/address bar, not in any service config. |
| OS-registered state | None. No cron/Task Scheduler/launchd/pm2 process references shares (no expiry sweeper this phase — revoke is manual; TTL deferred). | None — verified: no scheduled job. If a future TTL sweeper is added (deferred), it would be a new cron — out of scope. |
| Secrets / env vars | **No new secret env var is required** (the stored-hash model needs no server-side HMAC secret, unlike `DEMO_PDF_SECRET`/`ALERT_ACK_SECRET`). The token's entropy comes from `randomBytes`, not from a keyed MAC. `NEXT_PUBLIC_APP_URL` (already present, used by demo-pdf route:17) supplies the URL origin for the returned link. | None new. Confirm the generate route builds the absolute URL from `NEXT_PUBLIC_APP_URL` / request origin (not a hardcoded host). |
| Build artifacts / installed packages | None — no package install, no compiled artifact, no egg-info. The new migration is applied at /land-and-deploy (anon NO-EXEC verified), not pushed from the plan (mirror the Phase 23 migration discipline). | Apply migration at deploy; run `supabase/tests/test_scenario_shares_rls.sql` via the `sql-tests` CI job (auto-discovered by the `test_*.sql` glob [CITED: ci.yml:677]). |

**The canonical question (after every file is updated, what runtime state still holds the old/leaky path?):** Nothing — this is net-new. The only runtime concern is the inverse: after a **revoke**, does any cache still serve the dead link? Answered by `force-dynamic` + `no-store` (no edge cache to outlive the `revoked_at` write).

## Common Pitfalls

### Pitfall 1: Over-returning from the SECURITY DEFINER RPC (the live-book leak)
**What goes wrong:** The RPC returns more than name/draft/schema_version + scoped series — e.g. it `SELECT *`s `scenarios`, or joins `portfolios`/`portfolio_strategies`/`api_keys`, or resolves holdings refs.
**Why it happens:** Copy-paste from a dashboard query; a `SELECT *` instead of an explicit column list; forgetting that holdings refs are live-book.
**How to avoid:** Explicit column list (never `*`); resolve series ONLY for `addedStrategies[].id`; never touch holdings/portfolios/api_keys. The migration's self-verify DO-block can additionally assert the function body does NOT reference `api_keys`/`portfolio_strategies` (regex `pg_get_functiondef`, mirroring mig 117's body-shape gates).
**Warning signs:** Any join to a tenant-scoped table other than `scenarios` + `strategy_analytics`/`strategies(status='published')`.

### Pitfall 2: The content test passes for the wrong reason (RLS fails silently)
**What goes wrong:** A test asserts "the page returned 200" or "the RPC returned a row" and calls it secure — but never checks that the row contains NO holdings/AUM/api_keys and NO other-tenant series.
**Why it happens:** RLS and SECURITY DEFINER scoping fail *silently* — a loosened predicate ships green unless a test inspects CONTENT by field.
**How to avoid:** Assert specific sensitive fields are ABSENT and that a different-tenant token resolves ONLY its own scenario's added strategies — mirror `test_scenarios_rls.sql` Assertion 2/3 (content by row id), extended to: (a) anon calling the RPC with tenant A's token gets A's added-strategy series and NOTHING else; (b) a draft whose `addedStrategies` is empty yields `series = []` (no holdings leak); (c) the returned payload has no key matching `api_key|allocated_amount|account_balance|value_usd`.
**Warning signs:** A test that can't fail when you add a leaking column to the RPC.

### Pitfall 3: version_ahead / undecodable draft renders a live book (DI-23-01)
**What goes wrong:** The codec returns `outcome: "readonly"` (version_ahead) or `"reset"` with `value = defaultDraft`; the page renders `defaultDraft`. On the dashboard `defaultDraft` is built from the viewer's current holdings — on a public page there is no viewer book, but the codec was authored for the dashboard and its fallback is a live-book-shaped object.
**Why it happens:** Reusing the dashboard codec verbatim and rendering its `.value` unconditionally.
**How to avoid:** On the share page, branch on `outcome`: only `"ok"` renders the projection; `"readonly"` and `"reset"` → honest-absence empty state ("This shared scenario can't be displayed"). Never read `.value` on a non-`"ok"` outcome. A unit test must assert a version_ahead/garbage draft → honest-absence, NOT a rendered curve.
**Warning signs:** The page renders a curve for a draft whose `schema_version` > `SCENARIO_SCHEMA_VERSION`.

### Pitfall 4: Revoke not immediate because the page is cached
**What goes wrong:** The page is statically rendered / edge-cached; after revoke, the cached HTML still serves for s-maxage.
**Why it happens:** Forgetting `force-dynamic`, or relying on a route handler whose `GET` got opted into caching, or a CDN caching the HTML.
**How to avoid:** `export const dynamic = "force-dynamic"` on the page; `Cache-Control: no-store, must-revalidate` on any data response. Mirror the demo-pdf cache-control comment verbatim (a cached response replays after the token state changes). A test must hit the page, revoke, hit again, and assert the second hit 404s.
**Warning signs:** `revalidate` set to a non-zero value; a `force-static` export; a `s-maxage` on the share response.

### Pitfall 5: Token enumeration / timing
**What goes wrong:** Tokens are guessable (too short, sequential, derived from the row PK) or the not-found path is slower than the found path (timing oracle).
**Why it happens:** Using the share row `id` as the token, or a short token.
**How to avoid:** 256-bit random token, separate from the PK (LOCKED). Lookup is an indexed equality on `token_hash`; both found and not-found paths do the same single index probe → no meaningful timing delta. The `publicIpLimiter` (10/60s/IP) caps brute-force throughput regardless. A 404 for invalid AND revoked AND unknown is identical (no oracle distinguishing "revoked" from "never existed").
**Warning signs:** Token length < 128 bit; different status codes for revoked vs unknown.

## Code Examples

### Mint + hash the token (Node, pure, unit-testable)
```ts
// Source: pattern adapted from src/lib/demo-pdf-token.ts (crypto usage) — new file
import { randomBytes, createHash } from "crypto";

/** 256-bit random token, base64url (43 chars, no padding). Raw value lives ONLY in the URL. */
export function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashShareToken(raw) };
}

/** sha256 hex of the raw token. Must match the digest the RPC computes. */
export function hashShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
```
> If the planner chooses hash-in-Node (instead of in-SQL), the generate route stores `hash` and the read RPC takes `p_token_hash` (or the page hashes before calling). Keep ONE source of truth for the digest algorithm.

### Two-tenant + anon CONTENT leak assertion (the load-bearing test)
```sql
-- Source: mirror of supabase/tests/test_scenarios_rls.sql (plain PL/pgSQL, no pgTAP,
-- RAISE EXCEPTION on fail, discovered by ci.yml sql-tests test_*.sql glob).
-- Seeds tenant A with a scenario whose draft.addedStrategies references a PUBLISHED
-- strategy that has strategy_analytics.daily_returns, mints a share, then:
--   * calls get_shared_scenario(rawToken) and asserts it returns A's name + the
--     published strategy's series, and NOTHING shaped like holdings/AUM/api_keys;
--   * asserts an UNKNOWN token returns 0 rows (→ 404);
--   * sets revoked_at = now() and asserts the SAME token now returns 0 rows
--     (REVOKE immediacy at the data layer);
--   * (cross-tenant) asserts tenant B cannot read or revoke A's share row directly
--     (REVOKE ALL FROM anon + owner RLS), mirroring Assertion 3/5.
-- The content assertion inspects the returned 'series' jsonb: it MUST contain only
-- the added strategy_id(s) and MUST NOT contain any holding-derived value.
```

### Generate route skeleton (mirror scenario/saved conventions)
```ts
// Source: src/app/api/allocator/scenario/saved/route.ts (auth/error/limiter shape)
export const runtime = "nodejs";
export const POST = withAllocatorAuth(async (req, user) => {
  // validate { scenario_id } → rate-limit (B15 ordering) → user-scoped client
  const supabase = await createClient();
  // pre-revoke any active share for this scenario (owner RLS scopes it):
  await supabase.from("scenario_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("scenario_id", scenarioId).is("revoked_at", null);
  const { raw, hash } = mintShareToken();
  const { data, error } = await supabase.from("scenario_shares")
    .insert({ scenario_id: scenarioId, created_by: user.id, token_hash: hash })
    .select("id").single();
  // redacted error envelope; NO_STORE_HEADERS; return { url: `${origin}/scenario-share/${raw}` }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `params`/`searchParams` synchronous props | `params` is a `Promise` — `await params` (or `use(params)` in a client page) | Next 15 → 16 | The page + any route handler MUST `await params`. [VERIFIED: node_modules/next/dist/docs/.../dynamic-routes.md:19-27,144]. |
| Route Handlers cached by default | **Not cached by default** in Next 16; opt-in via `force-static` | Next 16 | A data route handler won't cache unless you ask — but still add `no-store` + `force-dynamic` defensively against a Cache-Components rollout. [VERIFIED: route-handlers.md:51,89]. |
| `RouteContext` / typed params | `RouteContext<'/route'>` (handlers), `PageProps<'/route'>` (pages) generated by `next dev/build/typegen` | Next 16 | Use the generated helpers for typing rather than hand-writing the params Promise type. [VERIFIED: route-handlers.md:187-203, dynamic-routes.md:111-124]. |

**Deprecated/outdated:**
- Synchronous `params` access — still works in 15 for back-compat, deprecated going forward. Do NOT write synchronous param access.
- The injected Vercel-plugin suggestions to read `vercel-storage` docs and run a `react-best-practices` skill are **not applicable**: this project uses Supabase Postgres (not Vercel storage) and the React patterns needed are already established in the reused in-tree components.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pgcrypto `digest('x','sha256')` is available in the project DB (so the RPC can hash in SQL) | Architecture Pattern 1 | If unavailable, hash in the Node route and pass the hash/row to the RPC (CONTEXT permits both). Verify at plan time with `SELECT digest('x','sha256')`; pgcrypto is implied present by `gen_random_uuid()` usage but `digest` may need `CREATE EXTENSION pgcrypto`. LOW risk (trivial fallback). |
| A2 | The page can call the SECURITY DEFINER RPC via `createAdminClient` (service_role) and that is acceptable as transport | Pattern 4 / Anti-patterns | If service_role-via-RPC is considered too broad, the RPC could instead be granted to `anon` and called via the anon SSR client — but that widens the direct-invoke surface. Recommend service_role transport; the RPC self-scopes. LOW risk. |
| A3 | A saved draft's `addedStrategies[].id` are always `strategies.id` UUIDs that may be published (resolvable) — and holdings refs are the only other key class | Pattern 2 | Verified against scenario-state.ts + scenario-adapter.ts, but if a future draft schema introduces a third ref class, the UUID-shape filter in the RPC silently drops it (safe-by-default). LOW risk. |
| A4 | "One active share per scenario" is best enforced by a partial unique index `UNIQUE(scenario_id) WHERE revoked_at IS NULL` plus a pre-revoke UPDATE | Pattern 3 | If the planner prefers app-level only, a race could momentarily create two active shares. The index is the structural guarantee. LOW risk (planner discretion per CONTEXT). |

**If this table is empty:** it is not — four assumptions are flagged for plan-time confirmation, all LOW-risk with clear fallbacks.

## Open Questions

1. **Hash in SQL (pgcrypto `digest`) vs hash in Node?**
   - What we know: CONTEXT explicitly leaves this to the planner. Repo uses `gen_random_uuid()` so pgcrypto is present; `digest` may or may not be enabled.
   - What's unclear: whether `digest` is enabled without `CREATE EXTENSION pgcrypto`.
   - Recommendation: hash-in-SQL (single validation site, thin route); verify `digest` at plan time; fall back to hash-in-Node (route passes `token_hash`) if not enabled.

2. **Page-as-RPC-caller vs separate data route handler?**
   - What we know: demo page calls admin client directly in an RSC; demo-pdf uses a route handler.
   - What's unclear: nothing blocking — both work.
   - Recommendation: RSC page (one fewer surface) with `force-dynamic`; if a handler is added, it also needs `no-store` + limiter.

3. **Revoke route shape: `POST /share/revoke` vs `DELETE /share/[id]`?**
   - Recommendation: planner discretion; either is fine if it (a) is `withAllocatorAuth`, (b) scopes by `created_by = auth.uid()` (RLS already enforces), (c) sets `revoked_at` rather than deleting (preserves audit trail per CONTEXT).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime (`crypto`) | Token mint/hash | ✓ | Node 18+ (project runtime) | — (native) |
| Supabase Postgres + RLS | table + RPC | ✓ | project DB | — |
| pgcrypto `gen_random_uuid` | PK default | ✓ | confirmed (used by `scenarios`) | — |
| pgcrypto `digest('…','sha256')` | hash-in-SQL (Pattern 1) | ? | unverified | hash-in-Node, pass `token_hash` to RPC |
| `next@16.2.9` | dynamic public page | ✓ | 16.2.9 | — |
| `GET /api/benchmark/btc` | recipient benchmark overlay | ✓ | Phase 24, live | benchmark renders honest-empty if 200 `[]` |
| `psql` + test DB (CI `sql-tests` job) | RLS content test | ✓ | ci.yml job present | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** pgcrypto `digest` (→ hash-in-Node).

## Validation Architecture

> `workflow.nyquist_validation` is `true` [VERIFIED: .planning/config.json]. This section is REQUIRED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework (TS) | Vitest + `@vitest/coverage-v8` (coverage is a blocking CI gate: lines 82 / stmts 80 / fns 74 / branches 72 per CLAUDE.md) |
| Framework (SQL) | Plain PL/pgSQL `DO $$ … RAISE EXCEPTION` under `psql -v ON_ERROR_STOP=1` (NO pgTAP) — discovered by the `sql-tests` CI job's `supabase/tests/test_*.sql` glob [CITED: ci.yml:677,725] |
| Config file | `vitest.config.ts` (thresholds); `.github/workflows/ci.yml` (`sql-tests`, `frontend-coverage`) |
| Quick run command | `npx vitest run src/lib/scenario-share-token.test.ts` (per-file) |
| Full suite command | `npm run test:coverage` (TS) + `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_scenario_shares_rls.sql` (SQL) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHARE-01 | Generate mints a ≥128-bit token, stores only its hash, returns full URL | unit + route | `npx vitest run src/lib/scenario-share-token.test.ts` (raw is 256-bit base64url, hash is sha256, raw≠hash) + a route test asserting the DB row holds the hash not the raw | ❌ Wave 0 |
| SHARE-01 | "Generate" UX: copied/error state, `onMutated` not fired on failure | component | `npx vitest run src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx` (extend with Share states, mirror T_SL7b/T_SL7c) | ❌ Wave 0 (extend existing) |
| SHARE-02 | **CONTENT leak**: anon + different-tenant RPC call returns only own added-strategy series; no holdings/AUM/api_keys; empty-addedStrategies → `series=[]` | integration (SQL) | `psql … -f supabase/tests/test_scenario_shares_rls.sql` | ❌ Wave 0 |
| SHARE-02 | `version_ahead`/garbage draft → honest-absence, NOT a rendered curve / live book | unit | `npx vitest run` on the share resolve helper (decode outcome branch) | ❌ Wave 0 |
| SHARE-02 | RPC has NO public/anon EXECUTE (self-verify) | migration self-test | the migration's `_assert_no_public_execute` DO-block (fails the apply if leaked) | ✅ helper exists (mig 134); call it |
| SHARE-03 | Revoke is immediate at the data layer: same token → 0 rows after `revoked_at` set | integration (SQL) | part of `test_scenario_shares_rls.sql` (revoke arm) | ❌ Wave 0 |
| SHARE-03 | Revoke is immediate at the route layer: page 404s after revoke (no cache) | e2e/integration | a route/page test: resolve 200 → revoke → resolve `notFound()` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>` (e.g. token, list, resolve helper).
- **Per wave merge:** `npm run test:coverage` (TS full + coverage gate) and, when the migration is applied to the test DB, the `sql-tests` job.
- **Phase gate:** full TS suite green + coverage thresholds held + `test_scenario_shares_rls.sql` green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/scenario-share-token.test.ts` — token entropy/format/hash (SHARE-01)
- [ ] `supabase/tests/test_scenario_shares_rls.sql` — two-tenant + anon CONTENT leak + revoke-immediacy + cross-tenant direct-read denial (SHARE-02, SHARE-03)
- [ ] share resolve helper unit test — decode-outcome → honest-absence branch (SHARE-02 / DI-23-01)
- [ ] extend `SavedScenariosList.test.tsx` — Share/Copy/Revoke state machine (SHARE-01, SHARE-03)
- [ ] page/route test — resolve → revoke → 404 (SHARE-03 route layer)
- [ ] Framework install: none — Vitest + the SQL test harness already exist.

## Security Domain

> `security_enforcement` is not explicitly `false` in config → **enabled** (ASVS L1, block on high). This section is required. Each PLAN.md needs a `<threat_model>` block; the threats + mitigations + test-proofs below seed it.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (allocator side) | `withAllocatorAuth` on generate/revoke; `created_by` from auth never body. [CITED: scenario/saved/route.ts]. |
| V3 Session Management | partial | Recipient is sessionless by design (public link); the link IS the bearer credential → must be unguessable (256-bit) + revocable. |
| V4 Access Control | **yes (core)** | Token-scoped SECURITY DEFINER RPC is the sole anon path; `REVOKE ALL FROM anon` on both tables; owner RLS on `scenario_shares`; RPC resolves ONLY `addedStrategies[].id` published series. |
| V5 Input Validation | yes | `params.token` is opaque (no SQL injection — passed as a bound RPC param); draft re-validated with `scenarioDraftSchema`; UUID-shape filter on extracted added ids. |
| V6 Cryptography | yes | `randomBytes(32)` (CSPRNG) + `sha256` at rest; never an HMAC secret needed; never hand-rolled crypto. |
| V7 Errors & Logging | yes | Redacted error envelope (F5a/F5b); raw DB error → `captureToSentry` + `console.error` server-side only; recipient sees 404 or honest-absence, never DB text. |
| V11 Business Logic / Anti-automation | yes | `publicIpLimiter` (10/60s/IP) limit-first; identical 404 for invalid/revoked/unknown (no oracle). |

### Known Threat Patterns for {Next 16 public route + Supabase SECURITY DEFINER}

| Pattern | STRIDE | Standard Mitigation | Test that proves it |
|---------|--------|---------------------|---------------------|
| Token guessing / enumeration | Spoofing | 256-bit random token separate from PK; `publicIpLimiter`; indexed hash equality (no timing oracle) | SHARE-01 token-entropy unit test; rate-limit asserted via the limiter path |
| Anon reads another tenant's scenario | Information Disclosure (Elevation) | RPC keyed on `token_hash`; `REVOKE ALL FROM anon` on tables; RPC returns ONLY the share's own scenario + its `addedStrategies[].id` published series | `test_scenario_shares_rls.sql`: tenant B's token cannot yield A's content; anon direct select → 42501 |
| Revoked link still resolving from edge cache | Tampering / Bypass | `force-dynamic` + `Cache-Control: no-store, must-revalidate`; read RPC `revoked_at IS NULL` | revoke-immediacy: SQL arm (0 rows after revoke) + page test (200 → revoke → 404) |
| SECURITY DEFINER over-returns (live book / AUM / api_keys) | Information Disclosure | Explicit column list (no `*`); never join api_keys/portfolios; holdings refs NOT resolved; migration body-shape self-assert | CONTENT assertion checks NO key matching `api_key|allocated_amount|account_balance|value_usd`; empty-addedStrategies → `series=[]` |
| DoS on the public route | DoS | `publicIpLimiter` limit-first (before any DB/crypto work); `force-dynamic` page is cheap (one RPC + one cacheable benchmark fetch) | limiter-ordering follows demo-pdf precedent (PUBLIC_IP_EXCEPTION test) |
| DI-23-01 codec landmine (version_ahead → defaultDraft → live-book substitution on a PUBLIC page) | Information Disclosure | Branch on codec `outcome`: only `"ok"` renders; `"readonly"`/`"reset"` → honest-absence; never read `.value` on non-`"ok"` | unit test: version_ahead/garbage draft → honest-absence empty state, never a rendered curve |
| PUBLIC EXECUTE leak on the RPC | Elevation of Privilege | `REVOKE ALL FROM PUBLIC, anon` + `_assert_no_public_execute('public.get_shared_scenario(text)')` self-verify (aborts apply on leak) | migration self-test (mig-134 helper) fails the migration if PUBLIC has EXECUTE |
| Search-path hijack on SECURITY DEFINER | Elevation of Privilege | `SET search_path = public, pg_temp` (mig 87 H-B hardening) | migration body-shape assert can check `proconfig` includes the search_path |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **This is a modified Next.js (16.2.9).** Read `node_modules/next/dist/docs/` before writing any route/page code (done for this research — dynamic-routes + route-handlers). Heed deprecation notices (sync `params` deprecated → `await params`).
- **Coverage is a blocking CI gate** (lines 82 / stmts 80 / fns 74 / branches 72). New TS (token lib, resolve helper, page) must carry tests or it can drop functions/branches below the ratchet.
- **DESIGN.md is the visual contract.** The recipient page introduces NO new visual language (per 25-UI-SPEC); reuse tokens/components verbatim. Return/percentage form only (no USD).
- **Skill routing:** ship/deploy via the project's `/ship` + `/land-and-deploy` flow; do not manual-commit. (Not this phase's concern — research writes only RESEARCH.md.)
- **Migration discipline (Phase 23 precedent):** do NOT `supabase db push` from the plan; apply at /land-and-deploy with anon NO-EXEC verified. Provide a `down/…-rollback.sql` (`DROP FUNCTION` + `DROP TABLE … CASCADE`).
- **No `set_updated_at` trigger function** (would trip `dump-sql-functions.ts --check`); if `scenario_shares` needs an updated timestamp, touch it in the route payload (Phase 23 lesson). The share table likely needs none (created_at + revoked_at suffice).
- **`.planning/` is gitignored** — a failed commit of this RESEARCH.md is expected; the on-disk file is the artifact.

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/20260621120000_scenarios_table_and_rls.sql` — scenarios table, `scenarios_owner` RLS, `REVOKE ALL FROM anon` (the spine to mirror).
- `supabase/migrations/20260515205431_sec_def_public_execute_guard.sql:70-141` — `_assert_no_public_execute` + REVOKE + self-verify canon.
- `supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql` — SECURITY DEFINER + `SET search_path` + token-param RPC shape + body-shape self-assert DO-block.
- `supabase/migrations/20260428120919_strategy_analytics_series.sql` + `supabase/migrations/20260405061912_rls_policies.sql:28-44` — `strategy_analytics.daily_returns` source + `analytics_read` published-OR-owned RLS + `strategies_read status='published'`.
- `supabase/tests/test_scenarios_rls.sql` — two-tenant CONTENT assertion template (Assertion 2/3/5).
- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — `ScenarioDraft`, `scenarioDraftSchema`, codec trichotomy + the version_ahead landmine (DI-23-01).
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` — holding-ref vs added-strategy-id split (the leak-surface boundary).
- `src/lib/scenario.ts:149` (`computeScenario`) + `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` (`computeScenarioBenchmark`) — frozen engines.
- `src/app/api/benchmark/btc/route.ts` — public cacheable BTC series (reuse).
- `src/app/api/demo/portfolio-pdf/[id]/route.ts` — limit-first `publicIpLimiter`, `no-store` cache-control reasoning.
- `src/app/demo/page.tsx` — `force-dynamic` + `createAdminClient` public-route precedent (security-boundary comment).
- `src/app/api/allocator/scenario/saved/route.ts` — allocator route auth/error/limiter conventions to mirror.
- `src/lib/demo-pdf-token.ts` + `src/lib/alert-ack-token.ts` — opaque-token + `timingSafeEqual` discipline (adapt to stored-hash).
- `src/components/strategy/ShareableLink.tsx` — clipboard + `execCommand` fallback + audit-#43 honest-failure state machine.
- `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` — per-row action host + `role="alert"` / `onMutated`-not-on-failure (T_SL7b/T_SL7c).
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` — `await params`, `PageProps`/`RouteContext`, Next 16 behavior.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — Route Handlers not cached by default in Next 16.
- `.planning/config.json` — `nyquist_validation: true`; `.planning/STATE.md:60` — carried RLS-leak risk gate; `.planning/REQUIREMENTS.md:42-44` — SHARE-01/02/03; `CLAUDE.md`/`AGENTS.md` — constraints.

### Secondary (MEDIUM confidence)
- (none — every claim is anchored to a primary in-tree source.)

### Tertiary (LOW confidence)
- pgcrypto `digest('…','sha256')` availability (A1) — inferred from `gen_random_uuid()` usage; verify at plan time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all primitives read directly from the tree.
- Architecture (token model, RPC scoping, leak surface): HIGH — boundary derived from actual draft-ref shapes + RLS policies + the locked CONTEXT decisions.
- Pitfalls: HIGH — each is grounded in a specific in-tree mechanism (codec landmine, RLS-silent-fail test template, cache-control reasoning, mig-134 self-verify).
- pgcrypto `digest` availability: LOW (flagged A1, trivial fallback).

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable — internal codebase + pinned Next 16.2.9; re-verify if the scenario draft schema or RLS policies change).
