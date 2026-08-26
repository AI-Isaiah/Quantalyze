# 161 FIX — TOPIC B: copy honesty on the public surface and in the copy table

**Scope:** WR-04, IN-03, IN-02 (claim text only)
**Tree:** MAIN working tree, branch `feat/v1.20-phase-161-wizerr`. No worktree created, no branch
created, **nothing committed** (orchestrator commits topics sequentially).
**Files touched (all inside the owned list):**

- `src/lib/wizardErrors.ts`
- `src/lib/wizardErrors.test.ts`
- `src/app/api/verify-strategy/route.ts`
- `src/app/api/verify-strategy/route.test.ts`

No file outside the owned list was edited. `src/components/error/ErrorEnvelope.tsx`,
`src/lib/strategyGate.ts`, `src/components/strategy/MarkOwnershipDialog.tsx`,
`src/lib/wizardErrors.invariant.test.ts` and `src/lib/dialog-envelope.invariant.test.ts` were READ
only.

---

## WR-04 — `verify-strategy` sfox arm, anonymous surface

### What the measurement says (and where it contradicts the review's framing)

The review's premise is that the sfox arm "discloses that an unlaunched venue exists". **Measured at
HEAD, it cannot.** The arm is guarded by an ordering that already gates the public copy on the
offered set, exactly as WIZERR-08/F3 asks:

| Gate | Line | Effect |
|---|---|---|
| `!UI_EXCHANGE_CODES.includes(exchange)` → `KEY_UNSUPPORTED_VENUE` | `route.ts:170` | runs FIRST |
| `exchange === "sfox" && !isSfoxEnabledServer()` → `KEY_VENUE_NOT_ENABLED` | `route.ts:184` | runs SECOND |

`UI_EXCHANGE_CODES` (`closed-sets.ts:389-406`) appends `sfox` only when `SFOX_UI_ENABLED`
(`NEXT_PUBLIC_SFOX_ENABLED === "true"`) — i.e. only when the public `VerificationForm` dropdown is
already **offering** sfox. So the venue-disabled arm is unreachable for a venue the landing form was
not presenting. And that ordering is not inherited from a comment: `route.test.ts` already carries
`F3 ORDERING:` (a venue outside the offered set is refused by the offered-set gate, never by the
venue-disabled gate) and `F3 ENUMERATION:` (the disclosed list is exactly `UI_EXCHANGE_CODES` and
names nothing wider, with a non-vacuity fence on the complement).

**Therefore the half of the instruction that reads "public copy gates on `UI_EXCHANGE_CODES`, the
offered set" is SATISFIED at HEAD by measurement, and I did not rewrite the public sentence.**
Rewriting `"sFOX integration is not yet available."` into an "unsupported-here" line would have
traded a bounded TRUE sentence for an unbounded FALSE one: at the only moment this arm fires we DO
support sfox and are offering it in our own dropdown, so "this exchange is not supported here" would
be the false-sentence defect this phase exists to close, pointed the other way. (Rule 3: where the
measurement contradicts `161-UI-SPEC`, the measurement wins — this is the sixth time the UI-SPEC has
been found defective this phase, and the same override 161-05 and 161-07 took.)

### What WAS defective, and what changed

1. **The route's own hazard note overstated the hazard and contradicted itself.** It argued
   "THE DISCLOSURE IS BOUNDED BY ORDERING" and then, two paragraphs later, that the code "WOULD leak
   a coming-soon signal about an unlaunched venue". Both cannot be true. Corrected in
   `route.ts:200-221` to state the residual hazard at its real size: the coming-soon **wording**
   would be rendered for a venue we are presenting as available — the wording F3 bans on this
   surface — not a disclosure of something hidden.
2. **The premise the deferral rests on had no tripwire.** Now pinned.

### The pin — `route.test.ts`, `[161-REVIEW / WR-04] the F3 deferral's premise…` (4 cases)

Population **derived from disk** (a hand-typed file list would keep passing the day someone adds a
new landing component that reads the channel — the actual regrowth vector):

- `productionSourcesUnder(src/components/landing/)` — recursive, skips `__tests__` / `__mocks__` and
  `*.test.tsx?`.
