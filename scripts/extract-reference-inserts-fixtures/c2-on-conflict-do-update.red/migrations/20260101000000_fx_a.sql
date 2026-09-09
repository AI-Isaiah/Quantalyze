-- RED: a DO UPDATE arm mutates a row that already exists.
INSERT INTO fx_ref (id, label) VALUES (1, 'ref_a') ON CONFLICT (id) DO UPDATE SET label = 'clobbered';
