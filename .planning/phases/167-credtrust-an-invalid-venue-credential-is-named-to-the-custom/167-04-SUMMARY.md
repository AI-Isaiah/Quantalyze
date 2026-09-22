---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
plan: 04
subsystem: analytics-service
tags: [python, react, allocator-holdings, mt5, sfox, closed-sets, sync-status, handler-ordering, ast-roster]

# Dependency graph
requires:
  - phase: 167-02
    provides: "the `_must_reach_handler_unwrapped` guard at the head of every MT5/sFOX except-arm, which the new raise sits behind"
  - phase: 167-03
    provides: "`sign_in_failed` admitted by api_keys_sync_status_check, and the amber pill + authored owner helper that render it"
provides:
  - "the daily holdings poll WRITES sync_status = 'sign_in_failed' for a refused MT5 sign-in, with authored, retry-free copy"
  - "AllocatorHoldingsSignInFailedError — a venue-neutral sign-in exception subclassing the transient one, so the retry disposition is unchanged and only the user-facing claim differs"
  - "SIGN_IN_FAILED_NOTE and its SYNC_ERROR_COPY_BY_STATUS row, closing sync_error_copy's unknown-status fallback for this value"
  - "a behavioural pin on the handler arm ORDER (the subclass-shadowing trap), a fallback-SPECIFIC copy pin, and an AST roster pin over every status the module can write"
  - "isUntrustedKeySyncStatus / untrustedKeyChipLabel in src/lib/closed-sets.ts — the ONE definition of 'this key's data is not to be trusted as current', with all 7 former `revoked` equalities as callers (D-16)"
affects: [167-05]

# Actuals
actuals:
  tokens: 17272
  tasks: 3
  commits: 2
  plan_head_before: 04cefc6c
  plan_head_after: 287d3afe

status: complete
---

# Phase 167 Plan 04 — SUMMARY

**The signal is written, and the surface that would have rendered it as healthy is closed in the
same commit.** A refused MT5 sign-in during the daily holdings poll now lands in `api_keys` as
`sync_status = 'sign_in_failed'` with copy that names the remedy and promises no retry; the
holdings and open-positions tables answer an untrusted-status PREDICATE instead of seven hand-kept
equalities against `revoked`.

## Task commits

| task | commit | what |
|---|---|---|
| 1 + 3 | `0a7c0a31` | the writer AND the D-16 predicate, one commit by founder decision — splitting them would open a window in which the value exists and the money surfaces lie about it |
| 2 | `287d3afe` | the three pins, the widened copy gate, and the sFOX verdict recorded at the arm |

## What landed

### Task 1 — the writer (D-11 arm B)

- **`AllocatorHoldingsSignInFailedError`** — venue-NEUTRAL (names no venue, carries no
  venue-specific field, any venue arm may raise it), SUBCLASSING
  `AllocatorHoldingsSyncTransientError`. The retry DISPOSITION is deliberately unchanged: the job
  still backs off and retries, which is correct, because a rotated credential is exactly what a
  later poll should pick up. Only the user-facing CLAIM differs.
- **`SIGN_IN_FAILED_NOTE`** — authored, `{venue}`-templated, names the remedy, promises NO retry.
  The 17-day PROD defect it replaces said *"sync will retry automatically"* about a credential no
  retry could guess.
- **`SIGN_IN_FAILED_SYNC_STATUS`** — the status literal, declared once in `allocator_positions.py`
  and IMPORTED by `job_worker.py`. A second spelling of a CHECK-constrained literal is a constraint
  violation waiting for a typo, and that violation would abort the very write that clears the UI's
  `syncing` spinner.
- **Its `SYNC_ERROR_COPY_BY_STATUS` row**, keyed by the constant rather than a second literal.
- **The raise moves into `_fetch_mt5_account_rows`'s `except Mt5ClientError` arm and nowhere else.**
  That is the arm where a login was attempted and did not succeed: `Mt5Client.login` turns the
  terminal's opaque `False` — the shape a wrong investor password and a wrong server BOTH produce —
  into this typed error.
- **`run_poll_allocator_positions_job` gains its `except` arm IMMEDIATELY ABOVE the parent's**,
  with the ordering named as load-bearing at the site.

**What deliberately did NOT change, each with a control case still green:**

