---
phase: 241-democreds-the-two-demo-accounts-are-gone-and-their-passwords
verified: 2026-11-25T00:00:00Z
status: passed
score: 4/4 roadmap success criteria verified (SC-1 as narrowed 2026-11-24); the founder step is done
verified_at_sha: c4a9f9ea16d6df879aac3733d7205b18ef26400a
drift_subjects:
  - scripts/check-demo-credential-digests.ts
  - src/__tests__/check-demo-credential-digests.test.ts
  - src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts
  - vitest.node-env.ts
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Founder resets Pair A's password (the shared e2e login) himself, then confirms the date so it is recorded"
    expected: "The leaked Pair A credential no longer authenticates; the account stays (admin role, 1 of PROD's 2 published strategies, a daily-syncing key). The reset date is recorded in the phase record. No agent performs or prompts the reset."
    why_human: "Founder-only step by ruling 2026-11-24 (CONTEXT, ROADMAP SC-1 narrowing). It is a credential change on a live admin account; no agent may do it and the repo cannot show it. Until it is done the leaked Pair A credential is still live, so 158-OPS-03 is closed in the tree but not yet closed in fact."
  - test: "Spot-confirm the Pair B deletion evidence if an independent audit is wanted"
    expected: "Pair B absent on TEST and PROD (241-04-SUMMARY records present=0 on both, Pair A present=1, 4 sibling keys survive, audit NULL-subject at its floor), dated 2026-11-24 (TEST) and 2026-11-25 (PROD)."
    why_human: "This verification had no database access by design. The PROD and TEST deletions rest on dated orchestrator records in 241-04-SUMMARY.md, not on a query run here."
---

# Phase 241: DEMOCREDS Verification Report

**Phase Goal:** The two demo accounts no longer exist, and their passwords are out of the tree behind a guard that still bites, closing `158-OPS-03` (F-3). Narrowed by founder ruling 2026-11-24: Pair A is kept and the founder resets its password himself; Pair B is deleted on TEST and PROD.
**Verified:** 2026-11-25 at HEAD `9492075b5`
**Status:** passed (no gaps found; the founder step was done 2026-11-26)
**Re-verification:** No, initial verification

No credential, login, id, digest or marker text appears in this report. Pairs are named by role.

## Evidence limits (stated up front)

- No database was queried. Pair B's absence on TEST and PROD is taken from the dated records in `241-04-SUMMARY.md` (counts and dates only), as instructed. Those are orchestrator records, not evidence this verifier produced.
- Pair A's password reset cannot be seen from the repo. It is a human item.

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | SC-1 (narrowed): Pair B does not exist on TEST or PROD, dated, no literal in the record. Pair A kept; its reset is the founder's step. | VERIFIED for Pair B (record-based); Pair A reset DONE 2026-11-26, see Founder step record | `241-04-SUMMARY.md`: TEST deleted 2026-11-24 and re-verified present=0 on 2026-11-25; PROD chain committed and the admin-API delete printed matches-before=1, deleted=1, matches-after=0 on 2026-11-25; post-verify Pair B present=0, Pair A present=1, siblings_present=4, audit NULL-subject at the 4211 floor. The record holds counts and dates only. The ROADMAP entry and `241-CONTEXT.md` both carry the dated CORRECTED note for the narrowing. The PROD deletion was rehearsed on the lane first (`241-03-SUMMARY.md`: 9 PASS, 0 FAIL; four chain checks each neutered to RED by name and restored by `cp` then `cmp`). |
| 2 | SC-2: No tracked file contains either demo password literal. The guard checks a digest, and goes RED when a matching literal is planted. | VERIFIED | Run here: `npx tsx scripts/check-demo-credential-digests.ts` printed `OK, 12191 tracked files, 263484537 bytes scanned against 4 digest rows; 0 matches`, exit 0. The four digests appear in no tracked file other than the guard script itself (the test derives its canary at runtime). Source has no path allowlist, reads every `git ls-files` path as raw bytes, and fails on EMPTY-SCAN, UNREADABLE and the floors. Plan 01's records scrub covers all 12 archived files (`git diff --name-only` of the scrub range lists 12; whole-tree census after it showed literals only in the e2e test, which plan 02 then cleaned). RED on a plant is recorded in 241-02-SUMMARY P-03 to P-11 and reproduced below. |
| 3 | SC-3: Seed and drain paths are retired or redirected as decided; the suites that read them run green. | VERIFIED | Decision recorded in CONTEXT (founder, keep as proposed): the seed reads its allocator login from the `DEMO_SEED_ALLOCATOR_*` environment variables, nothing reads either account, drain parses only fixed key ids. The non-planning diff (`6e8df792..HEAD`) touches no seed or drain file, consistent with that decision. The 11 TODOS-reading suites (558 tests) and the 28-file pre-push list (956 passed, 1 by-design skip) are recorded green in 241-04 and 241-02 SUMMARYs. The two suites asked for here passed on this run (22 tests). |
| 4 | SC-4 / PROOF-01: the guard and any changed seed pin go RED on a neutered copy with the named arm first, restored from a byte backup, GREEN again, recorded without a literal. | VERIFIED | 241-02-SUMMARY has 19 rows (P-01 to P-19) in neuter, command, RED, restore (`cp` then `cmp`), GREEN form, including a binding row showing the digest row is what makes the live arm bite. 241-03-SUMMARY has R-01 to R-04 for the delete chain. Independently reproduced here: replacing the sha256 comparison in the guard with a constant made 5 arms fail (canary arm first, then case, edges, failure-text, every-window); restored from a scratch backup, `cmp` exit 0, 17 of 17 passed again. No seed pin changed, so no seed row is owed (stated in the SUMMARY). |

