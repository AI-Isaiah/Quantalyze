# Phase 167 — deferred items

Discoveries made while running the release gate (plan 05) that are OUT OF SCOPE for it.
⛔ Each was measured, not reasoned about. ⛔ None was "fixed" by relaxing the thing that measures it.

---

## 1. Two `REAL CORPUS` cases sit close to their own in-file timeouts under v8 coverage

**Found:** plan 05, Task 1, running the full TS suite with `--coverage`.

**Measured, uninstrumented, on an otherwise idle machine:**

| case | duration | its own in-file budget | consumed |
|---|---|---|---|
| `mutation-runner-neuter.test.ts` — WR-07 `REAL CORPUS` | 9,486 ms | 20,000 ms | 47% |
| `mutation-annotation-parser.test.ts` — R2-W04 `REAL CORPUS` | 18,011 ms | 30,000 ms | 60% |

Under v8 coverage instrumentation both exceed those budgets locally. Reproduced with CI's own
invocation (`--shard=N/2 --coverage --test-timeout=20000` + blob reports): shard 1 went red on the
first, shard 2 on the second.

**Why this is NOT booked as a phase-167 regression.** Phase 167 grew the corpus these cases scan by
one file (75 → 76) and three arms (423 → 426) — **+1.3% and +0.7%**. At ~237 ms/file that is a
marginal cost around 0.1–0.2 s against an overshoot of 10–12 s. The headroom was already thin
before this phase and the instrumentation is what consumes it.

**Why it is not believed to be red in CI.** `main` at `956f663f` ran both shards green
(`frontend-test (1)` and `(2)`, ~6 min each) against ~11 min each for the same invocation in this
checkout. CI has materially more headroom than this worktree does.

⛔ **NOT fixed here, and the forbidden remedies are named so a later reader does not reach for
them:** do not raise either in-file timeout, do not lower `FILES_FLOOR` / `ARMS_FLOOR`, do not add
a waiver, and do not narrow the corpus either case scans. If this becomes red in CI, the honest
remedy is the `[REDUNDER-SUBSET-SPLIT]` shape the repo already records for the sibling problem —
split the work, do not widen the budget.

---

## 2. `test_mt5_session_monitor.py::test_CRITERION_3_...` flakes under `-n auto --dist loadgroup`

**Found:** plan 05, Task 1, first full Python suite run — 1 failed, 6044 passed, 90 skipped.

```
AssertionError: 0 rows for 3 healthy ticks
assert 0 == 1
```

The case drives the monitor loop with `_run_until(lambda: len(fake.call_order) >= 3, shutdown)` and
then asserts the sink holds exactly one row. It waits on the TICK COUNTER and asserts about the
ROW WRITE, so under parallel scheduling the assertion can run before the write lands.

**Measured, not assumed:**

- **Zero commits on this branch touch `test_mt5_session_monitor.py` or `mt5_session_monitor.py`**
  (`git log origin/main..HEAD -- <both paths>` → empty).
- Passes **3/3** in isolation.
- The full suite re-run immediately afterwards: **6045 passed, 90 skipped, 0 failed** — matching
  plan 04's reading exactly.

Pre-existing race, unrelated to this phase's subject. ⛔ Not fixed here; the honest fix is to make
`_run_until` wait on the condition the assertion actually cares about, which is a change to a
gate this phase has no business editing.

---

## 3. Coverage actuals now sit well clear of the thresholds

Measured via CI's own method (sharded blobs + `--merge-reports --coverage`):

| metric | actual | live threshold (`vitest.config.ts`, by symbol) | headroom |
|---|---|---|---|
| Statements | 87.22% (27128/31100) | 80 | +7.22 |
| Branches | 82.16% (19725/24008) | 72 | +10.16 |
| Functions | 84.23% (4579/5436) | 74 | +10.23 |
| Lines | 89.21% (24861/27866) | 82 | +7.21 |

`CLAUDE.md`'s rule is that the thresholds are a RATCHET and should be raised when actual climbs
**durably**. ⚠️ One reading is not "durably", `vitest.config.ts` is not in this plan's
`files_modified`, and raising a ratchet inside a release gate is scope this plan did not have.
Recorded for whoever owns the next ratchet pass rather than acted on.

---

## 4. The broken-windows ledger is refusing every append (cross-phase, pre-existing)

Carried forward from `167-04-SUMMARY.md` and re-confirmed at this plan's HEAD. `.planning/WINDOWS.md`'s
fenced JSON — the tool's sole source of truth — disagrees with its rendered table, because an
earlier commit hand-edited the table, which the tool explicitly forbids. Every
`gsd-tools windows append` is refused with a counts-disagree error.

⛔ **Deliberately NOT repaired and the file is byte-unchanged by this phase.** Editing a count to
unblock one's own append is the same move as clearing a red by widening the thing that measures it,
on a register this phase does not own.

**Consequence, stated plainly:** the two residuals plan 04 tried to file are UNFILED and live only
in `167-04-SUMMARY.md` — the wider D-16 class (`HoldingsTabPanel`'s `keyStatusById`,
`ApiKeyManager.tsx`'s `SyncProgress`), and the "revoked" wording in `HoldingsTable`'s toggle label
and hidden-count footer. Both are also named in the `0.86.0.0` CHANGELOG entry so they are visible
at ship time despite the ledger being unavailable.
