---
phase: 121-sfox-static-ip-egress
plan: 01
subsystem: infra
tags: [fly.io, tinyproxy, egress-proxy, static-ip, sfox, basicauth, connect-tunnel]

# Dependency graph
requires:
  - phase: 118-120
    provides: SfoxClient explicit proxy= seam + create_exchange ccxt chokepoint (wired by 121-02)
provides:
  - Self-contained fly-egress-proxy/ deployable (Dockerfile, fly.toml, tinyproxy.conf.template, entrypoint.sh, README)
  - tinyproxy forward proxy config — BasicAuth, deny-by-default, ConnectPort 443, no header leakage
  - Fail-loud secret-render entrypoint (PROXY_BASIC_AUTH → BasicAuth at container start; never baked into image/git)
  - Founder runbook encoding the corrected dual-IP topology (inbound v4 + static egress ≈$5.60/mo) with verify-before-whitelist ordering
affects: [121-02 (worker proxy wiring + probe --expect flag), 121-03 (founder fly deploy ops), sfox]

# Tech tracking
tech-stack:
  added: [tinyproxy (Alpine distro package), Fly.io static egress IP topology]
  patterns:
    - "Secret rendered from env at container start (never baked into image/git)"
    - "Founder-run infra: generate config + runbook, founder deploys (flyctl not local)"
    - "Config-only deployable, inert until deploy — port lockstep across fly.toml/conf/README"

key-files:
  created:
    - fly-egress-proxy/Dockerfile
    - fly-egress-proxy/fly.toml
    - fly-egress-proxy/tinyproxy.conf.template
    - fly-egress-proxy/entrypoint.sh
    - fly-egress-proxy/README.md
  modified: []

key-decisions:
  - "BasicAuth over IP allow-list — Railway worker egress IP is not stable"
  - "Render tinyproxy.conf from PROXY_BASIC_AUTH at start; placeholders only in git (Open Q2 recommendation)"
  - "POSIX parameter-expansion substitution (no sed/awk) — secret may contain / & \\ or :; split on FIRST colon"
  - "Two Fly IPs required: dedicated inbound v4 (~$2/mo) + static egress (~$3.60/mo); sFOX whitelists the EGRESS ip"

patterns-established:
  - "Fail-loud secret render: entrypoint exits non-zero without echoing the value on unset/malformed PROXY_BASIC_AUTH"
  - "Verify-before-whitelist runbook ordering: probe realized egress THEN whitelist"

requirements-completed: [SFOX-07]

# Metrics
duration: ~20min
completed: 2026-07-19
---

# Phase 121 Plan 01: Fly.io static-egress tinyproxy deployable Summary

**Self-contained `fly-egress-proxy/` (Alpine tinyproxy + fly.toml pinned to `ams` + fail-loud secret-render entrypoint + founder runbook) giving the worker one verified static IPv4 egress for IP-whitelisted sFOX keys — deny-by-default, no-header-leak, secret never baked into the image.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-19T03:45:00Z
- **Completed:** 2026-07-19T04:04:39Z
- **Tasks:** 2
- **Files modified:** 5 (all created)

## Accomplishments
- tinyproxy config template with BasicAuth (space-separated, placeholders only), `ConnectPort 443`, `DisableViaHeader Yes`, `XTinyproxy No`, `Anonymous` whitelist, and zero `Allow` lines (deny-by-default) — each of the three deliberate absences (`Listen`, `Allow`, open relay) commented with rationale.
- POSIX-sh entrypoint that fail-loud renders BasicAuth from `PROXY_BASIC_AUTH` at start: exits non-zero without echoing the value on unset/empty/colon-less/empty-side input, splits on the FIRST colon (secret may contain colons), and substitutes via pure parameter expansion so `/ & \ :` in the secret can't corrupt the render.
- `fly.toml` pinned to `ams`, handler-less raw-TCP `[[services]]` on 8888, always-on (`min_machines_running = 1`); Dockerfile on `alpine:3.20` with distro tinyproxy (no npm/PyPI surface), secret never in image layers.
- Founder README runbook encoding the CONTEXT.md topology correction: BOTH allocations (dedicated inbound v4 ~$2/mo AND static egress ~$3.60/mo ≈ $5.60 total), the EGRESS ip is what sFOX whitelists, and the `probe_exchange_egress --expect` gate is enforced BEFORE the whitelist step (line-order asserted). CONNECT credential-safety note + 8888-blocked→443-fronted fallback documented.

