"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { capitalOwnershipRefusalMessage } from "@/lib/capital-ownership";
import { withPublishedOnly } from "@/lib/visibility";

interface MigrationWizardButtonProps {
  portfolioId: string;
}

type Step = "select" | "details" | "notes" | "saving";
type StrategyOption = { id: string; name: string };

// 151 review E3 — FIXED COPY FOR THE NON-23514 WRITE FAILURES.
//
// Both handlers below used to render the PostgREST error's `message` verbatim,
// so a 42501 RLS refusal, a 23503 foreign-key violation, or any future trigger
// `RAISE` on these tables put internal table / policy / constraint names — and
// the strategy UUID the D-03-A trigger embeds — in front of an allocator. That
// is the same defect class as the PROD "'Mt5Session' object has no attribute
// 'fetch_balance'" sync_error: a raw machine string used as user copy.
//
// The two sentences differ because what is KNOWN differs, and telling those
// apart is the point. Neither names a table, a policy or an id; the driver text
// goes to the console, which is where an engineer reads it.
//
// ⚠️ 151 review I1/I2 — WHAT THESE SENTENCES MAY CLAIM, AND WHAT THEY MAY ASK
// FOR. The first cut of this copy asserted a DATABASE STATE ("nothing was
// changed") and issued an INSTRUCTION ("submit again"). Both are unsafe, and
// for the same underlying reason: supabase-js reports a lost response as a
// `PostgrestError` (`code: ''`) rather than throwing, so a write that actually
// LANDED and whose response never came back is indistinguishable here from one
// the server refused.
//
//   I1 — "nothing was changed" is therefore a claim this code cannot establish:
//        the upsert may have committed with a `portfolio_strategies` row now on
//        disk. The honest statement is about our KNOWLEDGE ("we couldn't
//        confirm"), and the remedy has to be safe under both outcomes, which
//        "reload and check first" is and a bare "try again in a moment" is not.
//
//   I2 — the position write is an `.upsert`, so it IS idempotent; the deposit
//        is not. `allocation_events` has NO uniqueness constraint — verified in
//        20260407075303_portfolio_intelligence.sql:11-21, whose only key is
//        `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, and no later
//        migration adds one (`grep -rn allocation_events supabase/migrations/`
//        finds two indexes and the RLS policies, nothing unique). So a user who
//        followed "submit again" on the lost-response case wrote a SECOND
//        deposit for one allocation and silently doubled an append-only ledger.
//        This copy therefore warns about the duplicate instead of asking for
//        it, and points at the history where the answer actually is.
const ERROR_CLAIM_NOT_SAVED =
  "We couldn't confirm whether this claim saved. Reload this page and check your allocations before you try it again.";
const ERROR_DEPOSIT_NOT_RECORDED =
  "The allocation was saved, but we couldn't confirm its deposit record. Reload this page and check this allocation's history — recording the deposit a second time would double it.";

