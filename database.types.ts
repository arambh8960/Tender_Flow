/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: npm run db:types
 *
 * Mirrors the public schema of the Supabase project. Shared by the frontend
 * (src/services/supabase) and the server (server/db).
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type DiscoveryStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type MemberStatus = 'invited' | 'active' | 'suspended';
export type OrgRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';

export interface Database {
  public: {
    Tables: {
      analysis_runs: {
        Row: {
          id: string;
          organization_id: string;
          analysis_id: string;
          request_id: string | null;
          status: string;
          stage: string | null;
          started_at: string;
          completed_at: string | null;
          duration_ms: number | null;
          error_code: string | null;
          error_message: string | null;
          metadata: Json;
          triggered_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          analysis_id: string;
          request_id?: string | null;
          status?: string;
          stage?: string | null;
          started_at?: string;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
          triggered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          analysis_id?: string;
          request_id?: string | null;
          status?: string;
          stage?: string | null;
          started_at?: string;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
          triggered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          actor_user_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Json;
          ip_address: string | null;
          user_agent: string | null;
          request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          actor_user_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          request_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          actor_user_id?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          request_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      compliance_documents: {
        Row: {
          id: string;
          organization_id: string;
          cert_name: string;
          category: string | null;
          issued_date: string | null;
          expiry_date: string | null;
          is_valid: boolean;
          storage_path: string | null;
          legacy_file_path: string | null;
          uploaded_by: string | null;
          created_at: string;
          updated_at: string;
          mime_type: string | null;
          file_size: number | null;
          checksum: string | null;
          file_name: string | null;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          cert_name: string;
          category?: string | null;
          issued_date?: string | null;
          expiry_date?: string | null;
          is_valid?: boolean;
          storage_path?: string | null;
          legacy_file_path?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string;
          mime_type?: string | null;
          file_size?: number | null;
          checksum?: string | null;
          file_name?: string | null;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          cert_name?: string;
          category?: string | null;
          issued_date?: string | null;
          expiry_date?: string | null;
          is_valid?: boolean;
          storage_path?: string | null;
          legacy_file_path?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string;
          mime_type?: string | null;
          file_size?: number | null;
          checksum?: string | null;
          file_name?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      discovery_run_tenders: {
        Row: {
          run_id: string;
          tender_id: string;
          is_new: boolean;
          created_at: string;
        };
        Insert: {
          run_id: string;
          tender_id: string;
          is_new?: boolean;
          created_at?: string;
        };
        Update: {
          run_id?: string;
          tender_id?: string;
          is_new?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      discovery_runs: {
        Row: {
          id: string;
          organization_id: string;
          portal: string;
          criteria: Json;
          status: DiscoveryStatus;
          started_at: string | null;
          completed_at: string | null;
          total_found: number;
          total_normalized: number;
          total_duplicates: number;
          total_expired: number;
          total_candidates: number;
          total_qualified: number;
          error_message: string | null;
          errors: Json;
          triggered_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          portal: string;
          criteria?: Json;
          status?: DiscoveryStatus;
          started_at?: string | null;
          completed_at?: string | null;
          total_found?: number;
          total_normalized?: number;
          total_duplicates?: number;
          total_expired?: number;
          total_candidates?: number;
          total_qualified?: number;
          error_message?: string | null;
          errors?: Json;
          triggered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          portal?: string;
          criteria?: Json;
          status?: DiscoveryStatus;
          started_at?: string | null;
          completed_at?: string | null;
          total_found?: number;
          total_normalized?: number;
          total_duplicates?: number;
          total_expired?: number;
          total_candidates?: number;
          total_qualified?: number;
          error_message?: string | null;
          errors?: Json;
          triggered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      inventory_items: {
        Row: {
          id: string;
          organization_id: string;
          sku_id: string;
          product_name: string;
          product_category: string | null;
          product_sub_category: string | null;
          oem_brand: string | null;
          specification: Json;
          available_quantity: number;
          warehouse_id: string | null;
          supplier_id: string | null;
          truck_type: string | null;
          lead_time_days: number | null;
          cost_price: number | null;
          unit_sales_price: number | null;
          bulk_sales_price: number | null;
          gst_rate: number | null;
          brokerage: number | null;
          min_margin_percent: number | null;
          is_active: boolean;
          is_custom_made_possible: boolean;
          is_compliance_ready: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          sku_id: string;
          product_name: string;
          product_category?: string | null;
          product_sub_category?: string | null;
          oem_brand?: string | null;
          specification?: Json;
          available_quantity?: number;
          warehouse_id?: string | null;
          supplier_id?: string | null;
          truck_type?: string | null;
          lead_time_days?: number | null;
          cost_price?: number | null;
          unit_sales_price?: number | null;
          bulk_sales_price?: number | null;
          gst_rate?: number | null;
          brokerage?: number | null;
          min_margin_percent?: number | null;
          is_active?: boolean;
          is_custom_made_possible?: boolean;
          is_compliance_ready?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          sku_id?: string;
          product_name?: string;
          product_category?: string | null;
          product_sub_category?: string | null;
          oem_brand?: string | null;
          specification?: Json;
          available_quantity?: number;
          warehouse_id?: string | null;
          supplier_id?: string | null;
          truck_type?: string | null;
          lead_time_days?: number | null;
          cost_price?: number | null;
          unit_sales_price?: number | null;
          bulk_sales_price?: number | null;
          gst_rate?: number | null;
          brokerage?: number | null;
          min_margin_percent?: number | null;
          is_active?: boolean;
          is_custom_made_possible?: boolean;
          is_compliance_ready?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: OrgRole;
          token: string;
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
          status: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          email: string;
          role?: OrgRole;
          token?: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          created_at?: string;
          status?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          email?: string;
          role?: OrgRole;
          token?: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          created_at?: string;
          status?: string;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          type: string;
          title: string;
          message: string | null;
          metadata: Json;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          type: string;
          title: string;
          message?: string | null;
          metadata?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          type?: string;
          title?: string;
          message?: string | null;
          metadata?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      organization_discovery_settings: {
        Row: {
          organization_id: string;
          default_portals: string[];
          categories: string[];
          manual_avg_kms: number;
          manual_rate_per_km: number;
          allow_emd: boolean;
          min_match_threshold: number;
          delivery_type: string;
          created_at: string;
          updated_at: string;
          min_tender_value: number | null;
          max_tender_value: number | null;
          preferred_authorities: string[];
          max_distance_km: number | null;
        };
        Insert: {
          organization_id: string;
          default_portals?: string[];
          categories?: string[];
          manual_avg_kms?: number;
          manual_rate_per_km?: number;
          allow_emd?: boolean;
          min_match_threshold?: number;
          delivery_type?: string;
          created_at?: string;
          updated_at?: string;
          min_tender_value?: number | null;
          max_tender_value?: number | null;
          preferred_authorities?: string[];
          max_distance_km?: number | null;
        };
        Update: {
          organization_id?: string;
          default_portals?: string[];
          categories?: string[];
          manual_avg_kms?: number;
          manual_rate_per_km?: number;
          allow_emd?: boolean;
          min_match_threshold?: number;
          delivery_type?: string;
          created_at?: string;
          updated_at?: string;
          min_tender_value?: number | null;
          max_tender_value?: number | null;
          preferred_authorities?: string[];
          max_distance_km?: number | null;
        };
        Relationships: [];
      };
      organization_financial_settings: {
        Row: {
          organization_id: string;
          default_gst_rate: number;
          brokerage_percent: number;
          target_margin_percent: number;
          transport_buffer_percent: number;
          default_emd_percent: number;
          default_epbg_percent: number;
          rate_per_km: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          default_gst_rate?: number;
          brokerage_percent?: number;
          target_margin_percent?: number;
          transport_buffer_percent?: number;
          default_emd_percent?: number;
          default_epbg_percent?: number;
          rate_per_km?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          default_gst_rate?: number;
          brokerage_percent?: number;
          target_margin_percent?: number;
          transport_buffer_percent?: number;
          default_emd_percent?: number;
          default_epbg_percent?: number;
          rate_per_km?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: OrgRole;
          status: MemberStatus;
          invited_by: string | null;
          created_at: string;
          updated_at: string;
          invited_at: string | null;
          joined_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: OrgRole;
          status?: MemberStatus;
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
          invited_at?: string | null;
          joined_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          role?: OrgRole;
          status?: MemberStatus;
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
          invited_at?: string | null;
          joined_at?: string | null;
        };
        Relationships: [];
      };
      organization_modules: {
        Row: {
          organization_id: string;
          module_key: string;
          enabled: boolean;
          config: Json;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          module_key: string;
          enabled?: boolean;
          config?: Json;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          module_key?: string;
          enabled?: boolean;
          config?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_profiles: {
        Row: {
          organization_id: string;
          legal_name: string | null;
          address: string | null;
          gstin: string | null;
          pan: string | null;
          domain: string | null;
          annual_turnover_cr: number | null;
          turnover_year: string | null;
          experience_years: number | null;
          oem_status: string | null;
          created_at: string;
          updated_at: string;
          description: string | null;
          website: string | null;
          city: string | null;
          state: string | null;
          pincode: string | null;
          country: string | null;
        };
        Insert: {
          organization_id: string;
          legal_name?: string | null;
          address?: string | null;
          gstin?: string | null;
          pan?: string | null;
          domain?: string | null;
          annual_turnover_cr?: number | null;
          turnover_year?: string | null;
          experience_years?: number | null;
          oem_status?: string | null;
          created_at?: string;
          updated_at?: string;
          description?: string | null;
          website?: string | null;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
          country?: string | null;
        };
        Update: {
          organization_id?: string;
          legal_name?: string | null;
          address?: string | null;
          gstin?: string | null;
          pan?: string | null;
          domain?: string | null;
          annual_turnover_cr?: number | null;
          turnover_year?: string | null;
          experience_years?: number | null;
          oem_status?: string | null;
          created_at?: string;
          updated_at?: string;
          description?: string | null;
          website?: string | null;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
          country?: string | null;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          industry: string | null;
          logo_url: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          industry?: string | null;
          logo_url?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          industry?: string | null;
          logo_url?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
          email: string | null;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          email?: string | null;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          email?: string | null;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          status: string | null;
          owner_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          status?: string | null;
          owner_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          status?: string | null;
          owner_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      signing_authorities: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          designation: string | null;
          din: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          designation?: string | null;
          din?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          designation?: string | null;
          din?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          contact_email: string | null;
          contact_phone: string | null;
          address: string | null;
          lead_time_days: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          address?: string | null;
          lead_time_days?: number | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          address?: string | null;
          lead_time_days?: number | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tender_analyses: {
        Row: {
          id: string;
          organization_id: string;
          tender_id: string | null;
          source: string | null;
          source_ref: string | null;
          status: string;
          parsed_data: Json | null;
          technical_analysis: Json | null;
          pricing: Json | null;
          risk_analysis: Json | null;
          processing_seconds: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          title: string | null;
          bid_number: string | null;
          buyer: string | null;
          bid_type: string | null;
          closing_at: string | null;
          source_url: string | null;
          file_name: string | null;
          raw_content: string | null;
          raw_storage_path: string | null;
          current_run_id: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          tender_id?: string | null;
          source?: string | null;
          source_ref?: string | null;
          status?: string;
          parsed_data?: Json | null;
          technical_analysis?: Json | null;
          pricing?: Json | null;
          risk_analysis?: Json | null;
          processing_seconds?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          title?: string | null;
          bid_number?: string | null;
          buyer?: string | null;
          bid_type?: string | null;
          closing_at?: string | null;
          source_url?: string | null;
          file_name?: string | null;
          raw_content?: string | null;
          raw_storage_path?: string | null;
          current_run_id?: string | null;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          tender_id?: string | null;
          source?: string | null;
          source_ref?: string | null;
          status?: string;
          parsed_data?: Json | null;
          technical_analysis?: Json | null;
          pricing?: Json | null;
          risk_analysis?: Json | null;
          processing_seconds?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          title?: string | null;
          bid_number?: string | null;
          buyer?: string | null;
          bid_type?: string | null;
          closing_at?: string | null;
          source_url?: string | null;
          file_name?: string | null;
          raw_content?: string | null;
          raw_storage_path?: string | null;
          current_run_id?: string | null;
          error_message?: string | null;
        };
        Relationships: [];
      };
      tender_qualifications: {
        Row: {
          id: string;
          organization_id: string;
          tender_id: string;
          run_id: string | null;
          inventory_score: number | null;
          technical_score: number | null;
          quantity_score: number | null;
          compliance_score: number | null;
          logistics_score: number | null;
          commercial_score: number | null;
          overall_score: number | null;
          status: string;
          is_qualified: boolean;
          reason: string | null;
          breakdown: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          tender_id: string;
          run_id?: string | null;
          inventory_score?: number | null;
          technical_score?: number | null;
          quantity_score?: number | null;
          compliance_score?: number | null;
          logistics_score?: number | null;
          commercial_score?: number | null;
          overall_score?: number | null;
          status?: string;
          is_qualified?: boolean;
          reason?: string | null;
          breakdown?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          tender_id?: string;
          run_id?: string | null;
          inventory_score?: number | null;
          technical_score?: number | null;
          quantity_score?: number | null;
          compliance_score?: number | null;
          logistics_score?: number | null;
          commercial_score?: number | null;
          overall_score?: number | null;
          status?: string;
          is_qualified?: boolean;
          reason?: string | null;
          breakdown?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenders: {
        Row: {
          id: string;
          organization_id: string;
          portal: string;
          external_id: string;
          title: string;
          description: string | null;
          buyer: string | null;
          category: string | null;
          subcategory: string | null;
          location: string | null;
          latitude: number | null;
          longitude: number | null;
          tender_url: string | null;
          published_at: string | null;
          closing_at: string | null;
          estimated_value: number | null;
          emd_amount: number | null;
          emd_required: boolean | null;
          raw_payload: Json;
          parse_warnings: string[];
          first_seen_run: string | null;
          last_seen_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          portal: string;
          external_id: string;
          title: string;
          description?: string | null;
          buyer?: string | null;
          category?: string | null;
          subcategory?: string | null;
          location?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          tender_url?: string | null;
          published_at?: string | null;
          closing_at?: string | null;
          estimated_value?: number | null;
          emd_amount?: number | null;
          emd_required?: boolean | null;
          raw_payload?: Json;
          parse_warnings?: string[];
          first_seen_run?: string | null;
          last_seen_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          portal?: string;
          external_id?: string;
          title?: string;
          description?: string | null;
          buyer?: string | null;
          category?: string | null;
          subcategory?: string | null;
          location?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          tender_url?: string | null;
          published_at?: string | null;
          closing_at?: string | null;
          estimated_value?: number | null;
          emd_amount?: number | null;
          emd_required?: boolean | null;
          raw_payload?: Json;
          parse_warnings?: string[];
          first_seen_run?: string | null;
          last_seen_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_security: {
        Row: {
          user_id: string;
          pin_hash: string | null;
          two_fa_secret: string | null;
          is_2fa_enabled: boolean;
          is_setup_complete: boolean;
          is_locked: boolean;
          failed_attempts: number;
          last_login: string | null;
          created_at: string;
          updated_at: string;
          pin_updated_at: string | null;
          locked_until: string | null;
        };
        Insert: {
          user_id: string;
          pin_hash?: string | null;
          two_fa_secret?: string | null;
          is_2fa_enabled?: boolean;
          is_setup_complete?: boolean;
          is_locked?: boolean;
          failed_attempts?: number;
          last_login?: string | null;
          created_at?: string;
          updated_at?: string;
          pin_updated_at?: string | null;
          locked_until?: string | null;
        };
        Update: {
          user_id?: string;
          pin_hash?: string | null;
          two_fa_secret?: string | null;
          is_2fa_enabled?: boolean;
          is_setup_complete?: boolean;
          is_locked?: boolean;
          failed_attempts?: number;
          last_login?: string | null;
          created_at?: string;
          updated_at?: string;
          pin_updated_at?: string | null;
          locked_until?: string | null;
        };
        Relationships: [];
      };
      vehicles: {
        Row: {
          id: string;
          organization_id: string;
          truck_type: string;
          label: string | null;
          capacity_tons: number | null;
          cost_per_km: number | null;
          fleet_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          truck_type: string;
          label?: string | null;
          capacity_tons?: number | null;
          cost_per_km?: number | null;
          fleet_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          truck_type?: string;
          label?: string | null;
          capacity_tons?: number | null;
          cost_per_km?: number | null;
          fleet_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      warehouses: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          name: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          pincode: string | null;
          latitude: number | null;
          longitude: number | null;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          code: string;
          name?: string | null;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string;
          name?: string | null;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_organization: {
        Args: { p_name: string; p_slug?: string | null; p_industry?: string | null };
        Returns: Database['public']['Tables']['organizations']['Row'];
      };
    };
    Enums: {
      discovery_status: DiscoveryStatus;
      member_status: MemberStatus;
      org_role: OrgRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

// Convenience aliases
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type InsertDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type UpdateDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
