---
phase: 238-nevercomputed
reviewed: 2026-11-24T18:28:43Z
depth: standard
scope: PR-1 (FACT-05), plans 238-01..03; diff 5217975b6f9078719852a85d3835c99b6e02818f..0702a43c6 excluding .planning
files_reviewed: 10
files_reviewed_list:
  - src/lib/status-surface-copy.ts
  - src/lib/status-surface-copy.test.ts
  - src/components/degrade/DegradeLine.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/page.key-pill.test.tsx
  - src/app/(dashboard)/strategies/page.merged.test.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx
  - TODOS.md
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
  necessity: 1
status: issues_found
---

# Phase 238: Code Review Report (PR-1, FACT-05)

**Reviewed:** 2026-11-24T18:28:43Z
**Depth:** standard, plus cross-file tracing into `degrade-warnings.ts`, `compute-state`, `strategy-health.ts` and `factsheet/viewer.ts`
**Files Reviewed:** 10
**Status:** issues_found

Severity key used below, as the brief asked: CRITICAL / HIGH / MEDIUM / LOW / INFO. In the frontmatter, MEDIUM and LOW count as `warning`, INFO counts as `info`, and there is nothing at CRITICAL or HIGH.

## Summary

I traced every path through the `/strategies` share-note selection:

- `shareNotes`, then `uncomputedNote`, then `ShareNoteDescriptor`, then `noteFor`.
- The probe fallbacks.
- The published `failedFacts` reuse.
- The owner pending page's `shareNote` ternary.

**The unpublished `/strategies` path is correct.** The `remedy` descriptor is produced only for mint-token, arm `not_available`, kind null. `readRecipientArm` always returns a non-null state, so in practice that means `failed`, `stalled` or `never_started`. The action always goes through `viewerRemedyAction`. The note and the `strategies.stale-no-data` detail read the same `armOf` promise, so parity holds by construction. `finished` cannot reach this path, because `jobsFinished` forces `finished_not_built`. `analytics_failed` keeps its text note. The probe-unreadable and D-02 unbuildable notes are unchanged.

**The published path adds no RPC.** IN-04 stands.

**Copy matches the UI-SPEC.** Each new sentence is the UI-SPEC Copywriting Contract text.

**Checks run:**

- `tsc --noEmit -p .` is clean.
- The four phase test files, `degrade-warnings.test.tsx` and `degrade-warning-scan.test.ts`: 6 files, 478 tests, all green.
- A wider run over `src/app/(dashboard)/strategies`, `src/app/factsheet` and `src/components/degrade` (192 files) had red tests on both attempts:
  - first attempt (overlapping `tsc`): 27 failed;
  - second attempt: 42 failed in 16 files, all under `src/app/factsheet/[id]/v2/`. They were `FactsheetBody.*`, `FactsheetView.{leverage,rolling-gate,unreadable-reason,usd-terms,venue-label,window-kpis}`, `MetricsColumn.*`, `page.owner-trust-tier` and `page.peer-ranks`. 31 of the 42 were `Test timed out in 5000ms`.
- **I classify these as load flakes, not branch failures.** Re-run alone with `--maxWorkers=2`, 15 of the 16 files passed. The 16th, `FactsheetView.window-kpis.test.tsx`, had 4 timeouts there, on different tests than before, and passed 26/26 when run by itself. None of these files renders `OwnerUnpublishedPanel` or a share note.
- Nothing outside `src` still cites the retired sentence or the deleted TODOS id. I grepped `e2e/`, `tests/`, `scripts/` and `docs/`.
- I read the worktree's `CLAUDE.md`, `AGENTS.md` and `DESIGN.md` (Voice, Numbers Contract). There is no `.claude/skills/` or `.agents/skills/` in the worktree.

**Two MEDIUMs:**

1. **WR-01.** The owner pending page now puts a manager-guarded link (the edit page, or the CSV wizard) in the share note for an owner whose role is allocator-only. The code comment justifying this rests on a false premise.
2. **WR-02.** The published-row branch's viewer mapping, and its shape remedies, have no test that asserts them (by grep over `src`), so removing the mapping would not turn any test red. So the prohibition "never send an allocator-only viewer to the edit page or CSV wizard" is enforced on `/strategies` for unpublished rows only.

