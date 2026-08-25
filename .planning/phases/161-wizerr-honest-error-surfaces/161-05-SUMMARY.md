---
phase: 161-wizerr-honest-error-surfaces
plan: 05
subsystem: wizard-key-lane-copy
status: complete
tags: [wizerr, wizard, key-orphaned, venue-conditional-copy, d-17, anti-vacuity, negative-control, measured-deviation]
requires:
  - "161-04's non-destructive `onTryAnotherKey` — KEY_ORPHANED's only remedy action is `try_another_key`, and it would have been self-defeating to mint an honest refusal whose sole remedy deleted the user's draft"
  - "src/app/api/strategies/create-with-key/route.ts resolveByVenueIdentity — the two-read discrimination 154.1 built, which this plan extends with a third answer"
  - "the FixRequirement / applyFixRequirements machinery (153.1-03) — the sanctioned extension point for a conditional fix bullet"
provides:
  - "`KEY_ORPHANED` — WizardErrorCode member + copy entry (EXPECTED_TABLE_SIZE 81 → 82 at both pins)"
  - "a third resolver answer, `orphaned`, discriminated BEFORE the byte-pinned fence 409"
  - "a new FixRequirement kind `venueIs` — exact closed-set comparison, strict on absence"
  - "a 409-scoped coverage law over create-with-key, closing the blind spot the 400-only ROUTES predicate leaves"
affects:
  - "E3 (the orphaned-key refusal surface) and E2 (the wizard key-connect envelope)"
  - "every venue's KEY_AUTH_FAILED card — five of six stop reading a Deribit sentence"
  - "any later plan adding a 409 to create-with-key: the new law now demands the roster row"
tech-stack:
  added: []
  patterns:
    - "a plan's copy contract is a claim about the codebase; verify the remedy is REACHABLE before shipping the sentence"
    - "an absence of a measurement is not a measurement — read faults stay `unresolved`, never `orphaned`"
    - "a fixture named for an arm it does not exercise is a vacuity mechanism; seed the shape that actually reaches the branch"
    - "when a law is structurally blind to a status, add a NEW population rather than widening the incumbent's"
key-files:
  created: []
  modified:
    - "src/lib/wizardErrors.ts"
    - "src/lib/wizardErrors.test.ts"
    - "src/lib/wizardErrors.invariant.test.ts"
    - "src/app/api/strategies/create-with-key/route.ts"
    - "src/app/api/strategies/create-with-key/route.test.ts"
    - "src/app/api/strategies/composite/add-key/route.ts"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx"
    - ".planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md"
decisions:
  - "A2 RE-MEASURED and CONFIRMED: cleanup_abandoned_wizard_drafts() builds v_candidate_keys from the drafts THAT RUN deletes, so an already-orphaned key is never a candidate again. The orphan is PERMANENT, so the copy gained 'and it does not clear on its own' rather than a time-bound."
  - "161-UI-SPEC's first WIZERR-03 fix bullet ('Disconnect the unused key under Manage keys') was REPLACED, not reworded: measured at HEAD, no surface reachable by a manager holding an orphaned key can release it. Shipping it verbatim would have breached the requirement's own remedy-can-succeed property."
  - "composite/add-key does NOT mirror the orphan discrimination and its roster does NOT gain KEY_ORPHANED. The venue-identity constraint is structurally unreachable there and is deliberately routed to a premise-changed alarm; mirroring would have deleted that alarm for a code the route cannot emit."
  - "The pre-RPC fence deliberately does NOT short-circuit the orphan. The credentials are unauthenticated at that point, so validateKey speaks first; the latency cost (MT5, 120s) is recorded as D-161-05-B."
  - "expectedSites is UNCHANGED at 12 for both split routes — measured, not assumed: ROUTES scans them with statusRe '400' and KEY_ORPHANED answers 409. The resulting blindness was closed with a NEW 409-scoped population instead of widening the incumbents."
  - "WIZERR-11 uses a new FixRequirement kind (`venueIs`) rather than a VENUE_CAPABILITY_PREDICATES entry: 'the key is the ClientId' is a fact about Deribit's own naming, and a capability with exactly one possible member forever would be a general name that lies about what it measures."
