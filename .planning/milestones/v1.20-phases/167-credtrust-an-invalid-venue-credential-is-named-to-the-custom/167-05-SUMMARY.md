---
phase: 167-credtrust
plan: 05
subsystem: release
tags: [release, changelog, version-gate, roadmap, coverage, mutation-runner, census-pins]

# Dependency graph
requires:
  - phase: 167-01
    provides: "the minted SIGN_IN_FAILED wire code and the contract-fixture change whose TypeScript consumer this plan's gate caught still red"
  - phase: 167-02
    provides: "the six guarded MT5/sFOX arms and their AST roster, re-run green here"
  - phase: 167-03
    provides: "the migration, its SQL gate and the moved censuses the mutation runner re-measured here"
  - phase: 167-04
    provides: "the writer and the D-16 predicate, and the residual list the CHANGELOG entry carries"
provides:
  - "v0.86.0.0 — VERSION, package.json and one unified CHANGELOG entry in a single commit"
  - "the eighth stale census restatement, found by the gate and fixed: tests/lib/validate-key-venue-transient-parity.test.ts"
  - "the D-01 ROADMAP attribution correction — 164.5.1 plan 09, not 164.7 plan 07"
  - "a measured coverage verdict taken by CI's own sharded method, not by a local full run"
  - "deferred-items.md — two pre-existing fragilities measured and routed rather than papered over"
affects: [167-VERIFICATION]

# Actuals
actuals:
  tokens: 7712
  tasks: 3
  commits: 3
  plan_head_before: 5bb9d4c762c5b2004b40ee10441203b619e602c3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A release gate earns its keep by running the suites NOTHING ELSE ran. The eighth stale census pin had survived four sweeps because it lives under `tests/`, outside both `eslint src/` and every plan's targeted vitest run."
    - "When a local full-suite run cannot produce a verdict, reproduce the CI JOB's invocation rather than inventing a fourth variant of the local one. Sharded blobs + `--merge-reports --coverage` is what `frontend-coverage` actually does, and it answered in one pass what three local attempts could not."
    - "A timeout is a measurement, not a verdict. Re-measure the case in isolation and quantify this phase's marginal contribution to its cost before calling it a regression or dismissing it as noise."

key-files:
  created:
    - .planning/phases/167-credtrust-an-invalid-venue-credential-is-named-to-the-custom/167-05-SUMMARY.md
    - .planning/phases/167-credtrust-an-invalid-venue-credential-is-named-to-the-custom/deferred-items.md
  modified:
    - VERSION
    - package.json
    - CHANGELOG.md
    - .planning/ROADMAP.md
    - tests/lib/validate-key-venue-transient-parity.test.ts

decisions:
  - "0.85.0.1 -> 0.86.0.0 (MINOR), decided on MEANING: a new customer-visible state across two surfaces plus a CHECK-constraint migration that auto-applies to PROD is not patch-shaped. Confirmed against the shape of the four preceding phase releases."
  - "The parity-roster red was fixed here rather than deferred: it is a red the phase itself caused, and it is the eighth face of a defect plan 03 had already named."
  - "The two REAL CORPUS timeouts were NOT fixed. Measured as pre-existing; this phase's marginal contribution is ~1% of a 10-12s overshoot."
  - "The ROADMAP was hand-edited. No gsd-tools roadmap handler was invoked, so no collateral clobber occurred and none had to be reverted."

status: complete
---

# Phase 167 Plan 05 — SUMMARY

**The gate found a red the phase had caused, the release went out on a measured coverage verdict
rather than an assumed one, and the ROADMAP now credits the phase that actually did the work.**

## Task commits

| task | commit | what |
|---|---|---|
| 1 (deviation) | `9c74299b` | the EIGHTH restatement — the TS parity roster never moved with the contract |
| 2 | `9b203548` | `chore(release): v0.86.0.0` — VERSION + package.json + CHANGELOG in one commit |
| 3 | `a69f2bfe` | the D-01 ROADMAP attribution correction |

