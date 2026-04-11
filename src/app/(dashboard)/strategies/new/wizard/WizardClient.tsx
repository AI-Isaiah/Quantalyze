"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { RequestCallModal } from "@/app/for-quants/RequestCallModal";
import { WizardChrome } from "./WizardChrome";
import { ConnectKeyStep, type ConnectKeySuccess } from "./steps/ConnectKeyStep";
import { SyncPreviewStep, type SyncPreviewSnapshot } from "./steps/SyncPreviewStep";
import { MetadataStep, type MetadataDraft } from "./steps/MetadataStep";
import { SubmitStep } from "./steps/SubmitStep";
import {
  clearWizardState,
  loadWizardState,
  newWizardSessionId,
  saveWizardState,
  type WizardStepKey,
} from "@/lib/wizard/localStorage";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { CtaLocation } from "@/lib/analytics";

/**
 * WizardClient owns the 4-step state machine for /strategies/new/wizard.
 * Source of truth is the server-side `strategies` row; localStorage
 * only stores a pointer so a tab close/reopen can resume.
 */

interface InitialDraft {
  id: string;
  name: string | null;
  description: string | null;
  category_id: string | null;
  strategy_types: string[] | null;
  subtypes: string[] | null;
  markets: string[] | null;
  supported_exchanges: string[] | null;
  leverage_range: string | null;
  aum: number | null;
  max_capacity: number | null;
  api_key_id: string | null;
}

interface WizardClientProps {
  /** Initial draft row from the server (null when no draft exists yet). */
  initialDraft: InitialDraft | null;
}

const STEP_INDEX: Record<WizardStepKey, 1 | 2 | 3 | 4> = {
  connect_key: 1,
  sync_preview: 2,
  metadata: 3,
  submit: 4,
};