- Needles (hand-typed, deliberately not imported): `WIZARD_ERROR_COPY`, `recogniseSeamErrorCode`,
  `recogniseDashboardDialogCode`, `formatKeyError`, `@/lib/wizardErrors`.

Anti-vacuity, all of it explicit:

- every needle `.trim().length > 8` (guards `"anything".includes("")`);
- **positive control**: the SAME scanner run over the authenticated wizard-steps dir must find at
  least one hit — so a broken walker/needle set cannot make the landing-dir negative look green;
- population fence `files.length > 0`, plus an independent hand-typed oracle that
  `VerificationForm.tsx` is in the derived set exactly once;
- a **consumption fence**: at least one scanned file must contain `/api/verify-strategy`, so the pin
  cannot go on guarding a surface that no longer calls this route;
- the `data.code` case asserts the two readers that DO exist (`data.human_message`, `data.error`)
  before asserting `/\bdata\.code\b/` is absent.

Measured premise, first-hand: `VerificationForm.tsx:96-109` reads
`safeHumanMessage(data.human_message) ?? safeHumanMessage(data.error) ?? "Verification failed"`.
There is no `code` read anywhere in `src/components/landing/`.

### Observed RED (falsifiability)

**Neuter 1** — repointed the landing scan at the wizard-steps dir (test-file only, no production
file touched):

```
FAIL … NO production file under src/components/landing/ translates a wire code into wizard copy
AssertionError: <home>/.../wizard/steps/ConnectKeyStep.tsx references WIZARD_ERROR_COPY.
An ANONYMOUS surface has begun translating wire codes into WIZARD_ERROR_COPY, so the sfox arm in
verify-strategy/route.ts can now render "This exchange is not open on Quantalyze yet." to a
logged-out visitor … : expected true to be false
```

**Neuter 2** — swapped the negative regex `/\bdata\.code\b/` → `/\bdata\.error\b/`:

```
FAIL … VerificationForm's error path reads the SENTENCE channel, never `code`
AssertionError: VerificationForm now reads `data.code` from /api/verify-strategy. … : expected true to be false
```

Both restored byte-identical (sha256 `6f951de0…` re-verified after each).

### Not done, and why

The review's alternative — mint a route-local `VENUE_NOT_OFFERED_HERE` that is not a
`WizardErrorCode` — was **not** taken. It would move `EXPECTED_TABLE_SIZE` for no truth gain, and it
re-creates the WR-03 hazard (a code invisible to every `code:`-first coverage law) to solve a hazard
the ordering already bounds. The pin makes the premise detectable, which is what was missing.

---

## IN-03 — `GATE_SERIES_EXAMINED_REFUSED`'s first remedy

### Measurement (producer, read first-hand — NOT inferred from the sibling comment)

`analytics-service/services/broker_dailies.py`, "Who stamps what" registry docstring (`:118-133`)
plus the three stamp sites:

| Producer | Venue(s) | Verdict | Conditional? |
|---|---|---|---|
| `combine_native_ledger` (`:311-347`) | deribit | `ledger_complete` | **No** — both return paths, unconditional; an incomplete crawl raises `LedgerCompletenessError` / `LedgerTruncatedError` and fails the whole job permanently, so no partial deribit series can exist |
| `combine_mt5_deal_ledger` (`:694-701`) | mt5 | `ledger_complete` | No |
| `combine_sfox_balance_history` (`:540`) | sfox | `ledger_complete` iff `nav_gap_days == 0`, else `sampled_gapped` | **Yes** |
| `combine_realized_and_funding` | binance / bybit / okx | `fill_derived_unproven` | No — "a CONSTANT, not a data-driven refinement" |

`GATE_SERIES_EXAMINED_REFUSED` is reached only from `fill_derived_unproven` / `sampled_gapped`
(`strategyGate.ts` `SERIES_EXAMINED_BUT_REFUSED`). So the venues that can **reach** this screen are
exactly binance / bybit / okx / sfox-with-gaps, and the venues that **cannot** are deribit and mt5.

### The change

`fix[0]` moved from a set the reader cannot resolve to a named venue:

- before: *"Connect a key from a venue we can read end to end — one that gives us a complete
  transaction ledger rather than a fill feed."*