---

## ⭐ Task 1 — the gate did its job: five REAL reds, and they were this phase's own

`npm run test:coverage` is the first thing in this phase to run `tests/lib/`. It went red on five
cases in `tests/lib/validate-key-venue-transient-parity.test.ts`, the cross-language drift guard
over the committed venue-transient contract.

**Cause, measured.** Plan 01 narrowed site `C5` in the contract fixture from
`NETWORK_UNAVAILABLE` / `recoverable: true` onto `SIGN_IN_FAILED` / `recoverable: false`, and swept
the Python consumer (`test_validate_key_venue_transient.py`, in the branch diff). The fixture's
OTHER committed consumer — the one whose docblock says `consumers[1]` reserved it — was not swept:

```
expected 8 to be 7    DISTINCT_WIRE_CODES
expected 3 to be 2    NON_RECOVERABLE_WIRE_CASES
TypeError: Cannot read properties of undefined (reading 'wizardCode')
                      three `it.each` arms, because EXPECTED had no SIGN_IN_FAILED row
```

**Why it survived four sweeps while seven siblings were found.** It lives under `tests/`, not
`src/`. `npm run lint` runs `eslint src/`, and every plan's verification used targeted runs
(`vitest run src/lib/`, `src/__tests__`, `src/app/(dashboard)/allocations/`). Nothing in the phase
reached it until the full suite did.

**What was changed, and what was deliberately not.**

| | |
|---|---|
| `EXPECTED` gains `SIGN_IN_FAILED` | → `KEY_SIGN_IN_FAILED`, `wireRecoverable: false`, `envelopeRecoverable: false`. The two columns AGREE, so `DIVERGENT_WIRE_CODE` stays at one member and "the one permitted divergence" keeps its meaning. Verified from source: the wizard entry's `actions` are `["request_call", "expand_log"]`, and `RECOVERABLE_ACTIONS` holds `clear_and_retry` / `try_another_key`. |
| `DISTINCT_WIRE_CODES` | 7 → 8 |
| `NON_RECOVERABLE_WIRE_CASES` | 2 → 3 |
| `NON_RECOVERABLE_WIRE_CODES` | 1 → 2 |
| `TOTAL_CASES` | **unchanged at 14** — the arm was NARROWED, not added |
| the "keeps its negatives" arm | no longer compares the whole non-recoverable list. It pins `AUTH_FAILED`'s two collapse SITES by name (`C6`, `C7`) and `SIGN_IN_FAILED`'s one (`C5`). |

⭐ **The site pin is not decoration.** A bare list comparison would have been diluted by the new
code; site identity catches a narrowing applied to the WRONG arm, which a count cannot. And
⛔ **no count was derived from the corpus it guards** — that file's own docblock forbids it, for
exactly the reason this incident demonstrates.

**Falsified, then restored.** Neutered three ways at once — `DISTINCT_WIRE_CODES` back to 7,
`envelopeRecoverable` flipped to `true`, `C5` rewritten to `C6`:

```
4 failed | 44 passed
expected 8 to be 7
expected [ 'C5' ] to deeply equal [ 'C6' ]
Whether a Retry control renders for SIGN_IN_FAILED changed … expected false to be true
expected [ 'AUTH_FAILED', 'SIGN_IN_FAILED' ] to deeply equal [ 'AUTH_FAILED' ]
```

The fourth arm is the divergence check correctly objecting to the flip — a neuter reddening an arm
I had not aimed at, which is the roster working. Restored from a `cp` byte backup verified with
`cmp`, sha256 `776faca2…` matching, and re-run: **48 passed**.

---

## Task 1 — the gate, command by command

⛔ Nothing was skipped, and every non-zero exit below is accounted for by name.

