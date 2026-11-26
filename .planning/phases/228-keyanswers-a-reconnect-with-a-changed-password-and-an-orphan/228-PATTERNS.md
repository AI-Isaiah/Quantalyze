# Phase 228: KEYANSWERS - Pattern Map

**Mapped:** 2026-11-26
**Read at HEAD:** `6039236bf` (worktree `228`). Every line range below is paired with a symbol. Re-resolve by symbol before copying: Phase 225-21 moves lines in `create-with-key/route.ts` in parallel, and RESEARCH and UI-SPEC anchors were taken at other SHAs.
**Files analyzed:** 22 touched or new code and test files (plus 4 bookkeeping files)
**Analogs found:** 22 / 22 (2 are role-match only, marked below)

## Authority and scope fence

- **CONTEXT wins over RESEARCH.** RESEARCH's "User Constraints" block restates the pre-amendment server rule ("pickSameAccountHolder's exact server, or its null-server legacy fallback"). That text is **superseded**. The rule is CONTEXT's: rotate in place only when the picked holder's stored `venue_server` EQUALS the typed, normalised server (exact tier). The null-server tier keeps today's refusal. CONTEXT also fixes: pre-validation fence only (the post-validation resolve and the 23505 race arm keep their refusals), and `failing_holder` keeps its 225-07 path.
- **Wire shape and the final same-account arm set are the planner's call** (CONTEXT). `key_secret: { outcome: "updated" | "unchanged"; name? }` is RESEARCH's recommendation, not a decision. The patterns below work for either shape (a nested field, or flat fields).
- **Out of scope, no patterns given:** `analytics-service/services/job_worker.py`, `analytics-service/services/allocator_positions.py` (Phase 225-21 owns the poll stamper), the post-validation resolve, the 23505 race arm, `failing_holder`, the archived-composite `KEY_ORPHANED` case (F-2), and the Deferred item (compare-and-set against a concurrent sync).
- **Public repo rule:** this file names no login, server, password or key id. Test excerpts refer to fixtures by constant name (`MT5_RECONNECT_BODY`, `SYNTHETIC_NEW_SECRET`).
- **Tracked-source gate:** every path below was checked with `git ls-files` and is tracked. None is a gitignored mirror. New files (marked NEW) do not exist yet.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/routers/internal.py` (`rotate_key_secret`) | service endpoint | request-response | itself (`rotate_key_secret`) + `secrets.compare_digest` in `_verify_internal_token` | exact (in-place edit) |
| `analytics-service/tests/test_mt5_rotate_secret_internal.py` | test | request-response | itself (`test_rotate_secret_happy_path_returns_ciphertext_and_login_never_passwords`) | exact |
| `src/lib/analytics-schemas.ts` (`RotateSecretResponseSchema`) | model (zod) | transform | itself | exact |
| `src/lib/analytics-schemas.test.ts` | test | transform | `describe("EncryptKeyResponseSchema ...")` in the same file | exact |
| `src/lib/analytics-client.ts` (+ `rotateKeySecret`) | service (seam client) | request-response | `validateKey` / `encryptKey` (wrapper shape) + the inline seam call in `rotate-secret/route.ts` (code to move) | role-match (see note) |
| `src/lib/api/rotate-key-secret.ts` NEW (`persistRotatedMt5Secret`) | service (lib helper, admin write) | CRUD (UPDATE + audit) | `swapAccountSlot` in `src/lib/venue-identity.ts` (typed result, admin client in, never a NextResponse) + `attemptPersist` block in `rotate-secret/route.ts` (code to move) | role-match |
| `src/lib/api/rotate-key-secret.test.ts` NEW | test | CRUD | `src/lib/venue-identity.test.ts` + the mock recorder in `rotate-secret/route.test.ts` | role-match |
| `src/lib/key-secret-outcome.ts` NEW (client-safe) | utility | transform | `holderField` / `parseAccountHolder` in `src/lib/own-account-holder.ts` | exact (shape) |
| `src/lib/key-secret-outcome.test.ts` NEW | test | transform | `parseAccountHolder` tests in `src/lib/own-account-holder.test.ts` | exact |
| `src/lib/own-account-holder.ts` (+ `readOwnKeyLabel`) | service (read) | CRUD (read) | the `step = "key"` read inside `readOwnAccountHolder` | exact |
| `src/app/api/keys/[id]/rotate-secret/route.ts` | controller | request-response | itself (refactor to call the two shared functions; behaviour byte-identical) | exact |
| `src/app/api/strategies/create-with-key/route.ts` | controller | request-response | itself: the pre-validation `venueMatch` arms + `handleReuseExistingKey` two-layer ownership idiom | exact |
| `src/app/api/strategies/create-with-key/route.test.ts` | test | request-response | `describe("[225-07] MT5 admission, the server rule and the swap")` | exact |
| `src/lib/resilient-fetch.ts` (`SEAM_ROUTE_BUDGETS` create-with-key row) | config | n/a | the `serialized-venue` / `default-venue` branch rows beside it | exact |
| `src/lib/seam-budgets.invariant.test.ts` (`EXPECTED_ROUTE_BUDGETS`, `CONNECT_VENUE_ARMS` loop) | test (census) | n/a | itself | exact |
| `src/lib/resilient-fetch.wiring.test.ts` (B-15 `site`, `EXPECTED_SEAM_CALL_FILES`) | test (census) | n/a | itself | exact |
| `src/lib/wizardErrors.ts` (`KEY_ORPHANED` table entry + holder arm in `formatKeyError`) | model (copy) | transform | the `KEY_ORPHANED` / `KEY_VENUE_ALREADY_CONNECTED` holder arms in `formatKeyError` | exact |
| `src/lib/wizardErrors.test.ts` | test | transform | the class sweeps in that file import `formatKeyError`, `WizardErrorContext`; holder-arm render tests live in `ConnectKeyStep.test.tsx` | role-match |
| `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` | component | request-response | itself: `existingHolder` state + `parseAccountHolder(data.holder)` + `{errorEnvelope && <WizardErrorEnvelope/>}` | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx` | test | request-response | `it("KEY_ORPHANED names the stored key (nickname and date) ...")` | exact |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (F6 fallback strip) | component | event-driven | itself: the three-way ternary in the `wizard-dedup-notice` strip | exact |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx` | test | event-driven | `describe("[154-06 / WIZCONT-02] WizardClient - the dedup notice")` and `describe("[213 CR-02] ...")` | exact |

Bookkeeping (no code pattern; follow `CLAUDE.md`): `CHANGELOG.md` entry + `VERSION` and `package.json` byte-equal 4-digit strings in the same commit; delete TODOS entry `C-2 / A-4`; edit `[167.1.2-ORPHAN-COPY-FIX]` down to the archived-composite case; the sync-race limit and the 212-03 SC5 reversal for MT5 go in `### Notes`.

---

## Pattern Assignments

### `analytics-service/routers/internal.py` — `rotate_key_secret` (service endpoint, request-response)

