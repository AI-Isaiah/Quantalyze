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
 * ⚠️ THIS IS ADDITIVE INSTRUMENTATION, NOT A LEAK BEING PLUGGED — the seam DOES
 * capture to Sentry, and every one of those captures comes through HERE.
 *
 * ── (140.5-04) THE SENTENCE THAT USED TO SIT HERE WAS FALSE ─────────────────
 *
 * It asserted that the seam sent NOTHING to Sentry at HEAD — resting that on a
 * `captureException` / `captureMessage` grep across the resilience core, both
 * seam clients and every seam route file returning ZERO — and put the real
 * figure at ten `captureToSentry` calls confined to the two key-bearing routes.
 *
 * ⚠️ That is a PARAPHRASE, not a quotation, and the difference is load-bearing.
 * Quoting the false sentence verbatim inside its own correction would re-seed
 * the exact phrase every absence check greps for, so the check would fail on
 * CORRECTED code and an author would "fix" it by deleting the correction. Same
 * hazard as DEF-16-2, one level up: a correction's own prose is scanner input.
 *
 * ⭐ THE GREP IT CITED IS LITERALLY TRUE AND THE SENTENCE IT DEFENDED IS FALSE.
 * `captureException` / `captureMessage` really do return ZERO across the seam
 * roster — because the ONLY place those two symbols appear is inside THIS
 * function's body. The seam captures via `captureToSentry`, at sites spread
 * across EVERY seam route file, not on two of them. An author reading the
 * justification would have re-run the grep, seen zero, and shipped the false
 * claim forward. This is CONTEXT §3's purest specimen: **a grep proves a state;
 * only a guard proves the state is held**, and a grep for the wrong symbol
 * proves nothing at all.
 *
 * NO INTEGER IS WRITTEN HERE, DELIBERATELY. The old sentence's "ten" is how it
 * rotted, and the true number is not one number — it depends entirely on which
 * population you ask about. Run the one you mean (comment-strip first: this very
 * docblock contains the needle, DEF-16-2):
 *
 *   - the `EXPECTED_SEAM_FILES` roster in `src/lib/seam-log-coverage.test.ts`
 *   - its `src/app/api/**` members only
 *   - repo-wide tracked non-test `src/**`, excluding this file
 *
 * Those three answered with three different integers when this note was written,
 * and none of them was "ten". A count in prose that a script can derive is a
 * future false claim; the predicate is what belongs in a comment.
 *
 * WHY HERE AND NOT AT THE CALL SITES. Every call site remembering to scrub is
 * the "3 of 5" shape this programme has already paid for: a mechanism at the
 * chokepoint cannot be forgotten by the next caller, and Sentry is a THIRD
 * PARTY — anything captured leaves our infrastructure, so "the caller will
 * remember" is not an acceptable control.
 *
 * ⚠️ WHAT THIS DOES NOT CLOSE. This helper is the chokepoint for the SEAM, not
 * for the repo. Non-seam routes still reach `@sentry/nextjs` directly through
 * their own `import("@sentry/nextjs")` — `alert-digest/route.ts` and
 * `preferences/route.ts` both call `Sentry.captureException` without passing
 * through this scrub. Nothing structurally forbids a seam file from doing the
 * same tomorrow; that would need a guard, and this docblock is not one.
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

