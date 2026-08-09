# Phase 153.1 — deferred items

Out-of-scope discoveries, logged not fixed. Each names an owner.

---

## DEF-153.1-05-A — `METADATA_DESCRIPTION_REQUIRED` derives `recoverable: true`

**Found during:** 153.1-05 Task 3, while checking the eleven admitted codes'
actions through `buildEnvelope` (the TRAP-4 check the SubmitStep suite
demanded).

**Measured, not assumed:**

```
VALIDATION_FAILED                    actions=["request_call"]                  recoverable=false
METADATA_NAME_INVALID                actions=["expand_log"]                    recoverable=false
METADATA_DESCRIPTION_REQUIRED        actions=["clear_and_retry"]               recoverable=true   <-- 
METADATA_DESCRIPTION_TOO_SHORT       actions=["expand_log"]                    recoverable=false
METADATA_DESCRIPTION_TOO_LONG        actions=["expand_log"]                    recoverable=false
METADATA_CATEGORY_REQUIRED           actions=["expand_log"]                    recoverable=false
METADATA_AUM_INVALID                 actions=["expand_log"]                    recoverable=false
METADATA_CAPACITY_INVALID            actions=["expand_log"]                    recoverable=false
METADATA_CAPITAL_OWNERSHIP_INVALID   actions=["expand_log"]                    recoverable=false
DRAFT_STATE_INVALID                  actions=["leave_and_return","expand_log"] recoverable=false
COMPOSITE_UNSUPPORTED_UNIFIED        actions=["request_call","expand_log"]     recoverable=false
```

**The issue.** `METADATA_DESCRIPTION_REQUIRED` is the ONE admitted code whose
copy carries a member of `RECOVERABLE_ACTIONS`, so it renders a Retry control.
Resubmitting an identical payload with a missing description is refused
identically — the false-affordance class this phase exists to close.

**Why it was NOT fixed here.**

1. **It is pre-existing, and this plan did not change recoverability at that
   arm.** Before 153.1-05 the arm answered code-less and fell to `UNKNOWN`,
   whose copy is ALSO recoverable. The rendered affordance is `true -> true`:
   no regression was introduced, and no regression is being hidden.
2. **The entry lives in `src/lib/wizardErrors.ts`**, which is 153.1-04's file
   and outside this plan's `files_modified`. 153.1-04 deliberately authored the
   seven NEW metadata codes without `clear_and_retry` ("it wipes the user's
   typing") and left this pre-existing member untouched.
3. It is arguably defensible as written: for a MISSING description there is
   nothing typed to wipe.

**Owner: Phase 153.2**, which owns field-level routing for exactly these codes
and is the phase that decides what each metadata refusal does on the form. If
153.2 routes `METADATA_DESCRIPTION_REQUIRED` to the description field, the
Retry becomes redundant with the field-level remedy and should go.

---

## DEF-153.1-05-B — the stale `DESTRUCTIVE_CONTROL_IS_WRONG_FOR` reference

**Found during:** 153.1-05 Task 3.

`SubmitStep.test.tsx`'s TRAP-4 failure message instructed whoever admitted a
code to "widen `DESTRUCTIVE_CONTROL_IS_WRONG_FOR` (`SyncPreviewStep.tsx`) IN
THE SAME COMMIT". **That identifier does not exist anywhere in `src/`** —
verified by `grep -rn "DESTRUCTIVE_CONTROL_IS_WRONG_FOR" src/`, whose only hit
is the message's own prose.

The underlying coupling is real (a non-recoverable code renders no Retry, which
can leave a destructive control as the sole affordance) but it did NOT bind for
153.1-05: not one of the eleven admitted codes carries `try_another_key`, and
`SubmitStep.tsx` has no destructive affordance at all. The check and its result
are now written into the test file so the next reader does not repeat it.

**Not fixed:** finding where that constant went (renamed? deleted? never
landed?) is a `SyncPreviewStep` archaeology task with no user-facing effect
today. **Owner: whichever phase next touches `SyncPreviewStep.tsx`'s error
surface.** Logged so the obligation is not quietly lost — it still binds for a
future plan admitting a `try_another_key`-carrying code.
