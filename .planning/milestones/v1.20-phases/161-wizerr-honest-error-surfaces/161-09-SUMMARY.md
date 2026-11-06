---
phase: 161-wizerr-honest-error-surfaces
plan: 09
subsystem: key-connect-routes
tags: [WIZERR-08, error-codes, coverage-law, disclosure-boundary, F3]
status: complete
requires:
  - 161-05 (the 409-scoped population reasoning; ROUTES/expectedSites convention)
  - 161-06 (validate-and-encrypt's route.test.ts AnalyticsUpstreamError ctor parity)
  - 161-08 (this route's terminal arm vocabulary)
  - 161-10 (EXPECTED_TABLE_SIZE at 88; the two-disjoint-populations rule; the code:-first hazard)
provides:
  - "keys/validate-and-encrypt: four request-shape arms on the split vocabulary, KEY_INVALID_FORMAT retired from the route entirely"
  - "keys/validate-and-encrypt: all eleven literal-coded arms reordered to code:-first, making the route VISIBLE to the repo's coverage predicate for the first time"
  - "verify-strategy: five arms on true codes with five byte-identical sentences, plus the F3 ordering and enumeration pins"
  - "KNOWN_VALIDATE_AND_ENCRYPT_CODES — the route's declared vocabulary, in wizardErrors.ts"
  - "the 4th ROUTES row in wizardErrors.invariant.test.ts (statusRe [45]\\d\\d, expectedSites 11) + a per-route NON-EMPTY assertion + a per-route rosterFloor"
affects:
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/verify-strategy/route.ts
  - src/lib/wizardErrors.ts
tech-stack:
  added: []
  patterns:
    - "code:-first key order is a HARD requirement on any route a coverage law watches"
    - "a law row lands in the same wave the route becomes visible, never before"
key-files:
  created: []
  modified:
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/app/api/verify-strategy/route.ts
    - src/app/api/verify-strategy/route.test.ts
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.invariant.test.ts
decisions:
  - "The plan's Task 3 premise was STALE: validate-and-encrypt's derived population at HEAD was ZERO, not non-empty. All eleven literal-coded arms were reordered to code:-first (153.1-05's precedent) so the row lands over a real population."
  - "statusRe is the WIDE [45]\\d\\d fragment. A 400-only row would see 5 of 11 and would NOT see STALE_CLIENT (409) — the code the row exists to catch."
  - "expectedSites = 11, not 12: the terminal 500 arm carries a COMPUTED code and is excluded by the literal class, exactly as the incumbents' shorthand read-only arm is."
  - "The roster lives in wizardErrors.ts (161-10's precedent), NOT at any consumer — three components POST to the route."
  - "⚠️ The roster's 'a client can render it' half is NOT enforced: measured at HEAD, none of the three consumers reads the route's code field. Recorded as named debt at the roster rather than claimed."
  - "verify-strategy's email arm KEEPS KEY_INVALID_FORMAT — a present value whose shape is wrong IS a format failure."
  - "verify-strategy's key order was deliberately NOT reordered: no law watches it, no consumer reads its codes, and T-161-27 requires the public diff to stay minimal. Recorded as an open finding."
  - "DERIVED_FLOOR resized 29 -> 36 by the docblock's own ~60%-of-total rule (new measured total 60), with all five collapse cases re-worked."
metrics:
  duration: ~1h20m
  completed: 2026-08-24
actuals:
  tokens: 47000
  tasks: 3
  commits: 3
---

# Phase 161 Plan 09: WIZERR-08 — the KEY_INVALID_FORMAT split lands on the last two routes Summary

Nine rejection arms across an authenticated and an anonymous route now answer codes true of
their own facts; the authenticated route was made VISIBLE to the repo's coverage predicate for
the first time (its whole population derived to zero) and gained the 4th `ROUTES` row over that
now-real population.

**Commits**

| Task | Commit | What |
|---|---|---|
| 1 | `6f59a661` | validate-and-encrypt: 4 arms re-coded + all 11 arms reordered `code:`-first + comment rewrite + tests |
| 2 | `d7bffe93` | verify-strategy: 5 arms re-coded, sentences pinned, F3 ordering + enumeration pins, latent-hazard comment |
| 3 | `cc2c579a` | `KNOWN_VALIDATE_AND_ENCRYPT_CODES` + the 4th ROUTES row + non-empty assertion + `rosterFloor` + floor resize |

---

## ⛔ THE PLAN'S TASK 3 PREMISE WAS STALE — measured, not assumed

The plan told me to measure `expectedSites` rather than copy it. I did, and what I found was not
a different number: **the derived population for `keys/validate-and-encrypt` was ZERO.**

**How I measured it.** I wrote a throwaway harness (`src/lib/zz-measure.tmp.test.ts`, deleted
before any commit and never staged) that re-implements the law's own three functions verbatim —
`emitterRe`, `deriveEmittedCodes`, `deriveRejectionSites` — and imports the REAL
`stripCommentsPreserveLines` from `src/lib/source-scan`, so the numbers it prints are the numbers
the law would derive. Output at HEAD, before any edit:

```
===== src/app/api/keys/validate-and-encrypt/route.ts
  400-only      : []
  [45]dd        : []
  rejection sites: 12 coded: 0
  statuses      : ["400-","400-","400-","400-","409-","503-","400-","503-","500-","503-","504-","500-"]
```

All twelve rejection arms were written `{ error, code }`. The predicate requires `code:` FIRST.
So **no coverage law in this repo has ever watched this route**, and a 4th ROUTES row added over
that population would have been precisely the failure the third row's own docblock records:
*"an assertion over an empty population — green forever, measuring nothing, and
indistinguishable from a route with no defects."* The plan's own must-have forbids it in as many
words.

**The remedy, and its precedent.** 153.1-05 hit this exact state on `finalize-wizard`
("fourteen arms were written `{ error, code }` … 153.1-05 reordered the fourteen") and the law's
failure message prescribes it: *"⛔ the remedy is to fix the emitter, never to relax the
predicate."* So Task 1 reordered **all eleven literal-coded arms** to `code:`-first, not just the
four the plan scoped. A partial reorder would have produced a count literal encoding "the arms
someone happened to touch", which states no property — and would have left `STALE_CLIENT`, the
named regrowth vector, invisible.

This is deviation #1 below. It is a key-order-only change: no sentence, status, header or
control-flow hunk on any of the seven arms outside the plan's four.

### The measured population after the reorder

```
  400-only      : ["KEY_VENUE_NOT_ENABLED","KEY_VENUE_NOT_ENABLED","KEY_MISSING_REQUIRED_FIELD",
                   "KEY_MISSING_REQUIRED_FIELD","KEY_NOT_READ_ONLY"]                          → 5
  [45]dd        : [… the five above, plus "STALE_CLIENT","SEAM_MISCONFIGURED",
                   "SEAM_MISCONFIGURED","UNKNOWN","CIRCUIT_OPEN","UPSTREAM_TIMEOUT"]          → 11
  rejection sites: 12 coded: 11
```

**`expectedSites = 11`, hand-typed from that run.** The twelfth site is the terminal 500 arm,
`{ code: seamCode ?? "UNKNOWN", error: … }` — a COMPUTED value with no string literal, excluded
by the `[A-Z][A-Z0-9_]*` literal class exactly as the incumbents' shorthand `{ code }` read-only
refusal is (the documented reason their count is 12 and not 13).

**`statusRe = "[45]\\d\\d"`, and this is forced rather than preferred.** The route answers its
coded arms at 400/409/500/503/504. A `"400"` row would see 5 of 11 and, decisively, would **not**
see `STALE_CLIENT` — a 409, and the single code whose unregistered shipping the plan names as
the regrowth vector this row closes. A row blind to the code that motivated it is decoration.
(161-05's note that its 409-answering codes sit outside the `"400"` population is the same fact
from the other side.)

---

## Task 1 — the authenticated route

| Arm | Fact | Was | Now | Sentence |
|---|---|---|---|---|
| sfox server gate | supported venue, not switched on | `KEY_INVALID_FORMAT` | `KEY_VENUE_NOT_ENABLED` | `sFOX integration is not yet available.` |
| mt5 server gate | supported venue, not switched on | `KEY_INVALID_FORMAT` | `KEY_VENUE_NOT_ENABLED` | `MT5 integration is not yet available.` |
| mt5 three-credential guard | a required slot arrived blank | `KEY_INVALID_FORMAT` | `KEY_MISSING_REQUIRED_FIELD` | `Missing required fields` |
| generic presence check | a required slot arrived blank | `KEY_INVALID_FORMAT` | `KEY_MISSING_REQUIRED_FIELD` | `Missing required fields` |

All four sentences byte-identical; all four still 400 with `NO_STORE_HEADERS`; asserted per arm
as hand-typed literals with `toBe` (never `toContain`, never an import).

**`KEY_INVALID_FORMAT` now has ZERO emitters on this route** — the correct end state, not an
omission: this route runs no format check of its own. The `api_secret.length < 8` ccxt guard that
makes that code's copy true lives on `create-with-key` and `composite/add-key`. Pinned by a
comment-stripped source scan with a **positive control ahead of the negative claim** (assert the
two new codes appear 2× each before asserting the old one appears zero times — a stripper that
blanked the file would otherwise satisfy the negative claim vacuously).

**The stale arm-group comment is rewritten.** It asserted all four "answer `KEY_INVALID_FORMAT`
(create-with-key's exact token for the same facts)". It now carries the fact→code mapping, why
`KEY_UNSUPPORTED_VENUE` is the wrong neighbour for a venue we do support, and why
`KEY_INVALID_FORMAT` has no emitter left.

**Pitfall 6 — the persist arm.** Confirmed at HEAD: all four re-coded sites are upstream of the
`body.persist !== true` discriminator (line ~118–165 vs ~210 pre-edit). Enforced two ways rather
than asserted: a **behavioural** case (a persist request still reaches the writer, still returns
`{api_key_id, valid, read_only}`, and `PERSIST_STATE.inserts.length === 1` — a 200 with no INSERT
would satisfy the shape assertion while proving the path was skipped), and a **source-order** case
pinning each of the four arms' index below the discriminator's, with a positive control that the
discriminator itself was found. The owed PROD smoke on `persist: true` stays attributable.

---

## Task 2 — the anonymous route

### The `VerificationForm` re-confirmation — MEASURED at HEAD, not inherited

The plan's F3 decision rests on it, so I re-verified it first-hand before touching the route.

`grep -n "\.code\|code\b" src/components/landing/VerificationForm.tsx` returns **exactly two
lines, both inside comments**:

- `:17` — `// EXCHANGE_DISPLAY map — no local label record — so a new code cannot render a`
- `:98` — a comment describing the seam envelope's shape `{ok:false, code, human_message, …}`

The live error path (`:96-110`) is:

```
throw new Error(
  safeHumanMessage(data.human_message) ??
    safeHumanMessage(data.error) ??
    "Verification failed",
);
```

**Confirmed: it never reads `data.code`.** So on this route the code channel is machine-only and
the SENTENCE is the sole public disclosure surface. Re-coding an arm cannot widen what an
anonymous caller learns; moving a sentence would. The F3 decision holds as written.

### The five arms

| Arm | Was | Now | Sentence (byte-identical) |
|---|---|---|---|
| unreadable body | `KEY_INVALID_FORMAT` | `KEY_MISSING_REQUIRED_FIELD` | `Invalid JSON body` |
| missing fields | `KEY_INVALID_FORMAT` | `KEY_MISSING_REQUIRED_FIELD` | `Missing required fields: email, exchange, api_key, api_secret` |
| malformed email | `KEY_INVALID_FORMAT` | **`KEY_INVALID_FORMAT` (RETAINED)** | `Invalid email address` |
| venue outside the offer | `KEY_INVALID_FORMAT` | `KEY_UNSUPPORTED_VENUE` | ``Unsupported exchange. Supported: ${UI_EXCHANGE_CODES.join(", ")}`` |
| sfox server gate | `KEY_INVALID_FORMAT` | `KEY_VENUE_NOT_ENABLED` | `sFOX integration is not yet available.` |

Each of the five is quoted once, above, and each is **byte-identical** to the pre-161-09 source.
The four non-sfox arms are asserted with `toBe` against hand-typed literals; the sfox arm has its
own case because reaching its half-state needs a two-module re-mock. A positive control asserts
`ARMS.length === 4` and that every hand-typed sentence is `> 10` non-blank characters — because
`"anything".includes("")` is `true` and a blanked expectation would otherwise pass everywhere.

**The email arm's retention is recorded at the arm.** None of the four split codes is true of "a
present value is malformed": not missing, not a venue property, not a length cap. The "exactly ONE
emitter per route" rule in `KEY_INVALID_FORMAT`'s union comment is scoped to the two WIZARD
connect routes and their ccxt `api_secret.length < 8` check; `verify-strategy` is a different
route with different facts. Forcing a false code here to satisfy a rule written about other
routes would be this phase's own defect wearing a compliance badge.

### The two disclosure pins

**Ordering.** `UI_EXCHANGE_CODES` gate must run FIRST, so the venue-disabled arm is reachable only
when the venue IS in the offered set. Pinned by a case that drives sfox with the offer at its real
value and the server flag off — the exact configuration in which a reversed ordering leaks — and
asserts `KEY_UNSUPPORTED_VENUE` with the enumerated sentence, plus `not.toContain("not yet
available")`.

**Enumeration.** The disclosed list is asserted `toBe` the `UI_EXCHANGE_CODES`-derived string, and
every venue in `SUPPORTED_EXCHANGES` that is NOT offered is asserted absent from it. **The
expectation is DERIVED, never hand-listed** — a hand-typed venue list in a test is itself a stale
disclosure claim the day the offer changes. Non-vacuity guarded both ways: `UI_EXCHANGE_CODES.length
> 1`, `SUPPORTED_EXCHANGES.length >= UI_EXCHANGE_CODES.length`, and `notOffered.length > 0` with a
message telling a future reader what to do if the two sets ever coincide.

### The latent hazard, written into the route

At the venue-disabled arm: `KEY_VENUE_NOT_ENABLED`'s copy reads *"This exchange is not open on
Quantalyze yet."* Nothing renders it today (no anon consumer reads codes). The day any anonymous
surface starts translating this route's codes into `WIZARD_ERROR_COPY`, that sentence **would**
leak a coming-soon signal about an unlaunched venue, and **F3 must be re-decided at that moment**
— not assumed settled because the line already existed. The suite's docblock states plainly that
nothing detects this; it is recorded, not covered.

---

## Task 3 — the roster and the 4th row

### Roster location, and what it does and does not prove

`KNOWN_VALIDATE_AND_ENCRYPT_CODES` lives in **`src/lib/wizardErrors.ts`**, beside 161-10's
`DASHBOARD_DIALOG_ROUTE_CODES`. Three components POST to this route (`ApiKeyManager`,
`StrategyForm`, `AllocatorExchangeManager` — measured by grep over `src/`), so a roster inside any
one of them would be a fourth hand-typed registry the other two silently disagree with. Six
members: `KEY_MISSING_REQUIRED_FIELD`, `KEY_VENUE_NOT_ENABLED`, `KEY_NOT_READ_ONLY`,
`STALE_CLIENT`, `SEAM_MISCONFIGURED`, `UNKNOWN`. `CIRCUIT_OPEN` and `UPSTREAM_TIMEOUT` are
deliberately absent — wire codes the alias table translates, neither a `WizardErrorCode`, and
adding either to a `ReadonlySet<WizardErrorCode>` would not compile.

**⚠️ THE PLAN'S OPEN-QUESTION-1 PREMISE ONLY HALF HOLDS, and I am not going to pretend otherwise.**
The decision block says a roster is required so *"the law's 'a client can render it' half is
enforced rather than dropped"*. **Measured at HEAD: none of the three consumers reads this route's
`code` field at all.** All three read `err.error` — the prose sentence:

- `ApiKeyManager.tsx:245` — `throw new Error(err.error || "Key validation failed")`
- `StrategyForm.tsx:150` — same shape
- `AllocatorExchangeManager.tsx:583` — `setFormError(result.error ?? "Validation failed")`

So there is no runtime reader to bind the roster to. What the row genuinely enforces is (1) every
emitted code is a `WizardErrorCode` or is alias-translated into one, so `WIZARD_ERROR_COPY` has a
real entry and the first consumer to read the channel gets copy rather than the UNKNOWN card;
(2) every roster member has that copy; (3) the emitter count cannot drift silently — which is how
`STALE_CLIENT` shipped here in Phase 160 with nothing watching it. What it does **not** enforce is
that anything renders it today. That gap is written into the roster's docblock as **named debt**
(wiring the three consumers onto the code channel, the way 161-10 wired the three dashboard
dialogs), with an explicit instruction to read "rostered" as "typed and has copy", never as "the
user will see it". Flagged for phase review below.

**A second honesty finding, measured.** I probed whether `SEAM_MISCONFIGURED`'s roster row is
load-bearing: removed it, re-ran the law → **49 passed, still green**. The alias table maps it to
itself and the law consults the alias before the roster, so that row is redundant for the coverage
half. It is kept (a vocabulary with an alias-covered hole is a worse artefact to inherit than a
complete one) and the docblock forbids reading its presence as evidence of a check.

### Which population this row owns

161-10 asked that a new law say which population it owns. **This is not a new law** — it is a 4th
row in the existing `wizardErrors.invariant.test.ts`, whose population is per-route by
construction (`ROUTES[i].route` is one file path, and the roster assertion is explicitly per-route,
never merged). It adds `src/app/api/keys/validate-and-encrypt/route.ts` and nothing else. It does
not overlap `dialog-envelope.invariant.test.ts`, whose population is `.tsx` files that call
`buildEnvelope` and mount `<Modal`; a route handler is neither.

### Two supporting changes, both stated as such

**`rosterFloor` made per-route** (`DEFAULT_ROSTER_FLOOR = 10`; the three incumbents' guard is
byte-identical). Six is simply how many codes this route emits, not a roster that parsed short. The
guard's own docblock states its job — *"catch a roster that parsed as `[]` or nearly so … not to
re-pin each roster's size, which is a fact about the roster rather than about the scanner"* — so
the new row takes `4` (~60% of 6, the ratio `DERIVED_FLOOR` uses), which still catches `[]`, 1 and
2. The alternatives (lower 10 for everyone, or drop the assertion) both weaken three routes to
admit a fourth.

**`DERIVED_FLOOR` 29 → 36**, by the resize rule the docblock itself established for 14 → 29: a
floor sized against an old total gets carried by routes it was not raised to cover. New measured
total 60 (12 + 12 + 32 + 11); ~60% is 36. All five collapse cases are re-worked at 60 in the
docblock, including the new one worth naming — all eleven arms of the new route go blind together
the moment someone reorders them back, and the floor **cannot** see that; the hand-typed 11 is the
only thing that reds.

**The three incumbent `expectedSites` literals have no hunk.** `git diff -U0` on the law shows
exactly one `expectedSites` addition (`+ expectedSites: 11,`) and no `-` line.

---

## Observed RED — five neuter cycles, each restored byte-identical

House three-part shape: neuter → observed message → restored (checksum verified).

**Neuter A — restore the old code on ONE arm of four** (Task 1). `KEY_VENUE_NOT_ENABLED` →
`KEY_INVALID_FORMAT` on the **mt5** venue arm only, working-tree only.

```
FAIL … [161-09 / WIZERR-08] … > mt5 is a venue we support that is not switched on here → its own code, with the sentence, status and no-store header byte-identical
AssertionError: expected 'KEY_INVALID_FORMAT' to be 'KEY_VENUE_NOT_ENABLED' // Object.is equality
FAIL … > KEY_INVALID_FORMAT has NO emitter left on this route — the split is complete, not partial
AssertionError: the comment-stripper blanked real code — every negative claim below is vacuous: expected 1 to be 2
FAIL … > PITFALL 6: all four re-coded arms sit UPSTREAM of the persist discriminator, in source order
AssertionError: arm not found in source: code: "KEY_VENUE_NOT_ENABLED", error: "MT5 integration is not yet available.": expected -1 to be greater than 0
      Tests  3 failed | 88 passed (91)
```

**The asymmetry is the evidence**, and it is what the plan asked for: the sfox arm and both
missing-field arms stayed GREEN. The cases are per-arm, not aggregate.
Restored: `shasum` matched `9acaaf76ddf1971e5fbae5532ba0528dd4aea2e2`; 91 passed.

**Neuter B — reverse the F3 gate ordering** (Task 2). Venue-disabled gate moved ABOVE the
offered-set gate, working-tree only.

```
FAIL … > F3 ORDERING: a venue OUTSIDE the offered set is refused by the offered-set gate, never by the venue-disabled gate
AssertionError: expected 'KEY_VENUE_NOT_ENABLED' to be 'KEY_UNSUPPORTED_VENUE' // Object.is equality
FAIL … (H-0335) > rejects sfox / sFOX / SFOX cleanly and never discloses sfox in the error enum (F3)   [×3]
AssertionError: expected 'sFOX integration is not yet available.' to contain 'Unsupported exchange'
      Tests  4 failed | 38 passed (42)
```

Note the incumbent F3 trio reddens too — the new pin and the 122-era pin agree about the same
property from different directions.
Restored: `shasum` matched `2d4d69113d3a1e4f4537cc8b9f64405ecd2491c6`; 42 passed.

**Neuter C — drop one code from the new roster** (Task 3, mandatory (a)). `STALE_CLIENT` removed
from `KNOWN_VALIDATE_AND_ENCRYPT_CODES`.

```
FAIL … > keys/validate-and-encrypt: every emitted code is admitted by THAT ROUTE's roster, or by the alias table
AssertionError: keys/validate-and-encrypt emits codes that KNOWN_VALIDATE_AND_ENCRYPT_CODES does not
admit and that SEAM_CODE_TO_WIZARD_CODE does not translate. … expected [ 'STALE_CLIENT' ] to deeply equal []
      Tests  1 failed | 48 passed (49)
```

Restored: `shasum` matched `dd16c4cb801b733c653facf09d041638c2c7f65b`.

**Neuter D — decrement the hand-typed `expectedSites`** (Task 3, mandatory (b)). 11 → 10.

```
FAIL … > keys/validate-and-encrypt: the site count is THIS ROUTE's hand-typed literal — not its own length
AssertionError: keys/validate-and-encrypt has 11 rejection-emitting sites under the predicate in this
file's header; 10 were measured … expected 11 to be 10 // Object.is equality
      Tests  1 failed | 48 passed (49)
```

Restored: `shasum` matched `0b0f93a97e92ec0ea3d26472f7cca4e3e2816ee8`.

**Neuter E — the REAL pre-161-09 route source** (Task 3, extra: the new NON-EMPTY assertion is a
new guard, so project rule #1 requires it be shown able to fail). `git show 6f59a661^:…route.ts`
written into the working tree — i.e. the genuine `{ error, code }` state the route was in.

```
FAIL … > keys/validate-and-encrypt: the derived population is NON-EMPTY — no row watches nothing
AssertionError: keys/validate-and-encrypt derived ZERO rejection-emitting sites, so every assertion
about this route below passes VACUOUSLY. … expected 0 to be greater than 0
FAIL … > keys/validate-and-encrypt: the site count is THIS ROUTE's hand-typed literal …
AssertionError: … has 0 rejection-emitting sites … expected +0 to be 11
      Tests  2 failed | 47 passed (49)
```

This is the strongest of the five: the neuter is not a synthetic mutation, it is the state the
codebase was actually in one commit earlier.
Restored: `shasum` matched pre-neuter; 49 passed.

---

## Verification

All prose uses "would have caught" — branch protection is off until there are paying clients, so
every CI gate is **advisory at merge** (ledger rule).

| Gate | Result |
|---|---|
| `npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts` | 91 passed |
| `npx vitest run src/app/api/verify-strategy/route.test.ts` | 42 passed |
| `npx vitest run src/lib/wizardErrors.invariant.test.ts` | 49 passed |
| `npx tsc --noEmit` | clean |
| `npx eslint` on all six touched files | clean |
| **`npm run test` (full)** | **791 files passed, 19 skipped; 12336 tests passed, 281 skipped; 264.34 s** |

The full-suite run is what clears `src/__tests__/contracts/`, which scan all of `src/`; a
file-scoped green cannot. The 281 skips are pre-existing — this plan skipped nothing.

**Tooling hazards honoured.** `src/lib/wizardErrors.test.ts` was never touched; its deliberate NUL
was counted after every write to `src/lib/` and is still exactly **1** (measured with Python, not
`grep`). vitest was run from the repo root, never wrapped in `gstack-evidence`. Work was done in
the MAIN tree on `feat/v1.20-phase-161-wizerr`; no worktree was created and no branch was created,
switched or renamed. `.planning/config.json` was left modified and unstaged, as instructed. The
throwaway measurement harness (`src/lib/zz-measure.tmp.test.ts`) was deleted before the full-suite
run and never staged — `git status` after Task 3 shows no stray file.

**Diff discipline.** `git diff` on `keys/validate-and-encrypt/route.ts` shows `code`-value changes
on four arms, key-order swaps on eleven, and comment hunks. No sentence, status, header or
control-flow hunk. On `verify-strategy/route.ts`: `code`-value changes on four arms (the fifth
retained) and comment hunks only — no sentence hunk, which is the disclosure boundary itself.

---

## Deviations from Plan

**1. [Rule 3 — blocking] All eleven literal-coded arms reordered to `code:`-first, not just the plan's four**
- **Found during:** Task 3's measurement, performed before Task 1's edits.
- **Issue:** the derived population for `keys/validate-and-encrypt` was **zero** — every arm was
  `{ error, code }`. Task 3's stated behavior ("the derived population for the new row is
  NON-EMPTY") and its must-have ("A 4th ROUTES row MUST NOT be added over an empty or unmeasured
  population") were both unreachable without the reorder.
- **Fix:** reordered all eleven, in Task 1's commit (same file). Precedent: 153.1-05 did exactly
  this on `finalize-wizard`; the law's own failure message prescribes it.
- **Files:** `src/app/api/keys/validate-and-encrypt/route.ts`. **Commit:** `6f59a661`.

**2. [Scope — measured] The plan's Open Question 1 premise ("the roster enforces 'a client can render it'") only half holds**
- **Found during:** Task 3, checking what the roster would bind to.
- **Issue:** none of the route's three consumers reads its `code` field; all three render prose.
  There is no runtime reader for the roster to be a contract with.
- **Resolution:** the roster still lands (it enforces union membership + copy + count stability,
  which IS the `STALE_CLIENT` vector in its typed/renderable dimension), and the gap is written
  into its docblock as named debt with an explicit "do not read this as 'the user will see it'".
  I did **not** rewrite the three consumers — that is WIZERR-07-shaped work outside this plan's
  file scope, and inventing it here would have been a much larger unreviewed change.
- **Files:** `src/lib/wizardErrors.ts`. **Commit:** `cc2c579a`.

**3. [Supporting change] `rosterFloor` per-route and `DERIVED_FLOOR` 29 → 36**
- Both are consequences of a fourth row existing. Neither touches an incumbent's guard: the three
  incumbents keep the literal `10` via `DEFAULT_ROSTER_FLOOR`, and the floor resize follows the
  rule the docblock itself wrote for the previous resize, with all five collapse cases re-worked.
- **Commit:** `cc2c579a`.

**4. [Deliberate non-change] `verify-strategy`'s key order left as `{ error, code }`**
- Measured: its nine rejection sites derive to **zero** under the same predicate, so no coverage
  law watches it either. Left alone because (a) no law row is planned for it and its only consumer
  reads no codes, so a reorder buys nothing today, and (b) threat `T-161-27` requires the public
  route's diff to stay minimal and auditable — "codes only on the public route". Recorded at the
  route in a comment and flagged below rather than silently omitted.

**5. [Executor error, self-reported] I ran `git checkout -- src/app/api/verify-strategy/route.ts` mid-Task-2 and destroyed my own uncommitted route edits.**
- The gsd-executor's destructive-git prohibition names blanket working-tree restores exactly for
  this. I noticed immediately (`grep -c "161-09"` returned 0), re-applied the edits, and re-ran the
  full Task 2 neuter cycle against the FINAL source using a scratchpad `cp` restore rather than
  git. No committed work was affected and no other file was touched. Recorded because "completed"
  is wrong if anything was skipped or lost silently.

---

## For the phase code review and verification (this is the phase's last plan)

1. **⚠️ The one thing this plan could not close: `keys/validate-and-encrypt` emits eight distinct
   codes and NO consumer reads any of them.** Three components POST to it and all three render
   `err.error` prose. The 4th ROUTES row makes the vocabulary typed, copied and count-stable; it
   cannot make it *rendered*. This is the same shape 161-10 fixed for the three dashboard dialogs,
   one route further out, and it is the natural WIZERR follow-on. It is named debt in
   `KNOWN_VALIDATE_AND_ENCRYPT_CODES`'s docblock.
2. **⚠️ `verify-strategy`'s nine rejection arms are invisible to every coverage law** (`{ error,
   code }` order, derived population zero, no ROUTES row). Deliberate — see deviation 4 — but a
   reviewer should see the number rather than discover it.
3. **The `code:`-first hazard is now a THIRD confirmed instance** (finalize-wizard 2026, this route
   2026-08-24, and verify-strategy still open). It is worth asking whether a repo-wide scan for
   `NextResponse.json({ error:` belongs in the contract tests, so the next route cannot ship
   invisible. That would be a phase of its own; flagging, not doing.
4. **`SEAM_MISCONFIGURED`'s roster row is measured non-load-bearing** (alias-to-self is consulted
   first). Applies to every roster in the repo, not just this one — a reviewer auditing roster
   coverage should not assume a listed alias-translated code is being checked.
5. **`EXPECTED_TABLE_SIZE` was NOT moved.** This plan minted no new members; the union is 88, as
   161-10 left it, verified by running the law's own `deriveUnionMembers` over the comment-stripped
   source.
6. **Full-suite duration is trending up:** 163 s (161-07) → 262 s (161-08) → 280 s (161-10) →
   264 s here.

---

## Known Stubs

None. No hardcoded empty value, placeholder string, TODO or FIXME was introduced. The retained
`UNKNOWN` code on the persist-INSERT arm is not a stub — it is the honest terminal for a failure
where the key WAS verified and the row was not written, it has real copy, and it is an explicit
roster member with its reasoning recorded.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change. The register's
five rows are mitigated as written: **T-161-27** (codes only on the public route; five sentences
pinned byte-identical with `toBe`; the enumeration assertion derives from `UI_EXCHANGE_CODES` with
a non-vacuity guard; the ordering pin proven falsifiable by Neuter B), **T-161-28** (accepted, with
the hazard written into the route and into this summary), **T-161-29** (only `code` values and key
order moved; status, headers and sentences pinned per arm — every gate that refused before still
refuses), **T-161-30** (all four edited sites confirmed upstream of the persist discriminator by a
source-order pin *and* a behavioural no-change case; secret scrubbing untouched), **T-161-31** (an
explicit per-route non-empty assertion plus a hand-typed measured count, both proven falsifiable
by Neuters E and D).

## Self-Check: PASSED

- All six modified key files FOUND on disk.
- Commits `6f59a661`, `d7bffe93`, `cc2c579a` — all FOUND in `git log --oneline --all`.
- `src/lib/zz-measure.tmp.test.ts` (the throwaway harness) confirmed ABSENT; `git status` clean of
  stray files.
- `src/lib/wizardErrors.test.ts` NUL count = **1**, unchanged.
- The three incumbent `expectedSites` literals (12 / 12 / 32) confirmed to have no diff hunk.
- Full `npm run test` green after the last commit's content was in place.
