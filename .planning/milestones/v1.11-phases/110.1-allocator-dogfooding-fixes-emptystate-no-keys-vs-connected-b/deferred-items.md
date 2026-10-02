# Phase 110.1 — Deferred Items

Out-of-scope discoveries logged during execution (not fixed — SCOPE BOUNDARY).

## Pre-existing test failures in AllocatorExchangeManager.test.tsx (5)

Discovered during 110.1-01 Task 2. These fail on the branch **independent of this
plan's changes** (confirmed: the committed branch state before Task 2 already had
`5 failed | 36 passed`).

Failing tests:
- `handleAddKey awaits POST and on 200 success leaves new row at sync_status='syncing' with no error helper`
- `handleAddKey_shows_error_when_first_run_sync_fails_with_403`
- `propagates the validate-and-encrypt ciphertext + kek_version into the api_keys insert (M-0407)`
- `applies the ?? fallbacks when validate-and-encrypt omits kek_version/dek_encrypted/nonce (M-0407)`
- `preserves kek_version:0 from validate-and-encrypt (nullish ?? 1, not falsy || 1) (M-0407)`

Root cause: `submitAddKeyForm()` helper calls `screen.getByLabelText(/API Secret/i)`,
which now matches **multiple** inputs in the shared `ApiKeyForm` add-key modal —
`TestingLibraryElementError: Found multiple elements with the text of: /API Secret/i`.
The shared form (`src/components/strategy/ApiKeyForm.tsx`) drifted (a second
secret-like labelled field) and the exchanges-side test fixture was not updated.

Why deferred: unrelated to DOGFOOD-1/DOGFOOD-2 (subtitle/empty-state copy); the fix
lives in `ApiKeyForm` + the add-key test helper, both outside this plan's file set.
Recommend a follow-up to disambiguate the label matcher (e.g. `getByLabelText(/^API Secret$/i)`
or a testid) so the add-key regression coverage is restored.
