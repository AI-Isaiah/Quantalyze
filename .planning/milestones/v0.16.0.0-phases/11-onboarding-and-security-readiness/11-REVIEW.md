---
phase: 11-onboarding-and-security-readiness
reviewed: 2026-04-26T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - .github/workflows/ci.yml
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_job_worker_first_sync_marker.py
  - e2e/helpers/cleanup-test-project.ts
  - e2e/helpers/seed-test-project.ts
  - e2e/onboarding-banner-smoke.spec.ts
  - e2e/onboarding-funnel.spec.ts
  - src/__tests__/migration-084-trigger.test.ts
  - src/__tests__/widget-state-no-duplicate-empty.test.ts
  - src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx
  - src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx
  - src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx
  - src/app/(dashboard)/allocations/components/OnboardingBanner.tsx
  - src/app/(dashboard)/allocations/components/WidgetState.test.tsx
  - src/app/(dashboard)/allocations/components/WidgetState.tsx
  - src/app/(dashboard)/allocations/page.tsx
  - src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.tsx
  - src/app/(dashboard)/allocations/widgets/__tests__/widget-states.test.tsx
  - src/app/(dashboard)/profile/components/AuditLogSubsection.test.tsx
  - src/app/(dashboard)/profile/components/AuditLogSubsection.tsx
  - src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx
  - src/app/api/allocator/scenario/commit/route.test.ts
  - src/app/api/allocator/scenario/commit/route.ts
  - src/app/api/match/decisions/holding/route.admin-rls.regression-1.test.ts
  - src/app/api/match/decisions/holding/route.test.ts
  - src/app/api/match/decisions/holding/route.ts
  - src/app/api/me/audit-log/export/route.test.ts
  - src/app/api/me/audit-log/export/route.ts
  - src/app/security/page.test.tsx
  - src/app/security/page.tsx
  - src/components/auth/ProfileTabs.test.tsx
  - src/components/auth/ProfileTabs.tsx
  - src/lib/admin/usage-metrics.ts
  - src/lib/analytics/onboarding-funnel.test.ts
  - src/lib/analytics/onboarding-funnel.ts
  - src/lib/analytics/usage-events-types.ts
  - src/lib/audit-log-csv.test.ts
  - src/lib/audit-log-csv.ts
  - src/lib/queries.mandateIsSet.test.ts
  - src/lib/queries.ts
  - src/lib/widget-state-flag.test.ts
  - src/lib/widget-state-flag.ts
  - supabase/migrations/084_first_api_key_added_trigger.sql
findings:
  critical: 0
  warning: 5
  info: 7
  total: 12
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-26T00:00:00Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Phase 11 ships seven plans covering onboarding-funnel analytics, the audit-log
CSV export, and several security-readiness UI surfaces. Overall the work is in
good shape: migration 084 is well-structured and idempotent, RFC 4180 escaping
is correct, the route handlers add proper non-blocking analytics stamps, and
the WidgetState primitive correctly enforces statelessness.

No Critical bugs or security holes found. All findings are Warnings or Info.

The most important Warnings:

1. **CSV-injection on export** — `serializeAuditLogCsv` deliberately does not
   prefix risky lead chars (`=`, `+`, `-`, `@`, TAB) with a single-quote.
   Comments say this is intentional ("parse-side guard's job"), but the file
   downloaded by an authenticated user is opened in Excel/Sheets/Numbers, not
   re-parsed by `csv.ts`. A malicious `action` or `metadata` value can execute
   on open. Excel/Sheets recommend export-side prefixing.
2. **CI gate falls through `if: false` paths silently** — the build-with-test-
   env step (lines 149-158) and the run-onboarding-funnel-spec step (lines 159-
   182) both gate on `vars.E2E_TEST_DB_CONFIGURED == 'true'`. That's correct
   per the requirement, but the build step does not produce any artifact
   the gated run-spec step relies on; it only sets env at build time. Worth
   confirming Next.js build output isn't getting silently overwritten between
   the two `npm run build` invocations.
3. **`isoWeekString` mutates its computed `Date`** — small bug: `d.setUTCDate
   (d.getUTCDate() + 4 - dayNum)` correctly shifts to ISO Thursday, but
   subsequent code reads `d.getUTCFullYear()` to get the ISO-year. This matches
   the spec for most dates. The Sun 2023-12-31 test case validates it. Low risk
   but worth a sanity check on year-boundary dates.
