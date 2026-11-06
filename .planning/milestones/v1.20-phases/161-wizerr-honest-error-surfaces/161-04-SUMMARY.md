---
phase: 161-wizerr-honest-error-surfaces
plan: 04
subsystem: wizard-remedy-semantics
status: complete
tags: [wizerr, wizard, non-destructive-remedy, data-loss, low-2, anti-vacuity, negative-control]
requires:
  - "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx onReviewKeys — the non-destructive precedent one prop away (WIZ-03)"
  - "src/app/api/strategies/create-with-key/route.ts resolveByVenueIdentity — returns kind:'draft' for a surviving wizard draft, which is what makes keep-and-resume honest"
  - "the confirm dialog + handleDeleteDraft (140.3-10 / TRAP-4) — retained unchanged as the only destructive path"
provides:
  - "onTryAnotherKey as a pure step transition (setStep + persistPointer + telemetry), with the LOW-2 re-answer recorded at the callback"
  - "the [161-04 / WIZERR-02] wiring describe — no-DELETE positive pin + confirm-dialog NEGATIVE CONTROL"
  - "a non-destructive try_another_key remedy for 161-05 (KEY_ORPHANED) to point at"
affects:
  - "every wizard refusal that offers 'Try another key' (E2 surface)"
  - "161-05 / WIZERR-03 — KEY_ORPHANED's remedy is try_another_key, which now cannot destroy the draft"
  - "the [94-03] WIZ-03 describe and the [140.3-10 / TRAP-4] describe, both re-argued in place"
tech-stack:
  added: []
  patterns:
    - "a remedy-labeled control is non-destructive by construction; deletion lives only behind an explicit confirmation"
    - "matched-pair testing: a 'stopped doing X' pin is meaningless without the negative control proving X still happens where it should"
    - "RED-first against the UNCHANGED production code — a stronger anti-vacuity proof than neutering a landed fix"
    - "re-argue a superseded pin in place with a dated tombstone naming its successor, never delete it quietly"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"
    - ".planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md"
decisions:
  - "keep-and-resume (RESEARCH Open Question 3): the draft deliberately survives 'Try another key'. MEASURED that this is honest — resolveByVenueIdentity returns kind:'draft' for the surviving row and create-with-key answers ok+deduped, so a same-key resubmit RESUMES rather than replaying stale state."
  - "persistPointer('connect_key') was ADDED to the callback, mirroring onReviewKeys. The old callback did not persist because it was deleting the draft; now that the draft survives, a pointer still naming sync_preview would be a small copy of the LOW-2 divergence. Pinned, so the choice cannot decay into an accident."
  - "The two existing tests that pinned the DESTRUCTIVE contract were re-argued in place, not deleted: [94-03]'s delete pin now guards Pitfall 3's actual worry (the two affordances stay distinct callbacks), and TRAP-4's anti-regression now pins that the trap surface is closed AND that closing it did not cost the wizard its ability to delete."
  - "handleDeleteDraft now has exactly ONE caller (the confirm dialog's danger button), reachable from two confirmed entrances (chrome Delete-draft, start_fresh)."
metrics:
  duration: "~55 min"
  completed: 2026-08-24
actuals:
  tokens: 5735
  tasks: 2
  commits: 2
---

# Phase 161 Plan 04: "Try another key" stops destroying the draft it was offered to save — Summary

The remedy offered on every wizard refusal is now the pure step transition its neighbour
`onReviewKeys` already models, and the red-team finding (LOW-2) that the deleted lines existed
to close is re-answered for the new shape at the callback rather than dropped with them.

## What changed, per task

### Task 1 — `onTryAnotherKey` becomes a pure step transition (`188369db`)

`src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx`

Before, the callback was:

```typescript
setStep("connect_key");
setWizardSessionId(newWizardSessionId());   // optimistic re-mint
void handleDeleteDraft();                    // fire-and-forget DELETE
trackForQuantsEventClient("wizard_try_different_key", { … });
```

One click on a control labelled as a way *forward* deleted the draft and every `strategy_keys`
member under it, with no confirmation and no way back. After:

```typescript
setStep("connect_key");
persistPointer("connect_key", strategyId);
trackForQuantsEventClient("wizard_try_different_key", { … });
```

