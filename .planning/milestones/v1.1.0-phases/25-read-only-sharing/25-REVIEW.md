---
phase: 25-read-only-sharing
reviewed: 2026-06-22T10:42:52Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql
  - supabase/schema/functions/get_shared_scenario.sql
  - src/lib/scenario-share-token.ts
  - src/app/api/allocator/scenario/share/route.ts
  - src/app/api/allocator/scenario/share/revoke/route.ts
  - src/app/scenario-share/[token]/page.tsx
  - src/app/scenario-share/[token]/share-resolve.ts
  - src/app/(dashboard)/allocations/components/SavedScenariosList.tsx
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 25: Code Review Report

**Reviewed:** 2026-06-22T10:42:52Z
**Depth:** deep
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 25 ("Read-Only Sharing") adds a revocable, hash-at-rest share-link
mechanism: a `scenario_shares` table, a single SECURITY DEFINER read RPC
(`get_shared_scenario`), a public sessionless recipient page, a pure resolve
layer with DI-23-01 honest-absence handling, owner-scoped generate/revoke
routes, and the SavedScenariosList Share affordance. The leak-defence
engineering is, for the most part, genuinely strong and well-tested: the RPC
returns an explicit 4-column projection, never references `api_keys` /
`portfolios` / `portfolio_strategies` (asserted by an in-migration body-shape
DO-block), filters `revoked_at IS NULL` + `status='published'`, runs with
`search_path = public, pg_temp`, is REVOKEd from PUBLIC/anon and self-verified
via `_assert_no_public_execute`. The public page is limit-first, hashes the
token before lookup, reads strictly via the RPC over a service_role transport,
is `force-dynamic` + `no-store`, renders return/percentage form only, and
correctly branches on the codec `outcome` so a non-"ok" decode yields
honest-absence (never a live-book substitution). The RLS test asserts content
BY FIELD, not row-count. The audit-action union and the Python parity list are
in sync; GDPR coverage adds `scenario_shares` with the correct CASCADE-erasure
allowlist and exports `token_hash` only as an opaque digest (no usable secret).

**However, the leak chain has one hole that breaks the phase's core promise.**
The share record carries NO binding between the share's `created_by` and the
referenced scenario's owner (`scenarios.allocator_id`). Neither the table
(no composite FK / CHECK / owner-coherence trigger), the RLS WITH CHECK (which
validates only `created_by = auth.uid()`), nor the read RPC (which joins only
`s.id = sh.scenario_id`) enforces that you may only share a scenario you own.
An authenticated allocator can mint a working public share link for ANY
scenario id — exposing another tenant's saved scenario name + draft (holdings
refs, weight overrides, fingerprint) + resolved published-strategy series.
This is CR-01 and must be fixed before ship.

Two of the warnings are correctness regressions that ship green: the
`has_active_share` UX plumbing is half-wired (the field is declared and read by
the component but never populated by the GET `/saved` route, so the Share state
silently resets to "no active share" on every page reload/refetch), and the
generate route's pre-revoke failure is conflated with insert failure into a
single 500 path without distinguishing the partial-write window.

## Critical Issues

### CR-01: Cross-tenant scenario disclosure — any allocator can mint a public share link for a scenario they do not own

**File:** `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:63-84,135-139`
(also `src/app/api/allocator/scenario/share/route.ts:162-170` and
`supabase/schema/functions/get_shared_scenario.sql:37-41`)

**Issue:** There is no ownership binding between a share row and the scenario it
points at. The data model and every gate in the chain enforce only
`created_by = auth.uid()` — they never check `scenarios.allocator_id = created_by`:

- Table: `scenario_id UUID NOT NULL REFERENCES scenarios ON DELETE CASCADE` —
  the FK checks the scenario EXISTS, not that the caller owns it. No composite
  FK to `(scenario_id, owner)`, no CHECK, no owner-coherence trigger (unlike the
  `allocator_holdings` f5 trigger the GDPR manifest cites for that table).
- RLS: `scenario_shares_owner ... WITH CHECK (created_by = auth.uid())` — passes
  for ANY `scenario_id` as long as `created_by` is the caller.
- RPC: `JOIN scenarios s ON s.id = sh.scenario_id WHERE sh.token_hash = ... AND sh.revoked_at IS NULL`
  — resolves the scenario with no `sh.created_by = s.allocator_id` predicate.

