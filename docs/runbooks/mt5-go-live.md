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

**Record the image digest in the provenance line below at stand-up:**

```
Provenance: gmag11/metatrader5_vnc:2.3@sha256:__________________________________  (fill at stand-up)
Stood up:   ____-__-__  on host: [ Railway dual-stack | VPS+Tailscale | Fly ]
```

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

- **Verify:** container healthy; the digest is recorded in the provenance line above;
  the service has NO public domain / no public port handler (grep the chosen template
  proves it); `/config` volume mounted.
- **Abort path:** any public exposure of `:8001` observed → tear it down immediately and
  go to [Step 8 — ROLLBACK]; the flip never proceeds with a public RPyC surface.

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
4. **TEAR DOWN** the public `:3000` access. From here only the worker reaches `:8001`
   privately.
5. Verify `/config` persistence: restart the service and confirm the saved login
   survives (no re-install needed).

- **Verify:** the investor login is saved and survives a restart; the server-time offset
  is recorded; `:3000` is no longer publicly reachable.
- **Abort path:** login does not persist across restart (volume not wired) or `:3000`
  cannot be torn down → fix the volume/networking; do NOT proceed to soak on an
  ephemeral install.

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
```

- **Verify:** all rows above checked with real evidence (CI links via `gh pr checks` /
  `gh run`, the soak-log table, the A2/NET confirmation) — never a local-only run.
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
