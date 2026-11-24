# Phase 226: MT5SOAK - Research

**Researched:** 2026-11-23
**Domain:** an offline-testable Python oracle script (`analytics-service/scripts/mt5_soak.py`) that re-judges the MT5 deal-ledger derive (`broker_dailies` fold + `nav_twr` core) without trusting it
**Confidence:** HIGH for the specs (read in the source this session, with line ranges) and for the walk's agreement with production on the fuzzed space (8,603 random ledgers, 8,377 timed days compared to 1e-9; 4,000 further ledgers / 20,538 days compared on NaN-vs-finite only). The fuzz space has named gaps; they are listed as required hand-derived tests, not claimed as covered.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(CONTEXT.md has no `## Decisions` heading; its binding section is `## Implementation Decisions` / `### Decided autonomously`, copied verbatim.)

- **Unit floors source:** `classify_account_currency(account currency)` from `services/account_unit`
  supplies the floors (the TODO prescribes it). Floors are configuration, not the arithmetic under
  test, so taking them from production does not break independence. Every `USD_FLOORS` read in the
  soak's judging code is replaced by the resolved unit's floors.
- **Independence rule:** the new per-day attribution walk and the timed-day cohort walk import no
  helper from `services.nav_twr`, `services.broker_dailies` or `services.mt5_deals` arithmetic. They
  read raw deal fields (time, profit, commission, swap, fee, type, position open time) and do their
  own UTC bucketing and cohort split. A test asserts the independence by inspecting the walk
  functions' source/imports (fails if a production helper name appears).
- **Timed-day check:** a timed day's published return must equal the soak's own D-17 telescoping
  cohort-walk value to `_RETURN_CHECK_TOL`; NaN must be explained by the soak's own guard reading;
  infinity and implausible values are mismatches by construction of the exact compare.
- **Minimum checked share:** `ok` additionally requires `checked / (checked + timed + guarded)` at
  or above a named constant; the planner picks the value with a measured rationale (it is a
  one-line reversible constant). Timed days that pass the exact cohort compare count as checked
  for this share if the planner judges that sound; record the reasoning.
- **Day-attribution check:** compare the soak's independent per-day P&L against the fold's
  `pnl_by_day` for every day; any day differing beyond the tolerance is a named mismatch kind
  (`day_attribution_mismatch`), and the result carries counts like the existing checks.
- **PROOF-01:** each new arm (BTC-floor, timed-day, attribution) is proven on a neutered copy of
  `mt5_soak.py`: neuter its own arm, run the named test, see RED on that arm, restore with `cp`
  from a byte backup and `cmp`, see GREEN. Edit, command, RED line and GREEN line recorded verbatim
  in the plan SUMMARY. Never `git checkout`/`restore`/`stash` on uncommitted work.

Phase boundary: one file of product code (`analytics-service/scripts/mt5_soak.py`) plus
`analytics-service/tests/test_mt5_soak.py`. No migration, no change to `services/nav_twr.py`,
`services/broker_dailies.py` or any published number. Wave 0: must merge before Phase 229
MT5DERIVE2's first `nav_twr.py` change. The ship PR must delete the three TODOS.md entries
`[164.6.6.2.3-SOAK-BTC-FLOORS]`, `[164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED]`,
`[164.6.6.2.3-SOAK-DAY-ATTRIBUTION]` and name them in the CHANGELOG entry.

### Claude's Discretion
Plan split (one plan or one per requirement), helper names, result-dict shape for new counts,
test fixture construction. Gates every executor runs: pytest from `analytics-service/` only,
CI mypy strict on the touched files, ruff.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOAK-01 | The soak judges a BTC-unit account on floors in its own unit, not on USD floors. | Section "Where floors flow": SIX USD-denominated reads, not two (found `_parity_tolerance` $1 literal and the `DUST_NAV_FLOOR` wedge gate in addition to the two `USD_FLOORS` reads). Unit-resolution failure modes. BTC fixture recipe. |
| SOAK-02 | Timed-day check rejects NaN and implausible returns, not only infinity, goes RED on a 1e-3 nudge. | "The D-17 cohort walk spec" with guard semantics; prototype proven equal to production on 8,377 timed days. Minimum checked share recommendation. |
| SOAK-03 | Day attribution checked against an independent per-day walk importing no production helper; RED when one deal moves one UTC day. | "Raw deal fields and UTC bucketing rule". The SC3 test must patch the fold in BOTH namespaces (pitfall 1). Independence-test recipe. |
</phase_requirements>

## Summary

The soak today is partly a self-agreement check. `reconcile_parity` calls the shipped combiner, then feeds the soak's own checks the fold's per-day P&L (`pnl_by_day` from `_fold_mt5_deals`) and the fold's timed-day set. A deal the fold buckets on the wrong UTC day moves `P_t` and `NAV_{t-1}` together and every check stays green (SOAK-03). A timed day's return is only tested for infinity (SOAK-02). And the soak never reads the account currency, so a BTC account is judged on USD thresholds (SOAK-01). The fixes are all inside one script and need no production change.

Three findings go beyond what CONTEXT.md and the TODOs name. (1) **SOAK-01 is bigger than "pass floors to two calls".** Four more USD-denominated reads sit in the soak's judging path: `_parity_tolerance` hard-codes a `1.0` absolute floor (a whole BTC for a BTC account, so the level check is toothless), the uPnL wedge gate uses `DUST_NAV_FLOOR` (the USD alias; a BTC account with a 15% wedge currently reads `wedge_within_materiality=True`), and the inception test reads `USD_FLOORS.residual_abs_tol`. All measured below. (2) **The soak does not model the Phase 188 tiny-base guard at all**, on any day class. Production NaNs a day whose base is under 5% of the previous-30-day peak. Today that is a pre-existing false RED on untimed and flat days; under the new "timed-day NaN must be guard-explained" rule it becomes a NEW false RED on timed days. An independent tiny-base reading is about 25 lines and was proven exact (see OQ1). (3) **`scripts/` is NOT in CI's mypy strict surface.** The command CI runs excludes it; CONTEXT's "CI mypy strict on the touched files" does not match CI. Baseline today: `mt5_soak.py` has 4 strict errors and 1 ruff finding, none in CI. The executor's rule is "do not add any".

**Primary recommendation:** Add three pure soak-owned functions, with no production-helper reference: `_walk_deal_ledger` (own UTC bucketing, own per-day P&L and flows, own timed-day set and per-day `DayTiming`-equivalent), `_walk_timed_return` (the D-17 cohort formula) and a small `_tiny_base_days` reading. Make `_reconcile_published_returns` take `floors` and the walk's output. Resolve the unit once in `reconcile_parity` and thread `unit.floors` through every judging read. Compare fold-vs-walk P&L per day for SOAK-03. Recommended minimum checked share `0.5`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reading the live account (equity, balance, currency, deals) | Operator CLI script (`scripts/mt5_soak.py`) over the injected `client_factory` | MT5 gateway (private network) | Read-only investor login; existing, unchanged |
| Unit floors (config) | `services/account_unit` (production leaf) | — | Floors are configuration, not arithmetic under test (locked) |
| Independent per-day ledger walk, cohort walk, tiny-base reading | Operator CLI script (new, soak-owned) | — | Oracle must not import the code it judges (`.planning/research/v1.22/PITFALLS.md` Pitfall 12, the one ROADMAP cites) |
| Published-return series under test | `services/broker_dailies.combine_mt5_deal_ledger` -> `services/nav_twr` | — | Unchanged by this phase |
| Verdict / evidence record | Operator CLI script, sanitized JSON in `MT5_SOAK_LOG_DIR` | — | Existing `sanitize_evidence` + `assert_sanitized` path |

