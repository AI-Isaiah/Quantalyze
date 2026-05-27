"""Phase 16 / OBSERV-08 — cassette recorder for Plan 16-08 Task 3.

Records {happy, auth-fail} cassettes against a live broker, then synthesizes
{rate-limit, schema-drift} from happy by editing the final response. Run with
`DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET[,PASSPHRASE]}` set in the shell ONLY —
NEVER write creds to .env or commit them. The 3-layer vcrpy filter at
analytics-service/tests/conftest_vcr.py scrubs broker signing headers + query
params + JSON body fields before YAML hits disk.

Usage (Bybit example):
  export DEBUG_KEY_FLOW_BYBIT_KEY=...
  export DEBUG_KEY_FLOW_BYBIT_SECRET=...
  .venv/bin/python scripts/record_cassettes.py bybit
  bash ../scripts/repro-key-flow.sh   # leak gate

Idempotent: skips happy/auth-fail if the cassette already exists. Always
re-synthesizes rate-limit + schema-drift from the latest happy.yaml.

After recording, ROTATE the broker key — the chat transcript that staged
the env vars is logged.
"""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

import ccxt
import yaml

# Importing the vcr singleton from the tests package — that's the
# canonical filter set used by the replay suite.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.conftest_vcr import phase16_vcr  # noqa: E402

CASSETTE_DIR = Path(__file__).resolve().parents[1] / "tests" / "cassettes"


def _read_env_creds(broker: str) -> dict[str, str]:
    upper = broker.upper()
    key = os.environ.get(f"DEBUG_KEY_FLOW_{upper}_KEY")
    secret = os.environ.get(f"DEBUG_KEY_FLOW_{upper}_SECRET")
    if not key or not secret:
        sys.exit(
            f"missing env: DEBUG_KEY_FLOW_{upper}_KEY and DEBUG_KEY_FLOW_{upper}_SECRET "
            "must be set in the shell before recording"
        )
    creds: dict[str, str] = {"apiKey": key, "secret": secret}
    if broker == "okx":
        passphrase = os.environ.get(f"DEBUG_KEY_FLOW_{upper}_PASSPHRASE")
        if not passphrase:
            sys.exit("OKX requires DEBUG_KEY_FLOW_OKX_PASSPHRASE")
        creds["password"] = passphrase
    return creds


def _record_happy(broker: str, creds: dict[str, str]) -> Path:
    target = CASSETTE_DIR / broker / "happy.yaml"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        print(f"[skip] {target.relative_to(CASSETTE_DIR.parent.parent)} already exists")
        return target
    klass = getattr(ccxt, broker)
    ex = klass({**creds, "enableRateLimit": False})
    print(f"[rec ] {broker}/happy.yaml — fetch_balance() against live broker")
    with phase16_vcr.use_cassette(str(target.relative_to(CASSETTE_DIR))):
        result = ex.fetch_balance()
    assert isinstance(result, dict), f"unexpected balance shape: {result!r}"
    print(f"[ok  ] {target.name}: {len(result.get('info', {}))} info keys")
    return target


def _record_auth_fail(broker: str, creds: dict[str, str]) -> Path:
    target = CASSETTE_DIR / broker / "auth-fail.yaml"
    if target.exists():
        print(f"[skip] {target.relative_to(CASSETTE_DIR.parent.parent)} already exists")
        return target
    # SECURITY: use FULLY SYNTHETIC creds, not a mangled real key. Bybit (and
    # likely Binance) echo the submitted apiKey back in the signature-failure
    # error body — `retMsg: "... origin_string[<ts><apiKey>...]"`. The deep
    # walker only redacts fields whose NAME matches sign/key/pass/secret;
    # Bybit's leak is in the VALUE of `retMsg` whose name does not match,
    # so a real key would leak. Synthetic key = nothing real to leak.
    bad_creds = {
        "apiKey": "synthetic-test-bad-key-not-real",
        "secret": "synthetic-test-bad-secret-not-real",
    }
    if "password" in creds:
        bad_creds["password"] = "synthetic-test-bad-passphrase"
    klass = getattr(ccxt, broker)
    ex = klass({**bad_creds, "enableRateLimit": False})
    print(f"[rec ] {broker}/auth-fail.yaml — fetch_balance() with SYNTHETIC bad creds")
    with phase16_vcr.use_cassette(str(target.relative_to(CASSETTE_DIR))):
        try:
            ex.fetch_balance()
        except (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.ExchangeError) as e:
            print(f"[ok  ] {target.name}: caught {type(e).__name__}")
            return target
    sys.exit(f"unexpected: synthetic bad creds did not raise an error for {broker}")


