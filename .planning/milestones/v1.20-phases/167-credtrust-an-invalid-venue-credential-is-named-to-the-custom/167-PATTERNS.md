# Phase 167: CREDTRUST — Pattern Map

**Mapped:** 2026-09-22
**Mapped at HEAD:** `c57a13f0` on branch `feat/167-credtrust`
**Files analyzed:** 14 new-or-modified artifacts (from `167-CONTEXT.md` D-01…D-15, `167-RESEARCH.md`, `167-UI-SPEC.md` S1/S2)
**Analogs found:** 12 exact or role-match / 14 — 2 honest absences, both named below

⛔ **Every path in this document was checked with `git ls-files` and is TRACKED source.** No
gitignored install/runtime mirror appears here.
⛔ **Cited BY SYMBOL, never by line number** (`[164.7-CITATION-DRIFT-01]` — line numbers in this
repo rot within a commit). Where a number appears it is a MEASURED pin value, re-grepped at the
HEAD above, with the grep that produced it written out so the planner re-runs it rather than
trusting it.
⛔ **No venue key, MT5 account number, broker server name, strategy name or key identifier appears
here.** Placeholders only.

---

## File Classification

| New/Modified file | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `src/lib/wizardErrors.ts` — new `WizardErrorCode` union member + `WIZARD_ERROR_COPY` entry + `VENUE_WIRE_CODE_TO_VERDICT` row + a new `FixRequirement` constant | config / closed-set registry | request-response (cross-language) | **the same file at commit `3e0eff65`** (164.5.4 plan 02, minting `KEY_MUST_BE_RECONNECTED`) | **exact** |
| `src/lib/wizardErrors.test.ts` — two `EXPECTED_TABLE_SIZE` pins + behavioural cases | test (census pin) | — | **the same file at commit `092a4227`** | **exact** |
| `src/lib/seam-venue-vocabulary.invariant.test.ts` — `EXPECTED_EMITTED_CODES` row + `DERIVED_FLOOR` | test (derived-population census) | — | its own `MT5_VALIDATE_INVARIANT_VIOLATION` / `CURSOR_UNAVAILABLE` arrival entries | **exact** |
| `src/lib/dialog-envelope.invariant.test.ts` — roster non-vacuity pin | test (census pin) | — | **the same file at commit `3e0eff65`** (`31` → `32`) | **exact** |
| `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` — `KNOWN_CREATE_WITH_KEY_CODES` row | component (roster) | request-response | **the same roster at commit `3e0eff65`** | **exact** |
| `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` — `KNOWN_ADD_KEY_CODES` row | component (roster) | request-response | **the same roster at commit `3e0eff65`** | **exact** |
| `analytics-service/routers/exchange.py` — new wire code at a `validate_key` transient arm | route / emitter | request-response | the MT5 `Mt5ClientError` → `classify_mt5_login_error` transient arm in the same file | **exact** |
| `analytics-service/services/exchange.py` (or `services/closed_sets.py`) — new `*_DETAIL` copy constant | config (copy constant) | — | `NETWORK_ERROR_DETAIL` / `AUTH_FAILED_DETAIL` (`services/exchange.py`); `MT5_WRONG_SERVER_DETAIL` (`services/closed_sets.py`) | **exact** |
| `analytics-service/docs/STATUS_CONTRACT.md` — §7 row `S-27` + §2.1 raise-site entry | documentation (contract ledger) | — | rows `S-25` / `S-26` and the file's own `## 8. How to add a new error site` | **exact** |
| `src/components/exchanges/AllocatorSyncStatus.tsx` — a new authored helper constant + one branch in the helper-resolution chain | component | request-response (renders a server-read status) | **`REVOKED_HELPER` and the `normalized === "revoked"` branch in the same file** | **exact** |
| `src/components/exchanges/AllocatorSyncStatus.test.tsx` — char-for-char locked-copy case | test | — | the `renders 'Key revoked' + helper …` case in the same file | **exact** |
| `analytics-service/services/allocator_positions.py` — make the retry PROMISE a function of the classifier verdict (D-09/D-10) | service | event-driven (job failure arm) | the **two** `if _must_reach_handler_unwrapped(exc): raise` guards in `fetch_allocator_holdings` | **role-match, with a measured gap — see Pattern Assignment 9** |
| `analytics-service/tests/test_allocator_positions.py` — a D-10 equivalence test | test | — | `test_..._wrap_iff_classifier_would_retry` (the EQUIVALENCE ORACLE, parametrized over `exc_factory`) | **exact** |
| `supabase/migrations/2026…_api_keys_sync_status_*.sql` — **ONLY under D-11 arm B** | migration | batch / DDL | `supabase/migrations/20260420073003_allocator_holdings.sql` STEP 5 + its self-verifying DO block arm `(h)` | **exact** |
| A new `sync_status` write boundary in a STRATEGY-level pipeline (`run_sync_trades_job` / the ledger fan-out) | service | event-driven | the `except Exception` arm in `run_poll_allocator_positions_job` (`analytics-service/services/job_worker.py`) | **role-match — see `## No Analog Found` for what it does NOT cover** |

---

## Pattern Assignment 1 — THE PRIMARY ANALOG, enumerated exhaustively

### `src/lib/wizardErrors.ts` + its five census siblings (config, cross-language request-response)

**Analog: Phase 164.5.4 plan 02** — `.planning/phases/164.5.4-mt5recon-gap-the-mt5-backfill-path-and-the-login-error-class/164.5.4-02-PLAN.md` and `…-02-SUMMARY.md`.
**Realised as three task commits: `3e0eff65` (feat) → `092a4227` (test) → `290cce4e` (fix).**

#### Every file it touched, in commit order, with its measured diffstat

| # | Commit | File | ± | What moved |
|---|---|---|---|---|
| 1 | `3e0eff65` | `src/lib/wizardErrors.ts` | +178 / −20 | union member + docblock; `WIZARD_ERROR_COPY` entry; `VENUE_WIRE_CODE_TO_VERDICT` row; **DELETED** the wire code's `VENUE_WIRE_CODES_WITHOUT_VERDICT` exemption; a `DASHBOARD_DIALOG_ROUTE_CODES` roster row |
| 2 | `3e0eff65` | `…/wizard/steps/ConnectKeyStep.tsx` | +20 | `KNOWN_CREATE_WITH_KEY_CODES` gains the member |
| 3 | `3e0eff65` | `…/wizard/steps/MultiKeyConnectStep.tsx` | +10 | `KNOWN_ADD_KEY_CODES` gains the member |
| 4 | `3e0eff65` | `src/lib/dialog-envelope.invariant.test.ts` | +10 / −2 | roster non-vacuity pin `expect(checked).toBe(31)` → `32` |
| 5 | `092a4227` | `src/lib/wizardErrors.test.ts` | +189 / −2 | **both** `EXPECTED_TABLE_SIZE` pins `93` → `94`, each with its OWN re-run argument; 4 behavioural cases |
| 6 | `290cce4e` | `src/app/api/keys/[id]/rotate-secret/route.ts` | +40 / −10 | the RESIDUAL comment rewritten as a record of the shipped mechanism |
| 7 | `290cce4e` | `src/app/api/keys/[id]/rotate-secret/route.test.ts` | +74 | one end-to-end route case, added to the EXISTING harness |

