# Phase 219: ACCOUNTEMAIL - Pattern Map

**Mapped:** 2026-11-19
**Files analyzed:** 13 (4 new, 9 modified; plus the census pins listed in RESEARCH, which are edits driven by failing tests and need no analog)
**Analogs found:** 12 / 13 (1 partial: the AFTER UPDATE trigger on `auth.users` has no in-repo twin)

All analog paths below were checked as git-tracked (`git ls-files`) or are tracked source read in this worktree; none is a gitignored mirror.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/auth/AccountEmailSection.tsx` (new) | component (client form) | request-response | `src/components/auth/ForgotPasswordForm.tsx` + `src/components/auth/DeleteAccountButton.tsx` | exact (form logic from the first, markup/state machine from the second) |
| `src/components/auth/AccountEmailSection.test.tsx` (new) | test | request-response | `src/components/auth/ForgotPasswordForm.test.tsx` | exact |
| `src/components/auth/ProfileTabs.tsx` (modify) | component | request-response | itself (`account` TabsContent, lines 178-182) | exact |
| `src/components/auth/ProfileTabs.test.tsx` (modify) | test | request-response | itself (mocks at lines 31-51) | exact |
| `src/app/(dashboard)/profile/page.tsx` (modify) | server component | request-response | itself (`getUser()` already at lines 19-24) | exact |
| `src/app/auth/callback/route.test.ts` (modify) | test | request-response | itself (cases at lines 89-96, 134-143) | exact |
| `supabase/migrations/<ts>_sync_profile_email_from_auth.sql` (new) | migration (trigger fn + trigger + column REVOKE) | event-driven | `supabase/migrations/20261117120000_mt5_server_clock_readings.sql` (style) + `20260520222848_lock_profile_role_at_signup.sql` (definer fn on auth.users path) + `20260405061912_rls_policies.sql:81-83` (only auth.users trigger) | role-match (no AFTER UPDATE twin) |
| `supabase/migrations/down/<ts>-rollback.sql` (new) | migration (rollback) | event-driven | `supabase/migrations/down/20261117120000-rollback.sql` | exact (shape only) |
| `supabase/tests/test_profiles_email_sync.sql` (new) | test (SQL gate, annotated) | event-driven | `supabase/tests/test_profiles_privileged_columns_locked.sql` (setup list, auth.users seeding, role switching) + `supabase/tests/test_mt5_server_clock_readings.sql` (arm/annotation/catalogue idiom) | exact |
| `scripts/mutation-floors.mjs`, `src/__tests__/mutation-annotation-parser.test.ts`, `mutation-runner-floors.test.ts`, `gate-family-meta.test.ts`, `lint-sql-gates.test.ts` (modify) | config / census pins | n/a | commit `357232aff` (Phase 155.1 plan 05) per RESEARCH | exact precedent (run the tests, they name the number) |
| `scripts/baseline-content-drift-check.mjs`, `scripts/dump-sql-functions.ts`, `supabase/schema/functions/<fn>.sql` (modify/generate) | config / generated | batch | same precedent commit | exact precedent |
| `CHANGELOG.md`, `VERSION`, `package.json` (modify) | config | n/a | CLAUDE.md CHANGELOG discipline | n/a |

## Pattern Assignments

### `src/components/auth/AccountEmailSection.tsx` (client component, request-response)

**Analog A (logic):** `src/components/auth/ForgotPasswordForm.tsx`
**Analog B (markup and state machine):** `src/components/auth/DeleteAccountButton.tsx`

**Imports and client-creation pattern** (ForgotPasswordForm.tsx lines 1-6, 27-41). Note `createClient()` is called INSIDE the submit handler, never at render. This is load-bearing: `ProfileTabs.test.tsx`'s mock of `@/lib/supabase/client` (line 49-51) has no `auth`, so a render-time `createClient().auth` would break those tests.
```typescript
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    ...
  }
