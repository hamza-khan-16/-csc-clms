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
      departments: {
        Row: {
          classes: string
          courses: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          classes?: string
          courses?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          classes?: string
          courses?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string
          department_id: string | null
          holiday_date: string
          id: string
          kind: string
          occasion: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          holiday_date: string
          id?: string
          kind?: string
          occasion: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          holiday_date?: string
          id?: string
          kind?: string
          occasion?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          applied_by: string | null
          created_at: string
          department_id: string | null
          from_date: string
          hod_acted_at: string | null
          hod_note: string | null
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          auto_approved_at: string | null
          paid_days: number
          payment_decision: string | null
          principal_acted_at: string | null
          principal_note: string | null
          reason: string
          session: Database["public"]["Enums"]["leave_session"]
          status: Database["public"]["Enums"]["leave_status"]
          teacher_id: string
          to_date: string
          total_days: number
          unpaid_days: number
          doc_status: "required" | "uploaded" | "verified" | null
          doc_url: string | null
          doc_note: string | null
          doc_acted_at: string | null
        }
        Insert: {
          applied_by?: string | null
          created_at?: string
          department_id?: string | null
          from_date: string
          hod_acted_at?: string | null
          hod_note?: string | null
          id?: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          paid_days?: number
          payment_decision?: string | null
          principal_acted_at?: string | null
          principal_note?: string | null
          reason: string
          session?: Database["public"]["Enums"]["leave_session"]
          status?: Database["public"]["Enums"]["leave_status"]
          teacher_id: string
          to_date: string
          total_days?: number
          unpaid_days?: number
        }
        Update: {
          applied_by?: string | null
          created_at?: string
          department_id?: string | null
          from_date?: string
          hod_acted_at?: string | null
          hod_note?: string | null
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          paid_days?: number
          payment_decision?: string | null
          principal_acted_at?: string | null
          principal_note?: string | null
          reason?: string
          session?: Database["public"]["Enums"]["leave_session"]
          status?: Database["public"]["Enums"]["leave_status"]
          teacher_id?: string
          to_date?: string
          total_days?: number
          unpaid_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      lectures: {
        Row: {
          class_name: string
          created_at: string
          day_of_week: number
          department_id: string | null
          end_time: string
          id: string
          lecture_date: string | null
          room: string
          start_time: string
          subject: string
          teacher_id: string
        }
        Insert: {
          class_name: string
          created_at?: string
          day_of_week: number
          department_id?: string | null
          end_time: string
          id?: string
          lecture_date?: string | null
          room?: string
          start_time: string
          subject: string
          teacher_id: string
        }
        Update: {
          class_name?: string
          created_at?: string
          day_of_week?: number
          department_id?: string | null
          end_time?: string
          id?: string
          lecture_date?: string | null
          room?: string
          start_time?: string
          subject?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lectures_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          body: string
          created_at: string
          created_by: string
          department_id: string | null
          id: string
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by: string
          department_id?: string | null
          id?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          department_id?: string | null
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          department_id: string | null
          designation: string
          full_name: string
          id: string
          monthly_salary: number
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          department_id?: string | null
          designation?: string
          full_name: string
          id: string
          monthly_salary?: number
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          department_id?: string | null
          designation?: string
          full_name?: string
          id?: string
          monthly_salary?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      proxy_assignments: {
        Row: {
          class_name: string
          created_at: string
          end_time: string
          id: string
          leave_request_id: string
          lecture_id: string | null
          proxy_date: string
          proxy_teacher_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["proxy_status"]
          subject: string
        }
        Insert: {
          class_name: string
          created_at?: string
          end_time: string
          id?: string
          leave_request_id: string
          lecture_id?: string | null
          proxy_date: string
          proxy_teacher_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["proxy_status"]
          subject: string
        }
        Update: {
          class_name?: string
          created_at?: string
          end_time?: string
          id?: string
          leave_request_id?: string
          lecture_id?: string | null
          proxy_date?: string
          proxy_teacher_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["proxy_status"]
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "proxy_assignments_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proxy_assignments_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          department_id: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          department_id?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          department_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      count_working_days: {
        Args: { _dept: string; _from: string; _to: string }
        Returns: number
      }
      dept_of: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      my_department: { Args: never; Returns: string }
      register_profile: {
        Args: {
          _department_id: string
          _designation: string
          _full_name: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "teacher" | "hod" | "principal" | "admin"
      leave_session: "full_day" | "forenoon" | "afternoon"
      leave_status: "pending_hod" | "hod_recommended" | "pending_principal" | "hod_approved" | "approved" | "rejected"
      leave_type: "casual" | "maternity" | "bereavement" | "other" | "emergency" | "medical" | "duty"
      proxy_status: "pending" | "accepted" | "rejected"
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
    Enums: {
      app_role: ["teacher", "hod", "principal", "admin"],
      leave_session: ["full_day", "forenoon", "afternoon"],
      leave_status: ["pending_hod", "hod_recommended", "pending_principal", "hod_approved", "approved", "rejected"],
      leave_type: ["casual", "maternity", "bereavement", "other", "emergency", "medical", "duty"],
      proxy_status: ["pending", "accepted", "rejected"],
    },
  },
} as const
