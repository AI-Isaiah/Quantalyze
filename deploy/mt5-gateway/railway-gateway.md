# MT5 Gateway — Railway co-locate service (PRIMARY host template)

**This is the PRIMARY host template** (research correction 2026-07-24). The gateway
runs as a **second Railway service in the SAME Railway project as the analytics
worker** — the only option where the RPyC channel never leaves one provider's
encrypted internal mesh and **no tunnel software is introduced**. See the host
decision matrix in `docs/runbooks/mt5-go-live.md` Step 0 for why this beats Fly/VPS.

> **HARD CONSTRAINT — PRIVATE NETWORK ONLY.** The RPyC bridge (`:8001`) is an
> **unauthenticated arbitrary-remote-code channel** (Phase-134 T-134-03 finding). It
> must be reachable ONLY at `gateway.railway.internal:8001` over Railway's internal
> WireGuard mesh. **NEVER** attach a public domain to this service. **NEVER** expose
> `:8001` publicly. No exceptions.

## ⚠️ T-134-03 POSTURE CHANGE — the channel is now a production RECOVERY path (Phase 164.6.5, D-05)

**Decision, founder-ratified 2026-09-25: D-05 = Option 2.** The terminal is supervised
from OUTSIDE the container, over the rpyc channel the analytics-service already dials.
Nothing inside the image supervises `terminal64.exe`: s6-overlay supervises only the
system services (kasmvnc, nginx, cron, pulseaudio, docker, the desktop), and the vendor
`start.sh` backgrounds the terminal once with a bare `&` and never restarts it.

**Why Option 2 beat the other two.**
- **Option 1 (wrap the image with our own s6 longrun) was rejected.** An s6 longrun
  supervises process EXIT, and in the 1h39m outage of 2026-09-21 there was no exit. The
  process ran and its UI answered while the IPC was dead, so a bare longrun would have
  stayed quiet the whole time (D-06). Making it useful means building the IPC liveness
  checker Option 2 already has, inside an image we would then own: a build and push
  pipeline, an amd64-only build, a re-pointed deploy, and the broker's un-freezable
  terminal self-update.
- **Option 3 (a Railway healthcheck or restart policy) was rejected.** There is no HTTP
  surface to probe without exposing the bridge, which the hard constraint above
  forbids. No `railway.toml` exists for this service. And a restart policy restarts the
  whole CONTAINER, which is not the process-only mechanism the unattended recovery was
  measured against.

**What changes, stated plainly.** The channel above is still an unauthenticated
arbitrary-remote-code channel. It now also carries a **new class of command**: one that
ends the terminal process. **No new network exposure is created.** The channel was
already dialled on every validate and every heal tick, and the private-network rule
above is unchanged and still absolute.

**The narrowing that pays for it.**
- **ONE verb:** `Mt5Client.recycle_terminal_process` in
  `analytics-service/services/mt5_client.py`. It is NOT `Mt5Client.restart`, which
  reconnects the rpyc socket and never touches the terminal.
- **ONE committed constant:** `_REMOTE_TERMINAL_RECYCLE_SRC`, bound as
  `_REMOTE_TERMINAL_RECYCLE_FN`. It is a plain string literal with no interpolation. The
  one run-time value, the exit wait, crosses as an int argument. It ends every
  `terminal64.exe` via Toolhelp32 + `TerminateProcess` and does nothing else.
- **No general execution helper** and no `__getattr__` passthrough.
- **No credential.** The verb's signature takes no parameter at all.
- **The Wine prefix and the `/config` volume are never touched** (D-07, one-way).
- The decision to fire belongs to the credential-free IPC detector,
  `Mt5Client.assert_session_authorized`. The verb only acts.
- `analytics-service/tests/test_mt5_client_contract.py` enforces all of this. Its
  `TERMINAL_RECYCLE` tests check: the constant is an AST string literal with no brace;
  the source can only end a process; the signature takes nothing; an abandoned session
  is refused before anything crosses; an absent transport raises; a remote traceback is
  scrubbed.

