-- RED (review round 2, IN-05 / SFH R2-05): C2 admits a ::cast, and a cast to an UNQUALIFIED domain was admitted as "a cast": a domain runs its CHECK expression at replay, which the tuple does not show.
INSERT INTO fx_ref (id, kind) VALUES (1, 'k'::fx_kind) ON CONFLICT (id) DO NOTHING;
