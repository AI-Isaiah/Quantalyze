---
phase: 241-democreds-the-two-demo-accounts-are-gone-and-their-passwords
plan: 04
subsystem: records
tags: [security, one-way-delete, prod-write, SECR-01, SECR-02]
requires: [241-03]
provides:
  - "Pair B (the seed-full-app-demo allocator) deleted on PROD 2026-11-25 and re-verified absent on TEST"
  - "the closed demo-credential TODOS entry deleted, riding the code PR"
affects: []
tech-stack:
  added: []
  patterns: ["marker query alone before every PROD statement", "census-pinned single-statement chain, then admin-API auth delete"]
key-files:
  created: []
  modified:
    - TODOS.md
decisions:
  - "Founder go 2026-11-25 (go-founder-runs), then channel moved to the orchestrator by founder instruction for the admin-API delete"
  - "Pair A is kept; its password reset stays a founder human_needed step"
metrics:
  completed: 2026-11-25
status: complete
human_needed:
  - "Pair A password reset (founder step, CONTEXT ruling 2026-11-24); record its date when done"
actuals:
  tasks: 3
  commits: 4
plan_head_before: c800dd753
plan_head_after: 08ab1c718
---

# Phase 241 Plan 04: Pair B on PROD Summary

Counts and dates only. This record holds no login, id, digest or marker text.

## Task 1: read-only preflight (2026-11-25 UTC)

**Integrity.** `shasum -a 256` of 241-PAIRB-chain.sql, 241-PAIRB-census.sql, 241-PAIRB-exists.sql
and 241-PAIRB-admin-delete.mjs equals every line of 241-03-SUMMARY "PROD file fingerprints".

**TEST.** Pair B on TEST: deleted 2026-11-24 by a scoped statement on the login hash (auth rows
only: 1 identity, 11 sessions; no profile); re-verified absent 2026-11-25: present = 0. The marker
query ran alone first and named TEST.

**PROD catalog.** The marker query ran alone before every PROD statement below and named PROD
each time.
- strict_rows = 137 and strict_md5 equal the lane catalog in 241-03-SUMMARY. The public-schema
  FK and trigger path is identical.
- auth_rows = 17 on PROD against 13 on the lane, and auth_md5 differs. That is GoTrue's own
  schema version and does not stop the run.
- `strategies_api_key_id_fkey` on PROD is ON DELETE SET NULL (`n`). 241-PROD-MEASUREMENT.md
  called it "no action", and that label was wrong. Pair B owns no strategy, so the edge does not
  apply here.

**Existence.** Pair A present = 1 (kept). Pair B present = 1.

**Census (Pair B).** pair_b_ids = 1. Every zero_* column = 0 (17 columns).

| expect_* | value |
|---|---|
| holdings | 3513 |
| bridge_outcomes | 2 |
| match_decisions | 2 |
| match_candidates | 14 |
| match_batches | 7 |
| allocator_preferences | 1 |
| api_keys | 2 |
| sibling_keys | 4 |

| info_* | value |
|---|---|
| allocator_holdings | 3513 |
| audit_rows_b | 3701 |
| audit_null_subject_total | 510 |
| csv_daily_returns | 369 |
| compute_jobs | 102 |
| api_key_nav_marks | 29 |
| strategies | 0 |
| match_candidates | 14 |
| match_batches | 7 |
| allocator_equity_derived | 3 |
| api_keys | 2 |
| portfolios | 3 |
| portfolio_analytics | 3 |
| strategy_shares_created_by | 0 |
| user_app_roles | 1 |
| user_app_roles_granted_by_b | 0 |
| contact_requests | 0 |
| investor_attestations | 1 |
| allocator_preferences | 1 |
| bridge_outcomes | 2 |
| match_decisions_allocator_id | 2 |
| match_decisions_decided_by | 2 |
| auth_sessions | 2 |
| auth_identities | 1 |
| profiles | 1 |