- No `handleDeleteDraft`, no `setWizardSessionId` — the acceptance criteria's two prohibitions.
- The chrome's Delete-draft button and `start_fresh` are **untouched**: `git diff` shows no
  hunks in `handleDeleteDraft` (`:959-1028`), in `handleStartFresh`'s body, or in the confirm
  dialog's markup. The only edit near them is the docblock correction described below.
- `trackForQuantsEventClient` is retained — the plan removed the *destruction*, not the count.

**Comments corrected** (a comment describing behavior that no longer exists is a false sentence
in this phase's own class):

1. The `onReviewKeys` comment said "*Unlike onTryAnotherKey* it does NOT handleDeleteDraft …
   and does NOT regenerate wizardSessionId". Both callbacks are now that shape.
2. `handleStartFresh`'s docblock closed with "NOT touched, deliberately: **the two paths** whose
   comments state that a delete IS intended — `onTryAnotherKey`'s fire-and-forget
   `void handleDeleteDraft()` … and the confirm dialog's own danger button." One of those two is
   gone. The replacement records that a remedy offered on a refusal is not a place a delete may
   be "intended" — the same argument the docblock already made about `start_fresh` one
   paragraph up — and that `handleDeleteDraft` consequently has exactly one caller.
3. Two stale comments in the test file that called `onTryAnotherKey` "the DESTRUCTIVE path".

### Task 2 — wiring pins, positive + negative control (`a790cfc0`)

`src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx`, new describe
`[161-04 / WIZERR-02]`. Both cases drive the **real** `WizardClient` callback through the real
`SyncPreviewStep` prop and the real confirm dialog — a hand-built callback would prove nothing
about the call site.

Positive (`clicking Try another key issues NO draft DELETE, and the draft stays bound`):
1. transitions to `connect_key`, `sync_preview` gone;
2. **zero** DELETE fetches to the draft route, and `clearWizardState` never called;
3. `strategyId` survived — observed via the chrome delete control, which is gated on
   `canDelete={Boolean(strategyId)}`;
4. no session id minted, and the connect step carries the *same* id the sync step held;
5. no confirmation dialog interposed (this is not TRAP-4's destructive-but-confirmed shape);
6. the resume pointer followed the user to `connect_key`.

Negative control (`the confirm-dialog danger button still issues the DELETE`): entered through
the **chrome's** Delete-draft control (the TRAP-4 describe already covers the `start_fresh`
entrance to the same dialog), asserts the dialog opens, that opening confirms nothing, then that
the danger button issues exactly one DELETE.

## LOW-2 re-answer (recorded at the callback and here, per must-have truth #3)

LOW-2's threat was **not** the delete. It was a **FAILED background DELETE** leaving the old
draft alive while a **REGENERATED session id** made the client believe it had a clean slate —
the silent divergence between client belief and server state was the bug, and the optimistic
re-mint was the patch for it.

With no delete attempted and no id regenerated, client belief and server state agree by
construction:

- **Same key resubmitted** ⇒ `resolveByVenueIdentity` finds the live key and its surviving
  `source='wizard'` / `status='draft'` row and returns `kind:"draft"`
  [MEASURED at HEAD: `create-with-key/route.ts:269`], and the route answers
  `{ok:true, strategy_id, api_key_id, deduped:true}` [`:634-649`] — the wizard **resumes** that
  draft and the neutral WIZCONT-02 dedup strip says so on screen. That is honest resume, not a
  silent replay of stale state: the surviving draft **is** current state.
- **Different key** ⇒ the normal create path runs; the old draft ages into the existing ≥7-day
  nightly sweep or the user's own explicit delete.

The plan instructed me to STOP and surface it if the resolver did anything other than resume for
the same-key case. **It resumes** — checked first-hand at both the resolver and its call site, so
no stop was needed. The re-answer therefore rests on a measurement, not on the plan's assertion.

## How the negative control was proved non-vacuous (the load-bearing half)

The prompt's demand was to prove the deliberate delete paths *still delete*, not merely that the
remedy stopped. Every RED below was **observed first-hand**; each neuter was restored and
verified byte-identical with `git diff --exit-code`.

**RED #1 — the strongest one: the pin was written BEFORE the fix and run against the real,
unchanged, still-deleting `onTryAnotherKey`.** This is the 161-03 lesson applied: rather than
assume the pin catches the arm, I watched it catch the actual production defect.

```
AssertionError: A remedy-labeled control must not delete the user's draft.:
  expected [ [ …(2) ] ] to have a length of +0 but got 1
 ❯ src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx:1301:7
```

The negative control was GREEN in that same pre-fix run, as it must be — it asserts behavior the
old tree also had.

**RED #2 — re-adding `void handleDeleteDraft()` to the landed callback** (the plan's own neuter):

```
× ANTI-REGRESSION — the trap surface is closed, and closing it did not break deletion
× clicking Try another key issues NO draft DELETE, and the draft stays bound to the wizard
AssertionError: An error state's own control must not destroy a draft in one click.:
  expected [ [ …(2) ] ] to have a length of +0 but got 1
AssertionError: A remedy-labeled control must not delete the user's draft.:
  expected [ [ …(2) ] ] to have a length of +0 but got 1
```

**RED #3 — dropping `persistPointer` from the callback**, proving the deliberate addition is
pinned and not incidental:

```
AssertionError: the surviving draft's resume pointer must follow the user to connect_key:
  expected false to be true // Object.is equality
 ❯ src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx:1390:9
```

**RED #4 — THE NEGATIVE CONTROL'S OWN NEUTER.** The confirm dialog's danger button was pointed
away from `handleDeleteDraft` (`onClick={() => setConfirmDelete(false)}`) — i.e. exactly the
over-eager class fix that would make "the remedy no longer deletes" true by breaking deletion
outright. Three tests went red, including the new negative control:

```
× confirming DOES delete — the affordance still works, it just asks first
× ANTI-REGRESSION — the trap surface is closed, and closing it did not break deletion
× NEGATIVE CONTROL — the confirm-dialog danger button still issues the DELETE
AssertionError: WIZERR-02 removes destruction from the REMEDY, not from the wizard.:
  expected [] to have a length of 1 but got +0
 ❯ src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx:1423:9
```

Vacuity traps checked explicitly:
- **`"anything".includes("")`**: the only identity comparison is the session id, guarded first by
  `expect(sessionBefore, "the mounted session id must be a real string").toBeTruthy()` so a blank
  id cannot make the survival check compare nothing against nothing. Every substring match uses a
  hardcoded non-empty route literal.
- **Timing vacuity**: `expect(deleteCalls).toHaveLength(0)` could pass by racing a pending
  promise. It does not — `wizardFetch` has no `await` before its `fetch`, so a fire-and-forget
  delete lands on the spy inside the click handler's own tick, and RED #1/#2 demonstrate the
  assertion catching a real delete at exactly this timing. A microtask flush is kept as
  belt-and-braces.
- **`vi.stubGlobal`**: none introduced. `vi.spyOn(globalThis, "fetch")` with
  `vi.restoreAllMocks()` in `afterEach`, matching the file's existing convention (DEF-16-1 /
  OPS-11).

