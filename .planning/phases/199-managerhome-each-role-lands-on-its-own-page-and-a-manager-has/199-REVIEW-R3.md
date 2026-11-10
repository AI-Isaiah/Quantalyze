---
phase: 199-managerhome
round: 3
reviewed: 2026-11-10T18:45:00Z
depth: standard
base: 9bc83f894
fix_base: 450d70f6b
head: 2e1289b0b
files_reviewed: 16
files_reviewed_list:
  - src/lib/admin.ts
  - src/lib/admin.test.ts
  - src/app/home/page.tsx
  - src/app/home/page.test.tsx
  - src/app/(dashboard)/strategies/error.tsx
  - src/app/(dashboard)/strategies/error.test.tsx
  - src/__tests__/role-home-call-sites.test.ts
  - src/app/(dashboard)/layout.tsx
  - src/app/(dashboard)/profile/page.tsx
  - src/app/(dashboard)/error.tsx
  - src/app/error.tsx
  - src/app/(auth)/pending-approval/page.tsx
  - src/app/(auth)/onboarding/page.tsx
  - src/lib/auth/requireRolePage.ts
  - src/lib/routing/role-home.ts
  - src/proxy.ts
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 199: Code Review Report, Round 3 (final)

**Reviewed:** 2026-11-10
**Depth:** standard. I traced the strict path through `isAdminUser` into `/home`, and every redirect edge between `/`, `/login`, `/home`, `/pending-approval`, `/onboarding`, `/admin`, the role surfaces and the boundaries.
**Files Reviewed:** 16. That is the round-2 fix diff (`450d70f6b..2e1289b0b`, seven files) plus the guards, layouts and the proxy it routes through.
**Status:** issues_found. There is one MEDIUM. It is a **carried** redirect-loop class that this phase reshaped, not a defect in the round-2 fix. The round-2 fix diff itself has **no MEDIUM+ finding**.

## Summary

I report MEDIUM and above only, as asked, and record MEDIUM as `warning`. I did not assess necessity, because this round only verifies fixes.

**Evidence I ran:**
- `npx vitest run` on `role-home-call-sites`, `strategies/error`, `home/page` and `lib/admin`: 4 files, 49 tests, green.
- The neighbouring boundary, proxy and wiring tests (`app/error`, `admin/error`, `allocations/error`, `DashboardChrome`, `proxy`, `requireRolePage-wiring`): 6 files, 185 tests, green.

The review was read-only. I traced the "can this test fail" claims and did not mutate source. The fixer's report records neuter-and-RED runs for each new arm (`199-REVIEW-FIX.md`, round 2), and my trace agrees with them.

### Task 1: are the round-2 findings closed?

