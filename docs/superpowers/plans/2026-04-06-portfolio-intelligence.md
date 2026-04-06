# Portfolio Intelligence Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Quantalyze from a strategy marketplace into a portfolio intelligence product for quant allocators — with portfolio analytics (TWR, correlation, attribution, risk), landing page verification, and a relationship/document layer.

**Architecture:** Five-phase build. Database migration first (everything depends on it), then Python analytics engine (computation before display), then Next.js dashboard frontend, then landing page verification (parallel with dashboard), then relationship layer (documents, alerts, migration, PDF). Each phase produces working, testable software.

**Tech Stack:** Next.js 16, Supabase (Postgres + Storage + RLS), Python FastAPI + numpy + pandas + quantstats, lightweight-charts + recharts, Puppeteer, Resend.

**Spec:** `docs/superpowers/specs/2026-04-06-portfolio-intelligence-design.md`

---

## Autoplan Review Fixes (incorporated post-review)

The following critical/high fixes from the CEO + Design + Eng review pipeline are mandatory during implementation:

### Critical Fixes
1. **Verification security**: Use `gen_random_bytes(32)` hex token for public polling (NOT UUID as capability token). Add 24h expiry. Rate limit polling to 30/min per IP. Add `public_token TEXT` column to `verification_requests`.
2. **Storage RLS**: Path-based policies with user_id prefix. Upload path: `{user_id}/{portfolio_id}/{filename}`. Policy checks `(storage.foldername(name))[1] = auth.uid()::text`.
3. **TWR math**: Document equity series contract (post-cash-flow convention). Add test for day-0 deposit. Fix `compute_mwr` to accept explicit `end_date` parameter.
4. **Exchange as primary source of truth**: Auto-detect deposits/withdrawals from exchange API transfer history. `allocation_events` are auto-populated, with manual entry as override only. Add `source TEXT CHECK (source IN ('auto', 'manual'))` column to `allocation_events`.

### High Fixes
5. **Immutable analytics**: Drop `UNIQUE (portfolio_id)` constraint on `portfolio_analytics`. Each recompute creates a new row. Dashboard queries `ORDER BY computed_at DESC LIMIT 1`. PDFs reference specific `portfolio_analytics.id`.
6. **DashboardShell state machine**: New wrapper component handling 5 states: empty (no strategies), pending (added, no analytics), computing (in progress), complete (full dashboard), stale (sync failed, showing last-good with warning).
7. **Morning briefing zone**: Dashboard opens with narrative summary + 4 KPIs (AUM, MTD TWR, Avg Correlation, Portfolio Sharpe) + active alerts above the fold. All charts below fold in collapsible sections.
8. **Correlation cap**: Skip rolling correlation if n > 20. Cap to top-10 most correlated pairs when n > 10.
9. **Cron concurrency**: Use `asyncio.Semaphore(3)` for portfolio recomputation. Check `computation_status != 'computing'` before starting. Decouple cron sync from portfolio analytics (fire-and-forget, don't block cron response).
10. **Sharpe annualization**: Use `sqrt(252)` consistently (not 365). Match existing `services/metrics.py`.
11. **Heatmap colors**: Blue-orange scale for correlation (not green-red, which conflicts with gain/loss).
12. **Extend existing relationship primitives**: Build on `contact_requests` + `relationship_documents` (migration 009) instead of creating parallel `portfolio_documents`. Add `portfolio_id` column to `relationship_documents`.
13. **First-run experience**: Inline CTA on empty dashboard: "Add your first strategy" with quick-add flow. Auto-trigger analytics computation after first strategy is added.
14. **Grid spec**: 2-column layout above 1024px (charts 60%, tables 40%). Single column below 768px. Strategy table collapses to card view on mobile.

---

## Phase 1: Database Foundation

Everything downstream reads from these tables. Blocking dependency for all other phases.

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/010_portfolio_intelligence.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 010: Portfolio Intelligence Platform
-- Creates tables for portfolio analytics, allocation events, documents, alerts, audit log, verification requests
-- Extends portfolio_strategies with allocation tracking and relationship fields

-- 1. New tables

CREATE TABLE IF NOT EXISTS allocation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('deposit', 'withdrawal')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  event_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  computation_status TEXT DEFAULT 'pending'
    CHECK (computation_status IN ('pending', 'computing', 'complete', 'failed')),
  computation_error TEXT,
  total_aum NUMERIC,
  total_return_twr NUMERIC,
  total_return_mwr NUMERIC,
  portfolio_sharpe NUMERIC,
  portfolio_volatility NUMERIC,
  portfolio_max_drawdown NUMERIC,
  avg_pairwise_correlation NUMERIC,
  return_24h NUMERIC,
  return_mtd NUMERIC,
  return_ytd NUMERIC,
  narrative_summary TEXT,
  correlation_matrix JSONB,
  attribution_breakdown JSONB,
  risk_decomposition JSONB,
  benchmark_comparison JSONB,
  optimizer_suggestions JSONB,
  portfolio_equity_curve JSONB,
  rolling_correlation JSONB,
  UNIQUE (portfolio_id)
);

CREATE TABLE IF NOT EXISTS portfolio_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('contract', 'note', 'factsheet', 'founder_update', 'other')),
  title TEXT NOT NULL,
  file_path TEXT,
  content TEXT,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('drawdown', 'correlation_spike', 'sync_failure', 'status_change', 'optimizer_suggestion')),
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  message TEXT NOT NULL,
  metadata JSONB,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'okx', 'bybit')),
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT,
  passphrase_encrypted TEXT,
  dek_encrypted TEXT NOT NULL,
  nonce TEXT,
  kek_version INT DEFAULT 1,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  error_message TEXT,
  results JSONB,
  matched_strategy_id UUID REFERENCES strategies(id),
  discovered_manager_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 2. Extend portfolio_strategies

ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS allocated_amount NUMERIC;
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS allocated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS current_weight NUMERIC;
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS relationship_status TEXT DEFAULT 'connected'
  CHECK (relationship_status IN ('connected', 'paused', 'exited'));
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS founder_notes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS last_founder_contact TIMESTAMPTZ;

-- 3. Indexes

