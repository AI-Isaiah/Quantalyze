---
phase: 244-accessguards-an-owner-read-without-its-key-id-fails-to-compi
plan: 02
subsystem: audit-law
tags: [audit, H-0001, DBACC-05, audit-skip, founder-exemption, ratchet]
requires: []
provides:
  - "H_0001_UNCOVERED_ALLOWLIST as a typed empty array asserted at length 0"
  - "six write sites each carrying a recorded disposition the gate reads"
affects: [src/__tests__/audit-coverage.test.ts]
tech-stack:
  added: []
  patterns: ["in-window @audit-skip pragma (8 lines above the chain start)", "exact-set allowlist ratchet that only shrinks"]
key-files:
  created: []
  modified:
    - src/app/api/admin/partner-import/route.ts
    - src/app/api/cron/flag-monitor/route.ts
    - src/app/api/keys/sync/route.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/__tests__/audit-coverage.test.ts
decisions:
  - "DBACC-05 founder decision 2026-11-26 ('Approve as proposed', recorded in 244-CONTEXT.md): site 1 covered by the admin.partner_import roll-up row, sites 2-6 founder exemption."
  - "Ratchet ends at 0 as a typed empty array so both drift arms stay live; it never gains an entry."
status: complete
completed: 2026-11-26
duration: ~25 min
actuals:
  tokens: 6000
  tasks: 3
  commits: 2
plan_head_before: 6e5f1840f053d2f43c21f8f807eaea3afe6af171
plan_head_after: 1de604f414025986a7fc0da499547a4ecd1ded05
---

# Phase 244 Plan 02: DBACC-05 audit law Summary

H-0001 ends at zero: partner-import's `profiles` upsert is shown covered by its `admin.partner_import` roll-up row through the moved pragma, the other five sites carry a dated founder-exemption pragma, and the exact-set allowlist went 6 -> 5 -> 0 and stays as a typed empty array.

## What changed

- **Task 1 (tracer), commit `610a9d65d`.** Moved the existing 4-line `@audit-skip: bulk-import row; rolled up into a single` block in `src/app/api/admin/partner-import/route.ts` from above the P325 comment to directly above the first `profileErr` upsert (byte-for-byte, no duplicate: `@audit-skip` count stays 4). Deleted the partner-import allowlist entry and lowered the length literal 6 -> 5 in the same commit. Gate green.
- **Task 2, commit `1de604f41`.** Added one `@audit-skip: founder exemption 2026-11-26 (Phase 244 DBACC-05) - <class>` pragma (2 comment lines) directly above each of: the two flag-monitor `feature_flags` upserts (internal cron counter), `stampCompositeFailedUnlessComplete`'s upsert in keys/sync, and the `compositeMemberCount` and `unifiedFinalizeWizardHandler` upserts in finalize-wizard (derived strategy_analytics compute state). Deleted the remaining five allowlist entries (declaration is now `ReadonlyArray<{ file: string; snippet: string; reason: string; }> = []`), literal 5 -> 0, added the dated closure paragraph (2026-11-26) with per-site dispositions to the header, and reworded the four TODOS pointers (header "stays open under H-0001", header census citation, detector-history comment, comment above the length assertion). Only comment lines changed in the four route files (diff against the plan base: 18 changed lines, 0 non-comment). No upsert statement, argument or ignored error result was touched (CONTEXT Deferred Idea).
- **Task 3.** PROOF-01 neuters N1 and N2 and the route-reading regression sweep; no file changes (both files byte-identical to their commits afterwards).

## PROOF-01 evidence (verbatim)

Byte backups under the session scratchpad `244/` directory; restored with `cp`, verified with `cmp`; no git checkout/restore/stash used.

**N1 - exemption pragma removed** (the two-line pragma above site 3's reset upsert in `src/app/api/cron/flag-monitor/route.ts`):

```
 FAIL  |jsdom| src/__tests__/audit-coverage.test.ts > audit coverage: every mutation site in src/app/api must emit or skip > every .insert/.update/.delete/.upsert has a logAuditEvent or @audit-skip
Error: Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist:
  src/app/api/cron/flag-monitor/route.ts:640
    > await admin.from("feature_flags").upsert(
 Test Files  1 failed (1)
      Tests  1 failed | 27 passed (28)
```

Restore: `cp <backup> src/app/api/cron/flag-monitor/route.ts; cmp <backup> src/app/api/cron/flag-monitor/route.ts` -> `cmp=0`. GREEN rerun: `Test Files  1 passed (1)`, `Tests  28 passed (28)`.

**N2 - site 1's block moved back out of the window** (4-line roll-up block returned above the P325 comment in `src/app/api/admin/partner-import/route.ts`, diff 4+/4-):

```
Error: Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist:
  src/app/api/admin/partner-import/route.ts:707
    > const { error: profileErr } = await admin.from("profiles").upsert(
 Test Files  1 failed (1)
      Tests  1 failed | 27 passed (28)
```

Restore: `cp` back, `cmp` -> `cmp=0`. GREEN rerun: `Test Files  1 passed (1)`, `Tests  28 passed (28)`. `git status --porcelain` on both files printed nothing afterwards.

## Verification

- `npx vitest run src/__tests__/audit-coverage.test.ts`: 28 passed (28), allowlist at zero.
- `npx eslint` on the five files: exit 0.
- All Task 1 and Task 2 acceptance greps hold (pragma counts 2/1/2, class-name counts, `file: "src/app/api/` count 0 inside the allowlist, `toHaveLength(0)` assertion present, stale TODOS phrases 0).
- Route-reading regression sweep: `Test Files  33 passed (33)`, `Tests  1952 passed (1952)`, no FAIL line.

## Deviations from Plan

**1. [Observation, no fix] Sweep file count is 33, not the plan's 34.** The plan's command (grep for the four route paths plus the four `ls` globs, de-duplicated) resolves to 33 test files in this worktree at the phase-branch base. All 33 pass. `audit-coverage.test.ts` (run separately, 28 passed) is the gate under change and does not match the route-path grep; no test that reads these routes was left unrun. The plan's "fewer than 34" fails_when threshold was a measurement taken at another sha; the sweep itself is green.

Otherwise none - plan executed as written.

## Known Stubs

None.

## Threat Flags

None. Comment-only edits in routes; no new endpoint, auth path or schema.

## Notes for ship

- TODOS id this plan closes: `[H-0001]` (section "Phase 163 / SEC-03 - H-0001 census RE-MEASURED"); ship deletes it and names it in the CHANGELOG.
- The exemption is a costly-to-reverse compliance judgment owned by the founder (CONTEXT).

## Self-Check: PASSED

- Commits `610a9d65d` and `1de604f41` are ancestors of HEAD.
- Modified files exist; working tree clean before this SUMMARY.