**Score:** 4/4 criteria verified; Pair A's reset is the one open item and routes to human verification, not to a gap.

## Artifacts

| Artifact | Status | Details |
|---|---|---|
| `scripts/check-demo-credential-digests.ts` | VERIFIED (exists, substantive, wired, data flows) | 286 lines. Wired as the last link of `npm run lint` in `package.json`. `ci.yml` `frontend-lint` runs `npm run lint` with no path filter (per 241-REVIEW, not re-read here). |
| `src/__tests__/check-demo-credential-digests.test.ts` | VERIFIED | 17 arms pass: per-role live arms, table-shape, canary, edges, case, coverage, floors, EMPTY-SCAN, verdict, CLI subprocess, wiring. Registered in `vitest.node-env.ts`. |
| `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` | VERIFIED | Pair A literals gone; keeps env-sourcing and a structural no-quoted-credential arm (P-19 shows it can fail). Passes. |
| 12 archived planning files | VERIFIED | Replaced by role placeholders; guard scan over the whole tree is clean. |
| `TODOS.md` entry deletion | VERIFIED | `grep -ac '158-OPS-03/SEC' TODOS.md` is 0. The 15 sibling `[158-OPS-03]` entries remain (15). The diff to `TODOS.md` against the phase base is 33 lines deleted, 0 added. No non-planning file cites the deleted id. |
| `241-PAIRB-*` chain, census, exists, admin-delete, rehearse, catalog files | VERIFIED as records of what ran | Fingerprinted in 241-03-SUMMARY and re-checked against it by 241-04 Task 1. Not executed here, as instructed. |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Guard passes on the live tree | `npx tsx scripts/check-demo-credential-digests.ts` | OK line, 0 matches, exit 0 | PASS |
| Guard and e2e gate suites | `npx vitest run src/__tests__/check-demo-credential-digests.test.ts src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts --testTimeout=120000` | 2 files, 22 tests passed | PASS |
| Guard arms can fail (PROOF-01, independent) | neuter the sha256 confirm from a byte backup, re-run the guard suite, restore | 5 arms RED, canary arm first; after `cp` and `cmp` (exit 0), 17 of 17 GREEN | PASS |
| TODOS closure | `grep -ac '158-OPS-03/SEC' TODOS.md` | 0 | PASS |
| Digests not copied elsewhere | whole-tree fixed-string search for the four digests, file names only | only the guard script | PASS |

## Key Links

| From | To | Via | Status |
|---|---|---|---|
| `package.json` `lint` | `scripts/check-demo-credential-digests.ts` | `&& tsx scripts/check-demo-credential-digests.ts` as the last link | WIRED (pinned by the wiring arm) |
| guard vitest file | guard script | imports `scanTree`, `scanBuffer`, `verdict`, `DIGEST_TABLE`; CLI subprocess arm | WIRED |
| `vitest.node-env.ts` | guard vitest file | node-env list entry | WIRED |

