import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { validateCsv } from "@/lib/analytics-client";
import { withAuth } from "@/lib/api/withAuth";
import { csvValidateLimiter, checkLimit } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";

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
 * Error envelope shape (v0): { ok: false, code, human_message,
 * debug_context, correlation_id: null }. Phase 16 / OBSERV-06 will
 * thread real correlation_id values through this route without
 * breaking the contract.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(
    csvValidateLimiter,
    `strategies-csv-validate:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_RATE_LIMIT",
        human_message: "Too many requests. Wait a minute and try again.",
        debug_context: {},
        correlation_id: null,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

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
      return NextResponse.json(
        {
          ok: false,
          code: "CSV_FILE_TOO_LARGE",
          human_message: `Maximum file size is 10 MB. Your upload is ${(contentLength / 1024 / 1024).toFixed(1)} MB.`,
          debug_context: { content_length: contentLength },
          correlation_id: null,
        },
        { status: 400 },
      );
    }
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "Invalid multipart body.",
        debug_context: {},
        correlation_id: null,
      },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "Missing file field.",
        debug_context: {},
        correlation_id: null,
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_FILE_TOO_LARGE",
        human_message: `Maximum file size is 10 MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
        debug_context: { size_bytes: file.size },
        correlation_id: null,
      },
      { status: 400 },
    );
  }

  const fmt = formData.get("fmt");
  if (
    typeof fmt !== "string" ||
    !["daily_returns", "daily_nav", "trades"].includes(fmt)
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "fmt must be one of daily_returns, daily_nav, trades.",
        debug_context: {
          fmt_received: typeof fmt === "string" ? fmt : "(missing)",
        },
        correlation_id: null,
      },
      { status: 400 },
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
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "wizard_session_id must be a valid UUID.",
        debug_context: {},
        correlation_id: null,
      },
      { status: 400 },
    );
  }

  try {
    const result = await validateCsv(formData);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CSV validation failed";
    console.error("[strategies/csv-validate] threw:", message);
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_UPSTREAM_FAIL",
        human_message: message,
        debug_context: {},
        correlation_id: null,
      },
      { status: 502 },
    );
  }
});
