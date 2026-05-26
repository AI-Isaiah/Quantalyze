"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AllocatorPreferences } from "@/lib/preferences";
import { SELF_EDITABLE_PREFERENCE_FIELDS } from "@/lib/preferences";

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
        | "cancelled";
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

  // NEW-C05-07: shared rate-limit gate across all concurrent field saves.
  // When ANY field save receives a 429, all subsequent saves for the same
  // component instance await this timestamp before attempting a fetch. This
  // prevents the N-field thundering herd (each field reads the same
  // Retry-After, sleeps identically, and retries simultaneously) from
  // re-tripping the limiter on the very next attempt.
  const rateLimitedUntilRef = useRef<number>(0);

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
  const failTerminal = useCallback(
    (fieldName: MandateField, message: string) => {
      setFieldErrors((prev) => ({ ...prev, [fieldName]: message }));
      setSaveState("error");
      removeSavingField(fieldName);
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
        // field save received a 429 and set rateLimitedUntilRef, wait until
        // that timestamp before sending this request. This prevents N concurrent
        // fields from all re-hitting the limiter on the same retry window.
        const rateLimitedUntil = rateLimitedUntilRef.current;
        if (rateLimitedUntil > Date.now()) {
          const waitMs = rateLimitedUntil - Date.now();
          await wait(waitMs, mountAbortRef.current.signal);
          if (mountAbortRef.current.signal.aborted) {
            return { ok: false, reason: "cancelled", message: "Cancelled." };
          }
          if (generationRef.current[fieldName] !== gen) {
            return { ok: false, reason: "superseded", message: "Superseded." };
          }
        }

        let res: Response;
        // NEW-C05-06: track whether this attempt was aborted by the timeout
        // (vs. component unmount) so we don't retry on mount-abort, but DO
        // retry on timeout (a transient hang is different from unmount).
        let timedOut = false;
        // Per-attempt timeout controller. Combined with the component-lifetime
        // mountAbortRef so EITHER the 12s timeout OR unmount cancels the fetch.
        const attemptController = new AbortController();
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
          // NEW-C05-06: only retry on timeout-abort; treat mount-abort as cancelled.
          if (mountAbortRef.current.signal.aborted) {
            // Component unmounted — exit silently, no setState on dead component.
            return { ok: false, reason: "cancelled", message: "Cancelled." };
          }
          // timedOut=true: per-attempt 12s timeout; !timedOut: pure network error
          // (e.g. offline). Both are transient — retry with exponential backoff.
          // mount-abort is handled above and never reaches here.
          if (attempt < MAX_ATTEMPTS) {
            await wait(1000 * Math.pow(2, attempt - 1), mountAbortRef.current.signal);
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
          // NEW-C05-01: parse Retry-After safely. The header may be an integer
          // seconds count OR an HTTP-date string. Number("Mon, 26 May…") = NaN.
          // Fall back to 5s on NaN/negative; clamp to [1, 30] so a hostile
          // server cannot pin this hook for minutes.
          const rawRetryAfter = res.headers.get("Retry-After");
          let retryAfterSec = rawRetryAfter !== null ? Number(rawRetryAfter) : NaN;
          if (!Number.isFinite(retryAfterSec) || retryAfterSec <= 0) {
            // HTTP-date or invalid value: derive seconds from the Date header
            // if available, otherwise default to 5s.
            const dateHeader = res.headers.get("Date");
            const retryDateMs = rawRetryAfter ? Date.parse(rawRetryAfter) : NaN;
            const baseDateMs = dateHeader ? Date.parse(dateHeader) : NaN;
            if (Number.isFinite(retryDateMs) && Number.isFinite(baseDateMs)) {
              retryAfterSec = Math.max(1, Math.ceil((retryDateMs - baseDateMs) / 1000));
            } else {
              retryAfterSec = 5;
            }
          }
          retryAfterSec = Math.min(Math.max(retryAfterSec, 1), 30);

          // NEW-C05-07: update the shared rate-limit gate so all concurrent
          // field saves for this component also wait out the limiter window
          // before retrying, preventing the N-field thundering herd.
          rateLimitedUntilRef.current = Math.max(
            rateLimitedUntilRef.current,
            Date.now() + retryAfterSec * 1000,
          );

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
            setSaveState("error");
          }
          // Cap a hostile/huge Retry-After so the hook can't be pinned for
          // minutes; the abort-aware wait() also resolves immediately on unmount.
          await wait(retryAfterSec * 1000, mountAbortRef.current.signal);
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
          failTerminal(fieldName, `${msg}. Try again.`);
          return { ok: false, reason, message: `${msg}. Try again.` };
        }

        // 5xx or other unexpected status — exponential backoff if attempts remain.
        if (attempt < MAX_ATTEMPTS) {
          await wait(1000 * Math.pow(2, attempt - 1), mountAbortRef.current.signal);
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

/**
 * Sleep for `ms`, resolving early (and clearing the timer) if `signal` aborts —
 * so an unmount during a backoff/retry-after sleep does not pin the coroutine
 * (and its captured state setters) alive until the timer fires. Resolves rather
 * than rejects on abort so callers' existing post-wait `signal.aborted` checks
 * handle the cancellation uniformly.
 */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => resolve();
    setTimeout(() => {
      // Normal timer-fire: detach the abort listener so it cannot accumulate on
      // the component-lifetime signal across repeated backoff sleeps ({ once:
      // true } only auto-removes it if `abort` actually fires).
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    // On abort, onAbort resolves immediately — freeing the awaiting save() so its
    // post-wait `signal.aborted` check returns — and { once: true } detaches the
    // listener. The pending timer then fires harmlessly into the settled promise.
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
