---
phase: 161-wizerr-honest-error-surfaces
plan: 10
subsystem: dashboard-write-dialogs
tags: [WIZERR-07, error-copy, coverage-law, dashboard-dialogs, E5]
status: complete
requires:
  - 161-07 (EXPECTED_TABLE_SIZE at 84; the pin-moving convention)
provides:
  - "code-first literals on every error arm of strategies/[id]/name, strategies/[id]/ownership and portfolio-strategies/allocation"
  - "DASHBOARD_DIALOG_ROUTE_CODES + recogniseDashboardDialogCode — one shared per-route roster and the ONLY guarded cast"
  - "4 new WizardErrorCode members (the DASHBOARD_* family) with copy"
  - "src/lib/dialog-envelope.invariant.test.ts — first coverage law reaching a population outside the wizard-steps directory"
affects:
  - src/lib/wizardErrors.ts
  - the three dashboard write dialogs and their three routes
tech-stack:
  added: []
  patterns:
    - "route emits a machine code first-position; consumer recognises through ONE shared per-route roster"
    - "field-level refusals stay inline (which is what gates the correlation id off actionable arms)"
key-files:
  created:
    - src/lib/dialog-envelope.invariant.test.ts
  modified:
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/app/api/strategies/[id]/name/route.ts
    - src/app/api/strategies/[id]/name/route.test.ts
    - src/app/api/strategies/[id]/ownership/route.ts
    - src/app/api/strategies/[id]/ownership/route.test.ts
    - src/app/api/portfolio-strategies/allocation/route.ts
    - src/app/api/portfolio-strategies/allocation/route.test.ts
    - src/components/strategy/RenameStrategyDialog.tsx
    - src/components/strategy/RenameStrategyDialog.test.tsx
    - src/components/strategy/MarkOwnershipDialog.tsx
    - src/components/strategy/MarkOwnershipDialog.test.tsx
    - src/app/(dashboard)/allocations/components/AllocateDialog.tsx
    - src/app/(dashboard)/allocations/components/AllocateDialog.test.tsx
decisions:
  - "All three routes grow code-first literals; the dialogs discriminate on the code. Prose-keyed lookups retired."
  - "The rosters live in wizardErrors.ts, not at each consumer — one shared table, per-route granularity, one guarded cast."
  - "4 members minted rather than reusing SESSION_EXPIRED / VALIDATION_FAILED / SEAM_INTERNAL_FAULT / GATE_DRAFT_GONE: each near-neighbour's SENTENCE is false on a dashboard dialog."
  - "The ownership route's FIVE internal-error arms share ONE code — same user situation, same remedy; each site already logs its own distinct server line."
  - "AllocateDialog's two incumbent reads are KEPT ahead of the code channel as a rolling-deploy compatibility arm; they AGREE with it, and agreement is asserted."
  - "E5 copy was NOT padded to reach '3 bullets' on two dialogs that cannot emit a 3-bullet code."
metrics:
  duration: ~2h40m
  completed: 2026-08-24
actuals:
  tokens: 71000
  tasks: 3
  commits: 3
---

# Phase 161 Plan 10: dashboard dialogs stop minting UNKNOWN — Summary

Three dashboard write dialogs that built `code: "UNKNOWN"` for failures their routes had
already classified now read a machine code their routes emit code-first, translated through
ONE shared per-route roster; and the phase's coverage law finally reaches a population
outside the wizard-steps directory, which is where the class regrew after Phase 153.

**Commits**

| Task | Commit | What |
|---|---|---|
| 1 | `31d0333a` | name route + RenameStrategyDialog + the 4 mints + the shared recogniser |
| 2 | `0b8f08c1` | ownership + allocation routes, MarkOwnershipDialog + AllocateDialog |
| 3 | `0aa731d7` | `dialog-envelope.invariant.test.ts` + the automatable half of E5 |

---

## The measured problem, restated from what I found at HEAD

The plan's framing ("stop minting `code: UNKNOWN`") understated the work exactly as CONTEXT
warned. The dialogs could not consume a code channel because **the routes did not emit one**.
Between them the three dialogs recognised **3 of their routes' 46 error arms**, and **two of
those three recognitions worked by matching `body.error` PROSE**:

