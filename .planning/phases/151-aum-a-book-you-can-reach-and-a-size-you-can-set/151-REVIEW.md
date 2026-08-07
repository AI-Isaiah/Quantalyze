---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
reviewed: 2026-08-07T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/closed_sets.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/mt5_client.py
  - analytics-service/services/mt5_concurrency.py
  - analytics-service/tests/test_allocator_positions_non_ccxt.py
  - analytics-service/tests/test_allocator_positions.py
  - analytics-service/tests/test_mt5_concurrency.py
  - analytics-service/tests/test_mt5_sync_path.py
  - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/hooks/useScenarioState.ts
  - src/app/(dashboard)/allocations/lib/scenario-state.ts
  - src/app/api/allocator/scenario/commit/route.ts
  - src/lib/queries.ts
  - src/__tests__/phase-149-my-strategies-parity.test.ts
findings:
  critical: 3
  warning: 8
  info: 9
  total: 20
status: issues_found
---

# Phase 151: Code Review Report

**Reviewed:** 2026-08-07
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Reviewed the Phase 151 delta (`0402eca9..HEAD`) across the MT5 lock extraction, the
non-ccxt holdings dispatch, the SSR book-gate split, the Portfolio AUM input, and the
per-strategy dollar input. The extraction (`mt5_concurrency.py`) is clean and its
identity-based tests are the right oracle. The venue dispatch is correctly keyed on the
venue string and the `NON_CCXT_VENUES` AST drift-gate is genuinely falsifiable. The
48 targeted Python tests pass locally.

Three defects rise to BLOCKER:

1. The phase's **headline flow** — blank mode + a manually-set AUM + commit — is
   structurally impossible to complete for any allocator who has live holdings. The
   blank draft's `init_holdings_fingerprint` is the empty string, which the commit RPC's
   optimistic-concurrency precondition reads as "zero holdings" and rejects with a 409
   whose remedy copy ("Refresh to load the latest holdings") does nothing. Pre-151 the
   AUM-zero refusal short-circuited this path; AUM-01 unlocks it into a dead end.
2. The split book-entry gate was repointed at **three of six** consumers. In the exact
   partial-book configuration the phase enables, a saved book scenario reopens in BLANK
   mode and persists EMPTY membership.
3. `allocator_positions.fetch_allocator_holdings` still stamps a raw Python exception
   string into the user-visible `api_keys.sync_error` on the ccxt derivative arm — the
   precise defect class the module's own new docstring declares impossible.

Warnings cluster on money-math edge behaviour (blur-without-edit silently mutates both
the AUM and the weight vector), MT5 extraction strictness, and an unbounded
venue-controlled string reaching a verbatim-rendered user column.

## Structural Findings (fallow)

No `<structural_findings>` block was supplied for this review.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Blank-mode commit with a manual AUM is permanently rejected 409 — the phase's headline flow is a dead end

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3942`, `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx:551-561`, `supabase/migrations/20260601120000_commit_scenario_batch_fingerprint_precondition.sql:240-262`

**Issue:**
In blank mode `holdingsSummary` is `[]` (`ScenarioComposer.tsx:915-918`), so the working
draft is `defaultDraftFromHoldings([])` and its
`init_holdings_fingerprint === computeHoldingsFingerprint([]) === ""`.

`handleCommit` freezes that value:
```ts
setCommitFingerprint(scenario.draft.init_holdings_fingerprint);   // "" in blank mode
```
The drawer forwards it because the guard is `!== null`, not truthiness:
```ts
...(initHoldingsFingerprint !== null && {
  init_holdings_fingerprint: initHoldingsFingerprint,          // sends ""
}),
```
The route forwards `parsed.data.init_holdings_fingerprint ?? null` — `""` is not nullish,
so the RPC precondition runs:
```sql
IF p_portfolio_fingerprint IS NOT NULL THEN          -- '' IS NOT NULL
  v_client_fp_tokens := ... WHERE t <> '' ...        -- => ARRAY[]
  IF v_server_fp_tokens IS DISTINCT FROM v_client_fp_tokens THEN -> portfolio_fingerprint_stale