Attack: an authenticated allocator POSTs `/api/allocator/scenario/share` with a
victim's `scenario_id` (a UUID — scenario ids appear in the allocator's own
saved-list responses, compare panels, and are otherwise enumerable). The
pre-revoke matches 0 rows; the INSERT sets `created_by = attacker.id`,
`scenario_id = victim_id` (FK + WITH CHECK both pass); the route returns a
working `…/scenario-share/<raw>` URL. Loading it runs `get_shared_scenario`,
which returns the **victim's** scenario `name` + `draft` (holdings refs,
`weightOverrides`, `init_holdings_fingerprint`, `toggleByScopeRef`) +
`addedStrategies[].id` published series — to an anonymous recipient. The
`test_scenario_shares_rls.sql` honesty test never exercises this: it seeds each
tenant's share against its OWN scenario and tests anon-deny + A-cannot-revoke-B,
but never A-mints-a-share-for-B's-scenario.

This is the exact "malicious recipient with a valid token for their OWN scenario
trying to pivot to another tenant's data" threat the phase brief names — except
the pivot does not even require a recipient token; the attacker mints the link
directly.

**Fix:** Bind the share to a scenario the caller owns. Either of these closes it;
do both for defence-in-depth:

1. RLS WITH CHECK that the referenced scenario is owned by the caller:

```sql
CREATE POLICY scenario_shares_owner ON scenario_shares
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM scenarios s
      WHERE s.id = scenario_shares.scenario_id
        AND s.allocator_id = auth.uid()
    )
  );
```

2. Defence-in-depth in the RPC body — require the share creator to be the
   scenario owner so even a mis-inserted row cannot resolve:

```sql
  SELECT s.* INTO v_scenario
    FROM scenario_shares sh
    JOIN scenarios s
      ON s.id = sh.scenario_id
     AND s.allocator_id = sh.created_by   -- owner-coherence: the sharer owns the scenario
   WHERE sh.token_hash = p_token_hash
     AND sh.revoked_at IS NULL;
```

Add a `test_scenario_shares_rls.sql` assertion: tenant A inserts a share for
tenant B's scenario_id (forged JWT, authenticated role) — the INSERT must be
rejected by RLS (or, with the RPC-only fix, the resulting token must return 0
rows from `get_shared_scenario`). Pin it BY FIELD: B's name/draft must never
appear in a payload resolved from an A-created share.

## Warnings

### WR-01: `has_active_share` is never populated server-side — the Share/Copy/Revoke UI silently resets on every reload

**File:** `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx:38-46,172-176`
(root cause: `src/app/api/allocator/scenario/saved/route.ts:190-193`;
consumer: `src/app/(dashboard)/allocations/AllocationsTabs.tsx:789-791`)

**Issue:** `SavedScenarioListRow.has_active_share` is declared and read
(`hasActiveShare = shareActiveById[row.id] ?? row.has_active_share ?? false`),
and its docstring claims it is "Derived from the saved-scenarios payload … rather
than firing a per-row probe fetch (Plan 25-03)". But the GET `/api/allocator/scenario/saved`
SELECT is `id, name, schema_version, created_at, updated_at, draft` — it never
joins `scenario_shares` and never returns `has_active_share`. No route anywhere
populates it (`grep` confirms the only non-test reference is the component
itself). `AllocationsTabs.refetchSaved` sets `savedRows` straight from that
payload. Consequence: `row.has_active_share` is always `undefined`, so the
initial render of every row shows "Share" even when an active share exists; and
after any `onMutated()` refetch (which fires after a successful generate/revoke)
the local `shareActiveById` override survives but a full page reload loses all
session state and shows "Share" for rows that have a live, un-revoked link. The
user has no way to find/copy/revoke an existing share after a reload — they can
only re-generate (which the route handles via pre-revoke, so it is not a data
hazard, but it is a broken affordance and the comment is a false claim). The
component tests pass `has_active_share` directly as a prop, so the gap ships
green.

**Fix:** Populate the field in the GET `/saved` route. Either add a correlated
existence subquery / left-join against `scenario_shares` (active = `revoked_at
IS NULL`) and map it onto each row, e.g.:

