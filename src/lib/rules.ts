// Business rules shared by the app and the node scripts (keep this file free of imports).

/** Is this staff card recovered from salary for the given usage month ('YYYY-MM')?
 *  deduct = true → always; deduct = false → only from deduct_from onward (directors switch from 2026-09). */
export function cardDeducts(card: { deduct?: boolean | null; deduct_from?: string | null }, period: string): boolean {
  if (card.deduct !== false) return true
  return !!card.deduct_from && period >= card.deduct_from
}

/** Is maintenance on this person's own vehicle utilised against their accrual in this month?
 *  Same switch as the card: company cost while none of their staff cards deduct. */
export function maintenanceToAccrual(staffCards: { deduct?: boolean | null; deduct_from?: string | null }[], period: string): boolean {
  if (!staffCards.length) return true
  return staffCards.some((c) => cardDeducts(c, period))
}
