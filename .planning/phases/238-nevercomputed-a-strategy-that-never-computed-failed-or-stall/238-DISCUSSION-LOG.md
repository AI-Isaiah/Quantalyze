# Phase 238: NEVERCOMPUTED - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-24
**Phase:** 238-nevercomputed
**Areas discussed:** FACT-03 encoding, FACT-05 note wording, public-link note scope, shipping split

The phase agent cannot ask the founder directly. It returned the questions to the coordinator, who asked them in AskUserQuestion on 2026-11-24 and relayed the answers verbatim.

---

## FACT-03 encoding (hard to reverse)

| Option | Description | Selected |
|--------|-------------|----------|
| A. Nullable `computed_at` | Migration: drop DEFAULT and NOT NULL, trigger-aware NULL backfill, census and move every reader in the same PR; reverses R-04; waits behind 233 | ✓ |
| B. Separate stored marker | Additive column written by the runner success write; R-04 stays; readers still censused; two date sources | |
| C. Derived marker, no migration | TS-only predicate (not complete AND no stored figures); inference; SQL and Python readers handled separately | |

**User's choice:** "A: allow an empty date (Recommended)"

---

## FACT-05 note wording (product, asked neutrally)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Reuse the remedy | The action `ownerRemedy` names per state and shape | ✓ |
| (b) One new sentence | One action sentence for all three states | |
| (c) Three new notes | State-specific copy with its own KCS12 ids | |
| (d) Drop the wait clause | Name no action, rely on the remedy line; does not meet the TODOS closing condition | |

**User's choice:** "(a) Reuse the remedy (Recommended)"

---

## Public-link note scope

| Option | Description | Selected |
|--------|-------------|----------|
| In scope | Fix `PUBLIC_URL_NOTE` in the same PR | ✓ |
| Out of scope | Book it | |

**User's choice:** "Yes, same PR (Recommended)"

---

## Shipping split

| Option | Description | Selected |
|--------|-------------|----------|
| FACT-05 first as PR-1, FACT-03 as PR-2 | PR-1 no migration ships now; PR-2 waits for 233 and the migration lane | ✓ |
| One PR | Everything waits for 233 | |

**User's choice:** followed from Q1=A per the coordinator: PR-1 now (FACT-05 plus the public note), PR-2 after 233 and a free lane.

---

## Claude's Discretion

- The exact sentence for each new note, within DESIGN.md's voice, reusing `ownerRemedy` texts.
- How a published row's note learns its state (state-free sentence vs reading jobs for published rows).

## Decided autonomously

[auto] [FACT-05] — Q: "Where do the FACT-05 tests live?" → Selected: "a page.key-pill.test.tsx case per state with the it.each re-pointed" (reversible technical — decided autonomously: test layout only)
[auto] [FACT-05] — Q: "Does the in-progress note (KCS12-MINT-A) change?" → Selected: "No" (reversible technical — decided autonomously: one untouched constant)
[auto] [FACT-05] — Q: "Do the analytics_failed and finished_not_built notes change?" → Selected: "No" (reversible technical — decided autonomously: untouched constants)
[auto] [FACT-03] — Q: "What shape is the reader census?" → Selected: "a vitest source-reading pin failing on an unclassified reader" (reversible technical — decided autonomously: a test file)
[auto] [Ship] — Q: "Which TODOS entries are deleted, and when?" → Selected: "170.1 entry in PR-1, 166.5 entry in PR-2" (reversible technical — decided autonomously: CLAUDE.md rule)

## Deferred Ideas

None.
