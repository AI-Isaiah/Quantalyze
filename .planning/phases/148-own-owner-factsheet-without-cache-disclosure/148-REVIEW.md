---
phase: 148-own-owner-factsheet-without-cache-disclosure
reviewed: 2026-08-05T10:41:33Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.owner-lane.test.tsx
  - src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx
  - src/__tests__/phase-148-owner-lane-cache-isolation.test.ts
  - TODOS.md
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 148: Code Review Report

**Reviewed:** 2026-08-05T10:41:33Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Adversarial review of the two-lane owner-factsheet surface (OWN-02/OWN-04), with
disclosure priority per the phase brief. The core security property — **the shared
id-keyed `unstable_cache` entry can never carry owner/draft data** — holds. I
attempted the bypasses the brief asked for and found none:

- **Cache isolation:** the single `unstable_cache` site hard-codes `withPublishedOnly`
  as a literal inside the callback; `buildFactsheetPayloadCached` takes no visibility
  parameter, so an owner-predicate cache fill is unrepresentable at the type level.
  The owner arm at `page.tsx:500-503` calls `fetchAndBuildPayload` directly (no read,
  no write, and the null-is-cached trap is avoided). The structural gate
  (`phase-148-owner-lane-cache-isolation.test.ts`) pins all of this plus a repo-wide
  no-other-caller walk, with documented red-run evidence for both mutation sites.
  Confirmed the walk's comment-stripping is load-bearing and functional.
- **Injected predicate:** both call sites of `fetchAndBuildPayload` are correct — the
  Lane A cached callback passes `withPublishedOnly`, the Lane B arm passes a lambda
  closing over `ownerUid` (session-only, captured from `auth.getUser()` in the miss
  branch, never from params). PostgREST combines `.eq("id", id)` with the `.or(...)`
  group as AND, so the admin-client query is `id = X AND (published OR user_id = uid)`.
- **Ownership probe:** request-scoped client (RLS on) + `withPublishedOrOwner`; anon,
  non-owner-authed, and missing-id all collapse to the same `notFound()`; probe errors
  log + Sentry but still 404 (no existence oracle). Lane order is locked (no session
  probe on a published hit — test 10).
- **Metadata/OG:** `generateMetadata` stays pinned `withPublishedOnly` (structural
  assertion 5); draft name/description cannot reach `<title>`/OG.
