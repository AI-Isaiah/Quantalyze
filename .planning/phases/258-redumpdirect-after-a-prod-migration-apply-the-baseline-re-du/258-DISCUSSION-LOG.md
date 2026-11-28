# Phase 258: REDUMPDIRECT - Discussion Log

**Date:** 2026-11-27
**Mode:** autonomous smart discuss, run by a phase agent that cannot ask the founder. The founder's ruling arrived in the phase brief; every hard-to-reverse choice below was taken with a recommendation and is surfaced in the handback for the founder to override.

## Founder ruling (from the brief)

| Choice offered | Answer |
|---|---|
| Bot token / Claude allow rule / Push to main directly | "Push to main directly" |

## Main's CI and Railway (hard to reverse; recommendation taken)

| Option | Chosen |
|---|---|
| Accept a check-less bot commit on main and record what it gives up | ✓ |
| Wait in the job for the parent's CI (tolerating baseline drift) before pushing | |
| Dispatch ci.yml on the bot commit | |
| Tokenless pre-push verify job (npm ci + dump-sql-functions --check) | |

## Race with concurrent merges (recommendation taken)

| Option | Chosen |
|---|---|
| Re-compose onto fresh main and push again, only when origin/main moved; 3 attempts; fail loud | ✓ |
| git rebase the bot commit and push | |
| Force-push | never |

## Decided autonomously

[auto] [Script] — Q: "Where does the compose-push-retry loop live?" → Selected: "A new self-tested mode of scripts/baseline-redump.mjs" (reversible technical — decided autonomously: a local addition)
[auto] [Script] — Q: "What happens to the bot-branch and PR modes?" → Selected: "Removed, EXPECTED_ASSERTIONS re-measured, each removed arm named in the SUMMARY" (reversible technical — decided autonomously: git history restores them)
[auto] [Script] — Q: "How is the push token kept from compose's children?" → Selected: "Only the push child's environment carries it, proven by a self-test arm" (reversible technical — decided autonomously: internal)
[auto] [Workflow] — Q: "Job name" → Selected: "redump-push" (reversible technical — decided autonomously: one file and its pins)
[auto] [Docs] — Q: "Edit CLAUDE.md?" → Selected: "No; ask the main session in the handback" (reversible technical — decided autonomously: prose only)
