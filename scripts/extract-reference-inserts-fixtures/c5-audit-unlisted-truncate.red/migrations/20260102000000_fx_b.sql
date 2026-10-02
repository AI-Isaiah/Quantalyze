-- RED: a TRUNCATE naming a replayed table second in its list empties rows the replay wrote (review IN-04).
TRUNCATE TABLE fx_other, fx_ref CASCADE;
