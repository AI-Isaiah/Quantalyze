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

export function VerificationSection() {
  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState<Status>("pending");
  const [results, setResults] = useState<VerificationResultData | null>(null);
  const [matchedStrategyId, setMatchedStrategyId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<{ public_token: string; verification_id: string } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  function pollStatus(verificationId: string, publicToken: string) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/verify-strategy/${verificationId}/status?token=${publicToken}`,
        );
        if (!res.ok) {
          setStatus("failed");
          stopPolling();
          return;
        }

        const data = await res.json();
        const newStatus = data.status as Status;
        setStatus(newStatus);

        if (newStatus === "complete" && data.results) {
          stopPolling();
          setResults(data.results);
          setMatchedStrategyId(data.results.matched_strategy_id ?? null);
          setPhase("results");
        } else if (newStatus === "failed") {
          stopPolling();
        }
      } catch {
        setStatus("failed");
        stopPolling();
      }
    }, 3000);
  }

  function handleResult(result: { public_token: string; verification_id: string }) {
    tokenRef.current = result;
    setPhase("progress");
    setStatus("pending");
    pollStatus(result.verification_id, result.public_token);
  }

  function handleRetry() {
    stopPolling();
    setPhase("form");
    setStatus("pending");
    setResults(null);
    setMatchedStrategyId(null);
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
        matchedStrategyId={matchedStrategyId}
      />
    );
  }

  return null;
}
