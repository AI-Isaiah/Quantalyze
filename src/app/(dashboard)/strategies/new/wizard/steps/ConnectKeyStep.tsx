"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { type WizardErrorCode } from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { SupportedExchange } from "@/lib/utils";
import { SFOX_UI_ENABLED, MT5_UI_ENABLED } from "@/lib/utils";
import {
  getWizardCorrelationId,
  wizardFetch,
} from "@/lib/wizard/wizard-correlation";

/**
 * ConnectKeyStep renders the exchange selector, the inline permission
 * block, and the key/secret/passphrase inputs. On submit it POSTs to
 * /api/strategies/create-with-key. All error states render scripted
 * copy from wizardErrors.ts — never raw server strings.
 */

// B8: the user-allowlist exchange ids derive from the single SupportedExchange
// set; the ExchangeOption[] array below adds component-specific UI metadata.
type ExchangeId = SupportedExchange;

interface ExchangeOption {
  id: ExchangeId;
  name: string;
  caption: string;
  requiresPassphrase: boolean;
  // Whether this exchange authenticates with an api_key + api_secret PAIR.
  // Absent → true (every ccxt exchange). sFOX authenticates with a SINGLE Bearer
  // token (no secret), so its card sets requiresSecret false: the secret input
  // is not rendered, submit is not gated on it, and the POST sends api_secret as
  // "" (the validate route's Phase-119 sfox carve-out normalizes + accepts it).
  requiresSecret?: boolean;
  // Per-exchange, presentation-only overrides for the credential-field labels
  // and placeholders. Defaults are "API Key"/"API Secret"; Deribit issues an
  // OAuth-style Client ID + Client Secret. The submit payload keys
  // (api_key/api_secret) and the generic storage columns are UNCHANGED — only
  // the rendered label/placeholder text differs.
  credentialLabels?: { key: string; secret: string };
  credentialPlaceholders?: { key: string; secret: string };
  // Per-exchange, presentation-only overrides for the third (passphrase-slot)
  // field. Today the third field is hardcoded to OKX ("OKX Passphrase"); MT5
  // reuses the SAME passphrase slot to collect the broker server, relabelled
  // "Broker server". Like credentialLabels (D-03), these mirror the label-only
  // precedent: the submit payload key (`passphrase`) and the storage column are
  // UNCHANGED — only the rendered label/placeholder/helper text differs.
  // Absent → today's OKX strings (byte-neutral for existing venues).
  passphraseLabel?: string;
  passphrasePlaceholder?: string;
  passphraseHelper?: string;
  // Optional muted helper rendered directly under the secret input. Absent →
  // nothing renders (byte-neutral). MT5 uses it for the up-front
  // investor-vs-master-password steer.
  secretHelper?: string;
}

// Phase 122 / SFOX-08: the sfox card is APPENDED only when SFOX_UI_ENABLED is on
// (the founder-gated NEXT_PUBLIC_SFOX_ENABLED flag). Flag OFF (default) leaves
// this array literal byte-identical to today's four cards (the spread is empty).
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
  {
    id: "deribit",
    name: "Deribit",
    caption: "Spot + Inverse Perpetuals + Options supported.",
    requiresPassphrase: false,
    credentialLabels: { key: "Client ID", secret: "Client Secret" },
    credentialPlaceholders: {
      key: "Paste the Deribit Client ID",
      secret: "Paste the Deribit Client Secret",
    },
  },
  ...(SFOX_UI_ENABLED
    ? [
        {
          id: "sfox" as const,
          name: "sFOX",
          caption: "Spot account. A single read-only API token, no secret.",
          requiresPassphrase: false,
          requiresSecret: false,
          credentialLabels: { key: "API Token", secret: "API Token" },
          credentialPlaceholders: {
            key: "Paste the read-only sFOX API token",
            secret: "Paste the read-only sFOX API token",
          },
        },
      ]
    : []),
  // Phase 138 / MT5UI-01: the MT5 card is APPENDED only when MT5_UI_ENABLED is
  // on (the founder-gated NEXT_PUBLIC_MT5_ENABLED flag). Flag OFF (default)
  // leaves this array literal byte-identical (empty spread). MT5 collects three
  // credentials into the existing {api_key, api_secret, passphrase} slots (the
  // 135 chokepoint): login → api_key, investor password → api_secret, broker
  // server → passphrase. requiresPassphrase:true renders the third field, gates
  // submit on it (:435), and flows the broker server into payload.passphrase.
  ...(MT5_UI_ENABLED
    ? [
        {
          id: "mt5" as const,
          name: "MT5",
          caption: "Live investor (read-only) login. Forex & CFD.",
          requiresPassphrase: true,
          credentialLabels: { key: "MT5 login", secret: "Investor password" },
          credentialPlaceholders: {
            key: "Your MT5 account number",
            secret: "Your read-only investor password",
          },
          passphraseLabel: "Broker server",
          passphrasePlaceholder: "Exactly as shown in your MT5 terminal",
          passphraseHelper:
            "Open your MT5 terminal's login window and copy the server name exactly as it appears there — it is broker-specific and often carries a region or Demo/Live suffix.",
          secretHelper:
            "Use your investor (read-only) password — not your master password. A master password can place trades, so we refuse it and store nothing.",
        },
      ]
    : []),
];

