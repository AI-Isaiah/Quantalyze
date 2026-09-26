-- RED: current_setting() reads session state; any call but now() is refused.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = current_setting('app.label') WHERE id = 1;
