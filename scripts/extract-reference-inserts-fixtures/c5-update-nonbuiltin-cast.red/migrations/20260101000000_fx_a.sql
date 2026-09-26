-- RED (review round 2, IN-05 / SFH R2-05): a cast to a type C5 does not know can run code the statement does not show: a domain runs its CHECK, and CREATE CAST … WITH FUNCTION runs a function. Unqualified, schema-qualified and quoted spellings are each refused.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET kind = 'k'::fx_kind WHERE id = 1;
UPDATE fx_ref SET kind = 'k'::public.fx_kind WHERE id = 1;
UPDATE fx_ref SET kind = 'k'::"text" WHERE id = 1;
