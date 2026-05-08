#!/usr/bin/env bash
# Phase 19 / Assumption A2 — verify quantstats Sharpe API.
#
# Quantstats has had API drift across versions; verify the periods=252
# convention before pinning a specific version in requirements-dev.txt.
#
# Usage:
#   scripts/probe-quantstats-version.sh
#
# Exits 0 on success, prints the recommended pin line. Exits non-zero if
# either the API has drifted, or quantstats cannot be installed in the
# active venv.
set -euo pipefail

# Best-effort latest-version lookup (only informational; the actual pin is
# read from the active analytics-service venv where quantstats is installed
# via requirements.txt).
LATEST=$(pip index versions quantstats 2>/dev/null \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
if [[ -n "${LATEST}" ]]; then
  echo "Latest quantstats on PyPI: ${LATEST}"
fi

# Probe the API in the current Python interpreter.
PROBE_OUTPUT=$(python3 - <<'PY'
import sys
try:
    import quantstats as qs
    import pandas as pd
except ImportError as exc:
    print(f"FAIL_IMPORT: {exc}", file=sys.stderr)
    sys.exit(2)

returns = pd.Series([0.001, 0.002, -0.001, 0.003, 0.0005] * 60)
try:
    sharpe = qs.stats.sharpe(returns, periods=252)
except TypeError as exc:
    # API drift: periods kwarg was renamed/removed.
    print(f"FAIL_API: qs.stats.sharpe(returns, periods=252) raised: {exc}", file=sys.stderr)
    sys.exit(3)

# Sanity: Sharpe should be a finite float for synthetic positive-mean data.
if not (sharpe == sharpe):  # NaN check
    print(f"FAIL_NAN: qs.stats.sharpe returned NaN", file=sys.stderr)
    sys.exit(4)

print(f"version={qs.__version__}")
print(f"sharpe={sharpe:.6f}")
PY
)

echo "${PROBE_OUTPUT}"

# Extract installed version (echoed as version=X.Y.Z).
VERSION=$(echo "${PROBE_OUTPUT}" | sed -nE 's/^version=([0-9.]+).*/\1/p')

if [[ -z "${VERSION}" ]]; then
  echo "FAIL: could not extract installed quantstats version" >&2
  exit 5
fi

cat <<EOF

OK: quantstats==${VERSION} verified.
  - qs.stats.sharpe(returns, periods=252) responds with a finite float.
  - Pin recommended: quantstats==${VERSION}

If this version differs from analytics-service/requirements.txt, update
requirements-dev.txt and document the version delta in
.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-08-SUMMARY.md.
EOF
