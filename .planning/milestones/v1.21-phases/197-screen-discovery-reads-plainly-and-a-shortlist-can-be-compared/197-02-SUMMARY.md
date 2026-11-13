---
phase: 197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared
plan: 02
subsystem: discovery
tags: [discovery, shared-account, service-role, admin-gate, published-only, clar-05]
requires:
  - phase: 197
    provides: "plan 01 discovery columns (no code dependency; same wave)"
provides:
  - "getSharedAccountPartners(supabase, user, forStrategyIds): admin-gated, published-only, names-only map or null"
  - "groupSharedAccountPartners: the pure grouping core implementing the account identity rule"
affects: [197-06]
tech-stack:
  added: []
  patterns: ["Admin gate inside the module that creates the service-role client", "Fake PostgREST builder that applies eq/in filters and select projection so a fence is proven by what comes back"]
key-files:
  created:
    - src/lib/discovery/shared-account-partners.ts
    - src/lib/discovery/shared-account-partners.test.ts
  modified: []
key-decisions:
  - "Admin check lives inside the reader, before createAdminClient (CONTEXT discretion): a non-admin never causes a service-role read, and the page only passes the prop when the result is non-null"
  - "A key id with no api_keys row still contributes key:<id> so a short read cannot make two strategies on one key look unrelated"
  - ".in() reads are chunked at 100 ids (PostgREST filter rides the URL; the catalogue grows)"
  - "Failure returns null plus captureToSentry (stage shared-account-partners, reason strategies_read_error / strategy_keys_read_error / api_keys_read_error / read_threw); overrides the UI-SPEC dismissal that it cannot fail separately (orchestrator resolution 2)"
requirements-completed: [CLAR-05]
duration: ~35m
completed: 2026-11-08
status: complete
actuals:
  tokens: 6200
  tasks: 2
  commits: 4
commits: 4
plan_head_before: 71dd649582ff9dab7c19122577f733bdd2486f58
plan_head_after: d239639fad03eb895b936401bb5d7b02436e9a99
---

# Phase 197 Plan 02: Shared-account partner reader Summary

A server-only reader that tells an admin which published strategies draw on the same exchange account as each listed strategy, from stored data only, returning partner names and nothing that identifies the account.

## What was built

- **Task 1 (tracer), RED `95d977bab`, GREEN `a6d923a7d`:** `isAdminUser` awaited before `createAdminClient()`; a published-only strategies read (`withPublishedOnly`), then `strategy_keys` for those ids, then `api_keys` limited to `id, exchange, venue_account_id, account_shared_with_api_key_id`; venue identity grouped through the exported pure `groupSharedAccountPartners`.
- **Task 2, RED `d26882ff9`, GREEN `d239639fa`:** the full identity rule (`key:<id>`, `key:<holder id>`, case-blind trimmed `venue:` token only for a non-blank venue id; composite member keys unioned in), names sorted by name then id, output limited to `forStrategyIds`, and the failure paths: any read `error` or throw calls `captureToSentry` with `stage: "shared-account-partners"` and returns `null`.
- No migration, no UI, no client import. Plan 06 wires the page.

## TDD evidence (plan type execute, tdd="true" tasks)

- RED, Task 1: with a signatures-only skeleton, "maps each strategy to the other's name ..." failed on `expected null to equal { s1: ["Beta"], s2: ["Alpha"] }` and "puts the published predicate on the strategies read" failed because no strategies call had been made. The non-admin cases were green on arrival (the skeleton returns null and never creates the client); their RED evidence is the Task 1 GREEN diff, where `createAdminClient` is introduced and the test still holds. Semantic assessment: the target tests executed and failed on the planned assertions, not on a load or syntax fault.
- RED, Task 2: 9 of 22 failed on assertions: same key, holder pointer, key id with no row, sort order, each of the three read errors, client throw, admin-client-creation throw. The identity cases already passing (case-blind exchange, blank venue id, composite member, unpublished partner) were covered by Task 1's venue path and the fake's filters.

## Neuter evidence (D-02 fence proven able to fail)

Byte backup `cp`'d to the session scratchpad, then the `withPublishedOnly(` wrap removed from the strategies read in place. Suite run: 3 failed, 19 passed.

- `puts the published predicate on the strategies read`: `AssertionError: expected [] to deep equally contain [ 'status', 'published' ]`
- `never names an unpublished partner and gives the published strategy no entry`: `AssertionError: expected { s1: [ 'Pending One', …(1) ], …(2) } to deeply equal {}`
- `does not read an unpublished strategy's keys at all`: `AssertionError: expected [ 'k1', 'k-draft' ] to deeply equal [ 'k1' ]`

Restored with `cp` from the backup; `cmp` reported the file identical to the backup (`CMP_IDENTICAL`); suite green again (22 passed).

## Verification

- `npx vitest run src/lib/discovery/shared-account-partners.test.ts`: 1 file, 22 tests, all pass.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors (2 pre-existing warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, files this plan does not touch), hygiene checks OK.
- Acceptance greps: first line `import "server-only";`; `withPublishedOnly(` count 1; `isAdminUser(` at line 144 before `createAdminClient(` at line 147; exactly three `select(` column lists as specified, none naming encrypted, secret, passphrase or label; `captureToSentry(` count 1; no `"use client"` file imports the module; `git diff --name-only 71dd649582ff -- supabase/migrations` prints nothing.

## Deviations from Plan

None - plan executed exactly as written. One small addition inside the plan's intent: `.in()` reads are chunked at 100 ids (Rule 2, request-line limit as the catalogue grows), and the fake client applies `eq`/`in` filters and select projection so the fence and the column list are behavioural.

## Known limits (recorded, not fixed)

- RESEARCH A1: any shared identity at any time counts (no interval overlap, departed keys included), so a rotated-away key can name a partner. Admin-only and informational.
- RESEARCH A5: partner names are raw `strategies.name`, the same string the discovery row prints.
- The strategies read has no pagination; PostgREST's default row cap would truncate beyond its limit. Published catalogue is far below it today.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register (T-197-03 through T-197-07 mitigated as listed; T-197-05 by the `server-only` import and the no-client-import grep).

## Self-Check: PASSED

- FOUND: src/lib/discovery/shared-account-partners.ts
- FOUND: src/lib/discovery/shared-account-partners.test.ts
- FOUND commits: 95d977bab, a6d923a7d, d26882ff9, d239639fa
