# Phase 231: BYBITREADS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-23
**Phase:** 231-bybitreads
**Areas discussed:** Anchor, Positions, Trades, Deposits, Fixtures (all decided autonomously; ROADMAP and REQUIREMENTS already fix the outcomes, the remaining choices are reversible technical ones). Smart discuss ran inside a phase agent with no AskUserQuestion; no hard-to-reverse or preference question remained open.

## Decided autonomously

[auto] [Anchor] — Q: "Which coin set is the one shared constant?" → Selected: "price_rule.is_stable_value, already used by the current-equity read" (reversible technical — decided autonomously: reuses the existing definition)
[auto] [Anchor] — Q: "Where does the fix live?" → Selected: "A Bybit-only branch of the anchor path; other venues unchanged; every helper caller a census row" (reversible technical — decided autonomously: a local venue branch)
[auto] [Anchor] — Q: "What does the flipped pin assert?" → Selected: "derive = stable wallet sum, wedge 0.0, reconstruct = derive + uPnL" (reversible technical — decided autonomously: a test assertion)
[auto] [Anchor] — Q: "Non-stable collateral in the anchor?" → Selected: "Out, as the requirement scopes it; decided census row, flagged to the founder" (reversible technical — decided autonomously: scope note)
[auto] [Positions] — Q: "How are USDC-settled and inverse positions read?" → Selected: "Iterate linear USDT, linear USDC and inverse on both paths; a failed sub-read refuses by name" (reversible technical — decided autonomously: request shape in one function)
[auto] [Positions] — Q: "Inverse uPnL valuation?" → Selected: "At the payload's markPrice, Deribit inverse pattern; unusable mark refuses by name" (reversible technical — decided autonomously: local conversion)
[auto] [Trades] — Q: "Fix shape for a start older than seven days?" → Selected: "Probe first; 7-day windows with explicit endTime, cap hit refuses by name; or a recorded disproof with a test" (reversible technical — decided autonomously: request shape in one function)
[auto] [Trades] — Q: "Execution categories?" → Selected: "Linear only stays, decided row" (reversible technical — decided autonomously: no change)
[auto] [Deposits] — Q: "What changes if the probe is undecided?" → Selected: "replace stays, verdict recorded undecided with counts, test added" (reversible technical — decided autonomously: evidence only)
[auto] [Fixtures] — Q: "Test payloads?" → Selected: "Recorded real Bybit v5 shapes through the real ccxt parser" (reversible technical — decided autonomously: test-only)

## Claude's Discretion

Plan split and wave layout within the CONTEXT constraints.

## Deferred Ideas

Non-stable collateral in the derive anchor; the start-less 7-day execution read (census row).