metrics:
  duration: "~75 min"
  completed: 2026-08-24
actuals:
  tokens: 21400
  tasks: 3
  commits: 4
---

# Phase 161 Plan 05: the key lane stops asserting things that are false — Summary

An orphaned live key now gets `KEY_ORPHANED` — a refusal that names the state the server
actually measured and offers a remedy the user can actually perform — instead of a
`DRAFT_ALREADY_EXISTS` 409 whose every clause the resolver had already disproved; and
`KEY_AUTH_FAILED` stops telling Binance, OKX, Bybit, sFOX and MT5 users about Deribit's
ClientId.

## The A2 re-measurement (the plan's one named unknown)

**Read at HEAD:** `supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql`, replayed
from `supabase/migrations/20260713120000_cleanup_abandoned_wizard_drafts.sql`.

**Finding — A2 is CONFIRMED. The sweep never collects an already-orphaned key.** Its
`api_keys` DELETE is scoped to `k.id = ANY(v_candidate_keys)`, and `v_candidate_keys` is built
in the same transaction from exactly two sources:

1. `strategy_keys` members of drafts `WHERE s.source='wizard' AND s.status='draft' AND
   s.review_note IS NULL AND s.created_at < now() - interval '7 days'` — captured *before* the
   CASCADE;
2. the `api_key_id`s **returned by that same DELETE**.

Both are keys belonging to drafts *this run is deleting*. A key that was already orphaned before
the run has no draft to be captured from, so it is never a candidate on any subsequent run.

**Consequence for the copy, which is why the plan made this a gate:** the orphan does **not**
age out, so the "leftover key" framing needs no time-bound. The copy gained the opposite —
`"...and it does not clear on its own."` — a claim that is now MEASURED rather than assumed.

**A second measurement the copy rests on** (not asked for by the plan, but the cause sentence
asserts it): `api_keys.venue_account_id` — the column whose partial UNIQUE produces this
refusal — is written by exactly ONE writer. Only three migrations mention the column
(`20260812083206`, `20260813150106`, `20260814120000`), and within them only
`create_wizard_strategy` stamps it, in the same INSERT that mints the draft strategy
(`add_wizard_composite_key` does not; every other writer's value is removed by the
`api_keys_scrub_venue_account_id` trigger). So *"saved in an earlier session whose draft was
deleted"* is the **only** way to reach this state — not the likeliest guess at it.

## How `EXPECTED_TABLE_SIZE` was counted without a blind grep

The plan's measured hazard is real and was re-confirmed live: `src/lib/wizardErrors.test.ts`
carries one NUL byte (`b.filter(x => x === 0).length === 1`, at the `.join(" \0 ")` phrase
delimiter), the project's `grep` wraps ugrep, classifies the file as binary and skips it
silently.

| Method | Result |
|---|---|
| `grep -an "EXPECTED_TABLE_SIZE"` | **10 lines**, matching the plan's measured figure — pins at `:1888` and `:2275`, guard at `:3535`, regex at `:3544` |
| Node `readFileSync` (all edits) | every write to this file went through `Buffer`/`latin1` round-trip, and the NUL count was re-asserted as **1** after each |

**Every edit to that file was made with Node, never with `sed`/`Edit`,** precisely so the NUL
could not be dropped. `git diff` after the pin move showed `1 insertion / 1 deletion` and the
NUL count held at 1 — checked again after each of the two test-block appends.

## What changed, per task

### Task 1 — `KEY_ORPHANED` minted (`89c7af90`)

`src/lib/wizardErrors.ts`, `src/lib/wizardErrors.test.ts`.

