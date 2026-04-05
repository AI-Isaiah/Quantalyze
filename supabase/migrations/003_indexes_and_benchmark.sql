-- Indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_contact_requests_status_created ON contact_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies (status);
CREATE INDEX IF NOT EXISTS idx_profiles_allocator_status ON profiles (allocator_status);

-- Benchmark prices table for BTC/ETH daily returns
CREATE TABLE IF NOT EXISTS benchmark_prices (
  date DATE NOT NULL,
  symbol TEXT NOT NULL,
  close_price DECIMAL NOT NULL,
  PRIMARY KEY (date, symbol)
);

-- review_note for strategy rejection feedback
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS review_note TEXT;
