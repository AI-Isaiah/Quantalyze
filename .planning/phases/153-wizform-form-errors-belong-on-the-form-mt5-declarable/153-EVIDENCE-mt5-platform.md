# MetaTrader 5 platform research — the study that should have preceded our integration

Date: 2026-08-08. Author: research agent. Repo context read-only.

**Label key used throughout:**
- **[DOC]** — stated in MetaQuotes/MQL5 official documentation or in the shipped package source.
- **[SRC]** — read directly out of the `mt5linux` 0.1.9 source distribution (verifiable fact about the code we run).
- **[ANEC]** — forum / vendor / community report. Real people, but not a specification. May be version-specific or wrong.
- **[INFER]** — my deduction from [DOC]/[SRC] facts. Stated as deduction, not fact.
- **[UNKNOWN]** — not publicly documented. Do not guess.

---

## A. The connection model

### A1. Architecture: what the `MetaTrader5` Python package actually is

**[DOC]** The `MetaTrader5` Python package is a *thin IPC client to a running MetaTrader 5 desktop terminal*. It is not a protocol implementation and cannot talk to a broker on its own. MQL5's own words: the package "enables convenient and fast obtaining of exchange data via **interprocessor communication directly from the MetaTrader 5 terminal**."
https://www.mql5.com/en/docs/python_metatrader5

**[DOC]** PyPI confirms the platform constraint: all distributions of `MetaTrader5` are **Windows x86-64 only** (latest 5.0.6090, 2026-08-01; Python 3.6–3.14). https://pypi.org/project/MetaTrader5/

**[DOC]** There is **no headless mode**. The terminal GUI process (`terminal64.exe`) is the thing that holds the broker connection, the symbol cache, and the history database. The package documentation says "all the necessary related operations, such as the platform launch, data synchronization with the broker's server and data transfer to the Python environment will be performed automatically" — i.e. the *terminal* does the work; Python is a consumer.

**IPC mechanism: [UNKNOWN — not publicly documented.]** MetaQuotes never documents the wire format. What *is* documented is the error surface: the whole `-1000x` error family is named `RES_E_INTERNAL_FAIL_*` with descriptions "internal IPC general error / send failed / recv failed / initialization fail / no ipc / internal timeout" (https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py). **[INFER]** from those names plus the `initialize(portable=...)` / per-installation-directory semantics: it is a local, per-terminal-instance named-pipe/shared-memory channel scoped to the machine and the terminal's data folder — which is exactly why a remote terminal is unreachable and why `mt5linux` has to put a Python interpreter *inside* the Wine prefix next to the terminal. It is **not** a TCP service you can point at.

### A2. Our actual topology, from source

**[SRC]** `mt5linux` 0.1.9 (`mt5linux/__main__.py`) writes out a verbatim copy of upstream rpyc's `rpyc_classic.py` and launches it under Wine. Default serving mode is `threaded`:

```
t = ThreadedServer(SlaveService, hostname=self.host, port=self.port, ...)
```

**[SRC]** The client (`mt5linux/__init__.py:357-365`) is:

```python
self.__conn = rpyc.classic.connect(host, port)
self.__conn.execute('import MetaTrader5 as mt5')
```

and every method is a *string eval* on the server:

```python
code = f'mt5.login(*{args},**{kwargs})'      # __init__.py:590
return self.__conn.eval(code)
```

**[INFER — high confidence, load-bearing]** `ThreadedServer` serves every connection **in one OS process**. `import MetaTrader5 as mt5` resolves through that process's shared `sys.modules`, so *every rpyc connection to our gateway binds the same `MetaTrader5` extension-module instance, which holds one process-global IPC session to one terminal, logged into one account.* Consequences:

- `login()` on connection A **changes the account that connection B sees.**
- `shutdown()` on connection A **tears down the IPC pipe for connection B**, which will then observe `-10004 No IPC connection`.
- rpyc connections give **no isolation whatsoever** here. The per-connection `_local_namespace` isolates variable *names*, not the C-extension's global state.

This is the single most important structural fact in this document, and it is the one our design implicitly bets against.

### A3. Can one terminal hold more than one account logged in? **No.**

**[ANEC — but from an MQL5 forum moderator, repeated and consistent]** Fernando Carreiro, MQL5 moderator: *"You can connect to any account with just one MetaTrader 5 via the Python API, but you can only connect to one account at a time. If you want to connect to multiple accounts at the same time, then you need a separate MetaTrader 5 installation for each account."* — https://www.mql5.com/en/forum/449894

Same thread: *"You can only have a theoretical maximum of 32 MetaTrader 5 terminals running at the same time on a computer with the same Windows user account… If you need 100 connections, then you will need multiple computers (real or virtual)."*

**[ANEC]** Moderator Stanislav Korotky: *"Out of the box MT5 does not support multiple instances bound to python at the same time, at the moment."* — https://www.mql5.com/en/forum/478406

