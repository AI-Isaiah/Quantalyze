#!/bin/sh
# fly-egress-proxy/entrypoint.sh
# ---------------------------------------------------------------------------
# Render tinyproxy.conf from the PROXY_BASIC_AUTH fly secret at container start,
# then exec tinyproxy in the foreground.
#
# The BasicAuth credential is NEVER baked into the image or committed to git:
# tinyproxy.conf.template ships with placeholders only, and this script
# substitutes them from the PROXY_BASIC_AUTH env var (set via `fly secrets set`)
# on every start. It fails LOUD if the secret is missing or malformed — a proxy
# that silently started without auth would be an open relay.
#
# Overridable env (defaults suit both the container and the local smoke test):
#   CONF_TEMPLATE  path to the template          (default: alongside this script)
#   CONF_OUT       rendered config path          (default: /etc/tinyproxy/tinyproxy.conf)
#   TINYPROXY_BIN  proxy binary to exec          (default: tinyproxy)
# ---------------------------------------------------------------------------
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TEMPLATE="${CONF_TEMPLATE:-$SCRIPT_DIR/tinyproxy.conf.template}"
CONF_OUT="${CONF_OUT:-/etc/tinyproxy/tinyproxy.conf}"
TINYPROXY_BIN="${TINYPROXY_BIN:-tinyproxy}"

# Diagnostics NEVER echo the secret value — only a generic message.
die() {
  echo "entrypoint: FATAL: $1" >&2
  exit 1
}

[ -n "${PROXY_BASIC_AUTH:-}" ] || \
  die "PROXY_BASIC_AUTH is unset or empty (set it via: fly secrets set PROXY_BASIC_AUTH=user:secret)"

case "$PROXY_BASIC_AUTH" in
  *:*) : ;;
  *)   die "PROXY_BASIC_AUTH must be in 'user:secret' form (no colon found)" ;;
esac

# Split on the FIRST colon only — the secret itself may contain colons.
AUTH_USER=${PROXY_BASIC_AUTH%%:*}
AUTH_PASS=${PROXY_BASIC_AUTH#*:}

[ -n "$AUTH_USER" ] || die "PROXY_BASIC_AUTH user (before the first colon) is empty"
[ -n "$AUTH_PASS" ] || die "PROXY_BASIC_AUTH secret (after the first colon) is empty"
[ -f "$TEMPLATE" ]  || die "template not found at $TEMPLATE"

# Read the template preserving any trailing newline, then substitute the two
# placeholders with pure POSIX parameter expansion. sed/awk are deliberately
# avoided: the secret may contain / & \ or : which would corrupt those tools'
# replacement semantics; parameter expansion treats the value as a literal.
content=$(cat "$TEMPLATE"; printf x)
content=${content%x}

before=${content%%__PROXY_BASIC_AUTH_USER__*}
after=${content#*__PROXY_BASIC_AUTH_USER__}
content="${before}${AUTH_USER}${after}"

before=${content%%__PROXY_BASIC_AUTH_PASS__*}
after=${content#*__PROXY_BASIC_AUTH_PASS__}
content="${before}${AUTH_PASS}${after}"

printf '%s' "$content" > "$CONF_OUT"

# Foreground (-d) so the machine's supervisor sees the process; -c the rendered conf.
exec "$TINYPROXY_BIN" -d -c "$CONF_OUT"
