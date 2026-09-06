# Phase 164.1 — deferred items

Out-of-scope discoveries logged rather than fixed, per the executor scope boundary
(only issues DIRECTLY caused by the current task's changes are auto-fixed).

## 1. `analytics-service/main.py` has 5 pre-existing `mypy --strict` errors

**Found during:** 164.1-02 Task 2, running the plan's own
`cd analytics-service && python3 -m mypy --strict main.py` verify.

**Measured, both sides:**

```
# HEAD (git show HEAD:analytics-service/main.py, before this plan's edit)
main.py:255: error: Function is missing a return type annotation  [no-untyped-def]
main.py:309: error: Missing type arguments for generic type "Task"  [type-arg]
main.py:741: error: Function is missing a return type annotation  [no-untyped-def]
main.py:741: error: Function is missing a type annotation for one or more parameters  [no-untyped-def]
main.py:857: error: Function is missing a return type annotation  [no-untyped-def]
Found 5 errors in 1 file (checked 1 source file)

# after 164.1-02 Task 2 (same five, one line number shifted by the +34 lines added)
main.py:255 / 309 / 741 x2 / 891
Found 5 errors in 1 file (checked 1 source file)
```

**Why it is not fixed here:** `main.py` is NOT on CI's mypy surface. `ci.yml:3217`
runs `mypy --strict --follow-imports=silent services/ routers/ models/`, which is
`Success: no issues found in 91 source files` at this commit. The five errors are a
pre-existing gap in a file CI's B-mypy programme has not yet widened to; fixing them
means annotating three functions that this plan does not otherwise touch (`:255`,
`:309`, `:891`), which is out-of-scope churn under the surgical-changes rule.

**Consequence for the plan:** the 164.1-02 Task 2 `<verify>` clause
"the last line is not `Success: no issues found` is a failure" is **unsatisfiable at
HEAD and always was**. It is recorded honestly in `164.1-02-SUMMARY.md` as a
deviation rather than reported as a pass. The load-bearing measurement — this
plan's change adds ZERO mypy errors — is proven by the identical before/after
five-error baseline above.

**Owner:** the B-mypy widening programme (`ci.yml:3209-3217`), whose stated
direction is `services/ingestion/` → `services/` → `routers/` → `models/` → the
remaining top-level modules.