No browser, SSR, API or database tier is touched.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python stdlib (`math`, `bisect`, `datetime`, `fractions`) | CI pins 3.12 (`[tool.mypy] python_version = "3.12"`); local box runs 3.14.3 | The walks are pure-stdlib arithmetic | Independence: nothing from `services.*` arithmetic |
| pandas | 3.0.1 local | Only for the published `returns` Series the soak already receives | Already imported by the soak |
| pytest | 9.0.2 local | Test runner | Existing 31 tests pass here (`31 passed in 14.91s`) [VERIFIED: run this session] |

No new third-party package is needed. **Package legitimacy audit: no packages are installed by this phase; the audit gate is N/A.**

### Supporting (config-only imports allowed in the soak)
| Symbol | Source | Use |
|--------|--------|-----|
| `classify_account_currency`, `UnitFloors`, `AccountCurrencyBlank`, `AccountCurrencyMalformed`, `AccountCurrencyUnsupported` | `services.account_unit` | Resolve the unit and its three floors. This is configuration (locked decision) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Soak-owned walk | import `_judged_cohorts` / `_timed_day_return` | Forbidden by the locked independence rule; it would agree with the derive by construction |

**Gates (commands):**
```bash
cd analytics-service
python3 -m pytest tests/test_mt5_soak.py -q                      # full soak file, ~15 s
python3 -m pytest tests/test_mt5_soak.py::test_NAME -x -q        # one named test (PROOF-01 RED/GREEN lines)
ruff check scripts/mt5_soak.py tests/test_mt5_soak.py            # baseline: 1 finding (F401 Mt5DealClassificationError in the script)
mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/mt5_soak.py   # baseline: 4 errors
```
CI's own mypy gate, verbatim from `.github/workflows/ci.yml` (step `Type gate - mypy strict over the running-service surface`):
`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.
The workflow comment states: "scripts/ stays ungated: they are one-off operational tooling ... tests/ stays untyped by design." [VERIFIED: ci.yml, mypy step comment block] So `mt5_soak.py` is NOT mypy-gated in CI. Do not widen the CI path set (a contract test, `src/__tests__/contracts/ci-mypy-strict-surface.contract.test.ts`, pins it). New code should still be fully annotated; the pre-existing 4 strict errors (`dict` type-args at lines 364/552/556, `no-untyped-call` at 408) are baseline, not this phase's to fix unless touched. Baseline of 4 mypy errors and 1 ruff finding were measured by running the commands this session. [VERIFIED: tool runs]

## Architecture Patterns

### System Architecture Diagram

```
history_deals_get (raw deals) ──┬─► combine_mt5_deal_ledger(floors=unit.floors) ─► published returns, meta   (UNDER TEST)
                                │                                  │
