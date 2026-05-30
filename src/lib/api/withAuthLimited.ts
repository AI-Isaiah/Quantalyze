import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import type { Ratelimit } from "@upstash/ratelimit";
import { withAuth } from "@/lib/api/withAuth";
import {
  checkLimit,
  rateLimitDenyJson,
  type CheckLimitResult,
} from "@/lib/ratelimit";

/**
 * B15 (audit-2026-05-07) — canonical-order wrapper for authenticated,
 * rate-limited routes.
 *
 * The class this closes: a route that consumes a rate-limit token BEFORE
 * validating the request body, so a malformed/invalid request burns one of
 * the caller's own tokens and *then* gets a 400. For per-user limiters the
 * bucket is the caller's own scarce resource (e.g. userActionLimiter 5/min
 * shared across attestation + deletion + key-create), so a buggy client that
 * retries on 400 — or a double-submit — can 429 the user's next *legitimate*
 * action. This is the same bug the `preferences` PUT route already fixed
 * inline (NEW-C07-04: "limiter moved AFTER validate so only RPC-bound
 * requests consume a token"); `withAuthLimited` makes that ordering
 * unrepresentable for any route that adopts it.
 *
 * Canonical order, enforced by construction:
 *
 *   CSRF + auth + approval-gate  (delegated to withAuth)
 *     -> body read (+ optional byte cap)
 *     -> schema validation (400 on failure — NO token consumed)
 *     -> rate-limit consume (429 throttle / 503 misconfig)
 *     -> handler(req, user, validatedBody)
 *
 * Scope note: this wrapper is for authenticated POST/PUT/PATCH routes whose
 * limiter is keyed by the caller (`key(user)`). It deliberately does NOT
 * cover the public/per-IP scrape surfaces (factsheet/portfolio PDF,
 * for-quants-lead, verify-strategy, alerts/ack, demo/*) where limit-FIRST is
 * the intended abuse defense — see the `B15 limit-first:` sanctioned-exception
 * markers on those routes and `limiter-ordering.test.ts`.
 *
 * Because it composes `withAuth`, every adopting route also gets the
 * approval gate (opt out via `requireApproval: false`) and the fail-CLOSED
 * 503 misconfig path (via the default `rateLimitDenyJson` deny builder) for
 * free — several hand-rolled routes lacked the 503 split.
 */

type RateLimitDenial = Extract<CheckLimitResult, { success: false }>;

interface WithAuthLimitedOptions<T> {
  /** Limiter consumed AFTER validation succeeds. May be null (dev/preview). */
  limiter: Ratelimit | null;
  /** Per-request bucket key derived from the authenticated user. */
  key: (user: User) => string;
  /**
   * Zod schema for the JSON body. When supplied, the body is read + validated
   * BEFORE the limiter, and the typed result is passed to the handler. Omit
   * only for routes with no request body (the handler then receives
   * `undefined` and the limiter fires immediately after auth — acceptable
   * because there is no input that could fail validation).
   */
  schema?: ZodType<T>;
  /** Forwarded to withAuth. Defaults to true (approval gate enforced). */
  requireApproval?: boolean;
  /**
   * Hard cap on the raw request-body size in bytes. Checked on the
   * Content-Length header AND the buffered text length BEFORE JSON.parse, so
   * an oversized payload is rejected 413 without buffering unbounded input or
   * consuming a token.
   */
  maxBytes?: number;
  /**
   * Rate-limit deny-response builder (429 throttle / 503 misconfig). Defaults
   * to rateLimitDenyJson; PDF/text routes would pass rateLimitDenyText.
   */
  deny?: (rl: RateLimitDenial) => NextResponse;
}

type AuthLimitedHandler<T> = (
  req: NextRequest,
  user: User,
  body: T,
) => Promise<NextResponse>;

type ReadResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

/**
 * Read + size-bound a JSON request body. An empty body is treated as `{}` so
 * schemas with all-optional fields accept a bodyless POST; a non-empty body
 * that is not valid JSON returns 400 without throwing into the handler.
 */
async function readJsonBounded(
  req: NextRequest,
  maxBytes: number | undefined,
): Promise<ReadResult> {
  if (maxBytes !== undefined) {
    const declared = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Request body too large" },
          { status: 413 },
        ),
      };
    }
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      ),
    };
  }
  // Buffer.byteLength (UTF-8 bytes), not text.length (UTF-16 code units), so a
  // multibyte payload is measured accurately against a byte cap.
  if (maxBytes !== undefined && Buffer.byteLength(text, "utf8") > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body too large" },
        { status: 413 },
      ),
    };
  }
  if (text.length === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}

export function withAuthLimited<T = undefined>(
  options: WithAuthLimitedOptions<T>,
  handler: AuthLimitedHandler<T>,
) {
  // requireApproval defaults to TRUE here, NOT just in withAuth. withAuth
  // merges via `{ ...DEFAULT_OPTIONS, ...options }`, and object-spread copies an
  // explicit `undefined`, so forwarding `{ requireApproval: undefined }` would
  // OVERRIDE withAuth's `true` default and silently disable the approval gate.
  // Defaulting to true here keeps the gate on unless a caller opts out.
  const {
    limiter,
    key,
    schema,
    requireApproval = true,
    maxBytes,
    deny = rateLimitDenyJson,
  } = options;

  return withAuth(
    async (req: NextRequest, user: User): Promise<NextResponse> => {
      // 1. INPUT VALIDATION — runs BEFORE the limiter so an invalid request
      //    never consumes a token (the canonical auth -> validate -> limit
      //    order this wrapper exists to guarantee).
      let body = undefined as T;
      if (schema) {
        const read = await readJsonBounded(req, maxBytes);
        if (!read.ok) return read.response;
        const parsed = schema.safeParse(read.value);
        if (!parsed.success) {
          return NextResponse.json(
            { error: "Invalid request body", issues: parsed.error.issues },
            { status: 400 },
          );
        }
        body = parsed.data;
      }

      // 2. RATE LIMIT — only well-formed requests reach here.
      const rl = await checkLimit(limiter, key(user));
      if (!rl.success) return deny(rl);

      // 3. HANDLER — receives the validated, typed body.
      return handler(req, user, body);
    },
    { requireApproval },
  );
}
