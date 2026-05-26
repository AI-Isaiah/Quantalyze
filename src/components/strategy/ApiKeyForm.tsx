"use client";

import { useEffect, useRef, useState } from "react";
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

  const needsPassphrase = exchange === "okx";

  // NEW-C29-03: hold refs to the secret setters so the unmount cleanup can
  // reach them without closing over the state values themselves.
  const setApiSecretRef = useRef(setApiSecret);
  const setPassphraseRef = useRef(setPassphrase);
  setApiSecretRef.current = setApiSecret;
  setPassphraseRef.current = setPassphrase;

  // NEW-C29-03: zero out the plaintext secret fields on unmount regardless of
  // close path (Cancel button, modal X button, Escape key). This bounds the
  // in-memory lifetime of the plaintext to the time the modal is open — the
  // same session the user intended — rather than leaving it in the React fiber
  // tree / DevTools heap snapshot for an unbounded time after dismiss.
  useEffect(() => {
    return () => {
      setApiSecretRef.current("");
      setPassphraseRef.current("");
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({ exchange, label, apiKey, apiSecret, passphrase });
    // On a successful round-trip the parent closes the modal and unmounts this
    // component, triggering the cleanup above. On validation failure the modal
    // stays open for retry — the plaintext stays available for the next attempt.
  }

  // NEW-C29-03: also scrub on explicit Cancel before calling onCancel, so the
  // fields are cleared synchronously before the parent re-renders.
  function handleCancel() {
    setApiSecret("");
    setPassphrase("");
    onCancel();
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
