"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { EXCHANGES } from "@/lib/constants";

interface ApiKeyFormProps {
  onSubmit: (data: {
    exchange: string;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
  }) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
  error: string | null;
  defaultExchange?: string;
}

export function ApiKeyForm({ onSubmit, onCancel, loading, error, defaultExchange }: ApiKeyFormProps) {
  const [exchange, setExchange] = useState(defaultExchange || "binance");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");

  // NEW-C37-06: scrub plaintext secrets and invoke the parent cancel handler.
  function handleCancel() {
    setApiKey("");
    setApiSecret("");
    setPassphrase("");
    onCancel();
  }

  const needsPassphrase = exchange === "okx";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // NEW-C37-02: block Enter-key double-submit. `loading` is the
    // in-flight guard; rejecting here before the async onSubmit call means
    // two rapid Enter presses cannot race past the parent's setLoading(true)
    // re-render and fire two validate-and-encrypt requests.
    if (loading) return;
    try {
      await onSubmit({ exchange, label, apiKey, apiSecret, passphrase });
    } finally {
      // NEW-C37-06: scrub plaintext secrets from component state after the
      // parent resolves, whether success or failure. On success the form
      // unmounts shortly after (showForm → false), but on failure it stays
      // mounted — leaving apiKey/apiSecret/passphrase in state indefinitely
      // while the user reads the error message. Clear them here so the
      // longest-lived in-memory plaintext copy is bounded to the call.
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4">Connect Exchange API Key</h3>
        <div className="space-y-3">
          <Select
            label="Exchange"
            options={EXCHANGES.map((e) => ({ value: e.toLowerCase(), label: e }))}
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
          />
          <Input
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Main Trading Account"
            required
          />
          <Input
            label="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Your read-only API key"
            required
            autoComplete="off"
          />
          <Input
            label="API Secret"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="Your API secret"
            type="password"
            required
            autoComplete="off"
          />
          {needsPassphrase && (
            <Input
              label="Passphrase (OKX)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="OKX passphrase"
              type="password"
              autoComplete="off"
            />
          )}
        </div>

        <p className="text-xs text-text-muted mt-3">
          Only read-only keys are accepted. Keys with trading or withdrawal permissions will be rejected.
        </p>

        {error && <p className="text-sm text-negative mt-3">{error}</p>}

        <div className="flex gap-3 mt-4">
          <Button variant="secondary" type="button" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Validating..." : "Connect Key"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
