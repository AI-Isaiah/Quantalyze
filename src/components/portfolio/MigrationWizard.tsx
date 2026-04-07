"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

interface MigrationWizardButtonProps {
  portfolioId: string;
}

type Step = "select" | "details" | "notes" | "saving";
type StrategyOption = { id: string; name: string };

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
    if (!isOpen || selected || query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("strategies")
        .select("id, name")
        .ilike("name", `%${query.trim()}%`)
        .eq("status", "published")
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
    if (psError) { setError(psError.message); setStep("notes"); return; }

    const { error: evError } = await supabase.from("allocation_events").insert({
      portfolio_id: portfolioId, strategy_id: selected.id, event_type: "deposit",
      amount: parsed, event_date: eventDate, notes: notes.trim() || null, source: "manual",
    });
    if (evError) { setError(evError.message); setStep("notes"); return; }

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
        <p className="text-xs text-text-muted mb-4">Step {stepNum} of 3</p>

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
                      className="block w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-page transition-colors">
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!selected && query.trim().length >= 2 && results.length === 0 && (
              <p className="text-xs text-text-muted">No published strategies match. Try a different name.</p>
            )}
          </div>
        )}

        {step === "details" && selected && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Strategy: <span className="font-medium text-text-primary">{selected.name}</span></p>
            <Input label="Amount ($)" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" required />
            <Input label="Allocation date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
          </div>
        )}

        {step === "notes" && (
          <div className="space-y-4">
            <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any prior communications, terms, or context..." rows={4} />
            {error && <p className="text-sm text-negative">{error}</p>}
          </div>
        )}

        {step === "saving" && <p className="text-sm text-text-secondary">Saving allocation...</p>}

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
