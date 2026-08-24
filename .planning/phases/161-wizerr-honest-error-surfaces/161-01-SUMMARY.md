---
phase: 161-wizerr-honest-error-surfaces
plan: 01
subsystem: api
tags: [error-handling, copy, coverage-law, anti-vacuity, seam, permissions-probe]

requires:
  - phase: 140.3-01
    provides: "the seam-failure `cause` that carries the upstream machine code (`buildSeamFailureCause`)"
  - phase: 140.3-09
    provides: "the 429 arm that already reads that cause — the precedent this arm follows"
provides:
  - "An honest `KEY_UNDECRYPTABLE` arm on `keys/[id]/permissions`: the server-classified code is consulted and renders a remedy that can actually succeed"
  - "`src/lib/probe-vocabulary.invariant.test.ts` — a derived-population coverage law over the route's private code vocabulary, proven falsifiable by three observed-RED mutations"
  - "The phase's repeatable motif, proven end-to-end: route classification → honest copy → coverage law → anti-vacuity proof"
affects: [161-02, 161-03, 161-04, 161-05, 161-06, 161-07, 161-08, 161-09, 161-10, WIZERR-05, WIZERR-06]

actuals:
  tokens: 8574
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Route-local derived-population law that brings its OWN scanner matched to the file's real emitter shapes, rather than restructuring working arms to suit an incumbent regex"
    - "Roster entries carry a `retryClearsIt` human judgment, making 'is this sentence true about the user's situation?' a checkable property"

key-files:
  created:
    - src/lib/probe-vocabulary.invariant.test.ts
  modified:
    - src/app/api/keys/[id]/permissions/route.ts
    - src/app/api/keys/[id]/permissions/route.test.ts

key-decisions:
  - "The arm is keyed on ONE code with `===`, never a blanket forward of every seam code — an identity admission would let an upstream name our private vocabulary and would silently retire the substring cascade"
  - "The law brings its own scanner (two shapes: `code: \"X\"` property and `const code = <ternary>`); the incumbent wizardErrors emitterRe is code-first and would see NEITHER"
  - "The response body stays STATIC; the upstream's own sentence reaches only the scrubbed operator log (T-161-01 / H-1062 / F5b)"
  - "No Retry-After is stamped — none was advertised, and absence must never become a fabricated zero (TRAP-3)"
  - "The remedy-honesty law asserts only the NEGATIVE direction (an irrecoverable arm may not say 'try again'); the converse is declared blind, because PROBE_RATE_LIMITED expresses its wait through the Retry-After header, never prose"

patterns-established:
  - "Anti-vacuity: every mutation records what was mutated → the observed RED → restored-byte-identical, with `git diff --stat` as the restoration oracle"
  - "Vacuity fences at two levels: the population is asserted non-empty AND every filtered sub-population used by a law gets its own non-empty fence"

requirements-completed: [WIZERR-04]

coverage:
  - id: D1
    description: "A permissions probe failing with server-classified KEY_UNDECRYPTABLE renders the reconnect remedy with code KEY_UNDECRYPTABLE, never the generic PROBE_FAILED retry sentence"
    requirement: WIZERR-04
    verification:
      - kind: unit
        ref: "src/app/api/keys/[id]/permissions/route.test.ts#POSITIVE — a seam failure carrying code KEY_UNDECRYPTABLE renders the reconnect remedy, not the retry sentence"
        status: pass
      - kind: unit
        ref: "src/app/api/keys/[id]/permissions/route.test.ts#CONTRACT A — a `service_error` 500 (OBJECT detail)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A genuinely unclassified probe failure still renders PROBE_FAILED with its existing sentence, byte-identical"
    requirement: WIZERR-04
    verification:
      - kind: unit
        ref: "src/app/api/keys/[id]/permissions/route.test.ts#NEGATIVE CONTROL — a genuinely unclassified failure still answers PROBE_FAILED, byte-identical"
        status: pass
      - kind: unit
        ref: "src/app/api/keys/[id]/permissions/route.test.ts#NEGATIVE CONTROL — the code is matched exactly, never by substring"
        status: pass
    human_judgment: false
  - id: D3
    description: "The PROBE_* vocabulary law derives its population from route source, asserts the population is non-empty, and pins a hand-typed site count"
    requirement: WIZERR-04
    verification:
      - kind: unit
        ref: "src/lib/probe-vocabulary.invariant.test.ts (16 tests, all pass)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The law was proven falsifiable: three neuter mutations each produced an observed RED, then the code was restored byte-identical"
    requirement: WIZERR-04
    verification:
      - kind: other
        ref: "three mutation cycles recorded verbatim in ## Anti-Vacuity Proof below; restoration oracle `git diff --stat` empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "Long remedy sentences wrap within the existing KeyPermissionBadge/envelope mounts without truncation"
    requirement: WIZERR-04
    verification: []
    human_judgment: true
    rationale: "Rendered-layout property jsdom does not measure. KeyPermissionBadge required ZERO edits — it already renders `${err.code}: ${message}` — so this is backstopped by the existing render tests, but wrap/clip behaviour at the new sentence length is a human look."

