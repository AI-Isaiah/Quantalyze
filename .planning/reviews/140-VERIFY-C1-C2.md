# Phase 140 — ADVERSARIAL VERIFICATION of C-1 and C-2

**Verifier stance:** refute by default. A finding survives only on demonstrated evidence.
**Tree under test:** isolated worktree, detached HEAD at `a77d607e` (the exact commit
`140-SYNTHESIS.md` adjudicates). Nothing committed; all probes deleted; tree clean.
**Runtime:** local Node `v25.8.1` / undici `7.22.0`. CI is Node 22 — see the caveat in C-1.
**Branch protection on `main` is OFF.** Every gate below **would have caught**; none **did stop**.

---

## VERDICT SUMMARY

| Finding | Verdict | Movement |
| --- | --- | --- |
| **C-1** — csv-validate 502 body echoes `INTERNAL_API_TOKEN` into the wizard panel | **CONFIRMED-BUT-RE-GRADED → LOW** | CRITICAL → LOW. The credential half is **refuted by measurement**. What survives is raw internal prose reaching the browser. |
| **C-2** — tenant-scope migration removed the CSV double-submit guard | **CONFIRMED** | Stays CRITICAL. **Could not refute on any of the four sub-claims.** Blast radius stated below. |

---

# C-1 — RE-GRADED from CRITICAL to LOW

**The finding's own collapse condition was met.** The brief set it explicitly: *"If (a) fails, the
finding collapses to 'raw upstream prose to the browser'."* Sub-claim (a) fails, and sub-claim (b)
fails **independently**. Either alone is sufficient.

## (a) Can a real transport failure produce an Error whose `.message` contains the token? — **REFUTED**

**MEASURED.** Standalone Node probe issuing `fetch` with `Authorization: Bearer <TOKEN>`,
`X-Tenant-Claim` and `X-User-Access-Token` set, across six failure shapes. "TOKEN ANYWHERE" scans
`message` + `name` + `stack` + the full `cause` chain + all own properties:

| Failure shape | `err.message` | TOKEN anywhere? |
| --- | --- | --- |
| ECONNREFUSED (closed port) | `fetch failed` (cause `connect ECONNREFUSED 127.0.0.1:9457`) | **false** |
| ECONNRESET / socket destroyed | `fetch failed` (cause `read ECONNRESET`) | **false** |
| DNS ENOTFOUND | `fetch failed` (cause `getaddrinfo ENOTFOUND …`) | **false** |
| `AbortSignal.timeout` | `The operation was aborted due to timeout` | **false** |
| HTTP parse error (garbage response) | `fetch failed` (cause `Response does not match the HTTP/1.1 protocol`) | **false** |
| **Invalid header VALUE** | `Headers.append: "Bearer <TOKEN>" is an invalid header value.` | **true** |

**No real transport failure inlines the token.** Modern undici returns a constant `fetch failed` and
puts the syscall detail in `cause`. The repo's own docblock claim — `seam-redaction.ts:21-23`,
*"undici embeds the outgoing headers in `err.message`"* — is **true for exactly one shape**: the
**header-value validation `TypeError`**, which fires only if the token value itself contains an
illegal character (newline, trailing space, control char). That is a malformed-secret condition, not
a Railway blip. The synthesis's stated trigger — *"needs a throw rather than a classified envelope —
a Railway blip"* — is precisely the case that does **not** carry the token.

*Version caveat (INFERRED):* measured on undici 7.22.0; CI/Vercel run Node 22. The `fetch failed` +
`cause` split is long-standing undici behaviour across both majors, but I did not execute under Node
22. This does not affect the verdict, because (b) is independently fatal.

## (b) Is the arm reachable from a realistic failure? — **REFUTED**

**This is the harder kill and it is decisive.** `postProcessKey` **classifies every upstream outcome
into `{ok:false, response}` and does not rethrow.** `process-key-client.ts:387-424` wraps both
`resilientFetch` *and* the body read; the catch at `:425-557` has four exhaustive arms
(`CircuitOpenError` → 503, `SeamConfigError` → 500, abort/timeout → 504, **everything else** → a
**static** `UPSTREAM_NETWORK_ERROR` 502). The route's `catch` at `route.ts:261` therefore only ever
sees residue thrown *outside* that try.