// F3 (Phase 122): the sfox honest "what we reject" atom. sFOX exposes no per-key
// scope endpoint, so we cannot PROBE scope the way the ccxt scope-rejection claim
// implies — say the structural facts instead, never a false verified-scope claim.
const SFOX_REJECT_ATOM_BODY =
  "sFOX keys are used read-only by our adapter — no order or withdraw path exists. sFOX exposes no per-key scope endpoint, so mint a READ-ONLY token.";

// Phase 138 / MT5UI-01 (UI-SPEC Delta 2): the mt5 honest "what we reject" atom.
// MT5 accounts carry a master password (can trade) and a separate investor
// (read-only) password. We refuse the master at connect time — state that
// structural fact up front rather than the ccxt scope-rejection claim, which
// does not describe MT5's mechanism.
const MT5_REJECT_ATOM_BODY =
  "MT5 master passwords can place trades, so we reject them at connect time and store nothing — only a read-only investor login is accepted.";

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

/**
 * The unvalidated credential draft the user has typed so far. Reported to the
 * parent via `onDraftChange` so a transition OUT of this component (multi-key
 * mode) can carry the in-progress key over instead of discarding it (UAT/F-4:
 * entering a key then clicking "+ Add another key window" must not erase it).
 */
export interface ConnectKeyDraft {
  exchange: ExchangeId;
  nickname: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

export interface ConnectKeyStepProps {
  wizardSessionId: string;
  onSuccess: (result: ConnectKeySuccess) => void;
  /**
   * Phase 88 / ONB-01 (A1). Optional slot rendered between the primary CTA and
   * the CSV escape-hatch. DEFAULT-ABSENT keeps this component byte-identical to
   * the single-key experience — the multi-key step (MultiKeyConnectStep) uses
   * it to inject the ghost "+ Add another key window" affordance. When
   * undefined, `{footerSlot}` renders nothing, so the DOM is unchanged.
   */
  footerSlot?: ReactNode;
  /**
   * UAT/F-4. Optional draft reporter. Fires whenever the credential fields
   * change so the parent (MultiKeyConnectStep) can seed the first key panel with
   * the in-progress draft when the user switches to multi-key mode. Absent for
   * the standalone single-key wizard → no behavior change.
   */
  onDraftChange?: (draft: ConnectKeyDraft) => void;
}

export function ConnectKeyStep({ wizardSessionId, onSuccess, footerSlot, onDraftChange }: ConnectKeyStepProps) {
  const [exchange, setExchange] = useState<ExchangeId>("binance");
  const [nickname, setNickname] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);
  // UX-02: the wizard session correlation id — the SAME id wizardFetch sends
  // on every request below, so the id shown in an error envelope matches the
  // failing request's server logs / Sentry tag / compute_jobs.metadata.
  const [correlationId] = useState<string>(() => getWizardCorrelationId());

