export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      allocation_events: {
        Row: {
          amount: number
          created_at: string | null
          event_date: string
          event_type: string
          id: string
          notes: string | null
          portfolio_id: string
          source: string
          strategy_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          event_date: string
          event_type: string
          id?: string
          notes?: string | null
          portfolio_id: string
          source?: string
          strategy_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          event_date?: string
          event_type?: string
          id?: string
          notes?: string | null
          portfolio_id?: string
          source?: string
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocation_events_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_events_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      allocator_equity_snapshots: {
        Row: {
          allocator_id: string
          asof: string
          breakdown: Json | null
          history_depth_months: number | null
          reconstructed_at: string
          source: string
          value_usd: number
        }
        Insert: {
          allocator_id: string
          asof: string
          breakdown?: Json | null
          history_depth_months?: number | null
          reconstructed_at?: string
          source?: string
          value_usd: number
        }
        Update: {
          allocator_id?: string
          asof?: string
          breakdown?: Json | null
          history_depth_months?: number | null
          reconstructed_at?: string
          source?: string
          value_usd?: number
        }
        Relationships: []
      }
      allocator_holdings: {
        Row: {
          allocator_id: string
          api_key_id: string
          asof: string
          cost_basis_usd: number | null
          created_at: string
          entry_price: number | null
          holding_type: string
          id: string
          mark_price: number
          quantity: number
          raw_payload: Json | null
          side: string
          symbol: string
          unrealized_pnl_usd: number | null
          updated_at: string
          value_usd: number
          venue: string
        }
        Insert: {
          allocator_id: string
          api_key_id: string
          asof: string
          cost_basis_usd?: number | null
          created_at?: string
          entry_price?: number | null
          holding_type: string
          id?: string
          mark_price: number
          quantity: number
          raw_payload?: Json | null
          side: string
          symbol: string
          unrealized_pnl_usd?: number | null
          updated_at?: string
          value_usd: number
          venue: string
        }
        Update: {
          allocator_id?: string
          api_key_id?: string
          asof?: string
          cost_basis_usd?: number | null
          created_at?: string
          entry_price?: number | null
          holding_type?: string
          id?: string
          mark_price?: number
          quantity?: number
          raw_payload?: Json | null
          side?: string
          symbol?: string
          unrealized_pnl_usd?: number | null
          updated_at?: string
          value_usd?: number
          venue?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocator_holdings_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      allocator_preferences: {
        Row: {
          correlation_ceiling: number | null
          edited_by_user_id: string | null
          excluded_exchanges: string[] | null
          founder_notes: string | null
          liquidity_preference: string | null
          mandate_archetype: string | null
          mandate_edited_at: string | null
          max_aum_concentration: number | null
          max_drawdown_tolerance: number | null
          max_weight: number | null
          min_sharpe: number | null
          min_track_record_days: number | null
          preferred_markets: string[] | null
          preferred_strategy_types: string[] | null
          scoring_weight_overrides: Json | null
          style_exclusions: string[] | null
          target_ticket_size_usd: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          correlation_ceiling?: number | null
          edited_by_user_id?: string | null
          excluded_exchanges?: string[] | null
          founder_notes?: string | null
          liquidity_preference?: string | null
          mandate_archetype?: string | null
          mandate_edited_at?: string | null
          max_aum_concentration?: number | null
          max_drawdown_tolerance?: number | null
          max_weight?: number | null
          min_sharpe?: number | null
          min_track_record_days?: number | null
          preferred_markets?: string[] | null
          preferred_strategy_types?: string[] | null
          scoring_weight_overrides?: Json | null
          style_exclusions?: string[] | null
          target_ticket_size_usd?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          correlation_ceiling?: number | null
          edited_by_user_id?: string | null
          excluded_exchanges?: string[] | null
          founder_notes?: string | null
          liquidity_preference?: string | null
          mandate_archetype?: string | null
          mandate_edited_at?: string | null
          max_aum_concentration?: number | null
          max_drawdown_tolerance?: number | null
          max_weight?: number | null
          min_sharpe?: number | null
          min_track_record_days?: number | null
          preferred_markets?: string[] | null
          preferred_strategy_types?: string[] | null
          scoring_weight_overrides?: Json | null
          style_exclusions?: string[] | null
          target_ticket_size_usd?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocator_preferences_edited_by_user_id_fkey"
            columns: ["edited_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocator_preferences_edited_by_user_id_fkey"
            columns: ["edited_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocator_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocator_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          account_balance_usdt: number | null
          api_key_encrypted: string
          api_secret_encrypted: string | null
          created_at: string
          dek_encrypted: string | null
          exchange: string
          id: string
          is_active: boolean
          kek_version: number
          label: string
          last_429_at: string | null
          last_fetched_trade_timestamp: string | null
          last_sync_at: string | null
          nonce: string | null
          passphrase_encrypted: string | null
          sync_error: string | null
          sync_started_at: string | null
          sync_status: string | null
          user_id: string
        }
        Insert: {
          account_balance_usdt?: number | null
          api_key_encrypted: string
          api_secret_encrypted?: string | null
          created_at?: string
          dek_encrypted?: string | null
          exchange: string
          id?: string
          is_active?: boolean
          kek_version?: number
          label: string
          last_429_at?: string | null
          last_fetched_trade_timestamp?: string | null
          last_sync_at?: string | null
          nonce?: string | null
          passphrase_encrypted?: string | null
          sync_error?: string | null
          sync_started_at?: string | null
          sync_status?: string | null
          user_id: string
        }
        Update: {
          account_balance_usdt?: number | null
          api_key_encrypted?: string
          api_secret_encrypted?: string | null
          created_at?: string
          dek_encrypted?: string | null
          exchange?: string
          id?: string
          is_active?: boolean
          kek_version?: number
          label?: string
          last_429_at?: string | null
          last_fetched_trade_timestamp?: string | null
          last_sync_at?: string | null
          nonce?: string | null
          passphrase_encrypted?: string | null
          sync_error?: string | null
          sync_started_at?: string | null
          sync_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      audit_log_cold: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      benchmark_prices: {
        Row: {
          close_price: number
          date: string
          symbol: string
        }
        Insert: {
          close_price: number
          date: string
          symbol: string
        }
        Update: {
          close_price?: number
          date?: string
          symbol?: string
        }
        Relationships: []
      }
      bridge_outcome_dismissals: {
        Row: {
          allocator_id: string
          dismissed_at: string
          expires_at: string
          id: string
          strategy_id: string
        }
        Insert: {
          allocator_id: string
          dismissed_at?: string
          expires_at?: string
          id?: string
          strategy_id: string
        }
        Update: {
          allocator_id?: string
          dismissed_at?: string
          expires_at?: string
          id?: string
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_outcome_dismissals_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_outcome_dismissals_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_outcome_dismissals_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_outcomes: {
        Row: {
          allocated_at: string | null
          allocator_id: string
          created_at: string
          delta_180d: number | null
          delta_30d: number | null
          delta_90d: number | null
          deltas_computed_at: string | null
          estimated_days: number | null
          estimated_delta_bps: number | null
          id: string
          kind: string
          match_decision_id: string | null
          needs_recompute: boolean
          note: string | null
          original_holding_ref: string | null
          percent_allocated: number | null
          rejection_reason: string | null
          strategy_id: string
          updated_at: string
        }
        Insert: {
          allocated_at?: string | null
          allocator_id: string
          created_at?: string
          delta_180d?: number | null
          delta_30d?: number | null
          delta_90d?: number | null
          deltas_computed_at?: string | null
          estimated_days?: number | null
          estimated_delta_bps?: number | null
          id?: string
          kind: string
          match_decision_id?: string | null
          needs_recompute?: boolean
          note?: string | null
          original_holding_ref?: string | null
          percent_allocated?: number | null
          rejection_reason?: string | null
          strategy_id: string
          updated_at?: string
        }
        Update: {
          allocated_at?: string | null
          allocator_id?: string
          created_at?: string
          delta_180d?: number | null
          delta_30d?: number | null
          delta_90d?: number | null
          deltas_computed_at?: string | null
          estimated_days?: number | null
          estimated_delta_bps?: number | null
          id?: string
          kind?: string
          match_decision_id?: string | null
          needs_recompute?: boolean
          note?: string | null
          original_holding_ref?: string | null
          percent_allocated?: number | null
          rejection_reason?: string | null
          strategy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_outcomes_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_outcomes_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_outcomes_match_decision_id_fkey"
            columns: ["match_decision_id"]
            isOneToOne: false
            referencedRelation: "match_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_outcomes_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      compute_job_kinds: {
        Row: {
          name: string
        }
        Insert: {
          name: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      compute_jobs: {
        Row: {
          allocator_id: string | null
          api_key_id: string | null
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          error_kind: string | null
          exchange: string | null
          id: string
          idempotency_key: string | null
          kind: string
          last_error: string | null
          max_attempts: number
          metadata: Json | null
          next_attempt_at: string
          parent_job_ids: string[]
          portfolio_id: string | null
          status: string
          strategy_id: string | null
          trade_count: number | null
          updated_at: string
        }
        Insert: {
          allocator_id?: string | null
          api_key_id?: string | null
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error_kind?: string | null
          exchange?: string | null
          id?: string
          idempotency_key?: string | null
          kind: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json | null
          next_attempt_at?: string
          parent_job_ids?: string[]
          portfolio_id?: string | null
          status?: string
          strategy_id?: string | null
          trade_count?: number | null
          updated_at?: string
        }
        Update: {
          allocator_id?: string | null
          api_key_id?: string | null
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error_kind?: string | null
          exchange?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json | null
          next_attempt_at?: string
          parent_job_ids?: string[]
          portfolio_id?: string | null
          status?: string
          strategy_id?: string | null
          trade_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compute_jobs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compute_jobs_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "compute_job_kinds"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "compute_jobs_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compute_jobs_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_requests: {
        Row: {
          admin_note: string | null
          allocation_amount: number | null
          allocator_id: string
          created_at: string
          founder_notes: string | null
          id: string
          mandate_context: Json | null
          message: string | null
          partner_tag: string | null
          portfolio_snapshot: Json | null
          replacement_for: string | null
          responded_at: string | null
          snapshot_status: string
          source: string
          status: string
          strategy_id: string
          tenant_id: string | null
        }
        Insert: {
          admin_note?: string | null
          allocation_amount?: number | null
          allocator_id: string
          created_at?: string
          founder_notes?: string | null
          id?: string
          mandate_context?: Json | null
          message?: string | null
          partner_tag?: string | null
          portfolio_snapshot?: Json | null
          replacement_for?: string | null
          responded_at?: string | null
          snapshot_status?: string
          source?: string
          status?: string
          strategy_id: string
          tenant_id?: string | null
        }
        Update: {
          admin_note?: string | null
          allocation_amount?: number | null
          allocator_id?: string
          created_at?: string
          founder_notes?: string | null
          id?: string
          mandate_context?: Json | null
          message?: string | null
          partner_tag?: string | null
          portfolio_snapshot?: Json | null
          replacement_for?: string | null
          responded_at?: string | null
          snapshot_status?: string
          source?: string
          status?: string
          strategy_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_requests_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_requests_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_requests_replacement_for_fkey"
            columns: ["replacement_for"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_requests_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_runs: {
        Row: {
          completed_at: string | null
          cron_name: string
          error: string | null
          id: string
          metadata: Json | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          cron_name: string
          error?: string | null
          id?: string
          metadata?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          cron_name?: string
          error?: string | null
          id?: string
          metadata?: Json | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          id: string
          notes: string | null
          rejected_at: string | null
          rejection_reason: string | null
          requested_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          requested_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          requested_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_strategies: {
        Row: {
          added_at: string | null
          deck_id: string
          strategy_id: string
        }
        Insert: {
          added_at?: string | null
          deck_id: string
          strategy_id: string
        }
        Update: {
          added_at?: string | null
          deck_id?: string
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deck_strategies_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deck_strategies_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      decks: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      discovery_categories: {
        Row: {
          access_level: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          access_level?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          access_level?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      for_quants_leads: {
        Row: {
          created_at: string
          email: string
          firm: string
          id: string
          name: string
          notes: string | null
          preferred_time: string | null
          processed_at: string | null
          processed_by: string | null
          source_ip: unknown
          user_agent: string | null
          wizard_context: Json | null
        }
        Insert: {
          created_at?: string
          email: string
          firm: string
          id?: string
          name: string
          notes?: string | null
          preferred_time?: string | null
          processed_at?: string | null
          processed_by?: string | null
          source_ip?: unknown
          user_agent?: string | null
          wizard_context?: Json | null
        }
        Update: {
          created_at?: string
          email?: string
          firm?: string
          id?: string
          name?: string
          notes?: string | null
          preferred_time?: string | null
          processed_at?: string | null
          processed_by?: string | null
          source_ip?: unknown
          user_agent?: string | null
          wizard_context?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "for_quants_leads_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "for_quants_leads_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_fees: {
        Row: {
          amount: number
          created_at: string
          currency: string
          exchange: string
          id: string
          match_key: string
          raw_data: Json | null
          strategy_id: string
          symbol: string
          timestamp: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          exchange: string
          id?: string
          match_key: string
          raw_data?: Json | null
          strategy_id: string
          symbol: string
          timestamp: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          exchange?: string
          id?: string
          match_key?: string
          raw_data?: Json | null
          strategy_id?: string
          symbol?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_fees_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      investor_attestations: {
        Row: {
          attested_at: string
          ip_address: string | null
          user_id: string
          version: string
        }
        Insert: {
          attested_at?: string
          ip_address?: string | null
          user_id: string
          version: string
        }
        Update: {
          attested_at?: string
          ip_address?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_attestations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investor_attestations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      key_permission_audit: {
        Row: {
          api_key_id: string
          caller_ip: string | null
          id: string
          requested_at: string
        }
        Insert: {
          api_key_id: string
          caller_ip?: string | null
          id?: string
          requested_at?: string
        }
        Update: {
          api_key_id?: string
          caller_ip?: string | null
          id?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_permission_audit_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      match_batches: {
        Row: {
          allocator_id: string
          candidate_count: number
          computed_at: string
          effective_preferences: Json
          effective_thresholds: Json
          engine_version: string
          excluded_count: number
          filter_relaxed: boolean
          holding_flags: Json
          id: string
          latency_ms: number | null
          mode: string
          partner_tag: string | null
          source_strategy_count: number
          tenant_id: string | null
          weights_version: string
        }
        Insert: {
          allocator_id: string
          candidate_count?: number
          computed_at?: string
          effective_preferences: Json
          effective_thresholds: Json
          engine_version: string
          excluded_count?: number
          filter_relaxed?: boolean
          holding_flags?: Json
          id?: string
          latency_ms?: number | null
          mode: string
          partner_tag?: string | null
          source_strategy_count: number
          tenant_id?: string | null
          weights_version: string
        }
        Update: {
          allocator_id?: string
          candidate_count?: number
          computed_at?: string
          effective_preferences?: Json
          effective_thresholds?: Json
          engine_version?: string
          excluded_count?: number
          filter_relaxed?: boolean
          holding_flags?: Json
          id?: string
          latency_ms?: number | null
          mode?: string
          partner_tag?: string | null
          source_strategy_count?: number
          tenant_id?: string | null
          weights_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_batches_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_batches_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_candidates: {
        Row: {
          allocator_id: string
          batch_id: string
          exclusion_provenance: string | null
          exclusion_reason: string | null
          id: string
          rank: number | null
          reasons: string[]
          score: number
          score_breakdown: Json
          strategy_id: string
        }
        Insert: {
          allocator_id: string
          batch_id: string
          exclusion_provenance?: string | null
          exclusion_reason?: string | null
          id?: string
          rank?: number | null
          reasons?: string[]
          score: number
          score_breakdown: Json
          strategy_id: string
        }
        Update: {
          allocator_id?: string
          batch_id?: string
          exclusion_provenance?: string | null
          exclusion_reason?: string | null
          id?: string
          rank?: number | null
          reasons?: string[]
          score?: number
          score_breakdown?: Json
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_candidates_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "match_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      match_decisions: {
        Row: {
          allocator_id: string
          candidate_id: string | null
          contact_request_id: string | null
          created_at: string
          decided_by: string
          decision: string
          founder_note: string | null
          id: string
          original_holding_ref: string | null
          original_strategy_id: string | null
          strategy_id: string
        }
        Insert: {
          allocator_id: string
          candidate_id?: string | null
          contact_request_id?: string | null
          created_at?: string
          decided_by: string
          decision: string
          founder_note?: string | null
          id?: string
          original_holding_ref?: string | null
          original_strategy_id?: string | null
          strategy_id: string
        }
        Update: {
          allocator_id?: string
          candidate_id?: string | null
          contact_request_id?: string | null
          created_at?: string
          decided_by?: string
          decision?: string
          founder_note?: string | null
          id?: string
          original_holding_ref?: string | null
          original_strategy_id?: string | null
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_decisions_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_allocator_id_fkey"
            columns: ["allocator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "match_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_contact_request_id_fkey"
            columns: ["contact_request_id"]
            isOneToOne: false
            referencedRelation: "contact_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_original_strategy_id_fkey"
            columns: ["original_strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatches: {
        Row: {
          created_at: string | null
          error: string | null
          id: string
          metadata: Json | null
          notification_type: string
          recipient_email: string
          sent_at: string | null
          status: string
          subject: string | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          id?: string
          metadata?: Json | null
          notification_type: string
          recipient_email: string
          sent_at?: string | null
          status: string
          subject?: string | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          id?: string
          metadata?: Json | null
          notification_type?: string
          recipient_email?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      organization_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string
          organization_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by: string
          organization_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          organization_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          joined_at: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          joined_at?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: string
          emailed_at: string | null
          id: string
          message: string
          metadata: Json | null
          portfolio_id: string
          severity: string
          strategy_id: string | null
          triggered_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          emailed_at?: string | null
          id?: string
          message: string
          metadata?: Json | null
          portfolio_id: string
          severity: string
          strategy_id?: string | null
          triggered_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          emailed_at?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          portfolio_id?: string
          severity?: string
          strategy_id?: string | null
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_alerts_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_alerts_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_analytics: {
        Row: {
          attribution_breakdown: Json | null
          avg_pairwise_correlation: number | null
          benchmark_comparison: Json | null
          computation_error: string | null
          computation_status: string | null
          computed_at: string | null
          correlation_matrix: Json | null
          id: string
          narrative_summary: string | null
          optimizer_suggestions: Json | null
          portfolio_equity_curve: Json | null
          portfolio_id: string
          portfolio_max_drawdown: number | null
          portfolio_sharpe: number | null
          portfolio_volatility: number | null
          return_24h: number | null
          return_mtd: number | null
          return_ytd: number | null
          risk_decomposition: Json | null
          rolling_correlation: Json | null
          total_aum: number | null
          total_return_mwr: number | null
          total_return_twr: number | null
        }
        Insert: {
          attribution_breakdown?: Json | null
          avg_pairwise_correlation?: number | null
          benchmark_comparison?: Json | null
          computation_error?: string | null
          computation_status?: string | null
          computed_at?: string | null
          correlation_matrix?: Json | null
          id?: string
          narrative_summary?: string | null
          optimizer_suggestions?: Json | null
          portfolio_equity_curve?: Json | null
          portfolio_id: string
          portfolio_max_drawdown?: number | null
          portfolio_sharpe?: number | null
          portfolio_volatility?: number | null
          return_24h?: number | null
          return_mtd?: number | null
          return_ytd?: number | null
          risk_decomposition?: Json | null
          rolling_correlation?: Json | null
          total_aum?: number | null
          total_return_mwr?: number | null
          total_return_twr?: number | null
        }
        Update: {
          attribution_breakdown?: Json | null
          avg_pairwise_correlation?: number | null
          benchmark_comparison?: Json | null
          computation_error?: string | null
          computation_status?: string | null
          computed_at?: string | null
          correlation_matrix?: Json | null
          id?: string
          narrative_summary?: string | null
          optimizer_suggestions?: Json | null
          portfolio_equity_curve?: Json | null
          portfolio_id?: string
          portfolio_max_drawdown?: number | null
          portfolio_sharpe?: number | null
          portfolio_volatility?: number | null
          return_24h?: number | null
          return_mtd?: number | null
          return_ytd?: number | null
          risk_decomposition?: Json | null
          rolling_correlation?: Json | null
          total_aum?: number | null
          total_return_mwr?: number | null
          total_return_twr?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_analytics_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_strategies: {
        Row: {
          added_at: string
          alias: string | null
          allocated_amount: number | null
          allocated_at: string | null
          current_weight: number | null
          founder_notes: Json | null
          last_founder_contact: string | null
          portfolio_id: string
          relationship_status: string | null
          strategy_id: string
          tenant_id: string | null
        }
        Insert: {
          added_at?: string
          alias?: string | null
          allocated_amount?: number | null
          allocated_at?: string | null
          current_weight?: number | null
          founder_notes?: Json | null
          last_founder_contact?: string | null
          portfolio_id: string
          relationship_status?: string | null
          strategy_id: string
          tenant_id?: string | null
        }
        Update: {
          added_at?: string
          alias?: string | null
          allocated_amount?: number | null
          allocated_at?: string | null
          current_weight?: number | null
          founder_notes?: Json | null
          last_founder_contact?: string | null
          portfolio_id?: string
          relationship_status?: string | null
          strategy_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_strategies_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_strategies_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_test: boolean
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_test?: boolean
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_test?: boolean
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolios_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      position_snapshots: {
        Row: {
          computed_at: string
          created_at: string
          entry_price: number | null
          exchange: string | null
          id: string
          mark_price: number | null
          side: string
          size_base: number | null
          size_usd: number | null
          snapshot_date: string
          strategy_id: string
          symbol: string
          unrealized_pnl: number | null
        }
        Insert: {
          computed_at?: string
          created_at?: string
          entry_price?: number | null
          exchange?: string | null
          id?: string
          mark_price?: number | null
          side: string
          size_base?: number | null
          size_usd?: number | null
          snapshot_date: string
          strategy_id: string
          symbol: string
          unrealized_pnl?: number | null
        }
        Update: {
          computed_at?: string
          created_at?: string
          entry_price?: number | null
          exchange?: string | null
          id?: string
          mark_price?: number | null
          side?: string
          size_base?: number | null
          size_usd?: number | null
          snapshot_date?: string
          strategy_id?: string
          symbol?: string
          unrealized_pnl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "position_snapshots_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          closed_at: string | null
          created_at: string
          duration_days: number | null
          entry_price_avg: number
          exit_price_avg: number | null
          fee_total: number | null
          fill_count: number
          funding_pnl: number
          id: string
          opened_at: string
          realized_pnl: number | null
          roi: number | null
          side: string
          size_base: number
          size_peak: number
          status: string
          strategy_id: string
          symbol: string
          unrealized_pnl: number | null
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          duration_days?: number | null
          entry_price_avg: number
          exit_price_avg?: number | null
          fee_total?: number | null
          fill_count?: number
          funding_pnl?: number
          id?: string
          opened_at: string
          realized_pnl?: number | null
          roi?: number | null
          side: string
          size_base: number
          size_peak: number
          status: string
          strategy_id: string
          symbol: string
          unrealized_pnl?: number | null
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          duration_days?: number | null
          entry_price_avg?: number
          exit_price_avg?: number | null
          fee_total?: number | null
          fill_count?: number
          funding_pnl?: number
          id?: string
          opened_at?: string
          realized_pnl?: number | null
          roi?: number | null
          side?: string
          size_base?: number
          size_peak?: number
          status?: string
          strategy_id?: string
          symbol?: string
          unrealized_pnl?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allocator_status: string
          aum_range: string | null
          avatar_url: string | null
          bio: string | null
          company: string | null
          created_at: string
          description: string | null
          display_name: string
          email: string | null
          id: string
          is_admin: boolean
          linkedin: string | null
          manager_status: string
          partner_tag: string | null
          preferences_updated_at: string | null
          role: string
          telegram: string | null
          tenant_id: string | null
          website: string | null
          years_trading: number | null
        }
        Insert: {
          allocator_status?: string
          aum_range?: string | null
          avatar_url?: string | null
          bio?: string | null
          company?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          email?: string | null
          id: string
          is_admin?: boolean
          linkedin?: string | null
          manager_status?: string
          partner_tag?: string | null
          preferences_updated_at?: string | null
          role?: string
          telegram?: string | null
          tenant_id?: string | null
          website?: string | null
          years_trading?: number | null
        }
        Update: {
          allocator_status?: string
          aum_range?: string | null
          avatar_url?: string | null
          bio?: string | null
          company?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_admin?: boolean
          linkedin?: string | null
          manager_status?: string
          partner_tag?: string | null
          preferences_updated_at?: string | null
          role?: string
          telegram?: string | null
          tenant_id?: string | null
          website?: string | null
          years_trading?: number | null
        }
        Relationships: []
      }
      reconciliation_reports: {
        Row: {
          created_at: string
          discrepancies: Json
          discrepancy_count: number
          id: string
          report_date: string
          status: string
          strategy_id: string
        }
        Insert: {
          created_at?: string
          discrepancies?: Json
          discrepancy_count?: number
          id?: string
          report_date: string
          status: string
          strategy_id: string
        }
        Update: {
          created_at?: string
          discrepancies?: Json
          discrepancy_count?: number
          id?: string
          report_date?: string
          status?: string
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_reports_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      relationship_documents: {
        Row: {
          contact_request_id: string | null
          content: string | null
          created_at: string | null
          doc_type: string | null
          file_name: string | null
          file_path: string | null
          file_type: string
          file_url: string
          id: string
          portfolio_id: string | null
          strategy_id: string | null
          title: string | null
          uploaded_by: string | null
        }
        Insert: {
          contact_request_id?: string | null
          content?: string | null
          created_at?: string | null
          doc_type?: string | null
          file_name?: string | null
          file_path?: string | null
          file_type?: string
          file_url: string
          id?: string
          portfolio_id?: string | null
          strategy_id?: string | null
          title?: string | null
          uploaded_by?: string | null
        }
        Update: {
          contact_request_id?: string | null
          content?: string | null
          created_at?: string | null
          doc_type?: string | null
          file_name?: string | null
          file_path?: string | null
          file_type?: string
          file_url?: string
          id?: string
          portfolio_id?: string | null
          strategy_id?: string | null
          title?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "relationship_documents_contact_request_id_fkey"
            columns: ["contact_request_id"]
            isOneToOne: false
            referencedRelation: "contact_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_documents_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_documents_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategies: {
        Row: {
          api_key_id: string | null
          aum: number | null
          avg_daily_turnover: number | null
          benchmark: string
          category_id: string | null
          codename: string | null
          created_at: string
          description: string | null
          disclosure_tier: string
          id: string
          is_example: boolean
          leverage_range: string | null
          markets: string[]
          max_capacity: number | null
          name: string
          organization_id: string | null
          partner_tag: string | null
          public_contact_email: string | null
          review_note: string | null
          source: string
          start_date: string | null
          status: string
          strategy_types: string[]
          subtypes: string[]
          supported_exchanges: string[]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          api_key_id?: string | null
          aum?: number | null
          avg_daily_turnover?: number | null
          benchmark?: string
          category_id?: string | null
          codename?: string | null
          created_at?: string
          description?: string | null
          disclosure_tier?: string
          id?: string
          is_example?: boolean
          leverage_range?: string | null
          markets?: string[]
          max_capacity?: number | null
          name: string
          organization_id?: string | null
          partner_tag?: string | null
          public_contact_email?: string | null
          review_note?: string | null
          source?: string
          start_date?: string | null
          status?: string
          strategy_types?: string[]
          subtypes?: string[]
          supported_exchanges?: string[]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          api_key_id?: string | null
          aum?: number | null
          avg_daily_turnover?: number | null
          benchmark?: string
          category_id?: string | null
          codename?: string | null
          created_at?: string
          description?: string | null
          disclosure_tier?: string
          id?: string
          is_example?: boolean
          leverage_range?: string | null
          markets?: string[]
          max_capacity?: number | null
          name?: string
          organization_id?: string | null
          partner_tag?: string | null
          public_contact_email?: string | null
          review_note?: string | null
          source?: string
          start_date?: string | null
          status?: string
          strategy_types?: string[]
          subtypes?: string[]
          supported_exchanges?: string[]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategies_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "discovery_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_analytics: {
        Row: {
          benchmark: string | null
          cagr: number | null
          calmar: number | null
          computation_error: string | null
          computation_status: string
          computed_at: string
          cumulative_return: number | null
          daily_returns: Json | null
          data_quality_flags: Json | null
          drawdown_series: Json | null
          exposure_metrics: Json | null
          id: string
          max_drawdown: number | null
          max_drawdown_duration_days: number | null
          metrics_json: Json | null
          monthly_returns: Json | null
          return_quantiles: Json | null
          returns_series: Json | null
          rolling_metrics: Json | null
          sharpe: number | null
          six_month_return: number | null
          sortino: number | null
          sparkline_drawdown: Json | null
          sparkline_returns: Json | null
          strategy_id: string
          trade_metrics: Json | null
          volatility: number | null
          volume_metrics: Json | null
        }
        Insert: {
          benchmark?: string | null
          cagr?: number | null
          calmar?: number | null
          computation_error?: string | null
          computation_status?: string
          computed_at?: string
          cumulative_return?: number | null
          daily_returns?: Json | null
          data_quality_flags?: Json | null
          drawdown_series?: Json | null
          exposure_metrics?: Json | null
          id?: string
          max_drawdown?: number | null
          max_drawdown_duration_days?: number | null
          metrics_json?: Json | null
          monthly_returns?: Json | null
          return_quantiles?: Json | null
          returns_series?: Json | null
          rolling_metrics?: Json | null
          sharpe?: number | null
          six_month_return?: number | null
          sortino?: number | null
          sparkline_drawdown?: Json | null
          sparkline_returns?: Json | null
          strategy_id: string
          trade_metrics?: Json | null
          volatility?: number | null
          volume_metrics?: Json | null
        }
        Update: {
          benchmark?: string | null
          cagr?: number | null
          calmar?: number | null
          computation_error?: string | null
          computation_status?: string
          computed_at?: string
          cumulative_return?: number | null
          daily_returns?: Json | null
          data_quality_flags?: Json | null
          drawdown_series?: Json | null
          exposure_metrics?: Json | null
          id?: string
          max_drawdown?: number | null
          max_drawdown_duration_days?: number | null
          metrics_json?: Json | null
          monthly_returns?: Json | null
          return_quantiles?: Json | null
          returns_series?: Json | null
          rolling_metrics?: Json | null
          sharpe?: number | null
          six_month_return?: number | null
          sortino?: number | null
          sparkline_drawdown?: Json | null
          sparkline_returns?: Json | null
          strategy_id?: string
          trade_metrics?: Json | null
          volatility?: number | null
          volume_metrics?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_analytics_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: true
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_flags: {
        Row: {
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      token_price_history: {
        Row: {
          asof: string
          fetched_at: string
          price_usd: number
          source: string
          symbol: string
        }
        Insert: {
          asof: string
          fetched_at?: string
          price_usd: number
          source?: string
          symbol: string
        }
        Update: {
          asof?: string
          fetched_at?: string
          price_usd?: number
          source?: string
          symbol?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          cost: number | null
          exchange: string
          exchange_fill_id: string | null
          exchange_order_id: string | null
          fee: number | null
          fee_currency: string | null
          id: string
          is_fill: boolean
          is_maker: boolean | null
          order_type: string | null
          price: number
          quantity: number
          raw_data: Json | null
          side: string
          strategy_id: string
          symbol: string
          timestamp: string
        }
        Insert: {
          cost?: number | null
          exchange: string
          exchange_fill_id?: string | null
          exchange_order_id?: string | null
          fee?: number | null
          fee_currency?: string | null
          id?: string
          is_fill?: boolean
          is_maker?: boolean | null
          order_type?: string | null
          price: number
          quantity: number
          raw_data?: Json | null
          side: string
          strategy_id: string
          symbol: string
          timestamp: string
        }
        Update: {
          cost?: number | null
          exchange?: string
          exchange_fill_id?: string | null
          exchange_order_id?: string | null
          fee?: number | null
          fee_currency?: string | null
          id?: string
          is_fill?: boolean
          is_maker?: boolean | null
          order_type?: string | null
          price?: number
          quantity?: number
          raw_data?: Json | null
          side?: string
          strategy_id?: string
          symbol?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      used_ack_tokens: {
        Row: {
          alert_id: string | null
          token_hash: string
          used_at: string
        }
        Insert: {
          alert_id?: string | null
          token_hash: string
          used_at?: string
        }
        Update: {
          alert_id?: string | null
          token_hash?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "used_ack_tokens_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "portfolio_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_app_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          role: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      user_favorites: {
        Row: {
          created_at: string
          notes: string | null
          strategy_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          notes?: string | null
          strategy_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          notes?: string | null
          strategy_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_favorites_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          scope_kind: string
          scope_ref: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          scope_kind: string
          scope_ref: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          scope_kind?: string
          scope_ref?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_requests: {
        Row: {
          api_key_encrypted: string
          api_secret_encrypted: string | null
          completed_at: string | null
          created_at: string | null
          dek_encrypted: string
          discovered_manager_id: string | null
          email: string
          error_message: string | null
          exchange: string
          expires_at: string | null
          id: string
          kek_version: number | null
          matched_strategy_id: string | null
          nonce: string | null
          passphrase_encrypted: string | null
          public_token: string | null
          results: Json | null
          status: string | null
        }
        Insert: {
          api_key_encrypted: string
          api_secret_encrypted?: string | null
          completed_at?: string | null
          created_at?: string | null
          dek_encrypted: string
          discovered_manager_id?: string | null
          email: string
          error_message?: string | null
          exchange: string
          expires_at?: string | null
          id?: string
          kek_version?: number | null
          matched_strategy_id?: string | null
          nonce?: string | null
          passphrase_encrypted?: string | null
          public_token?: string | null
          results?: Json | null
          status?: string | null
        }
        Update: {
          api_key_encrypted?: string
          api_secret_encrypted?: string | null
          completed_at?: string | null
          created_at?: string | null
          dek_encrypted?: string
          discovered_manager_id?: string | null
          email?: string
          error_message?: string | null
          exchange?: string
          expires_at?: string | null
          id?: string
          kek_version?: number | null
          matched_strategy_id?: string | null
          nonce?: string | null
          passphrase_encrypted?: string | null
          public_token?: string | null
          results?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_requests_matched_strategy_id_fkey"
            columns: ["matched_strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      weight_snapshots: {
        Row: {
          actual_weight: number | null
          created_at: string
          id: string
          portfolio_id: string
          snapshot_date: string
          strategy_id: string
          target_weight: number | null
        }
        Insert: {
          actual_weight?: number | null
          created_at?: string
          id?: string
          portfolio_id: string
          snapshot_date: string
          strategy_id: string
          target_weight?: number | null
        }
        Update: {
          actual_weight?: number | null
          created_at?: string
          id?: string
          portfolio_id?: string
          snapshot_date?: string
          strategy_id?: string
          target_weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "weight_snapshots_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weight_snapshots_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      compute_jobs_admin: {
        Row: {
          attempts: number | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string | null
          error_kind: string | null
          exchange: string | null
          id: string | null
          idempotency_key: string | null
          kind: string | null
          last_error: string | null
          max_attempts: number | null
          metadata: Json | null
          next_attempt_at: string | null
          portfolio_id: string | null
          portfolio_name: string | null
          portfolio_user_id: string | null
          status: string | null
          strategy_id: string | null
          strategy_name: string | null
          strategy_user_id: string | null
          trade_count: number | null
          updated_at: string | null
          user_email: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compute_jobs_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "compute_job_kinds"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "compute_jobs_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compute_jobs_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_user_id_fkey"
            columns: ["portfolio_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_user_id_fkey"
            columns: ["portfolio_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_user_id_fkey"
            columns: ["strategy_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_user_id_fkey"
            columns: ["strategy_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string | null
          description: string | null
          display_name: string | null
          id: string | null
          role: string | null
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          id?: string | null
          role?: string | null
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          id?: string | null
          role?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _assert_owner: {
        Args: { p_context: string; p_row_id: string; p_table: unknown }
        Returns: undefined
      }
      _enqueue_compute_job_internal: {
        Args: {
          p_allocator_id?: string
          p_api_key_id?: string
          p_exchange: string
          p_idempotency_key: string
          p_kind: string
          p_metadata: Json
          p_parent_job_ids: string[]
          p_portfolio_id: string
          p_run_at?: string
          p_strategy_id: string
        }
        Returns: string
      }
      check_fan_in_ready: { Args: { p_child_job_id: string }; Returns: boolean }
      claim_compute_jobs: {
        Args: { p_batch_size: number; p_worker_id: string }
        Returns: {
          allocator_id: string | null
          api_key_id: string | null
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          error_kind: string | null
          exchange: string | null
          id: string
          idempotency_key: string | null
          kind: string
          last_error: string | null
          max_attempts: number
          metadata: Json | null
          next_attempt_at: string
          parent_job_ids: string[]
          portfolio_id: string | null
          status: string
          strategy_id: string | null
          trade_count: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "compute_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      compute_bridge_outcome_deltas: {
        Args: never
        Returns: {
          batch_started_at: string
          failed_count: number
          updated_count: number
        }[]
      }
      create_allocator_connected_strategy: {
        Args: {
          p_api_key_encrypted: string
          p_api_secret_encrypted: string
          p_dek_encrypted: string
          p_exchange: string
          p_kek_version: number
          p_label: string
          p_nonce: string
          p_passphrase_encrypted: string
          p_portfolio_id: string
          p_strategy_name: string
          p_user_id: string
        }
        Returns: {
          api_key_id: string
          strategy_id: string
        }[]
      }
      create_wizard_strategy: {
        Args: {
          p_api_key_encrypted: string
          p_api_secret_encrypted: string
          p_dek_encrypted: string
          p_exchange: string
          p_kek_version: number
          p_label: string
          p_nonce: string
          p_passphrase_encrypted: string
          p_placeholder_name: string
          p_user_id: string
          p_wizard_session_id: string
        }
        Returns: {
          api_key_id: string
          strategy_id: string
        }[]
      }
      current_user_has_app_role: {
        Args: { p_roles: string[] }
        Returns: boolean
      }
      defer_compute_job: {
        Args: { p_defer_seconds: number; p_job_id: string; p_reason?: string }
        Returns: string
      }
      delete_allocator_api_key: {
        Args: { p_api_key_id: string; p_cascade_holdings?: boolean }
        Returns: number
      }
      enqueue_compute_job: {
        Args: {
          p_allocator_id?: string
          p_api_key_id?: string
          p_exchange?: string
          p_idempotency_key?: string
          p_kind: string
          p_metadata?: Json
          p_parent_job_ids?: string[]
          p_run_at?: string
          p_strategy_id: string
        }
        Returns: string
      }
      enqueue_compute_portfolio_job: {
        Args: {
          p_idempotency_key?: string
          p_metadata?: Json
          p_parent_job_ids?: string[]
          p_portfolio_id: string
        }
        Returns: string
      }
      enqueue_poll_allocator_positions_for_all_keys: {
        Args: never
        Returns: number
      }
      enqueue_poll_positions_for_all_strategies: {
        Args: never
        Returns: number
      }
      enqueue_refresh_allocator_equity_for_all: {
        Args: never
        Returns: undefined
      }
      extract_delta: {
        Args: { anchor: string; days: number; series: Json }
        Returns: number
      }
      extract_equity_at: {
        Args: { series: Json; target_date: string }
        Returns: number
      }
      extract_estimated: {
        Args: { anchor: string; series: Json }
        Returns: {
          bps: number
          days: number
        }[]
      }
      extract_symbol_value_at: {
        Args: { p_allocator_id: string; p_asof: string; p_symbol: string }
        Returns: number
      }
      finalize_wizard_strategy: {
        Args: {
          p_aum: number
          p_category_id: string
          p_description: string
          p_leverage_range: string
          p_markets: string[]
          p_max_capacity: number
          p_name: string
          p_strategy_id: string
          p_strategy_types: string[]
          p_subtypes: string[]
          p_supported_exchanges: string[]
          p_user_id: string
        }
        Returns: string
      }
      get_admin_compute_jobs: {
        Args: {
          p_exchange?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: {
          attempts: number
          claimed_at: string
          claimed_by: string
          created_at: string
          error_kind: string
          exchange: string
          id: string
          idempotency_key: string
          kind: string
          last_error: string
          max_attempts: number
          metadata: Json
          next_attempt_at: string
          portfolio_id: string
          portfolio_name: string
          status: string
          strategy_id: string
          strategy_name: string
          trade_count: number
          updated_at: string
          user_email: string
        }[]
      }
      get_allocator_latest_batch_meta: {
        Args: { p_allocator_id: string }
        Returns: {
          batch_id: string
          candidate_count: number
          computed_at: string
        }[]
      }
      get_allocator_recommendations: {
        Args: { p_allocator_id: string }
        Returns: {
          analytics_computed_at: string
          cagr: number
          discovery_category_slug: string
          id: string
          max_drawdown: number
          rank: number
          reasons: string[]
          score: number
          sharpe: number
          strategy_description: string
          strategy_id: string
          strategy_name: string
        }[]
      }
      get_user_compute_jobs: {
        Args: { p_limit?: number; p_strategy_id?: string }
        Returns: {
          attempts: number
          claimed_at: string
          claimed_by: string
          created_at: string
          error_kind: string
          exchange: string
          id: string
          idempotency_key: string
          kind: string
          last_error: string
          max_attempts: number
          metadata: Json
          next_attempt_at: string
          parent_job_ids: string[]
          portfolio_id: string
          status: string
          strategy_id: string
          trade_count: number
          updated_at: string
        }[]
      }
      increment_user_session_count: {
        Args: { p_debounce_seconds?: number; p_user_id: string }
        Returns: {
          debounced: boolean
          session_count: number
        }[]
      }
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      latest_cron_success: { Args: { p_cron_name: string }; Returns: string }
      log_audit_event: {
        Args: {
          p_action: string
          p_entity_id: string
          p_entity_type: string
          p_metadata: Json
        }
        Returns: string
      }
      log_audit_event_service: {
        Args: {
          p_action: string
          p_entity_id: string
          p_entity_type: string
          p_metadata: Json
          p_user_id: string
        }
        Returns: string
      }
      mark_compute_job_done: { Args: { p_job_id: string }; Returns: undefined }
      mark_compute_job_failed: {
        Args: { p_error: string; p_error_kind?: string; p_job_id: string }
        Returns: string
      }
      parse_holding_ref: {
        Args: { p_ref: string }
        Returns: {
          holding_type: string
          symbol: string
          venue: string
        }[]
      }
      reclaim_stuck_compute_jobs: {
        Args: { p_older_than?: string }
        Returns: number
      }
      request_allocator_holdings_sync: {
        Args: { p_api_key_id: string }
        Returns: Json
      }
      reset_stalled_compute_jobs: {
        Args: { p_per_kind_overrides?: Json; p_stale_threshold?: string }
        Returns: number
      }
      sanitize_user: { Args: { p_user_id: string }; Returns: boolean }
      send_intro_with_decision: {
        Args: {
          p_admin_note: string
          p_allocator_id: string
          p_candidate_id: string
          p_decided_by: string
          p_original_strategy_id: string
          p_strategy_id: string
        }
        Returns: {
          contact_request_id: string
          match_decision_id: string
          was_already_sent: boolean
        }[]
      }
      sync_strategy_analytics_status: {
        Args: { p_strategy_id: string }
        Returns: undefined
      }
      sync_trades: {
        Args: { p_strategy_id: string; p_trades: Json }
        Returns: number
      }
      test_force_hot_to_cold_move: { Args: never; Returns: number }
      update_allocator_mandates: {
        Args: {
          p_clear_fields?: string[]
          p_correlation_ceiling?: number
          p_excluded_exchanges?: string[]
          p_liquidity_preference?: string
          p_mandate_archetype?: string
          p_max_drawdown_tolerance?: number
          p_max_weight?: number
          p_preferred_strategy_types?: string[]
          p_style_exclusions?: string[]
          p_target_ticket_size_usd?: number
        }
        Returns: undefined
      }
      update_api_key_rate_limit: {
        Args: { p_api_key_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
