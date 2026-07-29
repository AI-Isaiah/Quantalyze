import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/withAuth";
import { csvValidateLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import { postProcessKey } from "@/lib/process-key-client";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
// 140.3-13b / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out IN FULL in `src/app/api/admin/match/eval/route.ts`
// by `140.3-13a`. Cited, never restated. The caught value is passed UNMODIFIED:
// `captureToSentry` scrubs at the chokepoint (SEAMCORE-06).
//
// PER-REQUEST SECRETS AT THIS ROUTE: none. The one credential the outgoing
// request carries is `INTERNAL_API_TOKEN`, which is already on
// `seam-redaction.ts`'s env-name list; no end-user JWT is forwarded from here
// and no exchange material exists on the CSV path. The uploaded BYTES are not a
// credential, and they are never put in a capture payload — only `fmt` and a
// size are. Stated rather than assumed (M78b).
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-09 / SEAMRIM-06 — the seam's ONE redaction leaf (SEAMCORE-06), for the
// terminal catch's console line.
//
// ⚠️ THE ABSENCE OF THIS IMPORT WAS RECORDED AS EVIDENCE OF A CREDENTIAL LEAK,
// AND THAT READING IS REFUTED. `grep -c scrubSeamError` returned 0 on this file
// and was reported by five independent registers as C-1 CRITICAL. It is a FALSE
// SIGNAL: the credential this route's outgoing request carries is
// `INTERNAL_API_TOKEN`, which is already on `seam-redaction.ts`'s env-name list
// and is therefore scrubbed unconditionally inside `captureToSentry` — the
// chokepoint — and no real transport failure inlines it into `err.message`
// anyway (ECONNREFUSED / ECONNRESET / DNS / timeout / parse all produce a
// constant `fetch failed`). What was actually wrong here was HYGIENE, and it is
// what this import fixes: an unscrubbed console line. Do not re-derive the
// stronger claim from the fact that this import is new.
import { scrubSeamError } from "@/lib/seam-redaction";
// CR-02: the terminal arm renders this code's OWN authored title rather than a
// second sentence about the user's file. One table, one sentence.
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";

/**
 * POST /api/strategies/csv-validate — Phase 15 / CSV-01..CSV-02.
 *
 * Multipart proxy to the analytics-service `/api/csv/validate` row-schema
 * validator. Defense-in-depth shape checks here (10 MB cap, fmt enum,
 * file presence) BEFORE forwarding so a malformed multipart body never
 * reaches the Python service. The validateCsv() helper throws
 * `Error('ANALYTICS_SERVICE_URL not configured')` when the env var is
 * missing — caught here and translated to a CSV_UPSTREAM_FAIL envelope
 * (no silent localhost fallback per cross-AI revision 2026-04-30).
 *
 * Phase 19 / BACKBONE-10 → Phase 106 Stage B
 * -------------------------------------------
 * The route re-targets the upstream unconditionally from `/csv/validate` to
 * `/process-key` with `flow_type=csv`. The former flag=off legacy
 * `validateCsv()` fallback was deleted in 106-07; the kill-switch reader
 * itself was deleted in 106-10 and the unified backbone is now the only path.
 *
 * Error envelope shape (v0): { ok: false, code, human_message,
 * debug_context, correlation_id: null }. Phase 16 / OBSERV-06 will
 * thread real correlation_id values through this route without
 * breaking the contract.
 */

/**
 * Phase 140 / SEAM-02 — pinned for clarity; asserted against
 * SEAM_ROUTE_BUDGETS by seam-budgets.invariant.test.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot raise this
 * route's worst-case lambda hold. It exists so the SC-4b headroom invariant
 * has an in-repo source of truth instead of a dashboard-changeable
 * assumption: this route spends one `process-key-sync` budget (60s — the CSV
 * flow runs the full pipeline INLINE), 5× headroom.
 */
export const maxDuration = 300;

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * M-14: the CSV v0 envelope BODY — `ok: false`, code, human_message,
 * debug_context, correlation_id, in that order.
 *
 * 140.4-13 / SEAMRIM-05 split this out of `csvErrorEnvelope` below so the deny
 * arm can hand the SAME body to `rateLimitDenyJson` without re-typing the five
 * fields. Re-typing them would have made this route the one place where the
 * envelope has a second definition — the exact opposite of M-14's stated reason
 * for existing, and the shape a future `correlation_id` thread would miss.
 */
function csvErrorBody(
  code: string,
  human_message: string,
  debug_context: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: false,
    code,
    human_message,
    debug_context,
    correlation_id: null,
  };
}