The 4 sibling keys are other logins' keys on the same OKX venue account as Pair B's OKX key. One
of them belongs to Pair A. The chain asserts that all 4 survive.

**Founder decision (2026-11-25, verbatim AskUserQuestion answer):** "Go: I run the admin cmd (Recommended)"
— resume signal **go-founder-runs**: the orchestrator runs the chain through the PROD MCP, the
founder runs the admin-delete command.

## Task 2: re-measure, chain, auth delete (2026-11-25 UTC)

The marker query ran alone before every PROD statement and named PROD each time.

**Re-measure.** pair_b_ids = 1, every zero_* = 0, and every expect_* equal to Task 1's values
(holdings 3513, bridge_outcomes 2, match_decisions 2, match_candidates 14, match_batches 7,
allocator_preferences 1, api_keys 2, sibling_keys 4). Nothing re-pinned. Sibling-key ids read
once and held only in the session (count 4).

**Chain.** The filled 241-PAIRB-chain.sql ran as ONE MCP call and committed. No check raised.

**After the chain.** Pair B present = 1, as expected, because the chain leaves the auth user.
Every expect_* now reads 0. siblings_present = 4.

**Auth delete.** The channel moved from go-founder-runs to the orchestrator by founder
instruction (2026-11-25, verbatim: "please do that for me. You have it all. We saved the keys in
macos keychain. I authorize you"). The founder's first terminal attempt never ran: zsh read the
placeholder brackets as redirections. Keychain holds no service-role key, so the orchestrator read
it through the Supabase CLI login (`supabase projects api-keys`) into one shell process and never
printed it. 241-PAIRB-admin-delete.mjs printed `matches-before=1 deleted=1 matches-after=0` and
exited 0.

**Pair B deleted on PROD on 2026-11-25 (UTC).**

**Post-verify.** The marker query ran alone first and named PROD.
- Pair B present = 0
- Pair A present = 1
- audit NULL-subject = 4211, at the floor of 510 + 3701 = 4211
- siblings_present = 4, equal to expect_sibling_keys

## Pair A password reset

This is a founder step (CONTEXT ruling 2026-11-24). It is human_needed and pending; its date is
recorded when the founder confirms. No agent performed, attempted or prompted a credential change.

## Task 3: TODOS deletion (2026-11-25)

Commit `08ab1c718` `chore(241-04): delete the closed demo-credential TODOS entry` removes the
closed demo-credential entry (33 lines removed, 0 added; numstat `0	33`). The 15 sibling
`[158-OPS-03]` entries and `[158-OPS-04]` stay (counts 15 and 1). No live pointer to the deleted id
remains outside the planning directory. `node scripts/verify-plan-anchors.mjs --pending` printed
`OK: 15 plan file(s), no stale claims.`; the 11 TODOS-reading vitest files passed (558 tests).

Task 3 was run inline by the phase agent after a machine restart killed the previous agent; no
executor subagent was dispatched for it.

## Commits

- `15676567e` docs(241-04): Task 1 read-only preflight record
- `9869689be` docs(241-04): founder go recorded; Pair B chain committed on PROD
- `1d78dba45` docs(241-04): Pair B deleted on PROD 2026-11-25, post-verify clean
- `08ab1c718` chore(241-04): delete the closed demo-credential TODOS entry

## Deviations from Plan

- Auth-delete channel: the founder chose go-founder-runs, then instructed the orchestrator to run
  the admin tool itself (verbatim quote above). The rehearsed tool ran unchanged.
- The service-role key came from the Supabase CLI login, not the macOS Keychain the founder named;
  it lived in one shell process and was never printed.

## Self-Check: PASSED

- Pair B present = 0 on PROD and TEST; Pair A present = 1; siblings_present = 4.
- `grep -ac '158-OPS-03/SEC' TODOS.md` = 0; `[158-OPS-03]` = 15; `[158-OPS-04]` = 1.
- This record holds no login, id, digest or marker text.
