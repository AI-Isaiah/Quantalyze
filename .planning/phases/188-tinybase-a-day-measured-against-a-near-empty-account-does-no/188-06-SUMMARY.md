---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 06
subsystem: frontend-lib
tags: [tiny-base, literal-pin, strict-reader, d-02, d-03, d-06, sc-2, sc-5]
requires: ["188-05"]
provides:
  - "src/lib/tiny-base-flag.ts: TINY_BASE_DAYS_FLAG, TINY_BASE_PERCENT, TINY_BASE_WINDOW_DAYS, readTinyBaseDays"
  - "src/__tests__/tiny-base-literal-pin.test.ts: the two-language pin (Python writer, runner, rule vs TypeScript)"
affects: ["188-07", "188-08", "188-09"]
tech-stack:
  added: []
  patterns: ["client-safe constants module with a raw-source literal pin (options-cash-basis-flag pattern)", "strict reader through parseMarksStart, fail closed"]
key-files:
  created:
    - src/lib/tiny-base-flag.ts
    - src/lib/tiny-base-flag.test.ts
    - src/__tests__/tiny-base-literal-pin.test.ts
  modified: []
key-decisions:
  - "D-06 reader semantics: one rejected element voids the whole list (the note is a disclosure; a missing one is recoverable, a false one is not), otherwise distinct days ascending in a new array."
status: complete
commits: 4
plan_head_before: 9355adb9ed8bd46f286c288b5dc0752bba4746ed
plan_head_after: 3949c14be65cb777f0bd023b68d192c843c057ac
actuals:
  tokens: 9000
  tasks: 2
  commits: 4
duration: single session
completed: 2026-11-03
---

# Phase 188 Plan 06: the tiny-base key and threshold are one literal in two languages, and every reader reads the stored day list the same strict way

**TypeScript now owns `tiny_base_days`, 5 percent and 30 days in one client-safe module, pinned from raw source against the Python writer, the runner and the rule, and `readTinyBaseDays` gives plans 07 and 08 distinct ascending real days or nothing.**

## What was built

- `src/lib/tiny-base-flag.ts` (client-safe, no `server-only`): `TINY_BASE_DAYS_FLAG = "tiny_base_days"`, `TINY_BASE_PERCENT = 5`, `TINY_BASE_WINDOW_DAYS = 30`, and `readTinyBaseDays(value: unknown): string[]`. The reader returns `[]` for a non-array; `[]` for an array holding any element `parseMarksStart` rejects (one call per element, so a non-string, a compact date, a timestamp, `null`, `undefined`, a nested array, an object and an impossible calendar day all void the list); otherwise the distinct days sorted ascending in a new array. It reads days only, never an amount.
- `src/__tests__/tiny-base-literal-pin.test.ts` (12 arms). Every Python file is read raw with `readFileSync`, asserted non-empty and to carry its own anchor first, then matched beside independent literals (`"tiny_base_days"`, 5, 30) written out once.
- `src/lib/tiny-base-flag.test.ts` (25 arms): non-arrays (six shapes), empty list, ordered, unordered with a repeat, month and year boundaries, leap day, new-array and no-input-mutation arms, nine malformed-element shapes, mixed good and bad in both orders, and a reason-only warning arm (the value read is never echoed).

## Anchors the pin reads, per Python file

| File | Anchor (file carries it) | Literal matched |
|---|---|---|
| `analytics-service/services/job_worker.py` | `run_derive_broker_dailies_job` | `_key_inputs_payload["<key>"] = _tiny_listed` (key-mode write) and `_prestamp_flags["<key>"] = _tiny_listed_days` (strategy pre-stamp); both keys must equal `tiny_base_days` |
| `analytics-service/services/analytics_runner.py` | `class DataQualityFlags` | the `_NAVMTM_DAY_LIST_KEYS = (...)` line must list `"tiny_base_days"`; the file must declare `    tiny_base_days: list[str]` |
| `analytics-service/services/tiny_base.py` | `def tiny_base_day_list` | `TINY_BASE_FRACTION: Final[float] = 0.05` (times 100 equals 5) and `TINY_BASE_WINDOW_DAYS: Final[int] = 30` |
| `src/lib/tiny-base-flag.ts` | `TINY_BASE_WINDOW_DAYS` | the three `export const` literals |

## TDD record

### Task 1 (the pin)