```
For any allocator who **has** `allocator_holdings` rows, `v_server_fp_tokens` is
non-empty, so every blank-mode commit returns 409 with
`"Portfolio changed since you started this scenario … Refresh to load the latest
holdings, then re-apply your changes."` A refresh cannot fix it — blank mode always
produces `""`.

Reachability is not theoretical: `canEnterBook = hasLiveBook && bookEntryGateSatisfied`
(`:893`), so a holder with live holdings but **zero contributing keys** is FORCE-blanked.
The comment at `:87-92` explicitly claims "151-06's manual AUM input removes blank mode's
residual harm (it can then size and commit)". It can size. It cannot commit. Before this
phase the AUM-zero refusal (`:3884`) stopped the request before it reached the route, so
AUM-01 converts a visible refusal into a misleading server rejection.

**Fix:** Only send the precondition when the draft was actually authored against a
holdings basis. Either drop the empty fingerprint at the drawer boundary:
```ts
// ScenarioCommitDrawer.tsx — an EMPTY fingerprint is "no holdings basis", not
// "zero holdings". Omitting the key makes the RPC skip the precondition, which is
// the correct semantic for a blank-authored draft.
...(initHoldingsFingerprint ? {
  init_holdings_fingerprint: initHoldingsFingerprint,
} : {}),
```
…or, preferably, make the composer pass `null` in blank mode so the intent is explicit at
the source:
```ts
setCommitFingerprint(
  entryMode === "blank" ? null : scenario.draft.init_holdings_fingerprint,
);
```
Add a regression test that commits from blank mode for an allocator WITH holdings and
asserts the body carries no `init_holdings_fingerprint`.

---

### CR-02: The split book-entry gate was repointed at only three of six consumers — a saved book scenario reopens BLANK with EMPTY membership

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1701-1710`, `:1735-1738`, `:2024-2027`

**Issue:**
`canEnterBook` (`:893`), `handleEntryModeSelect` (`:1590`) and `usePerKeySources` (`:2498`)
now read `payload.bookEntryGateSatisfied`. The reopen and membership-stamp seams were left
on `payload.perKeyDailiesGateSatisfied`:

```ts
const targetEntryMode: "book" | "blank" =
  draftIsBookAuthored && (payload.perKeyDailiesGateSatisfied ?? false) ? "book" : "blank";
...
const memberKeyIdsForSave =
  entryMode === "book" && payload.perKeyDailiesGateSatisfied
    ? (payload.eligibleApiKeyIds ?? []) : [];
...
deriveMembershipFromGate(payload.perKeyDailiesGateSatisfied ?? false, payload.eligibleApiKeyIds ?? [])
```

In the partial-book state this phase newly enables
(`bookEntryGateSatisfied === true && perKeyDailiesGateSatisfied === false` — the founder's
2026-08-05 PROD census of 8 eligible keys, 6 manager-side, 2 with series):

* A new save of a **book-mode** scenario persists `memberKeyIds: []` — the schema's
  documented meaning for "blank-authored (no book members)". The saved row now lies about
  what it models; share captions and compare read that membership.
* Reopening that scenario computes `targetEntryMode = "blank"`. `drifted` is false (the
  draft fingerprint matches the live-book arm of `isDraftDrifted`), so
  `setEntryMode("blank")` fires and the book scenario silently loses its book —
  `usePerKeySources` then falls to the added-only engine and the projection changes.
* Pre-v4 drafts hydrating in this state get `memberKeyIds: []` stamped by
  `deriveMembershipFromGate`.

This is a new user-visible regression: pre-151 the user could never reach book mode in
this configuration, so no book scenario could be saved and mis-reopened. The code at
`:2604-2609` already names the condition ("a reopened book draft syncs to blank mode while
`targetEntryMode` stays frozen on the old all-or-nothing gate") without fixing it.

**Fix:** Repoint the reopen/stamp seams at the book gate and the role-aware key set:
```ts
const bookGate = payload.bookEntryGateSatisfied ?? false;

