---
phase: 02-mandate-profile-builder
reviewed: 2026-04-18T16:30:25Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - supabase/migrations/061_mandate_columns.sql
  - src/__tests__/mandate-columns-schema-sync.test.ts
  - src/__tests__/update-allocator-mandates-rpc.test.ts
  - src/__tests__/mandate-audit.test.ts
  - src/app/api/preferences/route.test.ts
  - src/lib/audit.ts
  - src/lib/admin/match.ts
  - src/lib/preferences.ts
  - src/lib/preferences.test.ts
  - src/app/api/preferences/route.ts
  - src/app/api/admin/match/preferences/[allocator_id]/route.ts
  - src/components/admin/PreferencesPanel.tsx
  - src/components/admin/AllocatorMatchQueue.tsx
  - docs/architecture/adr-0023-audit-event-taxonomy.md
  - src/components/mandate/MandateForm.tsx
  - src/components/mandate/MandateSlider.tsx
  - src/components/mandate/MandateChipGroup.tsx
  - src/components/mandate/MandateSegmentedRadio.tsx
  - src/components/mandate/MandateAdvancedSection.tsx
  - src/components/mandate/MandateSaveStatus.tsx
  - src/components/mandate/useMandateAutoSave.ts
  - src/components/mandate/useMandateAutoSave.test.ts
  - src/components/mandate/formatRelativeTime.ts
  - src/components/mandate/formatRelativeTime.test.ts
  - src/components/mandate/MandateForm.test.tsx
  - src/components/mandate/MandateAdvanced.test.tsx
  - e2e/mandate-form.spec.ts
  - src/app/(dashboard)/preferences/page.tsx
  - src/app/globals.css
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-18T16:30:25Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 02 ships the Mandate Profile Builder in two plans (backend + frontend). The security-critical surface is strong: the SECURITY DEFINER RPC `update_allocator_mandates` is authored correctly (auth guard via `auth.uid()`, `SET search_path`, REVOKE/GRANT hygiene, bounds validation, whitelisted `p_clear_fields`, self-verifying DO block), the RLS policy drop is clean, the audit plumbing lands on both the user and admin paths, and the route handler's null-to-clear transform is safe. Tests are thorough at all three layers (route handler unit, live-DB RPC, E2E Playwright with per-test allocator provisioning). No P0/critical issues found.

Four P1/Warnings flagged — the most load-bearing is a **stale field-error after a 429 retry success** in `useMandateAutoSave.ts`: the "Saving too fast. Will retry in Ns." message persists forever after the retried save succeeds, contradicting the hook's own design contract. The **5 req/min rate limit on an auto-save form** is likely too tight in practice; it will trip during normal interactive mandate-building. The other two warnings are a **type divergence** between the two `AllocatorPreferences` interfaces (required in `src/lib/preferences.ts`, optional in `src/components/admin/AllocatorMatchQueue.tsx`) and a **missing abort/timeout** on the auto-save fetch (a hung request will leave `savingFields` stuck with no recovery short of a new save).

Info items are style/robustness nits: a fragile E2E selector (`.first()` on any Reset button), an unreachable `PGRST205` path in `getOwnPreferences` now that migration 061 has applied, two places where a null-check could be tightened, and a minor admin-path denorm-write that runs even when the RPC-layer audit path already fired.

## Critical Issues

_None._

## Warnings

### WR-01: `useMandateAutoSave` — stale `fieldErrors` persists after 429 retry success

**File:** `src/components/mandate/useMandateAutoSave.ts:126-136`

**Issue:** When the hook receives a 429, it sets `fieldErrors[fieldName] = "Saving too fast. Will retry in {N}s."` at line 128, then `await wait(...)` and `continue` into the next attempt. If the retry succeeds, the `res.ok` branch at lines 115-124 sets `saveState = "saved"` and clears `savingFields`, but never clears `fieldErrors[fieldName]`. Result: the "Saving too fast…" inline error stays rendered under the field indefinitely, next to a fresh "Mandate saved" flash — until the user triggers another save. The hook's own docstring (line 26: "429: reads `Retry-After` header, schedules one retry after the interval, **clears error on retry success**") explicitly claims this is handled.