#### ⭐ THE PINS THE PLAN NAMED vs. THE PINS RUNNING THE TESTS FOUND

This is the single most transferable fact in the analog, and its own SUMMARY states it:

> *"The plan named two census sites (`EXPECTED_TABLE_SIZE` ×2). The mint actually moved FOUR."*
> *"The two pins the plan named would have gone green while three other gates stayed red. Clearing
> the named subset would have read as a complete fix."*

| Pin | Discoverable by READING the plan? | Discoverable only by RUNNING? | Gate that reds |
|---|---|---|---|
| `EXPECTED_TABLE_SIZE` site A (destructive-action scan) | ✅ named | — | `[140.3-10 / TRAP-4]` in `wizardErrors.test.ts` |
| `EXPECTED_TABLE_SIZE` site B (banned-claims honesty scan) | ✅ named | — | `[140.3-12 / SEAMUX-04]` in `wizardErrors.test.ts` |
| `expect(checked).toBe(N)` in `dialog-envelope.invariant.test.ts` | ❌ | ⛔ **RUN-ONLY** | `[161-10 / WIZERR-07]` |
| `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) | ❌ | ⛔ **RUN-ONLY** | `[153.7 review W-153.7-1]` in `wizardErrors.invariant.test.ts` — reds **BY NAME** |
| `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) | ❌ | ⛔ **RUN-ONLY** | same gate, same run |
| `EXPECTED_EMITTED_CODES` (`seam-venue-vocabulary.invariant.test.ts`) | needed **NO** edit in the analog | — | *"minting a TypeScript member adds no Python emitter"* — **⚠️ THIS DOES NOT TRANSFER TO 167, see below** |
| disjointness (`no code is BOTH mapped and exempt`) | auto-green | — | `seam-venue-vocabulary.invariant.test.ts` |

**Instruction for the planner, in the analog's own words:** do not enumerate the touch points in
the plan text and treat that enumeration as complete. Task the executor to run **all six** gate
files and read **every** failure:

```
npx vitest run src/lib/wizardErrors.test.ts src/lib/wizardErrors.invariant.test.ts \
  src/lib/wizardErrors.roster-render.test.tsx src/lib/dialog-envelope.invariant.test.ts \
  src/lib/seam-venue-vocabulary.invariant.test.ts src/lib/envelope.test.ts
```

The analog's own verification scope, reported green and exit 0, was
`npx vitest run src/lib/ src/app/api/keys/`.

#### ⛔ THE ONE PLACE 167 IS **BIGGER** THAN ITS ANALOG — two pins the analog never touched

164.5.4-02 routed an **existing** Python wire code onto a **new** TypeScript member, so it added no
Python emitter and `EXPECTED_EMITTED_CODES` stayed still. **Phase 167 cannot do that.**
`VENUE_WIRE_CODE_TO_VERDICT` is a `ReadonlyMap` keyed on the wire code, one verdict per key, and
the wire code the transient arm emits today is already spoken for by `KEY_NETWORK_TIMEOUT`. So
routing a credential-suspected SUBSET onto a new verdict requires a **new Python-emitted wire
code** — which moves two further pins in `src/lib/seam-venue-vocabulary.invariant.test.ts`:

| Pin | Measured value at HEAD | Grep that produced it | Behaviour on a new Python code |
|---|---|---|---|
| `EXPECTED_EMITTED_CODES` | **41 members** | `python3` count over the array body (⛔ counted by script, never by eye) | **REDS BY NAME** — the assertion is `expect([...derived].sort()).toEqual([...EXPECTED_EMITTED_CODES].sort())`, sorted arrays so the failure names what moved |
| `DERIVED_FLOOR` | **24** | `grep -an 'const DERIVED_FLOOR' src/lib/seam-venue-vocabulary.invariant.test.ts` | ⚠️ **DOES NOT RED.** The comparison is `toBeGreaterThanOrEqual`. But the file's own stated rule is `floor(0.6 × N)`, and `floor(0.6 × 42) = 25` — so the rule says move it 24 → 25 and **nothing enforces that** |

⛔ **`DERIVED_FLOOR` is a CONVENTION pin, not a GATE pin, and the drift is already live.** Measured
at HEAD: the roster holds **41** members while the floor's own lineage prose says *"0.6 × 40
measured codes = 24.0"*. A 41st arrival landed without the prose moving; the floor value survives
only because `floor(0.6 × 41)` is still 24. There is **no ratchet test anywhere in `src/`** that
asserts `DERIVED_FLOOR === floor(0.6 × EXPECTED_EMITTED_CODES.length)` (measured: zero references
to the symbol outside its own file and the same-named constant in `wizardErrors.invariant.test.ts`).
This is the `mutation-runner-floors.test.ts` stale-low direction with no second layer. **Move the
floor in the same commit as the roster row, and say in the plan that no gate will tell you if you
forget.**

#### ⛔ GREP THE PINS — the values, and the exact commands

```
grep -an 'const EXPECTED_TABLE_SIZE' src/lib/wizardErrors.test.ts
#  → TWO declarations, both currently 94
grep -an 'expect(checked).toBe(' src/lib/dialog-envelope.invariant.test.ts
#  → two hits; the ROSTER pin is the one in [161-10 / WIZERR-07], currently 32
grep -an 'const DERIVED_FLOOR' src/lib/seam-venue-vocabulary.invariant.test.ts   # → 24
```

⚠️ `wizardErrors.test.ts` carries a **third, self-referential** assertion
(`[153.1-04 / WIZFORM-02] the two EXPECTED_TABLE_SIZE pins cannot silently diverge`) that reads the
pins back out of the source with `/const EXPECTED_TABLE_SIZE = (\d+);/g` and asserts exactly two
declarations that AGREE. Moving one and not the other reds there, not at the pin.
⛔ The repo's own dated defect class applies: a blanket N→N+1 across this corpus kills deliberate
mismatch calibrations. Each pin moves **with its own re-run argument** — the analog's two sites
front *different scans* and got *different arguments* (destructive-action membership vs. the
four-fragment banned-claims walk), and that discipline is the point, not the integers.

#### ⚠️ Floors that will NOT red and must NOT be "fixed" blindly

Measured at HEAD, all three are `toBeGreaterThanOrEqual`, so an addition passes them silently:

- `EXPECTED_POPULATION_MIN = 78` — `src/lib/wizardErrors.roster-render.test.tsx`
- `DERIVED_FLOOR = 36` — `src/lib/wizardErrors.invariant.test.ts`
- `DERIVED_FLOOR = 24` — `src/lib/seam-venue-vocabulary.invariant.test.ts` (the one above, whose
  own rule says to move it anyway)

