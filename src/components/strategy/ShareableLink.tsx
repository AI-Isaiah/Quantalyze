"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { analytics } from "@/lib/analytics";

interface ShareableLinkProps {
  strategyId: string;
}

export function ShareableLink({ strategyId }: ShareableLinkProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const url = `${window.location.origin}/factsheet/${strategyId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      analytics.shareClick(strategyId);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      analytics.shareClick(strategyId);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [strategyId]);

  return (
    <Button variant="secondary" onClick={handleCopy}>
      {copied ? (
        <>
          <svg className="h-4 w-4 mr-1.5 text-positive" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.28-8.72a.75.75 0 00-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="h-4 w-4 mr-1.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 1.5h-7a1 1 0 00-1 1v9" />
            <rect x="5.5" y="4.5" width="8" height="10" rx="1" />
          </svg>
          Share
        </>
      )}
    </Button>
  );
}