| Finding | Closed? | Basis |
|---|---|---|
| WR-01-R2 (strategies boundary sent a manager back into the crash) | **Yes** | See below. |
| SFH-R2-01 (`/home`'s admin check could not fail loudly) | **Yes** | See below. |

**WR-01-R2.** `strategies/error.tsx:51-53` now links to `/profile`.
- **The proxy** puts `/profile` behind a session check only (`src/proxy.ts:81-85`). It reads no role.
- **The `(dashboard)` layout** redirects only an unapproved profile (`layout.tsx:42-44`). Every approved role passes, including an admin approved through `is_admin`.
- **`profile/page.tsx`** has no `requireRolePage` and no admin check. Its only exits are `!user` → `/login` and `!profile` → `/onboarding`.
- **Result:** the page opens for allocator, manager, `both` and admin.

The census arm can fail:
- `toContain('href="/profile"')` breaks if the href changes.
- `guardedBy` finds `discovery/layout.tsx` for the Discovery path. That is the positive control.
- `DISCOVERY_CONSTANT_CONSUMERS` dropped to 3 + 3, and the strategies boundary no longer names the constant.

**SFH-R2-01.**
- **Strict throws.** `isAdminUser(..., { strict: true })` throws on a non-RLS error from either read (`admin.ts:191`, `admin.ts:231`). 42501 and PGRST116 still answer false.
- **The catch is live.** `/home:80` passes `strict`, so its catch now runs. It reports, throws, and never redirects.
- **The tests drive the real function.** `home/page.test.tsx` mocks the supabase client and not `isAdminUser`. The `profiles` arm uses a profile row with `is_admin: true` and an admin-flag read that returns `{ error }`. If `strict` is dropped, that arm redirects to `/strategies` and goes red. If `/home` short-circuits on `profile.is_admin`, it redirects to `/admin` and goes red.

**Regression check on other callers.**
- Every other production `isAdminUser` call passes two arguments (I grepped all 40-odd sites: the 13 admin page guards, the `(dashboard)` layout, `withAdminAuth`, `auth.ts` `withRole`/`requireRole`, `shared-account-partners`, every `/api/admin/*` route and `debug-key-flow`). `options.strict` is therefore `undefined`, and the `strict = false` default parameter applies.
- `isAdminUserGivenUserAppRoles` calls `hasIsAdminFlag` with two arguments, so it is unchanged.
- No strict path reaches a caller that must fail closed. The admin guards still answer false and redirect to `/home`. `/home` is the only strict caller, and its sink is the root error boundary.

### Task 2: is a redirect loop still reachable under a SUSTAINED failure?

**On the admin and role axis: no.** These are the edges under a sustained failure:

| Sustained failure | Chain | Ends at |
|---|---|---|
| Admin reads fail (either table, non-42501) | `/admin` guard false → `/home` strict throws | root boundary (terminal) |
| `profiles` read fails | `(dashboard)` layout: `profile` null → `/pending-approval` → its read is null too → renders | `/pending-approval` (terminal, misleading copy, carried) |
| `is_admin` + newbie statuses, admin read fails | `/pending-approval` → `roleHomeFor(raw)` → `/admin` → guard false → `/home` throws | root boundary. The R2 cycle is broken. |
| `/strategies` crashes for a manager | boundary → `/profile` → renders | `/profile` |
| `/home` throws for a manager | root boundary → Discovery → `requireRolePage` → `/strategies` | `/strategies` |
| Wrong role, or unknown role | `requireRolePage` → `roleSurfaceHome` (owned) or `/pending-approval` | terminal |

`/home` and the guards can still disagree only on a flap, one wrong landing per flap, as the `/home` docblock (lines 17-26) now says correctly.

**On the session axis: yes, one loop.** It is a carried class. See WR-01-R3.

### Below the bar (judged, not findings)

- **The strict blast radius reaches non-admins.**
  - **Why it happens:** an admin with `is_admin` true short-circuits before the `user_app_roles` read. A non-admin does not.
  - **Effect:** a sustained non-42501 error on that secondary table now makes `/home` throw for every allocator and manager at login. Before, they never saw it.
  - **Why it is below the bar:**
    - The root boundary's Discovery link still gets each role onto a working page (allocators to Discovery; managers are bounced to `/strategies`).
    - The `user_app_roles` policies are plain `auth.uid()` reads (`20260417031851_user_app_roles.sql:186-199`), so a sustained error there alone is unlikely.
    - This is the fail-loud behaviour SFH-R2-01 asked for.
  - **If it is ever narrowed:** make only `hasIsAdminFlag` strict. A missed role row costs one wrong landing and cannot loop.
- **The census arm has a narrow detector.** The role-free arm detects only `requireRolePage(`. A future escape target behind an `isAdminUser` guard (for example `/admin`) would pass it. It holds for today's one entry (`/profile`). LOW.
- **The Sentry report is doubled.** A strict failure is reported twice: once by `reportNonRlsError` in `admin.ts` and once by `/home`'s `captureToSentry`. This is observability noise only. LOW.
- **A docblock is stale.** The `hasAdminRoleRow` docblock (`admin.ts:159-162`) still says non-RLS errors "still return false". That is no longer true under `strict`. LOW.
- **`/profile` can redirect to `/onboarding` on a failed read.** If the service-role profile read fails, `profile` is null and the page redirects to `/onboarding`, which renders the wizard for an approved user. This was in place before phase 199 and requires a separate service-role failure. It is not a loop. LOW.

## Warnings

### WR-01-R3: Sign-in loop when the session cookie is still accepted but `getUser()` returns no user (`/` ↔ `/home`), user-facing, a carried class in a new shape

**Files:**
- `src/app/home/page.tsx:43`: `if (!user) redirect("/")`
- `src/proxy.ts:67-71`: `getSession()` is cookie-only.
- `src/proxy.ts:77-79` and `156-177`: `/` is public but not bounce-exempt, so a cookie session 307s it to `ROLE_HOME_ROUTE`.
- `src/proxy.ts:124`: `/home` is bounce-exempt.

**Issue:** the proxy decides "signed in" from the cookie (`getSession()`, no network unless the access token has expired). `/home` decides from `getUser()`, which asks the auth server. When the two disagree for a sustained period, the browser follows `/` → (proxy) `/home` → `/` → … until `ERR_TOO_MANY_REDIRECTS`:
1. `/home` gets `user: null` and redirects to `/`.
2. The proxy sees a cookie session on `/` and redirects back to `/home`.

Every `!user → /login` guard feeds the same cycle: `/login` → (proxy) `/home` → `/` → `/home`.

**When it happens.** The access-token JWT is still unexpired (up to its TTL, an hour by default) while `getUser()` refuses it:
- the session was revoked server-side (a global sign-out from another device, an admin ban or delete, `session_not_found`);
- the auth server is unreachable (`getUser` returns `{ user: null, error }`).

Neither is a flap. The user's landing page and sign-in page both show a browser redirect error, with no boundary and no Sentry signal.

**Why it is carried, not new.** At the pre-phase base `9bc83f894`, the same disagreement already looped:
1. `/` or `/login` → (proxy) `DEFAULT_AUTHENTICATED_ROUTE` = `/discovery/crypto-sma`.
2. `discovery/layout.tsx` saw `!user` and redirected to `/login?redirect=/discovery/crypto-sma`.
3. The proxy bounced that back to `/discovery/crypto-sma`.

That `/login?redirect=` loop still exists today (`discovery/layout.tsx:37-38`). Phase 199 added a second shape through `/home`. It neither created nor fixed the class. Prior rounds did not judge it: I grepped 199-REVIEW, REVIEW-R2, CONTEXT and RESEARCH for `getSession`, cookie-only, `TOO_MANY` and revoked-session, and none of them examines this disagreement.

**Recommendation:** book it as its own TODO rather than fix it in phase 199. A fix inside `/home` alone would leave the `/login?redirect=` shape looping.

**Fix (for whoever takes it):** confirm before bouncing, at the one place every shape passes through, the proxy's signed-in bounce branch (`proxy.ts:169`). On the few routes it bounces (`/`, `/login`, `/signup`, `/forgot-password`), call `supabase.auth.getUser()` and bounce only when it returns a user. Otherwise fall through, so the page renders: the marketing page or the login form. That keeps the proxy cookie-only on every other route.

```ts
if (session && isPublicRoute && !isApiRoute && !isAuthBounceExempt) {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    // existing safePath bounce
  }
  // else: fall through and render /, /login, ... (the stale cookie cannot loop)
}
```

Pin it with a proxy test: a cookie session plus a null `getUser` on `/` and on `/login?redirect=/discovery/crypto-sma` must not redirect.

---

_Reviewed: 2026-11-10T18:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