**Analog:** itself. Edit the decrypt line and the return only.

**Today** (symbol `rotate_key_secret`, the `decrypt_credentials` call and the final `return`):
```python
    try:
        login, _old_password, broker_server = decrypt_credentials(key_data, kek)
    except (InvalidToken, json.JSONDecodeError, KeyError):
        ...
    validate_result = await _validate_mt5_key(login, req.new_secret, broker_server)
    ...
    encrypted = encrypt_credentials(login, req.new_secret, broker_server, kek)
    ...
    return {**encrypted, "venue_account_id": mt5_venue_account_id(login)}
```

**Constant-time compare idiom already in the file** (symbol `_verify_internal_token`, `secrets.compare_digest(provided, expected)`; `secrets` is imported at the top of the module). Copy the idiom, but encode both sides to UTF-8 bytes (a `str` pair raises `TypeError` on non-ASCII; MT5 investor passwords are user-chosen and never trimmed, D-08):
```python
        login, old_password, broker_server = decrypt_credentials(key_data, kek)   # rename _old_password
        ...
        # after the success-shape assertion, BEFORE encrypt_credentials: probe-then-compare,
        # so "unchanged" truthfully means "and it signs in" (UI-SPEC A4 / section 1.3).
        secret_changed = not secrets.compare_digest(
            old_password.encode("utf-8"), req.new_secret.encode("utf-8")
        )
        encrypted = encrypt_credentials(login, req.new_secret, broker_server, kek)
        return {**encrypted, "venue_account_id": mt5_venue_account_id(login), "secret_changed": secret_changed}
```
**Constraints to carry:** update the docstring step 7 ("OLD password [discarded]"); never log `old_password`, `req.new_secret` or the compare result. Return type stays `dict[str, Any]`, so mypy strict is unaffected; CI command is in RESEARCH Standard Stack. Run pytest only from `analytics-service/`.

---

### `analytics-service/tests/test_mt5_rotate_secret_internal.py` (test, request-response)

**Analog:** `test_rotate_secret_happy_path_returns_ciphertext_and_login_never_passwords` (same file). Reuse its fixtures: `client`, `_headers()`, `_supabase_with_row(_mt5_row())`, the `patch("routers.internal.get_kek" ...)` / `decrypt_credentials` / `_validate_mt5_key` (`AsyncMock`) / `encrypt_credentials` stack, and the `_SYNTH_*` constants.

