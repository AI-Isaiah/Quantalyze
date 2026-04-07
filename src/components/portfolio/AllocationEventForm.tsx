"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Card } from "@/components/ui/Card";

interface AllocationEventFormProps {
  portfolioId: string;
  strategies: { strategy_id: string; strategy_name: string }[];
}

export function AllocationEventForm({ portfolioId, strategies }: AllocationEventFormProps) {
  const router = useRouter();
  const [strategyId, setStrategyId] = useState(strategies[0]?.strategy_id ?? "");
  const [eventType, setEventType] = useState<"deposit" | "withdrawal">("deposit");
  const [amount, setAmount] = useState("");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!strategyId || !eventDate || isNaN(parsed) || parsed <= 0) return;

    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("allocation_events").insert({
      portfolio_id: portfolioId,
      strategy_id: strategyId,
      event_type: eventType,
      amount: parsed,
      event_date: eventDate,
      notes: notes.trim() || null,
      source: "manual",
    });

    if (insertError) {
      setError("Failed to record event. Please try again.");
      setStatus("error");
      return;
    }

    setAmount("");
    setNotes("");
    setStatus("idle");
    router.refresh();
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Strategy" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} required
            options={strategies.map((s) => ({ value: s.strategy_id, label: s.strategy_name }))}
          />
          <Select
            label="Event Type" value={eventType}
            onChange={(e) => setEventType(e.target.value as "deposit" | "withdrawal")}
            options={[{ value: "deposit", label: "Deposit" }, { value: "withdrawal", label: "Withdrawal" }]}
          />
          <Input label="Amount ($)" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" required />
          <Input label="Date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
        </div>
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for allocation change..." rows={2} />
        {error && <p className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={status === "loading" || !amount || parseFloat(amount) <= 0}>
            {status === "loading" ? "Saving..." : "Record Event"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
