# Phase 184: WALLETOFFSET — the first-mark offset on wallet-base venues is measured from fills - Context

**Gathered:** 2026-11-01
**Status:** Ready for planning
**Source:** the ROADMAP Phase 184 entry, which carries the founder's booking answer verbatim (no discuss-phase was run; nothing below is a founder decision unless it says so). `167.2.1.1.1-CONTEXT.md` is NOT on `main` (measured 2026-11-01 at `b1121aa7a`: the NAVMTM phase directory holds only `.gitkeep`), so D-25 and D-27 are carried here only as the ROADMAP entry restates them.

<domain>
## Phase Boundary

A MEASUREMENT phase. On each wallet-base venue (OKX and Bybit now; Binance and sFOX once their keys have marks), the first-mark offset is measured per key: the realized P&L plus flows between UTC midnight of the first mark day and the mark read, rebuilt read-only from fills and trade history and stated as a ratio of NAV. The founder then decides whether any venue moves to a writer-chain base (ROADMAP Phase 184 Goal, SC-1..SC-3).

No published number changes in this phase unless the founder decides so (SC-3). Building a writer-chain base for any of these venues is NOT in this phase; if the founder decides for one, it is booked or replanned from the readout.

Data integrity.

</domain>

<decisions>
## Implementation Decisions

### Founder decision
- **D-01 — Book a measure phase** (founder 2026-11-01, AskUserQuestion on NAVMTM 167.2.1.1.1 D-27: "Book a measure phase" — "Book a phase that rebuilds the realized P&L for that window from fills and measures the offset."): the offset on OKX, Bybit, Binance and sFOX is measured from fills and trade history for the first-mark window, per key, as a ratio of NAV. Until it reports, those four venues keep the wallet base.

### Founder readout decision (2026-11-01)
- **D-02 — OKX and Bybit keep the wallet base; Binance and sFOX wait for their own measurement** (founder 2026-11-01, AskUserQuestion on the Phase 184 readout: OKX: "Keep the wallet base (Recommended)"; Bybit: "Keep the wallet base (Recommended)"; Q4 Binance and sFOX: "Wait for their own measurement (Recommended)"): venue-decision: okx=keep bybit=keep binance=wait sfox=wait; OKX and Bybit keep the wallet base, because no measured key reaches the 0.1% of NAV threshold on the P&L part (OKX at most 0.0000786 over 5 keys, Bybit 0.000543 on its 1 key, per the 184-07 re-run), and Binance and sFOX keep the wallet base until a key is marked and measured. This closes D-01: the readout has reported.
  - Q5: "Decide on the P&L part (Recommended)"
  - Q1: "0.1% of NAV (Recommended)"
  - Q2: "Venue moves if any key is material (Recommended)"
  - Q3: moot (every marked key was measured)
  - Q4: "Wait for their own measurement (Recommended)"
  - sFOX definition: not asked (no marked sFOX key)
  - Ledger offer: moot (no measured key at or above the Q1 threshold, and no chain-incompleteness caveat or reading objection)
  - Follow-up (founder 2026-11-01, AskUserQuestion "How should the wait be tracked?"): "TODOS entry with a trigger (Recommended)": "A TODOS item: when a Binance or sFOX key first gets a mark, measure its offset with the existing probe. It doesn't hold the milestone open." Booked as TODOS `[184-BINANCE-SFOX-OFFSET-WAIT]`, triggered when a Binance or sFOX key gets its first stored mark; no phase was booked.

