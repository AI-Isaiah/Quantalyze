---
phase: 213
slug: keyflow
status: secured
threats_open: 0
threats_total: 28
asvs_level: 2
block_on: high
audited_at_sha: 58a6f5a06
---

# Phase 213 KEYFLOW — Security Audit

Audited at head `58a6f5a06` on `feat/213-keyflow` against `git diff 4c4fa1993..HEAD -- src`. No database access; the pre-existing RPC and index were read from `supabase/migrations/` and `supabase/tests/` (this phase changes no SQL: `git diff 4c4fa1993..HEAD --stat -- supabase` is empty). Targeted tests re-run at HEAD: 8 files, 402 tests, all passing (composite routes, create-with-key, StrategiesSection.disconnect, localStorage, scenario-factsheet-payload.pending).

Verdict: **SECURED**. 28 threats (27 numbered plus `T-213-SC`) closed or accepted with evidence, 0 open. `T-213-SC` appears in all 12 plans and is counted once.

## Threat register

| Threat | Plan | Sev | Disposition | Status | Evidence |
|---|---|---|---|---|---|
| T-213-01 unknown incoming key restores key A's session id | 01 | high | mitigate | CLOSED | `src/lib/wizard/localStorage.ts` `unknownMeetsStoredKey` (source api, incoming null, stored string key, not same draft on screen) is ANDed into the session-id restore `if`; F6 fence in `create-with-key/route.ts` stays the server backstop |
| T-213-02 telemetry leaks ids | 01 | low | mitigate | CLOSED | `WizardClient.tsx:542` `trackForQuantsEventClient("wizard_session_id_not_restored", { step: reason })`; `reason` is the fixed string `incoming_key_unknown`; no key or session id in event or console line |
| T-213-03 `deduped` leaks identity | 02 | med | mitigate | CLOSED | `create-with-key/route.ts` F6 arm adds `deduped: true` (boolean) beside the existing `strategy_id` and `api_key_id` the caller already owns; no venue account id added |
| T-213-04 RPC-internal replay (F2) | 02 | low | accept | ACCEPTED | named in route comments ("F2 RESIDUAL", two sites); CHANGELOG `### Notes` entry is owed at ship (not a code gap) |
| T-213-05 add-key accepts MT5 | 03 | med | mitigate | CLOSED | `composite/add-key/route.ts:185` returns 400 `COMPOSITE_MT5_UNSUPPORTED`; it sits before `checkLimit` (:317), the MT5 flag gate (:238), `encryptKey` (:419) and the `add_wizard_composite_key` RPC (:528), so it is flag-independent and writes nothing |
| T-213-06 set-members accepts an MT5 key by id | 03 | med | mitigate | CLOSED | `composite/set-members/route.ts` user-scoped `api_keys` read (`.in(id, members).eq("user_id", user.id)`) before `set_wizard_composite_members`; any owned row with exchange mt5 (case-insensitive) gives 400; a read fault gives 500 `UNKNOWN` and never falls through. Tests: route.test.ts "mt5 members refused" |
| T-213-07 refusal as an ownership oracle | 03 | low | mitigate | CLOSED | the read filters by `user_id`, so a non-owned id returns no row and reaches the RPC's own ownership answer; the refusal body carries a code only, no id or venue |
| T-213-08 direct PostgREST or RPC write bypasses the TS MT5 guards | 03 | med | accept | ACCEPTED (not open) | declared residual per CONTEXT "No SQL change". Both route files carry the "UX fence, not a database invariant" comment. The stitch job fails loud on such a member. CHANGELOG `### Notes` entry is owed at ship |
| T-213-09 strategyless-key read cross-tenant | 04 | low | mitigate | CLOSED | `src/lib/queries.ts` read stays on the user-scoped client with `.eq("user_id", userId)`; `strategies/page.tsx` passes `user.id` only; the role gate was dropped for the list, not the tenant filter |
| T-213-10 placeholder read failure shown as empty | 04 | low | mitigate | CLOSED | the `null` degrade path is untouched in the diff (`deriveStrategylessKeys` change is the filter and row shape only); page.merged tests pass |
| T-213-11 blend strip shows interim-basis figures | 05 | med | mitigate | CLOSED | `ScenarioComposer.tsx` `legsPending` memo nulls cagr, volatility, sharpe and sortino in the strip; `KpiStrip.tsx` `sharpeDeltaHeld` |
| T-213-13 failed probe retries forever | 05 | low | mitigate | CLOSED | the leg-load effect skips `addedMetricsById[id] === "unavailable"`, so a failed probe is terminal and pending ends |
| T-213-14 cross-tenant disconnect | 06 | high | mitigate | CLOSED | `StrategiesSection.tsx` `DisconnectKeyConfirm` calls only `supabase.rpc("disconnect_allocator_api_key", { p_api_key_id })` with the user-scoped browser client (no admin or service-role import). The RPC (`20260422101911_api_keys_disconnected_at.sql:58-97`) is SECURITY DEFINER, reads `auth.uid()`, raises 42501 for an unauthenticated caller or a non-owner, and updates only `WHERE id AND user_id = v_uid`. It is granted to `authenticated` only (REVOKE from PUBLIC, anon at :102). It is the only definition of the function in `migrations/` |
| T-213-15 Disconnect becomes a data-loss path | 06 | med | mitigate | CLOSED | the host has no delete import, no `.from(...)` write and no `/api/keys` DELETE call. The RPC only stamps `disconnected_at` and is idempotent. `StrategiesSection.disconnect.test.tsx` "NEVER DELETES" asserts no Delete button, no cascade box and no delete RPC |
| T-213-16 feeds read leaks or lies | 06 | low | mitigate | CLOSED | `key-feeds-confirm.ts` `readKeyFeedsForConfirm` calls the existing `GET /api/keys/[id]/memberships`, which is `withAuth`, UUID-checked and tenant-gated by `api_keys.user_id` with an identical 404 for absent and foreign keys. A failed or malformed read returns "unreadable" and the note says it could not check; it never says "feeds no strategy" |
| T-213-17 KEY_ORPHANED dead end | 07 | med | mitigate | CLOSED | `resolveByVenueIdentity` in `create-with-key/route.ts:229` filters `.is("disconnected_at", null)`. Route test "the way out opens" (:2482) passes. The matching unique index is exercised by pre-existing `supabase/tests/test_api_keys_venue_identity_uniq.sql`; not run here, no DB access |
| T-213-18 KEY_ORPHANED copy leaks | 07 | low | mitigate | CLOSED | `wizardErrors.ts` KEY_ORPHANED text names no account id, credential or key id; it names only the page and button labels |
| T-213-19 stale `enterMulti` adds MT5 | 12 | low | mitigate | CLOSED | `MultiKeyConnectStep.tsx` `if (draft?.exchange === "mt5") return;` in `enterMulti`; the add-another control is swapped for a note when the draft is MT5; the server refusal (T-213-05/06) is the backstop |
| T-213-20 legacy MT5 member panel renders blank | 12 | low | mitigate | CLOSED | `{active?.name ?? venueLabel(p.exchange)}` fallback; the existing Remove control is kept; `COMPOSITE_MT5_UNSUPPORTED` is in the wizard error map with its own copy |
| T-213-21 saved draft persists a figure | 09 | med | mitigate | CLOSED | `ScenarioComposer.tsx` POST (:2492) and PUT (:2541) bodies are `{ name, draft }` only; the diff adds no figure key. A structural pin is in `ScenarioComposer.save.test.tsx` |
| T-213-22 delta and rolling consumers show interim figures | 09 | med | mitigate | CLOSED | `legsPending` holds `sharpe`/`sortino` delta, `records`/`span_days`, rolling Sharpe, volatility and Sortino data, and the annualization caption |
| T-213-23 benchmark section shows interim figures | 10 | med | mitigate | CLOSED | `ScenarioBenchmarkSection.tsx` `basisPending` nulls tracking error, information ratio, alpha and the "{N}-day annualized" text; wired at `ScenarioComposer.tsx:6194` and `:6281` |
| T-213-24 factsheet preview shows interim figures | 10 | med | mitigate | CLOSED | `scenario-factsheet-payload.ts` builder-level `basisPending` holds `buildReturnsBody` and omits `scenarioPeer` and `scenarioOwnBookDelta`; `basis-context.tsx` `windowView` holds Ann. vol, Sharpe, Sortino and the bootstrap CIs only when `ingestSource === "csv" && basisPending === true`; default-off. `scenario-factsheet-payload.pending.test.tsx` passes |
| T-213-25 false cause shown in empty states | 10 | low | mitigate | CLOSED | `rollingVerdict.state === "withheld" && !legsPending` and the `short` branch both gate on `!legsPending`; the blend-gate caption is gated the same way |
| T-213-26 gate caption shows an interim verdict | 11 | low | mitigate | CLOSED | `{blendGateNote !== null && !legsPending && ...}` |
| T-213-12 interim-basis peer rank | 11 | low | mitigate | CLOSED | `peerSharpe` and `peerSortino` are null while `legsPending`; `buildScenarioPeerRankRequest` returns null on a null input, so the effect sets `scenarioPeer` null and issues no `/api/scenario/peer-rank` fetch |
| T-213-27 long-wait test coverage lost | 08 | low | mitigate | CLOSED | `MultiKeyConnectStep.test.tsx` and its credential-input test were re-seated before the MT5 path was removed; the wizard test directory passes at HEAD (re-run during this audit) |
| T-213-SC npm installs (all plans) | 01-12 | low | accept | ACCEPTED | `git diff 4c4fa1993..HEAD --stat` shows no `package.json` or lockfile change |

