export type MealType = 'lunch' | 'dinner'
export type PassId = 'platinum' | 'silver' | 'registered'
export interface Allowance { lunch: number; dinner: number; total: number }
export interface Pass { id: PassId; name: string; lunch_limit: number; dinner_limit: number; total_limit: number }
export interface MealSession { archived?: number; id: string; name: string; meal_type: MealType; status: 'open' | 'closed'; per_person_limit: number; served?: number; registration_total?: number; expected?: number; not_included?: number; registered_served?: number; expected_remaining?: number }
export interface Participant { id: string; name: string; phone: string; pass_id: PassId; pass_name: string; parent_id: string | null; qr_token: string; lunch_override: number | null; dinner_override: number | null; total_override: number | null; created_at: string; remaining: Allowance; allowance: Allowance; guest_count?: number; registration_number?: string | null; category?: string | null; hospital?: string | null; food_requirement?: string | null; source_import?: string | null }
export interface ParticipantInput { name: string; phone: string; passId: PassId; parentId: string | null; lunchOverride: number | null; dinnerOverride: number | null; totalOverride: number | null; deviceLabel: string }
export interface RedemptionInput { requestId: string; qrToken: string; sessionId: string; deviceLabel: string }
export interface RedemptionResult { requestId: string; approved: boolean; reason: string; redemptionId: string | null; participant: { id: string; name: string; pass: string; remaining: Allowance } | null; timestamp: string }
export interface Redemption { id: string; participant_id: string; participant_name: string; pass_name: string; session_name: string; meal_type: MealType; device_label: string; created_at: string; voided_at: string | null; void_reason: string | null }
export interface AuditEvent { id: string; action: string; entity_id: string; device_label: string; details: Record<string, unknown>; created_at: string }
export interface PrintSettings { width_mm: number; height_mm: number }
export interface DashboardData { participants: number; guests: number; served: number; lunch: number; dinner: number; platinum: number; silver: number; sessions: MealSession[]; recent: Redemption[] }
