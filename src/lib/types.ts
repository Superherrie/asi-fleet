export type Category = 'Admin' | 'Ops Cabling' | 'Ops Admin' | 'Sales' | 'Exec'
export const CATEGORIES: Category[] = ['Admin', 'Ops Cabling', 'Ops Admin', 'Sales', 'Exec']
export type Ownership = 'owned' | 'avis' | 'other'
export type Source = 'first_auto' | 'avis' | 'insurance' | 'tracking' | 'travel_log' | 'accrual_opening' | 'fa_maintenance'
export interface MaintLine {
  id: number; import_id: number; period: string; invoice_no: string; line_id: string; order_id: string | null; cost_centre: string | null
  billing_type: string; excl: number; vat: number; total: number; order_date: string | null; completion_date: string | null; invoice_date: string | null
  supplier: string | null; reg: string | null; driver: string | null; vehicle_desc: string | null; item_desc: string | null; cost_category: string | null; description: string | null
  vehicle_id: number | null; employee_id: number | null; card_id: number | null; branch_id: number | null; category: Category | null; accrual_txn_id: number | null
}
export type LogStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed'

export interface Branch { id: number; code: string; name: string; aliases: string[]; active: boolean }
export interface Employee {
  id: number; emp_no: string | null; full_name: string; email: string | null; branch_id: number | null
  category: Category; manager_employee_id: number | null; manager_email: string | null; active: boolean; notes: string | null
  fuel_rate: number | null; maint_rate: number | null; vehicle_reg: string | null
}
export interface Profile {
  user_id: string; email: string; full_name: string; is_admin: boolean
  role: 'admin' | 'finance' | 'payroll' | 'manager' | 'driver'; employee_id: number | null; must_change_password: boolean
}
export interface Vehicle {
  id: number; registration: string; year: number | null; make: string | null; model: string | null
  branch_id: number | null; category: Category; ownership: Ownership; avis_mva: string | null
  license_expiry: string | null; lease_end: string | null; tracking_provider: string | null
  insured_value: number | null; active: boolean; notes: string | null
}
export interface Card {
  id: number; fa_driver_name: string; fa_reg: string; holder_type: 'vehicle' | 'staff' | 'unallocated'
  vehicle_id: number | null; employee_id: number | null; branch_id: number | null; category: Category | null
  active: boolean; notes: string | null
  /** staff card recovered from salary (false = directors' cards stay company cost) */
  deduct: boolean
  /** usage month ('YYYY-MM') from which a deduct=false card becomes deducted */
  deduct_from: string | null
}
export interface GlMap { id: number; source: string; cost_type: string; category: Category | null; gl_account: string; gl_name: string }
export interface Setting { key: string; value: string; description: string }
export interface ClaimRate { id: number; category: Category; effective_from: string; fuel_rate: number; maint_rate: number }
export interface Import {
  id: number; source: Source; period: string; provider: string | null; file_name: string | null
  row_count: number; total_amount: number; imported_at: string; notes: string | null; control_amount: number | null; control_note: string | null; control_date: string | null
}
export interface FaLine {
  id: number; import_id: number; period: string; card_id: number | null; fa_name_code: string | null; fa_code: string | null
  fa_driver_name: string | null; fa_reg: string | null; make: string | null; model: string | null
  fuel: number; oil_excl: number; oil_vat: number; repairs_excl: number; repairs_vat: number; tyres_excl: number; tyres_vat: number
  accident_excl: number; accident_vat: number; maint_excl: number; maint_vat: number; overhaul_excl: number; overhaul_vat: number
  other_excl: number; other_vat: number; toll_excl: number; toll_vat: number; expenses_excl: number; expenses_vat: number
  fees_excl: number; fees_vat: number; grand_total: number; odo_close: number | null; odo_prev: number | null
  kms: number | null; litres: number | null; consumption: number | null
}
export interface AvisLine {
  id: number; import_id: number; period: string; vehicle_id: number | null; branch_id: number | null; driver_name: string | null
  reg: string | null; mva_number: string | null; kilometers: number | null; rental_excl: number; vat: number; amount_due: number
  vat_claimable: number; total: number; cost_centre_name: string | null; vehicle_type: string | null; product: string | null
  transaction_type: string | null; make_model: string | null; transaction_date: string | null; document_no: string | null; transaction_number: string | null
}
export interface InsuranceLine {
  id: number; import_id: number; period: string; vehicle_id: number | null; branch_id: number | null; reg: string | null
  year: number | null; make: string | null; model: string | null; branch_name: string | null; tracking_unit: string | null
  retail_value: number | null; premium: number; vat: number; rate: number | null
}
export interface TrackingLine {
  id: number; import_id: number; period: string; provider: string; vehicle_id: number | null; branch_id: number | null
  invoice: string | null; invoice_date: string | null; item_code: string | null; reg: string | null; description: string | null
  quantity: number | null; amount_excl: number; vat: number; total: number; branch_name: string | null; contract_id: string | null
}
export interface TravelLog {
  id: number; period: string; employee_id: number; vehicle_reg: string | null; branch_id: number | null; department: string | null
  opening_odo: number | null; opening_date: string | null; closing_odo: number | null; closing_date: string | null
  business_km: number; private_km: number; status: LogStatus; submitted_at: string | null; approved_by: string | null
  approved_at: string | null; manager_email: string | null; manager_comment: string | null; source: 'app' | 'import'
  source_file: string | null; created_at: string; updated_at: string
}
export interface TravelLogLine {
  id?: number; log_id: number; line_no: number; trip_date: string | null; opening_km: number | null; closing_km: number | null
  private_km: number; business_km: number; destination: string | null; reason: string | null
}
export interface Claim {
  id: number; period: string; employee_id: number; log_id: number | null; category: Category; business_km: number
  fuel_rate: number; maint_rate: number; fuel_amount: number; maint_amount: number; total_amount: number
  status: 'pending' | 'exported' | 'paid'; batch_id: number | null; created_at: string
}
export interface AccrualTxn {
  id: number; employee_id: number; txn_date: string; period: string | null; kind: 'opening' | 'accrual' | 'payout' | 'adjustment'
  amount: number; description: string | null; reference: string | null; claim_id: number | null; created_at: string
}
export interface Deduction {
  id: number; period: string; employee_id: number; card_id: number | null; fa_line_id: number | null; amount: number
  status: 'pending' | 'exported' | 'deducted'; batch_id: number | null
}
export interface Journal {
  id: number; source: string; period: string; provider: string | null; import_id: number | null
  status: 'draft' | 'exported' | 'posted'; total_debit: number; created_at: string
}
export interface JournalLine {
  id?: number; journal_id?: number; line_no: number; gl_account: string; gl_name: string; branch_code: string
  category: string | null; description: string; reference: string | null; debit: number; credit: number
  vehicle_id: number | null; employee_id: number | null; card_id: number | null
}
export interface Notification {
  id: number; kind: string; to_email: string; cc_email: string | null; subject: string; body: string
  log_id: number | null; status: 'pending' | 'sent' | 'failed'; error: string | null; created_at: string; sent_at: string | null
}
