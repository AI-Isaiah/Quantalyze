-- Phase 241 plan 03 - LANE ONLY fixture with Pair B's foreign-key shape.
-- Loaded by 241-PAIRB-rehearse.sh as the lane's postgres superuser with
--   psql -v ON_ERROR_STOP=1 -v b_id=<uuid> -v x_id=<uuid> -v m_id=<uuid>
-- The three auth users already exist (the driver creates them through the GoTrue admin API),
-- so each has a profile (the handle_new_user trigger) and real sessions and identities.
--   M = a manager with one published strategy (the allocators' candidates and decisions
--       need a strategy owned by someone else).
--   X = a bystander allocator with the SAME row shape as B, and a key on B's venue account.
--   B = the fixture allocator the chain removes.
-- Nothing here is a literal id: every id is generated at load time.
SELECT set_config('fx.b', :'b_id', false),
       set_config('fx.x', :'x_id', false),
       set_config('fx.m', :'m_id', false);

DO $fx$
DECLARE
  b uuid := current_setting('fx.b')::uuid;
  x uuid := current_setting('fx.x')::uuid;
  m uuid := current_setting('fx.m')::uuid;
  strat uuid;
  who uuid;
  k uuid;
  batch uuid;
  cand uuid;
  dec uuid;
  dec2 uuid;
  pf uuid;
  i int;
BEGIN
  UPDATE public.profiles SET role = 'allocator' WHERE id IN (b, x);

  INSERT INTO public.strategies (user_id, name, status)
  VALUES (m, 'fixture published strategy', 'published')
  RETURNING id INTO strat;

  FOREACH who IN ARRAY ARRAY[b, x] LOOP
    -- one OKX-shaped key; B and X share one venue account (different logins). The venue id is
    -- unique per fixture, so earlier fixtures on the same lane never count as siblings.
    INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted, venue_account_id)
    VALUES (who, 'okx', 'fixture okx', 'fx', 'lane-venue-' || b::text)
    RETURNING id INTO k;

    FOR i IN 1..3 LOOP
      INSERT INTO public.allocator_holdings
        (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
      VALUES (who, k, 'okx', 'SYM' || i, current_date, 'spot', 'long', 1, 100, 100);
    END LOOP;

    INSERT INTO public.match_batches
      (allocator_id, mode, engine_version, weights_version, effective_preferences,
       effective_thresholds, source_strategy_count)
    VALUES (who, 'personalized', 'fx', 'fx', '{}'::jsonb, '{}'::jsonb, 1)
    RETURNING id INTO batch;

    INSERT INTO public.match_candidates
      (batch_id, allocator_id, strategy_id, score, score_breakdown, rank)
    VALUES (batch, who, strat, 0.5, '{}'::jsonb, 1)
    RETURNING id INTO cand;

    INSERT INTO public.match_decisions
      (allocator_id, strategy_id, candidate_id, decision, decided_by, kind)
    VALUES (who, strat, cand, 'thumbs_up', who, 'voluntary_add')
    RETURNING id INTO dec;

    INSERT INTO public.bridge_outcomes
      (allocator_id, match_decision_id, kind, rejection_reason)
    VALUES (who, dec, 'rejected', 'other');

    -- a second decision (a holding-ref kind, no strategy) and its bridge outcome
    INSERT INTO public.match_decisions
      (allocator_id, decision, decided_by, kind, original_holding_ref)
    VALUES (who, 'thumbs_down', who, 'voluntary_remove', 'fixture-holding-ref')
    RETURNING id INTO dec2;

    INSERT INTO public.bridge_outcomes
      (allocator_id, match_decision_id, kind, rejection_reason)
    VALUES (who, dec2, 'rejected', 'other');

    INSERT INTO public.allocator_preferences (user_id, edited_by_user_id)
    VALUES (who, who);

    -- derived rows hanging off the key
    FOR i IN 1..3 LOOP
      INSERT INTO public.csv_daily_returns (api_key_id, allocator_id, date, daily_return)
      VALUES (k, who, current_date - i, 0.001 * i);
    END LOOP;

    INSERT INTO public.api_key_nav_marks
      (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd, native_detail)
    VALUES (k, who, (now() AT TIME ZONE 'UTC')::date - 1, now(), 'okx', 1000, 10, '{}'::jsonb);

    INSERT INTO public.compute_jobs (kind, api_key_id, status)
    VALUES ('poll_allocator_positions', k, 'done');
    INSERT INTO public.compute_jobs (kind, allocator_id, status)
    VALUES ('rescore_allocator', who, 'done');

    INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload)
    VALUES (who, 'fixture-a', '{}'::jsonb), (who, 'fixture-b', '{}'::jsonb);

    FOR i IN 1..2 LOOP
      -- one real portfolio per user (unique index); the second is a test portfolio
      INSERT INTO public.portfolios (user_id, name, is_test) VALUES (who, 'fixture portfolio ' || i, i = 2)
      RETURNING id INTO pf;
      INSERT INTO public.portfolio_analytics (portfolio_id) VALUES (pf);
    END LOOP;
    INSERT INTO public.compute_jobs (kind, portfolio_id, status)
    VALUES ('compute_portfolio', pf, 'done');

    INSERT INTO public.user_app_roles (user_id, role, granted_by) VALUES (who, 'allocator', who);
    INSERT INTO public.investor_attestations (user_id, version) VALUES (who, 'fixture-v1');

    INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, metadata)
    SELECT who, 'fixture.event', 'fixture', gen_random_uuid(), jsonb_build_object('fx', who::text)
      FROM generate_series(1, 5);
  END LOOP;

  -- B only: a second, disconnected Bybit-shaped key, as on PROD
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted, disconnected_at)
  VALUES (b, 'bybit', 'fixture bybit', 'fx', now());
END
$fx$;
