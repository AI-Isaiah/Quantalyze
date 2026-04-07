"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VerificationForm } from "./VerificationForm";
import { VerificationProgress } from "./VerificationProgress";
import { VerificationResults } from "./VerificationResults";

type Status = "pending" | "processing" | "complete" | "failed";

interface VerificationResultData {
  twr: number | null;
  sharpe: number | null;
  return_24h: number | null;
  return_mtd: number | null;
  return_ytd: number | null;
  equity_curve: { date: string; value: number }[] | null;
  trade_count: number;
  matched_strategy_id?: string | null;
}

type Phase = "form" | "progress" | "results";

const POLL_INITIAL_MS = 3000;
const POLL_MAX_MS = 30000;
const POLL_BACKOFF_FACTOR = 1.5;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes hard cap

export function VerificationSection() {
  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState<Status>("pending");
  const [results, setResults] = useState<VerificationResultData | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  function schedulePoll(
    verificationId: string,
    publicToken: string,
    delay: number,
    startedAt: number,
  ) {
    pollTimeoutRef.current = setTimeout(async () => {
      if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
        setStatus("failed");
        return;
      }

      try {
        const res = await fetch(
          `/api/verify-strategy/${verificationId}/status?token=${publicToken}`,
        );
        if (!res.ok) {
          setStatus("failed");
          return;
        }

        const data = await res.json();
        const newStatus = data.status as Status;
        setStatus(newStatus);

        if (newStatus === "complete" && data.results) {
          setResults(data.results);
          setPhase("results");
          return;
        }
        if (newStatus === "failed") return;

        // Continue polling with exponential backoff
        const nextDelay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_MS);
        schedulePoll(verificationId, publicToken, nextDelay, startedAt);
      } catch {
        setStatus("failed");
      }
    }, delay);
  }

  function handleResult(result: { public_token: string; verification_id: string }) {
    setPhase("progress");
    setStatus("pending");
    schedulePoll(result.verification_id, result.public_token, POLL_INITIAL_MS, Date.now());
  }

  function handleRetry() {
    stopPolling();
    setPhase("form");
    setStatus("pending");
    setResults(null);
  }

  if (phase === "form") {
    return <VerificationForm onResult={handleResult} />;
  }

  if (phase === "progress") {
    return (
      <div>
        <VerificationProgress status={status} />
        {status === "failed" && (
          <div className="mt-4 text-center">
            <button
              onClick={handleRetry}
              className="text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "results" && results) {
    return (
      <VerificationResults
        results={results}
        matchedStrategyId={results.matched_strategy_id ?? null}
      />
    );
  }

  return null;
}
