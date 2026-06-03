"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AllocatorPreferences } from "@/lib/preferences";
import { SELF_EDITABLE_PREFERENCE_FIELDS } from "@/lib/preferences";
import { captureToSentry } from "@/lib/sentry-capture";
import { parseRetryAfterSeconds, abortableWait, RateLimitGate } from "@/lib/retry";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Union of field names an allocator may self-edit. Derived from the single
 *  source of truth in lib/preferences so a new field promotion automatically
 *  tightens the hook's type and surfaces consumer typos at compile time.
 *  H-0379 / H-0383: replaces the loose `string` parameter type. */
export type MandateField = (typeof SELF_EDITABLE_PREFERENCE_FIELDS)[number];

/** Discriminated result returned by save(). Lets callers branch on the
 *  outcome deterministically instead of subscribing to hook state.
 *  M-1115: replaces the opaque Promise<void> signature.
 *
 *  Existing callers using `void save(...)` are unaffected — the result is
 *  ignored just like Promise<void> was. */
export type SaveResult =
  | { ok: true; savedAt: Date }
  | {
      ok: false;
      reason:
        | "validation"
        | "auth"
        | "throttled"
        | "network"
        | "server"
        | "superseded"
        | "cancelled"
        // NEW-C05-06: per-attempt 12s timeout on a non-idempotent write. Unlike
        // "network" this is terminal-on-first-occurrence (NOT retried), because
        // the timed-out PUT may still commit server-side.
        | "timeout";
      message: string;
      retryAfter?: number;
    };

export interface MandateAutoSaveReturn {
  saveState: SaveState;
  /** Keyed by MandateField so consumer reads (`fieldErrors.max_weight`) are
   *  type-checked against the same key set as the write site.
   *  H-0381: replaces Record<string, string>. */
  fieldErrors: Partial<Record<MandateField, string>>;
  lastSavedAt: Date | null;
  savingFields: Set<MandateField>;
  /** M-1115: returns a SaveResult so callers can branch on the outcome.
   *  All existing `void save(...)` call sites continue to work — the result
   *  is ignored when not awaited. */
  save: <K extends MandateField>(
    fieldName: K,
    value: AllocatorPreferences[K] | null,
  ) => Promise<SaveResult>;
  clearError: (fieldName: MandateField) => void;
}

/**
 * Per-form auto-save hook for the MandateForm.
 *
 * - Each field save is a single PUT /api/preferences call with body
 *   `{ [fieldName]: value }`. A `null` value is the Reset path (D-11);
 *   the route handler transforms it into `p_clear_fields`.
 * - On success: `saveState = "saved"` for 2s (so the form-level
 *   MandateSaveStatus can flash "Mandate saved"), then reverts to "idle".
 * - On 400/401: single inline error, no retry.
 * - On 429: honor `Retry-After` header, schedule one retry.
 * - On 5xx / network: exponential backoff 1s/2s/4s, max 3 retries (4 attempts total).
 * - Generation counter per field drops stale responses so a fast second
 *   save wins over a still-in-flight first save (T-02-09 mitigation).
 * - Component-lifetime AbortController (H-0382) cancels in-flight fetches and
 *   retry-after sleeps on unmount, preventing setState-on-unmounted-component.
 */
