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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_prices: {
        Row: {
          close: number
          created_at: string | null
          data_source: string | null
          date: string
          has_full_volume: boolean | null
          high: number
          low: number
          open: number
          symbol: string
          volume: number
        }
        Insert: {
          close: number
          created_at?: string | null
          data_source?: string | null
          date: string
          has_full_volume?: boolean | null
          high: number
          low: number
          open: number
          symbol: string
          volume: number
        }
        Update: {
          close?: number
          created_at?: string | null
          data_source?: string | null
          date?: string
          has_full_volume?: boolean | null
          high?: number
          low?: number
          open?: number
          symbol?: string
          volume?: number
        }
        Relationships: []
      }
      data_sync_log: {
        Row: {
          completed_at: string | null
          data_source: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          started_at: string | null
          status: string
          symbols_failed: number | null
          symbols_processed: number | null
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          data_source?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          status?: string
          symbols_failed?: number | null
          symbols_processed?: number | null
          sync_type: string
        }
        Update: {
          completed_at?: string | null
          data_source?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          status?: string
          symbols_failed?: number | null
          symbols_processed?: number | null
          sync_type?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      market_scan_results: {
        Row: {
          alignment_reason: string | null
          alignment_status: string | null
          approved_for_live_scanner: boolean
          blocked_low_quality: boolean
          blockers: string[]
          confidence_level: string | null
          created_at: string
          id: number
          industry: string | null
          is_tier1_default: boolean
          pattern: string | null
          payload: Json
          promotion_status: string
          recommendation: string | null
          review_needed: boolean
          run_id: number
          scan_date: string
          scan_timestamp: string
          score: number | null
          sector: string | null
          support_level: string | null
          symbol: string
          trend_state: string | null
        }
        Insert: {
          alignment_reason?: string | null
          alignment_status?: string | null
          approved_for_live_scanner?: boolean
          blocked_low_quality?: boolean
          blockers?: string[]
          confidence_level?: string | null
          created_at?: string
          id?: number
          industry?: string | null
          is_tier1_default?: boolean
          pattern?: string | null
          payload?: Json
          promotion_status?: string
          recommendation?: string | null
          review_needed?: boolean
          run_id: number
          scan_date: string
          scan_timestamp?: string
          score?: number | null
          sector?: string | null
          support_level?: string | null
          symbol: string
          trend_state?: string | null
        }
        Update: {
          alignment_reason?: string | null
          alignment_status?: string | null
          approved_for_live_scanner?: boolean
          blocked_low_quality?: boolean
          blockers?: string[]
          confidence_level?: string | null
          created_at?: string
          id?: number
          industry?: string | null
          is_tier1_default?: boolean
          pattern?: string | null
          payload?: Json
          promotion_status?: string
          recommendation?: string | null
          review_needed?: boolean
          run_id?: number
          scan_date?: string
          scan_timestamp?: string
          score?: number | null
          sector?: string | null
          support_level?: string | null
          symbol?: string
          trend_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_scan_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "market_scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_scan_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "market_scan_runs_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_scan_results_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "symbol_industry_alignment_active"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "market_scan_results_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["symbol"]
          },
        ]
      }
      market_scan_runs: {
        Row: {
          blocker_summary: Json | null
          completed_at: string | null
          error_message: string | null
          error_sqlstate: string | null
          failing_step: string | null
          failure_reasons: Json
          id: number
          metadata: Json
          run_label: string | null
          scan_date: string
          stage_counts: Json | null
          started_at: string
          status: string
          symbols_failed: number
          symbols_scanned: number
          symbols_targeted: number
          universe_run_id: number | null
        }
        Insert: {
          blocker_summary?: Json | null
          completed_at?: string | null
          error_message?: string | null
          error_sqlstate?: string | null
          failing_step?: string | null
          failure_reasons?: Json
          id?: number
          metadata?: Json
          run_label?: string | null
          scan_date?: string
          stage_counts?: Json | null
          started_at?: string
          status?: string
          symbols_failed?: number
          symbols_scanned?: number
          symbols_targeted?: number
          universe_run_id?: number | null
        }
        Update: {
          blocker_summary?: Json | null
          completed_at?: string | null
          error_message?: string | null
          error_sqlstate?: string | null
          failing_step?: string | null
          failure_reasons?: Json
          id?: number
          metadata?: Json
          run_label?: string | null
          scan_date?: string
          stage_counts?: Json | null
          started_at?: string
          status?: string
          symbols_failed?: number
          symbols_scanned?: number
          symbols_targeted?: number
          universe_run_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_scan_runs_universe_run_id_fkey"
            columns: ["universe_run_id"]
            isOneToOne: false
            referencedRelation: "scanner_universe_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scanner_universe_runs: {
        Row: {
          as_of_date: string
          blocked_symbols: number
          eligible_symbols: number
          id: number
          metadata: Json
          run_at: string
          run_label: string | null
          total_symbols: number
        }
        Insert: {
          as_of_date?: string
          blocked_symbols?: number
          eligible_symbols?: number
          id?: number
          metadata?: Json
          run_at?: string
          run_label?: string | null
          total_symbols?: number
        }
        Update: {
          as_of_date?: string
          blocked_symbols?: number
          eligible_symbols?: number
          id?: number
          metadata?: Json
          run_at?: string
          run_label?: string | null
          total_symbols?: number
        }
        Relationships: []
      }
      scanner_universe_snapshot: {
        Row: {
          alignment_eligible: boolean | null
          baseline_eligible: boolean | null
          blocker_alignment_ineligible: boolean | null
          blocker_below_min_price: boolean | null
          blocker_below_min_volume: boolean | null
          blocker_low_confidence: boolean | null
          blocker_no_price_data: boolean | null
          blocker_unknown_sector: boolean | null
          canonical_industry: string | null
          canonical_sector: string | null
          classification_confidence_level: string | null
          classification_status: string | null
          created_at: string
          exclusion_reasons: string[]
          history_bars: number
          indicator_ready: boolean
          is_scanner_eligible: boolean
          latest_indicator_date: string | null
          latest_price_date: string | null
          run_id: number
          support_level: string | null
          symbol: string
        }
        Insert: {
          alignment_eligible?: boolean | null
          baseline_eligible?: boolean | null
          blocker_alignment_ineligible?: boolean | null
          blocker_below_min_price?: boolean | null
          blocker_below_min_volume?: boolean | null
          blocker_low_confidence?: boolean | null
          blocker_no_price_data?: boolean | null
          blocker_unknown_sector?: boolean | null
          canonical_industry?: string | null
          canonical_sector?: string | null
          classification_confidence_level?: string | null
          classification_status?: string | null
          created_at?: string
          exclusion_reasons?: string[]
          history_bars?: number
          indicator_ready?: boolean
          is_scanner_eligible?: boolean
          latest_indicator_date?: string | null
          latest_price_date?: string | null
          run_id: number
          support_level?: string | null
          symbol: string
        }
        Update: {
          alignment_eligible?: boolean | null
          baseline_eligible?: boolean | null
          blocker_alignment_ineligible?: boolean | null
          blocker_below_min_price?: boolean | null
          blocker_below_min_volume?: boolean | null
          blocker_low_confidence?: boolean | null
          blocker_no_price_data?: boolean | null
          blocker_unknown_sector?: boolean | null
          canonical_industry?: string | null
          canonical_sector?: string | null
          classification_confidence_level?: string | null
          classification_status?: string | null
          created_at?: string
          exclusion_reasons?: string[]
          history_bars?: number
          indicator_ready?: boolean
          is_scanner_eligible?: boolean
          latest_indicator_date?: string | null
          latest_price_date?: string | null
          run_id?: number
          support_level?: string | null
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "scanner_universe_snapshot_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "scanner_universe_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scanner_universe_snapshot_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "symbol_industry_alignment_active"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "scanner_universe_snapshot_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["symbol"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      symbols: {
        Row: {
          asset_class: string | null
          canonical_industry: string | null
          canonical_sector: string | null
          classification_confidence_level: string | null
          classification_status: string | null
          created_at: string | null
          eligible_for_backfill: boolean | null
          eligible_for_full_wsp: boolean | null
          enriched_at: string | null
          exchange: string | null
          industry: string | null
          instrument_type: string | null
          is_active: boolean | null
          is_adr: boolean | null
          is_common_stock: boolean | null
          is_etf: boolean | null
          name: string | null
          primary_exchange: string | null
          sector: string | null
          sic_code: string | null
          sic_description: string | null
          support_level: string | null
          symbol: string
          updated_at: string | null
        }
        Insert: {
          asset_class?: string | null
          canonical_industry?: string | null
          canonical_sector?: string | null
          classification_confidence_level?: string | null
          classification_status?: string | null
          created_at?: string | null
          eligible_for_backfill?: boolean | null
          eligible_for_full_wsp?: boolean | null
          enriched_at?: string | null
          exchange?: string | null
          industry?: string | null
          instrument_type?: string | null
          is_active?: boolean | null
          is_adr?: boolean | null
          is_common_stock?: boolean | null
          is_etf?: boolean | null
          name?: string | null
          primary_exchange?: string | null
          sector?: string | null
          sic_code?: string | null
          sic_description?: string | null
          support_level?: string | null
          symbol: string
          updated_at?: string | null
        }
        Update: {
          asset_class?: string | null
          canonical_industry?: string | null
          canonical_sector?: string | null
          classification_confidence_level?: string | null
          classification_status?: string | null
          created_at?: string | null
          eligible_for_backfill?: boolean | null
          eligible_for_full_wsp?: boolean | null
          enriched_at?: string | null
          exchange?: string | null
          industry?: string | null
          instrument_type?: string | null
          is_active?: boolean | null
          is_adr?: boolean | null
          is_common_stock?: boolean | null
          is_etf?: boolean | null
          name?: string | null
          primary_exchange?: string | null
          sector?: string | null
          sic_code?: string | null
          sic_description?: string | null
          support_level?: string | null
          symbol?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_credits: {
        Row: {
          balance: number
          id: string
          lifetime_purchased: number
          lifetime_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          id?: string
          lifetime_purchased?: number
          lifetime_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          id?: string
          lifetime_purchased?: number
          lifetime_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wsp_indicators: {
        Row: {
          above_ma150: boolean | null
          above_ma50: boolean | null
          avg_volume_5d: number | null
          calc_date: string
          close: number
          created_at: string | null
          ma150: number | null
          ma50: number | null
          ma50_slope: string | null
          mansfield_rs: number | null
          pct_change_1d: number | null
          pct_from_52w_high: number | null
          symbol: string
          volume: number | null
          volume_ratio: number | null
          wsp_pattern: string | null
          wsp_score: number | null
        }
        Insert: {
          above_ma150?: boolean | null
          above_ma50?: boolean | null
          avg_volume_5d?: number | null
          calc_date: string
          close: number
          created_at?: string | null
          ma150?: number | null
          ma50?: number | null
          ma50_slope?: string | null
          mansfield_rs?: number | null
          pct_change_1d?: number | null
          pct_from_52w_high?: number | null
          symbol: string
          volume?: number | null
          volume_ratio?: number | null
          wsp_pattern?: string | null
          wsp_score?: number | null
        }
        Update: {
          above_ma150?: boolean | null
          above_ma50?: boolean | null
          avg_volume_5d?: number | null
          calc_date?: string
          close?: number
          created_at?: string | null
          ma150?: number | null
          ma50?: number | null
          ma50_slope?: string | null
          mansfield_rs?: number | null
          pct_change_1d?: number | null
          pct_from_52w_high?: number | null
          symbol?: string
          volume?: number | null
          volume_ratio?: number | null
          wsp_pattern?: string | null
          wsp_score?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      market_scan_results_latest: {
        Row: {
          alignment_reason: string | null
          alignment_status: string | null
          approved_for_live_scanner: boolean | null
          blocked_low_quality: boolean | null
          blockers: string[] | null
          confidence_level: string | null
          industry: string | null
          is_tier1_default: boolean | null
          pattern: string | null
          payload: Json | null
          promotion_status: string | null
          recommendation: string | null
          review_needed: boolean | null
          run_id: number | null
          scan_date: string | null
          scan_timestamp: string | null
          score: number | null
          sector: string | null
          support_level: string | null
          symbol: string | null
          trend_state: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_scan_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "market_scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_scan_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "market_scan_runs_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_scan_results_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "symbol_industry_alignment_active"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "market_scan_results_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["symbol"]
          },
        ]
      }
      market_scan_runs_safe: {
        Row: {
          blocker_summary: Json | null
          completed_at: string | null
          id: number | null
          metadata: Json | null
          run_label: string | null
          scan_date: string | null
          stage_counts: Json | null
          started_at: string | null
          status: string | null
          symbols_failed: number | null
          symbols_scanned: number | null
          symbols_targeted: number | null
          universe_run_id: number | null
        }
        Insert: {
          blocker_summary?: Json | null
          completed_at?: string | null
          id?: number | null
          metadata?: Json | null
          run_label?: string | null
          scan_date?: string | null
          stage_counts?: Json | null
          started_at?: string | null
          status?: string | null
          symbols_failed?: number | null
          symbols_scanned?: number | null
          symbols_targeted?: number | null
          universe_run_id?: number | null
        }
        Update: {
          blocker_summary?: Json | null
          completed_at?: string | null
          id?: number | null
          metadata?: Json | null
          run_label?: string | null
          scan_date?: string | null
          stage_counts?: Json | null
          started_at?: string | null
          status?: string | null
          symbols_failed?: number | null
          symbols_scanned?: number | null
          symbols_targeted?: number | null
          universe_run_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_scan_runs_universe_run_id_fkey"
            columns: ["universe_run_id"]
            isOneToOne: false
            referencedRelation: "scanner_universe_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      symbol_industry_alignment_active: {
        Row: {
          alignment_eligible: boolean | null
          alignment_reason: string | null
          alignment_status: string | null
          canonical_industry: string | null
          canonical_sector: string | null
          symbol: string | null
        }
        Insert: {
          alignment_eligible?: never
          alignment_reason?: never
          alignment_status?: never
          canonical_industry?: string | null
          canonical_sector?: string | null
          symbol?: string | null
        }
        Update: {
          alignment_eligible?: never
          alignment_reason?: never
          alignment_status?: never
          canonical_industry?: string | null
          canonical_sector?: string | null
          symbol?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_tier1_price_coverage: {
        Args: { p_symbols: string[] }
        Returns: {
          bars: number
          symbol: string
        }[]
      }
      backfill_symbol_yahoo: { Args: { p_symbol: string }; Returns: Json }
      bulk_enrich_sectors_from_data: { Args: never; Returns: number }
      consume_credit: {
        Args: { p_amount?: number; p_description?: string; p_user_id: string }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_scanner_funnel_counts: { Args: never; Returns: Json }
      get_symbols_needing_backfill: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          bars: number
          symbol: string
        }[]
      }
      get_top_wsp_setups: {
        Args: never
        Returns: {
          industry: string
          pattern: string
          payload: Json
          recommendation: string
          score: number
          sector: string
          symbol: string
          vol_ratio: number
        }[]
      }
      materialize_wsp_indicators: {
        Args: { p_from_date?: string; p_to_date?: string }
        Returns: undefined
      }
      materialize_wsp_indicators_from_prices: {
        Args: {
          p_as_of_date?: string
          p_min_bars?: number
          p_symbols?: string[]
        }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      refresh_scanner_universe_snapshot: {
        Args: { p_as_of_date: string; p_run_label: string }
        Returns: number
      }
      run_broad_market_scan: {
        Args: { p_as_of_date: string; p_run_label: string }
        Returns: number
      }
      scanner_operator_snapshot: { Args: never; Returns: Json }
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