```ts
// In the GET handler, after fetching scenarios:
const { data: activeShares } = await supabase
  .from("scenario_shares")
  .select("scenario_id")
  .is("revoked_at", null);
const activeSet = new Set((activeShares ?? []).map((r) => r.scenario_id));
const rows = (data ?? []).map((s) => ({ ...s, has_active_share: activeSet.has(s.id) }));
return NextResponse.json(rows, { status: 200, headers: NO_STORE_HEADERS });
```

(RLS already scopes both reads to the caller.) Then remove the "rather than
firing a per-row probe fetch" claim or update it to reflect the join.

### WR-02: Generate route conflates pre-revoke failure with insert failure and leaves a partial-write window

**File:** `src/app/api/allocator/scenario/share/route.ts:137-181`

**Issue:** The pre-revoke UPDATE and the INSERT are two non-atomic statements. If
the pre-revoke succeeds (the prior active share is now `revoked_at = now()`) but
the subsequent INSERT fails (e.g. transient 5xx, or a 23505 race against the
partial unique index), the route returns 500 and the scenario is left with NO
active share even though one existed a moment ago — the user's previously-shared
link is now dead with no replacement, and the UI (per WR-01) cannot even show
that it was revoked. The two failures also collapse to the identical opaque
"Couldn't create a share link" message, so an operator cannot tell a pre-revoke
failure from an insert failure in the response (they are distinguishable in logs,
but the partial-write state is silent to the user). This is a Rule 6 root-cause
gap: the "one active share" invariant is maintained by two independent writes
with no rollback.

**Fix:** Make the revoke+mint atomic. Preferred: a single SECURITY INVOKER RPC
(RLS-scoped) that revokes the prior active row and inserts the new one in one
statement/transaction, returning the new row id. Minimal alternative: rely on the
partial unique index as the single source of truth and INSERT first with
`ON CONFLICT (scenario_id) WHERE revoked_at IS NULL DO …` semantics, or wrap both
writes so a failed insert does not leave the prior link revoked. At minimum,
on insert failure after a successful pre-revoke, surface that the prior link was
already revoked (so the client can re-generate) rather than a generic retry.

### WR-03: Public recipient page calls `fetchBtcDaily()` against its own origin with no timeout — a slow/hung benchmark route stalls every anonymous render

**File:** `src/app/scenario-share/[token]/page.tsx:46,52-69,120`

**Issue:** After resolving the share, the page does
`await fetch(\`${APP_URL}/api/benchmark/btc\`)` with no `AbortController` /
timeout. `APP_URL` is `process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"`.
This is a server-side self-fetch on a `force-dynamic`, sessionless, public route
that is the phase's only anon entry point. If the benchmark route is slow or
hangs (cold start, downstream stall), every share-page render blocks on it; the
`catch` only handles thrown/`!res.ok`, not a hung socket. On a public page this
is a cheap DoS amplifier (each scraped token request holds a function instance
open). The limiter is per-IP and will not stop a distributed scrape from pinning
benchmark fetches. (Note: performance is out of v1 scope, but this is a
robustness/availability hole on the highest-exposure surface, not a perf-tuning
nit.)

**Fix:** Add an `AbortController` with a short timeout (e.g. 2-3 s) so a hung
benchmark fetch degrades to the honest "benchmark unavailable" empty state
(`[] → benchmarkAvailable=false`) the code already supports:

```ts
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 2500);
try {
  const res = await fetch(`${APP_URL}/api/benchmark/btc`, { signal: ctrl.signal });
  ...
} catch { return []; } finally { clearTimeout(t); }
```

### WR-04: `revoke` route returns 404 for a re-revoke (idempotency gap), and the audit/`revoked_count` can never exceed 1

**File:** `src/app/api/allocator/scenario/share/revoke/route.ts:104-128,133-138`

**Issue:** Revoke is `.eq("scenario_id").is("revoked_at", null).select("id")`. A
second revoke of the same scenario (double-click, retry, or a stale UI that still
shows Revoke) matches 0 rows and returns **404 "Share not found"** even though the
share was successfully revoked moments earlier. The intended semantics of SHARE-03
("revoke immediately, never resurrect") are idempotent — revoking an
already-revoked link should be a success, not a not-found. The current behaviour
surfaces a confusing error to the user for a no-op they meant to perform.
Separately, because the partial unique index guarantees at most one active share
per scenario, `metadata: { revoked_count: data.length }` can only ever be `1` —
the field is dead/misleading (it implies multi-revoke that the schema forbids).