**[DOC-adjacent]** A single terminal *can store* many accounts in its Navigator (`config/accounts.dat` is described as "a database of accounts and their settings" — https://www.metatrader5.com/en/terminal/help/start_advanced/structure), but only one is **active/connected** at a time. Storage ≠ concurrency.

#### The standard production pattern for multi-account MT5

**[DOC]** One terminal **installation** per account, each launched with `/portable` so it owns its own data folder; `initialize(path=..., portable=True)` selects which one. https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py and the MQL5 article "Developing a Terminal Manager (Part 2): Running Multiple Terminal Instances" (https://www.mql5.com/en/articles/19852), which copies the terminal into per-instance folders and runs each with `/portable`, orchestrated by a FastAPI + `psutil` + `subprocess` supervisor.

**[ANEC]** The community-recommended shapes are (a) N terminals, one Python child process bound to each, or (b) one terminal + one supervisor process that *serializes* all work — never N concurrent clients against one terminal, because "when multiple programs connect to the same MT5 terminal.exe, the performance degrades & one or more python programs exit with errors" (https://www.quantvps.com/blog/how-to-open-multiple-mt5-terminals-on-same-vps, https://www.mql5.com/en/forum/351590).

**Alternative that is NOT available to us — MT5 Manager API / Web API.** **[DOC/vendor]** MetaQuotes sells a Manager API and a REST Web API that read accounts *server-side*, no terminal involved (https://www.metatrader5.com/en/brokers, https://b2broker.com/news/web-api-for-metatrader-how-does-it-work/). These are licensed **to the broker who operates the trade server**. They give the broker access to *their own* users. They cannot be used by a third party to read one user's account at an arbitrary broker. For a multi-tenant product whose users bring accounts at Vantage, IC Markets, Exness, etc., Manager/Web API is not a path. **[INFER]** — no vendor page contradicts this, and all of them are addressed to brokers/prop firms.

### A4. `initialize()` — exact semantics

**[DOC]** https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py

Three call forms: `initialize()`, `initialize(path)`, `initialize(path, login=…, password=…, server=…, timeout=…, portable=…)`.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `path` | str, unnamed | auto-detect | path to `terminal64.exe`; module auto-locates if omitted |
| `login` | int | **last used account** | |
| `password` | str | **password saved in the terminal database** | |
| `server` | str | **last used server** | |
| `timeout` | int | **60000** | **milliseconds** [DOC] |
| `portable` | bool | `False` | launch in portable mode |

Returns `True`/`False`. On `False`, read `last_error()`.

- **Does it launch a terminal?** **[DOC] Yes:** *"If required, the MetaTrader 5 terminal is launched to establish connection when executing the initialize() call."*
- **Is it idempotent against an already-running terminal?** **[UNKNOWN — not publicly documented.]** The docs never state idempotency. What *is* documented is that it establishes a connection and reuses saved credentials when none are supplied. Our code asserts idempotency in prose (`mt5_client.py:293-303`) — that assertion has no source. **[ANEC]** community code universally calls `initialize()` once per process and treats a repeat call as harmless, and the observed practice on our own gateway is that a bare `initialize()` attaches to the already-running terminal. Treat as "empirically fine, not contractual".
- **`timeout` unit/default: 60000 ms [DOC].** Note the doc default is **60 s**, i.e. three times our whole rpyc budget (see Corrections table).

### A5. `login()` vs `initialize(login=…)`

**[DOC]** https://www.mql5.com/en/docs/python_metatrader5/mt5login_py — `login(login, password="…", server="…", timeout=60000)`. `login` is a **required unnamed parameter**; password defaults to the terminal's saved password; server defaults to the last used server; `timeout` is **milliseconds, default 60000**, and *"if the connection is not established within the specified time, the call is forcibly terminated and the exception is generated."*

- `initialize()` **attaches Python to a terminal process** (launching one if needed) and optionally performs an initial account connection.
- `login()` **(re)connects the already-attached terminal to a trade account**. It does not attach the IPC pipe. It is the documented way to switch accounts.
- **Which is required when:** `initialize()` must succeed before *any* other call — without it every call, `login()` included, returns `-10004 'No IPC connection'`. **[DOC-by-implication + ANEC]**: the error constant exists for exactly this and every forum repro shows it (https://www.mql5.com/en/forum/450738). Our own live gateway observation matches.
- **Is re-`login()` to a different account on a live terminal supported?** **[DOC] Yes, nominally** — the docs present `login()` as the account-connection call and place no restriction on calling it repeatedly. **[ANEC] In practice it is fragile.** The most specific report, MQL5 forum 478716 ("Account Login, Server Discovery, and Timeout Bugs"):
  1. logging into an account whose **server is not already registered in the terminal** times out — *"the API cannot handle server discovery or addition programmatically, which requires manual intervention"*;
  2. *"If the terminal is not logged into any account, attempting to add a new account through the API results in a timeout"*;
  3. **a failed login while another account is active leaves the terminal in a broken state** — *"does not seem to gracefully handle incorrect login attempts"*, requiring a **manual** switch back to a good account in the GUI to recover.
  https://www.mql5.com/en/forum/478716
- **[ANEC]** Related: *"the code works only if you had a manual successful connection to account first"* — https://www.mql5.com/en/forum/443248

### A6. `shutdown()` semantics

**[DOC]** https://www.mql5.com/en/docs/python_metatrader5/mt5shutdown_py — no parameters, returns `None`, "closes the previously established connection to the MetaTrader 5 terminal." **It closes the IPC connection. It does not close the terminal, does not log the account out, and does not reset terminal state.**

- **Known hangs?** **[UNKNOWN — not publicly documented.]** No MetaQuotes statement about `shutdown()` hanging. **[INFER]** in our topology the risk is not `shutdown()` blocking but `shutdown()` *succeeding* and destroying the IPC pipe underneath a concurrent caller (see A2).

### A7. Error codes

**[DOC]** https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py — and independently confirmed **[SRC]** from `mt5linux/__init__.py:93-108`, which mirrors the constants (useful because the MQL5 HTML renders `-10003` twice in some scrapes):

| Constant | Value | Meaning |
|---|---|---|
| `RES_S_OK` | 1 | generic success |
| `RES_E_FAIL` | -1 | generic fail |
| `RES_E_INVALID_PARAMS` | -2 | invalid arguments/parameters |
| `RES_E_NO_MEMORY` | -3 | no memory condition |
| `RES_E_NOT_FOUND` | -4 | no history |
| `RES_E_INVALID_VERSION` | -5 | invalid version |
| **`RES_E_AUTH_FAILED`** | **-6** | **authorization failed** |
| `RES_E_UNSUPPORTED` | -7 | unsupported method |
| `RES_E_AUTO_TRADING_DISABLED` | -8 | auto-trading disabled |
| `RES_E_INTERNAL_FAIL` | -10000 | internal IPC general error |
| `RES_E_INTERNAL_FAIL_SEND` | -10001 | internal IPC send failed |
| `RES_E_INTERNAL_FAIL_RECEIVE` | -10002 | internal IPC recv failed |
| `RES_E_INTERNAL_FAIL_INIT` | -10003 | internal IPC initialization fail |
| **`RES_E_INTERNAL_FAIL_CONNECT`** | **-10004** | **internal IPC no ipc** |
| **`RES_E_INTERNAL_FAIL_TIMEOUT`** | **-10005** | **internal timeout** |

Observed message strings **[ANEC]**: `(-10004, 'No IPC connection')`, `(-10005, 'IPC timeout')`, `(-10003, 'IPC initialize failed, Process create failed')`.

**Critical gap: there is no distinct code for "invalid server".** Bad server, bad login and bad password all collapse into `-6 RES_E_AUTH_FAILED` / a `False` return, or — when the server is simply unknown to the terminal — into a **timeout** (`-10005`) rather than an auth error (https://www.mql5.com/en/forum/478716). See Corrections C-4.

---

## B. Broker servers and the server directory

### B7. Where the broker/server list comes from

**[DOC]** The terminal's account wizard: *"A broker is selected during the first step. If the desired company is not shown in the list, please type its name and click **'Find your broker'**… Alternatively, you can type the address of the server instead of the company name."* — https://www.metatrader5.com/en/terminal/help/startworking/acc_open

**[DOC]** Selections are persisted locally: `config/servers.dat` = *"Trade server settings for connection"*; `config/accounts.dat` = *"a database of accounts and their settings."* — https://www.metatrader5.com/en/terminal/help/start_advanced/structure

**[INFER + ANEC]** The mechanism is: the terminal queries MetaQuotes' broker directory over the network when you search a broker name, downloads that broker's connection descriptor (server addresses + the display names like `VantageMarkets-Live 5`), and caches it into `servers.dat`. The two independent forum findings that force this reading:
- *"you have to **search for your broker first, then mt5 will download the server info**, then the python script will work"* (Eduard Xue) — https://www.mql5.com/en/forum/443248
- the alternative offered in the same thread: **copy `servers.dat` from a terminal that already knows the broker** into the portable config directory, then `initialize(..., portable=True)`.
- and 478716's "server discovery… requires manual intervention".

MetaQuotes never documents the directory endpoint. **The exact URL/protocol is [UNKNOWN — not publicly documented].**

### B8. Is the server directory available programmatically?

**No public API. [DOC-absence + ANEC]**

- There is **no** MetaTrader5-Python function that lists brokers or servers. The full function list (https://www.mql5.com/en/docs/python_metatrader5) has nothing of the kind — `terminal_info()` tells you the *currently connected* server, nothing more.
- There is **no** published MetaQuotes endpoint for the broker directory.
- `config/servers.dat` is a **binary, undocumented, proprietary** file. Third parties have reverse-engineered it (mtapi.online publishes a "MT5 servers.dat reader" web tool at https://mtapi.online/fdat/form.html; discussion at https://www.mql5.com/en/forum/440619). The same MQL5 thread warns: *"These are proprietary files, and should they be used by 3rd party tools without express permission, you may be violating MetaQuotes terms of use… They are not user files to be used by 3rd party tools."*
- **[ANEC]** Whether MT5's `servers.dat` is encrypted is disputed on that thread ("probably encrypted" for current builds).

**Plain statement for the product decision: the broker→server directory is only obtainable inside a terminal, and harvesting `servers.dat` is a ToS-risk reverse-engineering exercise, not an integration.** The supportable product design is: **the user types their server string**, and we validate it by attempting a login. (Optionally: maintain our own curated list of server strings scraped from brokers' own public help pages — see B10 — but that is our data, maintained by us, and will go stale.)

### B9. Format, and what a typo does

**[DOC/ANEC]** The server string is a **closed set per broker** — it must exactly match a trade server the broker operates and that the terminal knows about. Convention observed across brokers: `<BrokerToken>-<AccountType> <N>`, e.g. `VantageInternational-Live`, `AdmiralsGroup-Demo`, `Deriv-Server-02`. The terminal also accepts a raw `host:port` address in the wizard **[DOC]** (acc_open page). There is **no published grammar** — **[UNKNOWN]**.

**On a typo:**
- If the string names a server the terminal already has in `servers.dat` → mismatch with the account → **`-6 RES_E_AUTH_FAILED`, message "Authorization failed" / "Invalid account"** **[DOC constant + ANEC]** (broker help pages universally say "Authorization failed means the credentials are incorrect **or the server you selected does not correspond to your account**" — e.g. https://get.exness.help/hc/en-us/articles/360016407520, https://community.deriv.com/t/deriv-mt5-login-error-authorization-failed-invalid-account-error-message/50035).
- If the string names a server the terminal has **never heard of** → **timeout**, `-10005`, not an auth error, because the terminal tries to *discover* it **[ANEC — https://www.mql5.com/en/forum/478716]**.

This bimodality is a real problem for our classifier (Corrections C-4).

### B10. Is a broker server name sensitive? **No — it is public.**

**[DOC/vendor, multiple independent]** Brokers publish their server names on public help pages. Vantage: https://www.vantagemarkets.com/quick-question/metatrader-5-login-broker-server/. Admirals: https://admiralmarkets.com/education/articles/forex-basics/metatrader-5-account. The MT5 wizard shows the whole list of a broker's servers to anyone who types the broker's name. A server name identifies a *broker's shared trade server*, not a user.

**Verdict:** the server string is public reference data. It is **not** a secret and does not require an encrypted secret column on its own merits. Two caveats before you change anything:
1. It is weakly *identifying* — combined with a login number it tells an attacker which broker a user trades with. That is a privacy attribute, not a credential.
2. In our schema it currently occupies the `passphrase` slot alongside genuine secrets. Moving it is a migration with real blast radius, and the storage cost of leaving it encrypted is ~zero. **Recommendation: leave the storage as-is; stop treating it as a secret in *logs, errors and UI*, where the current redaction actively hurts debuggability** (`mt5_client.py:320-322` redacts the server string out of error text — that is why nobody can tell a wrong-server failure from a bad password in production logs).

---

## C. Read-only / investor access

### C11. The investor password model

**[DOC — this is the strongest single citation in this document]** MQL5, "Trade permission" (https://www.mql5.com/en/docs/runtime/tradepermission): trading is forbidden for the account when —
- there is no connection to the trade server,
- the trading account is switched to read-only mode (archived),
- trading is disabled **at the trade server side**,
- **"connection to a trading account has been performed in Investor mode."**

So investor mode is a **connection mode**, and it makes `ACCOUNT_TRADE_ALLOWED` false. **[DOC]** `ACCOUNT_TRADE_ALLOWED` = "Allowed trade for the current account" (https://www.mql5.com/en/docs/constants/environment_state/accountinformation), and it is the flag `account_info().trade_allowed` exposes.

**Enforcement: server-side.** **[ANEC, but unanimous across broker documentation and the auditing industry]** The MetaTrader trade server rejects order/modify/close requests on an investor-authenticated session; the client is not the enforcer. E.g. Vantage (https://global.vantagehelpcenter.com/hc/en-us/articles/10956738706447), Weltrade (https://support.weltrade.com/en/articles/11952849), Darwinex (https://help.darwinex.com/change-mt4-mt5-master-and-investor-password). **[DOC-corroboration]** the tradepermission page listing "Investor mode" alongside "trading disabled at the trade server side" as sibling account-level conditions is consistent with server-side enforcement. I found **no** primary MetaQuotes sentence that says the words "the server rejects it", so: **server-side enforcement is [ANEC]-strong, [DOC]-implied, not [DOC]-explicit.**

What investor access grants **[ANEC/vendor]**: view balance/equity, open positions, full order & deal history, charts, indicators. What it forbids: opening/modifying/closing trades, changing account settings, withdrawing funds, and changing the master password.

**Industry precedent:** this is exactly how Myfxbook, FX Blue and similar verification services read accounts — the user hands over the investor password and the service logs a terminal in read-only (https://www.myfxbook.com/help/knowledge-base/verification/). Our product concept is standard and sound. It is only the *plumbing* that is unusual.

### C12. Verifying read-only-ness programmatically

**Partially. There is no dedicated "am I investor?" API.** **[DOC-absence]**

The available signals:
1. **`account_info().trade_allowed`** — **[DOC]** false in investor mode… **but also false when disconnected from the trade server, when the account is archived, and when the broker disabled trading.** It is necessary-but-not-sufficient. A `False` here does **not** prove investor mode.
2. **`order_check(request)`** — **[DOC]** "check funds sufficiency for performing a required trading operation" (https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py). It returns an `MqlTradeCheckResult` with a `retcode`. It does **not** place an order. **[ANEC]** an investor-mode session yields a trade-disabled rejection; the corresponding documented code is `TRADE_RETCODE_TRADE_DISABLED = 10017` (https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes). `TRADE_RETCODE_DONE = 10009` means the request would be accepted. **Note there is no `TRADE_RETCODE_INVALID_ACCOUNT` in the enum — 10014 is `TRADE_RETCODE_INVALID_VOLUME`.** Any code carrying that assumption is wrong.
3. **`terminal_info().trade_allowed`** — the terminal's AutoTrading toggle, and separately **[DOC]** the terminal option *"Disable automatic trading through the external Python API — Python scripts which use the module for integration with the trading platform can perform trading operations. However, **this possibility is disabled by default for security reasons**"* (https://www.metatrader5.com/en/terminal/help/startworking/settings). **This is a landmine for our probe**: with that default in force, `order_check`/`order_send` from Python are blocked *regardless of investor vs master*, so a **master** password can look exactly like an investor password to a probe. See Corrections C-5.

**Correct composition, given the above:** treat as read-only **only if** `terminal_info().connected` is true **and** `terminal_info().trade_allowed` is true (i.e. the terminal itself would permit trading, so a rejection is attributable to the account) **and** `account_info().trade_allowed` is false **and** `order_check` returns a trade-disabled-class retcode. Anything else is "cannot determine" and must fail closed as *transient*, not as "read-only confirmed".

---

## D. Operational reality

### D13. Login latency

**No documented numbers exist. [UNKNOWN — not publicly documented.]** MetaQuotes publishes no latency figures for `initialize()` or `login()`.

What can be said:
- **[DOC]** The *documented defaults* are the only official signal about the expected envelope, and they are large: `initialize(timeout=60000)` and `login(timeout=60000)` — **60 seconds each**. MetaQuotes chose a 60 s ceiling for a reason; it implies they consider multi-second, occasionally tens-of-seconds, connections normal.
- **[ANEC]** Cold path (terminal launch + first broker connect + symbol/history sync) is routinely reported in the *seconds to tens of seconds* range, and the failure reports that dominate the forums are **timeouts**, not fast errors: `-10005 IPC timeout` threads (https://www.mql5.com/en/forum/447937, https://www.mql5.com/en/forum/443248) and the server-discovery timeout in https://www.mql5.com/en/forum/478716.
- **[ANEC]** A specific, relevant slow path: **history synchronization after login is asynchronous and lags.** `history_deals_get()` right after a fresh login commonly returns an **empty tuple** while the terminal is still downloading — *"the first call in a session after restarting the script often returns empty"*, *"if you specify 30 days you get results almost every time, if you specify 1 day you get results sometimes"* (https://www.mql5.com/en/forum/385124, https://www.mql5.com/en/forum/469195). **This is silent data loss, not an error.**
- **[ANEC — Wine-specific and directly on our stack]** MQL5 forum 366378, "MT5 won't list history deals — python and wine": login and orders work, but the terminal *never downloads history*; the reporter's only fix was clicking the account in the GUI to re-login. A second user reproduced it in 2023. No resolution posted. https://www.mql5.com/en/forum/366378

**Bottom line for the team's unmeasured number:** you could not measure it because a 20 s login ceiling and a 30 s rpyc ceiling truncate the distribution that MetaQuotes itself budgets 60 s for. Any honest measurement must set `login(timeout=…)` to at least 60000 ms and the transport ceiling above that, on a warm terminal, on a trading day, and record the distribution — including the time until `history_deals_get` stops returning empty.

### D14. Rate limits / lockouts on repeated logins

**[UNKNOWN — not publicly documented.]** MetaQuotes documents no login throttle, and no broker help page I found states a failed-attempt lockout policy for MT5 trade accounts. What *is* documented by brokers: accounts get disabled/archived for inactivity or by the broker's decision, and server maintenance windows reject logins.

**[ANEC]** The observed practical hazard is not a broker lockout but the **terminal-side broken state after a failed login** (https://www.mql5.com/en/forum/478716) — the client, not the server, is what degrades under repeated bad logins.

**Practical guidance:** assume an undocumented per-account throttle may exist at any given broker, because you cannot see it until it bites; and independently assume that a re-login-per-request design will hit terminal-side degradation long before it hits any broker limit.

### D15. Wine / Linux

- **[DOC]** MetaQuotes ships **official** Ubuntu/Debian and macOS installers that install Wine and then install MT5 inside it: `wget https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5ubuntu.sh` (https://www.metatrader5.com/en/news/2329). So Wine is *sanctioned*, but it is explicitly a compatibility layer, not a native port — MetaQuotes make no native-Linux support claim.
- **[ANEC/community]** WineHQ AppDB rates MetaTrader 5.x **Gold** — "works flawlessly with some DLL overrides, other settings or third party software" — with webview-based windows noted as broken. https://appdb.winehq.org/objectManager.php?sClass=version&iId=19984
- **Known hazards specific to a long-running headless gateway:**
  - **[ANEC] Live Update.** The terminal **self-updates** `terminal64.exe`/`metaeditor64.exe` from the broker, independently of your image. Community advice under Wine is to back up working executables and not let Live Update run (https://www.mql5.com/en/forum/438067/page2). Our own runbook already flags this (`docs/runbooks/mt5-go-live.md:93-98`) and accepts it as managed risk. **This means your gateway's most important binary is unpinnable and can change without a deploy.**
  - **[ANEC] Wine version sensitivity.** Reports resolve MT5 breakage by moving to wine-staging/-devel, 64-bit Wine, and Windows≥7 compatibility mode; MetaQuotes' own installers pull "the latest Wine".
  - **[ANEC] The history-sync failure mode under Wine** (D13, forum 366378) — this is the one that would silently corrupt *our* product output, because empty history is indistinguishable from a flat account.
- **Does a wedged terminal self-recover?** **[UNKNOWN — not publicly documented]**, and **[ANEC] the evidence says no**: 478716's broken-state-after-bad-login needed a **manual GUI action**; 366378's missing history needed a **manual GUI re-login**. Our `Mt5Client.restart()` rebuilds the *rpyc transport*, which does **not** address either failure — the broken state lives in `terminal64.exe`, not in the socket. **Recovering a wedged MT5 means killing and restarting the terminal process**, which nothing in our client can do.

### D16. What mature third-party MT5 integrations actually do

**MetaApi (metaapi.cloud)** — the reference implementation of this product shape.
- **[vendor DOC]** Model: *a per-account API server provisioned in the cloud.* "MetaApi created a PaaS application… by adding their MetaTrader account to the app, where the API server is provisioned automatically in a cloud"; there is a provisioning REST API to launch servers; billing is per deployed account-server ("we bill for 6 hours each time you start your server"). https://metaapi.cloud/docs/client/faq/ , https://metaapi.cloud/docs/client/launchingApi/
- **[vendor DOC]** **Investor passwords are a first-class supported case**: users can *"specify investor password for read-only terminal access (trading features will not be available in this case)."*
- **[vendor DOC]** Reliability is stated **per-account**: >99.5% per-MT-account uptime on standard infrastructure, up to 99.96% on a high-reliability tier "depending on your broker". Regions are explicit; the client must use the URL of the account's region.
- **[vendor DOC]** Scale: "tested integrationally with workloads of up to 50K MetaTrader accounts".
- **[INFER]** Per-account server + per-account uptime + per-account billing + region pinning is only coherent if there is a **dedicated terminal instance per account, long-lived, kept logged in**, fronted by a streaming (websocket) API. That is the same conclusion the MQL5 forum reaches from first principles, arrived at from the opposite direction.

**Myfxbook / FX Blue / verification services** — **[vendor DOC]** user supplies the investor password; the service logs its own terminal into the account and pulls history (https://www.myfxbook.com/help/knowledge-base/verification/). Same shape: their terminals, one account each, long-lived.

**The MQL5-native pattern** — **[DOC]** one `/portable` terminal installation per account under a supervisor process (https://www.mql5.com/en/articles/19852).

**Nobody credible runs one terminal and re-logs it per request.** I looked for it; the only mentions of that pattern are people asking whether it works and being told to run separate installations.

---

## Corrections to our current implementation

| # | What we act on | What is actually true | Source | Where we get it wrong |
|---|---|---|---|---|
| **C-1** | rpyc connections give us independent sessions; an `Mt5Client` is "a session", and `close()` ends *our* session. Two `Mt5Client`s to the same gateway are two clients. | `mt5linux` starts a **`ThreadedServer(SlaveService)` — one process**, and every connection does `import MetaTrader5 as mt5` out of the **shared `sys.modules`**. There is exactly **one** MT5 IPC session and **one** logged-in account per gateway. `close()` → `mt5.shutdown()` **destroys the IPC pipe for every concurrent caller**, who then see `-10004`. | [SRC] `mt5linux-0.1.9/mt5linux/__main__.py` (`ThreadedServer(SlaveService, …)`), `mt5linux/__init__.py:364-365` | `analytics-service/services/mt5_client.py:376-386` (`close()` unconditionally calls `shutdown()` on shared state); `analytics-service/routers/exchange.py:449-466` (`finally:` closes on **every** validate, including concurrent ones); the docstring at `mt5_client.py:1-3` calling this "a session" |
| **C-2** | The worker's per-terminal `asyncio.Lock` serializes access to the one shared terminal. | The lock exists (`mt5_concurrency.py:126-134`) and the **worker** takes it, but the **FastAPI validate path never does** — `grep` for `mt5_concurrency`/`terminal_key`/`Lock` in `routers/exchange.py` returns nothing. So an HTTP validate races the worker's derive on the same terminal. Additionally an `asyncio.Lock` is **per-process**: it serializes nothing across Railway replicas. | [SRC] repo grep; API and worker share one process (`analytics-service/main.py:83-91,245`) but the lock is not taken on the HTTP path | `analytics-service/routers/exchange.py:351-447` — the whole `_probe()` body runs unlocked |
| **C-3** | `login(timeout=20000 ms)` with a 30 s rpyc ceiling is a sane budget; anything slower is a hung terminal. | MetaQuotes' **documented default is 60000 ms** for *both* `initialize()` and `login()`, and the dominant community failure mode is a **timeout**, not an error. Our 20 s ceiling truncates the legitimate tail — this is precisely why the team "could not measure" login latency. | [DOC] mt5login_py, mt5initialize_py | `analytics-service/services/mt5_client.py:82` (`MT5_REQUEST_TIMEOUT_S=30`), `:88` (`MT5_LOGIN_TIMEOUT_MS=20000`), `:213-219` (the ordering guard makes the small value structural), `routers/exchange.py:62` (`_MT5_PROBE_TIMEOUT_S = 35 s` for login+2×account_info+order_check) |
| **C-4** | A wrong broker server produces an error whose text contains "server"/"connect"/… so a substring match classifies it as `wrong_server`; auth text classifies as `auth`. | There is **no distinct error code for a bad server**. A *known-but-wrong* server yields `-6 RES_E_AUTH_FAILED` ("Authorization failed"/"Invalid account") — which our `_AUTH_TOKENS` will classify as **`auth`, blaming the user's password**. An **unknown** server yields a **timeout** (`-10005`), which our tables classify as `wrong_server` only by the accident of the word "timeout" not being in either list → falls through to `transient`. The classifier's two cases are effectively swapped relative to reality. | [DOC] mt5lasterror_py (no server code; `-6` = authorization failed); [ANEC] https://www.mql5.com/en/forum/478716 (unknown server → timeout); broker help pages (wrong server → "Authorization failed") | `analytics-service/services/mt5_validation.py:37-56` (token tables), `:152-174` (`classify_mt5_login_error`) — both already self-labelled `[ASSUMED]`; the assumption is wrong in both directions |
| **C-5** | `is_trade_capable = account_info().trade_allowed OR order_check().retcode == 10009` reliably separates investor from master. | Both signals are **false for a master password** when (a) the terminal is disconnected from the trade server, (b) the account is archived, (c) the broker disabled trading, or — decisively — (d) **"Disable automatic trading through the external Python API" is in force, which is the terminal's DEFAULT**. In all four cases a **master password is accepted and stamped read-only**. This fails *open* on the exact security property the probe exists to guarantee. | [DOC] https://www.mql5.com/en/docs/runtime/tradepermission (four sibling causes); [DOC] https://www.metatrader5.com/en/terminal/help/startworking/settings ("disabled by default for security reasons") | `analytics-service/services/mt5_validation.py:133-150` (`is_trade_capable`), `routers/exchange.py:437-447` (accepts `read_only: True` on the negative) — no `terminal_info()` check anywhere in the repo |
| **C-6** | `10014` / retcode assumptions around "invalid account"; `_TRADE_RETCODE_DONE = 10009  # [ASSUMED]`. | `10009 TRADE_RETCODE_DONE` is correct **[DOC]**. But there is **no `TRADE_RETCODE_INVALID_ACCOUNT`** in the enum (10014 = `TRADE_RETCODE_INVALID_VOLUME`), and the code an investor session should produce is **`10017 TRADE_RETCODE_TRADE_DISABLED`** — which we never test for, so we can't distinguish "rejected because investor" from "rejected because our probe volume/symbol was invalid". A probe rejected for `EURUSD` not being in the broker's symbol list looks identical to investor mode. | [DOC] https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes | `analytics-service/services/mt5_validation.py:32` and `:116-131` (`mt5_probe_request` hardcodes `EURUSD`) |
| **C-7** | `initialize()` is idempotent — "a no-op True when already attached". | **Not documented anywhere.** MetaQuotes documents only that `initialize()` establishes a connection and launches a terminal if required. Idempotency is our empirical observation, promoted to a contract in a docstring. | [DOC-absence] mt5initialize_py | `analytics-service/services/mt5_client.py:293-303` (asserts it as fact), `:305` |
| **C-8** | The broker server string is a secret and must be redacted from errors and logs. | It is **public reference data** — brokers publish their server names on public help pages, and the MT5 wizard lists them to anyone. Redacting it destroys our ability to diagnose exactly the failure class (C-4) we most need to diagnose. | [DOC/vendor] https://www.vantagemarkets.com/quick-question/metatrader-5-login-broker-server/ ; https://www.metatrader5.com/en/terminal/help/startworking/acc_open | `analytics-service/services/mt5_client.py:319-323` (redacts `server` by value); `Mt5Session.server` at `:483` marked `repr=False`; storage in the encrypted `passphrase` slot (`routers/exchange.py:653-665`) — storage is fine to leave, the *log/error* redaction is counterproductive |
| **C-9** | `restart()` recovers a wedged terminal. | It rebuilds the **rpyc transport**. Every documented/reported MT5 wedge (broken state after a failed login; history never downloading) lives in **`terminal64.exe`** and required a **manual GUI action** to clear. Nothing in our client can restart the terminal process. `restart()` recovers a broken *socket*, which is not the failure we've seen. | [ANEC] https://www.mql5.com/en/forum/478716 , https://www.mql5.com/en/forum/366378 | `analytics-service/services/mt5_client.py:388-438` — the docstring's own `[ASSUMED] (A1)` is the honest part; the name over-promises |
| **C-10** | `history_deals_get()` returning `()` is "an honest empty result" and is safe to treat as real data. | **[ANEC, consistently reported]** the terminal syncs history **asynchronously after login**; the first call in a session commonly returns empty while the download is still in flight, and this is **worse under Wine** (one report: history never arrives at all until a manual GUI re-login). Our own "None = error, `()` = honest empty" discipline — otherwise excellent — turns this into **silent fabrication of a flat account**. | [ANEC] https://www.mql5.com/en/forum/385124 , https://www.mql5.com/en/forum/469195 , https://www.mql5.com/en/forum/366378 | `analytics-service/services/mt5_client.py:334-353` (`()` → `[]`, no sync check); no `history_deals_total()` or settle-loop anywhere in the repo |
| **C-11** | `mt5linux==0.1.9` pinned for good reasons (0.1.10 `shell=True` regression; 1.x dropped `-w`). | The pin reasoning is **correct and well-documented** in `deploy/mt5-gateway/mt5linux-constraint.txt`. But upstream is now at **1.1.1 (2026-08-04)** and has moved to a standalone `mt5server.exe` bundling its dependencies — i.e. the ecosystem moved on and we are ~2 years and one architecture behind on an unaudited RCE-by-design transport. Worth a conscious re-decision, not a silent hold. | [DOC] https://pypi.org/project/mt5linux/ | `deploy/mt5-gateway/mt5linux-constraint.txt`, `analytics-service/services/mt5_client.py:140-149` |

---

## E. The verdict

### E17. Is "one shared terminal, re-login per user request, over rpyc" sound?

**No. It has a hard structural ceiling of one concurrent user, and it is not safe even at that ceiling.**

The design assumes rpyc connections are sessions. They are not. One `ThreadedServer` process, one shared `MetaTrader5` module, one IPC pipe, one logged-in account. Everything else follows:

1. **Concurrency is impossible, not merely difficult.** Two simultaneous validates *must* interleave `login()` calls on the same global. Our per-terminal `asyncio.Lock` is the right instinct — but the HTTP path doesn't take it, and even when taken it is per-process, so it dies the moment there is a second replica. The account-mismatch bracket (`exchange.py:363-378`) is a genuinely good detector, and the fact that it had to be written is the tell: **it is a race detector for a race the architecture cannot remove.**
2. **`close()` is a denial-of-service against yourself.** Every validate ends in `finally: client.close()` → `mt5.shutdown()` → the shared pipe drops → a concurrent derive gets `-10004`, which we then classify as `transient` and retry, and the retry does the same thing to the next caller.
3. **Re-login per request is the specific pattern the platform handles worst.** Documented-adjacent and community-confirmed: an unknown server times out rather than erroring; a failed login can leave the terminal in a state that only a **human clicking in the GUI** clears. In a re-login-per-request design, one user typing their password wrong can wedge the terminal for everyone.
4. **Throughput is bounded by the login handshake, not by our code.** MetaQuotes budgets 60 s per login. Serializing N users behind one terminal means N × (login + history-sync) seconds, serially, forever. At even 10 accounts this is not a product.
5. **The read-only guarantee we sell is not proven by the probe.** C-5: with the terminal's default "disable automated trading via external Python API" in force, a **master** password passes our investor check. That is a fail-open on the one property that justifies asking users for a password at all.
6. **Empty history is indistinguishable from a flat account**, and the Wine-specific history-sync failure is reported and unresolved. Our fail-loud discipline is excellent everywhere else and has a hole exactly here.

### What the standard approach is

**One long-lived terminal instance per connected account.** Every mature actor converges on it from different directions: MetaQuotes' own multi-instance article (`/portable`, one data folder per instance), the MQL5 moderators ("a separate MetaTrader 5 installation for each account"), and MetaApi's commercial product (per-account API server, per-account uptime SLA, per-account billing, investor passwords explicitly supported).

### Migration shape (high level, no gold-plating)

Three options, ranked by what I'd actually recommend:

**Option 1 — Buy it. Use MetaApi (or an equivalent) as the MT5 adapter.**
Replace `Mt5Client` with an HTTP/WS client to a provider that already runs the terminal fleet. They support investor-password read-only accounts natively, publish per-account uptime, and have run 50K accounts. Our `Mt5Session` seam and the `_make_exchange_client` chokepoint mean the blast radius is one adapter file plus credential plumbing. Costs money per account; removes the entire Wine/rpyc/terminal-lifecycle problem class, the RCE-channel risk, and the unpinnable-binary risk in one move. **For a product whose differentiator is analytics, not terminal orchestration, this is the right call.**

**Option 2 — Build the fleet ourselves: one terminal container per account.**
Each connected MT5 key gets a container running `terminal64.exe` + `mt5server` on its **own port**, logged in **once** and kept logged in. `MT5_GATEWAY_HOST:PORT` becomes per-key, resolved from a registry table. Reads become "connect to *this account's* gateway and read" — no `login()` at read time, no `shutdown()` on shared state, no lock, no mismatch bracket. Add a **health/liveness probe per terminal** (`terminal_info().connected` + `account_info().login` + `history_deals_total()` non-zero) and a supervisor that **kills and restarts the container** on wedge — the only recovery the platform actually supports. This is a real infrastructure project: image lifecycle, secret delivery into each container, cost per idle account, cold-start policy, and 32-terminals-per-host folklore to validate.

**Option 3 — Keep one terminal, but be honest about it: a single-account gateway.**
Serialize *everything* through one process-wide queue (not an `asyncio.Lock` — a durable single-consumer queue, since API and worker both touch it), pin to **one replica**, remove `shutdown()` from the per-request path entirely (attach once at boot, never tear down), and cap the product at a handful of MT5 accounts with a queue-depth SLA. This is what we have *plus* the fixes; it is defensible as a **beta with a documented account cap**, and it is not a platform.

Whatever is chosen, the **[ASSUMED]** markers in `mt5_validation.py` should be resolved against a live master **and** investor login on a real broker before any general availability — the read-only guarantee is currently unproven, and C-5 says it can fail open.

---

## Structural risks, ranked by severity

1. **Shared global MT5 state across all rpyc connections (C-1, C-2).** One account per gateway, enforced by the C-extension, not by policy. `close()` from one request breaks concurrent requests. The account-mismatch bracket detects the symptom; nothing removes the cause. *This is the ceiling. Everything else is downstream of it.*
2. **Read-only verification can fail open (C-5, C-6).** With the terminal's default "disable automated trading via external Python API", a master (trade-capable) password passes our investor probe and gets persisted as read-only. The probe also can't distinguish investor-rejection from a bad probe symbol. This is a security property we assert to users and cannot currently prove.
3. **Silent empty history (C-10) — a data-integrity risk, Wine-aggravated.** History syncs asynchronously after login; the first read commonly returns empty, and under Wine there are unresolved reports of history *never* arriving. Our `()` → `[]` path converts that into a confidently flat account. Nothing in the repo checks sync state.
4. **No recovery path for a wedged terminal (C-9, D15).** Every reported MT5 wedge required a human in the GUI. `restart()` rebuilds a socket. We cannot restart `terminal64.exe`, and a re-login-per-request design maximizes exposure to the failed-login wedge.
5. **Login-failure classification is inverted (C-4).** Wrong-but-known server → `-6` → we blame the user's password. Unknown server → timeout → we call it transient and retry forever. Users get the wrong remedy; support gets no signal — worsened by redacting the (public) server string out of logs (C-8).
6. **Timeouts below the platform's own budget (C-3).** 20 s login / 30 s transport against documented 60 s defaults. Guarantees truncated observations and manufactured "transient" failures, and is the reason the real latency distribution is still unknown.
7. **Unpinnable terminal binary + Wine drift (D15).** `terminal64.exe` self-updates from the broker outside any deploy. Wine version sensitivity is real. The soak window is the only detector, and it only runs before a flip.
8. **Unauthenticated RCE channel on a 2-year-old, since-rearchitected shim (C-11).** rpyc classic `SlaveService` is arbitrary remote code by design. The private-network constraint is correctly documented and enforced in `docker-compose.yml`, so this is contained — but it is one misconfiguration from catastrophic, and the pin means we carry it indefinitely.
9. **`asyncio.Lock` as a cross-process serializer.** Correct today only because API and worker share one process and there is one replica. Both of those are deployment accidents, not invariants; neither is asserted anywhere.

---

## Sources

- https://www.mql5.com/en/docs/python_metatrader5
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5login_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5shutdown_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py
- https://www.mql5.com/en/docs/runtime/tradepermission
- https://www.mql5.com/en/docs/constants/environment_state/accountinformation
- https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes
- https://www.metatrader5.com/en/terminal/help/start_advanced/structure
- https://www.metatrader5.com/en/terminal/help/startworking/acc_open
- https://www.metatrader5.com/en/terminal/help/startworking/settings
- https://www.metatrader5.com/en/news/2329
- https://pypi.org/project/MetaTrader5/
- https://pypi.org/project/mt5linux/
- https://www.mql5.com/en/articles/19852
- https://www.mql5.com/en/forum/449894
- https://www.mql5.com/en/forum/478406
- https://www.mql5.com/en/forum/478716
- https://www.mql5.com/en/forum/443248
- https://www.mql5.com/en/forum/447937
- https://www.mql5.com/en/forum/450738
- https://www.mql5.com/en/forum/385124
- https://www.mql5.com/en/forum/469195
- https://www.mql5.com/en/forum/366378
- https://www.mql5.com/en/forum/440619
- https://www.mql5.com/en/forum/438067/page2
- https://www.mql5.com/en/forum/351590
- https://metaapi.cloud/docs/client/faq/
- https://metaapi.cloud/docs/client/launchingApi/
- https://www.myfxbook.com/help/knowledge-base/verification/
- https://appdb.winehq.org/objectManager.php?sClass=version&iId=19984
- https://mtapi.online/fdat/form.html
- https://global.vantagehelpcenter.com/hc/en-us/articles/10956738706447
- https://www.vantagemarkets.com/quick-question/metatrader-5-login-broker-server/
- https://get.exness.help/hc/en-us/articles/360016407520
- https://community.deriv.com/t/deriv-mt5-login-error-authorization-failed-invalid-account-error-message/50035
- https://help.darwinex.com/change-mt4-mt5-master-and-investor-password
- https://www.quantvps.com/blog/how-to-open-multiple-mt5-terminals-on-same-vps
- `mt5linux` 0.1.9 sdist (source read directly): https://files.pythonhosted.org/packages/source/m/mt5linux/mt5linux-0.1.9.tar.gz
