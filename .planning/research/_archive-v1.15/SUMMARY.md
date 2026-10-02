# v1.15 MetaTrader 5 — Research Summary

**Synthesized 2026-07-23** from STACK / FEATURES / ARCHITECTURE / PITFALLS (4 parallel researchers, all HIGH confidence bar Wine-ops MEDIUM). Overall verdict: **feasible, low-novelty except one infra piece.**

## The one-paragraph shape

v1.15 is the shipped **v1.12 sFOX "live read = `api_verified` ground truth" arc re-applied to MT5's forex/CFD world.** ~95% is a verbatim clone of the sFOX seam (`Source` Literal + `SUPPORTED_SOURCES` + `_FACTORIES` lockstep, fail-loud non-ccxt client/adapter, read-only `validate_key` branch, 3 key routes, exchange-CHECK constraint-widen migration, `derive_basis_series` backbone + `api_verified` stamp, flag-gated UI shipping OFF). The genuinely new problem: the official `MetaTrader5` PyPI package is **Windows-x86-64-only** and drives a locally-running `terminal64.exe`, so it cannot run in-process in our Linux Railway worker like ccxt/sFOX.

## Stack decision (resolves the Windows-on-Linux problem)

- Run the maintained **`gmag11/MetaTrader5-Docker` v2.3** — a **Linux** container (Wine + Windows-Python + MT5 terminal + **RPyC bridge :8001**, browser-VNC :3000 for one-time install/investor-login). Because it's Linux, it deploys on a cheap VPS / Fly / Railway — **no Windows host**. ~€4–6/mo (Hetzner/Contabo) or folded into existing spend.
- Worker connects as a **pure network client** via **`mt5linux` 1.0.3** (`MetaTrader5(host, port)`) → Windows dependency stays OUT of the worker process. `Mt5Client` becomes structurally identical to `SfoxClient` (non-ccxt, read-only, timeout-bounded).
- Versions (verify at build): `MetaTrader5` 5.0.5735, `mt5linux` 1.0.3, image v2.3.

## Architecture

- **New component = the MT5 gateway** (Wine container + thin HTTP/RPyC shim + Xvfb + watchdog) making MT5 look like a cloud REST API. Everything downstream stubs against its HTTP contract.
- **Data flow = Deribit-shaped, not sFOX-shaped:** MT5 has **no historical equity series**. Reconstruct daily NAV from the **deal ledger** (`history_deals_get` → `profit/swap/commission/fee`) + `DEAL_TYPE_BALANCE` deals as **external cash flows** + the `account_info().equity` anchor → a new `combine_mt5_deal_ledger` mirroring deribit's `combine_native_ledger` → the ONE backbone unchanged.
- **Credentials:** MT5 needs THREE fields (login / investor password / broker server) mapped onto the existing encrypted `{api_key, api_secret, passphrase}` slots.
- **Concurrency:** one terminal = one active login. v1 = **serialized login→read→logout loop on ONE terminal** (per-terminal lock, no pool), fine for a once-daily batch. Scale-out (portable-mode terminal pool sharded by broker) only if needed.

## Forex/CFD divergences from crypto (must respect)

- **Annualization = traditional √252, NOT crypto √365** (existing #597 asset-class system). `isCryptoExchange` must be narrowed to EXCLUDE `'mt5'`. Getting this wrong flips Sharpe/vol. (Also touches the DEFERRED "unknown→crypto" latent bug.)
- `swap`/`commission`/`fee` per deal = realized cashflows to fold in. Broker **server-time vs UTC** day-bucketing. lot→USD notional only needed for exposure widgets (P2) — returns derive from equity deltas, not lot volume.

## Top pitfalls (each → owning phase)

1. **Event-loop wedge (highest severity):** blocking sync IPC to a Wine terminal is a worse hang than the HTTP crawl behind WEDGE-01/PR#632 + the v1.11 FLIP rollback. → `asyncio.to_thread` + `asyncio.wait_for` at the derive seam + **terminal-restart-on-timeout** (a blocked pipe won't self-unblock).
2. **Read-only must be PROVEN:** investor password is server-enforced read-only (Guest Mode, `order_send` retcode 10027) BUT `login()` accepts a master password silently → structural (no `order_*` surface, sFOX isinstance guard) + validate-time `order_check` dry-run rejection. Never call `order_send`.
3. **Concurrency cross-bleed:** two syncs sharing a terminal swap global account state mid-read → `api_verified` on the wrong account. → per-terminal lock + `account_info().login == expected` bracket assertion pre+post.
4. `mt5.initialize()`/`login()` return `False` uninterpretable without `last_error()`; `history_deals_get` `None` (error) vs `()` (empty) must be distinguished or an error fabricates a flat account.

## Roadmap implications (proposed, continues from Phase 134)

Mirrors the sFOX 118–123 arc, 6 phases:
- **134 — Feasibility + client contract (SPIKE first):** the real unknowns — unattended Wine auto-login reliability (go/no-go), read-only proof mechanism (`order_check` investor-vs-master), deal-reconstruction viability, server-time offset. `Mt5Client` contract + offline test suite.
- **135 — Read adapter + validate/encrypt + 3 key routes + constraint-widen migration** (`'mt5'` Source lockstep).
- **136 — Equity reconstruction → backbone → `api_verified`** (`combine_mt5_deal_ledger`; owns the data-correctness pitfalls incl. √252). Risk-concentrated.
- **137 — Concurrency + terminal-lifecycle hardening** (wedge/cross-bleed/read-only-trust, version-pin). Risk-concentrated.
- **138 — Flag-gated add-key UI + `api_verified` badge + investor-password setup guide.**
- **139 — Founder-gated go-live ops** (stand up gateway, credential isolation, real-broker soak). Ships **flag-OFF** like the sFOX v1.12 Foundation close.

## Open questions → Phase-134 feasibility spike

- Can `MetaTrader5` auto-login unattended under Wine reliably enough for a cron worker (vs needing `mt5linux`/rpyc)? **Core go/no-go.**
- Does `order_check()` reliably distinguish investor vs master login without side effects across brokers?
- How far back does a fresh investor login warm deal history; do target brokers cap it?
- Gateway hosting: Fly (reuse sFOX ops muscle) vs Railway (co-locate) — founder ops call.
- Broker re-login throttling — unknown until exercised live.
