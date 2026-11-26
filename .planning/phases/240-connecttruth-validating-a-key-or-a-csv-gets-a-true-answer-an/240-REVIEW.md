---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
reviewed: 2026-11-24T21:20:12Z
depth: standard
round: 3
re_reviewed: 2026-11-24T21:29:47Z
diff_base: b752182dc85ac08825089df31303ccaccb228079
files_reviewed: 44
files_reviewed_list:
  - analytics-service/docs/STATUS_CONTRACT.md
  - analytics-service/routers/exchange.py
  - analytics-service/routers/internal.py
  - analytics-service/routers/process_key.py
  - analytics-service/services/app_error_handlers.py
  - analytics-service/services/csv_validator.py
  - analytics-service/services/error_contract.py
  - analytics-service/services/ingestion/adapter.py
  - analytics-service/services/rate_limit.py
  - analytics-service/tests/fixtures/validate_key_permanent_400_contract.json
  - analytics-service/tests/test_anon_bucket_alert.py
  - analytics-service/tests/test_csv_validator_date_format_2026_05_27.py
  - analytics-service/tests/test_limiter_identity.py
  - analytics-service/tests/test_limiter_route_coverage.py
  - analytics-service/tests/test_mt5_rotate_secret_internal.py
  - analytics-service/tests/test_process_key.py
  - analytics-service/tests/test_process_key_anon_ip_tier.py
  - analytics-service/tests/test_process_key_csv_tier.py
  - analytics-service/tests/test_process_key_permanence_plumbing.py
  - analytics-service/tests/test_raw_5xx_census.py
  - analytics-service/tests/test_tenant_claim_parity.py
  - analytics-service/tests/test_tenant_claim_parsing.py
  - analytics-service/tests/test_validate_key_permanent_400.py
  - analytics-service/tests/test_validate_key_venue_transient.py
  - src/__tests__/csv-finalize-after-failloud.test.ts
  - src/__tests__/csv-finalize-c14-regression.test.ts
  - src/__tests__/csv-finalize-concurrent-never-classified.test.ts
  - src/__tests__/csv-finalize-cross-submission-merge.test.ts
  - src/__tests__/csv-validate-route.test.ts
  - src/app/api/strategies/csv-finalize/route.test.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/verify-strategy/route.test.ts
  - src/app/api/verify-strategy/route.ts
  - src/lib/process-key-client.test.ts
  - src/lib/process-key-client.ts
  - src/lib/ratelimit.ts
  - src/lib/seam-venue-vocabulary.invariant.test.ts
  - src/lib/tenant-claim.test.ts
  - src/lib/tenant-claim.ts
  - src/lib/wizardErrors.ts
  - tests/fixtures/tenant-claim-parity.json
  - tests/integration/process-key-thin-adapters.test.ts
  - tests/lib/csv-limit-agreement.test.ts
  - tests/lib/validate-key-permanent-400-parity.test.ts
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
  necessity: 1
status: clean
---

# Phase 240: Code Review Report

**Reviewed:** 2026-11-24T21:20:12Z
**Depth:** standard (with targeted cross-file tracing on the claim contract and the limiter stack)
**Files Reviewed:** 44 (diff `b752182dc..HEAD`, `.planning/` excluded)
**Status:** clean (round 3; round 1 was issues_found, round 3 recorded one MEDIUM found and fixed in the same round)

## Summary

I reviewed all four phase truths against the locked rulings in `240-CONTEXT.md`. Decisions recorded there are not flagged: the per-IP tier, the 200/hour aggregate, the CSV ceiling exemption, the 60/minute CSV tier, IPv6 hashed as given, and the transient deploy skew.

**Severity mapping.** The caller asked for MEDIUM and above as findings. One MEDIUM finding exists, filed under `## Warnings` as WR-01. LOW and INFO items are under `## Info`. Each is labelled non-actionable, and under the project rule they are recorded here and not booked in `TODOS.md`.

**What I traced and found clean** (each one checked against source or a run, not taken from the SUMMARYs):