4. **OnboardingBanner uses `<h3>` heading inside a banner-like container** —
   semantic heading-level concern; the banner is a section-level surface but
   uses `<h3>`, leaving an h2-level gap on the page.
5. **`maybeEmitFirstBridgeSurfaced` may double-fire under burst/concurrent
   page loads** — single-fire is enforced via the `*_emitted_at` sentinel,
   but the read-then-write is not atomic. Two parallel `/allocations`
   requests can both observe absent sentinel and both fire.

## Warnings

### WR-01: CSV formula injection on export (security UX)

**File:** `src/lib/audit-log-csv.ts:73-78` and `src/lib/audit-log-csv.ts:99-118`
**Issue:** The `escapeCsvValue` helper enforces RFC 4180 quoting (comma, quote,
CR, LF) but does NOT prefix formula-injection lead chars (`=`, `+`, `-`, `@`,
TAB, CR). The comment block at lines 26-33 explicitly states this is
intentional ("parse-side guard's job"), but this CSV is **downloaded** by the
allocator — its consumer is Excel / Google Sheets / Numbers, not the
project's own `csv.ts` parse path. If any `action` or `metadata` value
contains attacker-controlled content (e.g., a metadata field copied from a
user-supplied note in another flow), opening the CSV can execute formulas.
The audit-log itself is RLS-isolated to the user, so the blast radius is the
user's own machine — but a phishing scenario where a user is tricked into
forwarding their CSV to a third party (compliance team, accountant) extends
the blast radius. OWASP CSV injection guidance recommends export-side
prefixing.

**Fix:** Add a sibling helper that neutralizes formula-injection chars, then
apply it inside `serializeAuditLogCsv` before `escapeCsvValue`:

```ts
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function neutralizeFormulaPrefix(value: string): string {
  // Excel / Sheets execute formulas when a cell starts with =, +, -, @,
  // TAB, or CR. Prefix a single-quote so the cell renders as the literal
  // string. Recipients who legitimately wanted a formula get a one-character
  // fix on their end.
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

// In serializeAuditLogCsv:
return [
  row.created_at,
  escapeCsvValue(neutralizeFormulaPrefix(row.action)),
  escapeCsvValue(neutralizeFormulaPrefix(row.entity_type)),
  row.entity_id ? neutralizeFormulaPrefix(row.entity_id) : "",
  escapeCsvValue(neutralizeFormulaPrefix(summary)),
].join(",");
```