| Dialog | Recognised at HEAD | How |
|---|---|---|
| `AllocateDialog` | 2 of 23 | `res.status === 429`; `body.error === "not_allocatable"` (prose) |
| `RenameStrategyDialog` | 2 of 9, both field-level | `ROUTE_FIELD_ERRORS[body.error]` (prose-keyed local table) |
| `MarkOwnershipDialog` | 1 of 14 | `refusal.error === "live_allocation"` (prose) |

---

## Arm inventories (measured at HEAD, hand-typed into the suites)

### `strategies/[id]/name` — 9 emitters, 8 distinct arms

| Arm | Status | Sentence (unchanged) | Code |
|---|---|---|---|
| no session | 401 | `unauthorized` | `DASHBOARD_SIGNED_OUT` |
| malformed id | 400 | `id must be a UUID` | `DASHBOARD_REQUEST_INVALID` |
| unparseable body | 400 | `invalid json` | `DASHBOARD_REQUEST_INVALID` |
| non-string name | 400 | `invalid name` | `NAME_REQUIRED` |
| empty after trim | 400 | `invalid name` | `NAME_REQUIRED` |
| over the cap | 400 | `name too long` | `NAME_TOO_LONG` |
| limiter exhausted | 429 | `Too many requests` | `RATE_LIMITED` |
| UPDATE errored | 500 | `internal error` | `DASHBOARD_WRITE_FAILED` |
| zero rows matched | 404 | `strategy not found` | `DASHBOARD_ROW_STALE` |

### `strategies/[id]/ownership` — 14 emitters

401 `unauthorized`, 400 `id must be a UUID`, 400 `invalid json`, 400 `mark must be one of: …`,
400 `confirm_remove_allocation must be a boolean`, 429 `Too many requests`, **5×** 500
`internal error`, 409 `live_allocation` (+`allocated_amount`), **2×** 404 `strategy not found`.

### `portfolio-strategies/allocation` — 23 emitters across both verbs

401 `unauthorized` ×2, 400 `invalid json` ×2, 400 `strategy_id is required` ×2, 400
`allocated_amount must be a positive number no greater than …`, 429 `Too many requests` ×2,
500 `internal error` ×9, 404 `strategy not found`, 409 `not_allocatable` ×2, 404
`portfolio not found`, 404 `investment row not found`.

**Every sentence is byte-identical.** `git diff` on the name route shows only additive `code`
keys — no sentence, status or header hunk. Each route's suite carries a hand-typed sentence
inventory transcribed from the **pre-code source at `git show HEAD:…`**, not from the current
file, so a rewording reds by name.

---

## The four minted members (84 → 88, both pins in the same commit)

Baseline **re-measured at HEAD before moving** (`grep -an EXPECTED_TABLE_SIZE` → `84`, `84`;
161-05 took it 81→82, 161-07 took it 82→84). Both sites now read `88`, each with its own
re-run reasoning paragraph (destructive-class scan at one site, banned-claims scan at the
other). The `[153.1-04]` divergence guard is green.

