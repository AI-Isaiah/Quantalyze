-- Synthetic migration for the mutation runner's own fixture corpus.
--
-- This is the SUBSTRATE the runner is developed and self-tested against, so
-- runner development stays off the real 2564-line gate file. It deliberately
-- mirrors two shapes from the real corpus:
--
--   1. The `generation` column is declared with TWO spaces before BIGINT,
--      exactly like migration 20260827120000:170. Plan 164.3-01 measured that
--      the single-space string `generation BIGINT` matches somewhere else
--      entirely, which is why RED-UNDER-M carries bytes plus a measured
--      `occurrences` count rather than a prose locator.
--   2. `authenticated` holds exactly one table privilege, so an exact-set pin
--      arm shadows the narrower grant arm behind it — the structural shape that
--      makes a `neuter` prerequisite necessary (real corpus: SHAPE 3b shadowing
--      NONCE 1b).
--
-- The `anon` / `authenticated` / `service_role` roles are created by the lane
-- before any --apply file runs.

CREATE TABLE mini_widget (
  id          BIGINT      PRIMARY KEY,
  generation  BIGINT      NOT NULL DEFAULT 1 CHECK (generation >= 1),
  label       TEXT        NOT NULL DEFAULT 'unset'
);

INSERT INTO mini_widget (id) VALUES (1);

GRANT SELECT ON mini_widget TO authenticated;
