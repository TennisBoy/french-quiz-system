
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "answer_keys": {
                  Row: {
                    "assignment_id": string,"key": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id": string,"key": NonNullable<Json>
                  }
                  Update: {
                    "assignment_id"?: string,"key"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "answer_keys_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: true
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    }
                  ]
                },"assignments": {
                  Row: {
                    "content": NonNullable<Json>,"created_at": string,"description": string | null,"id": string,"owner_id": string | null,"school_id": string,"show_score_on_submit": boolean,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": NonNullable<Json>,"created_at"?: string,"description"?: string | null,"id"?: string,"owner_id"?: string | null,"school_id": string,"show_score_on_submit"?: boolean,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"description"?: string | null,"id"?: string,"owner_id"?: string | null,"school_id"?: string,"show_score_on_submit"?: boolean,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_school_id_fkey"
      columns: ["school_id"]
isOneToOne: false
      referencedRelation: "schools"
      referencedColumns: ["id"]
    }
                  ]
                },"class_assignments": {
                  Row: {
                    "assignment_id": string,"class_id": string,"created_at": string,"due_at": string | null,"is_open": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id": string,"class_id": string,"created_at"?: string,"due_at"?: string | null,"is_open"?: boolean
                  }
                  Update: {
                    "assignment_id"?: string,"class_id"?: string,"created_at"?: string,"due_at"?: string | null,"is_open"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "class_assignments_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_assignments_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    }
                  ]
                },"class_teachers": {
                  Row: {
                    "class_id": string,"created_at": string,"teacher_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_id": string,"created_at"?: string,"teacher_id": string
                  }
                  Update: {
                    "class_id"?: string,"created_at"?: string,"teacher_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "class_teachers_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_teachers_teacher_id_fkey"
      columns: ["teacher_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"classes": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"name": string | null,"school_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"name"?: string | null,"school_id": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"name"?: string | null,"school_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "classes_school_id_fkey"
      columns: ["school_id"]
isOneToOne: false
      referencedRelation: "schools"
      referencedColumns: ["id"]
    }
                  ]
                },"enrollments": {
                  Row: {
                    "class_id": string,"created_at": string,"student_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_id": string,"created_at"?: string,"student_id": string
                  }
                  Update: {
                    "class_id"?: string,"created_at"?: string,"student_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrollments_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrollments_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"first_name": string,"honorific": string | null,"id": string,"last_name": string,"must_change_password": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"first_name"?: string,"honorific"?: string | null,"id": string,"last_name"?: string,"must_change_password"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"first_name"?: string,"honorific"?: string | null,"id"?: string,"last_name"?: string,"must_change_password"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"school_members": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["school_role"],"school_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role": Database["public"]['Enums']["school_role"],"school_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["school_role"],"school_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "school_members_school_id_fkey"
      columns: ["school_id"]
isOneToOne: false
      referencedRelation: "schools"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"schools": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"staff_email_domain": string,"student_email_domain": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"staff_email_domain": string,"student_email_domain": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"staff_email_domain"?: string,"student_email_domain"?: string
                  }
                  Relationships: [
                    
                  ]
                },"submissions": {
                  Row: {
                    "answers": NonNullable<Json>,"assignment_id": string,"auto_results": NonNullable<Json>,"class_id": string,"graded_at": string | null,"graded_by": string | null,"id": string,"max_score": number,"question_comments": NonNullable<Json>,"returned_at": string | null,"score": number,"status": Database["public"]['Enums']["submission_status"],"student_id": string,"submitted_at": string,"teacher_comment": string | null,"teacher_marks": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"assignment_id": string,"auto_results"?: NonNullable<Json>,"class_id": string,"graded_at"?: string | null,"graded_by"?: string | null,"id"?: string,"max_score"?: number,"question_comments"?: NonNullable<Json>,"returned_at"?: string | null,"score"?: number,"status"?: Database["public"]['Enums']["submission_status"],"student_id": string,"submitted_at"?: string,"teacher_comment"?: string | null,"teacher_marks"?: NonNullable<Json>
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"assignment_id"?: string,"auto_results"?: NonNullable<Json>,"class_id"?: string,"graded_at"?: string | null,"graded_by"?: string | null,"id"?: string,"max_score"?: number,"question_comments"?: NonNullable<Json>,"returned_at"?: string | null,"score"?: number,"status"?: Database["public"]['Enums']["submission_status"],"student_id"?: string,"submitted_at"?: string,"teacher_comment"?: string | null,"teacher_marks"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "submissions_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "submissions_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "submissions_graded_by_fkey"
      columns: ["graded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "submissions_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "create_class":
{ Args: { "p_code": string,"p_name"?: string,"p_school_id": string }; Returns: string
                           },
"grade_submission":
{ Args: { "p_marks"?: Json,"p_question_comments"?: Json,"p_return"?: boolean,"p_submission_id": string,"p_teacher_comment"?: string }; Returns: {
              "answers": NonNullable<Json>,
"assignment_id": string,
"auto_results": NonNullable<Json>,
"class_id": string,
"graded_at": string | null,
"graded_by": string | null,
"id": string,
"max_score": number,
"question_comments": NonNullable<Json>,
"returned_at": string | null,
"score": number,
"status": Database["public"]['Enums']["submission_status"],
"student_id": string,
"submitted_at": string,
"teacher_comment": string | null,
"teacher_marks": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "submissions"
        isOneToOne: true
        isSetofReturn: false
      } },
"my_assignments":
{ Args: Record<PropertyKey, never>; Returns: {
              "assignment_id": string,"class_code": string,"due_at": string,"is_open": boolean,"max_score": number,"returned_at": string,"score": number,"status": Database["public"]['Enums']["submission_status"],"submitted_at": string,"title": string
            }[]
                           },
"my_classes":
{ Args: Record<PropertyKey, never>; Returns: {
              "code": string,"id": string,"name": string,"school_id": string,"school_name": string
            }[]
                           },
"my_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_submission_detail":
{ Args: { "p_assignment_id": string }; Returns: Json
                           },
"return_submissions":
{ Args: { "p_assignment_id": string,"p_class_id"?: string }; Returns: Json
                           },
"save_assignment":
{ Args: { "p_classes"?: Json,"p_content": Json,"p_description": string,"p_id"?: string,"p_key": Json,"p_regrade"?: boolean,"p_school_id": string,"p_show_score_on_submit"?: boolean,"p_title": string }; Returns: string
                           },
"submit_assignment":
{ Args: { "p_answers": Json,"p_assignment_id": string }; Returns: Json
                           }
          }
          Enums: {
            "school_role": "admin"|"teacher"|"student","submission_status": "submitted"|"graded"|"returned"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "school_role": ["admin", "teacher", "student"],"submission_status": ["submitted", "graded", "returned"]
          }
        }
} as const
