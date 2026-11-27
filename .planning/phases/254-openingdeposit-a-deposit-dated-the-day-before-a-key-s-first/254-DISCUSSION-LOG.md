# Phase 254: OPENINGDEPOSIT - Discussion Log

**Date:** 2026-11-27
**Mode:** autonomous smart discuss, run by a phase agent that cannot ask the founder. Every question was a reversible technical choice and was decided autonomously; none needed a founder answer. The founder's ruling for the phase is the ROADMAP's: "Exempt it, book for v1.23" (2026-11-26).

| Area | Question | Decision | Why |
|---|---|---|---|
| Scope of "flow" | Any flow or only a deposit on the day before the first return? | Net positive day flow only | ROADMAP goal and SC-1 say "deposit" |
| Which keys | Full-history keys too? | Only `history_reaches_inception=False` | SC-3: D-13 zero-start checks unchanged |
| Zero-start check | Judge the exempted deposit by the band? | No | Narrow exemption; D-13 unchanged |
| Writer basis | Legacy roll only? | Whichever flows the replay runs on | Same as the 234 stated-day ruling |
| Visibility | Name the exemption? | Count flag `opening_deposit_exempted` | Mirrors `opening_flows_reconciled`; no payload change |
| Existing tests | Tests pinning the old rule? | Rewritten with a dated note, wiring kept distinguishable | Documented intent change |
