# Phase 161 — deferred items

Out-of-scope discoveries made during execution. Logged, NOT fixed (executor scope boundary).

---

## D-161-01 — the `first_rule.upper()` CSV code family is invisible to the derived vocabulary

**Found during:** 161-03 Task 1 (full-suite run, `seam-venue-vocabulary.invariant.test.ts`).

`services/ingestion/csv_adapter.py` sets `error_code=first_rule.upper()` on a CSV
rejection, so EVERY pandera rule name is a real wire code (`COLUMN_IN_DATAFRAME`,
`MONOTONIC_DATES`, `DAILY_RETURN_LOWER_BOUND`, …). The seam vocabulary law derives its
population from **literals** in the Python tree, so a computed code is invisible: none of
the family is in `derived`, none has a row in `VENUE_WIRE_CODE_TO_VERDICT`, and none has a
reasoned exemption. They fall through the substring cascade to whatever an English sentence
earns — the exact defect class that law exists to catch.

This predates 161-03; `src/lib/wizardErrors.ts`'s `CSV_VALIDATION_FAILED` docblock already
records it as its third measured reason ("THE CODE IS A RULE NAME"). 161-03 only made it
visible, by adding a test fixture that names one member of the family.

**Why not fixed here:** closing it means either enumerating the rule family as literals at
the adapter (so the scanner sees them) or giving the family one disposition — a vocabulary
decision, not a copy fix, and outside WIZERR-12/13's scope.

---

## D-161-02 — `formatColumnInDataframeMessage` matches a shape this producer has never emitted

**Found during:** 161-03 Task 1.

`src/lib/wizardErrors.ts:3898` matches `/Column\s+'[^']*'\s+failed:\s+(\S+)/` — "Column 'x'
failed: daily_return". `csv_validator.py` emits "Column 'x' failed rule 'y' at row N." and
always has. The regex therefore never matches and every `column_in_dataframe` row falls
through to the raw message.

Consequence after 161-03's nan-guard: the user is told *that* a required column is missing
(via `CSV_RULE_LABELS.column_in_dataframe`) but not *which* one. The name lives only in
pandera's `failure_case`, which T-161-07 forbids forwarding.

**Why not fixed here:** recovering the column name needs a producer-side change (carry the
expected column as a first-class field beside `rule`/`row`/`message`, never via
`failure_case`), plus a client change. Both are outside WIZERR-13's stated behaviour.

---

## D-161-03 — the column-less message still renders "at row 0"

**Found during:** 161-03 Task 1.

For a dataframe-level check there is no row, and `csv_validator.py` reports the absent index
as `0` (its existing sentinel). The 161-UI-SPEC's approved copy for this case is
`"Failed rule '{rule_name}' at row {row_idx}."`, so the shipped sentence reads "Failed rule
'column_in_dataframe' at row 0." — a row number for a failure that has no row.

**Why not fixed here:** 161-UI-SPEC § Copy Spec WIZERR-13 is the binding copy contract and
states this sentence explicitly. Changing it is a UI-SPEC amendment, and improvising against
an approved contract is the failure mode this phase's discipline exists to prevent. Raised
for the phase owner.

---

## D-161-04 — `contracts-registry` B25 times out under full-suite load (flake, not a regression)

**Found during:** 161-04 wave gate.

`src/__tests__/contracts/contracts-registry.test.ts > [B25] eslint-plugin-quantalyze wiring
integrity > resolves every quantalyze rule to "error" for a representative src file` failed
`Error: Test timed out in 5000ms` on the first full-suite run of this plan, and PASSED on an
immediate second full-suite run of the identical tree (788 passed / 0 failed). Standalone it
runs in 3.72s — i.e. inside a 5s budget with ~1.2s of headroom, while the full suite reports
51s transform / 351s setup across workers.

**Why it is not 161-04's:** the test resolves ESLint rule severities for a representative src
file; this plan changed one component callback, its comments, and one test file, and added no
lint config. The failure mode is a hard 5s `testTimeout` on a test that boots ESLint, under
parallel load.

**Why not fixed here:** raising a timeout in a contract file is out of this plan's scope
(executor SCOPE BOUNDARY) and the honest fix is a decision about that file's budget, not a
number to nudge mid-phase. Suggested: give the B25 case an explicit per-test timeout so a
loaded machine cannot redden a green tree. Recorded so the next full-suite red on this name is
recognised as this, and not silently re-diagnosed.

---

## D-161-05-A — no manager-facing surface can release an ORPHANED api_key

**Found during:** 161-05 Task 1, while checking that `KEY_ORPHANED`'s remedy can succeed.

161-UI-SPEC § WIZERR-03's first fix bullet was *"Disconnect the unused key under Manage keys,
then connect it here again."* Measured at HEAD, that remedy is **unwinnable for the user who
sees this code**:

- the literal string `Manage keys` occurs **nowhere** in `src`;
- `src/components/strategy/ApiKeyManager.tsx` (the component that does carry a key delete) is
  mounted at `src/app/(dashboard)/strategies/[id]/edit/page.tsx` and nowhere else — a
  **per-strategy** surface. `KEY_ORPHANED` exists precisely because no strategy holds the key,
  so there is no edit page to reach;
- the only other list with a Disconnect control (`AllocatorExchangeManager`, profile →
  Exchanges, which calls `disconnect_allocator_api_key` and would work) sits behind
  `allocatorOnly` in `src/components/auth/ProfileTabs.tsx`. The user in the strategy wizard is
  a manager;
- `my-strategies` **does** surface the orphan (`getStrategylessActiveKeys` → the "No strategy
  yet" placeholder row in `StrategyTable.tsx`), but its only control is **"Finish setup →"**,
  which reopens the same wizard and lands on the same refusal.

**What 161-05 shipped instead:** the copy names only remedies that were measured to be
reachable — connect a different account, or email us to release the stored key. That keeps the
requirement's own remedy-can-succeed property true, and the divergence from the UI-SPEC bullet
is argued at the copy entry and pinned by a test (`names no key-management surface this arm
cannot reach`).

**Why not fixed here:** giving managers a key-release affordance is a new surface — a UI-SPEC
amendment plus a route, not a copy edit — and well outside this plan's declared file scope.
Until it exists, `KEY_ORPHANED`'s second bullet routes to us on purpose.

---

## D-161-05-B — an orphaned MT5 connect waits out the full 120 s validate before the refusal

**Found during:** 161-05 Task 2.

`resolveByVenueIdentity` now answers `orphaned` at the **pre-RPC** fence too, but that arm
deliberately does **not** short-circuit — unlike `draft` and `connected`, which return before
the charged seam calls. The reason is ordering honesty: the credentials in the request are
still unauthenticated at that point, so if the secret is wrong the user's real first problem is
the secret, and refusing early would hand them the orphan to chase while a bad credential sat
unmentioned. The refusal is made in the 23505 arm instead, after `validateKey`.

**The cost is real:** this fence only runs when `venueAccountId` is non-null, which today is
**mt5 only**, and MT5's validate budget is 120 000 ms. So an orphaned MT5 user can wait out a
full validation to be told something the server knew from rows it had already read.

**Why not fixed here:** the two orderings trade one honesty property against a latency one, and
picking the other side is a product call, not an executor call. The decision and its cost are
recorded at the fence in `create-with-key/route.ts` and pinned by the test
`the PRE-RPC fence lets the orphan through to validate — the credentials speak first`, so
reversing it is a deliberate act with a failing test attached.

---

## D-161-07-A — the wizard COMPOSITE arm still renders the provenance sentence for an EXAMINED verdict

**Found during:** 161-07 Task 1 (measured while reading the FIX-3 arm).

The composite arm decides admissibility with `isDailyReturnsSourced` and, when it refuses,
hardcodes `GATE_SERIES_PROVENANCE_UNVERIFIED` — for **every** inadmissible verdict, including
the two in the examined-but-refused map. After Task 2, the admin path and the wizard SINGLE-KEY
arm answer `sampled_gapped` with "The return series is built from sampled balance snapshots
with interior gaps…", while the composite arm still answers it with "…nothing on our side
recorded how that series was built."

**That sentence is FALSE on that arm for that verdict.** Something did record it: the stitch job
downgrades a composite to `sampled_gapped` when any member carried a measured coverage hole
(142.2 FIX 2), so the composite arm's own dedicated test
(`REFUSES a composite carrying a verdict the gate does not trust`) pins the false rendering.

**Reachability:** real, not theoretical — that FIX-2 downgrade is the documented path.
`fill_derived_unproven` is NOT reachable on this arm (the stitch deliberately does not inherit
member unprovenness), so the exposure is the `sampled_gapped` composite only.

**Why not fixed here:** 161-07's Task 1 behaviour list explicitly holds this arm at
`GATE_SERIES_PROVENANCE_UNVERIFIED` for inadmissible verdicts, and Task 2's declared file scope
excludes `SyncPreviewStep.tsx`. Closing it means re-cutting an existing 142.2 oracle — the kind
of deliberate act this phase performs with a plan behind it (cf. the D-15 re-cut), not as an
executor's aside. The fix is small: route the composite arm's refusal through the same
examined/unexamined split rather than a literal, then re-point that one pinned expectation.

## D-161-07-B — `vercel-functions` validator flags line 601 of `admin/strategy-review/route.test.ts`

**Found during:** 161-07 Task 3 (tooling hook fired on an unrelated region of the file I edited).

The plugin reports "Long-running or polling logic detected in a serverless handler" at
`route.test.ts:601`. That line is inside a **vitest mock**, not a handler, and predates this
plan. Recorded rather than acted on: out of scope per the executor's scope boundary, and acting
on it would mean editing test code this plan has no reason to touch.
