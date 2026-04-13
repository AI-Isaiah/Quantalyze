"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Exchange = "binance" | "okx" | "bybit";

type Step = "exchange" | "credentials" | "syncing";

interface ConnectAccountModalProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Exchange metadata
// ---------------------------------------------------------------------------

const EXCHANGES: { id: Exchange; name: string; tag: string; tagBg: string; tagFg: string }[] = [
  { id: "binance", name: "Binance", tag: "BNB", tagBg: "#FEF3C7", tagFg: "#92400E" },
  { id: "okx", name: "OKX", tag: "OKX", tagBg: "#1F2937", tagFg: "#F9FAFB" },
  { id: "bybit", name: "Bybit", tag: "BYB", tagBg: "#FFE4D6", tagFg: "#C2410C" },
];

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "exchange", label: "Exchange" },
    { key: "credentials", label: "Credentials" },
    { key: "syncing", label: "Sync" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className="flex items-center justify-center rounded-full text-[11px] font-semibold"
            style={{
              width: 22,
              height: 22,
              backgroundColor: i <= currentIdx ? "#1B6B5A" : "#E2E8F0",
              color: i <= currentIdx ? "#FFFFFF" : "#718096",
            }}
          >
            {i + 1}
          </div>
          <span
            className="text-[12px] font-medium"
            style={{
              color: i <= currentIdx ? "#1A1A2E" : "#718096",
            }}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div
              className="mx-1"
              style={{
                width: 16,
                height: 1,
                backgroundColor: i < currentIdx ? "#1B6B5A" : "#E2E8F0",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Slide-out panel (DESIGN.md pattern) for connecting an allocator's
 * exchange sub-account via a read-only API key.
 *
 * Three steps:
 *   1. Select exchange (Binance / OKX / Bybit)
 *   2. Enter API key + secret (+ passphrase for OKX) + label
 *   3. Syncing / done
 */
export function ConnectAccountModal({ onClose }: ConnectAccountModalProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>("exchange");
  const [exchange, setExchange] = useState<Exchange | null>(null);

  // Credentials
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [label, setLabel] = useState("");

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    strategy_id: string;
    status: string;
  } | null>(null);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // ── Step 1: Exchange selection ──────────────────────────────────

  function handleExchangeSelect(ex: Exchange) {
    setExchange(ex);
    setStep("credentials");
    setError(null);
  }

  // ── Step 2: Submit credentials ─────────────────────────────────

  async function handleConnect() {
    if (!exchange) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/allocator/connect-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          api_key: apiKey,
          api_secret: apiSecret,
          passphrase: exchange === "okx" ? passphrase : undefined,
          label: label || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Connection failed (${res.status})`);
        setSubmitting(false);
        return;
      }

      setResult({
        strategy_id: data.strategy_id,
        status: data.status,
      });
      setStep("syncing");
      setSubmitting(false);
    } catch {
      setError("Network error. Please check your connection.");
      setSubmitting(false);
    }
  }

  const needsPassphrase = exchange === "okx";
  const canSubmit =
    apiKey.length >= 8 &&
    apiSecret.length >= 8 &&
    (!needsPassphrase || passphrase.length > 0) &&
    !submitting;

  // ── Step 3: Syncing / done ─────────────────────────────────────

  function handleDone() {
    router.refresh();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Connect exchange account"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-md flex-col bg-surface shadow-elevated"
        style={{ animation: "slideInRight 250ms ease-out" }}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2
              className="text-base font-semibold truncate"
              style={{ color: "#1A1A2E" }}
            >
              Connect Account
            </h2>
            <div className="mt-2">
              <StepIndicator current={step} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="shrink-0 rounded-md p-1 transition-colors hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            style={{ color: "#718096" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── Step 1: Exchange selection ───────────────────────── */}
          {step === "exchange" && (
            <div>
              <p
                className="text-[13px] mb-4"
                style={{ color: "#4A5568" }}
              >
                Select the exchange where your sub-account is hosted.
              </p>
              <div className="space-y-2">
                {EXCHANGES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => handleExchangeSelect(ex.id)}
                    className="w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:border-[#1B6B5A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
                    style={{
                      borderColor: "#E2E8F0",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <span
                      className="inline-flex items-center justify-center rounded text-[10px] font-bold uppercase"
                      style={{
                        width: 36,
                        height: 24,
                        backgroundColor: ex.tagBg,
                        color: ex.tagFg,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {ex.tag}
                    </span>
                    <span
                      className="text-[14px] font-medium"
                      style={{ color: "#1A1A2E" }}
                    >
                      {ex.name}
                    </span>
                    <svg
                      className="ml-auto"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M6 4l4 4-4 4"
                        stroke="#718096"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Credentials form ─────────────────────────── */}
          {step === "credentials" && exchange && (
            <div>
              {/* Back link */}
              <button
                type="button"
                onClick={() => {
                  setStep("exchange");
                  setError(null);
                }}
                className="mb-3 flex items-center gap-1 text-[12px] font-medium transition-colors hover:underline"
                style={{ color: "#1B6B5A" }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M10 4l-4 4 4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Back
              </button>

              {/* Security notice */}
              <div
                className="mb-4 rounded-md border px-3 py-2.5"
                style={{
                  borderColor: "#E2E8F0",
                  backgroundColor: "#F8F9FA",
                }}
              >
                <div className="flex items-start gap-2">
                  <svg
                    className="mt-0.5 shrink-0"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M8 1a3 3 0 00-3 3v3H4a1 1 0 00-1 1v6a1 1 0 001 1h8a1 1 0 001-1V8a1 1 0 00-1-1h-1V4a3 3 0 00-3-3zm0 1.5A1.5 1.5 0 019.5 4v3h-3V4A1.5 1.5 0 018 2.5z"
                      fill="#1B6B5A"
                    />
                  </svg>
                  <p className="text-[12px] leading-relaxed" style={{ color: "#4A5568" }}>
                    <span className="font-semibold" style={{ color: "#1A1A2E" }}>
                      Read-only keys only.
                    </span>{" "}
                    We never place trades or withdraw funds. Create an API key
                    with read-only permissions on your exchange.
                  </p>
                </div>
              </div>

              {/* Form fields */}
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="connect-label"
                    className="block text-[12px] font-medium mb-1"
                    style={{ color: "#4A5568" }}
                  >
                    Account Label
                  </label>
                  <input
                    id="connect-label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`e.g. Main ${EXCHANGES.find((e) => e.id === exchange)?.name} account`}
                    className="w-full rounded-md border px-3 py-2 text-[13px] transition-colors focus:outline-none"
                    style={{
                      borderColor: "#E2E8F0",
                      color: "#1A1A2E",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "#1B6B5A";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "#E2E8F0";
                    }}
                    maxLength={100}
                  />
                </div>

                <div>
                  <label
                    htmlFor="connect-api-key"
                    className="block text-[12px] font-medium mb-1"
                    style={{ color: "#4A5568" }}
                  >
                    API Key
                  </label>
                  <input
                    id="connect-api-key"
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your read-only API key"
                    className="w-full rounded-md border px-3 py-2 text-[13px] font-mono transition-colors focus:outline-none"
                    style={{
                      borderColor: "#E2E8F0",
                      color: "#1A1A2E",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "#1B6B5A";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "#E2E8F0";
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <div>
                  <label
                    htmlFor="connect-api-secret"
                    className="block text-[12px] font-medium mb-1"
                    style={{ color: "#4A5568" }}
                  >
                    API Secret
                  </label>
                  <input
                    id="connect-api-secret"
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="Paste your API secret"
                    className="w-full rounded-md border px-3 py-2 text-[13px] font-mono transition-colors focus:outline-none"
                    style={{
                      borderColor: "#E2E8F0",
                      color: "#1A1A2E",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "#1B6B5A";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "#E2E8F0";
                    }}
                    autoComplete="off"
                  />
                </div>

                {needsPassphrase && (
                  <div>
                    <label
                      htmlFor="connect-passphrase"
                      className="block text-[12px] font-medium mb-1"
                      style={{ color: "#4A5568" }}
                    >
                      Passphrase
                    </label>
                    <input
                      id="connect-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="OKX API passphrase"
                      className="w-full rounded-md border px-3 py-2 text-[13px] font-mono transition-colors focus:outline-none"
                      style={{
                        borderColor: "#E2E8F0",
                        color: "#1A1A2E",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "#1B6B5A";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "#E2E8F0";
                      }}
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>

              {/* Error message */}
              {error && (
                <div
                  className="mt-3 rounded-md border px-3 py-2"
                  style={{
                    borderColor: "rgba(220, 38, 38, 0.2)",
                    backgroundColor: "rgba(220, 38, 38, 0.05)",
                  }}
                >
                  <p className="text-[12px]" style={{ color: "#DC2626" }}>
                    {error}
                  </p>
                </div>
              )}

              {/* Submit button */}
              <button
                type="button"
                onClick={handleConnect}
                disabled={!canSubmit}
                className="mt-4 w-full rounded-md px-4 py-2.5 text-[13px] font-medium text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B6B5A] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: canSubmit ? "#1B6B5A" : "#1B6B5A",
                }}
                onMouseEnter={(e) => {
                  if (canSubmit)
                    e.currentTarget.style.backgroundColor = "#155A4B";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#1B6B5A";
                }}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin"
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="28"
                        strokeDashoffset="8"
                        strokeLinecap="round"
                      />
                    </svg>
                    Connecting...
                  </span>
                ) : (
                  "Connect Account"
                )}
              </button>
            </div>
          )}

          {/* ── Step 3: Syncing / done ───────────────────────────── */}
          {step === "syncing" && result && (
            <div className="flex flex-col items-center py-8">
              {/* Success checkmark */}
              <div
                className="mb-4 flex items-center justify-center rounded-full"
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: "rgba(22, 163, 74, 0.1)",
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="#16A34A"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <h3
                className="text-[16px] font-semibold mb-1"
                style={{ color: "#1A1A2E" }}
              >
                Account Connected
              </h3>
              <p
                className="text-[13px] text-center mb-6 max-w-[280px]"
                style={{ color: "#4A5568" }}
              >
                Your exchange data is syncing in the background. Trades and
                analytics will appear on your dashboard within a few minutes.
              </p>

              {/* Sync status indicator */}
              <div
                className="w-full rounded-md border px-4 py-3 mb-6"
                style={{
                  borderColor: "#E2E8F0",
                  backgroundColor: "#F8F9FA",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="rounded-full animate-pulse"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: "#D97706",
                    }}
                  />
                  <span
                    className="text-[12px] font-medium"
                    style={{ color: "#4A5568" }}
                  >
                    Syncing trade history...
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDone}
                className="w-full rounded-md border px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
                style={{
                  borderColor: "#E2E8F0",
                  color: "#1A1A2E",
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Slide-in animation keyframe */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