export function MigrationWizardButton({ portfolioId }: MigrationWizardButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>("select");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StrategyOption[]>([]);
  const [selected, setSelected] = useState<StrategyOption | null>(null);
  const [amount, setAmount] = useState("");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setIsOpen(false);
    setStep("select");
    setQuery(""); setResults([]); setSelected(null);
    setAmount(""); setEventDate(new Date().toISOString().slice(0, 10));
    setNotes(""); setError(null);
  }

  useEffect(() => {
    if (!isOpen || selected || query.trim().length < 2) {
      // Defer to next tick to avoid sync setState-in-effect lint warning
      const id = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const { data } = await withPublishedOnly(
        supabase
          .from("strategies")
          .select("id, name")
          .ilike("name", `%${query.trim()}%`),
      )
        .limit(10);
      if (!cancelled) setResults(data ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, selected, isOpen, supabase]);

  async function handleSubmit() {
    if (!selected) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Amount must be a positive number");
      return;
    }
    setStep("saving"); setError(null);

    const { error: psError } = await supabase.from("portfolio_strategies").upsert({
      portfolio_id: portfolioId, strategy_id: selected.id,
      allocated_amount: parsed, allocated_at: eventDate, relationship_status: "connected",
    });
    // Review [3] — Phase 150's D-03-A trigger made this insert refusable, and
    // this handler renders `psError.message` VERBATIM. The migration's header
    // lists MigrationWizard among the paths it preserves, on the grounds that
    // it inserts for OTHER owners' strategies — but the search step lists every
    // strategy the caller can read, which includes their own, and ARM 2 fires
    // on a self-owned strategy that is unmarked (every pre-150 row is NULL).
    // Claiming a legacy allocation on your own strategy therefore surfaced raw
    // Postgres text with an internal UUID in it as the failure copy, with the
    // trigger's actionable HINT dropped. The two arms and their copy are the
    // SHARED mapper `capitalOwnershipRefusalMessage` (@/lib/capital-ownership),
    // which AddToPortfolio's 23514 branch also calls — this comment used to say
    // "same two arms, same copy, as AddToPortfolio" over a verbatim duplicate,
    // which is a promise the code did not keep.
    if (psError) {
      if (psError.code !== "23514") {
        // 151 review E3 — the driver text is DIAGNOSTICS, not copy. It goes to
        // the console (where an engineer reads it) and never to the DOM.
        console.error("[MigrationWizard] portfolio_strategies write failed:", psError.message);
      }
      setError(
        psError.code === "23514"
          ? capitalOwnershipRefusalMessage(psError)
          : ERROR_CLAIM_NOT_SAVED,
      );
      setStep("notes");
      return;
    }

    const { error: evError } = await supabase.from("allocation_events").insert({
      portfolio_id: portfolioId, strategy_id: selected.id, event_type: "deposit",
      amount: parsed, event_date: eventDate, notes: notes.trim() || null, source: "manual",
    });
    // 151 review E3 — same discipline, same table-adjacent leak: this handler
    // also rendered PostgREST's `message` verbatim. Its copy differs from the
    // one above because what is KNOWN differs — the position row is confirmed
    // saved by the time this fires, while the deposit's fate is exactly what we
    // could not confirm. I2: it must not ask for a resubmit, because the ledger
    // it writes to has no uniqueness constraint to absorb one.
    if (evError) {
      console.error("[MigrationWizard] allocation_events write failed:", evError.message);
      setError(ERROR_DEPOSIT_NOT_RECORDED);
      setStep("notes");
      return;
    }

    if (notes.trim()) {
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("relationship_documents").insert({
        portfolio_id: portfolioId, strategy_id: selected.id, title: "Migration notes",
        doc_type: "note", content: notes.trim(), uploaded_by: userData.user?.id, file_url: "",
      });
    }

    router.refresh();
    handleClose();
  }

  const stepNum = step === "select" ? 1 : step === "details" ? 2 : 3;

  return (
    <>
      <Button variant="secondary" onClick={() => setIsOpen(true)}>Claim Legacy Allocation</Button>
      <Modal open={isOpen} onClose={handleClose} title="Claim Legacy Allocation">
        <p className="text-caption text-text-muted mb-4">Step {stepNum} of 3</p>

        {step === "select" && (
          <div className="space-y-4">
            <Input
              label="Search strategies"
              value={selected ? selected.name : query}
              onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
              placeholder="Type at least 2 characters..."
            />
            {!selected && results.length > 0 && (
              <ul className="max-h-48 overflow-auto rounded-lg border border-border divide-y divide-border">
                {results.map((s) => (
                  <li key={s.id}>
                    <button type="button"
                      onClick={() => { setSelected(s); setQuery(""); setResults([]); }}
                      className="block w-full text-left px-3 py-2 text-small text-text-primary hover:bg-page transition-colors">
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!selected && query.trim().length >= 2 && results.length === 0 && (
              <p className="text-caption text-text-muted">No published strategies match. Try a different name.</p>
            )}
          </div>
        )}

        {step === "details" && selected && (
          <div className="space-y-4">
            <p className="text-small text-text-secondary">Strategy: <span className="font-medium text-text-primary">{selected.name}</span></p>
            <Input label="Amount ($)" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" required />
            <Input label="Allocation date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
          </div>
        )}

        {step === "notes" && (
          <div className="space-y-4">
            <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any prior communications, terms, or context..." rows={4} />
            {error && <p className="text-small text-negative">{error}</p>}
          </div>
        )}

        {step === "saving" && <p className="text-small text-text-secondary">Saving allocation...</p>}

        <div className="flex items-center justify-between mt-6 gap-2">
          <Button variant="ghost"
            onClick={() => {
              if (step === "details") setStep("select");
              else if (step === "notes") setStep("details");
              else handleClose();
            }}
            disabled={step === "saving"}
          >
            {step === "select" ? "Cancel" : "Back"}
          </Button>
          {step === "select" && <Button onClick={() => setStep("details")} disabled={!selected}>Next</Button>}
          {step === "details" && <Button onClick={() => setStep("notes")} disabled={!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !eventDate}>Next</Button>}
          {step === "notes" && <Button onClick={handleSubmit}>Claim Allocation</Button>}
        </div>
      </Modal>
    </>
  );
}