- **Wizard link:** owner-session-only by construction (renders only inside the authed
  wizard's terminal-success branches), `rel="noopener noreferrer"`, uuid-prop href.
- All 5 new/modified test files pass locally (33/33); harnesses use
  `vi.spyOn` + `restoreAllMocks` (Node22-CI-safe).

Two user-facing defects found, both in the lane-classification/banner logic — no
data-integrity or disclosure-of-data defects. Per the founder blast-radius bar,
both Warnings are user-facing and therefore in-scope for fixing.

## Warnings

### WR-01: A transient Lane A probe error mislabels a PUBLISHED strategy as "Unpublished — only you can see this"

**File:** `src/app/factsheet/[id]/v2/page.tsx:424-486` (miss condition at 424, lane assignment at 483-485)
**Issue:** The owner-lane branch is entered on `signRes.error || !signature` — i.e.
also on a **transient query error** for a strategy that IS published. If the viewer
is authenticated, the Lane B probe (`withPublishedOrOwner`) then matches the row via
its `status.eq.published` arm — for **any** authed user, owner or not — and the code
sets `lane = "owner"` unconditionally. The Lane B select list
(`id, name, codename, disclosure_tier, strategy_analytics(computed_at)`) carries
neither `status` nor `user_id`, so the code cannot distinguish "matched because
published" from "matched because owner". Consequences on that path:
1. Any authed viewer (including a random non-owner) of a published factsheet is shown
   the false banner "Unpublished — only you can see this. … Anyone else who opens
   this link sees a 404" — an incorrect disclosure statement on a public document.
2. The same window opens deterministically in the publish race (Lane A probe before
   the publish commit, Lane B probe after).
No draft data leaks (the row is published; the direct build returns the same public
content the cached lane would), and the shared cache is untouched — this is a
mislabel, not a disclosure. But the banner is itself a disclosure surface
(`FactsheetView.owner-notice.test.tsx` point 1 calls it "a DISCLOSURE, not
decoration"), and here it states a falsehood to a user.
**Fix:** Make the lane decision row-status-derived, not probe-derived. Add `status`
to the Lane B select and gate the owner lane on it:
```ts
const { data: ownRow, error: probeError } = await withPublishedOrOwner(
  supabase
    .from("strategies")
    .select("id, name, codename, disclosure_tier, status, strategy_analytics ( computed_at )")
    .eq("id", id),
  user.id,
).maybeSingle();
...
signature = ownRow;
if (ownRow.status !== "published") {
  lane = "owner";
  ownerUid = user.id;
}
// lane stays "public" for a published row reached via the error path —
// buildFactsheetPayloadCached serves it and no banner renders.
```
Note: `page.owner-lane.test.tsx:471-474` (test 9) pins Lane A/Lane B select-list
**equality**; the fix must relax that pin to "Lane B ⊇ Lane A columns" (the
payload-pending fallback only needs the Lane A columns present, so an additive
`status` cannot break it). The `hint` strings in the two `console.warn` gates should
be re-checked against the new condition.

### WR-02: Owner lane's payload-pending placeholder omits the unpublished banner

**File:** `src/app/factsheet/[id]/v2/page.tsx:504-548`
**Issue:** When the owner-lane build returns `null` (draft mid-recompute — e.g. a
member-set change resets analytics to pending, a composite read-path data defect, or
a series that clips empty), the page renders the "still computing" placeholder
`<article>` **without** `OwnerUnpublishedNotice`, even though `lane === "owner"` is
in scope at that point. The placeholder shows the draft's real name and reads like a
normal soon-to-be-live factsheet. This is exactly the scenario the banner exists to
prevent per its own test rationale ("An owner who opens their own unpublished
factsheet and does not see it will share the URL; the recipient's 404 then reads as
a platform bug") — and the pending state is when an owner is *most* likely to share
the link "for when it's ready". Test 6 (`page.owner-lane.test.tsx:419-430`) covers
this arm for cache isolation but never asserts the notice.
**Fix:** Render the visibility notice on the placeholder arm too. Since
`OwnerUnpublishedNotice` is private to `FactsheetView.tsx`, either export it and
prepend it to the placeholder article when `lane === "owner"`, or inline the
equivalent `role="note"` section in the placeholder JSX:
```tsx
return (
  <article className="mx-auto max-w-[760px] ...">
    {lane === "owner" && <OwnerUnpublishedNotice />}
    <p className="text-fixed-10 ...">Institutional Factsheet · Quantalyze</p>
    ...
```
Extend `page.owner-lane.test.tsx` test 6 to assert the notice copy is present in the
placeholder tree on the owner lane (and absent on the public-lane placeholder).

## Info

### IN-01: `withPublishedOrOwner` interpolates the uid into the PostgREST `.or()` filter without shape validation

**File:** `src/lib/visibility.ts:115-125`
**Issue:** The helper builds `` `status.eq.published,user_id.eq.${authUserId}` `` by
raw interpolation. Every current caller (including the new `page.tsx` sites) passes
the session `user.id` — a GoTrue-minted UUID — so this is not exploitable today. But
the helper's own contract ("`authUserId` MUST come from the authenticated session")
is enforced only by convention: a future caller passing a user-influenced string
could inject additional PostgREST filter clauses into the OR group (e.g.
`x,status.eq.draft`), widening visibility — and on the admin-client call path
introduced this phase, the injected predicate is the *only* gate. Pre-existing
helper (phase 110), so per the blast-radius bar this is log-only.
**Fix:** Cheap belt-and-suspenders inside the helper: assert UUID shape and
fail loud — `if (!/^[0-9a-f-]{36}$/i.test(authUserId)) throw new Error("withPublishedOrOwner: authUserId is not a uuid")`.
Candidate for TODOS.md rather than this phase.

---

_Reviewed: 2026-08-05T10:41:33Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