```
For this phase the call becomes `supabase.auth.updateUser({ email: next.trim() }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/profile?tab=account")}` })`. Unlike ForgotPasswordForm, do NOT swallow `error` (UI-SPEC: show `error.message`, fallback `Could not send the confirmation link. Please try again.` when empty/whitespace). Add `useRouter` from `next/navigation` and call `router.refresh()` after success (UI-SPEC Interaction contract).

**Form field pattern** (ForgotPasswordForm.tsx lines 55-70):
```tsx
<form onSubmit={handleSubmit} className="space-y-4">
  <Input
    label="Email"
    type="email"
    name="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    placeholder="you@example.com"
    required
    autoComplete="email"
  />
  <Button type="submit" disabled={loading} className="w-full">
    {loading ? "Sending reset link..." : "Send reset link"}
  </Button>
</form>
```
Adapt per UI-SPEC: `label="New email"`, `space-y-3` (not `space-y-4`), no `w-full`, busy text `Sending link...`, and `disabled` on the input and both buttons while submitting.

**Section markup, heading, helper, secondary-button row, error line** (DeleteAccountButton.tsx lines 47-70, 81-104). UI-SPEC says mirror this class for class:
```tsx
<div className="space-y-3">
  <div>
    <h3 className="text-sm font-semibold text-text-primary">Delete my account</h3>
    <p className="mt-1 text-xs text-text-secondary">...</p>
  </div>
  {state === "idle" && (<Button variant="danger" onClick={() => setState("confirming")}>...</Button>)}
  ...
  {error && (<p className="mt-2 text-xs text-negative" role="alert">{error}</p>)}
  <div className="mt-3 flex items-center gap-2">
    <Button variant="danger" onClick={submit} disabled={state === "submitting"}>...</Button>
    <Button variant="secondary" onClick={() => { setState("idle"); setError(null); }} disabled={state === "submitting"}>Cancel</Button>
  </div>
</div>
```
New markup uses `<section aria-labelledby="account-email-heading" className="space-y-3">`, an `h3` with `id`, and the error line `className="text-xs text-negative"` (UI-SPEC drops `mt-2`).

**State enum pattern** (DeleteAccountButton.tsx lines 13-14): `useState<"idle" | "confirming" | "submitting" | "sent">("idle")` plus separate `error` state. Map to UI-SPEC states `idle | editing | submitting | error | pending`; `error` is a separate string state (input keeps its value), `no-email` is derived from `email === null`.

**Pending panel classes** (DeleteAccountButton.tsx lines 38-45, copy exactly):
```tsx
<div className="rounded-md border border-border bg-page px-4 py-3 text-sm text-text-secondary">
```
Add `role="status"` (ForgotPasswordForm.tsx line 46 shows the role placement). The "Use a different email" ghost button sits OUTSIDE the live region (UI-SPEC).

**Error handling for a thrown call** (DeleteAccountButton.tsx lines 19-35): `try { ... } catch { setError("Network error. Please try again."); ... }`. Apply: wrap `updateUser` in try/catch; the destructured `{ error }` branch handles Supabase errors, the catch handles throws.

**Validation:** same-as-current guard is client-side only: compare `next.trim().toLowerCase()` with `email?.toLowerCase()`, show `That is already your sign-in email.`, make NO `updateUser` call. Otherwise native `type="email"` + `required`.

**Props:** `{ email: string | null; pendingEmail: string | null }`. Add `data-testid="account-email"` on the value line (UI-SPEC markup contract).

---

### `src/components/auth/AccountEmailSection.test.tsx` (test, request-response)

**Analog:** `src/components/auth/ForgotPasswordForm.test.tsx`

**Mock + hoisted spy pattern** (lines 12-22):
```typescript
const resetPasswordForEmailMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: resetPasswordForEmailMock,
    },
  }),
}));

import { ForgotPasswordForm } from "./ForgotPasswordForm";
```
Swap `resetPasswordForEmail` for `updateUser`; add `vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))` with a hoisted `refresh` spy (ProfileTabs.test.tsx lines 34-44 show the stable `vi.hoisted` spy idiom). Beware: ForgotPasswordForm.test declares a bare `vi.fn()` outside `vi.hoisted`; that works there because the factory closes over it lazily, but a `useRouter` factory returning a fresh `vi.fn()` per call is unassertable, so hoist it.

**Interaction pattern** (lines 29-40):
```typescript
resetPasswordForEmailMock.mockResolvedValueOnce({ data: {}, error: null });
const { container, getByText } = render(<ForgotPasswordForm />);
const email = container.querySelector('input[name="email"]') as HTMLInputElement;
fireEvent.change(email, { target: { value: "user@example.test" } });
fireEvent.click(getByText("Send reset link"));

await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalledOnce());
const [calledEmail, opts] = resetPasswordForEmailMock.mock.calls[0];
expect(opts.redirectTo).toMatch(/\/auth\/callback\?next=\/reset-password$/);
```
Assert exact args: `({ email: "x" }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/profile?tab=account")}` })`. Error path: `mockResolvedValueOnce({ data: null, error: { message: "...", name: "AuthApiError", status: 422 } })` (shape from lines 59-62), then assert the message appears in a `role="alert"` and the input value is kept. Per RESEARCH use `@quantalyze.test` / `@example.test` addresses only (public repo).

Case list is in RESEARCH "UI half" (render, null email, same-as-current no-call, args, success pending + `router.refresh`, Supabase error, empty-message fallback, thrown error, `pendingEmail` on first render, Keep/Use-different focus return).

---

### `src/components/auth/ProfileTabs.tsx` (modify)

**Analog:** itself. Current account panel (lines 178-182):
```tsx
<TabsContent value="account">
  <div className="max-w-xl">
    <DeleteAccountButton />
  </div>