Union member authored on the `STALE_CLIENT` model: what rendered before, why it is **not** an
alias in `SEAM_CODE_TO_WIZARD_CODE` (our own route mints it), why both nearest incumbents were
rejected **read at the emitter** — `DRAFT_ALREADY_EXISTS` because the draft read came back
empty two lines earlier, `VENUE_ALREADY_CONNECTED` because the owner read came back empty and
its first remedy ("open the strategy that already uses this account") is unwinnable by
construction — and the recoverability derivation.

The member comment records, as the plan required, that create-with-key's own 154.1 rationale
(*"a state the user cannot act on differently anyway"*) is now **false**, and that its falseness
is the reason the code mints.

`EXPECTED_TABLE_SIZE` 81 → 82 at both pins, in this commit.

### Task 2 — the orphan discriminated at the emitter (`d06b818a`)

`create-with-key/route.ts`, its test, `composite/add-key/route.ts`, `ConnectKeyStep.tsx`,
`wizardErrors.invariant.test.ts`.

- `VenueIdentityResolution` gains `{ kind: "orphaned" }`; `resolveByVenueIdentity` returns it at
  the `!ownerRow?.id` line (`:306` at HEAD). **The read-fault returns stay `unresolved`** — a
  failed read has observed nothing, and answering `orphaned` from one would be 154.1's unearned
  claim in the opposite direction. Both fault directions are pinned as negative controls.
- The 23505 race arm answers it 409 `{ code: "KEY_ORPHANED", error: "This key is already
  stored, but nothing uses it." }` + `NO_STORE_HEADERS`, `code`-first-literal, in a **new branch
  above** the fence (Pitfall 5). The fence emitter region has **zero diff**.
- `KNOWN_CREATE_WITH_KEY_CODES` gains the member.

### Task 3 — WIZERR-11 (`b909a9b9`)

`src/lib/wizardErrors.ts`, `src/lib/wizardErrors.test.ts`.

The two sentences failed differently and got different fixes:

- the `cause`'s `(e.g. Deribit returns invalid_credentials)` was an **illustration** of a general
  fact — deleted outright, because the sentence is complete and true without it on every venue
  including Deribit. Gating it would have been the wrong tool;
- the bullet carries real information for Deribit users — **split**. Generic re-copy stays
  unconditional (every venue keeps a complete remedy); the naming becomes its own bullet gated
  on `REQUIRES_DERIBIT`.

New `FixRequirement` kind `venueIs`, `venue: SupportedExchange` (a typo is a compile error, not
a bullet nobody sees), compared for exact equality — no `.toLowerCase()` on caller input, never
interpolated. **Absent ⇒ suppressed**, the documented divergence from the default-permissive
`venueCapability` convention, argued at the union member and pinned by its own case.

**No per-code equality arm was added to the formatter:** `grep -c 'code === "'` on
`wizardErrors.ts` is **11 at HEAD and 11 now**, and `git diff` adds zero such lines.

**A4 CONFIRMED by measurement, no threading needed.** `ConnectKeyStep.tsx:1089` passes
`venue: attemptExchange ?? exchange` and `MultiKeyConnectStep.tsx:1854` passes
`venue: attemptVenue`; both are typed `SupportedExchange` (`ExchangeId = SupportedExchange` at
`:43` / `:88`), so the value is lowercase by construction. The `buildEnvelope` call is
**code-agnostic** — it is built once for whatever `errorCode` is set — so the `KEY_AUTH_FAILED`
render path already receives the frozen attempt venue.

## Observed REDs (every one seen first-hand, every restore verified)