## Deviations from Plan

### 1. [Rule 1 — the plan did not enumerate two existing tests that pinned the DEFECT]

**Found during:** Task 1, immediately after the source change.
**Issue:** two tests asserted the destructive contract WIZERR-02 deliberately inverts, so the
source change alone left the suite RED:

- `WizardClient.test.tsx:679` `[94-03]` — *"Try another key (single-key destructive path) still
  issues the draft DELETE"*, `expect(deleteCalls).toHaveLength(1)` plus
  `expect(newWizardSessionIdMock…).toBeGreaterThan(1)`.
- `WizardClient.test.tsx:1212` `[140.3-10 / TRAP-4]` — *"ANTI-REGRESSION — the INTENTIONAL delete
  path is untouched and still deletes"*.

I did not treat this as a plan-vs-codebase contradiction requiring a stop: the requirement,
161-UI-SPEC ("'Try another key' is REMOVED from the destructive set"), and the plan's own
prohibitions all mandate exactly this inversion. What the plan omitted was the *bookkeeping*.

**Fix:** re-argued both **in place**, with dated tombstones naming their successor rather than
quiet deletion:
- `[94-03]`'s slot now pins research Pitfall 3's *actual* worry — that the two review
  affordances are separate callbacks and must not be collapsed. Their bodies are now the same
  shape, so the surviving observable is telemetry: `wizard_try_different_key` fires for the key
  remedy and **not** for the composite review. Collapse one onto the other and it goes red.
