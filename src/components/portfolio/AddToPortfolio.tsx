"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

interface Portfolio {
  id: string;
  name: string;
}

export function AddToPortfolio({ strategyId }: { strategyId: string }) {
  const [open, setOpen] = useState(false);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    async function fetchPortfolios() {
      setLoading(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from("portfolios")
        .select("id, name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setPortfolios(data ?? []);
      setLoading(false);
    }
    fetchPortfolios();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleAdd(portfolioId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("portfolio_strategies").insert({
      portfolio_id: portfolioId,
      strategy_id: strategyId,
    });

    if (error) {
      if (error.code === "23505") {
        setFeedback("Already in portfolio");
      } else {
        setFeedback("Failed to add");
      }
    } else {
      setFeedback("Added!");
    }

    setTimeout(() => {
      setFeedback(null);
      setOpen(false);
    }, 1500);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <Button variant="secondary" onClick={() => setOpen(!open)}>
        <svg
          className="h-4 w-4 mr-1.5"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
        Portfolio
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border bg-surface shadow-elevated z-50">
          {feedback ? (
            <div className="px-4 py-3 text-sm text-center text-positive font-medium">
              {feedback}
            </div>
          ) : loading ? (
            <div className="px-4 py-3 text-sm text-text-muted text-center">
              Loading...
            </div>
          ) : portfolios.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted text-center">
              No portfolios yet.
              <a
                href="/portfolios"
                className="block mt-1 text-accent hover:underline"
              >
                Create one
              </a>
            </div>
          ) : (
            <div className="py-1">
              {portfolios.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAdd(p.id)}
                  className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-page transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