| path | still writes | why |
|---|---|---|
| ccxt `AuthenticationError` / `PermissionDenied` | `revoked`, existing copy | the VENUE asserted the rejection — a confident claim the venue itself made stays confident |
| MT5 stage timeout | `error`, `MT5_UNREACHABLE_NOTE` | transport fault; no sign-in implicated |
| MT5 abandoned-session fence | `error`, `MT5_UNREACHABLE_NOTE` | lease fault; no sign-in implicated |
| MT5 account mismatch | `error`, `MT5_UNREACHABLE_NOTE` | concurrency fault; no sign-in implicated |
| sFOX balances read | `error`, `SFOX_FETCH_FAILED_NOTE` | see the sFOX measurement below |

Telling the owner of a wedged terminal that *their credentials may have changed* would be the same
false blame this phase removes, pointed at a different cause.

### Task 3 — one predicate, seven callers (D-16)

`src/lib/closed-sets.ts` gains `UNTRUSTED_KEY_SYNC_STATUSES`, `isUntrustedKeySyncStatus`,
`UNTRUSTED_KEY_STATUS_CHIP_LABEL` and `untrustedKeyChipLabel`. All seven former equalities are now
callers — six in `HoldingsTable.tsx` (legacy filter, legacy hidden counter, legacy per-row flag,
design-mode filter, design-mode hidden counter, design-mode per-row flag) and one in
`OpenPositionsTable.tsx`.

⭐ **The chip copy question, answered from the existing vocabulary rather than invented.** The chip
is per-status, not one shared sentence: `revoked` names a cause a sign-in failure does not have.
Both labels already shipped — **"Key revoked"** is the byte-unchanged Phase 08 MANAGE-02 chip and
**"Sign-in failed"** is the pill label plan 03 shipped in `AllocatorSyncStatus`. No third
vocabulary was minted. The label map carries `satisfies Record<UntrustedKeySyncStatus, string>`, so
a future member of the set physically cannot ship rendering a correctly-coloured EMPTY chip.

### Task 2 — the pins

| pin | what it catches | shape |
|---|---|---|
| `test_sign_in_failure_reaches_its_own_arm_not_the_parents` | the arms reordered so the subclass arm is dead code | BEHAVIOURAL — drives the real handler, reads the real write. Never source-text order |
| `test_sign_in_copy_is_not_the_unknown_status_FALLBACK` | the copy row deleted | asserts against the FALLBACK VALUE, with a control proving the fallback is live |
| `test_every_status_this_module_can_write_has_its_own_copy_row` | a FUTURE status shipped with no copy row | AST-derived status set (mapping-function returns ∪ `*_SYNC_STATUS` constants), anti-vacuity control per derivation |

## ⛔ Two findings this plan MEASURED rather than assumed

### 1. The AST copy-constant gate was blinded by the act of adding a subclass

`test_transient_error_is_only_ever_constructed_from_a_copy_constant` enforces "every construction
of the verbatim-stamped exception passes a copy constant, never an interpolated exception" — and it
scanned exactly ONE constructor NAME. `AllocatorHoldingsSignInFailedError` inherits the same
contract and gets its own verbatim-stamping handler arm, so **adding it opened a hole in the gate by
existing.** The gate now derives the SET of such types from the class hierarchy in the same AST, and
carries a per-type anti-vacuity control so a type with zero construction sites cannot report
coverage it does not have. Falsified: feeding the sign-in raise an f-string carrying `{exc}` reddens
it BY NAME.

### 2. The end-to-end case's own docstring over-claimed, and the neuter caught it

The first draft claimed three failures would redden it, including a deleted copy row. **Measured:
deleting the row leaves that case GREEN** — the handler's typed arm stamps `str(exc)`, the copy
constant the venue branch raised, and never consults `sync_error_copy` at all. The docstring now
says so explicitly and points at the two pins that DO cover the fallback. An over-claimed test is
worse than a missing one, and the only reason this was found is that the neuter was actually run
instead of reasoned about.

## ⭐ The sFOX measurement (Task 2), and why NEITHER plan branch applied verbatim

**The question:** does `SfoxApiError` carry an auth-distinguishable shape that would let the same
two-level split apply?