## Focus checks asked for

- **Owner-scoped Disconnect RPC:** closed. Ownership is decided by `auth.uid()` inside the RPC, and the client sends only the row id. There is no service-role path in the host.
- **set-members user-scoped read and MT5 refusal:** closed. The read is tenant-filtered, a fault refuses with 500, and the check runs before the membership RPC.
- **add-key MT5 refusal:** closed. It sits ahead of the flag gate, the rate-limit token, encryption and the RPC.
- **Sentry capture carries no key id:** closed. The capture call is `captureToSentry(err, { tags: { component: "DisconnectKeyConfirm", stage: "disconnect-rpc" } })`, so the tags carry no id. See the informational note below on the error body.
- **`basisPending` not reaching the public factsheet:** closed. The flag is set only inside `buildScenarioFactsheetPayload`, whose only callers are the composer preview (`ScenarioFactsheetChart.tsx`). It is emitted only when true and not degenerate. `windowView` reads it only on the csv arm. No public factsheet builder sets it. The type comment documents that it is omitted on every other payload.

## Accepted risks log

| ID | Risk | Bound |
|---|---|---|
| T-213-04 | RPC-internal replay returns the same shape as a fresh mint, so no `deduped` can be set without a `RETURNS TABLE` change | reachable only on an F6 read fault or a true concurrent double-submit of one session; same-session submit is the same key after plan 01's decline |
| T-213-08 | A direct PostgREST insert into `strategy_keys` or a direct `set_wizard_composite_members` or RPC call bypasses the TypeScript MT5 guards | the guards are a UX fence, not a database invariant (CONTEXT "No SQL change"); the stitch job has no mt5 arm and fails loud on such a member |
| T-213-SC | no new dependencies | lockfile unchanged |

## Unregistered flags

None. Every `## Threat Flags` section in the 12 SUMMARYs reads "None" or maps to a registered ID.

## Informational (not threats, not counted)

1. **Sentry error body may carry a key id on a tampered call.** The RPC's 42501 message reads `caller does not own api_key <uuid>`. `seam-redaction.ts` has no UUID scrubber, so if a non-owned id were ever sent, that message would reach Sentry through `captureToSentry`. The UI sends only ids from the caller's own server-rendered list, so this needs a hand-crafted client and discloses only the id the caller supplied. Not a gap against T-213-14 or T-213-16. A scrub or a fixed message in `DisconnectKeyConfirm.report` would remove it if the founder wants "no key id anywhere" literally.
2. **Order in set-members.** The MT5 refusal runs after the per-user rate-limit token is consumed, unlike add-key. This costs the caller one of their own tokens and is not a security effect; the plan asked only for refusal before the RPC.
3. **Not run here.** SQL arm 6b and the other `supabase/tests` files are cited from the repo and not executed (no database access). They are unchanged by this phase.

**threats_open:** 0
