# Phase 122 — Red-team fix notes (F1–F6)

**Theme:** make "sFOX is founder-gated until go-live" STRUCTURAL (not UI-pixels-only)
and remove pre-launch leaks. Every fix carries a regression test that fails without
the fix. Branch `gsd/v1.12-sfox-verified-integration`.

## Flag model (the durable takeaway)

Two DISTINCT flags now exist, and the founder must set BOTH at go-live:

| Flag | Kind | Gates | Default |
|------|------|-------|---------|
| `NEXT_PUBLIC_SFOX_ENABLED` | client build (Next inlines) | the wizard CARD / picker / chip OFFER (pixels) — `SFOX_UI_ENABLED` | off |
| `SFOX_ENABLED` | server/worker runtime (NOT NEXT_PUBLIC) | whether a sfox CONNECT is ADMITTED — 3 TS key routes + Python `/validate-key` + process_key source whitelist | off |

- TS reader: `isSfoxEnabledServer()` in `src/lib/closed-sets.ts` (strict `=== "true"`, per-request function, never inlined).
- Python reader: `sfox_enabled_server()` + `SFOX_DISABLED_DETAIL` in `analytics-service/services/closed_sets.py` (fail-closed, `.strip().lower() == "true"`).

Either flag alone is an intentional, SAFE half-state (card hidden but connect works,
or card shown but connect fails closed honestly). The go-live runbook must set
`SFOX_ENABLED` on **both** the Vercel server env AND the Railway worker, plus
`NEXT_PUBLIC_SFOX_ENABLED` in the client build.

## Findings + fixes

- **F2 (the structural gate)** — `fix(122): F2 …` (commit e586d860). Added the server
  gate at all three key routes (validate-and-encrypt, create-with-key,
  composite/add-key) + the Python worker (`routers/exchange.py` `/validate-key`,
  `routers/process_key.py` onboard/resync source whitelist). Fail CLOSED with an honest
  "sFOX integration is not yet available." — clean 4xx, NEVER a crash, NEVER a false
  KEY_AUTH_FAILED, NEVER a live probe. Existing sfox carve-out tests pin
  `SFOX_ENABLED=true`; new fail-closed tests (TS + Python) prove the disabled default.
- **F1 (public guide leak + false-today copy)** — `fix(122): F1 …` (bb55742d). Gated the
  `/security#sfox-readonly` SubAnchor on `isSfoxEnabledServer()` so it is ABSENT
  pre-launch (byte-identical to the pre-sfox page; no false static-egress-IP copy). Ties
  guide visibility to actual backend availability.
- **F3 (public verify-strategy disclosure + half-accept)** — `fix(122): F3 …` (e46de4da).
  Gated the public teaser on `UI_EXCHANGE_CODES` (the OFFERED set) instead of the wider
  key-save `SUPPORTED_EXCHANGES`. sfox now gets a clean "Unsupported exchange" and is not
  disclosed in the anon error enum; no more half-accept → confusing downstream 422.
- **F4 (third insert site, StrategyForm)** — `fix(122): F4 …` (95378aa8). Excluded sfox
  from the legacy connect-key modal's `EXCHANGE_OPTIONS` (the modal renders a hardcoded
  Secret field + generic copy that cannot serve token-only sfox) and added the
  `.trim().toLowerCase()` canonicalization at the api_keys insert chokepoint. Flag-on
  test proves sfox stays out of the legacy dropdown.
- **F5 (AllocatorSyncStatus casing)** — `fix(122): F5 …` (d4e78033). Derived
  `EXCHANGE_DISPLAY_NAME` from the shared `EXCHANGE_DISPLAY` (the old literal was missing
  sfox AND deribit → "Sfox" via titleCase). Drift-proof.
- **F6 (footer link, low priority)** — `fix(122): F6 …` (815841fe). Made the ApiKeyForm
  sfox footer's `/security#sfox-readonly` reference an actual link.

## Verification (all green)

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors (1 pre-existing warning in EquityChart.tsx, untouched).
- `npx vitest run --no-file-parallelism` on the 8 touched test files — 178 passed.
- `analytics-service`: targeted sfox/process_key — 89 passed; FULL suite — 4031 passed,
  96 skipped, 0 failures.

## Confirmations requested by the task

1. sFOX fails closed server-side when `SFOX_ENABLED` is unset — TS routes AND the worker
   (`/validate-key` + process_key source whitelist). ✔
2. Public `/security` + `/api/verify-strategy` no longer leak sfox pre-launch. ✔
3. The third insert site (StrategyForm) is fixed (canonicalized + sfox excluded). ✔
4. Client-flag-OFF stays byte-identical: `SFOX_UI_ENABLED` still gates the OFFER surfaces
   unchanged; the server gate is server-side only and the /security section absence
   RESTORES the pre-sfox baseline. ✔

## Notes / follow-ups (not in scope here)

- The public landing `VerificationForm` offers deribit (`UI_EXCHANGE_CODES`) but the
  Python teaser whitelist is `{okx,binance,bybit}` — a deribit teaser is a PRE-EXISTING
  half-accept, untouched by F3 (surgical). Worth a separate look if teaser deribit is
  expected to work.
