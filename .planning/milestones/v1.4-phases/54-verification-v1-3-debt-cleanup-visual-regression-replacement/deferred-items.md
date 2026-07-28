# Phase 54 Deferred Items

Out-of-scope discoveries logged during execution (not fixed by the originating plan).


## 54-02a — pre-existing no-raw-font-px warning in a test assertion string

- **Found during:** Plan 54-02a (strategy/strategy-v2 px→token migration)
- **File:** `src/components/strategy-v2/ReturnsDistributionPanel.test.tsx:103`
- **Issue:** The `no-raw-font-px` rule warns on `expect(cls).toContain("min-h-[240px]")` — an arbitrary-value class **inside an assertion string** that is `min-h` (NOT a font-size). It is a `.test.tsx` file (excluded from this plan's acceptance grep `grep -v "\.test\."`) and was NOT touched by this plan.
- **Why deferred:** Out of scope on two counts — (1) it is in a test file, (2) it is not a font-size. Not part of BP-03's `text-[Npx]`/`fontSize:'Npx'` migration surface. Fixing it (e.g. splitting the bracketed token in the assertion or adding a rule exemption for test files) belongs to 54-05 (the rule-flip owner) or a test-exempt glob decision, not to this className migration.
- **Not blocking:** the rule is still `warn` repo-wide (54-05 owns the `error` flip); this is a warning, not an error.
