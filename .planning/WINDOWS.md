---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 1
total_count: 2
last_updated: 2026-08-20T17:00:02.116Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 145 | skipped-test | src/__tests__/csv-finalize-c14-regression.test.ts | 503 | NEW-C14-07 describe.skip — pins the dissolved upstream-body spread; Plan 05 rebuilds the c14 file (plan-sanctioned skip) | fixed |  | 2026-08-17T21:25:43.021Z | 2026-08-17T21:43:38.829Z |
| 2 | 158 | deviation | src/app/api/strategies/create-with-key/route.test.ts | 2374 | Intra-file test-order dependence in 10 specs (DEF-16-1 class, one scope inward): vi.doMock in the H-0306 block is never deregistered (vi.resetModules clears the cache, not the registry). Green in declaration order; unreachable from CI (CI never shuffles tests within a file). Discovered by the 158-04 OPS-11 sweep; see phase deferred-items.md D-158-04-1. | open |  | 2026-08-20T17:00:02.116Z |  |

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
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "158",
    "file": "src/app/api/strategies/create-with-key/route.test.ts",
    "line": 2374,
    "description": "Intra-file test-order dependence in 10 specs (DEF-16-1 class, one scope inward): vi.doMock in the H-0306 block is never deregistered (vi.resetModules clears the cache, not the registry). Green in declaration order; unreachable from CI (CI never shuffles tests within a file). Discovered by the 158-04 OPS-11 sweep; see phase deferred-items.md D-158-04-1.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T17:00:02.116Z",
    "resolved_at": null
  }
]
````
