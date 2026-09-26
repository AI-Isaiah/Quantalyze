-- GREEN: a `::` cast is admitted, and so is a colon INSIDE a string literal.
INSERT INTO fx_ref (id, label) VALUES (1, 'a:b'::text) ON CONFLICT (id) DO NOTHING;
