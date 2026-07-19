"use client";

import { useEffect, useState } from "react";
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
  // Reveal toggle for the secret. Defaults hidden; lets the user eyeball what
  // they pasted (deribit rejects a mistyped secret as invalid_credentials, and
  // a masked field gives no way to catch a typo). Reset alongside every secret
  // scrub so a reopened form always starts masked.
  const [showSecret, setShowSecret] = useState(false);

  // NEW-C37-06: scrub plaintext secrets and invoke the parent cancel handler.
  function handleCancel() {
    setApiKey("");
    setApiSecret("");
    setPassphrase("");
    setShowSecret(false);
    onCancel();
  }

  const needsPassphrase = exchange === "okx";
  // Phase 122 / SFOX-08: sFOX authenticates with a SINGLE Bearer token (no
  // secret). The Select value is already lowercased, so an exact match is
  // enough. When sfox: relabel the key input to "API Token", skip the secret
  // block entirely (its `required` would otherwise block submit on a field sfox
  // does not have), submit apiSecret as "", and swap the footer to the F3-honest
  // copy. Non-sfox exchanges are unchanged — the scope-probe claim is TRUE for
  // ccxt exchanges.
  const isSfox = exchange === "sfox";

  // NEW-C29-03 / I1: zero out all plaintext credential fields on unmount,
  // regardless of close path (Cancel button, modal X, Escape key). This bounds
  // the in-memory lifetime of the plaintext to the time the modal is open.
  // useState setters are stable references — no refs needed to reach them
  // from the cleanup closure.
  useEffect(() => {
    return () => {
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      setShowSecret(false);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // NEW-C37-02: block Enter-key double-submit. `loading` is the
    // in-flight guard; rejecting here before the async onSubmit call means
    // two rapid Enter presses cannot race past the parent's setLoading(true)
    // re-render and fire two validate-and-encrypt requests.
    if (loading) return;
    try {
      // sFOX is token-only — submit an empty secret regardless of state (the
      // secret input is not rendered for sfox, so state stays "", but pin it
      // explicitly so a future edit cannot leak a stale secret into a sfox save).
      await onSubmit({
        exchange,
        label,
        apiKey,
        apiSecret: isSfox ? "" : apiSecret,
        passphrase,
      });
    } finally {
      // NEW-C37-06 + NEW-C29-03: scrub plaintext secrets from component state
      // after the parent resolves, whether success or failure. On success the
      // form unmounts shortly after (showForm → false), but on failure it stays
      // mounted — leaving apiKey/apiSecret/passphrase in state indefinitely
      // while the user reads the error message. Together with the unmount
      // cleanup and handleCancel scrub above, this bounds the longest-lived
      // in-memory plaintext copy to the call.
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      setShowSecret(false);
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
            label={isSfox ? "API Token" : "API Key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              isSfox ? "Your read-only sFOX API token" : "Your read-only API key"
            }
            required
            autoComplete="off"
          />
          {/* sFOX is token-only — render the secret block only for key+secret
              exchanges. Its `required` attr would otherwise block a sfox submit. */}
          {!isSfox && (
            <div className="relative">
              <Input
                label="API Secret"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Your API secret"
                type={showSecret ? "text" : "password"}
                required
                autoComplete="off"
                className="pr-16"
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                aria-pressed={showSecret}
                aria-label={showSecret ? "Hide API secret" : "Show API secret"}
                className="absolute bottom-0 right-0 flex h-[44px] items-center px-3 text-micro font-mono uppercase tracking-[0.14em] text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
          )}
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
          {isSfox
            ? "sFOX keys are used read-only by our adapter — no order or withdraw path exists. sFOX does not expose a per-key scope check, so mint a READ-ONLY token."
            : "Only read-only keys are accepted. Keys with trading or withdrawal permissions will be rejected."}
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
