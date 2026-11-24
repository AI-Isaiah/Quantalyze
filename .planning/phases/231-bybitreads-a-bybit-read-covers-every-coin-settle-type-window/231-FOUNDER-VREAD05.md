# Phase 231 VREAD-05: Bybit key IP allow-list, founder instructions

This phase prepares the instructions and stops for you. No agent changes Railway networking or the
Bybit key's settings. The addresses never enter any tracked file: they stay in the Railway dashboard
and the Bybit key settings. Reply to the orchestrator with the choice and the date only.

## Evidence

Counts only, read from PROD on 2026-11-23:

- The one live Bybit key (connected, active) had 2 `derive_broker_dailies` jobs end `failed_final` with an IP error, on 2026-10-07 and 2026-10-08.
- From 2026-10-24 through 2026-11-23 it has 31 `derive_broker_dailies` jobs, every one `done` on the first attempt, with no error.
- Railway's read-only service config does not show whether Static Outbound IPs are switched on.

So the daily "Unmatched IP" error is not occurring now. The first step is a confirmation of what
changed, and only if nothing changed is there an action to take.

## What changed between 2026-10-09 and 2026-10-24

Please answer three questions in one message to the orchestrator:

1. Which of these happened in that window:
   - "Railway static IPs enabled and allow-listed on the Bybit key",
   - "the key's IP restriction was removed", or
   - "neither / do not know".
2. On what date.
3. Whether the Bybit allow-list still holds only the old entry.

Give the choice and the date. Do not type, paste or screenshot any address.

## If nothing was changed: allow-list now

Do this only when the answer to question 1 is "neither / do not know" and the allow-list still holds
only the old entry.

1. In Railway, for each of the two services `quantalyze-analytics-backfill` and `quantalyze-analytics`: open Settings, then Networking, switch on "Enable Static IPs", read the IPv4 addresses shown for the service's region, then redeploy the service. This needs the Pro plan. Railway documents three addresses per service with traffic balanced across them, bound to the region (they change if the service moves region), and traffic uses them only after a redeploy.
2. In Bybit, open API management, the connected key, edit the IP restriction and add every address Railway showed for both services. Keep the existing entries until the confirmation below passes.

Unverified assumption (RESEARCH A3): that Bybit accepts that many entries on one key, and that saving
the edit does not rotate the secret. If saving asks you to re-enter or regenerate the secret, stop and
tell the orchestrator; add one address at a time instead.

## Confirmation the orchestrator records

The orchestrator records your choice and the date verbatim (never an address) in plan 05's SUMMARY.

After the change, the orchestrator reads, counts only and after the PROD marker query, the key's
`derive_broker_dailies` status for the day after the change. It must read `done` with `attempts = 1`.
A green Railway toggle without a `done` derive is not a close.
