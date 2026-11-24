# Phase 226: MT5SOAK - Pattern Map

**Mapped:** 2026-11-23
**Files analyzed:** 2 modified (`analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`); no new files
**Analogs found:** 2 / 2 (both are self-analogs: the file being extended is the closest analog for its own new code). Production files are SPEC-ONLY analogs for the walk (never imported by it).

All paths below are relative to `analytics-service/` in the worktree and were checked with `git ls-files` (all tracked). Line numbers are HEAD of this worktree (684-line soak, 727-line test file); they match RESEARCH.md's cited lines.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `scripts/mt5_soak.py` : new `_walk_deal_ledger`, `_walk_timed_return`, `_tiny_base_days`, `_attribution_mismatches` | utility (pure oracle) | transform (raw deals -> per-day P&L/flows/cohorts) | `scripts/mt5_soak.py` `_forward_nav_levels` (212-222) for shape; `services/nav_twr.py` `_judged_cohorts`/`_timed_day_return` (567-651) and `services/mt5_deals.py` for SPEC ONLY | role-match (spec is production, code must not import it) |
| `scripts/mt5_soak.py` : `_reconcile_published_returns` (extend: floors, walk, timed branch, share) | utility (verifier) | transform / batch over a Series | itself (234-341) | exact (extend in place) |
| `scripts/mt5_soak.py` : `_parity_tolerance` (floors-aware) | utility | transform | itself (173-177) | exact |
| `scripts/mt5_soak.py` : `reconcile_parity` (resolve unit once, thread floors, `unit_unresolved` early return, own walk) | service-ish orchestrator | request-response (injected client) | itself (353-548) + `services/job_worker.py:8070-8135` for the unit-failure ladder | exact + role-match |
| `tests/test_mt5_soak.py` : new SOAK-01/02/03 tests, `_FakeMt5(currency=)`, BTC helper | test | request-response via fake client + direct helper calls | itself (fixtures 84-175, 586-727) | exact |
| `tests/test_mt5_soak.py` : AST independence test + drift pins | test | static analysis | `tests/test_computed_at_stamp_census.py:94-153` (`ast.parse` walk) | role-match |

## Pattern Assignments

### `scripts/mt5_soak.py` : unit resolution + floors threading (SOAK-01)

**Analog:** `services/account_unit.py` (config API) and `services/job_worker.py:8070-8135` (failure ladder). Floors are configuration, so this import is allowed in the soak (locked decision).

**API to import** (`services/account_unit.py:77-124`, verified):
```python
class AccountCurrencyUnsupported(Exception):
    def __init__(self, code: str) -> None:
        super().__init__("account currency is not supported")
        self.code = code            # validated [A-Za-z]{2,10}, safe to echo

class AccountUnit:                   # frozen dataclass
    code: str; native: bool; floors: UnitFloors

def classify_account_currency(raw: object) -> AccountUnit:
    # not str / blank        -> AccountCurrencyBlank
    # fails [A-Za-z]{2,10}   -> AccountCurrencyMalformed   (message never carries raw text)
    # USD family             -> non-native, USD_FLOORS
    # native row (BTC)       -> native, that row's floors
    # other well-formed code -> AccountCurrencyUnsupported(code)
```
Rows (`account_unit.py:47,60`): `USD_FLOORS = UnitFloors(dust_nav=100.0, material_equity=100.0, residual_abs_tol=1.00)`; `"BTC": UnitFloors(dust_nav=1e-7, material_equity=0.0001, residual_abs_tol=1e-6)`.