Exact-value pins that will NOT move for this phase, measured: `EXPECTED_DIALOG_COUNT = 4`,
`EXPECTED_FINALIZE_REJECTION_SITES = 32`, `EXPECTED_FORMAT_EMITTERS_PER_ROUTE = 1`.

#### The code to copy — the mint, verbatim from `3e0eff65`

**(a) The union member.** A docblock naming WHERE IT COMES FROM, then a `⛔ NOT <member>` paragraph
per near-miss member explaining why reuse would close nothing, then the non-recoverability
derivation:

```typescript
  // 164.5.4-02 / D-03 — THE STORED CREDENTIAL CANNOT BE READ BACK, so no
  // action taken against that stored copy can succeed until it is replaced.
  //
  // WHERE IT COMES FROM. `analytics-service`'s `rotate_key_secret` … raises wire
  // `KEY_UNDECRYPTABLE` — 500, `retryable=False`, detail *"…"* …
  //
  // ⛔ NOT `KEY_PROBE_FAILED`, the nearest member by subject. Its `actions`
  // carry `clear_and_retry`, so `buildEnvelope` derives `recoverable: true` and
  // a Retry renders … Offering that retry IS the defect this member closes, so
  // reusing the member that renders it would close nothing.
  // ⛔ NOT `SEAM_MISCONFIGURED`. …
  // ⛔ NOT `SEAM_INTERNAL_FAULT` (… the closest PRECEDENT for the SHAPE of this
  // entry rather than for its subject). …
  //
  // NOT recoverable, DERIVED rather than declared: `actions` below carries
  // neither member of `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so
  // `buildEnvelope` derives `recoverable: false` and `ErrorEnvelope` renders NO
  // Retry control …
  | "KEY_MUST_BE_RECONNECTED"
```

⭐ For 167 the `⛔ NOT` paragraphs are **already written for you** — `167-CONTEXT.md` D-07 and
`167-UI-SPEC.md` §2's constraint table give the three: not `KEY_MUST_BE_RECONNECTED` (right action
shape, wrong cause — asserts a fault on OUR side of the store), not `KEY_AUTH_FAILED` (asserts the
exchange rejected the credentials, which the classifier refuses to assert on this arm), not
`KEY_NETWORK_TIMEOUT` (different verb, different noun, different claim).

**(b) The copy entry** — preceded by a `⚠️ WHAT THIS COPY MAY CLAIM, read at the emitter rather
than assumed` block and a `⛔ AND WHAT IT MAY NOT CLAIM, because the copy table is shared and the
row routing to it is keyed on a WIRE code, not on a route` block:

```typescript
  KEY_MUST_BE_RECONNECTED: {
    title: "We can no longer read this stored key.",
    cause: "…",
    fix: [ "…", "…", "…" ],
    docsHref: "/security",
    // ⛔ NEITHER member of `RECOVERABLE_ACTIONS` (`clear_and_retry`,
    // `try_another_key`, src/lib/envelope.ts) … THE ABSENCE IS THE WHOLE POINT
    // of this entry … ⚠️ Neither is a member of the destructive class either
    // (`start_fresh` alone) …
    actions: ["request_call", "expand_log"],
  },
```

⛔ **D-07 / Pitfall 3: copy the SHAPE, not one word of the text.** The 167 copy is fully authored in
`167-UI-SPEC.md` § Copywriting Contract §2 and must be used verbatim from there.

**(c) The routing row**, with the `⭐ WHY THE ROW IS NOT OPTIONAL BESIDE THE MINT` paragraph —
the mechanism claim, and it was MEASURED by neuter, not asserted:

```typescript
  ["KEY_UNDECRYPTABLE", { code: "KEY_MUST_BE_RECONNECTED", status: 500 }],
```

> *"the function above resolves this table BEFORE its substring cascade, and that cascade has no
> decrypt branch at all, so a minted member with no row here is unreachable and the founder still
> lands on `UNKNOWN`. The row is the ROUTING MECHANISM, not an alternative to the mint."*

**Status discipline:** *"Status 500 on the row, matching the emitter's own status, per the table's
stated discipline that the wire answer stays the one the service chose."* For 167 the transient arm
emits **424**, so the row carries `status: 424` unless the plan changes the emitter's status —
which would be a separate, argued decision.

**(d) The roster rows.** Both carry a comment stating **why the line survives a reader who measures
that this route cannot emit the code** — the analog's own anti-deletion device:

```typescript
    // ⚠️ WHETHER THIS ROUTE'S OWN SEAM CAN RAISE THAT WIRE CODE IS NOT WHAT
    // THIS ROSTER TURNS ON, and saying so here stops the next reader deleting
    // the line after measuring that it cannot. The set's contract is "every
    // verdict `classifyKeyValidationError` can RETURN" …
    "KEY_MUST_BE_RECONNECTED",
```

**(e) Anti-vacuity.** Three neuters, each observed RED, each restored from a `cp` byte backup
verified with `cmp` **and** a sha256 match. ⛔ No `git checkout --`, no `git restore`, no
`git stash`. The three for 167 map one-to-one: add a `RECOVERABLE_ACTIONS` member to the new entry
(expect `recoverable` to flip true); delete the `VENUE_WIRE_CODE_TO_VERDICT` row (expect the
UNKNOWN terminal); remove the wire code at its Python emission site. Each new case also carries a
**non-vacuity control** — the same human sentence with NO wire code still lands on UNKNOWN, so it
is the ROW that moved the verdict and not a reworded cascade.

#### The `SyncPreviewStep.tsx` third roster — the corrected pointer

`167-CONTEXT.md`'s `<canonical_refs>` already carries the orchestrator's correction, and it is
right. Measured at HEAD:

- `ConnectKeyStep.tsx` → `KNOWN_CREATE_WITH_KEY_CODES: ReadonlySet<WizardErrorCode>`
- `MultiKeyConnectStep.tsx` → `KNOWN_ADD_KEY_CODES: ReadonlySet<WizardErrorCode>`
- `SyncPreviewStep.tsx` → `KNOWN_KICKOFF_CODES: Readonly<Record<string, WizardErrorCode>>` — a
  **wire-code-keyed Record** governing post-connect JOB KICKOFF, a different failure surface from
  connect-time validate.

The two rosters the analog's gate reddened are the first two. `KNOWN_KICKOFF_CODES` is in scope
**only if** the new wire code can be emitted at kickoff time — a question the plan answers by
grepping the new code's emission sites in `analytics-service/routers/`, not by assumption
(`167-RESEARCH.md` A3 rates this MEDIUM risk and leaves it open).

---

## Pattern Assignment 2 — the new `FixRequirement` constant (no MT5 one exists)

### `src/lib/wizardErrors.ts` — `fixRequires` machinery

**Measured at HEAD:** `grep -an 'kind: "venueIs"' src/lib/wizardErrors.ts` returns **two** hits —
the type declaration and `REQUIRES_DERIBIT`. **There is no MT5 `FixRequirement` constant.**
`167-UI-SPEC.md` §2 requires `fixRequires[1] = { kind: "venueIs", venue: "mt5" }`, so one must be
minted.

**Analog — `REQUIRES_DERIBIT`, and its docblock is the template:**

```typescript
/**
 * "Render only on Deribit" — 161-05 / WIZERR-11's one user.
 *
 * ⚠️ ITS ONE BULLET IS A NAMING CLARIFICATION AND NOTHING ELSE. The generic
 * "re-copy both values" instruction stays UNCONDITIONAL one slot above it, so a
 * user on any venue — or on none we were told about — still gets a complete,
 * actionable remedy. Suppressing this bullet removes a Deribit-specific label,
 * never the instruction, which is what makes the strict absence rule safe here.
 */