## Task Commits

1. **Task 1: tinyproxy image — Dockerfile, conf template, entrypoint, fly.toml** — `df0fc45c` (feat)
2. **Task 2: Founder README runbook — dual-IP topology, verify-before-whitelist** — `088c9ace` (docs)

## Files Created/Modified
- `fly-egress-proxy/tinyproxy.conf.template` — deny-by-default authed proxy config; BasicAuth placeholders, ConnectPort 443, header hygiene
- `fly-egress-proxy/entrypoint.sh` — fail-loud secret render (first-colon split, POSIX param-expansion), exec tinyproxy foreground
- `fly-egress-proxy/Dockerfile` — alpine:3.20 + distro tinyproxy, secret-render design, entrypoint wired
- `fly-egress-proxy/fly.toml` — region ams, raw-TCP handler-less service on 8888, always-on machine
- `fly-egress-proxy/README.md` — founder runbook: deploy, allocate BOTH IPs, verify egress, whitelist EGRESS ip last

## Decisions Made
- **BasicAuth, not IP allow-list** — Railway's worker egress IP is not stable, so admission is authentication-based; deny-by-default via BasicAuth + zero `Allow` lines.
- **Secret rendered at start, not baked** — placeholders only in git; entrypoint renders from `PROXY_BASIC_AUTH` and fails loud if missing (RESEARCH Open Question 2).
- **POSIX parameter-expansion substitution over sed/awk** — the secret can contain `/ & \ :`, which would corrupt sed/awk replacement semantics; first-colon split preserves colons inside the secret.
- **Template path resolves alongside the script** (`$SCRIPT_DIR/tinyproxy.conf.template`) so the same default works in the container (`/opt/egress-proxy/`) and the local smoke test.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' automated gates passed on the first run; additional edge cases (empty-user `:secret`, empty-pass `user:`, empty-string) were spot-checked and also fail loud.

## Issues Encountered
None. The one design detail worth noting: the Task-1 verify smoke test invokes the entrypoint without setting `CONF_TEMPLATE`, so the default template path is resolved relative to the script's own directory (`$SCRIPT_DIR`) rather than a hardcoded `/etc/tinyproxy/...` — this makes the same default correct both locally and in the container (where entrypoint + template are co-located under `/opt/egress-proxy/`).

## Internal Consistency (requested confirmation)
- **Port lockstep:** `8888` matches across `fly.toml` (`internal_port` + `[[services.ports]] port`), `tinyproxy.conf.template` (`Port 8888`), and the README `:8888` proxy-URL host — verified by grep.
- **Secret never baked:** no `CHANGE_ME` / secret material in any committed file; the only secret-adjacent token is the `openssl rand -hex 32` generation command in the README. tinyproxy.conf.template carries placeholders only; the real value is rendered from `PROXY_BASIC_AUTH` at container start.
- **No overlap with 121-02:** zero `analytics-service/` files touched; exactly the 5 `fly-egress-proxy/` files changed.

## User Setup Required
None in this plan — the deployable is inert until the founder runs it. The founder ops (fly deploy, allocate both IPs, set `PROXY_BASIC_AUTH` + `WORKER_EGRESS_PROXY_URL`, verify egress, whitelist at sFOX) are the runbook in `fly-egress-proxy/README.md`, executed in plan 121-03.

## Next Phase Readiness
- 121-02 (worker proxy wiring + `probe_exchange_egress --expect` flag) can proceed independently — no file overlap; the README already references the `--expect` gate that 121-02 ships.
- 121-03 (founder deploy) is unblocked once 121-02 lands the probe flag.

## Self-Check: PASSED

All 5 `fly-egress-proxy/` files + SUMMARY.md exist on disk; both task commits (`df0fc45c`, `088c9ace`) present in git history.

---
*Phase: 121-sfox-static-ip-egress*
*Completed: 2026-07-19*
