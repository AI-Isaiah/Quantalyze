---
phase: 161-wizerr-honest-error-surfaces
artifact: review-fixes
source_review: .planning/phases/161-wizerr-honest-error-surfaces/161-REVIEW.md
fixed_at: 2026-08-25
scope: [CR-01, CR-02, WR-01, WR-06]
out_of_scope_by_instruction: [WR-02, WR-03, WR-04, WR-05, IN-01, IN-02, IN-03, IN-04]
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
commits:
  - 1cd46db3  # WR-06
  - 84c097df  # WR-01
  - 989c58ff  # CR-02
  - 279e92f6  # CR-01
---

# Phase 161: Review Fixes — CR-01, CR-02, WR-01, WR-06

**Chosen artifact:** this file (`161-FIXES-SUMMARY.md`), rather than appending to
`161-10-SUMMARY.md` — three of the four findings are not 161-10's work
(`csv_validator.py` is 161-03's, `seam-retry-after.ts` is 161-06's,
`mt5_probe.py` is 161-02's), so filing them under one plan's summary would put
the record in the wrong place.

All work on `feat/v1.20-phase-161-wizerr` in the **MAIN working tree**. No
worktree created, no branch created/switched/renamed. vitest from the repo root,
pytest from `analytics-service/` with `python3`, never wrapped in
`gstack-evidence run`.

---

## Verification (where it ran: MAIN checkout, repo root)

| Gate | Result |
|---|---|
| `npm run test` (full — the only run that clears `src/__tests__/contracts/`) | **791 files passed / 19 skipped · 12 357 tests passed / 281 skipped**, 175.16 s |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint` over every touched TS/TSX file | clean |
| `python3 -m pytest -q` (from `analytics-service/`) | **5240 passed / 89 skipped**, 107 s |
| `python3 -m mypy --strict --follow-imports=silent services/ routers/ models/` (the CI invocation) | **Success: no issues found in 91 source files** |
| `src/lib/wizardErrors.test.ts` NUL count | **1**, re-asserted after every write (245 902 → 253 862 bytes) |
| `EXPECTED_TABLE_SIZE` | **89** at exactly 2 sites (`grep -ac`) |

The 281 TS skips and 89 Python skips are pre-existing and unchanged. This work
skipped nothing and marked nothing `todo`.

**Ledger wording.** Branch protection is off until there are paying clients, so
every CI gate is advisory at merge. Each pin below is stated as one that
**would have** caught the defect it names; none of them *stopped* anything,
because nothing was merged.

---

## CR-01 — `DASHBOARD_WRITE_FAILED` split · commit `279e92f6`

Took the SPLIT per the orchestrator decision, not the strike.

### The per-arm verdict for EVERY emitter (the binding requirement)

Classified from each route's own code, not from its comment. **The membership
rule is mechanical:** an arm is verified-zero-write iff **no data-modifying
statement had been SENT** when it returns.

**Why a sent write can never claim a zero write** — two independent mechanisms,
both readable in the routes:

1. `supabase-js` collapses a **PostgREST rejection** (statement rolled back —
   nothing saved) and a **transport failure** (the statement may have committed
   and the answer was lost) into the same `{ data, error }` shape. **No arm on
   any of the three routes discriminates them**, so none can *verify* a zero
   write. The repo's own bar — "'NOTHING WAS SAVED' IS VERIFIED, NOT ASSERTED",
   recorded at the `CSV_UPSTREAM_FAIL` entry — is what this fails.
2. A write that returns **no row** is not a write that did nothing. The
   allocation route says so itself: *"RLS ate the row, or the conflict target
   drifted"* — and "RLS ate the row" means the upsert **SUCCEEDED** and only the
   returning row was suppressed.

| # | Emitter (pre-fix line) | Failing operation | Verdict | Reason |
|---|---|---|---|---|
| 1 | `name/route.ts:208` | `strategies` UPDATE errored | **INDETERMINATE** | statement SENT; mechanism 1 |
| 2 | `ownership/route.ts:229` | portfolios SELECT (`pfErr`) | verified-zero | READ; nothing sent |
| 3 | `ownership/route.ts:255` | portfolio_strategies SELECT (`posErr`) | verified-zero | READ; nothing sent |
| 4 | `ownership/route.ts:303` | flip RPC errored | **INDETERMINATE** | the RPC **DELETES live positions** + sets the mark in one txn; mechanism 1 |
| 5 | `ownership/route.ts:318` | flip RPC returned no row | **INDETERMINATE** | route's own comment: *"leaves the counts unknown"*; mechanism 2 |
| 6 | `ownership/route.ts:366` | `strategies` UPDATE errored | **INDETERMINATE** | statement SENT; mechanism 1 |
| 7 | `allocation/route.ts:225` | strategies SELECT (`stratErr`) | verified-zero | READ; nothing sent |
| 8 | `allocation/route.ts:252` | POST `resolveRealPortfolio` (SELECT) | verified-zero | READ; nothing sent |
| 9 | `allocation/route.ts:294` | 23505 race re-select found nothing | **INDETERMINATE** | an INSERT into `portfolios` was SENT |
| 10 | `allocation/route.ts:305` | non-23505 provisioning INSERT failed | **INDETERMINATE** | INSERT SENT; mechanism 1 |
| 11 | `allocation/route.ts:314` | provisioning INSERT returned no row | **INDETERMINATE** | INSERT SENT; mechanism 2 |
| 12 | `allocation/route.ts:368` | `portfolio_strategies` upsert errored | **INDETERMINATE** | THE MONEY WRITE; mechanism 1 |
| 13 | `allocation/route.ts:380` | upsert returned zero rows | **INDETERMINATE** | mechanism 2, stated at the arm |
| 14 | `allocation/route.ts:444` | DELETE-verb `resolveRealPortfolio` (SELECT) | verified-zero | READ; nothing sent |
| 15 | `allocation/route.ts:466` | `portfolio_strategies` DELETE errored | **INDETERMINATE** | statement SENT; mechanism 1 |

**5 verified-zero-write · 10 indeterminate.** Per route: name 0/1,
ownership 2/3, allocation 3/6.

**One judgement call, stated because it is the only arm where the rule is not
self-evident** — rows 9/10/11, the container-provisioning arms. The *money*
write (the upsert) has not been reached there, so "nothing the user asked for
was saved" is arguably true. I classified them INDETERMINATE anyway: an INSERT
into `portfolios` **was** sent, and deciding that an orphaned empty container
"does not count" is exactly the kind of judgement about an unanswered statement
that the split exists to stop making. The rule stays mechanical. This is
recorded at the arms and in the route docblock.

**⚠️ This differs from the reviewer's sketch in two places**, both consequences
of applying the rule uniformly: the reviewer did not classify `name:208` (it is
structurally identical to `ownership:366`, so it takes the same verdict), and
the reviewer's text put `allocation`'s DELETE-arm 500s wholesale in the
indeterminate set while also listing "`resolved.kind === "error"` arms" as
verified-zero — those overlap at row 14. The rule resolves it: row 14 is a READ.

### What shipped

- **`DASHBOARD_WRITE_FAILED`** — sentence, `fix[]` and `clear_and_retry`
  **byte-identical**. Pinned by a hand-typed `toBe` oracle over title/cause/fix
  (never imported from the table).
- **`DASHBOARD_WRITE_INDETERMINATE`** — new union member + copy entry.
  `actions: ["leave_and_return", "expand_log"]` ⇒ `recoverable: false` ⇒ no
  Retry control. Copy claims persistence in **neither** direction and directs
  the user to reload and read current state.
- Union-member docblock honours the *"'NOTHING WAS SAVED' IS VERIFIED, NOT
  ASSERTED"* rule and the sibling unknowable-outcome member
  (`SEAM_RESPONSE_UNREADABLE`) explicitly, as required.
- `EXPECTED_TABLE_SIZE` **88 → 89 at both pins in the same commit**, each with
  its own re-run reasoning paragraph (destructive-class scan at one site,
  banned-claims scan at the other). Divergence guard green.
- New code added to **all three** `DASHBOARD_DIALOG_ROUTE_CODES` rosters;
  `dialog-envelope.invariant.test.ts` `checked` 16 → 19.

### Observed RED (each first-hand; each restored and re-verified green)

**NEUTER D1** — money-write zero-rows arm back to `DASHBOARD_WRITE_FAILED`:
```
× [161-CR-01] the upsert returning ZERO ROWS is INDETERMINATE — the write may have landed
AssertionError: 'RLS ate the row' means the upsert SUCCEEDED and the returning row was
suppressed. … expected 'DASHBOARD_WRITE_FAILED' to be 'DASHBOARD_WRITE_INDETERMINATE'
```

**NEUTER D2** — the new copy asserts a zero write again:
```
× INDETERMINATE claims persistence in NEITHER direction
AssertionError: the indeterminate entry asserts a zero write. No arm that reaches it
established one … expected 'We could not confirm whether that cha…' not to match /nothing was saved/i
```

**NEUTER D3** — an **UNHEDGED** persistence claim (`"Your change was saved."`),
exercising the structural hedge rule rather than a needle list:
```
× INDETERMINATE claims persistence in NEITHER direction
AssertionError: this entry states an outcome with no qualifier: "Your change was saved."
— a guess about a statement we never got an answer to, and the mirror image of the
defect the entry was minted to close.
```

**NEUTER D4** — `clear_and_retry` restored on the indeterminate entry. **RED at
BOTH layers**, which is the receipt that the DOM pin is real:
```
× INDETERMINATE offers NO Retry — a blind retry against a possibly-applied money write
AssertionError: … expected [ 'clear_and_retry', …(2) ] to not include 'clear_and_retry'
× [161-CR-01] the indeterminate arm renders NO Retry — a blind retry against a possibly-live allocation
AssertionError: a Retry rendered for a write whose outcome we could not read …
  expected <button …(4)></button> to be null
```

**NEUTER D5** — ownership flip-returned-no-row arm reverted. RED at the count
pin **and** the source-order pin:
```
× the FIVE internal-error arms split 2 / 3 on ONE question, and that is the decision
AssertionError: an arm was added to or removed from the verified-zero-write set …
  expected 3 to be 2
× SOURCE ORDER: the indeterminate arms are the ones downstream of the flip RPC and the UPDATE
AssertionError: expected [ 5273, 6842 ] to have a length of 3 but got 2
```

### ⚠️ A vacuous pin I wrote, caught by its own counterpart — worth reading

My first draft asserted "no Retry button renders" on **`MarkOwnershipDialog`**,
with the verified-zero arm as the counterpart. **The counterpart went RED**, and
the diagnosis matters: `ErrorEnvelope` gates the control on
`recoverable && Boolean(onRetry)`, and **`MarkOwnershipDialog` passes no
`onRetry` at all**. Measured: `grep -c onRetry` is `0` in
`MarkOwnershipDialog.tsx` and `RenameStrategyDialog.tsx`, and `4` in
`AllocateDialog.tsx`.

So no Retry renders on two of the three dialogs for **any** code, and a
`queryByRole(… /retry/i) === null` assertion there would have been green against
every possible implementation — trap (b) from the brief, landing on me.

Fixed by moving the behavioural pin to the surface where it is real
(`AllocateDialog`, which is also the money dialog) and recording the measurement
at `MarkOwnershipDialog.test.tsx` so the next author does not re-add it. A
second self-inflicted variant of the same trap: the Retry control's accessible
name is its `aria-label`, `"Retry"` — my first matcher (`/try again|try the last
action/i`) matched neither, so the positive control failed. Now matched exactly.

**Consequence worth flagging to phase verification:** `DASHBOARD_WRITE_FAILED`'s
`clear_and_retry` renders **no control at all** on the rename and ownership
dialogs today. Not a regression and not in this fix's scope, but it means the
recoverable/non-recoverable distinction is currently user-visible on **one** of
the three dashboard dialogs.

---

## CR-02 — the CSV per-row breakdown · commit `989c58ff`

### Measured first (the UI-SPEC is a proposal; the producer is ground truth)

Driving `validate_csv` at HEAD from `analytics-service/`:

| Case | Message emitted |
|---|---|
| dataframe-level (misnamed value column) | `Failed rule 'column_in_dataframe' at row 0.` |
| column-level violation | `Column 'daily_return' failed rule 'daily_return_lower_bound' at row 2.` |

### Half 1 — the producer stops interpolating the absent-row sentinel

Rows are **1-based** (`int(idx) + 1`), so `0` can only mean "no row". The row
clause is now omitted on exactly the terms 161-03 established for the column
clause. The sentinel **stays on the wire** (the typed shape is an int and
`_forwarded_pandera_rows` projects it) — it is the *interpolation* that goes.
Post-fix: `Failed rule 'column_in_dataframe'.`

### Half 2 — the formatter could not fire, and could not be repaired

`formatColumnInDataframeMessage`'s regex requires a literal `failed:`. Verified
against all three producer shapes (past and present): **zero matches**. The
`Column 'None' failed: daily_return` shape its docblock quoted is PANDERA's own
error text, which this producer does not forward — it builds its own sentence.

**Repair is impossible, not merely awkward.** It ran only for
`rule === "column_in_dataframe"`, and for that DATAFRAME-level check pandera
reports `column` as NaN — which is why 161-03 had to strip the literal `nan`.
**The expected column name is not on the wire**, so a fixed regex has nothing to
extract. Deleted with a tombstone; restoring the remedy needs D-161-02's
producer field.

### Half 3 — deleting it exposed a SECOND fabricator underneath

With the formatter gone, `column_in_dataframe` rows fall to the `<li>`'s own
`` `Row ${e.row}: ` `` prefix — which would have rendered
**`Row 0: Failed rule 'column_in_dataframe'.`**, re-introducing the invented
number one layer out. The prefix is now conditional on a real row (`e.row >= 1`;
a non-numeric or absent `row` also yields no prefix). This also removes a
pre-existing `Row 0:` on the `date_format_ambiguous` error, which carries the
same sentinel.

### Observed RED

**NEUTER C1** — producer re-interpolates the sentinel:
```
AssertionError: Failed rule 'column_in_dataframe' at row 0.
assert "Failed rule ...me' at row 0." == "Failed rule ...n_dataframe'."
AssertionError: the per-row breakdown printed a number for a failure that has no row:
  "Failed rule 'column_in_dataframe' at row 0."
```

**NEUTER C2** — renderer prefixes unconditionally (fixture carries the
**corrected** server sentence, so only the renderer's guard can satisfy it):
```
AssertionError: the panel prefixed a row number onto a failure that has no row — the
invented-number class this phase exists to close, one layer out from the invented
column name 161-03 removed: expected '1 row failed validationRule violated:…'
not to contain 'Row 0:'
```

**NEUTER C3** — the dead formatter restored in the module:
```
AssertionError: the formatter was restored in wizardErrors.ts. It cannot fire: this
producer's messages read "failed rule '<name>'" and its regex requires "failed:".
Restoring it needs D-161-02's producer field.
```

**Re-argued, not deleted:** the three `ISSUE-012` cases that exercised the
formatter on pandera's own text — an input this producer never emits — are
replaced by a tombstone recording *why* they proved nothing (the mirror image of
a test that cannot fail: one that passes about a code path no user reaches).
The label case survives. Counterparts kept so no pin is satisfiable by deletion:
`test_a_real_column_still_gets_its_column_clause`, and a new
`POSITIVE COUNTERPART: a REAL row still gets its 'Row N:' prefix` at **row 1**,
the value adjacent to the sentinel.

---

## WR-01 — `keyRouteFailureHeaders` · commit `84c097df`

**Two** defects, not one; the file's TRAP-3 section described a rule that
**neither** branch fully enforced.

1. **Seam branch** checked `Number.isFinite`, which admits a fraction.
   `parseRetryAfterSeconds` returns `Number(raw)` for the delta-seconds form, so
   a proxy-injected `Retry-After: 0.5` crossed the seam intact and was relayed
   verbatim onto **our own** response — rendered as "Try again in 0.5s".
   `Number.isInteger` **replaces** `Number.isFinite` (it subsumes it).
2. **Breaker branch** stamped `String(err.retryAfterS)` unconditionally.
   `CircuitOpenError`'s constructor rejects `< 0` and therefore **accepts `0`**,
   so `Retry-After: 0` — the exact value TRAP-3 forbids — was reachable. It now
   checks rather than inherits.

`CircuitOpenError` has carried `Number.isInteger` since 140.2-11 with the reason
quoted at the constructor: the value *"is forwarded as a `Retry-After` HEADER by
both seam clients"*. 161-06 created the second wire-forwarded value without
inheriting it.

Pins are **per route**, per this pair's standing convention (a law about the
shared helper cannot see a route that stopped calling it), with a different
fraction on each so a cross-wired fixture cannot pass both.

**NEUTER A** — seam branch back to `isFinite`, RED on **both** routes by name:
```
× [composite/add-key] a FRACTIONAL wait is not a delta-seconds …  expected '1.5' to be null
× [create-with-key] a FRACTIONAL wait is not a delta-seconds …    expected '0.5' to be null
```
**NEUTER B** — breaker branch unconditional:
```
AssertionError: The breaker branch must ENFORCE TRAP-3, not inherit it. `0` is not a
wait — it is an instruction to retry immediately.: expected '0' to be null
```
Anti-control (`CircuitOpenError(42)` still stamps `"42"`) stayed green
throughout, so the fix was not achieved by breaking the relay.

---

## WR-06 — `Mt5GatewayMisconfigured` docstring · commit `1cd46db3`

Prose-only in the file the change landed in. The class docstring claimed
`classify_exception` maps this type onto
`("permanent", MT5_GATEWAY_MISCONFIGURED_DETAIL)`; 161-02 changed that arm to
`curated_gateway_detail(exc)` — an allow-list read — making the generic constant
the **degradation target**, not the return value.

Pin is **anchored on the live sink** (a curated cause is asserted to survive
`classify_exception` intact) so the docstring cannot be "fixed" into naming a
function the worker does not call. Needles are compared on collapsed whitespace,
guarded for length, and both directions are asserted.

```
AssertionError: the docstring does not name the sink 161-02 actually wired: …
assert '``("permanent", curated_gateway_detail(exc))``' in 'Operator fault: …'
```
Restored byte-identical (`shasum -a 256` match); 24 passed.

---

## ⚠️ Two self-inflicted incidents, reported because "completed" is wrong if anything was lost silently

### 1. A blanket `git checkout --` destroyed my own uncommitted work

Mid-CR-02, restoring a neuter, I ran `git checkout -- src/lib/wizardErrors.ts`
— the exact move the brief prohibits and that two executors already hit this
phase. It discarded the uncommitted formatter deletion and the `CSV_RULE_LABELS`
comment. Caught immediately (`grep -c` returned 0 for my marker), both edits
re-applied by hand from the exact text, re-verified (tsc + both suites) before
the commit. Nothing committed was affected and no other file was touched.

### 2. A snapshot-filename collision clobbered a route file

Snapshotting four files for the CR-01 neuters, I used `$(basename "$f")` as the
keep name — and **three of the four are called `route.ts`**, so one keep file
held the last writer's content. Restoring "allocation/route.ts" from it wrote
the **name route's** content into the allocation route (both 11 043 bytes, which
is why the `shasum` equality check I ran read as a success).

Detected by reading the file rather than trusting the checksum. Recovered by
`git show HEAD:<path>` (the working copy was already destroyed, so nothing could
be lost) and re-applying all seven CR-01 edits from the recorded substitutions;
the arm classification was then re-verified by grep (3 `FAILED` / 6
`INDETERMINATE`, matching the docblock) and by the full suite.

**Lesson for the next executor, stated plainly:** a `shasum` match between a file
and the snapshot you just restored from proves the *copy* succeeded, not that the
snapshot was the *right file*. Use path-unique keep names.

---

## Deviations and declined items

1. **[Rule 3 — declined] Vercel plugin hook recommendations.** `vercel-functions`
   flagged "polling logic in a serverless handler" at pre-existing lines in three
   **test** files (`create-with-key/route.test.ts:2667`,
   `composite/add-key/route.test.ts:1163`), and `react-best-practices` /
   `next-cache-components` fired on test-file edits. All are pre-existing code
   this work does not own. Declined, consistent with 161-05 / 161-06 / 161-08.
2. **[Found by the repo's own law] Bare `file:line` citations converted.** The
   full suite reddened `seam-citations.invariant.test.ts`: my
   `` `wizardErrors.ts:2470` `` citations are the coordinate-goes-stale class the
   law exists to close (*"this milestone was bitten by that eight times"*).
   Converted all six to symbol-anchored references (the *"'NOTHING WAS SAVED' IS
   VERIFIED, NOT ASSERTED"* rule **at the `CSV_UPSTREAM_FAIL` entry**). Note the
   review and the orchestrator decision both use the bare coordinate; the law
   wins.
3. **Out of scope by instruction, untouched:** WR-02, WR-03, WR-04, WR-05 and
   all four Info items. Nothing was widened into them.

---

## Notes the phase verification needs

1. **CR-01 changes a WIRE CONTRACT on three routes.** Ten arms that answered
   `code: "DASHBOARD_WRITE_FAILED"` now answer
   `code: "DASHBOARD_WRITE_INDETERMINATE"`. **Every `error` sentence, status and
   header is byte-identical**, and all three dialogs recognise the new code
   through the roster — but any consumer outside `src/` keying on the old code
   for a 500 would see a token it does not know. Measured: the three dialogs are
   the only code-channel consumers of these routes.
2. **A rolling deploy shows the OLD code briefly.** An old client against a new
   server renders `UNKNOWN` for these arms until the client catches up — the same
   transient 161-10 accepted and asserted for its prose retirement. It is
   strictly better than the pre-fix behaviour (a false sentence).
3. **`clear_and_retry` renders no control on two of the three dashboard
   dialogs** (they pass no `onRetry`). Measured, recorded at
   `MarkOwnershipDialog.test.tsx`, not fixed — outside CR-01's scope, but it
   means the recoverable/non-recoverable split is user-visible on
   `AllocateDialog` only.
4. **CR-02's producer change is user-visible copy** on the phase's headline CSV
   case. The rendered `<li>` for a dataframe-level failure is now
   `Failed rule 'column_in_dataframe'.` with no row prefix, under the human label
   *"Your CSV is missing a required column"*. It is still **not actionable** —
   the user is not told which column — and that is D-161-02, deliberately not
   closed here.
5. **`formatColumnInDataframeMessage` is deleted from the public surface of
   `src/lib/wizardErrors.ts`.** Only `CsvValidationEnvelope.tsx` imported it.
6. **`EXPECTED_TABLE_SIZE` is at 89.** Re-measure at HEAD before moving it again.
7. **`src/lib/wizardErrors.test.ts` still carries its NUL byte** (count 1,
   re-asserted after every write). Every edit to it went through a Node `latin1`
   byte-preserving round-trip; the `Edit` tool was deliberately not used, and new
   UTF-8 content was inserted as **raw bytes reinterpreted as latin1** (a plain
   UTF-8 string written through a latin1 buffer mangles em dashes and emoji —
   this bit once and was caught and redone).
8. **`npm run test` took 175 s** this run (161-10 recorded 280 s). `[B25]` did
   not bite.

---

_Fixed: 2026-08-25_
_Fixer: Claude (gsd-code-fixer)_
_Source: `161-REVIEW.md` + its ORCHESTRATOR DECISION_
