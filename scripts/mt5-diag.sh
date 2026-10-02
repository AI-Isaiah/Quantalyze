#!/usr/bin/env bash
# Read the LIVE MT5 terminal's capability flags without a VNC session.
#
# Why this exists: MT5GW-COPY-01 (TODOS.md) recurs. `[Experts] Enabled=0` makes
# `trade_allowed` false, which fails the capability seam and blocks every MT5
# connect — and diagnosing it used to mean a VNC trip and clicking through
# Tools -> Options. This reads the same flags in one command.
#
# ⛔ READ-ONLY, and deliberately so: it calls initialize() + terminal_info() and
# NEVER login(). A login() is an "account change"; while
# `[Experts] Account=1` is armed, MT5 re-clears `Enabled` on every account
# change, so a probe that logged in would itself re-break the thing it is
# measuring. That is not hypothetical — it happened during the 2026-08-13
# investigation, where each diagnostic round re-disabled algo trading.
#
# ⚠️ Do NOT "improve" this by reading Config/terminal.ini instead. MT5 only
# rewrites that file on a clean exit, so it can report `Enabled=0` while the
# running terminal is already correct. The live terminal_info() is the oracle.
#
# Usage:  ./scripts/mt5-diag.sh
# Needs:  railway CLI, authenticated, run from the repo root (the Railway link
#         is directory-scoped — running elsewhere gives "No linked project").
set -euo pipefail

SERVICE="${MT5_DIAG_SERVICE:-mt5-gateway}"
RPYC_HOST="${MT5_DIAG_HOST:-127.0.0.1}"
RPYC_PORT="${MT5_DIAG_PORT:-8001}"

read -r -d '' PROBE <<PY || true
import json
from mt5linux import MetaTrader5
mt5 = MetaTrader5(host="${RPYC_HOST}", port=${RPYC_PORT})
out = {"initialize": bool(mt5.initialize()), "last_error": mt5.last_error()}
ti = mt5.terminal_info()
if ti is None:
    out["terminal_info"] = None
else:
    d = ti._asdict()
    for k in ("trade_allowed", "tradeapi_disabled", "connected", "build", "path"):
        out[k] = d.get(k)
print("PROBE " + json.dumps(out))
PY

B64=$(printf '%s' "$PROBE" | base64 | tr -d '\n')
railway ssh --service "$SERVICE" \
  "python3 -c \"import base64;exec(base64.b64decode('${B64}'))\"" 2>&1 | grep '^PROBE ' || {
    echo "mt5-diag: no PROBE line returned — the gateway may be down, or rpyc unreachable on ${RPYC_HOST}:${RPYC_PORT}." >&2
    exit 1
  }

cat <<'NOTE'

Reading the result:
  trade_allowed=true   -> algo trading is ON; connects can prove read-only capability.
  trade_allowed=false  -> THE blocker. Fix in VNC: Tools -> Options -> Expert Advisors,
                          tick "Allow algorithmic trading" AND untick both
                          "...when the account has been changed" / "...when the profile
                          has been changed". Without those two, the next login turns it
                          straight back off and you get exactly one working sync.
  tradeapi_disabled    -> the option the operator-facing error message names. It has been
                          false throughout; it is NOT the blocker. See MT5GW-COPY-01.
NOTE
