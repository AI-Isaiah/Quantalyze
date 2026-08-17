---
schema_version: 1
open_count: 0
waived_count: 0
fixed_count: 1
total_count: 1
last_updated: 2026-08-17T21:43:38.829Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 145 | skipped-test | src/__tests__/csv-finalize-c14-regression.test.ts | 503 | NEW-C14-07 describe.skip — pins the dissolved upstream-body spread; Plan 05 rebuilds the c14 file (plan-sanctioned skip) | fixed |  | 2026-08-17T21:25:43.021Z | 2026-08-17T21:43:38.829Z |

````json
[
  {
    "id": 1,
    "kind": "skipped-test",
    "phase": "145",
    "file": "src/__tests__/csv-finalize-c14-regression.test.ts",
    "line": 503,
    "description": "NEW-C14-07 describe.skip — pins the dissolved upstream-body spread; Plan 05 rebuilds the c14 file (plan-sanctioned skip)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-17T21:25:43.021Z",
    "resolved_at": "2026-08-17T21:43:38.829Z"
  }
]
````