account_info().currency ─► classify_account_currency ─► unit.floors ┤ (config only)
                                │                                  │
                                ├─► _fold_mt5_deals ─► fold pnl_by_day, fold flows, fold timing keys (UNDER TEST; today also the soak's *input*)
                                │
                                └─► NEW soak-owned walk (raw fields only, fixed int offset)
                                      ├─ own UTC day per deal ─► walk_pnl_by_day, walk_flows_by_day
                                      ├─ own timed-day set + per-day (flow instants, P&L entries with open instant)
                                      └─ own level roll from `initial` (balance-anchored independent totals)
                                                │
   per-day:  fold_pnl vs walk_pnl  ─────────────┴──► day_attribution_mismatch            (SOAK-03)
   untimed:  published == walk P_t / NAV_{t-1}      ► return_off_ledger / guarded / flat   (existing, now on walk P&L + unit floors)
   timed:    published == walk D-17 cohort return   ► timed_* mismatch kinds               (SOAK-02)
   NaN:      allowed only where the soak's own guard / tiny-base / empty-cohort reading says NaN
   verdict:  recon_ok = level_ok AND return_check.ok  (ok now also needs checked-share >= floor)
```

### Recommended structure (all inside the one script)
```
scripts/mt5_soak.py
├── (unchanged) _forward_nav_levels, _forward_terminal_nav, _safe_close, run_soak, main
├── _parity_tolerance(anchor, floors=USD_FLOORS)          # abs floor = floors.residual_abs_tol (identity for USD)
├── _walk_deal_ledger(deals, server_utc_offset_s)          # NEW pure, own types/bucketing/instants
├── _walk_timed_return(prev, day, *, dust_nav, residual_abs_tol, inception) -> (value, reason)  # NEW pure, D-17
├── _tiny_base_days(...)                                   # NEW pure (OQ1)
├── _attribution_mismatches(walk_pnl, fold_pnl) -> list    # NEW
├── _reconcile_published_returns(..., floors, walk=...)    # extended
└── reconcile_parity                                       # resolve unit once, thread floors
```
Walk functions take plain floats (`dust_nav`, `residual_abs_tol`), NOT `UnitFloors`, so no production name appears in their annotations (independence test, below).

### Pattern 1: independence test (recipe)
Parse the soak module with `ast`; collect every name bound by `from services... import ...` and `import services...`; for each walk function (`inspect.getsource` -> `ast.parse`) assert no `ast.Name`/`ast.Attribute` id intersects that set. Derive the forbidden set from the soak's own imports so a future new production import is caught automatically; add an explicit denylist as a floor: `_fold_mt5_deals, combine_mt5_deal_ledger, classify_deal, deal_cash_effect, deal_utc_day, deal_utc_instant_ms, deal_position_id, deal_entry_code, _coerce_money, _guard_denominator, _judged_cohorts, _timed_day_return, chain_linked_twr, reconstruct_nav_and_twr, DayTiming, PNL_DOM_RATIO, DUST_NAV_FLOOR, USD_FLOORS, Mt5ServerClock, fixed_server_clock, is_tiny_base, window_peaks, UnitFloors`. Also make the test prove it can fail: run the checker over a synthetic source string that calls `deal_utc_day` and assert it is flagged.

### Anti-Patterns to Avoid
- **Taking the timed-day set, per-day P&L or guard predicates from the code under test.** That is the whole defect. Use production only for what is being judged (the published series, the fold's P&L for the attribution compare).
- **Sharing a constant with production inside the walk** (`PNL_DOM_RATIO`). Use a soak-owned constant `10.0` plus a drift-pin test in the test file (which MAY import `services.nav_twr.PNL_DOM_RATIO`) asserting equality, so a deliberate change in 229 turns the pin red and forces a conscious soak update.
- **Re-pinning existing values or loosening a tolerance to get green.** PROOF-01 says that is never a close.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Currency -> floors | A new currency table in the soak | `classify_account_currency(info.get("currency")).floors` | Locked decision; floors are config |
| Secret scrubbing of the record | Own sanitizer | existing `sanitize_evidence` + `assert_sanitized` in `main` | Already in place; new keys must avoid the deny substrings `secret`, `token`, `api_key`, `apikey`, `password` and the masked keys `id`, `login` with string values (`scripts/deribit_ground_truth.py:334-344`) |
| Test doubles | New client fakes | extend `_FakeMt5` with a `currency` kwarg (default `"USD"`) | `account_info()` hard-codes `"currency": "USD"` today (`tests/test_mt5_soak.py:134`) |

**Key insight:** the *walk* is the deliberate exception: it re-implements production arithmetic on purpose. Everything else composes.

## What Pitfall 12 asks for (the source of this phase's goal)

`.planning/research/v1.22/PITFALLS.md` Pitfall 12 ("A soak or oracle that agrees with the code by construction"), lines 414-435: expected values come from an independent walk over the raw deals; enforce a minimum checked share; resolve the unit with `classify_account_currency`; self-test that a timed-day nudge of 1e-3 and a deal moved one day each go RED. Its warning signs are "An expected value computed by calling the fold" and "100% green with zero residual on the first run". It names "Coordinate with 155.2 (Section E)": nothing here moves a published number, so no 155.2 recapture ordering applies to this phase, but the first live soak after this merge is a fresh-oracle run: expect new named mismatches on a real account and read them before calling the soak broken.

## Raw deal fields and UTC bucketing rule (finding 1)

Source of truth read this session: `services/mt5_deals.py` and `services/broker_dailies.py:639-829`.

**Fields read from each raw deal dict:** `type`, `time`, `time_msc`, `profit`, `swap`, `commission`, `fee`, `position_id`, `entry`. The soak's fixed-offset path passes a plain `int` `server_utc_offset_s`; `scripts/mt5_soak.py` never builds an `Mt5ServerClock`.

**Classification** (`services/mt5_deals.py:61` and `:67`, Read this session, verbatim): `_MT5_TRADING_DEAL_TYPES: frozenset[int] = frozenset({0, 1, 7, 8, 9, 10, 11})` and `_MT5_EXTERNAL_FLOW_DEAL_TYPES: frozenset[int] = frozenset({2, 3, 6})`. Anything else raises `Mt5DealClassificationError`. `type` must be a real `int` (a `bool` is rejected). The soak already calls `classify_deal` in `reconcile_parity` BEFORE the walk would run, so the walk only needs its own two sets and may raise a plain `ValueError` for a type outside them.

**Cash effect of a trading deal:** `profit + swap + commission + fee`, each read with `deal.get(field, 0.0)`, a `None` skipped, `bool` rejected, non-numeric or non-finite rejected, summed in that field order. **Flow amount:** the `profit` field alone (`None` or absent -> 0.0), same coercion.

**Day bucket (fixed integer offset, which is all the soak ever passes):** `day = datetime.fromtimestamp(epoch - server_utc_offset_s, tz=timezone.utc).date().isoformat()`, where `epoch` is `time` as a number (int or float) or a `datetime` (naive is treated as UTC; aware uses `.timestamp()`); `bool`, non-numeric and non-finite `time` raise. With `fixed_server_clock`, `day_offset_s` and `instant_offset_s` both return the same fixed offset (`services/mt5_server_clock.py:140-155`). [VERIFIED: read]

**Instant (ms), needed only for flow days:** `time_msc` absent -> `floor(epoch*1000)` (exact via `Fraction` for non-integer epochs; plain `int(epoch)*1000` for integer epochs); `time_msc` present -> must be a non-bool `int` or an integral float, and `time_msc // 1000 == floor(epoch)`, else NO instant. `instant_ms = server_ms - offset_s*1000`. The instant's UTC day must equal the deal's bucket day, else NO instant. No default is ever substituted. [VERIFIED: `mt5_deals.py` `deal_utc_instant_ms`]

**`position_id` / `entry`:** `position_id` is a positive non-bool `int` else `None` (0 and negatives are "no position"); `entry` is a non-bool `int` in `{0,1,2,3}` (IN, OUT, INOUT, OUT_BY) else `None`.

**Timed-day set** (`_mt5_flow_day_timing`): only a day with at least one flow deal can be timed. The WHOLE day is untimed (`None`) if any of: a flow deal's instant is `None`; any trading deal of that day has no instant; a BUY/SELL (types 0/1) deal has no `position_id` or no known `entry`; its position has no recorded IN deals (IN deals = trading-type deals with a positive `position_id` and `entry == 0`, any day); every IN deal of the position is on a LATER day; any needed IN instant is `None`; the position's earliest same-day IN instant is later than the closing deal's instant. A commission-family deal (7..11) with no position opens at its own instant. A position with any IN deal on an EARLIER day has open `None` (cohort 0). Otherwise open = earliest same-day IN instant. Each pnl entry is `(open_instant | None, cash)`; flow entries are `(instant, amount)` sorted ascending by instant, stable.

**Prototype result:** the soak-style walk reproduced production's timed-day SET exactly on every one of 8,603 random ledgers (2,876 small-balance + 5,727 large-balance; the set-equality assert never fired) and its per-day returns to 1e-9 on 8,377 timed days of the large-balance run (171 expected NaN). The small-balance run had 1 mismatch in 4,213 timed days, and it was a tiny-base NaN (see OQ1). [VERIFIED: scratch prototype `proto_walk.py` / `proto_walk2.py`, run this session, scratchpad]

**What the fuzz did NOT cover, so each is a required hand-derived test and not a claimed pass:** commission-family deals (types 7..11) with and without a `position_id`; flow types 3 (CREDIT) and 6 (BONUS); non-zero `swap` and `fee`; a `time_msc` that is absent, fractional, bool, or disagrees with `time` by a second; a `datetime`-typed `time`; offsets other than 0 / 7200 / 10800; an OUT_BY or INOUT entry; two flows at the same instant, and a flow at exactly a position's open instant (flow counts first); a flow exactly at midnight; BTC floors; an overnight position (open `None`) on a timed day. The generator only produced BUY/SELL pairs, BALANCE flows, int `time` + exact `time_msc`.

## The D-17 cohort walk spec (finding 2)

Source of truth: `services/nav_twr.py` `_judged_cohorts` (567-620), `_timed_day_return` (623-651), call site in `chain_linked_twr` (827-886). SPEC ONLY; do not import.

For a timed day `D` with `prev = NAV_{t-1}` (the soak's own level before the day; for the first union day, `initial`):

1. Drop zero-amount flows. `instants` = remaining flow instants (ascending); `n = len(flows)+1` cohorts.
2. Each P&L entry goes to cohort `k = 0` if its open instant is `None`, else `bisect.bisect_right(instants, open_instant)` (a flow AT the open instant counts first). `cohort_pnl[k] += cash` in deal order.
3. Telescoping base (D-17): `capital = prev`; for `k` in `0..n-1`: if `k > 0`, `capital += flows[k-1].amount`; `pnl = cohort_pnl[k]`; if `(k > 0 or inception) and pnl == 0.0`: skip (flow already inside `capital`); else append `(capital, pnl)`; then `capital += pnl`. So `B_k = prev + sum(P_j, j<k) + sum(F_j, j<=k)`.
4. `inception` (day 0 only): `t == 0 and full_history and flow_t > 0 and abs(prev) <= floors.residual_abs_tol`. `full_history=True` always for MT5 (`broker_dailies.py:966`) and `flow_t` is the day's TOTAL flow (summed over all flow deals that day). The soak's existing `inception` expression already matches for the untimed case.
5. Return = `prod_k (1 + P_k/B_k) - 1`, **NaN when**:
   - `judged` is empty (an inception day with no P&L: a deposit-only first day). NaN with NO guard key. Real, expected, and it happens in the existing `_timed_deposit_then_trade_deals` fixture (10-16).
   - any judged cohort has `B_k <= 0` (`negative_nav_guard`) or `0 < B_k < floors.dust_nav` (`dust_nav_guard`). Checked per cohort in order; first hit returns NaN.
   - any judged cohort has `abs(P_k) >= PNL_DOM_RATIO * B_k` (`PNL_DOM_RATIO = 10.0`, `nav_twr.py:84`, Read this session), `pnl_dominated_guard`.
   - the day's `prev` is tiny-base (Phase 188): `0 < prev < 0.05 * peak` where `peak` = max end-of-day level over calendar days `d-30..d-1` with last-level carry (`services/tiny_base.py:35` `TINY_BASE_FRACTION: Final[float] = 0.05` and `:37` `TINY_BASE_WINDOW_DAYS: Final[int] = 30`, Read this session). It is judged on `prev`, never on a cohort base (`nav_twr.py:870-876`).
6. A flow never drops a day (D-05); there is no flow-dominance guard.

`_guard_denominator`, verbatim: `if prev_nav <= 0: return "negative_nav_guard"`, `if prev_nav < dust_floor: return "dust_nav_guard"`. [VERIFIED: nav_twr.py:1021-1024, Read this session]

**The 1e-3 nudge goes RED** with `_RETURN_CHECK_TOL = 1e-9`: the walk value is exact to float rounding (fuzz: max error far under 1e-9), so `abs(actual - walk) = 1e-3 > 1e-9` -> `timed_return_off_cohort_walk`. A timed-day published value of NaN where the walk is finite, a finite value where the walk is NaN, `inf`, `7.0` and `-0.99` all fall out of the same compare by construction.

**Important: where the soak's tolerance is exposed.** The soak's `prev` comes from its forward roll (anchored to the balance), production's from a backward roll from the terminal; they differ by float rounding on levels (~1e-11 of NAV). Fuzz at balances 150 to 1e6 produced zero compares over 1e-9. [VERIFIED: prototype fuzz]

### Minimum checked share (finding 4)
Definition recommended: `certified = checked + timed_verified`, `denominator = checked + timed + guarded` (flat days excluded: they carry no ledger information and are exactly-0.0 padding). `ok` additionally requires `certified / denominator >= _MIN_CHECKED_SHARE`.

- **Counting timed days that pass the exact cohort compare as certified is sound**, because the cohort walk is an independent arithmetic recomputation of the same quantity the untimed check recomputes (`P_t/NAV_{t-1}`); both are exact-to-1e-9 compares against soak-owned arithmetic. Report `timed` (all timed days) and `timed_verified` separately so a timed day that failed the compare is not hidden in the share.
- **Value: `0.5`** `[ASSUMED]`. Rationale: the share must catch "almost nothing was certified" (the BTC-on-USD-floors bug certified 0 of 3; 1 certified day of 200 active days is the TODO's case) without false-REDing a legitimate young account. Guarded days are real: the inception day, and every day under the dust floor ($100 USD, 1e-7 BTC) while an account is still being funded. In the 5-10 business-day soak window the runbook recommends, an account with 3 guarded days then 4 measured days is 57% and must stay green. 0.9 would block that. 0.5 means a strict majority of the days that could have been certified were. No measured soak log exists in the repo to calibrate against (`docs/evidence` has no soak records; checked), so the number is a judgment, not a measurement. The planner/founder may move it; it is one named constant.
- **A timed day whose walk value is NaN does NOT count toward `certified`.** A NaN match certifies no return (it only certifies that the soak's own guard reading agrees). It stays in the `timed` count and in the denominator. The existing timed fixture: 10-16 (walk NaN: inception, no P&L) counts in the denominator only; 10-17 is `timed_verified`; 10-18 is `checked`. Share = 2/3, above 0.5.
- **Keep `vacuous` meaning unchanged (`checked == 0`) and keep `test_a_run_that_excludes_every_day_is_vacuous_and_not_green` untouched.** That fixture is one timed inception day, which the new walk can now certify (return 0.01). Redefining vacuity as `checked + timed_verified == 0` would require editing that test's premise; PROOF-01 forbids treating re-pinned values as a close. Cost: an account whose every active day is a flow day stays not-green. Say so in the docstring. Flag as OQ3.
- **The TODO's literal "1 untimed day out of 200 must not be green" fixture:** after the walk exists, 199 timed days that verify are legitimately certified, so the literal shape no longer reaches the share. Build the share test where the other 199 days are `guarded` instead (initial 50, dust base, hand-built `pnl_by_day`, call `_reconcile_published_returns` directly): 1 checked + 199 guarded = 0.5%. Also add the boundary pair (exactly at and just under the constant).

## Where floors flow (finding 3)

`classify_account_currency(info.get("currency"))` once, right after `account_info()`. Reads of USD-denominated values in the soak, measured this session:

| # | Line (HEAD) | Read | Effect on a BTC account today | Fix |
|---|-------------|------|-------------------------------|-----|
| 1 | 428 | `combine_mt5_deal_ledger(...)` with no `floors` | combiner uses `USD_FLOORS` -> every day dust-NaN | pass `floors=unit.floors` |
| 2 | 309 | `inception` uses `USD_FLOORS.residual_abs_tol` (1.0) | a 0.4 BTC first-day base reads as "inception" | `floors.residual_abs_tol` |
| 3 | 313 | `_guard_denominator(base, USD_FLOORS.dust_nav)` | every BTC day "guarded" | `floors.dust_nav` |
| 4 | 177 | `_parity_tolerance`: `max(1.0, 1e-6*abs(anchor))` | tolerance of one whole BTC: level check toothless | `max(floors.residual_abs_tol, 1e-6*abs(anchor))`; keep a default so `_parity_tolerance(balance)` in the existing test still equals `$1` |
| 5 | 514 | wedge gate `abs(equity) > DUST_NAV_FLOOR` (USD alias, 100.0) | a 0.5 BTC account never evaluates the ratio: a 15% wedge reads `wedge_within_materiality=True` | `floors.dust_nav` (production's own gate is `anchor > floors.dust_nav`, `nav_twr.py:1503`) |
| 6 | 146/147 | the imports of `USD_FLOORS` and `DUST_NAV_FLOOR` | — | keep `USD_FLOORS` only as a default argument value |

Measured on a 1e-5-scaled copy of the canonical ledger (balance 1.105 BTC), current code: `{'ok': False, 'vacuous': True, 'checked': 0, 'guarded': 3, 'timed': 0, 'flat': 1, 'mismatch_count': 0}`, `recon_level_ok True`, `recon_tolerance 1.0`, and with equity 1.3 / balance 1.105 `wedge_within_materiality True`. Combiner on that ledger: USD floors -> `[None, 0.0, None, None]`; BTC floors -> `[0.004, 0.0, 0.002988, -0.001807]`. [VERIFIED: scratch probe run this session]

BTC row, verbatim (`services/account_unit.py:60`): `"BTC": UnitFloors(dust_nav=1e-7, material_equity=0.0001, residual_abs_tol=1e-6)`; USD row (`services/account_unit.py:47`): `USD_FLOORS = UnitFloors(dust_nav=100.0, material_equity=100.0, residual_abs_tol=1.00)`. Floors have three fields only; the soak needs `dust_nav` and `residual_abs_tol` (not `material_equity`).

**Unit-resolution failures** (`classify_account_currency` raises `AccountCurrencyBlank`, `AccountCurrencyMalformed`, `AccountCurrencyUnsupported(code)`). Production refuses all three (job_worker). Recommended soak behaviour: return `{"observation": "unit_unresolved", "parity_ok": None, "unit_error": "<ClassName>"}` (plus the validated `code` for Unsupported only, which production echoes too). INCONCLUSIVE, never green, never a silent USD fallback; main exits 1 via `parity_ok is True` already false. Never echo the raw broker text. Record `account_unit` (`code`, `native`) in the populated result so the evidence log states which floors were used. No new key may contain the deny substrings above.

**SC1 test shapes that actually discriminate.** The roadmap sentence is "a BTC account that the USD floors would pass and its own floors fail". The all-NaN-series shape does NOT meet it (measured: it is `vacuous`, not a pass), so it is a regression test for the combiner-floors arm only. The shape that meets it literally:

*Ledger (untimed, no `time_msc`; 150 BTC account):* 06-02 BUY `profit 1.0`; 06-03 BALANCE `-100.0` and SELL `+0.5`; 06-04 SELL `-0.3`; `balance = equity = 51.2`. Bases are 150, 151, 51.5. The first two are at or above the USD dust floor (100) so USD judging has real checked days; the third (51.5) is between BTC dust (1e-7) and 100 and above 5% of the 151 peak (not tiny-base), so USD floors call it guarded and BTC floors call it checked. Publish the correct BTC series but with 06-04 set to NaN. Probe, run this session against HEAD (`btc_probe2.py`, the fixed combiner call and the BTC row stood in for the judging reads):

```
USD-judged {'ok': True,  'vacuous': False, 'checked': 2, 'guarded': 1, 'flat': 0, 'mismatch_count': 0} []
BTC-judged {'ok': False, 'vacuous': False, 'checked': 3, 'guarded': 0, 'flat': 0, 'mismatch_count': 1} [('2025-06-04', 'checked_day_not_finite')]
```

That is the discriminating test: green on USD floors, red with the named kind on BTC floors. Run it end-to-end through `reconcile_parity` with a `currency="BTC"` fake and `_publish_corrupted`; at helper level call `_reconcile_published_returns` with `floors=USD_FLOORS` vs the BTC row.

Further SC1 tests, each tied to one neuter arm:
1. *Level tolerance arm (`_parity_tolerance`):* BTC ledger (1e-5-scaled canonical, balance 1.105), the soak's own fold call drops the SELL `+0.003` (patch only `_soak._fold_mt5_deals`). HEAD: `recon_residual -0.0029999999999998916`, `recon_tolerance 1.0`, `recon_level_ok True` (probe `sc3_probe.py`). Fixed: tolerance `max(1e-6, 1e-6*1.105)`, `recon_level_ok False`.
2. *Wedge arm:* BTC equity 1.3 / balance 1.105: `wedge_within_materiality False`, `parity_ok False` (HEAD reads `True`; probe `btc_probe.py`).
3. *Combiner-floors arm:* a wrapper that drops the `floors` kwarg (pre-fix call) on a BTC ledger -> all-NaN series -> `checked_day_not_finite` on the checked days under BTC judging. Do not call this one "USD would pass".
4. *End-to-end green:* `currency="BTC"`, real combiner, `parity_ok is True`, `checked >= 1`.
5. *Unit failure:* blank / malformed / unsupported currency -> `observation == "unit_unresolved"`, `parity_ok is None`, `main` exits non-zero.

PROOF-01 neuter arms for SOAK-01 (each needs a test that fails on that neuter alone): (a) the combiner call without `floors=`, (b) the guard/inception reads back on USD, (c) `_parity_tolerance` back on the `1.0` literal, (d) the wedge gate back on `DUST_NAV_FLOOR`.

## Day attribution (SOAK-03)

- **Walk output:** `walk_pnl_by_day` and `walk_flows_by_day` from raw deals. Compare `walk_pnl_by_day` to the fold's `pnl_by_day` over the UNION of days (a day present on one side only is a mismatch with the missing side reported as `0.0`/`None`). Tolerance: `abs(a-b) <= _ATTRIBUTION_REL_TOL * max(abs(a), abs(b)) + _ATTRIBUTION_ABS_TOL` with `1e-9` and `1e-12`; both sums add the same four fields in the same order, so equality is bit-exact in practice, and a unit-agnostic absolute floor of `1e-12` keeps 1-satoshi BTC deals detectable (a flat `1e-9` absolute would hide a 10% error on 1e-8 BTC amounts).
- **Recommended extension (cheap, same walk):** compare flows per day against the fold's `flows` list (`ExternalFlow.utc_day_iso` / `usd_signed`; the soak currently discards it as `_fold_flows`) and use the WALK's flows and P&L for the expected-return / level reading so a mis-bucketed flow is caught too. The soak's current `flows_by_day` is built with the production `deal_utc_day`, so a bucketing bug would shift fold and soak flows identically. Mismatch kind `day_attribution_mismatch` for P&L, `flow_attribution_mismatch` for flows.
- **Keep the level roll (fidelity (a)) on the FOLD's P&L as it is today.** Its whole value is that a fold dropping a deal lands off balance. Do the expected-return and cohort reading on the WALK's P&L (decided here, so the soak has two detectors for a mis-bucketed fold, not one): when attribution passes the two P&L maps are equal; when the fold mis-buckets, both `day_attribution_mismatch` and `return_off_ledger` fire.
- **Known blind spot, say it in the docstring:** a deal whose cash is exactly 0.0 moved one UTC day is invisible to a P&L compare. It matters only through its open instant, and the timed cohort compare covers that on a flow day.
- **SC3 test (pitfall 1):** "move one deal by one UTC day in the fold's input only" must reproduce the TODO's real failure: the combiner and the soak's fold read BOTH use the same wrong bucketing. `scripts.mt5_soak` holds its own reference (`from services.broker_dailies import _fold_mt5_deals, combine_mt5_deal_ledger`), and `combine_mt5_deal_ledger` calls `broker_dailies._fold_mt5_deals` by module global. Patch BOTH `_soak._fold_mt5_deals` and `services.broker_dailies._fold_mt5_deals` with a wrapper that adds 86400 to the `time` of one deal (copy the dicts) before delegating. Use the canonical SELL `+300` on 2025-06-04 (non-zero cash) shifted to 06-05.
  - **Measured on the unmodified HEAD soak** (probe `sc3_probe.py`): `parity_ok True, recon_ok True, recon_level_ok True, return_check.ok True, mismatch_count 0`. That is the TODO's hole, reproduced: this scenario is GREEN today, which is the pre-fix evidence for PROOF-01.
  - **The assertion is kind-specific:** `day_attribution_mismatch` present for BOTH 2025-06-04 and 2025-06-05, and `parity_ok is False`. Do not assert the other kinds are absent: with the walk's P&L in the expected-return path, `return_off_ledger` is expected to fire too.
  - **Neuter and expected RED:** delete the attribution compare (leave the walk and the rest); the test goes RED on the missing `day_attribution_mismatch` kind (the gate stays red from `return_off_ledger`, so assert the kind, not `parity_ok`, as the first assertion). Restore from the byte backup and it goes GREEN.

## Timed-set authority (recommended, OQ2)

Today `timed_days` is `{ts.date().isoformat() for ts in _fold_timing}`. Production silently degrading a resolvable flow day to the day-level rule (D-07) is then invisible: that day is judged as untimed, and the day-level value `P/NAV_{t-1}` matches the day-level published value. The walk derives its own timed set; the fuzz shows it equals production's on all 8,603 ledgers. Recommend the soak use ITS OWN set for judging and report two disagreements as mismatches: `timed_day_unconfirmed` (fold timed it, walk cannot) and `timed_day_not_timed_by_fold` (walk can resolve it, fold did not). Fallback if the planner wants less: use the fold's set and only recompute those days.

## Tiny-base reading (OQ1, recommended)

`chain_linked_twr` NaNs a day (timed or untimed) whose base is positive and under 5% of the previous-30-day peak, and a gap-filled quiet day is NaN'd by `_leave_out_tiny_base_days` (`broker_dailies.py:235-253`) by the same test. The soak models neither: `_reconcile_published_returns` treats an untimed tiny-base day as `checked`, so the NaN reads `checked_day_not_finite`, and a quiet tiny-base day reads `flat_day_not_zero`. Pre-existing false RED for an account that withdrew more than 95%, and the new timed-NaN rule would extend it to timed days.

A soak-owned reading (levels map = each union day's end level plus the capital the day before the first union day; peak over `d-30..d-1` with carry-in of the last level at or before `d-30`; quiet days between consecutive union days judged on the carried level) predicted NaN-vs-finite correctly on **all 20,538 days of 4,000 fuzzed ledgers (194 of them with `tiny_base_days` non-empty, i.e. where production fired the guard)**, covering timed, untimed and quiet days at balances 300 to 20,000. That run compared NaN-vs-finite only, not return values (those are covered by the 1e-9 compare above). [VERIFIED: scratch `proto_tiny.py`, run this session]

Recommendation: implement it, treat a published NaN as explained where the soak's own reading says tiny, and count such days as `guarded` (new reason `tiny_base`). Do NOT explain NaN by reading production's `meta["tiny_base_days"]`: that reads the code under test's own claim and is the agreement-by-construction the phase removes. If the planner declines (scope), then at minimum document the false-RED class and book it; but then a timed tiny-base day newly reds. Flag to the founder only if declined.

## Common Pitfalls

### Pitfall 1: patching the fold in one namespace
**What goes wrong:** patching only the soak's reference leaves the combiner correct, so the published series is right and the test no longer reproduces the TODO's failure (fold and combiner agreeing on the same wrong bucketing). It would still show an attribution mismatch, so it would not prove the HEAD soak was blind. **Avoid:** patch both references (above) and record that the unmodified HEAD soak reads `parity_ok True` on that scenario. **Warning sign:** the scenario is red on the HEAD soak, which means it is not the TODO's hole.

### Pitfall 2: JSON-unsafe NaN in mismatch records
**What goes wrong:** the existing `_mismatch` writes `None` for a NaN `actual` but passes `expected` through; a NaN expected from the walk writes literal `NaN` into the evidence JSON, which `json.dumps` accepts but strict parsers reject. **Avoid:** map NaN to `None` for both fields.

### Pitfall 3: changing `_reconcile_published_returns`'s signature and breaking the existing helper test
`test_guard_explained_nan_is_accepted_and_a_finite_value_there_is_not` (line 711) calls it with `pnl_by_day, flows_by_day, timed_days, initial` only. Give every new parameter a safe default (`floors=USD_FLOORS`; walk results default to "none"), and make a timed day with no walk result a mismatch (`timed_day_not_walked`), never a silent pass. Do not edit that test.

### Pitfall 4: tests that quote a hand-picked "expected" instead of an independent recomputation
Rule 9 (CLAUDE.md): the timed-day test must compare against a hand-derived number (for the existing fixture, 10-17: base 110_000, P&L 1_100, return 0.01), not against the walk run on the same input. The existing fixture is the tight case to reuse.

### Pitfall 5: the `time` field shape in fixtures
`_canonical_deals` uses epoch ints with no `time_msc` (instant = `time*1000`); `_stamped_deal` sets both. The walk must handle both and `datetime`. A test of the walk with a `time_msc` that disagrees with `time` must yield "untimed", not a guess.

### Pitfall 6: hitting a gate that is not a gate
`scripts/` is outside CI mypy, ruff is not in CI at all (`grep` over workflows finds none; no `ruff.toml`). They are executor hygiene, not merge gates. Do not claim "CI mypy strict green" for this file in the SUMMARY.

### Pitfall 7: local Python is 3.14.3, CI pins 3.12
The Makefile warns that a 3.13/3.14 venv can segfault. The soak tests ran clean here (31 passed), but any `float`/`Fraction` edge reading should be checked in a 3.12 venv if one exists (`make install`). `[ASSUMED]` no divergence.

## Code Examples

The cohort walk, ADAPTED from the scratch prototype `proto_walk.py` (the prototype is what was fuzzed; this block is a reformatted rewrite with renamed parameters and a returned reason, not byte-identical code, so the executor re-runs its own checks). The prototype is in the scratchpad, not committed:

```python
# Source: adapted from scratch prototype proto_walk.py (fuzzed against services.broker_dailies this session)
def _walk_timed_return(prev, flow_events, pnl_events, *, dust_nav, residual_abs_tol, inception):
    flows = [(i, a) for i, a in sorted(flow_events, key=lambda e: e[0]) if a != 0.0]
    instants = [i for i, _ in flows]
    cohort_pnl = [0.0] * (len(flows) + 1)
    for open_instant, cash in pnl_events:
        k = 0 if open_instant is None else bisect.bisect_right(instants, open_instant)
        cohort_pnl[k] += cash
    capital, growth, judged = prev, 1.0, []
    for k in range(len(flows) + 1):
        if k > 0:
            capital += flows[k - 1][1]
        if (k > 0 or inception) and cohort_pnl[k] == 0.0:
            continue
        judged.append((capital, cohort_pnl[k]))
        capital += cohort_pnl[k]
    if not judged:
        return float("nan"), "inception_no_pnl"
    for base, pnl in judged:
        if base <= 0 or base < dust_nav:
            return float("nan"), "base_guard"
        if abs(pnl) >= _WALK_PNL_DOM_RATIO * base:
            return float("nan"), "pnl_dominated"
        growth *= 1.0 + pnl / base
    return growth - 1.0, None
```

Fixture helpers to reuse (all in `tests/test_mt5_soak.py`): `_epoch`, `_canonical_deals` (06-02 BUY +500-100, 06-04 deposit 10_000 and SELL +300, 06-05 SELL -200; equity=balance=110_500), `_FakeMt5(touched, equity, balance, login, deals, deals_error, trade_allowed)`, `_make_factory(**kw)`, `_reconcile(factory)` (offset 0, history 90, `utc_now` 2025-06-06), `_ms(day, hh)` (Oct 2025), `_stamped_deal(row, utc_ms)`, `_timed_deposit_then_trade_deals()` (10-16 deposit-only inception NaN, 10-17 timed 1% day, 10-18 untimed), `_publish_corrupted(monkeypatch, corrupt)` (wraps `_soak.combine_mt5_deal_ledger`, forwards `*args, **kwargs` so a new `floors=` kwarg passes through), `_canonical_parity()`, `_assert_returns_breach(parity, kind)`. Add: a `currency` kwarg on `_FakeMt5` (default `"USD"`, returned by `account_info`), a BTC scaling helper (multiply `profit`/`commission` by `1e-5`, balance `1.105`), and a timed-day nudge test (`returns[pd.Timestamp("2025-10-17")] += 1e-3`, kind expected `timed_return_off_cohort_walk`, assert `expected == pytest.approx(0.01)`).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Soak rolls returns (`NAV*(1+r)+F`) | Soak rolls LEVELS (`NAV+P+F`) | 164.6.6.2.3 WR-01 | A timed day's return is a cohort return |
| Timed day only rejects infinity | Exact compare vs soak-owned cohort walk | this phase | SOAK-02 |
| USD thresholds everywhere | `unit.floors` | this phase (production did it in 164.6.6.2) | SOAK-01 |

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted. (The soak's persisted artifact, the dated JSON under `MT5_SOAK_LOG_DIR`, gains new keys; older records simply lack them. No stored data is migrated.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `_MIN_CHECKED_SHARE = 0.5` is the right floor; no real soak log exists to calibrate | Minimum checked share | Too high blocks a legitimate young account; too low lets a guard-dominated window pass. One constant, founder may move it |
| A2 | Python 3.14 (local) and 3.12 (CI pin) behave identically for the walk's `float`/`Fraction` use | Pitfall 7 | A divergence would only surface in CI's `python` job |
| A3 | `vacuous` should keep meaning `checked == 0` (existing test untouched) | Minimum checked share | A stricter founder reading would redefine it and edit that test's premise |
| A4 | The soak keeps judging with a FIXED integer server offset (it never builds an `Mt5ServerClock`) | Raw deal fields | If a later phase makes the soak DST-aware (Phase 175 rules), the walk must replicate the clock's day/instant offsets and the fuzz must be repeated |

## Open Questions (RESOLVED)

All five were resolved at planning time (2026-11-23) by adopting the recommendation, with the departures named below. The plans carry the decisions; this section records where.

1. **OQ1 tiny-base reading in or out?** Recommended IN (evidence above; without it the new timed-NaN rule adds a false RED). Founder-visible only if the planner declines.
   **RESOLVED: IN, adopted by 226-05.** `_walk_tiny_base_days` is soak-owned and never reads `meta["tiny_base_days"]`. An active tiny day counts as `guarded`, and a timed tiny day expects NaN. **Departure:** a quiet (gap-filled) tiny day stays counted as `flat`, not `guarded`. It must be NaN (kind `tiny_base_day_not_nan`) but stays out of the checked-share denominator, because like any flat day it carries no ledger information.
2. **OQ2 does the soak use its own timed-day set as the authority?** Recommended yes, with `timed_day_unconfirmed` / `timed_day_not_timed_by_fold`.
   **RESOLVED: yes, adopted by 226-03.** The walk's own timed set is the judging authority (`timed_days = set(walk.timing)`). Both disagreement kinds are recorded in the `attribution_check` block.
3. **OQ3 vacuity definition** (above). Recommended unchanged.
   **RESOLVED: unchanged, recorded in 226-05.** `vacuous` stays `checked == 0`, `test_a_run_that_excludes_every_day_is_vacuous_and_not_green` is untouched, and the docstring states the cost.
4. **OQ4 shared guard constants for the existing untimed branch.** The untimed `must_break` still imports `_guard_denominator` and `PNL_DOM_RATIO` from `nav_twr`. CONTEXT scopes independence to the NEW walks. Recommended: one soak-owned guard predicate (own `10.0`, own `base <= 0 or base < dust_nav`) used by both untimed and timed branches, with a drift-pin test against `nav_twr.PNL_DOM_RATIO`, so 229's guard edits turn it red deliberately. If declined, the untimed branch is knowingly not independent; say so in the docstring.
   **RESOLVED: adopted.** 226-04 creates `_walk_day_guard` with its own `_WALK_PNL_DOM_RATIO = 10.0` and pins it to `nav_twr.PNL_DOM_RATIO`. 226-05 moves the untimed branch onto it, removes the nav_twr guard imports, and adds a test that `_reconcile_published_returns` references no nav_twr, broker_dailies or mt5_deals name.
5. **Result shape for new counts** (Claude's discretion): extend `return_check` with `timed_verified`, `certified_share`, `min_certified_share`, `attribution: {days_compared, mismatch_count, mismatches[:10]}`, and `account_unit: {code, native}` on the populated result. Keep `checked/guarded/timed/flat` names and meanings (existing tests pin `(checked, flat, timed, guarded) == (3, 1, 0, 0)` and `(checked, timed) == (1, 2)`).
   **RESOLVED: adopted, with one departure; recorded in every plan's Phase contract.**
   - `return_check` gains `timed_verified` (226-04) plus `certified_share`, `min_certified_share` and `tiny_base` (226-05).
   - `account_unit` is on the populated result (226-01).
   - **Departure:** attribution is NOT nested in `return_check`. It is its own `attribution_check` block plus `attribution_ok` (226-02), and `recon_ok` ANDs it in. It judges the fold, not the published returns.
   - Existing names and pins are unchanged.

**Further departure, not an open question.** 226-02 drops the pre-walk `classify_deal` pass that "Raw deal fields" and PATTERNS suggested keeping. The `combine_mt5_deal_ledger` call runs first and already raises `Mt5DealClassificationError` on an unknown type, which `test_unclassifiable_deal_type_propagates` pins, so the pass was redundant. The `services.mt5_deals` import goes with it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | everything | yes | 3.14.3 (CI 3.12) | `make install` for a 3.12 venv |
| pytest | tests | yes | 9.0.2 | — |
| mypy | hygiene (not a CI gate for scripts/) | yes | 2.0.0 | — |
| ruff | hygiene (not in CI) | yes | 0.15.7 | — |
| pandas | the script | yes | 3.0.1 | — |
| Network / MT5 gateway / DB | not needed | n/a | — | the soak tests use fake clients; nothing here touches Supabase or PROD |

No blocking dependency.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2 |
| Config file | `analytics-service/pyproject.toml` (no soak-specific config) |
| Quick run command | `python3 -m pytest tests/test_mt5_soak.py -q` (from `analytics-service/` only; ~15 s) |
| Full suite command | the same file plus `tests/test_account_unit.py tests/test_nav_twr.py tests/test_mt5_deal_reconstruction.py -q` (nothing else imports the soak; unchanged production files) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOAK-01 | BTC account green end-to-end on its floors | integration (fake client) | `pytest tests/test_mt5_soak.py -k btc -q` | Wave 0: add |
| SOAK-01 | unit-failure observation (blank/malformed/unsupported) is INCONCLUSIVE | unit | same | Wave 0: add |
| SOAK-01 | pre-fix all-NaN BTC series reds on BTC floors, agrees on USD floors | unit | same | Wave 0: add |
| SOAK-01 | BTC material wedge not green; tolerance not `1.0` | unit | same | Wave 0: add |
| SOAK-02 | 1e-3 nudge on timed day 10-17 -> named mismatch, `expected ≈ 0.01` | unit | `pytest ... -k timed -q` | Wave 0: add |
| SOAK-02 | timed-day NaN unexplained / NaN explained / inf / 7.0 / -0.99 | unit | same | Wave 0: add |
| SOAK-02 | cohort walk hand-derived cases: deposit before open, after open, withdrawal, overnight position, two flows, zero-amount flow, dust cohort, P&L-dominated cohort | unit | same | Wave 0: add |
| SOAK-02 | share floor: 1 checked + 199 guarded red; boundary pair | unit | same | Wave 0: add |
| SOAK-02 | tiny-base days explained (timed, untimed, quiet) | unit | same | Wave 0: add (if OQ1 in) |
| SOAK-03 | one deal moved one UTC day in both fold namespaces -> `day_attribution_mismatch` on both days | integration | `pytest ... -k attribution -q` | Wave 0: add |
| SOAK-03 | walk imports no production helper (AST) and the checker can fail | unit | same | Wave 0: add |
| SOAK-03 | drift pins: walk constants and type sets equal production's | unit | same | Wave 0: add |
| all | existing 31 tests unchanged and green | regression | `pytest tests/test_mt5_soak.py -q` | exists |

Negative-control discipline (project rule): each new gate test must be shown RED on a neutered copy with its arm named first, then restored from a byte backup (`cp` back and `cmp`), then GREEN. Suggested backup path: the scratchpad directory, not `/tmp`. Never `git checkout/restore/stash`. Edit the neuter with a small python or the Edit tool (BSD `sed -i` needs `''` on this machine).

### Sampling Rate
- Per task commit: the one new test plus `pytest tests/test_mt5_soak.py -q`
- Per wave merge: that file plus `test_account_unit.py`, `test_nav_twr.py`, `test_mt5_deal_reconstruction.py`
- Phase gate: soak file green; `ruff` and `mypy` deltas no worse than baseline (1 / 4)

### Wave 0 Gaps
- [ ] `_FakeMt5(currency=...)` kwarg and BTC fixture helpers
- [ ] new tests per the table; no new framework or config needed

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (the key is absent), so it applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2/V3/V4 auth, session, access | no | Script reads via an existing read-only investor login; no new surface |
| V5 Input validation | yes | The walk treats broker fields as untrusted: reject `bool`, non-finite and non-numeric money/time fields (fail loud, no coercion); raise static messages naming the FIELD, never the value |
| V6 Cryptography | no | none |
| V7 Error handling/logging | yes | Never echo raw broker text: the currency text is third-party text; only the validated `[A-Za-z]{2,10}` code may be echoed (as production does); the whole record still goes through `sanitize_evidence` + `assert_sanitized` before write/print |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential literal in the evidence log | Information disclosure | existing `sanitize_evidence`/`assert_sanitized` + `_redact_secret_values`; new record keys must not contain deny substrings or be named `id`/`login` |
| Account size leaked through an error string | Information disclosure | new mismatch records carry amounts by design (they are the evidence), but exception messages must name fields only (mirror `Mt5DealClassificationError`) |
| No trade surface | Elevation | keep `order_send(` absent from the file (`test_source_composes_not_reimplements` greps for it) |

No migration, no SQL, no new dependency: the repo's SQL-gate, CI-skip-token and mutation-floor rules do not apply.

## Project Constraints (from CLAUDE.md)

- `./CLAUDE.md` (and the global one): read-before-write, surgical changes, match conventions, fail loud, tests encode intent.
- **CHANGELOG discipline:** the ship writes a CHANGELOG entry in the same commit as the `VERSION` bump (`VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`); follow the enumerated-commits, group-by-theme, cross-check mechanism; sections from this repo's vocabulary (`### Fixed`, `### Added`, `### Changed`, `### Tests`, `### Notes`, ...).
- **TODOS.md holds open work only:** delete the three SOAK entries in the ship PR and name them in the CHANGELOG. LOW/Info survivors go to the phase `REVIEW.md`, not TODOS.
- **Never write a CI-skip token in a commit message or PR body, not even to deny it** (say "the skip trailer").
- **No AI authorship attribution trailers beyond the harness's own** per the user's memory rule (the project memory says no Co-Authored-By / "Generated with Claude Code"; a harness reminder says otherwise: the planner/shipper must resolve this explicitly, not by default).
- **Ship planning guard:** a ship branch must change nothing under `.planning`.
- **`covered_digest` / `covered_files` are banned** in VERIFICATION frontmatter: use `verified_at_sha` + `drift_subjects` (`scripts/mt5_soak.py` is a legitimate drift subject; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never).
- **Agent briefs:** pytest only from `analytics-service/`; `grep -a`; a new test file or arm can move censuses: grep them (no SQL here).
- **Review:** gsd-code-reviewer plus silent-failure-hunter, MEDIUM+ only; no migration reviewers needed.
- **PROOF-01 record:** neuter edit, command, RED line, GREEN line verbatim in the plan SUMMARY.
- AGENTS.md ("This is NOT the Next.js you know") is irrelevant here: this phase touches Python only.

## Sources

### Primary (HIGH confidence): all read in this session
- `analytics-service/scripts/mt5_soak.py` (whole file)
- `analytics-service/tests/test_mt5_soak.py` (whole file)
- `analytics-service/services/account_unit.py` (whole file)
- `analytics-service/services/mt5_deals.py` (whole file), `services/mt5_server_clock.py:140-160`
- `analytics-service/services/broker_dailies.py:233-253, 633-979`
- `analytics-service/services/nav_twr.py:60-110, 455-660, 776-963, 993-1023, 1406-1560`
- `analytics-service/services/tiny_base.py:1-90`
- `analytics-service/services/job_worker.py:8068-8135, 8280-8325`, `services/mt5_read.py:195-215`
- `.github/workflows/ci.yml` mypy step and its comment block (5677-5715)
- `TODOS.md` 2809-2814, `.planning/REQUIREMENTS.md`, ROADMAP `### Phase 226`, 226-CONTEXT.md, `.planning/STATE.md` (lines 1-60; no constraint on this phase beyond the v1.22 focus line), `.planning/research/v1.22/PITFALLS.md` Pitfall 12 (414-435), `.planning/research/v1.22/FEATURES.md` MT5SOAK group (301-302)
- No `.claude/skills/` directory exists in this checkout (checked)
- Tool runs: pytest (31 passed), ruff, mypy, three scratch prototypes under the session scratchpad (`proto_walk.py`, `proto_walk2.py`, `proto_tiny.py`, `btc_probe.py`)

### Secondary / Tertiary
None. No web or Context7 lookup was needed: every claim is in-repo; no external library behavior is relied on.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, stdlib only, nothing installed
- Architecture / specs: HIGH, read at source and fuzz-verified against production (0 unexplained mismatches over 8,377 timed + 20,538 mixed days)
- Pitfalls: HIGH for 1-6 (observed); MEDIUM for 7
- Checked-share value: LOW-MEDIUM (a judgment, flagged `[ASSUMED]`)

**Research date:** 2026-11-23
**Valid until:** until Phase 229 changes `nav_twr.py` guards (it deliberately moves them; the drift pins are designed to catch exactly that)