const REQUIRES_DERIBIT: FixRequirement = { kind: "venueIs", venue: "deribit" };
```

⭐ **That final sentence is exactly the argument `167-UI-SPEC.md` §3 move 2 makes** ("an absent
venue SUPPRESSES that bullet … fail toward saying less"), so the new constant's docblock writes
itself from the spec.

**Analog for the parallel array — `KEY_AUTH_FAILED` carries `fixRequires: [null, null,
REQUIRES_DERIBIT, null]`; `DRAFT_ALREADY_EXISTS` is the four-slot exemplar mixing
`NOT_ON_PRESELECT_SURFACE` and `REQUIRES_PRESELECT_SURFACE`.** The UI-SPEC's
`surfaceIsNot: "preselect"` slot is `NOT_ON_PRESELECT_SURFACE`, which already exists — reuse it,
do not mint a second.

**The pin this creates:** `WizardErrorCopy`'s own docblock states the rule and names the gate —
*"`wizardErrors.test.ts` sweeps every tagged entry for `fixRequires.length === fix.length`. Add a
bullet, add its slot."* Four `fix` bullets ⇒ four `fixRequires` slots.

⛔ **`fix` stays `string[]`.** `buildEnvelope` forwards it VERBATIM as `debug_context` and
`WizardErrorEnvelope.test.tsx` compares against it; turning a bullet into an object has a blast
radius this phase has not scoped.

---

## Pattern Assignment 3 — the non-recoverability derivation (D-08)

### `src/lib/envelope.ts` → `src/components/error/ErrorEnvelope.tsx`

The whole chain, measured at HEAD, three symbols:

```typescript
// src/lib/envelope.ts
const RECOVERABLE_ACTIONS: ReadonlySet<WizardErrorAction> = new Set([
  "clear_and_retry",
  "try_another_key",
]);
// … inside buildEnvelope:
recoverable: copy.actions.some((a) => RECOVERABLE_ACTIONS.has(a)),
```

```typescript
// src/components/error/ErrorEnvelope.tsx
const showRetry = envelope.recoverable && Boolean(onRetry);
```

⛔ **Non-recoverability is DERIVED, never asserted** — the analog's own
`patterns-established` line. The plan must not add a `recoverable: false` field to the copy entry
and must not add a per-route branch; it omits both `RECOVERABLE_ACTIONS` members from `actions` and
pins the result **through `buildEnvelope`**, never by reading `actions` back.

---

## Pattern Assignment 4 — the Python emission site (route, request-response)

### `analytics-service/routers/exchange.py` — `validate_key`

**Analog: the `except Mt5ClientError` arm in the same function.** Measured shape, verbatim:

```python
        except Mt5ClientError as e:
            # Classify via the ONE mt5_validation seam. NEVER log the interpolated
            # remote text (it can carry the scrubbed code only) and never
            # login/pw/server values.
            kind = classify_mt5_login_error(e)
            if kind == "auth":
                trace.outcome = "auth"
                raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
            if kind == "wrong_server":
                trace.outcome = "wrong_server"
                raise HTTPException(status_code=400, detail=MT5_WRONG_SERVER_DETAIL)
            # transient -> fail CLOSED with the shared NETWORK detail …
            logger.warning(
                "validate_key: MT5 transient upstream failure (code=%s)", e.code
            )
            trace.outcome = "transient"
            raise VenueTransientHTTPException(
                status_code=424,
                code="NETWORK_UNAVAILABLE",
                detail=NETWORK_ERROR_DETAIL,
                recoverable=True,
            )
```

**This is the arm D-05/D-07 target.** The new code is a sibling `raise` on the transient path, with
a new `code=` and a new `detail=`. Measured: `code="NETWORK_UNAVAILABLE"` appears at **ten** raise
sites in this file — a plan that changes the shared constant instead of adding a narrowed sibling
arm would re-route nine unrelated failures. ⛔ **Add an arm; do not reword the shared constant.**

**The procedure is written down and must be followed** —
`analytics-service/docs/STATUS_CONTRACT.md` `## 8. How to add a new error site`. This is a **3b
(FLAT) site**: a 4xx with no `dependency`, consumed by a seam that classifies by SUBSTRING over
`err.detail`. Its three non-negotiable rules, and step 5:

> *"`detail` must be **byte-identical** to the copy the site already emitted (it is the classifier's
> live input — a reword changes behaviour), `code` is carried **verbatim from the producer with no
> route-minted default**, and the site names **no `dependency`**."*
> *"4. Write the test with **literal** expected values — never import the expected status or code
> from `error_contract`. … For a 3b site also assert the **exact key set** of the wire body: a
> `set(body) == {"detail","code","recoverable"}` assertion is what catches a fall-through to the
> default `HTTPException` handler."*
> *"5. Add the row to §7 — and for a 3b site, to §2.1's raise-site list as well."*

⚠️ Rows `S-25` and `S-26` are the two most recent §7 additions and are the row template. The next
id is `S-27`. **No automated gate reads `STATUS_CONTRACT.md`** (measured: every reference to it
under `src/` and `analytics-service/` is prose or a comment, none reads the file). It is a
convention, so it is missed silently — name it as an explicit plan task.

---

## Pattern Assignment 5 — the new Python detail constant (config)

### `analytics-service/services/exchange.py` (or `services/closed_sets.py`)

**Analog — `AUTH_FAILED_DETAIL`, whose docblock states the cross-language contract:**

```python
# The single source of truth for the key-authentication-failure detail string.
# The Next.js `classifyKeyValidationError` (src/lib/wizardErrors.ts) maps any
# detail whose lowercase form includes "authentication failed" to
# KEY_AUTH_FAILED. Both the ccxt AUTH_FAILED arm below and the non-ccxt sFOX
# branch in routers/exchange.py reuse THIS constant so the cross-language
# contract cannot drift from one site (a reword here must update the TS matcher).
AUTH_FAILED_DETAIL = "Authentication failed. Check your API key and secret."
```