- **Limiter evaluation order.** slowapi 0.1.10's `__evaluate_limits` (installed copy, read directly) runs the limits in list order, appends `_dynamic_route_limits` in decorator-application order (bottom first), and `break`s on the first refusal. All three providers are callables, so no static string can jump the queue. The order is identity, then aggregate, then ceiling. A per-identity refusal spends no aggregate or ceiling token.
- **`exempt_when` predicates.** Both `_process_key_not_anonymous` and `_process_key_is_csv_scoped` take exactly one parameter, so slowapi passes them the request (`Limit._exempt_when_takes_request`). Both wrap the classifier in try/except and answer "not exempt" on a fault. `classify_tenant_claim` catches its own errors and answers `unverified`. The key functions keep their never-raise contract.
- **429 bodies.** `rate_limit_exceeded_handler` emits `detail = "Rate limit exceeded: <limit string>"` (for example `30 per 1 hour`). It never includes the key, the IP hash or the bucket name. Header injection is off. The saturation alert now covers the legacy key and `anon-all`, and per-IP keys are excluded, so `_anon_alert_last_at` cannot grow per pseudonym.
- **Claim grammar parity.** The TS side produces `public:` + `createHmac(...).digest("hex").slice(0, 32)` (lowercase), which Python fullmatches with `public:([0-9a-f]{32})` and `re.ASCII`. TS sends `csv:${user.id}` only when `flow_type === "csv"`, and the only such caller is csv-validate, which passes a Supabase lowercase uuid. Python's `_CSV_PAYLOAD_RE` is strict. A malformed `public:` suffix falls to the shared `:anon` bucket, never `:t:`. A malformed `csv:` payload becomes a plain tenant and is not exempt. The committed parity fixture is read by both languages.
- **Raw IP.** `clientIp` is read only by `anonymousClaimPayload`. It does not appear in any header, log line or body. `X-User-Id` stays `args.userId`. Mint guards 1 to 3 are unchanged, and `internalToken` is non-empty before the HMAC runs (the earlier 503 arm).
- **RLIM-02 retry amplification.** `retriesForFlow("csv", …)` returns 0, because `csv` is absent from the retry-safe map (`seam-retry-registry.ts`). One edge admission therefore spends at most one CSV-tier token.
- **Validate-key flat 400s.** Every converted arm keeps its detail constant (`AUTH_FAILED_DETAIL`, `MT5_*_DETAIL`, `SFOX_DISABLED_DETAIL`, `MT5_DISABLED_DETAIL`). Each has `recoverable=False` and the codes the ruling names. No production code branches on `isinstance(..., VenueTransientHTTPException)`, so the 400s cannot be misread as transient. The rotate-secret gate sits after the token, rate-limit, 404 and 422 arms and before `get_kek()`, the decrypt and the probe. The TS rotate-secret route classifies through `classifyKeyValidationError`, which gives UNKNOWN/500, as recorded in `VENUE_WIRE_CODES_WITHOUT_VERDICT`.
- **process-key permanence.** Both arms pass `recoverable=False` only when `val.permanent is True`, and `None` otherwise. The 424 pre-gate is skipped only on a stated True. Today MT5 is the only adapter that states `permanent`.
- **`_maybe_auto_normalize_percent_form`.** It is untouched, and no new rule literal was added (`date_format_normalized` is reused). The new `detected_format: "month_name"` value has no TS or Python consumer.
- **Month-name parser, never-raise.** I fed blanks, `nan`, `31 Feb`, and years `0001`, `1500` and `9999` through `validate_csv`. None raised. Each gave the same error set as its numeric twin, except for the case in WR-01.
- **Test reliability.** The 61-call CSV-tier test and the anonymous-tier tests run in under 0.1 s each, 34 passed in 12 s locally. The fixed window starts at the first hit in `memory://`, so the tests carry no clock-boundary flake.
- **csv-finalize split.** It uses a distinct limiter instance and a distinct identifier. Every test that mocks `@/lib/ratelimit` and reaches the route gained the new export. The remaining "30/hour" in `routers/csv.py` is that route's own live limit, not a stale upstream citation.

**Necessity:** assessed against `necessity-review.md` (read). One Info item (IN-02).

## Warnings

### WR-01: A month-name cell in an ambiguous or out-of-order column is still left unread, and the file is rejected for the wrong reason (MEDIUM, user-facing)

**Status: FIXED in 2a1194ba4.** Both rejecting exits now write the month-first reading back when `month_named.any()`; `test_month_name_cell_on_a_rejecting_exit_gets_its_numeric_twins_errors` pins each exit against its all-numeric twin.

**File:** `analytics-service/services/csv_validator.py`, `_detect_and_normalize_date_column`. The `if mf_ok and df_ok:` ambiguity return is at about line 1067. The final `return None  # neither reading is a clean ascending series` is at about line 1085.

**Issue:** The month-name cells are written back only on the three exits that write a reading: the equal-parse exit, the month-first-only exit and the day-first exit. The other two exits leave `df["date"]` as raw text. pandera then parses that text, infers one numeric format from the first cell, and fails the month-name cell. So the cell CONN-06 says "is parsed" is still not parsed on these two paths, and the user is told a date could not be read.

