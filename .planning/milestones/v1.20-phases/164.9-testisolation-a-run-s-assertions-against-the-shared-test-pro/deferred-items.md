# Phase 164.9 — out-of-scope discoveries

Items found while executing a plan in this phase that are **outside that plan's scope
boundary**. ⛔ Nothing here was fixed by the plan that found it; each is recorded so it is
visible rather than silently absorbed.

⚠️ Recording an item here is NOT routing it. Per the standing rule, only a
data-integrity or user-facing item earns a phase (via `/gsd-phase --edit`); everything else
is fix-or-drop. Each entry below says which it is.

---

## Found by plan 06 (2026-09-21)

### 1. `src/__tests__/lint-sql-gates.test.ts` — four execution-oracle legs time out locally

- **What:** Four legs under *"EXECUTION ORACLE — the result loop is RUN, so a skip tolerance is
  observed in ANY spelling"* exceed vitest's 5000 ms default, each taking ~7.1 s on this machine.
- **PROVEN PRE-EXISTING, not caused by plan 06.** `ci.yml` was replaced with its byte-exact
  content at plan 06's base commit `59b61161` (via a `cp` byte backup of the working version,
  restored afterwards and verified with `cmp`) and that file re-run: the **same four legs timed
  out**. The failure is a property of the legs' own runtime against a 5 s default, not of any
  edit.
- **Why not fixed here:** it is not this plan's file and not this plan's defect. Plan 06 raised
  the timeout on `drift-check-scripts.test.ts` ONLY because its own new arms pushed that file's
  already-70 ms margin over the edge — a consequence it owned. Reaching into a sibling gate file
  to raise a timeout it did not cause would be the adjacent-code "improvement" the standing rules
  forbid.
- **Classification:** neither data-integrity nor user-facing → **fix-or-drop, never a phase.**
  ⚠️ But it is not nothing: a leg that reds on scheduling luck is a leg that gets "fixed" by
  deletion. Whoever next touches that file should measure and size its timeout explicitly, in the
  same shape plan 06 used (record the measurement in-file, keep the bound).
- **Reproduce:** `npx vitest run src/__tests__/lint-sql-gates.test.ts`

### 2. `src/__tests__/gdpr-export-coverage-hook.test.ts` — fails at import inside a git worktree

- **What:** The suite throws before collecting any test:
  `MEASURE_FAIL: the repo's pinned tsx is absent at <repo>/node_modules/.bin/tsx — run \`npm ci\``.
- **Cause:** `node_modules/` is gitignored, so a freshly created git worktree has no
  `node_modules/.bin/tsx`. The file spawns tsx by ABSOLUTE path on purpose (each spawn's cwd is a
  node_modules-less scratch repo) and refuses to fall back to `npx tsx`, which would fetch a
  different version. Its refusal is CORRECT; the environment is what is missing.
- **Environment artefact, not a code defect.** It does not reproduce in the main checkout or in CI,
  where `npm ci` has run.
- **Classification:** neither data-integrity nor user-facing → **fix-or-drop, never a phase.**
  ⚠️ Worth knowing when reading a worktree agent's test output: this file's red is expected there
  and says nothing about the change under test.