**Measured: YES to the shape, and the shape belongs to the OTHER level.** `SfoxApiError` stores the
HTTP `status`, and THREE shipped call sites already dispose of 401/403 as a DEFINITIVE credential
rejection — `routers/exchange.py`'s `_validate_sfox_key`, `routers/internal.py`'s finalize probe
(*"DEFINITIVE auth rejection: the exchange ANSWERED, rejecting the key"*), and
`services/ingestion/sfox.py`. But a definitive rejection is **the venue ASSERTING**, which this
phase routes to the CONFIDENT level (`revoked`), not to `sign_in_failed`. Everything else
`SfoxApiError` carries is explicitly not a credential verdict (status 0 shape violation, 429, 5xx,
timeout).

⇒ **sFOX has no arm of the ambiguous kind the new status exists for**, so the arm is left exactly as
plan 02 left it: guarded, still writing `error`.

⛔ **And promoting sFOX 401/403 to `revoked` was NOT taken, for a reason the repo already records.**
`routers/internal.py` carries an explicit note that a 4xx behind the shared static-egress proxy
could be a transient IP/WAF block rather than a revoked key, that the ambiguity applies to both
surfaces identically, and that **changing it is a founder decision which must move `validate_key`
and the finalize probe together, never a unilateral split**. Adding a third surface with a different
answer is exactly what that note forbids. A `revoked` write is also more consequential here than at
a validate surface: `enqueue_poll_allocator_positions_for_all_keys` loops
`WHERE is_active AND sync_status IS DISTINCT FROM 'revoked'`, so writing it STOPS the daily poll.
The measurement and its reasoning are recorded **at the sFOX arm in source**, not only here — a
SUMMARY scrolls out of context, a comment at the site does not.

## ⚠️ Named residuals — what this plan does NOT reach

1. **The strategy→key attribution gap** (from the plan's own scoping decision, restated so the next
   reader does not mistake it for an oversight). The daily poll writes a fact about a KEY, and it
   surfaces on the account-wide keys surface. It does NOT attach a cause to a specific STRATEGY's
   factsheet, because the factsheet-feeding pipelines (`run_sync_trades_job`, the ledger fan-out)
   still write nothing to `api_keys`. 167-UI-SPEC §4 already binds the copy to that limit.
2. **The wider D-16 class, outside the two money surfaces.** `HoldingsTabPanel`'s `keyStatusById`
   map and `ApiKeyManager.tsx`'s `SyncProgress` (`syncStatus !== "idle"`) carry the same shape and
   were named in D-16 itself as out of scope for this plan. Untouched here.
3. **The "revoked" WORD in the toggle label and the hidden-count footer.** `Show revoked-key
   holdings` and `{N} holdings hidden from revoked keys` now describe a wider set than they name.
   ⛔ Deliberately NOT changed: the toggle label carries an explicit locked pin (`T6: toggle label
   reads 'Show revoked-key holdings' exactly`) on a surface whose own docblock says it is preserved
   *byte-for-byte*, 167-UI-SPEC authors no copy for these tables, and re-opening a reviewed copy
   surface without a spec is how a fix round becomes a regression. Named for whoever owns the next
   copy pass.
4. **`HoldingNoteIconButton`'s `revoked` PROP NAME.** It is a styling flag on a shared component
   outside this phase's `files_modified`; its value is now the wider untrusted set while its name
   still says `revoked`. A rename reaches `HoldingNoteRow.tsx` and its own pins. Commented at the
   call site.

## Deviations from Plan

### 1. [Rule 2 — missing critical functionality] The predicate lives in `src/lib/closed-sets.ts`, a third file

- **Found during:** Task 3.
- **Plan said:** `files_modified` lists only the two components.
- **Done instead:** the set + predicate + label map went into the closed-set registry, whose own
  header states its purpose — *"A closed set declared here once cannot be silently re-widened at a
  consuming layer"* — which is verbatim the defect D-16 describes. The alternative (a component
  importing a predicate from a sibling component) would have made `OpenPositionsTable` depend on
  `HoldingsTable` for a domain fact neither owns.
- **Also new:** two test files, `src/lib/closed-sets.untrusted-key-status.test.ts` and
  `src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx`.
- **Commit:** `0a7c0a31`.

### 2. [Rule 1 — required by the behaviour change] Plan 02's `Mt5ClientError` oracle case updated

- **Found during:** Task 1, as a RED.
- **Issue:** `test_mt5_client_error_arm_follows_the_live_classifier_verdict` asserted
  `str(caught.value) == MT5_UNREACHABLE_NOTE` on its non-permanent branches. That arm's raise is
  precisely what this plan changes.