## Warnings

### WR-01: [MEDIUM, user-facing] The owner pending page's new note links the manager-guarded edit page or CSV wizard for an allocator-only owner

**File:** `src/app/factsheet/[id]/v2/page.tsx:936-952`

**Issue:** For the kind-less `not_available` arm, the note renders `<DegradeAction id={ownerRemedyAction(ownerRemedyLine)} />`. That is the raw owner mapping, and it can produce:

- `A-RESYNC-EDIT` and `A-LINK-KEY-EDIT`, which link `/strategies/{id}/edit`. That route is manager-only: `requireRolePage(supabase, user, "manager")` in `src/app/(dashboard)/strategies/[id]/layout.tsx:46`.
- `A-CSV-FIXED`, which links `/strategies/new/wizard?source=csv`. That route is also manager-only: `requireRolePage(supabase, user, "manager")` in `src/app/(dashboard)/strategies/new/layout.tsx:46`.

The comment justifies skipping the viewer mapping with "it is the owner's own page". **Being the owner does not make the viewer a manager:**

- The owner lane is gated only on `ownRow.status !== "published"` (`page.tsx:655`), with no role check.
- `/strategies` itself documents that an allocator-only viewer owns wizard drafts and keeps them as Draft rows (`strategies/page.tsx:545-551`, CD-10).

**Concrete path:** an allocator-only user has a wizard draft with a linked key and no computation (`never_started`, shape `single`). Before this phase, the panel note had no link. Now it says "Start a new computation with Resync on this strategy's edit page", and that link bounces them to their role home.

The KCS-09 remedy line below the panel (`page.tsx:988-997`) already had the same raw link, so the defect is pre-existing. This phase doubles it, and its comment asserts the opposite of the fact. UI-SPEC §1.7 chose "this page does not apply the viewer mapping today, and this phase does not add it". The brief states the invariant without that carve-out.

**Why this needs a decision rather than a one-line fix:**

- The real fix touches the KCS-09 remedy line, which is outside this diff.
- It also needs a role read the owner lane does not make today.
- Mapping only the note would break plan 238-03's truth that the note shows "the same action as the page's KCS-09 remedy line".

**Fix:** In the owner lane, read the viewer's role. `resolveFactsheetViewer` returns early for an owner without reading `profiles`, so this needs one `profiles.role` read or an extension of that function. Then use:

```tsx
id={viewerRemedyAction({ remedy: ownerRemedyLine, managerSurface: isManagerRole, shape: ownerStatus.shape })}
```

Apply the same mapping to the KCS-09 remedy line, so the two lines still cannot differ. If the founder keeps the §1.7 carve-out, correct the comment so it no longer claims an owner is always a manager. Then book the allocator-owner gap as a routed item with a test that pins it.

### WR-02: [MEDIUM, not user-facing (test integrity on a user-facing prohibition)] The published branch's viewer mapping and shape remedies are untested

**File:** `src/app/(dashboard)/strategies/page.tsx:1336-1343`, tests in `src/app/(dashboard)/strategies/page.merged.test.tsx` (the "NEVERCOMPUTED published" describe block)

**Issue:** The `public-uncomputed` branch computes its own `ownerRemedy` and `viewerRemedyAction`. It is a second copy of the unpublished branch at `:1305-1311`.

Every published test either:

- uses `FAILED_JOB` (permanent, so `A-CONTACT-RESOLVE`, which is not a `KCS21-*` remedy, so `viewerRemedyAction` passes it through unchanged), or
- asserts `KCS12-PUBLIC-UNKNOWN`, `KCS12-PUBLIC` or finished-not-built.

None of them uses an allocator role or a shape remedy. I grepped all of `src`. No test asserts the public lead followed by a shape or Exchanges action, and no share-note test renders a published row for an allocator. I did not run a mutation, since the review is read-only. By that grep, though, any of the following edits at `:1342` would not be caught:

- replacing `managerSurface: isManager` with `true`,
- replacing the call with `ownerRemedyAction(remedy)`,
- passing the wrong `compositeHistory`.

