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

---

## DEF-153.1-06-A — FIVE `finalize-wizard` rejections still answer with NO code

**Found during:** 153.1-06, by the new source-derived rejection sweep — the
first scan in this sub-phase whose population includes arms that emit nothing.

**Measured** (comment-stripped source, `9705838f`): **30** 4xx/5xx
`NextResponse.json(` sites, **25** coded, **5** code-less:

| Status | Body | Note |
|---|---|---|
| 429 | `{ error: "Too many requests" }` | `KEY_RATE_LIMIT` is what the key routes answer |
| 503 | `{ error: "Rate limiter unavailable" }` | `SEAM_MISCONFIGURED`; 140.4-15 fixed this exact arm on `composite/add-key` |
| 500 | `{ error: "Could not load draft" }` | the strategy lookup's failure |
| 500 | `{ error: "Could not finalize wizard draft" }` | the RPC's generic failure |
| 502 | `{ error: "Upstream service returned unexpected response" }` | |

Each renders the UNKNOWN card — *"We could not classify this failure"* — for a
failure the route classified well enough to pick a status and write a sentence
about. **This is WIZFORM-02's own criterion, still open**, which is why the
requirement was NOT ticked (see the SUMMARY's Requirements section).

⚠️ **A raw-source scan with a fixed look-ahead window reports FOUR of the five**
— it loses the `:869` arm behind the `console.error` block above it. The count
must be taken from stripped source. Same class as the 14-vs-12 lesson.

**Why NOT fixed here.** 153.1-06 is a TEST-ONLY plan (`⛔ No production source
is touched by this plan`), and all five sit outside both populations 153.1-05
worked on — it coded the eleven `validatePayload` arms and reordered the
fourteen coded emitters, and none of these five is either. The 503/429 pair are
limiter arms; the 502 is the upstream-shape arm.

**They are now FENCED, not merely noted.** `KNOWN_CODELESS_FINALIZE_REJECTIONS
= 5` in `wizardErrors.invariant.test.ts` pins the number, and a SIXTH reds by
name. The failure message forbids the bump: *"IF THIS NUMBER WENT UP, THE
REMEDY IS A CODE ON THE NEW ARM ... never a bump of this literal."*

**Owner: Phase 153.2**, which already owns this route's error surface. Each arm
fixed lowers the literal by one; at zero the constant and its assertion collapse
into "every rejection carries a code", which is where WIZFORM-02 lands.

---

## DEF-153.1-06-B — `seam-citations.invariant.test.ts` RED: bare `file:line` citations in `wizardErrors.ts`

**Found during:** 153.1-06's full-suite run. **PRE-EXISTING at `aff52516`** —
`git diff aff52516..HEAD` for this plan is a single test file, and this guard
does not read it.

```
src/lib/wizardErrors.ts:42   cites MetadataStep.tsx:19
src/lib/wizardErrors.ts:217  cites finalize-wizard/route.ts:1319
src/lib/wizardErrors.ts:292  cites finalize-wizard/route.ts:1782
src/lib/wizardErrors.ts:618  cites envelope.ts:86
src/lib/wizardErrors.ts:619  cites WizardErrorEnvelope.test.tsx:44
src/lib/wizardErrors.ts:1838 cites finalize-wizard/route.ts:1763-1777
src/lib/wizardErrors.ts:2252 cites envelope.ts:86
```

Introduced by **153.1-04**, whose copy entries cite route coordinates. ⚠️ Three
of them are ALREADY STALE — 153.1-05 moved `:1319 → :1448` and `:1782 → :1911`
— which is precisely the drift the guard exists to name.

**Not fixed:** comment prose only, no user-facing or data-integrity effect. The
founder's stopping rule puts citations explicitly in the log-never-block class.
Remedy is mechanical: convert each to a SYMBOL anchor.
**Owner: Phase 153.2** (it owns `wizardErrors.ts` copy and re-derives these
anchors anyway).

---

## DEF-153.1-06-C — `seam-venue-vocabulary.invariant.test.ts` RED: `mt5.py` line drift

**Found during:** 153.1-06's full-suite run. **PRE-EXISTING and NOT 153.1's.**

The declared-blind-spot ledger pins dynamic `error_code` emitters by
`file:line`; `analytics-service/services/ingestion/mt5.py:242` has moved.

**Not fixed — explicitly out of bounds:** `analytics-service/` belongs to
**Phase 153.3**, which is complete and under code review. Touching it during
153.1's closing plan would collide with that review.
**Owner: Phase 153.3.**