**The live spike that proved the mechanism (founder, 2026-09-25; no agent touched the
gateway).**
- **Process tree.** `wineserver` and `winedevice` run alongside two bridge processes.
  The Linux-side one is `python3 -m mt5linux --host 0.0.0.0 -p 8001 -w wine python.exe`.
  The Wine-side one is `python.exe /tmp/mt5linux/server.py --host 0.0.0.0 -p 8001`, and
  it is the interpreter the rpyc channel executes in. The terminal is
  `C:\Program Files\MetaTrader 5\terminal64.exe`, with `WINEPREFIX=/config/.wine`.
- **Image launch.** The running container's `/Metatrader/start.sh` starts the terminal
  as `$wine_executable "$mt5file" $MT5_CMD_OPTIONS &` and starts the bridge afterwards.
- **Run 1.** The terminal process was killed and was gone within 5 s. About 25 s later a
  new `terminal64.exe /portable` (ppid 1) appeared with no human relaunch. It was logged
  in, read-only, with live quotes, 86 s after the kill. No password was typed.
- **Run 2.** The terminal was killed and was gone within 1 s. A new
  `terminal64.exe /portable` (ppid 1) appeared about 4m45s later, again with no human
  action. It was still up with live quotes 7h35m later.
- **The bridge survived.** Its pids were unchanged throughout (10 days of uptime).
- **What relaunched it.** `/portable` is the MetaTrader5 Python package's
  `initialize()` launching a terminal that is not running. The bridge's own next
  `initialize()` did the relaunch. So a **recycle is: terminate the process, then call
  `initialize()`.** No Linux-side launch command is needed. The two runs' different
  delays were simply when the next caller arrived. The verb removes that wait by issuing
  the relaunch `initialize()` itself.

**Caveats. Read these before trusting a recycle.**
- **The terminal is shared, with per-call login.** After a relaunch it sat on whichever
  account the last service call had logged in to. In run 2 that was a different account
  on the same broker. Nothing may assume a fixed account after a recycle.
- **The relaunched terminal runs with `/portable`; the original did not.** In portable
  mode the data directory is the install directory, not the per-user one. Both came
  back authorized. However, a setting changed while the terminal is portable lands in a
  different directory from one changed under the image's own launch, and a container
  restart returns to the non-portable launch. So read terminal state LIVE
  (`terminal_info()`), never from a config file.
- **Not yet exercised live: the terminate issued over the channel.** The spike ended the
  terminal with a Linux-side `kill`. The verb ends it from the Wine-side bridge
  interpreter with `TerminateProcess`. Both are an abrupt end of the same process, and
  the relaunch half is identical. Even so, the first live run of
  `recycle_terminal_process` is the measurement that closes this caveat. Until then,
  treat a recycle verdict's `terminated` / `exited` counts as the only evidence the
  terminate landed.
- **`/gsd-secure-phase` must run before Phase 164.6.5 closes.** That is part of what
  ratifying Option 2 ratified.

## ⚠️ T-134-03 POSTURE CHANGE — file deletion under the volume (Phase 164.6.6.1, terminal_scrub)

**Decision.** Ratified by the founder through 164.6.6 D-03 (2026-09-27: saved accounts and
history are removed, and the jobs terminal keeps its Journal `Logs`) and D-04 (i)
(2026-10-04: scrub on every `ipc_fault` recycle; the jobs terminal's `trades` caches only
after Phase 164.6.6.3). D-03 reverses 164.6.5 D-07 for saved accounts and history only.
The recycle verb above is unchanged and still deletes nothing.

**Why this beat the others.** A credentialed relaunch from a terminal with no
`accounts.dat` replaces re-saving the house password. That is the ROADMAP's "(or a
credentialed relaunch)" branch. It was chosen because re-saving needs a terminal that
answers, and the terminal wedged by L7 did not. Removing the saved-account database is
what stops a stale saved house password from wedging the terminal again.