**Fix:** Treat an already-revoked / no-active-share state as idempotent success
(return 200 `{ success: true }`) rather than 404, distinguishing only the
"scenario does not exist / not owned" case if you need a true 404 (which would
require a separate ownership probe and reintroduces the existence-oracle concern
the comment warns about — so simplest is: 0 rows revoked → 200 idempotent
no-op). Drop `revoked_count` or replace it with a boolean `was_active`.

### WR-05: `share-resolve` defaults a missing per-strategy weight to `0`, silently zeroing strategies out of the shared projection

**File:** `src/app/scenario-share/[token]/share-resolve.ts:144-167`

**Issue:** For each added strategy, `weights[id] = draft.weightOverrides[id] ?? 0`.
If a saved draft toggled a strategy ON (`toggleByScopeRef[id] !== false`, default
true) but carries no explicit `weightOverrides` entry for it (a legitimate state —
weights are an override map, not a complete map), the strategy is included as
selected but with weight `0`, so it contributes nothing to `computeScenario`. The
shared projection then silently misrepresents the saved scenario (a 2-strategy
blend renders as whatever the explicitly-weighted subset is, with the
zero-weighted strategy invisible — including its absence from the correlation
heatmap's effective contribution). Because the recipient cannot see the source
draft, there is no signal that the rendered projection differs from what the owner
saved. This is an honesty defect on a page whose entire value proposition is an
honest projection. (The unit test only exercises drafts where every added
strategy has an explicit weight, so the gap is not caught.)

**Fix:** Confirm the dashboard's own equal-weight / normalization default and
mirror it here rather than defaulting to `0`. If the composer treats a missing
override as equal-weight across selected strategies, apply the same rule in
`resolveSharedScenario`; if `0` is genuinely the engine's intended default for an
un-overridden selected strategy, add a test that pins the shared projection equals
the owner's saved projection for a mixed explicit/implicit-weight draft.

## Info

### IN-01: `force-dynamic` page imports `createAdminClient` which throws at module/build time if env is unset

**File:** `src/app/scenario-share/[token]/page.tsx:15,98`;
`src/lib/supabase/admin.ts:11-17`

**Issue:** `createAdminClient()` throws "Missing SUPABASE_SERVICE_ROLE_KEY for
admin operations" when the env is absent. It is called inside the request handler
(good — not at module load), and the page is `force-dynamic`, so a build-time
prerender should not invoke it. This is acceptable, but note that if
`SUPABASE_SERVICE_ROLE_KEY` is ever unset in a running environment the public
page throws an unhandled error rather than the neutral notFound()/try-again state
the rest of the route takes pains to render. Consider catching the construction
error and routing it to the same neutral "try again shortly" state as the
rate-limit branch, so a service-role misconfig does not leak a stack/500 to an
anonymous visitor.

### IN-02: SQL UUID-shape filter is lowercase-only while the TS `UUID_RE` is case-insensitive

**File:** `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:148-151`

**Issue:** The RPC's `addedStrategies[].id` filter uses
`~ '^[0-9a-f]{8}-…-[0-9a-f]{12}$'` (no case-insensitive flag), whereas
`src/lib/utils.ts:UUID_RE` is `/…/i`. `gen_random_uuid()` emits lowercase so this
is harmless today (and it is correctly defensive — it drops holdings/poison refs).
Flagged only so a future change that stores upper/mixed-case ids does not silently
drop legitimate strategies from the shared series. Either document the lowercase
invariant or use `~*` for parity with the TS regex.

### IN-03: `resolveSharedScenario` re-serializes the RPC's parsed JSONB only to have the codec re-parse it

**File:** `src/app/scenario-share/[token]/share-resolve.ts:114-118`

**Issue:** `codec.decode(JSON.stringify(row.draft))` round-trips the
already-parsed jsonb back to a string so the localStorage-shaped codec can parse
it again. The comment acknowledges this. It is correct and the cost is negligible,
but it couples the public read path to a codec whose contract is "decode a
localStorage string". A future codec change (e.g. a checksum envelope around the
stringified value) could silently break this re-serialization assumption. Low
priority; consider a thin `decodeParsed(obj)` codec entry point so the public path
does not depend on stringify/parse symmetry.

---

_Reviewed: 2026-06-22T10:42:52Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