⛔ **THE SUBSTRING-COLLISION RULE, and it is load-bearing.** `services/closed_sets.py`'s MT5 detail
block states it explicitly:

> *"… collide with NONE. Any reword MUST re-run that collision check before landing — a stray
> `"rate"`/`"trading"`/`"timeout"` substring would silently mis-classify the MT5 failure."*

The named needles it lists are `"ip"+"allow"`, `"rate"`, `"429"`, `"timeout"`, `"could not
verify"`, `"permission scope"`, `"probe"`, `"trading"`, `"withdraw"`. **The new detail string must
be swept against the live substring cascade in `classifyKeyValidationError` before it lands** —
this matters more for 167 than for the analog, because the wire code carries a
`VENUE_WIRE_CODE_TO_VERDICT` row that resolves BEFORE the cascade, so a collision would be latent
until the row was ever removed or the code reached a cascade-only consumer.

**Related closed set, measured:** `PERMANENT_VALIDATION_ERROR_CODES` in `services/exchange.py` is a
five-member `frozenset` and is what `routers/portfolio.py` and `routers/exchange.py`'s ccxt arm
derive `recoverable=` from. The MT5 arms **hardcode `recoverable=True`** instead. The plan must
decide, and record, whether the new code joins that set — noting D-05: the browser's Retry is
derived from the TS `actions`, **not** from the wire `recoverable` flag, so the two can disagree
and the disagreement is invisible on screen.

---

## Pattern Assignment 6 — the authored owner-surface helper (component, request-response)

### `src/components/exchanges/AllocatorSyncStatus.tsx`

**Analog: `REVOKED_HELPER` and the `revoked` branch in the SAME file.** This is the shipped
precedent for exactly the shape `167-UI-SPEC.md` S1 calls for — an authored constant that **ignores
`syncError`**.

**The LOCKED-copy convention, verbatim:**

```typescript
// LOCKED pill colour map — do NOT deviate.
// `idle`/`syncing`/`complete` are neutral; `complete_with_warnings`/
// `rate_limited` are amber; `revoked`/`error` are red. No positive colour is
// used here — positive is reserved for future status states.
const PILL_STYLES: Record<string, { bg: string; text: string }> = { … };

// LOCKED helper copy — note the terminating period.
const REVOKED_HELPER = "Re-add a read-only key from your exchange.";

const ELLIPSIS = "…"; // U+2026 — NOT three dots.
const EM_DASH = "—";  // U+2014 — NOT a hyphen-minus.
```

**The helper-resolution chain, verbatim — this is the code the new branch joins:**

```typescript
  // Helper text resolution order:
  //   1. helperOverride — explicit manager-side override wins over all.
  //   2. status-specific computed text per the locked copy table.
  //   3. Queued surface when syncing + queuedNextAttemptAt >= 30s out.
  //   4. neutral empty string — aria-live stays silent.
  let helperText = "";
  if (helperOverride !== null && helperOverride !== undefined && helperOverride.length > 0) {
    helperText = helperOverride;
  } else if (normalized === "revoked") {
    helperText = REVOKED_HELPER;                 // ← AUTHORED, ignores syncError
  } else if (normalized === "rate_limited") {
    helperText = `${exchangeDisplayName(exchange)} cooldown remaining`;
  } else if (normalized === "error" || normalized === "complete_with_warnings") {
    helperText = syncError ?? "";                // ← THE DEFECT: raw DB string, verbatim
  } else if (normalized === "syncing") { … }
```

⚠️ **Chain-order consequences the planner must state in the plan, because they are silent:**

1. **`helperOverride` wins over everything.** It is set client-side by `AllocatorExchangeManager`'s
   add/sync failure handlers (`helperOverride={key.helper_override}` at the call site). The
   UI-SPEC's 9-state `optimistic` cell already forbids rendering the credential sentence
   optimistically — the chain enforces that for free, but only as long as the new branch is placed
   **below** the override, never above.
2. **Under D-11 arm C the `error` branch is NARROWED, not replaced.** Every non-credential failure
   must keep rendering the curated `sync_error` exactly as today.
3. **`PILL_STYLES`' unknown-key fallback is `idle` — a NEUTRAL pill.** Measured:
   `const normalized = (rawKey in PILL_STYLES ? rawKey : "idle")`. Under D-11 arm B a new
   `sync_status` value that reaches the browser before `PILL_STYLES` has a row renders a broken key
   as **healthy**. ⛔ The style map and the migration land in the SAME commit.

**The forward-compat comment already names the analog migration** — *"The 066 migration adds
`revoked` + `rate_limited`"* — i.e. `20260420073003`, which is Pattern Assignment 8.

### `src/components/exchanges/AllocatorSyncStatus.test.tsx` — the char-for-char pin

**Analog case, verbatim (this is the whole shape of a new one):**

```typescript
  it("renders 'Key revoked' + helper 'Re-add a read-only key from your exchange.'", () => {
    render(<AllocatorSyncStatus syncStatus="revoked" syncError={null} lastSyncAt={null} exchange="binance" />);
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Key revoked");
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe("Re-add a read-only key from your exchange.");
    // aria-live contract: helper line is the announcement channel.
    expect(helper).toHaveAttribute("role", "status");
    expect(helper).toHaveAttribute("aria-live", "polite");
  });
```

⭐ **The `syncError` non-vacuity control is already in this file and must be copied:** the override
case asserts `expect(helper.textContent).not.toContain("Re-add a read-only key")`. The 167
equivalent is the assertion that proves the new helper **ignores** `syncError` — render the new
state **with a non-empty `syncError`** and assert the helper is the authored constant, not the DB
string. Without that control the new case cannot fail the way the defect fails.

⚠️ The file's header states it *"Verifies the D-08 LOCKED copy table character-for-character (U+2026
ellipsis …)"*. Assertions use `—` / `…` **escapes**, not literal glyphs. The UI-SPEC's
helper string contains a U+2014 — compose it through the file's existing `EM_DASH` constant in the
source and assert with `—` in the test.

---

## Pattern Assignment 7 — the retry-promise copy family (service, event-driven)

### `analytics-service/services/allocator_positions.py` — D-09 / D-10

⭐ **A PRECEDENT EXISTS, and it is only HALF applied. That gap IS the phase's Python work.**

**The analog, verbatim — `fetch_allocator_holdings`'s two ccxt arms:**

```python
    try:
        spot_rows = await _fetch_spot_rows(exchange_name, exchange)
    except Exception as exc:  # noqa: BLE001
        if _must_reach_handler_unwrapped(exc):
            raise
        logger.warning(
            "fetch_allocator_holdings: spot-side read failed for %s (%s) — "
            "surfacing end-user copy (AUM-02)", exchange_name, type(exc).__name__, exc_info=True,
        )
        raise AllocatorHoldingsSyncTransientError(
            SPOT_FETCH_FAILED_NOTE.format(venue=_venue_display(exchange_name))
        ) from exc
```

`_must_reach_handler_unwrapped` is the consultation of the authority:

```python
def _must_reach_handler_unwrapped(exc: Exception) -> bool:
    """…
    1. **``job_worker.classify_exception`` calls it PERMANENT.** That function
       — not this module, and not ``_map_exception_to_sync_status`` below — is
       THE AUTHORITY on retry disposition, so it is CONSULTED here rather than
       mirrored. A hand-copied allow-list is what broke this …
       … under the copy "sync will retry automatically" — a promise that
       cannot be kept. …
    2. **``ccxt.RateLimitExceeded``** …
    ``services.job_worker`` is imported INSIDE the function … the import graph
    stays acyclic … A failure to classify … returns False, so the caller falls
    back to fixed end-user copy. …"""
```

**⛔ THE MEASURED GAP — `grep -an '_must_reach_handler_unwrapped' analytics-service/services/allocator_positions.py`
returns exactly TWO call sites, and BOTH are in the ccxt path.** The MT5 and sFOX arms raise their
retry-promising note **unconditionally**:

| Arm | Exception caught | Note raised | Guarded by the classifier? |
|---|---|---|---|
| MT5 read timeout | `asyncio.TimeoutError` | `MT5_UNREACHABLE_NOTE` | ❌ no |
| MT5 abandoned-session fence | `Mt5SessionAbandoned` | `MT5_UNREACHABLE_NOTE` | ❌ no |
| MT5 account mismatch | `Mt5AccountMismatchError` | `MT5_UNREACHABLE_NOTE` | ❌ no |
| **MT5 client error** | `Mt5ClientError` | `MT5_UNREACHABLE_NOTE` | ❌ no — **this is the measured wrong-password path** |
| MT5 missing account ref | (guard) | `MT5_MISSING_ACCOUNT_REF_NOTE` | ❌ no |
| sFOX balances | `SfoxApiError` / `asyncio.TimeoutError` | `SFOX_FETCH_FAILED_NOTE` | ❌ no |
| ccxt spot | `Exception` | `SPOT_FETCH_FAILED_NOTE` | ✅ **yes** |
| ccxt derivative | `Exception` | `DERIVATIVE_FETCH_FAILED_NOTE` | ✅ **yes** |

**So the pattern to copy is literally the two-line guard `if _must_reach_handler_unwrapped(exc):
raise`, placed ahead of the note in each unguarded arm** — same symbol, same module, already
imported, already unit-tested.

⚠️ **And the write-boundary table is ALREADY honest and must NOT be swept up in the change:**

```python
SYNC_ERROR_COPY_BY_STATUS: dict[str, str] = {
    "revoked": "{venue} rejected these API credentials — reconnect the key to resume syncing.",
    "rate_limited": "{venue} is rate-limiting us — sync will retry automatically.",
    # Deliberately promises nothing about retrying: this arm covers both a
    # permanent failure (the job will NOT retry) and a retryable one, and the
    # one thing true in both is what the allocator is looking at right now.
    "error": "Couldn't sync holdings from {venue} — the balances shown are from the last successful sync.",
}
```

⛔ The `rate_limited` promise is **legitimate** (rate limits are transient by construction) — D-09's
Pitfall 2 names it. Touching it would be a new dishonesty.

### `analytics-service/tests/test_allocator_positions.py` — the D-10 test analog

**The EQUIVALENCE ORACLE is already written for the ccxt arms and is the exact shape for the MT5 /
sFOX ones.** Its docblock states the oracle rule:

> *"The oracle is the EQUIVALENCE, not a list: whatever `classify_exception` calls permanent must
> arrive at the handler unwrapped; everything else must arrive as fixed copy. Stated that way the
> test cannot go stale when the classifier grows a family."*

and its body derives the expectation from the authority rather than hard-coding a set:

```python
    kind, _ = classify_exception(expected)
    must_be_unwrapped = kind == "permanent" or isinstance(expected, ccxt.RateLimitExceeded)
    …
    if must_be_unwrapped:
        with pytest.raises(Exception) as caught:  # noqa: PT011 - identity asserted
            await fetch_allocator_holdings("binance", exchange)
        assert caught.value is expected, (
            f"{kind!r} failure was swallowed into {type(caught.value).__name__} …")
        return
    …
    assert str(wrapped.value) == ("Couldn't read balances from Binance — sync will retry automatically.")
    assert wrapped.value.__cause__ is expected
```

⚠️ **The `exc_factory` params use REAL venue `str()` bodies, not synthetic ones** — *"`is_geo_blocked`
is SIGNATURE-based, so a synthetic message would test nothing."* The MT5/sFOX equivalents must use
the real exception shapes those arms actually catch.
⚠️ Run from `analytics-service/` only — a repo-root pytest misses cassettes and makes LIVE broker
calls.

---

## Pattern Assignment 8 — the `sync_status` CHECK widening (migration, DDL) — **D-11 ARM B ONLY**

### Analog: `supabase/migrations/20260420073003_allocator_holdings.sql`

**The widening, verbatim (STEP 5):**

```sql
-- D-07: add 'revoked' and 'rate_limited' to the existing 6-value set.
-- Migration 007 line 66 ships the original 6 values. No migration in between
-- touched this CHECK (verified via grep), so DROP+ADD is safe.
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_sync_status_check
  CHECK (sync_status IN (
    'idle','syncing','computing','complete','complete_with_warnings',
    'error','revoked','rate_limited'
  ));
```

⭐ **The comment's `"No migration in between touched this CHECK (verified via grep)"` is part of the
pattern, not decoration.** The 167 migration re-runs that grep at HEAD and records the answer,
because a DROP+ADD that re-types a stale value list silently removes whatever was added since.

**The self-verifying DO block arm, verbatim — this is what makes the migration fail loud:**

```sql
  -- ---- (h) api_keys_sync_status_check accepts revoked + rate_limited ----
  SELECT pg_get_constraintdef(oid) INTO v_sync_status_def
    FROM pg_constraint WHERE conname = 'api_keys_sync_status_check';
  IF v_sync_status_def IS NULL
     OR v_sync_status_def NOT LIKE '%revoked%'
     OR v_sync_status_def NOT LIKE '%rate_limited%' THEN
    RAISE EXCEPTION 'Migration 066 failed: api_keys_sync_status_check missing revoked/rate_limited. Got: %',
      COALESCE(v_sync_status_def, '<null>');
  END IF;
```

**The same migration also shows the GRANT half** that a new user-visible column would need:
`GRANT SELECT (sync_error) ON api_keys TO authenticated;` — a column-level grant extending the
migration-027 allow-list, with the reason recorded inline.

### ⛔ What arm A's `revoked` FILTER actually costs — MEASURED, and it is wider than CONTEXT.md says

`167-CONTEXT.md` D-11 arm A names `HoldingsTable` and "both ledger-refresh enqueuers". Measured at
HEAD, `IS DISTINCT FROM 'revoked'` appears in **eight** tracked migration files:

`20260420073003_allocator_holdings.sql` · `20260422101911_api_keys_disconnected_at.sql` ·
`20260717233529_allocator_equity_derived_surface.sql` · `20260825130000_ledger_refresh_fanout_dormant.sql` ·
`20260825140000_ledger_refresh_composite_arm.sql` · `20260907130000_ledger_refresh_switch_to_system_flags.sql` ·
`20260911130000_ledger_fanout_grantees_and_dormancy.sql` · `20260917120000_ledger_fanout_admit_private.sql`

plus **two Python services** (`services/allocator_equity_derive.py`,
`services/equity_reconstruction.py` — the latter in prose describing a sibling-count exclusion) and
the TypeScript readers (`src/lib/queries.ts`'s connected-key predicate
`key.is_active && key.sync_status !== "revoked" && key.disconnected_at == null`;
`HoldingsTable.tsx` ×4 uses; `OpenPositionsTable.tsx`; `AllocationDashboardV2.tsx`).

⇒ **Arm A is not "cheapest by far"; it is the arm with the largest measured blast radius, and every
one of those sites changes meaning silently.** The plan should cost it against this list, not
against the two sites CONTEXT.md names.

---

## Pattern Assignment 9 — the owner-lane / public-cache boundary (D-04)

### `src/app/factsheet/[id]/v2/page.tsx`

**The lane split, verbatim:**

```typescript
  // ⛔ The owner arm calls the builder DIRECTLY: no cache read, no cache write.
  // It cannot route through `buildFactsheetPayloadCached` — the effective
  // unstable_cache key is id-ONLY (header comment), so an owner-built payload
  // would be served to every subsequent reader of this id, anonymous ones
  // included, for the full 3600s TTL. …
  const payload =
    lane === "owner"
      ? await fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))
      : await buildFactsheetPayloadCached(`${id}::${computedAt}`);
```

and the wrapper's unrepresentability device:

```typescript
  // ⛔ This wrapper takes NO visibility parameter, and the predicate below is a
  // LITERAL, never a variable. … Keeping the parameter off the signature makes
  // that unrepresentable: a caller cannot pass one, and the literal cannot be
  // reached by a caller at all.
  return unstable_cache(
    async () => fetchAndBuildPayload(id, withPublishedOnly), …
```

### ⛔ CORRECTION the planner needs — the existing guard does NOT cover a new payload field

`167-RESEARCH.md`'s Validation Architecture row for D-04 says *"existing guard — verify it still
covers any new field."* **Measured: it does not, and cannot.**
`src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` is a **structural source-text** guard.
Its own docblock enumerates what it pins:

1. `unstable_cache(` occurs **exactly once** in `page.tsx`;
2. that call's callback body names `withPublishedOnly` as a **LITERAL** and never
   `withPublishedOrOwner`;
3. `buildFactsheetPayloadCached`'s declaration head carries no `visibility` /
   `StrategyVisibility` token;
4. repo-wide module pins: only `page.tsx` may mention `buildFactsheetPayloadCached`; exactly one
   production file may DECLARE `function fetchAndBuildPayload`, and every other file naming it must
   carry the canonical import specifier;
5. `generateMetadata` never contains `withPublishedOrOwner`;
6. `export const dynamic = "force-dynamic"` survives;
7. anti-vacuity: the extractor really found a cache call with a non-empty callback body.

**None of those is a field-level assertion over `FactsheetPayload`.** So if Phase 167 ever adds a
credential-cause field to the payload type, this guard stays green while the field is cached by id
and served to anonymous readers. ⇒ **the honest plan action is: do not add the field (D-04's
intent), and if a `checkpoint:decision` ever approves one, a NEW field-level guard is owed.** The
existing guard's own comment-stripping discipline (page.tsx's prose names both predicates, so a
bare grep would self-invalidate assertions 2 and 4) is the template for writing that new one.

---

## Shared Patterns

### A. Census moves are found by MEASUREMENT, never by counting
**Source:** `164.5.4-02-SUMMARY.md` → `patterns-established`.
**Apply to:** every plan touching `src/lib/wizardErrors.ts`.
> *"Census moves are found by MEASUREMENT, not by counting: the mint reddened FOUR independent
> pins, only TWO of which the plan named."*
> *"Each census pin carries a re-run of ITS OWN scan's reasoning before its integer moves."*

⭐ **And the integer itself is READ OFF THE GUARD'S FAILURE MESSAGE** (`expected 94 to be 93`),
never counted off the table and never derived from `Object.keys(...)` — *"an expectation built by
reading the subject is an oracle that cannot fail."*

### B. Anti-vacuity by neuter, restored from a byte backup
**Source:** `164.5.4-02-SUMMARY.md` → "Anti-vacuity — three neuters".
**Apply to:** every behavioural test this phase adds.
Every restore was `cp` from a byte backup, verified with `cmp` **and** a sha256 match.
⛔ No `git checkout --`, no `git restore`, no `git stash` — the repo's dated destructive-edit class.
⚠️ Re-take the byte backup after every edit; a stale backup makes `cmp` pass on a corrupt restore.

### C. Locked-verbatim copy is EXTENDED, never reworded in passing
**Source:** `AllocatorSyncStatus.tsx`'s `// LOCKED …` comments + `AllocatorSyncStatus.test.tsx`'s
char-for-char cases; `wizardErrors.ts`'s *"Code IDs are STABLE — renaming breaks PostHog
`wizard_error { code }` events."*
**Apply to:** S1 and S2 both. Under **D-11 arm A** the helper change is a **reword of a locked
constant** (`REVOKED_HELPER`), not an extension — `167-UI-SPEC.md`'s Arm Variance table already
flags it as the costliest copy cell and requires the char-for-char pins to move in the same commit.

### D. An end-user copy constant is authored, never a raw exception string
**Source:** `allocator_positions.py`'s `AUM-02` block.
> *"Anything this module returns as a `warning` … lands in `api_keys.sync_error` and is rendered
> VERBATIM in the browser by AllocatorSyncStatus — there is no frontend translation layer. … ONE
> sentence, `{what happened} — {what happens next or what to do}`, joined by a U+2014 em dash, no
> jargon, and NEVER a Python type/method name or a raw exception string. The PROD defect this
> replaces was literally `'<Type>' object has no attribute '<method>'` shown to a user."*
**Apply to:** every Python string this phase writes, and to the TS side's mirror decision (the
authored helper that ignores `syncError`).

### E. Cross-language detail strings are substring-swept before landing
**Source:** `services/closed_sets.py`'s MT5 detail block; `services/exchange.py`'s
`AUTH_FAILED_DETAIL` docblock.
**Apply to:** the new Python `*_DETAIL` constant (Pattern Assignment 5).

