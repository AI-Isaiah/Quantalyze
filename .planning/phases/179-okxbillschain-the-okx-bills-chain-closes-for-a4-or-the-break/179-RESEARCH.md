# Phase 179: OKXBILLSCHAIN - Research

**Researched:** 2026-10-28
**Domain:** OKX bills-archive running balance as an opening-balance oracle (analytics-service, Python); read-only probe measurement on the backfill worker; forced-path fail-closed behaviour
**Confidence:** MEDIUM-HIGH (code seams, probe contract, test strategy, OKX documented fields: HIGH, read this session. Which candidate cause fires for a4: UNKNOWN by design, only the probe can measure it. Fix shapes: MEDIUM, they are derived, not measured.)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Carried (not re-asked)
- Phase 172 D-01: the bills oracle is a check-only second opinion; anything but "agreed" refuses `anchor_skipped_implausible` and writes nothing (fail closed). Venue exceptions propagate (PD-I: no automatic re-crawl).
- Phase 172 plan 05, founder 2026-10-28: "Record, route a follow-up (Recommended)" (SC-3 mismatch). This phase is that follow-up.
- Phase 172 plan 05, founder 2026-10-28: "Keep 0.05, re-decide later (Recommended)". `OPENING_TOLERANCE_REL` stays 0.05 until an opening is measurable; SC-3 of this phase re-decides it.
- `OPENING_UNAVAILABLE_REASONS` is a closed set: "a new way to fail is a decision, not an f-string" (module docstring). Adding a token is a founder decision.
- TRADEPAGES D-05: stored histories stay as recorded. Phase 173 owns any OKX rebuild.
- Probe records carry counts, booleans, tokens and 3-significant-figure ratios only: no amount, no uuid, no bill id, no run of ten or more digits.

### D-01 Measure before fixing (orchestrator brief 2026-10-28, from the founder's routing)
"Measure before fixing; the phase's first plan should be the measurement." The measurement is a read-only PROD probe on the backfill worker (the 172 plan 05 delivery pattern). It is an operator step owned by the orchestrator, and each Railway probe run needs the founder's approval. Plan it as a checkpoint task.

### D-02 Candidate causes are measured, not assumed (orchestrator brief 2026-10-28)
The measurement must be able to tell apart, in one run where possible:
- which arm fires: an interior link (`bal != prev_bal + balChg`) or the close (newest `bal != cashBal`);
- on which currency and which bill kind (`type`, `subType`, `instType` tokens);
- bills-archive not covering the newest days (compare against `/account/bills`, last 7 days);
- bill types missing from the archive;
- ordering or ties (billId order against ts order; several bills on one ts);
- precision or rounding (the size of the link residual as a bucket token, never an amount);
- a currency whose bills are partly outside the window.

### D-03 Fix choice waits for the reading
Which fix lands (a reading change in the oracle, or a new named refusal) is chosen from the measurement at a founder decision checkpoint after plan 01, not in this context. If the reading disproves a later plan, replan rather than patch.

### Coordination with Phase 173
Phase 173 REBUILDGATES changes `allocator_history_probe.py` in parallel (the OKX ordering read also runs on a refused member). This phase keeps its probe changes minimal and additive (new record keys only), expecting a merge later.

### Claude's Discretion
- Where the break diagnostic is computed: the oracle can return a structured break descriptor (arm, currency, bill-kind tokens, counts, residual-size bucket) that the probe prints. This keeps the forced path's behaviour unchanged (still fail closed) while making the token explain itself.
- The exact record keys and bucket edges, within the counts-and-tokens rule.
- Whether the extra `/account/bills` (7-day) read lives in the oracle or only in the probe. It must stay GET-only and go through `_okx_bills_fetch_with_backoff`.

### Founder decisions pending (not answered here)
- After plan 01's reading: which fix, or which named refusal token.
- After deploy (SC-3): keep or re-set `OPENING_TOLERANCE_REL` on a4's reading.
- Whether the measurement probe run is shared with Phase 173's next probe run (one Railway run serving both, as 172 plan 05 did with Phase 171).

### Deferred Ideas (OUT OF SCOPE)
- Any OKX history rebuild (Phase 173 and later).
- A second OKX account for the tolerance basis (none is connected).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were assigned (phase-local success criteria, ROADMAP `### Phase 179`).

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | A read-only measurement (counts and tokens only) names which arm of `chain_break` fires for a4, and which currency and bill kind it falls on | "The measurement shape" (record keys, pure `analyse_chain`, GET readers), "Reading interpretation table" |
| SC-2 | The cause is fixed in the bills oracle with a test that goes RED on the old reading, or recorded as a real gap in OKX's archive with a named refusal; a4 never anchors on an unproven opening | "Likely fix shapes", "Validation Architecture" (RED-on-old-reading template, neuter list) |
| SC-3 | After deploy the probe re-reads a4: `opening_check` is `measured` with a residual, or the refusal carries the named cause; the 0.05 tolerance is kept or re-set by the founder | "Operator checkpoints", "Tolerance re-decision" |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from the root `CLAUDE.md`, `AGENTS.md`, the global `CLAUDE.md` and the standing rules in the invocation. Treated as locked.

- Analytics briefs carry CI's mypy line verbatim, run from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. `scripts/` is NOT in that mypy line, `services/` is, so a new `services/` module is type-checked strictly and counts toward the `--cov-fail-under=80` gate (`pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`, `.github/workflows/ci.yml`).
- Fixer briefs quote verbatim: "For fix rounds minimal fix only, no new abstractions or defensive checks". Fix MEDIUM+ user-facing or data-integrity findings, at most 3 fixer rounds; never fix LOW or INFO.
- Models: executors and fixers Sonnet high; gsd-code-reviewer Opus; silent-failure-hunter, verifier, security-auditor, plan-checker, pattern-mapper and phase-researcher Sonnet high; planner and debugger omit the model.
- No AI-authorship trailers or footers in any commit message or PR body (founder 2026-10-20), and never the CI skip trailer anywhere, not even in a sentence denying it (the root `CLAUDE.md` section "CI gate integrity" records that it suppresses CI and survives a squash).
- No secrets, PROD ids or uuids, bill ids, home paths or account numbers in tracked text (public repo, `.planning/` tracked). Probe output is pasted into tracked files: labels, counts, booleans, tokens and 3-significant-figure ratios only.
- No `--linked`, no `db push`, and no PROD, TEST or Railway access from a dispatched agent. Railway and PROD are operator steps owned by the orchestrator (checkpoint tasks), each probe run with the founder's approval.
- pytest only from `analytics-service/`; never `importlib.reload` in tests. Always `grep -a`. A new test file or key moves several censuses: grep them all.
- Tests verify intent: a gate must be able to fail. Neuter, see RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work).
- Data integrity: "Never invent data: uncomputable metrics are null." A guessed or zeroed opening is the failure this phase exists to prevent.
- A ship branch changes nothing under `.planning`. Completion is historical (`verified_at_sha` + `drift_subjects`; `covered_digest` and `covered_files` are banned). Every ship writes a CHANGELOG entry and bumps `VERSION` and `package.json` as byte-equal 4-digit strings.
- No frontend change in this phase, so the Next.js warning in `AGENTS.md` and `DESIGN.md` do not apply.

## Summary

The refusal token `chain_break` is one string for two different conditions, and the only reading we have cannot tell them apart. In `per_ccy_opening` (`services/okx_opening_balance.py:285-313`) a currency is refused if an INTERIOR link fails (`bal != prev_bal + balChg` in `billId` order) or if its CLOSE fails (newest `bal != cashBal`); the function raises at the first failing currency in the walk's own order, so it also hides every other currency's state. The probe's `bal_over_cashbal=1` does NOT clear the close arm, which the CONTEXT reads as "suggests USDT's close arm holds": the probe prints ratios through `sig3` (three significant figures), so `1` means the newest USDT `bal` is within about 0.05% of `cashBal`, not equal to it [VERIFIED: `scripts/allocator_history_probe.py:791-801` `ratio_or_absent` -> `sig3`]. A residual of a few fees on a large account prints as `1` and still fails exact `Decimal` equality. So the close arm for USDT, a dust currency (`non_stable_share=4.72e-9` proves non-stable dust is held), or an interior link are all open, and so is a race: the oracle compares the NEWEST bill with a `cashBal` read BEFORE the walk, on an account that trades (1282 fills in 90 days).

The measurement must therefore be built to discriminate, in ONE operator run, between: (1) which arm and which currency, (2) a race or archive lag at the newest end (compare `uTime` of the balance row and a post-walk balance re-read, and compare `/account/bills` with the archive), (3) ordering/ties (billId-vs-ts inversions, same-ts links, an order-independent balance-multiset check, re-closing under alternative sorts), (4) a missing bill or missing bill type (unmatched chain ends, per-type and per-instType filtered presence sweep), (5) precision/dust (relative residual bucket and the residual's relation to the breaking bill's own `balChg`), and (6) whether the break is reproducible (a second oracle read in the same run). All of that is computable from bills the walk already fetched plus a bounded set of extra GETs. The code seams are small: the oracle gains a `walked` field and keeps `subType`/`mgnMode`/`posBalChg`; a NEW `services/okx_bills_chain.py` holds a pure `analyse_chain` plus the GET readers; a NEW `scripts/okx_chain_record.py` holds the record vocabulary; the probe is touched by four one-line splices plus one block at the end of `_measure_anchor`. Phase 173 edits the same probe file in different places; the collision map below keeps the textual overlap to zero hunks if followed.

