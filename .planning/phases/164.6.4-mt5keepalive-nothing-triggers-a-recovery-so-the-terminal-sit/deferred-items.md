# Phase 164.6.4 — deferred items

Out-of-scope discoveries logged during execution. ⛔ Nothing here was fixed by this phase.

## [164.6.4-WINDOWS-LEDGER-TABLE-JSON-DISAGREE] — the broken-windows ledger REFUSES every append

**Found during:** plan 02, the SUMMARY step (2026-09-15).
**Measured, verbatim:**

```
$ gsd-tools windows append --kind unrun-verify --phase 164.6.4 …
Error: Ledger table in .planning/WINDOWS.md disagrees with the fenced JSON entries
(the sole source of truth) for row id(s): 25, 37. Edit the fenced JSON block directly,
or discard the table edit and re-run the command so gsd-tools regenerates the table;
never hand-edit the rendered table.
```

**Why it is NOT fixed here.** Rows 25 and 37 predate this phase entirely; repairing another
phase's ledger rows as a side effect of an MT5 plan is exactly the collateral the SCOPE BOUNDARY
rule exists to prevent. The ledger's own contract is best-effort — a refused append never blocks
execution — so plan 02 continued and recorded the refusal here instead.

⚠️ **The consequence is real and worth naming:** `/gsd-ship`'s ledger gate reads WINDOWS.md, so
for as long as the table and the fenced JSON disagree, NOTHING can be added to it — every
defect a later phase tries to record is silently absent from the ship gate. Phase 164.6.2's
wave-3 record already reports the append REFUSED "for the third consecutive wave", so this is a
standing condition with a new message rather than a new event.

**What plan 02 would have recorded, had the append worked** (three `unrun-verify` entries, all
POST-DEPLOY by construction and all carried in `164.6.4-02-SUMMARY.md` under *Outstanding*):

1. Assumption A4 — no Python code has ever written to `public.cron_runs`, so READ THE ROW BACK
   on the first deploy rather than assuming the service-role INSERT lands.
2. Assumption A2 — the gateway's rpyc thread counter across two prober runs several hours apart.
3. Criterion 2's cross-check against the independent hourly prod-prober.

**Destination:** needs a named phase via `/gsd-phase --edit`. ⛔ Do not leave it as prose.

---

## [164.6.4-NO-REQUIREMENT-IDS] — the plan's `requirements:` IDs are not REQUIREMENTS.md rows

**Measured 2026-09-15:** `grep -cE "164\.6\.4-C[123]|MT5-GATEWAY-LOGIN-01" .planning/REQUIREMENTS.md`
→ **0**. The ROADMAP says so itself (`**Requirements**: TBD (no v1.20 requirement IDs)`), so
`requirements.mark-complete` was correctly SKIPPED rather than invoked against IDs that do not
exist. Recorded so a verifier reading the plan's frontmatter does not open a gap that is not one.
