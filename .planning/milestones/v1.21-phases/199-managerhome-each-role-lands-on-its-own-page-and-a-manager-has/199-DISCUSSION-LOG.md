# Phase 199: MANAGERHOME - Discussion Log

**Date:** 2026-11-09
**Mode:** analysis by the phase agent; questions relayed to the founder by the coordinator.

> Audit trail only. Decisions live in 199-CONTEXT.md.

## Findings that shaped the questions
- `/my-strategies` is the allocator's list (Phase 149), `/strategies` the manager's (Phase 109 guard). Role `both` saw both entries.
- PROD read (2026-11-09, marker confirmed): allocator, manager and `both` profiles all own non-archived strategies, so a manager-only merge would drop real rows.
- One role-blind literal plus about 25 hand-written `/discovery/crypto-sma` "home" sites.

## Q1 Which URL is the one list, and who sees it?
| Option | |
|---|---|
| `/strategies` for every owner (Recommended) | chosen |
| `/my-strategies` for every owner | |
| Merge for managers only | |
**Founder:** "/strategies for all owners (Recommended)"

## Q2 What does the merged list keep?
| Option | |
|---|---|
| Everything from both (Recommended) | chosen |
| Manager list plus placeholder rows | |
| Manager list only | |
**Founder:** "Everything from both (Recommended)"

## Q3 What does the Health column show?
| Option | |
|---|---|
| One word per row plus a legend (Recommended) | chosen |
| Coloured dot plus a legend | |
| Data freshness only | |
**Founder:** "One word + legend (Recommended)"

## Q4 How wide is the degrade-warning sweep?
| Option | |
|---|---|
| App-wide, factsheet files after 196 (Recommended) | chosen |
| App-wide now | |
| Manager surfaces only | |
**Founder:** "App-wide, factsheet after 196 (Recommended)"

## Claude's discretion
CD-01..CD-06 in 199-CONTEXT.md (role-home function, deep links win, wrong-role bounce to own home, no new thresholds, registry test, 308 for the retired URL). The coordinator confirmed they stand (2026-11-09).
