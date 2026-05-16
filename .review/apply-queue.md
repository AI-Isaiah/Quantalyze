# PR #179 Retroactive Apply Queue

Consolidated findings post-dedup, filtered to threshold:
- CRITICAL: ALL
- HIGH: conf >= 7
- MED: conf >= 8
- LOW: skip (except where dual-confirmed by red-team list in prompt)

Findings by source:
- `.review/specialist.security.jsonl` (7 records, 1 blank)
- `.review/specialist.code-reviewer.jsonl` (0 records)
- `.review/specialist.pr-test-analyzer.jsonl` (21 records)
- `.review/specialist.performance.jsonl` (9 records)
- `.review/red-team.jsonl` (10 records)

Out-of-scope (analytics-service / equity_reconstruction): all pr-test-analyzer items #1-#14 and red-team items #1-#2 cover analytics-service code, not CI hardening. They are tracked in a separate worktree.

## Apply queue (CI hardening only)

| # | Source | Sev | Conf | Title | Commit |
|---|--------|-----|------|-------|--------|
| 1 | security #1 / red-team #3 (2-way confirmed) | HIGH | 9 | playwright-report trace.zip leaks NEXT_PUBLIC creds | 1 |
| 2 | security #2 | MED | 8 | nightly-pdf-report leaks DEMO_PDF_SECRET | 1 |
| 3 | pr-test-analyzer #15 | HIGH | 9 | No CI gate enforces SHA-pin policy | 2 |
| 4 | pr-test-analyzer #16 | HIGH | 9 | No CI gate enforces NEXT_PUBLIC-not-in-artifact | 2 |
| 5 | pr-test-analyzer #17 | HIGH | 8 | Seed-gated rebuild has no contract test | 2 |
| 6 | pr-test-analyzer #20 / #21 | MED | 8 | No vitest regression for placeholder-env contract / hidden-files invariant | 2 (same describe) |
| 7 | red-team #4 | MED | 8 | persist-credentials default exposes GITHUB_TOKEN | 3 |
| 8 | red-team #8 | LOW | 8 | supabase-migrate plan job missing production env-gate (per prompt) | 4 |
| 9 | performance #5 | MED | 9 | Rebuild step comment lie + no actual cache restore | 5 |

## Skip list (rationale)

- security #3 (.next/cache stale-cred residue, MED conf-7): conf-7 below MED threshold of 8.
- security #4-#7 (LOW): below threshold.
- pr-test-analyzer #1-#14 (equity_reconstruction): out of scope, separate worktree.
- pr-test-analyzer #18 (Dependabot, MED conf-9): not in instructed apply queue.
- pr-test-analyzer #19 (runbook drift, MED conf-8): doc-only, not in instructed apply queue.
- performance #1-#4 (analytics-service): out of scope.
- performance #6 (LOW conf-8): below threshold.
- performance #7-#9 (info): not actionable.
- red-team #1-#2 (analytics-service): out of scope.
- red-team #5 (SHA force-push detection, MED conf-8): nightly cron addition not in instructed apply queue.
- red-team #6 (gitleaks PR-comment chain, MED conf-7): conf-7 below MED threshold.
- red-team #7 (rebuild rm -rf list, MED conf-7): conf-7 below MED threshold.
- red-team #9 (workflow OIDC scope, LOW conf-8): below threshold.
- red-team #10 (artifact retention, MED conf-7): conf-7 below MED threshold; also addressed by commit 1.

## Commits planned

1. `fix(ci): close playwright-report trace.zip exfil (closes retro-PR179-H1)`
2. `test(ci): add CRITICAL-C0293 invariants to critical-regressions.test.ts (closes retro-PR179-H2/H3/H4)`
3. `fix(ci): persist-credentials=false on all actions/checkout invocations (closes retro-PR179-M-persist-chain)`
4. `fix(ci): supabase-migrate plan job missing production env-gate (closes retro-PR179-M-env-gate)`
5. `chore(ci): rebuild step comment honesty + cache restore (closes retro-PR179-M-cache)`
6. `docs(ci): retroactive specialist findings consolidated`