**Copy the exception ladder shape** from `job_worker.py:8073-8080` (one `classify_account_currency(_mt5_info.get("currency"))` read of the PRE `account_info` dict, no second `account_info()` call, three `except` arms Blank / Malformed / Unsupported). In the soak the three arms collapse to one inconclusive return (RESEARCH recommendation), never a silent USD fallback, never echo raw broker text:
```python
# in reconcile_parity, right after `info = client.account_info()` inside the existing try
try:
    unit = classify_account_currency(info.get("currency"))
except (AccountCurrencyBlank, AccountCurrencyMalformed, AccountCurrencyUnsupported) as exc:
    result = {"observation": "unit_unresolved", "parity_ok": None, "unit_error": type(exc).__name__}
    if isinstance(exc, AccountCurrencyUnsupported):
        result["code"] = exc.code
    return result
floors = unit.floors
```
Place it so the early return sits with the other typed returns (`reconcile_parity` 402-409 `observation: "error"` and 413-424 `honest_empty` are the shape to mirror: dict with `observation`, `parity_ok: None`). `main` already exits 1 because `parity.get("parity_ok") is True` is false (671-678). New keys must avoid `secret/token/api_key/apikey/password` substrings and bare `id`/`login` string keys (sanitizer).

**The six USD reads to replace** (all measured at HEAD):
```python
# 177  _parity_tolerance:      return max(1.0, 1e-6 * abs(anchor))          -> max(floors.residual_abs_tol, ...) ; default floors=USD_FLOORS keeps `_parity_tolerance(balance)` == $1 (test 261-275)
# 309  inception:              abs(base) <= USD_FLOORS.residual_abs_tol     -> floors.residual_abs_tol
# 313  guard:                  _guard_denominator(base, USD_FLOORS.dust_nav)-> floors.dust_nav
# 428  combiner call:          combine_mt5_deal_ledger(deals, equity, balance, server_utc_offset_s=server_utc_offset_s)  -> add floors=unit.floors
# 514  wedge gate:             abs(equity) > DUST_NAV_FLOOR                 -> abs(equity) > floors.dust_nav  (production gate nav_twr.py:1503 is `anchor > floors.dust_nav`)
# 146/147 imports:             keep USD_FLOORS only as a default-arg value; DUST_NAV_FLOOR import goes
```
Existing signature style to extend (keep safe defaults; do NOT edit `test_guard_explained_nan_is_accepted_and_a_finite_value_there_is_not` at test line 711, it calls the helper with the old 4 kwargs):
```python
def _reconcile_published_returns(
    returns: pd.Series, *, pnl_by_day, flows_by_day, timed_days, initial,
    floors: UnitFloors = USD_FLOORS,   # NEW, default keeps the old call valid
    walk=None,                         # NEW, default "none"; a timed day with no walk result is a mismatch `timed_day_not_walked`, never a silent pass
) -> dict[str, Any]:
```

---

### `scripts/mt5_soak.py` : `_reconcile_published_returns` timed branch, share, mismatch recorder (SOAK-02)

**Analog:** itself, lines 274-341.

**Mismatch recorder to reuse** (278-286). Fix RESEARCH Pitfall 2 while extending it: map NaN to `None` for BOTH fields, today only `actual` is mapped:
```python
def _mismatch(day: str, kind: str, expected: float | None, actual: float) -> None:
    mismatches.append(
        {
            "day": day,
            "kind": kind,
            "expected": expected,                       # <- becomes None if NaN
            "actual": None if math.isnan(actual) else actual,
        }
    )
```

