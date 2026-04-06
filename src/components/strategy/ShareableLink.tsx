"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";

interface ShareableLinkProps {
  strategyId: string;
  variant?: "primary" | "secondary";
}

export function ShareableLink({ strategyId, variant = "secondary" }: ShareableLinkProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const url = `${window.location.origin}/factsheet/${strategyId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [strategyId]);

  return (
    <Button variant={variant === "primary" ? "primary" : "secondary"} onClick={handleCopy}>
      {copied ? (
        <>
          <svg className="h-4 w-4 mr-1.5 text-positive" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.28-8.72a.75.75 0 00-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd" />
          </svg>
          Link copied!
        </>
      ) : (
        <>
          <svg className="h-4 w-4 mr-1.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 9.5l3-3M8.25 4.75L9.5 3.5a2.12 2.12 0 013 3L11.25 7.75M7.75 11.25L6.5 12.5a2.12 2.12 0 01-3-3l1.25-1.25" />
          </svg>
          Share Factsheet
        </>
      )}
    </Button>
  );
}
