# Runbook — MT5 Go-Live (MT5GW-01 / MT5GOLIVE-01 / MT5GOLIVE-02, Phase 139)

**Owner:** founder (every leg is a LIVE op — no autonomous run can execute it) ·
**Audience:** whoever stands up the MT5 gateway and flips MT5 live ·
**Risk:** exposing the RPyC bridge publicly (unauthenticated RCE), flipping the flags
on an ASSUMED-green gate, standing up on a legacy IPv6-only Railway env (the worker
silently can't reach the gateway), or whitelisting the WRONG (worker) egress IP at the
broker. The mitigations are the **PRIVATE NETWORK ONLY** hard constraint (every step),
the explicit **GATE-CHECK** (never assumed, Step 5), the dual-stack A2 check (Step 0),
and a **ROLLBACK** so trivial it removes all flip risk (Step 8).

## Why this document exists

MT5 shipped **dark** through Phases 134–138 (both flags empty; the derive branch,
badge, and wizard card all flag-gated and byte-identical when OFF — the 138 guarantee).
This runbook takes it from dark to **LIVE**: a prod Wine gateway stood up, a real broker
investor account onboarded and soaked to reconstructed-vs-live equity parity, then
`MT5_ENABLED` (Railway worker) + `NEXT_PUBLIC_MT5_ENABLED` (Vercel) flipped, with an
`api_verified` MT5 strategy rendering LIVE across every surface and role.

The buildable half — this runbook + the `deploy/mt5-gateway/` templates + the
`scripts/mt5_soak.py` soak runner (Phase 139-01) — lands now. The live legs
(stand-up, VNC install, broker onboard, soak RUN, flag flip, prod verify) are
`human_needed` — a skipped gate is NEVER claimed done.

The two flags this runbook flips (both empty today):

| Flag | Plane | Effect | Redeploy needed |
|------|-------|--------|-----------------|
| `MT5_ENABLED` | Railway worker service env + Vercel prod env | server-side enable: gates `mt5_enabled_server` (worker, `closed_sets.py`) AND `isMt5EnabledServer` (Vercel validate-and-encrypt route) | yes — redeploy the worker AND redeploy Vercel |
| `NEXT_PUBLIC_MT5_ENABLED` | Vercel prod client env | shows the MT5 card in the add-key wizard picker | yes — `NEXT_PUBLIC_*` is baked into the client bundle at BUILD time; an un-redeployed Vercel env change is a **silent no-op** (Pitfall 3) |

Worker transport env (`MT5_GATEWAY_HOST` / `MT5_GATEWAY_PORT`) wires
`_make_mt5_session` (`job_worker.py:926`) to the gateway; set them at the flip too.

**Standing rule: abort at ANY step → jump to [Step 8 — ROLLBACK].** The gate is
explicit and the flip is env-only, so aborting is always safe and always cheap.

---

## Step 0 — HOST DECISION + the A2 dual-stack check (MT5GOLIVE-01, founder call)

**The load-bearing fact:** the RPyC bridge (`:8001`) is an **unauthenticated
arbitrary-remote-code channel** (Phase-134 T-134-03) → it MUST be reachable over a
**private network only**, never a public port. That reframes the host choice:

| Option | Private-net to worker | Image change? | Static gateway IP | Verdict |
|--------|-----------------------|---------------|-------------------|---------|
| **Railway co-locate, NEW dual-stack env** | `gateway.railway.internal:8001`, **zero tunnel** (same-project WireGuard mesh) | **None** (dual-stack IPv4 private reaches the image's `0.0.0.0` bind) | Railway egress set (rotates → whitelist all) | **PRIMARY** |
| Railway co-locate, LEGACY IPv6-only env | `railway.internal` is IPv6-only | YES — rebuild image to bind `::` (`start.sh` hardcodes `0.0.0.0`) | same | avoid (Pitfall 1) |
| VPS (Hetzner/Contabo amd64) + Tailscale | worker joins tailnet → gateway tailscale IP | None | VPS public IP = clean single static IP | **FALLBACK** (best for broker allowlisting) |
| Fly Machine + Tailscale | cross-provider → SAME tunnel as VPS | None | `fly ips allocate-v4` dedicated | secondary — no advantage over VPS |

**Railway co-locate in a NEW dual-stack environment is PRIMARY** (research correction
2026-07-24): the only option where the RPyC channel never leaves one provider's
encrypted internal mesh and no tunnel software is introduced. **VPS + Tailscale is the
FALLBACK** (clean single static IP, best when the broker allowlists). **Fly is
secondary** — cross-provider means it needs the same tunnel as a VPS while adding a
second PaaS, so it buys nothing here. Do NOT regress to the superseded
"Fly reuse-ops vs Railway co-locate" framing.

**⚠️ A2 CHECK — do this BEFORE standing up (Pitfall 1):** confirm the target Railway
environment is a **post-2025-10-16 dual-stack** environment. The gmag11 image binds
IPv4 `0.0.0.0`; a legacy IPv6-only `railway.internal` cannot reach it, so with the flag
ON the worker's `_make_mt5_session` connect fails `connection refused`/timeout even
though the container is healthy and VNC works. If the env is legacy, **create a new
environment** or take the VPS fallback.

- **Verify:** host chosen; if Railway, the environment is confirmed dual-stack
  (post-2025-10-16); the matching `deploy/mt5-gateway/` template is selected.
- **Abort path:** env is legacy IPv6-only and no new env can be created → switch to the
  VPS + Tailscale fallback (`deploy/mt5-gateway/docker-compose.yml`) BEFORE any stand-up.

## Step 1 — STAND-UP (MT5GW-01)

Deploy the gateway per the chosen `deploy/mt5-gateway/` template (Railway
`railway-gateway.md` primary / VPS `docker-compose.yml` / Fly `fly.toml`). Set
`CUSTOM_USER`/`PASSWORD` (the gateway VNC secret — host secret store, NEVER git) and
`mt5server_port=8001`. Mount `/config` on the persistent volume.

**Image digest provenance — FILLED 2026-09-19 (was blank since stand-up):**

```
Provenance: gmag11/metatrader5_vnc:2.3@sha256:2fdff449cf70b74c242319828b6859592ab52dfb05690d9a989c75107dabf4c1
Pin verified: 2026-09-19  on host: Railway  (service mt5-gateway)
Stood up:   NOT ESTABLISHED — see note below
```

⭐ **Both halves were measured, and they AGREE.** `docker buildx imagetools inspect
gmag11/metatrader5_vnc:2.3` resolves to that digest, and the live Railway service instance
carries the identical `image` ref including the `@sha256:` suffix. The pin is real, not aspirational.

⛔ **`Stood up:` is deliberately NOT a date, and must not be quietly filled with one.** Nothing
measured establishes it: the deployment on record for this service carries a REDEPLOY reason, so it
is not the stand-up event. The verification date above is a different fact and is labelled as one.
Substituting it would turn an unknown into a false record — leave this as NOT ESTABLISHED until
someone has evidence of the actual stand-up.

Get the `sha256` with `docker buildx imagetools inspect gmag11/metatrader5_vnc:2.3` and
pin the service to that digest.

**⚠️ Terminal self-update correction (Pitfall 2 — do NOT chase a non-existent
switch):** the gmag11 README states plainly that the MetaTrader program is
`updated independently` from the image — the MT5 terminal binary **self-updates** from
the broker and this **cannot be disabled** (there is **NO auto-update switch to
disable**). Only the **image tag + `sha256`
digest** is pinnable (that pins the Wine/Python/RPyC base, not the terminal). Accept the
terminal self-update as a managed risk: the **soak window is the parity-break detector**
— a terminal-update-induced parity break reddens a soak run before the flip. A reviewer
who sees "pin/disable auto-update" in older ROADMAP prose should know it **cannot be
disabled**; do not look for a toggle that does not exist.

**⚠️ HARD CONSTRAINT — PRIVATE NETWORK ONLY (non-negotiable):** the RPyC bridge
(`:8001`) is an UNAUTHENTICATED arbitrary-remote-code channel (Phase-134 T-134-03).
Never a public port, never a public domain, no `[[services.ports]]`/`[http_service]`
handler — no exceptions. Railway: no public domain, reachable only at
`gateway.railway.internal:8001`. VPS: both ports bound to `127.0.0.1`. Fly: no public
port handler; tunnel only.

**⛔ INVARIANT — SINGLE REPLICA, BOTH SERVICES (153.3 / D-33). The mt5-gateway service
and the analytics service that talks to it each run at EXACTLY ONE replica. Scaling
either is a CORRECTNESS change, not a capacity change.** This is stated as an invariant,
not as a setting, because it cannot be re-derived from the dashboard: nothing in either
service fails loudly when a second replica appears.

The mechanism, so a future operator can *evaluate* this rather than obey it:

1. `mt5linux` serves **every** RPyC connection from ONE `ThreadedServer` process sharing
   ONE `MetaTrader5` module instance, so there is ONE IPC pipe and ONE logged-in account
   per gateway (`153-EVIDENCE-mt5-platform.md` §A2 / Correction C-1). MT5 binds one
   account per terminal AT A TIME.
2. Our serialization of that terminal is a **per-event-loop `asyncio.Lock`**
   (`analytics-service/services/mt5_concurrency.py`). A second analytics replica has its
   own process, its own event loop, its own lock registry and its own `Lock` objects — so
   it serializes **nothing** against the first one.

A second replica of either service therefore reintroduces exactly the interleaved
`login()` race the lease was added to remove: two validations land on the ONE terminal,
the second re-points it under the first, and a capability verdict can be judged against
another account. The in-process detector (`_assert_expected_login`) still fails the
request CLOSED, so the symptom is not silent corruption — it is a validate path that
starts failing transiently for no visible reason.

**Raising the replica count requires a durable CROSS-PROCESS serializer first** (a
Postgres advisory lock or equivalent), not a flag. Wanting more replicas is a `TODOS.md`
item, not a knob. Two gateways would need two accounts and a routing rule as well.

- **Verify:** container healthy; the digest is recorded in the provenance line above;
  the service has NO public domain / no public port handler (grep the chosen template
  proves it); `/config` volume mounted; **replica count = 1 for the mt5-gateway service
  AND for the analytics service — read the value and record it, never assume it**.
- **Abort path:** any public exposure of `:8001` observed → tear it down immediately and
  go to [Step 8 — ROLLBACK]; the flip never proceeds with a public RPyC surface. Either
  service showing >1 replica → scale it back to 1 BEFORE the soak, and treat every soak
  run taken while it was >1 as void.

## Step 2 — ONE-TIME VNC INSTALL + INVESTOR LOGIN (MT5GW-01)

1. With `/config` on the persistent volume and `CUSTOM_USER`/`PASSWORD` set, reach
   noVNC `:3000` **ONCE** — via a `railway run`/port-forward, `fly proxy 3000:3000`, or
   an SSH tunnel (VPS), or a TEMPORARY password-gated public domain. Do NOT leave
   `:3000` publicly exposed.
2. In the terminal: install → add the broker account with the **INVESTOR (read-only)
   password** → enable "save account / auto-login". The saved login persists in
   `/config`.
3. Verify the VNC-displayed **server clock** against UTC to confirm the
   broker-server-time offset — this closes the Phase-134 leg-4 `[ASSUMED]` estimate and
   feeds `MT5_SOAK_SERVER_OFFSET_MIN` (139-01) / the 136 UTC-normalization seam.
4. **⛔ TURN OFF the terminal's external-Python trade disable — every MT5 validation
   fails while it is on (153.3 / D-31).** In the same VNC session, open
   *Tools → Options → Expert Advisors* and clear the option **"Disable automatic trading
   through the external Python API"**. MetaQuotes ships this option **ON by default, for
   security reasons**, and while it is in force `order_check` from Python is refused
   **regardless of investor vs master** — so a MASTER password produces exactly the two
   negatives an investor password produces and the two are indistinguishable.

   As of Phase 153.3 the service **REFUSES a key it cannot classify** rather than
   stamping it read-only (D-31: the old rule was a fail-OPEN on the one security property
   the probe exists to prove). The consequence is blunt: **with this option on, EVERY MT5
   validation fails.**

   - This turns off the *terminal's* Python-API trade block. It does **not** change the
     account: leave the account itself logged in with the **INVESTOR** password, which is
     what actually makes the session read-only.
   - **Verification:** `terminal_info()` must report **`connected: true` AND
     `trade_allowed: true`**. Both, not either — a detached terminal is a documented
     SIBLING cause of the same refusal, so `connected: false` makes the signal
     unattributable and the service refuses on that too.
   - **Failure signature if you miss this:** a **permanent** `MT5_GATEWAY_UNCONFIGURED`
     refusal with `retryable: false` — never an accusation of the user's credentials, and
     never a `read_only: true` success. If a tester reports "my investor password is
     rejected as invalid", that is a DIFFERENT fault; this one never blames the key.

5. **TEAR DOWN** the public `:3000` access. From here only the worker reaches `:8001`
   privately.
6. Verify `/config` persistence: restart the service and confirm the saved login
   survives (no re-install needed).

- **Verify:** the investor login is saved and survives a restart; the server-time offset
  is recorded; the external-Python trade disable is OFF and `terminal_info()` reports
  `connected: true` + `trade_allowed: true`; `:3000` is no longer publicly reachable.
- **Abort path:** login does not persist across restart (volume not wired) or `:3000`
  cannot be torn down → fix the volume/networking; do NOT proceed to soak on an
  ephemeral install. `trade_allowed` still false after clearing the option → do NOT flip;
  every validation would refuse permanently.

### Step 2a — ⭐ Since Phase 164.6.2, the session is RE-established without a human (MT5-GATEWAY-LOGIN-01)

Step 2 above is unchanged and still required. This subsection sits BESIDE it, not in place of it.

- **The FIRST session still needs the one-time VNC login Step 2 describes.** Nothing here
  installs the terminal, adds the broker account or ticks "save account / auto-login". ⛔ Do
  not delete or soften Step 2 — it remains how a session comes into existence at stand-up.
- **What changed:** since Phase 164.6.2 the ANALYTICS service re-establishes the terminal's
  broker session from three of its OWN environment variables — `MT5_LOGIN`, `MT5_PASSWORD` and
  `MT5_SERVER`, set on the **`quantalyze-analytics`** Railway service (⛔ NOT on `mt5-gateway`
  — D-00 deliberately keeps the broker password out of the gateway container). It runs once at
  each analytics startup, as `heal_mt5_terminal_session` started from `main.lifespan`. Absent
  or malformed variables log one warning naming only the variable names and the boot continues.
- ⚠️ **The measured limit, stated as a limit:** the heal fires at **ANALYTICS** startup, NOT
  when the gateway restarts. A gateway restart that loses the saved session therefore leaves a
  window in which the prober's mt5 arm can still report the authorization failure, until the
  analytics service next starts. The size of that window is measured in Phase 164.6.2 (D-06);
  read the number there rather than from a figure restated here, which would rot.
- **If the session is lost:** first confirm the three variables are set on the analytics
  service (key names only — never read a value back), then restart the **ANALYTICS** service.
  ⛔ Not the gateway — "restart it" used to mean the gateway in this runbook, and restarting
  the gateway is now the one action that does NOT trigger the heal. It never did help on its
  own, either: the saved login lives on the persistent `/config` volume, so a terminal with no
  usable credential comes straight back with no usable credential. Only when the variables are
  absent, or the heal is observed not to fire, does Step 2's VNC route become necessary again.

## Step 2b — ⛔ `-10005` differential diagnosis: two known causes, opposite remedies (Phase 164.6.5)

Step 2a is about the heal that re-establishes a LOST session automatically. This section is
narrower: an operator is looking at a terminal that answers `-10005` ("IPC timeout") right
now and must decide which of two known causes they have, because the remedies are opposite.

### The two causes

**Cause A — the modal-login-dialog wedge (`MT5-WEDGE-OBS-01`).** PERSISTED state: a login
dialog is sitting open in the terminal's own UI and is blocking the IPC path behind it. It
lives with the Wine prefix on the gateway's named persistent volume, so a redeploy brings it
straight back — the dialog is still there after the container restarts. Clearing it needs a
human at the VNC console.

**Cause B — the account-switch wedge, measured 2026-09-21.** PROCESS state, not persisted
state: there was no dialog — the live VNC console was clean and the Alerts tab was empty —
yet the running terminal answered `-10005` to every IPC call. A human clicked OK on the
terminal's own Login dialog three separate ways and the terminal's own Journal wrote NOTHING
for any of the three attempts. A PROCESS restart of `terminal64.exe`, under the same Wine
prefix, same container and same volume, reached `authorized` in 2.0 s with no human involved
— Step 2a above records the mechanism that restart relies on (the saved login persisting on
`/config`).

⛔ **The two causes have OPPOSITE remedies, and the shipped prober remedy string
(`scripts/prod-prober/arms/mt5.mjs`'s `mt5-ipc-timeout` `REMEDIES` entry) described only
Cause A until this phase** — it told the reader to clear a modal dialog via VNC and stated a
redeploy does NOT fix the fault. Under Cause A that is correct. Under Cause B a process
restart — no VNC, no dialog to clear — is what worked, in 2.0 s.

### Evidence procedure — decide which cause you have

Run this at the gateway before changing anything. It reaches for evidence, not a guess.

1. **Open the terminal's own Journal tab.** A login attempt writes a Journal line EVEN WHEN
   IT FAILS, so silence in the Journal following a `disconnected` line is itself the
   reading, not an absence of information. Silence after a disconnect, with no failed-login
   line ever appearing, is what was observed for Cause B on 2026-09-21.
2. **Open the Alerts tab.** An empty Alerts tab during the outage is one of the two facts
   that ruled out Cause A on 2026-09-21 — a modal-dialog wedge typically leaves a trace an
   operator can see there.
3. **Look at the live VNC console itself for a modal window.** If a login dialog, an error
   popup, or any other modal is sitting open on top of the terminal, that is Cause A — clear
   it and stop here.
4. **Record the terminal's reported build number.** This does not by itself decide the
   cause; the candidate-mechanism subsection below is what uses it.
5. **⛔ Do not read `Config/terminal.ini` for any of the above.** `scripts/mt5-diag.sh`'s own
   warning applies here too: MT5 only rewrites that file on a CLEAN terminal exit, so it can
   report stale state while the running terminal disagrees. The Journal, the Alerts tab and
   the live VNC console are the only live oracles. `scripts/mt5-diag.sh` is the only in-repo,
   read-only diagnostic and is safe to run alongside this procedure — it never calls
   `login()`.

### The remedy that is correct under both causes

Try the **PROCESS restart first**: kill and relaunch `terminal64.exe` under the same Wine
prefix, container and volume — do NOT touch or reset the volume itself. This is cheap,
unattended, was measured at 2.0 s on 2026-09-21, and it cannot make Cause A worse: if a modal
dialog was the problem, the restart either clears it along with the process or leaves it
exactly as it was, so trying the restart first never destroys evidence. **If `-10005`
returns after the restart, THEN open the VNC console and clear the modal dialog** — that is
the one step a process restart cannot do for you.

### Candidate mechanisms for Cause B — what would confirm or reject each

These were written as candidates. Each carries the ONE observation that would confirm it and
the ONE that would reject it, and since 2026-09-25 each also carries its recorded verdict.

- **(a) Terminal self-update.** `deploy/mt5-gateway/railway-gateway.md`'s digest-pin
  paragraph records, in its own words, that the MetaTrader terminal binary self-updates from
  the broker independently of the image and cannot be frozen — pinning the image digest pins
  the Wine/RPyC base only. A terminal that self-updated between the clean switch and the
  wedged one is a mechanism that predicts the asymmetry, because a binary changing mid-day
  would behave differently before and after the change.
  - **Confirms:** the terminal's reported build number differs between a reading taken
    before the clean switch and one taken after the wedge began, OR the terminal's own
    update log records a self-update landing in that window.
  - **Rejects:** the build number is identical across that window and no self-update log
    entry exists for it.
  - **Verdict (2026-09-25): UNDECIDED.** The only build reading that exists is the one taken
    on 2026-09-25, AFTER two terminal restarts: terminal build 6182, server build 5830. No
    build reading from 2026-09-21 before 11:02 exists, and the capture recorded no
    self-update line for the 04:08 → 11:02 window. One reading cannot show a change. See the
    verdict subsection below for what would decide it.
- **(b) Same-account re-auth vs. cross-account switch.** The session monitor re-establishes
  the terminal's session against the house account on a fixed cadence and returns quickly
  when nothing needs to change; a validate re-establishes the same session against a client
  account, which is a genuine account change (`analytics-service/services/mt5_relogin.py`,
  `analytics-service/routers/exchange.py`). If the clean switch was itself a re-auth to the
  account already logged in, while the wedged switches were changes to a different account,
  that difference is a mechanism that predicts the asymmetry.
  - **Confirms:** the captured evidence shows the clean event was a re-auth to the SAME
    (house) account already logged in, while the wedged events were switches to a DIFFERENT
    (client) account.
  - **Rejects:** the captured evidence shows the clean event was ALSO a switch to a
    different account — i.e., a cross-account switch sometimes succeeds cleanly, which would
    mean "which account" alone does not predict the asymmetry.
  - **Verdict (2026-09-25): REJECTED, on the 2026-09-21 reading.** The Journal lines read
    during the incident, recorded in `.planning/ROADMAP.md` § `### Phase 164.6.6` success
    criterion 1, show the clean 04:08 event as `'<account A>': disconnected` at 04:08:06
    followed by `'<account B>': authorized` at 04:08:07. That is a change to a DIFFERENT
    account, and it completed in about one second. So a cross-account switch can succeed
    cleanly, and "same account vs different account" does not predict the asymmetry. ⚠️ The
    2026-09-25 capture could NOT re-read those 04:08 lines through VNC. This rejection rests
    on the 2026-09-21 reading alone, and it has not been re-verified.
- **(c) Same broker server vs a different broker server.** Surfaced by the 2026-09-25 capture:
  at one point the terminal's window title named an account at a DIFFERENT broker from the
  session the Journal was running. The shared terminal therefore switches across broker
  servers, not only across accounts, which is the Phase 164.6.6 surface. A switch to an
  account on another broker server has to drop one trade-server connection and open a
  different one. A switch within one broker keeps the same server. If the clean 04:08 event
  stayed on one broker server and the wedged 11:02 and 12:52 events changed server, that
  difference would predict the asymmetry.
  - **Confirms:** the broker server on each side of the 04:08 switch is the SAME, and on each
    side of the 11:02 and 12:52 switches it DIFFERS.
  - **Rejects:** the 04:08 switch also changed broker server, or a wedged switch stayed on one
    server.
  - **Verdict (2026-09-25): UNDECIDED.** The 2026-09-21 record redacts the server on both
    sides of every switch, and the 04:08 lines were not reachable on 2026-09-25. ⚠️ The
    founder's 2026-09-25 relaunch spike (plan 02 SUMMARY, run 2) came back authorized on a
    different account at the SAME broker. That run was a relaunch, not an in-session
    switch, so it neither confirms nor rejects (c).
- **Any further candidate.** None beyond (a), (b) and (c) is supported by the repo's measured
  record as of 2026-09-25. If a future investigation surfaces one, record it here with the
  same confirms/rejects shape rather than as a bare guess.

### Verdict — criterion 1 is EXPLICITLY OPEN (recorded 2026-09-25, Phase 164.6.5 plan 01)

⛔ **The mechanism behind Cause B is NOT named.** No candidate above predicts the asymmetry
on the evidence that exists. (b) is rejected, and (a) and (c) are undecided because the
deciding readings were never taken or can no longer be taken. Per D-01 and D-03, criterion 1
ships OPEN. It is not closed on a story, and it is not closed on a mitigation.

**The D-03a verdict, in one sentence:** the terminal-self-update hypothesis is UNDECIDED,
because no terminal build reading from 2026-09-21 before the 11:02 wedge exists and no
terminal update record for the 04:08 → 11:02 window was found. The build read on 2026-09-25
(6182, server 5830) was taken after two restarts and cannot show a change on its own.

**What the 2026-09-25 capture established.** The founder read these at the VNC console; no
agent touched the gateway.

- **Build:** terminal build 6182, server build 5830.
- **Journal:** the terminal was `disconnected` from 2026-09-21 12:52:04, with NO reconnect line
  until the founder's two restarts on 2026-09-25. Taken at face value, the second wedge of
  2026-09-21 (the ~12:52 validate) was never recovered until 2026-09-25. ⚠️ This plan records
  that reading and does NOT reconcile it with any other record of that period.
- **Log retention:** the 04:08 Journal lines were not reachable through VNC, and no terminal
  log files exist for 2026-08-06 to 08-11 or for 2026-08-26 to 08-31.
- **Experts options:** "Allow algo trading" CHECKED, and all four "disable …" options
  UNCHECKED. This does not bear on criterion 1. It is recorded because Phase 164.6.5
  criterion 7 pins those settings.
- **Alerts tab:** NOT read on 2026-09-25 before the terminal was restarted, and that state is
  gone now. The "Alerts tab empty" fact under Cause B above is the 2026-09-21 reading and was
  not re-taken.
- **Restart remedy:** REPRODUCED. Killing `terminal64.exe` and letting the bridge's next
  `initialize()` relaunch it brought authorization back with no human action, twice (plan 02
  SUMMARY). This is a MITIGATION finding under D-02, NOT a diagnosis: it says what clears
  Cause B, not what causes it.
- **Cause A (the modal dialog):** not observed on 2026-09-25.

**What would close criterion 1.** Readings taken at the NEXT Cause B wedge, BEFORE anything
restarts the terminal:

1. the terminal build at the wedge, and the build at the last clean switch before it;
2. the broker server on each side of the wedged switch and of the last clean switch;
3. the Alerts tab and the Journal lines around the `disconnected`.

⚠️ The automatic recycle this phase ships DESTROYS all three, because the wedge is process
state. Unless the heal records them first, the next wedge heals without evidence. The routed
residual is `MT5-SWITCH-WEDGE-CAUSE-01` in `TODOS.md`, cross-linked from `MT5-WEDGE-OBS-01`.

⛔ **Public repo, no exceptions.** Refer to accounts only as "the house account" and "a
client account" — never a number, never a broker server name, never a connection string or a
local machine path. Timestamps, durations and MT5 error codes (like `-10005`) are safe and
are kept above because they are the evidence.

## Step 3 — CREDENTIAL ISOLATION + BROKER ALLOWLISTING (MT5GOLIVE-01)

- The gateway holds ONLY the **one investor login** it syncs (v1 = one serial terminal).
  The worker passes creds per-sync through the encrypted slots (the 135 convention):
  **login → `api_key`, investor-password → `api_secret`, broker server → `passphrase`**
  (`_make_mt5_session`, `job_worker.py:925`). The VNC-saved login is that same investor
  account. Broker creds are NEVER stored in the gateway image.
- **Broker IP-allowlisting (if the broker requires it) keys off the GATEWAY egress IP —
  NOT the worker's Railway static egress set** (Pitfall 4; the opposite of the sFOX
  model, where the worker egress is what sFOX whitelists). The *terminal* makes the
  broker connection. On Railway the gateway egress rotates within a set → whitelist ALL
  (v1.13 lesson); a VPS/Fly-dedicated IP gives one stable address.
- Most brokers do NOT IP-restrict investor logins **[ASSUMED A1 — confirm with the
  chosen broker]**.

- **Verify:** the gateway holds only the one investor login; if the broker allowlists,
  the GATEWAY egress IP(s) are whitelisted (whole set on Railway).
- **Abort path:** interactive VNC login works but the automated gateway-driven login is
  geo/IP-blocked → you whitelisted the wrong IP (worker vs gateway); fix at the broker,
  do NOT flip.

## Step 4 — SOAK (MT5GOLIVE-02)

Run the 139-01 soak/parity runner daily over the window:

```bash
cd analytics-service && python -m scripts.mt5_soak
```

Set the `MT5_SPIKE_*` credential env (reused verbatim) + the confirmed
`MT5_SOAK_SERVER_OFFSET_MIN` (from Step 2) + `MT5_SOAK_LOG_DIR`. Each run reconstructs
NAV from the deal ledger (`combine_mt5_deal_ledger`) and asserts
`|reconstructed − live equity| ≤ max($1, 1e-6·|equity|)` (the exact 136-03 gate).

- Window: **5–10 business days**, one run/day **[ASSUMED A5 — extend on any red]**.
- **Every run must be within tolerance.** An INCONCLUSIVE (empty/deposit-only ledger)
  run reads `parity_ok=None` and **never counts as green**; a read error is
  `observation=error` (never coerced to an empty flat).
- Results append one sanitized `mt5-soak-<UTC-date>.json` under
  `analytics-service/docs/evidence/` and fill the per-day `## Soak log (MT5GOLIVE-02)`
  table in `analytics-service/docs/mt5-spike-gonogo.md`.

- **Verify:** every run over the window is within tolerance (all `parity_ok=True`, exit
  0); the soak-log table rows are filled (no residual `human_needed`).
- **Abort path:** any run reddens (parity breach), is INCONCLUSIVE, or errors → extend
  the window / root-cause (terminal self-update? server-offset? open-position uPnL
  wedge?); do NOT flip on a red or short soak.

### Step 4a — ⚠️ The validate timeout chain is PROVISIONAL (153.3 / D-27)

The soak window is where numbers get collected, so record here what the numbers this
phase installed actually are — and are not.

The interactive `/validate-key` chain, as shipped by Phase 153.3:

| Layer | Value | Constant |
|-------|-------|----------|
| `initialize()` / `login()` IPC pipe | **45 000 ms** | `MT5_VALIDATE_INITIALIZE_TIMEOUT_MS` / `MT5_VALIDATE_LOGIN_TIMEOUT_MS` |
| rpyc round-trip | **55** s | `MT5_VALIDATE_REQUEST_TIMEOUT_S` |
| per-stage ceiling | **60** s | `_MT5_VALIDATE_STAGE_TIMEOUT_S` |
| end-to-end deadline | **75** s | `MT5_VALIDATE_DEADLINE_S` |
| lease (queue) wait — OUTSIDE the deadline | **20** s | `MT5_LEASE_WAIT_S` |
| release — OUTSIDE the deadline | **10** s | `MT5_RELEASE_TIMEOUT_S` |

**⛔ Every one of those six numbers is PROVISIONAL. They are derived from vendor
defaults and from the D-26 client ceiling — NOT from measurement.** State it plainly:
**no uncensored measurement of a SUCCESSFUL MT5 validation existed anywhere when these
numbers were chosen** — not in Railway logs, not in Sentry, not in
`analytics-service/docs/evidence/`. The nine correlated gateway↔worker failures of
2026-08-06/08 are all we have, and every one of them is right-censored at a timeout
ceiling, so they measure our ceiling rather than the broker's latency.

⚠️ The **"35–70 s"** figure circulating in the 153 planning documents is a **derivation
from the old constants, and says so itself** (`153-UI-SPEC.md`). It is not an
observation. Do not cite it as evidence for or against any of the values above.

**Where the real numbers will come from.** Phase 153.3 added the telemetry that was
missing: every MT5 call now emits a structured `mt5.stage` event carrying `stage` +
`duration_ms` **on success and on failure alike**, plus a `lease_wait` event (the queue
wait, timed SEPARATELY from the terminal work — a combined number is wrong for the second
concurrent user by construction) and one per-validate `outcome` event
(`read_only` / `master_rejected` / `undetermined` / `auth` / `wrong_server` / `transient`
/ `deadline_exceeded` / `lease_busy` / `gateway_unreachable` / `gateway_unconfigured`).
During the soak, query Railway for `event="mt5.stage"` and group `duration_ms` by `stage`
and by `outcome`.

**Owner of the tightening: Phase 155 (MT5-VERIFY)**, which is live-gated on a trading
day. Phase 153.3 measures and deliberately does **not** tune — moving a timeout in the
same change that first measured it destroys the before/after. Every value above is
env-overridable, so Phase 155 retunes without a code deploy.

**⛔ The invariant any future change MUST preserve:** the server's end-to-end worst case
— **lease wait + deadline + release = 20 + 75 + 10 = 105 s** — stays STRICTLY under the
client budget, which is Phase 153.4's **`120_000` ms** (`SEAM_ROUTE_BUDGETS`). That
leaves 15 s of margin today. A "small" bump to any of the three that crosses 120 000 ms
means the client abandons the request while the server is still holding the terminal:
the user sees a timeout with no verdict, and the terminal stays leased for the remainder.
Tighten these numbers freely; widen them only against that arithmetic.

## Step 5 — GATE-CHECK (explicit, never assumed)

**Every row below must be checked before the flip. The flip is NEVER assumed green.**

```
[ ] 134  Mt5Client offline contract suite green + the four-leg spike run recorded GO
[ ] 135  test_mt5_exchange_boundary.sql green; constraint migration APPLIED + verified on PROD;
         TS route/parity vitest + Python source-lockstep green
[ ] 136  test_mt5_derive_branch.py green (incl. the reconciliation gate + $2-drift negative control);
         test_process_key mt5 onboard + resync stamps api_verified; the √252 mutation guard green
[ ] 137  hung-terminal timeout, restart-on-timeout, per-terminal lock, login==expected bracket regressions green
[ ] 138  mt5-badge.spec.ts registered + green in the BLOCKING e2e-seeded list; byte-identity/envelope + go-dark tests green
[ ] SOAK reconstructed-vs-live equity parity holds EVERY run over the window (mt5_soak log all within tolerance)
[ ] CI   full analytics pytest green + full vitest (coverage gate) + e2e-seeded green on main
[ ] NET  worker reaches gateway.railway.internal:8001 privately (Pitfall 1 dual-stack confirmed — Step 0 A2)
[ ] DEPLOY Railway deploy verified SUCCESS, NOT SKIPPED (Pitfall 5)
[ ] SCALE single replica confirmed — mt5-gateway = 1 AND analytics = 1, VALUE READ AND
         RECORDED here: gateway ____ / analytics ____ (D-33, Step 1). A second replica
         serializes nothing across processes and reopens the interleaved-login() race —
         this is a CORRECTNESS row, not a capacity one. Never assumed.
[ ] TERM external-Python trade disable is OFF and terminal_info() reports
         connected:true AND trade_allowed:true (D-31, Step 2). While the option is ON,
         EVERY MT5 validation refuses permanently (MT5_GATEWAY_UNCONFIGURED) — a
         wizard that "just doesn't work" with no bad-credential message is this row.
```

- **Verify:** all rows above checked with real evidence (CI links via `gh pr checks` /
  `gh run`, the soak-log table, the A2/NET confirmation, the recorded replica counts, the
  `terminal_info()` output) — never a local-only run.
- **Abort path:** ANY row not green → **DO NOT FLIP**. A missing row means the flip
  waits.

## Step 6 — FLIP (MT5GOLIVE-02, LIVE env ops — NOT migrations)

Only when every GATE-CHECK row is green. These are LIVE env-var ops on Railway + Vercel,
never a DB migration.

```bash
# ── 1. Railway WORKER (analytics-service dir, `railway link`-ed) ────────────────
railway variables --set MT5_ENABLED=true --set MT5_GATEWAY_HOST=gateway.railway.internal --set MT5_GATEWAY_PORT=8001
railway up                          # force from the repo dir on the intended clean main commit
railway deployment list --json      # VERIFY status=SUCCESS + the right commitHash (NOT skipped) — Pitfall 5
```

> **Pitfall 5 — Railway "Wait for CI" silently SKIPS the deploy on a red main
> check-suite.** If `railway deployment list --json` shows `skippedReason="CI check
> suite failed"`, the flag never reached prod. Recover with `gh run rerun <main-run-id>
> --failed`, or `railway up` from `analytics-service/` to force. Cross-reference
> `railway-worker.md` for the `/health` `git_sha` convergence check and the full
> skipped-deploy recovery.

```bash
# ── 2. Vercel (server gate + client card — from a clean MAIN checkout) ──────────
vercel env add MT5_ENABLED production             # isMt5EnabledServer (validate-and-encrypt route)
vercel env add NEXT_PUBLIC_MT5_ENABLED production # wizard card (BUILD-TIME inlined → redeploy MANDATORY)
vercel redeploy <prod-deploy-url>                 # or: vercel --prod  (builds CWD = clean main)
```

> **Pitfall 3 — `NEXT_PUBLIC_MT5_ENABLED` is build-time inlined.** Setting the Vercel
> env var alone does NOTHING to the running deploy — the redeploy is MANDATORY (the
> exact sFOX precedent). Redeploy from a clean **main** checkout, never a feature branch
> (the CLI builds CWD).

**VPS / Fly variant:** `MT5_GATEWAY_HOST` is the **tailnet address** of the gateway
instead of `gateway.railway.internal`; everything else is identical.

- **Verify:** Railway `/health` returns fresh at the expected `git_sha` post-redeploy;
  the Railway deploy is `status=SUCCESS` (not skipped); the MT5 card appears in the
  add-key wizard on prod after the Vercel redeploy.
- **Abort path:** deploy skipped/failed, or the card does not appear → go to [Step 8 —
  ROLLBACK] and root-cause with the flags off.

## Step 7 — PROD VERIFY (MT5GOLIVE-02)

With both flags on, a real user connects an MT5 investor key through the add-key wizard
**end-to-end**, and its `api_verified` strategy renders LIVE across ALL surfaces:

- **factsheet** (`/strategy/[id]`) · **discovery** (browse listing) · **edit** (strategy
  edit page)

…proven across ALL roles: **owner / allocator / admin / anon** (anon sees the public
`api_verified` render, never the edit surface). The Phase-138 all-roles
`mt5-badge.spec.ts` e2e is the automated proxy; this LIVE prod check is the founder's
post-flip proof. **Test the WHOLE flow E2E after the flip** (the v1.10 flag-flip lesson
— not a single surface). Prod URL is **quantalyze.xyz**.

- **Verify:** the `api_verified` badge is observed on all surfaces for all roles; the
  connect wizard completes without a fail-closed error; a real sync stamps
  `api_verified` on the strategy.
- **Abort path:** any surface/role missing the `api_verified` render, or a fail-closed
  wizard error → go to [Step 8 — ROLLBACK], then root-cause with the flags off.

## Step 8 — ROLLBACK (the standing abort target — trivial, riskless)

Set **BOTH** enable flags back to empty and redeploy both planes:

```bash
# Railway worker: clear the server enable, then redeploy
railway variables --set MT5_ENABLED=
railway up

# Vercel: remove both enable flags, then redeploy from clean main
vercel env rm MT5_ENABLED production
vercel env rm NEXT_PUBLIC_MT5_ENABLED production
vercel --prod
```

This restores the **byte-identical DARK state** (the Phase-138 flag-OFF byte-identity
guarantee makes rollback riskless — MT5 simply disappears from the wizard picker; the
derive branch fails closed). The flip is **env-only** — no data is written by flipping,
nothing to clean up. **No migrations, no SQL, no code revert.**
`MT5_GATEWAY_HOST`/`MT5_GATEWAY_PORT` may stay set — harmless while `MT5_ENABLED` is
empty.

---

## Appendix — the honest culmination

This runbook + the `deploy/mt5-gateway/` templates + the `scripts/mt5_soak.py` runner
are the **buildable deliverable**. The live legs — gateway stand-up (Step 1), VNC
install (Step 2), broker onboard (Step 3), the soak RUN (Step 4), the flag flip (Step 6),
and the prod verify (Step 7) — are `human_needed` and stay OPEN until the founder
executes them and supplies the evidence: the recorded image digest + host (Step 1), the
persisted investor login + server-time offset (Step 2), the whitelisted gateway egress
(Step 3), the within-tolerance soak-log over the window (Step 4), the checked GATE-CHECK
rows (Step 5), the observed flags + both redeploys at `SUCCESS` (Step 6), and the
`api_verified` render on all surfaces × all roles (Step 7). No simulation, no CI-derived
claim, no partial credit.