/**
 * M-14: shared error-envelope builder for the CSV routes. Every error path
 * returns the same v0 envelope shape (`ok: false`, code, human_message,
 * debug_context, correlation_id: null) — co-locate that here so a future
 * Phase 16 / OBSERV-06 correlation_id thread is one edit, not seven.
 */
function csvErrorEnvelope(
  code: string,
  human_message: string,
  debug_context: Record<string, unknown> = {},
  status = 400,
  init: ResponseInit = {},
): NextResponse {
  return NextResponse.json(
    csvErrorBody(code, human_message, debug_context),
    // NO_STORE_HEADERS is the base so every error envelope is private,no-store;
    // caller headers (e.g. the 429's Retry-After) merge ON TOP without
    // clobbering Cache-Control. Spread order matters: a flat `...init` last
    // would replace the whole `headers` key and drop no-store on the 429.
    {
      status,
      ...init,
      headers: {
        ...NO_STORE_HEADERS,
        ...(init.headers as Record<string, string> | undefined),
      },
    },
  );
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  // Adversarial-review fix 2026-05-02: short-circuit oversize uploads on
  // Content-Length BEFORE req.formData() buffers the entire body. The
  // file.size check at line 73 fires only after the multipart parser
  // has already read the request, so the prior 10 MB cap was cosmetic.
  // The header is advisory (clients can lie or omit it), so the
  // post-parse file.size check stays as defense-in-depth.
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
      return csvErrorEnvelope(
        "CSV_FILE_TOO_LARGE",
        `Maximum file size is 10 MB. Your upload is ${(contentLength / 1024 / 1024).toFixed(1)} MB.`,
        { content_length: contentLength },
        400,
      );
    }
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return csvErrorEnvelope("CSV_INVALID_FORMAT", "Invalid multipart body.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return csvErrorEnvelope("CSV_INVALID_FORMAT", "Missing file field.");
  }

  if (file.size > MAX_BYTES) {
    return csvErrorEnvelope(
      "CSV_FILE_TOO_LARGE",
      `Maximum file size is 10 MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      { size_bytes: file.size },
    );
  }

  const fmt = formData.get("fmt");
  if (
    typeof fmt !== "string" ||
    !["daily_returns", "daily_nav", "trades"].includes(fmt)
  ) {
    return csvErrorEnvelope(
      "CSV_INVALID_FORMAT",
      "fmt must be one of daily_returns, daily_nav, trades.",
      { fmt_received: typeof fmt === "string" ? fmt : "(missing)" },
    );
  }

  // Phase 15 / WR-03: validate the wizard_session_id UUID shape at the
  // edge so a missing/malformed value returns a clean 400 envelope
  // instead of a FastAPI 422 wrapped as a CSV_UPSTREAM_FAIL 502 (the
  // Python router declares wizard_session_id: str = Form(...) with no
  // shape check). Mirrors the defense-in-depth check the csv-finalize
  // route already performs.
  const sessionId = formData.get("wizard_session_id");
  if (typeof sessionId !== "string" || !isUuid(sessionId)) {
    return csvErrorEnvelope(
      "CSV_INVALID_FORMAT",
      "wizard_session_id must be a valid UUID.",
    );
  }

  // B15 limiter-ordering: consume the rate-limit token only AFTER all pure
  // input validation (Content-Length cap, multipart parse, file
  // presence/size, fmt enum, wizard_session_id UUID) so a malformed request
  // is rejected with 400 without burning one of the caller's own tokens.
  const rl = await checkLimit(
    csvValidateLimiter,
    `strategies-csv-validate:${user.id}`,
  );
  if (!rl.success) {
    // 140.4-13 / SEAMRIM-05 — deny through the chokepoint so a limiter
    // misconfiguration answers 503.
    //
    // ⚠️ WHICH OF THE TWO ALLOWED SHAPES THIS ROUTE USES, AND WHY. The plan
    // permitted either passing the envelope as a body override or keeping
    // `csvErrorEnvelope` and branching on `isRateLimitMisconfigured` locally.
    // Neither verbatim: the body comes from `csvErrorBody` — the SAME builder
    // `csvErrorEnvelope` uses — so the five v0 fields keep one definition, and
    // the STATUS comes from `rateLimitDenyJson`, so the 503-vs-429 decision
    // lives in the artefact rather than in a twelfth inlined copy. Re-typing
    // the envelope here would have been the "simplification" that gave this
    // route a second envelope definition to drift.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: csvErrorBody(
        "CSV_RATE_LIMIT",
        "Too many requests. Wait a minute and try again.",
      ),
      misconfiguredBody: csvErrorBody(
        "SEAM_MISCONFIGURED",
        "Our rate limiter is unavailable, so we stopped before checking your file. This is a fault on our side, not your data. Nothing was uploaded — try again in a minute.",
      ),
    });
  }

  // Phase 106 Stage B (D2): the unified backbone is the sole validate path.
  // The former flag-off legacy validateCsv arm was deleted in 106-07; the
  // kill-switch reader was deleted in 106-10 (backbone permanent-on).
  return await unifiedCsvValidateHandler({
    formData,
    file,
    fmt,
    sessionId,
    userId: user.id,
  });
});

/**
 * Phase 19 / BACKBONE-01 unified path. Re-targets the upstream from
 * `/csv/validate` to `/process-key` with `flow_type=csv`. The CSV bytes
 * are passed in `context.raw_bytes_base64` (base64-encoded raw bytes)
 * along with `fmt` and `wizard_session_id`. Returns the same envelope
 * shape as the legacy path so wizard chrome doesn't need to branch.
 */
async function unifiedCsvValidateHandler(args: {
  formData: FormData;
  file: File;
  fmt: string;
  sessionId: string;
  userId: string;
}): Promise<NextResponse> {
  // M-3: csv-validate keeps a route-local INTERNAL_API_TOKEN check because
  // the 503 envelope must be the CSV envelope shape, not the generic
  // `{error: "Service unavailable"}` the shared helper returns. The helper
  // is still used for the actual POST so the per-route fetch boilerplate is
  // gone.
  if (!process.env.INTERNAL_API_TOKEN) {
    // 140.3-13b / SEAMUX-08 — a PERMANENT CONFIG FAULT, captured `fatal`. The
    // isomorph of `verify-strategy`'s admin-client-config arm, which
    // `140.3-13a` captured for the same reason: a misconfigured deployment
    // takes the whole CSV upload path down for every user, it can never
    // self-heal, and nothing else reports it — a `console.error` on a serverless
    // function is not an alert. It is NOT an upstream condition, so it is not
    // excluded by the policy's breaker / timeout / forwarded-4xx list.
    //
    // A SYNTHETIC Error, deliberately: there is no caught value here, and the
    // ENV VALUE must never be near a capture payload. Only the name is stated,
    // and it is absent by definition on this arm.
    captureToSentry(
      new Error("csv-validate: INTERNAL_API_TOKEN is not configured"),
      {
        tags: { surface: "strategies-csv-validate", step: "config-missing" },
        level: "fatal",
      },
    );
    console.error("[strategies/csv-validate] INTERNAL_API_TOKEN not configured");
    return csvErrorEnvelope("CSV_UPSTREAM_FAIL", "Service unavailable.", {}, 503);
  }

  try {
    const arrayBuffer = await args.file.arrayBuffer();
    const rawBase64 = Buffer.from(arrayBuffer).toString("base64");
    const result = await postProcessKey({
      flow_type: "csv",
      source: "csv",
      context: {
        fmt: args.fmt,
        wizard_session_id: args.sessionId,
        user_id: args.userId,
        file_name: args.file.name,
        raw_bytes_base64: rawBase64,
        step: "validate",
      },
      routeTag: "strategies/csv-validate",
      // CT-4 (army2) — forward tenant id for cross-tenant rate-limit isolation.
      userId: args.userId,
    });
    // 140.3-13b / SEAMUX-08 — DELIBERATELY NOT CAPTURED. `postProcessKey`
    // returns an ALREADY-CLASSIFIED envelope here: this is where the breaker's
    // forwarded 503 lives, alongside the client's own transport codes and any
    // upstream refusal. Capturing it would alert on every short-circuit during
    // the exact correlated incident Sentry exists to surface — the policy's
    // named exclusion — and would double-report anything the client itself
    // already answers for. Same reading `140.3-13a` applied to
    // `verify-strategy`'s `!result.ok`.
    if (!result.ok) return result.response;
    return NextResponse.json(result.body, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // 140.3-13b / SEAMUX-08 — THE TERMINAL ARM. `postProcessKey` classifies
    // every outcome it can into the `!result.ok` envelope above, so a THROW
    // reaching here is by construction the unclassified residue: a transport
    // failure, a missing-config throw from the client, a contract-drift parse
    // throw, or any untyped throw. The caught VALUE is passed, so Sentry keeps
    // the Error type, its grouping and its stack.
    captureToSentry(err, {
      tags: { surface: "strategies-csv-validate", step: "unified-path-threw" },
      extra: { fmt: args.fmt, size_bytes: args.file.size },
    });
    // 140.4-09 / SEAMRIM-06 — H-1062, the rule `src/app/api/bridge/route.ts`
    // states verbatim at its own terminal arm: a genuine 5xx / unexpected
    // exception returns a STATIC message and THE DETAIL STAYS SERVER-SIDE.
    // Echoing `err.message` there leaked Python contract-drift strings (the
    // multi-line Zod issue list `parseResponse()` throws) and FastAPI 5xx
    // detail to authenticated allocators. Here it was worse-placed: this body's
    // `human_message` is rendered by `CsvUploadStep` → `CsvValidationEnvelope`
    // as the wizard panel's TITLE and SUBTITLE — the one surface whose job is
    // "the upload failed, send this to support".
    //
    // The operator loses nothing. The caught value goes to Sentry above with
    // its type and its stack, and the line below carries the rendered detail
    // SCRUBBED. Answering this by dropping `err` from the log instead would be
    // the A-10 defect — the syscall token is the most valuable thing in a
    // transport line.
    console.error(
      "[strategies/csv-validate] unified path threw:",
      scrubSeamError(err),
    );
    return csvErrorEnvelope(
      "CSV_UPSTREAM_FAIL",
      // ⚠️ 140.4-16 / CR-02 — READ THE ARM'S OWN DEFINITION BEFORE CHANGING
      // THIS SENTENCE. Everything reaching here is, by construction, the
      // UNCLASSIFIED RESIDUE: a transport failure, a missing-config throw, a
      // contract-drift parse throw. `postProcessKey` classifies every other
      // outcome into the `!result.ok` envelope above. None of those is the
      // user's data.
      //
      // 140.4-09 replaced a leaky `err.message` echo with a static sentence —
      // correct — and picked "CSV validation failed. Try again shortly.",
      // which tells a user whose file is perfectly valid that their file is
      // not. That is the milestone's signature defect, authored by the phase
      // that exists to remove it, on the wizard's highest-traffic error
      // surface, and it WIDENED the misattribution: before, that sentence
      // applied only to the non-Error throw branch. A live QA pass reproduced
      // it in a browser (qa-report-localhost-2026-07-29, ISSUE-003).
      //
      // The code already OWNS an honest sentence. Read it from the ONE copy
      // table rather than restating it here: a second copy of a sentence is a
      // second thing to drift. `csv-validate-route.test.ts` hand-types the
      // expected literal, so the table and the assertion are independent
      // oracles.
      WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL.title,
      {},
      502,
    );
  }
}
