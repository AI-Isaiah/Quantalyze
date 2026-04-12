"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { WidgetProps } from "../../lib/types";

type SaveState = "idle" | "saving" | "saved" | "error";

export function NotesWidget({ data }: WidgetProps) {
  const portfolioId: string | undefined = data?.portfolio?.id;
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load notes on mount
  useEffect(() => {
    if (!portfolioId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/notes?portfolio_id=${portfolioId}`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setNotes(json.content ?? "");
        }
        // 404 is fine — no note exists yet
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  const save = useCallback(
    async (content: string) => {
      if (!portfolioId) return;
      setSaveState("saving");
      try {
        const res = await fetch("/api/notes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, portfolio_id: portfolioId }),
        });
        if (res.ok) {
          setSaveState("saved");
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
      }
    },
    [portfolioId],
  );

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setNotes(val);
    setSaveState("idle");

    // Debounce save by 1 second
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(val), 1000);
  }

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const stateLabels: Record<SaveState, string> = {
    idle: "",
    saving: "Saving...",
    saved: "Saved",
    error: "Save failed",
  };

  const stateColors: Record<SaveState, string> = {
    idle: "#718096",
    saving: "#718096",
    saved: "#16A34A",
    error: "#DC2626",
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={notes}
        onChange={handleChange}
        placeholder={loaded ? "Portfolio notes..." : "Loading..."}
        disabled={!loaded}
        className="flex-1 w-full resize-none rounded border p-2 text-sm focus:outline-none"
        style={{
          borderColor: "#E2E8F0",
          color: "#1A1A2E",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      />
      <span
        className="text-[10px]"
        style={{ color: stateColors[saveState] }}
        aria-live="polite"
      >
        {stateLabels[saveState]}
      </span>
    </div>
  );
}
