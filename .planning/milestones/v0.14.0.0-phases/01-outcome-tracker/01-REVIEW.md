---
phase: 01-outcome-tracker
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - supabase/migrations/059_bridge_outcomes.sql
  - supabase/migrations/060_bridge_outcome_cron.sql
  - src/lib/audit.ts
  - src/lib/queries.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/bridge-outcome-label.ts
  - src/lib/bridge-outcome-label.test.ts
  - src/lib/bridge-outcome-schema.ts
  - src/lib/gdpr-export.ts
  - src/app/api/bridge/outcome/route.ts
  - src/app/api/bridge/outcome/route.test.ts
  - src/app/api/bridge/outcome/dismiss/route.ts
  - src/app/api/bridge/outcome/dismiss/route.test.ts
  - src/__tests__/bridge-outcomes-rls.test.ts
  - src/__tests__/bridge-outcome-cron.test.ts
  - src/app/(dashboard)/allocations/AllocationDashboard.tsx
  - src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx
  - src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx
  - src/app/(dashboard)/allocations/components/AllocatedForm.tsx
  - src/app/(dashboard)/allocations/components/RejectedForm.tsx
  - src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx
  - e2e/bridge-outcome.spec.ts
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 1 (Outcome Tracker) is architecturally sound. The security perimeter
— CSRF, auth, rate-limit, Zod, RLS WITH CHECK, no-DELETE append-only
invariant — is correctly layered. The migration SQL is internally
consistent, the cron math is correct, and test coverage is wide enough
that the critical paths are exercised.

There is **one Critical finding**: the dismiss route has no `X-CSRF-Token`
fallback path and relies entirely on `Origin` header checking. More
importantly, the dismiss `upsert` does not set a new `dismissed_at` value
when bumping an existing row — the column retains the original timestamp
while only `expires_at` advances. This is a logic correctness bug: on a
re-dismiss the constraint `expires_at > dismissed_at` still passes, but
`dismissed_at` silently lies about when the most recent snooze was
initiated, which matters for any future analytics on dismissal frequency.

Four warnings cover: an HTML syntax error in `AllocationDashboard.tsx`
(unclosed `<>` fragment), a subtle insert-vs-update heuristic that breaks
on the same clock tick, a missing Zod 400 test for the dismiss route, and
the `getMyAllocationDashboard` admin client reaching `bridge_outcomes`
without the RLS allocator filter that the user-scoped client would enforce.

---

## Critical Issues

### CR-01: Dismiss upsert does not refresh `dismissed_at` on re-dismiss

**File:** `src/app/api/bridge/outcome/dismiss/route.ts:63-73`

**Issue:** When a user clicks dismiss a second time (re-snooze before the
24-hour TTL expires), the upsert on the unique `(allocator_id, strategy_id)`
index updates only the computed `expiresAt` value. The `dismissed_at`
column — which `DEFAULT now()` captures on the initial INSERT — is never
touched on the conflicting UPDATE. PostgREST's upsert only writes the
columns explicitly listed in the payload; columns absent from the object
retain their current DB value.

The consequence is that after re-dismissal `dismissed_at` reflects the
*first* dismiss time, not the latest. The CHECK constraint
`expires_at > dismissed_at` still passes, but any downstream query that
derives "time since last snooze" from `dismissed_at` (e.g., a future
analytics query or a stricter TTL check) will silently use the wrong
anchor. This is a data-integrity bug.

**Fix:** Include `dismissed_at` explicitly in the upsert payload so the
UPDATE path refreshes it:

```typescript
const now = new Date();
const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

const { data: inserted, error } = await supabase
  .from("bridge_outcome_dismissals")
  .upsert(
    {
      allocator_id: user.id,
      strategy_id: parsed.data.strategy_id,
      dismissed_at: now.toISOString(),   // refresh on every upsert
      expires_at: expiresAt,
    },
    { onConflict: "allocator_id,strategy_id" },
  )
  .select("id, expires_at")
  .single();
```

---

## Warnings

### WR-01: Unclosed JSX fragment causes invalid HTML in AllocationDashboard

**File:** `src/app/(dashboard)/allocations/AllocationDashboard.tsx:447-453`

**Issue:** The JSX fragment `<>` opened at line 447 wraps `<AlertBanner>`
and then `<main>`. However the closing `</>` is at line 540 — which is
correct — but the opening `<AlertBanner>` element sits *outside* the
`<main>` element while the `<AlertBanner />` self-closing tag appears
before the `<main>` opening tag. The structure renders as:

```jsx
<>
  <AlertBanner portfolioId={portfolio.id} />
  <main ...>
    ...
  </main>
</>
```

This is actually valid JSX, but the indentation at lines 451-453 makes it
appear that `<AlertBanner>` is a sibling to `<main>` with `<main>` not
wrapped by the fragment — the `<main>` open tag has no closing `>` on the
same line and the code formatter has left it ambiguously indented. A
reviewer or future author could easily lose the structural context.

