# Pitfalls Research

**Domain:** Self-hosted headless MetaTrader 5 terminal + official `MetaTrader5` Python package as a LIVE read-only account-sync source, integrated into a Linux Python worker feeding the ONE `derive_basis_series` daily-returns backbone (v1.15, the sFOX arc applied to MT5's forex/CFD world).
**Researched:** 2026-07-23
**Confidence:** HIGH on MT5 package + investor-password behavior (verified: MQL5 docs + community + broker docs); HIGH on this platform's backbone/worker constraints (read from code); MEDIUM on Wine/container ops specifics (ecosystem-reported, not yet exercised here).

> **Phase map used below** (v1.15 continues numbering from **134**, mirroring the sFOX 118–123 arc):
> - **Phase 134** — Research + Windows/Wine headless MT5 terminal hosting infra + `MetaTrader5` client contract; the real unknown is *can we reconstruct daily equity from `history_deals_get` + `account_info`, auto-login unattended, and PROVE investor-password read-only*.
> - **Phase 135** — Read adapter (`history_deals_get`/`account_info`, read-only enforced STRUCTURALLY) + worker `validate_key`/`encrypt_key` `mt5` branch + all 3 Vercel key routes accept `mt5` + DB constraint-widening migration admitting `'mt5'`.
> - **Phase 136** — Equity reconstruction → daily returns → the ONE backbone with `api_verified` stamp; forex/CFD asset-class handling (√252 per #597, lot→USD notional, swap/commission/balance-op semantics) + ground-truth parity check.
> - **Phase 137** — Terminal lifecycle + concurrency hardening (one-terminal-one-login serialization, `asyncio.wait_for` wall-clock bounds, hang detection/recovery, version-pin/auto-update lock) + container isolation/cost.
> - **Phase 138** — Flag-gated add-key UI (`NEXT_PUBLIC_MT5_ENABLED`/`MT5_ENABLED`, ships OFF) + `api_verified` badge + read-only (investor password + broker server) setup guide + e2e all roles.
> - **Phase 139** — Go-live ops (founder-gated): credential KEK storage, broker-server storage, container/host provisioning, broker connection-limit soak.

---

## Critical Pitfalls

### Pitfall 1: `mt5.initialize()` / `login()` returns `False` and you never read `last_error()` — silent, uninterpretable failures

**What goes wrong:**
The `MetaTrader5` package signals almost every failure by returning `False` (or `None`) from `initialize()`, `login()`, `history_deals_get()`, and `account_info()`. If the adapter only checks truthiness, a broker-server-name typo, a stale terminal, an IPC timeout, a not-yet-logged-in terminal, and a genuinely empty account are all indistinguishable — the worker records "sync failed" or, worse, "0 deals → flat equity" with no cause. The confirmed IPC failure mode is `"IPC initialize failed, Pipe server didn't answer in 60 sec"`: the terminal process is up but the Python↔terminal named-pipe handshake never completes.

**Why it happens:**
Developers port cloud-API mental models (exceptions, HTTP status codes) onto a package whose entire error channel is `mt5.last_error()` → `(code, description)`, which you must call *immediately* after the failing call (the next call overwrites it). `history_deals_get()` returning `None` specifically means "call failed" whereas returning `()` (empty tuple) means "succeeded, zero deals" — conflating them fabricates a flat account out of an error.

**How to avoid:**
- Wrap every `MetaTrader5` call in a thin client that, on any falsy/`None` return, captures `mt5.last_error()` and raises a typed `Mt5Error(code, description)` — mirror the sFOX `SfoxApiError` fail-loud posture (`services/sfox_read.py`: "any leg raising propagates UNTOUCHED; no retry, no silent catch, no partial dict").
- Distinguish `None` (error → raise) from `()` (honest empty → the no-invented-data empty state) at the boundary, exactly as sFOX distinguishes an empty account from a failure.
- Map `last_error` codes to the platform's honest key-validation vocabulary: auth failures → `KEY_AUTH_FAILED` (mirroring sFOX 119-02), transient IPC/timeout → a classified transient (retryable), not a permanent fail.
- Set an explicit `timeout=` on `initialize()`/`login()` and treat the 60 s IPC pipe timeout as transient, not terminal.

**Warning signs:**
Syncs that "succeed" with suspiciously flat/zero equity; `history_deals_get` handling that does `if not deals:` (conflates error+empty); no `last_error()` call anywhere in the adapter; log lines that say "MT5 failed" with no code.

**Phase to address:** Phase 134 (client contract: typed errors + `None`-vs-`()` discipline), enforced at Phase 135 (validate branch → `KEY_AUTH_FAILED`).

---

### Pitfall 2: Headless auto-login flakiness on Wine — the Windows-only package "works on my machine" then wedges in the container

**What goes wrong:**
`MetaTrader5` is a **Windows-only** wheel. On the Linux worker it runs under Wine (community pattern: `mt5linux` = Wine + `rpyc` bridging a Windows Python to the Linux worker, or the terminal itself under Wine with the Python package talking to it over the pipe). Unattended auto-login is the fragile part: the terminal must already be running AND logged in before `initialize(login=..., password=..., server=...)` can attach; a cold terminal, a Wine display/`Xvfb` hiccup, a not-yet-warmed pipe, or a first-run "terms of use / server pick" dialog all make `initialize()` hang or return `False`. Community reports repeatedly note "manual login works, automated login fails" — a timing/IPC race the terminal hides behind a GUI you don't have.

**Why it happens:**
The package was designed for a human-attended Windows desktop with the terminal already open. Headless removes the human who dismisses dialogs, retries login, and confirms the server. Wine adds a second failure surface (missing `Xvfb`, wine-prefix drift, DLL/`vcrun` gaps) that produces the *same* opaque `False`.

**How to avoid:**
- Treat "terminal up AND logged in AND pipe answering" as an explicit, probed **readiness gate** before any read — a health probe (`account_info()` returns the expected login) with bounded retry/backoff, not an assumption. This is the direct analogue of the sFOX egress-IP "VERIFY egress IP == dedicated v4 before whitelisting" gate.
- Run the terminal under a supervised process (Xvfb + a supervisor that restarts a dead terminal) and pre-seed the wine prefix + terminal config (accepted terms, server list) at image-build time so first-run dialogs never appear at runtime.
- Pin ONE known-good terminal build inside the image (see Pitfall 4) and smoke-test auto-login in CI/build, not in prod.
- Budget the whole initialize→login→ready sequence under one `asyncio.wait_for` wall clock (see Pitfall 5) so a Wine hang becomes a classified transient, never a worker wedge.

**Warning signs:**
Login works when you `railway ssh` in and poke it but fails on the cron path; intermittent `IPC timeout`; failures that clear after a manual terminal restart; wine-prefix files mutating between deploys.

**Phase to address:** Phase 134 (prove unattended auto-login on Wine is feasible — this is a core feasibility unknown), hardened in Phase 137 (readiness gate + supervised restart), provisioned in Phase 139.

---

### Pitfall 3: Broker server-name mismatch — the silent auth failure that looks like a bad password

**What goes wrong:**
`login()`/`initialize()` requires the **exact** broker server string (e.g. `"ICMarketsSC-Demo"`, `"MetaQuotes-Demo"`), which is broker- and account-group-specific and NOT derivable from the login number. A wrong/renamed/near-miss server string returns the same opaque `False` as a wrong password, so users (and the adapter) misdiagnose it as bad credentials and rotate passwords fruitlessly.

**Why it happens:**
The server name is free-text the user copies from their broker; brokers run many named servers (Live1/Live2/Demo) and occasionally rename them; there's no discovery endpoint on a read-only login. Developers assume login+password is enough (it is for a cloud API; it is not for MT5).

**How to avoid:**
- Make **broker server a first-class, required credential field** alongside login + investor password in the connect UI and the encrypted key record — do not treat it as optional or infer it. (This is a new field the sFOX/exchange key shape doesn't have.)
- At `validate_key` time, on failure surface the *distinguishable* `last_error` so "invalid server" (a specific code) maps to a targeted UI message ("check your broker's server name") vs. `KEY_AUTH_FAILED`.
- In the setup guide, tell users exactly where to find the server string in their own terminal (Account properties) and that it is case- and suffix-sensitive.

**Warning signs:**
Users reporting "my password is right but it won't connect"; validate failures clustered by broker; a connect form that omits server or auto-guesses it.

**Phase to address:** Phase 135 (server as required credential + distinguishable validate error), Phase 138 (setup guide + UI field).

---

### Pitfall 4: Terminal auto-update / version drift silently breaks the pipe and the pinned build

**What goes wrong:**
The MT5 terminal auto-updates itself. A silent terminal update can (a) desync from the pinned `MetaTrader5` wheel version (the Python package and terminal build must be compatible), (b) re-introduce a first-run dialog, (c) change the pipe/IPC behavior, or (d) restart the terminal mid-sync. Any of these turns a green integration red weeks later with no code change — the classic "it worked, we didn't touch it, now it's down."

**Why it happens:**
Auto-update is on by default and is a *terminal* action, invisible to the Python layer and to your deploy pipeline. Nobody owns "the broker pushed a new terminal build."

**How to avoid:**
- **Disable terminal auto-update** in the pinned image (config + block the updater), and pin BOTH the terminal build and the `MetaTrader5` wheel version in the image; upgrades become a deliberate, tested image rebuild — the same discipline as `AGENTS.md`'s "read the deprecation notice before writing code" and the sFOX version-pin posture.
- Add a build-time (and startup) compatibility assertion: terminal build ↔ wheel version, fail-loud if drift.
- Since Railway/host redeploys can rotate infra (per the v1.13 egress-IP-rotation lesson), rebuild-and-redeploy is the update unit — never let the running terminal mutate itself.

**Warning signs:**
Terminal version string changing between deploys; sudden IPC timeouts after a quiet period; a terminal restart in supervisor logs you didn't trigger.

**Phase to address:** Phase 134 (pin in image), Phase 137 (compatibility assertion + auto-update lock), Phase 139 (image provisioning).

---

### Pitfall 5: A hanging terminal blocks the sequential worker's event loop — the exact v1.11 wedge, now with a Wine terminal as the new hang source

**What goes wrong:**
`MetaTrader5` calls are **synchronous, blocking C-extension/IPC calls** (or blocking `rpyc` round-trips). A slow or wedged terminal (Wine stall, pipe timeout, broker-side stall) blocks the calling thread. If that thread is the worker's asyncio event loop, the whole sequential worker freezes — the platform ALREADY hit this: `stitch_composite` heavy pandas on the shared loop froze `healthz` → Railway restarted the container mid-job (WEDGE-01, PR#632), and the v1.11 derived-curve FLIP was rolled back precisely because an unbounded exchange crawl wedged the sequential worker loop.

**Why it happens:**
Blocking native calls on the event loop is invisible until something is slow. MT5's synchronous API + a GUI-app-under-Wine backend is a *worse* hang source than an HTTP crawl (no socket timeout you control by default).

**How to avoid:**
- **Never call `MetaTrader5` on the event loop.** Run every MT5 call in a worker thread (`asyncio.to_thread` / executor) — the exact fix WEDGE-01 applied to pandas ("rescore in `to_thread`") — AND wrap it in `asyncio.wait_for` with a hard wall-clock budget, the seam already established for sFOX/deribit crawls (`sfox_read.py`: "the asyncio.wait_for wall-clock bound wraps at the derive_broker_dailies worker seam ... a hang there becomes a classified transient failure, never a wedge of the sequential worker loop").
- On `wait_for` timeout, classify as transient AND actively recover the terminal (kill/restart the terminal process — a blocked pipe won't unblock itself), then re-queue.
- Keep a hard per-sync request/time budget so a runaway history crawl truncates into a typed result instead of spinning (the `_SFOX_CRAWL_MAX_REQUESTS = 50` pattern).

**Warning signs:**
`healthz`/`/health` latency spikes during a sync; Railway restarts correlated with MT5 syncs; a single account's sync never returning; event-loop lag metrics climbing.

**Phase to address:** Phase 136/137 — the derive seam wiring (Phase 136) MUST run MT5 in a thread under `wait_for`; the hang-recovery/restart logic is Phase 137. This is the highest-severity, most platform-specific pitfall.

---

### Pitfall 6: One terminal = one account → cross-account data bleed and login/logout races

**What goes wrong:**
A single MT5 terminal instance holds **exactly one logged-in account** at a time. If two account syncs share one terminal, sync B's `login()` silently switches the terminal out from under sync A's in-flight `history_deals_get()`, so A reads B's deals — a catastrophic cross-tenant data-bleed that stamps `api_verified` on the *wrong* account's numbers. Even serial reuse has a race: the read must be bracketed by "this login is still the active one" between `login()` and the reads.

**Why it happens:**
The terminal's "current account" is global mutable process state; the Python package has no per-call account parameter. Concurrency-naïve code assumes each `login()` scopes its own reads. The worker runs multiple accounts.

**How to avoid:**
- Enforce **strict serialization**: a per-terminal async lock (or a one-container-per-account model, see Pitfall 12) so only one login→read→logout transaction touches a terminal at a time; never interleave.
- After `login()`, assert `account_info().login == expected_login` immediately before AND after the read block, and fail-loud on mismatch (structural cross-account guard — the same "prove it's the account you think" rigor as sFOX's isinstance read-only guard).
- Prefer **one terminal per account** (isolated container/instance) if concurrency is needed at all — trading correctness beats density. Weigh against cost (Pitfall 12).
- Make the sync unit idempotent and account-scoped end-to-end (key_id carried through), so a misroute is detectable, not silently persisted.

**Warning signs:**
Two accounts producing suspiciously identical deal sets; equity curves swapping between accounts; any code path that `login()`s without holding an exclusive terminal lock; concurrent-sync tests absent.

**Phase to address:** Phase 137 (serialization + `account_info().login` bracket guard + terminal-per-account decision). Add a regression test that fails if two concurrent syncs can share a terminal.

---

### Pitfall 7: Read-only enforcement is asserted structurally but never PROVEN — a full-access password silently grants trade capability

**What goes wrong:**
The whole `api_verified` value prop is trust; connecting a manager's account must be provably incapable of trading. Two failure modes: (a) the adapter *claims* read-only but nothing prevents a caller from issuing `order_send` through the same terminal session; (b) a user pastes their **master (full-access) password** instead of the investor password — the terminal logs in with full trade rights, and nothing warns them or the platform. Storing a full-access credential is both a trust breach and a liability.

**Why it happens:**
MT5's read-only guarantee is **server-side, tied to the investor password** (verified: investor password = "Guest Mode", the server disables New Order/Close/Withdraw, `order_send` fails with a retcode like 10027 "trade disabled/read-only"). But the login call takes any password; the terminal doesn't tell *you* which kind it is up front — it only refuses trades at order time. So structural read-only requires you to (1) never expose a write surface AND (2) actively detect a full-access login.

**How to avoid:**
- **Structural, like sFOX:** the `Mt5Client` composes ONLY read methods (`account_info`, `history_deals_get`, `positions_get`) — NO `order_send`/`order_check` write surface, with an ingestion-boundary guard mirroring `sfox_read.py`'s isinstance assertion ("a future caller cannot smuggle a write-capable object through here").
- **Prove the credential is investor-only at validate time (fail loud on full-access):** after login, probe trade-capability read-only — e.g. `account_info().trade_allowed` and/or an `order_check()` dry-run (which never sends an order) whose "allowed" result indicates a full-access login → REJECT with a specific "this looks like a full-access password; paste your INVESTOR (read-only) password" error. Do NOT call `order_send`. This is the MT5 analogue of "read-only STRUCTURAL + honest `KEY_AUTH_FAILED`."
- Setup guide walks the user through creating/using the investor password only.

**Warning signs:**
`account_info().trade_allowed == True` on a connected account; no validate-time capability probe; any `order_*` symbol imported in the adapter; a setup guide that doesn't explicitly say "investor password."

**Phase to address:** Phase 134 (design the capability probe + confirm investor-password server behavior), Phase 135 (structural no-write surface + validate-time full-access rejection). This is a trust-critical gate — treat like the sFOX read-only assertion.

---

### Pitfall 8: `history_deals_get` misread — balance ops, partial fills, and swaps/commissions-as-separate-deals corrupt equity reconstruction

**What goes wrong:**
`history_deals_get` returns *deals* (executions + non-trade ledger events), not a clean PnL series. Mistakes that corrupt the daily returns:
- **Balance operations counted as trading PnL:** deposits/withdrawals appear as `DEAL_TYPE_BALANCE` (and credit/charge/correction types), with the amount in `profit`. If summed into trading PnL, a deposit reads as a huge winning "trade" — inflating returns and Sharpe. These are **external flows** (like the sFOX/deribit external-flow handling), not returns.
- **Partial fills:** one order can produce multiple deals; naïvely counting deals ≠ trades.
- **Swap & commission:** depending on broker, swaps and commissions arrive as `commission`/`swap`/`fee` fields on the deal OR as *separate* deals. Miss them and net PnL is overstated; double-count them and it's understated.
- **`DEAL_ENTRY_IN/OUT/INOUT`:** realized PnL lands on the closing (`OUT`) deal; summing `profit` across all entries without regard to entry type mis-times PnL.

**Why it happens:**
Developers treat `history_deals_get` like a trade blotter. MT5's deal model mixes ledger and execution events; broker conventions for swap/commission vary. This platform already hit the analogous class: the deribit `correction` txn-type fail-loud (unhandled ledger type) and the "balance ops vs trades" classification work.

**How to avoid:**
- Classify each deal by `type` FIRST: `DEAL_TYPE_BALANCE`/credit/charge/correction → **external flow** (feeds the flow-aware valuation, NOT returns); `DEAL_TYPE_BUY/SELL` → trading. Reuse the platform's external-flow machinery (`services/external_flows.py`, `USD_FAMILY`/`ExternalFlow`) that sFOX already feeds.
- Compute realized trading PnL as `profit + commission + swap + fee` per deal, summed over the day — never re-add commission/swap if the broker already emits them as separate `DEAL_TYPE_*` rows (detect the broker's convention explicitly; fail-loud on an unclassifiable deal type, per the deribit-`correction` lesson: unknown → fail, don't guess).
- Group by `position_id`/`order` to handle partial fills; key realized PnL off `DEAL_ENTRY_OUT`.

**Warning signs:**
A deposit day showing a giant return spike; Sharpe implausibly high; net PnL that doesn't reconcile to `account_info().balance`; an unhandled deal `type` silently dropped (repeat of the deribit `correction` blocker).

**Phase to address:** Phase 136 (equity reconstruction — classification + flow separation + swap/commission convention), verified by the ground-truth parity check.

---

### Pitfall 9: Timezone — MT5 server time (broker UTC+2/+3, DST-shifting) mislabels daily buckets vs UTC

**What goes wrong:**
`history_deals_get(datetime_from, datetime_to)` and all MT5 timestamps are in the **broker server's timezone** (commonly UTC+2/UTC+3 "trade server time", often with DST), while the package's `datetime` handling treats naïve datetimes as **UTC** for the *request* — a well-documented trap. Two bugs: (a) your query window is offset by 2–3 h, silently dropping or double-including deals at the day boundary; (b) you bucket deals into the wrong calendar day, so a Friday-evening trade lands on Saturday, corrupting daily returns and any day-count annualization.

**Why it happens:**
There's no single canonical timezone: request datetimes are interpreted as UTC, but returned `time`/`time_msc` are server-time epoch. Brokers rarely run true UTC; DST makes the offset non-constant. This is one of the most reported MT5-Python gotchas.

**How to avoid:**
- Establish the broker's server-time offset explicitly at Phase 134 (e.g. compare a known deal's `time` against a symbol's server tick, or read it from the terminal), store it per broker/account, and normalize ALL deal timestamps to UTC before day-bucketing — a single conversion seam.
- Bucket daily returns on a fixed, documented UTC (or explicit trade-day) boundary consistent with the backbone's convention; never mix server-time and UTC in the same series.
- Pad query windows by ±1 day and de-dupe by `ticket` to avoid boundary drops.

**Warning signs:**
Deals near midnight landing on the wrong day; daily-return count off-by-one vs. calendar; equity steps appearing a day early/late vs the broker statement.

**Phase to address:** Phase 134 (establish + store the offset), Phase 136 (single normalize-to-UTC seam before bucketing).

---

### Pitfall 10: No historical equity snapshot → reconstruct-from-deals wedge (open-position floating PnL is NOT in deal history)

**What goes wrong:**
MT5 gives you *current* `account_info().equity/balance` but **no historical equity time series**. You must reconstruct daily equity from starting balance + cumulative realized deals + flows. The wedge: **open-position floating (unrealized) PnL is not in `history_deals_get`** — it only materializes as realized PnL on the closing `OUT` deal. So a backward roll of realized-only PnL drifts from the mark-to-market anchor by the running unrealized wedge — the EXACT `unrealized_pnl_in_anchor` problem the platform already solved for the anchor-to-today reconstruction (v1.8 TWR decision).

**Why it happens:**
Deal history is a realized-execution ledger; equity is realized balance + floating PnL of open positions. Any reconstruction that ignores open positions silently understates/overstates intra-window equity whenever positions straddle a day boundary.

**How to avoid:**
- Reuse the v1.8 flow-aware realized-basis reconstruction verbatim: reconstruct on a realized-basis terminal NAV, re-add current floating PnL only to the *reported current* NAV, and **raise a fail-loud DQ flag (`complete_with_warnings`) when the open-position wedge is material** — never silently absorb it.
- `positions_get()` gives *current* open positions only (not historical), so a per-day floating-PnL true-up is generally NOT retrievable read-only — accept the realized-basis default (the same MEDIUM-confidence conclusion v1.8 reached for exchanges) rather than fabricating historical marks (no-invented-data).
- Reconcile the reconstructed terminal NAV to live `account_info().balance` as the ground-truth parity check (the sFOX "ground-truth parity" gate).

**Warning signs:**
Reconstructed equity not tying out to `account_info().balance`; a smooth realized curve that ignores a large open position; no DQ warning surface for the uPnL wedge.

**Phase to address:** Phase 136 (equity reconstruction reuses the v1.8 realized-basis + DQ-flag machinery + ground-truth parity).

---

### Pitfall 11: Forex/CFD asset-class annualization wrong (√365 crypto vs √252 traditional) flips Sharpe/vol — and lot→USD notional errors

**What goes wrong:**
MT5 is forex/CFD — a **traditional 5-day-week** asset class. If the adapter inherits the crypto default (24/7, √365 risk annualization / calendar-365 return), forex Sharpe/volatility are **wrong**: annualizing a 252-trading-day series on √365 mis-scales vol and flips the Sharpe ranking — the platform explicitly protects against this (#597: crypto √365 / traditional √252; the v1.2.1 mutation-verified 365-rescale proof; two DEFERRED latent bugs in MEMORY about annualization understating vol on unknown-asset-class inputs). Separately, MT5 volumes are in **lots**, not USD; converting deals to a USD notional / return basis wrong (ignoring contract size, tick value, and quote-currency→USD conversion) corrupts the return magnitude.

**Why it happens:**
The backbone's crypto heritage makes √365 the path of least resistance; asset_class is easy to leave unset (→ the DEFERRED "unknown→crypto" bug). Lot economics (contract_size × tick_value, JPY/other quote-ccy conversion) are forex-specific and unfamiliar to a crypto-first codebase.

**How to avoid:**
- Stamp MT5 keys with `asset_class = traditional` so RISK annualization uses **√252** and RETURN/CAGR uses the **calendar clock** per the v1.8 split-basis decision — and add a mutation test (like ANNUAL-02's) that FAILS if MT5 series get √365. Guard the "unknown asset_class → crypto" default so an MT5 leg never silently annualizes on 365 (closing the DEFERRED latent bug for this new source).
- Derive returns from **equity deltas**, not raw lot volume, so contract-size/notional errors can't enter the return series (equity is already in the account currency); handle account base currency ≠ USD explicitly if present.
- BLEND rule (#597): a scenario mixing an MT5 (traditional) leg with any crypto leg annualizes on 365 if ANY leg is crypto — verify MT5 legs don't break that.

**Warning signs:**
MT5 factsheet Sharpe/vol ~20% off vs. a hand-check; asset_class null on MT5 keys; a mixed scenario silently switching bases; returns scaling with lot size.

**Phase to address:** Phase 136 (asset_class stamp + √252 + calendar-return + lot/notional-free equity-delta returns + mutation test).

---

### Pitfall 12: Cost blowup + broker connection limits/bans from one-container-per-account at scale

**What goes wrong:**
The safe concurrency answer (Pitfall 6) is one terminal per account — but a Windows-Wine terminal container per account is heavy (RAM/CPU + a running GUI app under Xvfb). At N accounts this is a linear cost blowup on Railway/host, and spinning up many terminal→broker connections can trip **broker connection limits / anti-abuse bans** (a demo/investor login hammering reconnects looks like abuse; some brokers rate-limit or ban).

**Why it happens:**
Density instinct (one terminal, many accounts) is unsafe (Pitfall 6); safety instinct (one terminal per account) is expensive. Nobody models the cost/limit curve until the bill or the ban arrives.

**How to avoid:**
- Since Quantalyze is **pre-revenue with few accounts**, start with a small pool of terminals with strict serialization (the Pitfall 6 lock), NOT one-per-account — right-sized for current scale, explicitly documented as a scale-later decision (don't over-engineer per the template's guidance).
- Sync on a schedule (daily/hourly like the backbone), reuse a warm logged-in session where safe, and **rate-limit login/reconnect churn** to stay under broker thresholds; back off on broker-side rejects.
- Model the per-terminal cost and the broker's connection policy at Phase 139 before scaling the pool.

**Warning signs:**
Railway spend scaling linearly with account count; broker connection-refused/ban errors; reconnect storms in logs.

**Phase to address:** Phase 137 (pooled-serialized vs per-account decision + reconnect rate-limit), Phase 139 (cost/limit soak before scaling).

---

### Pitfall 13: Insecure credential + broker-server storage and weak terminal-container isolation

**What goes wrong:**
The investor password + login + broker server must be stored to re-sync. Investor is read-only, but it still exposes the account's positions/history — and if a user mistakenly supplies a master password (Pitfall 7), that's a trade-capable secret at rest. A terminal running third-party MT5 binaries under Wine is also a larger attack surface than an HTTP client; a container escape or a compromised terminal build could exfiltrate every connected account's credentials from process memory.

**Why it happens:**
Credentials-at-rest and container isolation are easy to under-scope when the "it's only read-only" framing lulls. MT5 terminals are opaque third-party binaries.

**How to avoid:**
- Store the investor password (+ server) **KEK-encrypted** exactly like the existing exchange keys (the `encrypt_key` path the sFOX/exchange keys use), never plaintext; store broker server as a first-class field.
- **Reject full-access passwords at validate time** (Pitfall 7) so a trade-capable secret is never persisted.
- Isolate the terminal container (least-privilege, no outbound except the broker, no shared secrets volume beyond the one account being synced in the per-account/serialized model); pin the terminal binary + verify its provenance; keep worker DB creds out of the terminal container's reach.
- Egress: MT5 broker connections go out through the worker's controlled egress (the Railway static-egress lesson) — know the outbound IPs.

**Warning signs:**
Plaintext credentials anywhere; a full-access password accepted by validate; the terminal container holding more than the one account's secret; unrestricted outbound from the terminal container.

**Phase to address:** Phase 135 (KEK encrypt on the `mt5` key path + full-access rejection), Phase 139 (container isolation + binary provenance + egress).

---

### Pitfall 14: Missing-history windows read as flat/zero equity instead of honest absence

**What goes wrong:**
`history_deals_get` only returns what the broker retains; brokers cap deal history (some to a limited window), and a fresh investor login may not immediately have full history warmed. A gap (no deals in a window) is indistinguishable from "flat account" unless handled — the adapter fabricates a flat/zero segment, violating no-invented-data and stamping `api_verified` on a hole.

**Why it happens:**
Empty `()` from `history_deals_get` is ambiguous (Pitfall 1); brokers silently truncate old history; the sync assumes inception-to-now availability.

**How to avoid:**
- Crawl history in **bounded windows** (the `_SFOX_CRAWL_MAX_REQUESTS`-style budget) back to the earliest returned deal, and treat the earliest-available deal as the honest start — never backfill zeros before it.
- Render missing/partial windows as the honest empty/coverage-masked state (the platform's coverage-window model + no-invented-data invariant), and surface a coverage caption (like the scenario coverage-window work), not a fabricated flat line.
- Reconcile realized-deal-derived balance to `account_info().balance`; a mismatch signals truncated history → warn, don't fill.

**Warning signs:**
Flat equity before a certain date across many accounts; reconstructed opening balance ≠ broker statement; no coverage/absence surface for gaps.

**Phase to address:** Phase 136 (bounded history crawl + honest coverage/absence + balance reconciliation).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| One shared terminal for all accounts, no lock | Cheapest, simplest | Cross-account data bleed → `api_verified` on the wrong account's numbers (Pitfall 6) | **Never** — a trust-integrity violation, not a perf choice |
| Check truthiness only, skip `mt5.last_error()` | Less code | Uninterpretable failures; error vs empty conflated; fabricated flat equity | Never for a trust source |
| Assume UTC = server time | Ships faster | Off-by-2–3h day-bucket corruption of every daily return | Never — establish the offset in Phase 134 |
| Sum all deal `profit` as trading PnL | Trivial | Deposits read as huge returns; Sharpe inflated (Pitfall 8) | Never |
| One-container-per-account from day 1 | Maximally safe concurrency | Linear cost blowup + broker-ban risk at scale (Pitfall 12) | Deferred: pooled+serialized is right-sized for pre-revenue scale |
| Leave terminal auto-update on | Zero ops | Silent version drift breaks the pipe weeks later (Pitfall 4) | Never in the prod image |
| Accept any password, rely on order-time refusal | No validate probe needed | Full-access secret persisted; no user warning (Pitfall 7) | Never — trust-critical |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `MetaTrader5` package | Treating it like a cross-platform cloud API | Windows-only wheel under Wine; synchronous blocking IPC; error channel is `last_error()`; run in a thread under `wait_for` |
| `initialize()`/`login()` | Assuming login+password is enough | Broker **server** string is required, exact, DST-sensitive; a wrong server looks like a bad password |
| `history_deals_get` | `if not deals:` conflating error+empty; summing all `profit` | `None`=error (raise), `()`=empty; classify `DEAL_TYPE_BALANCE`/credit/charge/correction as external flows, not returns |
| Timestamps | Bucketing on server time as if UTC | Establish + store the broker offset; normalize to UTC in one seam before day-bucketing |
| Equity | Expecting a historical equity endpoint | None exists; reconstruct from balance+realized deals; realized-basis + uPnL DQ flag (reuse v1.8) |
| Asset class | Inheriting the crypto √365 default | Stamp `traditional` → √252 risk / calendar return (#597 + v1.8 split); mutation-test it |
| Terminal lifecycle | Assuming a logged-in terminal is always ready | Probe `account_info().login == expected` readiness gate before every read; supervised restart |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Blocking MT5 call on the event loop | `healthz` latency spikes, Railway restarts mid-sync | `asyncio.to_thread` + `asyncio.wait_for` bound (WEDGE-01 fix) | First slow/wedged terminal — i.e. immediately in prod |
| Unbounded history crawl | A sync never returns; worker wedged | Hard request budget (`_SFOX_CRAWL_MAX_REQUESTS`-style) + wall clock | Accounts with long history or a looping broker response |
| One heavyweight terminal container per account | Linear RAM/CPU + broker connection churn | Pooled+serialized terminals at current scale; rate-limit reconnects | Tens of accounts / broker connection cap |
| Serial terminal login/logout per sync | Slow sequential syncs as accounts grow | Warm-session reuse where safe under the per-terminal lock | When account count × login latency exceeds the sync window |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing investor/master password plaintext | Credential theft; if master, trade-capable | KEK-encrypt on the existing `encrypt_key` path |
| Accepting a full-access (master) password | Trade-capable secret at rest; trust breach | Validate-time capability probe (`trade_allowed`/`order_check` dry-run) → reject, never `order_send` |
| Exposing `order_*` in the adapter | A caller could trade through the read session | Structural: adapter composes read methods ONLY + ingestion-boundary isinstance guard (sFOX pattern) |
| Shared-secret volume across account terminals | One escape exfiltrates all accounts' creds | Per-account/serialized isolation; terminal container sees only the secret it's syncing |
| Unpinned/unverified terminal binary | Compromised build exfiltrates creds from memory | Pin + verify provenance; disable auto-update; least-privilege container, restricted egress |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Connect form omits broker server (or guesses it) | Endless "wrong password" confusion (really a wrong server) | Required server field + guide showing where to find it in their terminal |
| Generic "connection failed" on validate | User can't tell bad-server vs bad-password vs full-access | Map `last_error` → distinct messages; explicit "use your INVESTOR password" |
| No coverage caption on truncated history | User thinks the platform lost their data | Honest coverage-window/absence surface (reuse existing) |
| Flag/badge shipped ON before ops proven | Users connect keys nothing can sync (Wine/hosting not live) | Ship flag-OFF like sFOX; badge only after go-live ops (Phase 139) |

## "Looks Done But Isn't" Checklist

- [ ] **`initialize`/`login`:** Often missing `last_error()` capture — verify every falsy return raises a typed error with the code.
- [ ] **`history_deals_get`:** Often missing the `None`-vs-`()` distinction and balance-op classification — verify deposits don't read as returns and unknown deal types fail loud (deribit-`correction` lesson).
- [ ] **Read-only:** Often missing the full-access-password rejection — verify a master password is rejected at validate, and no `order_*` symbol exists in the adapter.
- [ ] **Concurrency:** Often missing the `account_info().login == expected` bracket guard — verify two concurrent syncs cannot share a terminal (regression test).
- [ ] **Event loop:** Often missing `to_thread` + `wait_for` — verify a hung terminal times out and recovers, `healthz` stays green (WEDGE-01 regression).
- [ ] **Annualization:** Often missing `asset_class=traditional` → √252 — verify a mutation test fails if MT5 series annualize on √365.
- [ ] **Equity:** Often missing the uPnL wedge DQ flag — verify reconstructed NAV ties to `account_info().balance` and warns when floating PnL is material.
- [ ] **Timezone:** Often missing the server→UTC seam — verify midnight-boundary deals bucket into the correct calendar day.
- [ ] **Terminal auto-update:** Often missing the lock/pin — verify the image disables auto-update and asserts terminal↔wheel compatibility.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cross-account data bleed (Pitfall 6) | HIGH | Invalidate/re-sync ALL affected keys; add the `login`-bracket guard + serialization; audit any `api_verified` stamp written during the bleed window |
| Event-loop wedge (Pitfall 5) | MEDIUM | Restart terminal + worker; wrap calls in `to_thread`+`wait_for`; re-queue the classified-transient job (WEDGE-01 playbook) |
| Balance-op counted as PnL (Pitfall 8) | MEDIUM | Reclassify deals; re-run reconstruction; re-derive backbone dailies for affected keys |
| Wrong annualization shipped (Pitfall 11) | LOW-MEDIUM | Stamp asset_class, re-derive; golden/mutation test catches it pre-ship if present |
| Full-access password stored (Pitfall 7) | HIGH | Revoke/rotate at broker; purge the secret; add validate-time rejection; notify user |
| Terminal auto-update broke sync (Pitfall 4) | LOW | Rebuild the pinned image, redeploy; the update is a deliberate rebuild unit thereafter |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Opaque False / no `last_error` | 134 (contract) / 135 (validate) | Fault-injection test: each failure mode raises a distinct typed error; `None`≠`()` |
| 2. Headless Wine auto-login flakiness | 134 (feasibility) / 137 (readiness gate) / 139 (provision) | Unattended auto-login smoke passes in build; readiness probe blocks reads until logged in |
| 3. Broker server mismatch | 135 (required field) / 138 (guide) | Wrong-server test yields a distinct message, not `KEY_AUTH_FAILED` |
| 4. Terminal auto-update / version drift | 134 (pin) / 137 (assert) / 139 (image) | Startup asserts terminal↔wheel compatibility; auto-update disabled in image |
| 5. Event-loop wedge | 136 (thread+wait_for at seam) / 137 (recovery) | Hung-terminal test: `wait_for` fires, `healthz` green, job re-queued (WEDGE-01 regression) |
| 6. One-terminal cross-account bleed | 137 (serialize + bracket guard) | Concurrent-sync test cannot interleave; `account_info().login` asserted pre+post read |
| 7. Read-only not proven / full-access accepted | 134 (probe design) / 135 (structural + reject) | Master-password login rejected at validate; no `order_*` symbol in the adapter |
| 8. `history_deals_get` misread | 136 (classify + flow split) | Deposit day → external flow not return; unknown deal type fails loud |
| 9. Timezone server-vs-UTC | 134 (offset) / 136 (normalize seam) | Midnight-boundary deal buckets to the correct UTC day |
| 10. No historical equity / uPnL wedge | 136 (realized-basis + DQ flag) | Reconstructed NAV ties to `account_info().balance`; material wedge warns |
| 11. Annualization √365 vs √252 + lot notional | 136 (asset_class + equity-delta returns) | Mutation test fails if MT5 annualizes on √365; returns invariant to lot size |
| 12. Cost blowup / broker limits | 137 (pool decision) / 139 (soak) | Reconnect rate-limited; cost modeled before scaling the pool |
| 13. Credential storage / container isolation | 135 (KEK + reject) / 139 (isolation) | Secrets KEK-encrypted; terminal container least-privilege, restricted egress |
| 14. Missing-history windows | 136 (bounded crawl + honest absence) | Gaps render coverage-masked, never fabricated flat zeros |

## Sources

- MQL5 official Python integration docs — `initialize` returns True/False, check `last_error`, IPC pipe-timeout: https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- MQL5 forum — "IPC initialize failed / Pipe server didn't answer in 60 sec"; manual-login-works-automated-fails timing race: https://www.mql5.com/en/forum/438477 ; https://www.mql5.com/en/forum/306742/page16
- `mt5linux` (Wine + rpyc headless Linux pattern): https://pypi.org/project/mt5linux/0.1.8
- Investor password = server-enforced read-only "Guest Mode", `order_send` fails (retcode 10027): https://support.weltrade.com/en/articles/11952849-what-is-investor-password-in-mt4-5 ; https://www.mql5.com/en/forum/376255 ; https://www.mql5.com/en/forum/339101
- This codebase (HIGH): `analytics-service/services/sfox_read.py` (structural read-only isinstance guard; `asyncio.wait_for` derive-seam wall-clock bound; `_SFOX_CRAWL_MAX_REQUESTS=50`), `services/ingestion/sfox.py` (structural read-only + `KEY_AUTH_FAILED`), `services/external_flows.py` (`ExternalFlow`/`USD_FAMILY`).
- This platform's own post-mortems / MEMORY (HIGH): WEDGE-01 (event-loop block, PR#632); v1.11 derived-curve FLIP rollback (unbounded crawl wedged sequential worker); deribit `correction` unhandled ledger-type fail-loud; #597 asset-class annualization (crypto √365 / trad √252); v1.8 TWR realized-basis + `unrealized_pnl_in_anchor` DQ flag; DEFERRED "unknown asset_class → crypto" annualization latent bug; v1.13 Railway egress-IP rotation.

---
*Pitfalls research for: self-hosted MT5 + Python read-only live account sync (v1.15)*
*Researched: 2026-07-23*