The file is rejected either way. Only the stated reason is false. Measured through `validate_csv(..., "daily_returns")`, each beside its numeric twin:

| cells | errors with the month-name cell | numeric twin's errors |
|---|---|---|
| `01/03/2024, 02/03/2024, 12 Mar 2024, 03/03/2024, 04/03/2024` (out of order, every day/month ≤ 12) | `coerce_dtype('datetime64[ns]')`, `dtype('datetime64[ns]')` | `monotonic_dates` (with `12/03/2024` or `05/03/2024`) |
| `01/03/2024, 12 Jan 2024, 01/04/2024` | `coerce_dtype`, `dtype` | not applicable (no numeric twin) |
| `01/02/2024, 03/04/2024, 12 Dec 2024` (ambiguous) | `date_format_ambiguous` **plus** `coerce_dtype`, `dtype` | `date_format_ambiguous` only (with `12/12/2024`) |

The phase's own test `test_out_of_order_month_name_cell_is_reported_by_the_order_check` states the intent: an out-of-order month-name cell gets "the same report as any out-of-order numeric date". That test covers only the day-first-only exit, because its column has a day greater than 12, so these two exits are unpinned. The real user is someone uploading a short or monthly series with an ordering mistake. They are told a date is unreadable when the true problem is the order, and they are sent to fix a cell that is fine.

**Fix hint (replayed):** On the two exits that do not write a reading, and only when `month_named.any()`, write the month-first reading. That is the reading pandera itself infers from the raw numeric text, so the numeric cells come out the same:

```python
# just above `if mf_ok and df_ok:`
if month_named.any() and not (day_first_only or (df_ok and not mf_ok)) and not (mf_ok and not df_ok):
    df["date"] = (
        parsed_mf if readable.all() else parsed_mf.astype(object).where(readable, leftover)
    )
```

I replayed this in memory, without editing the file, on the three cases above and on the all-numeric out-of-order twin. The results were `monotonic_dates` only, `monotonic_dates` only, `date_format_ambiguous` only, and `monotonic_dates` only (unchanged). The ambiguity exit's comment says "do NOT mutate df["date"]". Its purpose is not to choose a calendar silently, and that still holds, because the ambiguity error rejects the file regardless. The fixer should update that comment. Add a test for each exit, each beside its numeric twin.

## Info

All items below are LOW or INFO: **non-actionable** under the review policy, recorded here only.

### IN-01 (LOW): The ceiling exemption is decided by the claim alone, with no check that the body is a CSV flow

**File:** `analytics-service/routers/process_key.py:213` `_process_key_is_csv_scoped`
**Issue:** The exemption is `classify_tenant_claim(request).kind == "csv"`. Nothing in Python checks that the same request's `body.flow_type == "csv"`. Today the only `csv:` producer is `postProcessKey` under `flow_type === "csv"`, and the claim is signed with the shared secret, so the two cannot disagree without a TS bug. This is a missing second layer, not a live hole.
**Fix hint:** Optional defense in depth: have the predicate also require the parsed body's `flow_type == "csv"`, or log a WARN when the claim kind and the flow type disagree.

### IN-02 (LOW): Generality without instantiation: `tenant_or_platform_key` gives a csv claim its own bucket on single-limit routes

**File:** `analytics-service/services/rate_limit.py:581` (`if claim.kind == "csv" and claim.value is not None: return csv_bucket_key(scope, claim.value)`)
**Category:** necessity
**Issue:** No route keyed by `tenant_or_platform_key` ever receives a `csv:` claim. `postProcessKey` (`/process-key`) is the only minter, and `/process-key` uses `tenant_rate_limit_key`. So this arm handles a state that does not occur. If it were reached, it would hand a user a second window (`<scope>:csv:<uuid>` beside `<scope>:t:<uuid>`) on a route with no aggregate above it. That is the exact "N windows with nothing above them" shape that commit `fe8515052` removed for anonymous claims on these routes. This rests on judgment about future callers, hence Info.
**Fix hint:** Fold `csv` into the tenant arm here (`<scope>:t:<uuid>`), or drop the arm, so the single-limit routes keep one window per user.

### IN-03 (LOW): The month-name info flag can describe a cell that is then rejected

**File:** `analytics-service/services/csv_validator.py:915` `_month_only_flag` and the `n_month` count at about line 1018
**Issue:** `n_month` counts cells the regex matched, not cells that parsed. For `13/03/2024, 14/03/2024, 12 Mar 9999`, the 9999 cell is out of range and becomes NaT. The file then carries a `coerce_dtype` error and also the info flag "Read 1 date written with a month name … and normalized it to YYYY-MM-DD", which is false for that cell. The numeric twin `12/03/9999` carries no flag. The file is rejected anyway.
**Fix hint:** Count `(month_named & month_parsed.notna())` instead.

