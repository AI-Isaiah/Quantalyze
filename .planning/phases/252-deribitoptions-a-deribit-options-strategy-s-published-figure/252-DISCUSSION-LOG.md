# Phase 252: DERIBITOPTIONS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-25
**Phase:** 252-deribitoptions
**Areas discussed:** Remedy

---

## Remedy

| Option | Description | Selected |
|--------|-------------|----------|
| Mark-to-market only | Switch the headline to a market-price basis. MTM has never run on PROD, its daily marks are trade candles that fail loud on a held day with no trade, and whether it moves the cumulative was unmeasured. | |
| Named withhold only | Withhold the headline of a Deribit options book measured on the cash wallet, using the existing `unsmoothed_options_book` flag as the trigger. This extends D-05. | |
| Withhold first, then MTM (Recommended) | Ship the named withhold now on every surface, then measure market-price valuation and switch the headline only if it works for these keys. | ✓ |

**User's choice:** "Withhold first, then MTM (Recommended)" (founder, AskUserQuestion via the coordinator, 2026-11-25)
**Notes:** The option text says the ruling extends D-05 and is accepted like the 233 structural withholds the same day.

---

## Decided autonomously

[auto] [Wave 1] — Q: "Where does the withhold decision live?" → Selected: "One TS owner beside the headline verdict in headline-basis.ts; no Python change for wave 1" (reversible technical — decided autonomously: internal code location)
[auto] [Wave 1] — Q: "Does wave 1 need a re-derive?" → Selected: "No backfill UPDATE; re-stitch through the product job only if a needed stored value is missing" (reversible technical — decided autonomously: the re-stitch path is repeatable)
[auto] [Wave 1] — Q: "How is SC-2's RED fixture built?" → Selected: "The debug session's 0.311 → 0.1605 → 0.165 → 0.528 wallet shape on an options member, RED on today's code" (reversible technical — decided autonomously: test-only)
[auto] [Ship] — Q: "One PR or two?" → Selected: "Wave 1 in the phase PR; the founder-gated measurement run and any promotion follow" (reversible technical — decided autonomously: release sequencing)

## Claude's Discretion

- Public wording of the withheld reason, shown to the founder at the visual check.

## Deferred Ideas

- Single-key Deribit options strategy with a successful MTM pass (none on PROD).
- Deribit allocator books in key mode (Phase 233).
