-- GREEN: the literal write moved to the TOP level (the remedy for a migration not yet applied), where an update: line replays it; the DO body keeps only a NON-literal write, on a row the replay did not write, and that one is declinable.
UPDATE fx_ref SET label = 'v' WHERE id = 1;
DO $$
BEGIN
  UPDATE fx_ref SET label = lower(label) WHERE id = 2;
END
$$;
