import { scrubSeamError, scrubSeamString } from "./seam-redaction";

/**
 * Lazy Sentry capture helper.
 *
 * The dynamic `import("@sentry/nextjs")` keeps Sentry out of bundles
 * (notably middleware) that don't otherwise need it. The dual try/catch
 * skeleton prevents a Sentry-transport failure from masking the caller's
 * own logging — both `console.error` (caller's responsibility) and this
 * Sentry path are best-effort observability; either failing in isolation
 * must not break the caller's response.
 *
 * Consolidates the lazy-Sentry pattern previously copied across:
 *   - src/lib/admin.ts (reportNonRlsError)
 *   - src/lib/audit.ts (reportToSentry — module-private)
 *   - src/lib/api/withAllocatorAuth.ts (reportProfileGateError)
 *   - src/app/api/allocator/scenario/commit/route.ts (reportEnvelopeError + stamp-failure)
 *
 * Each call site now passes its own `tags` / `extra` / `level` and a single
 * helper handles the import lifecycle.
 *
 * ── SEAMCORE-06 (Phase 140.2): scrubbing is folded in HERE ──────────────────
 *
 * ⚠️ THIS IS ADDITIVE INSTRUMENTATION, NOT A LEAK BEING PLUGGED. The seam
 * captures nothing to Sentry at HEAD — a `captureException` / `captureMessage`
 * grep across the resilience core, both seam clients and every seam route file
 * returns ZERO. What exists is ten `captureToSentry` calls on the two
 * key-bearing routes, and this is where they become safe.
 *
 * WHY HERE AND NOT AT THE CALL SITES. Ten sites each remembering to scrub is
 * the "3 of 5" shape this programme has already paid for: a mechanism at the
 * chokepoint cannot be forgotten by an eleventh caller, and Sentry is a THIRD
 * PARTY — anything captured leaves our infrastructure, so "the caller will
 * remember" is not an acceptable control.
 *
 * WHAT IS DISPATCHED. An `Error` is rebuilt with a scrubbed `name`, `message`
 * and `stack`, and its `cause` chain is FOLDED INTO the scrubbed message rather
 * than re-attached — attaching the original object would hand Sentry the very
 * bytes this function exists to remove. Anything else is rendered to a scrubbed
 * string. `extra` and `tags` string values are scrubbed too, because a call site
 * can legitimately put an upstream detail in `extra`.
 *
 * WHAT MUST NOT REGRESS. The scrub runs in its OWN try/catch with a fail-safe
 * fallback: a scrubbing failure must neither throw into the caller's catch block
 * nor cancel the capture (that would silently remove an alert), so it degrades
 * to a placeholder error that carries no original content at all.
 */

/** How deep `extra` is walked when scrubbing string values. */
const MAX_EXTRA_DEPTH = 4;

/**
 * Rebuild a thrown value with every known secret removed.
 *
 * Returns an `Error` for an `Error` input, so Sentry's grouping and stack
 * rendering are unchanged; a string for everything else, which is what Sentry
 * does with a non-Error anyway.
 */
function scrubCaptureInput(err: unknown, secrets: readonly unknown[]): unknown {
  try {
    if (err instanceof Error) {
      let message = scrubSeamString(err.message ?? "", secrets);
      const cause = (err as { cause?: unknown }).cause;
      if (cause !== undefined && cause !== null) {
        // FOLDED IN, never re-attached. `scrubSeamError` renders the whole chain
        // and scrubs it; handing Sentry the original `cause` object would ship
        // the unscrubbed message this function was called to remove.
        message += ` [cause: ${scrubSeamError(cause, secrets)}]`;
      }
      const rebuilt = new Error(message);
      rebuilt.name = scrubSeamString(err.name ?? "Error", secrets);
      if (typeof err.stack === "string") {
        rebuilt.stack = scrubSeamString(err.stack, secrets);
      }
      return rebuilt;
    }
    return scrubSeamError(err, secrets);
  } catch {
    // Fail SAFE, and still capture: an alert that never fires is a worse outcome
    // than an alert with no detail, and shipping the original would defeat the
    // whole function.
    return new Error(
      "[sentry-capture] scrubbing failed — the original error was withheld " +
        "rather than dispatched unscrubbed",
    );
  }
}

/** Scrub string values inside a caller-supplied payload, depth-capped. */
function scrubValue(
  value: unknown,
  secrets: readonly unknown[],
  depth: number,
): unknown {
  if (depth > MAX_EXTRA_DEPTH) return value;
  if (typeof value === "string") return scrubSeamString(value, secrets);
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, secrets, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = scrubValue(entry, secrets, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubRecord<T extends Record<string, unknown>>(
  record: T | undefined,
  secrets: readonly unknown[],
): T | undefined {
  if (!record) return record;
  try {
    return scrubValue(record, secrets, 0) as T;
  } catch {
    // A hostile getter in `extra` must not cost the capture. Drop the payload
    // rather than dispatch it unscrubbed.
    return undefined;
  }
}

export function captureToSentry(
  err: unknown,
  options: {
    tags: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: "fatal" | "error" | "warning" | "info";
    /**
     * PER-REQUEST secret values to redact in addition to the env-secret list —
     * a live user JWT, a raw exchange `api_key` / `api_secret` / `passphrase`.
     * No module-level list can know these; the call site that holds them is the
     * only place they can be named.
     */
    secrets?: readonly unknown[];
  },
): void {
  try {
    const secrets = options.secrets ?? [];
    const payload = scrubCaptureInput(err, secrets);
    const tags = scrubRecord(options.tags, secrets) ?? {};
    const extra = scrubRecord(options.extra, secrets);
    void import("@sentry/nextjs")
      .then((Sentry) => {
        try {
          Sentry.captureException(payload, {
            tags,
            extra,
            level: options.level ?? "error",
          });
        } catch {
          // Swallow — caller already logged via console.error / warn.
        }
      })
      .catch(() => {
        // Sentry import failed — swallow.
      });
  } catch {
    // import() construction failed (extremely unlikely) — swallow.
  }
}