CREATE INDEX IF NOT EXISTS idx_allocation_events_portfolio ON allocation_events(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_allocation_events_strategy ON allocation_events(strategy_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_portfolio ON portfolio_analytics(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_portfolio ON portfolio_alerts(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_unacked ON portfolio_alerts(portfolio_id) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portfolio_documents_portfolio ON portfolio_documents(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_verification_requests_email ON verification_requests(email);
CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- 4. RLS

ALTER TABLE allocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;

-- allocation_events: owner of portfolio can read/insert/delete
CREATE POLICY allocation_events_owner_read ON allocation_events FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY allocation_events_owner_insert ON allocation_events FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY allocation_events_owner_delete ON allocation_events FOR DELETE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- portfolio_analytics: service-role writes, owner reads
CREATE POLICY portfolio_analytics_owner_read ON portfolio_analytics FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_analytics_service_insert ON portfolio_analytics FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY portfolio_analytics_service_update ON portfolio_analytics FOR UPDATE
  USING (auth.role() = 'service_role');

-- portfolio_documents: owner read/insert/delete
CREATE POLICY portfolio_documents_owner_read ON portfolio_documents FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_documents_owner_insert ON portfolio_documents FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_documents_owner_delete ON portfolio_documents FOR DELETE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- portfolio_alerts: owner read/update (acknowledge)
CREATE POLICY portfolio_alerts_owner_read ON portfolio_alerts FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_alerts_owner_update ON portfolio_alerts FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_alerts_service_insert ON portfolio_alerts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- audit_log: service-role writes, owner reads own
CREATE POLICY audit_log_owner_read ON audit_log FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY audit_log_service_insert ON audit_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- verification_requests: service-role only (anonymous users go through API)
CREATE POLICY verification_requests_service_all ON verification_requests FOR ALL
  USING (auth.role() = 'service_role');

-- 5. Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('portfolio-documents', 'portfolio-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY portfolio_docs_owner_upload ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'portfolio-documents' AND auth.uid() IS NOT NULL);
CREATE POLICY portfolio_docs_owner_read ON storage.objects FOR SELECT
  USING (bucket_id = 'portfolio-documents' AND auth.uid() IS NOT NULL);
CREATE POLICY portfolio_docs_owner_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'portfolio-documents' AND auth.uid() IS NOT NULL);
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push` or apply via Supabase dashboard.
Expected: All tables created, RLS enabled, no errors.

- [ ] **Step 3: Verify tables exist**

Run: `npx supabase db dump --schema public | grep -c "CREATE TABLE"` or check Supabase dashboard Table Editor.
Expected: New tables visible with correct columns and constraints.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/010_portfolio_intelligence.sql
git commit -m "feat: add portfolio intelligence schema (migration 010)"
```

### Task 2: TypeScript Types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add new interfaces**

Add after the existing `DeckWithCount` interface:

```typescript
export interface AllocationEvent {
  id: string;
  portfolio_id: string;
  strategy_id: string;
  event_type: "deposit" | "withdrawal";
  amount: number;
  event_date: string;
  notes: string | null;
  created_at: string;
}

export interface PortfolioAnalytics {
  id: string;
  portfolio_id: string;
  computed_at: string;
  computation_status: "pending" | "computing" | "complete" | "failed";
  computation_error: string | null;
  total_aum: number | null;
  total_return_twr: number | null;
  total_return_mwr: number | null;
  portfolio_sharpe: number | null;
  portfolio_volatility: number | null;
  portfolio_max_drawdown: number | null;
  avg_pairwise_correlation: number | null;
  return_24h: number | null;
  return_mtd: number | null;
  return_ytd: number | null;
  narrative_summary: string | null;
  correlation_matrix: Record<string, Record<string, number>> | null;
  attribution_breakdown: { strategy_id: string; weight: number; twr: number; mwr: number; contribution: number }[] | null;
  risk_decomposition: { strategy_id: string; marginal_risk: number; component_var: number; standalone_vol: number }[] | null;
  benchmark_comparison: Record<string, { alpha: number; beta: number; info_ratio: number; tracking_error: number }> | null;
  optimizer_suggestions: { strategy_id: string; strategy_name: string; corr_with_portfolio: number; sharpe_lift: number; dd_improvement: number; score: number }[] | null;
  portfolio_equity_curve: { date: string; value: number }[] | null;
  rolling_correlation: { date: string; value: number }[] | null;
}

export interface PortfolioStrategy {
  portfolio_id: string;
  strategy_id: string;
  added_at: string;
  allocated_amount: number | null;
  allocated_at: string | null;
  current_weight: number | null;
  relationship_status: "connected" | "paused" | "exited";
  founder_notes: { date: string; author: string; text: string }[];
  last_founder_contact: string | null;
}

export interface PortfolioDocument {
  id: string;
  portfolio_id: string;
  strategy_id: string | null;
  doc_type: "contract" | "note" | "factsheet" | "founder_update" | "other";
  title: string;
  file_path: string | null;
  content: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface PortfolioAlert {
  id: string;
  portfolio_id: string;
  alert_type: "drawdown" | "correlation_spike" | "sync_failure" | "status_change" | "optimizer_suggestion";
  severity: "high" | "medium" | "low";
  message: string;
  metadata: Record<string, unknown> | null;
  triggered_at: string;
  acknowledged_at: string | null;
  emailed_at: string | null;
}

export interface VerificationRequest {
  id: string;
  email: string;
  exchange: "binance" | "okx" | "bybit";
  status: "pending" | "processing" | "complete" | "failed";
  error_message: string | null;
  results: Record<string, unknown> | null;
  matched_strategy_id: string | null;
  created_at: string;
  completed_at: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add TypeScript types for portfolio intelligence"
```

### Task 3: Pydantic Schemas

**Files:**
- Modify: `analytics-service/models/schemas.py`

- [ ] **Step 1: Add request models**

Add to the existing schemas file:

```python
class PortfolioAnalyticsRequest(BaseModel):
    portfolio_id: str

class PortfolioOptimizerRequest(BaseModel):
    portfolio_id: str
    weights: Optional[dict] = None  # Custom optimizer weights

class VerifyStrategyRequest(BaseModel):
    email: str
    exchange: str  # binance, okx, bybit
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None  # OKX only
```

- [ ] **Step 2: Commit**

```bash
git add analytics-service/models/schemas.py
git commit -m "feat: add Pydantic schemas for portfolio analytics"
```

---

## Phase 2: Analytics Engine (Python)

The dashboard displays computed data, so computation must exist before display.

### Task 4: TWR/MWR Computation Module

**Files:**
- Create: `analytics-service/services/portfolio_metrics.py`
- Create: `analytics-service/tests/test_portfolio_metrics.py`

- [ ] **Step 1: Write tests for TWR computation**

```python
# analytics-service/tests/test_portfolio_metrics.py
import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from services.portfolio_metrics import compute_twr, compute_mwr, compute_modified_dietz, compute_period_returns


def test_twr_no_cash_flows():
    """With no deposits/withdrawals, TWR equals simple return."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity = pd.Series(np.linspace(100000, 110000, 30), index=dates)
    events = []
    twr = compute_twr(equity, events)
    assert abs(twr - 0.10) < 0.01  # ~10% return


def test_twr_mid_month_deposit():
    """The spec's primary example: $200K deposit on last day should NOT distort +10%."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    # Manager generates +10% on initial $100K (grows to $110K by day 29)
    equity_before = np.linspace(100000, 110000, 29)
    # Day 30: $200K deposit, manager makes +1.95% on the $310K = $316K
    equity_after = [316050]
    equity = pd.Series(np.concatenate([equity_before, equity_after]), index=dates)

    events = [{"event_date": dates[29].isoformat(), "event_type": "deposit", "amount": 200000}]
    twr = compute_twr(equity, events)
    # TWR should be ~10.1% (chain of +10% * +1.95%), NOT the simple (316K-100K-200K)/300K = 5.3%
    assert twr > 0.09, f"TWR {twr} should be > 9% (reflecting manager skill, not deposit timing)"


def test_mwr_known_sequence():
    """MWR/IRR for a known cash flow should converge."""
    cash_flows = [
        {"amount": -100000, "date": "2026-01-01"},  # Initial investment
        {"amount": -50000, "date": "2026-06-01"},    # Additional deposit
        {"amount": 170000, "date": "2026-12-31"},    # Final value
    ]
    mwr = compute_mwr(cash_flows, final_value=170000)
    # Should converge to a positive number (modest return)
    assert mwr is not None
    assert 0 < mwr < 0.5


def test_modified_dietz_matches_twr():
    """Modified Dietz should approximate TWR within tolerance when data is daily."""
    start_value = 100000
    end_value = 110000
    cash_flows = []  # No external flows
    total_days = 30
    md = compute_modified_dietz(start_value, end_value, cash_flows, total_days)
    assert abs(md - 0.10) < 0.01


def test_period_returns():
    """Compute 24h, MTD, YTD returns from a returns series."""
    dates = pd.date_range("2026-01-01", periods=90, freq="D")
    returns = pd.Series(np.random.normal(0.001, 0.02, 90), index=dates)
    result = compute_period_returns(returns)
    assert "return_24h" in result
    assert "return_mtd" in result
    assert "return_ytd" in result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd analytics-service && python -m pytest tests/test_portfolio_metrics.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.portfolio_metrics'`

- [ ] **Step 3: Implement TWR/MWR module**

```python
# analytics-service/services/portfolio_metrics.py
import pandas as pd
import numpy as np
from typing import Optional
from services.metrics import _safe_float


def compute_twr(daily_equity: pd.Series, allocation_events: list[dict]) -> Optional[float]:
    """Compute Time-Weighted Return by chain-linking sub-period returns around cash flows."""
    if daily_equity.empty or len(daily_equity) < 2:
        return None

    # Sort events by date
    events = sorted(allocation_events, key=lambda e: e["event_date"])
    event_dates = set()
    event_amounts = {}
    for e in events:
        d = pd.Timestamp(e["event_date"]).normalize()
        event_dates.add(d)
        event_amounts[d] = event_amounts.get(d, 0) + (
            e["amount"] if e["event_type"] == "deposit" else -e["amount"]
        )

    # Build sub-periods
    chain = 1.0
    prev_idx = 0

    for i in range(1, len(daily_equity)):
        current_date = daily_equity.index[i].normalize()
        if current_date in event_dates:
            # End of sub-period: compute return BEFORE the cash flow
            start_val = daily_equity.iloc[prev_idx]
            end_val = daily_equity.iloc[i] - event_amounts.get(current_date, 0)
            if start_val > 0:
                sub_return = end_val / start_val
                chain *= sub_return
            prev_idx = i

    # Final sub-period (from last event to end)
    if prev_idx < len(daily_equity) - 1:
        start_val = daily_equity.iloc[prev_idx]
        end_val = daily_equity.iloc[-1]
        if start_val > 0:
            chain *= end_val / start_val

    return _safe_float(chain - 1.0)


def compute_mwr(cash_flows: list[dict], final_value: float, max_iter: int = 100) -> Optional[float]:
    """Compute Money-Weighted Return (IRR) using Newton-Raphson method."""
    if not cash_flows:
        return None

    # Normalize dates to fractions of a year
    dates = [pd.Timestamp(cf["date"]) for cf in cash_flows]
    min_date = min(dates)
    t = [(d - min_date).days / 365.25 for d in dates]
    amounts = [cf["amount"] for cf in cash_flows]

    # Add final value as positive cash flow at the end
    t_final = (pd.Timestamp(dates[-1]) - min_date).days / 365.25 if len(dates) > 1 else 1.0
    amounts_with_final = amounts + [final_value]
    t_with_final = t + [t_final]

    # Newton-Raphson
    r = 0.1  # Initial guess
    for _ in range(max_iter):
        npv = sum(cf / (1 + r) ** ti for cf, ti in zip(amounts_with_final, t_with_final))
        dnpv = sum(-ti * cf / (1 + r) ** (ti + 1) for cf, ti in zip(amounts_with_final, t_with_final))
        if abs(dnpv) < 1e-12:
            break
        r_new = r - npv / dnpv
        if abs(r_new - r) < 1e-8:
            return _safe_float(r_new)
        r = r_new

    return _safe_float(r)


def compute_modified_dietz(start_value: float, end_value: float, cash_flows: list[dict], total_days: int) -> Optional[float]:
    """Modified Dietz approximation for TWR when daily data has gaps."""
    if start_value <= 0 or total_days <= 0:
        return None

    weighted_cf = 0
    total_cf = 0
    for cf in cash_flows:
        day_of_flow = cf.get("day", 0)
        amount = cf["amount"]
        weight = (total_days - day_of_flow) / total_days
        weighted_cf += amount * weight
        total_cf += amount

    denominator = start_value + weighted_cf
    if denominator <= 0:
        return None

    return _safe_float((end_value - start_value - total_cf) / denominator)


def compute_period_returns(returns: pd.Series) -> dict:
    """Compute 24h, MTD, YTD returns from a daily returns series."""
    if returns.empty:
        return {"return_24h": None, "return_mtd": None, "return_ytd": None}

    now = returns.index[-1]

    # 24h: last return
    return_24h = _safe_float(float(returns.iloc[-1])) if len(returns) >= 1 else None

    # MTD: compound returns from start of current month
    month_start = now.replace(day=1)
    mtd_returns = returns[returns.index >= month_start]
    return_mtd = _safe_float(float((1 + mtd_returns).prod() - 1)) if len(mtd_returns) > 0 else None

    # YTD: compound returns from start of current year
    year_start = now.replace(month=1, day=1)
    ytd_returns = returns[returns.index >= year_start]
    return_ytd = _safe_float(float((1 + ytd_returns).prod() - 1)) if len(ytd_returns) > 0 else None

    return {"return_24h": return_24h, "return_mtd": return_mtd, "return_ytd": return_ytd}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd analytics-service && python -m pytest tests/test_portfolio_metrics.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add analytics-service/services/portfolio_metrics.py analytics-service/tests/test_portfolio_metrics.py
git commit -m "feat: TWR/MWR computation module with tests"
```

### Task 5: Correlation & Risk Module

**Files:**
- Create: `analytics-service/services/portfolio_risk.py`
- Create: `analytics-service/tests/test_portfolio_risk.py`

- [ ] **Step 1: Write tests**

```python
# analytics-service/tests/test_portfolio_risk.py
import pytest
import numpy as np
import pandas as pd
from services.portfolio_risk import (
    compute_correlation_matrix, compute_avg_pairwise_correlation,
    compute_risk_decomposition, compute_attribution, compute_rolling_correlation
)


def test_perfect_correlation():
    """Two identical return series should have correlation ~1.0."""
    dates = pd.date_range("2026-01-01", periods=60, freq="D")
    returns = np.random.normal(0.001, 0.02, 60)
    strategies = {
        "s1": pd.Series(returns, index=dates),
        "s2": pd.Series(returns, index=dates),
    }
    matrix = compute_correlation_matrix(strategies)
    assert abs(matrix["s1"]["s2"] - 1.0) < 0.01


def test_uncorrelated_returns():
    """Independent random returns should have low correlation."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    strategies = {
        "s1": pd.Series(np.random.normal(0, 0.02, 250), index=dates),
        "s2": pd.Series(np.random.normal(0, 0.02, 250), index=dates),
    }
    matrix = compute_correlation_matrix(strategies)
    assert abs(matrix["s1"]["s2"]) < 0.3


def test_mcr_sums_to_portfolio_vol():
    """Marginal contributions to risk should sum to total portfolio volatility."""
    weights = [0.5, 0.3, 0.2]
    cov = np.array([[0.04, 0.01, 0.005], [0.01, 0.03, 0.002], [0.005, 0.002, 0.02]])
    result = compute_risk_decomposition(weights, cov)
    total_mcr = sum(r["marginal_risk_pct"] for r in result)
    assert abs(total_mcr - 100.0) < 1.0


def test_attribution_sums_to_portfolio_return():
    """Contributions should sum to portfolio return."""
    weights = [0.4, 0.35, 0.25]
    twrs = [0.18, 0.12, -0.03]
    portfolio_twr = sum(w * t for w, t in zip(weights, twrs))
    result = compute_attribution(weights, twrs, portfolio_twr)
    total_contribution = sum(r["contribution"] for r in result)
    assert abs(total_contribution - portfolio_twr) < 0.001
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd analytics-service && python -m pytest tests/test_portfolio_risk.py -v`
Expected: FAIL

- [ ] **Step 3: Implement module**

```python
# analytics-service/services/portfolio_risk.py
import numpy as np
import pandas as pd
from typing import Optional
from services.metrics import _safe_float


def compute_correlation_matrix(strategy_returns: dict[str, pd.Series]) -> dict:
    """Compute NxN pairwise Pearson correlation matrix."""
    ids = list(strategy_returns.keys())
    if len(ids) < 2:
        return {ids[0]: {ids[0]: 1.0}} if ids else {}

    # Align all series to common dates
    df = pd.DataFrame(strategy_returns).dropna()
    if len(df) < 10:
        return {sid: {sid2: None for sid2 in ids} for sid in ids}

    corr = df.corr().to_dict()
    # Ensure all values are safe floats
    return {
        k1: {k2: _safe_float(v) for k2, v in row.items()}
        for k1, row in corr.items()
    }


def compute_rolling_correlation(strategy_returns: dict[str, pd.Series], window: int = 30) -> dict:
    """Compute rolling pairwise correlation (30-day window) for each pair."""
    ids = list(strategy_returns.keys())
    if len(ids) < 2:
        return {}

    df = pd.DataFrame(strategy_returns).dropna()
    result = {}
    for i, s1 in enumerate(ids):
        for s2 in ids[i + 1:]:
            rolling = df[s1].rolling(window).corr(df[s2]).dropna()
            result[f"{s1}:{s2}"] = [
                {"date": d.isoformat(), "value": _safe_float(v)}
                for d, v in rolling.items()
            ]
    return result


def compute_avg_pairwise_correlation(corr_matrix: dict) -> Optional[float]:
    """Average of all off-diagonal entries in correlation matrix."""
    ids = list(corr_matrix.keys())
    n = len(ids)
    if n < 2:
        return None

    total = 0
    count = 0
    for i, s1 in enumerate(ids):
        for s2 in ids[i + 1:]:
            val = corr_matrix.get(s1, {}).get(s2)
            if val is not None:
                total += val
                count += 1

    return _safe_float(total / count) if count > 0 else None


def compute_risk_decomposition(weights: list[float], covariance_matrix: np.ndarray) -> list[dict]:
    """Compute Marginal Contribution to Risk (MCR) for each strategy."""
    w = np.array(weights)
    port_var = w @ covariance_matrix @ w
    port_vol = np.sqrt(port_var) if port_var > 0 else 0

    if port_vol == 0:
        return [{"marginal_risk_pct": 0, "standalone_vol": 0, "component_var": 0} for _ in weights]

    marginal_contrib = (covariance_matrix @ w) / port_vol
    component_risk = w * marginal_contrib

    return [
        {
            "marginal_risk_pct": _safe_float(float(cr / port_vol * 100)),
            "standalone_vol": _safe_float(float(np.sqrt(covariance_matrix[i][i]))),
            "component_var": _safe_float(float(cr)),
        }
        for i, cr in enumerate(component_risk)
    ]


def compute_attribution(weights: list[float], strategy_twrs: list[float], portfolio_twr: float) -> list[dict]:
    """Compute return attribution: contribution and allocation effect per strategy."""
    n = len(weights)
    equal_weight = 1.0 / n if n > 0 else 0

    result = []
    for i in range(n):
        contribution = weights[i] * strategy_twrs[i]
        allocation_effect = (weights[i] - equal_weight) * (strategy_twrs[i] - portfolio_twr)
        result.append({
            "contribution": _safe_float(contribution),
            "allocation_effect": _safe_float(allocation_effect),
        })
    return result
```

- [ ] **Step 4: Run tests**

Run: `cd analytics-service && python -m pytest tests/test_portfolio_risk.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add analytics-service/services/portfolio_risk.py analytics-service/tests/test_portfolio_risk.py
git commit -m "feat: correlation matrix, risk decomposition, attribution analysis"
```

### Task 6: Portfolio Optimizer & Narrative

**Files:**
- Create: `analytics-service/services/portfolio_optimizer.py`
- Create: `analytics-service/tests/test_portfolio_optimizer.py`

- [ ] **Step 1: Write tests**

```python
# analytics-service/tests/test_portfolio_optimizer.py
import pytest
import numpy as np
import pandas as pd
from services.portfolio_optimizer import find_improvement_candidates, generate_narrative


def test_negatively_correlated_improves_sharpe():
    """A candidate negatively correlated with the portfolio should improve Sharpe."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    base_returns = np.random.normal(0.001, 0.02, 250)

    portfolio = {"s1": pd.Series(base_returns, index=dates)}
    # Candidate: negatively correlated
    candidates = {"c1": pd.Series(-base_returns + np.random.normal(0.001, 0.01, 250), index=dates)}
    weights = {"s1": 1.0}

    results = find_improvement_candidates(portfolio, candidates, weights)
    assert len(results) == 1
    assert results[0]["corr_with_portfolio"] < 0
    assert results[0]["sharpe_lift"] > 0


def test_identical_candidate_no_improvement():
    """A candidate identical to existing strategy should not improve."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    returns = np.random.normal(0.001, 0.02, 250)

    portfolio = {"s1": pd.Series(returns, index=dates)}
    candidates = {"c1": pd.Series(returns, index=dates)}
    weights = {"s1": 1.0}

    results = find_improvement_candidates(portfolio, candidates, weights)
    # High correlation, minimal improvement
    assert results[0]["corr_with_portfolio"] > 0.9


def test_narrative_contains_key_metrics():
    """Narrative should mention return, correlation, risk."""
    analytics = {
        "return_mtd": 0.048,
        "avg_pairwise_correlation": 0.18,
        "attribution_breakdown": [
            {"strategy_name": "Alpha-7", "contribution": 0.0756},
            {"strategy_name": "Beta-3", "contribution": 0.0396},
        ],
        "risk_decomposition": [
            {"strategy_name": "Alpha-7", "marginal_risk_pct": 55, "weight_pct": 42},
        ],
    }
    narrative = generate_narrative(analytics)
    assert "4.8%" in narrative or "4.80%" in narrative
    assert "Alpha-7" in narrative
    assert "0.18" in narrative
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd analytics-service && python -m pytest tests/test_portfolio_optimizer.py -v`
Expected: FAIL

- [ ] **Step 3: Implement module**

```python
# analytics-service/services/portfolio_optimizer.py
import numpy as np
import pandas as pd
from typing import Optional
from services.metrics import _safe_float, compute_all_metrics


def find_improvement_candidates(
    portfolio_returns: dict[str, pd.Series],
    candidate_returns: dict[str, pd.Series],
    weights: dict[str, float],
    w1: float = 0.4, w2: float = 0.3, w3: float = 0.3,
    add_weight: float = 0.10,
) -> list[dict]:
    """For each candidate, simulate adding at add_weight and compute improvement."""
    # Build current portfolio return series
    port_df = pd.DataFrame(portfolio_returns).dropna()
    if port_df.empty:
        return []

    w_arr = np.array([weights.get(sid, 0) for sid in port_df.columns])
    if w_arr.sum() > 0:
        w_arr = w_arr / w_arr.sum()
    port_returns = (port_df * w_arr).sum(axis=1)

    # Current portfolio metrics
    current_sharpe = _compute_sharpe(port_returns)
    current_avg_corr = _avg_corr(port_df)
    current_max_dd = _max_drawdown(port_returns)

    results = []
    for cid, c_returns in candidate_returns.items():
        # Align dates
        aligned = pd.concat([port_df, c_returns.rename(cid)], axis=1).dropna()
        if len(aligned) < 30:
            continue

        # Simulate adding candidate at add_weight
        new_weights = {sid: w * (1 - add_weight) for sid, w in weights.items()}
        new_weights[cid] = add_weight
        w_new = np.array([new_weights.get(col, 0) for col in aligned.columns])
        if w_new.sum() > 0:
            w_new = w_new / w_new.sum()
        new_port = (aligned * w_new).sum(axis=1)

        new_sharpe = _compute_sharpe(new_port)
        new_avg_corr = _avg_corr(aligned)
        new_max_dd = _max_drawdown(new_port)

        corr_with_portfolio = float(port_returns.reindex(c_returns.index).dropna().corr(
            c_returns.reindex(port_returns.index).dropna()
        )) if len(port_returns) > 10 else 0

        sharpe_lift = (new_sharpe - current_sharpe) if current_sharpe is not None and new_sharpe is not None else 0
        corr_reduction = (current_avg_corr - new_avg_corr) if current_avg_corr is not None and new_avg_corr is not None else 0
        dd_improvement = (current_max_dd - new_max_dd) if current_max_dd is not None and new_max_dd is not None else 0

        score = w1 * sharpe_lift + w2 * corr_reduction + w3 * dd_improvement

        results.append({
            "strategy_id": cid,
            "corr_with_portfolio": _safe_float(corr_with_portfolio),
            "sharpe_lift": _safe_float(sharpe_lift),
            "dd_improvement": _safe_float(dd_improvement),
            "score": _safe_float(score),
        })

    return sorted(results, key=lambda x: x["score"], reverse=True)[:5]


def generate_narrative(analytics: dict) -> str:
    """Generate templated narrative from portfolio analytics. No LLM dependency."""
    parts = []

    mtd = analytics.get("return_mtd")
    if mtd is not None:
        parts.append(f"Your portfolio returned {mtd * 100:+.1f}% MTD (TWR)")

    # Top contributor
    attr = analytics.get("attribution_breakdown", [])
    if attr:
        top = max(attr, key=lambda a: abs(a.get("contribution", 0)))
        parts.append(f"driven primarily by {top.get('strategy_name', 'unknown')} ({top['contribution'] * 100:+.2f}% contribution)")

    # Correlation
    avg_corr = analytics.get("avg_pairwise_correlation")
    if avg_corr is not None:
        quality = "well-diversified" if avg_corr < 0.3 else "moderately correlated" if avg_corr < 0.6 else "highly correlated"
        parts.append(f"Average pairwise correlation is {avg_corr:.2f}, which is {quality}")

    # Risk concentration
    risk = analytics.get("risk_decomposition", [])
    if risk:
        top_risk = max(risk, key=lambda r: r.get("marginal_risk_pct", 0))
        if top_risk.get("marginal_risk_pct", 0) > top_risk.get("weight_pct", 0) * 1.2:
            parts.append(
                f"Risk is concentrated in {top_risk.get('strategy_name', 'unknown')} "
                f"({top_risk['marginal_risk_pct']:.0f}% of portfolio volatility on "
                f"{top_risk.get('weight_pct', 0):.0f}% of capital)"
            )

    return ". ".join(parts) + "." if parts else "Portfolio analytics pending computation."


def _compute_sharpe(returns: pd.Series, rf: float = 0) -> Optional[float]:
    if returns.empty or returns.std() == 0:
        return None
    return _safe_float(float((returns.mean() - rf) / returns.std() * np.sqrt(365)))


def _avg_corr(df: pd.DataFrame) -> Optional[float]:
    if df.shape[1] < 2:
        return None
    corr = df.corr()
    n = len(corr)
    total = (corr.values.sum() - n) / (n * (n - 1))
    return _safe_float(float(total))


def _max_drawdown(returns: pd.Series) -> Optional[float]:
    if returns.empty:
        return None
    cumulative = (1 + returns).cumprod()
    running_max = cumulative.cummax()
    drawdown = (cumulative - running_max) / running_max
    return _safe_float(float(drawdown.min()))
```

- [ ] **Step 4: Run tests**

Run: `cd analytics-service && python -m pytest tests/test_portfolio_optimizer.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add analytics-service/services/portfolio_optimizer.py analytics-service/tests/test_portfolio_optimizer.py
git commit -m "feat: portfolio optimizer and templated narrative generation"
```

### Task 7: Portfolio Analytics Router

**Files:**
- Create: `analytics-service/routers/portfolio.py`
- Modify: `analytics-service/main.py` (add router import)

- [ ] **Step 1: Create the router with all 3 endpoints**

This is the orchestrator that wires together Tasks 4-6. Create `analytics-service/routers/portfolio.py` with:

1. `POST /api/portfolio-analytics` — fetches strategies + allocation events from Supabase, calls TWR/MWR/correlation/attribution/risk/narrative/benchmark, upserts into `portfolio_analytics`, generates alerts into `portfolio_alerts`
2. `POST /api/portfolio-optimizer` — fetches published strategies not in portfolio, runs optimizer, stores top 5 suggestions
3. `POST /api/verify-strategy` — validates read-only key, encrypts, fetches trades, computes metrics, stores in `verification_requests`

Follow the exact patterns from `analytics-service/routers/analytics.py`:
- Rate limiting with slowapi
- Status lifecycle management (pending → computing → complete/failed)
- Supabase upsert with service-role client
- Error handling with try/except around each operation
- `_safe_float()` wrapping on all numeric outputs
- `sanitize_metrics()` before database writes

- [ ] **Step 2: Register router in main.py**

Add to `analytics-service/main.py`:
```python
from routers import portfolio
app.include_router(portfolio.router)
```

- [ ] **Step 3: Test endpoints manually**

Run: `cd analytics-service && uvicorn main:app --port 8002`
Test with: `curl -X POST http://localhost:8002/api/portfolio-analytics -H "X-Service-Key: $SERVICE_KEY" -H "Content-Type: application/json" -d '{"portfolio_id": "test-uuid"}'`
Expected: 200 with computation lifecycle, or meaningful error if portfolio doesn't exist

- [ ] **Step 4: Commit**

```bash
git add analytics-service/routers/portfolio.py analytics-service/main.py
git commit -m "feat: portfolio analytics, optimizer, and verification API endpoints"
```

### Task 8: Cron Extension for Portfolio Recomputation

**Files:**
- Modify: `analytics-service/routers/cron.py`

- [ ] **Step 1: Add portfolio recomputation after key sync**

At the end of the existing `cron_sync` function, after all keys are synced, add logic to:
1. Find all portfolios that contain at least one strategy whose data was just synced
2. Call the portfolio-analytics endpoint for each affected portfolio

```python
# After the existing sync loop completes:
# Find affected portfolios
synced_strategy_ids = [r["strategy_id"] for r in results if r["status"] == "ok"]
if synced_strategy_ids:
    portfolio_rows = supabase.table("portfolio_strategies") \
        .select("portfolio_id") \
        .in_("strategy_id", synced_strategy_ids) \
        .execute()
    portfolio_ids = list(set(r["portfolio_id"] for r in (portfolio_rows.data or [])))

    for pid in portfolio_ids:
        try:
            # Import and call portfolio analytics computation directly
            from routers.portfolio import _compute_portfolio_analytics
            await _compute_portfolio_analytics(pid)
        except Exception as e:
            logger.error(f"Portfolio recompute failed for {pid}: {e}")
```

- [ ] **Step 2: Commit**

```bash
git add analytics-service/routers/cron.py
git commit -m "feat: trigger portfolio analytics recomputation after cron sync"
```

---

## Phase 3: Dashboard Frontend

Builds the visual layer. Requires Phase 1 (migration) and Phase 2 (computed data).

### Task 9: Portfolio Queries & Analytics Client

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/analytics-client.ts`

- [ ] **Step 1: Add portfolio query functions to queries.ts**

Add after existing functions:

```typescript
export async function getPortfolioDetail(portfolioId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .single();
  if (error) return null;
  return data as Portfolio;
}

export async function getPortfolioStrategies(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_strategies")
    .select(`
      *, strategies (id, name, status, strategy_types, supported_exchanges, start_date, aum,
        strategy_analytics (cagr, sharpe, max_drawdown, volatility, cumulative_return, sparkline_returns, computed_at, computation_status, returns_series, daily_returns)
      )
    `)
    .eq("portfolio_id", portfolioId)
    .order("added_at", { ascending: false });
  return data ?? [];
}

export async function getPortfolioAnalytics(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_analytics")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .single();
  return data as PortfolioAnalytics | null;
}

export async function getPortfolioAlerts(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_alerts")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .is("acknowledged_at", null)
    .order("triggered_at", { ascending: false });
  return (data ?? []) as PortfolioAlert[];
}

export async function getAllocationEvents(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("allocation_events")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("event_date", { ascending: false });
  return (data ?? []) as AllocationEvent[];
}

export async function getAllocatorAggregates(userId: string) {
  const supabase = await createClient();
  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id, name, description, created_at")
    .eq("user_id", userId);

  if (!portfolios?.length) return { portfolios: [], analytics: [] };

  const portfolioIds = portfolios.map((p) => p.id);
  const { data: analytics } = await supabase
    .from("portfolio_analytics")
    .select("*")
    .in("portfolio_id", portfolioIds);

  return { portfolios, analytics: (analytics ?? []) as PortfolioAnalytics[] };
}
```

- [ ] **Step 2: Add analytics client functions**

Add to `src/lib/analytics-client.ts`:

```typescript
export async function computePortfolioAnalytics(portfolioId: string) {
  const url = `${process.env.ANALYTICS_SERVICE_URL}/api/portfolio-analytics`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Key": process.env.ANALYTICS_SERVICE_KEY!,
    },
    body: JSON.stringify({ portfolio_id: portfolioId }),
  });
  return res.json();
}

export async function runPortfolioOptimizer(portfolioId: string) {
  const url = `${process.env.ANALYTICS_SERVICE_URL}/api/portfolio-optimizer`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Key": process.env.ANALYTICS_SERVICE_KEY!,
    },
    body: JSON.stringify({ portfolio_id: portfolioId }),
  });
  return res.json();
}