The unit test `TC5` (line 118-135) does not assert `fieldErrors.max_weight` is `undefined` after retry, so the bug is not caught by the suite.

The same analysis applies to the network-error retry path (catch branch, lines 93-98): no error is set before `continue`, so no stale state there. The 5xx retry path (lines 155-159) also sets no error before retry, so that path is clean. Only the 429 branch leaks.

**Fix:**
```ts
if (res.ok) {
  setLastSavedAt(new Date());
  setSaveState("saved");
  setSavingFields((prev) => {
    const n = new Set(prev);
    n.delete(fieldName);
    return n;
  });
  clearError(fieldName); // <-- clear any stale 429-retry error
  return;
}
```
Add a corresponding assertion in `TC5` (e.g. `expect(result.current.fieldErrors.max_weight).toBeUndefined();`) so the regression is caught.

### WR-02: `userActionLimiter` = 5 req/min is likely too tight for an auto-save mandate form

**File:** `src/app/api/preferences/route.ts:38-44` (consumer) + `src/lib/ratelimit.ts:49` (definition)

**Issue:** `userActionLimiter = makeLimiter(5, "60 s")` caps `/api/preferences` PUT at 5 requests per user per minute. Phase 02 converts this route from a single "Save" button into an auto-save sink for 9 self-editable fields, each committing on blur / pointerup / touchend / toggle. A user who toggles 3 preferred strategy types, 2 excluded exchanges, edits max_weight on a slider, and blurs the ticket size + archetype textareas within ~30 seconds has fired 8+ requests, trip the limiter, and seen the 429 "Saving too fast. Will retry in 5s." error mid-flow. The hook's 429 retry helps on a single burst but will not repair a sustained interaction pattern because the retry itself re-enters the same 5/min bucket.

This is a design tradeoff, not an obvious bug, but the limiter was sized for "sensitive POSTs (attestation, deletion requests)" per its comment — auto-save UX has a different profile. Worth flagging for explicit decision before merging.

**Fix (options, pick one):**
- Carve out a dedicated limiter: `export const mandateAutoSaveLimiter = makeLimiter(30, "60 s");` and wire it into `/api/preferences` PUT only. Keep `userActionLimiter` as-is for the sensitive-POST paths it was sized for.
- Document the deferred decision in `.planning/phases/02-mandate-profile-builder/deferred-items.md` and add a manual QA step: "click through 10 fields in < 60s and confirm no 429".
- Keep 5/min but tune the hook's 429 helper copy ("Autosave paused, please wait 5s") and ensure the form is visually usable during the throttle window.

### WR-03: `AllocatorPreferences` type divergence — optional vs required fields across files

**File:** `src/components/admin/AllocatorMatchQueue.tsx:98-118` vs `src/lib/preferences.ts:17-39`

**Issue:** Two interfaces named `AllocatorPreferences` exist:

- `src/lib/preferences.ts` (server-side canonical) declares the 6 Phase 2 fields (`edited_by_user_id`, `max_weight`, `correlation_ceiling`, `liquidity_preference`, `style_exclusions`, `mandate_edited_at`) as **required** (`: T | null`).
- `src/components/admin/AllocatorMatchQueue.tsx` (client-side admin type — exported and consumed by `PreferencesPanel.tsx`) declares the same 6 fields as **optional** (`?: T | null`).

`PreferencesPanel.tsx:8` imports from the admin file, not from `@/lib/preferences`. The `MandateForm.tsx:8` imports from `@/lib/preferences`. So the two layers use different shapes for the same DB row.

