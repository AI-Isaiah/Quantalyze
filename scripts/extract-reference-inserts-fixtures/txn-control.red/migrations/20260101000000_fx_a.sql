-- The migration manages its own transaction, exactly as
-- 20260515095804_teaser_anchor_strategy.sql does. A wholesale take would find
-- three statements here; only the INSERT is reference data. The RED leg pins 3
-- so that a script which stopped taking INSERT spans ONLY would go green.
BEGIN;
SET lock_timeout = '3s';
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
COMMIT;
