"use client";

import { useEffect, useRef } from "react";

interface UndoToastProps {
  widgetName: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoToast({ widgetName, onUndo, onDismiss }: UndoToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, 10_000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDismiss]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-up"
      style={{ width: 320 }}
    >
      <div
        className="flex items-center justify-between rounded-lg bg-white px-4 py-3 text-sm"
        style={{
          border: "1px solid #E2E8F0",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          color: "#1A1A2E",
        }}
      >
        <span>
          <strong>{widgetName}</strong> removed.
        </span>
        <button
          type="button"
          onClick={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
            onUndo();
          }}
          className="ml-3 font-semibold transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
          style={{ color: "#1B6B5A" }}
        >
          Undo
        </button>
      </div>

      {/* Slide-up keyframes injected inline to avoid global CSS dependency */}
      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translate(-50%, 16px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-slide-up {
          animation: slide-up 250ms ease-out forwards;
        }
      `}</style>
    </div>
  );
}