Consequences:
1. Code that reads `preferences.max_weight` via the admin type must handle `undefined`, but `MandateForm` (via the canonical type) only handles `null`. The row shape returned from `getOwnPreferences` never sets `undefined` (Postgres returns NULL → JS `null`), so the practical runtime behavior is identical, but the type discipline is lost.
2. If migration 061 is rolled back, the admin type silently degrades to "field missing" rather than "field nullable" — harder to spot than a canonical-type compile error.
3. `PreferencesPanel.tsx:446-453` renders `preferences.mandate_edited_at && ...`, which short-circuits on both `null` and `undefined` identically — no observable behavior difference today.

**Fix:** Have `src/components/admin/AllocatorMatchQueue.tsx` re-export the canonical `AllocatorPreferences` from `@/lib/preferences` (drop its local redefinition). If the admin client genuinely needs a looser shape (e.g. for the demo/readonly variant), name the local interface differently and document why.

```ts
// In AllocatorMatchQueue.tsx, replace the local interface with:
export type { AllocatorPreferences } from "@/lib/preferences";
```

### WR-04: `useMandateAutoSave` — no AbortController / fetch timeout; hung request leaks `savingFields`

**File:** `src/components/mandate/useMandateAutoSave.ts:87-92`

**Issue:** The `fetch("/api/preferences", ...)` call has no `signal` and no wall-clock timeout. If the server or a middle-box hangs the request body (not uncommon on cold-start serverless with network jitter), the fetch never resolves — the loop never advances, `savingFields` stays populated, the slider stays `aria-busy`, the UI spinner keeps pulsing. The generation counter will drop the response if/when it eventually arrives, but the user sees "still saving" forever until they manually trigger another save on the same field.

The hook's retry logic also only kicks in on `try { fetch } catch { … }` (network failure after the browser aborts its own connection). A silent TCP stall before browser abort → no catch, no retry, permanent stuck state.

**Fix:** Add a 10-15s AbortController on each attempt.
```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 12_000);
try {
  res = await fetch("/api/preferences", { ..., signal: controller.signal });
} catch (err) {
  // AbortError also lands here — same retry path.
  clearTimeout(timer);
  // ... existing backoff logic ...
}
clearTimeout(timer);
```
Aborts raise in the existing `catch {}` branch, so the backoff + generation logic already handles it correctly with one line of plumbing.

## Info

### IN-01: E2E `Reset` selector uses `.first()` — fragile against reorder

**File:** `e2e/mandate-form.spec.ts:171`

**Issue:** `page.getByRole("button", { name: "Reset" }).first()` assumes the max_weight Reset is the FIRST Reset button in DOM order. Today the order is max_weight → preferred_strategy_types → excluded_exchanges → ticket_size → archetype → advanced. If a future UI-SPEC tweak reorders Basics (e.g., moves preferred_strategy_types above max_weight), the test silently targets the wrong Reset.

**Fix:** Anchor the selector to the slider's scope. Since `MandateSlider.tsx:78-86` renders the Reset inside the same `<div className="flex items-baseline justify-between">` as the slider label, test can scope via a role-based container:
```ts
const maxWeightRegion = page
  .getByRole("group", { name: "Max weight per strategy" }) // needs role="group" on slider wrapper
  // or:
  .locator("div", { has: page.getByLabel("Max weight per strategy") });
await maxWeightRegion.getByRole("button", { name: "Reset" }).click();
```
Or — simplest — give the Reset button a `data-testid="max-weight-reset"` hook, same pattern already used on `mandate-save-status`.

### IN-02: `getOwnPreferences` PGRST205 fallback is unreachable after migration 061

**File:** `src/lib/preferences.ts:218-225`

**Issue:** The `if (error.code === "PGRST205")` branch comments say "migration 011 not applied yet" — both migrations 011 and 061 have shipped to production; `allocator_preferences` is guaranteed to exist. The fallback is effectively dead code, but it's cheap (one conditional) and the comment is slightly misleading now. Low-priority cleanup when the file is next touched.

