# Feature Research

**Domain:** MetaTrader 5 live `api_verified` account sync for an allocator/manager quant-strategy platform (forex/CFD track records)
**Researched:** 2026-07-23
**Confidence:** HIGH (MT5 Python API + investor-password semantics verified against MQL5 docs + broker docs; platform-mechanic mapping verified against PROJECT.md + memory ledger; the sFOX arc is a proven, shipped template)

> Scope note: this file covers ONLY the NEW user-facing capabilities for connecting +
> reading a LIVE MT5 account. The connect-a-key wizard, per-key read-only validation,
> `api_verified`/`self_reported` provenance tiers, the dailies-canonical backbone, the
> institutional factsheet (cash/MTM/smoothed bases), asset-class annualization, and the
> legacy MT5 Expert-Advisor push already exist and are NOT re-researched here — they are
> the substrate this milestone plugs into. The founder has already decided the read path
> (self-hosted MT5 terminal + official `MetaTrader5` Python package, read-only investor
> login) and the scope (live account sync, not statement/report ingest).

## Feature Landscape

### Table Stakes (Users Expect These)

Features an allocator/manager assumes exist. Missing these = the MT5 integration feels broken or untrustworthy. These mirror what sFOX already delivers, re-expressed for MT5's forex/CFD world.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Connect via **login + investor (read-only) password + broker server** | This is the entire MT5 credential triple — there is no API-key/secret model; the server name (e.g. `ICMarketsSC-MT5`) is a mandatory third field the crypto wizard never had | MEDIUM | New wizard branch: three fields, not key/secret. `server` is a broker-published string the user must supply. Validate all three or fail loud with `KEY_AUTH_FAILED`. |
| **Live connection / validation state** (connected, auth-failed, server-unreachable, syncing) | Same state affordance the ccxt/sFOX keys show; MT5 adds a distinct "terminal busy / login-in-flight" state because one terminal serves one login at a time | MEDIUM | Validation is a real terminal login (`mt5.login`) + `mt5.account_info()` non-null probe, not a static credential check. Surface honest error taxonomy. |
| **`api_verified` factsheet from real deal history + equity** | The whole point of the milestone — the factsheet must be reconstructed from `history_deals_get` (profit/commission/swap/fee per deal) + `account_info().equity`, stamped `api_verified` | HIGH | `Mt5Adapter` reconstructs daily equity → daily returns → the ONE `derive_basis_series` backbone. Balance-type deals (`DEAL_TYPE_BALANCE`) are the external deposit/withdrawal cashflows the flow-aware TWR path already expects. |
| **Server-enforced read-only guarantee** | Allocators are handing over live-account credentials; they must be certain nothing can trade | LOW (stronger than sFOX by construction) | The investor password puts the terminal in server-side "Guest Mode": New Order / Close / Withdraw are disabled **by the broker server**, not by our code. This is a *stronger* read-only guarantee than sFOX's structural "no write surface" assertion — surface it as such in the setup guide. |
| **Read-only setup guide** ("how to get your investor password") | Non-obvious step: the user must generate the *investor* (not master) password in their broker/terminal, and know their server name | LOW | Mirror the sFOX read-only guide. Emphasize: never enter the master password; the investor password cannot place, modify, or close orders. |
| **Correct forex/CFD asset-class annualization (√252 traditional, NOT crypto √365)** | An FX/CFD strategy trades a 5-day week; annualizing risk on 365 or CAGR on the wrong clock mis-states Sharpe/Calmar vs a crypto strategy | MEDIUM | The platform ALREADY has the asset-class annualization split (#597: crypto √365 / traditional √252; RISK=frequency, RETURN/CAGR=calendar). MT5 instruments must resolve to a **traditional** asset class so risk annualizes √252. This is wiring an existing system, not building one. |
| **Lot → USD notional conversion** | MT5 volume is in lots, not base-currency units; 1.0 lot ≠ a fixed notional (contract size varies per symbol AND per broker) | MEDIUM | Notional = `volume × contract_size × price`, with `contract_size` from `symbol_info()` (100,000 for standard FX, but CFDs/indices differ per broker). Needed for exposure/leverage; NOT needed for pure daily-return reconstruction if equity is read directly. |
| **Swap/rollover + commission as cashflows** | Overnight swap and per-trade commission are real P&L the equity curve already reflects; they must not be double-counted or dropped | MEDIUM | `history_deals_get` exposes `swap`, `commission`, `fee` per deal. Because we reconstruct from realized deal P&L + equity, these fold in naturally — but the reconstruction must include them and classify balance-type entries as external flows, not trading P&L. |
| **`mt5` as a first-class `Source`** (Literal + `SUPPORTED_SOURCES` + `_FACTORIES` lockstep) | Every existing chokepoint (worker validate/encrypt, 3 Vercel key routes, DB CHECK constraints) must admit `'mt5'` or the key silently fails downstream | MEDIUM | Exact sFOX/deribit registry-widening pattern — `test_boundary_literals_parity` already pins the lockstep. Add a constraint-widening migration admitting `'mt5'` across the hardcoded exchange CHECKs. |
| **Flag-gated rollout, ships OFF** | Same de-risking discipline as sFOX — no user can connect until the founder flips it | LOW | `NEXT_PUBLIC_MT5_ENABLED` / `MT5_ENABLED`, empty = byte-identical, zero prod impact. |

### Differentiators (Competitive Advantage)

Features that make the MT5 integration meaningfully better than the status quo (the legacy EA) and than fabricatable track records. These are where the milestone earns its cost.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`api_verified` beats the submitter-fabricatable EA/CSV** | The legacy MT5 Expert-Advisor *push* is `self_reported` — the manager's own terminal computes and sends numbers, which a manager can fabricate or an EA can be doctored to inflate. A live *pull* from the real account via investor password is ground truth the submitter cannot forge | HIGH (core thesis) | This is the exact v1.12 founder thesis (live read = `api_verified` ground truth) applied to MT5. The trust tier IS the product. The EA path stays as a `self_reported` fallback; MT5-verified accounts rank in the higher trust tier. |
| **Ground-truth equity + deal history as the verification anchor** | The live read gives us the broker's own recorded deal-by-deal history AND the broker's own equity figure — two independent series that must reconcile. A fabricated CSV has neither | MEDIUM | Optional parity check: reconstructed terminal equity vs `account_info().equity` at the read boundary (mirrors sFOX's ground-truth parity check). Discrepancy = fail-loud DQ flag, never silent absorption. |
| **Broker-agnostic verified forex/CFD coverage** | MT5 is *the* retail/prop forex+CFD platform; one integration verifies track records across hundreds of brokers (each is just a different `server` string) without per-broker work | MEDIUM | Unlike broker-specific Manager APIs (see anti-features), the investor-password + terminal path is broker-agnostic by construction. One adapter, N brokers. |
| **Honest forex/CFD factsheet** (traditional-calendar metrics, swap/commission-inclusive returns) | A crypto-native factsheet applied to an FX book would silently mis-annualize and hide financing drag; getting the 5-day-week clock and financing cashflows right is a credibility signal to institutional allocators | MEDIUM | Leverages #597 asset-class system + the flow-aware backbone. The differentiator is *correctness institutional allocators will notice*, not a new panel. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem natural for an "MT5 integration" but are out of scope for a read-only verified-factsheet milestone. Documenting them prevents scope creep.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Live trading / order execution / copy-trading** | MT5 is a trading platform; "connect your account" invites "let me trade from here" | Violates the read-only guarantee that makes allocators trust the connection; the investor password *cannot* trade anyway (server-enforced Guest Mode); explodes liability and regulatory surface | Read-only verified factsheet ONLY. The investor-password design makes this a hard wall, not a policy. |
| **MT4 support** | Many legacy brokers/managers still run MT4; users will ask | MT4 has a different (unofficial, deprecated) Python integration; MetaQuotes ships an official `MetaTrader5` package but NOT an MT4 one. Supporting MT4 doubles the read-path infra for a sunsetting platform | MT5 only. If an MT4-only manager appears, the legacy EA/CSV `self_reported` path still accepts them. |
| **Broker-specific Manager / MT5 Gateway / Web API** | Prop firms and brokers expose richer server-side Manager APIs (real-time, multi-account) | Per-broker credentials, per-broker contracts, licensing/cost, and a bespoke integration per broker — the opposite of the broker-agnostic investor-password path the founder chose | Self-hosted terminal + investor password (founder decision 2026-07-23). One integration, all brokers. |
| **Real-time streaming / tick data / live P&L ticker** | "Live account" connotes real-time | The factsheet is a daily-return artifact; the dailies-canonical backbone is a daily batch, and one terminal serves one login serially. Real-time streaming fights the concurrency model and the backbone's daily grain for zero factsheet value | Periodic (daily/scheduled) batch sync through the existing worker, exactly like every other key. |
| **Statement / HTML-report / `.htm` history ingest** | MT5 exports rich account statements; parsing them looks easy | It is a `self_reported` artifact (the user exports and uploads it — fabricatable) and duplicates the CSV path; the founder explicitly scoped this milestone to *live account sync* | Live API pull only. Report ingest, if ever wanted, is just the existing CSV path. |
| **MetaApi.cloud or other hosted MT5 bridges** | Avoids self-hosting a Windows terminal | Third-party dependency in the credential path (allocator investor passwords transit a vendor), recurring cost, and the founder explicitly rejected it 2026-07-23 | Self-hosted terminal on our own Windows/Wine infra. |
| **Per-position / open-trade MTM true-up from MT5** | The factsheet has an MTM basis; MT5 exposes open positions | Historical open-position marks are not reliably retrievable per-broker on a read-only login; chasing per-day open-MTM true-up is the same MEDIUM-confidence rabbit hole flagged for crypto in v1.8. Reconstruct on a realized/equity basis, flag material uPnL wedges, don't fabricate | Realized-basis reconstruction + `account_info().equity` for current NAV; raise a DQ flag when the open-uPnL wedge is material (existing v1.8 pattern). |

## Feature Dependencies

```
[MT5 verified factsheet]
    └──requires──> [Mt5Adapter: deals+equity → daily returns]
                       └──requires──> [self-hosted MT5 terminal + MetaTrader5 pkg (Windows/Wine infra)]
                       └──requires──> [derive_basis_series backbone (EXISTS)]
                       └──requires──> [asset-class annualization √252 (EXISTS, #597)]
                       └──requires──> [flow-aware TWR: balance-deals as external flows (EXISTS, v1.8)]

[mt5 add-key wizard branch (login/investor-pw/server)]
    └──requires──> [mt5 as first-class Source: Literal+SUPPORTED_SOURCES+_FACTORIES lockstep]
                       └──requires──> [worker validate_key read-only branch]
                       └──requires──> [3 Vercel key routes accept 'mt5']
                       └──requires──> [DB CHECK-constraint widen migration admitting 'mt5']

[api_verified badge on MT5 factsheet]
    └──requires──> [Phase-111 provenance tiers (EXISTS)]

[everything] ──gated-by──> [NEXT_PUBLIC_MT5_ENABLED / MT5_ENABLED flags (ships OFF)]

[ground-truth parity check] ──enhances──> [MT5 verified factsheet]
[lot→USD notional] ──enhances──> [exposure/leverage widgets]  (NOT required for daily-return reconstruction)

[live trading] ──conflicts──> [read-only guarantee]  (mutually exclusive by design)
[real-time streaming] ──conflicts──> [one-terminal-one-login concurrency + daily backbone grain]
```

### Dependency Notes

- **Verified factsheet requires the self-hosted terminal infra:** the `MetaTrader5` package is Windows-only and talks to a *locally running, logged-in* terminal. Our Linux worker cannot host it — this is genuinely NEW infra (Windows/Wine host) the sFOX arc did not need. One terminal serves one login serially, so the sync is a queued, one-at-a-time operation, not a fan-out. This is the milestone's principal net-new risk.
- **The add-key branch requires the Source-registry lockstep FIRST:** exactly as `test_boundary_literals_parity` pins for sfox/deribit — Literal, `SUPPORTED_SOURCES`, and `_FACTORIES` must admit `'mt5'` together, or `get_adapter` and the key chokepoints silently diverge. The DB constraint-widen migration is a hard prerequisite for any `'mt5'` key row to persist.
- **Verified factsheet reuses the EXISTING backbone/annualization/flow machinery — it does not rebuild them:** the differentiator is correct *wiring* of MT5's forex/CFD semantics into systems that already exist (dailies-canonical `derive_basis_series`, #597 asset-class split, v1.8 flow-aware TWR with balance-deals as external flows). The novel adapter work is equity reconstruction from `history_deals_get` + `account_info`.
- **Lot→USD notional enhances but does not block the factsheet:** daily returns can be reconstructed from equity/realized-P&L without ever converting lots to notional. Notional (`volume × contract_size × price`, contract_size per `symbol_info`) is only needed for exposure/leverage widgets — so it can be a later phase, not a launch blocker.
- **Read-only guarantee and live trading are mutually exclusive by construction:** the investor password physically cannot trade (server Guest Mode). This is a feature, not a limitation — it makes the anti-feature un-buildable.

## MVP Definition

### Launch With (v1.15 core — the sFOX arc for MT5)

Minimum to let an allocator connect a live MT5 account and get a verified factsheet.

- [ ] **`mt5` first-class Source** (Literal + `SUPPORTED_SOURCES` + `_FACTORIES` lockstep) — every chokepoint must admit it or the key dies silently
- [ ] **DB constraint-widen migration** admitting `'mt5'` across the hardcoded exchange CHECKs — prerequisite for persistence
- [ ] **Self-hosted MT5 terminal + `MetaTrader5` pkg infra** (Windows/Wine) — the read path physically requires it; net-new
- [ ] **Worker `validate_key` read-only branch** (real `mt5.login` + `account_info()` probe, honest error taxonomy) — proves the credential triple before storing
- [ ] **`Mt5Adapter`**: `history_deals_get` + `account_info().equity` → daily equity → daily returns → `derive_basis_series` with `api_verified` stamp — the core value
- [ ] **Forex/CFD asset-class wiring**: MT5 instruments resolve to a traditional asset class so risk annualizes √252 (#597) and swap/commission fold in as realized P&L, balance-deals as external flows — correctness
- [ ] **Flag-gated add-key wizard branch** (login/investor-pw/server) + `api_verified` badge + read-only setup guide, ships OFF (`NEXT_PUBLIC_MT5_ENABLED`) — the user surface
- [ ] **e2e across all roles** asserting the `api_verified` badge renders on an MT5 factsheet — the acceptance gate

### Add After Validation (v1.x)

- [ ] **Ground-truth parity check** (reconstructed equity vs `account_info().equity`, fail-loud on material wedge) — add once the base reconstruction is trusted; mirrors sFOX
- [ ] **Lot→USD notional + exposure/leverage widgets on MT5 books** — add when an allocator wants exposure breakdowns; needs per-symbol `contract_size`
- [ ] **Multi-account / multi-terminal concurrency** (terminal pool) — add only if the one-terminal serial sync becomes a throughput bottleneck

### Future Consideration (v2+)

- [ ] **Per-day open-position MTM true-up from MT5** — defer; historical marks unreliable per-broker on read-only logins (same MEDIUM-confidence gate as crypto v1.8)
- [ ] **MT4 support** — defer indefinitely; sunsetting platform, no official Python package; legacy EA/CSV covers MT4 managers as `self_reported`

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `mt5` Source lockstep + DB constraint migration | HIGH | LOW | P1 |
| Self-hosted terminal + `MetaTrader5` infra | HIGH | HIGH | P1 |
| `Mt5Adapter` deals+equity → backbone (`api_verified`) | HIGH | HIGH | P1 |
| Worker read-only `validate_key` branch | HIGH | MEDIUM | P1 |
| Forex/CFD asset-class annualization wiring (√252) | HIGH | MEDIUM | P1 |
| Flag-gated wizard + `api_verified` badge + setup guide | HIGH | MEDIUM | P1 |
| e2e all-roles badge assertion | MEDIUM | MEDIUM | P1 |
| Ground-truth equity parity check | MEDIUM | LOW | P2 |
| Lot→USD notional + exposure widgets | MEDIUM | MEDIUM | P2 |
| Multi-terminal concurrency pool | LOW | HIGH | P3 |
| Per-day open-position MTM true-up | LOW | HIGH | P3 |
| MT4 support | LOW | HIGH | P3 |

**Priority key:** P1 = must have for launch · P2 = should have, add when possible · P3 = future consideration

## Competitor Feature Analysis

Framed against how MT5 track-record verification is typically done, and against the platform's own prior art.

| Feature | Legacy EA push (our own prior art) | Broker Manager / MetaApi.cloud | Our Approach (v1.15) |
|---------|-----------------------------------|-------------------------------|----------------------|
| Trust tier | `self_reported` (manager's terminal computes + pushes → fabricatable) | `api_verified` but per-broker or via 3rd-party bridge | `api_verified` via self-hosted terminal + investor password — ground truth, broker-agnostic |
| Read-only guarantee | EA runs in the manager's terminal (manager controls it) | Varies; Manager APIs often carry write scopes | Server-enforced Guest Mode — physically cannot trade |
| Broker coverage | Any (manager installs EA) | Per-broker integration or vendor-dependent | Broker-agnostic (server = a string), no per-broker work |
| Forex/CFD metrics correctness | Depends on EA author | N/A (raw data) | √252 traditional annualization + swap/commission cashflows via existing #597 + backbone |
| Infra cost/complexity | Low (manager-hosted) | Recurring vendor cost / licensing | One self-hosted Windows/Wine terminal; serial sync |
| Real-time | EA can stream | Yes | No — daily batch, matches the factsheet grain |

## Sources

- [MQL5 docs — `history_deals_get` / Python integration](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py) — deal fields: profit, commission, swap, fee, volume, price, type, entry, symbol; balance-type deals (HIGH)
- [MQL5 docs — `account_info` / Python integration](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py) — balance, equity, leverage, currency (HIGH)
- [Weltrade — What is investor password in MT4/5](https://support.weltrade.com/en/articles/11952849-what-is-investor-password-in-mt4-5) — read-only semantics (MEDIUM)
- [Can You Execute Trades with an Investor Password? (sarowarjahan.com)](https://www.sarowarjahan.com/can-you-trade-with-investor-password/) — server-enforced Guest Mode, New Order/Close/Withdraw disabled (MEDIUM)
- [FX Blue Trade Mirror user guide](https://api.fxblue.com/appstore/u21/internet-trade-mirror/user-guide) — contract-size variance across brokers for CFDs/indices (MEDIUM)
- [Integrating MetaTrader 5 API in Python — practical example (Medium)](https://medium.com/@ullasraj1998/integrating-metatrader-5-api-in-python-a-practical-example-3996524f1ea0) — terminal-coupled read path, login flow (LOW/MEDIUM)
- Quantalyze `.planning/PROJECT.md` (v1.15 milestone goal, founder read-path + scope decisions 2026-07-23; v1.12 sFOX arc; #597 asset-class annualization; v1.8 flow-aware TWR) — internal, authoritative for platform mechanics (HIGH)
- Quantalyze codebase — `services/ingestion` Source/`SUPPORTED_SOURCES`/`_FACTORIES` lockstep, `test_boundary_literals_parity`, `models/schemas.py` exchange Literal (HIGH)

---
*Feature research for: MT5 live `api_verified` account sync (forex/CFD verified factsheet)*
*Researched: 2026-07-23*
