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
      core_assignments: {
        Row: {
          color: string
          core_number: number
          created_at: string
          customer: string | null
          destination: string | null
          id: string
          notes: string | null
          odc_id: string | null
          odp_id: string | null
          source: Database["public"]["Enums"]["link_source"]
          status: Database["public"]["Enums"]["core_status"]
          tube_number: number | null
          updated_at: string
        }
        Insert: {
          color: string
          core_number: number
          created_at?: string
          customer?: string | null
          destination?: string | null
          id?: string
          notes?: string | null
          odc_id?: string | null
          odp_id?: string | null
          source: Database["public"]["Enums"]["link_source"]
          status?: Database["public"]["Enums"]["core_status"]
          tube_number?: number | null
          updated_at?: string
        }
        Update: {
          color?: string
          core_number?: number
          created_at?: string
          customer?: string | null
          destination?: string | null
          id?: string
          notes?: string | null
          odc_id?: string | null
          odp_id?: string | null
          source?: Database["public"]["Enums"]["link_source"]
          status?: Database["public"]["Enums"]["core_status"]
          tube_number?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "core_assignments_odc_id_fkey"
            columns: ["odc_id"]
            isOneToOne: false
            referencedRelation: "odcs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_assignments_odp_id_fkey"
            columns: ["odp_id"]
            isOneToOne: false
            referencedRelation: "odps"
            referencedColumns: ["id"]
          },
        ]
      }
      odc_power_sources: {
        Row: {
          created_at: string
          id: string
          odc_id: string
          port_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          odc_id: string
          port_id: string
        }
        Update: {
          created_at?: string
          id?: string
          odc_id?: string
          port_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "odc_power_sources_odc_id_fkey"
            columns: ["odc_id"]
            isOneToOne: false
            referencedRelation: "odcs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odc_power_sources_port_id_fkey"
            columns: ["port_id"]
            isOneToOne: false
            referencedRelation: "olt_ports"
            referencedColumns: ["id"]
          },
        ]
      }
      odcs: {
        Row: {
          cable_type: Database["public"]["Enums"]["cable_type"]
          created_at: string
          id: string
          location: string | null
          name: string
          notes: string | null
          olt_id: string
          updated_at: string
        }
        Insert: {
          cable_type: Database["public"]["Enums"]["cable_type"]
          created_at?: string
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          olt_id: string
          updated_at?: string
        }
        Update: {
          cable_type?: Database["public"]["Enums"]["cable_type"]
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          olt_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odcs_olt_id_fkey"
            columns: ["olt_id"]
            isOneToOne: false
            referencedRelation: "olts"
            referencedColumns: ["id"]
          },
        ]
      }
      odps: {
        Row: {
          cable_type: Database["public"]["Enums"]["cable_type"]
          created_at: string
          id: string
          location: string | null
          name: string
          notes: string | null
          odc_id: string
          updated_at: string
        }
        Insert: {
          cable_type: Database["public"]["Enums"]["cable_type"]
          created_at?: string
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          odc_id: string
          updated_at?: string
        }
        Update: {
          cable_type?: Database["public"]["Enums"]["cable_type"]
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          odc_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odps_odc_id_fkey"
            columns: ["odc_id"]
            isOneToOne: false
            referencedRelation: "odcs"
            referencedColumns: ["id"]
          },
        ]
      }
      olt_cards: {
        Row: {
          card_label: string | null
          card_type: Database["public"]["Enums"]["card_type"]
          created_at: string
          id: string
          notes: string | null
          olt_id: string
          port_count: number
          slot_number: number
          updated_at: string
        }
        Insert: {
          card_label?: string | null
          card_type: Database["public"]["Enums"]["card_type"]
          created_at?: string
          id?: string
          notes?: string | null
          olt_id: string
          port_count?: number
          slot_number: number
          updated_at?: string
        }
        Update: {
          card_label?: string | null
          card_type?: Database["public"]["Enums"]["card_type"]
          created_at?: string
          id?: string
          notes?: string | null
          olt_id?: string
          port_count?: number
          slot_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olt_cards_olt_id_fkey"
            columns: ["olt_id"]
            isOneToOne: false
            referencedRelation: "olts"
            referencedColumns: ["id"]
          },
        ]
      }
      olt_ports: {
        Row: {
          card_id: string
          created_at: string
          id: string
          notes: string | null
          port_number: number
          sfp_model: string | null
          sfp_serial: string | null
          sfp_tx_power: string | null
          status: Database["public"]["Enums"]["port_status"]
          updated_at: string
        }
        Insert: {
          card_id: string
          created_at?: string
          id?: string
          notes?: string | null
          port_number: number
          sfp_model?: string | null
          sfp_serial?: string | null
          sfp_tx_power?: string | null
          status?: Database["public"]["Enums"]["port_status"]
          updated_at?: string
        }
        Update: {
          card_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          port_number?: number
          sfp_model?: string | null
          sfp_serial?: string | null
          sfp_tx_power?: string | null
          status?: Database["public"]["Enums"]["port_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olt_ports_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "olt_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      olts: {
        Row: {
          created_at: string
          id: string
          location: string | null
          name: string
          notes: string | null
          olt_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          olt_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          olt_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "operator"
      cable_type:
        | "48_core_2_tube"
        | "24_core_2_tube"
        | "12_core_2_tube"
        | "figure8_12_core"
        | "figure8_6_core"
        | "48_core_4_tube"
        | "24_core_4_tube"
        | "48_core_8_tube"
      card_type: "GTGO" | "GTGH" | "GPFA" | "GPBD" | "OTHER"
      core_status: "idle" | "used" | "reserved" | "damaged"
      link_source: "olt_to_odc" | "odc_to_odp"
      port_status: "active" | "inactive" | "reserved" | "damaged"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "operator"],
      cable_type: [
        "48_core_2_tube",
        "24_core_2_tube",
        "12_core_2_tube",
        "figure8_12_core",
        "figure8_6_core",
        "48_core_4_tube",
        "24_core_4_tube",
        "48_core_8_tube",
      ],
      card_type: ["GTGO", "GTGH", "GPFA", "GPBD", "OTHER"],
      core_status: ["idle", "used", "reserved", "damaged"],
      link_source: ["olt_to_odc", "odc_to_odp"],
      port_status: ["active", "inactive", "reserved", "damaged"],
    },
  },
} as const