More concretely: the `<AlertBanner>` component renders *outside* of the
`ref={dashboardContainerRef}` div that drives the `IntersectionObserver`
for `widget_viewed` events. That is probably intentional (the alert banner
is not a widget), but the nesting should be made explicit.

**Fix:** Close the fragment explicitly and add a comment to clarify intent:

```tsx
return (
  <>
    {/* Alert banner renders above the padded main content column intentionally */}
    <AlertBanner portfolioId={portfolio.id} />
    <main ref={dashboardContainerRef} className="max-w-[1280px] mx-auto p-6 pb-20">
      {/* ... */}
    </main>
  </>
);
```

### WR-02: Insert-vs-update heuristic is unreliable at sub-millisecond resolution

**File:** `src/app/api/bridge/outcome/route.ts:188-191`

**Issue:** The `isInsert` detection compares `inserted.created_at` to
`inserted.updated_at` via strict string equality:

```typescript
const isInsert =
  typeof inserted.created_at === "string" &&
  typeof inserted.updated_at === "string" &&
  inserted.created_at === inserted.updated_at;
```

The trigger `bridge_outcomes_set_updated_at_trigger` fires `BEFORE UPDATE`
and sets `NEW.updated_at := now()`. On a true insert, `created_at` and
`updated_at` are both set to `DEFAULT now()` in the same statement
evaluation — they will be the same value. On an update the trigger fires
and the two diverge.

The fragility: `now()` in Postgres returns the transaction start time, not
wall-clock time. If a client POSTs twice in the *same transaction* (or if
the application somehow issues two upserts within the same database
transaction), both `created_at` and `updated_at` will be identical even
on the second call, causing the audit action to misfire as
`bridge_outcome.record` instead of `bridge_outcome.update`.

In normal operation (one HTTP request = one transaction) this is safe.
The risk surfaces in tests that call the function directly without going
through HTTP, or in future batch-insert paths.

**Fix:** The cleanest fix is a DB-level `xmax` check to distinguish INSERT
from UPDATE (a `xmax = 0` means the row was just inserted) or to add a
dedicated boolean `just_inserted` to the RETURNING clause via a generated
column. A pragmatic TS-only fix is to add a dedicated column like
`inserted_at` that is only set on INSERT (never touched by the trigger),
so the comparison is reliable. Alternatively, document the limitation
inline so it is not silently depended on:

```typescript
// NOTE: This relies on same-tx equality of created_at/updated_at.
// Postgres sets both to now() on INSERT; the BEFORE UPDATE trigger
// then diverges updated_at. Reliable in single-statement HTTP paths.
// Do NOT use in batch or direct-DB contexts.
```

### WR-03: `getMyAllocationDashboard` fan-out uses admin client for `bridge_outcomes` without scoping to the target user

**File:** `src/lib/queries.ts:700-706`

**Issue:** The fan-out SELECT for `bridge_outcomes` uses the `admin` client:

```typescript
admin
  .from("bridge_outcomes")
  .select("id, strategy_id, kind, ...")
  .eq("allocator_id", userId),
```

The admin client bypasses RLS. The query is correctly filtered by
`.eq("allocator_id", userId)`, so no cross-user data leaks in practice.
However, using the admin client here is inconsistent with the project's
security convention: data reads that are naturally scoped to the calling
user should use the user-scoped client so that RLS acts as a second gate.

If the `.eq("allocator_id", userId)` filter were accidentally dropped (e.g.,
during a refactor that passes a different `userId` param or omits the filter),
the admin client would silently return all allocators' outcomes. A user-
scoped client would return zero rows without the filter, failing loudly in
tests and in production.

The same concern applies to the `match_decisions` and
`bridge_outcome_dismissals` fan-outs at lines 695-712, but `bridge_outcomes`
is the most sensitive because it contains self-reported financial data.

**Fix:** Use the user-scoped `supabase` client for these three fan-out selects.
The `strategy_analytics` fan-out at lines 660-686 legitimately requires the
admin client (column-level REVOKE on `daily_returns`), but the outcome
eligibility fan-outs do not access any RLS-revoked columns:

```typescript
// Use user-scoped client — RLS provides a second ownership gate
supabase
  .from("bridge_outcomes")
  .select("id, strategy_id, kind, ...")
  .eq("allocator_id", userId),
```

### WR-04: Missing Zod 400 test for `POST /api/bridge/outcome/dismiss`

**File:** `src/app/api/bridge/outcome/dismiss/route.test.ts`

**Issue:** The dismiss route test file covers TC1 (happy path), TC2 (401),
and TC3 (429). It is missing a test for the 400 path — specifically when
`strategy_id` is not a valid UUID (the only Zod field). The outcome route
test (route.test.ts) has a matching TC6a for the same scenario. Without a
400 test, a future change that accidentally removes or weakens the UUID
validation on the dismiss route would not be caught.

**Fix:** Add a TC4 to `dismiss/route.test.ts`:

```typescript
it("TC4 — 400 Zod: invalid strategy_id → issues array", async () => {
  const { POST } = await import("./route");

  const res = await POST(makeRequest({ strategy_id: "not-a-uuid" }));

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("Invalid request body");
  expect(Array.isArray(body.issues)).toBe(true);
});
```

---

## Info

### IN-01: `bridge-outcome-schema.ts` is documented as a mirror but has no enforcement mechanism

**File:** `src/lib/bridge-outcome-schema.ts:7-10`

**Issue:** The comment states "Both copies must stay in sync — the route is
authoritative; this module is the consumer-facing mirror." There is no test,
CI check, or ESLint rule that fails when the schema diverges. If a developer
adds a new `rejection_reason` enum value to the route's `BODY_SCHEMA`, the
`REJECTION_REASONS` array here will silently lag behind until a user sees a
form validation mismatch.

**Fix:** Either (a) move the canonical enum and schema to `bridge-outcome-schema.ts`
and `import` it from the route (eliminating the duplication), or (b) add a
unit test that imports both and asserts equality. Option (a) is cleaner:

```typescript
// In route.ts — import instead of re-declaring:
import { REJECTION_REASONS, ALLOCATED_FIELDS, REJECTED_FIELDS } from "@/lib/bridge-outcome-schema";
```

### IN-02: `compute_bridge_outcome_deltas` uses `COALESCE` to preserve stale deltas on partial re-compute

**File:** `supabase/migrations/060_bridge_outcome_cron.sql:199-204`

**Issue:** The UPDATE inside `compute_bridge_outcome_deltas` uses `COALESCE`
to keep old values when the new computation produces NULL:

```sql
SET
  delta_30d  = COALESCE(c.d30,  bo.delta_30d),
  delta_90d  = COALESCE(c.d90,  bo.delta_90d),
  delta_180d = COALESCE(c.d180, bo.delta_180d),
```

This means: if a strategy's 90-day data was previously computed but the
`returns_series` has since been truncated (removing those dates), the old
`delta_90d` survives rather than going NULL. The UI would show a stale
realized delta rather than reverting to Pending.

This is probably acceptable as a design choice (data truncation in
`returns_series` should be rare), but it is undocumented and could surprise
operators who truncate series to correct bad data and expect deltas to
revert.

**Fix:** Document the COALESCE intent explicitly in the migration comment,
or add a `needs_recompute = TRUE` escape hatch that bypasses COALESCE and
writes the raw value (including NULL):

```sql
-- COALESCE intentionally preserves prior realized deltas when the current
-- series window is not yet wide enough to recompute them. This means a
-- truncated returns_series will NOT clear existing deltas. To force a
-- NULL-reset, set needs_recompute = TRUE AND manually NULL the delta columns.
```

### IN-03: `OutcomeRecordedRow` renders `outcome.percent_allocated` without a null guard

**File:** `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx:72-73`

**Issue:** The "Allocated" branch renders `{outcome.percent_allocated}%`
without a null check:

```tsx
<span className="font-metric tabular-nums">{outcome.percent_allocated}%</span>
```

`RecordedOutcome.percent_allocated` is typed as `number | null`. When the
server returns a row where `percent_allocated` is somehow null for an
`allocated` outcome (which the DB CHECK prevents, but the TypeScript type
allows), the render will produce `null%` or `0%` in the UI.

The DB CHECK constraint (`bridge_outcomes_kind_fields_valid`) prevents this
at the database layer, so this is defence-in-depth rather than a live bug.

**Fix:**

```tsx
<span className="font-metric tabular-nums">
  {outcome.percent_allocated != null ? `${outcome.percent_allocated}%` : "—"}
</span>
```

### IN-04: E2E tests share a single seeded allocator account across all three tests — parallel runs will conflict

**File:** `e2e/bridge-outcome.spec.ts:22-111`

**Issue:** All three E2E tests (`allocated`, `rejected`, `dismiss`) log in
as the same `SEEDED_ALLOCATOR_EMAIL` account and rely on that account having
at least one strategy with `eligible_for_outcome=true`. The first test
(`allocated`) will record an outcome, which sets `eligible_for_outcome=false`
for that strategy. The second test (`rejected`) then runs against the same
account and may find no eligible rows, causing it to fail with a missing
banner.

If tests run in sequence (Playwright's default), the first test's recorded
outcome persists and the second test starts with a stale state. If tests run
in parallel, the race condition is worse.

**Fix:** Either (a) use `test.use({ storageState: ... })` with separate seeded
accounts per test, or (b) add a `beforeEach` that resets the seeded account's
outcome rows via an API call:

```typescript
test.beforeEach(async ({ request }) => {
  // Reset: delete bridge_outcomes + bridge_outcome_dismissals for the seeded account
  // via a test-only admin API endpoint (or direct Supabase service-role call).
  await request.delete("/api/test/reset-outcomes", { ... });
});
```

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
