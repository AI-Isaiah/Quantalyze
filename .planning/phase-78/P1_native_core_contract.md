# P1 — Native-Unit NAV Reconstruction: Contract Spec

**Status:** CONTRACT SPEC (no code). Grounded in the code as of `main` @ 9a1e7b8e.
**Scope:** the category-invalid USD-space backward reconstruction for coin-margined
accounts is replaced by per-settlement-currency native-unit reconstruction, valued
daily at `{ccy}_usd` marks. USD-native accounts must be **byte-identical** (SC-4).

All file paths are under `analytics-service/`.

---

## 0. The invariant being restored (why native space is the only valid space)

USD equity of a coin-margined account decomposes exactly as

```
E_usd(anchor) = E_usd(start) + Σ change·P(t_event) + Σ_c ∫ B_c(t)·dP_c(t)
```

The shipped v1.8 core (`services/nav_twr.py:266` `reconstruct_nav`, driven from
`reconstruct_nav_and_twr` at `nav_twr.py:627`) rolls
`NAV_{t-1} = NAV_t − pnl_t − F_t` **in USD**, where `pnl_t` is the event-time-valued
`Σ change·P(t_event)` from `deribit_txn.txn_rows_to_daily_records`
(`deribit_txn.py:673`). That identity omits the translation integral
`Σ_c ∫ B_c·dP_c`, which is zero **only** when every held currency is USD-family.
For a coin account the omitted term is absorbed into the reconstructed
"start capital" (the −$480,782 LTP068 case). In **native units per currency** the
ledger reconciles exactly (proven empirically: BTC to 0.048 dust; USDC/ETH exact),
so the correct decomposition is:

```
B_c(t-1) = B_c(t) − change_c(t) − flowqty_c(t)        (native units, per currency)
NAV_usd(d) = Σ_c B_c(d) × P_c(d)                       (valued at day-d marks)
```

The translation term is now carried **implicitly and exactly** by
`B_c(t-1)·(P_c(t) − P_c(t-1))` inside the day-over-day NAV difference — nothing is
estimated, nothing is mislabeled as capital.

---

## 1. The native-NAV reconstructor — module, signatures, shapes

### 1.1 Module placement

New module: **`services/native_nav.py`** — pure, I/O-free, same discipline as
`services/nav_twr.py` (module docstring at `nav_twr.py:1-36`): stdlib + pandas +
numpy only; no network, no DB, **no logging of raw NAV/balance/flow values**
(account-size-leak class T-73-02 / T-76-03-LEAK, see the raise-message discipline
in `reconcile_flow_residual`, `nav_twr.py:443-444`).

It imports and **reuses verbatim** (never forks):

- `nav_twr.reconstruct_nav` (`nav_twr.py:266`) — the backward roll, which is
  **unit-agnostic** (it subtracts numbers; nothing in it is USD-specific), so the
  per-currency native roll is the *same function* applied to native series.
- `nav_twr.chain_linked_twr` (`nav_twr.py:297`) — extended with one additive
  keyword (§1.4), default-preserving.
- `nav_twr._guard_denominator` (`nav_twr.py:345`), `DUST_NAV_FLOOR` (`:58`),
  `FLOW_DOM_RATIO` (`:65`), `NavTWRMeta` (`:106`), `NAV_TWR_GUARD_KEYS` (`:145`),
  `NavReconstructionError` (`:155`), `_coerce_float` (`:163`).
