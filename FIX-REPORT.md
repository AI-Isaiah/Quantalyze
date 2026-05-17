# PR #188 Retro Follow-up — Fix Report

**Branch:** `fix/pr188-retro-followup-2026-05-16`
**Base:** `origin/main` @ `609b625b` (refactor(ci): code-simplifier retro on PR #188 fix-content)
**Version:** 0.22.40.18 -> 0.22.40.22

## Summary

Threshold-filtered (CRITICAL / HIGH conf>=7 / MED conf>=8 / LOW conf>=9)
retroactive specialist findings on the PR #188 CI hardening fix-content
turned up 26 in-scope items. 11 applied as atomic fixes, 5 deferred with
documented reasons, 4 covered by other applied fixes, 1 out-of-scope.

## Findings catalogue + decisions

Full findings extracted from
`/Users/helios-mammut/claude-projects/quantalyze-worktrees/pr188-retro-audit/.review/follow-up-pr-findings.md`.

| ID | Sev/Conf | File | Disposition |
|----|----------|------|-------------|
| F1 | HIGH/9 | `src/__tests__/critical-regressions.test.ts` | APPLIED — commit `ed8d4ebe` |
| F2 | HIGH/9 | `src/__tests__/critical-regressions.test.ts` | APPLIED — commit `b55af44f` |
| F3 | HIGH/9 | `src/__tests__/critical-regressions.test.ts` | APPLIED — commit `b55af44f` |
| F4 | HIGH/8 | `src/__tests__/critical-regressions.test.ts` | APPLIED — commit `b55af44f` |
| F5 | HIGH/8 | `src/__tests__/critical-regressions.test.ts` | APPLIED — commit `ed8d4ebe` |
| F6 | HIGH/8 | `.github/workflows/ci.yml` (playwright-report gate) | APPLIED — commit `38028344` |
| F7 | HIGH/9 | `.github/workflows/ci.yml` (security playwright trace exfil) | COVERED by F6 |
| F8 | HIGH/9 | `src/__tests__/critical-regressions.test.ts` (YAML anchor guard) | APPLIED — commit `b55af44f` |
| F9 | MED/9 | `.github/dependabot.yml` | APPLIED — commit `7a5994b9` |
| F10 | MED/8 | `src/__tests__/critical-regressions.test.ts` (permissions cardinality) | APPLIED — commit `b55af44f` |
| F11 | MED/8 | `docs/runbooks/ci-hardening-permissions-c0293.md` | APPLIED — commit `c0a245ef` |
| D1 | MED/9 | `.github/workflows/ci.yml` `.next/cache` comment | COVERED by PR #192 |
| D2 | HIGH/9 | SHA-pin enforcement script | COVERED by existing test invariant |
| D3 | HIGH/9 | Artifact-content runtime gate | DEFERRED — separate scope (runtime grep, different layer) |
| D4 | HIGH/8 | `.github/workflows/ci.yml` rebuild verification | APPLIED — commit `e6fae768` |
| D5 | HIGH/8 | SQL tests for new migrations | OUT-OF-SCOPE (PR #188 is CI scope, not SQL) |
| D6 | MED/9 | `supabase-migrate.yml` plan-job password removal | DEFERRED — substantive runtime change |
| D7 | MED/8 | CRITICAL-C0293 file isolation | DEFERRED — refactor, no posture change |
| D8 | MED/8 | Nightly SHA-drift detection cron | DEFERRED — auto-issue design needed |
| D9 | MED/8 | Rebuild step contract test brittle on rename | DEFERRED — current test works |
| D10 | MED/8 | `nightly.yml` playwright-report retention | COVERED — PR #188 removed the upload entirely |

**Applied:** 11
**Covered by other fixes:** 4 (F7 by F6; D1 by PR #192; D2 by existing test; D10 by PR #188 itself)
**Deferred with reason:** 5 (D3, D6, D7, D8, D9)
**Out of scope:** 1 (D5 — SQL tests, unrelated to CI hardening scope)

## Commits

| Hash | Subject |
|------|---------|
| `ed8d4ebe` | fix(ci-retro): broaden frontend-build secret check + tighten env-block regex (closes follow-up F1+F5) |
| `b55af44f` | fix(ci-retro): add regression tests for PR #188 invariants (closes follow-up F2+F3+F4+F8+F10) |
| `38028344` | fix(ci-retro): tighten playwright-report gate to fail-closed allow-list (closes follow-up F6) |
| `e6fae768` | fix(ci-retro): assert seed-gated rebuild inlined real env into .next/ (closes follow-up D4) |
| `7a5994b9` | fix(ci-retro): add dependabot config for github-actions ecosystem (closes follow-up F9) |
| `c0a245ef` | docs(ci-retro): expand runbook with regression-gate matrix + enforcement gaps (closes follow-up F11) |
| `0500c3da` | chore: bump v0.22.40.22 — CI hardening retro follow-up |
| `79a2b66b` | docs: CHANGELOG v0.22.40.22 entry — PR #188 retro follow-up |

## Test verification

- `npx vitest run src/__tests__/critical-regressions.test.ts` — 63 passed (was 48 pre-PR; +15 new tests).
- `npx vitest run` (full suite) — 3695 passed, 228 skipped, 0 failed.
- `actionlint .github/workflows/*.yml` — clean.

## Deferred items (must surface in next planning cycle)

These were flagged HIGH/MED by the retro audit but require separate
scope:

- **D3 — artifact-content runtime gate** (pr-test-analyzer #35, HIGH/9):
  add a CI step that downloads the `nextjs-build` artifact in the same
  run and greps it for `TEST_SUPABASE_*`. The applied F1 covers the
  source-text regression layer; the runtime grep would catch a buggy
  build that drifts inlined values vs source despite passing F1.

- **D6 — supabase-migrate plan-job password removal** (red-team #38,
  MEDIUM/9): replace `SUPABASE_DB_PASSWORD` with `SUPABASE_ACCESS_TOKEN`
  -only auth in the plan job. Actually reduces exposure surface (vs the
  applied F4 which achieves symmetry). Requires validation that the
  read-only flow works end-to-end with `version: 2.98.2`.

- **D7 — CRITICAL-C0293 file isolation** (red-team #43, MEDIUM/8):
  move the `[CRITICAL-C0293]` describe block to its own test file so it
  runs in every vitest shard. Mitigates the single-shard-flake risk
  on a doc-only PR merging concurrent ci.yml regression.

- **D8 — Nightly SHA-drift detection cron** (red-team #28, MEDIUM/8):
  `gh api repos/<org>/<action>/git/ref/tags/<tag>` probe per pinned
  action in `docs/runbooks/ci-hardening-permissions-c0293.md`, with
  auto-issue routing matching the existing demo-pdf-coldstart pattern.
  ~10s nightly cost.

- **D9 — Rebuild step contract test refactor** (pr-test-analyzer #45,
  MEDIUM/8): refactor the seed-gated rebuild contract test to key on
  the unique combination of `if:` + `rm -rf` wipe + `npm run build` +
  `secrets.TEST_SUPABASE_URL` env binding rather than the exact step
  name string. Lower priority — current test still works, the refactor
  is biased toward future renames.

## Rebase phase (post-#191/#195)

**Date:** 2026-05-17
**Outcome:** Rebased + force-with-lease pushed; CI green; PR mergeable=CLEAN.

### Sequence

1. **First rebase attempt** — onto `origin/main` @ `8c1d71cc` (v0.22.40.26 — types.ts tightening from PR #191). Expected conflicts on VERSION + package.json + CHANGELOG.md. Resolved to v0.22.40.27, force-with-lease pushed `7b74f29e`.

2. **PR #195 landed in parallel** — while the first push was settling, PR #195 merged claiming patch slot v0.22.40.27 (`701fa883`). GitHub kept reporting `mergeable: false / mergeable_state: dirty` for PR #194; `git merge-tree origin/main HEAD` confirmed renewed conflicts on the same files plus FIX-REPORT.md.

3. **Second rebase** — onto `origin/main` @ `701fa883` (v0.22.40.27 — PR #195 retro follow-up on PR #189). Re-resolved:
   - **VERSION + package.json**: bumped to `0.22.40.28` (claims clean slot above PR #195's .27).
   - **CHANGELOG.md**: re-headered this PR's entry under `[0.22.40.28] - 2026-05-17`; preserved PR #195's `[0.22.40.27]` section verbatim.
   - **FIX-REPORT.md** (root-level): both PRs added a top-level FIX-REPORT.md. Took `--theirs` (incoming PR #194 content); the upstream PR #195 FIX-REPORT.md was a transient working file with no semantic dependency on this PR's content.
   - The original "bump v0.22.40.22" commit was auto-dropped by `git rebase` as "patch contents already upstream" — now consolidated into the single `chore: re-bump version after rebase against main (v0.22.40.28)` commit (`b05cba0c`).

4. **Force-with-lease pushed** `b05cba0c`. CI run `25977671615` triggered automatically.

### Final state

- Branch tip: `b05cba0c chore: re-bump version after rebase against main (v0.22.40.28)`
- Version: `0.22.40.28` in VERSION + package.json; CHANGELOG entry `[0.22.40.28] - 2026-05-17`
- CI run `25977671615`: ALL checks green (frontend-lint, frontend-policy, frontend-test 1/2/3, frontend-typecheck, frontend-build, sql-tests, secret-scan, python, e2e, docs-link-check, Vercel deployment).
- PR state: `gh pr view 194 --json mergeable,mergeStateStatus` -> `{"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN"}`.
- DID NOT merge / DID NOT /land-and-deploy — handoff back to orchestrator per task spec.

### Commits ahead of origin/main (9)

```
b05cba0c chore: re-bump version after rebase against main (v0.22.40.28)
295f9260 docs: FIX-REPORT for PR #188 retro follow-up
0a4c6422 docs: CHANGELOG v0.22.40.22 entry — PR #188 retro follow-up
9ab1c5d4 docs(ci-retro): expand runbook with regression-gate matrix + enforcement gaps (closes follow-up F11)
f77c897a fix(ci-retro): add dependabot config for github-actions ecosystem (closes follow-up F9)
c2c8d31e fix(ci-retro): assert seed-gated rebuild inlined real env into .next/ (closes follow-up D4)
e8b5821f fix(ci-retro): tighten playwright-report gate to fail-closed allow-list (closes follow-up F6)
44ee6598 fix(ci-retro): add regression tests for PR #188 invariants (closes follow-up F2+F3+F4+F8+F10)
8bf3ae80 fix(ci-retro): broaden frontend-build secret check + tighten env-block regex (closes follow-up F1+F5)
```