**Timed branch to replace** (291-295), currently rejects only infinity:
```python
if day in timed_days:
    counts["timed"] += 1
    if math.isinf(actual):
        _mismatch(day, "timed_day_infinite", None, actual)
    continue
```
Target: compute the walk value for the day via `_walk_timed_return(prev_by_day[day], flow_events, pnl_events, dust_nav=floors.dust_nav, residual_abs_tol=floors.residual_abs_tol, inception=...)`; compare exactly to `_RETURN_CHECK_TOL` (230); walk NaN requires published NaN (the soak's own reading, never `meta["tiny_base_days"]`); walk finite requires published finite and `abs(actual-walk) <= _RETURN_CHECK_TOL`, else kind `timed_return_off_cohort_walk` with `expected=walk`. Count `timed_verified` separately; a NaN-matching timed day stays in `timed` and the denominator but not in `certified`.

**Class counters and ok verdict to extend** (274, 332-341). Keep the names and meanings `checked/guarded/timed/flat` (existing tests pin `(3,1,0,0)` and `(1,2)`):
```python
counts = {"checked": 0, "guarded": 0, "timed": 0, "flat": 0}
...
vacuous = counts["checked"] == 0           # KEEP unchanged (test 691 pins it)
return {
    "ok": not mismatches and not vacuous,   # add: and certified/denominator >= _MIN_CHECKED_SHARE
    "vacuous": vacuous, **counts,
    "mismatch_count": len(mismatches),
    "mismatches": mismatches[:_RETURN_CHECK_MAX_MISMATCHES_LISTED],
    "max_abs_err": max_abs_err, "tolerance": _RETURN_CHECK_TOL,
}
```
Add a named module constant beside `_RETURN_CHECK_TOL` (module-level, commented with the measured rationale, per the 225-230 comment style): `_MIN_CHECKED_SHARE = 0.5`, `certified = checked + timed_verified`, `denominator = checked + timed + guarded` (flat excluded). Add `timed_verified`, `certified_share`, `min_certified_share` to the result dict.

**Untimed branch guard** (311-320) keeps its shape but should read soak-owned predicates (OQ4: own `10.0` ratio, own `base <= 0 or base < dust_nav`) instead of `PNL_DOM_RATIO`/`_guard_denominator`:
```python
must_break = (
    inception
    or _guard_denominator(base, USD_FLOORS.dust_nav) is not None
    or abs(pnl) >= PNL_DOM_RATIO * base
)
```
Add a `tiny_base` guarded reason (soak's own 0.05 / 30-day peak reading, spec only from `services/tiny_base.py:35-37`: `TINY_BASE_FRACTION = 0.05`, `TINY_BASE_WINDOW_DAYS = 30`; day is tiny-base when `0 < base < 0.05 * peak`, peak = max end-of-day level over `d-30..d-1` with last-level carry).

---

### `scripts/mt5_soak.py` : `_walk_timed_return` (D-17 cohort walk, SPEC ONLY from production)

**Analog (spec, never import):** `services/nav_twr.py:567-651`.

Cohort split and telescoping base to re-implement independently (`nav_twr.py:609-619`):
```python
flows = [(instant, amount) for instant, amount in timing.flows if amount != 0.0]
instants = [instant for instant, _ in flows]
n_cohorts = len(flows) + 1
cohort_pnl = [0.0] * n_cohorts
for open_instant, cash, _realized_instant in timing.pnl:
    k = 0 if open_instant is None else bisect.bisect_right(instants, open_instant)
    cohort_pnl[k] += cash
judged = []
capital = prev
for k in range(n_cohorts):
    if k > 0:
        capital += flows[k - 1][1]
    pnl = cohort_pnl[k]
    if (k > 0 or inception) and pnl == 0.0:
        continue
    judged.append((capital, pnl))
    capital += pnl
```
Return (`nav_twr.py:642-651`): `judged` empty -> `(nan, None)` (inception, no P&L, no guard); per cohort NaN when `base <= 0`, `0 < base < dust_nav`, or `abs(pnl) >= 10.0 * base`; else `growth *= 1 + pnl/base`; value `growth - 1`. The RESEARCH Code Examples block (lines 316-344 of 226-RESEARCH.md) is the adapted soak-side version; use it with soak-owned `_WALK_PNL_DOM_RATIO = 10.0`.

**Independence rule:** takes plain floats (`dust_nav`, `residual_abs_tol`), NOT `UnitFloors`, and references no name imported from `services.*`. Allowed imports in the walks: stdlib only (`bisect`, `math`, `datetime`, `fractions`).

---

### `scripts/mt5_soak.py` : `_walk_deal_ledger` (SOAK-03, raw-field walk)

**Analog (spec, never import):** `services/mt5_deals.py` (`deal_utc_day` 252-275, `deal_utc_instant_ms` 290+, `_coerce_money` 146, `deal_cash_effect` 173) and `services/broker_dailies.py:639-829` (`_fold_mt5_deals`, `_mt5_flow_day_timing`). Rules to re-implement (all verified in RESEARCH from source):
- Type sets: trading `{0,1,7,8,9,10,11}`, external flow `{2,3,6}`; `bool` rejected; other raises plain `ValueError` with a static field-naming message.
- Cash of trading deal: `profit + swap + commission + fee` in that order, `.get(field, 0.0)`, `None` skipped, `bool`/non-numeric/non-finite rejected. Flow amount: `profit` alone.
- Day bucket (fixed int offset only): `datetime.fromtimestamp(epoch - server_utc_offset_s, tz=timezone.utc).date().isoformat()`.
- Instant ms: `time_msc` absent -> `floor(epoch*1000)`; present -> non-bool int/integral float with `time_msc // 1000 == floor(epoch)` else NO instant; `instant_ms = server_ms - offset_s*1000`; instant's UTC day must equal bucket day.
- Timed-day set and per-day `(open_instant|None, cash)` pnl entries, `(instant, amount)` flow entries: see RESEARCH section "Raw deal fields and UTC bucketing rule" for the full untimed-degradation rules.

**Shape analog inside the soak** (`_forward_nav_levels`, 212-222), same style (pure, dict-of-day, union of days, sorted):
```python
def _forward_nav_levels(
    pnl_by_day: dict[str, float], *, initial: float, flows_by_day: dict[str, float]
) -> list[tuple[str, float]]:
    nav = initial
    levels: list[tuple[str, float]] = []
    for day in sorted(set(pnl_by_day) | set(flows_by_day)):
        nav = nav + pnl_by_day.get(day, 0.0) + flows_by_day.get(day, 0.0)
        levels.append((day, nav))
    return levels
```
Keep the level roll on the FOLD's P&L (research decision): `reconstructed = _forward_terminal_nav(pnl_by_day /* fold */, initial=initial, flows_by_day=...)` at 479-481 stays. Expected-return and cohort reading move to the WALK's P&L/flows. `initial` (469) stays `balance - total_trading_pnl - total_flows`; its `total_*` loop (434-446) currently calls `classify_deal`/`deal_cash_effect`/`deal_utc_day`/`_coerce_money`: the walk's totals replace these for the flows map (a bucketing bug must not shift fold and soak flows identically). Keep the pre-walk `classify_deal(deal)` call so `Mt5DealClassificationError` still propagates (test 367).

**Attribution compare** (new `_attribution_mismatches`): union of days, `abs(a-b) <= 1e-9*max(abs(a),abs(b)) + 1e-12`, kinds `day_attribution_mismatch` (P&L) and `flow_attribution_mismatch` (flows, compared against the fold's `ExternalFlow.utc_day_iso`/`usd_signed`, which the soak currently discards as `_fold_flows` at 473). Result block: `attribution: {days_compared, mismatch_count, mismatches[:10]}`; any mismatch makes `return_check.ok`/`recon_ok` false (record in `return_check` so `_assert_returns_breach`-style asserts work). Known blind spot to state in the docstring: a zero-cash deal moved a day is invisible to a P&L compare.

---

### `tests/test_mt5_soak.py` : fixtures and the three new test families

**Analog:** itself. Reuse verbatim: `_epoch` (84), `_canonical_deals` (88-100), `_FakeMt5`/`_make_factory`/`_reconcile` (103-174), `_UTC_NOW`/`_set_env` (384-393), `_ms`/`_stamped_deal`/`_timed_deposit_then_trade_deals` (520-544), `_publish_corrupted` (586-594), `_canonical_parity` (597), `_assert_returns_breach` (603-611).

**`_FakeMt5` currency kwarg** (add default `"USD"`; `account_info` currently hard-codes `"currency": "USD"` at line 134):
```python
def __init__(self, *, touched, equity, balance, login=99887766, deals=None,
             deals_error=None, trade_allowed=False, currency: str = "USD") -> None:
    ...
    self._currency = currency
def account_info(self) -> dict:
    return {"equity": self._equity, "balance": self._balance,
            "currency": self._currency, "login": self._login,
            "trade_allowed": self._trade_allowed}
```

**Published-series corruption pattern** (copy for every nudge/NaN/inf/7.0/-0.99 test; `_publish_corrupted` forwards `*args, **kwargs` so the new `floors=` kwarg passes through, 586-594):
```python
def nudge(returns):
    returns[pd.Timestamp("2025-10-17")] += 1e-3
    return returns
_publish_corrupted(monkeypatch, nudge)
parity = _reconcile(factory)   # timed ledger, equity=balance=111_600
# assert kind timed_return_off_cohort_walk, expected == pytest.approx(0.01)
```
Hand-derived timed expectation (Rule 9 / RESEARCH Pitfall 4): 10-17 base 110_000, P&L 1_100 -> 0.01; never compare against the walk run on the same input. Counts for that ledger after the change: 10-16 walk NaN (timed, denominator only), 10-17 `timed_verified`, 10-18 `checked`; share 2/3. The existing `(checked, timed) == (1, 2)` pin (681) must stay true.

**Direct-helper test shape** (copy 711-727 for share-floor, NaN-explained, tiny-base, BTC floors-vs-USD arms; build the Series with `pd.DatetimeIndex([...]).as_unit("us")`):
```python
idx = pd.DatetimeIndex(["2025-06-02", "2025-06-03"]).as_unit("us")
nan_ok = _soak._reconcile_published_returns(
    pd.Series([float("nan"), float("nan")], index=idx), **kwargs
)
assert nan_ok["guarded"] == 2 and nan_ok["mismatch_count"] == 0
```
Share test: 1 checked + 199 guarded (initial 50, hand-built `pnl_by_day`) plus the at/just-under boundary pair; call `_reconcile_published_returns` directly.

**SC1 discriminating BTC fixture** (RESEARCH "SC1 test shapes"): 150-BTC untimed ledger, 06-02 BUY `profit 1.0`; 06-03 BALANCE `-100.0` and SELL `+0.5`; 06-04 SELL `-0.3`; `balance = equity = 51.2`; publish the correct series with 06-04 NaN via `_publish_corrupted`; at helper level `floors=USD_FLOORS` gives ok True / `guarded 1`, BTC row gives ok False / kind `checked_day_not_finite`. End-to-end through `reconcile_parity(currency="BTC")`. Separate arm tests, each failing on exactly one neuter: combiner `floors=`, guard/inception reads, `_parity_tolerance` (1e-5-scaled canonical, balance 1.105, soak's fold drops SELL +0.003 via `monkeypatch.setattr(_soak, "_fold_mt5_deals", ...)`), wedge gate (equity 1.3 / balance 1.105).

**SC3 test must patch the fold in BOTH namespaces** (RESEARCH Pitfall 1): `_soak._fold_mt5_deals` AND `services.broker_dailies._fold_mt5_deals`, with a wrapper that copies the deal dicts and adds 86400 to the canonical SELL `+300` on 2025-06-04 (-> 06-05) before delegating; copy the wrapper style of `_publish_corrupted`:
```python
real = _soak.combine_mt5_deal_ledger
def wrapped(*args, **kwargs):
    returns, meta = real(*args, **kwargs)
    return corrupt(returns.copy()), meta
monkeypatch.setattr(_soak, "combine_mt5_deal_ledger", wrapped)
```
Assert `day_attribution_mismatch` for both 2025-06-04 and 2025-06-05 first (kind-specific; `return_off_ledger` may also fire); record that the unmodified HEAD soak is `parity_ok True` on this scenario as the pre-fix PROOF-01 evidence.

**AST independence test + drift pins**

**Analog:** `tests/test_computed_at_stamp_census.py:94-153` (`tree = ast.parse(source)`, recursive visit over `ast.iter_child_nodes`, `isinstance(node, ast.Name)`). Recipe: parse `scripts/mt5_soak.py`, collect names bound by `from services... import` / `import services...`, `inspect.getsource` each walk function, assert no `ast.Name`/`ast.Attribute` id intersects the set plus the explicit denylist in RESEARCH Pattern 1; also run the checker over a synthetic source string calling `deal_utc_day` and assert it IS flagged (the test must be able to fail). Drift pins (the test file MAY import production): `_WALK_PNL_DOM_RATIO == services.nav_twr.PNL_DOM_RATIO`, the soak's trading/flow type sets equal `services.mt5_deals._MT5_TRADING_DEAL_TYPES` / `_MT5_EXTERNAL_FLOW_DEAL_TYPES`, and tiny-base constants equal `services.tiny_base.TINY_BASE_FRACTION` / `TINY_BASE_WINDOW_DAYS`.

Keep `test_source_composes_not_reimplements` (485-491) green: `from scripts.mt5_spike import`, `combine_mt5_deal_ledger`, `sanitize_evidence` must remain in the file and `order_send(` must stay absent.

## Shared Patterns

### Fail-loud, never fabricate, count every class
**Source:** `scripts/mt5_soak.py` module docstring 70-81 and `_reconcile_published_returns` 251-264.
**Apply to:** every new branch. Each day class is counted; nothing dropped silently; a typed `observation` + `parity_ok: None` for anything inconclusive; `Mt5DealClassificationError` propagates uncaught. Update the module docstring paragraphs that currently say timed-day cohort arithmetic is "NOT covered by this gate" (lines 50-52, 258-260): they become false and the file's docstrings are its spec.

### Untrusted broker fields
**Source:** `services/mt5_deals.py` `_coerce_money`/`deal_utc_day` posture (reject `bool`, non-finite, non-numeric; static messages naming the FIELD never the value).
**Apply to:** `_walk_deal_ledger` only (raise plain `ValueError`, not `Mt5DealClassificationError`).

### Secret hygiene on the record
**Source:** `main` 652-654 `sanitize_evidence(report)` + `assert_sanitized(clean)`; `_redact_secret_values` at 390.
**Apply to:** all new result keys. No key containing `secret`, `token`, `api_key`, `apikey`, `password`; no bare string-valued `id`/`login`. Currency text is third-party: echo only the validated `code` from `AccountCurrencyUnsupported`, never raw text. Record `account_unit: {code, native}` in the populated result.

### Test discipline (PROOF-01)
**Source:** CONTEXT.md and RESEARCH "Negative-control discipline".
**Apply to:** each new arm: neuter on a copy/edit, run the named test, record the RED line, restore with `cp` from a byte backup in the scratchpad plus `cmp`, record GREEN. Never `git checkout/restore/stash`. pytest only from `analytics-service/`. Gates: `python3 -m pytest tests/test_mt5_soak.py -q`; ruff baseline 1 finding; `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/mt5_soak.py` baseline 4 errors (scripts/ is NOT in CI mypy; do not claim a CI mypy gate).

## No Analog Found

| File / function | Role | Data Flow | Reason |
|-----------------|------|-----------|--------|
| `_tiny_base_days` (soak-owned peak reading) | utility | transform | No soak-side tiny-base code exists; spec is `services/tiny_base.py` (`window_peaks`, `is_tiny_base`), which the walk must not import. Use RESEARCH OQ1 description (prototype proven exact on 20,538 days). |
| `unit_unresolved` observation | orchestrator branch | request-response | No soak precedent; copy the `error`/`honest_empty` dict shape (soak 405-409, 413-424) and the three-exception set from `job_worker.py:8073-8135`. |

## Metadata

**Analog search scope:** `analytics-service/scripts/`, `analytics-service/tests/`, `analytics-service/services/{account_unit,nav_twr,mt5_deals,broker_dailies,tiny_base,job_worker}.py`
**Files read in full this pass:** `scripts/mt5_soak.py`, `tests/test_mt5_soak.py`; targeted ranges of the production spec files
**Tracked-source gate:** all named analog paths verified tracked with `git ls-files` (no `.gsd` mirror paths)
**Pattern extraction date:** 2026-11-23