- `deribit_txn._row_utc_day` (`deribit_txn.py:388`) — the ONE UTC-day boundary
  (Pitfall #11, `nav_twr.py:44-47`).
- `external_flows.ExternalFlow` (extended per §2) and the new shared
  `USD_FAMILY` set (§3).

### 1.2 Input data shapes (what an adapter supplies)

One frozen dataclass groups the parallel per-currency inputs so their key-set
coherence can be validated in one place:

```python
@dataclass(frozen=True)
class NativeLedger:
    """Everything a venue adapter must supply. Pure data; no I/O objects.

    Currency keys are UPPERCASE everywhere (matching the `.upper()` convention
    at deribit_txn.py:180/209/493/559)."""

    # B-source: per-currency daily NATIVE pnl — Σ of the ledger `change` per UTC
    # calendar day, in the currency's OWN units, NO index conversion.
    # pd.Series, float dtype, tz-naive midnight DatetimeIndex, ascending,
    # one row per UTC day that had cash-bearing activity in that currency.
    native_pnl: Mapping[str, pd.Series]

    # Terminal anchor: per-currency NATIVE equity at the anchor instant
    # (Deribit: `equity` per summary from private/get_account_summaries — the
    # same field deribit_equity_to_usd reads at deribit_txn.py:278, but kept
    # NATIVE, never pre-multiplied).
    terminal_native_equity: Mapping[str, float]

    # Marks: per-currency daily USD mark P_c(d). pd.Series, float dtype,
    # tz-naive midnight DatetimeIndex. REQUIRED for every branch-2 currency on
    # every day the reconstruction will value (§3.3 density contract).
    # Branch-1 (USD-family) currencies MUST NOT appear here (their mark is the
    # literal 1.0 — see §4).
    marks: Mapping[str, pd.Series]

    # Dated external flows in NATIVE units (currency + quantity), per §2.
    native_flows: Sequence[ExternalFlow]

    # Terminal open-uPnL wedge, NATIVE per currency (Deribit: session_upl per
    # summary [ASSUMED A1], deribit_ingest.py:749). Empty mapping = zero wedge.
    terminal_upnl_native: Mapping[str, float]

    # None => the ledger covers the account's FULL history (Deribit: txn-log is
    # retained from inception; DEFAULT_START_MS=2015, deribit_ingest.py:104) and
    # the inception gate (§5) reconciles against an expected pre-history balance
    # of 0 per currency. A retention-capped venue (OKX/Bybit) passes the floor
    # from nav_twr.flow_retention_floor (nav_twr.py:469) instead, which SKIPS
    # the zero-inception gate and routes to the existing DQ-02 evidence-gated
    # terminus (nav_twr.py:585 flow_coverage_gap_evidence).
    full_history: bool
```

**Why native_pnl and not pre-built balances:** the task brief says adapters supply
`B_c(d)`; this contract has adapters supply the *inputs to* `B_c(d)` and the core
builds the balances with the one shared backward roll, because hand-rolling the
roll per venue is exactly how the two valuation paths in `deribit_txn` were kept
from diverging (the "identical resolution order... so the two paths can never
disagree" pin at `deribit_txn.py:663-665`). The core exposes the balances it built
(§1.3 output) so the adapter-supplies-B_c(d) reading is satisfied at the
observable level. A venue that *reports* daily balances natively (Deribit txn-log
rows carry a post-transaction `balance` field — currently unread anywhere in
`services/`) MAY later feed them as a cross-check, never as the primary source.

### 1.3 Core entry point

```python
def reconstruct_native_nav_and_twr(
    ledger: NativeLedger,
    *,
    indexable_currencies: frozenset[str],   # §3.2 — probed by the I/O layer
) -> tuple[pd.Series, NavTWRMeta]:
    """Per-currency native backward roll → daily USD NAV via day marks →
    chain-linked TWR with the same DQ-01 guards.

    Steps (all pure):
      1. classify every currency key appearing in native_pnl ∪
         terminal_native_equity ∪ native_flows ∪ terminal_upnl_native (§3);
         coalesce branch-1 currencies into the single "USD" bucket (§4.1).
      2. Per bucket c: union that bucket's flow days into its pnl index
         (reuse of the _union_flow_days semantics, nav_twr.py:213), then
         B_c = nav_twr.reconstruct_nav(native_pnl_c,
                                       terminal_native_equity_c − upnl_native_c,
                                       native_flow_qty_by_day_c)      # native units
      3. Inception-reconciliation gate (§5) — refuses before valuation.
      4. Value: NAV(d) = Σ_c B_c(d) × mark_c(d) over the UNION calendar of all
         bucket indices (a day absent from a bucket's index but inside its
         [first, last] span carries that bucket's carried-forward balance — the
         balance between ledger events is constant BY DEFINITION of a balance;
         this is not price fill-forward, marks are never filled §3.3).
         F_usd(d) = Σ_c flowqty_c(d) × mark_c(d)  (same-day mark — the exact
         same-UTC-day valuation rule deribit_dated_external_flows_usd already
         locks at deribit_txn.py:596-604).
      5. returns, flags = nav_twr.chain_linked_twr(nav_usd, ...,
                                                   prev0=prev0_usd)   # §1.4
      6. meta = _build_nav_meta-style assembly, plus the §6 chain-break key.

    Raises NavReconstructionError subclasses (§3.4, §5) — permanent/structural,
    matching the LedgerValuationError worker-retry discipline
    (deribit_txn.py:58-61, nav_twr.py:155-160)."""
```

**Output:** `(returns, meta)` — the identical shape
`trades_to_daily_returns_with_status` returns (`transforms.py:83-90`), so the
downstream (`broker_dailies.gap_fill_daily_returns` at `broker_dailies.py:118`,
then the CSV route / `compute_all_metrics`) is untouched.

**Day-0 previous capital (native analog):** the linear core computes
`prev = cur − pnl0 − flow_t` on day 0 (`nav_twr.py:330-331`). Natively:

```
prev0_usd = Σ_c (B_c(d0) − native_pnl_c(d0) − flowqty_c(d0)) × mark_c(d0)
```

i.e. the pre-history native balance valued at **day-0 marks** (the earliest mark
we possess; inventing an earlier price would be fabrication).

### 1.4 One additive change to `chain_linked_twr`

`chain_linked_twr` (`nav_twr.py:297`) derives day-0 `prev` from
`daily_pnl.iloc[0]` (`:320-322`, `:330-331`), which has no meaning once pnl is
per-currency native. Contract: add

```python
def chain_linked_twr(
    nav, daily_pnl, flows_by_day, *, prev0: float | None = None
) -> tuple[pd.Series, dict[str, bool]]
```

`prev0=None` (default) ⇒ exactly today's arithmetic — every existing caller and
test is byte-identical. `prev0` set ⇒ day-0 uses the supplied value; the guards
(`_guard_denominator`) apply to it unchanged.

---

## 2. `ExternalFlow` extension — carrying `(currency, quantity)`

### 2.1 Current shape and the two consumption modes that constrain it

`services/external_flows.py:34-45`:

```python
class ExternalFlow(NamedTuple):
    utc_day_iso: str
    usd_signed: float
```

Consumed two ways today:

1. **Positional 2-unpack** — `day_raw, usd_raw = flow` at `nav_twr.py:201`
   (`_flows_to_daily_usd`) and `day, usd = flow` at `external_flows.py:63`
   (`validate_flow_shape`). A NamedTuple grown to 3–4 fields **breaks both**
   (`ValueError: too many values to unpack`). This is the one place the existing
   code actively fights the extension — called out explicitly.
2. **Attribute access** — `f.utc_day_iso` at `nav_twr.py:623`
   (`flow_coverage_gap_evidence`). Unaffected by added fields.

Producers construct positionally with 2 args: `ExternalFlow(day, usd)` at
`deribit_txn.py:670` and `ccxt_flows.py:295`.

### 2.2 The extended type

```python
class ExternalFlow(NamedTuple):
    utc_day_iso: str
    usd_signed: float
    currency: str = "USD"          # settlement currency, UPPERCASE
    quantity: float | None = None  # signed NATIVE quantity; None = legacy
                                   # USD-only flow (pre-extension producer)
```

**Field semantics (locked):**

- `usd_signed` keeps its exact current meaning (event/same-day USD value, deposit
  `+` / withdrawal `−`, sign trusted verbatim per `external_flows.py:15-17`). It
  remains the **authoritative** value for the linear/legacy path — every existing
  consumer reads it unchanged.
- `currency`/`quantity` are the native channel. Invariant for a fully-populated
  flow: `usd_signed` was derived as `quantity ×` a same-UTC-day mark for
  `currency` (branch-1: `quantity == usd_signed` exactly, mark ≡ 1.0).
- **The native core (§1) reads ONLY `(utc_day_iso, currency, quantity)`** and
  re-values at its own day marks; it never trusts a producer-side `usd_signed`
  (one valuation authority, no drift). A branch-2 flow reaching the native core
  with `quantity=None` is refused (§3.4) — never back-solved from `usd_signed`.

### 2.3 Migration path (exhaustive caller census)

| Site | Today | Change |
|---|---|---|
| `nav_twr.py:201` `day_raw, usd_raw = flow` | 2-unpack | → `day_raw, usd_raw = flow[0], flow[1]` (indexed; also tolerates the bare 2-tuples the core docstring allows at `nav_twr.py:27-30`) |
| `external_flows.py:63` `day, usd = flow` | 2-unpack | same indexed fix; `validate_flow_shape` additionally validates `currency` non-empty-upper and `quantity` finite-or-None |
| `deribit_txn.py:670` `ExternalFlow(day, usd)` | producer | → `ExternalFlow(day, usd, ccy, qty)` where `qty` is the summed native `change` per (day, ccy) it already iterates — note this forces the accumulator from `dict[str, float]` keyed by day (`:620`) to keyed by `(day, ccy)` (a same-day USDC-deposit + BTC-withdrawal pair currently collapses into ONE USD sum at `:669`; natively they must stay two flows) |
| `ccxt_flows.py:295` `ExternalFlow(day, usd)` | producer | P3: same `(day, usd, ccy, qty)` population. Until P3, defaults fill → behavior byte-identical |
| `nav_twr.py:623` `f.utc_day_iso` | attribute | unchanged |

Both 2-unpack fixes are mechanical and byte-identical in behavior; they land in
the same commit as the type extension with a pinned test constructing a 4-field
flow and passing it through `_flows_to_daily_usd` and `validate_flow_shape`.

---

## 3. The per-currency classifier

### 3.1 Branch rules (exactly three; no account-level branch anywhere)

```python
class MarkBranch(str, Enum):
    USD_FAMILY = "usd_family"   # mark ≡ 1.0
    INDEXED    = "indexed"      # mark = that day's {ccy}_usd index
    UNMARKABLE = "unmarkable"   # refuse if it carries any value

def classify_currency(
    ccy: str, *, indexable: AbstractSet[str],
    usd_family: AbstractSet[str] = USD_FAMILY,
) -> MarkBranch:
    """Uppercases ccy. usd_family wins first (mirrors 'both converters check
    linear FIRST' — the disjointness rationale at deribit_txn.py:104-110);
    then indexable; else UNMARKABLE. Pure; never raises."""
```

**Refusal is value-gated, not classification-gated:** an `UNMARKABLE` currency
(BUIDL/USYC) with **zero** balance, zero pnl, zero flows everywhere is skipped
silently — the exact precedent of `deribit_equity_to_usd`'s
`if equity == 0.0: continue` (`deribit_txn.py:282-283`). The moment it carries a
nonzero balance/pnl/flow on any day, the core raises (§3.4). This keeps a dust
tokenized-fund wallet from sinking a job while never silently zeroing real value.

### 3.2 The `USD_FAMILY` set — single definition, evidence-gated maintenance

Today the set exists twice-ish: `_LINEAR_CURRENCIES = {"USDC","USDT","USD","EURR"}`
(`deribit_txn.py:95`) plus the instrument-name markers `("_USDC","_USDT","_EURR")`
(`:88`). Contract:

- Promote **one** `USD_FAMILY: frozenset[str]` into `services/external_flows.py`
  (stdlib-only module — importing it keeps `deribit_txn`'s purity scan green,
  same rationale as the existing import at `deribit_txn.py:48-52`), initialized
  `{"USD", "USDC", "USDT", "EURR", "DAI"}`.
- `deribit_txn._LINEAR_CURRENCIES` becomes an alias of it. Adding `DAI` is
  behavior-neutral for Deribit (no DAI wallet exists there; if one ever appears
  its `change` correctly passes through at 1.0). The import-time disjointness
  assert (`deribit_txn.py:108-110`) is retargeted to
  `USD_FAMILY ∩ indexable == ∅` **at classification time** (the indexable set is
  now dynamic, so the static assert alone no longer covers it): overlap raises.
- Maintenance rule: additions are code edits to this one frozenset, each with an
  evidence citation in the accompanying comment (the `docs/evidence/` pattern,
  see `deribit_txn.py:26`) and a pinned membership test. Never config, never DB,
  never inferred from venue metadata.

### 3.3 The `{ccy}_usd` index-resolution contract

Two obligations, cleanly split:

**(a) Resolvability probe (I/O layer, per job):** for every enumerated non-USD-family
currency (`enumerate_currencies`, `deribit_ingest.py:269` — the authoritative
public universe), attempt one `public/get_index_price {index_name: f"{ccy.lower()}_usd"}`
— the exact probe `fetch_deribit_account_equity_and_upnl_usd` already performs
per held currency (`deribit_ingest.py:816-827`). Success ⇒ member of
`indexable_currencies: frozenset[str]`; cached per job. This is what generalizes
`_INVERSE_CURRENCIES` (§7): SOL is indexable because `sol_usd` resolves; BUIDL is
not.

**(b) Daily mark series (I/O layer → `NativeLedger.marks`):** per indexable
currency with any nonzero value, fetch the per-UTC-day settlement mark via
`fetch_deribit_settlement_index` (`deribit_ingest.py:432`,
`public/get_delivery_prices`, returns `{day_iso: price}`) back to the currency's
oldest needed day — the same-day D-07-compliant source already locked by P72.
**Density contract:** the marks Series for currency `c` MUST contain every UTC
day `d` in the valuation calendar on which `B_c(d) ≠ 0` or `flowqty_c(d) ≠ 0`.
A missing day is **refused** (§3.4) — never forward-filled, never interpolated
(a filled mark is a fabricated price; Deribit publishes delivery prices daily so
this never fires on healthy data, and a gap is therefore signal). Marks must be
finite and `> 0` (same rule as `txn_change_to_usd`'s `price <= 0` refusal,
`deribit_txn.py:231-236`).

### 3.4 The refuse behavior

```python
class UnmarkableCurrencyError(NavReconstructionError):
    """A currency carrying nonzero value has no resolvable {ccy}_usd mark —
    either UNMARKABLE by classification (no index exists: BUIDL, USYC) or
    INDEXED but with a missing/invalid mark on a needed day.

    Carries (attributes, all leak-safe — NO raw balances/quantities/USD):
      currency: str        # e.g. "BUIDL"
      venue: str           # e.g. "deribit"
      reason: str          # "no_usd_index" | "missing_daily_marks"
                           # | "flow_quantity_missing"
      missing_day_count: int   # count only, never the values held on them
    """
```

Subclassing `NavReconstructionError` (itself `ValueError`,
`nav_twr.py:155-160`) inherits the permanent/structural worker disposition — the
job fails to the wizard gate, no factsheet is emitted, never a retry loop and
never a silent zero (the anti-pattern this repo already bans at
`deribit_txn.py:99-102`: "must FAIL LOUD rather than be blindly index-multiplied").

---

## 4. SC-4 — byte-identity for USD-native accounts

### 4.1 The mechanism: branch-1 coalescing + IEEE-754 identity + verbatim reuse

Three design choices make identity hold **by construction**, not by luck:

1. **Branch-1 coalescing.** All USD-family currencies collapse into ONE bucket
   keyed `"USD"` at classification time, quantities summed per day in producer
   row order. This mirrors what the linear path already does: `txn_rows_to_daily_records`
   sums across currencies into one `by_day` (`deribit_txn.py:713`, `:768`) and
   `deribit_dated_external_flows_usd` likewise (`:620`, `:669`). For a USD-native
   account the native pipeline therefore holds **exactly one bucket whose per-day
   floats are the same floats** the linear path feeds `reconstruct_nav_and_twr`
   — same rows, same `_row_utc_day` bucketing, same accumulation order, and
   `change` passes through unconverted in both (linear passthrough,
   `deribit_txn.py:204-205`).
2. **The ×1.0 mark is an IEEE-754 no-op.** For every finite float `x`,
   `x * 1.0` is bit-identical to `x` (including `-0.0`); NaN/Inf are already
   rejected at the input choke point (`nav_twr._coerce_float`, `:181-184`). So
   `NAV(d) = B_USD(d) × 1.0 = B_USD(d)` — the same bits, and the Σ over one
   bucket is the identity function (no re-association of additions).
3. **Verbatim reuse of the arithmetic core.** The roll is the same
   `reconstruct_nav` loop (`nav[t-1] = nav[t] - pnl[t] - flows[t]`,
   `nav_twr.py:291-292`); the chain-link is the same `chain_linked_twr` with
   `prev0=None`-equivalent day-0 math (`prev0_usd` of §1.3 reduces, for one
   bucket at mark 1.0, to `cur − pnl0 − flow_t` — the literal `:331` expression);
   the guards are the same `_guard_denominator` on the same floats; the wedge
   subtraction is the same `terminal = anchor − upnl` (`:673`).

**The exact arithmetic that must remain identical** (any deviation breaks SC-4):

| # | Operation | Where it lives today |
|---|---|---|
| A | per-day pnl accumulation `by_day.get(day,0)+usd` in row order | `deribit_txn.py:768` |
| B | per-day flow accumulation, same-day collapse | `deribit_txn.py:669`, `nav_twr.py:199-207` |
| C | anchor scalar: Σ USD-family equities in summaries order | `deribit_txn.py:271-283` |
| D | `terminal = anchor − upnl` | `nav_twr.py:673` |
| E | flow-day union into the pnl index | `nav_twr.py:213-239` |
| F | backward roll loop | `nav_twr.py:288-294` |
| G | day-0 prev and `r_t = (cur − prev − flow)/prev` | `nav_twr.py:327-342` |
| H | guard comparisons (`<=0`, `<DUST_NAV_FLOOR`, `>=FLOW_DOM_RATIO·prev`) | `nav_twr.py:362-368` |
| I | wedge-materiality check `anchor > DUST ∧ |upnl|/anchor > 0.05` | `nav_twr.py:698` |
| J | `gap_fill_daily_returns` and everything downstream | `broker_dailies.py:118` |

C deserves emphasis: for a USD-native account the adapter's
`Σ terminal_native_equity[branch-1] × 1.0` must equal the float that
`deribit_equity_to_usd` produces today — guaranteed by coalescing in the same
summaries iteration order and by USD-family passthrough being addition-only in
both (`deribit_txn.py:279-280`).

### 4.2 The identity test (fails if identity breaks)

`tests/test_native_nav_sc4_identity.py` — dual-run golden:

1. Fixture matrix over a synthetic **all-USDC/USDT** account: {no flows, quiet-day
   flow, flow-dominated day, negative-reconstructed-NAV day, dust day, nonzero
   uPnL wedge below/above 5%, multi-USD-family currencies on the same day}.
2. For each fixture, run **(i)** the legacy path
   (`trades_to_daily_returns_with_status` → `reconstruct_nav_and_twr`,
   `transforms.py:198`) and **(ii)** the native path
   (`reconstruct_native_nav_and_twr` fed by the same rows through the native
   adapter shim).
3. Assert `pd.testing.assert_series_equal(legacy, native, check_exact=True)`
   (bit-exact — any re-associated addition or a mark multiply that isn't the
   IEEE no-op fails it) **and** `assert dict(legacy_meta) == dict(native_meta)`
   (guard flags and `computation_status_hint` byte-equal).
4. A companion micro-test pins the IEEE assumption itself:
   `struct.pack("<d", x*1.0) == struct.pack("<d", x)` over a sample including
   `-0.0`, denormals, and large magnitudes — so a future platform/numpy change
   that breaks the premise is caught at the premise, not downstream.

This is the "prove it fails when neutered" pattern: mutating the native path to
sum currencies before rolling (order change), to multiply by a recomputed 1.0-ish
mark, or to derive day-0 prev differently, each flips `check_exact` red.

---

## 5. Inception-reconciliation refuse gate

### 5.1 What it checks (and what the existing residual check cannot)

`reconcile_flow_residual` (`nav_twr.py:409`) is self-admittedly a construction
tautology — "the identity closes for ANY anchor value" (`:419-425`). The native
method finally has a **non-tautological** external reference: for a
`full_history=True` venue (Deribit — the txn-log reaches inception,
`DEFAULT_START_MS` = 2015-01-01, `deribit_ingest.py:104`, and completeness is
already enforced by `assert_ledger_complete`, `deribit_ingest.py:863`), the
backward roll from today's **venue-reported** native equity through the **entire**
ledger must land at a pre-history balance of ~0 per currency:

```
resid_c = B_c(pre-inception)
        = terminal_native_equity_c − Σ_d native_pnl_c(d) − Σ_d flowqty_c(d)
```

A nonzero `resid_c` means the venue-reported equity and the summed ledger
disagree — missing rows, a mis-classified type, a wrong scope — precisely the
wrong-scope class the DQ-02 tautology documents itself blind to
(`nav_twr.py:427-437`). This is the empirical check that already reconciled the
live account (BTC to 0.048 dust; USDC/ETH exact) promoted into a hard gate.

### 5.2 Tolerance policy

Per currency, valued at the **inception-day mark** (the earliest mark held —
never a current price; D-07 discipline):

```
resid_usd_c = |resid_c| × mark_c(first_day_c)     # branch-1: × 1.0
PASS  iff  Σ_c resid_usd_c ≤ max(INCEPTION_ABS_TOL_USD,
                                 INCEPTION_REL_TOL × NAV_usd(anchor_day))
INCEPTION_ABS_TOL_USD = 1.00      # same $1 floor as reconcile_flow_residual
                                  # (nav_twr.py:458: max(1.00, 1e-6·|terminal|))
INCEPTION_REL_TOL     = 1e-4      # wider than the tautology's 1e-6: this gate
                                  # compares two INDEPENDENT measurements
                                  # (reported equity vs summed ledger), which
                                  # legitimately differ by fee-rounding dust
```

Both constants are module-level in `native_nav.py` and are **tuned against the
three real Deribit keys at the P78-style live acceptance gate** — the exact
precedent of `FLOW_DOM_RATIO` ("tuned against real accounts at the Phase 78
gate", `nav_twr.py:64-65`). Tightening after calibration is expected; loosening
requires evidence.

### 5.3 The refuse signal

```python
class InceptionReconciliationError(NavReconstructionError):
    """Full-history native roll does not reconcile to zero pre-history balance.
    Carries: currencies (list[str]), venue (str), and the RELATIVE breach ratio
    (Σ resid_usd / tolerance) — NEVER raw residual quantities or USD (leak
    discipline, nav_twr.py:443-444)."""
```

Permanent, loud, no factsheet. `full_history=False` (retention-capped venues,
P3) **skips this gate entirely** — a truncated ledger can never reconcile to
zero and must not be punished for it; those venues stay on the existing DQ-02
evidence-gated terminus (`flow_coverage_gap_evidence`, `nav_twr.py:585`) which
already handles the pre-retention gap honestly.

---

## 6. Strict-mode guard hardening — no silent chain-bridging

### 6.1 The current masking

`_guard_denominator` (`nav_twr.py:345-368`) correctly NaNs a bad day, and
`chain_linked_twr` correctly `continue`s (`:338`). The mask is downstream:
`cumulative_twr` (`nav_twr.py:371-377`) does `retained = returns.dropna()` and
takes `Π(1+r) − 1` across the gap — a series with a genuine capital
discontinuity (NAV went ≤ 0 mid-history) is presented as one continuous
compounded figure. The break is *flagged* (`complete_with_warnings` via
`_build_nav_meta`, `:380-406`) but the *number itself* silently bridges it.

### 6.2 The corrected contract

New pure function in `nav_twr.py` (beside the old one):

```python
def cumulative_twr_segmented(returns: pd.Series) -> tuple[float, dict[str, bool]]:
    """Cumulative chain-linked return that refuses to compound across an
    INTERIOR break.

    * No NaN in `returns`            -> Π(1+r) − 1, no flag — bit-identical to
                                        cumulative_twr (SC-4 clean path).
    * LEADING NaNs only (a DQ-02 terminus segment, apply_flow_coverage_terminus
      nav_twr.py:508, or day-0 guard)  -> compound the post-NaN suffix; NO new
      flag (the terminus/DQ-01 machinery already flagged the cause).
    * Any INTERIOR NaN (a break with retained returns on BOTH sides)
      -> compound ONLY the maximal contiguous suffix AFTER the LAST break (the
         suffix is the anchored, trustworthy segment — it chains back from the
         real venue terminal), and raise {"twr_chain_broken": True}.
    NEVER stitches across a gap; NEVER returns NaN when a valid suffix exists;
    returns NaN only when no day survived (same terminal case as today,
    nav_twr.py:375-376)."""
```

Contract additions that make the break loud end-to-end:

- `NavTWRMeta` gains `twr_chain_broken: bool` and it is appended to
  `NAV_TWR_GUARD_KEYS` (`nav_twr.py:145`) — by the registry's own design
  ("adding a guard is a one-line edit that propagates by construction",
  `:139-143`) this automatically rides `complete_with_warnings` through
  `transforms._merge_status_meta`, the analytics_runner lift, and the
  job_worker pre-stamp.
- Every cumulative-consuming call site migrates to the segmented form; the old
  `cumulative_twr` is deleted in the same change (two coexisting cumulative
  semantics is the "surface conflicts, don't average them" violation). A
  source-scan test — the pattern of the forbidden-substitution scan the module
  already references (`nav_twr.py:359-361`) — pins that no caller computes
  `Π(1+returns.dropna())` inline.
- The daily series is untouched: broken days stay NaN in the emitted returns
  (never bridged, never zero-filled by this layer). Note
  `gap_fill_daily_returns` (`broker_dailies.py:118`) `fillna`-style reindexes
  **missing calendar days** with 0.0 — the contract explicitly requires that
  guard-NaN'd *existing* days are NOT converted to 0.0 there; `reindex` with
  `fill_value` only fills newly-created labels, so today's behavior already
  complies, and a pinned test freezes it (a refactor to `.fillna(0)` would
  silently un-break the chain).

### 6.3 Test

Fixture with a mid-history `negative_nav_guard` day flanked by valid returns:
assert (a) `twr_chain_broken` present, (b) cumulative equals the suffix product
exactly and NOT the bridged product (assert both numbers differ in the fixture,
so a regression to bridging fails), (c) status is `complete_with_warnings`.

---

## 7. Generalizing `_INVERSE_CURRENCIES`

### 7.1 Every hardcoded consumer (census)

`_INVERSE_CURRENCIES = frozenset({"BTC","ETH"})` at `deribit_txn.py:102`, consumed by:

| Site | Behavior today on SOL |
|---|---|
| `txn_change_to_usd` `deribit_txn.py:210-217` | **raises** `LedgerValuationError` ("refusing to blind-multiply an unknown currency") — the reported crash |
| `classify_instrument_settlement` `deribit_txn.py:156-161` | raises `ValueError` for a SOL-PERPETUAL instrument |
| `_day_ccy_own_index` `deribit_txn.py:494` | skips SOL rows → no same-day own index ever seeds |
| `inverse_days_needing_index` `deribit_txn.py:559-560` | skips SOL → the settlement-index fetch is never planned |
| `fetch_deribit_ledger_daily_records` `deribit_ingest.py:636` | skips the supplemental-index fetch for SOL |

### 7.2 The generalization: membership becomes injected, probed resolvability

Replace the **meaning** of the set — from "the two currencies we bothered to
hardcode" to "any currency with a resolvable `{ccy}_usd` index" — without
changing the fail-loud shape:

- Every pure function above gains
  `indexable_currencies: AbstractSet[str] = _INVERSE_CURRENCIES` as a
  keyword-only parameter and tests membership against it instead of the module
  constant. **Default = the current frozenset**, so every existing caller and
  test is byte-identical until the I/O layer threads the probed set.
- `_INVERSE_CURRENCIES` itself is retained, renamed in intent (comment) to the
  **static floor**: currencies known-resolvable without a probe. It is the
  degraded-mode default, never the ceiling.
- The I/O layer (`fetch_deribit_ledger_daily_records`) builds the real set once
  per job: `indexable = static_floor ∪ {ccy for ccy in enumerate_currencies(...)
  if ccy ∉ USD_FAMILY and probe(f"{ccy}_usd") succeeds}` using the §3.3(a) probe
  (the code for which already exists verbatim at `deribit_ingest.py:816-827`),
  and threads it into every call in the table. The probe result is cached in the
  job (the same per-currency cache discipline as `settlement_index_cache`,
  `deribit_ingest.py:601`).
- The refusal text at `deribit_txn.py:211-217` keeps its exact semantics — it
  now fires only for genuinely un-indexable currencies (BUIDL/USYC), which is
  the §3.4 branch-3 behavior by construction. The USD_FAMILY ∩ indexable
  disjointness check (§3.2) replaces the static assert's coverage for the
  dynamic part.

SOL therefore works end-to-end: probe resolves `sol_usd` → SOL ∈ indexable →
`classify_currency` returns `INDEXED` → marks fetched via
`fetch_deribit_settlement_index(exchange, "SOL", ...)` → valued. No new
conversion code path; the same multiply, the same same-day rule.

---

## 8. Mixed-account composition

Nothing special-cased — composition is the base case of §1.3:

1. Classification partitions the currency set: `{USDC, USDT} → "USD"` bucket
   (coalesced, mark ≡ 1.0); `{BTC, SOL} →` their own buckets (day marks);
   zero-valued `{BUIDL}` → skipped.
2. Each bucket rolls **independently in its own units** (step 2). A USDC deposit
   never touches the BTC roll; a BTC withdrawal is `flowqty_BTC` on its UTC day.
3. One valuation pass composes them:
   `NAV(d) = B_USD(d)·1.0 + B_BTC(d)·P_BTC(d) + B_SOL(d)·P_SOL(d)` over the
   union calendar (per-bucket carry-forward of *balances* between that bucket's
   ledger events, per §1.3 step 4 — balances are constant between events by
   definition; marks are never carried).
4. One chain-link on the composed NAV with the composed
   `F_usd(d) = Σ_c flowqty_c(d)·mark_c(d)`; one set of guards; one meta.
5. The inception gate (§5) checks each bucket's native residual and sums the
   USD-valued breaches — so a clean USDC book cannot hide a broken BTC book.

A USD-native account is a mixed account with zero branch-2 buckets (⇒ §4
identity); a pure coin account has zero branch-1 buckets. Same code, all three.

---

## 9. Phasing / adapter boundary

### 9.1 The adapter interface (venue-agnostic core, per-venue producers)

The core's entire venue surface is the `NativeLedger` dataclass (§1.2) plus the
probed `indexable_currencies` set. A venue adapter is one function:

```python
# P2 — services/deribit_ingest.py
async def build_deribit_native_ledger(
    exchange: Any, *, sleep: SleepFn = asyncio.sleep,
) -> tuple[NativeLedger, CompletenessReport]:
```

built almost entirely from existing parts:

- **native_pnl:** a per-currency sibling of `txn_rows_to_daily_records`
  (`deribit_txn.py:673`) — `txn_rows_to_native_daily(rows) -> Mapping[str, pd.Series]`
  that keeps the identical type-partition (CASH_BEARING sum / INFORMATIONAL skip /
  unknown-with-cash fail-loud, `:717-780`) and the identical `change`
  absent/null/blank fail-loud guards (`:725-745`), but buckets by
  `(day, currency)` and **never multiplies by an index**. Quiet-day pnl rows
  (the P72 `negative_balance_fee` class) therefore need **no settlement index at
  all for pnl** — a genuine simplification: the index dependency moves from
  every event to the daily mark series.
- **terminal_native_equity / terminal_upnl_native:** the summaries read already
  performed by `fetch_deribit_account_equity_and_upnl_usd`
  (`deribit_ingest.py:773`), keeping per-currency `equity` / `session_upl`
  native instead of collapsing through `deribit_equity_to_usd`. (The collapsed
  USD anchor remains computed for the P78-style parity panel.)
- **native_flows:** `deribit_dated_external_flows_usd` (`deribit_txn.py:581`)
  extended to emit 4-field `ExternalFlow`s keyed `(day, ccy)` (§2.3).
- **marks:** `fetch_deribit_settlement_index` (`deribit_ingest.py:432`) per
  nonzero-valued indexable currency, driven by the §3.3 density requirement
  (the planner generalizes `inverse_days_needing_index` from "days needing an
  event fallback" to "days needing a mark": every day with nonzero B_c or flow).
- **full_history:** `True` (Deribit txn-log reaches inception;
  `assert_ledger_complete` at `deribit_ingest.py:863` already guarantees the
  crawl covered it).

```python
# P3 — ccxt venues (Bybit/OKX/Binance coin-margined)
async def build_ccxt_native_ledger(
    exchange: Any, venue: str, ...,
) -> NativeLedger:   # full_history=False; marks from the venue's daily index/
                     # close source behind the same shape
```

**The contract clause:** a new venue supplies `(native_pnl, terminal_native_equity,
native_flows, marks, terminal_upnl_native, full_history)` and **nothing in
`native_nav.py` changes** — no venue string reaches the core except inside
exception metadata, no per-venue constant lives in it (the per-venue retention
map stays where it is, `FLOW_TERMINUS_DAYS_BY_VENUE` at `nav_twr.py:99`, consumed
by the adapter/wiring layer, not the core).

### 9.2 Wiring and coexistence during phasing

- The Deribit job path (`job_worker` → `fetch_deribit_ledger_daily_records` →
  `combine_realized_and_funding`, `broker_dailies.py:130`) gains a sibling
  `combine_native_ledger(ledger, indexable) -> (returns, meta)` that calls the
  core and reuses `gap_fill_daily_returns` (`broker_dailies.py:118`) —
  everything from the returned Series onward (CSV route, `compute_all_metrics`,
  persistence, factsheet) is untouched.
- **There is no per-account dispatch flag.** Deribit accounts — including
  USD-native ones — all take the native path once P2 lands; §4 identity is what
  licenses that. CSV uploads and venues without per-currency ledgers keep the
  existing `reconstruct_nav_and_twr` path, which is now understood as the
  degenerate single-bucket case of the same math (route-by-data-availability,
  not by account type).
- **Ship gate:** P2 does not merge without (i) the §4.2 SC-4 identity suite
  green, (ii) the §5 inception gate green on the three real Deribit keys, and
  (iii) an old-vs-new golden parity panel (the P78 pattern —
  `parity_diff.classify_delta` reuse) with founder sign-off on the coin
  accounts where the numbers *should* move.

---

## Appendix A — Where the existing code fights the design (honest friction list)

1. **`ExternalFlow` positional 2-unpack** (`nav_twr.py:201`,
   `external_flows.py:63`) breaks on any field addition — two mechanical indexed
   fixes required in the same commit as the extension (§2.3). This is the only
   place the extension is not purely additive.
2. **`chain_linked_twr` derives day-0 prev from `daily_pnl.iloc[0]`**
   (`nav_twr.py:320-331`) — meaningless for a marks-valued NAV; fixed with the
   additive `prev0` keyword (§1.4) rather than a fork.
3. **Currency identity is destroyed at aggregation** — both
   `txn_rows_to_daily_records` (`deribit_txn.py:768`) and
   `deribit_dated_external_flows_usd` (`:669`) collapse to per-day USD scalars.
   The native adapter needs `(day, ccy)`-keyed siblings; the type-partition and
   fail-loud guards are lifted verbatim so the two aggregators cannot drift.
4. **`cumulative_twr` bridges NaN breaks by construction**
   (`returns.dropna()`, `nav_twr.py:374`) — replaced, not patched (§6), because
   two cumulative semantics coexisting is worse than the migration.
5. **`_INVERSE_CURRENCIES` is compile-time but resolvability is a runtime fact**
   — resolved by injection-with-static-floor (§7.2), preserving byte-identity
   for every existing caller via the default.
6. **`_deribit_session_upl_to_usd` silently zeroes an unvaluable coin wedge**
   (`deribit_ingest.py:764-766`) — under the native contract the wedge stays
   native per currency and an unmarkable nonzero wedge is a §3.4 refusal, not a
   0.0; the `unrealized_pnl_unreadable` (MUST-2) machinery is unchanged.
7. **`reconcile_flow_residual` is a tautology for anchor errors** (documented at
   `nav_twr.py:427-437`) — the §5 inception gate is the first non-tautological
   reconciliation; the tautology check is retained (it still catches roll-loop
   code divergence, its original job).

## Appendix B — New/changed public symbols (summary)

| Symbol | Module | New/Changed |
|---|---|---|
| `NativeLedger` (frozen dataclass) | `services/native_nav.py` | new |
| `reconstruct_native_nav_and_twr(ledger, *, indexable_currencies)` | `services/native_nav.py` | new |
| `classify_currency(ccy, *, indexable, usd_family)` / `MarkBranch` | `services/native_nav.py` | new |
| `UnmarkableCurrencyError`, `InceptionReconciliationError` | `services/native_nav.py` | new (subclass `NavReconstructionError`) |
| `INCEPTION_ABS_TOL_USD = 1.00`, `INCEPTION_REL_TOL = 1e-4` | `services/native_nav.py` | new, live-gate-tuned |
| `USD_FAMILY` frozenset | `services/external_flows.py` | new (single source; `_LINEAR_CURRENCIES` aliases it) |
| `ExternalFlow(utc_day_iso, usd_signed, currency="USD", quantity=None)` | `services/external_flows.py` | changed (additive fields; 2 unpack sites fixed) |
| `chain_linked_twr(..., *, prev0=None)` | `services/nav_twr.py` | changed (additive kwarg) |
| `cumulative_twr_segmented(returns)` + `twr_chain_broken` guard key | `services/nav_twr.py` | new (replaces `cumulative_twr`) |
| `txn_change_to_usd(..., *, indexable_currencies=_INVERSE_CURRENCIES)` (+ 3 siblings per §7.1) | `services/deribit_txn.py` | changed (additive kwarg, default-identical) |
| `txn_rows_to_native_daily(rows)` | `services/deribit_txn.py` | new |
| `build_deribit_native_ledger(exchange)` | `services/deribit_ingest.py` | new (P2 adapter) |
| `combine_native_ledger(ledger, indexable)` | `services/broker_dailies.py` | new wiring |