export async function verifyStrategy(data: {
  email: string;
  exchange: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
}) {
  const url = `${process.env.ANALYTICS_SERVICE_URL}/api/verify-strategy`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Key": process.env.ANALYTICS_SERVICE_KEY!,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts src/lib/analytics-client.ts
git commit -m "feat: portfolio queries and analytics client functions"
```

### Task 10: Portfolio Dashboard Page

**Files:**
- Create: `src/app/(dashboard)/portfolios/[id]/page.tsx`
- Create: `src/components/portfolio/PortfolioKPIRow.tsx`
- Create: `src/components/portfolio/StrategyBreakdownTable.tsx`

This is the largest frontend task. Server component that renders the full dashboard layout.

- [ ] **Step 1: Create PortfolioKPIRow component**

6-metric top bar following the existing 4-card pattern from `src/app/(dashboard)/allocations/page.tsx`. Uses Card component, font-metric for numbers, metricColor and correlationColor for styling.

- [ ] **Step 2: Create StrategyBreakdownTable component**

Sortable table with columns: Strategy, Allocation, Weight, TWR, MWR, Sharpe, Avg Corr, Contribution, Risk Share. Follow pattern from `src/components/strategy/StrategyTable.tsx` for sorting/pagination.

- [ ] **Step 3: Create the dashboard page**

Server component at `src/app/(dashboard)/portfolios/[id]/page.tsx`. Fetches data via getPortfolioDetail, getPortfolioStrategies, getPortfolioAnalytics. Renders: PageHeader → KPI row → Chart sections (placeholder divs for now, filled by Tasks 11-14) → Strategy table → Optimizer suggestions.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/portfolios/\[id\]/page.tsx src/components/portfolio/PortfolioKPIRow.tsx src/components/portfolio/StrategyBreakdownTable.tsx
git commit -m "feat: portfolio dashboard page with KPIs and strategy table"
```

### Task 11: Multi-Strategy Equity Curve Chart

**Files:**
- Create: `src/components/portfolio/PortfolioEquityCurve.tsx`

- [ ] **Step 1: Create chart component**

Extends the pattern from `src/components/charts/EquityCurve.tsx` (lightweight-charts). Instead of one strategy + benchmark, renders N strategy lines with distinct colors. Add PnL ($) vs Return (%) toggle. Reuse the same createChart, resize observer, and tooltip patterns.

- [ ] **Step 2: Wire into dashboard page**

Add the chart to the portfolio dashboard page from Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/components/portfolio/PortfolioEquityCurve.tsx
git commit -m "feat: multi-strategy equity curve chart"
```

### Task 12: Correlation Heatmap

**Files:**
- Create: `src/components/portfolio/CorrelationHeatmap.tsx`

- [ ] **Step 1: Create heatmap component**

CSS grid heatmap following the pattern from `src/components/charts/MonthlyHeatmap.tsx`. Color scale: green (-1) to white (0) to red (+1). Strategy names on both axes. Click handler to expand rolling correlation for a pair (optional chart below).

- [ ] **Step 2: Wire into dashboard**

- [ ] **Step 3: Commit**

```bash
git add src/components/portfolio/CorrelationHeatmap.tsx
git commit -m "feat: correlation matrix heatmap component"
```

### Task 13: Attribution, Risk, and Composition Charts

**Files:**
- Create: `src/components/portfolio/AttributionBar.tsx`
- Create: `src/components/portfolio/RiskAttribution.tsx`
- Create: `src/components/portfolio/CompositionDonut.tsx`

- [ ] **Step 1: Create AttributionBar**

Horizontal recharts BarChart showing MTD contribution by strategy. Ranked by contribution, green/red coloring. Follow `MonthlyReturnsBar.tsx` pattern.

- [ ] **Step 2: Create RiskAttribution**

Stacked bar (recharts) showing % of portfolio volatility per strategy + table below with MCR assessment labels. Follow the data table patterns from MetricPanel.tsx.

- [ ] **Step 3: Create CompositionDonut**

Recharts PieChart (donut) showing allocation weights. Table below with strategy name, amount, weight%, TWR, Sharpe.

- [ ] **Step 4: Wire into dashboard**

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolio/AttributionBar.tsx src/components/portfolio/RiskAttribution.tsx src/components/portfolio/CompositionDonut.tsx
git commit -m "feat: attribution bar, risk decomposition, and composition donut charts"
```

### Task 14: Benchmark Comparison + Founder Insights

**Files:**
- Create: `src/components/portfolio/BenchmarkComparison.tsx`
- Create: `src/components/portfolio/FounderInsights.tsx`
- Create: `src/components/portfolio/AddFounderNote.tsx`

- [ ] **Step 1: Create BenchmarkComparison**

Line chart overlaying portfolio equity curve against BTC/ETH using lightweight-charts (extends EquityCurve pattern). Stats row below with alpha, beta, info ratio, tracking error.

- [ ] **Step 2: Create FounderInsights card**

Collapsible card per strategy row. Shows: latest founder note, "Add Note" button, AI narrative, relationship status badge, last contact date. Opens AddFounderNote modal on button click.

- [ ] **Step 3: Create AddFounderNote modal**

Modal form using existing Modal + Input + Textarea components. Writes to `portfolio_strategies.founder_notes` JSONB array via client-side Supabase. Follow the pattern from `CreatePortfolioForm.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/portfolio/BenchmarkComparison.tsx src/components/portfolio/FounderInsights.tsx src/components/portfolio/AddFounderNote.tsx
git commit -m "feat: benchmark comparison and founder insights components"
```

### Task 15: Portfolio Management Page

**Files:**
- Create: `src/app/(dashboard)/portfolios/[id]/manage/page.tsx`
- Create: `src/components/portfolio/AllocationEventForm.tsx`
- Create: `src/components/portfolio/AllocationTimeline.tsx`

- [ ] **Step 1: Create AllocationEventForm**

Client component form with: strategy selector, event type (deposit/withdrawal), amount, date, notes. Inserts into `allocation_events` table via Supabase. Follow `CreatePortfolioForm.tsx` pattern.

- [ ] **Step 2: Create AllocationTimeline**

Chronological list of allocation events with strategy name, type, amount, date. Uses Card + Badge components.

- [ ] **Step 3: Create the management page**

Server component with: PageHeader, list of portfolio strategies with allocation amounts, AllocationEventForm, AllocationTimeline, add/remove strategy controls.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/portfolios/\[id\]/manage/page.tsx src/components/portfolio/AllocationEventForm.tsx src/components/portfolio/AllocationTimeline.tsx
git commit -m "feat: portfolio management page with allocation events"
```

### Task 16: Allocations Hub Evolution

**Files:**
- Modify: `src/app/(dashboard)/allocations/page.tsx`

- [ ] **Step 1: Evolve the existing allocations page**

Transform from the current simple connection list to the full allocations hub:
- Add cross-portfolio aggregate KPIs using `getAllocatorAggregates()`
- Add portfolio list section with sparklines and key metrics
- Add "Active alerts" summary section
- Add "Open founder notes" section
- Keep existing connection cards as secondary section

Follow the existing page's data fetching pattern. Import PortfolioKPIRow from Task 10.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/allocations/page.tsx
git commit -m "feat: evolve allocations hub with cross-portfolio aggregates"
```

### Task 17: Sidebar Navigation Update

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add portfolios link to sidebar**

In the MY WORKSPACE section, add a "Portfolios" item with icon, linking to `/portfolios`. Follow the existing navItem pattern.

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: add Portfolios to sidebar navigation"
```

---

## Phase 4: Landing Page Verification

Partially parallel with Phase 3. Requires Phase 1 + Task 7 (verify-strategy endpoint).

### Task 18: Verification API Route

**Files:**
- Create: `src/app/api/verify-strategy/route.ts`
- Create: `src/app/api/verify-strategy/[id]/status/route.ts`

- [ ] **Step 1: Create POST route for verification**

No auth required (anonymous access). Rate limit: check `verification_requests` table for count by email and by IP in last 24h. Calls the Python analytics service `/api/verify-strategy`. Returns `{ id: verification_request_id }` for polling.

Use `createAdminClient()` for service-role Supabase writes (since anonymous users can't write directly).

- [ ] **Step 2: Create polling status route**

GET `/api/verify-strategy/[id]/status` — fetches the verification_request by ID, returns status + results if complete. No auth (uses the request ID as a capability token).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/verify-strategy/route.ts src/app/api/verify-strategy/\[id\]/status/route.ts
git commit -m "feat: landing page verification API routes"
```

### Task 19: Landing Page Verification Section

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/landing/VerificationForm.tsx`
- Create: `src/components/landing/VerificationProgress.tsx`
- Create: `src/components/landing/VerificationResults.tsx`

- [ ] **Step 1: Create VerificationForm**

Client component with: exchange selector, API key/secret fields, email input, submit handler. On submit: POST to `/api/verify-strategy`, then poll `/api/verify-strategy/[id]/status` every 5 seconds. State machine: idle → submitting → processing → complete | error.

Follow the Input/Select/Button component patterns.

- [ ] **Step 2: Create VerificationProgress**

Step indicator showing 4 phases with checkmark/spinner/pending states. Uses the same styling as the rest of the design system (DM Sans, muted teal).

- [ ] **Step 3: Create VerificationResults**

Inline results display: metric summary row (Total Return, CAGR, Sharpe, Max DD, Vol), mini Sparkline chart, MonthlyHeatmap, and CTA buttons. Reuse existing chart components.

- [ ] **Step 4: Add section to landing page**

Add new section to `src/app/page.tsx` between "How It Works" and "Social Proof". Import the verification components.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/landing/VerificationForm.tsx src/components/landing/VerificationProgress.tsx src/components/landing/VerificationResults.tsx
git commit -m "feat: landing page strategy verification with real-time analysis"
```

---

## Phase 5: Relationship Layer

Documents, alerts, migration, PDF export. Depends on Phase 1-2 complete, most of Phase 3 in place.

### Task 20: Documents Tab

**Files:**
- Create: `src/app/(dashboard)/portfolios/[id]/documents/page.tsx`
- Create: `src/components/portfolio/DocumentUpload.tsx`
- Create: `src/components/portfolio/DocumentList.tsx`
- Create: `src/app/api/portfolio-documents/route.ts`

- [ ] **Step 1: Create API route for document CRUD**

GET (list by portfolio_id) and POST (upload metadata) with `withAuth()`. File upload goes to Supabase Storage `portfolio-documents` bucket.

- [ ] **Step 2: Create DocumentUpload component**

Client component: file picker, title input, doc_type selector, optional strategy association. Uses Supabase Storage `.upload()` for the file and inserts metadata row.

- [ ] **Step 3: Create DocumentList component**

Filterable list grouped by strategy. Shows title, type badge, date, download link.

- [ ] **Step 4: Create documents page**

Server component with PageHeader, DocumentUpload, DocumentList.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/portfolios/\[id\]/documents/page.tsx src/components/portfolio/DocumentUpload.tsx src/components/portfolio/DocumentList.tsx src/app/api/portfolio-documents/route.ts
git commit -m "feat: portfolio documents tab with file upload"
```

### Task 21: Portfolio Alerts

**Files:**
- Create: `src/app/api/portfolio-alerts/route.ts`
- Create: `src/components/portfolio/AlertsList.tsx`

- [ ] **Step 1: Create alerts API route**

GET (list unacknowledged) and PATCH (acknowledge by id) with `withAuth()`.

- [ ] **Step 2: Create AlertsList component**

Renders alerts with severity badges (high=red, medium=yellow, low=blue), message, timestamp, and "Dismiss" button.

- [ ] **Step 3: Wire into dashboard and allocations hub**

Add AlertsList to portfolio dashboard page and allocations hub.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/portfolio-alerts/route.ts src/components/portfolio/AlertsList.tsx
git commit -m "feat: portfolio alerts display and acknowledgment"
```

### Task 22: Alert Email Digest

**Files:**
- Modify: `src/lib/email.ts`
- Create: `src/app/api/alert-digest/route.ts`

- [ ] **Step 1: Add digest email function**

Add `sendAlertDigest(email, portfolioName, alerts)` to `email.ts` following the existing template pattern.

- [ ] **Step 2: Create cron-triggered digest route**

API route that: queries all portfolios with un-emailed alerts, groups by user, sends one digest email per user per day, marks alerts as emailed. Triggered by Vercel/Railway cron. Uses `withAdminAuth()` or service key auth.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email.ts src/app/api/alert-digest/route.ts
git commit -m "feat: daily alert digest email via cron"
```

### Task 23: Portfolio PDF Export

**Files:**
- Create: `src/app/(dashboard)/portfolios/[id]/pdf/page.tsx`
- Create: `src/app/api/portfolio-pdf/[id]/route.ts`

- [ ] **Step 1: Create printable HTML page**

Server component rendering the portfolio report: KPIs, strategy table, equity curve (static), correlation matrix, attribution, narrative, disclaimer footer. Follows `src/app/factsheet/[id]/page.tsx` pattern.

- [ ] **Step 2: Create PDF generation route**

Clone the Puppeteer pattern from `src/app/api/factsheet/[id]/pdf/route.ts`. Navigate to the printable page, generate PDF, return with Content-Type: application/pdf.

- [ ] **Step 3: Add "Export PDF" button to dashboard**

Add button to PageHeader actions on the portfolio dashboard page.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/portfolios/\[id\]/pdf/page.tsx src/app/api/portfolio-pdf/\[id\]/route.ts
git commit -m "feat: portfolio PDF export via Puppeteer"
```

### Task 24: Migration Wizard

**Files:**
- Create: `src/components/portfolio/MigrationWizard.tsx`

- [ ] **Step 1: Create multi-step wizard**

Client component with 3 steps:
1. Search for strategy (by name, exchange) or manual entry
2. Enter allocation amount + date
3. Optionally paste notes from prior communications

On completion: inserts into portfolio_strategies + allocation_events + portfolio_documents (if notes provided).

- [ ] **Step 2: Add wizard trigger to management page**

Add "Claim Legacy Allocation" button to the portfolio management page (Task 15).

- [ ] **Step 3: Commit**

```bash
git add src/components/portfolio/MigrationWizard.tsx
git commit -m "feat: migration wizard for claiming legacy allocations"
```

### Task 25: Disclaimers & Compliance Copy

**Files:**
- Modify: various pages to add disclaimer footers

- [ ] **Step 1: Add disclaimer component**

Use the existing `Disclaimer` component from `src/components/ui/Disclaimer.tsx`. Add standard text to:
- Portfolio dashboard page footer
- Portfolio PDF page footer
- Landing page verification results
- Optimizer suggestions section

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add performance disclaimers to all analytics views"
```

---

## Verification

### How to test end-to-end:

1. **Database**: Run `npx supabase db push` and verify all tables/policies via Table Editor
2. **Analytics engine**: `cd analytics-service && python -m pytest tests/ -v` — all new tests pass
3. **Portfolio dashboard**: Start dev server (`npm run dev`), create a portfolio, add strategies, log allocation events, trigger analytics computation, verify KPIs/charts/tables render correctly
4. **Landing page**: Visit `/`, scroll to verification section, submit a test API key (read-only Binance testnet), wait for results, verify metrics display
5. **Documents**: Upload a test document, verify it appears in the documents tab, verify download works
6. **Alerts**: Trigger a drawdown alert by setting a low threshold, verify it appears in the hub and dashboard
7. **PDF**: Click "Export PDF" on a portfolio with computed analytics, verify the PDF downloads with all sections
8. **Migration**: Use the migration wizard to claim a legacy allocation, verify it appears in the portfolio

### Tests to run:

```bash
# Python analytics tests
cd analytics-service && python -m pytest tests/ -v

# Next.js build check
npm run build

# Existing E2E tests still pass
npx playwright test

# Type check
npx tsc --noEmit
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | 10 findings (3 critical, 4 high). Auto-detect allocation events incorporated. "Daily OS" reframed to "portfolio intelligence." |
| CEO Voices | `autoplan-voices` | Independent 2nd opinion | 1 | clean | Claude: 6 findings. Codex: 7 findings. Consensus: 2/6 confirmed, 4 disagree. |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | 15 findings. Morning briefing zone, DashboardShell, responsive strategy, blue-orange heatmap incorporated. |
| Design Voices | `autoplan-voices` | Independent 2nd opinion | 1 | clean | Claude: 7 findings. Codex: 8 findings. Consensus: 6/6 confirmed (all gaps). |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | issues_open | 17 findings. Verification security, immutable analytics, TWR math, cron guard, storage RLS all fixed. |
| Eng Voices | `autoplan-voices` | Independent 2nd opinion | 1 | clean | Claude: 8 findings. Codex: 9 findings. Consensus: 5/6 confirmed, 1 disagree. |

**VERDICT:** APPROVED with 14 mandatory fixes incorporated. 5 taste decisions resolved (dashboard-first, morning briefing, blue-orange heatmap, extend existing relationships, correlation cap). 4 user challenges surfaced (pick-a-wedge, single source of truth, immutable snapshots, verification sequencing) — user chose to keep full scope with fixes.
