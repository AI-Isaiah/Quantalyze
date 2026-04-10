"use client";

import { useCallback, useState } from "react";
import type { WidgetProps } from "../../lib/types";

export function QuickActions({ data }: WidgetProps) {
  const [copied, setCopied] = useState(false);
  const portfolioId: string | undefined = data?.portfolio?.id;

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some contexts
    }
  }, []);

  const buttonClass =
    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]";

  return (
    <div className="flex h-full items-center justify-center gap-3">
      <button
        type="button"
        disabled
        title="Triggers analytics recompute"
        className={buttonClass}
        style={{
          borderColor: "#E2E8F0",
          color: "#718096",
          cursor: "not-allowed",
          opacity: 0.6,
        }}
      >
        Recompute
      </button>

      <a
        href={portfolioId ? `/api/portfolio-pdf/${portfolioId}` : "#"}
        className={buttonClass}
        style={{
          borderColor: "#E2E8F0",
          color: "#1B6B5A",
          textDecoration: "none",
          display: "inline-block",
        }}
        {...(!portfolioId && { "aria-disabled": true })}
      >
        Export PDF
      </a>

      <button
        type="button"
        onClick={handleShare}
        className={buttonClass}
        style={{
          borderColor: "#E2E8F0",
          color: copied ? "#16A34A" : "#1B6B5A",
        }}
      >
        {copied ? "Copied!" : "Share"}
      </button>
    </div>
  );
}