- **Fix:** the two non-permanent branches now expect `AllocatorHoldingsSignInFailedError` and the
  authored copy. **The PERMANENT branch is byte-unchanged** — plan 02's guard still does the one
  thing it was built for. Two assertions were ADDED rather than removed: `isinstance(...,
  AllocatorHoldingsSyncTransientError)` (the retry disposition is unchanged) and
  `str(...) != MT5_UNREACHABLE_NOTE` (the narrowing is narrow), so a later simplification cannot
  reduce it to a copy-string comparison that proves nothing about the chain.
- **Commit:** `0a7c0a31`.

### 3. [Rule 3 — blocking] The Python interpreter path

- **Issue:** `analytics-service/.venv` does not exist in the worktree — the Python venv is the one
  dependency in this repo that does NOT resolve by walking up, so the plan's literal
  `"$PWD/.venv/bin/python"` cannot run here.
- **Fix:** every Python command ran as the main checkout's interpreter with **cwd set to the
  WORKTREE's `analytics-service/`**, and module resolution was VERIFIED rather than assumed:
  `services.allocator_positions.__file__` resolves inside the worktree. No `npx`, no `pip install`,
  no new package.

### 4. [Rule 2] The AST copy-constant gate widened to the subclass

See "Two findings" above. Commit `287d3afe`.

## Falsifiers — every neuter, its RED, and its restore

Each restore was from a `cp` byte backup verified with `cmp`, re-taken after every edit.
⛔ No `git checkout --`, no `git restore`, no `git stash` at any point.

| # | neuter | observed RED | other pins |
|---|---|---|---|
| A | the MT5 arm's raise reverted to the generic transient type | e2e case: `got 'error'` vs `sign_in_failed` | — |
| B | the two handler arms PHYSICALLY swapped (the literal trap, not an approximation) | ordering pin + e2e case RED, both `'error' == 'sign_in_failed'` | fallback + roster stayed GREEN — correct, they measure something else |
| C | the `SYNC_ERROR_COPY_BY_STATUS` row deleted | fallback pin RED **on the fallback value itself**; roster pin RED naming `sign_in_failed` | e2e case stayed GREEN — which is what exposed the over-claim above |
| D | a second writable `*_SYNC_STATUS` constant added with no copy row | roster pin RED naming it, and ONLY that pin | — |
| E | the sign-in raise fed an f-string carrying `{exc}` | widened copy gate RED, naming `AllocatorHoldingsSignInFailedError` and the expression | — |
| F | `isUntrustedKeySyncStatus` neutered to a bare `=== "revoked"` | the 5 new-status surface arms + the chip-totality arm RED | every `revoked` arm and every healthy control arm GREEN |

## Verification

| gate | result |
|---|---|
| full `analytics-service` pytest suite | **6045 passed, 90 skipped**, exit 0 |
| `pytest tests/test_allocator_positions{,_non_ccxt}.py tests/test_job_worker.py` | 255 passed, 1 skipped |
| `mypy services/allocator_positions.py services/job_worker.py` | Success, no issues |
| `vitest run "src/app/(dashboard)/allocations/"` + the closed-sets case | **1930 + 4 passed**, 0 failed |
| `vitest run src/__tests__` (the census/gate suites) | **3097 passed, 261 skipped, 0 test failures** |
| `tsc --noEmit` | clean |
| `eslint` on all five changed/added TS files | clean |

⛔ **No database command was run against any remote**, no local `uvicorn`, no Railway or gateway
action, no package installed. No floor lowered, ceiling raised, timeout relaxed or waiver added.
No `supabase/tests` census was touched — this plan adds no SQL gate file and no SQL gate arm, so
none of the four censuses moved.

### ⚠️ One environment-only red, measured and NOT fixed (out of scope)

`src/__tests__/gdpr-export-coverage-hook.test.ts` fails at FILE level in a worktree with
`MEASURE_FAIL: the repo's pinned tsx is absent at <worktree>/node_modules/.bin/tsx`. Measured
cause: the worktree's `node_modules` contains only a vitest cache directory (deps resolve by
walking up to the main checkout), and that gate spawns `tsx` by ABSOLUTE path under the repo root
ON PURPOSE, refusing an `npx` fallback. It has nothing to do with any file this plan touches and
passes in CI, which runs `npm ci` at the repo root. Recorded, not repaired — repairing it is a
change to a gate this plan has no business editing.

