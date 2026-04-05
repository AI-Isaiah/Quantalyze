"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
    >
      Download as PDF
    </button>
  );
}