That is the exact mutation UI-SPEC Test Contract 3 says must go RED, and it covers the plan 238-02 prohibition, which names the whole `/strategies` note. Plan 238-02's must-have truth "jobs failed **or never_started**" also has no `never_started` published case. This repo's rule is that a user-facing gate must be able to fail, and this one cannot for published rows.

**Fix:** Add these published cases to the "NEVERCOMPUTED published" block:

- `pubRow("s-pub", { api_key_id: "key-1" })` with `TRANSIENT_JOB`:
  - As `asRole("manager")`, expect `KCS12-PUBLIC-RESYNC-EDIT` with one `/strategies/s-pub/edit` link.
  - As `asRole("allocator")`, expect `KCS12-PUBLIC-EXCHANGES-KEY` and `container.querySelector('a[href*="/edit"]')` null.
- A no-key, no-jobs published row (`never_started`), expecting `KCS12-PUBLIC-LINK-KEY-EDIT`.

Neuter the `:1342` mapping, see RED, then restore from a byte backup. The better fix is to collapse the two branches into one local helper. For example, `remedyNote(lead, state, compositeHistory)` returning `<>{lead} <DegradeAction id={viewerRemedyAction(...)} strategyId={s.id} /></>`. Then the mapping exists once, and the unpublished role matrix covers it.

### WR-03: [LOW] The two lead-plus-action branches in `noteFor` are duplicated

**File:** `src/app/(dashboard)/strategies/page.tsx:1304-1315` and `:1336-1346`

**Issue:** The two branches are the same JSX: `shapeOf`, then `ownerRemedy`, then `viewerRemedyAction`, then `DegradeAction`. Only the lead differs. Because they are separate copies, WR-02's untested copy can drift from the tested one.

**Fix:** Extract one helper (see WR-02).

### WR-04: [LOW] The owner pending page has no `stalled` case

**File:** `src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx:962-1013`

**Issue:** Plan 238-03's truth names "failed / stalled / never_started". The tests cover failed-permanent, failed-transient-single and never_started-unlinked. `stalled` is never rendered on this surface.

**Fix:** Add a stalled stitch-heartbeat fixture (composite shape gives `A-COMPOSITE-CONTACT`) and assert the full sentence plus endsWith-parity with the remedy line.

### WR-05: [LOW] Stale doc comment: `recipientShareNote` no longer ignores the arm for a public URL

**File:** `src/lib/status-surface-copy.ts:677-678`

**Issue:** The comment reads: "`recipientShareNote` cannot express it (it ignores the arm for a public URL, 167.2 IN-04)". Since this phase, `PUBLIC_URL_NOTES[arm]` is arm-aware, so the stated reason is false.

**Fix:** Reword it to: "An arm is what the recipient sees, and here that is exactly what is unknown."

## Info

