import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { logAuditEvent } from "@/lib/audit";
import { getCorrelationId } from "@/lib/correlation-id";
import { checkDebugKeyFlowRateLimit } from "./rate-limit";
import { exchangeEnum } from "@/lib/closed-sets";

// Phase 16 / OBSERV-07 — admin-gated diagnostic SSE endpoint.
// runtime=nodejs (NOT edge — Pitfall 2; Vercel knowledge-update 2026-02-27).
// maxDuration=300 — Vercel Pro default, pinned for clarity. Each per-step fetch
// is wrapped in AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]) so
// one hung broker cannot consume the entire 300s budget.
// 15s heartbeat keeps the stream alive through proxy idle-timeout windows
// (Vercel + Cloudflare default to 100s; some corporate proxies are tighter).
//
// Audit row is inserted BEFORE the ReadableStream's start() callback (Pattern E +
// Pattern F: fire-and-forget, never awaited) so the forensic record survives
// even if the stream aborts mid-flight. cancel() emits a SECOND audit row with
// status='client_aborted' so the lifecycle is closed-loop.
//
// "debug_key_flow.invoke" / "debug_session" — see src/lib/audit.ts (Phase 16
// section) for the AuditAction + AuditEntityType union extensions.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const PER_STEP_TIMEOUT_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

const REQUEST_SCHEMA = z.object({
  // B8: the user-allowlist exchange set, single-sourced.
  broker: exchangeEnum,
});

interface SseEventBase {
  step: string;
  correlation_id: string;
  started_at: string;
}
interface SseStepEvent extends SseEventBase {
  status: "started" | "ok" | "error";
  duration_ms?: number;
  error?: { code: string; human_message: string };
}
interface SseDoneEvent {
  step: "done";
  envelope: unknown;
}