const targetEntryMode: "book" | "blank" =
  draftIsBookAuthored && bookGate ? "book" : "blank";

// The stamp must name what the engine ACTUALLY blends (see WR-07).
const memberKeyIdsForSave =
  entryMode === "book" && bookGate ? (payload.contributingApiKeyIds ?? []) : [];

const hydratedValue =
  decoded.value.memberKeyIds === undefined
    ? setMemberKeyIds(
        decoded.value,
        deriveMembershipFromGate(bookGate, payload.contributingApiKeyIds ?? []),
      )
    : decoded.value;
```
Re-check `memberKeyIdsForUpdate`'s `!payload.perKeyDailiesGateSatisfied` guard (`:2043-2047`)
in the same pass — with the book gate true and the all-or-nothing gate false it currently
freezes membership on every Update.

---

### CR-03: A raw Python exception string still reaches the user-visible `sync_error`, contradicting the module's own AUM-02 invariant

**File:** `analytics-service/services/allocator_positions.py:856-859` (invariant declared at `:101-116`)

**Issue:**
The module now documents, in the file this phase rewrote:

> Anything this module returns as a `warning` … lands in `api_keys.sync_error` and is
> rendered VERBATIM in the browser by AllocatorSyncStatus … NEVER a Python type/method
> name or a raw exception string.

Sixty lines later the ccxt derivative arm does exactly that:
```python
except Exception as exc:  # noqa: BLE001
    # Partial success: persist spot, surface the derivative-side error
    warning = str(exc)[:500]
```
`job_worker.py:7246-7255` writes that `warning` straight into `api_keys.sync_error` with
`sync_status='complete_with_warnings'`. Any internal failure inside
`positions.fetch_positions` (a `KeyError`, a `TypeError`, a ccxt parse error) is rendered
verbatim to the allocator — structurally the same defect as
`"'Mt5Session' object has no attribute 'fetch_balance'"` that this phase exists to close,
still live for binance/bybit/okx/deribit. The new leak test
(`test_allocator_positions_non_ccxt.py:261-288`) enumerates only the new constants, so it
cannot catch this.

**Fix:** Route the ccxt derivative failure through the same end-user copy channel as the
new venue branches; keep the exception text in the log/Sentry chain only:
```python
DERIVATIVE_FETCH_FAILED_NOTE = (
    "Couldn't read open positions from {venue} — spot balances synced and "
    "positions will retry automatically."
)
...
except Exception as exc:  # noqa: BLE001
    logger.warning(
        "fetch_allocator_holdings: derivative-side read failed for %s (%s)",
        exchange_name, type(exc).__name__, exc_info=True,
    )
    warning = DERIVATIVE_FETCH_FAILED_NOTE.format(venue=_venue_display(exchange_name))
```
Extend `test_user_visible_copy_never_leaks_python_internals` to drive a ccxt venue whose
`fetch_positions` raises, and assert the resulting warning carries none of
`BANNED_INTERNALS`.

## Warnings

### WR-01: MT5 equity row is written with no non-positive guard — a zero or negative account equity becomes a holding

**File:** `analytics-service/services/allocator_positions.py:540-591`

**Issue:** `equity` is checked for `math.isfinite` only. The ccxt spot path filters
`float(qty) > 0` (`:294-300`) before emitting a row; the MT5 branch does not. A stopped-out
MT5 account (negative equity is a real broker state) writes a row with negative
`value_usd`, silently deflating `serverAumUsd` in the commit-route audit recompute
(`route.ts:796-806`) and the dashboard AUM. A zero-equity account writes a measured `$0`
holding, which the module elsewhere argues against ("a 0.0 here would read downstream as a
real measured zero", `:579-581`).

**Fix:**
```python
if not (math.isfinite(equity) and math.isfinite(balance)):
    ...