The `created_at` cell (ISO timestamp) is exempt because it never starts
with a formula char. Also update the test at
`src/lib/audit-log-csv.test.ts:53-58` to reflect the new behaviour
(the comment claims "does NOT strip lead chars — parse-side guard's
job"; that's the assumption the fix flips).

---

### WR-02: `maybeEmitFirstBridgeSurfaced` race window enables duplicate fires

**File:** `src/lib/analytics/onboarding-funnel.ts:200-233`
**Issue:** All five emitter helpers use the read-then-write pattern: read
metadata, check sentinel absent, fire PostHog, write sentinel. This is
non-atomic. Two parallel `/allocations` requests for the same user (e.g.
prefetch + user navigation) can both observe the sentinel absent and both
fire. The module docstring at line 30 acknowledges the at-least-once
semantics ("Pitfall 3"), but the deduplication relies on PostHog's server-
side `(distinct_id + event + properties)` dedupe — which is only
approximate (PostHog dedupes on `event_id`, not on a property hash). For
the four passive markers (signup / first_api_key_added / first_sync_success
/ first_outcome) the property bag includes the immutable `stamped_at`
timestamp, so the duplicate event will share an identical property bag
and PostHog dedupe kicks in. But for `maybeEmitFirstBridgeSurfaced`, the
`stamped_at` is *generated* at call time when the marker is absent (line
209-210: `meta.first_bridge_surfaced_at ?? new Date().toISOString()`),
so two parallel calls produce two different `stamped_at` values, which
breaks PostHog's content-hash dedupe.

This is a low-impact analytics quality issue (duplicate funnel events
inflate one cell of one cohort), not a security or correctness bug, but
the helper deserves the same single-fire discipline as the others.

**Fix:** Compute the `stamped_at` deterministically (e.g. from the user's
auth.users created_at when the marker hasn't been written), or write the
`first_bridge_surfaced_at` stamp via a SECURITY DEFINER RPC that uses
`COALESCE` like `stamp_first_sync_success` does. The cleanest fix
mirrors migration 084:

```sql
CREATE OR REPLACE FUNCTION public.stamp_first_bridge_surfaced(p_user_id UUID)
RETURNS TIMESTAMPTZ ...
```

Returns the stamp (whether new or existing). The TS helper then reads the
returned stamp and uses it as the `stamped_at` property — both racing
callers observe the same value, PostHog dedupe holds.

---

### WR-03: `OnboardingBanner` heading level is `h3` with no surrounding `h2`

**File:** `src/app/(dashboard)/allocations/components/OnboardingBanner.tsx:67-74`
**Issue:** The banner renders `<h3 id="onboarding-banner-heading">Connect
your exchange to see real performance</h3>`. On `/allocations` the page
has the `<h1>My Allocation</h1>` in `AllocationsTabs.tsx:360` and no
sibling `<h2>` precedes the banner — the banner is the first heading
after the page title. Skipping a heading level (h1 → h3) is a WCAG 1.3.1
violation: screen readers using heading-level navigation will see a
gap. Existing peers in this codebase (`MandateQuickSetCard.tsx:144` uses
`<h2>`, `AuditLogSubsection.tsx:73` uses `<h2>`) all use `<h2>` for
section-level subsection headings.

**Fix:** Change `h3` to `h2` (the banner is a top-level subsection on
the page; nothing else uses `h2` ahead of it):

```tsx
<h2
  id="onboarding-banner-heading"
  className="text-lg font-semibold text-text-primary leading-snug"
>
  Connect your exchange to see real performance
</h2>
```

Update the existing assertion in `OnboardingBanner.test.tsx:101-103` (which
selects `h3#onboarding-banner-heading`) to match.

---

### WR-04: CI workflow re-runs `npm run build` with different env between two gated steps

**File:** `.github/workflows/ci.yml:149-182`
**Issue:** Step 1 (line 149-158) builds with the placeholder Supabase env,
then later step 2 (line 159-172) re-runs `npm run build` with the
TEST_SUPABASE secrets, then starts the server. But Next.js build output
in `.next/` is reused by `npm run start`. Since the BLOCK-3 gated step
is conditional on `vars.E2E_TEST_DB_CONFIGURED == 'true'`, when the gate
is true the build is run twice — first with placeholder env (line 112-119,
unconditional), then with test-DB env (line 149-158, gated). The second
build overwrites the first. Then the unconditional smoke-spec step (line
120-140) runs *after* the gated rebuild, so its `npm run start` would now
serve the test-DB-flavoured build, not the placeholder build it expects.

Wait — re-reading: step at line 120 runs the smoke specs FIRST (unconditional),
then steps at 149-182 run conditionally AFTER. Order is OK.

But: when the gate is true, line 149-158 runs `npm run build` again on top
of the already-built `.next/`. Some build artifacts may be written
incrementally — env vars baked into the build (`NEXT_PUBLIC_*`) are
embedded by `next build` and would be re-baked. This is the *intended*
behaviour. However, the second `npm run start` at line 161-172 doesn't
explicitly stop / clean up; if the smoke-spec server (line 122) didn't
fully shut down, the gated step's `npm run start &` would race the port
or simply fail.

Actual concern: line 132 (`kill $SERVER_PID 2>/dev/null || true`) — the
`|| true` swallows any kill failure. If the smoke server didn't shut down
in time, line 162's `npm run start &` would exit non-zero on EADDRINUSE
and Playwright would never run, but the step might still appear green
because of how the `for` loop at line 164-170 falls through on timeout.

**Fix:** Add an explicit `wait $SERVER_PID 2>/dev/null || true` after the
kill at line 133 and again at line 172 to ensure the previous server has
actually exited before the next step starts a new one. Also consider
splitting the gated build + serve into a separate job that uses
`needs: e2e` if you want strict sequencing.

---

### WR-05: `seedBridgeCandidate` in fork-PR seed helpers — module-load side-effect surface

**File:** `e2e/helpers/seed-test-project.ts:51-84`
**Issue:** The module docstring at lines 11-13 promises "Required env (asserted
at call time, not module load — module load MUST stay side-effect-free so
that the smoke spec which never imports this file isn't accidentally affected)."
The module honors that contract — `getAdmin()` is called only inside
`seedTestAllocator()` and `seedBridgeCandidate()`. Good.

However, `seed-test-project.ts:33` — the error message inside `getAdmin()`
("spec must skip when secrets absent (D-16 / BLOCK-3 vars.E2E_TEST_DB_CONFIGURED)")
is a useful breadcrumb but the helper does not double-check that the URL
points at a non-prod project. The `SAFETY NOTE` comment at lines 16-23
puts the responsibility on the human: "If a developer accidentally sets
them to production values, this module will mutate production data." A
defense-in-depth check would be cheap to add.

**Fix:** Reject obvious prod URLs at the top of `getAdmin()`:

```ts
function getAdmin(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[seed-test-project] TEST_SUPABASE_URL or TEST_SUPABASE_SERVICE_ROLE_KEY missing — " +
        "spec must skip when secrets absent (D-16 / BLOCK-3 vars.E2E_TEST_DB_CONFIGURED).",
    );
  }
  // Defense-in-depth: refuse to seed against the known production project.
  // The production Supabase project ref is well-known and the URL pattern
  // is deterministic.
  const PROD_PROJECT_REFS = ["YOUR-PROD-REF-HERE"]; // populate from infra inventory
  for (const ref of PROD_PROJECT_REFS) {
    if (url.includes(`${ref}.supabase.co`)) {
      throw new Error(
        `[seed-test-project] refusing to seed against production project ref ${ref}. ` +
          `Set TEST_SUPABASE_URL to the dedicated test Supabase project, not prod.`,
      );
    }
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
```

Also: the seeded allocator email pattern `e2e-onboarding-${Date.now()}@example.com`
uses `@example.com`, a real (Reserved/IANA) domain. If a real-time email
verification check fires anywhere, this could generate noise. Switch to a
guaranteed-unrouted domain like `@example.test` (already used in
`audit-log/export/route.test.ts`) or `@e2e.test.invalid`.

## Info

### IN-01: Consider extracting the `setState-in-effect` post-mount-read pattern into a shared hook

**File:** `src/app/(dashboard)/allocations/components/OnboardingBanner.tsx:33-52`
**Also:** `src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx:52-67`
**Also:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:236-244`
**Issue:** Three sites all use the same pattern: `useState(false)` then a
`useEffect(() => { setState(localStorage flag) }, [])`. Each disables a
lint rule with the same justification ("setState-in-effect is intentional
and bounded — fires AT MOST ONCE on mount"). The duplication is small
but reusing a `useSessionStorageBoolean(key)` helper would consolidate the
pattern, improve testability, and remove the per-site eslint-disable
comments.

**Fix:** Add `src/lib/hooks/useSessionStorageBoolean.ts`:

```ts
"use client";
import { useEffect, useState } from "react";

export function useSessionStorageBoolean(
  key: string,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(key) === "1") setValue(true);
    } catch {}
  }, [key]);
  const set = (next: boolean) => {
    try {
      if (next) sessionStorage.setItem(key, "1");
      else sessionStorage.removeItem(key);
    } catch {}
    setValue(next);
  };
  return [value, set];
}
```

Then `OnboardingBanner` and `MandateQuickSetCard` consume the hook and
shed both the local `useState` + `useEffect` and the eslint-disable.

---

### IN-02: `WidgetState` mode='partial' renders `aria-hidden` on a positioned child without keyboard alternative

**File:** `src/app/(dashboard)/allocations/components/WidgetState.tsx:96-110`
**Issue:** The partial-mode pill renders an `aria-hidden="true"` chip
absolutely positioned at top-right plus a sibling `.sr-only` for screen
readers. That's the documented dual-ARIA pattern (UI-SPEC AC #16). The
chip itself is a non-interactive `<span>`, so there's no keyboard concern.
However, on a touch device with high-zoom or a low-vision sighted user
who can't reach a screen reader, the position-absolute chip can occlude
content underneath, and the sr-only text is invisible. Consider whether
the pill should also be visually rendered to non-SR users with proper
contrast — current Tailwind classes (`bg-warning/5 border border-warning
text-warning`) at 5% opacity background may not meet 3:1 contrast on
warning-token theme.

**Fix:** Optional. If the visual contrast is a concern, bump the
background opacity from 5% to 15%-20% to ensure the pill is reliably
visible on the warning chrome.

---

### IN-03: `audit-log/export/route.ts` does not rate-limit

**File:** `src/app/api/me/audit-log/export/route.ts:42-46`
**Issue:** The route is a GET with a hard `.limit(10000)` cap, which the
file's docstring uses to justify omitting rate-limiting ("the response
is bounded at ~2 MB — not a candidate for the Upstash bucket pattern").
That's reasonable for memory, but a malicious authenticated user could
script an N-per-second hit on this endpoint to inflate Supabase egress
without bound. The 10K cap bounds a single response, not the request rate.

**Fix:** Optional, low priority. If observed in production, add a 1-per-
30s `userActionLimiter` bucket keyed `audit_log_export:${user.id}` —
the same shape as `scenario_commit:${user.id}` in
`scenario/commit/route.ts:146`.

---

### IN-04: Migration 084 trigger uses `to_char(...)` for ISO-MS format — verify timezone consistency

**File:** `supabase/migrations/084_first_api_key_added_trigger.sql:81-88`
**Issue:** `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
formats the timestamp explicitly as UTC. PostgreSQL's `now()` returns
`timestamptz`; the `AT TIME ZONE 'UTC'` then converts to a `timestamp`
without TZ for `to_char` to render. The format string places literal
`Z` so the resulting string is ISO-8601 UTC. This is correct.

