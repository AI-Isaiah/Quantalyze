---
phase: 258-redumpdirect-after-a-prod-migration-apply-the-baseline-re-du
plan: 03
subsystem: infra
tags: [docs, lineage, supabase-migrate, baseline-redump, phase-gate]
requires:
  - phase: 258-01
    provides: the redump-push job and the direct-push script mode
  - phase: 258-02
    provides: the deleted bot-PR machinery and the corrected bot text
provides:
  - "supabase-migrate.yml comments that describe the direct push, with dated CORRECTED notes over the old text"
  - "a BASELINE.md Regenerating note on the direct push and the widened D-33 residual"
  - "the phase-gate readings on the tree all three plans produced"
affects: []
status: complete
commits: 3
plan_head_before: 5aa15bb2c8319b58b1403d1e98e11a52cfea190e
plan_head_after: 1ac5a084bc925471339fa64fc433672214602b5b
actuals:
  tokens: 7000
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns:
    - "dated CORRECTED note after the old text; the old text is kept as lineage"
key-files:
  created: []
  modified:
    - .github/workflows/supabase-migrate.yml
    - supabase/schema/BASELINE.md
    - .gitleaks.toml
    - src/__tests__/critical-regressions.test.ts
key-decisions:
  - "No decision of this plan's own. It records the founder ruling of 2026-11-27 (Push to main directly) in the files readers open."
requirements-completed: []
---

# Phase 258 Plan 03: say what the re-dump does now, and run the phase gate Summary

**Every human-facing description of the re-dump now says it is pushed straight to `main` by `redump-push` with the job token, with no PR and no reviewer, and what verifies the check-less bot commit is stated plainly. The phase gate passes on the merged tree: self-test 201 and 210 with gitleaks, 11 vitest files, actionlint, eslint, tsc and the planning-hygiene check.**

Comments and prose only. No rule, regex, path, allowlist, assertion or live workflow line changed.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 1e53e99ef | `supabase-migrate.yml`: header Flow step 6, the permissions comment, three `redump-dump` comments, and the block above `redump-push` (a to h, what verifies the bot commit, the recorded residuals, the deferred ideas) |
| 2 | da59521cf | `BASELINE.md` CORRECTED note (+6 lines, 0 deleted), `.gitleaks.toml` one line, `critical-regressions.test.ts` one line |
| 2b | 1ac5a084b | one more comment line under the old `redump-push` block heading so the heading reads as lineage |

`commits: 3` is the measured `git rev-list --count` over the ledger base.

## Phase gate readings (verbatim, on the tree after the last commit)

```
node scripts/baseline-redump.mjs --self-test
baseline-redump self-test OK: 201 assertion(s)

node scripts/baseline-redump.mjs --self-test --with-gitleaks
baseline-redump self-test OK: 210 assertion(s) (with gitleaks)
```

Both match the 258-02 record exactly, so no arm was lost or added without its pin.

```
vitest, 11 files (baseline-redump-wiring, supabase-migrate-test-first, critical-regressions,
ghcr-login-before-image-pull.contract, gitleaks-allowlist, baseline-wiring-claim,
test-restore-workflow-wiring, secret-scan-full-history, ci-apt-bounded.contract,
mutex-dead-holder-verdict, legacyretire-runbook-forms):
 Test Files  11 passed (11)
      Tests  706 passed | 1 skipped (707)
```

The one skip is `gitleaks-allowlist.test.ts` "advertises skip reason when the gitleaks binary is unavailable": by design it is skipped when the binary IS available (it is, gitleaks 8.30.1). It is not a silent skip of a live check.

The four wiring files alone, run after Task 1 (before the BASELINE, gitleaks and test-comment edits): `Test Files 4 passed (4)`, `Tests 255 passed (255)`.