Also measured: a first pass of `src/__tests__` under the default 5 s per-case timeout produced four
TIMEOUT failures in `lint-sql-gates.test.ts` (shell-out heavy cases, machine under load). Re-run at
a 60 s timeout: **zero test failures**. Recorded so the first reading is not mistaken for a
regression.

## Known Stubs

None. No hardcoded empty value, placeholder string, `TODO` or `FIXME` was introduced, and no test
was skipped or left unrun.

## Threat Flags

None. This plan opens no network endpoint, no auth path, no file-access pattern and no schema
change — the CHECK-constraint widening it depends on landed in plan 03 and is untouched here. Every
`mitigate` disposition in the plan's own register (T-167-13 through T-167-17) is implemented and
pinned; T-167-SC is satisfied by construction, since no package was installed.

## ⛔ The broken-windows ledger REFUSED both entries, and it is not this plan's drift

Residuals 2 and 3 above are open, user-facing and belong in `.planning/WINDOWS.md` so they are
visible at ship time rather than only here. `gsd-tools windows append` refused BOTH:

```
Error: Ledger counts disagree with entries:
frontmatter open/waived/fixed/total=50/0/13/63 but entries yield 51/0/12/63.
```

**Measured: the ledger's own frontmatter counts already disagreed with its entries at
`04cefc6c`** — one entry is `open` while the header still counts it `fixed`. Nothing was written
(`git status` clean on that path), so the ledger is byte-unchanged.

⛔ **NOT hand-repaired.** Editing a count to unblock my own append is the same move as clearing a
red by widening the thing that measures it, on a cross-phase register this plan does not own.
Surfaced instead. The two entries that could not be filed, verbatim, so whoever repairs the counts
can file them without re-deriving:

| kind | phase | file | description |
|---|---|---|---|
| `deviation` | 167 | `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` | D-16 closed the two money surfaces and NOT the class. `HoldingsTabPanel`'s `keyStatusById` map and `ApiKeyManager.tsx`'s `SyncProgress` (`syncStatus !== "idle"`, no `sign_in_failed` branch, and not confirmed to be fed from `api_keys.sync_status`) carry the same shape: no closed set over the column, so every status that is not the one literal they test falls to the healthy branch. A key whose sign-in was refused can still read as healthy there. Mechanical to fix now that `isUntrustedKeySyncStatus` exists — make them callers of it. |
| `deviation` | 167 | `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` | The toggle label `Show revoked-key holdings` and the footer `{N} holdings hidden from revoked keys` now describe a wider set than they NAME: a holding hidden for `sign_in_failed` is reported as hidden "from revoked keys". Left unchanged on purpose — the toggle label carries a locked pin (`T6 … reads 'Show revoked-key holdings' exactly`) on a surface documented as preserved byte-for-byte, and 167-UI-SPEC authors no copy for these tables. Needs a copy decision, not an executor's guess. |

## Self-Check: PASSED

| claim | verification |
|---|---|
| `167-04-SUMMARY.md` exists | FOUND |
| `src/lib/closed-sets.untrusted-key-status.test.ts` exists | FOUND |
| `src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx` exists | FOUND |
| commit `0a7c0a31` exists | FOUND in `git log --all` |
| commit `287d3afe` exists | FOUND in `git log --all` |
| `commits: 2` is MEASURED, not narrated | `git rev-list --count 04cefc6c..HEAD` → `2`, taken at SUMMARY-write time. ⚠️ The `docs(167-04)` commit carrying this file lands AFTER the measurement, so a later `rev-list` reads `3`; the frontmatter counts the two TASK commits and `plan_head_after` names the last of them |
| `tokens: 17272` is MEASURED | `git diff 04cefc6c..HEAD \| wc -c` → 69088, ÷4 |
| neither commit deleted a tracked file | `git diff --diff-filter=D HEAD~1 HEAD` → empty, both commits |
| no `.planning/` hygiene leak | `check:planning-hygiene` OK, 6842 tracked files, 0 findings |

⚠️ **The estimate gap, recorded unflattered.** The plan estimated `tokens: 100000` /
`raw_tokens: 50000`; the realized diff is **17272** on the same chars-over-four scale plan 02 used.
The plan came in well under, and rounding it toward the estimate would corrupt every later
projection. The likely cause is that the estimate priced Task 3 as an unknown (it was appended by
founder decision after the estimate was set) and the sFOX branch as work rather than as a
measurement that closed without code.