- `[140.3-10 / TRAP-4]`'s slot now pins that the trap surface is **closed** (the remedy deletes
  nothing and opens no dialog) **and**, from the same mount in sequence, that the wizard can
  still delete through the confirmed path — because the failure worth catching is a class fix
  that makes the first half true by breaking the second.

**Files:** `WizardClient.test.tsx`. **Commit:** `188369db` (landed with the source change — a
commit where the suite is red is not a commit).

**Consequence for the plan's task split:** Task 1's commit therefore touches
`WizardClient.test.tsx` as well as `WizardClient.tsx`, where the plan's Task 1 `<files>` named
only the source. Both files are in the plan's `files_modified`.

### 2. [Plan-authorised judgement] `persistPointer` added to the callback

The plan said "`setStep("connect_key")` only" but scoped that by its own em-dash to "no
`handleDeleteDraft`", and told me to adopt "the `onReviewKeys` shape" — which includes
`persistPointer`. I included it, and argued it at the callback: the old code did not persist
because it was deleting the draft outright; now that the draft survives, leaving the resume
pointer on `sync_preview` while the client sits on `connect_key` is a small instance of the very
client-belief-vs-persisted-state divergence LOW-2 was about. Acceptance criteria are unaffected
(they forbid `handleDeleteDraft` and `setWizardSessionId`, not this). It is pinned (RED #3) so it
cannot decay into an accident.

### 3. [Out of scope — logged, not fixed] `contracts-registry` B25 timeout

First full-suite run reddened
`src/__tests__/contracts/contracts-registry.test.ts > [B25] … resolves every quantalyze rule to
"error" for a representative src file` with `Error: Test timed out in 5000ms`. An immediate
second full-suite run of the identical tree was **788 passed / 0 failed**; standalone the file
runs in 3.72s. It is a hard 5s budget on a test that boots ESLint, under parallel load — this
plan added no lint config. Recorded as **D-161-04** in `deferred-items.md` so the next red on
that name is recognised rather than re-diagnosed, per the executor SCOPE BOUNDARY.

## Verification

| Gate | Command | Result |
|---|---|---|
| Task 1 | `npx vitest run 'src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx'` | 34 passed |
| Task 2 | same file, after the new describe | **36 passed** |
| Wave gate | `npm run test` (full suite — the only run that clears `src/__tests__/contracts/`) | **788 files / 12121 tests passed, 19 files + 281 tests skipped (pre-existing), 0 failed** |
| Types | `npx tsc --noEmit` | clean |
| Lint | `npx eslint` on both touched files | clean |

Invocation constraints honoured: repo root, **not** a worktree, **not** wrapped in
`gstack-evidence run`. The `|jsdom|` label in the failure headers is the project default and was
not "fixed".

Branch protection is off until there are paying clients, so every CI gate is advisory at merge:
these pins **would have** caught a re-added delete, a broken deliberate delete, and a dropped
resume pointer.

## Must-haves

| Truth | Status |
|---|---|
| 'Try another key' issues NO draft DELETE and cascades away NO strategy_keys members | ✅ pinned; RED observed against the real pre-fix code |
| The deliberate delete paths still delete, with their existing confirmation, byte-identical | ✅ no diff hunks in `handleDeleteDraft` / dialog / `handleStartFresh` body; negative control + its own neuter (RED #4) |
| The LOW-2 calculus re-answered explicitly at the callback and in the SUMMARY | ✅ both, and grounded in a first-hand measurement of the resolver |
| Same key after 'Try another key' resumes the surviving draft via the venue-identity resolver | ✅ MEASURED: `route.ts:269` → `kind:"draft"` → `:634-649` `ok + deduped` |
| No loading / success / empty-state edit on E2; diff touches the remedy callback and adjacent comments only | ✅ `git diff --stat`: 2 files, both named by the plan; no render/CSS change |
| Envelope remedy bullets wrap without truncation, body grows downward, no fixed-height clipping (backstop) | ✅ vacuously preserved — no envelope, layout, or CSS was touched; the change is confined to what the button *does* |

## Threat model

- **T-161-10 (DoS / user-inflicted data loss — the recorded class), `mitigate`** — closed. The
  remedy is a pure step transition; deletion exists only behind the retained confirmation; the
  wiring test proves no DELETE is issued and the negative control proves the fix was not achieved
  by breaking deletion.
- **T-161-11 (Spoofing / session replay, LOW-2 lineage), `mitigate`** — closed. No id
  regeneration and no background delete ⇒ client belief and server state agree by construction;
  the reasoning is recorded at the callback and rests on a measured resolver behavior.

## Known Stubs

None. No hardcoded empty values, placeholder text, TODO/FIXME, or unwired data sources were
introduced. **No test was skipped, deleted, or marked `todo`** — the two superseded pins were
re-argued into live, failing-capable tests (both demonstrated red under neuter). The 281 skips in
the full suite are pre-existing and unchanged. No `<verify>` went unrun.

## Threat Flags

None — no new security-relevant surface. The change removes a mutation; it adds no endpoint, no
auth path, no file access, and no schema change.

## Notes for the next executor (161-05 / WIZERR-03 depends on this)

1. **`try_another_key` is now safe to offer as `KEY_ORPHANED`'s remedy.** That was the whole
   reason this plan is in wave 1: shipping an honest refusal whose only remedy destroys the
   user's work would have been self-defeating. Clicking it now returns the user to `connect_key`
   with the draft intact.
2. **⚠️ But check the orphan's own arithmetic before relying on the resume path.** My LOW-2
   re-answer's same-key branch depends on a `status='draft'` / `source='wizard'` row still
   hanging off the live key. For `KEY_ORPHANED` that row is precisely what is missing — the
   resolver returns `UNRESOLVED`, not `kind:"draft"` (`route.ts:306`). So on the orphan arm
   "Try another key" is a genuine *different-key* invitation, and re-submitting the SAME key
   still falls through to the 23505 arm. 161-05's copy must not imply the same key will now work.
3. **This plan removed one of `handleDeleteDraft`'s two callers.** It now has exactly one (the
   confirm dialog's danger button), reachable from two confirmed entrances. If a future plan adds
   a third caller, the `handleStartFresh` docblock's claim about "one deliberate delete" becomes
   a false sentence — the class this phase exists to close.
4. **⛔ Do not re-simplify `onReviewKeys` and `onTryAnotherKey` into one prop.** Their bodies are
   now identical but for telemetry, which makes the collapse tempting. The re-argued `[94-03]`
   test will go red, deliberately — they are two user-facing affordances on two different
   surfaces (composite review vs single-key remedy) and 161-05 attaches meaning to the second.
5. **The `[161-04 / WIZERR-02]` describe is a matched pair.** Deleting the negative control
   leaves a positive case that a wizard which had merely lost the ability to delete would satisfy.
   Its docblock says so.
6. **`npm run test` takes ~300s and its B25 contract case has a marginal 5s budget** (D-161-04).
   A single red on that name with `Test timed out in 5000ms` is the flake, not your change —
   re-run before investigating.

## Self-Check: PASSED

- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — FOUND; the `onTryAnotherKey`
  body with comments stripped is exactly three statements (`setStep`, `persistPointer`,
  `trackForQuantsEventClient`) — no `handleDeleteDraft`, no `setWizardSessionId`.
- `git diff 948d9cf0..HEAD` on that file produces exactly TWO hunks: `@@ -1066,11 +1066,16 @@`
  (the `handleStartFresh` **docblock** — prose only; `setConfirmDelete(true)` is an unchanged
  context line) and `@@ -1228,29 +1233,69 @@` (the two callbacks). `handleDeleteDraft`
  (`:959-1028`) and the confirm-dialog `Modal` are outside both hunks ⇒ **byte-identical**.
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx` — FOUND, contains the
  `[161-04 / WIZERR-02]` describe and its `NEGATIVE CONTROL` case.
- `.planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md` — FOUND, contains
  `D-161-04`.
- No `TODO` / `FIXME` / `placeholder` / `.skip(` / `.todo(` introduced anywhere in the diff.
- Commit `188369db` — FOUND.
- Commit `a790cfc0` — FOUND.