```
actionlint .github/workflows/supabase-migrate.yml   actionlint-exit=0
npx eslint (baseline-redump-wiring, supabase-migrate-test-first, critical-regressions)   eslint-exit=0
npx tsc --noEmit   tsc-exit=0
npx tsx scripts/check-planning-hygiene.ts   exit 0
  [check-planning-hygiene] OK — 12774 tracked files scanned, none carry the local username or an absolute home path
  ROADMAP-STRUCTURE (rule 6) OK — 39 phase headings, 39 checklist bullets, 39 Progress rows
  STATE-POSITION (rule 7) OK
```

### Task verify gates (run before each commit, against HEAD)

- Task 1: `git-exit=0`, `comment-lines-added=75`, `live-lines-changed=0`. After the heading note: the diff against HEAD had 0 non-comment, non-blank changed lines.
- Task 2: `git diff --numstat HEAD -- supabase/schema/BASELINE.md` printed `6  0` (6 added, 0 deleted). `.gitleaks.toml` plus `critical-regressions.test.ts`: `git-exit=0`, `lines-added=2`, `non-comment-changed=0`. `### Regenerated ` heading count: `regen-head=62 regen-now=62`. No 64-hex value in the new paragraph, no "NOT WIRED YET" or "NO consumer" anywhere in BASELINE.md.
- Acceptance greps: workflow `CORRECTED 2026-11-27 (Phase 258)` 6 hits (needs 5 or more) before the heading note, 7 lines after; `Push to main directly` 1 line; `PUSH_ARGV` 1; `starts no workflow` 1; BASELINE.md `CORRECTED 2026-11-27 (Phase 258` 1, `compose-and-push` 1; `.gitleaks.toml` 1; `critical-regressions.test.ts` `redump-push` 1 or more.

## PROOF-01

No pin, arm or assertion was added or changed by this plan, so there is nothing to neuter. The gate that could fail here is the live-line diff gate; it reads 0 on both tasks, and the existing wiring and self-test pins run green on the edited tree.

## Security-review requirement 1: final sweep