**Fix:** None needed; just verify the test
`src/__tests__/migration-084-trigger.test.ts:55` (`ISO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`)
matches the milliseconds (`.MS` is 3 digits in PostgreSQL `to_char`).
Confirmed correct.

---

### IN-05: `commit_scenario_batch` non-blocking outcome stamp may surface partial failure as warning

**File:** `src/app/api/allocator/scenario/commit/route.ts:225-239`
**Issue:** After a full-success batch the route fires `stampOutcomeMarker`
inside a try/catch that logs `console.warn`. The comment notes "Non-
blocking: a stamp failure does NOT affect the route response or the
committed batch." Correct behaviour. However: the stamp uses a
freshly-created admin client (`createAdminClient()` at line 232). On a
pathological cold-start the createAdminClient call itself can throw if
env is missing, which the catch at line 234 swallows. That's intended,
but the catch swallows ALL errors including programmer bugs (e.g. an
`undefined.method` typo). The same pattern is in
`match/decisions/holding/route.ts:152-159`. Worth widening the warn
log to dump the stack at debug level so a future ts/lint regression
surfaces.

**Fix:** Optional:

```ts
try {
  const admin = createAdminClient();
  await stampOutcomeMarker(admin, user.id);
} catch (err) {
  console.warn(
    "[scenario-commit] first_outcome_at stamp failed:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
}
```

