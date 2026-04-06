"use client";

import { cn } from "@/lib/utils";

interface VerificationProgressProps {
  status: "pending" | "processing" | "complete" | "failed";
}

const STEPS = [
  { key: "validating", label: "Validating Keys" },
  { key: "fetching", label: "Fetching Trades" },
  { key: "computing", label: "Computing Metrics" },
  { key: "complete", label: "Complete" },
] as const;

const STATUS_TO_STEP: Record<VerificationProgressProps["status"], number> = {
  pending: 0,
  processing: 1,
  complete: 3,
  failed: -1,
};

function CheckIcon() {
  return (
    <svg className="h-4 w-4 text-white" viewBox="0 0 16 16" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M12.78 4.22a.75.75 0 010 1.06l-5.5 5.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 011.06-1.06L7 9.44l4.97-4.97a.75.75 0 011.06-.25l.75.75z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path
        d="M14 8a6 6 0 00-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VerificationProgress({ status }: VerificationProgressProps) {
  const activeStep = STATUS_TO_STEP[status];

  return (
    <div className="mx-auto max-w-lg py-8">
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isComplete = i < activeStep || status === "complete";
          const isCurrent = i === activeStep && status !== "complete" && status !== "failed";
          const isPending = i > activeStep && status !== "complete";

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
                    isComplete && "bg-accent",
                    isCurrent && "bg-accent",
                    isPending && "border-2 border-border bg-white",
                    status === "failed" && i === 0 && "bg-negative",
                  )}
                >
                  {isComplete ? (
                    <CheckIcon />
                  ) : isCurrent ? (
                    <Spinner />
                  ) : (
                    <span className="text-text-muted">{i + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 text-xs whitespace-nowrap",
                    isComplete || isCurrent ? "text-text-primary font-medium" : "text-text-muted",
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line */}
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 flex-1 rounded-full transition-colors",
                    i < activeStep || status === "complete" ? "bg-accent" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {status === "failed" && (
        <p className="mt-6 text-center text-sm text-negative">
          Verification failed. Please check your API keys and try again.
        </p>
      )}
    </div>
  );
}
