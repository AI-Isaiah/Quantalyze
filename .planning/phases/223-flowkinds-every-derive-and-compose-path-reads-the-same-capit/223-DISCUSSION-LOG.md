# Phase 223: FLOWKINDS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-24
**Phase:** 223-flowkinds
**Areas discussed:** okx_archive_job live funding, FLOWK-03 realized refusal, C27 ownership

The phase agent could not ask the founder directly. It returned three questions with recommendations to the orchestrator, which put them to the founder in AskUserQuestion on 2026-11-24.

---

## okx_archive_job, a malformed live funding row

| Option | Description | Selected |
|--------|-------------|----------|
| Stop by name (Recommended) | `on_malformed="raise"`, `_Stop("live_anchor_unusable", "live_funding=malformed")` before any write | ✓ |
| Keep dropping | default drop, pinned by a test | |

**User's choice:** "Stop by name (Recommended)"

---

## FLOWK-03, a malformed realized row (count 0 on 2026-11-24)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep flagging (Recommended) | D-12 stays: flag, no refusal | ✓ |
| Switch refusal on | refuse the key; nothing would be refused today | |

**User's choice:** "Keep flagging (Recommended)"

---

## C27, the Bybit sync_funding walk over budget

| Option | Description | Selected |
|--------|-------------|----------|
| Out of scope, reported (phase agent's recommendation) | no published reader of `funding_fees` | |
| Yes, 223 fixes it | make it fit or fill the table, without hiding a timeout | ✓ |

**User's choice:** "Yes, 223 fixes it"

---

## Decided autonomously

[auto] [C27] — Q: "How does the Bybit funding walk fill the table inside a 180 s budget?" → Selected: "per 7-day window, both categories, upsert after each window, oldest first" (reversible technical — decided autonomously: handler and one fetcher keyword, no schema)
[auto] [C27] — Q: "Does the walk stop itself before the handler budget?" → Selected: "No self-deadline; the handler timeout stays the stop" (reversible technical — decided autonomously: one less mechanism, timeout stays visible)
[auto] [C27] — Q: "Category order inside a window" → Selected: "linear then inverse in the same window" (reversible technical — decided autonomously: shared cursor)
[auto] [PROOF-01] — Q: "How is each decision pinned?" → Selected: "one caller-level test each plus a C27 cancellation test, neutered RED then cp/cmp GREEN" (reversible technical — decided autonomously: test-only)

## Claude's Discretion

Test placement, the `_Stop` detail wiring, the fetcher keyword's name.

## Deferred Ideas

None beyond F-2 and ruling 2.