Command: `grep -rnaE 'reviews and merges|D-13|D-23|D-24|automation/baseline-redump|redump-pr|bot PR|Approve workflows' .github scripts src supabase/schema .gitleaks.toml docs` (108 files hit, mostly other phases' own D-13 and D-23). I inspected every hit that is about the re-dump. Each remaining hit is lineage:

**`.github/workflows/supabase-migrate.yml`** (every `redump-pr`, bot PR, D-13, D-23, "reviews and merges" and "Approve workflows" hit is old text, each followed directly by a dated `CORRECTED 2026-11-27 (Phase 258)` note):
- lines 30-32 (header Flow step 6): old text, CORRECTED note at lines 33-39.
- line 172 (permissions comment, `redump-pr`): old text, CORRECTED note on the next lines.
- line 1270 (`redump-pr` below holds the write token): old text, CORRECTED note on the next lines.
- line 1401 (`redump-pr` below has read it): old text, CORRECTED note on the next line.
- lines 1412 (block heading), 1422-1427 (D-23 approval paragraph, D-13 never-merged paragraph with "A human reviews and merges every re-dump"), D-25 paragraph: the four old paragraphs, introduced by a CORRECTED note directly under the heading and a full CORRECTED block after them.
- lines 1436, 1440-1441: the CORRECTED block itself, which names D-13, D-23, D-11, D-12, D-24 and the bot PR as overridden or retired.

**`supabase/schema/BASELINE.md`**:
- 52 hits in historical `### Regenerated` sections (`composed onto main by the redump-pr job`): history of past regenerations, not edited (the plan and the security review both forbid it).
- lines 1567, 1568, 1590, 1596 (the AUTOMATED 2026-09-26 paragraph under `## Regenerating`): lineage, now followed by the new CORRECTED 2026-11-27 note at line 1615, which says to read it instead.
- line 1608 (the D-33 sentence "Such a dump reaches only the bot pull request ... nothing merges without a human", no pattern hit but the same claim): lineage, contradicted by name in the new note's D-33 paragraph.
- line 503: Phase 186 D-13, unrelated.

**`scripts/baseline-redump.mjs:1201`**: already a `CORRECTED 2026-11-27 (Phase 258)` line (plan 02). Line 49 likewise, and the self-test arm at 1872 asserts the composed text carries none of the old words.

**`src/__tests__/*`**: `critical-regressions.test.ts:1217` (the 2026-09-26 note, followed by the new 2026-11-27 line), `supabase-migrate-test-first.test.ts:317` (the 2026-09-26 WIDENED note, followed by the 2026-11-27 correction written by plan 01), `baseline-redump-wiring.test.ts` lines 5-22 (the original header, then the Phase 258 CORRECTED paragraph at lines 36-43), and line 1196 (a mutation fixture that deliberately points the refspec at the retired bot branch so the pin is proven to bite; it asserts, it does not describe behavior).

**`.gitleaks.toml:417`**: the sentence about "a bot branch", now followed by the CORRECTED line.

**Not about the re-dump** (other phases' own decisions that happen to carry the same id), left alone: `migration-drift-check.yml:18`, `ci.yml:3421,3427,3723,3975` (VAC-04 D-13), `scripts/prod-body-drift-check.sh:728`, `scripts/prod-prober/*` (prober D-13), `supabase/schema/baseline.sql` comments (several phases), `docs/sql-gate-lineage.md:311`, `docs/runbooks/*` (NAVMTM D-13 band, cron-sync D-13), `docs/architecture/adr-0023-audit-event-taxonomy.md` (D-23 atomic commit). No applied migration under `supabase/migrations` was edited, and no CHANGELOG entry was edited.

No live, non-lineage line says a human reviews or merges the re-dump.

## Security-review requirement 2: what verifies the bot commit

Stated in the workflow comment block above `redump-push` (items "WHAT VERIFIES THE BOT COMMIT" and "RECORDED RESIDUALS") and, in prose, in the BASELINE.md note: the `redump-dump` gates (five-class secret scan, sha256-pinned gitleaks, integrity gate, the shape gate that refuses any data statement so the content is schema only, marker regeneration), the push job's compose-side re-scan and offline gates (no-op and older-dump refusals, `--check-currency`, content-drift, staleness, version-bump mirror, staged-set judge), and the skip-token judge. Residuals: D-33 truncated dump, CI verdict only at the next push, Railway deploys the check-less commit.

## Facts for the ship-time CHANGELOG entry (this plan does not write CHANGELOG.md, VERSION or package.json)

- **Founder ruling**, 2026-11-27: "Push to main directly". It overrides D-13 (a human merges every re-dump) and D-23 (approval-required PR runs). D-11 (one reused PR), D-12 (approve or reopen) and D-24 (never force-push over a human commit) retire with the bot branch. D-25's one-refspec principle is kept, now `HEAD:refs/heads/main` as `PUSH_ARGV` in the script; D-21 and D-14 are kept (D-14's judged text widened to the commit message, CHANGELOG entry and Regenerated section).
- **Removed modes**: `--check-bot-branch` and `--open-or-edit-pr` (both now print `unknown argument(s)` and exit 1); twelve exports deleted (`BOT_BRANCH`, `DEFAULT_REPO`, `findPullRefsForSha`, `botBranchTip`, `judgeForeignCommits`, `judgeOpenBotPrs`, `openBotPrsCurlArgv`, `checkBotBranch`, `buildPrArgv`, `openOrEditPr`, `composePrBody`, `botPrStatus`); `composePrTitle` renamed `composeCommitTitle`. The job `redump-pr` became `redump-push` (`permissions: contents: write` only).
- **Removed self-test arms: 41** (226 to 201 is net minus 25, with 16 added). Plan 01: 1 (the PR-body file arm). Plan 02: 40, by group: 3 (4c, the no-op's bot-PR status notice), 8 (1c, PR-body presence arms: approve workflows, conclusions, branch protection, SHA-bound gh api, "what it adds" column, re-dispatch, close-and-reopen, never auto-merged), 17 (4c, bot-branch check), 12 (4d, open-or-edit-PR).
- **New arms and pins: 16 arms** (plan 01: 4 in section 4e: PUSH_ARGV frozen, takePushToken, first-try push, empty token; 10 in section 4f: race then success, not a race, exhausted, re-compose no-op, newer marker, migration merge, fetch failure, remote name, token boundary across a retry, skip token; plan 02: 2 in section 1c: the composers name `redump-push` and the direct push, `composeCommitTitle`). Wiring pins: no live git push and no gh pr line in the workflow, `PUSH_ARGV` frozen, permissions exactly `{contents: write}`, one `GH_TOKEN` env, token taken from `process.env` first in `main()`, script-region push literal and spread.
- **Accepted limits**: the bot commit on `main` carries zero Actions runs by construction (a `GITHUB_TOKEN` push starts no workflow; not the skip-trailer failure); Railway deploys the check-less commit; the next push's predecessor verdict is `absent` so it runs the FULL `sql-mutation` and skips the docs-only short path; `ci.yml` and `sql-function-snapshot.yml` first run over the re-dump tree at the next push (precedent PR #1398, `NAME_SET_RATCHET`).
- **Widened D-33 residual** (`### Notes`): a dump truncated after its `CREATE EXTENSION` lines is not refused and now reaches `main` itself with no reviewer.
- **Rollout (CONTEXT `<specifics>`)**: bot PR #1401 (`automation/baseline-redump`, v0.133.106.1) is open at booking time. After this phase merges it is either merged by the main session as before or closed with the bot branch deleted. If closed unmerged, a `workflow_dispatch` of `supabase-migrate.yml` on `main` re-dumps and is the first live proof of the direct push; otherwise the next migration merge is. The verification records which happened. The live push is NOT proven by this phase.
- **Open question for the main session**: add a CLAUDE.md note that a check-less re-dump commit on `main` is normal (CONTEXT "Decided autonomously", Docs)? This phase did not edit CLAUDE.md.

## Deviations from Plan

**1. [Placement] The `.gitleaks.toml` line sits at the end of the WR-03 paragraph, not mid-sentence.**
The plan says to insert after "the sentence saying the gate runs before a bot branch is pushed". That sentence continues into the next clause ("and the default rules did not match either class"), so a comment line inserted there would split it. The line was placed after the paragraph's last line (`# 0 findings from either rule.`). Text, count and rule content are as specified.

**2. [Rule 2 - security review requirement] One extra comment line in `supabase-migrate.yml`** under the old `redump-push` block heading ("PUT THE GATED RE-DUMP IN FRONT OF A HUMAN, AS ONE BOT PR"), so that no live comment reads as a human-review step before the reader reaches the CORRECTED block. Separate commit 1ac5a084b. Comment only.

**3. [Process] Task 1 is `type="tracer"`** and its `<verify>` (live-line gate, actionlint, the four wiring files) is fully automated, so the tracer gate was satisfied by the Task 1 verify run; no human checkpoint was raised.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. T-258-10 to T-258-13 are handled as the plan registers them: the widened D-33 residual is recorded in the workflow comment and in BASELINE.md; the check-less bot commit is described as normal by construction; the live-line diff gate printed 0.

## What is NOT proven

The live push. Nothing in this phase exercises GitHub's acceptance of a `contents: write` job-token push to an unprotected `main`; the first real `supabase-migrate.yml` run on `main` after merge does.

## Self-Check: PASSED

- Files modified exist: `.github/workflows/supabase-migrate.yml`, `supabase/schema/BASELINE.md`, `.gitleaks.toml`, `src/__tests__/critical-regressions.test.ts`.
- Commits `1e53e99ef`, `da59521cf` and `1ac5a084b` are ancestors of HEAD on `gsd/phase-redumpdirect`.
- `STATE.md`, `ROADMAP.md`, `CHANGELOG.md`, `VERSION` and `package.json` were not touched.
