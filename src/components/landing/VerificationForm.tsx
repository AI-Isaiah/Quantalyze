"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

interface VerificationFormProps {
  onResult: (result: { public_token: string; verification_id: string }) => void;
}

type FormState = "idle" | "submitting" | "error";

const EXCHANGE_OPTIONS = [
  { value: "binance", label: "Binance" },
  { value: "okx", label: "OKX" },
  { value: "bybit", label: "Bybit" },
];

export function VerificationForm({ onResult }: VerificationFormProps) {
  const [exchange, setExchange] = useState("binance");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("submitting");
    setError(null);

    try {
      const res = await fetch("/api/verify-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          exchange,
          api_key: apiKey,
          api_secret: apiSecret,
          ...(exchange === "okx" && passphrase ? { passphrase } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Verification failed");
      }

      onResult({
        public_token: data.public_token,
        verification_id: data.verification_id ?? "",
      });
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-card"
    >
      <div className="space-y-4">
        <Select
          label="Exchange"
          options={EXCHANGE_OPTIONS}
          value={exchange}
          onChange={(e) => setExchange(e.target.value)}
        />

        <Input
          label="API Key"
          placeholder="Your read-only API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          required
        />

        <Input
          label="API Secret"
          type="password"
          placeholder="Your API secret"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          required
        />

        {exchange === "okx" && (
          <Input
            label="Passphrase"
            type="password"
            placeholder="OKX API passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
          />
        )}

        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        disabled={state === "submitting"}
      >
        {state === "submitting" ? "Verifying..." : "Verify My Strategy"}
      </Button>

      <p className="mt-3 text-center text-xs text-text-muted">
        We only use read-only API access. Your keys are never stored.
      </p>
    </form>
  );
}
