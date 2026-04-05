-- Decks: admin-curated strategy bundles
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deck_strategies (
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (deck_id, strategy_id)
);

ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY decks_read ON decks FOR SELECT USING (true);
CREATE POLICY deck_strategies_read ON deck_strategies FOR SELECT USING (true);
