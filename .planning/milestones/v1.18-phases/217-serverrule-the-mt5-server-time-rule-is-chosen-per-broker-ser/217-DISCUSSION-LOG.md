# Phase 217: SERVERRULE - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-18
**Phase:** 217-serverrule
**Areas discussed:** Rule carrier, Unmapped mismatch, utc representation

---

## Rule carrier (Q1)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Railway map by hash | `MT5_SERVER_TIME_RULES` hash→eu/us/utc; default stays `MT5_SERVER_TIME_RULE` (recommended) | ✓ |
| (b) Railway map by name | Same, keyed by server name (house `MT5_KNOWN_SERVERS` pattern) | |
| (c) Tracked code constant | hash→rule in code; ships on deploy, any new server needs a PR | |
| (d) DB column/table | Needs a migration and an admin path; closest to writing back | |

**User's choice:** "Railway map by hash (Recommended)". The coordinator sets the server entry after deploy.

---

## Unmapped mismatch (Q2)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep refusing | 155.1 D-01 as is (recommended) | |
| Write and alert | Persist under the default rule and page; can write mis-dated days | ✓ |

**User's choice:** "Write and alert" — explicit founder override of 155.1 D-01 for unmapped servers only; the mis-dated-day cost is accepted.

---

## utc representation

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed offset 0 | Stored as `configured_rule='fixed'`, expected 0, no migration (Claude's call) | ✓ |
| New `utc` rule id | Needs a migration to widen the CHECK | |

**User's choice:** Claude's call accepted.

## Decided autonomously

[auto] [Selection point] — Q: "When is the per-server rule picked?" → Selected: "parse pre-read, select once post-read from the PRE account_info server hash" (reversible technical — decided autonomously: control flow inside one handler)
[auto] [Selection point] — Q: "Which server value keys the lookup?" → Selected: "server_label_hash(account_info().server)" (reversible technical — decided autonomously: one-line choice)
[auto] [Selection point] — Q: "Blank or missing server?" → Selected: "unmapped, default rule" (reversible technical — decided autonomously: local branch)
[auto] [Map grammar] — Q: "Value syntax?" → Selected: "comma-separated <hash>=<rule>" (reversible technical — decided autonomously: parser pinned by tests)
[auto] [Map grammar] — Q: "Full hash or prefix?" → Selected: "full 64-hex" (reversible technical — decided autonomously: exact equality)
[auto] [Alert] — Q: "How is an unmapped mismatch heard?" → Selected: "ops_alert.page with a new closed-set cause, value-free detail" (reversible technical — decided autonomously: internal naming)
[auto] [Readings] — Q: "Row for an unmapped mismatch?" → Selected: "unchanged shape, verdict mismatch" (reversible technical — decided autonomously: no schema change)
[auto] [Tests] — Q: "How is it proven?" → Selected: "leaf + job-level tests that go RED when neutered" (reversible technical — decided autonomously: test layout)

## Claude's Discretion

Names, helper placement, and the adaptation of `test_one_clock_per_derive`.

## Deferred Ideas

None.
