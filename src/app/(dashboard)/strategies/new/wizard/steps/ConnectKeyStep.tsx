"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  formatKeyError,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";

/**
 * ConnectKeyStep renders the exchange selector, the inline permission
 * block, and the key/secret/passphrase inputs. On submit it POSTs to
 * /api/strategies/create-with-key. All error states render scripted
 * copy from wizardErrors.ts — never raw server strings.
 */

type ExchangeId = "binance" | "okx" | "bybit";

interface ExchangeOption {
  id: ExchangeId;
  name: string;
  caption: string;
  requiresPassphrase: boolean;
}

const EXCHANGES: ExchangeOption[] = [
  {
    id: "binance",
    name: "Binance",
    caption: "Spot + USDⓈ-M Futures + COIN-M Futures supported.",
    requiresPassphrase: false,
  },
  {
    id: "okx",
    name: "OKX",
    caption: "Spot + Perpetuals. Passphrase required.",
    requiresPassphrase: true,
  },
  {
    id: "bybit",
    name: "Bybit",
    caption: "Spot + Linear + Inverse supported.",
    requiresPassphrase: false,
  },
];

const TRUST_ATOMS: { title: string; body: string }[] = [
  {
    title: "What we store",
    body: "Your API key and secret are encrypted with AES-256-GCM envelope encryption before they ever hit the database. The KEK lives in Supabase Vault.",
  },
  {
    title: "What we reject",
    body: "Any key with trading or withdrawal scopes is rejected before we store it. Only Read permissions are allowed, enforced at the database level.",
  },
  {
    title: "Who can decrypt",
    body: "Only the Railway analytics service can decrypt the stored ciphertext to fetch your trade history. The web tier has no decryption path.",
  },
  {
    title: "Security contact",
    body: "Questions? security@quantalyze.com responds within one business day.",
  },
];

export interface ConnectKeySuccess {
  strategyId: string;
  apiKeyId: string;
  exchange: ExchangeId;
}

export interface ConnectKeyStepProps {
  wizardSessionId: string;
  onSuccess: (result: ConnectKeySuccess) => void;
}

export function ConnectKeyStep({ wizardSessionId, onSuccess }: ConnectKeyStepProps) {
  const [exchange, setExchange] = useState<ExchangeId>("binance");
  const [nickname, setNickname] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);

  const requiresPassphrase =
    EXCHANGES.find((e) => e.id === exchange)?.requiresPassphrase ?? false;

  const onSelectExchange = useCallback((next: ExchangeId) => {
    setExchange(next);
    setErrorCode(null);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorCode(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/strategies/create-with-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          api_key: apiKey,
          api_secret: apiSecret,
          passphrase: requiresPassphrase ? passphrase : null,
          label: nickname.trim() || `${exchange} key`,
          wizard_session_id: wizardSessionId,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        strategy_id?: string;
        api_key_id?: string;
        code?: string;
        error?: string;
      };

      if (!res.ok || !data.strategy_id || !data.api_key_id) {
        const code = (data.code as WizardErrorCode | undefined) ?? "UNKNOWN";
        setErrorCode(code);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "connect_key",
          code,
        });
        setSubmitting(false);
        return;
      }

      onSuccess({
        strategyId: data.strategy_id,
        apiKeyId: data.api_key_id,
        exchange,
      });
    } catch (err) {
      setErrorCode("KEY_NETWORK_TIMEOUT");
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "connect_key",
        code: "KEY_NETWORK_TIMEOUT",
      });
      console.error("[wizard:ConnectKeyStep] submit threw:", err);
      setSubmitting(false);
    }
  }

  const errorCopy = errorCode ? formatKeyError(errorCode) : null;

  return (
    <section aria-labelledby="wizard-connect-key-heading">
      <h2
        id="wizard-connect-key-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        Connect your exchange
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Paste a read-only API key. We validate scopes server-side before storing
        anything. Secrets are never persisted to your browser.
      </p>

      {/* Inline permission block — visible, not collapsible */}
      <div className="mt-6 rounded-md border border-border bg-page">
        <dl className="divide-y divide-border">
          {TRUST_ATOMS.map((atom) => (
            <div
              key={atom.title}
              className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6"
            >
              <dt className="text-xs font-medium text-text-primary">{atom.title}</dt>
              <dd className="text-xs text-text-secondary">{atom.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* Exchange cards */}
        <fieldset>
          <legend className="text-xs font-medium text-text-primary">
            Exchange
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {EXCHANGES.map((ex) => {
              const active = ex.id === exchange;
              return (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => onSelectExchange(ex.id)}
                  className={`rounded-md border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent/5"
                      : "border-border bg-white hover:border-accent/50"
                  }`}
                  aria-pressed={active}
                  data-testid={`wizard-exchange-${ex.id}`}
                >
                  <p className="text-sm font-semibold text-text-primary">{ex.name}</p>
                  <p className="mt-1 text-[11px] text-text-muted">{ex.caption}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Need help creating a read-only key?{" "}
            <Link
              href={`/security#${exchange}-readonly`}
              className="underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener"
            >
              {EXCHANGES.find((e) => e.id === exchange)?.name} setup guide →
            </Link>
          </p>
        </fieldset>

        <Input
          label="API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste the read-only key"
          autoComplete="off"
          required
        />

        <div>
          <div className="flex items-center justify-between">
            <label
              htmlFor="wizard-api-secret"
              className="text-xs font-medium text-text-primary"
            >
              API Secret
            </label>
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="text-[11px] text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
            >
              {showSecret ? "Hide" : "Show"}
            </button>
          </div>
          <input
            id="wizard-api-secret"
            type={showSecret ? "text" : "password"}
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="Paste the secret"
            autoComplete="off"
            required
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>

        {requiresPassphrase && (
          <div>
            <Input
              label="OKX Passphrase"
              type={showSecret ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Paste the OKX passphrase"
              autoComplete="off"
              required
            />
            <p className="mt-1 text-[11px] text-text-muted">
              OKX requires a passphrase in addition to key and secret. You set
              this when you created the API key on OKX.
            </p>
          </div>
        )}

        <div>
          <Input
            label="Key nickname (optional)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={`e.g. ${exchange} · prod`}
            autoComplete="off"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            For your own reference inside Quantalyze. Never shown to allocators.
          </p>
        </div>

        {errorCopy && (
          <div
            role="alert"
            className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
            data-testid="wizard-connect-error"
            data-error-code={errorCode ?? undefined}
          >
            <p className="text-sm font-semibold text-negative">{errorCopy.title}</p>
            <p className="mt-1 text-xs text-text-secondary">{errorCopy.cause}</p>
            {errorCopy.fix.length > 0 && (
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-text-secondary">
                {errorCopy.fix.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[11px]">
              <Link
                href={errorCopy.docsHref}
                className="text-accent underline-offset-4 hover:underline"
                target="_blank"
                rel="noopener"
              >
                Read the full guide →
              </Link>
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={submitting || !apiKey || !apiSecret || (requiresPassphrase && !passphrase)}
            data-testid="wizard-connect-submit"
          >
            {submitting ? "Validating..." : "Validate key and continue"}
          </Button>
        </div>
      </form>
    </section>
  );
}