- after: *"Connect a Deribit key instead — Deribit gives us the venue's full transaction ledger
  rather than a fill feed, so the record behind the series is whole."*

**MT5 is deliberately NOT named**, even though it qualifies: its wizard presence rides
`MT5_UI_ENABLED`, so static copy naming it would name a venue the surface may not be offering — the
same disclosure class as WR-04, in a different costume. The sentence names ONE venue and claims no
exhaustiveness precisely so it stays true whether a flag-gated venue is dark or live. A 20-line
docblock records the measurement, the MT5 exclusion, and the obligation ("if a second
always-offered venue starts stamping `ledger_complete`, name it here too").

Deribit is in `UI_EXCHANGE_CODES_BASE` — offered unconditionally, behind no flag. Precedent for a
static venue name in copy exists at `wizardErrors.ts:1542` (Binance / OKX / Bybit secret formats).

### The pins — `wizardErrors.test.ts`, `[161-REVIEW / IN-03]…` (3 cases)

⛔ **The oracle is not the copy table.** The venue→verdict mapping is Python and cannot be imported,
so the test READS `analytics-service/services/broker_dailies.py` and asserts the registry facts the
sentence rests on. A hand-typed venue list checked against the sentence would only restate the
sentence. Fences: file size `> 5000`, bullet `.trim().length > 40` before any `toContain`, and
`>= 2` unconditional `ledger_complete` assignment sites for the deribit paths. The negative half
asserts the bullet names none of Binance / Bybit / OKX / sFOX, and a third case asserts it names
neither MT5 nor MetaTrader.

### Observed RED

**Neuter A** — reverted `fix[0]` to the old sentence in `wizardErrors.ts`:

```
FAIL … the first remedy names Deribit, and never a venue that can reach this code
AssertionError: the examined-refused remedy no longer names a venue the reader can act on
(161-REVIEW / IN-03). … expected 'Connect a key from a venue we can rea…' to contain 'Deribit'
```

**Neuter B** — producer needle `(deribit` → `(kraken`, simulating the producer's mapping moving:

```
FAIL … the producer still maps deribit → ledger_complete and the ccxt venues → fill_derived_unproven
  expect(BROKER_DAILIES).toContain("``combine_native_ledger`` (kraken");
```

Both restored byte-identical (sha256 re-verified).

---

## IN-02 — the Principle-4 correlation-id claim

### VERDICT: **the TEXT is what should change — and the renderer alone cannot fix it.**

Three measurements:

1. `ErrorEnvelope.tsx:202-223` renders `<details> Diagnostics` — `code` and `correlation_id` —
   **unconditionally**, with no reference to `actions`. (Confirmed still true at the end of this
   run: `git status` shows `ErrorEnvelope.tsx` unmodified; Topic C changed only
   `ErrorEnvelope.test.tsx`.)
2. `expand_log` has **zero production consumers**:
   `grep -rn "expand_log" src --include='*.ts' --include='*.tsx' | grep -v wizardErrors.ts | grep -v '\.test\.'`
   returns nothing. It is a declaration in the copy table with no renderer behaviour.
3. ⭐ **Gating the renderer on `actions.includes("expand_log")` would NOT make the claim true.**
   Derived over all 89 entries: `KEY_ORPHANED` carries `try_another_key` — a member of
   `RECOVERABLE_ACTIONS`, so `buildEnvelope` derives `recoverable: true` — **alongside**
   `expand_log`. One counterexample is enough: `expand_log` present cannot establish "this arm is
   non-actionable" under any renderer.

So the claim "no correlation id on an actionable arm … because `expand_log` is present only on
terminal members" is false on its own terms, independent of the renderer. The text had to change.

Because Topic C owns the renderer, the replacement text was written to be **true under both renderer
states** — it makes no claim about what `ErrorEnvelope` renders, only that this table does not decide
it. If Topic C later gates the block, nothing I wrote becomes false.

### Changes

- `wizardErrors.ts:3216-3242` (DASHBOARD roster note): Principle 4 restated as an **authoring rule**,
  with both grounds recorded and the superseded sentence quoted verbatim so the next reader inherits
  the reasoning rather than an unexplained inversion.
- `wizardErrors.ts:4589-4593` (`DASHBOARD_DIALOG_ROUTE_CODES` docblock): *"would show a correlation
  id on an ACTIONABLE arm"* → the renderer-independent core (*"the remedy is AT the Name field, and a
  terminal panel beside it is noise competing with that remedy"*), with a note pointing at the IN-02
  correction. This claim was TRUE at HEAD only because the block is unconditional; it would have
  become false the moment Topic C gated it.

### The pins — `wizardErrors.test.ts`, `[161-REVIEW / IN-02]…` (2 cases)

1. **The counterexample, DERIVED** (through `buildEnvelope`, not by reading `actions` — matching this
   file's standing rule that asserting `actions` directly only restates the table). Fence:
   `codes.length > 50`. Fails loudly with a "re-decide, do not delete" message if the
   recoverable+`expand_log` set ever empties.
2. **The citation pin, WHITESPACE-NORMALISED.** A raw substring pin is defeated by re-wrapping the
   comment — the same sentence at a different line width reads identically to a human and slips
   through. The test strips comment markers, collapses whitespace, then asserts:
   - claim A appears **exactly once**, and the 200 chars before it contain "superseded" (i.e. the one
     occurrence is the correction quoting it, not an assertion);
   - claim B appears **zero** times;
   - normaliser controls: `flat.length > 50_000` and the corrected heading present, so a normaliser
     that blanked the file cannot make the case vacuously green.

### Observed RED

**Neuter C** — removed `expand_log` from `KEY_ORPHANED`:

```
FAIL … at least one entry is RECOVERABLE and carries `expand_log` — so presence cannot mean 'terminal'
AssertionError: no entry is both recoverable and carries `expand_log` any more. … expected 0 to be greater than 0
```

**Neuter D** — reintroduced claim A **at a different line wrap** than the original (the exact
weakness the normalisation exists to close):

```
FAIL … no docblock claims `expand_log`'s presence establishes Principle 4
AssertionError: the superseded Principle-4 claim appears somewhere other than (or instead of) the
IN-02 correction that quotes it. … expected 2 to be 1
```

**Neuter E** — reintroduced claim B alone:

```
AssertionError: wizardErrors.ts has reintroduced: would show a correlation id on an ACTIONABLE arm
(Principle 4). Nothing in this file decides what ErrorEnvelope renders. … expected 1 to be 0
```

All restored byte-identical (`428f54c4…` / test-file sha re-verified).

---

## Verification (run in the MAIN checkout, not a worktree — reproducible from this tree)

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean (no output) |
| `npx vitest run src/lib/wizardErrors.test.ts src/app/api/verify-strategy/route.test.ts src/lib/wizardErrors.invariant.test.ts src/lib/strategyGate.test.ts src/app/api/verify-strategy/route.seam.test.ts` | **5 files / 383 tests passed** |
| `npx vitest run src/__tests__/contracts src/lib/seam-citations.invariant.test.ts` (globally-scanning laws — file-scoped runs cannot clear these) | **5 files / 138 tests passed** |

Invariants re-asserted after the last write:

- `src/lib/wizardErrors.test.ts` NUL count = **1** (264 096 bytes) — the load-bearing delimiter at
  line 1572 is intact and was never touched (all appends went to EOF).
- `EXPECTED_TABLE_SIZE` = **89** at exactly 2 sites, unchanged — **no code was minted**.
- `git diff -U0 src/lib/wizardErrors.ts | grep '^@@'` → exactly 4 hunks, all mine. No other agent
  touched this file.

Full `npm run test` deliberately NOT run (orchestrator runs the gate once after all three topics).

---

## Files needed but NOT owned

None. Every fix landed inside the owned list.

## Flag for the orchestrator

**Coupling with Topic C.** My IN-02 text is renderer-agnostic by construction, so it survives either
outcome. But if Topic C gates the Diagnostics block on `actions.includes("expand_log")`, note that
Principle 4 STILL will not hold — `KEY_ORPHANED` (`try_another_key` + `expand_log`) is a live
counterexample, and my derived pin names it. Deciding what to do about `KEY_ORPHANED` is a copy call
nobody owned this round; it is the one remaining gap between Principle 4 as written and the table as
shipped.