/**
 * Capture to Sentry, RETURNING the import chain so the caller can hold the
 * request alive until it settles.
 *
 * ── SEAMRIM-04 (Phase 140.4): NEW-C10-03, RE-CREATED HERE AND NOW FIXED ──────
 *
 * `src/lib/audit.ts`'s `reportToSentry` carries the diagnosis verbatim: the
 * prior implementation used `void import(...).then(...)`, which returns
 * SYNCHRONOUSLY — the in-flight dynamic-import promise is detached before
 * `captureException` resolves, so under `after()` on a cold finish the lambda
 * can be reaped before Sentry flushes and the alert is lost silently. That red
 * team (audit-2026-05-26) fixed `reportToSentry` by returning the chain. This
 * helper kept the defective shape until now. Two adjacent modules, one rule.
 *
 * ⚠️ SCHEDULING IS THE CALLER'S JOB, AND THAT IS A BUNDLE CONSTRAINT, NOT A
 * STYLE PREFERENCE. This module is imported by SIX `"use client"` components
 * (`ForQuantsCtas`, `ScenarioCommitDrawer`, `widget-boundary`, `EquityChart`,
 * `useMandateAutoSave`, `storage/cross-tab`), so it MUST NOT import
 * `next/server` — doing so would ship a server-only module into the browser
 * bundle. It imports exactly one module (`./seam-redaction`) and must keep that
 * property. `after()` therefore lives at the server-only call sites
 * (`resilient-fetch.ts`, `ratelimit.ts`), never here.
 *
 * SOURCE-COMPATIBLE BY DESIGN: an unused returned promise is legal, so the 100+
 * existing call sites that discard the return value are unaffected. A site that
 * needs the capture to survive a cold finish schedules it explicitly.
 */
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
): Promise<void> {
  try {
    const secrets = options.secrets ?? [];
    const payload = scrubCaptureInput(err, secrets);
    const tags = scrubRecord(options.tags, secrets) ?? {};
    const extra = scrubRecord(options.extra, secrets);
    return import("@sentry/nextjs")
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
        // Sentry import failed — swallow. RESOLVING rather than rejecting is
        // load-bearing now that the chain is returned: a floating rejection
        // would become an unhandled rejection at every call site.
      });
  } catch {
    // import() construction failed (extremely unlikely) — swallow, and still
    // hand the caller a settled promise so `after(captureToSentry(...))` and
    // `await` are total.
    return Promise.resolve();
  }
}

/**
 * 140.4-16 / WR-06 — EDGE-TRIGGER FOR THE HIGH-VOLUME CAPTURE SITES.
 *
 * ⚠️ THE PROBLEM THIS SOLVES IS AN ALERT STORM DURING THE EXACT INCIDENT THE
 * INSTRUMENTATION EXISTS TO OBSERVE. Three capture sites added by SEAMRIM-04
 * fire once per REQUEST rather than once per state TRANSITION:
 *   · `ratelimit.ts`' posture-2 arm — every request that wins the 5 s fail-open
 *     race, i.e. every request for the whole duration of an Upstash outage;
 *   · `resilient-fetch`'s `isBreakerOpen` catch — every request whose breaker
 *     probe rejects;
 *   · `recordSeamFailure`'s catch — every failure whose bookkeeping write fails.
 * All three sit on the seam's highest-volume paths, and each capture is an
 * `import("@sentry/nextjs")` + `captureException` held alive by `after()`. A
 * sustained store outage therefore burns the Sentry quota and DROPS OTHER
 * ALERTS during the same incident. `emitBreakerTransition` was already bounded
 * to open/close edges; these were not.
 *
 * WHY A TIME WINDOW AND NOT A TRUE EDGE. An "edge" needs a prior state to
 * compare against, and these three are stateless catch arms — there is nothing
 * that says "the store was healthy a moment ago". A coarse window is the honest
 * approximation: it keeps the FIRST occurrence of a burst, which is the one an
 * operator needs, and re-arms so a long incident still produces a heartbeat.
 *
 * ⚠️ THE LOG LINE MUST STAY UNCONDITIONAL AT EVERY CALL SITE. This suppresses
 * the REMOTE capture only. Dropping the local `console.warn`/`console.error`
 * too would make the Vercel trace lie about how many requests were affected,
 * which is the measurement an operator sizes the incident with.
 *
 * In-memory and per-instance by construction: serverless instances do not share
 * it, so N instances emit up to N captures per window. That is the correct
 * trade — a cross-instance store would put a network call on the failure path
 * of the thing whose network call is already failing.
 */
const CAPTURE_WINDOW_MS = 60_000;
const lastCapturedAtMs = new Map<string, number>();

export function shouldCaptureNow(
  key: string,
  now: number = Date.now(),
  windowMs: number = CAPTURE_WINDOW_MS,
): boolean {
  const last = lastCapturedAtMs.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  lastCapturedAtMs.set(key, now);
  return true;
}

/** Test-only reset. Never called from production code. */
export function __resetCaptureThrottleForTests(): void {
  lastCapturedAtMs.clear();
}
