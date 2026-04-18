"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface MandateAutoSaveReturn {
  saveState: SaveState;
  fieldErrors: Record<string, string>;
  lastSavedAt: Date | null;
  savingFields: Set<string>;
  save: (fieldName: string, value: unknown) => Promise<void>;
  clearError: (fieldName: string) => void;
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
 */
export function useMandateAutoSave(
  initialLastSavedAt: Date | null = null,
): MandateAutoSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(initialLastSavedAt);
  const [savingFields, setSavingFields] = useState<Set<string>>(new Set());

  // 2s fade-timer for "saved" -> "idle" transition (WizardChrome toast shape).
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveState === "saved") {
      fadeTimerRef.current = setTimeout(() => setSaveState("idle"), 2000);
    }
    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [saveState]);

  // Per-field generation counter. Each save() bumps the counter for that
  // field; stale responses (whose generation is less than the current one)
  // are dropped before touching state. Prevents race where save(0.25)'s
  // response arrives after save(0.30)'s and overwrites the newer value.
  const generationRef = useRef<Record<string, number>>({});

  const clearError = useCallback((fieldName: string) => {
    setFieldErrors((prev) => {
      if (!(fieldName in prev)) return prev;
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
  }, []);

  const save = useCallback(
    async (fieldName: string, value: unknown): Promise<void> => {
      const gen = (generationRef.current[fieldName] ?? 0) + 1;
      generationRef.current[fieldName] = gen;

      setSaveState("saving");
      setSavingFields((prev) => {
        const next = new Set(prev);
        next.add(fieldName);
        return next;
      });
      clearError(fieldName);

      let attempt = 0;
      const MAX_ATTEMPTS = 4; // 1 initial + 3 retries (1s, 2s, 4s backoff)
      const FETCH_TIMEOUT_MS = 12_000;
      while (attempt < MAX_ATTEMPTS) {
        attempt += 1;

        let res: Response;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          res = await fetch("/api/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [fieldName]: value }),
            credentials: "same-origin",
            signal: controller.signal,
          });
        } catch {
          // Network error or AbortError (hung request hit the 12s timeout) —
          // backoff if we still have attempts left.
          if (attempt < MAX_ATTEMPTS) {
            await wait(1000 * Math.pow(2, attempt - 1));
            if (generationRef.current[fieldName] !== gen) return;
            continue;
          }
          if (generationRef.current[fieldName] === gen) {
            setFieldErrors((prev) => ({ ...prev, [fieldName]: "Couldn't save." }));
            setSaveState("error");
            setSavingFields((prev) => {
              const n = new Set(prev);
              n.delete(fieldName);
              return n;
            });
          }
          return;
        } finally {
          clearTimeout(timeout);
        }

        // Drop stale response for an older generation of this field.
        if (generationRef.current[fieldName] !== gen) return;

        if (res.ok) {
          setLastSavedAt(new Date());
          setSaveState("saved");
          setSavingFields((prev) => {
            const n = new Set(prev);
            n.delete(fieldName);
            return n;
          });
          clearError(fieldName); // WR-01: clear any stale 429-retry error on retried success
          return;
        }

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
          setFieldErrors((prev) => ({
            ...prev,
            [fieldName]: `Saving too fast. Will retry in ${retryAfter}s.`,
          }));
          setSaveState("error");
          await wait(retryAfter * 1000);
          if (generationRef.current[fieldName] !== gen) return;
          continue;
        }

        if (res.status === 400 || res.status === 401) {
          const body = await res.json().catch(() => ({}));
          const msg = (body?.error as string | undefined) ?? "Couldn't save";
          setFieldErrors((prev) => ({
            ...prev,
            [fieldName]: `${msg}. Try again.`,
          }));
          setSaveState("error");
          setSavingFields((prev) => {
            const n = new Set(prev);
            n.delete(fieldName);
            return n;
          });
          return;
        }

        // 5xx or other unexpected status — exponential backoff if attempts remain.
        if (attempt < MAX_ATTEMPTS) {
          await wait(1000 * Math.pow(2, attempt - 1));
          if (generationRef.current[fieldName] !== gen) return;
          continue;
        }

        if (generationRef.current[fieldName] === gen) {
          setFieldErrors((prev) => ({ ...prev, [fieldName]: "Couldn't save." }));
          setSaveState("error");
          setSavingFields((prev) => {
            const n = new Set(prev);
            n.delete(fieldName);
            return n;
          });
        }
        return;
      }
    },
    [clearError],
  );

  return { saveState, fieldErrors, lastSavedAt, savingFields, save, clearError };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
