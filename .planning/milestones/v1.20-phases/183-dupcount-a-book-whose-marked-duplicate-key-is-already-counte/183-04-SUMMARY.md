---
phase: 183-dupcount-a-book-whose-marked-duplicate-key-is-already-counte
plan: 04
subsystem: post-deploy PROD reading (SC-4)
tags: [sc-4, d-01, prod-read, read-only, sentry]
status: complete
requires: ["183-01", "183-02", "183-03", "183-05"]
provides:
  - "the deploy binding for PR #1169 (v0.133.14.0) on Railway and Vercel"
  - "the SC-4 reading on PROD after the first nightly derive past both deploys"
  - "the SC-4 verdict"
affects: [183-VERIFICATION]
requirements-completed: [SC-4]
decisions:
  - "SC-4 met on PROD: 0 account_duplicate refusal rows, the one book the retired gate refused draws a version-2 trustworthy counted-once curve, and QUANTALYZE-2H has had no event since the deploy."
metrics:
  tasks: 2
  prod-writes: 0
---

# Phase 183 Plan 04: the DUPCOUNT SC-4 reading on PROD

Read 2026-11-02 around 06:10Z, after the 2026-11-02 nightly derive chain. Every PROD statement
was a single `SELECT` (or `WITH ... SELECT`). Nothing was written, enqueued or redeployed.

## Task 1: deploy binding

phase-merge-commit: bd3ae7e965149af90b9487fa764dcd127cc64d27
main-ci-green: yes
railway-health-sha: 6e01c254160bc6d5a2f3003670943cbf189320e2
vercel-production: yes
deployed-commit: 6e01c254160bc6d5a2f3003670943cbf189320e2
deploys-done-at: 2026-11-01T12:35Z
derive-awaited: yes

- **CI on the merge.** These push runs are bound to the merge sha: `CI` success (24 jobs
  success, 2 skipped) and `Contracts` success. The sha carries 32 check runs: 27 success,
  3 skipped and 2 failures. Both failures (`preflight`, `npm-audit`) are in the scheduled
  `Nightly probes` run at 14:41Z, which is not push-bound.
- **Railway.** The first deploy of the merge reached `success` at 2026-11-01T12:35Z. Every
  later deploy is a main descendant of the merge. Both workers (interactive and backfill)
  have run `6e01c254` since their 2026-11-01T21:13Z deploys (status `SUCCESS`), which was
  before the 2026-11-02 00:10Z derive chain. `/health` reports `git_sha` = that commit,
  `config_ok: true`, and `git merge-base --is-ancestor <merge> <railway sha>` exits 0.
- **Vercel.** The `Production` deployment of the merge reached `success` at
  2026-11-01T12:24Z. The current production deployment, of `6e01c254` (a descendant of the
  merge), reached `success` at 2026-11-01T21:16Z. The production site answers 200.
- **Derive awaited.** R2 below reads `derived_after_deploy=1` for `owners=1`. The book's
  curve row was computed at 2026-11-02T01:31Z, after both deploys.

## Task 2: the SC-4 reading

marker: names PRODUCTION
refusal-tokens: none=7
account-duplicate-rows: 0
account-duplicate-carrying: 0
dupcount-population: owners=1 curve_rows=1 trustworthy_v2=1 refused=0 counted_once_flag=1 derived_after_deploy=1 identity_pending=0
dupcount-tokens: classified_rotation=1, window_truncated=1
census-d: equity_curve_rows=7, version=2,is_trustworthy=true=7, degrade_reason=classified_rotation=3, degrade_reason=window_truncated=4
census-e: owners_with_eligible_keys=7, ready=7
sentry-2h-events-since-deploy: 0
sentry-23-family: account_duplicate
sentry-23-events-since-deploy: 0
sc4-met: yes

- **Marker.** The marker query ran alone before the reads, and again before the census and
  after a transient MCP error. Each time it returned the manifest's `database_marker`. The
  census `rls` label answered `bypasses_rls`.
- **R1.** All 7 `equity_curve` rows have no refusal, and none carries `account_duplicate`.
- **R2 / R3.** The population the retired gate refused is one owner. Its curve is version 2,
  trustworthy, has points, carries `duplicate_shared_account_counted_once`, and has no
  refusal and no identity-pending key. Its two degrade tokens are informational. Neither is
  one of 183-RESEARCH A2's blocking tokens, and neither is `inception_unreconciled`, so no
  contingency applies.
- **Census.** `d`: all 7 curve rows are version 2 and trustworthy. `e`: all 7 owners with an
  eligible key read `ready`. No `duplicate_account` or `account_identity_pending` bucket
  appears.
- **Sentry** (org on the EU region, read-only MCP). QUANTALYZE-2H was last seen at
  2026-11-01T01:29Z, before the deploy. Searching events tagged
  `derive_refusal:account_duplicate` in production over the last 2 days returns that one
  event and nothing later, so tonight's 01:31Z derive emitted none. QUANTALYZE-23 carries
  the same static `derive_allocator_equity: account_duplicate — ...` message (the
  "refused and deleted" wording) and was last seen 2026-10-19.

sentry-resolve-list: QUANTALYZE-2H, QUANTALYZE-23

The Sentry MCP is read-only, so neither issue was resolved here. The list goes to whoever
holds write access.

## Carried open questions

183-CONTEXT's three open questions are no longer open. The founder closed all three on
2026-11-01: question 1 (the per-key duplicate note) as D-02, which plan 05 shipped in the
same PR; question 2 (the panel line copy for a collision) as D-03, left as is; question 3
(a counted-once note on the Overview) as D-04, no note. This plan neither asked nor decided
them.

## Deviations

- **Read path.** PROD reads ran through the Supabase MCP `execute_sql` rather than
  `supabase db query --linked -f <file>`, because the operator brief forbade `--linked`.
  The census SQL came from `node scripts/accounttruth-census.mjs --print-sql=<label>`, run
  one label per call in order: marker, rls, d, e. The census `e` file passed the plan's
  write-verb grep with no hit. Every other statement was a single read visible in full.
- **Book identity.** The operator brief named the book by a tag hint. The plan identifies
  the book only by R2's population, and the hint matched neither that owner nor any key,
  portfolio or curve row on PROD. The reading follows the plan's population.
- **Task 3** (ROADMAP corrections, the runbook note, the records PR and phase close-out)
  is not part of this reading and is left to the orchestrator.

## Self-Check: PASSED