| command | result |
|---|---|
| `npm run typecheck` | **clean**, RC 0 |
| `npm run lint` | **clean**, RC 0 — eslint + `check-admin-route-manifest` (20 routes) + `check-route-contract` (58 routes) + `check-planning-hygiene` |
| `npm run test:coverage` (full TS suite) | **15,084 passed**, 280 skipped, **0 assertion failures**; 2 in-file-timeout cases + 1 worktree-only file error, all accounted for below |
| coverage thresholds | **PASS** — see the table below |
| full Python suite | **6,045 passed, 90 skipped**, RC 0 (see the flake note) |
| `mypy --strict --follow-imports=silent services/ routers/ models/` | **Success: no issues found in 96 source files** |
| `node scripts/mutation-runner/run.mjs` | **exit 0** |
| `node scripts/lint-sql-gates.mjs --self-test` | `OK: 7 rules, red+green each.` |
| `node scripts/lint-sql-gates.mjs` | `scanned 76 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` |
| `node scripts/lint-app-guc.mjs --self-test` | `OK: 4 finding kinds, red+green each (11 red, 2 green fixtures)` |
| `node scripts/lint-app-guc.mjs` | `app-guc: findings 0` |
| `npm run check:planning-hygiene` | `OK — 6842 tracked files scanned, none carry the local username or an absolute home path` |

⛔ **No database command was run against any remote. No local `uvicorn`. No package installed.**

### The mutation runner, read off the run

```
coverage: files 49/76
arms: 426/426/0   (executed/annotated/waived)
biting: 426
lane-invocations: 426          ← the two independent tallies AGREE
lane-blocked: 0 file(s)
lane-probe: pg_cron AVAILABLE — lane-blocked class is empty
pending: 0
per-arm lane time: mean 4.3s over 426 arm run(s)
✅ No defects. Every annotated arm bit its own arm first.
```

Census reconciles: **49 annotated + 0 lane-blocked + 27 unreachable + 0 pending = 76**.
⛔ `FILES_FLOOR 49` · `ARMS_FLOOR 426` · **`WAIVED_CEILING 0`**, all read BY SYMBOL from
`scripts/mutation-runner/run.mjs`. Against `origin/main`: 48 → 49 and 423 → 426, with the ceiling
unmoved. **Nothing lowered a floor, raised a ceiling, relaxed a timeout or added a waiver, and no
red was cleared by widening an allowlist.**

### ⭐ The coverage verdict, and how it was actually obtained

**The problem:** vitest suppresses the coverage report whenever any test fails, and two
shell-out-heavy corpus cases exceed their own in-file timeouts under v8 instrumentation. So the
local full run exits before printing a number, every time.

⚠️ **Recorded honestly because it cost time: three attempts to route around that failed** — a
repeated `--exclude` flag (they do not accumulate; the first wins), a brace-glob `--exclude` (it
matched one file), and `--maxWorkers=4` (the cause is instrumentation, not worker contention —
confirmed by reproducing the timeout with two files in isolation *with* `--coverage`).

**What worked was reproducing the CI JOB rather than inventing a fourth local variant.**
`frontend-coverage` merges sharded blob reports and enforces thresholds on the merged numbers, so
that is what was run: two `--shard=N/2 --coverage --test-timeout=20000` runs with thresholds zeroed
emitting blobs, then `npx vitest run --merge-reports --coverage`.

| metric | actual | live threshold (read by symbol from `vitest.config.ts`) | headroom |
|---|---|---|---|
| Statements | **87.22%** (27128/31100) | 80 | +7.22 |
| Branches | **82.16%** (19725/24008) | 72 | +10.16 |
| Functions | **84.23%** (4579/5436) | 74 | +10.23 |
| Lines | **89.21%** (24861/27866) | 82 | +7.21 |

⛔ **Coverage did not fall, and no threshold was touched.** The one deviation from CI is
`--exclude` on the GDPR export coverage hook, which is structurally unrunnable in a worktree.
⭐ Excluding a test file can only LOWER measured coverage, so this is a CONSERVATIVE pass.

### The three non-assertion reds, each measured rather than waved through