if equity <= 0:
    # Parity with the ccxt spot path's `> 0` filter: a flat/negative account
    # contributes no holdings, and a negative value_usd would deflate AUM.
    logger.info(
        "poll_allocator_positions: mt5 account equity is not positive — no row emitted"
    )
    return ([], None)
```

---

### WR-02: A missing/non-numeric `balance` kills an otherwise-healthy MT5 equity sync

**File:** `analytics-service/services/allocator_positions.py:531-539`

**Issue:** `balance` is used only inside `raw_payload` (`:585-587`) — it is diagnostic, not
economic. Yet it sits in the same fail-loud extraction as `equity`:
```python
equity = float(info["equity"])
balance = float(info["balance"])
```
A broker/terminal whose `account_info()` omits `balance` (or returns it as a non-numeric)
raises `AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE)`, so the user sees
"MT5 terminal unreachable" forever and the account contributes **zero** to AUM even though
the one figure the branch needs was present. This defeats the phase's stated goal for
those accounts.

**Fix:** Fail loud on `equity` only; degrade `balance` to an optional diagnostic.
```python
try:
    equity = float(info["equity"])
except (KeyError, TypeError, ValueError) as exc:
    ...
    raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
raw_balance = info.get("balance")
balance = float(raw_balance) if isinstance(raw_balance, (int, float)) else None
```
…and emit `"balance": balance` (possibly `None`) into `raw_payload`.

---

### WR-03: `SFOX_UNPRICED_ASSETS_NOTE` writes an unbounded, venue-controlled string into a verbatim-rendered column

**File:** `analytics-service/services/allocator_positions.py:755-760`, `analytics-service/services/job_worker.py:7248-7255`

**Issue:** The warning is `", ".join(sorted(unpriced))` over every non-stablecoin asset the
venue returned. `unpriced` is unbounded and its members come from `entry["currency"]`
(≤16 chars each after the allow-list). The success path writes `warning` with **no length
cap** — unlike every sibling arm, which applies `[:500]`:
```python
ctx.supabase.table("api_keys").update({
    "sync_status": final_status,
    "sync_error": warning,          # unbounded
    ...
```
An sFOX account holding 100+ assets produces a multi-kilobyte string that
`AllocatorSyncStatus` renders verbatim. This is also a storage-poison surface for a
compromised/misbehaving upstream.

**Fix:** Bound both the enumeration and the final string.
```python
_SFOX_MAX_NAMED_ASSETS = 6
named = sorted(unpriced)
label = ", ".join(named[:_SFOX_MAX_NAMED_ASSETS])
if len(named) > _SFOX_MAX_NAMED_ASSETS:
    label += f" and {len(named) - _SFOX_MAX_NAMED_ASSETS} more"
warning = SFOX_UNPRICED_ASSETS_NOTE.format(assets=label) if unpriced else None
```
…and apply the sibling `[:500]` cap at the `_update_ok` write site so no future producer
can bypass it.

---

### WR-04: A bare focus→blur on the Portfolio AUM field silently converts the derived live sum into a persisted manual override

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3785-3798`, `:4259-4261`

**Issue:** In book mode the field is seeded with `String(liveHoldingsSum)` (`:3759`).
`commitAumInput` refuses blank/invalid/zero, but has **no unchanged-value guard**:
```ts
const parsed = Number(raw);
if (!isValidDollar(parsed) || parsed <= 0) { ...snap back...; return; }
scenario.setManualAum(parsed);
```
Tabbing through the form (no keystroke) therefore writes `manualAumUsd = liveHoldingsSum`.
Consequences: (a) the AUM is now FROZEN — a subsequent holdings sync moves
`liveHoldingsSum` while `scenarioAum` stays pinned, and the "Overrides live-holdings total
$X" note appears for an override the user never made; (b) the drawer starts sending
`manual_aum_usd`, which changes the commit body bytes and therefore the idempotency
`request_hash` for a caller the design explicitly wanted unchanged (T-151-21,
`route.ts:166-176`).

**Fix:**
```ts
function commitAumInput(raw: string) {
  if (raw.trim() === "") { setAumInputText(committedAumText()); return; }
  const parsed = Number(raw);
  if (!isValidDollar(parsed) || parsed <= 0) { ...; return; }
  // A blur that commits the value already displayed is not an edit — do not
  // convert the derived live sum into a manual override.
  if (raw.trim() === committedAumText()) return;
  scenario.setManualAum(parsed);
}
```

---

### WR-05: A bare focus→blur on a per-strategy dollar field rewrites the weight vector

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5740-5771`, `:5824-5826`

**Issue:** `commitDollarInput` commits on every blur where the field is non-blank, with no
unchanged-value guard:
```ts
const amount = Number(raw);
if (isValidDollar(amount)) {
  onSetWeight(ref, amount / scenarioAum);
}
```
The displayed value is `Math.round(weightValue * scenarioAum)` (`:5798`), so a no-op blur
writes `round(w·A)/A` back — a lossy round-trip. Two real consequences:

1. The weight changes by up to `0.5 / scenarioAum`. Immaterial at $460k, but the AUM field
   accepts any positive value under `$1e12`, so at a modelling AUM of a few thousand
   dollars a non-edit visibly moves the allocation, and `handleWeightChange` rescales
   every other constituent accordingly.
2. In a **mixed book**, `weightValue` is `blendShareByRef[a.id]` (`:6120-6122`) — the
   *derived* share. Committing it routes through `applyWeightOverrides(vector, basisIds,
   [scopeRef])`, which **stamps** `userWeightOverrides[ref]`. A row that previously rode
   the derived blend is silently pinned to an explicit override by a keyboard tab.

**Fix:** Skip the write when the parsed amount already equals the displayed figure.
```ts
const amount = Number(raw);
if (isValidDollar(amount)) {
  if (Math.round(amount) === displayed) {
    el.value = String(displayed);          // no-op blur — never a weight write
    return;
  }
  onSetWeight(ref, amount / scenarioAum);
}
```

---

### WR-06: `manualAumUsd` is invisible to `diffCount` — an AUM-only edit reports "0 changes" and bypasses the dirty-draft guard

**File:** `src/app/(dashboard)/allocations/hooks/useScenarioState.ts:405-448`

**Issue:** `diffCount` counts toggle deltas, added strategies and `userWeightOverrides`.
`manualAumUsd` is a first-class, persisted, commit-affecting draft field and is counted
nowhere. Therefore an allocator who sets the portfolio AUM and nothing else:
* sees the footer "N changes" chip read 0 for a real unsaved edit;
* passes `if (scenario.diffCount > 0)` in `handleEntryModeSelect`
  (`ScenarioComposer.tsx:1591`), so the mode switch proceeds with no
  ResetConfirmationModal — the guard whose entire purpose is "a mode switch can never
  silently wipe in-progress edits" (`:1577-1579`).

**Fix:** Add the field to the diff derivation, comparing against the default draft:
```ts
// AUM-01 — a manual portfolio AUM is a user-explicit edit like any other.
if (draft.manualAumUsd !== defaultDraft.manualAumUsd) count++;
```

---

### WR-07: `memberKeyIdsForSave` stamps the role-BLIND `eligibleApiKeyIds` while the engine now blends `contributingApiKeyIds`

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2024-2027`

**Issue:** Independent of CR-02, even when `perKeyDailiesGateSatisfied === true` the save
stamp uses `payload.eligibleApiKeyIds`, which by construction still contains the owner's
manager-side keys. The engine's constituent set was narrowed this phase to
`contributingApiKeyIds` (`:2479`, `:2592`). An owner-manager therefore saves a scenario
whose declared membership over-claims keys the projection never blended — and the phase's
own partial-book note explicitly says a manager key "belongs to NEITHER count"
(`queries.ts:2454-2461`).

**Fix:** Stamp what the engine blends (see the CR-02 patch):
`memberKeyIdsForSave = entryMode === "book" && bookGate ? (payload.contributingApiKeyIds ?? []) : []`.
`ScenarioComparePanel`'s narrowed payload (`AllocationsTabs.tsx:1156-1162`) should be
extended in the same pass, or compare will keep computing the live-book leg from the
role-blind set and diverge from the composer.

---

### WR-08: The MT5 kill-switch does NOT gate "before any decrypt / login" on the holdings path

**File:** `analytics-service/services/allocator_positions.py:429-434`

**Issue:** The comment asserts:
> (a) Kill switch FIRST — the derive arm's exact posture (gate before any decrypt / login /
> read), so turning MT5_ENABLED off during an incident stops live RPyC reads on this path too.

By the time `_fetch_mt5_account_rows` runs, `_allocator_key_preflight` has already decrypted
the credentials and called `_make_exchange_client` → `_make_mt5_session` → `Mt5Client(...)`,
whose `__init__` calls `connect(host, port, timeout=...)` (`mt5_client.py:232`) and opens a
live RPyC connection to the gateway. Flipping `MT5_ENABLED=false` during an incident does
not stop the worker connecting to the terminal on this path; it only stops the
`login`/`account_info` calls. (The derive arm at `job_worker.py:3463` carries the same
inaccurate claim — this is not a regression, but the new code repeats it as fact and an
operator will make an incident-response decision on it.)

**Fix:** Either gate at the construction chokepoint so the claim becomes true —
```python
# job_worker._make_exchange_client
if exchange_name == "mt5":
    if not mt5_enabled_server():
        raise Mt5DisabledError(MT5_DISABLED_DETAIL)   # no decrypt-consuming connect
    return _make_mt5_session(api_key, api_secret, passphrase)
```
— or correct the comment to say the gate stops the *reads*, not the connection.

## Info

### IN-01: `_mt5_bounded_restart` logs a hardcoded `derive_broker_dailies:` prefix from the holdings path

**File:** `analytics-service/services/mt5_concurrency.py:91-95`
**Issue:** The helper is now invoked from `allocator_positions._fetch_mt5_account_rows`
(`:489`, `:503`), but its warning still reads `"derive_broker_dailies: bounded mt5 terminal
restart did not complete…"`. Incident triage will look at the wrong job kind.
**Fix:** Accept a `caller: str` argument (or use `logger.warning("%s: bounded mt5 …", caller, …)`).

### IN-02: `setManualAum(undefined)` has no production caller — a manual AUM cannot be cleared

**File:** `src/app/(dashboard)/allocations/lib/scenario-state.ts:818-832`
**Issue:** The composer only ever calls `scenario.setManualAum(parsed)` (`:3798`); the blank
branch of `commitAumInput` snaps the text back rather than clearing. Once a manual AUM is
committed, the only way back to the live-holdings sum is a full draft Reset. The
documented clear path is dead code.
**Fix:** Either clear on an explicit blank commit, or delete the `undefined` branch.

### IN-03: MT5 holding symbol truncates the key id to 8 chars for no gain

**File:** `analytics-service/services/allocator_positions.py:560`
**Issue:** `symbol = f"ACCOUNT-{api_key_id[:8]}"`. A full UUID already satisfies
`_HOLDING_SYMBOL_RE` / `HOLDING_REF_RE` (hyphens are in the alphabet), so the truncation
buys nothing and re-introduces a small collision surface on a UNIQUE
`(allocator_id, venue, symbol, asof)` index — the exact silent-overwrite failure the
comment above it warns about. The comment also correctly notes changing it later is a
data migration.
**Fix:** Use the full `api_key_id`.

### IN-04: The copy-leak test's stated scope is broader than what it checks

**File:** `analytics-service/tests/test_allocator_positions_non_ccxt.py:261-288`
**Issue:** The docstring claims "Every worker-written string this plan can put in
`api_keys.sync_error`", but the candidate list omits `MT5_DISABLED_DETAIL`,
`SFOX_DISABLED_DETAIL`, `MT5_MISSING_ACCOUNT_REF_NOTE`, `SFOX_FETCH_FAILED_NOTE` and
`SFOX_UNPRICED_ASSETS_NOTE`. The two `*_DISABLED_DETAIL` constants ARE returned as
warnings by this plan and would fail the `assert "—" in copy` assertion.
**Fix:** Enumerate every constant the module can return as a warning, and either exempt
the two disabled-detail strings explicitly or reword them into the em-dash copy class.

### IN-05: `test_timeout_constants_survived_the_move` is environment-coupled

**File:** `analytics-service/tests/test_mt5_concurrency.py:166`
**Issue:** `assert read_s == MT5_REQUEST_TIMEOUT_S + 10.0` fails whenever
`MT5_DERIVE_READ_TIMEOUT_S` is set in the environment (a legitimate production override).
**Fix:** `monkeypatch.delenv("MT5_DERIVE_READ_TIMEOUT_S", raising=False)` + `importlib`
re-read, or assert the derivation only when the env var is unset.

### IN-06: The composer defensively `?? false` / `?? []` fields the payload declares required

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:893`, `:1590`, `:2479`, `:2592`, `:2613`, `:2624-2626`
**Issue:** `queries.ts:3976-3980` states the new fields are emitted explicitly "because every
downstream `?? []` / `?? false` fallback would mask a missing field instead of failing
loudly", and the payload type declares them non-optional. Every consumer then applies
exactly that fallback. The two decisions contradict each other; the fallbacks would mask a
future producer that forgets a field.
**Fix:** Drop the fallbacks (the type already guarantees presence), or drop the comment.

### IN-07: The unregistered-non-ccxt-venue skip arm is currently unreachable

**File:** `analytics-service/services/allocator_positions.py:830-838`
**Issue:** `NON_CCXT_VENUES == {"mt5", "sfox"}` and both have fetchers, so
`UNSUPPORTED_VENUE_NOTE` can only be reached via the monkeypatched test. Intentional
(documented as the standing contract for the next venue) — noted so a future reader does
not mistake it for live copy.

### IN-08: The role-discriminator degradation re-admits manager keys as book constituents

**File:** `src/lib/queries.ts:3868-3898`
**Issue:** On a read failure `strategyLinkedKeyIds` is empty, so
`allocatorEligibleApiKeyIds === eligibleKeyIds`. The comment frames the failure mode only
as "an allocator who can still reach their book"; the fuller effect is that manager-side
keys (which DO have per-key series) re-enter `contributingApiKeyIds`, become toggle rows,
and are blended into the allocator's book projection and membership stamp. That equals
pre-151 behaviour, so it is a fail-open by design — but the comment understates it.
**Fix:** Extend the comment; consider surfacing a degraded-gate flag so the UI can note it.

### IN-09: `key={displayed}` remounts the dollar input on Enter, dropping focus

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5804`, `:5819-5822`
**Issue:** Committing with Enter changes the weight, which changes `displayed`, which changes
the `key` — React unmounts and remounts the input, so the caret leaves the field the user
is still editing. Blur is unaffected.
**Fix:** Key on the ref (`key={\`${ref}-usd\`}`) and reconcile via `defaultValue` +
an explicit `el.value` write, which `commitDollarInput` already performs.

---

_Reviewed: 2026-08-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
