# Phase 109: ROLE — predicate unification + page guards - Pattern Map

**Mapped:** 2026-07-16
**Files analyzed:** 12 (2 new, 10 modified)
**Analogs found:** 12 / 12 (every file has a canonical in-repo analog — this is a wiring/refactor phase)

> Governing trap (from RESEARCH.md, do NOT get this wrong): there are **two role systems**. This phase targets `profiles.role` (`allocator`|`manager`|`both`) + `is_admin` boolean — the system used by `withAllocatorAuth.ts` and `(dashboard)/layout.tsx`. **Do NOT mirror `requireRole`/`withRole` from `src/lib/auth.ts`** — those read the unrelated `user_app_roles` RBAC join table. Every excerpt below is from the `profiles.role` system.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/auth/requireRolePage.ts` (NEW) | middleware/guard (server helper) | request-response | `src/lib/api/withAllocatorAuth.ts` | exact (three-branch) — redirect substitutes for wrong-role 403 |
| `src/lib/auth/requireRolePage.test.ts` (NEW) | test | request-response | `src/lib/api/withAllocatorAuth.test.ts` + `src/lib/approval.ts` deny-default | role-match |
| `supabase/migrations/20260716HHMMSS_backfill_staff_role_both.sql` (NEW) | migration | batch/transform | `supabase/migrations/20260521150000_universal_signup_approval_gate.sql` | exact (idempotent backfill UPDATE) |
| `supabase/tests/test_staff_role_both_backfill.sql` (NEW) | test | batch | `supabase/tests/test_handle_new_user_role_allowlist.sql` (bare `DO`-block) | role-match (empty-set assertion) |
| `src/components/layout/Sidebar.tsx` (EDIT) | component | request-response | itself (drop `|| isAdmin` at 49-51 + 198-199) | in-place |
| `src/app/(dashboard)/discovery/layout.tsx` (EDIT) | route/layout guard | request-response | itself + `requireRolePage` (add allocator-role branch) | in-place + new-helper |
| `src/app/(dashboard)/allocations/page.tsx` (EDIT) | page (allocator) | request-response | `discovery/layout.tsx` attachment | attach guard |
| `src/app/(dashboard)/recommendations/page.tsx` (EDIT) | page (allocator) | request-response | same | attach guard |
| `src/app/(dashboard)/compare/page.tsx` (EDIT) | page (allocator) | request-response | same | attach guard |
| `src/app/(dashboard)/decks/page.tsx` (EDIT) | page (allocator) | request-response | same | attach guard |
| `src/app/(dashboard)/strategies/page.tsx` (EDIT) | page (manager) | request-response | same | attach guard |
| `src/app/(dashboard)/portfolios/page.tsx` (EDIT) | page (manager) | request-response | same | attach guard |
| `src/components/layout/Sidebar.test.tsx` + `MobileNav.test.tsx` (EDIT) | test | — | existing OR-logic assertions (flip to role-only) | in-place |

---

## Pattern Assignments

### `src/lib/auth/requireRolePage.ts` (NEW — server guard, request-response)

**Analog:** `src/lib/api/withAllocatorAuth.ts` (three-branch discipline). Mirror the branch semantics EXACTLY; the ONLY behavioral change is the wrong-role branch calls `redirect()` instead of returning a 403 `NextResponse`.

**Imports pattern** (copy the `server-only` + Sentry + server-client shape from `withAllocatorAuth.ts:1-8`, swap `NextResponse` for `redirect`):
```typescript
import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { captureToSentry } from "@/lib/sentry-capture";
// NOTE: caller passes the already-created supabase client + user (from the page's
// own getUser()), so no createClient import is strictly needed — decide by signature.
```

**Three-branch core pattern to mirror** (`withAllocatorAuth.ts:64-127`):
```typescript
const { data, error } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", user.id)
  .maybeSingle();

if (error) {                       // DB-error branch — NEVER redirect
  console.error("[requireRolePage] profile lookup failed:", { user_id: user.id, code: error.code, message: error.message });
  captureToSentry(error, {
    tags: { role_gate_failure: "true", role_gate_kind: "lookup_error", role_gate_code: error.code ?? "unknown" },
    extra: { user_id: user.id, message: error.message ?? "" },
    level: "error",
  });
  throw error;                     // → error.tsx (503-equivalent), never a redirect
}