  // UAT/F-4: report the in-progress draft up so a switch to multi-key mode can
  // carry it into the first panel instead of discarding it. No-op (single-key
  // wizard) when onDraftChange is absent.
  useEffect(() => {
    onDraftChange?.({ exchange, nickname, apiKey, apiSecret, passphrase });
  }, [onDraftChange, exchange, nickname, apiKey, apiSecret, passphrase]);

  const activeExchange = EXCHANGES.find((e) => e.id === exchange);
  // WR-01: the per-exchange "setup guide" SubAnchors for the flag-gated venues
  // (sfox #sfox-readonly, mt5 #mt5-readonly) are gated on their SERVER go-live
  // flags (isSfoxEnabledServer / isMt5EnabledServer), while this wizard card is
  // gated on the CLIENT flag. In the documented card-visible / guide-dark
  // half-state those per-exchange anchors do not render, so a deep link to them
  // lands on /security top with no guide. Point those venues at the
  // UNCONDITIONAL #readonly-key section anchor (the parent "Creating a read-only
  // API key" Section, always rendered) — matching the error-envelope link — so
  // the link is never dead. Other venues keep their per-exchange anchor.
  const guideAnchor =
    exchange === "sfox" || exchange === "mt5"
      ? "readonly-key"
      : `${exchange}-readonly`;
  const requiresPassphrase = activeExchange?.requiresPassphrase ?? false;
  // Absent requiresSecret → true (every ccxt exchange). sFOX is token-only.
  const requiresSecret = activeExchange?.requiresSecret ?? true;
  // Swap the "What we reject" atom body to the honest structural claim per
  // venue. MT5 is keyed on the venue id (it REQUIRES a secret, so the sfox
  // `!requiresSecret` branch can never fire for it — check mt5 FIRST). F3: sfox
  // keys on `!requiresSecret` (no order/withdraw path; no per-key scope
  // endpoint). Every other exchange renders today's scope-rejection copy
  // byte-identically.
  const trustAtoms = TRUST_ATOMS.map((atom) => {
    if (atom.title !== "What we reject") return atom;
    if (activeExchange?.id === "mt5")
      return { ...atom, body: MT5_REJECT_ATOM_BODY };
    if (!requiresSecret) return { ...atom, body: SFOX_REJECT_ATOM_BODY };
    return atom;
  });
  // Presentation-only credential labels/placeholders. Default to the generic
  // "API Key"/"API Secret" wording; Deribit overrides to "Client ID"/"Client
  // Secret" (D-03). Storage columns + payload keys are unchanged.
  const keyLabel = activeExchange?.credentialLabels?.key ?? "API Key";
  const secretLabel = activeExchange?.credentialLabels?.secret ?? "API Secret";
  const keyPlaceholder =
    activeExchange?.credentialPlaceholders?.key ?? "Paste the read-only key";
  const secretPlaceholder =
    activeExchange?.credentialPlaceholders?.secret ?? "Paste the secret";
  // Third (passphrase-slot) field overrides. Default to today's OKX strings so
  // existing venues render byte-identically; MT5 relabels it "Broker server".
  const passphraseLabel = activeExchange?.passphraseLabel ?? "OKX Passphrase";
  const passphrasePlaceholder =
    activeExchange?.passphrasePlaceholder ?? "Paste the OKX passphrase";
  const passphraseHelper =
    activeExchange?.passphraseHelper ??
    "OKX requires a passphrase in addition to key and secret. You set this when you created the API key on OKX.";
  // Optional muted helper under the secret input (MT5's investor-vs-master
  // steer). Absent → render nothing.
  const secretHelper = activeExchange?.secretHelper;

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
      const res = await wizardFetch("/api/strategies/create-with-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          api_key: apiKey,
          // sFOX is token-only: send api_secret as "" (the Phase-119 validate
          // carve-out normalizes empty→"" and accepts it for sfox; every ccxt
          // exchange still sends its real secret).
          api_secret: requiresSecret ? apiSecret : "",
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

  const errorEnvelope = errorCode
    ? buildEnvelope(errorCode, correlationId)
    : null;

  return (
    <section aria-labelledby="wizard-connect-key-heading">
      <h2
        id="wizard-connect-key-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        Connect your exchange
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        Paste a read-only API key. We validate scopes server-side before storing
        anything. Secrets are never persisted to your browser.
      </p>

      {/* Inline permission block — visible, not collapsible */}
      <div className="mt-6 rounded-md border border-border bg-page">
        <dl className="divide-y divide-border">
          {trustAtoms.map((atom) => (
            <div
              key={atom.title}
              className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6"
            >
              <dt className="text-caption font-medium text-text-primary">{atom.title}</dt>
              <dd className="text-caption text-text-secondary">{atom.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* Exchange cards */}
        <fieldset>
          <legend className="text-caption font-medium text-text-primary">
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
                  <p className="text-body font-semibold text-text-primary">{ex.name}</p>
                  <p className="mt-1 text-micro text-text-secondary">{ex.caption}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-micro text-text-muted">
            Need help creating a read-only key?{" "}
            <Link
              href={`/security#${guideAnchor}`}
              className="underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener"
            >
              {EXCHANGES.find((e) => e.id === exchange)?.name} setup guide →
            </Link>
          </p>
        </fieldset>

        <Input
          label={keyLabel}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={keyPlaceholder}
          autoComplete="off"
          required
        />

        {/* sFOX is token-only (requiresSecret false) — render the secret block
            only for exchanges that authenticate with a key+secret pair. A
            rendered `required` secret input would otherwise block a sfox submit
            on a field it does not have. */}
        {requiresSecret && (
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="wizard-api-secret"
                className="text-caption font-medium text-text-primary"
              >
                {secretLabel}
              </label>
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="text-micro text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="wizard-api-secret"
              type={showSecret ? "text" : "password"}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder={secretPlaceholder}
              autoComplete="off"
              required
              className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            {/* Muted (never amber/red) steer under the secret input — DESIGN.md
                semantic-color gate: tone is earned by an actual rejection, not a
                preemptive warning. MT5 uses it for the investor-vs-master steer. */}
            {secretHelper && (
              <p className="mt-1 text-micro text-text-muted">{secretHelper}</p>
            )}
          </div>
        )}

        {requiresPassphrase && (
          <div>
            <Input
              label={passphraseLabel}
              type={showSecret ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={passphrasePlaceholder}
              autoComplete="off"
              required
            />
            <p className="mt-1 text-micro text-text-muted">{passphraseHelper}</p>
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
          <p className="mt-1 text-micro text-text-muted">
            For your own reference inside Quantalyze. Never shown to allocators.
          </p>
        </div>

        {errorEnvelope && (
          <WizardErrorEnvelope
            envelope={errorEnvelope}
            onRetry={() => setErrorCode(null)}
          />
        )}

        {/* UAT/F-5: the "+ Add another key window" affordance (footerSlot) sits
            ABOVE the primary CTA — you decide to go multi-key BEFORE validating a
            single key, so the add-window action must precede "Validate key and
            continue". Absent for the single-key wizard → renders nothing. */}
        {footerSlot}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={submitting || !apiKey || (requiresSecret && !apiSecret) || (requiresPassphrase && !passphrase)}
            data-testid="wizard-connect-submit"
          >
            {submitting ? "Validating..." : "Validate key and continue"}
          </Button>
        </div>

        {/* Phase 15 follow-up (2026-05-07): the CSV branch shipped without a
            GUI entry point — only reachable via direct URL — so founders
            with a track-record CSV but no exchange API key had no way in.
            This is the bridge: a quiet inline link from the API wizard's
            first step to the CSV branch. Same wizard chrome, just a
            different first-step component. */}
        <p className="pt-2 text-caption text-text-muted">
          Don&apos;t have an API key yet?{" "}
          <Link
            href="/strategies/new/wizard?source=csv"
            className="font-medium text-accent underline-offset-4 hover:underline"
            data-testid="wizard-csv-branch-link"
          >
            Upload a CSV track record instead →
          </Link>
        </p>
      </form>
    </section>
  );
}
