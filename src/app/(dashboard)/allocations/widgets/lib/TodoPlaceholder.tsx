import type { ReactNode } from "react";

/**
 * Shared TODO widget placeholder — consistent dashed border, centered
 * icon + message, muted text. Used by all "coming soon" widgets so
 * they share a single visual pattern.
 */
export function TodoPlaceholder({
  icon,
  message,
  testId,
}: {
  icon: ReactNode;
  message: string;
  testId?: string;
}) {
  return (
    <div
      className="flex h-full items-center justify-center p-6"
      data-testid={testId}
    >
      <div
        className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-[#E2E8F0] px-6 py-8 text-center"
        style={{ maxWidth: 360 }}
      >
        {icon}
        <p className="text-sm leading-relaxed" style={{ color: "#718096" }}>
          {message}
        </p>
      </div>
    </div>
  );
}