### IN-04 (INFO): The domain-separation claim in the docblock is stronger than the construction

**File:** `src/lib/tenant-claim.ts:131`, the `anonymousClaimPayload` docblock
**Issue:** The docblock says the `anon-ip:` prefix means "the digest can never equal a claim MAC". For a dotted IPv4 address, the message `anon-ip:203.0.113.7` is byte-equal to the claim MAC message for payload `anon-ip:203.0.113` with exp `7`. This cannot be exploited: that exp is long expired, the digest is truncated to 128 bits, and it never leaves the Vercel-to-Railway hop. But the sentence is not literally true.
**Fix hint:** Reword it to the real guarantee: any colliding claim would carry a single-digit expiry and is rejected as expired.

### IN-05 (INFO): `VenueTransientHTTPException` is now also the permanent-400 builder, and the contract table records it as a 400

**File:** `analytics-service/services/error_contract.py` (class docstring addition) and `analytics-service/docs/STATUS_CONTRACT.md:613`
**Issue:** The class name says "transient", but it now carries `recoverable: false` permanent 400s. The docstring records this, and no code branches on the type. The STATUS_CONTRACT handler table lists its status as **400**, while its seven venue-verdict sites emit **424**. A reader who trusts the name or the table will misread one of the two populations.
**Fix hint:** Make the table cell "424 (venue verdicts) or 400 (permanent validate-key arms)". A rename can wait for its own phase.

### IN-06 (INFO): A deploy-skew window exists and is accepted (recorded so it is not rediscovered)

**File:** `src/lib/process-key-client.ts` (`claimPayload` derivation) against the pre-240 `services/rate_limit.py`
**Issue:** Vercel deploys on merge and Railway deploys after main CI, so the new TS reaches the old Python first. In that window the old `tenant_rate_limit_key` buckets `public:<hex>` and `csv:<uuid>` as `process_key:t:…`, at 100/hour per pseudonym with no aggregate (the ceiling still applies). The window is transient and is not an outage. `240-CONTEXT.md` accepts it ("transient skew that is not an outage").
**Fix hint:** None. Accepted by decision.


## Round 2

**Re-reviewed:** 2026-11-24T21:26:35Z, commits `2a1194ba4` and `34fdebf51`. **MEDIUM and above: 0.** WR-01 is closed. The frontmatter now counts open findings only (warning 0, total 6). WR-01 stays above as the record.

**WR-01 is closed (`2a1194ba4`).** The new block in `_detect_and_normalize_date_column` writes the month-first reading back, guarded by `if month_named.any():`. It is the code the round-1 fix hint proposed, and I replayed it again here through `validate_csv`:
- Out of order, `01/03, 02/03, 12 Mar, 03/03, 04/03`: only `monotonic_dates`, the same as the numeric twin.
- `01/03/2024, 12 Jan 2024, 01/04/2024`: only `monotonic_dates`.
- Ambiguous, `01/02, 03/04, 12 Dec`: only `date_format_ambiguous`, with no `coerce_dtype`.

The new parametrised test `test_month_name_cell_on_a_rejecting_exit_gets_its_numeric_twins_errors` compares each exit's full error list to its all-numeric twin's list and asserts `coerce_dtype` is absent. Against the round-1 code it would have failed: round 1 measured `coerce_dtype` on both exits. All 89 tests in `test_csv_validator_date_format_2026_05_27.py` pass.

**No regression on the accepting exits.** The block sits after every accepting branch has returned: the equal-parse exit, the month-first-only exit and the day-first exit. Only the ambiguous return and the final fallthrough can reach it. Re-run outcomes:
- `12 Mar 2024, 13/03/2024, 14/03/2024`: accepted, `month_name` flag.
- `01/02/2024, 15 Jan 2024`: accepted, `month_name` flag.
- `12 Mar 2024, 15 Mar 2024` (all month names): accepted, no flag.
- `13/03/2024, 12 Mar 2024`: `monotonic_dates` from the equal-parse exit, unchanged.
- A footer cell beside a month-name cell takes the month-first-only exit, which this commit does not touch.

**A numeric-only column is still left as written on the rejecting exits.** The `month_named.any()` guard is false for it. I called the detector directly:
- `01/03, 02/03, 05/03, 03/03, 04/03` returns `None` with the cells unchanged as text.
- `01/02, 03/04, 12/12` returns `date_format_ambiguous` with the cells unchanged as text.