export function WizardClient({ initialDraft }: WizardClientProps) {
  const router = useRouter();

  // Read localStorage once on mount. Three useState initializers below
  // all consume this same snapshot so we don't re-parse JSON three times.
  const initialLocalStateRef = useRef<ReturnType<typeof loadWizardState>>(null);
  if (typeof window !== "undefined" && initialLocalStateRef.current === null) {
    initialLocalStateRef.current = loadWizardState();
  }
  const loaded = initialLocalStateRef.current;

  const [wizardSessionId] = useState<string>(
    () => loaded?.wizardSessionId ?? newWizardSessionId(),
  );

  const [step, setStep] = useState<WizardStepKey>(() => {
    if (!initialDraft) return "connect_key";
    if (loaded?.strategyId === initialDraft.id) return loaded.step;
    return "sync_preview";
  });

  const [strategyId, setStrategyId] = useState<string | null>(
    initialDraft?.id ?? null,
  );
  const [apiKeyId, setApiKeyId] = useState<string | null>(
    initialDraft?.api_key_id ?? null,
  );

  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(
    () => Boolean(initialDraft) && loaded?.strategyId !== initialDraft?.id,
  );

  const [syncSnapshot, setSyncSnapshot] = useState<SyncPreviewSnapshot | null>(
    null,
  );
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(
    initialDraft
      ? {
          name: initialDraft.name ?? null,
          description: initialDraft.description ?? "",
          categoryId: initialDraft.category_id ?? null,
          strategyTypes: initialDraft.strategy_types ?? [],
          subtypes: initialDraft.subtypes ?? [],
          markets: initialDraft.markets ?? [],
          supportedExchanges: initialDraft.supported_exchanges ?? [],
          leverageRange: initialDraft.leverage_range ?? "",
          aum: initialDraft.aum?.toString() ?? "",
          maxCapacity: initialDraft.max_capacity?.toString() ?? "",
        }
      : null,
  );

  const [savedAt, setSavedAt] = useState<number | null>(
    initialDraft ? Date.now() : null,
  );
  const [toastKey, setToastKey] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requestCallOpen, setRequestCallOpen] = useState(false);
  const wizardStartFiredRef = useRef(false);

  useEffect(() => {
    if (wizardStartFiredRef.current) return;
    wizardStartFiredRef.current = true;
    trackForQuantsEventClient("wizard_start", {
      wizard_session_id: wizardSessionId,
      resume: Boolean(initialDraft),
    });
  }, [wizardSessionId, initialDraft]);

  useEffect(() => {
    trackForQuantsEventClient(`wizard_step_view_${STEP_INDEX[step]}` as const, {
      wizard_session_id: wizardSessionId,
      step,
    });
  }, [step, wizardSessionId]);

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          setSessionExpired(true);
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step,
            code: "SESSION_EXPIRED",
          });
        }
      },
    );
    return () => {
      subscription.unsubscribe();
    };
  }, [wizardSessionId, step]);

  const persistPointer = useCallback(
    (nextStep: WizardStepKey, id: string | null) => {
      if (!id) return;
      saveWizardState({
        strategyId: id,
        wizardSessionId,
        step: nextStep,
      });
      setSavedAt(Date.now());
      setToastKey((k) => k + 1);
    },
    [wizardSessionId],
  );

  const handleConnectSuccess = useCallback(
    (result: ConnectKeySuccess) => {
      setStrategyId(result.strategyId);
      setApiKeyId(result.apiKeyId);
      setStep("sync_preview");
      persistPointer("sync_preview", result.strategyId);
      trackForQuantsEventClient("wizard_step_complete_1", {
        wizard_session_id: wizardSessionId,
        strategy_id: result.strategyId,
        exchange: result.exchange,
      });
    },
    [wizardSessionId, persistPointer],
  );

  const handleSyncComplete = useCallback(
    (snapshot: SyncPreviewSnapshot) => {
      setSyncSnapshot(snapshot);
      setStep("metadata");
      persistPointer("metadata", strategyId);
      trackForQuantsEventClient("wizard_step_complete_2", {
        wizard_session_id: wizardSessionId,
        strategy_id: strategyId ?? undefined,
        trade_count: snapshot.tradeCount,
      });
    },
    [strategyId, wizardSessionId, persistPointer],
  );

  const handleMetadataComplete = useCallback(
    (draft: MetadataDraft) => {
      setMetadataDraft(draft);
      setStep("submit");
      persistPointer("submit", strategyId);
      trackForQuantsEventClient("wizard_step_complete_3", {
        wizard_session_id: wizardSessionId,
        strategy_id: strategyId ?? undefined,
      });
    },
    [strategyId, wizardSessionId, persistPointer],
  );

  const handleSubmitSuccess = useCallback(
    (finalStrategyId: string) => {
      trackForQuantsEventClient("wizard_submit_success", {
        wizard_session_id: wizardSessionId,
        strategy_id: finalStrategyId,
      });
      clearWizardState();
      router.push(`/strategies/${finalStrategyId}?wizard_submitted=1`);
      router.refresh();
    },
    [wizardSessionId, router],
  );

  const handleDeleteDraft = useCallback(async () => {
    if (!strategyId) {
      // No server draft yet; just clear local state.
      clearWizardState();
      setStep("connect_key");
      setStrategyId(null);
      setApiKeyId(null);
      setSyncSnapshot(null);
      setMetadataDraft(null);
      setConfirmDelete(false);
      return;
    }

    trackForQuantsEventClient("wizard_delete_draft", {
      wizard_session_id: wizardSessionId,
      strategy_id: strategyId,
    });

    try {
      const res = await fetch(`/api/strategies/draft/${strategyId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error("[wizard] delete draft failed:", await res.text());
      }
    } catch (err) {
      console.error("[wizard] delete draft threw:", err);
    } finally {
      clearWizardState();
      setStep("connect_key");
      setStrategyId(null);
      setApiKeyId(null);
      setSyncSnapshot(null);
      setMetadataDraft(null);
      setConfirmDelete(false);
    }
  }, [strategyId, wizardSessionId]);

  const handleResume = useCallback(() => {
    if (!initialDraft) return;
    setShowResumeBanner(false);
    // Honor the server-side draft; jump to sync_preview because the key
    // is already there but the sync status may be stale.
    setStep("sync_preview");
    persistPointer("sync_preview", initialDraft.id);
    trackForQuantsEventClient("wizard_resume", {
      wizard_session_id: wizardSessionId,
      strategy_id: initialDraft.id,
    });
  }, [initialDraft, persistPointer, wizardSessionId]);

  const handleStartFresh = useCallback(async () => {
    setShowResumeBanner(false);
    await handleDeleteDraft();
  }, [handleDeleteDraft]);

  const requestCallLocation: CtaLocation =
    `wizard_step_${STEP_INDEX[step]}` as CtaLocation;

  const handleOpenRequestCall = useCallback(() => {
    setRequestCallOpen(true);
    trackForQuantsEventClient("wizard_request_call_click", {
      wizard_session_id: wizardSessionId,
      step,
    });
  }, [wizardSessionId, step]);

  const wizardContext = useMemo(
    () => ({
      draft_strategy_id: strategyId,
      step,
      wizard_session_id: wizardSessionId,
    }),
    [strategyId, step, wizardSessionId],
  );

  return (
    <>
      <WizardChrome
        currentStep={step}
        savedAt={savedAt}
        canDelete={Boolean(strategyId)}
        onDeleteDraft={() => setConfirmDelete(true)}
        onRequestCall={handleOpenRequestCall}
        toastKey={toastKey}
      >
        {sessionExpired && (
          <div className="mb-4 rounded-md border border-border bg-page px-3 py-2 text-xs text-text-secondary">
            Your session expired. Your draft is saved.{" "}
            <a
              href="/login?next=/strategies/new/wizard"
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Sign in again
            </a>{" "}
            to continue.
          </div>
        )}

        {showResumeBanner && initialDraft && (
          <div className="mb-4 rounded-md border border-border bg-white px-4 py-3">
            <p className="text-sm font-medium text-text-primary">
              We saved your progress.
            </p>
            <p className="mt-1 text-xs text-text-muted">
              A draft from an earlier session is ready. Secrets are never stored in
              your browser, so you will need to paste your API secret again.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleResume} data-testid="wizard-resume">
                Resume draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleStartFresh}
                data-testid="wizard-start-fresh"
              >
                Start fresh
              </Button>
            </div>
          </div>
        )}

        {step === "connect_key" && (
          <ConnectKeyStep
            wizardSessionId={wizardSessionId}
            onSuccess={handleConnectSuccess}
          />
        )}

        {step === "sync_preview" && strategyId && (
          <SyncPreviewStep
            strategyId={strategyId}
            apiKeyId={apiKeyId}
            wizardSessionId={wizardSessionId}
            onComplete={handleSyncComplete}
            onTryAnotherKey={() => {
              setStep("connect_key");
              // Delete the current draft so the next create-with-key can
              // land without the unique(user, api_key) trigger blocking.
              void handleDeleteDraft();
              trackForQuantsEventClient("wizard_try_different_key", {
                wizard_session_id: wizardSessionId,
              });
            }}
          />
        )}

        {step === "metadata" && strategyId && syncSnapshot && (
          <MetadataStep
            strategyId={strategyId}
            wizardSessionId={wizardSessionId}
            initial={metadataDraft}
            detectedMarkets={syncSnapshot.detectedMarkets}
            detectedExchange={syncSnapshot.exchange}
            onComplete={handleMetadataComplete}
            onBack={() => {
              setStep("sync_preview");
              persistPointer("sync_preview", strategyId);
            }}
          />
        )}

        {step === "submit" && strategyId && syncSnapshot && metadataDraft && (
          <SubmitStep
            strategyId={strategyId}
            wizardSessionId={wizardSessionId}
            snapshot={syncSnapshot}
            metadata={metadataDraft}
            onSubmitted={handleSubmitSuccess}
            onBack={() => {
              setStep("metadata");
              persistPointer("metadata", strategyId);
            }}
          />
        )}
      </WizardChrome>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this draft?"
      >
        <p className="text-sm text-text-secondary">
          Your draft and its linked API key will be removed. You will start over
          from step 1.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteDraft}>
            Delete draft
          </Button>
        </div>
      </Modal>

      <RequestCallModal
        open={requestCallOpen}
        onClose={() => setRequestCallOpen(false)}
        ctaLocation={requestCallLocation}
        wizardContext={wizardContext}
      />
    </>
  );
}

