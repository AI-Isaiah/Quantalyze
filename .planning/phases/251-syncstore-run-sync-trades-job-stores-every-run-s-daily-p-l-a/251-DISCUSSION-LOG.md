# Phase 251: SYNCSTORE - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-26
**Phase:** 251-syncstore
**Areas discussed:** store order, refusal store, flag write, re-read outcome

Run by a phase agent without founder access: each area took the recommended option.

---

## Store order (item 1)

| Option | Description | Selected |
|--------|-------------|----------|
| Store Phase 1 right after its read, flag write stays at the end | Smallest move; a cancelled run loses only its flags, re-derived next run | ✓ |
| Store Phase 1 and write flags before Phase 2 | Two flag writes per run, larger diff | |

## Refusal store (item 2)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `daily_pnl_read_verdict`; refuse store, hold last_sync_at, DONE, still enqueue follow-on; rate limit re-raised | Mirrors derive and cron | ✓ |
| Route a refusal through phase1_failed | Stamps an untrue persist-failed flag | |
| Return FAILED on a refusal | Retries a deterministic refusal | |

## Flag write (items 3, 4)

| Option | Description | Selected |
|--------|-------------|----------|
| Owned refusal keys replaced every ccxt run; malformed left to derive | Truthful, one read per sync | ✓ |
| Pop every `daily_pnl_*` key including malformed | Clears a full-history flag on a partial read | |

## Re-read outcome (TODOS 222-SYNCTRADES-REREAD-FAILED)

| Option | Description | Selected |
|--------|-------------|----------|
| DONE on a raised re-read, FAILED kept on a raised write; log names the failing call | Consistent with the first-read arm (T-222-13) | ✓ |
| FAILED, log line fixed only | Round-3 reviewer's reading; can unpublish at last attempt | |

## Decided autonomously

[auto] [Tests] — Q: "How are the item tests driven?" → Selected: "Mocked-supabase handler tests, ingestion flag monkeypatched" (reversible technical — decided autonomously: test files only)
[auto] [Tests] — Q: "How is the live-lane RED shown under the load limit?" → Selected: "Mocked unit RED locally, live test in CI" (reversible technical — decided autonomously: can run locally later)
[auto] [Scope] — Q: "Does the cron path change?" → Selected: "No" (reversible technical — decided autonomously: cron already refuses)

## Claude's Discretion

- Shape of the owned-key helper.

## Deferred Ideas

- Carrying sync refusal keys through the derive's wholesale rebuild.