| red | verdict |
|---|---|
| `gdpr-export-coverage-hook.test.ts` — file-level `MEASURE_FAIL` | Worktree-only. It spawns the repo's pinned `tsx` by ABSOLUTE path on purpose (each spawn's cwd is a `node_modules`-less scratch repo) and refuses an `npx` fallback. Deps otherwise resolve by walking up; that one does not. Passes in CI, which runs `npm ci` at the repo root. |
| 13 timeouts on the first run (`lint-sql-gates` ×4, `ScenarioComposer` ×3, `FactsheetBody` ×2, `self-referential-oracle`, `seam-venue-vocabulary`, and the two corpus cases) | Load-bound. **All re-measured passing in isolation**: 379 passed across the five gate files, 70 passed across the two UI files. Zero assertion failures among them. |
| the 2 `REAL CORPUS` cases, still red under CI's own sharded invocation | Pre-existing. Uninstrumented: **9,486 ms / 20,000 ms** and **18,011 ms / 30,000 ms**. This phase grew the scanned corpus by **+1.3% files / +0.7% arms** ≈ 0.1–0.2 s, against a 10–12 s overshoot. `main` at `956f663f` ran both shards green in ~6 min each vs ~11 min here. Routed to `deferred-items.md`. |

⛔ **Neither timeout was raised and neither gate was weakened.**

### The Python flake, measured rather than assumed

The first full run reported **1 failed, 6044 passed** —
`test_mt5_session_monitor.py::test_CRITERION_3_an_already_authorized_terminal_is_never_sent_a_credential`,
`AssertionError: 0 rows for 3 healthy ticks`. The case waits on the TICK COUNTER and asserts about
the ROW WRITE, so the assertion can run before the write lands.

- **Zero commits on this branch touch that test or its module** (`git log origin/main..HEAD --` on
  both paths → empty).
- Passes **3/3** in isolation.
- Full suite re-run immediately after: **6045 passed, 90 skipped, 0 failed** — matching plan 04's
  reading exactly.

Pre-existing parallelism race, unrelated to this phase's subject. Routed to `deferred-items.md`.

⚠️ **The interpreter note:** `analytics-service/.venv` does not exist in a worktree — the Python
venv is the one dependency in this repo that does NOT resolve by walking up. Every Python command
ran as the MAIN checkout's interpreter with cwd set to the WORKTREE's `analytics-service/`, and
resolution was VERIFIED rather than assumed: `services.allocator_positions.__file__` resolves
inside the worktree.

---

## Task 2 — the release commit

**`0.85.0.1` → `0.86.0.0`, decided on MEANING.** This phase adds a customer-visible state that did
not exist — new copy on the keys surface and in the wizard, a new wizard terminal, a new wire code —
and widens a CHECK constraint that **auto-applies to PROD on merge**. That is a new capability plus
a schema change. The shape was confirmed against `CHANGELOG.md`'s most recent headings rather than
assumed: `0.85.0.0`, `0.84.0.0`, `0.83.0.0` and `0.82.0.0` each shipped a phase's worth of
user-visible behaviour change and each moved the MINOR digit; `0.85.0.1`, the one that moved only
the last digit, was docs-only.

`VERSION` is 8 bytes with **no trailing newline** (`xxd`-verified) and byte-equal to
`package.json`; `src/__tests__/critical-regressions.test.ts` asserts it and passed **164/164**.
⛔ `npm version` was never run.

### ⛔ The CROSS-CHECK — 37 commits, every one mapped

`git log origin/main..HEAD --oneline | wc -l` → **37** at the release commit. Used as a CHECKLIST,
not as background reading. An unrepresented commit would be an unshipped fact, so here is the
mapping in full:

| # | commit | CHANGELOG bullet it maps to |
|---|---|---|
| 1 | `47beee0b` | Notes — the tracked planning record (context) |
| 2 | `36216917` | Notes — the tracked planning record (context session) |
| 3 | `c57a13f0` | Notes — the tracked planning record (UI contract) |
| 4 | `9d14485d` | Notes — research + validation; and Changed → the D-01 attribution the correction acts on |
| 5 | `36987cfd` | Notes — the UI contract's sign-off; Notes → the two pre-existing visual findings it scoped out |
| 6 | `66466242` | Changed — "the pattern document cited six arms; re-measuring found ten" |
| 7 | `1df63bc5` | Notes — the tracked planning record (five plans) |
| 8 | `0b15eafc` | Notes — the tracked planning record |
| 9 | `8f23a4f3` | Notes — the tracked planning record (validation sign-off) |
| 10 | `569567ec` | **Added** — `SIGN_IN_FAILED` minted cross-language, no Retry rendered |
| 11 | `8fd10ea4` | **Fixed** — eight stale census restatements (the mint's seven sites) |
| 12 | `367f2aad` | **Added** — `STATUS_CONTRACT` S-27 |
| 13 | `06fdf6ce` | Notes — "an executor terminated mid-task by a rate limit, rebuilt by re-measuring at HEAD" |
| 14 | `5c48916a` | **Changed** — six MT5/sFOX arms consult the retry disposition; **Security** — no exception text reaches customer copy |
| 15 | `26c83dc3` | **Tests** — the AST roster + the `rate_limited` pin |
| 16 | `243320bb` | Notes — the tracked planning record; **Notes** — the four structural residuals |
| 17 | `5f89b472` | Notes — "a requirements-ID collision booked as D-15b" |
| 18 | `6fe963a8` | **Added** — the migration, the amber pill and the authored helper |
| 19 | `60120f31` | **Tests** — the SQL gate over the widened CHECK; **Fixed** — census restatements |
| 20 | `37d262f7` | Notes — the tracked planning record (partial summary) |
| 21 | `bc4c6947` | **Changed** — D-16 lands in the same commit as the writer; **Notes** — the wider D-16 class |
| 22 | `2169fa2d` | **Fixed** — census restatements (the fourth pin) |
| 23 | `1a0669ba` | **Fixed** + **Root cause** — the substring hole in the no-value-was-lost guard |
| 24 | `c11a282b` | **Fixed** — the two unbounded `ACCESS EXCLUSIVE` waits |
| 25 | `c2f7cfbd` | **Fixed** — `conrelid` scoping and the qualified DDL |
| 26 | `f4aa5cb1` | **Fixed** + **Tests** — the non-exhaustive `pillLabel` switch |
| 27 | `e803007b` | **Fixed** — census restatements (five more); **Tests** — the ratchet moves |
| 28 | `c1ab7beb` | Notes — the tracked planning record (executor worktree merge) |
| 29 | `c6dd7403` | **Fixed** + **Root cause** — a session `SET` survives `COMMIT` |
| 30 | `72f94e2e` | **Fixed** — census restatements (the seventh) |
| 31 | `04cefc6c` | **Added** — the founder's human-verify approval of the migration |
| 32 | `0a7c0a31` | **Added** — the writer; **Changed** — the two money surfaces answer a predicate |
| 33 | `287d3afe` | **Tests** — the three pins; **Root cause** — the subclass blinded the gate; **Security** — the sFOX verdict |
| 34 | `8ec24511` | Notes — the tracked planning record (plan 04 summary); **Notes** — the ledger refusing both appends |
| 35 | `4d74d776` | Notes — "a Python suite result deliberately re-bound to the FINAL tree" |
| 36 | `5bb9d4c7` | Notes — the tracked planning record (executor worktree merge) |
| 37 | `9c74299b` | **Fixed** — the eighth stale restatement |

**All 37 map. No theme is unrepresented.** ⚠️ The release commit itself (`9b203548`) and the
ROADMAP commit (`a69f2bfe`) land after this enumeration; the D-01 correction they carry has its own
bullet under **Changed**, so the release is represented in its own entry.

### Disclosure discipline on the entry

⛔ Swept before committing, and recorded as a VERDICT and a COUNT rather than as a specimen: **0
hits** for the local username, any absolute home path, the measured MT5 account number, the
strategy identifier, the second venue's name and its error code. **0 hits** for the CI skip trailer
in all three commit-message files. No credential-shaped fixture literal is quoted anywhere in the
prose — the push-to-`main` gitleaks scan sees a squash diff that includes `CHANGELOG.md`, and the
branch-scoped allowlist does not cover it.

---

## Task 3 — the D-01 ROADMAP correction

The `### Phase 167` `Depends on:` line credited **164.7 plan 07** with activating the 161.1 ledger
refresh. Re-measured in this checkout before writing, not taken from `167-CONTEXT.md`:

| source | reading |
|---|---|
| `164.7-07-SUMMARY.md` | `Completed: 2026-09-10 (DEFERRED path)`; the founder declined on a failed pre-flight; `20260907130000` reported `applied DORMANT (system_flags.ledger_refresh_enabled = false; NOTHING scheduled)`; the committed manifest held 14 jobs |
| `164.5.1-09-SUMMARY.md` | `provides:` records the refresh **ACTIVATED**: `ledger_refresh_enabled = true`, `ledger_refresh_fanout` as jobid 40 on `25 * * * *`; completed `2026-09-17T08:06Z`; oracle re-captured BY SCRIPT, 14 → 15 jobs |
| `scripts/prod-prober/cron-manifest.json` | the live PROD reading: jobid 40, `ledger_refresh_fanout`, `25 * * * *`, `active: true` |
| `d6607a88` | "Phase 164.5.1 plan 09 tail: the ledger refresh goes live, the oracle agrees again" |

**Why it is not cosmetic.** The dependency IS met on the substance, so the line reached a true
conclusion by a false route — and both ways of checking it were wrong. A reader who looks up
164.7's status and finds it Complete is right for the wrong reason; a reader who opens 164.7 plan 07
and reads it in full finds a DEFERRED activation with nothing scheduled, concludes the dependency
is NOT met, and stalls a phase that is actually unblocked.

**Scope, verified three ways before commit:**

- `git diff --numstat` → **1 insertion, 1 deletion, one file**.
- Line count unchanged (4645 → 4645); **exactly one line index differs**.
- The tail from `⚠️ Adjacent but NOT the same phase` onward — the 164.8.3 PROBERAUTH and 164.5.4
  notes — is **byte-identical**, as is the `MM1` measurement sentence between. No other phase's
  section moved.

⛔ **Hand-edited. No `gsd-tools` roadmap handler was invoked**, so there was no collateral clobber
to revert and none is reported. A `cp` byte backup was taken first and the diff was read rather
than trusted. `npm run check:planning-hygiene` re-run afterwards: **OK, 6842 tracked files, 0
findings** — the count line and the OK line read separately, never with `tail -1`.

---

## Deviations from Plan

### 1. [Rule 1 — bug] The parity roster was fixed here, not deferred

- **Found during:** Task 1, the first full `npm run test:coverage`.
- **Issue:** five real assertion failures in `tests/lib/validate-key-venue-transient-parity.test.ts`,
  caused by plan 01's fixture change.
- **Why it was in scope despite not being in `files_modified`:** it is a red **this phase caused**,
  and the SCOPE BOUNDARY rule excludes pre-existing failures in unrelated files — not failures the
  branch introduced. It is also the eighth face of a defect plan 03 had already named and fixed
  seven times.
- **Commit:** `9c74299b`.

### 2. [Rule 3 — blocking] The coverage verdict needed CI's method, not the plan's command

- **Issue:** the plan's `<verify>` expects `npm run test:coverage` to exit 0. In a worktree it
  cannot: `gdpr-export-coverage-hook.test.ts` fails at file level by design, and vitest then
  suppresses the coverage report entirely — so the threshold verdict the task actually needs is
  unobtainable from that command here.
- **Fix:** reproduced `frontend-coverage`'s own invocation (sharded blobs + `--merge-reports
  --coverage`). ⛔ Nothing was committed to make this work: no config edit, no threshold change, no
  timeout change. The single `--exclude` is a diagnostic flag on one run and can only LOWER measured
  coverage.
- ⚠️ **Recorded as a cost, not just a workaround:** three earlier attempts to get a number out of a
  local full run failed and consumed real time. The lesson is in `tech-stack.patterns` above.

### 3. [documented, not a rule deviation] The two `REAL CORPUS` timeouts were NOT fixed

Measured as pre-existing (this phase's marginal contribution ≈ 1% of a 10–12 s overshoot) and
routed to `deferred-items.md`. ⛔ Raising either in-file timeout is forbidden and was not done.

---

## Known Stubs

**None.** No hardcoded empty value, placeholder string, `TODO` or `FIXME` was introduced by this
plan; no test was skipped, and every gate named above was run rather than assumed.

## Threat Flags

**None.** This plan opens no network endpoint, no auth path, no file-access pattern and no schema
change. Every `mitigate` disposition in its own register is implemented: T-167-18 (no CI skip
trailer — three message files swept, 0 hits), T-167-19 (no credential-shaped literal or identifier
in the CHANGELOG — swept, 0 hits), T-167-20 (hygiene re-run after every `.planning/` write, and
this record states verdicts and counts rather than specimens), T-167-21 (`VERSION` and the
CHANGELOG in ONE commit with `package.json`), T-167-SC (no package installed, `npm version` never
run).

## ⛔ The broken-windows ledger is still refusing appends

Re-confirmed at this plan's HEAD and **carried forward unfixed**: `.planning/WINDOWS.md`'s fenced
JSON disagrees with its rendered table because an earlier commit hand-edited the table, which the
tool forbids. Every `gsd-tools windows append` is refused on a counts-disagree error.

⛔ **Not repaired, and `.planning/WINDOWS.md` is byte-unchanged by this phase.** Editing a count to
unblock one's own append is the same move as clearing a red by widening the thing that measures it,
on a cross-phase register this phase does not own. The consequence is stated in the `0.86.0.0`
CHANGELOG entry and in `deferred-items.md` so the unfiled residuals are visible at ship time
anyway.

## Self-Check: PASSED

| claim | verification |
|---|---|
| `167-05-SUMMARY.md` exists | FOUND |
| `deferred-items.md` exists | FOUND |
| commit `9c74299b` exists | FOUND in `git log` |
| commit `9b203548` exists | FOUND in `git log` |
| commit `a69f2bfe` exists | FOUND in `git log` |
| `VERSION` and `package.json` are byte-equal 4-digit strings | `critical-regressions.test.ts` **164 passed** |
| `VERSION` carries no trailing newline | `xxd` → 8 bytes, `302e 3836 2e30 2e30` |
| `commits: 3` is MEASURED, not narrated | `git rev-list --count 5bb9d4c7..HEAD` → `3`, taken at SUMMARY-write time. ⚠️ The `docs(167-05)` commit carrying this file lands AFTER the measurement, so a later `rev-list` reads `4`; the frontmatter counts the three TASK commits. |
| `tokens: 7712` is MEASURED | `git diff 5bb9d4c7..HEAD \| wc -c` → 30849, ÷4 |
| no commit deleted a tracked file | `git diff --diff-filter=D HEAD~1 HEAD` → empty on all three |
| the three cross-phase working-tree files were never staged | `git status --short` in this worktree never listed them; the three commits touched only the five files named in `key-files` |
| no `.planning/` hygiene leak | `check:planning-hygiene` OK, 6842 tracked files, 0 findings |

⚠️ **The estimate gap, recorded unflattered.** The plan estimated `tokens: 60000` /
`raw_tokens: 30000` at `confidence: low` (zero calibration samples). The realized diff is **7,712**
on the same chars-over-four scale. The plan priced a release gate as a writing task; almost all of
the real cost was WALL-CLOCK — five full TS suite runs, two full Python suite runs and a 426-arm
mutation run — which that scale does not measure at all. ⭐ **That is the calibration lesson worth
keeping: for a gate plan, token estimate and actual cost are close to uncorrelated.**
