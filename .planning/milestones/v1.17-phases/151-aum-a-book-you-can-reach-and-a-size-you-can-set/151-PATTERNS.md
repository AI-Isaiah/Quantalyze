# Phase 151: AUM — A book you can reach and a size you can set - Pattern Map

**Mapped:** 2026-08-07
**Files analyzed:** 16 (13 modified, 1–3 new depending on planner's Pattern-2 shape choice)
**Analogs found:** 15 / 16 (1 genuine no-analog: the money-typing INPUT control)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/allocator_positions.py` | service | request-response (venue fetch → rows) | `job_worker.py:996-1023` `_make_exchange_client` (venue dispatch) + its own `_fetch_spot_rows:138-232` (row shape) | exact |
| `analytics-service/services/mt5_concurrency.py` *(NEW, if Pattern-2 option (a))* | utility | shared-resource serialization | `job_worker.py:332-410` (helpers to be MOVED verbatim); registry idiom `position_reconstruction.py:308-318` | exact (move, not rewrite) |
| `analytics-service/services/closed_sets.py` | config | closed-set membership | `CRYPTO_VENUES:210-212`, `STABLECOINS:176-178`, `mt5_enabled_server:107-109` (same file) | exact |
| `analytics-service/services/job_worker.py` | worker/dispatch | event-driven (job kind) | its own lazy-import block `:7100-7104`; MT5 read bracket `:3489-3684` | exact |
| `analytics-service/tests/test_allocator_positions.py` *(or a new `_non_ccxt` sibling)* | test | — | same file `:47-109` (fetch-level) + `:401-499` (handler-level monkeypatch); parametrize shape `test_mt5_client_contract.py:720-737` | exact |
| `src/lib/queries.ts` | data-access / SSR query | request-response (read → payload) | `deriveStrategylessKeys:342-375` (pure predicate), `getStrategylessActiveKeys:392-428` (narrowed `strategy_keys` builder), payload emit `:3799-3801` / `:4223-4225`, type decl `:2380-2408` | exact |
| `src/lib/queries.test.ts` | test | — | `queries.my-strategies.test.ts` (pure-predicate sibling for `deriveStrategylessKeys`) | exact |
| `src/lib/queries.my-allocation.test.ts` | test | — | same file `:525` `"Phase 37: !portfolio branch exposes the per-key channel with empty/false defaults"` | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | component | event-driven (draft state) | its own `handleWeightChange:1160-1275`, `windowTouchedRef:1151-1158`, `dataSourceKeys:2489-2492`, `notionalText:5400-5411`, weight-input JSX `:5625-5676` | exact (all in-file) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | test | — | same file `:2450-2475` (the refusal test to be REWRITTEN, not deleted) | exact |
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` | model / codec | transform (persist ⇄ decode) | `leverageOverrides` field `:126-135` + its zod entry `:865-874` | exact |
| `src/app/(dashboard)/allocations/lib/scenario-state.test.ts` | test | — | same file (codec round-trip cases) | role-match |
| `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` | component | request-response (POST) | its own body builder `:534-539` (the `init_holdings_fingerprint` conditional-spread) | exact |
| `src/app/api/allocator/scenario/commit/route.ts` | route handler | request-response | `CommitBodySchema:150-163` (additive optional field) + `_size_source` sentinel block `:826-905` | exact |
| `src/app/api/allocator/scenario/commit/route.test.ts` | test | — | same file `:321-353` (`describe("zod validation")`) | exact |
| **AUM input + per-strategy dollar input (the money-typing control)** | component | event-driven | **none** — see §No Analog Found | none |

`src/components/exchanges/AllocatorSyncStatus.tsx` is listed in the phase context but is **NOT a file to modify** — it is already a verbatim pass-through (`:252-253`). It is included below as a read-only contract reference so the planner does not plan an edit there.

---

## Pattern Assignments

### `analytics-service/services/allocator_positions.py` (service, request-response)

**Analog A — the venue-dispatch shape:** `analytics-service/services/job_worker.py:996-1023`

```python
def _make_exchange_client(
    exchange_name: str,
    api_key: str,
    api_secret: str,
    passphrase: str | None,
) -> ccxt.Exchange | SfoxClient | Mt5Session:
    """SFOX-05 — the SINGLE preflight construction chokepoint. ...
    so the sfox-vs-mt5-vs-ccxt decision lives in exactly ONE place.
    ...
    Every ccxt venue is BYTE-IDENTICAL to the prior inline create_exchange call.
    """
    if exchange_name == "sfox":
        return make_sfox_client(api_key.strip())
    if exchange_name == "mt5":
        return _make_mt5_session(api_key, api_secret, passphrase)
    return create_exchange(exchange_name, api_key, api_secret, passphrase)
```

Copy: (1) branch on the **venue string parameter**, never on `isinstance`/`hasattr`; (2) ccxt is the **fall-through**, byte-unchanged; (3) a docstring sentence that names the chokepoint ("lives in exactly ONE place") — this file's own docstring already carries the same convention at `allocator_positions.py:31-33`.

**Analog B — the graceful per-venue skip already in this file** (`allocator_positions.py:150-152`):

```python
    # Deribit — spot deferred (no spot path). Skip gracefully; derivatives sync.
    if getattr(exchange, "id", None) == "deribit":
        return []
```
This is the *existing* precedent for "this venue does not do this fetch → return early, never raise". The new venue branches extend it; note the existing one uses `getattr(exchange, "id")`, which is exactly the duck-typing CONTEXT bans for the new code — **do not copy that access form**, copy only the early-return posture.

**Analog C — the honest-skip return contract** (`allocator_positions.py:268-304`, the function being extended):

```python
async def fetch_allocator_holdings(
    exchange_name: str, exchange: Any
) -> tuple[list[dict[str, Any]], str | None]:
    """D-01: fetch BOTH spot and derivatives in a single sync.

    Returns ``(rows, warning)`` where ``warning`` is None on full success
    and a sanitized string when the derivative side failed ...
    (partial success → the handler writes sync_status='complete_with_warnings').
    """
    ...
    except Exception as exc:  # noqa: BLE001
        # Partial success: persist spot, surface the derivative-side error
        # as sync_status='complete_with_warnings' via the handler.
        warning = str(exc)[:500]

    return (spot_rows + deriv_rows, warning)
```

⚠️ The existing warning arm assigns `str(exc)[:500]` — the exact class of leak AUM-02 fixes. The new non-ccxt branches must return **human copy**, never `str(exc)`.

**Analog D — the holdings-row dict shape** (`allocator_positions.py:215-231`) — the MT5/sFOX rows must be key-for-key identical:

```python
        rows.append({
            "venue": exchange_name,
            "symbol": asset,              # D-16: raw currency code, no suffix
            "holding_type": "spot",
            "side": "flat",
            "quantity": float(qty),
            "value_usd": float(qty) * mark_price,
            "entry_price": None,           # D-06: spot has no basis from the worker
            "mark_price": mark_price,
            "unrealized_pnl_usd": None,
            "cost_basis_usd": None,
            "raw_payload": _cap_raw_payload({
                "asset": asset,
                "total": float(qty),
                "mark_price": mark_price,
            }),
        })
```

**Stablecoin/`mark_price = 1.0` precedent for the sFOX branch** (`:209-214`), reusing the already-imported `STABLECOINS`:

```python
        asset_upper = asset.upper()
        if asset_upper in STABLECOINS:
            mark_price = 1.0
```
`from services.closed_sets import STABLECOINS` is already at `allocator_positions.py:43` — no new import.

**Error→status table (leave untouched, ccxt-only)** (`:122-135`):

```python
def _map_exception_to_sync_status(exc: Exception) -> str:
    if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied)):
        return "revoked"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "rate_limited"
    return "error"
```

---

### `analytics-service/services/mt5_concurrency.py` (utility, shared-resource serialization) — NEW, if option (a)

**Analog:** `analytics-service/services/job_worker.py:332-410` — the symbols to MOVE (not copy):

```python
async def _mt5_bounded_restart(client: "Mt5Client") -> None:
    """MT5CONC-01 — ACTIVELY restart a wedged MT5 terminal, bounded so it can never
    itself nest-wedge the SEQUENTIAL worker.
    ...
    Kept module-level (not nested in the branch) because plan 137-02 reuses it for
    the login-mismatch branch.
    """
    try:
        await asyncio.wait_for(
            asyncio.to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001 — best-effort recovery
        logger.warning(...)
```

```python
# MT5CONC-02 ... It MUST be module-level, NOT a Mt5Session attribute: _make_mt5_session
# builds a FRESH Mt5Session + Mt5Client per job, so a Session-attached lock would be a
# brand-new Lock object per job and serialize NOTHING (the Pitfall-1 anti-pattern).
_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock] = {}


def _mt5_terminal_lock_for(terminal_key: str) -> asyncio.Lock:
    # setdefault is atomic across coroutine resumption — there is no await between
    # the lookup and the insert, so within one event loop two simultaneous first-
    # callers for the same terminal cannot end up with two different Lock objects.
    return _MT5_TERMINAL_LOCKS.setdefault(terminal_key, asyncio.Lock())
```

Also move `_MT5_DERIVE_READ_TIMEOUT_S:295-297`, `_MT5_RESTART_TIMEOUT_S:307-309`, and `class _Mt5PostReadVerificationError:390-410`.

**Precedent that this module SHAPE is legitimate** — `analytics-service/services/position_reconstruction.py:308-318` is the registry idiom the MT5 comment itself cites:

```python
# The dict grows unboundedly by design: evicting a Lock with waiters
# parked on it would silently break serialization, and strategy_id
# cardinality is bounded by the strategies table (O(10²–10³)).
_RECONSTRUCT_LOCKS: dict[str, asyncio.Lock] = {}


def _lock_for(strategy_id: str) -> asyncio.Lock:
    return _RECONSTRUCT_LOCKS.setdefault(strategy_id, asyncio.Lock())
```

**Terminal-key contract** (`analytics-service/services/mt5_client.py:441-453`) — read-only, do not change:

```python
    def terminal_key(self) -> str:
        """Process-wide terminal identity (``host:port``) — the key for the
        Phase-137 per-terminal serialization lock registry
        (``job_worker._MT5_TERMINAL_LOCKS``, MT5CONC-02).
        ...must be derived from the construction identity (``_host``/``_port``)...
        """
        return f"{self._host}:{self._port}"
```
⚠️ The docstring **names `job_worker._MT5_TERMINAL_LOCKS`**. If the registry moves, this docstring is a stale cross-reference and must be updated in the same edit.

---

### `analytics-service/services/allocator_positions.py` — MT5 read bracket (service, request-response)

**Analog:** `analytics-service/services/job_worker.py:3489-3552` — copy the structure, drop `history_deals_get`.

```python
            def _assert_expected_login(info: dict[str, Any]) -> None:
                # MT5CONC-02 login bracket: the live terminal's account MUST be the
                # connected key's account ... STRICT equality; a MISSING "login"
                # field (info.get → None) must FAIL LOUD, never default-match
                _actual_login = info.get("login")
                if _actual_login != _mt5_session.login:
                    raise Mt5AccountMismatchError(_mt5_session.login, _actual_login)

            def _mt5_read() -> tuple[dict[str, Any], list[dict[str, Any]]]:
                _mt5_session.client.login(
                    _mt5_session.login,
                    _mt5_session.investor_password,
                    _mt5_session.server,
                )
                _info = _mt5_session.client.account_info()  # None→typed raise
                _assert_expected_login(_info)
                ...
                try:
                    _post_info = _mt5_session.client.account_info()
                except Mt5ClientError as exc:
                    raise _Mt5PostReadVerificationError(str(exc)) from exc
                _assert_expected_login(_post_info)
                return _info, _deals

            async with _mt5_terminal_lock_for(_mt5_session.client.terminal_key):
                try:
                    _mt5_info, _mt5_deals = await asyncio.wait_for(
                        asyncio.to_thread(_mt5_read),
                        timeout=_MT5_DERIVE_READ_TIMEOUT_S,
                    )
                except asyncio.TimeoutError:
                    ...
                    await _mt5_bounded_restart(_mt5_session.client)
                    return DispatchResult(... error_kind="transient")
                except Mt5AccountMismatchError as exc:
                    ...
                    await _mt5_bounded_restart(_mt5_session.client)
                    return DispatchResult(... error_kind="transient")
                except _Mt5PostReadVerificationError as exc:
                    ...
```

**Kill-switch gate FIRST** (`job_worker.py:3462-3467`) — the derive arm's exact posture, to be mirrored (but returning `([], copy)` instead of a `DispatchResult`, per the honest-skip channel):

```python
            if not mt5_enabled_server():
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=f"derive_broker_dailies: {MT5_DISABLED_DETAIL}",
                    error_kind="permanent",
                )
```

**Equity extraction + fail-loud on non-finite** (`job_worker.py:3691-3719`) — the economic contract for the MT5 holdings row (`equity`, **not** `balance`):

```python
            try:
                _mt5_equity = float(_mt5_info["equity"])
                _mt5_balance = float(_mt5_info["balance"])
            except (KeyError, TypeError, ValueError) as exc:
                ...
                    error_message=(
                        "derive_broker_dailies: mt5 account_info missing/non-numeric "
                        "equity/balance — " + str(scrub_freeform_string(str(exc)))
                    ),
            if not (math.isfinite(_mt5_equity) and math.isfinite(_mt5_balance)):
                ... "refusing a poisoned anchor"
```
Note `scrub_freeform_string` is the established secret-scrub for any MT5 text that may reach a message.

**Union narrowing for mypy --strict** (`job_worker.py:3478-3481`) — `cast()`, never `# type: ignore`:

```python
            # venue=="mt5" ⇒ the preflight built an Mt5Session (cast narrows the
            # ccxt.Exchange | SfoxClient | Mt5Session union ... mypy --strict, no ignore).
            _mt5_session = cast(Mt5Session, ctx.exchange)
```

---

### `analytics-service/services/closed_sets.py` (config, closed-set)

**Analog — the "why this set lives here" comment + `frozenset` declaration** (`:194-212`):

```python
# Crypto exchange venues — the "annualize on the crypto (√365) clock" set (#597).
# MD-01 (Fable code-review, Phase 105.1): single-sourced HERE precisely because it
# was hand-copied — ... A new venue admitted to one only would drift ... the exact
# silent re-widening / hand-copy failure mode this module exists to prevent.
CRYPTO_VENUES: frozenset[str] = frozenset(
    {"deribit", "binance", "okx", "bybit", "sfox"}
)
```

**Analog — the venue copy-string block** (`:96-104`), the shape for the new `UNSUPPORTED_VENUE_NOTE` / `MT5_NON_USD_NOTE` strings:

```python
MT5_DISABLED_DETAIL = "MT5 integration is not yet available."
MT5_MASTER_PASSWORD_DETAIL = (
    "MT5 master password detected — this login can place trades. Reconnect "
    "using your read-only investor password."
)
```
⚠️ The block at `:81-88` documents a **STRING-SAFETY INVARIANT**: these detail strings are collision-checked against `wizardErrors.ts:classifyKeyValidationError`'s substring branches ("signature", "rate", "timeout", "probe", "trading", …). New user-visible venue copy that could reach a classifier must run the same collision check.

⚠️ **Research correction:** RESEARCH §Code-Example-D says `EXCHANGE_DISPLAY` lives in `services/closed_sets.py`. It does **not** — that module has no such map. `EXCHANGE_DISPLAY` exists only in TypeScript (`src/lib/closed-sets.ts:48-55`, consumed by `AllocatorSyncStatus.tsx:118`). The Python worker has no venue-label map; the planner must either hardcode `"MT5"` / `"sFOX"` in the copy constants or add the map (a new closed set, subject to the module's single-source rule).

---

### `analytics-service/services/job_worker.py` (worker, event-driven)

**Analog — the lazy-import block to extend** (`:7100-7104`):

```python
    from services.allocator_positions import (
        fetch_allocator_holdings,
        persist_allocator_holdings,
        _map_exception_to_sync_status,
    )
```

**The `warning` → status mapping that makes the honest skip free** (`:7204-7213`) — **no edit needed here**:

```python
        final_status = "complete_with_warnings" if warning else "complete"

        def _update_ok() -> None:
            ctx.supabase.table("api_keys").update({
                "sync_status": final_status,
                "sync_error": warning,
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", api_key_id).execute()
```

**The leak arm to keep non-ccxt exceptions OUT of** (`:7155-7165`):

```python
        except Exception as exc:  # noqa: BLE001
            error_kind, msg = classify_exception(exc)
            sanitized = msg[:500]
            status_target = _map_exception_to_sync_status(exc)
            ...
                    {"sync_status": status_target, "sync_error": sanitized}
```
This is where `"'Mt5Session' object has no attribute 'fetch_balance'"` reached PROD. Per RESEARCH Open-Q5, a genuine MT5/sFOX transport failure that must still RETRY has to raise an exception whose `str()` IS human copy, so this arm stamps human text.

**`aclose_exchange` is already venue-safe** (`:7184-7188`) — no edit:

```python
    finally:
        try:
            await aclose_exchange(ctx.exchange)
        except Exception:  # pragma: no cover - defensive cleanup
            pass
```

---

### `analytics-service/tests/test_allocator_positions.py` (test)

**Analog A — fetch-level test with an `AsyncMock` exchange** (`:47-60`):

```python
@pytest.mark.asyncio
async def test_fetch_allocator_holdings_returns_both_types(monkeypatch):
    """D-01: each sync emits BOTH spot (from fetch_balance) AND derivative
    (from fetch_positions) rows in a single flat list. ..."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"BTC": 0.5, "ETH": 2.0, "USDT": 1000.0},
    })
```
⚠️ **`AsyncMock` auto-creates any attribute**, so `hasattr(fake, "fetch_balance")` is always True on an `AsyncMock`. The RESEARCH §Code-Example-B assertion `assert not hasattr(client, "fetch_balance") or not client.fetch_balance.called` therefore only bites via the `.called` half. Build the mt5/sfox fakes as **`MagicMock(spec=Mt5Client)` / `spec=SfoxClient`** (or plain stub classes) so the `not hasattr` half is load-bearing.

**Analog B — handler-level test with a stubbed preflight** (`:409-459`):

```python
    from services import job_worker as jw
    from services import audit as audit_module

    key_row = api_key_row_factory(id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance")
    mock_supabase = MagicMock()
    mock_exchange = MagicMock()
    mock_exchange.close = AsyncMock()

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase, strategy_row=None, key_row=key_row, exchange=mock_exchange,
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)
    ...
    # Patch module-local lookups in the handler. The handler does a local
    # import from services.allocator_positions — patch the symbols on that
    # module so the import binding picks up the mock.
    from services import allocator_positions as ap_mod
    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", _fake_fetch)
```
The `api_key_row_factory` fixture and the `exchange=` kwarg are the seam for venue-parametrized handler tests.

**Analog C — the parametrize shape** (`analytics-service/tests/test_mt5_client_contract.py:720-726`):

```python
@pytest.mark.parametrize(
    "forbidden",
    [
        "order_send",
        "order_send_async",
        "positions_get",
        "orders_get",
```
The MT5 facade pin at `:719-763` is the fence CONTEXT says stays closed — the new tests must not widen it.

**Docstring convention** (`:1-21`) — a numbered required-test list at the top of the file, tying each test to its requirement ID.

---

### `src/lib/queries.ts` (data-access, request-response)

**Analog A — the pure role-discriminator to extract from** (`:342-375`):

```ts
export function deriveStrategylessKeys(
  keys: Pick<ApiKeyUserView, "id" | "exchange" | "label" | "is_active" | "sync_status" | "disconnected_at">[],
  ownStrategies: readonly { id: string; api_key_id: string | null; status: string }[],
  strategyKeyLinks: readonly { strategy_id: string; api_key_id: string }[],
): StrategylessKey[] {
  // W-4: archived ≠ coverage.
  const live = ownStrategies.filter((s) => s.status !== "archived");
  const liveIds = new Set(live.map((s) => s.id));

  const covered = new Set<string>([
    ...live.map((s) => s.api_key_id).filter((id): id is string => id != null),
    // A key may hold TWO disjoint windows on the same composite ... the Set de-dupes.
    // Links whose strategy is archived or not the owner's are dropped by the
    // liveIds membership check.
    ...strategyKeyLinks
      .filter((l) => liveIds.has(l.strategy_id))
      .map((l) => l.api_key_id),
  ]);

  return keys
    .filter(isPerKeyDailiesEligibleKey)
    .filter((k) => !covered.has(k.id))
    .map(({ id, exchange, label }) => ({ id, exchange: exchange as SupportedExchange, label }));
}
```
Extract lines **354-365** verbatim into `deriveStrategyLinkedKeyIds(...): Set<string>` and have this function call it — same `covered` semantics, zero behavior change.

**Analog B — the narrowed `strategy_keys` builder** (`:397-427`), required because the table is absent from `database.types.ts`:

```ts
  // `strategy_keys` (migration 20260710120000) is NOT present in the generated
  // `database.types.ts` ... Narrow ONE builder to the exact shape used here rather
  // than widening the whole client, so the owner scope stays a literal
  // `.eq("owner_id", …)`. Regenerating database.types.ts is the real fix ...
  type StrategyKeyLinkRow = { strategy_id: string; api_key_id: string };
  const strategyKeysTable = (
    supabase as unknown as {
      from: (relation: "strategy_keys") => {
        select: (columns: string) => {
          eq: (column: string, value: string) => PromiseLike<{
            data: StrategyKeyLinkRow[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  ).from("strategy_keys");

  const [keysRes, strategiesRes, linksRes] = await Promise.all([
    supabase.from("api_keys").select(API_KEY_USER_COLUMNS).eq("user_id", userId),
    // `status` is projected so the archived filter is decidable in-memory.
    supabase.from("strategies").select("id, api_key_id, status").eq("user_id", userId),
    strategyKeysTable.select("strategy_id, api_key_id").eq("owner_id", userId),
  ]);
```
⚠️ Note the **owner column asymmetry**: `strategies` scopes on `user_id`, `strategy_keys` on `owner_id`.

**Analog C — the gate hoist + payload-ride comment** (`:3714-3728`), the exact place the new fields go:

```ts
    // D3 gate: the eligible-key predicate MUST match the backfill's ...
    const eligibleKeyIds = apiKeys
      .filter(isPerKeyDailiesEligibleKey)
      .map((k) => k.id);
    // Phase 37 / DSRC-01 — hoist the D3 gate to a const so the SAME single call
    // both SELECTS the liveBaselineMetrics source (below) AND rides the payload
    // (perKeyDailiesGateSatisfied, on both return branches). No behavior change:
    // the ternary still gates on this exact value.
    const perKeyDailiesGateSatisfied = allActiveKeysHavePerKeyDailies(
      eligibleKeyIds,
      perKeyReturnsByApiKeyId,
    );
```

**Analog D — the eligible-filter idiom for narrowing a map** (`:3745-3750`), the shape for `contributingApiKeyIds`:

```ts
    const eligibleKeyIdSet = new Set(eligibleKeyIds);
    const eligiblePerKeyReturns = Object.fromEntries(
      Object.entries(perKeyReturnsByApiKeyId).filter(([id]) =>
        eligibleKeyIdSet.has(id),
      ),
    );
```

**Analog E — BOTH return branches** (`:3797-3801` and `:4217-4225`) — the new fields must be added in both, with the same comment style:

```ts
        // Phase 37 / DSRC-01 — per-key channel (additive; real values, computed
        // before this !portfolio split). Fresh allocators carry {} / false / [].
        perKeyReturnsByApiKeyId,
        perKeyDailiesGateSatisfied,
        eligibleApiKeyIds: eligibleKeyIds,
```

```ts
      // Phase 37 / DSRC-01 — per-key channel (additive). This is the FULL
      // unfiltered per-key map; the composer applies its OWN eligibleApiKeyIds
      // filter client-side when it recomputes the blend on a data-source toggle.
      perKeyReturnsByApiKeyId,
      perKeyDailiesGateSatisfied,
      eligibleApiKeyIds: eligibleKeyIds,
```

**Analog F — the payload TYPE declarations** (`:2394-2408`) — every new field needs the same "read-only; the client must NEVER re-derive" doc:

```ts
  /**
   * Phase 37 / DSRC-01. The Phase-36 D3 all-or-nothing gate result ... Read-only; the
   * client must NEVER re-derive the eligibility predicate (the Python backfill
   * is the source of truth — see `isPerKeyDailiesEligibleKey`).
   */
  perKeyDailiesGateSatisfied: boolean;
  /**
   * Phase 37 / DSRC-01. The ids of this allocator's active keys eligible for
   * the per-key basis ... Exposed read-only for the composer; a subset of `apiKeys[].id`.
   */
  eligibleApiKeyIds: string[];
```

**Analog G — the existing all-or-nothing predicate to leave UNTOUCHED** (`:2846-2863`):

```ts
/**
 * @internal Exported for unit testing only (Phase 36 D3 honesty guard). The
 * all-or-nothing predicate: returns true IFF EVERY active key id has a
 * non-empty per-key series. ... (never a mixed annualization basis inside one curve).
 */
export function allActiveKeysHavePerKeyDailies(
  activeKeyIds: ReadonlyArray<string>,
  perKeyReturnsByApiKeyId: Record<string, DailyPoint[]>,
): boolean {
  if (activeKeyIds.length === 0) return false;
  return activeKeyIds.every((id) => { ... });
}
```
The new `bookEntryGateSatisfied` is a **sibling** with `.some(...)` semantics + the manager-key subtraction — it does not replace this.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (component, event-driven)

**Analog A — the gate consumer to repoint** (`:841-862`):

```tsx
  const hasLiveBook = rawHoldingsSummary.length > 0;
  // ENGINE-03 (Phase 63) — book mode requires BOTH a live book AND the per-key
  // dailies gate. A gate=false holder has no per-source engine behind a book
  // mode, so book entry is unavailable and the composer initializes to BLANK ...
  const canEnterBook = hasLiveBook && payload.perKeyDailiesGateSatisfied;
  const [entryMode, setEntryMode] = useState<"book" | "blank">(
    canEnterBook ? "book" : "blank",
  );

  const holdingsSummary = useMemo(
    () => (entryMode === "blank" ? [] : rawHoldingsSummary),
    [entryMode, rawHoldingsSummary],
  ) as typeof rawHoldingsSummary;
```

**Analog B — `dataSourceKeys`, the SoT-mirror filter to narrow** (`:2486-2492`):

```tsx
  // The connected exchange keys eligible for per-source toggling — payload
  // apiKeys filtered to the SSR-computed eligible-key id set (SoT mirror; the
  // client never re-derives eligibility, RESEARCH §SoT-mirror). One row per key.
  const dataSourceKeys = useMemo(() => {
    const eligible = payload.eligibleApiKeyIds ?? [];
    return (payload.apiKeys ?? []).filter((k) => eligible.includes(k.id));
  }, [payload.apiKeys, payload.eligibleApiKeyIds]);
```

**Analog C — the honest calm-note gate + render** — the exact template for the partial-book note.
Gate (`:2481-2484`):

```tsx
  const showDataSourcesFallback =
    hasLiveBook &&
    !payload.perKeyDailiesGateSatisfied &&
    (payload.eligibleApiKeyIds ?? []).length > 0;
```
Render (`:4069-4080`):

```tsx
      {showDataSourcesFallback && (
        <div className="mt-4" data-testid="scenario-constituent-fallback">
          <InfoBanner>
            <span className="font-semibold text-text-primary">
              Per-source modeling needs per-key history.
            </span>{" "}
            One or more connected keys don&apos;t have a per-key return series
            yet, so this projection blends your whole book. Per-source toggles
            appear once every key has its own history.
          </InfoBanner>
        </div>
      )}
```
Copy: `InfoBanner` (imported at `:117`), a bold lead sentence + calm body, a `data-testid` on the wrapper. ⚠️ RESEARCH Pitfall 3 (consumer 5): this note is gated on `!perKeyDailiesGateSatisfied` and stays partly true under a partial book — reconcile it with the new note rather than deleting it.

**Analog D — the AUM memo to rename** (`:3581-3590`):

```tsx
  const scenarioAum = useMemo(() => {
    let sum = 0;
    for (const [scopeRef, on] of Object.entries(scenario.draft.toggleByScopeRef)) {
      if (!on) continue;
      if (!scopeRef.startsWith("holding:")) continue;
      const h = holdingByRef.get(scopeRef);
      if (h) sum += h.value_usd;
    }
    return sum;
  }, [scenario.draft.toggleByScopeRef, holdingByRef]);
```

**Analog E — the one-time-seed-with-touched-ref idiom** (`:1151-1158`), for seeding the book-mode AUM input without re-snapping a typed value:

```tsx
  const [winStart, setWinStart] = useState<string | null>(null);
  const [winEnd, setWinEnd] = useState<string | null>(null);
  // Pitfall 3 — the intersection default is a one-time SEED (and the "Common
  // period" preset target), never a controlled value. Once the user sets a
  // window (preset or picker) this flag is true and the seed effect never
  // re-snaps their choice.
  const windowTouchedRef = useRef(false);
```

**Analog F — the ONLY weight-write path the dollar input may route through** (`:1160-1191`, `:1233-1251`):

```tsx
  function handleWeightChange(scopeRef: string, weight: number) {
    if (!Number.isFinite(weight)) {
      console.warn("[ScenarioComposer] handleWeightChange received non-finite weight", { scopeRef, weight });
      setCommitError("Invalid weight — enter a value between 0 and 1. The previous value was kept.");
      return;
    }
    if (weight > 1) {
      setCommitError("Weight clamped to 1 — the maximum allocation is 100% of portfolio AUM.");
    } else {
      setCommitError(null);
    }
    const clampedWeight = Math.min(1, Math.max(0, weight));
    ...
    if (!isMixedPerKeyBook) {
      scenario.setWeightOverride(scopeRef, clampedWeight);
      return;
    }
    const otherIds = basisIds.filter((id) => id !== scopeRef);
    if (otherIds.length === 0) {
      setCommitError("A single constituent is always 100%.");
      return;
    }
```
All three guards (non-finite log+message, >1 clamp banner, sole-unit refusal) must remain reachable from a dollar edit. Do not fork a second write path.

**Analog G — the number-input JSX recipe** (`:5625-5666`) — the closest in-repo shape for the new inputs:

```tsx
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`weight-${k.id}`}>
                  {labelText} weight
                </label>
                <input
                  id={`weight-${k.id}`}
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={(blendShareByRef[k.id] ?? draft.weightOverrides[k.id] ?? 0).toFixed(3)}
                  disabled={!included}
                  onChange={(e) => onSetWeight(k.id, Number(e.target.value))}
                  className="w-20 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
                />
```
And the **commit-on-blur/Enter** variant for values that must not fire per keystroke (`:5456-5480`):

```tsx
      <input
        id={`target-dd-${ref}`}
        type="number"
        step="0.1" min="0" max="100"
        disabled={disabled}
        title="Target this constituent's OWN standalone max drawdown ... Commits on blur/Enter and back-solves the leverage."
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const raw = (e.target as HTMLInputElement).value;
            // F2 — a blank field is "no target entered", not a 0% target ...
            if (raw.trim() !== "") onCommitTarget(ref, Number(raw));
          }
        }}
        onBlur={(e) => {
          const raw = e.target.value;
          if (raw.trim() !== "") onCommitTarget(ref, Number(raw));
        }}
        className="w-16 rounded border border-accent bg-surface px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
      />
```
⚠️ The `raw.trim() !== ""` guard is exactly the "blank ≠ 0" rule the blank-mode AUM input needs (151-UI-SPEC: "never pre-filled `0` — a zero is a claim").

**Analog H — the em-dash-when-non-derivable derived cell** (`:5400-5411`), the template for the dollar column when `scenarioAum <= 0`:

```tsx
  const notionalText = (ref: string): string => {
    const share = blendShareByRef[ref];
    if (totalBookEquity == null || typeof share !== "number" || !Number.isFinite(share)) {
      return "—";
    }
    const notional = share * totalBookEquity * (leverageByRef[ref] ?? 1);
    return Number.isFinite(notional) ? formatCurrency(notional) : "—";
  };
```
Rendered with both a `title` and a `data-testid` (`:5669-5675`):

```tsx
                <span
                  data-testid="scenario-constituent-notional"
                  title="Notional = equity × blend share × leverage — derived, informative only ...; never a weight input"
                  className="w-20 text-right font-mono text-xs text-text-muted"
                >
                  {notionalText(k.id)}
                </span>
```
⚠️ Note this file uses a local `formatCurrency`, not `formatUsd`. RESEARCH/150-UI-SPEC direct the NEW money surfaces to `formatUsd` from `@/lib/dollar-validation`; the planner must decide explicitly and comment it, or the composer ends up with two money formatters.

**Analog I — the refusal copy to replace** (`:3669-3680`) and its alert host (`:5012-5021`):

```tsx
    // Refuse the commit when scenarioAum<=0 with voluntary_adds present:
    // every add row would land with size_at_decision_usd:0 and the
    // downstream daily-delta cron divides realized PnL by that size →
    // division-by-zero. ...
    const hasVoluntaryAdds = scenario.draft.addedStrategies.length > 0;
    if (hasVoluntaryAdds && (!Number.isFinite(scenarioAum) || scenarioAum <= 0)) {
      setCommitError(
        "Can't record a scenario commit: portfolio AUM is zero. Connect an exchange API key or toggle on a live holding before submitting.",
      );
      return;
    }
```

```tsx
      {commitError && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="scenario-commit-error"
          className="mt-4 rounded-md border border-negative bg-[rgba(220,38,38,0.05)] p-3 text-sm text-negative"
        >
          {commitError}
        </div>
      )}
```
Per-row size gate immediately after (`:3684-3694`) uses the same `setCommitError` + `return` shape.

**Analog J — the disclosure note that auto-clears once AUM > 0** (`:4421-4433`):

```tsx
        {/* NEW-C18-14: the factsheet-backed chart renders the projected SHAPE ...
            When scenarioAum=0 there is no real book behind the curve, so disclose
            that it is illustrative ... */}
        {scenarioAum <= 0 && (
          <div aria-live="polite" className="mt-2 text-center text-fixed-11 text-text-muted">
            Illustrative shape only — no live capital connected
          </div>
        )}
```

---

### `src/app/(dashboard)/allocations/lib/scenario-state.ts` (model, transform)

**Analog — the optional-additive draft field** (`:126-135`):

```ts
  /**
   * LEV-02 (Phase 90.5, D3/D4): per-strategy leverage stamped at Save ...
   * Optional + additive — no schema_version bump
   * (userWeightOverrides/window precedent). Saved-scenario persistence ONLY:
   * NOT a commit-diff input, NOT localStorage-autosave-maintained. NO range
   * refine (a refine failure = draft-deleting reset; sanitize-on-read via
   * sanitizeLeverageMap instead).
   */
  leverageOverrides?: Record<string, number>;
```

**Its zod entry** (`:865-874`) — the load-bearing "declare it or it is silently stripped" note:

```ts
  // LEV-02 (Phase 90.5, D3) — per-strategy leverage overrides. Optional +
  // additive so pre-existing drafts (field absent) validate; no schema_version
  // bump. ⚠️ LOAD-BEARING: `z.object` STRIPS unknown keys and saved/route.ts:140
  // persists `parsed.data.draft`, so WITHOUT this field a POSTed leverage map is
  // silently dropped. DELIBERATELY NO `.min/.max` range refine (D3 correction
  // 2026-07-11): a refine FAILURE on this shared schema routes the codec to the
  // draft-deleting reset → data loss over one out-of-range persisted value. The
  // clamp happens on READ (sanitizeLeverage, plan 90.5-04); `boundedRecord`
  // already caps entry count (the DoS guard).
  leverageOverrides: boundedRecord(z.number(), "leverageOverrides").optional(),
```
Same anti-refine rule stated again for `window` (`:875-884`) and `memberKeyIds` (`:891-903`). Three precedents; `SCENARIO_SCHEMA_VERSION` stays **4** (`:79`).

**Sanitize-on-read precedent:** `sanitizeLeverageMap` lives in `@/lib/leverage` (not in `scenario-state.ts`) and is applied at the composer's decode sites (`ScenarioComposer.tsx:1711`, `:1753`) and in `share-resolve.ts:336`. A `sanitizeManualAum` helper should follow the same home + call-site pattern.

---

### `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` (component, request-response)

**Analog — the conditional-spread body builder** (`:534-539`):

```tsx
        // B11 / NEW-C18-10: include the frozen draft fingerprint so the RPC can
        // reject a stale-draft commit (409). Omit the key when null so the
        // request shape (and its idempotency request_hash) is unchanged for
        // callers/tests that don't supply it.
        body: JSON.stringify({
          diffs: buildSubmitDiffs(),
          ...(initHoldingsFingerprint !== null && {
            init_holdings_fingerprint: initHoldingsFingerprint,
          }),
        }),
```
⚠️ The comment names a real constraint: the body shape feeds the **idempotency `request_hash`**. Adding `manual_aum_usd` unconditionally would change the hash for every existing caller; use the same conditional spread.

---

### `src/app/api/allocator/scenario/commit/route.ts` (route handler, request-response)

**Analog A — the additive optional body field** (`:150-163`):

```ts
export const CommitBodySchema = z.object({
  diffs: z.array(CommitDiffSchema).min(1).max(50),
  // B11 / NEW-C18-10 — optimistic concurrency. ...
  // Optional for backward compatibility (absent => RPC skips the precondition);
  // the live client always sends it. .max() bounds a hostile payload ...
  init_holdings_fingerprint: z.string().max(200_000).optional(),
});
```
Bound the new number the way the diff schemas bound theirs (`:97`, `:106`): `z.number().nonnegative()` / `.min(0).max(100)`.

**Analog B — the `_size_source` sentinel machinery to extend** (`:826-834`, `:844-871`, `:886-901`):

```ts
        | "client_unverified"
        | "lookup_failed"
        | "ref_not_found"
        | "no_holdings_snapshot" =
        "client_unverified";
```

```ts
        } else if (
          inputDiff.kind === "voluntary_modify" ||
          inputDiff.kind === "voluntary_add" ||
          inputDiff.kind === "bridge_recommended"
        ) {
          if (serverAumUsd > 0) {
            serverSizeUsd = (inputDiff.percent_allocated * serverAumUsd) / 100;
            sizeSource = "server_aum";
          } else if (!holdingsLookupOk) {
            sizeSource = "lookup_failed";
          } else if (holdingsEmptyOk) {
            sizeSource = "no_holdings_snapshot";
          }
        }
```

```ts
            // NEW-C18-04: server-recomputed authoritative figure.
            // Pre-fix this was the unverified client number; a malicious
            // allocator could inflate or deflate it without bound. Now
            // the `_size_source` sentinel below distinguishes six states:
            //   server_holding        — voluntary_remove uses holdings.value_usd
            //   server_aum            — other arms recompute pct × total_aum
            //   ref_not_found         — voluntary_remove's holding_ref absent
            //                           from a non-empty holdings map
            //   no_holdings_snapshot  — lookup ran, returned zero rows
            //   lookup_failed         — allocator_holdings SELECT errored
            //   client_unverified     — no inputDiff (shouldn't happen)
            size_at_decision_usd: serverSizeUsd,
            size_at_decision_usd_client: inputDiff.size_at_decision_usd,
            _size_source: sizeSource,
```
A new sentinel = **three coordinated edits**: the union type at `:830-834`, a new branch in the `if/else` chain, and the enumeration comment at `:890-897` (which the code calls "six states" — that literal count must be updated or it becomes a lie).

⚠️ **Research correction to assumption A7:** `src/app/api/allocator/scenario/commit/route.test.ts` **does exist** (1,613 lines). The `manual_aum_usd` test is an EXTENSION, not a new file. Its zod-validation analog is `:321-353`:

```ts
describe("zod validation", () => {
  it("T_R2: rejects empty diffs array with 400", async () => { ... });
  it("T_R3: rejects > 50 diffs with 400 (DoS cap)", async () => { ... });
  it("T_R15: rejects malformed holding_ref with 400", async () => { ... });
```
The file's mock stack (`:34-198`) — `vi.mock("server-only")`, `@/lib/supabase/admin`, `@/lib/api/withAllocatorAuth`, `@/lib/ratelimit`, `@/lib/audit`, `@/lib/sentry-capture` — is the required boilerplate for any new case there.

---

### `src/lib/queries.my-allocation.test.ts` (test)

**Analog:** same file `:525` — `it("Phase 37: !portfolio branch exposes the per-key channel with empty/false defaults", …)`. This is the precedent that a new payload field gets a **`!portfolio`-branch defaults test**, which is precisely the RESEARCH Pattern-7 "both branches" checklist item.

---

## Shared Patterns

### Cross-language single-source discipline
**Source:** `analytics-service/services/closed_sets.py:1-41` (module docstring) and `src/lib/closed-sets.ts:44-55`
**Apply to:** any new venue set, venue label, or copy constant

```python
"""Single source of truth for the analytics-service closed sets.
...The TypeScript half lives in ``src/lib/closed-sets.ts`` (B8a). This module
exists so a closed set / composite-key derivation cannot be silently
re-widened or hand-copied across the analytics worker...
It imports nothing from the rest of ``services`` so it can be a leaf in the
import graph (no cycles): every consumer imports FROM here, never the reverse.
"""
```

```ts
/**
 * Lowercase code → display label. The `satisfies Record<SupportedExchange,…>`
 * makes a missing label a COMPILE error, so a new exchange code physically
 * cannot ship without a display label.
 */
export const EXCHANGE_DISPLAY = { binance: "Binance", okx: "OKX", bybit: "Bybit",
  deribit: "Deribit", sfox: "sFOX", mt5: "MT5",
} as const satisfies Record<SupportedExchange, string>;
```

### Fail-closed, read-per-call kill switch
**Source:** `analytics-service/services/closed_sets.py:66-68`, `:107-109`
**Apply to:** the MT5 holdings branch (and the sFOX branch)

```python
def mt5_enabled_server() -> bool:
    """True iff MT5_ENABLED is set to "true" (fail-closed; see module note)."""
    return (os.getenv("MT5_ENABLED") or "").strip().lower() == "true"
```
Read **per call**, never a module-load const, so a go-live env flip needs no reimport.

### The em-dash / never-a-fabricated-zero contract
**Source:** `src/lib/dollar-validation.ts:41-53`
**Apply to:** every new money render (AUM display, per-strategy dollar cell)

```ts
/**
 * Whole-dollar USD rendering for the allocations surface.
 * `null` renders the em-dash, never `$0` (no-invented-data).
 */
export function formatUsd(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}
```

### The dollar bound
**Source:** `src/lib/dollar-validation.ts:21-39`
**Apply to:** the AUM input (client) and `manual_aum_usd` (server)

```ts
/**
 * The AUM / max-capacity dollar bound: a finite number in [0, 1e12).
 * ... The contract: client must send a finite number in [0, 1e12), or omit
 * the field (null / undefined) entirely.
 *
 * NOTE the cap split (closed-sets.ts:538-541): this is
 * `MAX_DOLLAR_VALUE_USD` ($1e12), the AUM/capacity bound. The allocation
 * TICKET cap is the distinct `MAX_TICKET_SIZE_USD` ($1e9) — do not conflate.
 */
export const isValidDollar = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 &&
  v < MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD;
```
Server-side usage precedent (`src/app/api/strategies/finalize-wizard/route.ts:420,442`):

```ts
  if (!isOmitted(aum) && !isValidDollar(aum)) { /* 400 */ }
  const aumNum = isValidDollar(aum) ? aum : null;
```

### Worker-written copy is END-USER copy (pass-through render)
**Source:** `src/components/exchanges/AllocatorSyncStatus.tsx:252-253`, `:270-277` — **no edit needed**
**Apply to:** every string the Python holdings path can put in `sync_error`

```tsx
  } else if (normalized === "error" || normalized === "complete_with_warnings") {
    helperText = syncError ?? "";
  }
```
```tsx
      <div role="status" aria-live="polite" data-testid="allocator-sync-helper"
           className="text-xs text-text-muted mt-1">
        {helperText ? <span>{helperText}</span> : null}
      </div>
```
There is no sanitization layer between the DB column and the DOM. The Python-side copy IS the product copy.

### Additive payload / additive draft field, never a version bump
**Source:** `queries.ts:3797-3801` + `:4217-4225` (payload), `scenario-state.ts:126-135` + `:865-874` (draft)
**Apply to:** `bookEntryGateSatisfied`, `contributingApiKeyIds`, `allocatorEligibleApiKeyIds`, `manualAumUsd`, `manual_aum_usd`
Rule set: optional/additive → declared in the zod object (or it is silently stripped) → **no `.refine()` on a range** → sanitize on read → present on **both** return branches.

### Sequential-worker safety for blocking IPC
**Source:** `job_worker.py:3547-3552` + `:332-352`
**Apply to:** the MT5 holdings read

`async with _mt5_terminal_lock_for(terminal_key)` → `await asyncio.wait_for(asyncio.to_thread(sync_closure), timeout=...)` → `except asyncio.TimeoutError` → bounded restart → `error_kind="transient"`. Never a bare blocking call on the shared loop (v1.11 WEDGE-01 class).

---

## No Analog Found

| File / element | Role | Data Flow | Reason |
|---|---|---|---|
| The AUM input + per-strategy **dollar** input control | component | event-driven | There is **no money-typing input anywhere in `src/`**. `formatUsd` has only display consumers (`HoldingsTable.tsx:434,623,624,905`; `MarkOwnershipDialog.tsx:152`) and `isValidDollar` has only server consumers (`finalize-wizard/route.ts:420-443`). Nearest partial match is the composer's own `type="number"` recipe (§Analog G above), which is a *fraction* input (step 0.001, max 1) and carries no currency formatting, no thousands separators, and no `$` affordance. The planner must compose: `type="number"` + `sr-only` label + blank-≠-zero `raw.trim() !== ""` guard (`:5467-5477`) + `isValidDollar` at the boundary + `formatUsd` for any read-only echo. Treat DESIGN.md / 151-UI-SPEC as the authority for the visual, not an existing component. |
| Python venue **display-label** map | config | — | `EXCHANGE_DISPLAY` exists only in TypeScript (`src/lib/closed-sets.ts:48`). RESEARCH §Code-Example-D asserts a Python mirror in `services/closed_sets.py` — **there is none** (whole file read this session). Either hardcode `"MT5"` / `"sFOX"` in the copy constants or mint the map under `closed_sets.py`'s single-source rule. |

---

## Conflicts & Corrections Surfaced

1. **RESEARCH A7 is wrong** — `src/app/api/allocator/scenario/commit/route.test.ts` exists (1,613 lines) with a `describe("zod validation")` block at `:321`. The `manual_aum_usd` test extends it.
2. **RESEARCH §Code-Example-D is wrong** about `EXCHANGE_DISPLAY` living in `services/closed_sets.py`. It does not exist there.
3. **RESEARCH §Code-Example-B's `hasattr` assertion is weak** against `AsyncMock`/`MagicMock` fakes (they synthesize any attribute). Use `spec=`-constrained mocks or plain stub classes so the `not hasattr(client, "fetch_balance")` half can actually fail.
4. **Two money formatters on one surface.** `ScenarioComposer.tsx` uses a local `formatCurrency` (`:5410`), while 150-UI-SPEC mandates `formatUsd` for new money on the allocations surface. Pick one and comment the choice; do not blend (Rule 7).
5. **`mt5_client.py:441-453` docstring names `job_worker._MT5_TERMINAL_LOCKS`.** If Pattern-2 option (a) moves the registry, that cross-reference must move in the same edit or it becomes a stale pointer to a deleted symbol.
6. **`allocator_positions.py:151` already uses `getattr(exchange, "id", …)` duck-typing.** CONTEXT bans that form for the NEW dispatch. The old Deribit line is out of scope, but the planner should not let the new code inherit the style by proximity — and should note the inconsistency rather than silently "fix" it (Rule 3).

---

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/tests/`, `src/lib/`, `src/app/(dashboard)/allocations/`, `src/app/api/allocator/scenario/commit/`, `src/components/exchanges/`, `src/components/strategy/`
**Files read this session:** 18 (5 full, 13 targeted non-overlapping ranges)
**Pattern extraction date:** 2026-08-07