| Member | Covers | Rejected near-neighbour, and why (read at the neighbour's own entry) |
|---|---|---|
| `DASHBOARD_SIGNED_OUT` | 401 on all three routes | `SESSION_EXPIRED` — its cause says "Your wizard draft is saved… your form answers and preview are still there" and its fix says "you will need to paste the secret once more". No draft, no preview, no secret on a dashboard dialog; the second is an instruction the user cannot follow. |
| `DASHBOARD_REQUEST_INVALID` | every 400 shape refusal | `VALIDATION_FAILED` — title and cause are almost exactly right; its **fix** is not: "Contact security@quantalyze.com with your draft ID". There is no draft ID here, so its one instruction cannot be carried out. |
| `DASHBOARD_WRITE_FAILED` | every 500 `internal error` | `SEAM_INTERNAL_FAULT` ("…while we checked this key", "no key was stored" — no key is checked or stored here); `SERVICE_UNAVAILABLE_RETRY` / `SERVICE_UNREACHABLE` (both describe the analytics seam; these faults never crossed a service boundary). |
| `DASHBOARD_ROW_STALE` | every 404 | `GATE_DRAFT_GONE` / `DRAFT_STATE_INVALID` (every sentence is about a wizard draft); `GUARD_BLOCKED` (asserts a permissions verdict this merged 404 cannot establish). |

`recoverable` derivations: `DASHBOARD_WRITE_FAILED` is the **only** recoverable member of the
family (`clear_and_retry`) — a query that errored once may succeed next time, and these writes
set a stated value so a retry cannot double anything. The other three carry neither member of
`RECOVERABLE_ACTIONS`, so no Retry control renders on an error the server refuses identically.

### The shared roster, and why it is not at each consumer

`DASHBOARD_DIALOG_ROUTE_CODES` (a `ReadonlyMap<DashboardDialogRoute, ReadonlySet<WizardErrorCode>>`)
plus `recogniseDashboardDialogCode(route, wireCode)` live in `wizardErrors.ts`.

- **Not** in `SEAM_CODE_TO_WIZARD_CODE`: that table's own docblock forbids aliasing codes minted
  by our OWN routes ("the vocabulary starts lying" failure). None of the four is added there.
- **Not** per-component `KNOWN_*_CODES` sets like the wizard steps use: the plan's must-have is
  explicit that no per-consumer local code table may be introduced. Keeping them shared is also
  what lets the new law **import the live map** instead of re-parsing three component files, so
  a future roster row joins the law with no test edit.
- **Per-route, not one flat set**, on `ConnectKeyStep`'s argument: a flat set would go green
  while the rename dialog silently admitted an allocation-only code. Pinned both directions.
- The `code as WizardErrorCode` cast happens **once**, inside the recogniser, after `.has()`.

### Three wire codes deliberately NOT `WizardErrorCode`s

`NAME_REQUIRED`, `NAME_TOO_LONG` (field-level, land inline at the Name input) and
`LIVE_ALLOCATION` (a question, not a refusal — it swaps in the confirmation body). Each is an
**explicit listed disposition with a reason** in the coverage law, not an omission.

---

## The ownership route's five `internal error` arms share ONE code — the decision and its reason

They differ by which internal query failed: the portfolio lookup, the position lookup, the flip
RPC erroring, the flip RPC returning no row, and the plain UPDATE. **Shared.** The user's
situation ("we could not save that change") and remedy ("nothing was saved — try again, and
tell us if it repeats") are identical at all five, and the distinguishing fact is one the user
cannot act on. Each site already logs its own distinct server-side line, which is where the
distinction belongs. A code per call site would put our internal call graph in front of a person
trying to mark a strategy. Recorded at the route and pinned (`expect(internal).toBe(5)`) so the
decision cannot be reversed silently in either direction.

## The allocation route's codes go through the existing helper

All 23 arms are the first argument of `json(...)`. Pinned two ways: `json({ code: "…` appears
23 times, and `NextResponse.json(` appears **exactly once** in the file — inside the helper's own
body. A second occurrence is a parallel response path, which would silently lose
`NO_STORE_HEADERS` while looking correct.

---

## Observed RED — four neuter cycles, each restored byte-identical

House three-part shape: neuter → observed message → restored (checksum verified).

**Neuter A — remove the `code` from the name route's 404 arm** (Task 1)
```
FAIL src/app/api/strategies/[id]/name/route.test.ts > … zero rows matched … answers its own code with its sentence unchanged
AssertionError: expected undefined to be 'DASHBOARD_ROW_STALE' // Object.is equality
FAIL … SOURCE PIN: every code literal is written FIRST in its object literal
AssertionError: expected 8 to be 9 // Object.is equality
```
Restored: `shasum` matched `69579b74d0085aab0616d37c04931c80b525d443`.

⚠️ **A finding worth recording.** The plan expected this neuter to redden *the dialog case*. It
did **not** — the dialog suites feed their own fixtures and never read the route source, so they
are decoupled from it by construction. What caught it was the route-side pin. That is why
Neuter B exists.

**Neuter B — drop `DASHBOARD_ROW_STALE` from the name route's roster** (Task 1)
```
FAIL src/lib/wizardErrors.test.ts > … the dashboard recogniser admits only rostered codes > admits a code the route really emits, per route
AssertionError: expected 'UNKNOWN' to be 'DASHBOARD_ROW_STALE' // Object.is equality
FAIL src/components/strategy/RenameStrategyDialog.test.tsx > … a row that is no longer renameable renders its own envelope code
```
Restored: `shasum` matched `25b11c4aa945bf933eef86173ec3b803216f3968`.

**Neuter C — revert `AllocateDialog`'s fallthrough to a blanket `buildEnvelope("UNKNOWN", …)`** (Task 2)
```
5 failed | 38 passed (43)
FAIL … a signed-out session renders its own envelope code
FAIL … a request our own page built wrong renders its own envelope code
FAIL … an internal fault renders its own envelope code
  expect(element).toHaveAttribute("data-error-code", "DASHBOARD_WRITE_FAILED")
FAIL … a row that is no longer there renders its own envelope code
FAIL … AGREEMENT 2/2: a body carrying ONLY the code resolves identically
```
**And the evidence the extension did not displace the in-file pattern:** with the neuter in
place, `-t "E5"` → `2 passed | 41 skipped` and `-t "429"` → `1 passed | 42 skipped`. Both
incumbent recognitions stayed green throughout, with **no fixture edits**.
Restored: `shasum` matched `da2f3ee8b6be4237aa639dba5f83657f98ae3ca2`.

**Neuter D(a) — remove one dialog's recognition of a route code** (Task 3, mandatory)
```
FAIL src/lib/dialog-envelope.invariant.test.ts > A. ARRIVAL: every code a route emits is rostered OR an explicit disposition
AssertionError: AllocateDialog: ALLOCATION_NOT_ALLOCATABLE is emitted by portfolio-strategies/allocation but is neither in its roster nor listed as a deliberate non-envelope. It will render UNKNOWN — 'we could not classify this failure' — for a failure the route classified.
FAIL … B. COPY: every rostered code has a real copy entry
AssertionError: expected 15 to be 16 // Object.is equality
```

**Neuter D(b) — blank the hand-typed population count (3 → 0)** (Task 3, mandatory)
```
FAIL … C. NON-VACUITY: the population is NON-EMPTY and matches the hand-typed count
AssertionError: … expected 3 to be +0 // Object.is equality
FAIL … C. every hand-typed DIALOGS row is really in the derived population
AssertionError: expected 3 to be +0 // Object.is equality
```
Both restored: `shasum` matched `25b11c4aa945bf933eef86173ec3b803216f3968` and
`ae00b02520f7830161cd7a3fa2e9bd75b6c4e4c8`.

---

## The coverage law — population, and how I counted it

`src/lib/dialog-envelope.invariant.test.ts` (`// @vitest-environment node`, 12 cases).

**Predicate, in full prose:** a `.tsx` file not containing `.test.`, anywhere under
`src/components` or `src/app/(dashboard)`, **excluding** any path containing `wizard/steps`,
read from disk and comment-stripped with `stripCommentsPreserveLines(src, "ts")`, is a member
iff it **both** calls `buildEnvelope(` **and** mounts `<Modal`.

**How I counted:** ran the predicate over disk and counted the printed paths by hand.

```
population size: 3
 - src/app/(dashboard)/allocations/components/AllocateDialog.tsx
 - src/components/strategy/MarkOwnershipDialog.tsx
 - src/components/strategy/RenameStrategyDialog.tsx
wizard-step buildEnvelope files (excluded): 6
```

`EXPECTED_DIALOG_COUNT = 3` is that hand-typed number, never `derived.length`. The complement
is the point of the law: **6** wizard-step files were watched by the incumbent law and **3**
dashboard dialogs by nothing.

**Why the `<Modal` clause is load-bearing.** A raw `grep -rl buildEnvelope src/` outside
wizard-steps returns **7** paths at HEAD. One of them is
`strategies/[id]/ownership/route.ts` — which mentions `buildEnvelope` only in a docblock **this
plan wrote**. A law on the raw count would demand a roster for a route handler. The other two
non-dialogs it correctly excludes are `finalize-wizard/route.ts` and `venueOutageCopy.ts`.

**What it asserts:** (A) arrival — every code a route emits is rostered **or** an explicit
disposition with a ≥40-char reason, and a code that is *both* also reds; (B) copy — every
rostered code has a real entry with a usable title and a non-empty remedy list (16 checked,
hand-counted 5+5+6); (C) non-vacuity — population non-empty **and** equal to the hand-typed
literal, both directions (a listed row missing from the derived set also reds). Plus a positive
self-test (scanner finds `buildEnvelope` in ≥2 dialogs), and two negative self-tests (a
commented mention is not counted; a non-dialog that builds envelopes is not counted).

**Terminal-UNKNOWN dispositions, listed with reasons** (4): transport failure, unreadable body,
unrostered code, and the shared CSRF 403 (emitted by `src/lib/csrf.ts`, a cross-cutting change
this plan did not scope; a browser-originated dialog request always carries an Origin).

---

## ⚠️ E5 — what I actually did, split into the two halves

### The AUTOMATED half (data layer) — done

Per-dialog case asserting every `fix[]` bullet reaches the DOM: the rendered `<li>` list is
compared against `WIZARD_ERROR_COPY[code].fix` — two different artefacts, so a data path that
truncated the list moves one side and not the other.

**A deviation, stated plainly.** The plan asked for a **≥3-bullet** case on **all three**
dialogs. Measured at HEAD, only **one** code any of the three routes emits has three bullets:

| Dialog | Max reachable `fix[]` bullets |
|---|---|
| `RenameStrategyDialog` | 2 |
| `MarkOwnershipDialog` | 2 |
| `AllocateDialog` | **3** (`ALLOCATION_NOT_ALLOCATABLE`) |

I **refused to pad the copy** to reach the number — writing the product to fit the oracle is the
inverse of the rule this phase enforces. So: the genuine ≥3 case is on `AllocateDialog` (and it
asserts `expected.length >= 3`, so if that entry ever shrinks the phase's one multi-bullet case
reds rather than quietly becoming a 2-bullet case); the other two assert their **real** maximum,
derived from the live table, so a third bullet added later is covered with no test edit.

### The MANUAL half (rendered layout) — PERFORMED, and it does NOT clip

**⛔ This is recorded as MANUAL. The automated bullet-presence assertion above did not settle
it and must not be reported as having done so.**

`161-UI-SPEC`'s ⚠ row premise was re-verified WRONG at HEAD, as the plan's correction says:
`src/components/ui/Modal.tsx` has **no `max-h`, no `overflow`, no fixed height** — the only
`height` token in the file is the close icon's `<svg width="20" height="20">` at `:36`. That is
now pinned by the law, so if someone re-introduces a `max-h` the finding's own precondition reds
instead of rotting.

**What I did.** jsdom does no layout, so I measured the real question — viewport containment of
an *unbounded* body — in a **real Chromium** (Playwright, already a repo dependency) against a
static reproduction of the `Modal` + `ErrorEnvelope` markup and the real
`ALLOCATION_NOT_ALLOCATABLE` copy, at four viewports.

| Scenario | `dialogScrolls` | last bullet below fold | outcome |
|---|---|---|---|
| 3 bullets @ 900px | false | no | everything visible, no overflow |
| 3 bullets @ 500px | **true** | no | dialog scrolls; bullets visible, bottom control below fold |
| 3 bullets @ 360px | **true** | yes | dialog scrolls |
| 5 bullets @ 360px (stress) | **true** | yes | dialog scrolls |

The decisive fact: the UA stylesheet gives `<dialog>` **`overflow-y: auto`** and
**`max-height: calc(100% - 38px)`**. So an over-tall body **scrolls; it does not clip.** I then
scrolled it as a user would (`dlg.scrollTop = dlg.scrollHeight`) at the 360px viewport and
confirmed by measurement **and by screenshot** that the last bullet ("Close this dialog to see
the strategy's current state…") and every control — Cancel, Allocate, *Remove allocation…* —
become fully visible: `lastBulletVisible: true, lastControlVisible: true`.

**Verdict: the named assumption holds.** A tall envelope in these dialogs scrolls within the
viewport rather than clipping. Nothing to STOP and surface.

**⛔ What this does NOT establish, stated so nobody over-reads it.** This was a reproduction of
the markup, not the running application: it was not driven through the real Next.js app with a
real session, a real strategy row, and a real refusal from the route. Two things it therefore
cannot speak to — (a) whether an ancestor of the `<dialog>` in the real page tree introduces an
`overflow` or transform that changes the containing block; (b) Safari/Firefox, which were not
measured. Both are believed benign (the `<dialog>` is top-layer, so ancestors do not clip it,
and `overflow-y: auto` on `dialog` is in the HTML spec's suggested rendering), but *believed*
is not *measured*. **A founder eyes-on pass on the real Allocate dialog in Safari remains genuinely
unverified.** It is small, and it is not zero.

---

## Deviations from Plan

**1. [Scope — measured] E5's "≥3 bullets on all three dialogs" was not achievable without padding copy**
- **Found during:** Task 3.
- **Issue:** only `ALLOCATION_NOT_ALLOCATABLE` (3 bullets) is reachable; the rename and
  ownership routes emit no 3-bullet code.
- **Resolution:** genuine ≥3 case on `AllocateDialog`; the other two assert their real maximum,
  derived from the live table. Copy was **not** padded. Documented above and at each case.
- **Commit:** `0aa731d7`.

**2. [Rule 1 — latent bug found while rewriting] `MarkOwnershipDialog` could throw on an unreadable 409 body**
- **Found during:** Task 2.
- **Issue:** the old code called `await res.json()` **un-guarded** inside the `res.status === 409`
  branch, so a 409 whose body failed to parse threw into the transport `catch` and was reported
  as an offline/transport failure.
- **Fix:** one guarded body read (`.catch(() => null)`) ahead of the discrimination, so an
  unreadable body is an honest `UNKNOWN` envelope on the response path rather than an exception
  path. Pinned by a new case.
- **Commit:** `0b8f08c1`.

**3. [Deliberate, plan-directed] `AllocateDialog`'s prose read on `not_allocatable` was KEPT**
- The plan required both "retire prose-sniffing" (rename dialog) **and** "the existing 429 and
  not_allocatable reads keep working byte-identically… with no fixture edits" (AllocateDialog).
  Those pull in opposite directions on one arm. I followed each instruction literally: the
  rename dialog's `ROUTE_FIELD_ERRORS` is **deleted**; AllocateDialog's 409 prose read is kept
  **ahead of** the code channel and documented as a rolling-deploy compatibility arm with a
  stated deletion condition. It is not a competing discriminator — the route answers that arm
  with `code: "ALLOCATION_NOT_ALLOCATABLE"` too, so the two **agree**, and agreement (the
  standard `ConnectKeyStep` already records) is asserted by the `AGREEMENT 1/2` and `2/2` cases
  rather than narrated.

**4. [Behaviour change, deliberate and asserted] prose alone no longer classifies**
- Retiring the prose keys means a response from a deployment older than `31d0333a` gets a
  terminal envelope where it used to get the inline field message (rename) or the confirm body
  (ownership). This is the intended cost of the retirement, it is transient across a deploy, and
  it is **asserted rather than discovered** — `PROSE ALONE no longer classifies` cases exist in
  both dialog suites. On the ownership dialog this direction is the safer one: prose alone can no
  longer open the only client path to `confirm_remove_allocation: true`.

---

## Verification

All prose below uses "would have caught" — branch protection is off until there are paying
clients, so every CI gate is **advisory at merge** (ledger rule).

| Gate | Result |
|---|---|
| `npx vitest run src/lib/dialog-envelope.invariant.test.ts` | 12 passed |
| Task 1 suites (rename dialog + name route + wizardErrors) | 284 passed |
| Task 2 suites (mark dialog + allocate dialog + 2 routes) | 174 passed |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every touched source | clean |
| **`npm run test` (full)** | **791 files passed, 19 skipped; 12313 tests passed, 281 skipped; 280.41 s** |

The full-suite run is what clears `src/__tests__/contracts/` (which scan all of `src/`) and the
repo-wide ring/surface gates that depend on `AllocateDialog.test.tsx`'s `vi.mock` carve-out — a
file-scoped green cannot clear either. The 281 skips are pre-existing; this plan skipped nothing.

**AllocateDialog carve-out untouched — verified, not asserted.** `git diff` on that file
produces exactly two hunks: `@@ -26,6 +26,8 @@` (two import lines) and `@@ -785,6 +787,138 @@`
(the appended block). The `vi.mock` region at `:31-84` has no hunk. No second mock of either
primitive was added, none was unwrapped, none was moved.

**Tooling hazards honoured.** Every measurement over `src/lib/wizardErrors.test.ts` used
`grep -a`, `awk`, Python or Node — never bare `grep`. Its deliberate NUL at line 1572
(a `.join(" \0 ")` separator) was counted before and after **every** write to that file and is
still exactly **1**. vitest was run from the repo root, never wrapped in `gstack-evidence`.

---

## Known Stubs

None. No hardcoded empty value, placeholder string, TODO or FIXME was introduced. The
`?? "UNKNOWN"` / fall-to-`UNKNOWN` paths are **not** stubs — they are the honest terminal for a
genuinely unclassified failure, each is a listed disposition with a reason in the coverage law,
and each is exercised by a negative-control case.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change. The register's
five rows are mitigated as written: T-161-32 (copy names no key id, uid or venue internal; route
sentences pinned byte-identical), T-161-33 (one guarded cast, no `code as WizardErrorCode` at any
consumer — pinned by the arbitrary-string cases), T-161-34 (new law, proven falsifiable by two
observed REDs), T-161-35 (automated bullet presence + the manual layout measurement above),
T-161-36 (carve-out prohibited from change, verified by the full-suite run).

---

## Notes for the next executor (161-09, wave 5)

1. **The pins are at 88.** Both `EXPECTED_TABLE_SIZE` sites, each with its own re-run reasoning
   paragraph. Re-measure at HEAD before moving them again — this plan moved them 84 → 88.
2. **There is now a SECOND coverage law with its own population**, and the two are deliberately
   disjoint: `wizardErrors.invariant.test.ts` owns `wizard/steps`, and
   `dialog-envelope.invariant.test.ts` explicitly EXCLUDES that directory. If you add a law,
   say which population it owns — a merged one would go green while each half admitted the
   other's codes.
3. **`DASHBOARD_DIALOG_ROUTE_CODES` is the extension point.** A fourth dashboard dialog that
   calls `buildEnvelope` and mounts a `<Modal>` will red `EXPECTED_DIALOG_COUNT` **by name**.
   The correct response is a roster row + a `DIALOGS` row in the same commit, never bumping the
   literal.
4. **⚠️ Dialog suites are decoupled from route sources** (Neuter A's finding). A component case
   feeds its own fixture and cannot see a route that stopped emitting a code. If you need
   end-to-end arrival, the route-side pin is what carries it — do not assume a dialog test
   covers its route.
5. **The `code:`-first key order is load-bearing, not cosmetic.** Every coverage law in this repo
   derives its population with a `code:`-first predicate. An arm written `{ error, code }` is
   invisible to all of them. Three suites now pin this per route.
6. **`npm run test` took 280.41 s this run** (161-08 recorded 262.55 s, 161-07 163 s). Budget it.
7. **The one thing genuinely still unverified** is the E5 residue named above: a founder eyes-on
   pass on the real Allocate dialog in Safari. Everything measurable was measured; that is not.

---

## Self-Check: PASSED

- All 9 created/modified key files FOUND on disk.
- Commits `31d0333a`, `0b8f08c1`, `0aa731d7` — all FOUND in `git log --oneline --all`.
- `EXPECTED_TABLE_SIZE = 88` appears at exactly **2** sites (`grep -ac`), matching the
  divergence guard's requirement of exactly two hand-typed declarations.
- `src/lib/wizardErrors.test.ts` NUL count = **1**, unchanged (re-asserted after every write).
- `ROUTE_FIELD_ERRORS` absent from `RenameStrategyDialog.tsx`'s comment-stripped code (it
  survives only in the docblock recording what was retired, which is deliberate and is why the
  source pin is comment-stripped).
- Working tree clean on every neutered file after restore (`shasum` match recorded per neuter).
