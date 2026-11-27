# Phase 242: SECRETSHYGIENE - Discussion Log

**Date:** 2026-11-26
**Mode:** smart discuss inside a background phase agent (no founder prompt available; brief: "the rest is your call")

Every hard-to-reverse question was decided on its recommended answer and is reported at handback for founder override. CONTEXT.md is the record.

## Full-history scan

| Question | Options | Selected |
|---|---|---|
| How are historical findings suppressed? | commit-scoped `.gitleaksignore` fingerprints; literals made obviously fake | fingerprints (history cannot be rewritten; no literal re-published) |
| What does "full history" cover? | main's history; every ref | main's history (31 findings measured vs 49 for all refs) |
| May a red scheduled scan block a redeploy? | yes, like the D-11 nightly; no (report only) | yes, and it files a labelled issue |

## Cron destinations

| Question | Options | Selected |
|---|---|---|
| Allowed destinations | exact two-origin set; a narrower pattern | exact set: the PROD analytics origin and the loopback discard literal |
| Scope of the migration | the two named functions; the CHECK and all four key-posting functions | the CHECK and all four (close gate (1) of the residuals entry) |

## Decided autonomously

[auto] [Full-history scan] — Q: "How is gitleaks installed in the scheduled job?" → Selected: "sha256-pinned 8.30.1 release binary, as supabase-migrate.yml does" (reversible technical — decided autonomously: one workflow step)
[auto] [Full-history scan] — Q: "How often does it run?" → Selected: "daily plus workflow_dispatch" (reversible technical — decided autonomously: one-line cron edit)
[auto] [Full-history scan] — Q: "What pins the workflow?" → Selected: "a vitest pin on schedule, binary pin, log-opts and no committed report" (reversible technical — decided autonomously: a test file)
[auto] [Cron destinations] — Q: "What does the refusal message say?" → Selected: "keep the existing non-echoing message" (reversible technical — decided autonomously: body text replaced anyway)
