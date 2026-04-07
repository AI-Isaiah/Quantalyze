"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { SUPPORTED_EXCHANGES } from "@/lib/queries";

interface VerificationFormProps {
  onResult: (result: { public_token: string; verification_id: string }) => void;
}

const EXCHANGE_LABELS: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
};
const EXCHANGE_OPTIONS = SUPPORTED_EXCHANGES.map((value) => ({
  value,
  label: EXCHANGE_LABELS[value],
}));

export function VerificationForm({ onResult }: VerificationFormProps) {
  const [exchange, setExchange] = useState<string>(SUPPORTED_EXCHANGES[0]);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
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

      if (!data.verification_id || !data.public_token) {
        throw new Error("Verification service returned an invalid response");
      }

      onResult({
        public_token: data.public_token,
        verification_id: data.verification_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
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
        disabled={submitting}
      >
        {submitting ? "Verifying..." : "Verify My Strategy"}
      </Button>

      <p className="mt-3 text-center text-xs text-text-muted">
        We only use read-only API access. Your keys are never stored.
      </p>
    </form>
  );
}
