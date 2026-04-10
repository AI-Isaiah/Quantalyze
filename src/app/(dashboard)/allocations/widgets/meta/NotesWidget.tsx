"use client";

import { useState } from "react";

export function NotesWidget() {
  const [notes, setNotes] = useState("");

  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Personal portfolio notes. Persistence coming soon."
        className="flex-1 w-full resize-none rounded border p-2 text-sm focus:outline-none"
        style={{
          borderColor: "#E2E8F0",
          color: "#1A1A2E",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      />
      <span className="text-[10px]" style={{ color: "#718096" }}>
        Notes reset on page reload
      </span>
    </div>
  );
}
