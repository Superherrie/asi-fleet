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
  /** read-only access to the all-vehicle fleet dashboard (regional managers) */
  view_all?: boolean
  claims_admin?: boolean
}
export interface Vehicle {
  id: number; registration: string; year: number | null; make: string | null; model: string | null
  branch_id: number | null; category: Category; ownership: Ownership; avis_mva: string | null
  license_expiry: string | null; lease_end: string | null; tracking_provider: string | null
  insured_value: number | null; active: boolean; notes: string | null
  /** how and when the vehicle left the fleet (sets active = false) */
  disposal_type: 'sold' | 'returned' | 'written_off' | null; disposal_date: string | null; disposal_note: string | null
  /** who the vehicle is allocated to (history in fleet_vehicle_drivers); null = pool / not allocated */
  driver_name: string | null; driver_since: string | null
  /** registered owner on eNaTIS (from the Motor Vehicles per Person query) */
  enatis_status: 'registered' | 'not_registered' | null; enatis_checked: string | null; enatis_note: string | null
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
/** Effective-dated branch / category of a vehicle or person (usage month 'YYYY-MM' onward). */
export interface Allocation { id: number; vehicle_id: number | null; employee_id: number | null; branch_id: number | null; category: Category; effective_from: string; note: string | null; created_at: string }
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
  /** one log per vehicle per month: the usual car, a second car, or a rental / replacement (fuel rate only) */
  vehicle_kind: 'own' | 'second' | 'rental'; vehicle_note: string | null
}
export interface TravelLogLine {
  id?: number; log_id: number; line_no: number; trip_date: string | null; opening_km: number | null; closing_km: number | null
  private_km: number; business_km: number; destination: string | null; reason: string | null
}
export interface Claim {
  id: number; period: string; employee_id: number; log_id: number | null; category: Category; business_km: number
  fuel_rate: number; maint_rate: number; fuel_amount: number; maint_amount: number; total_amount: number
  status: 'pending' | 'exported' | 'paid' | 'finalised'; batch_id: number | null; created_at: string
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

export interface VehicleQueryComment { id: number; query_id: number; author: string; author_name: string; by_admin: boolean; body: string; created_at: string }
export interface Copier {
  id: number; model: string; serial_no: string; supplier: string; location: string | null; branch_id: number | null
  contract_end: string | null; month_to_month: boolean; rental_excl: number; avg_black: number | null; avg_colour: number | null
  photo_path: string | null; photo_at: string | null; photo_by: string | null; active: boolean; disposal_note: string | null; notes: string | null
  contract_no: string | null; service_contract_no: string | null
  created_at: string; updated_at: string
}
export interface CopierInvoiceRow {
  id: number; copier_id: number | null; serial_no: string; supplier_entity: string; account_no: string | null; customer_name: string | null
  invoice_no: string; invoice_date: string | null; period: string | null; kind: 'rental' | 'service'; contract_no: string | null; model: string | null; site: string | null
  rental_excl: number; rental_for: string | null; admin_fee: number
  mono_open: number | null; mono_close: number | null; mono_qty: number | null; mono_rate: number | null; mono_charge: number | null; mono_read: string | null
  colour_open: number | null; colour_close: number | null; colour_qty: number | null; colour_rate: number | null; colour_charge: number | null
  scan_qty: number | null; scan_rate: number | null; scan_charge: number | null
  subtotal: number; vat: number; total: number; source_file: string | null
}
export interface InsuranceClaimEvent { id: number; claim_id: number; event_date: string; body: string; author_name: string; created_at: string }
export interface InsuranceClaim {
  id: number; vehicle_id: number | null; asset_desc: string | null; branch_id: number | null; incident_date: string
  incident_type: 'accident' | 'hijacking' | 'theft' | 'break_in' | 'windscreen' | 'third_party' | 'stock_in_transit' | 'other'
  location: string | null; driver_name: string | null; description: string | null; police_station: string | null; police_case_no: string | null
  reported_internal: string | null; reported_insurer: string | null; insurer: string | null; policy_no: string | null; claim_no: string | null; handler: string | null; owner_name: string | null
  status: 'reported' | 'documents_outstanding' | 'registered' | 'assessment' | 'approved' | 'in_repair' | 'settled' | 'rejected' | 'withdrawn'
  outstanding: string | null; quote_amount: number | null; excess_amount: number | null; settlement_amount: number | null; closed_date: string | null; created_at: string; updated_at: string
  fleet_insurance_claim_events?: InsuranceClaimEvent[]
}
export interface VehicleQuery {
  id: number; vehicle_id: number | null; copier_id: number | null; branch_id: number | null; period_from: string | null; period_to: string | null; subject: string
  status: 'open' | 'answered' | 'closed'; raised_by: string; raised_by_name: string; created_at: string; updated_at: string; closed_at: string | null
  fleet_vehicle_query_comments?: VehicleQueryComment[]
}