**What changes, stated plainly.**
- The channel is still an unauthenticated arbitrary-remote-code channel. It now also
  carries a **new class of command**: deletion of `Config/accounts.dat` under the install
  directory and, behind an int flag, the children of `Bases/<server>/trades` (the
  per-account deal caches). **No new network exposure is created.** The private-network
  rule above is unchanged.
- **ONE verb:** `Mt5Client.scrub_terminal_account_data(*, delete_trades: int)` in
  `analytics-service/services/mt5_client.py`. **ONE committed constant:**
  `_REMOTE_TERMINAL_SCRUB_SRC`, bound as `_REMOTE_TERMINAL_SCRUB_FN`. It is a plain string
  literal with no interpolation. Its two run-time values (the exit wait and the flag)
  cross as int arguments. It takes no credential.
- **The literal refuses unless every matched process exited.** It deletes only when at
  least one `terminal64.exe` matched, every match was terminated and exited, and the
  process walk did not fail. Otherwise it returns a named refusal and every file stays.
  A running terminal can rewrite `accounts.dat` from memory (A4).
- **It never names** the Journal logs, the mail or subscriptions folders, `common.ini`
  or `servers.dat`. `common.ini` carries the `[Experts]` keys trade-capability
  classification reads, and `servers.dat` is what the credentialed relaunch needs. The
  per-user profile directory is only counted, never deleted.
- **The job path deletes `trades` only after Phase 164.6.6.3 ships** its bounded history
  wait (RESEARCH Finding C). Until then it passes `delete_trades=0`. The validation path
  passes `1`.
- **The verb never relaunches.** It records a per-terminal relaunch debt before the
  terminate crosses. Every caller must follow it with a CREDENTIALED house relaunch,
  because a bare `initialize()` against a terminal with no saved account hangs or returns
  `-10005`.
- **The launch-mode divergence.** A container restart launches the terminal through
  `start.sh` with no `/portable`. An `initialize()` relaunch launches
  `terminal64.exe /portable`. The data directory is the install directory either way
  (CONTEXT S-07), so the scrub's one target directory is the same under both.
- `analytics-service/tests/test_mt5_client_contract.py` enforces all of this. Its
  `TERMINAL_SCRUB` tests run the committed body offline against a scratch tree. They
  check each refusal (no match, not terminated, not exited, walk failed) and confirm
  every file survives it. They also check: the flag removes only the `trades` children;
  the literal names no forbidden target; the signature takes one keyword-only int; no
  `initialize()` follows the terminate.
- ⚠️ **Not yet exercised live: the delete issued over the channel.** The 2026-10-04 spike
  deleted by hand over `railway ssh` (CONTEXT S-02, S-09). The first live run of this verb
  is the measurement. Until then, treat its `refused`, `accounts_deleted` and
  `trades_deleted` counts as the only evidence of what was deleted.

## T-134-03 (Phase 164.6.6, D-07 part 1) — private-host check on the dialling side

**What is now CHECKED.** The analytics service refuses to dial an MT5 gateway at any host
that is not a private-network name. `services/mt5_client.py::is_private_gateway_host` is
the one predicate. It is checked at the top of `_default_connect`, the only production
transport factory, before `mt5linux` is imported, so no connection is ever built toward a
refused host. Both endpoint readers in `services/mt5_relogin.py` apply it as well, so a
refused validation host takes the existing misconfiguration path: the wizard's 500
`MT5_GATEWAY_UNCONFIGURED` and the worker's `RuntimeError`, each with the D-05 alert. A
refused job host makes the heal and the session monitor skip with a log-once line that
names the env var, never its value. A test pins that no other production file imports
`mt5linux` or opens an rpyc connection.

**The allowlist, in words.**
- A name whose last label is `internal`, `test` or `localhost`. Railway's private DNS
  lives under `.internal`.
- A single-label name, which resolves only through the container's own search domain.
- An IP literal inside loopback, RFC 1918, 100.64.0.0/10 (the Tailscale fallback in
  `docker-compose.yml`) or IPv6 unique-local.