export function useMandateAutoSave(
  initialLastSavedAt: Date | null = null,
): MandateAutoSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MandateField, string>>>({});
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(initialLastSavedAt);
  const [savingFields, setSavingFields] = useState<Set<MandateField>>(new Set());

  // NEW-C05-07: shared rate-limit gate across all concurrent field saves (B20
  // RateLimitGate primitive). When ANY field save receives a 429 it blocks the
  // gate; all subsequent saves for the same component instance wait out that
  // window before attempting a fetch. This prevents the N-field thundering herd
  // (each field reads the same Retry-After, sleeps identically, and retries
  // simultaneously) from re-tripping the limiter on the very next attempt.
  const gateRef = useRef(new RateLimitGate());

  // 2s fade-timer for "saved" -> "idle" transition (WizardChrome toast shape).
  // NEW-C05-05: gate the idle transition on savingFields.size === 0 so a
  // fast-finishing field cannot flip the form-level status to idle while
  // another field is still in-flight. The ref mirrors savingFields synchronously
  // so the setTimeout callback can read it without a stale closure.
  const savingFieldsSizeRef = useRef<number>(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveState === "saved") {
      fadeTimerRef.current = setTimeout(() => {
        // NEW-C05-05: only revert to idle when no other field is still saving.
        if (savingFieldsSizeRef.current === 0) {
          setSaveState("idle");
        }
      }, 2000);
    }
    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [saveState]);

  // Component-lifetime AbortController. Aborted on unmount so any in-flight
  // fetch (including those sleeping inside a 429 retry-after wait) is
  // cancelled before it can call setState on an unmounted component.
  // H-0382: prevents mandate state forgery / React unmount-setState warnings.
  const mountAbortRef = useRef<AbortController>(new AbortController());
  useEffect(() => {
    // Fresh controller on each mount so re-mounting starts with a live signal.
    mountAbortRef.current = new AbortController();
    return () => {
      mountAbortRef.current.abort();
    };
  }, []);

  // Per-field generation counter. Each save() bumps the counter for that
  // field; stale responses (whose generation is less than the current one)
  // are dropped before touching state. Prevents race where save(0.25)'s
  // response arrives after save(0.30)'s and overwrites the newer value.
  const generationRef = useRef<Record<string, number>>({});

  const clearError = useCallback((fieldName: MandateField) => {
    setFieldErrors((prev) => {
      if (!(fieldName in prev)) return prev;
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
  }, []);

  // Release a field from the in-flight set (no-op if absent). Every terminal
  // outcome routes through here so the per-field saving spinner can never stick.
  // NEW-C05-05: also decrements savingFieldsSizeRef so the idle-transition gate
  // (in the fade timer) sees an accurate count without a stale closure.
  const removeSavingField = useCallback((fieldName: MandateField) => {
    setSavingFields((prev) => {
      if (!prev.has(fieldName)) return prev;
      const next = new Set(prev);
      next.delete(fieldName);
      // Decrement synchronously so setTimeout in the "saved" fade-timer reads 0
      // only after the last field is actually removed.
      savingFieldsSizeRef.current = next.size;
      return next;
    });
  }, []);

  // Terminal failure for a field: surface the inline error, flip the form-level
  // banner to "error", and release the in-flight marker. Centralising the trio
  // guarantees savingFields is always cleared on a terminal outcome.
  // F-04/F-05: also capture to Sentry so that mandate save exhaustion (network,
  // 5xx, or 429 budget) is observable in production — without this, a systemic
  // route regression exhausts all retries with zero signal to engineers.
  // M-2 (red-team): accept an optional sentryLevel override so expected client
  // errors (400 validation, 401 auth) are captured as "warning" rather than
  // "error" — preventing these routine user-side events from polluting the Sentry
  // error budget and masking genuine server failures.
  const failTerminal = useCallback(
    (
      fieldName: MandateField,
      message: string,
      originalError?: unknown,
      sentryLevel?: "error" | "warning",
    ) => {
      setFieldErrors((prev) => ({ ...prev, [fieldName]: message }));
      // H-0380: never let one field's terminal failure clobber a concurrent
      // fresher "saved" banner from a different field. The per-field error is
      // still written above (unconditional), so no error is hidden — only the
      // shared form-level banner is protected during the 2s "saved" flash.
      setSaveState((prev) => (prev === "saved" ? "saved" : "error"));
      removeSavingField(fieldName);
      captureToSentry(
        originalError ?? new Error(`Mandate autosave terminal failure: ${fieldName}`),
        {
          tags: { hook: "useMandateAutoSave", field: fieldName },
          extra: { message },
          level: sentryLevel ?? "error",
        },
      );
    },
    [removeSavingField],
  );

  const save = useCallback(
    async <K extends MandateField>(
      fieldName: K,
      value: AllocatorPreferences[K] | null,
    ): Promise<SaveResult> => {
      const gen = (generationRef.current[fieldName] ?? 0) + 1;
      generationRef.current[fieldName] = gen;

      setSaveState("saving");
      setSavingFields((prev) => {
        const next = new Set(prev);
        next.add(fieldName);
        // NEW-C05-05: keep ref in sync so the "saved" fade-timer gate sees the
        // correct count synchronously without a stale closure.
        savingFieldsSizeRef.current = next.size;
        return next;
      });
      clearError(fieldName);

      let attempt = 0;
      const MAX_ATTEMPTS = 4; // 1 initial + 3 retries (1s, 2s, 4s backoff)
      const FETCH_TIMEOUT_MS = 12_000;
      while (attempt < MAX_ATTEMPTS) {
        attempt += 1;

        // If the component already unmounted (e.g. during a prior backoff
        // sleep), short-circuit before issuing another fetch. A listener added
        // to an ALREADY-aborted signal never fires (WHATWG), so onMountAbort
        // below would not abort this attempt and the PUT would escape post-
        // unmount as an unintended write. Guard synchronously here.
        if (mountAbortRef.current.signal.aborted) {
          return { ok: false, reason: "cancelled", message: "Cancelled." };
        }

        // NEW-C05-07: honor the shared rate-limit gate. If another concurrent
        // field save received a 429 and blocked the gate, wait out that window
        // before sending this request. This prevents N concurrent fields from
        // all re-hitting the limiter on the same retry window.
        // IMP-2: snapshot Date.now() once so the guard and the sleep duration use
        // the same instant — a second Date.now() under heavy load could yield a
        // near-zero/negative wait (benign, but misleading about what fired).
        const nowBeforeRateWait = Date.now();
        const gateWaitMs = gateRef.current.remainingMs(nowBeforeRateWait);
        if (gateWaitMs > 0) {
          await abortableWait(gateWaitMs, mountAbortRef.current.signal);
          if (mountAbortRef.current.signal.aborted) {
            return { ok: false, reason: "cancelled", message: "Cancelled." };
          }
          if (generationRef.current[fieldName] !== gen) {
            return { ok: false, reason: "superseded", message: "Superseded." };
          }
        }

        let res: Response;
        // Per-attempt timeout controller. Combined with the component-lifetime
        // mountAbortRef so EITHER the 12s timeout OR unmount cancels the fetch.
        // IMP-1: the previous `timedOut` flag was set inside the setTimeout
        // callback but never read in the catch block — both the timeout-abort
        // and pure-network-error paths fell through identically to the same
        // retry logic, so the variable was dead discriminator code. Removed to
        // eliminate the misleading "intent to branch" signal.
        const attemptController = new AbortController();
        // NEW-C05-06: flag a 12s TIMEOUT abort so the catch can tell it apart
        // from a pure network error / mount-abort. A timeout means the PUT may
        // still be in-flight on the server, so the non-idempotent write must
        // NOT be retried (the retry is the amplification path the finding flags).
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          attemptController.abort();
        }, FETCH_TIMEOUT_MS);
        // Wire mount-abort into this attempt signal.
        const onMountAbort = () => attemptController.abort();
        mountAbortRef.current.signal.addEventListener("abort", onMountAbort, { once: true });
        try {
          res = await fetch("/api/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [fieldName]: value }),
            credentials: "same-origin",
            signal: attemptController.signal,
          });
        } catch {
          // Network error or AbortError (12s timeout OR component unmounted).
          // mount-abort means the component is gone — exit silently; timeout or
          // pure network error is transient and should retry.
          if (mountAbortRef.current.signal.aborted) {
            // Component unmounted — exit silently, no setState on dead component.
            return { ok: false, reason: "cancelled", message: "Cancelled." };
          }
          // NEW-C05-06: a per-attempt 12s TIMEOUT aborts only the client wait,
          // not the server write. update_allocator_mandates is non-idempotent
          // (it stamps mandate_edited_at = now() and overwrites compliance
          // fields), so a timed-out attempt-1 can still COMMIT after a retry
          // (attempt-2) carrying a newer value lands — silently overwriting the
          // newer value while generationRef hides the divergence in the UI.
          // Do NOT retry on timeout: fail terminally so the allocator re-confirms
          // against the current persisted value. (Pure network errors below —
          // request never reached the server — remain safe to retry.)
          if (timedOut) {
            if (generationRef.current[fieldName] === gen) {
              failTerminal(fieldName, "Save timed out — please re-confirm.");
            }
            return {
              ok: false,
              reason: "timeout",
              message: "Save timed out — please re-confirm.",
            };
          }
          // Pure network error (e.g. offline) — request did not reach the
          // server, so retry with exponential backoff is safe.
          // mount-abort + timeout are handled above and never reach here.
          if (attempt < MAX_ATTEMPTS) {
            await abortableWait(1000 * Math.pow(2, attempt - 1), mountAbortRef.current.signal);
            if (mountAbortRef.current.signal.aborted) {
              return { ok: false, reason: "cancelled", message: "Cancelled." };
            }
            if (generationRef.current[fieldName] !== gen) {
              return { ok: false, reason: "superseded", message: "Superseded." };
            }
            continue;
          }
          if (generationRef.current[fieldName] === gen) {
            failTerminal(fieldName, "Couldn't save.");
          }
          return { ok: false, reason: "network", message: "Couldn't save." };
        } finally {
          clearTimeout(timeout);
          mountAbortRef.current.signal.removeEventListener("abort", onMountAbort);
        }

        // Drop stale response for an older generation of this field. We do NOT
        // release savingFields here: a newer save() bumped the generation and
        // now owns the in-flight marker, so it will clear it on its own terminal
        // outcome. Clearing here would wrongly hide the newer save's spinner.
        if (generationRef.current[fieldName] !== gen) {
          return { ok: false, reason: "superseded", message: "Superseded." };
        }

        if (res.ok) {
          const savedAt = new Date();
          setLastSavedAt(savedAt);
          setSaveState("saved");
          removeSavingField(fieldName);
          clearError(fieldName); // WR-01: clear any stale 429-retry error on retried success
          return { ok: true, savedAt };
        }

        if (res.status === 429) {
          // NEW-C05-01 (B20): parse Retry-After through the shared primitive,
          // which handles both RFC 9110 forms (delta-seconds + HTTP-date, the
          // latter resolved against the response's Date header) and NEVER returns
          // NaN/0/negative. Default to 5s when unparseable; clamp to [1, 30] so a
          // hostile server cannot pin this hook for minutes.
          const retryAfterSec = Math.min(
            Math.max(parseRetryAfterSeconds(res.headers) ?? 5, 1),
            30,
          );

          // NEW-C05-07: block the shared rate-limit gate so all concurrent field
          // saves for this component also wait out the limiter window before
          // retrying, preventing the N-field thundering herd.
          gateRef.current.blockUntil(Date.now() + retryAfterSec * 1000);

          // Budget exhausted: terminate cleanly. Falling through the loop would
          // leave the field pinned in savingFields and a message falsely
          // promising a retry that will never run.
          if (attempt >= MAX_ATTEMPTS) {
            if (generationRef.current[fieldName] === gen) {
              failTerminal(
                fieldName,
                "Saving too fast. Please wait a moment and try again.",
              );
            }
            return {
              ok: false,
              reason: "throttled",
              message: "Saving too fast. Please wait a moment and try again.",
              retryAfter: retryAfterSec,
            };
          }
          // NEW-C05-03: only write the transient retry-error to state when we
          // are still the active generation for this field. A concurrent save()
          // that bumped the generation already owns the field's UI state; writing
          // here would clobber the newer save's message and leave a stale error
          // visible after the newer save succeeds.
          if (generationRef.current[fieldName] === gen) {
            setFieldErrors((prev) => ({
              ...prev,
              [fieldName]: `Saving too fast. Will retry in ${retryAfterSec}s.`,
            }));
            // H-0380: same banner-clobber guard as failTerminal — a transient
            // 429 retry on field A must not overwrite field B's fresher "saved".
            setSaveState((prev) => (prev === "saved" ? "saved" : "error"));
          }
          // Cap a hostile/huge Retry-After so the hook can't be pinned for
          // minutes; abortableWait() also resolves immediately on unmount.
          await abortableWait(retryAfterSec * 1000, mountAbortRef.current.signal);
          if (mountAbortRef.current.signal.aborted) {
            return { ok: false, reason: "cancelled", message: "Cancelled." };
          }
          if (generationRef.current[fieldName] !== gen) {
            return { ok: false, reason: "superseded", message: "Superseded." };
          }
          continue;
        }

        if (res.status === 400 || res.status === 401) {
          const body = await res.json().catch(() => ({}));
          // A concurrent save() may have bumped the generation while we awaited
          // res.json(); if so this response is stale — don't paint an error over
          // (or clear the spinner of) the newer in-flight save. The 429/5xx
          // paths re-check post-await too; this path must as well.
          if (generationRef.current[fieldName] !== gen) {
            return { ok: false, reason: "superseded", message: "Superseded." };
          }
          const msg = (body?.error as string | undefined) ?? "Couldn't save";
          const reason = res.status === 401 ? "auth" : "validation";
          // M-2 (red-team): 400 (validation) and 401 (session-expired) are
          // expected client-side outcomes — capture as "warning" not "error" so
          // they don't inflate the Sentry error budget or mask genuine failures.
          failTerminal(fieldName, `${msg}. Try again.`, undefined, "warning");
          return { ok: false, reason, message: `${msg}. Try again.` };
        }

        // 5xx or other unexpected status — exponential backoff if attempts remain.
        if (attempt < MAX_ATTEMPTS) {
          await abortableWait(1000 * Math.pow(2, attempt - 1), mountAbortRef.current.signal);
          if (mountAbortRef.current.signal.aborted) {
            return { ok: false, reason: "cancelled", message: "Cancelled." };
          }
          if (generationRef.current[fieldName] !== gen) {
            return { ok: false, reason: "superseded", message: "Superseded." };
          }
          continue;
        }

        if (generationRef.current[fieldName] === gen) {
          failTerminal(fieldName, "Couldn't save.");
        }
        return { ok: false, reason: "server", message: "Couldn't save." };
      }
      // TypeScript needs an explicit return; the loop always returns above.
      return { ok: false, reason: "server", message: "Couldn't save." };
    },
    [clearError, failTerminal, removeSavingField],
  );

  return { saveState, fieldErrors, lastSavedAt, savingFields, save, clearError };
}