---

### IN-06: `ProfileTabs.tsx` continues to snapshot `activeTab` to local state — back/forward breakage

**File:** `src/components/auth/ProfileTabs.tsx:60-76`
**Issue:** `AllocationsTabs.tsx:222-224` was deliberately fixed to derive
`activeTab` per render rather than snapshotting in state, with a long
comment (lines 158-163) explaining why: "browser back/forward updates
the URL → searchParams changes → re-render → activeTab recomputes."
`ProfileTabs.tsx` still uses the snapshot pattern (`useState<TabKey>
(initialTab)` at line 64 with the URL-sync `useEffect` at 67-76). The
back/forward bug is latent here too — the same fix the AllocationsTabs
PR adopted should be applied. Outside Phase 11 scope, but worth noting
since Phase 11 added the new `security` tab to this component without
fixing the underlying issue.

**Fix:** Optional, deferred. Mirror `AllocationsTabs.tsx`'s derive-per-
render pattern in a follow-up.

---

### IN-07: `WidgetState` Test 8 reads its own source via `node:fs` — fragile to refactors

**File:** `src/app/(dashboard)/allocations/components/WidgetState.test.tsx:116-129`
**Issue:** Test 8 enforces the "Pitfall 4" stateless contract by reading
`WidgetState.tsx` source and grep'ing for `useState\s*\(`, `useEffect\s*\(`,
`useRef\s*\(`. The test strips comments before grep'ing (good), but a
future refactor that uses a sibling hook (e.g. `useFooHook()` whose name
contains "use") would still pass — and a refactor that legitimately
imports `useState` from React (without calling it) would fail. The
fail-safe covers the common case but the false positives/negatives
deserve a comment.

**Fix:** Add a sentence to the test's docstring noting the limitation:
"This is a heuristic regex check, not a full AST parse. False positives
on `useFoo` identifiers are possible; promote the assertion to a
TypeScript-AST scanner if false flags become an issue."

---

_Reviewed: 2026-04-26T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