if (!data) {                       // missing-profile branch — NEVER redirect
  const missingErr = new Error("Profile row missing for auth user");
  console.error("[requireRolePage] profile row missing for auth user:", { user_id: user.id });
  captureToSentry(missingErr, {
    tags: { role_gate_failure: "true", role_gate_kind: "missing_profile" },
    extra: { user_id: user.id },
    level: "warning",
  });
  throw missingErr;                // → error.tsx, never a redirect
}
```

**Deny-by-default owns-check** (copy the exhaustive-switch / `default: return false` discipline from `src/lib/approval.ts:33-55`, adapted to the `role IN ('x','both')` idiom used at `withAllocatorAuth.ts:116` and `(dashboard)/layout.tsx:45-46`):
```typescript
const owns = need === "allocator"
  ? (data.role === "allocator" || data.role === "both")
  : (data.role === "manager"   || data.role === "both");
// unknown/malformed role → owns=false → redirect (deny-by-default, matching approval.ts default branch)
```

**Wrong-role redirect — MUST sit OUTSIDE any try/catch** (Pitfall 2 — `redirect()` throws `NEXT_REDIRECT`; a wrapping catch swallows it → fail-open):
```typescript
if (!owns) redirect(homeHref);     // 307; terminates the segment. NEVER inside try/catch.
```
Home targets (RESEARCH matrix, Claude's Discretion — planner confirms against routing): **allocator → `/allocations`**, **manager → `/strategies`**. `both` owns both → never redirected. Structure: put the DB read + error/missing handling first (they `throw`), compute `owns`, then the `redirect()` on the outside — do NOT wrap the whole body in try/catch.

---

### `src/lib/auth/requireRolePage.test.ts` (NEW — test)

**Analog:** `src/lib/api/withAllocatorAuth.test.ts` (branch-by-branch assertions) + the `role × is_admin` matrix in RESEARCH.md:300-308.
Assert all three branches: DB-error → throws, does NOT redirect; missing-profile → throws, does NOT redirect; wrong-role → calls `redirect(homeHref)`. Enumerate the matrix rows (allocator/manager/both × is_admin true/false) — a `both` user is never redirected off either surface; deny-by-default on an unknown role string. Rule 9: each case must fail if the branch logic is neutered (e.g. mock a DB error and assert NO redirect fired).

---

### `supabase/migrations/20260716HHMMSS_backfill_staff_role_both.sql` (NEW — migration, batch)

**Analog:** `supabase/migrations/20260521150000_universal_signup_approval_gate.sql` — the canonical idempotent backfill-UPDATE-with-WHY-header. Timestamp MUST be `> 20260716090000` (the current latest migration).

**Header + body pattern** (mirror the analog's multi-line WHY block, then the guarded UPDATE):
```sql
-- Atomic staff backfill (Phase 109 ROLE-05). Ships in the SAME PR as the
-- `|| isAdmin` nav OR-in drop (Sidebar.tsx:49-51,198-199). Dropping the OR-in
-- without this backfill locks every is_admin account out of the allocator
-- workspace — role='both' is the durable replacement predicate.
UPDATE profiles
SET role = 'both'
WHERE is_admin = true
  AND role <> 'both';
-- Idempotent: a no-op once every staff row is 'both'.
```
**A2 verify (RESEARCH assumption):** `prevent_profile_role_change` (migration `20260520222848`) is SECURITY INVOKER; a migration runs as table owner/postgres so the trigger should NOT fire. **Confirm during the mandatory test-project MCP apply** — the empty-set assertion below is the definitive check.

**GATE:** MCP-apply this migration to the test project `qmnijlgmdhviwzwfyzlc` BEFORE merge (test-project catch-up rule) or the RED-guarded SQL assertion fails in CI.

---

### `supabase/tests/test_staff_role_both_backfill.sql` (NEW — test, batch)

**Analog:** `supabase/tests/test_handle_new_user_role_allowlist.sql` — uses a **bare `BEGIN; DO $$ ... $$; ROLLBACK;`** block with `RAISE EXCEPTION` on invariant violation (NOT pgTAP `plan()`/`finish()`; A3 confirmed — sibling test uses a bare `DO` block). Match this style exactly.

**Empty-set assertion pattern:**
```sql
BEGIN;
DO $$
DECLARE v_leaked int;
BEGIN
  SELECT count(*) INTO v_leaked
  FROM profiles
  WHERE is_admin = true AND role NOT IN ('both');
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'GATE FAILED: % staff rows have is_admin=true but role NOT IN (both)', v_leaked;
  END IF;