The fix is not chosen here (CONTEXT D-03). The research supplies the interpretation table (reading -> named cause -> fix shape) so the post-measurement replan is quick, and a RED-on-the-old-reading test template. Two findings the planner should not lose: every existing oracle fake builds a perfectly consistent chain with `ts` and `billId` rising together (`tests/_okx_bills.py:okx_bill_chain`), so the oracle has never been exercised against a tie, an inversion, a lagging archive or a moving balance; and the oracle's walk stop rule ("stop at the first page that serves a bill older than the opening instant") silently assumes `billId` order equals `ts` order across the opening boundary, which can mis-state a currency's OPENING without ever raising `chain_break`.

**Primary recommendation:** Plan 01 ships the measurement (pure `analyse_chain` + GET readers + additive record keys + tests), the orchestrator ships and deploys it, plan 02 is the operator probe checkpoint (one run, ideally shared with Phase 173's run), plan 03 is the founder fix-choice checkpoint driven by the interpretation table, and the fix plans are written only after that reading.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bills walk and chain verdict (the oracle) | Analytics worker `services/okx_opening_balance.py` | OKX REST (GET) | Already owns the walk, the closed reason set and the forced-path entry; unchanged except additive fields in plan 01 |
| Break analysis (arm, ccy, kinds, buckets, order, topology) | Analytics worker, PURE function in new `services/okx_bills_chain.py` | - | Pure on already-fetched bills: unit-testable without a venue; keeps the oracle diff minimal |
| Extra diagnostic GETs (7-day bills, post-walk balance, type presence sweep, repeat walk) | Analytics worker `services/okx_bills_chain.py` (async readers) | OKX REST (GET only) | The probe source must not name `private_get_account_bills_archive` (existing static pin) and the oracle-side module owns venue I/O |
| Record vocabulary and redaction (keys, validators, defaults) | Worker-side script module `scripts/okx_chain_record.py` | Probe `emit_record` | Keeps 179's keys out of the probe's hot edit zones; the emitter stays the only path to stdout |
| Probe orchestration | `scripts/allocator_history_probe.py` `_measure_anchor` tail | Railway backfill worker | Runs only for an OKX member refused `anchor_skipped_implausible` or agreed through the bills check |
| Forced-path decision (anchor or refuse) | `services/equity_reconstruction.py` `_okx_forced_opening_check` (UNCHANGED by the measurement plans) | - | Fail closed stays: anything but "agreed" refuses `anchor_skipped_implausible` |
| Operator run of the probe | Orchestrator/founder step on Railway | - | `railway ssh` is broken; start-command wrapper with founder approval per run |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt (async) | `ccxt==4.5.88` pinned [VERIFIED: `analytics-service/requirements.txt:33`] | OKX implicit methods `private_get_account_bills_archive`, `private_get_account_bills`, `private_get_account_subtypes`, `private_get_account_balance` | The repo already calls all four: `exchange.py:1464` (`private_get_account_bills`), `okx_archive_job.py:815` (`private_get_account_subtypes`), `okx_opening_balance.py:129` and `:185` (archive, balance) [VERIFIED by reading this session]. Local ccxt is 4.5.64 and also exposes them, tagged local |
| `decimal.Decimal` | stdlib | Exact balance arithmetic | The oracle's existing choice; the diagnostic must use the same equality it diagnoses |
| pytest + pytest-asyncio | `asyncio_mode = auto` [VERIFIED: `analytics-service/pytest.ini`] | Tests | Existing suite |
| mypy | `mypy==2.4.0` in CI [VERIFIED: `requirements-dev.txt:53`]; local 2.0.0 | Strict typing of `services/` | CI gate |

### Supporting (all existing, no install)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `services.exchange._okx_bills_fetch_with_backoff` (`exchange.py:1378`) | 429 backoff for every bills/subtypes page (`OKX_BILLS_MAX_RETRIES = 4`, `OKX_BILLS_BACKOFF_BASE_S = 0.5`, `exchange.py:1374-1375`) | Every new bills GET (D-02 discretion: GET-only, through this helper) |
| `services.closed_sets.STABLECOINS` | Stable set (USDT, USDC, DAI, BUSD, TUSD, FDUSD, USD per Phase 172 research `closed_sets.py:237-239`) | Stable/non-stable flag on the worst currency |
| `scripts.bybit_upnl_probe.sig3`, `FIELD_ABSENT`, `FAILURE_CLASSES`, `classify_failure` | 3-sig-fig rounding, absent marker, allow-listed exception CLASS | New record keys, failure recording |
| `scripts.allocator_history_probe.emit_record` / `validate_record` | The only path to stdout | Probe record |
| `tests/_okx_bills.py` (`OkxBillsArchive`, `okx_bill`, `okx_bill_chain`, `okx_detail`, `okx_balance_payload`) | OKX raw-reply fakes | Extend ADDITIVELY (ties, inversions, a 7-day `bills` fake, a subtypes fake, a balance that changes between calls, `uTime`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Diagnostic inside `per_ccy_opening` | New pure `analyse_chain` beside it | Editing `per_ccy_opening` touches the forced path's decision; a separate pure function cannot change the verdict. Use the separate function |
| Diagnostic recomputed from a SECOND archive walk | `walked` bills carried on the reading | A second walk could see different data than the walk that refused. Carry the first walk's bills; a deliberate second oracle read is a separate, labelled measurement (`chain_repeat_reason`) |
| One nested `chain_report` JSON object in the record | Flat `chain_*` keys | Railway's log view re-renders each record as `key=value` attributes (172-05-SUMMARY "Log-format note"); only flat scalars are proven to survive that round trip |
| `bills-history-archive` quarter files | - | Async POST apply (about 2 h), cannot cover the current quarter, unified accounts only (Phase 172 research). Out of scope |

**Installation:** none. **Version verification:** no new package is recommended, so no registry command applies; the ccxt and mypy versions above are the repo's own pins.

## Package Legitimacy Audit

No external package is added by this phase, so no `package-legitimacy check` was run. The two repo-banned packages (global CLAUDE.md) are irrelevant.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
FORCED PATH (UNCHANGED in the measurement plans; fail closed)
  _okx_forced_opening_check ──> obal.read_okx_balance_row (cashBal map, ONCE, before the walk)
        │                       obal.read_okx_opening ──> walk_okx_bills_archive (GET bills-archive, after=billId, until a bill older than the opening)
        │                                                      │ bills (billId order newest first)
        │                                                      ▼
        │                                         per_ccy_opening  ── interior arm: bal != prev + balChg ──┐
        │                                                          └─ close arm:    newest bal != cashBal ──┴─> OpeningUnavailable("chain_break")
        └─ anything but "agreed" ──> refuse anchor_skipped_implausible, write nothing

PROBE (operator step, backfill worker, read-only)       [179 additions marked +]
  _probe_member ──refused anchor_skipped_implausible / agreed──> _anchor_diagnostic ──> _measure_anchor
        │  existing: advisory pass, balance row, obal.read_okx_opening ──> opening_check / reason / bills_read / bal_over_cashbal
        │
        └─ + when reason == "chain_break":  (inside the same crawl bound, try/except by exception CLASS)
              reading.walked (the bills that refused)  ──> + analyse_chain(...)  PURE: arm, ccy, kinds, buckets, order, ties, topology
              + GET balance AGAIN (post-walk)           ──> close arm vs a fresh cashBal; cashBal moved during walk?; uTime vs newest bill ts
              + GET /account/bills (7 days, paged)      ──> overlap with the walk: only-in-bills / only-in-archive / field mismatch / lag bucket
              + GET /account/subtypes + type= and instType= filtered presence sweep ──> kinds the unfiltered walk never served
              + second obal.read_okx_opening (fresh balance row) ──> chain_repeat_reason (transient or structural)
              ──> okx_chain_record.chain_values(report) ──> flat chain_* keys ──> emit_record (validated, redacted)
```

### Recommended Project Structure
```
analytics-service/
├── services/okx_opening_balance.py   # EDIT (additive only): _parse_bill keeps subType/mgnMode/posBalChg; OkxOpeningReading.walked
├── services/okx_bills_chain.py       # NEW: ChainReport, analyse_chain (pure), bucket/kind helpers, GET readers (recent bills, post-walk balance, type sweep)
├── scripts/okx_chain_record.py       # NEW: CHAIN_KEYS, CHAIN_VALIDATORS, chain_defaults(), chain_values(report): the record vocabulary
├── scripts/allocator_history_probe.py# EDIT: 4 one-line splices + one block at the end of _measure_anchor
└── tests/
    ├── _okx_bills.py                 # EXTEND additively (fakes below)
    ├── test_okx_bills_chain.py       # NEW: analyse_chain scenarios, GET readers, static GET-only pin, mutation targets
    ├── test_okx_chain_record.py      # NEW: vocabulary/redaction/census tests for the chain_* keys (pure, no probe end-to-end)
    └── test_allocator_history_probe.py # APPEND one end-to-end test at the END of the file only
```

### Pattern 1: The oracle's two arms, exactly as shipped
**What:** [VERIFIED: `services/okx_opening_balance.py:296-313`, read this session]
```python
    by_ccy: dict[str, list[Mapping[str, str]]] = {}
    for bill in bills:
        by_ccy.setdefault(bill["ccy"], []).append(bill)
    openings: dict[str, Decimal] = dict(cash_by_ccy)
    for ccy, group in by_ccy.items():
        ordered = sorted(group, key=lambda b: int(b["billId"]))
        first_bal = _decimal(ordered[0]["bal"], "malformed_bills")
        openings[ccy] = first_bal - _decimal(ordered[0]["balChg"], "malformed_bills")
        prev_bal = first_bal
        for bill in ordered[1:]:
            bal = _decimal(bill["bal"], "malformed_bills")
            bal_chg = _decimal(bill["balChg"], "malformed_bills")
            if bal != prev_bal + bal_chg:
                raise OpeningUnavailable("chain_break")
            prev_bal = bal
        if prev_bal != cash_by_ccy.get(ccy, Decimal(0)):
            raise OpeningUnavailable("chain_break")
```
Consequences the planner must keep in view: (a) the interior arm and the close arm raise the SAME token; (b) the loop stops at the first failing currency in dict order, which is the walk's order (newest bill first), so the token says nothing about the other currencies; (c) equality is exact `Decimal`; (d) the cash balance map was read ONCE, before the walk (`_okx_forced_opening_check`, `equity_reconstruction.py:4060`; the probe, `allocator_history_probe.py:1053`), while the walk takes at least 15 pages for 1489 bills; (e) a currency absent from the balance row is compared with 0.

### Pattern 2: The walk's stop rule (a latent ordering assumption)
**What:** [VERIFIED: `okx_opening_balance.py:243-282`] The walk pages with `after=<smallest billId of the previous page>` and stops at the first page in which any bill has `ts < opening_ms`; bills with `ts >= opening_ms` on that page are kept, bills on later pages are never read. This is correct only if every in-window bill has a larger `billId` than every pre-window bill. A bill with a LARGER billId but an OLDER `ts` ends the walk early; a bill with a SMALLER billId and a NEWER `ts` is then never read. That cannot raise `chain_break` (the kept bills still chain among themselves) but can make a currency's opening wrong. It is not a cause of a4's refusal, but a fix that touches ordering must keep it in view. [ASSUMED] that OKX violates it; the measurement counts billId-vs-ts inversions so it is measured, not assumed.

### Pattern 3: The measurement shape (what to compute and print, one run)

All computations are pure functions of data already in memory, except the labelled GETs. Everything printed is a count, a boolean, a closed-vocabulary token, a bucket or a short token list; never an amount, a bill id, a timestamp finer than the run date, or a uuid.

**Inputs to `analyse_chain`:** the walked bills (`reading.walked`, strings), `cash_by_ccy` (the pre-walk balance map), the pre-walk per-currency `uTime` map, an optional post-walk `cash_by_ccy_after`, an optional list of 7-day `bills` rows.

**Per currency `c`** (bills of `c` in `billId` order, `n` bills): interior links `n-1`; interior breaks `#{i : bal_i != bal_{i-1} + balChg_i}`; close ok = `bal_n == cash_by_ccy.get(c, 0)`.

**Record keys (flat, prefix `chain_`; every unmeasured value is `field-absent` or `not-run`, never 0/False).** Tier A is required for SC-1; Tier B is the remaining candidate causes and is recommended because each Railway run needs founder approval.

| Tier | Key | Type / vocabulary | What it answers |
|------|-----|-------------------|-----------------|
| A | `chain_diagnostic` | one of `not-run`, `run`, `failed` | ran or not |
| A | `chain_diagnostic_failure_class` | `_FAILURE_CLASSES` (allow-listed exception CLASS) | a failed extra GET never discards the other keys |
| A | `chain_arm` | one of `none`, `interior`, `close`, `both` | SC-1 "which arm" over ALL currencies (the oracle's own token stops at the first) |
| A | `chain_ccys_checked`, `chain_ccys_interior_broken`, `chain_ccys_close_broken` | counts | how many currencies, how many fail each arm |
| A | `chain_interior_links`, `chain_interior_breaks` | counts | size of the problem |
| A | `chain_worst_ccy` | regex `^[A-Z][A-Z0-9]{1,9}$` or `none`, see Open Question 1 | SC-1 "which currency" (worst = most interior breaks, tie -> close arm, then alphabetical) |
| A | `chain_worst_ccy_is_stable` | bool or absent | stable vs dust/non-stable |
| A | `chain_break_kinds` | token list `type.subType.instType:count`, comma-joined, at most 5 entries then `other:n` | SC-1 "which bill kind" of the BREAKING bill |
| A | `chain_break_prev_kinds` | same grammar | kind of the bill BEFORE the breaking bill (a missing bill sits between the two) |
| A | `chain_break_mgn_modes` | token list `isolated`, `cross`, `cash`, `blank` with counts | isolated vs cross margin (OKX documents `mgnMode` and a separate position-level `posBal`) |
| A | `chain_residual_bucket`, `chain_close_residual_bucket` | one of `none`, `zero`, `lt_1e-12`, `lt_1e-9`, `lt_1e-6`, `lt_1e-3`, `lt_1e-1`, `ge_1e-1` | residual size RELATIVE to `max(abs(bal), abs(prev_bal), abs(balChg))`, never an amount |
| A | `chain_sig_bal_unchanged`, `chain_sig_double_count`, `chain_sig_swapped_pair`, `chain_sig_other` | counts | residual signature: `bal == prev_bal` (the bill did not move `bal`), residual equals `balChg` (applied twice), two adjacent breaks whose residuals sum to 0 (an order swap), anything else |
| A | `chain_billid_ts_inversions` | count | adjacent (billId order) bills where the larger billId has the strictly smaller `ts` (D-02 ordering) |
| A | `chain_same_ts_links`, `chain_same_ts_breaks` | counts | links whose two bills share a `ts` (ties) and how many of those break |
| A | `chain_trail_ccys` | count | currencies for which an ORDER-INDEPENDENT chain exists: the multiset of starts `bal - balChg` and ends `bal` differs by exactly one start and one end (the Eulerian-trail degree condition). Equal to `chain_ccys_checked` while `chain_interior_breaks > 0` means "pure ordering, nothing missing" |
| A | `chain_closes_by_ts_id`, `chain_closes_by_ts_id_desc` | counts | currencies whose interior closes when sorted by `(ts, billId)` and by `(ts, -billId)` |
| A | `chain_gap_estimate` | count | `sum(max(0, unmatched_starts - 1))` over currencies: how many chain gaps (missing bills) the multiset implies |
| A | `chain_first_break_age`, `chain_last_break_age` | one of `none`, `lt_1h`, `lt_1d`, `lt_7d`, `lt_30d`, `ge_30d` | age of the oldest/newest interior break measured back from the NEWEST walked bill; clustering at the newest end points to lag or a race, at the 7-day edge to a `bills`/archive seam |
| A | `chain_breaks_in_recent_7d` | count | interior breaks within 7 days of the newest bill |
| A | `chain_close_cash_moved` | count | currencies whose `cashBal` differs between the pre-walk and a fresh post-walk balance read (a RACE, measured) |
| A | `chain_close_matches_after` | count | close-arm failures that DISAPPEAR against the post-walk `cashBal` (race proven for that currency) |
| A | `chain_close_bill_after_utime` | count | currencies whose newest bill `ts` is later than the pre-walk `details[].uTime` (a bill arrived after the balance was read) |
| A | `chain_close_utime_after_bill` | count | currencies whose balance `uTime` is later than the newest archive bill `ts` (the balance changed with no archive bill: archive lag or a bill-less balance change) |
| A | `chain_repeat_reason` | `not-run`, `none`, or an `OPENING_UNAVAILABLE_REASONS` member | a SECOND oracle read in the same run, with a fresh balance row: `none` after a first `chain_break` means TRANSIENT (race/lag), the same reason means STRUCTURAL |
| B | `chain_recent_read` | count or absent | `/account/bills` rows read (paged until empty or a small ceiling) |
| B | `chain_recent_complete` | bool or absent | the 7-day paging reached its end, not the ceiling |
| B | `chain_recent_both`, `chain_recent_only_bills`, `chain_recent_only_archive`, `chain_recent_field_mismatch` | counts | billIds in both stores, only in the 7-day store, only in the archive (restricted to the overlap window), and same billId with different `bal`/`balChg`/`ts`/`ccy` |
| B | `chain_recent_only_bills_kinds` | token list | kinds the archive does not serve for the overlap window |
| B | `chain_archive_behind` | one of `absent`, `none`, `lt_1m`, `lt_10m`, `lt_1h`, `lt_1d`, `ge_1d` | newest `/account/bills` `ts` minus newest archive `ts` (archive lag) |
| B | `chain_types_probed`, `chain_types_hidden`, `chain_inst_types_probed`, `chain_inst_types_hidden` | counts | `type=<t>` and `instType=<i>` filtered queries (from `GET /account/subtypes` and the six documented instTypes) that returned a bill the UNFILTERED walk never served |
| B | `chain_hidden_kinds` | token list | the kinds of those bills |
| B | `chain_sweep_complete` | bool or absent | the sweep stayed under its call ceiling |
| B | `chain_break_pos_level` | count | breaking bills with a non-zero `posBalChg` or `posBal` (position-level balance, documented for isolated margin) |

About 45 keys. They are flat, defaulted to `field-absent`/`not-run`, and live in `scripts/okx_chain_record.py`.

**Key-name pitfall.** `assert_sanitized` rejects any key containing `secret`, `token`, `api_key`, `apikey` or `password` and any string value matching `[A-Za-z0-9+/=_-]{40,}` [VERIFIED: `scripts/deribit_ground_truth.py:334-340` `_DENY_KEY_SUBSTRINGS`, `:349` `_LONG_TOKEN_RE`]. Never name a key `..._token` (the CONTEXT's own wording "currency token" would invite it). Keep token-list values short with `.`/`:`/`,` separators.

**Run order inside the probe** (all inside `_anchor_diagnostic`'s existing `asyncio.wait_for(..., er._RECONSTRUCT_CRAWL_TIMEOUT_S)`, 1500 s [VERIFIED: `equity_reconstruction.py:179-181`]): existing oracle read -> (only if `unavailable_reason == "chain_break"`) pure analysis -> post-walk balance GET -> `/account/bills` paging -> type/instType sweep -> repeat oracle read. Each extra GET group is wrapped separately so one failure sets `chain_diagnostic_failure_class` and keeps the earlier keys (the SFH-04 pattern the probe already uses, `allocator_history_probe.py:1079-1084`). Estimated extra GETs for a4: about 15 (repeat walk) + 2-3 (`bills`) + 1 (balance) + 1 (subtypes) + about 6 (instType) + one per enabled type, capped (suggest 120 total). [ASSUMED] runtime well under the bound: the 1489-bill walk is 15 pages and the whole a4 diagnostic read took 32 s of forced read in the 172 run.

### Pattern 4: Keeping the forced path byte-identical
The measurement plans change the oracle in exactly two additive ways: `_parse_bill` returns three more string keys, and `OkxOpeningReading` gains a defaulted `walked` field (`tuple[Mapping[str, str], ...] = ()`), filled on BOTH return arms (hoist `bills` above the `try` so the `except OpeningUnavailable` arm can hand over what it fetched). `per_ccy_opening`, `walk_okx_bills_archive`'s control flow, `opening_agrees`, the reason set and `_okx_forced_opening_check` are not edited. The existing `_GAP_CASES` parametrization (`tests/test_okx_opening_balance.py:272-296`) and `tests/test_okx_anchor_rule.py` (`_UNPROVABLE_CASES`, `:264`) are the regression net and must stay green untouched. [VERIFIED: `OkxOpeningReading(` is constructed only inside `okx_opening_balance.py`, `grep -rn` this session, so a defaulted field breaks no caller.]

### Anti-Patterns to Avoid
- **Editing `per_ccy_opening` to "also report"**: it is the forced path's verdict. Report from a separate pure function.
- **A second archive walk as the evidence**: it can disagree with the walk that refused. Use `reading.walked`; label any second read as a second read (`chain_repeat_reason`).
- **Printing the oracle token alone**: `chain_break` hides the arm, the currency and the others. Keep printing it, and add the arm.
- **Treating `bal_over_cashbal = 1` as "close arm holds"**: it is 3-sig-fig rounded.
- **Adding a refusal-token for the diagnostic**: the forced refusal vocabulary is closed (16 tokens at the 172 deploy: `import-check: 0 16 True 0.05 True`, 172-05-SUMMARY). The opening reasons are a separate closed set; nothing in the measurement plans adds to either.
- **A `type`/`instType`/`ccy`-filtered walk in the oracle's production path** before the measurement says it is needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 429 backoff on any bills/subtypes/`bills` page | A retry loop | `_okx_bills_fetch_with_backoff` (`exchange.py:1378`) | Retries only `RateLimitExceeded`/`DDoSProtection`, re-raises the rest (PD-I) |
| Parsing a venue number | `float(x)` | `obal._decimal` semantics (`Decimal(str(v))`, reject bool/NaN/inf) | Money must not be guessed or zeroed |
| Probe output redaction | `print(json.dumps(...))` | `emit_record` + `ratio_or_absent`/`sig3` + per-key validators | The only audited path to stdout |
| Stable set | A literal | `STABLECOINS` | The replay and the oracle must agree on what is cash |
| Order-independent chain test | A permutation search | Balance-multiset degree test (start/end `Counter` difference) | O(n), exact on `Decimal`, no ordering assumption; necessary-not-sufficient is stated in the key's description |
| OKX raw reply fakes | `AsyncMock()` for OKX methods | Extend `tests/_okx_bills.py` | An unset method on `AsyncMock` answers with a `MagicMock` (Phase 172 Pitfall 2) |
| Subtype list parsing | Importing `okx_archive_job._parse_live_subtypes` | A 6-line local parse of `data[].type` | That module pulls the job worker into the probe; note its own comment records that the first real call read 0 entries because the shape was guessed (`okx_archive_job.py:764-769`), so the parse must tolerate both nested `subTypeDetails` and flat shapes and report `0 types` as a count, not a pass |

**Key insight:** every piece of the diagnostic is a pure fold over bills already fetched plus a few GETs the repo already issues elsewhere. The risk is not the volume of code; it is that each additional printed value is a redaction decision, so the vocabulary stays closed and validated.

## Common Pitfalls

### Pitfall 1: Reading `bal_over_cashbal=1` as a cleared close arm
**What goes wrong:** the CONTEXT's "`bal_over_cashbal=1` suggests USDT's close arm holds" sends the investigation to interior links first. **Why:** the ratio is `sig3`-rounded, so any gap under about 0.05% prints `1`; on an account that trades, a few fees or one fill between the balance read and the walk is that size. **Avoid:** print `chain_close_residual_bucket` and the post-walk comparison; do not rank the arms by the old ratio. **Warning sign:** a plan task that begins with "the close arm is fine".

### Pitfall 2: A race built into the read order
**What goes wrong:** the cash map is read once before a walk of 15+ pages; any bill created in between makes the newest bill's `bal` differ from the pre-read `cashBal`. **Why:** a4 had 1282 fills in 90 days and holds open positions (`upl_over_anchor=0.0107`); funding settles on a schedule. **Avoid:** measure `chain_close_cash_moved`/`chain_close_matches_after`, and run the probe away from funding boundaries (see Operator checkpoints). **Warning sign:** `chain_close_matches_after > 0`.

### Pitfall 3: Ties and inversions are invisible in the existing fakes
**What goes wrong:** the fixes are tested only against `okx_bill_chain`, whose ids and timestamps "rise together, as on the venue" (`tests/_okx_bills.py` docstring). **Why:** nobody has seen a real tie or inversion on the JSON endpoint; the file chain held in `billId` order on ONE account's quarter files (1605 pairs, Phase 167.1.2.2.2.1 VERIFICATION), which is not the JSON endpoint and not a4. **Avoid:** build fakes with same-`ts` bills, billId/ts inversions and shuffled pages first (they are the Wave 0 gap), then assert `analyse_chain` names them.

### Pitfall 4: The 7-day `bills` store and the archive are not guaranteed to agree
**What goes wrong:** assuming identical rows over the overlap. **Why:** [ASSUMED] (A1). The docs describe `bills` as "last 7 days" and the archive as "last 3 months" with the same fields; whether the archive is populated in real time is not documented. **Avoid:** the overlap keys (`chain_recent_only_bills`, `chain_recent_field_mismatch`, `chain_archive_behind`) turn the assumption into a reading.

### Pitfall 5: The probe source pins
**What goes wrong:** a new probe line trips a static test. **Why:** `tests/test_allocator_history_probe.py:796` forbids `re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", _PROBE_SRC)`, `:799` forbids `private_(post|put|delete)_`, `:2362` asserts `"private_get_account_bills_archive" not in _PROBE_SRC  # the oracle owns that call`, and `:2346-2359` requires every `supabase` parameter of `_anchor_diagnostic`/`_measure_anchor` to be annotated `ReadOnlySupabase`. **Avoid:** all venue I/O lives in `services/okx_bills_chain.py`; do not name a helper ending in `transfer(` (use `transfers_net_`); keep `_measure_anchor`'s signature unchanged.

### Pitfall 6: Census edits (grep them all)
`tests/test_allocator_history_probe.py:940` asserts `set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))`; `_diagnostic_control()` (`:2255`) builds a control record from `_account_record`; `tests/test_okx_opening_balance.py:356` pins `{p.values[0] for p in _GAP_CASES} == obal.OPENING_UNAVAILABLE_REASONS`; `tests/test_okx_anchor_rule.py:304` pins `_OPENING_CHECK_VOCABULARY` and `:406` has `test_every_unavailable_token_has_an_anchor_rule_case`. If the founder picks a NEW opening reason, all three and the `_GAP_CASES`/`_UNPROVABLE_CASES` lists move together.

### Pitfall 7: Phase 173 touches the same probe, tests and helpers
See "Phase 173 collision map" below. Short form: add 179's keys through `*okx_chain_record.CHAIN_KEYS` at the END of each of three structures, put 179's logic in new modules, append (never insert) in the probe test file, and keep 179's pure tests in a new file.

### Pitfall 8: Walking the funding boundary into the evidence
Funding settles at fixed UTC times (OKX documents funding bills as type 8, subType 173/174 [CITED: okx.com/docs-v5/en bill `px` description: "173: Funding fee expense 174: Funding fee income"]; the 00:00/08:00/16:00 UTC schedule is [ASSUMED]). A run just after a boundary can see a settlement mid-flight and confuse a transient with a structural break. **Avoid:** schedule the run at least 20 minutes clear of a boundary and rely on `chain_repeat_reason`.

### Pitfall 9: A repeat read that hides the first
Reporting only the second oracle read would erase the original refusal. The probe already records the first reading's `opening_unavailable_reason`; `chain_repeat_reason` is an ADDITIONAL key and never overwrites it.

## Code Examples

### The pure analysis skeleton (proposal; names are not final)
```python
# services/okx_bills_chain.py  (NEW, strict-typed; no I/O in this function)
from collections import Counter
from decimal import Decimal
from collections.abc import Mapping, Sequence

def _chain_stats(group: Sequence[Mapping[str, str]], cash: Decimal) -> "_CcyStats":
    ordered = sorted(group, key=lambda b: int(b["billId"]))
    breaks: list[tuple[int, Decimal]] = []          # (index, residual = bal - (prev + chg))
    for i in range(1, len(ordered)):
        prev = Decimal(ordered[i - 1]["bal"])
        bal, chg = Decimal(ordered[i]["bal"]), Decimal(ordered[i]["balChg"])
        if bal != prev + chg:
            breaks.append((i, bal - (prev + chg)))
    starts = Counter(Decimal(b["bal"]) - Decimal(b["balChg"]) for b in ordered)
    ends = Counter(Decimal(b["bal"]) for b in ordered)
    unmatched_starts = sum((starts - ends).values())    # a perfect chain leaves exactly 1 (the opening)
    unmatched_ends = sum((ends - starts).values())      # and exactly 1 (the close)
    close_ok = Decimal(ordered[-1]["bal"]) == cash
    ...
```
Residual relative bucket: `scale = max(abs(bal), abs(prev), abs(chg))`; `scale == 0 -> "zero"`; else decade of `abs(residual) / scale`. The residual SIGNATURE: `bal == prev` -> `bal_unchanged`; `residual == chg and chg != 0` -> `double_count`; two consecutive breaks with `r_i + r_{i+1} == 0` -> `swapped_pair`; else `other`.

### The record splices (the only probe edits besides `_measure_anchor`'s tail)
```python
# scripts/allocator_history_probe.py  [VERIFIED anchors: tuple end :283-288, validators end :404-405, defaults end :1300-1304]
ACCOUNT_RECORD_KEYS: tuple[str, ...] = (
    ...
    "opening_day_is_window_start",
    *okx_chain_record.CHAIN_KEYS,          # + one line before the closing paren
)
_ACCOUNT_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    ...
    "opening_day_is_window_start": _is_bool_or_absent,
    **okx_chain_record.CHAIN_VALIDATORS,   # + one line before the closing brace
}
# _account_record(): "opening_day_is_window_start": FIELD_ABSENT,  then  **okx_chain_record.chain_defaults(),
```
`okx_chain_record` must not import the probe (circular); it defines its own tiny predicates (`_is_count_or_absent`, ratio-free) and imports only `FIELD_ABSENT`/`FAILURE_CLASSES` from `scripts.bybit_upnl_probe`.

### A fake that models the venue irregularities the oracle has never met (Wave 0, extend `tests/_okx_bills.py`)
```python
# additive, default-off switches on OkxBillsArchive / new helpers
# - same_ts_pairs: two bills with one ts whose billId order is NOT the balance-update order
# - tail_hidden=N: the archive omits its newest N bills while a separate 7-day fake serves them
# - hide_type={"1"}: an unfiltered query omits that type, a query with type="1" serves it
# - OkxBalanceSequence([payload_before, payload_after]): private_get_account_balance answers differently per call
# - okx_detail(..., u_time="...") and okx_bill(..., sub_type="173", mgn_mode="cross", pos_bal_chg="0")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Opening balance from the replay alone | Bills archive as an independent check-only oracle | Phase 172 (v0.133.4.0, #1136) | Made the question answerable; the first complete walk on a4 refused with `chain_break` |
| Partial one-page bills walk (`bills_read=100`, `bal_over_cashbal=0.932`) | Complete backward walk with proof of reach | Phase 172 round 1 | The old 0.932 and the 0.0147 residual are superseded; the unit test `test_bills_whose_newest_balance_is_not_todays_cash_are_not_a_measurement` replays that old shape |
| `begin`-bounded bills query | `after`-paged, no `begin` | Phase 172 round 1 | A `begin`-bounded reply can be oldest-first and hide the newest bills (`test_a_begin_bounded_query_served_oldest_first_does_not_hide_the_newest_bills`). The diagnostic's filtered presence sweep deliberately DOES send `begin`; it only asks whether ANY unseen bill appears, so reply order does not matter |

**OKX documentation, read this session** [CITED: https://www.okx.com/docs-v5/en/ , fetched with curl 2026-10-28, quotes verbatim]:
- `GET /api/v5/account/bills-archive`: "Retrieve the account's bills. The bill refers to all transaction records that result in changing the balance of an account. Pagination is supported, and the response is sorted with most recent first. This endpoint can retrieve data from the last 3 months." Rate limit "5 requests per 2 seconds". `after`: "Pagination of data to return records earlier than the requested bill ID." `begin`/`end`: "Filter with a begin timestamp ts." `limit`: "The maximum is 100." `instType`: "SPOT MARGIN SWAP FUTURES OPTION EVENTS". Filters `mgnMode` (`isolated`, `cross`), `ctType`, `type`, `subType`, `instId`, `ccy` exist.
- `GET /api/v5/account/bills`: same description with "This endpoint can retrieve data from the last 7 days." and "Rate Limit: 5 requests per second".
- Fields: `bal` "Balance at the account level"; `balChg` "Change in balance amount at the account level"; `posBal` "Balance at the position level"; `posBalChg` "Change in balance amount at the position level"; `ts` "The time when the balance complete update"; `fillTime` "Last filled time"; `fee` "Negative number represents the user transaction fee charged by the platform. Positive number represents rebate."; `interest`, `pnl`, `sz`, `mgnMode` ("When bills are not generated by trading, the field returns """), `from`/`to` for transfers. The docs state NOTHING about the ordering key behind "most recent first" (billId or ts) and nothing about ties.
- `GET /api/v5/account/balance`: "Retrieve a list of assets (with non-zero balance), remaining balance, and available amount in the trading account." Top-level `uTime` "Update time of account information"; per currency `cashBal` "Cash balance" and `uTime` "Update time of currency balance information". The 172 research noted the docs' own example satisfies `eq = cashBal + upl + stgyEq`, so strategy-bot equity is outside `cashBal`.
- `GET /api/v5/account/subtypes` ("Get bill types"): returns `{type, typeDesc, subTypeDetails: [{subType, subTypeDesc}]}`; "" in a description "means the type is not enabled". Rate limit "20 requests per 2 seconds".
- Changelog: bill type 34 / subType 355 "Settlement PnL" added 2025-03-12; type 1 / subType 381 "Auto earn (auto lend)" added 2025-09-11; auto-convert subTypes 379/380 and collateralized-borrowing auto-conversion subTypes 376/377 added during 2025 [CITED: https://www.okx.com/docs-v5/log_en/]. These are balance-moving bill types that did not exist when older code was written; the type presence sweep is what finds one the unfiltered walk omits.

**Deprecated/outdated:** the Phase 172 reading "`bal_over_cashbal=0.932`" and "`opening_residual_over_anchor=-0.0147`" (partial walk) are superseded and must not be cited as measurements.

## Likely fix shapes (for the post-measurement replan; NOT a recommendation, CONTEXT D-03)

| If the reading shows | Named cause | Fix shape | RED-on-old test | Founder-decision surface |
|---|---|---|---|---|
| `chain_arm=close`, `chain_close_matches_after > 0` or `chain_close_cash_moved > 0`, `chain_repeat_reason=none` | Race: cash read before a long walk | Read the cash map AFTER the walk (or bracket it: pre and post equal, else read once more); compare `uTime` to the newest bill `ts`. A moving balance after bounded re-reads is `chain_break` still, no new token | Balance fake whose first answer predates the newest bill: old code `chain_break`, new code measured | none |
| `chain_close_utime_after_bill > 0` or `chain_archive_behind` not `none`, `chain_recent_only_bills > 0` | Archive lags the 7-day store | Splice the newest end from `/account/bills` (dedupe by billId, require identical `bal`/`balChg` on the overlap or refuse, require at least one overlapping billId so contiguity is proven) | Archive fake hiding its newest N bills while the 7-day fake serves them | whether a lagging archive is a named refusal instead |
| `chain_arm=interior`, `chain_trail_ccys == chain_ccys_checked`, `chain_closes_by_ts_id*` > 0, `chain_same_ts_breaks > 0` or inversions > 0 | Order: `billId` is not the balance-update order | Order each currency by the key that closes (ts then billId, or chain by `bal - balChg` linkage) ; if ambiguous (repeated balances, zero changes) refuse | Shuffled/tied fake: old order breaks, new order closes | none, unless ambiguity needs a named refusal |
| `chain_gap_estimate > 0`, `chain_types_hidden > 0` or `chain_inst_types_hidden > 0` | Bill types/instTypes missing from the unfiltered walk | Walk the missing filters too and merge by billId before the chain check; or a named refusal | Archive fake that hides a type unless `type=` is sent | adds a request budget; possibly a new reason |
| `chain_gap_estimate > 0` with no hidden type and no lag, breaks on one kind | A real gap in OKX's archive (OKX does not serve a bill) | Record as a real gap behind a NEW named refusal (for example `bills_archive_gap`, a placeholder name) | Gap fake: refusal carries the new token | YES: `OPENING_UNAVAILABLE_REASONS` is a closed set; adding a token is a founder decision |
| `chain_sig_bal_unchanged` or `chain_sig_double_count` concentrated on one kind (funding, auto earn, bot, isolated), or `chain_break_mgn_modes` shows `isolated`, or `chain_break_pos_level` > 0 | `bal` is not the account-level cash for that kind | Exclude or special-case that kind in the chain, or refuse by name for accounts that use it | Kind-specific fake | YES if a new token |
| `chain_worst_ccy_is_stable=false`, tiny `chain_close_residual_bucket` (`lt_1e-9` or smaller), USDT clean | Dust/precision on a non-stable currency | A per-currency USD-value tolerance on the close arm; or drop sub-dust currencies from the check. Loosens "exact Decimal equality", so it is a decision | Dust-diff fake | YES: loosening a data-integrity equality |
| Nothing breaks and `chain_repeat_reason=none` and the first read was `chain_break` | Transient (race or lag) not reproduced | Same as the race row; one run cannot prove it, plan for a second run | - | whether to spend a second Railway run |

A fix reaches the forced rebuild's decision (`obal.read_okx_opening` behind the forced path), so every fix test must also run through the real `_fetch_and_price_window` in the `tests/test_okx_anchor_rule.py` style (`_okx_world`, `_UNPROVABLE_CASES`), not only through the oracle unit.

## Tolerance re-decision (SC-3)

`OPENING_TOLERANCE_REL = 0.05` and `OPENING_TOLERANCE_USD = 1.0` (`okx_opening_balance.py:126-127`) can only fire on a measured opening, and no measured residual exists yet (`tolerance-basis: opening_check=unavailable reason=chain_break residual=field-absent`, 172-05-SUMMARY). The existing rule from 172 plan 05 step 9b is: keep 0.05 only with `opening_check=measured` and an absolute `opening_residual_over_anchor` under 0.025; otherwise route. Re-use that rule verbatim and add the new caveat that still holds after this phase: ONE account (a4) is the only basis, and a second OKX account is unmeasured (`172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`, deferred item "A second OKX account"). The founder decides keep/re-set on the post-fix reading; the probe already prints `opening_residual_over_anchor` for a measured member, whether refused or agreed.

## Operator checkpoints (orchestrator-owned; plan as `checkpoint:human-action`)

Pattern: 172 plan 05, read in full this session. Reuse its structure:
1. Preconditions: PR merged; main CI green and bound to the merge SHA with the expected check count (`gh api "repos/<owner>/<repo>/actions/runs?head_sha=<sha>"` count); Railway deployed that head (it deploys only after main CI is green; a skipped deploy is the founder's to recover); UTC clock outside 23:30-00:30. Record `deployed-commit:`.
2. Import check through the same start-command wrapper, no payload, for example `python -c 'import scripts.allocator_history_probe as p, scripts.okx_chain_record as c; print(p.EXIT_OK, len(c.CHAIN_KEYS), "chain_arm" in p.ACCOUNT_RECORD_KEYS)'`; the expected line is a plan constant, and anything else is a STOP (deploy mismatch). Do not pin the refusal-token count blindly: 172's own `import-check:` expected 15 and the deployed count was 16 because Phase 171 had merged; derive expectations from the checkout being deployed.
3. Start `python -m scripts.allocator_history_probe` in the background with no arguments, print `probe-exit: <code>` whatever it is, then exec the normal start; apply with `railway redeploy --from-source` (172 recorded that a redeploy reusing the old service config never ran the wrapper). The probe exits 1 when any member is refused, so nothing may depend on exit 0.
4. Restore the start command at once and confirm the normal startup line; `worker-restored: yes` is gated; a worker that does not return outranks the measurement.
5. Paste only the `{"` lines (Railway's log view prints them as `key=value` attributes; rebuild JSON from the attributes, copy every value exactly). Gate: no uuid, no run of ten or more digits outside the commit line, scratch directory deleted.
6. Identify a4 by shape (`okx_members >= 1`, `window_days` 90, label recorded in 172) and record the `chain_*` keys as one `chain-reading:` line.
7. Timing: the full probe also reads the Bybit account and took about 18 minutes in the 172 run (a6 `read_elapsed_s=1048`, a4 printed before it). Start it so it ends before 23:30 UTC and at least 20 minutes clear of a funding boundary.
8. Sharing: Phase 173's checkpoint also runs the FULL probe once (its CONTEXT D-03: "No, full probe"; no transfers-only mode). If 179's measurement code is merged and deployed before 173's run, one Railway run serves both; otherwise 179 needs its own approved run. The founder question "share the run" is already listed in CONTEXT; the planner should make plan 02's `depends_on` and the shipping order explicit (see Open Question 3).
9. No enqueue, no SQL, no PROD write. The only record is the SUMMARY.

After the founder fix-choice checkpoint and the fix's deploy, the SC-3 re-read is a second operator run of the same form (and may share Phase 173's run if that run happens after the fix deploys). The tolerance question is asked at that run.

## Phase 173 collision map

Read this session: `git diff origin/main...HEAD -- analytics-service/scripts/allocator_history_probe.py` in the Phase 173 worktree (616 diff lines at the time of reading; 173 has review-fix rounds still landing, so re-run the diff at execution time).

173 edits, by region (probe): module docstring items 2, 4 and the READ-ONLY paragraph; `DEPLOYED_ER_NAMES` (+`BYBIT_TRADE_TERMINUS_DAYS`); `ACCOUNT_RECORD_KEYS` mid-tuple (after `okx_order_violations`, after `okx_passes_ended_full`, after `transfers_older_365d`); `SUMMARY_RECORD_KEYS` tail; `_ACCOUNT_VALIDATORS` mid-dict and `_SUMMARY_VALIDATORS` tail; new pure helpers after `transfers_older_than` and after `okx_newest_first`; `_busiest_inst_type` replaced; `_MemberResult`; `_read_member` signature; `_probe_member` (all three arms); `_account_record` defaults mid-dict; `_probe_account` record construction; `summarize`.

179 touch points and their overlap:

| 179 edit | Location | Overlap with 173 |
|---|---|---|
| import of `okx_chain_record` | import block near `:130-135` | 173 changes only the `collections.abc` import line (`:128`), three lines up: put 179's import AFTER the `from services...` lines, not next to `collections.abc` |
| `*CHAIN_KEYS` splice | LAST line of `ACCOUNT_RECORD_KEYS` (`:287`) | none: 173's inserts are mid-tuple |
| `**CHAIN_VALIDATORS` splice | LAST entry of `_ACCOUNT_VALIDATORS` (`:404`) | none (173's validator inserts are mid-dict) |
| `**chain_defaults()` splice | LAST entry of `_account_record` (`:1302`) | none |
| chain block | END of `_measure_anchor` (`:1092-1099`, inside the `else:` after `reading`) | none: 173 does not touch `_measure_anchor` |
| module docstring | item 5 / new item 6 | 173 rewrites items 2, 4 and the READ-ONLY paragraph: add a NEW item 6 AFTER item 5's last line and do not touch items 2-5 |
| tests | `tests/test_allocator_history_probe.py` | 173's hunks run through `~:2426` and edit `_OkxAnchorVenue`, `_refusing_reader`, `_anchoring_reader`, which 179's probe test would reuse: append ONE end-to-end test at the very END of the file, and put every pure test in the new test files |

Do NOT edit `_read_member`, `_probe_member`, `_probe_account`, `summarize`, `SUMMARY_*`. Do not add a record kind. The result is that a merge in either order is textually conflict-free in the probe and conflict-light in its tests. [VERIFIED for the code regions above by reading both files this session; hunks can still shift as 173 lands review fixes.]

## Runtime State Inventory

Not a rename/refactor/migration phase. None. (No stored data, service config, OS registration, secret name or build artifact carries a name this phase changes. Verified by scope: the measurement plans add code and a probe record; the fix plans change an in-process function; `anchor_opening_check` is a free-text audit field with no SQL or TS vocabulary pin, `grep -rn` this session.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | tests, mypy | yes | 3.14.3 (CI 3.12 [CITED: Phase 172 research, `ci.yml`]) | CI authoritative; avoid 3.13+ only syntax |
| pytest suite | all tests | yes | `129 passed` on `tests/test_okx_opening_balance.py tests/test_allocator_history_probe.py` this session (5.9 s) | - |
| mypy | CI line | yes | 2.0.0 local (CI pin 2.4.0); `services/okx_opening_balance.py` passes `--strict` locally | CI authoritative |
| ccxt | OKX implicit methods | yes | 4.5.64 local (pin 4.5.88); local exposes `private_get_account_bills`, `private_get_account_bills_archive`, `private_get_account_subtypes` | the repo already calls all three at the pinned version |
| Railway CLI | operator step | present (`railway 5.71.0`), `railway ssh` known broken | - | start-command wrapper with founder approval (172 pattern) |
| Network to OKX docs | doc check | yes | fetched | - |
| Database / PROD / Railway from a dispatched agent | none | NOT USED | - | operator checkpoints only |

**Missing dependencies with no fallback:** none. The operator run needs the founder's approval per run (a PROD service setting).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest, `asyncio_mode = auto` (`analytics-service/pytest.ini`) |
| Config file | `analytics-service/pytest.ini` |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_okx_opening_balance.py tests/test_okx_anchor_rule.py tests/test_okx_bills_chain.py tests/test_okx_chain_record.py tests/test_allocator_history_probe.py -x -q` |
| Full suite command | `cd analytics-service && python3 -m pytest -q` (CI: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`) plus the verbatim mypy line from Project Constraints |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | `analyse_chain` names the arm over ALL currencies (interior only, close only, both, none) and does not stop at the first failing currency | unit (pure) | `python3 -m pytest tests/test_okx_bills_chain.py -k arm -x -q` | Wave 0 |
| SC-1 | worst currency, stable flag, break kinds (cur and prev), mgnMode tally for a seeded multi-currency break; top-5 truncation with `other:n` | unit | `... -k kinds -x -q` | Wave 0 |
| SC-1 | residual bucket edges (exact `Decimal` boundaries) and residual signatures (`bal_unchanged`, `double_count`, `swapped_pair`, `other`) | unit | `... -k residual -x -q` | Wave 0 |
| SC-1 | ordering: inversions, same-ts links/breaks, trail-exists, re-close under `(ts, id)` and `(ts, -id)` on a tied and on an inverted fake | unit | `... -k order -x -q` | Wave 0 |
| SC-1 | topology: a deleted middle bill gives `chain_gap_estimate == 1` and `chain_trail_ccys` excludes that currency | unit | `... -k gap -x -q` | Wave 0 |
| SC-1 | close race: a balance fake that changes between calls gives `chain_close_cash_moved`, `chain_close_matches_after`, `chain_close_bill_after_utime`; archive-lag fake gives `chain_close_utime_after_bill` and `chain_archive_behind` | unit with fakes | `... -k race -x -q` / `-k lag` | Wave 0 |
| SC-1 | 7-day overlap: only-in-bills, only-in-archive, field mismatch, ceiling gives `chain_recent_complete=False`; every call goes through `_okx_bills_fetch_with_backoff` and is a GET | unit with fakes | `... -k recent -x -q` | Wave 0 |
| SC-1 | type/instType sweep finds a hidden type; call ceiling gives `chain_sweep_complete=False`; `0 types` from subtypes is a count, not a pass | unit with fakes | `... -k sweep -x -q` | Wave 0 |
| SC-1 | repeat read: transient (second read measured) vs structural (same reason); a venue exception in the repeat sets the failure class and keeps the first keys | unit | `... -k repeat -x -q` | Wave 0 |
| SC-1 | vocabulary and redaction: each `chain_*` key refuses an out-of-vocabulary value (unrounded float, bool for count, ccy outside the regex, kind list with an amount, a 40+ char token); synthetic distinctive amounts and billIds never appear in `emit_record` output; no key name contains a deny substring | unit | `python3 -m pytest tests/test_okx_chain_record.py -x -q` | Wave 0 |
| SC-1 | census: `set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record(...))` still holds; defaults are all `field-absent`/`not-run` for a member with no chain break | unit | `python3 -m pytest tests/test_allocator_history_probe.py -k "vocabulary or diagnostic" -x -q` | exists (extend by appending) |
| SC-1 | end-to-end through `hp.run()` on an a4-shaped fake: refused `anchor_skipped_implausible`, oracle `chain_break`, record carries `chain_arm` and the rest, the forced pass's counters are not doubled, `services.supabase.writes == []`, the refusal stays | e2e with fakes | appended test in `tests/test_allocator_history_probe.py` | Wave 0 (append at END only) |
| SC-1 | static pins: the new services module is GET-only (no `.insert(` `.update(` `.upsert(` `.delete(` `.rpc(`, no `private_(post\|put\|delete)_`, no `create_order\|cancel_order\|withdraw\|transfer(`), never names `bills_history_archive` or `_stamp_429`; the probe source still lacks `private_get_account_bills_archive` | static | `python3 -m pytest tests/test_okx_bills_chain.py tests/test_allocator_history_probe.py -k "get_only or read_only or static" -x -q` | Wave 0 + exists |
| SC-1 | forced path unchanged: the whole of `test_okx_opening_balance.py` (`_GAP_CASES`) and `test_okx_anchor_rule.py` (`_UNPROVABLE_CASES`) stay green untouched; `OkxOpeningReading().walked` default is `()` | unit | `python3 -m pytest tests/test_okx_opening_balance.py tests/test_okx_anchor_rule.py -x -q` | exists |
| SC-1 | LIVE: the deployed probe on a4 prints a `chain_arm` other than `not-run` | operator checkpoint | n/a (manual-only, PROD read) | n/a |
| SC-2 | Fix path: a replay of a4's reading shape (built from the chosen cause) is `chain_break` on the OLD code and `measured` (or the named refusal) on the new, through the oracle AND through the real `_fetch_and_price_window` | unit + forced-path e2e | written after the founder checkpoint | after D-03 |
| SC-2 | Named-refusal branch: the new token is in `OPENING_UNAVAILABLE_REASONS`, has a `_GAP_CASES` entry, a `_UNPROVABLE_CASES` entry and an audit-vocabulary entry; the forced refusal stays `anchor_skipped_implausible` and nothing is written | unit + e2e | after D-03 | after D-03 |
| SC-2 | a4 never anchors on an unproven opening: any non-"agreed" outcome still refuses (pinned by the existing `test_each_unprovable_opening_refuses_by_name`) | e2e | `python3 -m pytest tests/test_okx_anchor_rule.py -x -q` | exists |
| SC-3 | Post-deploy re-read of a4 and the tolerance decision | operator checkpoint | n/a | n/a |

### Mutations to run (neuter, see RED, restore from a byte backup; never `git checkout`/`restore`/`stash`)
(N1) `analyse_chain` returns `chain_arm="none"` unconditionally -> the arm tests go RED. (N2) the loop stops at the first failing currency (mimic `per_ccy_opening`) -> the multi-currency arm test goes RED. (N3) the post-walk comparison is skipped -> the race test goes RED. (N4) the multiset test counts only starts -> `chain_trail_ccys` tests go RED. (N5) the residual bucket edges shift by one decade -> the boundary test goes RED. (N6) the 7-day reader bypasses `_okx_bills_fetch_with_backoff` -> the backoff test goes RED. (N7) a `private_post_` name is added to the new module -> the static pin goes RED. (N8) a validator accepts an unrounded float or a 40-char string -> the redaction test goes RED. (N9) the repeat read overwrites the first `opening_unavailable_reason` -> the e2e test goes RED. (N10) `walked` omitted on the `except` arm -> the e2e chain test goes RED.

### Sampling Rate
- **Per task commit:** the quick run command above.
- **Per wave merge:** the full suite and the verbatim mypy line (services/ is strict-typed; run it from `analytics-service/`).
- **Phase gate:** full suite green, CI green and bound to the head SHA, the probe lines pasted from the worker, `chain_arm` recorded, the founder's fix choice recorded, and the SC-3 reading recorded before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_okx_bills_chain.py` - SC-1 (new)
- [ ] `analytics-service/tests/test_okx_chain_record.py` - SC-1 vocabulary/redaction (new)
- [ ] Extend `analytics-service/tests/_okx_bills.py`: tie and inversion switches, a 7-day `bills` fake with `after`/`begin`, a subtypes fake (nested `subTypeDetails`, flat, empty), a balance sequence, `uTime`/`subType`/`mgnMode`/`posBalChg` parameters (additive; default-off so the 172 tests are untouched)
- [ ] One appended end-to-end test at the END of `tests/test_allocator_history_probe.py`
- [ ] Framework install: none

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Keys are decrypted only in the worker (`decrypt_credentials`); no new auth |
| V4 Access Control | yes (operator) | Read-only exchange keys, GET-only calls, `ReadOnlySupabase`; start-command change is a founder-approved checkpoint |
| V5 Input Validation | yes | Venue JSON is untrusted: `Decimal` parse that rejects bool/NaN/inf, non-dict/non-list replies fail, billId digits only, every printed token validated by regex or closed set |
| V7 Error handling and logging | yes | Exception CLASS only (`classify_failure`), never `str(exc)`; logging is switched off for the probe run |
| V8 Data protection | yes | Public repo: counts, booleans, closed tokens, bucketed ratios; no amount, bill id, uuid, home path or account number; `assert_sanitized` as a belt |
| V13 API | yes | Respect `bills-archive` 5 requests / 2 s, `bills` 5 / s, `subtypes` 20 / 2 s via ccxt throttling and the backoff helper; a hard call ceiling on the sweep; never POST `bills-history-archive` |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account size or holdings leaked through the record (a bucket that is really an amount, a ccy list, a kind list with a rare instrument) | Information disclosure | Relative buckets only; ccy symbol validated and bounded (Open Question 1); kind tokens are numeric OKX enum codes plus a closed instType/mgnMode set; counts only |
| A bill id or uuid reaches stdout through a token list | Information disclosure | Validators reject any digit run of 10+ digits and any uuid shape; `assert_sanitized`; test with synthetic distinctive billIds |
| A diagnostic exception changes the refusal | Tampering | The diagnostic is wrapped by class; `reading` and the forced path are unchanged; the refusal stays `anchor_skipped_implausible` |
| Probe run left a PROD service on the wrapper | Denial of service | Background probe plus exec of the normal start; restore before analysis; `worker-restored: yes` gated |
| Unbounded sweep or paging on a live account | Denial of service | Page and call ceilings, `chain_sweep_complete`/`chain_recent_complete` booleans, the existing crawl timeout |
| A fix loosens equality and anchors on an unproven opening | Tampering (data integrity) | Any loosening is a founder decision with a RED test; non-"agreed" still refuses |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `/account/bills` and `/account/bills-archive` serve identical rows (billId, bal, balChg, ts, ccy) over their 7-day overlap | Pitfall 4, recent-overlap keys | The overlap keys read as a defect where there is none, or hide a real divergence; the keys measure it |
| A2 | `billId` order equals the order in which balances were updated, on the JSON endpoint (it held in `billId` order on one account's quarter FILES) | Pattern 1, ordering keys | If false the interior arm fires on ties/inversions; measured by the ordering keys |
| A3 | A `type=<t>` or `instType=<i>` filtered query with `begin` serves bills the unfiltered query omits when a type is hidden | Sweep keys | The sweep proves nothing; it can only report "no hidden kind", which is itself the reading |
| A4 | The race (a bill created between the balance read and the newest page) is large enough to matter on a4 | Pitfall 2 | If wrong the post-walk keys read zero and the cause is elsewhere; costs nothing extra |
| A5 | OKX funding settles at 00:00, 08:00 and 16:00 UTC and bills for it can lag | Pitfall 8, operator timing | The 20-minute margin is unnecessary; `chain_repeat_reason` still discriminates |
| A6 | `bal` is the account-level cash balance for every bill kind, including isolated-margin, bot-transfer and earn bills | fix-shape row 6 | If false the interior arm fires on that kind; measured by kind and mgnMode tallies |
| A7 | The archive can lag the 7-day store | fix-shape row 2 | Measured by `chain_archive_behind` |
| A8 | The balance-multiset degree test (starts vs ends) is necessary but not sufficient for an order-independent chain (it ignores connectivity) | `chain_trail_ccys` | A currency could read "trail exists" while split into disjoint cycles; the key's description states necessary-not-sufficient |
| A9 | Extra GETs (about 30 + one per enabled bill type) finish well inside the 1500 s crawl bound and the exchange's rate limits | Pattern 3 | A ceiling hit sets the `*_complete` booleans false; no verdict changes |
| A10 | A currency symbol is safe to print (public ticker, no amount) | `chain_worst_ccy` | Redaction contract widens from closed vocabulary; see Open Question 1 |
| A11 | `ccxt 4.5.88` costs and throttling for `account/bills` and `account/subtypes` match the local 4.5.64 | Environment | Longer run only |

## Open Questions (RESOLVED)

Every question below is resolved or routed to a named plan step (plans 179-01 to 179-03, 2026-10-28). The original analysis under each RESOLVED line is kept as lineage.

1. **May the probe print the worst currency's symbol?**
   - RESOLVED: the closed vocabulary is the default (CONTEXT Claude's Discretion: `STABLECOINS` plus `BTC`, `ETH`, `OKB`, anything else `other`, with a stable flag), built by 179-01 (`_ccy_class` and the chain_worst_ccy validator). The free ticker stays a founder call and is asked BEFORE the run at 179-03 Task 1 step 0 (keep the closed class, recommended; or widen to the regex-validated ticker, which needs a code change and a redeploy first). When the closed class is kept and the reading prints `other`, 179-03 Task 1 step 9 records `sc1-ccy-limit:` (`other` names no currency).
   - What we know: the CONTEXT and the orchestrator ask for a "currency token"; the redaction contract is "labels, counts, booleans, closed-vocabulary tokens and 3-significant-figure ratios". A ticker is public and carries no amount, but it is not a closed vocabulary and reveals one holding.
   - What's unclear: whether the founder treats a ticker as inside the contract.
   - Recommendation: default to the regex-validated symbol `^[A-Z][A-Z0-9]{1,9}$` (starts with a letter so it cannot be a 10-digit run), and fall back to `STABLECOINS` plus `BTC`, `ETH`, `OKB` with everything else printed as `other` if the founder objects. Put it to the founder with the plan, not after the run.
2. **How many extra requests may the one run spend?**
   - RESOLVED: CONTEXT Claude's Discretion ("a hard call ceiling (about 120) with `*_complete` booleans when it is hit"), built by 179-02 (`CHAIN_CALL_CEILING` 120 over one `BudgetedExchange`; `chain_ceiling_hit`, `chain_below_stop_complete`, `chain_recent_complete`, `chain_sweep_complete`, `chain_sweep_partial`). 179-03 Task 2 records `chain-completeness:` and never derives a fix from a search that did not run to its end: a cut-short search recommends second-run with a caveat, and named-refusal needs `chain-completeness: complete`.
   - What we know: each Railway run needs approval; the sweep adds one call per enabled bill type (count unknown until `subtypes` is read) plus six instTypes.
   - Recommendation: Tier A plus the 7-day overlap in plan 01; keep the type sweep in the same plan with a hard ceiling (suggest 120 calls) so a second run is not needed to test "bill types missing".
3. **Ship order against Phase 173.**
   - RESOLVED: routed to 179-03 Task 1 step 0 (the founder answers whether this run is shared with 173's next probe run; recommendation: share when 173's measurement code is merged and on the deployed head, otherwise run 179 alone) and to its precondition (the 179 merge is an ancestor of the deployed commit). The probe splices are append-only (collision map), so either merge order rebases mechanically; 179-02 depends only on 179-01, never on 173.
   - What we know: 173's checkpoint runs the full probe once; if 179's measurement is deployed first, the one run serves both; the collision map keeps the probe merge conflict-free in either order.
   - Recommendation: land whichever finishes first and rebase the other (the splices rebase mechanically); the orchestrator decides whether plan 02's run waits for 173's.
4. **If the first run reads `measured` (the break does not reproduce).**
   - RESOLVED: routed to 179-03 Task 1 step 9 (`sc1: not-measured (...)` and a STOP asking the founder whether to spend a second approved run; no arm is claimed that was not measured) and to Task 2 row 1 (second-run).
   - What we know: the SC-1 arm cannot then be named from that run alone.
   - Recommendation: record `chain_repeat_reason` and the original `chain_break` from 172-05 as the only evidence of a transient, apply the race/lag fix shapes, and ask the founder whether to spend a second run; do not claim a named arm that was not measured.
5. **Whether the later fix may add a new `OPENING_UNAVAILABLE_REASONS` token.** Founder decision (module docstring); the cost list is Pitfall 6.
   - RESOLVED: routed to the founder at 179-03 Task 2 (the `named-refusal` option, whose cons list the censuses it moves; `new-reason-token:` records the founder-named token or `none`). The fix itself is written by the replan that follows that choice (CONTEXT D-03).

## Sources

### Primary (HIGH confidence)
- Repo source read in full this session: `analytics-service/services/okx_opening_balance.py`, `scripts/allocator_history_probe.py` (record keys, validators, `_measure_anchor`, `_probe_member`, pins), `tests/test_okx_opening_balance.py` (gap cases, static pin, tolerance pin), `tests/_okx_bills.py`, `tests/test_okx_anchor_rule.py` (forced-path template, vocabulary pin), `tests/test_allocator_history_probe.py` (`:700-2362` regions cited), `services/okx_archive_classify.py` (`verify_bal_chain`, `_bill_order_key`), `services/okx_archive_job.py` (`_subtypes_census`, `_parse_live_subtypes`), `services/equity_reconstruction.py` (`_okx_forced_opening_check`, anchor block `:4348-4364`), `services/exchange.py` (`_okx_bills_fetch_with_backoff`, `fetch_daily_pnl` bills loop), `scripts/deribit_ground_truth.py` (`assert_sanitized`).
- Phase 172 records: `172-RESEARCH.md`, `172-03-SUMMARY.md`, `172-05-SUMMARY.md`, `172-05-PLAN.md` (operator pattern), `TODOS.md` entries `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` and `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`.
- Phase 173 worktree diff of `scripts/allocator_history_probe.py` and `173-CONTEXT.md` (read-only).

### Secondary (MEDIUM confidence)
- [CITED: https://www.okx.com/docs-v5/en/] OKX API v5 docs fetched with curl on 2026-10-28 and read from the saved text: Trading Account > Get balance; Get bills details (last 7 days); Get bills details (last 3 months); Apply/Get bills details (since 2021); Get bill types. Quotes above are verbatim.
- [CITED: https://www.okx.com/docs-v5/log_en/] OKX API changelog: bill type/subType additions (2025-02-12, 2025-03-12, 2025-06-13, 2025-07-24, 2025-09-11).

### Tertiary (LOW confidence)
- A web search for community reports of `bal`/`balChg` chain mismatches or `billId` ordering on `bills-archive` returned nothing relevant; all ordering, tie, lag and `bal`-semantics claims are therefore [ASSUMED] and are exactly what the measurement is designed to read.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new package; every helper named was read in the repo.
- Architecture (seams, collision map, probe contract): HIGH - read from both worktrees with line anchors; 173's hunks can still move.
- Measurement shape: MEDIUM-HIGH - every key is a deterministic fold or a documented GET; the key count is a planner trade-off (Tier A/B).
- Candidate causes and fix shapes: MEDIUM - derived from the code and the documented fields, unmeasured on a4.
- Pitfalls: HIGH for 1, 3, 5, 6, 7 (code-verified); MEDIUM for 2, 4, 8.

**Research date:** 2026-10-28
**Valid until:** 2026-11-04 for the line anchors and the 173 collision map (re-run the diff and `grep -n` at plan time; the probe file moves with every phase), 30 days for the OKX doc quotes.