**MEASURED end-to-end** — throwaway vitest exercising the **real** `process-key-client` + **real**
`resilient-fetch` (only auth / ratelimit / Sentry-transport / `next/headers` faked), `node`
environment, `INTERNAL_API_TOKEN` set to a distinctive 49-char value, real sockets:

| Probe | HTTP status | body `code` | TOKEN in body? |
| --- | --- | --- | --- |
| A. real ECONNREFUSED upstream | 502 | `UPSTREAM_NETWORK_ERROR` | **false** |
| B. real DNS failure | 502 | `UPSTREAM_NETWORK_ERROR` | **false** |
| C. malformed `ANALYTICS_SERVICE_URL` | 500 | `SEAM_MISCONFIGURED` | **false** |
| D. **token is an invalid header value** (the one inlining shape) | 502 | `UPSTREAM_NETWORK_ERROR` | **false** |

**In all four the route's catch arm never executed** — every `human_message` came from
`postProcessKey`'s static copy, not from `csvErrorEnvelope("CSV_UPSTREAM_FAIL", message, …)`.

Probe **D** is the money shot. The raw undici error *did* carry the token, and the operator log shows
the scrubber eating it in flight:

```
[resilient-fetch] process-key-sync: network failure reaching the analytics service:
  TypeError: Headers.append: "Bearer <redacted>" is an invalid header value.
[strategies/csv-validate] /process-key upstream fetch threw:
  Headers.append: "Bearer <redacted>" is an invalid header value.
```

`<redacted>` is `seam-redaction.ts`'s `REDACTED` constant. **The one shape that can inline the token
is the one shape that never escapes `postProcessKey`, and it is scrubbed on the way to the log.**

**The arm IS reachable — but not by anything token-bearing.** Probe E forced `getCorrelationId()`
(`process-key-client.ts:309`, the one `await` *outside* the try) to throw:

```
[E CATCH-ARM] status 502 body: {"ok":false,"code":"CSV_UPSTREAM_FAIL",
  "human_message":"headers() called outside a request scope", ...}
```

That is the finding's true residual: **raw internal prose in the HTTP body.** The reachers are
`file.arrayBuffer()` / `Buffer.from(...)` (OOM/RangeError), a `getCorrelationId()` throw, and a
post-catch `NextResponse.json` construction fault. **None carries a credential.**

## (c) Does the value reach the DOM? — **CONFIRMED** (but moot)

`CsvUploadStep.tsx:275` assigns `data.human_message` verbatim into the envelope; that string renders
twice in `CsvValidationEnvelope.tsx` — the title `<p>` (`envelope.human_message` when
`errors.length === 0`) and the subtitle `<p>` via `causeText` (the `else` branch when `ruleCount === 0`).
React escapes markup but does not filter content. The mechanism is real; there is simply no
credential to carry through it.

## (d) Is `captureToSentry` genuinely unscrubbed here? — **REFUTED, flatly**

The finding's premise — *"passes the raw error to `captureToSentry` **with no `secrets:` argument**"* —
misreads the API. `captureToSentry` scrubs **unconditionally at the chokepoint**:
`sentry-capture.ts:141` calls `scrubCaptureInput(err, secrets)`, which runs `scrubSeamString` over
`message`, `name`, `stack` and the folded `cause` chain. `INTERNAL_API_TOKEN` is a **hard-coded
member of `SEAM_SECRET_ENV_NAMES`** (`seam-redaction.ts:84`), read from `process.env` at call time.

The `secrets:` argument is **only** for PER-REQUEST secrets (a live user JWT, exchange
`api_key`/`passphrase`) that no module-level list can know. `route.ts:13-18` states — correctly —
that this route has **none**. Its absence is right by design, not an omission. Probe D measured
`TOKEN IN SENTRY PAYLOAD? >>> false`.

The synthesis's supporting metric, `grep -c scrubSeam` on the route → **0**, reproduces (I measured
it), but it is a **false signal**: the route does not import the leaf because its capture path scrubs
one layer down. Absence of the import is not absence of scrubbing.