- RED (commit ce96598c0), `/tmp/tinybase-06/red1.log`: the file fails to collect, `Failed to resolve import "@/lib/tiny-base-flag"` (the module does not exist). One red test file.
- GREEN (commit 16519f25a): 12 passed.
- Neuter drills, each restored with `cp` from a byte backup and proved with `cmp`; every Python file ended byte-identical (`git status` clean for them):
  - TypeScript side, `TINY_BASE_PERCENT` 5 changed to 6 (`neuter1.log`): 3 failed, 9 passed (the percent-vs-Python arm, the exported-literal arm, the imported-constant arm).
  - Python rule side, `TINY_BASE_FRACTION` 0.05 changed to 0.10 (`neuter1b.log`): 2 failed (the rule's fraction arm, the reader-percent arm).
  - Python worker side, `_key_inputs_payload["tiny_base_days"]` renamed to `tiny_base_day` (`neuter1c.log`): 1 failed (the key-mode write arm).
  - Python runner side, `"tiny_base_days"` removed from `_NAVMTM_DAY_LIST_KEYS` (`neuter1d.log`): 1 failed (the runner transport arm).

### Task 2 (the reader)

- RED (commit d26fad01d), `/tmp/tinybase-06/red2.log`: 25 failed, every one `TypeError: readTinyBaseDays is not a function`.
- GREEN (commit 3949c14be): `tiny-base-flag.test.ts` and the pin together: 37 passed.
- Neuter drill 2 (`flag2.bak`, restored with `cp`, `cmp` clean): a rejected element skipped instead of voiding the list (`neuter2.log`): 1 failed, 24 passed (the "one bad element beside a good one gives []" arm). Extra drill: the ascending sort removed (`neuter2b.log`): 2 failed, 23 passed.

## Verification

- `npx vitest run src/lib/tiny-base-flag.test.ts src/__tests__/tiny-base-literal-pin.test.ts`: 2 files, 37 passed.
- `npx tsc --noEmit`: clean (exit 0). `npm run typecheck` clean after each task.
- `npx eslint` on the three files: clean. `npm run lint` (includes the planning-hygiene check): exit 0 after each task.
- Full `npx vitest run` (`/tmp/tinybase-06/full.log`): 1206 files, 1185 passed, 20 skipped, **1 failed**; 23689 tests, 23378 passed, 309 skipped, **2 failed**.
  - The 2 failures are `src/lib/factsheet/compute.conventions.test.ts` (two FROZEN inline snapshots, fixture B and fixture C). **Pre-existing:** re-run alone on a temporary detached worktree at the fork point `9355adb9e` (same `node_modules` symlink, removed afterwards) it fails identically, 2 failed and 21 passed. Its history is `53c326303` (Phase 169.1), nothing from this phase, and this plan touches no factsheet code. Not fixed (out of scope); noted for the orchestrator.
- Acceptance greps: `git ls-files` lists the three new paths; `export const TINY_BASE_DAYS_FLAG = "tiny_base_days"` 1; `import 'server-only'` 0; `export function readTinyBaseDays(value: unknown): string[]` 1; `parseMarksStart` 3.
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched. No Python, migration, package or version change; no `npm ci` (shared `node_modules` symlink, never staged).

## Deviations from Plan

None in behavior. The plan executed as written; the STOP-rule policy did not fire (no existing test newly fails). Notes, not deviations:

- The pin's reader anchor is `TINY_BASE_WINDOW_DAYS`, not `readTinyBaseDays`: Task 1's GREEN must pass before Task 2 adds the function, so the anchor has to exist at that point.
- Step 0's `npm ci` was skipped on the orchestrator's instruction (the checkout's `node_modules` is a symlink to the phase checkout with a byte-identical lockfile).
- `TINY_BASE_PERCENT` is compared to the Python fraction times 100 with `toBeCloseTo(.., 9)`, since a float product is not exact by construction; the independent literal arm uses `toBe(5)`.

## Known limits (recorded, not fixed)

- `readTinyBaseDays` voids the list on the first rejected element and `parseMarksStart` logs one reason-only `console.warn` for it (the repo's existing reader behavior); a stored list with several bad elements logs once.
- A caller that wants the count must take `length` of the result; a voided list reads as zero days, so the note shows nothing rather than a wrong count.

## Known Stubs

None.

## Threat Flags

None. A pure client-safe module and two tests; no endpoint, auth path, file access or schema surface. T-188-11 (a Python/TS drift on the key or threshold) is mitigated by the pin and four neuter drills; T-188-21 (a false disclosure from a malformed list) by the malformed arms and the neuter drill.

## Self-Check: PASSED

Files exist: `src/lib/tiny-base-flag.ts`, `src/lib/tiny-base-flag.test.ts`, `src/__tests__/tiny-base-literal-pin.test.ts`. Commits ce96598c0, 16519f25a, d26fad01d, 3949c14be are ancestors of HEAD (4 commits since the plan base `9355adb9e`).
