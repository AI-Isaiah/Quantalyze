"use client";

/**
 * useNoteAutoSave — shared on-blur autosave hook for all 4 note scopes
 * (portfolio / holding / bridge_outcome / strategy). Cloned from
 * useMandateAutoSave with three simplifications:
 *
 *   1. No per-field fieldErrors map — single content field per hook instance.
 *   2. No 429 Retry-After backoff — /api/notes IS rate-limited
 *      (notesUpsertLimiter, 30/min), but a 429 is treated as a terminal 4xx
 *      error (item 3), not retried against the Retry-After header.
 *   3. No 4-attempt exponential backoff — on 5xx or network error, retry
 *      exactly ONCE after 2s, then surface the error. On 4xx, no retry.
 *
 * Race guard: a per-hook generation counter bumps on each save(); stale
 * responses (older generation) are dropped before mutating state. Prevents
 * the rapid-blur race where save("a") resolves after save("b") and
 * overwrites the newer value.
 *
 * Contract: NO unmount flush. Consumers rely on blur (or an explicit save()
 * before navigation) to persist. Rationale: blur already covers the dominant
 * user path; unmount-flush would race with StrictMode double-mount in dev
 * and create more noise than it resolves for a rare case. In-flight fetches
 * during unmount are fire-and-forget — the generation guard prevents stale
 * state writes after unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface UseNoteAutoSaveReturn {
  saveState: SaveState;
  lastSavedAt: Date | null;
  save: (content: string) => Promise<void>;
}

type ScopeKind =
  | "portfolio"
  | "holding"
  | "bridge_outcome"
  | "strategy"
  | "dashboard";

// Contract: NO unmount flush. Consumers rely on blur or explicit save() to persist.
export function useNoteAutoSave(
  scope_kind: ScopeKind,
  scope_ref: string,
  initialLastSavedAt: Date | null = null,
): UseNoteAutoSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(initialLastSavedAt);

  // 2s "saved" flash → "idle" fade (mirrors MandateSaveStatus pattern).
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

  // Race-drop guard. Bump on every save(); stale responses are dropped.
  const generationRef = useRef(0);

  const save = useCallback(
    async (content: string): Promise<void> => {
      const gen = ++generationRef.current;
      setSaveState("saving");

      const attempt = async (retry: boolean): Promise<void> => {
        let res: Response;
        try {
          res = await fetch("/api/notes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope_kind, scope_ref, content }),
            credentials: "same-origin",
          });
        } catch {
          // Network error — retry once after 2s.
          if (retry) {
            await wait(2000);
            // Abort retry if a newer save() has superseded us.
            if (generationRef.current !== gen) return;
            return attempt(false);
          }
          if (generationRef.current === gen) setSaveState("error");
          return;
        }

        if (generationRef.current !== gen) {
          // M-1160: a newer save() superseded this one — drop the stale
          // response, but log so the discarded save isn't invisible.
          console.debug(
            "[useNoteAutoSave] stale save response dropped",
            scope_kind,
            scope_ref,
            { gen, current: generationRef.current },
          );
          return;
        }

        if (res.ok) {
          setLastSavedAt(new Date());
          setSaveState("saved");
          return;
        }
        if (res.status >= 500 && retry) {
          await wait(2000);
          if (generationRef.current !== gen) return;
          return attempt(false);
        }
        setSaveState("error"); // 4xx OR final-attempt 5xx
      };

      await attempt(true);
    },
    [scope_kind, scope_ref],
  );

  return { saveState, lastSavedAt, save };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
