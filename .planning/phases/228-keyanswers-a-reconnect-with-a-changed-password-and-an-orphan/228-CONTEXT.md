# Phase 228: KEYANSWERS - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning

⭐ **Moved from v1.22 TRUTH to v1.23 HARDEN, 2026-11-27 (founder ruling in chat; recorded here and in `ROADMAP.md`'s v1.22 and v1.23 sections per the deviation policy, and in `REQUIREMENTS.md`).** Founder (2026-11-27): "let's then move 228 & 230 to the next milestone and after 252 close the current one and start the next one". The ruling names only the milestone for this phase; nothing else about it was ruled on, and the earlier records stand. Its open human item, the founder reconnecting a live MT5 key with a changed investor password, stays as it is. The ruling's second half (close v1.22 after 252, then start v1.23) is not part of this move.

<domain>
## Phase Boundary

Two answers in `src/app/api/strategies/create-with-key/route.ts` (seam S4, after Phase 225):

- **CONN-02.** An MT5 reconnect with a rotated or mistyped password gets a named answer that matches what `api_keys` holds afterwards. A mistyped password is never reported as success.
- **CONN-04.** `KEY_ORPHANED` tells the owner, of any role, by name which key to Disconnect. The archived-composite case is out (F-2).

### Re-measured at HEAD (origin/main fdcf4deb8), before this context was written

The ROADMAP's two premises are partly stale, because Phase 225 (#1361, #1368) changed both seams.

- `keyOrphanedResponse(holder?)` already takes the caller's own holder. `formatKeyError` and `holderLink` already name the stored key: "You already stored this account as your key "X", added D." plus "Open Strategies to finish setup on "X"".
- The pre-validation `draft` arm is a 409 `VENUE_DRAFT_IN_PROGRESS` now, not a silent `200 deduped`.

These are the arms an MT5 reconnect with a different password reaches today:

| Arm | Answer | validateKey runs? | api_keys afterwards |
|---|---|---|---|
| F6 session fence (same `wizard_session_id` has a draft) | 200 `deduped: true`; wizard strip | no | unchanged |
| Pre-fence `draft` (another session) | 409 VENUE_DRAFT_IN_PROGRESS, named | no | unchanged |
| Pre-fence `connected` (holder WORKING) | 409 VENUE_ALREADY_CONNECTED, names strategy, nothing about the password | no | unchanged |
| Pre-fence `orphaned` / `held` | 409 KEY_ORPHANED / KEY_VENUE_ALREADY_CONNECTED, names key | no | unchanged |
| `failing_holder` | validates; new key takes the slot (swapAccountSlot) | yes | new row, old marked duplicate |
| Post-validation resolve and 23505 race arm | the same refusals | yes | unchanged |

The live CONN-02 gap is a rotated password while the stored key still reads as working: the user is refused and told nothing about the password. The F6 fallback strip "These credentials are already connected." is also false for a changed password.

</domain>

<decisions>
## Implementation Decisions

### CONN-02: rotated or mistyped MT5 password (FOUNDER RULING, 2026-11-26)
- **Founder ruling (AskUserQuestion, 2026-11-26): "Validate and update in place".** On the MT5 same-account arms, a reconnect with a new password is validated. If it passes, the stored key's secret is rotated through the same seam `PATCH /api/keys/[id]/rotate-secret` uses (`POST /internal/keys/{id}/rotate-secret`, `rotate_key_secret` in `analytics-service/routers/internal.py`). The answer names the key: "We updated the password on your key "X"". A mistyped password gets the named validation error (the existing `classifyKeyValidationError` vocabulary, including `KEY_MT5_MASTER_PASSWORD` for a master password). — **Reversibility:** costly — a connect request now writes an existing PROD key's secret, and undoing it means removing a write path users will have relied on.
- **Trade-off the founder accepted, recorded as the founder's:** the up-to-120 s validation comes back on those arms, which reverses 212-03 SC5 ("refuse before the 120 s validateKey") for MT5. A connect request now changes an existing key.
- **Which arms are "same-account":** the MT5 pre-validation fence verdicts where the caller's own WORKING holder is picked on the same login and server: `connected`, `orphaned`, `held`, and the other-session `draft`. `failing_holder` keeps its 225-07 path (a validated new key takes the slot), because the founder's ruling is about the working-holder refusals and 225's slot swap is shipped behaviour. The planner confirms or narrows this set against the code, and records the final set in the plan.
- **What the answer carries:** the refusal that arm gives today still says what holds the account (strategy / key / draft), and a sentence naming the key whose password was updated is prepended. It is still not a new strategy, so no `strategy_id` is minted. The exact code shape (a new wizard code, or the existing code plus a `secret_updated` marker) is the planner's call, under the censuses (`KNOWN_CREATE_WITH_KEY_CODES`, the invariant and roster tests). The answer must match `api_keys` afterwards.
- **Server rule (amended 2026-11-26 after research):** rotate in place only when the picked holder's stored `venue_server` EQUALS the typed, normalised server (exact tier). The null-server legacy tier keeps today's refusal. Reason: the seam probes the server stored in the ciphertext, not the typed one, so on the null-server tier a right password typed beside a different broker's server would be written and reported "updated". Measured on PROD by MCP on 2026-11-26 (marker query first): 0 of 11 live MT5 keys have `venue_server IS NULL`, so the narrowing costs no real user.
- **Only at the pre-validation fence (amended after research):** the post-validation resolve has already spent the up-to-120 s validation. Adding the rotate leg there would outlast the browser deadline (UI-SPEC O2), so a post-validation same-account verdict keeps its existing refusal.
- **A failing holder with a composite dependent never rotates:** it is not a working holder (its `held` comes from the failing branch). The key id to rotate is carried explicitly on the working-holder path only, never inferred from the verdict.

### CONN-02: F6 session-fence strip
- Correct the false fallback strip in `WizardClient.tsx` ("These credentials are already connected. We continued with your existing strategy instead of creating a duplicate."). It must not claim the submitted credentials are connected when the F6 fence did not validate them. The new copy states only what is known: an existing strategy from this setup was continued, the credentials just entered were not checked or saved, and how to connect different ones.

### CONN-04: orphaned key copy
- `KEY_ORPHANED`'s Disconnect line (`fix[2]`) names the key when the holder is known, and degrades to today's sentence when it is not.
- Disconnect is safe to recommend to an allocator, measured: the `/strategies` row calls `disconnect_allocator_api_key`. Its confirm (`StrategiesSection.tsx`) uses an allocator body ("We'll stop syncing this key. Your historical holdings stay available…") and a feeds note listing what the key feeds. The key row is kept with `disconnected_at` set.
- SC-2's test drives an allocator-role and a manager-role owner through `KEY_ORPHANED`. The route has no role branch, so the test pins that both roles get the same named answer. For PROOF-01 it goes RED by removing the holder from the answer.

### Review scope (orchestrator instruction, 2026-11-26)
- The new write path touches PROD key secrets. Review must cover:
  - authz: only the key's owner, with the same checks as rotate-secret (owner-scoped read, the `user_id` passed to the seam, an UPDATE filtered on `id` + `user_id` + `exchange = 'mt5'`);
  - the master-password refusal;
  - a race against a concurrent sync.

### Decided autonomously
- [CONN-02] Q: "Run validateKey and then the rotate seam (two broker probes), or the rotate seam alone?" → Selected: "The rotate seam alone. It runs `_validate_mt5_key` (the same probe validateKey uses for MT5) against the stored login and server before it re-encrypts, and raises the same three MT5 refusals (auth failed, master password, wrong server). One probe, not two." — cheap to undo: adding a validateKey call before the seam is a local change in one arm.
- [CONN-02] Q: "Unchanged password: same password resubmitted to a working key?" → Selected: "The seam reports whether the new secret equals the stored one (a constant-time compare in Python, a boolean in the response). When it is unchanged, nothing is written and the answer says the stored password already works." — cheap to undo: one response field and one branch.
- [CONN-02] Q: "Sync race" → Selected: "No change to the poll or sync writers (Phase 225-21 owns the poll stamper and runs in parallel). The rotate UPDATE is the same one rotate-secret already ships (`sync_status: idle`, `sync_error: null`), so a sync that started with the old password can still mark the key failed afterwards. The next sync clears that. The limit is recorded in the plan and the CHANGELOG, not fixed here." — cheap to undo: a compare-and-set can be added later without changing any contract.
- [CONN-02] Q: "Share the persist code with rotate-secret or duplicate it?" → Selected: "Extract the seam call and owner-scoped UPDATE into one helper used by both routes (TWIN-8 one-builder rule), with rotate-secret's behaviour byte-identical." — cheap to undo: internal module.

### Claude's Discretion
- Test layout, helper names and the exact copy wording within DESIGN.md and the existing copy voice.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/api/keys/[id]/rotate-secret/route.ts`: the seam call (`resilientFetch("keys-rotate-secret", …)`), `RotateSecretResponseSchema`, `classifyKeyValidationError`, and the owner-scoped persist UPDATE with the venue_account_id backfill rule.
- `analytics-service/routers/internal.py` `rotate_key_secret`: owner-scoped row load (`req.user_id`), MT5 go-dark gate, decrypt, `_validate_mt5_key`, re-encrypt.
- `src/lib/own-account-holder.ts` `readOwnAccountHolder` / `holderField` / `parseAccountHolder`.
- `src/lib/wizardErrors.ts` `formatKeyError` holder arms, `holderLink`; `src/lib/envelope.ts` `buildEnvelope`.

### Established Patterns
- One builder per refusal body (TWIN-8). `code` first, as a literal (invariant scanner, byte-pins).
- No login, server or key id in any response body (T-154-06-C).
- Secrets passed to every `scrubSeamError` / `captureToSentry` call.

### Integration Points
- `create-with-key/route.ts` pre-validation fence (~:1575) and post-validation resolve (~:1747).
- `ConnectKeyStep.tsx` response handling (~:1170) and `WizardClient.tsx` dedup strip (~:1399).

</code_context>

<specifics>
## Specific Ideas

- Founder's answer sentence: "We updated the password on your key "X"".

</specifics>

<deferred>
## Deferred Ideas

- Guarding the rotate UPDATE against a concurrent sync writing `sign_in_failed` afterwards. It needs the poll writers, which Phase 225-21 owns.
- The archived-composite `KEY_ORPHANED` case (F-2, out).

</deferred>