END $$;
ROLLBACK;
```
RED-guarded: passes only after the backfill migration is applied to the test project.

---

### `src/components/layout/Sidebar.tsx` (EDIT — component, two sites, one file)

**Analog:** itself. RESEARCH confirms the OR-in lives in exactly two functions in this one file; `MobileNav.tsx` has NO independent OR-in (it delegates to `buildPrimaryMobileNav`), so no cross-file drift.

**Site 1 — `buildNavSections` (lines 49-51):**
```typescript
// BEFORE:
const showsAllocatorWorkspace = isAllocator || isAdmin;
const showsManagerWorkspace = isManager || isAdmin;
const showsDiscovery = isAllocator || isAdmin;
// AFTER (pure role):
const showsAllocatorWorkspace = isAllocator;
const showsManagerWorkspace = isManager;
const showsDiscovery = isAllocator;
```

**Site 2 — `buildPrimaryMobileNav` (lines 198-199):**
```typescript
// BEFORE:
const showsAllocatorWorkspace = p.isAllocator || p.isAdmin;
const showsManagerWorkspace = p.isManager || p.isAdmin;
// AFTER:
const showsAllocatorWorkspace = p.isAllocator;
const showsManagerWorkspace = p.isManager;
```
Leave the Admin section gate (`Sidebar.tsx:131`, `isAdmin` alone) UNCHANGED. Update the now-stale comment block at `Sidebar.tsx:41-48` ("Admins see BOTH … triage/demo") to reflect role-only derivation (RESEARCH State-of-the-Art note). `MobileNav.tsx` needs NO edit.

---

### `src/app/(dashboard)/*/page.tsx` (EDIT — 6 owned pages, attach guard)

**Analog:** the identical existing guard shape on all six pages (VERIFIED) — insert the role guard immediately after the `getUser()` / `if (!user) redirect("/login")` line. RESEARCH recommends **per-page helper calls (Option A)** for surgical minimalism (Rule 3) over route-group layout moves (Option B).

Current shared shape (all six pages — e.g. `strategies/page.tsx:14-15`, `allocations/page.tsx:49-50`):
```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");   // some pass ?redirect=/<route>
// INSERT: await requireRolePage(supabase, user, 'allocator'|'manager', homeHref);
```
| Page | Insert guard for | Line of existing `!user` guard |
|------|------------------|-------------------------------|
| `allocations/page.tsx` | `allocator` → home `/allocations` | 50 |
| `recommendations/page.tsx` | `allocator` | 43 |
| `compare/page.tsx` | `allocator` | 30 |
| `decks/page.tsx` | `allocator` | 11 |
| `strategies/page.tsx` | `manager` → home `/strategies` | 15 |
| `portfolios/page.tsx` | `manager` | 22 |

---

### `src/app/(dashboard)/discovery/layout.tsx` (EDIT — route/layout guard, allocator-owned)

**Analog:** itself — the attachment precedent for a route-group server layout. Keeps `export const dynamic = "force-dynamic"` (fail-open prevention). It already does `getUser()` + `if (!user) redirect(...)` (lines 33-38) and a fail-closed error branch (47-49). ADD the allocator-role branch after the user check, mirroring `requireRolePage`'s wrong-role → `redirect('/strategies')` for a manager, while its existing attestation error branch already renders the gate (do NOT redirect on DB error). Note the `DEFAULT_AUTHENTICATED_ROUTE = '/discovery/crypto-sma'` post-login bounce (RESEARCH Open Q1): a manager lands here → this guard redirects → `/strategies` (single hop, loop-free).

---

## Shared Patterns

### Three-branch failure discipline (the core cross-cutting rule)
**Source:** `src/lib/api/withAllocatorAuth.ts:70-121`
**Apply to:** `requireRolePage.ts` and the `discovery/layout.tsx` role branch.
Never collapse infra failure into a policy decision. DB error → 503-equivalent (`throw` → `error.tsx`) + Sentry `level:"error"`; missing profile → `throw` + Sentry `level:"warning"` soft signal; wrong role → the ONLY redirect. A transient Postgres hiccup must NEVER masquerade as "wrong role" and bounce a valid owner off their own surface.

### Sentry reporting shape
**Source:** `src/lib/sentry-capture.ts` (`captureToSentry`), as used at `withAllocatorAuth.ts:79-87,102-109`
**Apply to:** both guard branches that report.
```typescript
captureToSentry(err, {
  tags: { role_gate_failure: "true", role_gate_kind: "lookup_error" | "missing_profile", ... },
  extra: { user_id: user.id, ... },
  level: "error" | "warning",
});
```
Always pair with a `console.error` first (the helper's Sentry path is best-effort; the console line is the caller's responsibility).

### Role idiom + deny-by-default
**Source:** `(dashboard)/layout.tsx:45-46` (the SSR source of truth) + `src/lib/approval.ts:33-55` (exhaustive switch, `default: return false`)
**Apply to:** the guard's owns-check and its test.
`isAllocator = role === 'allocator' || role === 'both'`; `isManager = role === 'manager' || role === 'both'`. Any role outside `{allocator, manager, both}` → deny (owns=false). `is_admin` grants NO marketplace surface — the guard branches on `role` ONLY (ROLE-03); staff access comes from the `role='both'` backfill, not an `is_admin` bypass.

### Idempotent backfill migration
**Source:** `supabase/migrations/20260521150000_universal_signup_approval_gate.sql`
**Apply to:** the staff-backfill migration. Multi-line WHY header → guarded `UPDATE ... WHERE role <> 'both'` (idempotent). Auto-applies to prod on merge (verify objects post-deploy); MCP-apply to test project first.

### Bare-`DO`-block SQL assertion
**Source:** `supabase/tests/test_handle_new_user_role_allowlist.sql`
**Apply to:** the empty-set test. `BEGIN; DO $$ ... RAISE EXCEPTION ... $$; ROLLBACK;` — no `plan()`/`finish()`.

---

## Anti-Patterns (do NOT do — from RESEARCH)

- **Do NOT gate role in `src/proxy.ts`** (146-160 deliberately does cookie-only `getSession()`, no `profiles` read). Role gating stays page/layout-level.
- **Do NOT import `requireRole`/`withRole` from `src/lib/auth.ts`** — that is the `user_app_roles` system, not `profiles.role`.
- **Do NOT wrap `redirect()` in try/catch** — it throws `NEXT_REDIRECT`; a catch swallows it → fail-open.
- **Do NOT split the backfill migration from the `Sidebar.tsx` OR-in drop** — ONE PR/deploy (the hard GATE).
- **Do NOT key the guard on `is_admin`** — ROLE-03.

---

## No Analog Found

None. Every file has a canonical in-repo analog (RESEARCH: "Every piece of this phase has a canonical in-repo pattern to copy"). The risk is not "how to build it" but coupling the three changes atomically and enumerating the redirect matrix.

## Test-string cleanup (grep WHOLE repo, not just `src/`)

Flip the admin-sees-all assertions to role-only (RESEARCH Pitfall 5 / v1.10 e2e lesson): `Sidebar.test.tsx:173,445-446`, `MobileNav.test.tsx:12`. Grep `e2e/` + `**/*.test.tsx` for any remaining spec asserting `isAdmin` shows the allocator/manager workspace before finalizing.

## Metadata

**Analog search scope:** `src/lib/api/`, `src/lib/auth/`, `src/lib/`, `src/app/(dashboard)/`, `src/components/layout/`, `supabase/migrations/`, `supabase/tests/`
**Files read for extraction:** `withAllocatorAuth.ts`, `discovery/layout.tsx`, `(dashboard)/layout.tsx`, `Sidebar.tsx` (both OR-in sites), `sentry-capture.ts`, `approval.ts`, `20260521150000_universal_signup_approval_gate.sql`, `test_handle_new_user_role_allowlist.sql`, plus 6 owned pages (guard-shape confirmation)
**Pattern extraction date:** 2026-07-16