## What actually survives C-1

1. **`route.ts:274` returns raw `err.message` in the HTTP body**, violating the rule its sibling
   states verbatim at `bridge/route.ts:190-193` (*"H-1062: genuine 5xx / unexpected exceptions return
   a STATIC message"*). Harm: internal prose (a Next.js internals message, a stack-adjacent string)
   painted into a user-facing panel. **Information disclosure, LOW.**
2. **`route.ts:273` `console.error`s raw `message` unscrubbed** — the only log site on this seam not
   routed through `scrubSeamError`. No demonstrated leak today; a **latent** gap that would matter if
   a token-bearing value ever reached this arm. Worth closing as class hygiene.

**Remedy is unchanged and cheap** (static 502 message + `scrubSeamError` at the console site) — but
it is **LOW-priority hygiene**, not a credential incident. Nothing about the support-screenshot
exfiltration narrative survives.

> **The TRAP note remains correct and still applies.**
> `src/__tests__/csv-validate-route.test.ts:382-397` pins the echo green
> (`expect(json.human_message).toContain("ANALYTICS_SERVICE_URL not configured")`), so a fix must
> delete an assertion. **But note what that test proves about the finding:** it reaches the arm only
> via `postProcessKeyMock.mockRejectedValue(...)` — `postProcessKey` is mocked wholesale
> (`:196-197`). It demonstrates nothing about whether the real client can throw a token-bearing
> error. **The synthesis's `TST §1` probe measuring `PROBE token in HTTP body? >>> true` is a
> contrived construction in exactly this sense.**

---

# C-2 — CONFIRMED. I could not refute it on any sub-claim.

**I tried to kill this four ways and failed every time.** Every load-bearing fact was re-derived
first-hand from source, and independently re-derived a second time by a separate search pass. The
two derivations agree on every point.

## (d) Is the migration real, valid, and reachable? — **YES**

`20260726000225_strategy_verifications_tenant_scope_uniq.sql` is a single well-formed transactional
migration (196 insertions, branch-only: `git diff --stat origin/main..HEAD -- supabase/migrations`
= this one file, commit `5ad45c22`). It does exactly what the finding says:

- `:123-124` `CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_strategy_wizard_session_uniq ON strategy_verifications (strategy_id, wizard_session_id);`
- `:135` `DROP INDEX IF EXISTS strategy_verifications_wizard_session_id_unique_idx;`

Its STEP 0 pre-flight (`:104-118`) only aborts on **pre-existing duplicate composite pairs** — it
does not change the analysis. STEP 3 (`:140-194`) actively **asserts the old index is gone**
(`:172-174`), so the removal is intentional and self-verified, not accidental.

**The migration is correct about the bug it targets.** It fixes a genuine CRITICAL: `wizard_session_id`
is caller-supplied, so the old single-column index made it unique platform-wide, letting tenant B's
insert collide with tenant A's and — via the 23505 re-fetch at `process_key.py:895-901` — return
**tenant A's** `verification_id`/`status`/`trust_tier` to B. **This must not be reverted.**

The defect is **enumeration scope**. The migration's own read-path note (`:76-81`) enumerates
*readers* of the dropped index and clears them. It never enumerates the **writer** whose only
double-submit protection that index was. The dropped index's own comment
(`20260510173005:86-87`) said what it was for, in as many words:
*"Phase 19 / BACKBONE-08. Wizard double-submit prevention; route catches 23505 and returns existing row."*

## (b) Is `finalize_csv_strategy` still what the CSV path calls? — **YES**

Traced, not assumed. `analytics-service/routers/process_key.py:1092-1102` calls
`user_sb.rpc("finalize_csv_strategy", {...})` inside the branch
`if body.flow_type == "csv" and step == "finalize" and body.source == "csv"` (`:1061-1065`).
Chain: browser → `POST /api/strategies/csv-finalize` → `unifiedCsvFinalizeHandler` → `postProcessKey`
→ Python `/process-key` → the RPC. The route states the backbone *"is now the sole finalize path"*.
Latest of the two definitions is `20260716130500_finalize_terminal_status_param.sql` (re-base rule
applied; the 2026-05-01 original is superseded by an explicit `DROP FUNCTION` + `CREATE`).

## (a) Is there ANY other guard? — **NO. Searched hard; found none.**

**1. The composite key cannot collide.** `20260716130500:296-305`:

```sql
INSERT INTO strategies (
  user_id, name, status, source,
  strategy_types, subtypes, markets, supported_exchanges
) VALUES (...)
RETURNING id INTO v_strategy_id;
```

A **fresh** `strategy_id` every call — and the column list **omits `wizard_session_id`**. Then
`:315-321` inserts `strategy_verifications (strategy_id, wizard_session_id, …) VALUES (v_strategy_id,
p_wizard_session_id, …)`. Since `strategy_id` is new each time, `(strategy_id, wizard_session_id)` is
**unique by construction and can never raise 23505.**

**2. The 2026-06-02 partial index cannot fire.**
`20260602190000_f6_wizard_session_idempotency.sql:52-54` is
`ON strategies (user_id, wizard_session_id) WHERE wizard_session_id IS NOT NULL`. Because the INSERT
above omits the column it stays NULL, so the row falls outside the partial predicate. **That
migration's own column comment says so out loud** (`:47`): *"NULL for legacy/admin/**CSV** strategies."*
It guards `create_wizard_strategy` / `add_wizard_composite_key` — the API-key wizard, not CSV.

**3. The Python `WIZARD_DUPLICATE` pre-check never runs on this path — and that is deliberate.**
This was my best refutation candidate and it dies on control flow. The pre-check
(`process_key.py:1186-1240`) and the 23505 race-winner arm (`:1276-1303`) both sit **below** the
`if strategy_id is None:` block, and the CSV finalize branch **returns inside that block**
(`:1120-1126`). The comment at `:1170-1185` says the position is load-bearing and names the CSV
consequence explicitly:

> *"(b) it short-circuited EVERY flow, including csv-finalize. Once `finalize_csv_strategy` had
> written an SV row carrying that session id, every later csv call for the session hit this return
> instead of the finalize branch — **a plain double-submit, no timeout needed**."*

**This is the crux, and it makes the finding stronger, not weaker.** That short-circuit *was* the
application-level double-submit guard for CSV — a repeat submit returned `WIZARD_DUPLICATE` 200 with
the existing `verification_id`. Commit `ca9a9235` (140.1-02) removed it as "C-20's dead end",
**one commit after** `5ad45c22` (140.1-01) removed the DB-level guard. Two adjacent commits each
removed one of the two guards, each for a locally defensible reason, and **neither noticed the
combined effect.** Textbook enumeration failure.

**4. No guard inside the RPC.** Full body read (`:236-325`). Only pre-INSERT guards are
terminal-status (`:244-248`), auth-identity (`:254-263`), fmt whitelist (`:266-269`) and
strategy-name length (`:277-286`). **No existence check, no advisory lock, no `ON CONFLICT`.**
(Advisory-lock fences exist only in `create_wizard_strategy` and `add_wizard_composite_key`.)

**5. No route-level dedupe.** No idempotency key, no Idempotency-Key header, no SELECT by
`wizard_session_id`. The 23505 references in `src/app/api/strategies/csv-finalize/route.ts` are all
about duplicate **dates** in the series (T-19.1-04 / PR #274).

**6. Rate limiting bounds volume, not duplication.** `route.ts:1051-1054` →
`csvValidateLimiter` = **20 requests / 60 s per user** (`src/lib/ratelimit.ts:204`). That permits 20
duplicate strategies per minute. Not a guard.

**7. No later migration restores protection.** This is the newest migration touching the table.

### ⚠️ The regression is pinned green by a passing test

`analytics-service/tests/test_process_key.py:3888` —
`test_pyapi_09c_csv_finalize_double_submit_reaches_finalize_branch`, docstring:

> *"This is the DURABLE proof that the pre-check moved: the SV row below WOULD short-circuit if the
> pre-check still ran first."*

A test named for a **double-submit** now asserts that a double-submit **reaches the strategy-creating
branch**. Any fix must change this test, which is TRAP-9 territory — same shape as C-1's trap.

## (c) Does `wizardErrors.ts:882` make the claim? — **YES, verbatim**

`src/lib/wizardErrors.ts:884`, under `CSV_SUBMIT_NO_STRATEGY_ID`:

> `"Submit again. On the CSV path a repeat submit of the same wizard session cannot create a second strategy."`

**Three aggravations the synthesis does not mention:**

- The comment immediately above (`:876-882`) explicitly reasons *"The guarantee itself is real HERE
  and is kept"* — now **false**, and it is the exact "promise made ahead of its mechanism" failure
  the comment itself warns against.
- The copy is the **remedy text for the error whose fix is retrying** —
  `CSV_SUBMIT_NO_STRATEGY_ID` renders *"Submission succeeded but the server did not return a strategy
  id. Retry to confirm."* The product therefore **instructs the user to perform the double-submit**
  that now silently mints a duplicate.
- **The adjacent error code already contradicts it.** `CSV_SUBMIT_FAILED` (`:860-871`) was already
  rewritten to warn: *"Open /strategies in another tab first. If your strategy is listed, the save
  did complete and **submitting again would create a second copy**."* Two neighbouring codes now make
  opposite claims about the same path. Also stale: `WIZARD_DUPLICATE` (`:892-909`) still describes a
  23505 handler that is unreachable on the CSV branch.

## Blast radius — stated explicitly, as requested

**Behaviour change on a CSV double-submit:**

| | Before migration | After migration |
| --- | --- | --- |
| SV insert | 23505 on the global index | succeeds |
| Whole RPC txn | **rolls back** (single SECDEF transaction) — no `strategies` row | commits |
| User-visible | 422 `CSV_FINALIZE_FAILED` | **200 OK** |
| Rows created | none | **a second `strategies` row + a second `strategy_verifications` row** |

- **Severity:** silent duplicate-strategy creation, per user, on a flow whose own error copy tells the
  user to retry. **Same-tenant only** — no cross-tenant exposure, and the migration *closes* a
  cross-tenant leak. It is a **data-integrity** regression, not a security one.
- **Detection:** none. The path returns 200 and logs `process_key.csv_finalize_ok`.
- **Deployment:** `supabase/migrations/**` **auto-applies to PROD on push to `main` with no human
  approval gate** — `.github/workflows/supabase-migrate.yml:3-13` (*"there is no human approval gate
  between plan and apply"*). Not yet in prod: branch-only at `a77d607e`.
- **The shipped SQL gate cannot catch this.**
  `supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql` asserts A1–A5, all
  about tenant isolation. **A1 requires the very composite behaviour that produces this regression.**
  The file names its own blind spot (`:66-69`) but scopes the caveat to the Python read-path, not to
  the CSV writer. Grepping it for `csv|finalize|double` returns **zero hits**. This gate **would have
  passed**, green, on the regression.

## Remedy direction (do not revert)

The finding's own remedy stands: **enumerate the writers of the dropped index.** Preferred fix — add
`wizard_session_id` to `finalize_csv_strategy`'s `strategies` INSERT column list, which makes the
already-live `strategies_user_wizard_session_uniq` partial index bite on `(user_id,
wizard_session_id)` and restores a 23505 on double-submit **without touching the tenant-scope fix**.
That also aligns the `strategies.wizard_session_id` column comment with reality. Ship it **in the
same PR** as the migration, plus a regression test that double-submits CSV finalize and asserts
exactly one `strategies` row — and reconcile `test_pyapi_09c_…` and the three `wizardErrors.ts`
strings in the same commit.

---

## Method notes

- **MEASURED:** all C-1 undici behaviour; all C-1 route-level probes (throwaway vitest, real client
  stack, real sockets, `node` environment); `grep -c scrubSeam`; `git diff --stat origin/main..HEAD`.
- **INFERRED:** C-1 behaviour under CI's Node 22 (probed on Node 25 only) — non-load-bearing.
  **All of C-2's runtime behaviour is inferred from source: no live database was available**, so the
  constraint analysis is read from migration DDL and PL/pgSQL function bodies, quoted above. The
  reasoning is structural — a fresh surrogate key cannot collide on a composite containing it — and
  does not depend on data.
- All probe files deleted; worktree clean; nothing committed.