duration: 24min
completed: 2026-08-24
status: complete
---

# Phase 161 Plan 01: KEY_UNDECRYPTABLE honest remedy + PROBE_* coverage law — Summary

**A permanently orphaned key stopped being told "Try again." — the permissions route now consults the `KEY_UNDECRYPTABLE` code it had been carrying on the error `cause` since 140.3-01, and a derived-population law over the route's six private codes is armed and proven falsifiable by three observed REDs.**

## Performance

- **Duration:** ~24 min
- **Tasks:** 2/2
- **Files modified:** 3 (1 created, 2 modified)
- **Full TS suite:** 788 files passed / 19 skipped · 12111 tests passed / 281 skipped (all skips pre-existing; this plan added none)

## Accomplishments

- **The remedy that can succeed now ships.** `routers/internal.py` answers a permanent 500 with `code: "KEY_UNDECRYPTABLE"` when stored ciphertext can no longer be read. The route had held that code on the thrown error's `cause` since 140.3-01 and had read the same cause for its 429 arm since 140.3-09 — the terminal arm simply never consulted it, so the fault fell through the substring cascade (whose six needles its sentence matches none of) and answered `PROBE_FAILED`: *"Could not check key scopes. Try again."* A retry cannot clear that fault. The sentence was not vague; it was **false about the user's situation**, and it hid the one action that works.
- **The class is closed, not just the instance.** `src/lib/probe-vocabulary.invariant.test.ts` derives the vocabulary from route source on every run, so the seventh code fails BY NAME on the day it is written and a deleted arm fails on the day it is deleted.
- **`KeyPermissionBadge` needed zero edits** — it already renders `${err.code}: ${message}`, so the honest code and sentence reach the user through the existing consumer. MT5-13 (the PROBE_FAILED red text on the success screen, parked v1.18) was not absorbed and its per-venue capability-flag fix is not foreclosed.

## Task Commits

1. **Task 1 (tracer): KEY_UNDECRYPTABLE honest remedy — one arm, end-to-end** — `ade08a92` (feat)
2. **Task 2: derived-population law over the private PROBE_* vocabulary** — `9b15377c` (test)

## Files Created/Modified

- `src/lib/probe-vocabulary.invariant.test.ts` **(new, 482 lines)** — the coverage law: derived population, both-halves agreement, remedy honesty, four SELF-TESTs.
- `src/app/api/keys/[id]/permissions/route.ts` — one new arm (+57 lines, 0 deletions) in the terminal catch, below the `CircuitOpenError` type check and above the substring cascade.
- `src/app/api/keys/[id]/permissions/route.test.ts` — a new `[161-01 / WIZERR-04]` describe with 3 cases; 3 lines changed in the pre-existing CONTRACT A case (see Deviations).

## The measured population — count and method

**Measured 6 codes at HEAD.** Method, re-runnable: the route source is read from disk and passed through `stripCommentsPreserveLines(…, "ts")` (`src/lib/source-scan.ts`), then two needles are applied and their results unioned:

