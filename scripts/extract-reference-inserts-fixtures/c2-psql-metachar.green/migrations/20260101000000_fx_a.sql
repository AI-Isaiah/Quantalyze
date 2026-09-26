-- GREEN: a backslash INSIDE a string literal is masked and admitted, beside
-- every other character C2's allowlist keeps: a ::cast, a sign, a decimal and a
-- quoted column name.
INSERT INTO fx_ref (id, "label", n) VALUES (1, 'a\b'::text, -1.5) ON CONFLICT (id) DO NOTHING;