**Copy this skeleton** (symbol: that test's `with patch(...)` block and `res = client.post(...)`):
```python
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(_mt5_row())), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch("routers.internal.decrypt_credentials",
               return_value=(_SYNTH_LOGIN, _SYNTH_OLD_PASSWORD, _SYNTH_BROKER_SERVER)), \
         patch("routers.internal._validate_mt5_key",
               new=AsyncMock(return_value={"valid": True, "read_only": True})) as mock_validate, \
         patch("routers.internal.encrypt_credentials", return_value=dict(encrypted_fields)):
        res = client.post("/internal/keys/key-mt5/rotate-secret", headers=_headers(),
                          json={"new_secret": _SYNTH_NEW_PASSWORD})
```
New cases (each must go RED when neutered, per RESEARCH Validation): `secret_changed` is `True` when the secrets differ and `False` when `decrypt_credentials` returns the same string as `new_secret`; a non-ASCII password pair does not raise; neither password appears in `res.text` (the file's non-vacuous leak assertion style: assert the exact synthetic strings absent); probe still runs before the compare (probe raising means no `secret_changed` anywhere). Neuter: swap `secrets.compare_digest` for `==` or drop `.encode`.

---

### `src/lib/analytics-schemas.ts` — `RotateSecretResponseSchema` (model, transform)

**Analog:** itself (symbol `RotateSecretResponseSchema`, currently `EncryptKeyResponseSchema.extend({ venue_account_id: z.string() })`).
```ts
export const RotateSecretResponseSchema = EncryptKeyResponseSchema.extend({
  venue_account_id: z.string(),
  // OPTIONAL: Vercel ships before Railway; a required field would fail rotate-secret's own parse
  // against the old Python service. Absent means "changed" (old rotate semantics always wrote).
  secret_changed: z.boolean().optional(),
});
```
Add a comment block in the file's own voice (the existing block above the schema explains "Never a secret"). Test in `src/lib/analytics-schemas.test.ts`, analog `describe("EncryptKeyResponseSchema (envelope-encryption contract)")`: parses with and without the field, rejects a non-boolean, makes no change to `EncryptKeyResponseSchema`.

---

### `src/lib/analytics-client.ts` — add `rotateKeySecret` (service, request-response)

**Analog (wrapper shape):** `validateKey` / `encryptKey` (symbols): exported async function, `tenant`-style identity param, returns the parsed schema, never builds a budget key by interpolation (T-140-01).
**Analog (the code to MOVE):** the seam call in `src/app/api/keys/[id]/rotate-secret/route.ts` (the `try { const res = await resilientFetch("keys-rotate-secret", ...)` block through `parsed = result.data`). Move it verbatim and wrap it in a function that THROWS, so each route's existing `catch` runs `classifyKeyValidationError(err)` unchanged.

**Imports already in `analytics-client.ts` that the moved block needs:** `resilientFetch`, `SeamBodyReadError`, `seamErrorCode`, `seamHumanMessage`. Add `RotateSecretResponseSchema` to the existing `./analytics-schemas` import block.

**Core excerpt to move** (symbol: that `try` block in `PATCH`):
```ts
const res = await resilientFetch(
  "keys-rotate-secret",
  `/internal/keys/${encodeURIComponent(id)}/rotate-secret`,
  { method: "POST",
    headers: { "Content-Type": "application/json",
               "X-Internal-Token": process.env.INTERNAL_API_TOKEN!,
               "X-Correlation-Id": correlationId },
    body: JSON.stringify({ new_secret: newSecret, user_id: user.id }),
    retriesOverride: 0 },
);
if (!res.ok) {
  const errBody = await res.json().catch((readErr: unknown) => {
    if (readErr instanceof SeamBodyReadError) throw readErr;
    return {};
  });
  const seamCode = seamErrorCode(errBody);
  const upstreamFailure = new Error(seamHumanMessage(errBody) ?? `Upstream ${res.status}`);
  if (seamCode !== null) (upstreamFailure as Error & { seamCode?: string }).seamCode = seamCode;
  (upstreamFailure as Error & { status?: number }).status = res.status;
  upstreamFailure.name = "AnalyticsUpstreamError";
  throw upstreamFailure;
}
const result = RotateSecretResponseSchema.safeParse(await res.json());
if (!result.success) throw new Error(`rotate-secret payload failed schema validation (fields: ...)`);
return result.data;
```
**Rules that must survive the move (each is pinned by a test):** `retriesOverride: 0`; `user_id: user.id` in the body is the owner-scoping depth; the thrown `Error` carries `seamCode`, `status`, `name = "AnalyticsUpstreamError"`; the typed password is never in a message. Keep the long WR-01 / 164.5.4-02 comment (it records why the code reaches the classifier) with the moved block or cite it by symbol.

**Census consequences (measure, do not assume):** `analytics-client` is already on `EXPECTED_SEAM_CALL_FILES` and the `SEAM_MODULES` import edge, so `rotate-secret/route.ts` stays on the edge by importing `analytics-client`. See the wiring and budgets entries below. Check `src/lib/analytics-client.test.ts`: it scans `budgetKeyFor`'s body for venue literals; a new function must not introduce venue-name equality.

---

### `src/lib/api/rotate-key-secret.ts` NEW — `persistRotatedMt5Secret` (lib helper, admin UPDATE + audit)

**Role-match analog:** `swapAccountSlot` in `src/lib/venue-identity.ts` (symbol, with `afterSlotSwap`). It is the repo's existing "lib helper that takes the admin client, writes, audits, and returns a typed result, never a response":
```ts
export async function swapAccountSlot(
  admin: SupabaseClient,
  args: { userId: string; exchange: string; newKeyId: string; oldHolderId: string;
          venueAccountId: string; venueServer: string | null },
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  ...
  try {
    const { error } = await admin.rpc("swap_account_slot", rpcArgs);
    if (error) return { ok: false, error };
  } catch (error) {
    return { ok: false, error };
  }
  await afterSlotSwap(admin, args);
  return { ok: true };
}
```
Note the posture: errors are RETURNED, never logged inside the helper ("it can carry the login"); the caller scrubs with its own secrets. Copy that. The helper here returns RESEARCH's union `{ kind: "ok" } | { kind: "venue_collision" } | { kind: "holder_read_failed" } | { kind: "write_indeterminate" }`, so the two routes keep their own response vocabularies (`DASHBOARD_*` + `buildEnvelope` in rotate-secret; bare `{ code }` from the create-with-key roster).

**The code to MOVE (not an analog):** `returnsKeyToLive` + `attemptPersist` + the backfill fence + the 23505 retry + the zero-row check + the audit, from `src/app/api/keys/[id]/rotate-secret/route.ts` (symbols: `returnsKeyToLive`, `attemptPersist`, `shouldBackfillVenueAccountId`, `readLiveSameLoginKeys`, `VENUE_IDENTITY_CONSTRAINT`, `logAuditEvent`). Core to preserve byte-for-byte:
```ts
const attemptPersist = (includeVenueAccountId: boolean) =>
  admin.from("api_keys")
    .update({
      api_key_encrypted: parsed.api_key_encrypted,
      api_secret_encrypted: parsed.api_secret_encrypted,
      passphrase_encrypted: parsed.passphrase_encrypted,
      dek_encrypted: parsed.dek_encrypted,
      nonce: parsed.nonce,
      kek_version: parsed.kek_version,
      sync_error: null,
      sync_status: "idle",
      ...(returnsKeyToLive ? { history_inclusion: null } : {}),
      ...(includeVenueAccountId ? { venue_account_id: parsed.venue_account_id } : {}),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("exchange", "mt5")
    .select("id");
```
```ts
if (shouldBackfillVenueAccountId && updateErr && updateErr.code === "23505" &&
    pgConstraintName(updateErr) === VENUE_IDENTITY_CONSTRAINT) {
  ({ data: updatedRows, error: updateErr } = await attemptPersist(false));
}
...
logAuditEvent(supabase, { action: "api_key.rotate_secret", entity_type: "api_key", entity_id: id });
```
**Audit rule:** `src/__tests__/audit-coverage.test.ts` walks one import hop from each route and requires an audit call or `@audit-skip` in the SAME function as the `.update(`. Keep `logAuditEvent` inside `persistRotatedMt5Secret`, beside `.update`. The helper needs `supabase` (user-scoped, for `logAuditEvent`) as well as `admin`.

**Authz posture to keep (CONTEXT review scope):** the UPDATE filter triple `id` + `user_id` + `exchange = 'mt5'` stays inside this function; the `user_id` argument comes from the session, never a body. On this connect arm `venue_account_id` is non-null (the holder was selected by login), so the backfill branch is inert; the helper still takes the pre-read value and applies rotate-secret's rule unchanged.

**Tests:** new `src/lib/api/rotate-key-secret.test.ts`. Analog for shape: `src/lib/venue-identity.test.ts` (helper tests with a faked admin) and the recorder pattern in `rotate-secret/route.test.ts` (`ADMIN_STATE.updates` capturing payload + `filters`, `resultQueue` for collide-then-succeed). Assert: filter triple exact; zero rows maps to `write_indeterminate`; audit emitted only on `ok`; the second 23505 maps to `venue_collision`.

---

### `src/app/api/keys/[id]/rotate-secret/route.ts` (controller, request-response) — refactor, behaviour byte-identical

**Analog:** itself. After the move, the route keeps: CSRF, session, approval gate, UUID check, body shape, the user-scoped ownership read (`api_keys` select of `id, user_id, exchange, venue_account_id, disconnected_at, is_active`), the `keys-rotate-secret:${user.id}` limiter, `createAdminClient()` in its own try (503 `SEAM_MISCONFIGURED`), and EVERY `NextResponse.json({ code ... })` literal.

**Imports it must still have** (so it stays on the seam import edge): `rotateKeySecret` from `@/lib/analytics-client`, `persistRotatedMt5Secret` from `@/lib/api/rotate-key-secret`, `classifyKeyValidationError`, `OUR_DEFECT_KEY_ERROR_CODES`, `buildEnvelope`, `NO_STORE_HEADERS`, `scrubSeamError`, `captureToSentry`.

**Catch to keep exactly** (symbol: the `catch (err)` after the seam call):
```ts
} catch (err) {
  const perRequestSecrets = [newSecret];
  console.error("[api/keys/[id]/rotate-secret] validation failed:", scrubSeamError(err, perRequestSecrets));
  const { code, status } = classifyKeyValidationError(err);
  if (OUR_DEFECT_KEY_ERROR_CODES.has(code)) {
    captureToSentry(err, { tags: { surface: "keys-rotate-secret", step: "unclassified-key-error" },
      extra: { exchange: keyRow.exchange }, secrets: perRequestSecrets });
  }
  const envelope = buildEnvelope(code, correlationId);
  return NextResponse.json(envelope, { status, headers: NO_STORE_HEADERS });
}
```
**Regression gate:** `src/app/api/keys/[id]/rotate-secret/route.test.ts` (56 `it` blocks) must pass UNCHANGED. It mocks `@/lib/resilient-fetch` (symbol `mockResilientFetch`), which keeps working because `analytics-client` imports the same module. Source pins in that file read the route SOURCE (symbols: `interface RotateSecretBody { new_secret?: unknown; }`; every `NextResponse.json(` carries `NO_STORE_HEADERS`; contains `classifyKeyValidationError`), and `src/lib/dialog-envelope.invariant.test.ts` pins this route's `code:`-first emitters. Move only the seam call and the UPDATE.

---

### `src/app/api/strategies/create-with-key/route.ts` (controller, request-response)

**Analog:** itself. Four edits, all pre-validation. Nothing touches the post-validation resolve, the race arm or `failing_holder`.

#### (a) Resolver carries a rotate target from the working-holder path only
**Symbols:** `VenueIdentityResolution` (type), `resolveByVenueIdentity`, `resolveOtherKeyUse`, `resolveStrategiesForKey`, `isWorkingHolder`.

`VenueIdentityResolution` today (the working-holder members carry only `holder`):
```ts
  | { kind: "connected"; strategyName: string | null; holder?: AccountHolder | null }
  | { kind: "held"; holder?: AccountHolder | null }
  | { kind: "orphaned"; holder?: AccountHolder | null }
  | { kind: "failing_holder"; holderId: string }
```
The id is in scope exactly once, after the working check (inside `resolveByVenueIdentity`):
```ts
    const picked = pickSameAccountHolder(rows, venueServer, mode);
    if (picked === null) return UNRESOLVED;
    if (!isWorkingHolder(picked)) {
      ... // the dependent read
      if (dependent) { return { kind: "held", holder: await readOwnAccountHolder(supabase, userId, picked.id, HOLDER_LOG_LABEL) }; }
      return { kind: "failing_holder", holderId: picked.id };
    }
    liveKeyId = picked.id;
```
and the tail that builds the four verdicts:
```ts
  if (byStrategy.kind === "connected") {
    return { ...byStrategy, holder: await readOwnAccountHolder(supabase, userId, liveKeyId, HOLDER_LOG_LABEL) };
  }
  if (byStrategy.kind !== "orphaned") return byStrategy;          // "draft" passes through here
  const otherUse = await resolveOtherKeyUse(supabase, userId, liveKeyId, secrets);
  if (otherUse.kind === "held" || otherUse.kind === "orphaned") {
    return { ...otherUse, holder: await readOwnAccountHolder(supabase, userId, liveKeyId, HOLDER_LOG_LABEL) };
  }
```
**Pattern to apply:** add an optional `rotate?: { keyId: string }` to `connected`, `held`, `orphaned` and `draft`. Set it ONLY on the `liveKeyId` path and ONLY when `picked.venue_server !== null && picked.venue_server === venueServer` (CONTEXT's exact-tier rule). Never set it on the `dependent`-`held` return above (that `held` is a failing holder, not a working one: CONTEXT "never inferred from the verdict"). `draft` already carries `api_key_id: liveKeyId` from `resolveStrategiesForKey`, but set `rotate` too for one code path. `picked` is in scope, so the exact-tier test lives inside the `liveKeyId = picked.id` branch (capture a local `rotateKeyId`). The key id is never put in a response body (T-154-06-C).

#### (b) The rotate arm, at the pre-validation fence
**Symbols:** the `if (venueAccountId) { const venueMatch = await resolveByVenueIdentity(... "fence") ...` block in `POST`, with its arms `read_failed`, `failing_holder`, `draft`, `connected`, `orphaned`, `held`.

Today each working-holder arm returns its refusal directly:
```ts
    if (venueMatch.kind === "draft") { return venueDraftInProgressResponse(venueMatch.strategyName); }
    if (venueMatch.kind === "connected") { return venueAlreadyConnectedResponse(venueMatch.strategyName, venueMatch.holder); }
    if (venueMatch.kind === "orphaned") { return keyOrphanedResponse(venueMatch.holder); }
    if (venueMatch.kind === "held") { return keyVenueAlreadyConnectedResponse(venueMatch.holder); }
```
**Pattern to apply:** insert ONE arm before these four (after `failing_holder` assigns `failingHolderId`): when `venueMatch` has `rotate`, run the rotate leg inside a `try` so a seam throw reaches the route's existing `catch (err)` at the bottom of `POST`; otherwise fall to today's returns (byte-identical). The leg's order, per RESEARCH diagram: `createAdminClient()` fail-hard (503 `SEAM_MISCONFIGURED`, BEFORE the up-to-120 s probe) -> user-scoped re-read of the holder row by id (label, `is_active`, `disconnected_at`, `venue_account_id`) -> `rotateKeySecret(...)` (throws on any seam refusal, NO write, NO outcome field) -> if `secret_changed === false` skip the write and answer `unchanged` -> else `persistRotatedMt5Secret` -> answer the SAME refusal builder plus the outcome.

**Fail-hard admin + two-layer ownership idiom to copy** (symbol `handleReuseExistingKey`):
```ts
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (adminErr) {
    console.error(
      "[strategies/create-with-key] no service-role credential for the reuse arm; refusing (nothing was written):",
      scrubSeamError(adminErr),
    );
    return NextResponse.json(
      { code: "SEAM_MISCONFIGURED", error: "Service credential unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
```
```ts
  const { data: ownedKey, error: ownedKeyErr } = await supabase   // user-scoped, RLS
    .from("api_keys")
    .select("id")
    .eq("id", reuseKeyId)
    .eq("user_id", user.id)
    .is("disconnected_at", null)
    .maybeSingle();
  if (ownedKeyErr) { ... return NextResponse.json({ code: "UNKNOWN", error: "Could not create draft strategy" }, { status: 500, headers: NO_STORE_HEADERS }); }
```
Copy the shape, not the strings: the rotate arm's failure answers must be roster-known codes (`UNKNOWN` 500 for a write failure, `holderReadFailedResponse()` for a read fault, `SEAM_MISCONFIGURED` 503). A missing or non-owned row fails TOWARD today's refusal (return the same builder with no outcome), never toward an outcome.

**Secrets array to pass to every `scrubSeamError` / `captureToSentry` in the arm** (already built for the resolver call; reuse it, add nothing new): `[api_key, apiSecretNormalized, passphraseOrNull, venueAccountId, venueServer]`. The typed password (`apiSecretNormalized`) MUST be in it; `captureToSentry` takes it as `secrets`.

**Seam failure handling:** do NOT write a second classifier. The route's existing catch is the pattern:
```ts
  } catch (err) {
    console.error("[strategies/create-with-key] caught exception:",
      scrubSeamError(err, [api_key, apiSecretNormalized, passphraseOrNull, venueAccountId, venueServer]));
    const { code, status } = classifyKeyValidationError(err);
    if (OUR_DEFECT_KEY_ERROR_CODES.has(code)) {
      captureToSentry(err, { tags: { surface: "strategies-create-with-key", step: "unclassified-key-error" },
        extra: { exchange: exchangeNormalized }, secrets: [api_key, apiSecretNormalized, passphraseOrNull, venueServer] });
    }
    const headers = keyRouteFailureHeaders(err);
    return NextResponse.json({ code }, { status, headers });
  }
```
The rotate arm must sit INSIDE (or be wrapped by) a `try` whose `catch` is this one. Today the pre-validation fence sits OUTSIDE the `try { const validation = await validateKey(...)` block, so the planner either moves the `try` opening up to cover the arm or adds a sibling `try` that rethrows into the same catch body. Decide which, and record it in the plan; do not duplicate the catch.

#### (c) The four refusal builders gain one optional outcome parameter (TWIN-8)
**Symbols:** `venueAlreadyConnectedResponse`, `venueDraftInProgressResponse`, `keyOrphanedResponse`, `keyVenueAlreadyConnectedResponse`.

Their shared shape (copy this placement: the optional fragment is built ABOVE the literal, `code` stays first, so the emitter stays inside the invariant scanner's `error:` window and the body is byte-identical when the param is absent):
```ts
function keyOrphanedResponse(holder?: AccountHolder | null): NextResponse {
  const extra = holderField(holder);
  return NextResponse.json(
    {
      code: "KEY_ORPHANED",
      error: "This key is already stored, but no strategy uses it.",
      ...extra,
    },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}
```
`venueAlreadyConnectedResponse` builds `extra = { ...(strategyName === null ? {} : { strategy_name: strategyName }), ...holderField(holder) }`; `venueDraftInProgressResponse` omits (not nulls) a blank name. Add `...keySecretField(outcome)` to each `extra` (helper in `src/lib/key-secret-outcome.ts`, below). **No new `NextResponse.json({ code ... })` literal anywhere in the arm**: that keeps `wizardErrors.invariant.test.ts`, `wizardKeyRosters.test.ts` and `KNOWN_CREATE_WITH_KEY_CODES` unmoved. The route's top docblock for `keyOrphanedResponse` ("IT TAKES NO PARAMETERS") and the `⛔ NO LOGIN` language must be updated, since it now takes a parameter (`holder` already broke that sentence).

#### (d) Comments to correct, not code
The block beginning "161-05 / WIZERR-03 - `orphaned` DELIBERATELY DOES NOT SHORT-CIRCUIT HERE" through "`held` keeps the latency" and the `212-03 / SC5` comments describe refusals-before-validate; add a dated `CORRECTED` note that the MT5 working-holder arms now validate and rotate (founder ruling 2026-11-26). The `maxDuration = 300` docblock at the top says the route "spends at most two seam budgets back to back"; the rotate arm spends one `keys-rotate-secret` leg instead of validate+encrypt, so that sentence stays true.

---

### `src/app/api/strategies/create-with-key/route.test.ts` (test, request-response)

**Analog:** `describe("[225-07] MT5 admission, the server rule and the swap")` (helpers `routeRpc`, `rpcCalls`, `beforeEach { auditMock.mockReset(); routeRpc(); }`) and the parent `describe("[154-06 / WIZCONT-02] create-with-key - the venue-identity fence")`, whose constants `MT5_LOGIN`, `MT5_RECONNECT_BODY`, `EXISTING_KEY_ID`, `EXISTING_DRAFT_NAME`, `OTHER_SESSION_ID` and `beforeEach` (lines resetting every lookup mock) the new `describe("[228] ...")` should sit inside, so it inherits the same `beforeEach`.

**Seed idiom to copy** (symbol `venueKeyLookupMock` seeding in the 225-07 tests):
```ts
venueKeyLookupMock.mockResolvedValue({
  data: [{ id: EXISTING_KEY_ID, venue_server: SERVER_NORMALISED }],   // exact tier: rotate eligible
  error: null,
});
venueOwnerLookupMock.mockResolvedValue({ data: { id: EXISTING_STRATEGY_ID, name: EXISTING_DRAFT_NAME }, error: null });
```
Null-server and different-server seeds are the O1 negative controls (`venue_server: null` / `"some-other-broker"`): assert today's refusal and ZERO seam calls. The failing-holder-with-composite-dependent seed is the `describe("[WR-06] a failing holder with a composite dependent is refused before admission")` fixture (`compositeDependentReadMock`).

**Harness work the new arm cannot avoid** (each is a `vi.mock` factory or double in this file that a new import or call hits; lines are at HEAD `6039236bf`, re-resolve by symbol):

| Double (symbol) | Line | What breaks | Required change |
|---|---|---|---|
| `vi.mock("@/lib/analytics-client", ...)` | ~95-98 | exports only `validateKey`, `encryptKey`; the route's new `rotateKeySecret` import is `undefined` | add `rotateKeySecret: (...args) => rotateKeySecretMock(...args)` with a `const rotateKeySecretMock = vi.fn()` beside `validateKeyMock` |
| `vi.mock("@/lib/audit", ...)` | ~104-106 | exports only `logAuditEventAsUser`; `persistRotatedMt5Secret` imports `logAuditEvent`, so it would throw "not a function" | add `logAuditEvent: (...args) => auditMock(...args)` (or a separate mock), and reset it in the new describe's `beforeEach` (the venue-fence parent `beforeEach` does not reset `auditMock`; the 225-07 describe does at its own `beforeEach`) |
| `vi.mock("@/lib/supabase/admin", ...)` admin `update()` | ~694-711 | returns `{ eq: () => ({ eq: async () => ({ error: null }) }) }`: two `.eq`, no `.select`, no filter capture. The persist helper chains three `.eq` and `.select("id")` | replace with a recorder: capture the payload and each `.eq(col, val)`, support three `.eq` plus `.select("id")` resolving `{ data: [{ id }], error }`, with an overridable answer. It must keep calling `recordWrite("admin", table, "update")` |
| `vi.mock("@/lib/supabase/server", ...)` user-scoped `select` | ~641-657 + `makeSelectBuilder` `maybeSingle` `api_keys` routing ~582-610 | the holder-row re-read selects different columns than `"label, created_at"`; it falls to `if ("id" in filters)` -> `reuseKeyUserScopedLookupMock`, which returns only `{ id }` | add a `columns`-routed branch (like `client === "user-scoped" && columns === "label, created_at"` -> `ownKeyLabelReadMock`) for the new select, or export a label-only helper selecting exactly `label, created_at` so the existing branch serves it |
| `makeSelectBuilder` fall-through | ~635 | an unknown table (`profiles`) is answered by `draftLookupMock` | for SC-2's role test add a `profiles` branch that records reads (assert ZERO), or `it.each` over roles asserting identical bodies |
| `then` thenable on the select builder | ~566-579 | an awaited select on `api_keys` WITH an `id` filter rejects "unexpected awaited select" | the new reads must end in `maybeSingle()` |
| `vi.mock("@/lib/api/withAuth", ...)` bypass | ~61-66 | none | stays; `MOCK_USER` supplies `user.id` |
| `@/lib/sentry-capture` (real) + `@sentry/nextjs` mock + `sentryState` | ~38-56 | none | reuse `sentryState.captured` to assert secrets are scrubbed from Sentry `extra` on the rotate arm |
| `@/lib/ratelimit` | ~83-91 | none | the rotate arm adds NO limiter token (the request already spent `strategies-create-with-key:<uid>`); assert `checkLimit` is called once |
| `vi.mock("server-only", ...)` | ~19 | none | already present |

**Existing tests the ruling reverses on purpose (rewrite as "now rotates", do not delete; list the reds before editing, RESEARCH Pitfall 8):** by name, in this file: the `225-05 CONN-01 ... VENUE_DRAFT_IN_PROGRESS naming the own draft` group (zero writes and not validated), `an ORPHANED key ... is refused 409 KEY_ORPHANED before validate and the RPC`, the orphan and wrong-credentials ordering tests in `describe("[161-05 / WIZERR-03] the orphan answers KEY_ORPHANED ...")`, `a WORKING same-login same-server key whose strategy is past draft is refused by name BEFORE validateKey` (becomes the exact-tier rotate test), and `a WORKING same-login key whose server is NULL matches at the fence for any server (the wildcard)` (becomes the O1 NEGATIVE control: today's refusal, zero seam calls). Keep the body byte-pins by asserting the same refusal body with the outcome field appended.

**Extend, do not replace:** `it("⛔ NO ARM EVER ECHOES THE LOGIN BACK TO THE BROWSER")` (stringify the whole response, assert the login absent) gets a rotate-arm response added (and the typed password, the ciphertext, the key id, and the server). **Pin O4:** run the arm twice (`rotateKeySecretMock` first `secret_changed: true`, then `false`) and assert one UPDATE total. **Pin O3:** `it.each` over the three seam failure details asserting classifier code, no outcome field, zero UPDATEs, zero audit.

---

### `src/lib/key-secret-outcome.ts` NEW (utility, transform; client-safe)

**Analog:** `holderField` / `parseAccountHolder` at the bottom of `src/lib/own-account-holder.ts` (server fragment builder + browser shape-check, one module). Copy the pair, but put it in its OWN dependency-free file: `own-account-holder.ts` imports `captureToSentry` and the Supabase types, which a browser-imported leaf should not pull. Imports: none beyond types.
```ts
/** The response fragment: `{ holder }` or nothing, so an absent holder leaves the body byte-identical to before. */
export function holderField(holder: AccountHolder | null | undefined): { holder?: AccountHolder } {
  return holder ? { holder } : {};
}

export function parseAccountHolder(raw: unknown): AccountHolder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "strategy" && r.kind !== "key") return null;
  if (typeof r.name !== "string" || r.name.trim().length === 0) return null;
  ...
}
```
**Apply:** `KeySecretOutcome` type (`"updated" | "unchanged"` plus an optional trimmed name), `keySecretField(outcome)` returning `{}` when absent (body byte-identical, name OMITTED not nulled when blank, exactly like `strategy_name`), and `parseKeySecretOutcome(raw)` that closed-set-checks `outcome` and requires a non-blank string `name` (never an href, never trusted as typed). The notice sentences from UI-SPEC section 1.3 are built in exactly one place (TWIN-8, UI-SPEC G4): put the sentence builder here too, so the visible `<p>` and the `LiveRegion` message cannot diverge.
**Test:** `src/lib/key-secret-outcome.test.ts`, analog the `parseAccountHolder` cases in `src/lib/own-account-holder.test.ts` (rejects unknown outcome, blank or non-string name, non-object).

---

### `src/lib/own-account-holder.ts` — `readOwnKeyLabel` (service read, CRUD)

**Analog:** the `step = "key"` read inside `readOwnAccountHolder` (symbol) and that function's catch posture (never throws, logs by error code only, `void captureToSentry(...)`).
```ts
    step = "key";
    const { data: key, error: keyErr } = await db
      .from("api_keys")
      .select("label, created_at")
      .eq("user_id", userId)
      .eq("id", keyId)
      .maybeSingle();
    if (keyErr) throw keyErr;
    const row = key as { label?: unknown; created_at?: unknown } | null;
    if (!row || typeof row.label !== "string" || row.label.trim().length === 0) {
      return null;
    }
```
Needed because the `connected` holder is the STRATEGY (UI-SPEC re-measurement row 4), so the key's nickname is not on the response today. Select exactly `label, created_at` so the existing test double branch (`columns === "label, created_at"` -> `ownKeyLabelReadMock`) serves it with no new routing, or select what the arm needs and add the double branch. Owner filter on `user_id` is mandatory (header docblock: "THE CALLER'S OWN ROWS, AND ONLY EVER THAT"). Test in `src/lib/own-account-holder.test.ts` using its `fakeDb` (foreign rows first sharing the key id, so a dropped owner filter returns the foreign row).

---

### `src/lib/wizardErrors.ts` — `KEY_ORPHANED` named Disconnect bullet (model, transform)

**Analog:** the existing holder arms in `formatKeyError` (symbols: `if (code === "KEY_ORPHANED" && context?.holder?.kind === "key")` and the `KEY_VENUE_ALREADY_CONNECTED` arm directly under it) and `holderLink`.
```ts
  if (code === "KEY_ORPHANED" && context?.holder?.kind === "key") {
    const added =
      context.holder.added_at !== undefined && formatDay(context.holder.added_at) !== "—"
        ? `, added ${formatDay(context.holder.added_at)}`
        : "";
    return {
      ...base,
      cause: `You already stored this account as your key "${context.holder.name}"${added}. ` + base.cause,
    };
  }
```
**Apply:** hold today's third `fix` sentence once as a module constant (identify the bullet by CONTENT, not index) and use it in the `WIZARD_ERROR_COPY.KEY_ORPHANED.fix` array (symbol `KEY_ORPHANED:` entry) so the unnamed case stays byte-identical. In the holder arm above, return `fix: base.fix.map((f) => f === KEY_ORPHANED_DISCONNECT_FIX ? named(context.holder.name) : f)` alongside the existing `cause`. UI-SPEC section 3 gives the exact named sentence with curly quotes around the nickname. Strategy holder, absent holder, blank name: today's sentence (the holder is already shape-checked by `parseAccountHolder`, which drops blank names). The table sentence is not pinned verbatim anywhere else (RESEARCH measured one hit). Tests: `ConnectKeyStep.test.tsx` KEY_ORPHANED render test (below) and `formatKeyError("KEY_ORPHANED", { holder })` unit cases in `src/lib/wizardErrors.test.ts` (it already imports `formatKeyError` and `type WizardErrorContext`).

---

### `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` (component, request-response)

**Analog:** itself. Four touch points, all symbols.

1. **State + per-failure clearing.** Copy the `existingHolder` pattern: state declared next to `existingStrategyName` / `existingHolder`; cleared at the top of `handleSubmit` beside `setExistingStrategyName(null); setExistingHolder(null);`; set in the `!res.ok` branch from the SAME response as `errorCode`:
```ts
        setExistingHolder(parseAccountHolder(data.holder));
```
   -> add `setKeyOutcome(parseKeySecretOutcome(data.key_secret))` (or the planner's flat equivalent) and the `data` type annotation gains the field as `unknown` (see the `holder?: unknown` line in the `readCreateWithKeyBody<{ ... }>` generic). The UI-SPEC lifecycle also clears it in the envelope's `onRetry`.
2. **Render.** The immediate previous sibling of the envelope (symbol: `{errorEnvelope && (<WizardErrorEnvelope envelope={errorEnvelope} onRetry={() => setErrorCode(null)} />)}` near the end of the credential render). Visual recipe is UI-SPEC section 1.4. Real donors for the positive recipe: `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` (`className="rounded-md border border-positive/30 bg-positive/5 px-3 py-2"`) and `src/components/ui/ScopedBanner.tsx` (`success: "border border-positive/30 bg-positive/5"`, DECLINED by UI-SPEC for its serif title). Neutral donor: the `wizard-dedup-notice` strip in `WizardClient.tsx` (`border-border bg-page px-3 py-2`). Add `text-body text-text-primary break-words`, `data-testid="wizard-key-outcome-notice"`, `data-outcome`, NO `role` on the `<p>`.
3. **Always-mounted polite announcement.** Analog: `ValidateWaitCard.tsx` mounts `<LiveRegion message={announcement} />` for its whole life (polite, no `assertive`), and `StrategiesSection.tsx` holds `const [announcement, setAnnouncement] = useState<string | null>(null)` then `<LiveRegion message={announcement} />`. `LiveRegion`'s own contract (docblock): render before the message arrives, pass the SAME sentence the surface shows, never author new copy. Mount it unconditionally in the credential render with `message={noticeText}` (null when no notice). `MetadataStep.tsx`'s use is `assertive` and is NOT the donor.
4. **Comment-only edit:** the docblock near the `wizard-dedup-notice` reference (around the line quoting the retired F6 sentence, ~:1364 at HEAD per RESEARCH) quotes the old copy; update in the same edit.

**Test:** `ConnectKeyStep.test.tsx`. Analog: `it("KEY_ORPHANED names the stored key (nickname and date) and links to where it is listed")`:
```tsx
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: "KEY_ORPHANED", error: "...", holder: { kind: "key", name: "Test", added_at: "...", href: "/strategies" } }, 409));
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));
    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "KEY_ORPHANED");
```
Use `jsonResponse`, `fillKeyAndSecret`, `SESSION` (helpers already in that file). UI-SPEC Test Contract items 1-6 and 8 map here: exact sentences, DOM order notice-before-`error-envelope`, no notice on a seam refusal, cleared on resubmit and on Retry, the always-mounted `LiveRegion` exists before the response and carries the exact sentence after, G1 sweep over text and attributes.

---

### `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — F6 fallback strip (component, event-driven)

**Analog:** itself (symbol: the `dedupedExisting && step === "sync_preview"` strip, `data-testid="wizard-dedup-notice"`). Replace ONLY the third ternary arm; markup, gate, test id and the two other arms stay byte-identical.
```tsx
            {dedupedKeptDraft
              ? "We kept the strategy this setup already created, on its original key. To connect different credentials, delete this draft first."
              : dedupedHeldOnly
                ? "We continued with a strategy that already exists for these credentials or this setup instead of creating a duplicate. To connect different credentials, delete that draft first."
                : "These credentials are already connected. We continued with your existing strategy instead of creating a duplicate."}
```
New fallback text is UI-SPEC section 2 (it deliberately narrows CONTEXT's "not checked or saved" to "did not change that key", because the post-validation same-session arm reaches this branch after `validateKey` ran: UI-SPEC re-measurement row 3 and assumption A2). Update the state docblock that quotes the old sentence (the `dedupedKeptDraft` docblock, `"These credentials are already connected" would be false there`) in the same edit.
**Tests (`WizardClient.test.tsx`):** analog `describe("[154-06 / WIZCONT-02] WizardClient - the dedup notice")`. Its `DEDUP_COPY` constant and the first `it` ("renders the neutral strip ...", `connect-success-deduped`) hard-code the OLD sentence and must change to the new one. `describe("[213 CR-02] ...")`'s `OLD_COPY` is asserted ABSENT (`expect(screen.queryByText(OLD_COPY)).toBeNull()`): keep it, it now genuinely discriminates. `KEPT_COPY` and `HELD_ONLY_COPY` stay byte-identical. Add absence assertions for `already connected`, `checked` and `not saved` on the fallback.

---

### `src/lib/resilient-fetch.ts` — `SEAM_ROUTE_BUDGETS` create-with-key row (config)

**Analog:** the rows beside it. The source of truth is in `resilient-fetch.ts` (symbol `SEAM_ROUTE_BUDGETS`), not in the test.
```ts
  "src/app/api/strategies/create-with-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1, branch: "default-venue" },
      { key: "validate-key-serialized", calls: 1, branch: "serialized-venue" },
      { key: "encrypt-key", calls: 1 },
    ],
  },
```
**Constraint (measured in the test, see next entry):** add the rotate leg as its OWN exclusive branch, e.g. `{ key: "keys-rotate-secret", calls: 1, branch: "mt5-rotate" }`. Do NOT add it unlabelled or to the `serialized-venue` branch (SC-4b would sum validate+encrypt+rotate = a real breach). Only `serialized-venue` and `default-venue` labels exist for connect routes today (the other labels in the file are `composite` and `single-key`, on other routes). The `keys-rotate-secret` budget key itself exists and stays `retries: 0`; no new `RouteBudgetKey`. Unlabelled `encrypt-key` is then charged to the new branch too (over-stating it, still under the browser deadline per RESEARCH Pitfall 1).

---

### `src/lib/seam-budgets.invariant.test.ts` (census test)

**Analog:** itself. Three coupled edits:
1. `EXPECTED_ROUTE_BUDGETS` twin of the row above (the create-with-key entry, same `branch: "mt5-rotate"` leg).
2. The PARITY-03 oracle loops BOTH connect routes over `CONNECT_VENUE_ARMS` and throws on a missing label:
```ts
const CONNECT_VENUE_ARMS = [
  { branch: "serialized-venue", venue: "mt5", failingWorstCaseMs: 175_500 },
  { branch: "default-venue", venue: "binance", failingWorstCaseMs: 85_500 },
] as const;
...
      expect(CONNECT_VENUE_ARMS.length, "...exactly two mutually exclusive venue arms...").toBe(2);
      for (const routePath of BROWSER_ABORTED_CONNECT_ROUTES) {
        for (const arm of CONNECT_VENUE_ARMS) {
          ... const branch = branchWorstCases(entry, state).find((b) => b.label === arm.branch);
          if (!branch) { throw new Error(`"${routePath}" no longer declares a "${arm.branch}" branch. ...`); }
```
   A third row cannot simply be appended: `composite/add-key` has no rotate branch and the loop checks both routes. The rotate leg needs its own hand-computed assertion instead (RESEARCH Pitfall 1: `SEAM_BUDGETS["keys-rotate-secret"].timeoutMs <= SEAM_BUDGETS["validate-key-serialized"].timeoutMs`, equal `retries`, and a hand-typed `mt5-rotate` failing worst case below `connectAbortDeadlineMsFor("mt5") - WAIT_ABORT_GRACE_MS`). Figures are hand-computed, never read back out of `branchWorstCases` (the file's own rule).
3. `deriveSeamRouteFiles` / `SEAM_IMPORT_EDGE` (`SEAM_MODULES = ["analytics-client","resilient-fetch","process-key-client"]`): no edit if `rotate-secret/route.ts` keeps importing `analytics-client` (the recommended placement). Verify by running SC-4f.

---

### `src/lib/resilient-fetch.wiring.test.ts` (census test)

**Analog:** itself. Edits under the recommended placement: the B-15 row's `site` (symbol `{ id: "B-15", family: "iii", key: "keys-rotate-secret", ...}`) moves from `src/app/api/keys/[id]/rotate-secret/route.ts` to `src/lib/analytics-client.ts`; `EXPECTED_SEAM_CALL_FILES` drops `"src/app/api/keys/[id]/rotate-secret/route.ts"` (`"src/lib/analytics-client.ts"` is already listed). Verify `discoverAnalyticsWrappers` does not treat `rotateKeySecret` as a wrapper (it keys on `analyticsRequest(` inside each exported function body; the new function calls `resilientFetch(` directly). Run the whole census set (command in RESEARCH Validation Architecture) after the extraction and BEFORE building the arm, to measure which censuses actually move (RESEARCH A7: derived from reading, not running; there is no `node_modules` in this worktree).

---

## Shared Patterns

### Secret hygiene on every log and capture
**Source:** `src/app/api/strategies/create-with-key/route.ts` (the `catch (err)` at the bottom of `POST`, and the resolver's `scrubSeamError(liveKeyErr, secrets)` / `captureToSentry(liveKeyErr, { tags, secrets })`).
**Apply to:** every `catch`, `console.error` and `captureToSentry` in the rotate arm and in `persistRotatedMt5Secret`'s callers. The typed password, login, server and `venueAccountId` are always named in `secrets`. `scrubSeamError` redacts exact-value matches regardless of length for per-request candidates. Pass the caught value UNMODIFIED to `captureToSentry` (it scrubs at the chokepoint; pre-scrubbing destroys grouping).

### No identifier in any response body (T-154-06-C)
**Source:** the builder docblocks (`venueDraftInProgressResponse`: "IT TAKES NO IDENTITY PARAMETER"), `holderField`, and `it("⛔ NO ARM EVER ECHOES THE LOGIN BACK TO THE BROWSER")`.
**Apply to:** the outcome field. It carries only `outcome` and the caller's own key nickname. Never the login, server, key id, venue account id, password or ciphertext. A key id is carried explicitly on the server-side resolver member only, never serialised.

### Owner scoping on every read and write
**Source:** `readLiveSameLoginKeys` (mandatory `userId` in its signature), `readOwnAccountHolder` (explicit `user_id` filter), `handleReuseExistingKey` (admin read with `.eq("user_id", user.id)` as "THE TENANT BOUNDARY", then a user-scoped RLS re-read), and the UPDATE filter triple in `rotate-secret/route.ts`.
**Apply to:** the label read, the holder-row re-read, the seam body (`user_id` from `withAuth`'s session, never the request body), and the UPDATE (`id` + `user_id` + `exchange = 'mt5'`). The admin client crosses RLS, so the explicit filter IS the tenant boundary.

### `code` first, as a literal; no emitter outside the scanned window
**Source:** every refusal builder in `create-with-key/route.ts` and the header comment of `rotate-secret/route.ts` ("`code:` is written FIRST in every literal rejection body").
**Apply to:** any new response literal. The plan should add none: reuse the four builders plus an optional spread, and keep every `NextResponse.json({ code ... })` in the route files that the invariant scanners read (`src/lib/wizardErrors.invariant.test.ts`, `src/lib/dialog-envelope.invariant.test.ts`).

### NO_STORE_HEADERS on every response
**Source:** `import { NO_STORE_HEADERS } from "@/lib/api/headers"`; both routes stamp it on every arm, and `rotate-secret/route.test.ts` pins "stamps NO_STORE_HEADERS on every response arm" by counting `NextResponse.json(` against `NO_STORE_HEADERS` in the source.

### Failure classification: one classifier, no second cascade
**Source:** `classifyKeyValidationError` + `OUR_DEFECT_KEY_ERROR_CODES` (both key routes), `keyRouteFailureHeaders` (`@/lib/api/seam-retry-after`) for the create-with-key twin.
**Apply to:** the rotate arm's seam failures. A seam refusal (`KEY_MT5_SIGN_IN_REFUSED`, `KEY_MT5_MASTER_PASSWORD`, `KEY_MT5_WRONG_SERVER`, `KEY_MUST_BE_RECONNECTED`, rate-limit, timeout) arrives through the existing `seamCode` branch and is already on `KNOWN_CREATE_WITH_KEY_CODES` via `CLASSIFIER_RETURNED_CODES` (A5 in RESEARCH: Wave 0 asserts every code the rotate path can classify to is a member).

### Test discipline (PROOF-01)
**Source:** project memory and `CLAUDE.md`: neuter, see RED naming the arm, restore from a byte backup (`cp` back, `cmp`), see GREEN; never `git checkout/restore/stash` on uncommitted work. Money-math-style gates must be able to fail. Always `grep -a`. pytest only from `analytics-service/`. Paste the transcript for every RESEARCH Validation row into the plan SUMMARY.

---

## No Analog Found

None. Two files only have role-match analogs (no exact one), so the planner leans on RESEARCH's recommended shape for the details:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/api/rotate-key-secret.ts` | lib helper | CRUD | No existing helper moves a route's `api_keys` ciphertext UPDATE out of a route. `swapAccountSlot` is the structural analog (typed result, admin in, audit in-function); the body is code to MOVE from `rotate-secret/route.ts`. |
| `src/lib/analytics-client.ts` `rotateKeySecret` | seam client | request-response | Every existing wrapper goes through `analyticsRequest(path, body, { budgetKey, tenantId })`; the rotate seam is an `/internal/...` call with its own header set (`X-Internal-Token`, `X-Correlation-Id`) via `resilientFetch` directly, so `validateKey` is only a shape analog. Move the existing inline call instead of routing it through `analyticsRequest`. |

## Metadata

**Analog search scope:** `src/app/api/keys/`, `src/app/api/strategies/create-with-key/`, `src/lib/`, `src/lib/api/`, `src/components/ui/`, `src/app/(dashboard)/strategies/` (wizard steps), `src/app/(dashboard)/allocations/components/`, `analytics-service/routers/`, `analytics-service/tests/`.
**Files read in full or by targeted range:** 21 (route files, helpers, schemas, copy table, both wizard components, harness sections of two route tests, Python endpoint and test, budget and wiring censuses).
**Pattern extraction date:** 2026-11-26
**Verified at HEAD:** `6039236bf`. Re-anchor by symbol; do not trust line numbers across phases.