The rewritten comment on the ambiguity exit says the same.

**The pin move from 65 to 68 (`34fdebf51`) is measured, not hand-tallied.** `test_process_key_permanence_plumbing.py` holds exactly three `error_code=error_code` constructions (`grep -c`). The argument says no code-list entry moves. `src/lib/seam-venue-vocabulary.invariant.test.ts` passes (27/27) at 68.

No new LOW or INFO items.


## Round 3

**Re-reviewed:** 2026-11-24T21:29:47Z, commit `3ccd52607`. **Open MEDIUM and above: 0.** One MEDIUM was found and fixed in this round.

### WR-02 (MEDIUM, data-integrity, user-facing): the WR-01 write-back blanked a cell only the day-first reading could read. FIXED in `3ccd52607`.

**Found by:** the silent-failure hunter, in `2a1194ba4`. **Origin:** the WR-01 fix hint in this report. The write-back was keyed on `readable`, which is `parsed_mf.notna() | parsed_df.notna()`, but it wrote `parsed_mf`. A cell such as `25/03/2024`, which only the day-first reading can parse, therefore went in as NaT. pandera then reported `not_nullable` at a row the user had filled in, and the preview showed NaT.

My round-2 replay missed it because none of my cases contained such a cell. I replayed the defect in memory: putting `readable` back on `01/02/2024, 25/03/2024, 03/25/2024, 12 Mar 2024, 05/06/2024` gives `not_nullable` at the `25/03/2024` row and NaT in the preview.

**The fix is correct.** The write-back is now keyed on `parsed_mf.notna()`, the month-first reading's own cells, with the existing `leftover` fallback. A cell month-first cannot read becomes the uncoercible placeholder, so pandera reports it as `coerce_dtype` at its row and the preview shows it as written. A blank cell stays blank and still reports `not_nullable`. Measured through `validate_csv`:
- Day-first-only cell: `coerce_dtype` at the `25/03/2024` row plus `monotonic_dates`, with `'25/03/2024'` shown as written in the preview. There is no `not_nullable`, so the rule set matches the all-numeric version. That version reports the coerce at row 0, because pandera cannot name the row when it reads raw text; the fix names the real row, which is the house's WR-03 intent.
- Blank beside a month-name cell: `not_nullable` once at the blank row plus `monotonic_dates`, the same as the all-numeric version.
- Footer `Total` beside a month-name cell: `coerce_dtype` at the `Total` row plus `monotonic_dates`, the same as the all-numeric version.

The two new tests each fail on the defect it targets:
- `..._is_not_blanked_by_the_month_first_write_back` asserts that `not_nullable` is absent and the preview has no NaT. It fails against the neutered `readable` key.
- `..._still_reports_not_nullable` pins the blank-cell arm.

All 91 tests in `test_csv_validator_date_format_2026_05_27.py` pass. The round-2 verdicts still hold: the write runs only after every accepting branch has returned, and the `month_named.any()` guard keeps a numeric-only column as written on the rejecting exits. The frontmatter counts open findings only, so it is unchanged (warning 0, total 6). WR-02 is recorded here as found and fixed.

---

_Reviewed: 2026-11-24T21:20:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter — LOW / INFO survivors (recorded only, not fixed)

Round 1 of the silent-failure hunt found no MEDIUM+ issues. Round 2 found one MEDIUM, recorded above as WR-02 and fixed in `3ccd52607`. Round 3 is clean. The LOW items below are kept here only, per the review rule:
- SFH-L1: `_process_key_not_anonymous` / `_process_key_is_csv_scoped` have `except` arms that are effectively unreachable, because `classify_tenant_claim` never raises. The aggregate predicate's "a fault refuses" docstring therefore applies only in theory.
- SFH-L2: an absent or `unknown` client IP silently mints the shared `public` claim, as CONTEXT allows. A `getClientIp` regression would show only through saturation of the shared bucket.
- SFH-L3: a malformed `csv:` payload falls to the plain tenant tier without a log line. A malformed `public:` payload falls to the shared anonymous bucket. Both are throttles, not bypasses.
- SFH-L4: the `except ValueError` around `create_exchange` labels any ValueError `INVALID_REQUEST` and does not log it.
- SFH-L5: the wizard renders `VENUE_DISABLED` / `INVALID_REQUEST` as UNKNOWN, per the UI-SPEC rulings R1/R2.
- SFH-L6: the month-name flag count includes cells that are later rejected for an out-of-bounds year. The text is cosmetic only, and the rejection still shows.
- SFH-L7: the legacy-bucket alert and the aggregate alert share one Sentry fingerprint; the `limit` tag tells them apart.