### IN-01: [INFO] `string | ReactNode` is a redundant union

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:1404`

**Issue:** `ReactNode` already includes `string`. The `typeof shareNote === "string"` branch is still correct.

**Fix:** Change it to `shareNote?: ReactNode`.

### IN-02: [INFO] The test comment says `ANALYTICS_FAILED_ACTIONS` is "every action either page can put after a lead". It is not.

**File:** `src/lib/status-surface-copy.test.ts:794-803, 873-879`

**Issue:** `A-OWNER-RELOAD` comes only from the `reload` rule, and that rule is only reached on the `in_progress` arm. It can never follow a lead. The composed-notes set, and the `DISTINCT_FLOOR` of 73 built on it, therefore count test-composed strings that no page renders. That is harmless to the floor's direction, but the comment overstates it.

**Fix:** Say "a superset of the actions either page can put after a lead". Optionally, exclude `A-OWNER-RELOAD` and re-measure.

### IN-03: [INFO] Impossible-state guards kept only for type narrowing

**File:** `src/app/(dashboard)/strategies/page.tsx:1323` (`state === null`), `src/app/factsheet/[id]/v2/page.tsx:946` (`&& ownerRemedyLine`)

**Category:** necessity

**Issue:**

- `failedFactsOf`'s public-url branch always returns a non-null `deriveComputeState(...)` (`failedFactsOf`, `page.tsx:1084-1139`), so `state === null` cannot be true there.
- `ownerRemedyLine` is `ownerStatus && ownerRemedy(...)`, and `ownerRemedy` always returns an object. Inside the `ownerStatus ?` branch it is therefore always truthy.

Both guards exist because the declared types are nullable. This rests on judgment: they are cheap, and the types allow null.

**Fix:** None required. Optionally, tighten `failedFactsOf`'s return type to `state: ComputeState`.

### IN-04: [INFO] Out of scope, but now visible: a published Stale (no data yet) row with running jobs pairs "no computation is running" with a wait note

**File:** `src/lib/degrade-warnings.ts:1009-1012` (pre-existing), `src/app/(dashboard)/strategies/page.tsx:1327-1328`

**Issue:** On this row, the `strategies.stale-no-data` detail opens with the fixed "No figures yet, and no computation is running." and its state is `running`. The share note (new arm `in_progress`, so `KCS12-PUBLIC`) says the numbers appear "once a computation succeeds". The detail's fixed prefix predates this phase. Before this phase, the published note was always the wait wording, so the pair is not new. Recorded here only, per the repo's LOW/INFO rule.

**Fix:** None in this phase.

---

_Reviewed: 2026-11-24T18:28:43Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Fix round 1

Branch `gsd/phase-238-nevercomputed`. Commits: `1e4426cec` (WR-01), `45b61db50` (WR-02). WR-03 and WR-04 (LOW) were not touched.

### WR-01: FIXED (commit 1e4426cec) — requires human verification (role logic)

- `src/app/factsheet/[id]/v2/page.tsx`: the owner lane now reads `profiles.role` once (request client, `signature.user_id`) and derives `ownerManagerSurface` (`manager` or `both`). A failed read, or a missing row, reads as not-a-manager and is logged and sent to Sentry (stage `owner-role`), so the owner is never sent to a route that bounces them.
- `ownerRemedyViewerAction = viewerRemedyAction({ remedy: ownerRemedyLine, managerSurface, shape })` now feeds BOTH the share note's `DegradeAction` and the KCS-09 remedy line. The remedy line keeps its existing before/link/after rendering whenever the viewer action equals the owner action (managers, and every non-`KCS21-*` remedy), and renders the same `DegradeAction` the note shows otherwise. The note and the line therefore still name one action (238-03 parity truth).
- The false "it is the owner's own page" comment is replaced.
- Tests (`page.owner-compute-state.test.tsx`; the request-client double gained a `profiles` branch, default role `manager` so every older case is unchanged): `SHARE-NOTE-ALLOCATOR-SINGLE` (Exchanges sentence in note and line, endsWith parity, no `/edit` or CSV wizard href), `SHARE-NOTE-ALLOCATOR-UNLINKED` (never_started, contact form), `SHARE-NOTE-ALLOCATOR-CSV` (contact form, no wizard href), `SHARE-NOTE-BOTH` (a `both` owner keeps the edit link).
- PROOF-01, with the source byte-backed-up to a temp dir outside the repo:
  - Neuter A, `managerSurface: ownerManagerSurface` changed to `managerSurface: true`: RED, `Tests  3 failed | 58 passed (61)`, failing `SHARE-NOTE-ALLOCATOR-SINGLE`, `SHARE-NOTE-ALLOCATOR-UNLINKED`, `SHARE-NOTE-ALLOCATOR-CSV`. Restored with `cp`, `cmp` exit 0, GREEN `Tests  61 passed (61)`.
  - Neuter B, the remedy-line condition replaced with `false` (note mapped, line raw): the same three cases RED, `Tests  3 failed | 58 passed (61)`. Restored with `cp`, `cmp` exit 0.

### WR-02: FIXED, test-only (commit 45b61db50) — no source change, no test exposed a bug

Added to the "NEVERCOMPUTED published" block of `page.merged.test.tsx`: (a) single-key transient failure as manager, `KCS12_PUBLIC_LEAD` plus the RESYNC-EDIT sentence whole, one `/strategies/s-pub/edit` link; (b) the same row as an allocator-only viewer, the Exchanges sentence whole, no `/edit` or `/strategies/new` link; (c) published never_started with no key, manager (LINK-KEY-EDIT sentence whole) and allocator (contact form, no edit link); (d) published row whose jobs read failed (`state.rpcError = true`), the note equals `KCS12_PUBLIC_UNKNOWN` exactly with no `/edit` link in the note.

PROOF-01, `strategies/page.tsx` byte-backed-up outside the repo:
- Neuter 1, the published branch's `managerSurface: isManager` changed to `true`: RED, `Tests  2 failed | 104 passed (106)`, failing "the same row as an allocator-only viewer: the lead plus the Exchanges page, and no link to the manager-guarded edit page" and "a never_started row with no key, as an allocator-only viewer: the lead plus the contact form, no edit link". Restored with `cp`, `cmp` exit 0.
- Neuter 2, the `state.state === "unreadable"` arm dropped from the `public-uncomputed` condition: RED, `Tests  1 failed | 105 passed (106)`, failing "a jobs read that failed: the state-free note, exactly, and no shape action guessed". Restored with `cp`, `cmp` exit 0.
- After restore: `Tests  106 passed (106)`.

### Gates

`npx tsc --noEmit` exit 0. `npm run lint` exit 0 (4 pre-existing warnings, none in touched files). The specified vitest run: 60 files, 1469 tests, all passed. Also run: the 11 other `src/app/factsheet/[id]/v2/page.*.test.tsx` files that render the page, 153 tests, all passed (`--maxWorkers=2`). All verification ran in the main worktree checkout `quantalyze-wt-238`, not a nested worktree.

## Re-review round 2

**Reviewed:** 2026-11-24T19:05:00Z, branch `gsd/phase-238-nevercomputed` at `45b61db50`
**Scope:** fix commits `1e4426cec` (WR-01) and `45b61db50` (WR-02), plus the whole PR-1 diff `5217975b6f9078719852a85d3835c99b6e02818f..HEAD` excluding `.planning`, checked for anything the fixes broke.
**Verdict:** WR-01 and WR-02 are resolved. Nothing new at MEDIUM or above. There are four new LOW findings. Under this repo's rule, LOW is recorded here and nowhere else.

### WR-01: RESOLVED

**The role read**
- It runs only on the owner lane, on the request client: `supabase.from("profiles").select("role").eq("id", signature.user_id)`.
- On the owner lane, `signature.user_id` is the session user. The lane needs `status !== "published"`, and `withPublishedOrOwner` can match a non-published row only through its `user_id = <session uid>` arm.
- RLS allows the read. `profiles_read_public` is `FOR SELECT USING (id = auth.uid() OR true)` (`supabase/schema/baseline.sql:17630`). `/strategies` and `requireRolePage` make the same read on the same client.
- No admin client is involved.

**Managers render exactly as before**
- `viewerRemedyAction` returns `ownerRemedyAction(remedy)` whenever `managerSurface` is true, or the remedy id does not start with `KCS21-` (`degrade-warnings.ts:310-311`).
- So for a `manager` or `both` owner, `ownerRemedyViewerAction === ownerRemedyAction(ownerRemedyLine)`. The remedy line takes the old raw `before` / `link` / `after` branch, and the note gets the same id it got before.
- The same holds for every non-`KCS21-*` remedy, whatever the role.

**The note and the line still match**
- Both read the one `ownerRemedyViewerAction` value. When it differs from the owner action, both render `<DegradeAction id={ownerRemedyViewerAction} />`, so the text is identical by construction.
- When it does not differ, the pairing is the one shipped and pinned before this round.
- The `!` on `ownerRemedyViewerAction!` at `page.tsx:1020` is sound. That branch sits inside `ownerLine && ownerRemedyLine`, which implies `ownerStatus`, which implies a non-null action.
- The note's guard changed from `ownerRemedyLine` to `ownerRemedyViewerAction`. Both are truthy under exactly the same conditions.

**The `both` role** maps to the manager surface, the same as `/strategies:536` and `requireRolePage`.

**The comment** no longer says "it is the owner's own page".

### WR-02: RESOLVED

**What the five new published cases pin**
- The allocator mapping of the published branch, through exact text and the absence of any `/edit` or `/strategies/new` link.
- The manager edit link, as exactly one `/strategies/s-pub/edit` link.
- `never_started` for both roles.
- The `unreadable` arm, as `KCS12_PUBLIC_UNKNOWN` exactly.

Mutating `managerSurface: isManager` to `true` changes the allocator cases' exact text, so they can fail.

**Can the new tests fail?** I did not reproduce this, because the review is read-only on source. It rests on two things:
1. The fixer's PROOF-01 neuters, recorded above. Each went RED with the named cases and was restored by `cmp`.
2. My own reading that every new case asserts whole, role-specific text. The allocator sentence and the manager sentence share no action text, so either mutation changes `textContent`.

### Checks run this round

- **Vitest, the specified files:** `v2/page.*`, `strategies/page.merged`, `strategies/page.key-pill`, `status-surface-copy.test`, `degrade-warnings.test`. 16 files, 617 tests, all green.
- **Vitest, source-reading pins that cite `v2/page.tsx`:**
  - `verify-plan-anchors`
  - `phase-147-series-resolution-guards`
  - `phase-150-capital-ownership-invariant`
  - `phase-148-owner-lane-cache-isolation`
  - `degrade-warning-scan`
  - `display-sign-single-source`
  - `critical-regressions`

  7 files, 340 tests, all green.
- **Typecheck:** `npx tsc --noEmit -p .` exits 0.
- **Other test doubles:** None of the 11 sibling `page.*` test files gained a `profiles` branch, and all of them pass in the run above. Their remedy-line assertions, if any, are unaffected.

### New findings

#### R2-01: [LOW] The role-read fallback is untested, and so are a missing row and an unknown role

**File:** `src/app/factsheet/[id]/v2/page.tsx:883-896`, `page.owner-compute-state.test.tsx:220-224`

**Issue:** The test double's `profiles` branch always returns `error: null`. No case sets `STATE.profileRole = null` or an unrecognised role. So two mutations leave all 61 cases green:
- `ownerManagerSurface = ownerProfileError ? true : ...`
- treating a null or unknown role as manager.

The brief named this fallback.

**Why LOW, unlike round-1 WR-02 (MEDIUM):**
- WR-02 left the normal allocator path on published rows unpinned.
- This is a fault path. It needs a DB error, a missing profile row ("should be impossible" per `requireRolePage`), or a role outside `{manager, allocator, both}`.
- The normal allocator path on this page is now pinned by three cases.

**Fix:** Add two cases.
- `STATE.profileRole = null`, plus a variant whose `profiles` answer carries an `error`: expect the allocator sentence and no `/edit` href.
- On the error variant, also assert a `captureToSentry` call tagged `stage: "owner-role"`.

#### R2-02: [LOW] A missing profile row is silent, and the page guesses a role where its siblings throw

**File:** `src/app/factsheet/[id]/v2/page.tsx:889-895`

**Issue:** Only `ownerProfileError` is logged and captured. A missing row (`data: null`, no error) quietly falls through to not-a-manager, so this data-integrity signal is lost.

That contradicts the fix-round note above, which says "A failed read, or a missing row … is logged and sent to Sentry". The code does not do that for a missing row.

Both `/strategies` (`page.tsx:504-528`) and `requireRolePage` throw on a read error and on a missing row: "a guessed role is a guessed set of controls". This page guesses instead.

The guess goes the safe way. Every action it can pick (`A-EXCHANGES-KEY`, `A-CONTACT-CHECK`) opens for every role. And degrading one line beats sending a pending page to `error.tsx`. So this is a deliberate divergence and not a defect in what renders. But it is undocumented as a divergence (Rule 7), and the missing-row arm violates Rule 12.

**Fix:**
1. Add an `else if (!ownerProfile)` arm that does `console.error` plus `captureToSentry(..., { tags: { stage: "owner-role-missing" }, level: "warning" })`.
2. Add one sentence to the comment naming the divergence from `/strategies` and why: one line is degraded, not the whole page.

#### R2-03: [LOW] An allocator-only owner of a composite loses a remedy that worked, and nothing covers it

**File:** `src/lib/degrade-warnings.ts:311-314`, newly applied at `src/app/factsheet/[id]/v2/page.tsx:897-904`

**Issue:** `KCS21-COMPOSITE` maps to `A-COMPOSITE-CONTACT`, which links the contact form (`degrade-warnings.ts:222-227`). The contact form opens for every role. Even so, `viewerRemedyAction` rewrites every `KCS21-*` remedy for a non-manager, so an allocator-only owner of a composite now reads "Check its key on the Exchanges page." on both the note and the KCS-09 line.

Before this fix, that owner saw a reachable and more accurate remedy. A composite has no self-serve re-run.

The mapping is the recorded CD-11 decision, so this is inherited, not a new bug. The docstring's rationale ("the shape remedies … link the manager-guarded edit page or CSV wizard") is false for `KCS21-COMPOSITE`.

None of the four new cases uses a composite shape. I did not establish whether an allocator-only user can own a composite at all. Composite means `strategy_keys` membership count > 0 (`strategy-shape.ts:179`).

**Fix:** None in this phase. If CD-11 is revisited, exempt `KCS21-COMPOSITE` from the rewrite, or correct the docstring.

#### R2-04: [LOW] UI-SPEC §1.7 still says the opposite of the shipped code

**File:** `.planning/phases/238-nevercomputed-a-strategy-that-never-computed-failed-or-stall/238-UI-SPEC.md:252`

**Issue:** It still reads: "The note maps that same remedy object through `ownerRemedyAction` … This page does not apply the viewer mapping today, and this phase does not add it."

WR-01 reversed that, and it also changed the KCS-09 remedy line, which was out of scope. The global CLAUDE.md deviation policy records a changed decision in CONTEXT and ROADMAP. No planning file records this one.

**Fix:** Add a dated CORRECTED note to §1.7 (and its row 576), and a line in `238-CONTEXT.md`, naming WR-01's reversal and the KCS-09 line change.

### Still open from round 1 (LOW and INFO, unchanged by design)

WR-03 (duplicated lead-plus-action branches), WR-04 (no owner-page `stalled` case) and WR-05 (`status-surface-copy.ts:677-678` stale comment, still present), plus IN-01 through IN-04. All are recorded here only.

---

_Re-reviewed: 2026-11-24T19:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (round 2)_

## Fix round 2

Branch `gsd/phase-238-nevercomputed`. Commit `7c006b6da` (R2-01, test-only, no source change; no test exposed a bug). Only `src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx` changed.

### R2-01: FIXED, test-only (commit 7c006b6da)

- The request-client double gained `STATE.profileError` (default null, reset per test) and `STATE.observed.profileEqCalls`; its `profiles` branch returns `{ data: null, error }` when `profileError` is set, and `.eq` records `(column, value)` for `profiles` reads.
- `SHARE-NOTE-ROLE-READ-FAILED`: single-key owner, transient failure, `profileError` set while `profileRole` is still `manager` (so ignoring the error would read as a manager). Note and remedy line equal the Exchanges sentence, no `/edit` href in either; `console.error` called with "owner role read failed" plus the error; `captureToSentry` called with the error and `tags` containing `stage: "owner-role"`; every `profiles` `.eq` call is `["id", OWNER_UID]`. This case passes `user_id: OWNER_UID` on the owner row (the shared fixture default omits it, and adding it to the default moved 5 older cases, so it was not changed); with `user_id` on the row the panel renders its own "Edit strategy" button, so the no-`/edit` assertions are scoped to the note and the line.
- `SHARE-NOTE-ROLE-ROW-MISSING`: `profileRole = null`, no error, CSV strategy: contact-form fallback, `CONTACT_HREF` link in the note, no `/strategies/new/wizard` and no `/edit` link.
- Not touched: the null-row logging and the other LOW items.

### PROOF-01 (page.tsx byte-backed-up outside the repo with `cp`; every restore verified with `cmp`)

Neuter A, `ownerManagerSurface = !ownerProfile || ownerProfile.role === "manager" || ownerProfile.role === "both"` (error or null role reads as manager):
```
     × SHARE-NOTE-ROLE-READ-FAILED: the owner's role read errors -> ...
     × SHARE-NOTE-ROLE-ROW-MISSING: no profile row and no error -> ...
 Test Files  1 failed (1)
      Tests  2 failed | 61 passed (63)