**RED 1 — the divergence guard, at the half-moved state** (Task 1, the plan's own instruction):

```
AssertionError: The two EXPECTED_TABLE_SIZE pins disagree: 82 vs 81. Moving one and not the
other is a silent half-fix ...: expected 2 to be 1
 ❯ src/lib/wizardErrors.test.ts:3571:7
```
plus the size guard itself: `expected 82 to be 81` at `:2281`. Both green after the twin moved.

**RED 2 — the new KEY_ORPHANED copy pins, neutered together** (Task 1). Copy set to the
UI-SPEC bullet + `actions: ["try_another_key","clear_and_retry","resume_draft","start_fresh","expand_log"]`:

```
× derives recoverable — and derives it from try_another_key, not clear_and_retry
    expected [ 'try_another_key', …(4) ] to not include 'clear_and_retry'
× offers neither to resume a draft nor to delete one — there is no draft
    expected [ 'try_another_key', …(4) ] to not include 'resume_draft'
× names no key-management surface this arm cannot reach (the measured 161-05 divergence)
    expected [ 'manage keys' ] to deeply equal []
```

⭐ **And a fourth, unplanned:** the pre-existing `[140.3-10 / TRAP-4]` destructive-class scan
also went red (`the destructive class really is FOUR entries` — five received), independently
confirming that the `start_fresh` exclusion is enforced by a guard this plan did not write.

**RED 3 — the orphan discrimination neutered** (Task 2, `return ORPHANED` → `return
UNRESOLVED`). **Exactly one test failed, and it received the exact sentence the requirement
exists to remove:**

```
FAIL … [161-05 / WIZERR-03] the orphan answers KEY_ORPHANED, and only the orphan does >
       a live key with no strategy behind it answers 409 KEY_ORPHANED — never the false fence sentence
Expected: "{"code":"KEY_ORPHANED","error":"This key is already stored, but nothing uses it."}"
Received: "{"code":"DRAFT_ALREADY_EXISTS","error":"A wizard session with this key is already in progress."}"
```

All **four** negative controls stayed GREEN under that neuter, which is the matched-pair
property: they assert behaviour the pre-change tree also had.

**RED 4 — the roster row removed** (Task 2, proving the new 409 law is not decorative):

```
FAIL … create-with-key's 409 refusals clear ConnectKeyStep's roster too >
       every 409 code is a union member AND admitted by ConnectKeyStep's roster
AssertionError: KNOWN_CREATE_WITH_KEY_CODES does not admit these 409 codes …
  expected [ 'KEY_ORPHANED' ] to deeply equal []
```

**RED 5 — the venue gate removed** (Task 3, `fixRequires: [null,null,null,null]`):

```
× a BINANCE user sees the token NOWHERE in the whole card — and still gets a complete remedy
× an ABSENT venue sees the token NOWHERE — the STRICT rule …
× SWEEP: no venue in the registry OTHER than deribit ever sees the token   (5 offenders)
× the venue is a LOOKUP/COMPARISON KEY ONLY — no caller string round-trips into the card (D-17)
```
The positive control and the cause-neutrality case stayed green, as they must — the cause is
venue-neutral regardless of the gate.

**RED 6 — the strict absence rule flipped to the capability convention** (Task 3,
`context?.venue === undefined || …`). **Exactly one** failure, isolating the divergence:

```
× an ABSENT venue sees the token NOWHERE — the STRICT rule, diverging from the capability default
AssertionError: With no venue in context the Deribit bullet still rendered. Absence is not
permission …
```

Vacuity traps checked explicitly:
- **`"anything".includes("")`** — every `includes`/phrase-class assertion is preceded by a
  non-blank guard: `surface.length > 80` (KEY_ORPHANED) and `> 120` (KEY_AUTH_FAILED), and the
  phrase lists are hand-typed non-empty literals with **live positive controls** (the
  unreachable-surface predicate is proved to match the exact UI-SPEC sentence; the Deribit token
  is proved present for a Deribit user).
- **Fixture-names-the-wrong-arm (the 161-03 lesson)** — the pre-existing
  `"venue-identity constraint + UNRESOLVABLE"` case leaves `venueKeyLookupMock` **empty**, so it
  returns at `!liveKeyId` and never reaches the orphan branch. A pin written on that fixture
  would have been green against both trees. My fixture seeds the key as FOUND with both strategy
  reads succeeding empty — the only shape that produces `kind:"orphaned"` — which RED 3 proves.
  That case's stale comment ("orphan / dark fence") was corrected in place.
- **Self-referential oracle** — `EXPECTED_409_CODES` and the count floors are hand-typed; the
  new law never compares a derivation against itself.

## The `expectedSites` measurement, and its method

**Method:** not `grep -c` (two of these names also appear in prose in that route, which is the
14-vs-12 lesson), and not `derived.length`. The number is decided by arithmetic on the
scanner's own predicate and then confirmed by the scanner executing:

`emitterRe(statusRe)` ends `…status:\s*(?:${statusRe})`, and both split routes carry
`statusRe: "400"`. `KEY_ORPHANED` answers **409**, so it cannot match — the same reason
`DRAFT_ALREADY_EXISTS` and `VENUE_ALREADY_CONNECTED` are already outside the population (the
`statusRe` docblock records that widening to `[45]\d\d` moves the count **12 → 16**, i.e. four
409/500 arms are excluded today).

**Result: `expectedSites` is UNCHANGED at 12 for BOTH routes, and no literal was edited.** The
per-route site-count assertion and the "structural mirrors" assertion both stayed green with my
new emitter in the tree — which is the scanner confirming the arithmetic on the real source.

**But that is a blind spot, not a clean bill of health,** and I did not leave it as prose. A new
population was added — `[161-05 / WIZERR-03] create-with-key's 409 refusals clear
ConnectKeyStep's roster too` — deriving `emitterRe("409")` over create-with-key only, with:

- a non-vacuity floor (`codes.length >= 3`);
- a hand-typed closed set `["DRAFT_ALREADY_EXISTS","KEY_ORPHANED","VENUE_ALREADY_CONNECTED"]`
  (predicted before running; the scanner confirmed exactly three);
- union + roster coverage, which RED 4 proves can fail.

`ROUTES` and `EXPECTED_SPLIT_CODES` are untouched — an **additional** population, the shape
153.1-06 used for finalize-wizard, not a widening of the incumbents' pinned counts.

## Deviations from Plan

### 1. [Rule 1 — the plan's copy would have shipped an unwinnable remedy] `fix` bullet replaced

**Found during:** Task 1, verifying the remedy-can-succeed property before writing the entry.

**Issue:** 161-UI-SPEC § WIZERR-03 (which the plan quotes) specifies
*"Disconnect the unused key under Manage keys, then connect it here again."* Measured at HEAD:
`"Manage keys"` occurs nowhere in `src`; `ApiKeyManager.tsx` is mounted only on the
**per-strategy** edit page (and no strategy holds this key); `AllocatorExchangeManager` (profile
→ Exchanges), the only other Disconnect control, is `allocatorOnly` and the wizard user is a
manager; `my-strategies` surfaces the orphan but its only control reopens this wizard.

**Fix:** the bullet was **replaced, not reworded** — "Connect this strategy with a different
account…" plus an honest escalation path. The divergence is argued at the copy entry, pinned by
a test with a live positive control, and the underlying product gap is filed as
**D-161-05-A**.

**Why this is not improvising against an approved contract** (the 161-03 discipline): the
UI-SPEC's own Copy Principle 2 and this plan's own must-have truth both require *"a remedy that
can succeed"*. Shipping the literal bullet would have satisfied the letter of one line while
breaching the principle the whole requirement exists to enforce — the D-17 class, minted by the
plan that was removing it.

### 2. [Plan vs codebase — declined, with the reason recorded in code] no `composite/add-key` mirror

**Found during:** Task 2.

**Issue:** the plan and the UI-SPEC both call for mirroring the orphan discrimination at
`composite/add-key:569` and adding the member to `KNOWN_ADD_KEY_CODES`. That route **cannot
reach the orphan state**: `KEY_ORPHANED` is only reachable from the venue-identity constraint,
`add_wizard_composite_key` does not write `venue_account_id` (TWIN-7 left it untouched
deliberately), MT5 cannot be a composite member, and the route's existing code routes that
constraint to a **loud UNKNOWN 500 + Sentry alarm** whose docblock states — as a decision, not a
gap — that it deliberately does not get create-with-key's resolver arm.

Mirroring would have meant building a resolver for a fence this route does not have, aiming it
at a constraint that cannot fire, and **converting a premise-changed alarm into a silent 409** —
deleting the one signal that would tell us the premise moved. `:569` is the wizard-session
fence, whose sentence is **true** for its own case.

**Fix:** declined. The decision is recorded at that alarm's own docblock with the condition that
would make the mirror owed. `KNOWN_ADD_KEY_CODES` deliberately does **not** gain the member: a
roster row for a code the route cannot emit is the same false claim in the client's vocabulary.
The existing test `"a venue-identity 23505 is an ALARM, not a 409"` (`route.test.ts:516-529`)
already pins this and stayed green.

### 3. [Plan-authorised judgement] the pre-RPC fence does not short-circuit the orphan

The plan specified the 23505 race arm and I implemented it there. The resolver now also answers
`orphaned` at the **pre-RPC** fence, where it falls through — argued at the fence: the
credentials are unauthenticated at that point, so `validateKey` speaks first and a wrong secret
is not buried under an orphan the user is then sent to chase. Pinned
(`the PRE-RPC fence lets the orphan through to validate`) so reversing it is deliberate. The
latency cost is **D-161-05-B**.

### 4. [Scope-expansion, argued] the 409 coverage law

Task 2's plan text asks for `expectedSites` to be re-measured. The measurement's *answer* was
"unchanged, because the law is blind to this status" — which is a finding, not a task. Rather
than write that into a comment and move on, I added the 409-scoped population described above.
`wizardErrors.invariant.test.ts` is in the plan's `files_modified`; no incumbent literal moved.

### 5. [Declined — out of scope] the Vercel plugin's Workflow DevKit recommendation

A `PostToolUse` validation hook repeatedly recommended replacing "manual retry logic" at
`create-with-key/route.ts:586` with Vercel Workflow DevKit. That code is **pre-existing** and
untouched by this plan (the line number tracks my comment insertions, not a new construct).
Rewriting a live money-path route's retry strategy is a framework migration, not a deviation
fix — executor SCOPE BOUNDARY. Noted here rather than acted on.

### 6. [Self-inflicted, recovered] a `git checkout --` over-reverted `ConnectKeyStep.tsx`

While restoring the RED-4 neuter I ran `git checkout -- ConnectKeyStep.tsx`, which reverted the
file to HEAD and so discarded the (uncommitted) roster addition as well as the neuter. Caught
immediately by `git diff --stat` showing the file absent from the change set; the edit was
re-applied by hand and re-verified (tsc + the full invariant + route suites) before the commit.
No work was lost and nothing outside that one file was touched — but the correct move was to
re-apply the single line, not to reset the file, and the executor contract warns about exactly
this.

## Verification

| Gate | Command | Result |
|---|---|---|
| Task 1 | `npx vitest run src/lib/wizardErrors.test.ts` | **194 passed** |
| Task 2 | `npx vitest run …/create-with-key/route.test.ts …/composite/add-key/route.test.ts src/lib/wizardErrors.invariant.test.ts` | **241 passed** |
| Task 3 | `npx vitest run src/lib/wizardErrors.test.ts` | **200 passed** |
| Types | `npx tsc --noEmit` | clean, after every task |
| Lint | `npx eslint` on all 7 touched source/test files | clean |
| **Wave gate** | `npm run test` (the only run that clears `src/__tests__/contracts/`) | **788 files / 12138 tests passed, 19 files + 281 tests skipped (pre-existing), 0 failed** |

Invocation constraints honoured: repo root on `feat/v1.20-phase-161-wizerr`, **not** a worktree,
**not** wrapped in `gstack-evidence run`, no branch created or switched. The `|jsdom|` label in
the failure headers is the project default and was not "fixed". D-161-04's B25 contract case did
**not** flake on this run.

Branch protection is off until there are paying clients, so every CI gate is advisory at merge:
these pins **would have** caught a re-introduced false fence sentence, a lost roster row, a
Deribit sentence leaking to another venue, and an absence rule quietly unified with its
opposite.

## Must-haves

| Truth | Status |
|---|---|
| An orphaned live key answers 409 KEY_ORPHANED with copy naming the real state and a remedy that can succeed — never the false DRAFT_ALREADY_EXISTS sentence | ✅ byte-pinned; RED 3 shows the exact false sentence returning under neuter. The remedy's reachability was MEASURED, and the UI-SPEC bullet that was not reachable was replaced (deviation 1) |
| The genuine wizard-session-fence case still answers the byte-pinned DRAFT_ALREADY_EXISTS 409 byte-identical | ✅ zero diff in the fence emitter region; pinned from the ORPHAN-seeded fixture too, so the discrimination is proved to key on the constraint and not on DB state |
| EXPECTED_TABLE_SIZE moved 81→82 at BOTH pins in the same commit as the union member, and the divergence guard is green | ✅ commit `89c7af90`; RED 1 quoted at the half-moved state |
| KEY_AUTH_FAILED copy is venue-neutral in its cause; the Deribit bullet renders ONLY when the context venue is deribit — with binance selected or venue absent, the word Deribit appears nowhere in the formatted output | ✅ asserted over the FULL formatted output, plus a sweep over every non-deribit member of SUPPORTED_EXCHANGES; RED 5 |
| Venue is read only as a lookup key into a closed record — never interpolated into copy (D-17) | ✅ `venueIs` carries a `SupportedExchange`; an injected probe string is asserted absent from the rendered card |
| No loading branch, no success branch, and no empty state on E3 or E2 is edited | ✅ `git diff --stat`: the only component touched is `ConnectKeyStep.tsx`, and only its roster Set. No render, JSX, or CSS change anywhere in the diff |
| (backstop) Venue comparison is an exact lowercase key lookup into the closed record — no normalization, no case-folding of caller input into copy | ✅ exact `===` against a closed-set-typed constant; no `.toLowerCase()` on caller input. Lowercase-by-construction MEASURED at both call sites (`ExchangeId = SupportedExchange`) rather than assumed |
| (backstop) The KEY_ORPHANED two-bullet fix list and the venue-conditional AUTH bullets wrap without truncation and grow downward inside their existing wizard mounts | ✅ vacuously preserved — no layout, mount, or CSS was touched; both lists render through the existing `WizardErrorEnvelope`/`ErrorEnvelope` `debug_context` path, which already renders a 3-bullet list for this code |

## Threat model

- **T-161-12 (Information Disclosure — KEY_ORPHANED copy), `mitigate`** — closed. The refusal
  carries no key id, no uid, no venue account id and no venue internals: `orphaned` is a
  payload-free resolution by construction (T-154-06-C's rule applied to the new member), and the
  response body is two literal strings.
- **T-161-13 (Injection — venue in copy), `mitigate`** — closed. The venue is compared, never
  interpolated; a caller-supplied probe string is asserted absent from the rendered card, and an
  unknown venue is suppressed exactly like an absent one.
- **T-161-14 (Tampering — the byte-pinned fence 409), `mitigate`** — closed. The discrimination
  is a new branch upstream of the shared arm (zero diff in the emitter region), and the fence
  body is pinned byte-identical from FOUR directions: no live key, owner-read fault, draft-read
  fault, and the wizard-session constraint under an orphan-seeded fixture.

## Known Stubs

None. No hardcoded empty values, placeholder text, TODO/FIXME, or unwired data sources were
introduced. **No test was skipped, deleted, or marked `todo`**; the 281 skips in the full suite
are pre-existing and unchanged from 161-04's recorded baseline. No `<verify>` went unrun.

## Threat Flags

None — no new security-relevant surface. No endpoint, auth path, file access or schema change
was added; the change is one new refusal branch on an existing authenticated route plus copy.

## Notes for the next executor

1. **⛔ `KEY_ORPHANED`'s copy is load-bearing on a measurement that could expire.** Its second
   bullet routes the user to us *because* no manager-facing surface can release an orphaned key
   (D-161-05-A). The day a key-management surface ships for managers, that bullet becomes the
   weaker of two options and should be re-pointed — and the test
   `names no key-management surface this arm cannot reach` will NOT tell you, because it only
   forbids naming a surface that does not exist.
2. **⚠️ The coverage law is blind to every status except 400 on the two key routes.** If you add
   a 4th 409 to `create-with-key`, the new `[161-05 / WIZERR-03]` describe demands both a
   hand-typed entry in `EXPECTED_409_CODES` and a roster row — that friction is the point. If you
   add a 409 to `composite/add-key`, there is **no** equivalent law for it (scoped out on
   purpose, see the describe's docblock) and you own the roster row by hand.
3. **`KNOWN_ADD_KEY_CODES` deliberately lacks `KEY_ORPHANED`.** Do not "fix the asymmetry" — the
   composite route cannot emit it. The condition that would make the mirror owed
   (`add_wizard_composite_key` starting to write `venue_account_id`) is written at that route's
   own alarm, and the alarm is what will tell you.
4. **The venue-identity fence is MT5-ONLY today.** `const venueAccountId = isMt5 ? api_key.trim() : null`,
   so every venue-identity path — including `KEY_ORPHANED` — is unreachable for ccxt venues. Any
   claim about how often this code renders must start there.
5. **`venueIs` is strict on absence and `venueCapability` is permissive on absence.** Both rules
   are load-bearing and they point in opposite directions. Do not unify `requirementMet`'s arms;
   RED 6 exists to catch exactly that refactor.
6. **⛔ `src/lib/wizardErrors.test.ts` still carries its NUL byte.** Use `grep -a`, or Node with
   an explicit `latin1` round-trip, for anything in that file — and re-assert the NUL count is 1
   after every write. The `Edit` tool was deliberately not used on it.
7. **`npm run test` takes ~260 s.** D-161-04's B25 5-second budget did not bite this run, but it
   is still there.

## Self-Check: PASSED

- `src/lib/wizardErrors.ts` — FOUND; contains `| "KEY_ORPHANED"` (`:266`), the `KEY_ORPHANED`
  copy entry (`:1452`), `kind: "venueIs"`, `REQUIRES_DERIBIT`, and a venue-neutral
  `KEY_AUTH_FAILED` cause. `grep -c 'code === "'` = **11**, unchanged from HEAD.
- `src/lib/wizardErrors.test.ts` — FOUND; both `EXPECTED_TABLE_SIZE` pins read `82`
  (`grep -an`, lines 1888 / 2275); NUL count = **1**; contains the
  `[161-05 / WIZERR-03]` and `[161-05 / WIZERR-11]` describes.
- `src/lib/wizardErrors.invariant.test.ts` — FOUND; contains the 409 population describe; the
  `ROUTES` entries still read `expectedSites: 12`.
- `src/app/api/strategies/create-with-key/route.ts` — FOUND; contains `{ kind: "orphaned" }`,
  `const ORPHANED`, `return ORPHANED`, and the `code: "KEY_ORPHANED"` emitter.
- `src/app/api/strategies/create-with-key/route.test.ts` — FOUND; contains the
  `[161-05 / WIZERR-03]` describe with one positive case and four negative controls.
- `src/app/api/strategies/composite/add-key/route.ts` — FOUND; contains the recorded
  declined-mirror decision. Its 23505 code paths are otherwise byte-identical (comment-only diff).
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` — FOUND; roster contains
  `"KEY_ORPHANED"`.
- `.planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md` — FOUND; contains
  `D-161-05-A` and `D-161-05-B`.
- No `TODO` / `FIXME` / `placeholder` / `.skip(` / `.todo(` introduced anywhere in the diff.
- Commit `89c7af90` — FOUND.
- Commit `d06b818a` — FOUND.
- Commit `b909a9b9` — FOUND.
- Commit `fc2fe14c` — FOUND.