</TabsContent>
```
Target per UI-SPEC: `max-w-xl space-y-8`, `<AccountEmailSection email={accountEmail} pendingEmail={pendingEmail} />` first, then `<div className="border-t border-border pt-8"><DeleteAccountButton /></div>`.

**Props pattern** (lines 50-62): optional-with-default props so existing renders keep compiling:
```tsx
interface Props {
  profile: Profile;
  initialPreferences?: AllocatorOwnPreferences | null;
  isAllocator?: boolean;
  exchanges?: ExchangesTabContentProps | null;
}
export function ProfileTabs({ profile, initialPreferences = null, isAllocator = false, exchanges = null }: Props) {
```
Add `accountEmail?: string | null` and `pendingEmail?: string | null`, both defaulting to `null`. Add the import beside `import { DeleteAccountButton } from "./DeleteAccountButton";` (line 8). Do not touch `ALL_TABS`/`parseTabParam`: `account` is already a valid, non-allocator-only key.

### `src/components/auth/ProfileTabs.test.tsx` (modify)

**Analog:** itself. The existing `next/navigation` mock (lines 36-44) returns `useRouter: () => ({ replace, push, refresh })`, so the new section's `useRouter().refresh` is already satisfied. The `@/lib/supabase/client` mock (lines 49-51) has NO `auth`, which is fine only because the section calls `createClient()` at submit. New cases follow the `searchParamsState.tab = "..."` + `render(<ProfileTabs ... />)` idiom (lines 101-113, 281-290): set `searchParamsState.tab = "account"`, render with `accountEmail`/`pendingEmail`, assert `data-testid="account-email"` text, pending panel, and that the email section precedes the "Request account deletion" button in DOM order. Use `PROFILE_FIXTURE` (line 67), whose `email` field is deliberately different from `accountEmail` to prove D-02 (display never reads `profile.email`).

### `src/app/(dashboard)/profile/page.tsx` (modify)

**Analog:** itself. `user` is already in scope (lines 19-24):
```tsx
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) redirect("/login");
```
Pass at the `<ProfileTabs>` call (lines 116-121): `accountEmail={user.email ?? null}` and `pendingEmail={user.new_email ?? null}`. `User.new_email?: string` verified on auth-js 2.118.0. Do NOT use `profile.email` (line 33-37 reads it via the admin client; leave that read untouched). No new Next API; page stays `force-dynamic`.

### `src/app/auth/callback/route.test.ts` (modify)

**Analog:** itself. Helper and mock (lines 37-40, 22-35):
```typescript
async function callGet(url: string) {
  const { GET } = await import("./route");
  return GET(new NextRequest(url, { method: "GET" }));
}
```
Existing `next` assertion shape (lines 89-96):
```typescript
const res = await callGet("http://localhost:3000/auth/callback?code=pkce-abc&next=/dashboard");
const loc = new URL(res.headers.get("location")!);
expect(loc.pathname).toBe("/dashboard");
```
New cases (D-04 pin): `?code=pkce-abc&next=%2Fprofile%3Ftab%3Daccount` and `?token_hash=h&type=email_change&next=%2Fprofile%3Ftab%3Daccount`; assert `loc.pathname === "/profile"` AND `loc.searchParams.get("tab") === "account"` (or `res.headers.get("location") === "http://localhost:3000/profile?tab=account"`), plus `authState.verifyCalls` equals `[{ type: "email_change", token_hash: "h" }]` for the OTP branch. `route.ts` itself needs no change: `safeNextPath` (route.ts lines 59-75) accepts a decoded `/profile?tab=account` (single `/`, char[1] is a letter) and `new URL(safeNext, req.url)` keeps the query (lines 91 and 105). Do not edit the route (RESEARCH Pitfall 2: no speculative fix of the double-confirm first-click landing).

---

### `supabase/migrations/<20261119HHMMSS>_sync_profile_email_from_auth.sql` (migration, event-driven)

**Analog (style, hardening, verify block):** `supabase/migrations/20261117120000_mt5_server_clock_readings.sql`
**Analog (definer function with pinned search_path on the auth.users path):** `supabase/migrations/20260520222848_lock_profile_role_at_signup.sql` (`handle_new_user`, last line `$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;`)
**Analog (the only existing `auth.users` trigger, for DDL shape):** `supabase/migrations/20260405061912_rls_policies.sql:81-83`
**Timestamp:** must sort after `20261117120000` (latest in this checkout); re-pick at ship time after fetching main (RESEARCH A5).

**Transaction style** (mt5 migration lines 84-96): NO `BEGIN`/`COMMIT`; open with the lock timeout.
```sql
SET LOCAL lock_timeout = '3s';
```

**Trigger function and hardening pattern** (mt5 lines 231-263), adapted: this function MUST be `SECURITY DEFINER` (D-06) with `SET search_path = public, pg_catalog` (handle_new_user's pin; the mt5 trigger is INVOKER with `public, pg_temp`, do not copy that part). Schema-qualify `public.profiles`.
```sql
CREATE FUNCTION public.enforce_mt5_server_clock_readings_write_once()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  ...
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_mt5_server_clock_readings_write_once() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER mt5_server_clock_readings_write_once
  BEFORE UPDATE OR DELETE ON public.mt5_server_clock_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_mt5_server_clock_readings_write_once();
