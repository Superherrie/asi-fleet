import { useState } from 'react'
/** Open/collapsed state for a dashboard card, remembered per browser under `key`. */
export function useCollapsed(key: string) {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(key) !== 'closed' } catch { return true } })
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? 'closed' : 'open') } catch { /* storage unavailable */ } return !o })
  return [open, toggle] as const
}
