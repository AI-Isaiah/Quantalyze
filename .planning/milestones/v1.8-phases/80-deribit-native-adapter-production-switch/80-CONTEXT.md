# Phase 80: Deribit Native Adapter + Production Switch (RISKY, GATING) - Context

**Gathered:** 2026-07-08
**Status:** Ready for execution (80-01…80-03 autonomous; 80-04 human-gated LIVE)
**Source:** v1.9 roadmap (`.planning/v1.9-ROADMAP.md`, Phase 80 §) + the P1 contract
(`.planning/phase-78/P1_native_core_contract.md` §9.1/§9.2, App A #6, App B) +
**the ACTUAL landed Phase 79 code** (re-read during planning; the core is COMPLETE
and its signatures were verified against source, not the spec — see Divergences).

**D9 (RESOLVED 2026-07-08, execution-time architectural decision — supersedes the
`pd.Series` return in 80-01 T1 and contract §9.1):** `txn_rows_to_native_daily`
stays in the **pandas-pure** `deribit_txn.py` and returns PLAIN data
(`Mapping[str, dict[str, float]]` = uppercase-ccy → {utc_day_iso: native_pnl_sum}),
NOT `pd.Series`. Reason: `deribit_txn.py` has a deliberate, TESTED AST purity guard
forbidding pandas (`tests/test_deribit_txn.py::test_option_enters_via_cash_delta_not_perp`);
its parent `txn_rows_to_daily_records` already returns `list[dict[str, Any]]` and
pandas-ification happens DOWNSTREAM. Importing pandas here (Option A) would erode a
shipped invariant the whole module respects. The dict→`pd.Series` conversion (tz-naive
midnight DatetimeIndex, per `NativeLedger.native_pnl: Mapping[str, pd.Series]`) moves
to **`build_deribit_native_ledger` in 80-02**, where pandas already lives — that is the
adapter's job, not a scope leak. The core's input type (§1.2) is unchanged.

<domain>
## Phase Boundary

Phase 79 shipped the **complete, pure** native core (`services/native_nav.py`):
`reconstruct_native_nav_and_twr(ledger, *, indexable_currencies, venue="")` already
performs all six §1.3 steps — classify+coalesce, per-bucket `reconstruct_nav` roll,
the §5 inception gate, union-calendar valuation with the §3.3 density refusal, the
native `prev0_usd` day-0 capital, and the §6 `twr_chain_broken` merge. `NativeLedger`,
`classify_currency`, `UnmarkableCurrencyError`, `InceptionReconciliationError`,
`INCEPTION_ABS_TOL_USD=1.00`, `INCEPTION_REL_TOL=1e-4` all exist. The SC-4 dual-run
suite and inception gate are GREEN on synthetic fixtures.

**Phase 80 WIRES that core into the Deribit job path behind three HARD SHIP GATES.**
It writes ZERO core arithmetic — it only (a) builds `NativeLedger` from existing
Deribit parts, (b) routes the job path through a `combine_native_ledger` sibling with
NO per-account dispatch flag, and (c) proves the switch safe on the three real keys.

**Delivers (in scope):**
- `txn_rows_to_native_daily(rows) -> Mapping[str, pd.Series]` — the `(day, ccy)`-keyed
  native-unit sibling of `txn_rows_to_daily_records`, type-partition + `change`
  fail-loud guards lifted VERBATIM, NO index multiply (80-01).
- `deribit_dated_external_flows_usd` extended to emit 4-field `ExternalFlow`s keyed
  `(day, ccy)` — accumulator moves day → `(day, ccy)` per §2.3 (80-01).
- SI-02 `failed_final`-bounce residual launder closed with a regression test, BEFORE
  any live re-run (80-01).
- `build_deribit_native_ledger(exchange) -> (NativeLedger, CompletenessReport)`:
  native per-currency pnl/anchors(`equity`)/wedge(`session_upl`)/flows/marks, dense
  daily marks, `full_history=True`; the collapsed USD anchor still computed for the
  parity panel (80-02).
- `combine_native_ledger(ledger, indexable) -> (returns, meta)` reusing
  `gap_fill_daily_returns`; Deribit job path routed through it with NO per-account
  flag; typed `NavReconstructionError` disposition at callsites; SC-4 dual-run suite
  vs the REAL adapter (ship gate i) (80-03).
- LIVE GATE (80-04, autonomous:false): 3-key re-derivation, inception-tolerance tuning
  (gate ii), golden parity panel + founder sign-off incl. LTP068/ACC-02 (gate iii).

**Does NOT deliver (Phase 81):** `build_ccxt_native_ledger`, per-venue routing,
legacy `reconstruct_nav_and_twr` retirement. ccxt `ExternalFlow` stays 2-arg
(defaults keep it byte-identical — §2.3).
</domain>

<decisions>
## Locked Decisions

1. **SC-4 byte-identity is the merge gate.** A USD-native Deribit account's stored
   dailies MUST be bit-identical old-vs-new — `check_exact=True` series AND
   byte-equal meta — for the real USD-native key(s), not just synthetic fixtures.
2. **Zero core edits.** `native_nav.py` is not touched. Every Phase-80 file only
   FEEDS the landed core or wires its output. If a bug is found IN the core, STOP and
   escalate — do not fork or patch inside an adapter (§1.1 verbatim-reuse discipline). CARVE-OUT: "not touched" means no arithmetic/logic
   edits — 80-04 (gate ii) edits the two tolerance constants `INCEPTION_ABS_TOL_USD` /
   `INCEPTION_REL_TOL` (native_nav.py:178-180); that constant tuning is the sanctioned
   INCEPT-01 job (the FLOW_DOM_RATIO precedent), not a core-logic edit.
3. **No per-account dispatch flag.** All Deribit accounts — USD-native included — take
   the native path once 80-03 lands; §4 identity is what licenses that
   (route-by-data-availability, not by account type).
4. **TDD discipline (Phase 77/79 pattern):** every behavioral task is RED → GREEN with
   an explicit mutation-honesty neuter (the exact change that must flip the test red).
5. **Guards lifted VERBATIM.** `txn_rows_to_native_daily` and the extended flow
   producer copy the type-partition (CASH_BEARING sum / INFORMATIONAL skip /
   unknown-with-cash fail-loud) and the `change` absent/null/blank `LedgerValuationError`
   guards from the existing aggregators word-for-word so the two paths cannot drift.
6. **Leak discipline holds:** no raw NAV/balance/flow/quantity in any log or exception
   (`nav_twr.py:443-444`; `native_nav` errors carry codes/counts/ratios only).
7. **Marks are NEVER forward-filled or interpolated** (§3.3). Balances carry forward
   between events (a balance is constant by definition); marks do not.
8. **SI-02 lands BEFORE the live re-derivations** — a status bounce during repeated
   live re-runs could launder the very `complete_with_warnings` gate iii must observe.

## Ship Gates (hard; merge is blocked until all three are green)

| Gate | Wave | What blocks merge |
|------|------|-------------------|
| (i) SC-4 identity | 80-03 T3 | Dual-run not bit-exact (`check_exact=True` series + byte-equal meta) for the all-USD-family fixture matrix AND the real USD-native key's stored dailies old-vs-new |
| (ii) §5 inception | 80-04 | Any of the 3 real keys fails pre-history-≈0 reconciliation within the live-tuned tolerance; loosening the tolerance requires evidence |
| (iii) Golden parity + founder | 80-04 | Any UNEXPLAINED delta; any USD-native account moved; coin-account movement (incl. LTP068) not founder-signed. Absorbs the ACC-02 final sign-off + v1.7 close-out trigger |

## §9.1-vs-landed-79 divergences resolved at plan time (flag → decision)

- **D1 — the core is already complete (not pending).** Contract §1.3/§9.1 frame the
  inception gate, valuation, prev0, and chain-break merge as steps to build; they are
  ALREADY in the landed `reconstruct_native_nav_and_twr`. Phase 80 only builds a
  correct `NativeLedger` and reads back `(returns, meta)`. The `venue` kwarg (G2)
  exists — adapters call `venue="deribit"`.
- **D2 — the value-gate reads `f.usd_signed`.** `native_nav._code_carries_value`
  (:263-268) tests `f.usd_signed != 0.0` (and quantity). So the 4-field flows the
  adapter emits MUST populate `usd_signed` too — the existing index-valued figure stays
  authoritative + feeds the value-gate; `quantity` is the additive native `change`.
  `ExternalFlow(day, usd, ccy, qty)`, all four fields, per §2.3.
- **D3 — an INDEXED flow with `quantity=None` REFUSES** (`native_nav._bucket_flow_qty`
  :323-327, `flow_quantity_missing`). So the producer MUST supply a native quantity on
  every coin flow. Branch-1 flows may keep `quantity=None` (the core uses `usd_signed`
  verbatim, G4) — but the adapter populates all four uniformly anyway.
- **D4 — marks density is chicken-and-egg with the roll.** The core requires a mark on
  every day `B_c(d)≠0` or `flowqty_c(d)≠0` INCLUDING carry-forward days after the last
  event (G3) — but `B_c` is computed BY THE CORE, so the adapter cannot pre-select the
  nonzero-balance days. RESOLUTION: the "marks planner" is NOT a balance-aware selector.
  Per indexed nonzero-valued currency, fetch a DENSE daily settlement-index series
  across `[oldest_needed_day, today]` via `fetch_deribit_settlement_index` (which already
  returns a dense `{day: price}` from `public/get_delivery_prices`, published daily).
  Density then holds for every possible carry-forward day; the core's `missing_daily_marks`
  refusal fires only on a genuine publish gap (signal, not noise). This SUPERSEDES the
  literal "generalize `inverse_days_needing_index`" framing (that planner selects
  event-fallback days; a marks series must be dense, not sparse).
- **D5 — native per-currency anchors need a pre-collapse read.**
  `fetch_deribit_account_equity_and_upnl_usd` returns COLLAPSED USD scalars. The adapter
  needs `Mapping[str, float]` of native `equity` and `session_upl` per currency (the
  per-summary reads at `deribit_ingest.py:888-919`). RESOLUTION: extract the native maps
  from the SAME one `get_account_summaries` response (never double-fetch); KEEP the
  collapsed USD anchor (`deribit_equity_to_usd`) computed for the 80-04 parity panel.
- **D6 — App A #6 wedge refusal is by construction.** `_deribit_session_upl_to_usd`'s
  silent-zero of an unvaluable coin wedge (`deribit_ingest.py:844-846`) is superseded by
  passing native `session_upl` per currency into `terminal_upnl_native`: a nonzero wedge
  on an UNMARKABLE currency makes `_code_carries_value` True → `UnmarkableCurrencyError`.
  The adapter does NO wedge valuation; the core enforces the refusal. `_deribit_session_upl_to_usd`
  itself stays for the collapsed parity anchor.
- **D7 — SI-02 is NOT fixable in the bridge alone.** The migration
  `20260707120000` header explicitly documents defect (2) (a warned strategy whose
  sibling hits `failed_final` then recovers WITHOUT an analytics re-run is laundered by
  branch (b) then branch (c)) as NOT fixable in the SQL bridge without forking the
  runner's flag→status promotion policy. RESOLUTION: the fix is RUNNER-OWNED and
  single-source — the analytics runner re-asserts `complete_with_warnings` idempotently
  (or reads a runner-owned sticky column) rather than re-deriving warned-ness in SQL.
  The regression EXTENDS the existing `supabase/tests/test_sync_status_preserves_warnings.sql`
  with a `failed_final`-bounce case that fails without the fix. WATCH the pre-existing
  mig-038 "any `failed_final` → failed" retry-poison (defect (1)) during 80-04 re-runs.
- **D8 — "USD-native" is a PER-CURRENCY property.** An account nominally USD-native but
  holding even coin DUST is NOT byte-identical old-vs-new: the native path routes the
  dust into a marks-valued coin bucket, while the legacy anchor (`deribit_equity_to_usd`)
  values that dust at the anchor-instant index and folds it into initial capital. SC-4
  identity holds ONLY over genuinely all-USD-family accounts. The gate-i real-key check
  MUST first confirm the key holds zero non-USD-family value before asserting byte-identity;
  a dust-bearing "USD-native" key is a parity-panel MOVED case (80-04), not a gate-i failure.
  Because the production switch routes EVERY Deribit account through the native core with NO
  per-account flag, the D8 RUNTIME backstop is a COMPLETENESS assertion — not the 3-key panel
  and not the inception gate: 80-04 T3 enumerates ALL existing Deribit-venue accounts (live-DB,
  human-run) and asserts the panel's audited set == that enumerated set with zero un-audited
  accounts; every genuinely all-USD-family account is additionally proven byte-identical
  old-vs-new (a real-key SC-4 shadow). The §5 inception gate reconciles the roll to pre-history
  ≈0, NOT native-vs-legacy identity — a silently-rescaled account can still roll to ~0, so the
  inception gate is NOT the D8 backstop; the completeness-enumerated panel is.
</decisions>

<sc_crossmap>
## Roadmap Success Criteria → wave/task map

| SC | Requirement | Plan / Task |
|----|-------------|-------------|
| SC-1 `build_deribit_native_ledger` from existing parts (native pnl/anchors/wedge/flows/marks, full_history=True) | NAT-04 | 80-01 T1 (`txn_rows_to_native_daily`) + T2 (4-field flows) → 80-02 T1 (native anchors) + T2 (marks + assembly) |
| SC-2 Deribit job path through `combine_native_ledger`, NO per-account flag, typed error disposition, App A #6 wedge | NAT-05 | 80-03 T1 (`combine_native_ledger`) + T2 (job-path route + disposition) |
| SC-3 SHIP GATE (i) SC-4 dual-run vs the REAL adapter (bit-exact series + byte meta, incl. real USD-native key) | SC-4 | 80-03 T3 |
| SC-4 SHIP GATE (ii) INCEPT-01 green on all 3 real keys; tolerances live-tuned | INCEPT-01 | 80-04 (gate ii) |
| SC-5 SHIP GATE (iii) ACC-03 golden parity + 3-key re-derivation + founder sign-off incl. LTP068 (absorbs ACC-02) | ACC-03 | 80-04 (gate iii) |
| SC-6 SI-02 `failed_final`-bounce launder closed with regression, BEFORE live re-runs | SI-02 | 80-01 T3 |
</sc_crossmap>

<canonical_refs>
## Canonical References (all re-read during planning; anchors verified against source)

> NOTE: line-number citations below (and in the plans) are execute-time HINTS, not
> guarantees — re-derive every anchor via `grep -n` at execution; some sibling-plan
> citations may drift as files change. Verified at plan time (2026-07-08):
> `deribit_dated_external_flows_usd` :601, `txn_rows_to_daily_records` :698,
> `_deribit_session_upl_to_usd` wedge silent-zero :844-846, `settlement_index_cache` :673,
> `assert_ledger_complete` :943, `_assert_inception_reconciled` :573.

- `.planning/phase-78/P1_native_core_contract.md` — §9.1/§9.2, App A #6, App B, §2.3, §3.3, §4.1.
- `services/native_nav.py` — the COMPLETE landed core; adapters feed `NativeLedger`, read `(returns, meta)`. Signature `reconstruct_native_nav_and_twr(ledger, *, indexable_currencies, venue="")`.
- `services/external_flows.py` — `ExternalFlow(utc_day_iso, usd_signed, currency="USD", quantity=None)`; `USD_FAMILY`; `validate_flow_shape`.
- `services/deribit_txn.py` — `txn_rows_to_daily_records`:698 (guards :748-799), `deribit_dated_external_flows_usd`:601 (accumulator by_day :643, emit :695), `inverse_days_needing_index`, `txn_change_to_usd`, `_row_utc_day`; type sets :333/:341/:361; `_INVERSE_CURRENCIES`:111, `_LINEAR_CURRENCIES`:99.
- `services/deribit_ingest.py` — `fetch_deribit_account_equity_and_upnl_usd`:853 (per-summary reads :888-919, wedge :786), `deribit_equity_to_usd` (in deribit_txn:261), `fetch_deribit_settlement_index`:433 (dense daily map), `build_deribit_indexable_currencies`:546, `fetch_deribit_ledger_daily_records`:606, `enumerate_currencies`:270, `assert_ledger_complete`:943, `CompletenessReport`:512.
- `services/broker_dailies.py` — `gap_fill_daily_returns`:118, `combine_realized_and_funding`:130.
- `services/job_worker.py:2001-2284` — the Deribit branch: equity read :2051, ledger crawl :2055, typed error disposition :2061-2109, `combine_realized_and_funding` call :2278.
- `supabase/migrations/20260707120000_sync_status_preserve_warnings.sql` — the SI-02 header (defect (2) is the launder to close; defect (1) mig-038 poison to WATCH).
- `supabase/tests/test_sync_status_preserves_warnings.sql` — the SI-02 regression to EXTEND.
- `services/parity_diff.py:158` `classify_delta(...)`, `scripts/golden_parity.py:141` `gate_account`, `tests/fixtures/golden_parity/oracle_*.json` — the 80-04 parity panel primitives (frozen OLD oracle).
- `scripts/deribit_acceptance.py` — the read-only live re-crawl harness the 80-04 runbook extends.
- `.planning/phases/77-*/77-0*-PLAN.md` + `.planning/phases/79-*/79-CONTEXT.md` — the TDD plan format matched here.
</canonical_refs>

<tooling>
## `$PY312`

Every `<verify>` uses `$PY312` = a Python 3.12 venv with `analytics-service/requirements.txt`
installed (CI-pinned; NEVER the shared local `.venv` — the B-mypy drift class). Commands
run from repo root unless they `cd analytics-service` first. Local pytest contention is
avoided with `--no-file-parallelism` where the suite touches shared fixtures.
</tooling>

<deferred>
## Deferred (Phase 81 — do NOT implement in 80)
- `build_ccxt_native_ledger` (Bybit/OKX/Binance), per-venue verifiability-gated routing, `full_history=False`.
- Retirement of the USD-space `reconstruct_nav_and_twr` orchestration (single-bucket collapse or delete).
- `ccxt_flows.py:295` stays 2-arg (defaults keep it byte-identical).
- The Deribit txn-log `balance` field as a rolled-balance cross-check (candidate hardening after 80).
</deferred>

---
*Phase: 80-deribit-native-adapter-production-switch*
*Context gathered: 2026-07-08 (planner; landed-79 code re-read, §9.1 assumptions verified against source).*
</content>
</invoke>