```
Use `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS ... ON auth.users;` before `CREATE TRIGGER ... AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.<fn>();` (idempotent re-run, RESEARCH Pitfall 6). The body (RESEARCH Pattern 1): ONE guard only, no `WHEN` clause on the trigger.
```sql
IF current_setting('quantalyze.sanitize_in_progress', true) = 'on' THEN RETURN NEW; END IF;
IF NEW.email IS DISTINCT FROM OLD.email THEN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
END IF;
RETURN NEW;
```
The `, true` missing-ok idiom matches `baseline.sql:4798`; `sanitize_user` sets the GUC transaction-local at `20260827130000_sanitize_user_revoke_strategy_shares.sql:192` (`PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true);`) and then runs `UPDATE auth.users SET email = NULL ...` at line 360, which is exactly the update the guard must skip.

**EXECUTE-revoke caveat (RESEARCH A1, planner decides):** the mt5 precedent revokes EXECUTE from anon/authenticated on a trigger function. Whether revoking is safe for a SECURITY DEFINER function fired by GoTrue's role is [ASSUMED] (EXECUTE is checked at CREATE TRIGGER). The pg-lane gate runs as superuser and cannot prove it, so either (a) omit the EXECUTE revoke like `handle_new_user` does (zero-risk), or (b) keep it and require the gate to pass on the local-stack lane in CI. Record the choice in the plan.

**Column REVOKE (D-07):** `REVOKE UPDATE (email) ON public.profiles FROM authenticated;` effective because the current grant is column-level (`20260529150000_lock_profile_privileged_columns.sql:73,77-79` re-granted `UPDATE ( id, display_name, company, description, email, telegram, ...`). The executor re-runs the writer-proof greps from RESEARCH and pastes output into the SUMMARY/REVIEW before keeping this statement.

**Self-verify block** (mt5 lines 265-294): catalogue-only `DO $verify$`, reads `pg_proc`/`pg_trigger`/`has_column_privilege`, NEVER `public.profiles` rows (`scripts/lint-migration-data-dependence.mjs` refuses a data-reading DO guard, no opt-out; shared TEST is data-empty).
```sql
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'mt5_server_clock_readings_write_once'
                    AND tgrelid = 'public.mt5_server_clock_readings'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 20261117120000 failed: trigger ... is missing on ...';
  END IF;
  RAISE NOTICE 'Migration 20261117120000: ... exist.';
END
$verify$;
```
Keep the verify block shallow (existence only) on purpose: the mt5 header (lines 265-271) explains a verify that asserts the mutated line would abort the apply of a mutated copy and stop the gate's twin from going RED on behaviour. So do NOT assert the REVOKE or the function body here. Optional `PERFORM public._assert_no_public_execute('public.<fn>()')` (defined `20260515205431_sec_def_public_execute_guard.sql:70`; stubbed in `scripts/pg-lane/fixtures/01-fixture-core.sql:62-75`) only if choice (b) above is taken.

**Header comment convention:** state in the header that `handle_new_user` (latest `20260520222848`) and `sanitize_user` (latest `20260827130000`) are cited and NOT replaced (re-base duty met vacuously, as mt5 lines 88-90 do), name the rollback file, and note the migration applies to PROD automatically after apply-test (D-10).

### `supabase/migrations/down/<ts>-rollback.sql` (rollback, event-driven)

**Analog:** `supabase/migrations/down/20261117120000-rollback.sql`. Copy: the long header (single-transaction psql invocation, the CLAUDE.md marker query FIRST, ledger-row note), `SET LOCAL lock_timeout = '3s';`, a catalogue-only `DO $precondition$` that refuses when the migration is absent, the change, and a catalogue-only `DO $verify$`. Change body here: `DROP TRIGGER IF EXISTS ... ON auth.users;`, `DROP FUNCTION IF EXISTS public.<fn>();`, `GRANT UPDATE (email) ON public.profiles TO authenticated;` (restores the pre-migration grant). No data is dropped, so no keep-data renames are needed.

---

### `supabase/tests/test_profiles_email_sync.sql` (SQL gate, event-driven)

**Analog 1 (setup, seeding, role switching):** `supabase/tests/test_profiles_privileged_columns_locked.sql`
**Analog 2 (arm layout, annotation idiom, catalogue arms, sentinel):** `supabase/tests/test_mt5_server_clock_readings.sql`

**RED-UNDER-SETUP** (privileged-columns test line 63). Mirror it and append the new migration LAST. The list is load-bearing: `20260405061912` is the only thing enabling RLS and creating `on_auth_user_created`, and `20260529150000` is what creates the column-level grant the REVOKE arm needs to withdraw (without it the revoke arm is vacuous):
```sql
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/28-fixture-profiles-privileged-columns.sql","supabase/migrations/20260405061912_rls_policies.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","supabase/migrations/20260512182319_profiles_rls_hardening.sql","supabase/migrations/20260529150000_lock_profile_privileged_columns.sql","supabase/migrations/<new>.sql"]}
```
Stub facts verified: the pg-lane `auth.users` stub (`01-fixture-core.sql:8-14`) has `id, instance_id, email, created_at, updated_at` and fixture `02` adds `raw_user_meta_data` (line 16); the stub `profiles` has `email TEXT` with no unique constraint. RESEARCH Open Question 2 (does `UPDATE auth.users SET email` fire the new trigger on the stub) is answered at authoring by running the gate; the stub is a plain table so a normal trigger attaches.

**Seeding + impersonation pattern** (privileged-columns lines 76-85, 101-103):
```sql
INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
VALUES (v_uid, '00000000-0000-0000-0000-000000000000',
        'clsec-' || v_uid::text || '@quantalyze.test', now(), now(),
        '{"role":"manager"}'::jsonb);

PERFORM set_config('request.jwt.claims',
                   json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                   true);
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET display_name = 'clsec-edit', company = 'acme' WHERE id = v_uid;
RESET ROLE;
```
The `on_auth_user_created` trigger creates the profile row, so no separate profile insert. Use `@quantalyze.test` addresses.

**Refusal capture pattern** (privileged-columns lines 131-134):
```sql
v_raised := false;
BEGIN UPDATE public.profiles SET is_admin = true WHERE id = v_uid;
EXCEPTION WHEN OTHERS THEN v_raised := true; END;
IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): ...'; END IF;
```
For this gate, use `TEST FAILED (<arm>): ...` raises instead of `PRIVESC (2)`, and keep the raise on a SIMPLE head (not `IF NOT v_raised THEN RESET ROLE; RAISE ...`): the privileged-columns header (lines 46-52) records that the runner's neuter tokenizer refuses compound heads (R4-C01) and that `PRIVESC (2)` raises are not identities. RESEARCH Pitfall 3/4: raises not carrying `TEST FAILED (` make the file `unreachable` (unfalsifiable); an annotation-less file with them is `pending` and reds `sql-mutation`. Do `RESET ROLE` BEFORE the check, then raise on a plain `IF`.

**Annotation grammar** (mt5 lines 254-258, 840-849): a prose `-- RED-UNDER:` line immediately followed by a column-0 `-- RED-UNDER-M: {...}` twin, one per arm, placed right above the arm's statements; every twin edits the migration that DEFINES what it mutates (here the new migration):
```sql
  -- RED-UNDER: make the trigger function SECURITY DEFINER in 20261117120000. ...
-- RED-UNDER-M: {"arm":"9c","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"LANGUAGE plpgsql\n  SECURITY INVOKER","replace":"LANGUAGE plpgsql\n  SECURITY DEFINER","occurrences":1}]}
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = 'public.enforce_mt5_server_clock_readings_write_once()'::regprocedure
                    AND NOT p.prosecdef) THEN
    RAISE EXCEPTION 'TEST FAILED (9c): the write-once trigger function is SECURITY DEFINER, expected SECURITY INVOKER';
  END IF;
```
Arms to author (from RESEARCH, D-08): (1) change syncs, twin deletes the `UPDATE public.profiles SET email` line; (2) unchanged email does not write, twin makes the `IS DISTINCT FROM` always true; (3) GUC on suppresses, twin removes the GUC early return, plus a GUC-absent positive control; (4) revoke bites (`has_column_privilege('authenticated','public.profiles','email','UPDATE')` false AND an authenticated `UPDATE ... SET email` raises), twin deletes the REVOKE line; (5) `authenticated` can still edit `display_name` (revoke is narrow); (6) catalogue arms for hardening: `prosecdef`, `proconfig` carries the pinned `search_path`, trigger `tgtype` (AFTER UPDATE OF email, FOR EACH ROW) and anon/authenticated EXECUTE per the A1 decision. Each arm is its own `TEST FAILED (<id>)` with its own twin; the runner requires the FIRST failure under a mutation to name that arm, so order arms so none depends on a later one.

**Catalogue arm idiom** (mt5 lines 810-838, 857-861): equality on `tgtype` (not a bitmask), `tgenabled = 'O'`, `has_function_privilege(role, 'public.<fn>()', 'EXECUTE')` loop.
```sql
  IF v_trg.tgtype IS DISTINCT FROM 27 THEN
    RAISE EXCEPTION 'TEST FAILED (9b): the write-once trigger has tgtype %, expected 27 ...', v_trg.tgtype;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.enforce_mt5_server_clock_readings_write_once()', 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST FAILED (9d): % may EXECUTE ...', v_role;
    END IF;
  END LOOP;
```
For an `AFTER UPDATE OF email` row trigger compute the expected `tgtype` yourself (ROW 1 + UPDATE 16 = 17; AFTER sets neither BEFORE bit 2 nor INSTEAD bit 64) and assert `tgattr`/`pg_get_triggerdef` contains `UPDATE OF email`; verify the number by running the gate rather than trusting this line.

**ANTI-GREEN-SKIP:** copy the mt5 arm-1 stance (line 244-246): absence of the function or trigger is an EXCEPTION, never a skip. This differs from the privileged-columns test, which emits `SKIP (2)` when its migration is not applied (lines 118-127); do NOT copy that skip. Merging `supabase/migrations/**` auto-applies to PROD, so a presence skip would hide a missing object.

**Structure:** whole file inside `BEGIN; ... ROLLBACK;`, one `DO $$` body, `pg_temp.*` helper functions for seeding (mt5 lines 116-142 pattern: `CREATE FUNCTION pg_temp.sc_user() ...`), every identity `TEST FAILED (...)` raise sitting DIRECTLY in the DO body (helpers return values, never raise identities; mt5 lines 89-91). Sentinel `ALL N ARMS EXECUTED (...)` is OPTIONAL (RESEARCH Open Question 1): declaring it moves `ci.yml` SENTINEL_FLOOR/ARMS_FLOOR and three pins; recommend it only if an arm can return early.

---

### Census pins (config, batch)

**Analog:** commit `357232aff` (Phase 155.1 plan 05). Do not hand-derive: add the gate, then run
```bash
npx vitest run src/__tests__/mutation-annotation-parser.test.ts src/__tests__/mutation-runner-floors.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts
node scripts/mutation-runner/run.mjs --parse-only
```
Each failure names the number. Read floors by symbol (`grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)' scripts/mutation-floors.mjs`), never from prose; RESEARCH snapshot was FILES_FLOOR 83, ARMS_FLOOR 891, corpus 110 files, valid only to 2026-11-26. `scripts/lint-app-guc.mjs` needs NO edit (its `DETECT_RE` matches `current_setting('app.`, not `quantalyze.`). `baseline-carried-migrations.txt` needs NO edit (the local-stack lane REPLAYS a migration newer than the dump; confirm with `node scripts/check-baseline-currency.mjs --replay-set`). `vac08-ledger-baseline.txt` stays empty.

## Shared Patterns

### No direct write to `auth.users`; no `profile.email` for display
**Source:** `src/app/(dashboard)/profile/page.tsx` lines 19-24 (server `getUser()`), CONTEXT D-02/D-11.
**Apply to:** `AccountEmailSection.tsx`, `profile/page.tsx`, `ProfileTabs.tsx`. The email shown and the pending address come from the server-side `getUser()` result as props; the browser only calls `supabase.auth.updateUser`.

### Browser Supabase client created at call time
**Source:** `src/components/auth/ForgotPasswordForm.tsx` lines 31-37.
**Apply to:** `AccountEmailSection.tsx` only. `createClient()` inside the handler, so `ProfileTabs.test.tsx`'s `auth`-less mock keeps working.

### Inline error line, not the error envelope
**Source:** `src/components/auth/DeleteAccountButton.tsx` lines 81-85 and UI-SPEC "Error pattern".
```tsx
{error && (<p className="mt-2 text-xs text-negative" role="alert">{error}</p>)}
```
**Apply to:** `AccountEmailSection.tsx` (use `text-xs text-negative`, no `mt-2`; UI-SPEC records this as a deliberate reading of DESIGN.md).

### Open-redirect guard on `next`
**Source:** `src/app/auth/callback/route.ts` `safeNextPath` lines 59-75.
**Apply to:** `route.test.ts` additions only. Test it, do not copy or reimplement it.

### Migration conventions
**Source:** `supabase/migrations/20261117120000_mt5_server_clock_readings.sql` lines 84-96 (no explicit transaction, `SET LOCAL lock_timeout`), 255 (function EXECUTE hardening), 265-294 (catalogue-only verify).
**Apply to:** the new migration and its rollback. Never `BEGIN`/`COMMIT` (note `20260827130000` uses them; the newer file is the convention). No data-reading `DO` guard (`scripts/lint-migration-data-dependence.mjs`, no opt-out). Never apply to TEST or PROD by hand (D-10); the CLI here is linked to PROD.

### SQL gate integrity
**Source:** `supabase/tests/test_mt5_server_clock_readings.sql` (annotation grammar, one identity per arm) and `scripts/mutation-runner/GRAMMAR.md`.
**Apply to:** `test_profiles_email_sync.sql`. Prove it can fail: run `node scripts/mutation-runner/run.mjs --file supabase/tests/test_profiles_email_sync.sql` (mutates copies, repo file stays pristine), and for the by-hand neuter use `cp -p` to the scratchpad, mutate, see RED, restore from the byte backup, `cmp`. Never `git checkout/restore/stash` on uncommitted work.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| the `AFTER UPDATE OF email ON auth.users` trigger itself (inside the new migration) | trigger | event-driven | `auth.users` carries exactly one trigger today (`on_auth_user_created AFTER INSERT`, `20260405061912_rls_policies.sql:81-83`). Take the DDL shape from it, the function hardening from the mt5 migration, and the body from RESEARCH Pattern 1; there is no AFTER UPDATE twin. The pg-lane gate cannot prove behaviour under GoTrue's real role (RESEARCH A1, A4), so a post-merge UAT on TEST (change an email, read `profiles.email` count-only) is the only proof the trigger fires on a real confirmation. |

## Metadata

**Analog search scope:** `src/components/auth/`, `src/app/auth/callback/`, `src/app/(dashboard)/profile/`, `supabase/migrations/` (latest `handle_new_user`, `sanitize_user`, mt5 clock migration and its `down/`), `supabase/tests/`, `scripts/pg-lane/fixtures/`.
**Files read:** 17 (plus RESEARCH/CONTEXT/UI-SPEC, which already carried the grep evidence for D-07 and the census list).
**Hook note:** the Read tool printed LOW "injection scan" warnings for `route.ts`, `route.test.ts` and `test_profiles_privileged_columns_locked.sql`; the matches are an `?code=` URL in documentation and the word "phase", i.e. false positives. Nothing in those files issued instructions.
**Pattern extraction date:** 2026-11-19
