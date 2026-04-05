-- profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  company TEXT,
  description TEXT,
  email TEXT,
  telegram TEXT,
  website TEXT,
  linkedin TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL CHECK (role IN ('manager', 'allocator', 'both')) DEFAULT 'manager',
  manager_status TEXT NOT NULL CHECK (manager_status IN ('newbie', 'pending', 'verified')) DEFAULT 'newbie',
  allocator_status TEXT NOT NULL CHECK (allocator_status IN ('newbie', 'pending', 'verified')) DEFAULT 'newbie',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- api_keys (envelope encryption: DEK per row, KEK in Supabase Vault)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'okx', 'bybit')),
  label TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  passphrase_encrypted TEXT,
  dek_encrypted TEXT NOT NULL,
  nonce TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- discovery_categories
CREATE TABLE discovery_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  access_level TEXT NOT NULL DEFAULT 'public' CHECK (access_level IN ('public', 'qualified_only')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- strategies
CREATE TABLE strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  category_id UUID REFERENCES discovery_categories ON DELETE SET NULL,
  api_key_id UUID REFERENCES api_keys ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  strategy_types TEXT[] NOT NULL DEFAULT '{}',
  subtypes TEXT[] NOT NULL DEFAULT '{}',
  markets TEXT[] NOT NULL DEFAULT '{}',
  supported_exchanges TEXT[] NOT NULL DEFAULT '{}',
  leverage_range TEXT,
  avg_daily_turnover DECIMAL,
  aum DECIMAL,
  max_capacity DECIMAL,
  start_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'archived')),
  is_example BOOLEAN NOT NULL DEFAULT false,
  benchmark TEXT NOT NULL DEFAULT 'BTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- strategy_analytics (precomputed, cached)
CREATE TABLE strategy_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL UNIQUE REFERENCES strategies ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  computation_status TEXT NOT NULL DEFAULT 'pending' CHECK (computation_status IN ('pending', 'computing', 'complete', 'failed')),
  computation_error TEXT,
  benchmark TEXT,
  cumulative_return DECIMAL,
  cagr DECIMAL,
  volatility DECIMAL,
  sharpe DECIMAL,
  sortino DECIMAL,
  calmar DECIMAL,
  max_drawdown DECIMAL,
  max_drawdown_duration_days INTEGER,
  six_month_return DECIMAL,
  sparkline_returns JSONB,
  sparkline_drawdown JSONB,
  metrics_json JSONB,
  returns_series JSONB,
  drawdown_series JSONB,
  monthly_returns JSONB,
  daily_returns JSONB,
  rolling_metrics JSONB,
  return_quantiles JSONB,
  trade_metrics JSONB,
  data_quality_flags JSONB
);

-- contact_requests
CREATE TABLE contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies ON DELETE CASCADE,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE (allocator_id, strategy_id)
);

-- trades
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies ON DELETE CASCADE,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  price DECIMAL NOT NULL,
  quantity DECIMAL NOT NULL,
  fee DECIMAL,
  fee_currency TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  order_type TEXT
);

CREATE INDEX idx_trades_strategy_timestamp ON trades (strategy_id, timestamp);

-- portfolios
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- portfolio_strategies
CREATE TABLE portfolio_strategies (
  portfolio_id UUID NOT NULL REFERENCES portfolios ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, strategy_id)
);

-- Seed discovery categories
INSERT INTO discovery_categories (name, slug, description, sort_order) VALUES
  ('Crypto SMA', 'crypto-sma', 'Separately Managed Accounts for crypto quantitative strategies. Verified performance from exchange APIs.', 1),
  ('CFD', 'cfd', 'Contract-for-difference strategies across major crypto pairs.', 2),
  ('Emerging Crypto', 'emerging-crypto', 'Early-stage strategies on newer tokens and protocols.', 3),
  ('Crypto Decks', 'crypto-decks', 'Curated bundles of crypto strategies for diversified allocation.', 4),
  ('TradFi Decks', 'tradfi-decks', 'Traditional finance strategy bundles bridging TradFi and crypto.', 5);