## Requirements Coverage

| Requirement | Plans | Status | Evidence |
|---|---|---|---|
| SECR-01 | 03, 04 | SATISFIED as narrowed (Pair B on TEST and PROD, record-based). Pair A is kept by ruling, and its reset was done 2026-11-26 (see Founder step record). | 241-04-SUMMARY, 241-03-SUMMARY, ROADMAP and CONTEXT CORRECTED notes. REQUIREMENTS.md still shows SECR-01 unticked and its text still says both accounts; the narrowing is recorded in the ROADMAP and CONTEXT, so a milestone-audit reader should read those. |
| SECR-02 | 01, 02 | SATISFIED | Guard clean over 12191 files, records scrubbed, arms bite. |
| PROOF-01 | 02, 03 | Phase-level evidence SATISFIED. The requirement is milestone-wide and closes at the v1.22 audit. | Rows listed under SC-4. |

No ORPHANED requirement: SECR-01 and SECR-02 are the only IDs mapped to Phase 241 and both are claimed.

## Anti-Patterns

| File | Pattern | Severity | Impact |
|---|---|---|---|
| (none) | No `TBD`, `FIXME` or `XXX` marker introduced in the changed non-planning files was found by the review or required action; the guard has no stub paths | none | none |

## Code review

`241-REVIEW.md` round 2 is `status: clean`. Round 1's two MEDIUM findings (CLI verdict untested, fold on the leaving byte unpinned) are resolved in `fcb98c6dd`, and I re-ran the suite at HEAD green. Remaining LOW and INFO items (digest-table shape invariants, an env-fallback shape in the e2e structural arm, encoded-form blind spots, banner wording, the CLI failure branch only exercised on a clean tree) are recorded in that report only, per this repo's rule.

## Notes for the reader (not gaps)

- The guard's honest limit is stated in its header: a sha256 of a short password can be brute-forced by someone holding the digest, which is why the digests are accepted as tripwires and not as secrecy. The leaked Pair A password is dead only once the founder resets it.
- Pair A's bare login local part, without its domain, remains in 5 archived planning files. The full-login digest cannot see it. CONTEXT records this as deferred: a login is not a secret and it is outside the phase scope.
- `241-PROD-MEASUREMENT.md` mislabelled one strategies foreign key as no action; `241-04-SUMMARY.md` corrects it (it is set-null) and notes it did not apply to Pair B.
- The ROADMAP progress row reads "Executed; review and ship pending". The code PR and the records PR still have to ship; ship must keep `.planning` out of the code PR.

## Item 2 re-measurement, 2026-11-26 (read-only, marker query run first on each database)

Human item 2 (spot-confirm the Pair B deletion) was re-measured live rather than read from `241-04-SUMMARY.md`:

| Check | TEST | PROD |
|---|---|---|
| Pair B present | 0 | 0 |
| Pair A present | 0 (never seeded there; `241-04-SUMMARY.md` is silent on it) | 1 |
| OKX keys sharing Pair A's venue account | n/a | 4, equal to the SUMMARY's `expect_sibling_keys` |

Limit: Pair B's key is deleted, so the sibling count is a stand-in query keyed on Pair A's OKX venue account. It matches the expected number and does NOT prove they are the same 4 rows the delete left behind. Counts and dates only; no literal is recorded.

Item 1 (the founder resets Pair A's password) was open at this reading and is recorded done below.

## Founder step record, 2026-11-26

Human item 1 is DONE. The founder reset the shared e2e Pair A login's password through the product's password-reset flow on PROD and signed in with the new password. The leaked Pair A credential no longer authenticates, so `158-OPS-03` is now closed in fact as well as in the tree. Human item 2 was recorded in #1379. No credential, login or id is recorded here.

## Gaps Summary

No gaps. Every roadmap success criterion is met in the repository, and the guard's ability to fail was reproduced independently here. The phase was held at `human_needed` only because Pair A's password reset is a founder-only step that nothing in the repo can show. It is recorded done below.

---

_Verified: 2026-11-25_
_Verifier: Claude (gsd-verifier)_