const encoder = new TextEncoder();
function frame(event: SseStepEvent | SseDoneEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
const HEARTBEAT_FRAME = encoder.encode(`: keepalive\n\n`); // SSE comment; clients ignore

export async function POST(req: NextRequest) {
  // CSRF defense (Pattern G — apply to mutating routes; webhook receivers excluded).
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // Admin gate (403, NOT 404 — Security Domain L1184 — endpoint enumeration yields no signal).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Body validation (Pattern H).
  const rawBody = await req.json().catch(() => null);
  const parsed = REQUEST_SCHEMA.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { broker } = parsed.data;

  // Rate limit (best-effort 5/hour/admin/instance — see rate-limit.ts top-of-file LIMITATIONS).
  const limit = checkDebugKeyFlowRateLimit(user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retry_after_seconds: limit.retry_after_seconds,
      },
      { status: 429 },
    );
  }

  const correlationId = await getCorrelationId();
  // entity_id must be a UUID (migration 049 declares p_entity_id uuid). Inbound
  // X-Correlation-Id is attacker-controllable on the wire, so we mint a fresh
  // sessionId for the audit anchor and stash the inbound cid in metadata. This
  // guarantees the audit row lands regardless of header shape.
  const sessionId = randomUUID();

  // Audit BEFORE the work — Pattern E + Pattern F (fire-and-forget, never await,
  // never block the request on audit failure). Guarantees a forensic row even if
  // the stream aborts mid-flight.
  logAuditEvent(supabase, {
    action: "debug_key_flow.invoke",
    entity_type: "debug_session",
    entity_id: sessionId,
    metadata: {
      broker,
      admin_user_id: user.id,
      correlation_id: correlationId,
      rate_limit_remaining: limit.remaining,
    },
  });

  const internalToken = process.env.INTERNAL_API_TOKEN;
  const analyticsUrl =
    process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
  if (!internalToken) {
    return NextResponse.json(
      { error: "INTERNAL_API_TOKEN not configured" },
      { status: 503 },
    );
  }

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Heartbeat: keep the stream alive through proxy idle timeouts.
      // SSE comment (`:` prefix) — client EventSource ignores by spec.
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(HEARTBEAT_FRAME);
        } catch {
          // Stream already closed — interval will be cleared in cancel/finally.
        }
      }, HEARTBEAT_INTERVAL_MS);

      const finalEnvelope: {
        ok: boolean;
        code: string;
        human_message: string;
        debug_context: string[];
        correlation_id: string;
        recoverable: boolean;
      } = {
        ok: true,
        code: "ok",
        human_message: `${broker} diagnostic completed`,
        debug_context: [],
        correlation_id: correlationId,
        recoverable: false,
      };

      const STEPS = ["validate", "encrypt", "fetch-trades"] as const;
      try {
        for (const step of STEPS) {
          controller.enqueue(
            frame({
              step: step.replace("-", "_"),
              status: "started",
              correlation_id: correlationId,
              started_at: new Date().toISOString(),
            }),
          );
          const t0 = Date.now();
          let upstream: Response;
          // Per-step timeout: 60s budget per broker hop. AbortSignal.any
          // composes the client-disconnect signal with a hard timeout so one
          // hung broker cannot burn the entire 300s maxDuration.
          const stepSignal = AbortSignal.any([
            req.signal,
            AbortSignal.timeout(PER_STEP_TIMEOUT_MS),
          ]);
          try {
            upstream = await fetch(
              `${analyticsUrl}/internal/debug-key-flow/${step}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-internal-token": internalToken,
                  "x-correlation-id": correlationId,
                },
                body: JSON.stringify({ broker }),
                signal: stepSignal,
              },
            );
          } catch (fetchErr) {
            const isTimeout =
              fetchErr instanceof Error && fetchErr.name === "TimeoutError";
            controller.enqueue(
              frame({
                step: step.replace("-", "_"),
                status: "error",
                correlation_id: correlationId,
                started_at: new Date(t0).toISOString(),
                duration_ms: Date.now() - t0,
                error: {
                  code: isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE",
                  human_message: String(fetchErr),
                },
              }),
            );
            finalEnvelope.ok = false;
            finalEnvelope.code = isTimeout
              ? "UPSTREAM_TIMEOUT"
              : "UPSTREAM_UNREACHABLE";
            finalEnvelope.human_message = isTimeout
              ? `Step ${step} timed out after ${PER_STEP_TIMEOUT_MS}ms`
              : "Could not reach analytics service";
            finalEnvelope.debug_context.push(
              `step=${step} ${isTimeout ? "timeout" : "unreachable"}: ${String(fetchErr)}`,
            );
            break;
          }
          // Malformed JSON from a 200-status upstream is a contract violation,
          // NOT success — surface as UPSTREAM_INVALID_JSON instead of silently
          // green-lighting a stream operators can't trust (WR-02).
          let json: { status?: string; error?: { code?: string; human_message?: string } };
          try {
            json = (await upstream.json()) as typeof json;
          } catch {
            controller.enqueue(
              frame({
                step: step.replace("-", "_"),
                status: "error",
                correlation_id: correlationId,
                started_at: new Date(t0).toISOString(),
                duration_ms: Date.now() - t0,
                error: {
                  code: "UPSTREAM_INVALID_JSON",
                  human_message: "Upstream returned non-JSON body",
                },
              }),
            );
            finalEnvelope.ok = false;
            finalEnvelope.code = "UPSTREAM_INVALID_JSON";
            finalEnvelope.human_message =
              "Analytics service returned an unparseable response";
            finalEnvelope.debug_context.push(
              `step=${step} invalid_json: HTTP ${upstream.status}`,
            );
            break;
          }
          const ok = upstream.ok && json?.status !== "error";
          controller.enqueue(
            frame({
              step: step.replace("-", "_"),
              status: ok ? "ok" : "error",
              correlation_id: correlationId,
              started_at: new Date(t0).toISOString(),
              duration_ms: Date.now() - t0,
              // Per-field coalesce: upstream `json?.error` is shaped
              // `{code?: string; human_message?: string}` (both optional)
              // because the analytics-service envelope can omit them; the
              // outbound `frame()` contract requires both fields. Read
              // each slot defensively so the SSE consumer always gets a
              // complete `{code, human_message}` pair when ok=false.
              error: ok
                ? undefined
                : {
                    code: json?.error?.code ?? "UPSTREAM_NON_OK",
                    human_message:
                      json?.error?.human_message ?? `HTTP ${upstream.status}`,
                  },
            }),
          );
          if (!ok) {
            finalEnvelope.ok = false;
            finalEnvelope.code = json?.error?.code ?? "UPSTREAM_NON_OK";
            finalEnvelope.human_message =
              json?.error?.human_message ?? `HTTP ${upstream.status}`;
            finalEnvelope.debug_context.push(
              `step=${step} failed: ${finalEnvelope.human_message}`,
            );
            break;
          }
        }
        controller.enqueue(frame({ step: "done", envelope: finalEnvelope }));
      } catch (err) {
        controller.enqueue(
          frame({
            step: "stream_error",
            status: "error",
            correlation_id: correlationId,
            started_at: new Date().toISOString(),
            error: {
              code: "STREAM_ABORTED",
              human_message: String(err),
            },
          }),
        );
      } finally {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — stop emitting heartbeats AND best-effort
      // emit an audit-log update with status='client_aborted' so the
      // initial audit row's lifecycle is closed-loop in Sentry / audit_log.
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      try {
        // Fire-and-forget; do NOT block cancel() on the audit write.
        // entity_id MUST be the synthetic sessionId UUID (declared above) —
        // migration 049 declares p_entity_id uuid. The inbound `correlationId`
        // can be a non-UUID string (WR-03 attacker-controllable header), and
        // the initial audit row at L109 already mints + uses sessionId for
        // exactly this reason. The cancel-path row must join the same anchor.
        logAuditEvent(supabase, {
          action: "debug_key_flow.invoke",
          entity_type: "debug_session",
          entity_id: sessionId,
          metadata: {
            broker,
            admin_user_id: user.id,
            correlation_id: correlationId,
            status: "client_aborted",
          },
        });
      } catch {
        // Audit failure during cancel is acceptable — initial row already exists.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Pitfall 8 — disable Vercel proxy buffering
    },
  });
}