### Founder rules carried (not re-asked)
- **NAVMTM D-25** (restated in the ROADMAP entry): MT5 and Deribit moved to the writer-chain base (G-01, PR #1166). Out of scope here.
- **NAVMTM D-27** (restated in the ROADMAP entry): OKX, Bybit, Binance and sFOX keep the wallet base, because the wallet is final on OKX (NAVMTM REVIEW CR-01). Their pre-mark levels sit off the realized chain by the first-mark offset; any material offset goes back to the founder with the numbers.
- PROD reads are authorized (founder memory). This phase still WRITES nothing anywhere: no PROD row, no TEST row, no exchange order or transfer. The run's one PROD change is infrastructure, not data: a temporary start command on the Railway backfill worker, applied with one redeploy and restored with another, under the founder's standing PROD-write authorization (founder memory, 2026-10-03: "you are always authorized" / "also authorized for prod writes"). *(Sentence added 2026-11-01 at plan revision, checker iteration 1. It carries a standing founder rule; it is not a new decision.)* ⛔ *CORRECTED 2026-11-01 (orchestrator): the standing PROD-write authorization covers data reads and writes, NOT Railway start-command changes or probes. Those need the founder's explicit approval each time (standing session constraint). Plan 04 asks before changing the start command; the sentence before this note is kept as lineage.*
- Never invent data: a key whose window cannot be rebuilt is reported as unmeasurable with its reason, never as zero.
- Public repo: the readout carries counts and ratios only, never key ids, account ids, user ids or amounts.

### Shape the orchestrator set for the plans (not a founder decision)
- The measurement needs exchange reads with the stored keys, so it is a read-only script the orchestrator executes inside the Railway worker (the plan carrying it is `autonomous: false`). It prints counts and ratios only.
- A final plan is the founder readout: the numbers go to the founder, and the decision is recorded in this CONTEXT and in the ROADMAP entry (SC-2).
- Analytics plans carry CI's mypy line verbatim: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.

### Claude's Discretion
- How the window's realized P&L is rebuilt per venue (which fills / bills / closed-P&L endpoints, and how fees and funding enter), as long as research shows each term's source and the script states which terms it summed.
- Where the mark read instant for a key's first mark comes from (stored `key_inputs` timing or the worker's own reading), as long as research names the column or log it reads.
- Whether the script lives under `analytics-service/scripts/` beside the other read-only probes (`okx_chain_record.py`, `bybit_reconcile.py`, `mt5offset_dry_run.py`), and how its arithmetic is unit-tested offline.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` — `### Phase 184: WALLETOFFSET` (goal, booking, evidence, SC-1..SC-3)
- `analytics-service/services/job_worker.py` — `_warn_wallet_base_fallback` and its call sites (the wallet-base arm)
- `analytics-service/services/allocator_equity_derive.py` — reads `realized_terminal_usd`
- `analytics-service/scripts/` — existing read-only worker probes to pattern on (`mt5offset_dry_run.py`, `okx_chain_record.py`, `bybit_reconcile.py`, `flowtiming_dry_run.py`)

</canonical_refs>

<specifics>
## Evidence (copied from the ROADMAP Phase 184 entry)

D-25 moved MT5 and Deribit to the writer-chain base (G-01, PR #1166). OKX, Bybit, Binance and sFOX keep the wallet base (NAVMTM REVIEW CR-01: the wallet is final on OKX), so their pre-mark levels sit off the realized chain by that offset; mark reads land about 5.5-6.7 h after the boundary. The stored rows cannot give it: PROD 2026-11-01 (counts only) has 5 OKX keys and 1 Bybit key with marked `key_inputs` since 2026-10-26, their `realized_terminal_usd` equals the mark NAV, and no Binance or sFOX key has inputs yet.

## Success Criteria (copied from the ROADMAP)

1. For each key on those venues, the offset as a ratio of NAV is measured from fills and trade history for the first-mark window, read-only, and recorded with counts and ratios only.
2. The founder gets the numbers and decides whether any venue moves to a writer-chain base; the decision is recorded in this phase's CONTEXT and in this ROADMAP entry.
3. No published number changes in this phase unless the founder decides so.

</specifics>

<deferred>
## Deferred / Related

- Binance and sFOX have no keys with inputs as of 2026-11-01. If that still holds when the script runs, the readout states them as "no marked keys, not measured" and the founder decides whether they wait for a later reading.
- Any writer-chain base for a wallet-base venue is a follow-up, booked from the readout, not built here.
- NAVMTM G01-REVIEW WR-01 (MT5 credit deals) stays conditional where NAVMTM left it; not in this phase.

</deferred>

<open_questions>
## Open questions for the founder

None of these is decided here. The readout plan brings the numbers back with them.

1. **What offset counts as material?** What ratio of NAV (for example 0.1%, 0.5% or 1%), per key or per venue, makes a venue worth moving to a writer-chain base? **Answered 2026-11-01 (D-02):** "0.1% of NAV (Recommended)"
2. **Per key or per venue?** If one key on a venue is material and the others are not, does the venue move, or does nothing move? **Answered 2026-11-01 (D-02):** "Venue moves if any key is material (Recommended)"
3. **Unmeasurable keys.** If a key's fill history for the window cannot be read (expired retention, a revoked key, an endpoint the key lacks permission for), does the readout stand on the measured keys alone, or does the decision wait for that key? **Answered 2026-11-01 (D-02):** moot (every marked key was measured)
4. **Binance and sFOX.** If they still have no marked keys when the script runs, does the decision for them wait for a later measurement, or follow whatever is decided for OKX and Bybit? **Answered 2026-11-01 (D-02):** "Wait for their own measurement (Recommended)"
5. **Flows in the window.** A deposit or withdrawal between midnight and the mark read moves the wallet without being P&L. Should the readout state the P&L part and the flow part separately, or only their sum as the Goal words it? **Answered 2026-11-01 (D-02):** "Decide on the P&L part (Recommended)"

</open_questions>