**Fix:** Either delete the PGRST205 branch (throw like other errors) OR update the comment:
```ts
// PGRST205 = table not in schema cache. Can happen during a migration
// rollback scenario (011 or 061 reverted). Treat as "no preferences yet"
// so the page still renders instead of 500'ing.
```

### IN-03: Admin route denorm write runs even when RPC audit already emitted

**File:** `src/app/api/admin/match/preferences/[allocator_id]/route.ts:75-78`

**Issue:** The admin route already correctly emits `mandate_preference.admin_update` at line 61. Immediately after, line 75 does `await admin.from("profiles").update({ preferences_updated_at: ... })`. The `@audit-skip` pragma at line 72 correctly declares this as a denorm write. Two nits:

1. The `await` on line 75 blocks the response on the denorm write — if that UPDATE fails (e.g., transient network), the caller sees a 500 even though the primary write + audit already landed. Better: `.then(…).catch(…)` or wrap in `after()` to fire-and-forget like the audit.
2. If the denorm write fails silently via `after()`, the "Last saved" badge on the admin UI may show a stale timestamp — but the authoritative `allocator_preferences.updated_at` is already correct.

Low-priority because the probability of this UPDATE failing is miniscule, but it does mean a rare network blip on the `profiles` table takes down a mandate save that would otherwise have succeeded.

**Fix (optional):**
```ts
after(async () => {
  const { error } = await admin
    .from("profiles")
    .update({ preferences_updated_at: new Date().toISOString() })
    .eq("id", allocator_id);
  if (error) console.error("[api/admin/match/preferences] denorm write failed:", error);
});
```

### IN-04: `PreferencesPanel.tsx` — `String.fromCharCode(183)` for middot is obscure

**File:** `src/components/admin/PreferencesPanel.tsx:450`

**Issue:** The file renders a middle-dot separator via `String.fromCharCode(183)` (decimal for `·`). Same file uses Unicode escapes (`\u2713`, `\u25BC`) elsewhere. Either idiom works; mixing both hurts grep-ability. The existing "Decision history" / "Excluded strategies" code in `AllocatorMatchQueue.tsx:633,682` uses the `\u25BC` escape.

**Fix:** Replace `{String.fromCharCode(183)}` with `{"\u00B7"}` or just the literal `·` for consistency with other separators in the same codebase.

### IN-05: `MandateSlider` has no useEffect cleanup for the keyboard-debounce timer

**File:** `src/components/mandate/MandateSlider.tsx:50-55`

**Issue:** `keyTimerRef` persists via `useRef` across re-renders (W-09 fix — correct). But there's no cleanup on unmount. If a user keys the slider and navigates away within the 300ms window, `onCommit` fires against an already-unmounted parent's state setter. In practice `MandateForm` keeps `setMaxWeight` etc. valid even post-unmount (React tolerates it with a dev-only warning), and the generation counter in `useMandateAutoSave` means the save itself won't stomp on anything — but the dev-only warning would still fire.

Compare with `PreferencesPanel.tsx:80-86` which has a matching cleanup `useEffect` for its `successTimerRef` — the pattern exists in the codebase.

**Fix:**
```ts
useEffect(() => {
  return () => {
    if (keyTimerRef.current) clearTimeout(keyTimerRef.current);
  };
}, []);
```
Trivial, cleans up the console, and matches the precedent.

### IN-06: `MandateForm.tsx` — `toggleIn` helper could live at module scope

**File:** `src/components/mandate/MandateForm.tsx:74-76`

**Issue:** `toggleIn` is declared inside the component body, allocating a new closure on every render. It closes over nothing — pure function. Hoisting it to module scope (or importing it from a utility) avoids the re-allocation and makes it unit-testable without rendering the whole form. Not a performance problem at this scale; just a minor code-quality nit.

**Fix:** Move to `src/lib/array-utils.ts` or declare at the bottom of the file as a non-exported module-level function.

---

_Reviewed: 2026-04-18T16:30:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
