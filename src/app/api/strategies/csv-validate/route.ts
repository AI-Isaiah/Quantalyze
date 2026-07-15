import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/withAuth";
import { csvValidateLimiter, checkLimit } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import { postProcessKey } from "@/lib/process-key-client";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

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
 * `validateCsv()` fallback was deleted in 106-07 (its
 * `isUnifiedBackboneActive()===false` gate is dormant with the ratified pins).
 *
 * Error envelope shape (v0): { ok: false, code, human_message,
 * debug_context, correlation_id: null }. Phase 16 / OBSERV-06 will
 * thread real correlation_id values through this route without
 * breaking the contract.
 */

const MAX_BYTES = 10 * 1024 * 1024;

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
    {
      ok: false,
      code,
      human_message,
      debug_context,
      correlation_id: null,
    },
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
    return csvErrorEnvelope(
      "CSV_RATE_LIMIT",
      "Too many requests. Wait a minute and try again.",
      {},
      429,
      { headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Phase 106 Stage B (D2): the unified backbone is the sole validate path.
  // The former flag-off legacy validateCsv arm was deleted —
  // isUnifiedBackboneActive()===false is dormant with the ratified prod pins.
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
    if (!result.ok) return result.response;
    return NextResponse.json(result.body, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "CSV validation failed";
    console.error("[strategies/csv-validate] unified path threw:", message);
    return csvErrorEnvelope("CSV_UPSTREAM_FAIL", message, {}, 502);
  }
}