### F. Three reviewers before any migration apply
**Source:** standing repo rule, restated at D-13.
**Apply to:** D-11 arm B only — `migration-reviewer` + `rls-policy-auditor` +
`silent-failure-hunter`, findings fixed, **then** ask.
⚠️ `supabase/migrations/**` auto-applies to TEST first and then PROD on merge; a data-reading `DO`
block that `RAISE EXCEPTION`s on an unexpected count can apply to PROD and REFUSE on TEST, and a
failed TEST apply blocks the PROD apply. The recorded interim remedy is to REVERT THE MERGE — never
to edit `supabase-migrate.yml`.

---

## No Analog Found

| Artifact | Role | Data flow | Verdict |
|---|---|---|---|
| **A `sync_status` write boundary in a STRATEGY-level pipeline** (`run_sync_trades_job`, or the ledger fan-out's failure path) | service | event-driven | ⛔ **NONE EXISTS.** `167-RESEARCH.md`'s exhaustive grep of `services/job_worker.py` finds every `sync_status` write inside `run_poll_allocator_positions_job` and nowhere else. The `except Exception` arm there (`status_target = _map_exception_to_sync_status(exc)` → `human_copy = sync_error_copy(status_target, venue)` → one `api_keys` UPDATE) is a **shape** analog, but it is scoped to `compute_jobs.kind='poll_allocator_positions'`, has a ccxt-typed classifier that the MT5/ledger paths do not raise into, and sits inside a handler with a different lifecycle. A plan that copies it must state which `compute_jobs.kind` it applies to and must not assume the ccxt type table transfers. |
| **A SECURITY DEFINER, OWNER-SCOPED wrapper over `ledger_refresh_staleness`** (needed only if D-03 conjunct (a) is consumed from an `authenticated` lane) | migration / RPC | request-response | ⚠️ **PARTIAL ONLY.** `supabase/migrations/20260719140000_get_published_trust_signals.sql` is the nearest shipped SECDEF precedent (`LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE`, `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon, authenticated, service_role`, column allow-list enforced structurally by `RETURNS TABLE`). **But it is PUBLIC-gated** — published-strategies-only, no ownership check. No measured in-repo precedent exists for the `s.user_id = auth.uid()` conjunct an owner-scoped equivalent needs. If this path is taken the plan is INVENTING, and should say so. ⚠️ D-12's two named traps (SECDEF-inside-an-RLS-policy needs `anon EXECUTE` or reads go silently empty; delete-guards must exempt `sanitize_user`) apply to the **RLS-embedded** call shape; a directly-invoked RPC from an authenticated Server Component may reach neither. Decide the call shape before assuming both. |
| **Cross-run consecutive-failure tracking for an `api_key`** (the D-10 "has REPEATED while the refresh was demonstrably running" half of the D-03 conjunction) | model / schema | batch | ⛔ **NONE FOUND** — recorded as an ABSENCE, not as a design decision. `167-RESEARCH.md` A4 searched `compute_jobs` for `attempt_count` / `consecutive_fail` / `retry_count` / `fail_count` and found only the per-row `attempts`/`max_attempts` pair, which the queue resets on each new recurring-job row. Recommended first planning-time step if the chosen D-11 arm depends on it: `git log -p --all -S consecutive_fail` plus a fresh schema grep. |

⭐ **And one NEAR-absence, stated precisely because a stretched analogy here would mislead:**
`167`'s brief asked whether any precedent exists in `analytics-service/` for end-user copy that
**branches on** `classify_exception`. The honest answer is: **there is a precedent for the
CONTROL-FLOW shape (`if _must_reach_handler_unwrapped(exc): raise` ahead of the note — two sites,
both ccxt), and there is NO precedent for a single string template whose TEXT is selected by the
verdict.** No dict keyed on `"permanent"` / `"transient"` exists in the copy path. If the plan wants
verdict-selected wording rather than verdict-gated control flow, it is inventing — and the module's
own `SYNC_ERROR_COPY_BY_STATUS` docblock argues against it: the copy is derived from *"the
`sync_status` they are about to write and … the venue — the two things they legitimately know — so
there is no parameter through which an exception string can travel."*

---

## Metadata

**Analog search scope:** `src/lib/`, `src/components/exchanges/`, `src/components/error/`,
`src/app/(dashboard)/strategies/new/wizard/steps/`, `src/app/(dashboard)/allocations/components/`,
`src/app/factsheet/[id]/v2/`, `src/app/api/keys/[id]/`, `src/__tests__/`,
`analytics-service/services/`, `analytics-service/routers/`, `analytics-service/tests/`,
`analytics-service/docs/`, `supabase/migrations/`, and
`.planning/phases/164.5.4-…/` (plan 02 plan + summary + the three realised commits).

**Read this session (each file or range read ONCE):** `164.5.4-02-SUMMARY.md` (full);
`git show` for `3e0eff65` / `092a4227` / `290cce4e`; `src/lib/wizardErrors.ts` (union docblock,
copy entry, verdict row, exemption removal, dialog roster, `FixRequirement` constants,
`WizardErrorCopy` interface, `DRAFT_ALREADY_EXISTS`); `src/lib/envelope.ts` (`RECOVERABLE_ACTIONS`,
`buildEnvelope`); `src/lib/seam-venue-vocabulary.invariant.test.ts` (`EXPECTED_EMITTED_CODES`,
`DERIVED_FLOOR`, the three assertions); `src/lib/wizardErrors.test.ts` (both pins + the
self-referential regex); `src/lib/dialog-envelope.invariant.test.ts` (roster pin);
`src/lib/wizardErrors.invariant.test.ts` + `wizardErrors.roster-render.test.tsx` (floor symbols
only); `src/components/exchanges/AllocatorSyncStatus.tsx` (full) + its test (revoked / error /
override cases); `src/app/factsheet/[id]/v2/page.tsx` (cache wrapper + lane branch);
`src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (docblock);
`analytics-service/services/allocator_positions.py` (copy family, `_must_reach_handler_unwrapped`,
`_map_exception_to_sync_status`, `SYNC_ERROR_COPY_BY_STATUS`, the two guarded ccxt arms, the
unguarded MT5/sFOX arms); `analytics-service/routers/exchange.py` (the `Mt5ClientError` arm);
`analytics-service/services/exchange.py` (detail constants, `PERMANENT_VALIDATION_ERROR_CODES`);
`analytics-service/services/closed_sets.py` (MT5 details + the collision rule);
`analytics-service/docs/STATUS_CONTRACT.md` (§7 tail + §8);
`analytics-service/tests/test_allocator_positions.py` (the equivalence oracle);
`supabase/migrations/20260420073003_allocator_holdings.sql` (STEP 5 + DO-block arm (h)).

**Tracked-source gate:** every path named above was verified with `git ls-files`; all 25 checked
paths returned non-empty. No gitignored mirror path appears in this document.

**Pattern extraction date:** 2026-09-22
**Re-verify by:** ~2026-10-06. Every pin value here is bound to HEAD `c57a13f0`; re-grep rather
than trust, per `[164.7-CITATION-DRIFT-01]`.

---

*Phase: 167-CREDTRUST*