def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _dump_yaml(data: dict, path: Path) -> None:
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(data, fh, default_flow_style=False, sort_keys=False)


def _synthesize_rate_limit(broker: str, happy_path: Path) -> Path:
    target = CASSETTE_DIR / broker / "rate-limit.yaml"
    print(f"[syn ] {broker}/rate-limit.yaml — flip final response to 429")
    data = _load_yaml(happy_path)
    last = data["interactions"][-1]
    last["response"]["status"] = {"code": 429, "message": "Too Many Requests"}
    # OKX code 50011 = "Request too frequent" -> ccxt RateLimitExceeded. NOT
    # 50013 ("System is busy") which ccxt maps to ExchangeNotAvailable (and the
    # exact-code match precedes the HTTP-429 handler, which is ALSO
    # ExchangeNotAvailable on okx). The test asserts the RateLimitExceeded
    # family, so the body code is what drives the mapping.
    body = (
        '{"retCode":10006,"retMsg":"Too many visits!",'
        '"result":{},"retExtInfo":{},"time":0}'
        if broker == "bybit"
        else '{"code":"50011","msg":"Request too frequent. Please throttle."}'
    )
    last["response"]["body"]["string"] = body
    _dump_yaml(data, target)
    print(f"[ok  ] {target.name}: synthesized")
    return target


def _drop_canonical_field(obj, field: str) -> bool:
    if isinstance(obj, dict):
        if field in obj:
            del obj[field]
            return True
        return any(_drop_canonical_field(v, field) for v in obj.values())
    if isinstance(obj, list):
        return any(_drop_canonical_field(v, field) for v in obj)
    return False


def _synthesize_schema_drift(broker: str, happy_path: Path) -> Path:
    target = CASSETTE_DIR / broker / "schema-drift.yaml"
    print(f"[syn ] {broker}/schema-drift.yaml — drop ccxt-canonical field per broker")
    data = _load_yaml(happy_path)
    last = data["interactions"][-1]
    body_str = last["response"]["body"]["string"]
    parsed = json.loads(body_str)
    # ccxt's parse_balance assembles canonical free/used/total dicts from
    # broker-specific fields. To trigger the test_schema_drift branch
    # ("result missing 'free'/'info'"), we must drop a field ccxt actually
    # reads — the test exercises the wizard's broker-quirk error path.
    #
    # Bybit:   result.list[].coin[].coin     (the currency symbol; without it,
    #                                         ccxt cannot key the balance row)
    # OKX:     data[].details[].ccy          (analogous symbol)
    # Binance: balances[].asset              (analogous symbol)
    drop_field = {
        "bybit": "coin",
        "okx": "ccy",
        "binance": "asset",
    }.get(broker, "")
    dropped = drop_field and _drop_canonical_field(parsed, drop_field)
    if not dropped:
        sys.exit(f"could not find ccxt-canonical drift field for {broker} in happy.yaml")
    last["response"]["body"]["string"] = json.dumps(parsed)
    _dump_yaml(data, target)
    print(f"[ok  ] {target.name}: synthesized (dropped '{drop_field}')")
    return target


def _post_record_env_sweep(broker: str, creds: dict[str, str]) -> int:
    """Defense-in-depth: replace any literal env-cred value with [REDACTED]
    across all cassettes. Catches the Pitfall 4 case where a broker echoes
    the submitted apiKey in a free-text field whose name doesn't match the
    L3b deep walker's substring set (Bybit's `retMsg: "...origin_string[<key>]..."`)."""
    targets = [v for v in (creds.get("apiKey"), creds.get("secret"), creds.get("password")) if v]
    swept = 0
    for path in (CASSETTE_DIR / broker).glob("*.yaml"):
        text = path.read_text(encoding="utf-8")
        new_text = text
        for v in targets:
            if v in new_text:
                new_text = new_text.replace(v, "[REDACTED]")
                swept += 1
                print(f"[scrub] {path.name}: replaced live cred literal")
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
    return swept


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in ("okx", "binance", "bybit"):
        sys.exit("usage: record_cassettes.py {okx|binance|bybit}")
    broker = argv[1]
    creds = _read_env_creds(broker)
    happy = _record_happy(broker, creds)
    _record_auth_fail(broker, creds)
    _synthesize_rate_limit(broker, happy)
    _synthesize_schema_drift(broker, happy)
    swept = _post_record_env_sweep(broker, creds)
    print()
    print(f"[done] 4 cassettes in {CASSETTE_DIR / broker}/ (post-sweep replacements: {swept})")
    print("       run scripts/repro-key-flow.sh from the repo root for the leak gate")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