cmp exit 0
```
Neuter B, the `captureToSentry(...)` call removed:
```
     × SHARE-NOTE-ROLE-READ-FAILED: the owner's role read errors -> ...
 Test Files  1 failed (1)
      Tests  1 failed | 62 passed (63)
cmp exit 0
```
Neuter C (extra), the profiles read `.eq("id", signature.user_id)` changed to `.eq("id", signature.id)`:
```
     × SHARE-NOTE-ROLE-READ-FAILED: the owner's role read errors -> ...
      Tests  1 failed | 62 passed (63)
cmp exit 0
```
After the restores:
```
 Test Files  1 passed (1)
      Tests  63 passed (63)
```
`git status` shows `page.tsx` unmodified.

### Gates

`npx tsc --noEmit` exit 0. `npm run lint` exit 0 (4 pre-existing warnings). `npx vitest run "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx" "src/app/(dashboard)/strategies"`: 56 files, 1208 tests, all passed. All verification ran in the `quantalyze-wt-238` checkout, not a nested worktree.

## Orchestrator disposition (2026-11-24)

- **Round 1, gsd-code-reviewer:** WR-01 (MEDIUM, user-facing) fixed in fix round 1, commit 1e4426cec. WR-02 (MEDIUM, a test gap guarding a user-facing prohibition) fixed in fix round 1, commit 45b61db50. WR-03..05 and IN-01..04 are LOW/INFO: recorded here only, not fixed.
- **Round 1, silent-failure-hunter:** MEDIUM-2 is the same gap as WR-02, closed by 45b61db50. MEDIUM-1 (an unpublished row with an unreadable jobs read keeps KCS12-UNREADABLE, "… once a computation succeeds") is pinned unchanged by the approved 238-UI-SPEC §1.1 row 5. Changing it would change a pinned spec row, so it was NOT fixed. It is recorded as an open founder decision in 238-CONTEXT.md `<deviations>`. LOW-1..3 are recorded only.
- **Round 2:** gsd-code-reviewer found nothing new at MEDIUM+ and rated the untested role-read fallback LOW (R2-01). silent-failure-hunter rated the same gap MEDIUM (user-facing). Where the two disagreed, the higher rating was taken: fix round 2 (tests only, commit 7c006b6da) pinned the error and missing-row arms, with three neuters RED and then GREEN after a byte restore. R2-02..04 are LOW. R2-04 (UI-SPEC §1.7 now contradicts the code) is answered by the deviation record in 238-CONTEXT.md and ROADMAP Phase 238.
- **Round 3:** the orchestrator reviewed 7c006b6da directly. It is test-only, with no source change, so no reviewer was spawned. No MEDIUM+ remains open.

## Founder ruling round (2026-11-24, "Neutral 'unknown' note")

- **The ruling answers SFH round-1 MEDIUM-1.** Commit d955d487a replaces KCS12-UNREADABLE on the private-link `unreadable` arm with `KCS12_MINT_B_UNKNOWN` and re-points six pins. PROOF-01: the neutered copy restored the old sentence and went RED on "UNREADABLE: an RPC error …"; after `cp` back, `cmp exit 0`, it was GREEN.
- **The reviewer pass (gsd-code-reviewer, opus) found one MEDIUM, user-facing (M-1).** The lead "shows that its factsheet is not available" can be false, because the private share page shows "being prepared" while a computation runs, and an unread state cannot rule that out. Fixed in 5dc7491f4: the lead is now "opens a page without its factsheet", true for both cards, and the founder's tail is unchanged. PROOF-01: the neutered copy put back the not-available lead and went RED on the same case, with `Expected "… opens a page without its factsheet …" / Received "… shows that its factsheet is not available …"`; after `cp` back, `cmp exit 0`, it was GREEN.
- **LOWs, recorded only:**
  - L-1: no link assertion for the contact form on this arm.
  - L-2: a stale lineage comment in owner-compute-state.test.tsx:300.
  - L-3: the UI-SPEC table and the plan must-haves still say "KCS12-UNREADABLE unchanged". The deviation is recorded in CONTEXT and ROADMAP.
  - L-4: an unread state on the owner page pairs the remedy line's reload with the share note's contact-form action, the same pairing already accepted on the public path.
  - L-5: docstring width, and present-tense KCS12-UNREADABLE mentions in comments.