Everything else is refused: a Railway public domain, a TCP-proxy host, any other public
name and any public IP, including the numeric forms the resolver accepts. The stdlib's
private-address flag is not used, because it admits documentation ranges.

**Why authentication was not taken.** D-07 asked for "authentication OR network
isolation". Authentication would need the server to cooperate:
- `mt5linux` 0.1.9 hardwires `rpyc.classic.connect(host, port)` on the client.
- The server is the package's own `server.py` inside the prebuilt image, which this repo
  does not build. Phase 164.6.5 rejected owning that image (see "Why Option 2 beat the
  other two" above).

An rpyc authenticator, SSL or a TLS sidecar all require changing that image. Network
isolation is the branch this repo can deliver.

**What the code does NOT prove.** The check proves what the analytics service DIALS. It
does not prove that a gateway has no public listener. That half stays a founder-read
infrastructure fact: reading N-01 (no public domain and no TCP proxy on either gateway
service) and live check L-H3.

**The boundary, and its residual.** The check isolates the channel from the PUBLIC
internet only. Inside the Railway environment's private network the rpyc port is still
unauthenticated, so every service on that network can reach both terminals. N-01 counted
six services there, all this product's own: the analytics service, the backfill worker,
the two gateways and two idle function services. That was already true before this
phase. The founder's answer is CONTEXT's `H3-CHANNEL-RESIDUAL: accepted` (2026-10-03).
Closing the residual would need rpyc authentication in the gateway image, or the gateways
in their own environment, which is future infrastructure work.

## Service source

Deploy from a prebuilt Docker image (Railway → New Service → **Deploy from Docker
Image**):

```
Image:  gmag11/metatrader5_vnc:2.3
```

- `gmag11/metatrader5_vnc:2.3` = `latest`, **linux/amd64 only** (~1.57 GB compressed,
  ~4 GB on disk). Do NOT schedule this on an ARM instance.
- **PIN THE DIGEST at stand-up.** The `:2.3` tag can be silently re-pushed. Record the
  resolved `sha256` in the runbook provenance line and pin the service to
  `gmag11/metatrader5_vnc:2.3@sha256:<digest>` so the *base* (Wine / Windows-Python /
  RPyC bridge) is reproducible. Get the digest at stand-up with:
  ```bash
  docker buildx imagetools inspect gmag11/metatrader5_vnc:2.3   # copy the sha256
  ```
  Note: pinning the digest pins the **image base only**. The MetaTrader terminal
  binary self-updates from the broker independently of the image and CANNOT be frozen
  — the soak window is the parity-break detector (see the runbook).

## ⚠️ DUAL-STACK ENVIRONMENT REQUIREMENT (Pitfall 1 — the load-bearing gotcha)

The gmag11 `start.sh` launches the RPyC bridge as
`python3 -m mt5linux --host 0.0.0.0 -p $mt5server_port` — an **IPv4-only** bind.
Railway private networking in **legacy (pre-2025-10-16) environments is IPv6-only**;
a service that binds only `0.0.0.0` is **UNREACHABLE** over an IPv6-only
`railway.internal`, even though the container is healthy and VNC works.

**The environment hosting this gateway (and the worker) MUST be a dual-stack
environment created AFTER 2025-10-16** — these support IPv4 *and* IPv6 private
networking, so the `0.0.0.0` bind is reachable at `gateway.railway.internal` with no
image change.

**Founder A2 check — do this BEFORE stand-up:** confirm the target Railway
environment is post-2025-10-16 dual-stack. If it is a legacy IPv6-only environment,
**create a new environment** or take the **VPS + Tailscale fallback**
(`docker-compose.yml`). Do NOT flip `MT5_ENABLED` against a legacy env — the worker's
`_make_mt5_session` connect would fail `connection refused`/timeout with the flag ON.

## Persistent volume

```
Mount:  /config
```

- The Wine prefix, the MT5 terminal install, and the **saved investor login** all live
  in `/config`. Lost on any volume-less redeploy → the one-time VNC install must be
  re-run.
- Railway volumes are **single-writer, one volume per service** [ASSUMED: exact volume
  UI path — Railway → service → Settings → Volumes → "Add Volume", mount path `/config`;
  confirm in the current dashboard]. A redeploy incurs brief downtime; **never** run
  two gateway deployments against one volume (Pitfall 6). Fine for a once-daily batch
  read — schedule the sync away from expected redeploys.

## Environment variables (gateway service)

Set these on the **gateway** service. `PASSWORD` is a gateway secret — store it in the
Railway secret store, **never in git**.

```
CUSTOM_USER     = <vnc user>
PASSWORD        = <vnc password>      # gateway secret, NOT in git
mt5server_port  = 8001
PIP_CONSTRAINT  = /config/mt5linux-constraint.txt   # see below — MANDATORY
```

## ⚠️ PIP_CONSTRAINT — the bridge does NOT work without it (Pitfall 5 — false-green)

`start.sh` installs `mt5linux`/`rpyc`/`numpy` **unpinned** on both the Wine and Linux
sides, and the resulting default versions leave the RPyC bridge **functionally dead
while it still logs `[7/7] server started on :8001`** — a bare TCP-connect / `LISTEN`
check passes, so this is a classic false-green. Three coordinated pins are required:

1. Copy **`deploy/mt5-gateway/mt5linux-constraint.txt`** (in this repo) to the gateway
   volume at **`/config/mt5linux-constraint.txt`**.
2. Set the gateway env var **`PIP_CONSTRAINT=/config/mt5linux-constraint.txt`**.
3. **One-time Wine numpy fix.** Because `start.sh` skips the Wine MetaTrader5/mt5linux
   reinstall when they're already present, the constraint alone does NOT downgrade the
   Wine-side numpy on an already-provisioned volume. Force it once:
   ```bash
   railway ssh --service <gateway> "s6-setuidgid abc bash -lc \
     'export WINEPREFIX=/config/.wine WINEDEBUG=-all PIP_CONSTRAINT=/config/mt5linux-constraint.txt; \
      wine python -m pip install --no-cache-dir \"numpy<2\"'"
   ```
   It persists on `/config` and survives boots (the MT5 reinstall stays skipped).

The three failure modes each pin prevents are documented inline in the constraint file.
**Verify the bridge is actually live** (not just listening) by attaching a client and
reading the account — `initialize()` must return `True` and `account_info()` must return
the real login, e.g. from inside the gateway container:
```bash
railway ssh --service <gateway> "python3 -c 'from mt5linux import MetaTrader5; \
  m=MetaTrader5(host=\"localhost\",port=8001); print(m.initialize(), m.account_info())'"
```

The **worker** carries the matching client libs: `rpyc==5.2.3` (pinned in
`analytics-service/requirements.in`, 5.x/<6) plus `mt5linux==0.1.9` installed `--no-deps`
in `analytics-service/Dockerfile`. Keep the worker rpyc on the 5.x line to match the
gateway's Wine-side rpyc-5 server.

## Environment variables (worker service — set AT FLIP, not at stand-up)

Set these on the **existing analytics-worker** service when you flip live (runbook
Step 6). They wire the worker's `_make_mt5_session` (`job_worker.py:926`) to the
gateway:

```
MT5_GATEWAY_HOST = gateway.railway.internal
MT5_GATEWAY_PORT = 8001
MT5_ENABLED      = true
```

## Validation gateway (Phase 164.6.6, D-02)

**What this is.** A SECOND gateway service that serves ONLY the two validate sites
(`routers/exchange.py::_validate_mt5_key_probe` and
`services/ingestion/mt5.py::Mt5Adapter.validate`). Every other MT5 caller keeps using the
job gateway described above. The founder chose this on 2026-09-27 (D-02, option (b)), so
that a client's key validation logs in on a terminal the jobs never use and cannot
displace the account the job terminal is serving.

⛔ **Every step below is a FOUNDER act.** No agent creates, restarts, redeploys, ssh'es
into or configures either gateway. No agent logs into a broker, or enters or reads a
credential. **The job gateway is READ-ONLY throughout this section:** its memory reading,
its networking settings and its VNC reachability are read, and nothing on it is changed,
restarted or deleted.

**Placeholders.** `<validation-gateway>` is the new service, `<job-gateway>` is the
existing one and `<analytics-service>` is the analytics service. Never write a real service
name, host, digest, account number, broker server or password into this file or into a
reading you paste back. A service name is also its `.railway.internal` host prefix.

Each step says what to RECORD. The readings are labelled S-01, S-07, S-08 and N-01, and
they go into the phase record (`164.6.6-CONTEXT.md`, `## Stand-up findings`).

1. **Stand-up (D-02).** Create `<validation-gateway>` in the SAME Railway project and
   environment as the analytics service.
   - **Image.** Use the same `gmag11/metatrader5_vnc:2.3` image, pinned to the same
     digest the job gateway is pinned to (see `## Service source`). Do not pin a freshly
     resolved digest; the two gateways run the same base.
   - **Volume.** Give it its OWN named volume at `/config` (see `## Persistent volume`).
     ⛔ Never mount the job terminal's volume: one volume per service, and two
     deployments on one volume is Pitfall 6.
   - **Env keys.** Set the same gateway keys as `## Environment variables (gateway
     service)`: `CUSTOM_USER`, `PASSWORD`, `mt5server_port` and `PIP_CONSTRAINT`. Use a
     VNC password of its own, stored in the Railway secret store and never in git.
   - **Pins.** Follow `## ⚠️ PIP_CONSTRAINT — the bridge does NOT work without it
     (Pitfall 5 — false-green)` in full on the new volume. Copy
     `deploy/mt5-gateway/mt5linux-constraint.txt` to `/config/mt5linux-constraint.txt`,
     and run the one-time Wine `numpy<2` fix against `<validation-gateway>`.
   - **Dual-stack.** `## ⚠️ DUAL-STACK ENVIRONMENT REQUIREMENT (Pitfall 1 — the
     load-bearing gotcha)` applies unchanged. The bridge binds IPv4-only, so the new
     service must sit in the analytics service's post-2025-10-16 dual-stack environment,
     or step 5 cannot reach it.
   - **Record:** that the digest matches the job gateway's (yes/no). Do not paste the
     digest itself.

2. **Private networking only (T-134-03, D-07 part 1).** The new rpyc port is the same
   unauthenticated arbitrary-remote-code channel as the job gateway's (see the `HARD
   CONSTRAINT` block at the top of this file). It must be reachable ONLY at
   `<validation-gateway>.railway.internal`.
   - ⛔ Never attach a public domain to `<validation-gateway>`.
   - ⛔ Never add a TCP proxy to `<validation-gateway>`.
   - Step 8 reads this back on BOTH gateways.

3. **Sizing (S-01 sizing, RESEARCH open question 4).**
   - **BEFORE the install,** read two figures from `<job-gateway>`, read-only: its
     configured memory limit, and its peak memory over the longest window the Railway
     service metrics show.
   - Set the new service's memory limit to AT LEAST the job gateway's limit.
   - **AFTER the install** (step 5 done), read the new service's own peak.
   - **Record:** the job gateway's limit and peak, the new service's limit and peak, and
     the metrics window. A new-service peak within 10% of its limit is recorded as a
     FINDING, not waved through. The 10% is a planner heuristic the founder may adjust.

4. **One-time VNC install.** Reach noVNC `:3000` on `<validation-gateway>` once, under the
   same rules as `## One-time VNC install access (torn down afterward)`.
   - Install the terminal.
   - Do step 4a in this same session, BEFORE adding the house account.
   - Add the house account with its INVESTOR password and enable "save account /
     auto-login".
   - Tear VNC down: remove the port-forward, or the temporary public domain if one was
     used.

4a. **Expert Advisors options (without them the new terminal refuses every key).**
   `docs/runbooks/mt5-go-live.md` `## Step 2 — ONE-TIME VNC INSTALL + INVESTOR LOGIN
   (MT5GW-01)` item 4 applies here word for word. Read it there rather than from a copy.
   - **Why it bites harder here.** The validation terminal changes account on EVERY
     validation. With the external-Python-API trade disable on, which is how MetaQuotes
     ships it, every validation is refused as undetermined (D-31).
   - **In *Tools, Options, Expert Advisors*,** the founder sets these four options and
     records each one yes/no as it reads on screen:
     - "Allow algorithmic trading": TICKED.
     - "Disable automatic trading through the external Python API": UNTICKED.
     - The option named by `services/mt5_validation.py::ACCOUNT_CHANGE_ALGO_DISABLE_OPTION`:
       UNTICKED. That symbol's comment explains why every validation counts as an account
       change.
     - "Disable algorithmic trading when the profile has been changed": UNTICKED. This is
       the second box named in `scripts/mt5-diag.sh`'s "Reading the result" note.
   - ⛔ **No repo path writes a terminal option** (164.6.5 criterion 7). This is a founder
     act at the console. The repo only records what was read.

5. **S-01: the new terminal reaches `authorized` over the private network.** Run this
   AFTER the house login, WHILE `<job-gateway>` is also logged into the house account.
   - **The reading.** Run `scripts/mt5-diag.sh` (it uses `railway ssh`, so the FOUNDER
     runs it) from the analytics service's side, so the dial crosses the private network:

     ```
     MT5_DIAG_SERVICE=<analytics-service> \
     MT5_DIAG_HOST=<validation-gateway>.railway.internal \
     MT5_DIAG_PORT=<its mt5server_port> \
     ./scripts/mt5-diag.sh
     ```

     The analytics image carries the `mt5linux` client (`analytics-service/Dockerfile`),
     so this runs the read-only `initialize()` + `terminal_info()` across
     `*.railway.internal`, the same path the validate sites will dial.
   - **Fallback.** `MT5_DIAG_SERVICE=<validation-gateway>` with the default host dials
     loopback INSIDE the new container. It reads the terminal's flags, but it does NOT
     prove private-network reachability. If you use it, record S-01's reachability half as
     not measured.
   - **Record:**
     - `initialize()` true/false, and `last_error` if it is false.
     - Whether the new terminal shows `authorized` for the house account (yes/no), and the
       time from login to `authorized`.
     - Whether `<job-gateway>` stayed authorized on the house account through the reading
       (yes/no). Read this without logging it in or out.
     - The `terminal_info()` read-back the script prints: `connected`, `trade_allowed` and
       `tradeapi_disabled`, each true/false.
   - **Pass** is `connected` true, `trade_allowed` true and `tradeapi_disabled` false. That
     is the go-live runbook's own Step 2 Verify line and its `## Step 5 — GATE-CHECK` row
     `TERM`. ⚠️ For this gateway all three flags are the bar. Do not read the diag note's
     remark about `tradeapi_disabled` as a waiver.
   - **What the read-back covers, and no more.** The three flags are the terminal's live
     state. The account-change option cannot be read directly (see its symbol's comment).
     `trade_allowed` still true after the house login is the only consequence reading
     available before deploy. The on-screen reading in step 4a is the primary record.
   - **Any other read-back blocks plan 04 Task 3** (setting the routing env vars). The
     founder fixes the option over VNC (step 4a) and re-reads.

6. **S-07: directory layout.** Record the directory layout observed on the new volume
   under `/config`, plus whether the terminal runs in portable mode (`/portable`). See the
   portable-mode caveat in the T-134-03 posture section above: the data directory moves.
   - Record directory NAMES only. Replace any user name with `<user>`.
   - This is the layout the Phase 164.6.6.1 scrub will target.

7. **S-08 (live check L6): VNC reachability on BOTH gateways.** For each of
   `<job-gateway>` and `<validation-gateway>`, record whether VNC port 3000 is reachable
   today, and by whom. The answer is one of: reachable publicly, torn down, or reachable
   only through a port-forward. The job gateway is read, not changed.

8. **N-01 (H3 part 1, D-07): no public exposure on EITHER gateway.**
   - **Record per gateway,** from each gateway service's Settings, Networking:
     - Public domain present (yes/no).
     - TCP proxy present (yes/no).
   - **Any "yes" is a finding that blocks plan 04's deploy** until it is removed. If you
     remove one, record both the before and the after.
   - **The lateral-reachability residual.** From the Railway project canvas for the
     environment the gateways run in, record every service on that environment's private
     network: the COUNT, and each one's ROLE in words, for example "the analytics service",
     "the job gateway", "the validation gateway" or "a database proxy". ⛔ Never write a
     service name, which is its `.railway.internal` host prefix, and never write a host.
     The rpyc port stays unauthenticated to every service on that list. That is the D-07
     part 1 residual, and plan 02 Task 2 puts it to the founder.
   - This is the gateway-side half of D-07 part 1. The analytics side's refusal to dial
     anything but a private-network host is enforced in code (plan 05). That proves what
     the service DIALS, not that a gateway has no public listener.

9. **Analytics-side env names (set by plan 04 Task 3, not at stand-up).** On the analytics
   service:

   ```
   MT5_VALIDATION_GATEWAY_HOST = <validation-gateway>.railway.internal
   MT5_VALIDATION_GATEWAY_PORT = <its mt5server_port>
   ```

   These sit beside the job pair (`MT5_GATEWAY_HOST` / `MT5_GATEWAY_PORT`), which keeps its
   names. ⚠️ **D-05 fails loud.** Once plan 04's routing change deploys, every validation
   is refused with `MT5_GATEWAY_UNCONFIGURED` and an alert fires until BOTH are set. There
   is NO fallback to the job terminal, because a fallback would silently bring the
   eviction back.

10. **The house credentials stay on the analytics service.** They are the names read by
    `services/mt5_relogin.py::read_env_mt5_credentials`. They never go on either gateway.
    The house account is added on the new terminal only through the step 4 VNC login.

11. ⛔ **What this section does NOT do.** It runs no scrub, deletes no account data and
    relaunches nothing.
    - The scrub spike belongs to Phase 164.6.6.1 (plan 164.6.6.1-01) and runs on this
      gateway later.
    - Until then, the validation terminal accumulates every client account validated on it
      (the "interim residue" in `164.6.6-CONTEXT.md`).
    - Known gap, routed by D-06 to Phase 164.6.8 (`MT5-VALIDATION-TERMINAL-COVERAGE-01`):
      the session monitor, boot heal, `ipc_fault` recycle and prod-prober MT5 arm all read
      only the job pair. That leaves this terminal dark to all four. A wedged or logged-out
      validation terminal is noticed only when a validation fails.

## One-time VNC install access (torn down afterward)

Reach noVNC `:3000` **once** to install the terminal and add the investor login:

- **Preferred:** `railway run` / port-forward the `:3000` port to your laptop, or an
  SSH-tunnel [ASSUMED: exact Railway port-forward invocation — confirm current CLI].
- **Or:** a **TEMPORARY, password-gated public domain** on the gateway service that you
  **tear down immediately after install**.

**Do NOT leave `:3000` publicly reachable after install** (Pitfall / T-139-06). From
then on, only the worker reaches `:8001` privately over `gateway.railway.internal`.

## Broker egress note (Pitfall 4)

If the broker IP-allowlists, it keys off the **GATEWAY** egress IP — the *terminal*
makes the broker connection, NOT the worker. On Railway the gateway egresses from
Railway's static set which **rotates within a set → whitelist ALL** (the v1.13 lesson).
A VPS gives one stable IP if the broker requires a single address. Most brokers do NOT
IP-restrict investor logins [ASSUMED A1 — confirm with the chosen broker].
