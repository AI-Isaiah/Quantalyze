# Phase 237: FACTSHEETHONEST - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-23
**Phase:** 237-factsheethonest
**Areas discussed:** FACT-01 D6 items, FACT-02 reach

Questions were relayed to the founder by the coordinating session; answers recorded verbatim.

---

## Q1 Worst 10 Drawdowns on a Withheld factsheet

| Option | Description | Selected |
|--------|-------------|----------|
| Withhold panel (Recommended) | The whole panel is replaced by the Withheld note on a Withheld full-history view; a zoomed window keeps its own slice | ✓ |
| Dash row #1 Depth only | Only the figure equal to the rail's dashed max drawdown reads "—" | |
| Keep as is | No change | |

**User's choice:** "Withhold panel (Recommended)"

---

## Q2 EOY Returns and Calmar by Year on a Withheld factsheet

| Option | Description | Selected |
|--------|-------------|----------|
| Withhold both (Recommended) | Both by-year panels withheld on a Withheld full-history view; zoom keeps its slice | ✓ |
| Keep with a note | One line saying one year may span a break | |
| Keep as is | No change | |

**User's choice:** "Withhold both (Recommended)"

---

## Q3 Style Drift and its KS line on a Withheld factsheet

| Option | Description | Selected |
|--------|-------------|----------|
| Withhold panel + KS (Recommended) | Panel and Kolmogorov-Smirnov line withheld on a Withheld full-history view | ✓ |
| Keep halves, hide KS | Only the whole-record KS sentence is hidden | |
| Keep as is | No change | |

**User's choice:** "Withhold panel + KS (Recommended)"

---

## Q4 FACT-02 re-run holding reach

| Option | Description | Selected |
|--------|-------------|----------|
| 7 + (a) + (b) (Recommended) | The ROADMAP's seven surfaces plus the strategy page panels and the withhold-by-design detail reads; (c) composite approval ruled out as a write gate | ✓ |
| The seven only | (a) and (b) classified withheld by design and left booked | |
| Everything | Including composite approval during a re-stitch | |

**User's choice:** "7 + (a) + (b) (Recommended)". (c), composite approval, is ruled out as a write gate rather than a display. Close TODOS 190-RERUN-SURFACES-NOT-HOLDING on that basis in the ship PR.

---

## Decided autonomously

[auto] [FACT-04] — Q: "How does the owner's private factsheet get its own trust tier?" → Selected: "Owner lane reads strategy_verifications on the user-scoped client under the existing owner RLS policy; get_published_trust_signals not widened" (reversible technical — decided autonomously: no schema change, one read on one lane)
[auto] [CACHE-01] — Q: "What cache does a not-found OG card get?" → Selected: "Short cache (about 60 s); re-run cards also short-cached" (reversible technical — decided autonomously: a header constant)
[auto] [CACHE-03] — Q: "How is a failed BTC price read kept out of the payload cache?" → Selected: "Throw inside the unstable_cache callback, render uncached" (reversible technical — decided autonomously: local to the builder)
[auto] [Gates] — Q: "How are SC-3's cache cases proven?" → Selected: "Good-after-bad-within-TTL tests on the real cache wrapper, PROOF-01 red-then-green" (reversible technical — decided autonomously: tests only)

The founder confirmed these stand (2026-11-23).

## Claude's Discretion

Short-cache value, census test location and vocabulary, plan split.

## Deferred Ideas

None — discussion stayed within phase scope.
