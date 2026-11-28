# Phase 259: OKXARCHIVEFILLS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-27
**Phase:** 259-okxarchivefills
**Areas discussed:** Source endpoint, Trigger and scope

Run by a phase agent that cannot ask the founder. The founder's one ruling is "Yea, get archive endpoint" (2026-11-27). The other answers below are the agent's recommendations and are recorded as such in CONTEXT.md.

---

## Source endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| `trade/fills-archive` | Per-fill archive ("Transaction details (in the past 2 years)"); delisted 2024-09-18 per the OKX changelog; ccxt marks it "not documented" | |
| `account/bills-history-archive` | Quarterly CSV since 2021-02, except the current quarter; trade bills carry tradeId, px, sz, fee, subType, fillTime | ✓ |
| `asset/monthly-statement` | Funding-account statement for the last year; no per-fill fields | |

**User's choice:** Founder: "Yea, get archive endpoint". The agent picked the endpoint on the documented evidence.

## Trigger and scope

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic, chained from sync_trades | Future OKX strategies stay complete with no operator; costs archive applies (12/day per user) | ✓ |
| Operator-run job only | Smaller; future strategies lose pre-floor fills unless someone runs it | |

**User's choice:** The agent's recommendation. It is open to founder override before planning.

## Decided autonomously

[auto] [Code layout] — Q: "Where does the new code live?" → Selected: "Own module(s), named seams in exchange.py and job_worker.py" (reversible technical — decided autonomously: code in a separate module is cheap to move)
[auto] [Tests] — Q: "How is the mapping tested?" → Selected: "Fixture CSV rows plus fills-history pairs, mismatch and unproven-instType arms" (reversible technical — decided autonomously: tests can be reworked freely)
[auto] [Write path] — Q: "How are fills written?" → Selected: "The fills-history upsert path, on conflict do nothing" (reversible technical — decided autonomously: local change)