| Shape | Predicate | Measured | Codes |
|---|---|---|---|
| A | a `code:` object property whose value is an UPPER_SNAKE string literal (the response-body form) | **3** | `CIRCUIT_OPEN`, `PROBE_RATE_LIMITED`, `KEY_UNDECRYPTABLE` |
| B | an UPPER_SNAKE string literal on the RHS of a `const code = …;` assignment (the cascade's bare-ternary form) | **3** | `PROBE_BACKEND_UNAVAILABLE`, `PROBE_TIMEOUT`, `PROBE_FAILED` |
| | **union** | **6** | |

The count was obtained by running the two needles over the real file in a throwaway `vite-node` script **before** the law was written, and the three numbers (6 / 3 / 3) are hand-typed into the law as `EXPECTED_TOTAL_CODES`, `EXPECTED_SHAPE_A_SITES`, `EXPECTED_SHAPE_B_SITES`. **No assertion uses `derived.length`.**

**Discriminating negative, measured on the real file (not a fixture):** the route also contains `"ECONNREFUSED"` and `"INTERNAL_API_TOKEN"` as bare UPPER_SNAKE literals — they are the cascade's own sentinel needles. A lazy "every UPPER_SNAKE literal is a code" scan reports **9**, not 6, and would demand roster entries for two things that are not codes. The law asserts both literals are present in the source AND absent from the derived population, so the predicate's precision is itself a checked property.

## Anti-Vacuity Proof

Three mutation cycles. Each records: what was mutated → the **observed** RED (copied from the run, not paraphrased) → restoration.

### Mutation 1 — delete the Task-1 `KEY_UNDECRYPTABLE` arm from the route (working tree only)

Both the law and the Task-1 route test were required to redden. Both did.

**Observed RED — the law (4 of 16 tests failed):**

```
× the population size equals the HAND-TYPED measured count
AssertionError: expected 6 emitted codes (hand-measured at HEAD), derived 5:
CIRCUIT_OPEN, PROBE_BACKEND_UNAVAILABLE, PROBE_FAILED, PROBE_RATE_LIMITED,
PROBE_TIMEOUT. …: expected 5 to be 6

× BOTH emitter shapes contribute — neither needle may silently die
AssertionError: SHAPE A (`code: "X"` response-body properties) derived 2,
expected 3. …: expected 2 to be 3

× HALF 2 — every ROSTER member is still emitted (a deleted arm fails HERE)
AssertionError: A roster member is no longer emitted anywhere in the permissions
route. … Missing from the route: KEY_UNDECRYPTABLE: expected
[ 'KEY_UNDECRYPTABLE' ] to deeply equal []

× every roster member has its curated sentence at the source the roster names
AssertionError: … Offending codes: KEY_UNDECRYPTABLE: expected
[ 'KEY_UNDECRYPTABLE' ] to deeply equal []
```

**Observed RED — the route test (2 of 44 tests failed):**

```
× CONTRACT A — a `service_error` 500 (OBJECT detail): the operator log carries
  `body.detail.detail`, never '[object Object]'
AssertionError: expected 502 to be 500 // Object.is equality

× POSITIVE — a seam failure carrying code KEY_UNDECRYPTABLE renders the
  reconnect remedy, not the retry sentence
AssertionError: The server already classified this fault. Falling back to
PROBE_FAILED discards a code the route is holding in its hand.:
expected 'PROBE_FAILED' to be 'KEY_UNDECRYPTABLE'
```

**Restored** via `git checkout -- src/app/api/keys/[id]/permissions/route.ts`. Oracle: `git diff --stat -- src/app/api/keys/[id]/permissions/route.ts` printed **nothing** — byte-identical.

### Mutation 2 — blank one roster entry (`PROBE_TIMEOUT.sentence = ""`)

⚠️ **This mutation found a real hole before it proved anything.** `"anything".includes("")` is `true` in JavaScript, so a blanked roster entry would have sailed through the sentence-presence check while asserting nothing — the law would have gone on reporting six guarded codes with one of them silently unguarded. A `no roster sentence is BLANK` guard was added (length floor 8; the shortest shipped sentence, `"Too many requests"`, is 17) **and only then** was the mutation run.

**Observed RED (1 of 16 tests failed):**

```
× no roster sentence is BLANK (an empty needle matches everything)
AssertionError: A roster sentence is blank or a stub. An empty string is a
substring of every source file, so the sentence assertion below would pass for
it forever while checking nothing. Transcribe the real shipped copy.
Offending codes: PROBE_TIMEOUT: expected [ 'PROBE_TIMEOUT' ] to deeply equal []
```

**Restored** to the shipped transcription; law back to 16/16 green.

### Mutation 3 — drift one roster sentence (added beyond the plan's two)

Mutation 2's RED came from the **new blank-guard**, not from the sentence-presence check it was meant to exercise — so the presence check was still unproven. Mutation 3 closes that: `PROBE_TIMEOUT.sentence` was changed to a plausible-but-wrong transcription, `"Permissions probe timed out. Please retry."`.

**Observed RED (1 of 16 tests failed):**

```
× every roster member has its curated sentence at the source the roster names
AssertionError: A roster member's curated sentence is not present where the
roster says it lives. Either the shipped copy changed without this transcription
moving with it (in which case the law is now vouching for a sentence no user
sees), or a curated sentence was replaced by an interpolated one — which on a
5xx would leak upstream prose (H-1062 / F5b). Offending codes: PROBE_TIMEOUT:
expected [ 'PROBE_TIMEOUT' ] to deeply equal []
```

**Restored** to `"Permissions probe timed out. Try again."`; law 16/16 green; route `git diff --stat` clean.

## Verification

| Command | Result |
|---|---|
| `npx vitest run 'src/app/api/keys/[id]/permissions/route.test.ts' 'src/app/api/keys/[id]/permissions/route.seam.test.ts'` (Task 1) | **48 passed** (45 baseline + 3 new) |
| `npx vitest run src/lib/probe-vocabulary.invariant.test.ts` + the route test (Task 2) | **64 passed** across 3 files |
| `npm run test` (full suite — mandatory, `src/__tests__/contracts/` scan all of `src/`) | **788 files passed / 19 skipped · 12111 tests passed / 281 skipped** |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint` over all 3 touched files | clean |

Invocation constraints honoured: run from the repo **root** on the main working tree (no worktree — a worktree has no `node_modules` and `npx vitest` there silently downloads a different vitest); **never** wrapped in `gstack-evidence run`. No Python was touched, so pytest was not required.

> Branch protection is deliberately off until there are paying clients, so every CI gate is **advisory at merge**. Stated correctly: this law and these route cases **would have caught** a regression of the `KEY_UNDECRYPTABLE`-discarding class; they did not *stop* anything at merge time.

## Deviations from Plan

### 1. [Expected — the plan's own target] CONTRACT A's two response assertions moved

- **Found during:** Task 1.
- **Issue:** The plan says pre-existing cases stay green "with no fixture edits". One pre-existing case could not stay green: `[140.3-01 / TS-05] CONTRACT A` asserted `expect(res.status).toBe(502)` and `expect(code).toBe("PROBE_FAILED")` **on this exact KEY_UNDECRYPTABLE fixture**, carrying the comment *"Unchanged by design — TS-34 owns the status, not this plan."* It pinned the precise wrong answer 161-01 exists to fix.
- **Fix:** The two assertions moved to `500` / `KEY_UNDECRYPTABLE`, with a comment recording that this plan is the one that owns the response shape. **The fixture is byte-identical** — same real, executed raise site — so what the case certifies (the nested read through `seamHumanMessage`, asserted below it) is unchanged; only the observable it had deliberately not yet asserted moved off the wrong value. This exactly mirrors the established in-file precedent: `CONTRACT B` carries the same kind of note ("UPDATED FROM 502 BY THE PLAN THAT OWNS THIS STATUS") from 140.3-09.
- **Verification:** the case still asserts the operator-log property it was written for; mutation 1 proved it reddens when the arm is removed.
- **Committed in:** `ade08a92`.

### 2. [Rule 2 — missing correctness guard] Blank-sentence guard added to the law

- **Found during:** Task 2, mutation 2.
- **Issue:** `"x".includes("")` is `true`, so a roster entry blanked to `""` passed the sentence-presence check while asserting nothing.
- **Fix:** added `no roster sentence is BLANK` with a length floor of 8.
- **Verification:** mutation 2 observed RED against the new guard; mutation 3 then proved the presence check itself is falsifiable.
- **Committed in:** `9b15377c`.

### 3. [Planned deviation, pre-authorised by the plan] The law brings its OWN scanner

The plan's `<action>` explicitly authorises this and records why: measured, this route's emitters are error-first JSON literals plus a ternary of bare string literals, which the incumbent `wizardErrors` `emitterRe` would **not** see. `161-UI-SPEC`'s parenthetical *"code-first-literal emitter shape so the scanner sees it"* assumed reuse of that regex; per the UI-SPEC's own preamble the **copy and invariants are the contract and the mechanics are planner-adjustable**. The copy is verbatim and every invariant is honoured; only the mechanism differs, and both SELF-TESTs prove the substituted mechanism actually reads this route's shapes. No working route arm was restructured to suit a scanner. This is documented in full in the law's docblock.

### 4. [Rule 3 — surgical changes] Prettier not run on the route

`npx prettier --check` reports the permissions route as unformatted — but it was **already** unformatted at `HEAD~1` (verified by checking the file at the parent commit), so prettier is not enforced on it. Reformatting would have produced a large unrelated diff. Not done.

### 5. [Out of scope] Vercel-plugin hook recommendations not actioned

The `posttooluse-validate` hook twice flagged *"Long-running or polling logic detected in a serverless handler"* against a pre-existing line in `route.test.ts` (line number shifted with my insertions; the flagged code is not mine), and a `PreToolUse` hook demanded the `verification` skill because a throwaway measurement script was run with `vite-node`. Both are false positives on code this plan does not own — out of scope per the executor's scope boundary and CLAUDE.md Rule 3.

---

**Total deviations:** 5 — 1 expected (the plan's own target), 1 auto-fixed (Rule 2), 1 pre-authorised by the plan, 2 declined as out-of-scope (Rule 3).

## Known Stubs

None. No hardcoded empty values, placeholder text, TODO/FIXME, or unwired data sources were introduced. No tests were skipped or marked `.todo`; no `<verify>` went unrun.

## Threat Flags

None. The plan's threat register is fully honoured and no new security-relevant surface was introduced:

- **T-161-01 (Information Disclosure, `mitigate`)** — the new arm answers a **static** curated sentence; the raw thrown message never reaches the response body. Asserted positively (`body.error` equals the hand-typed sentence) and negatively (`body.error` does not contain the upstream's own prose), with the scrubbed operator line asserted to still carry it.
- **T-161-02 (DoS / Retry-After stamping, `mitigate`)** — the new arm stamps no `Retry-After`; asserted `res.headers.get("Retry-After")` is `null`. The existing absent-value-⇒-header-omitted pattern is untouched.
- **T-161-03 (Tampering, `accept`)** — the law reads in-repo source at test time only; no external input.

Sentry policy unchanged: the terminal arm remains the route's only capture (the new arm returns before it, deliberately — an orphaned key is a user-actionable state, not an incident to page on).

## Notes for the next executor

1. **The plan's motif is proven and repeatable.** Route classification → honest copy → coverage law → anti-vacuity proof works end-to-end. Reuse the shape.
2. **⛔ `grep` is silently blind to `src/lib/wizardErrors.test.ts`** (deliberate NUL byte at line 1572 — a load-bearing phrase delimiter, do NOT remove it). `grep -c` returns exit 1 with no output, which reads exactly like "not found". Use `grep -a`. Confirmed live this session: an unquoted `--include=*.ts` also dies on zsh globbing — quote your globs.
3. **`stripCommentsPreserveLines` lives in `src/lib/source-scan.ts`**, not a separate module.
4. **`CIRCUIT_OPEN_COPY` is imported, not a route literal** — any law over this route's sentences must handle that member separately or it will report a false miss.
5. **The `|jsdom|` label in vitest failure headers is the project default and does NOT mean the `// @vitest-environment node` directive was ignored.** The real signal is the `environment` timing: `0ms` for node files, ~1.5s for jsdom ones. Do not "fix" a directive that is working.
6. **Adding a 7th code to this route now requires three deliberate edits** in `probe-vocabulary.invariant.test.ts`: the roster entry (with its `retryClearsIt` judgment), `EXPECTED_TOTAL_CODES`, and the relevant per-shape count. That friction is the point.

## Self-Check: PASSED

- `src/lib/probe-vocabulary.invariant.test.ts` — FOUND (482 lines, exceeds the plan's `min_lines: 80`)
- `src/app/api/keys/[id]/permissions/route.ts` — FOUND, contains the `KEY_UNDECRYPTABLE` arm
- `src/app/api/keys/[id]/permissions/route.test.ts` — FOUND, contains the `[161-01 / WIZERR-04]` describe
- Commit `ade08a92` — FOUND
- Commit `9b15377c` — FOUND
