import { useRef, useState, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type ButtonHTMLAttributes } from 'react'
import { MONTH_NAMES, money } from '../lib/format'

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-brand-navy">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function Card({ title, children, className = '', actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-lg border border-brand-hairline bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-brand-hairline px-4 py-2">
          <h2 className="font-display text-sm font-semibold text-brand-navy">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md' }
export function Button({ variant = 'primary', size = 'md', className = '', ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand-purple text-white hover:bg-brand-lilac',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-500',
    ghost: 'text-brand-purple hover:bg-brand-card',
  }[variant]
  const s = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'
  return <button {...p} className={`rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50 ${v} ${s} ${className}`} />
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-lilac focus:outline-none ${p.className ?? ''}`} />
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-brand-lilac focus:outline-none ${p.className ?? ''}`} />
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'purple' | 'teal' | 'pink' }) {
  const t = {
    slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800', purple: 'bg-brand-purple/10 text-brand-purple', teal: 'bg-brand-teal/20 text-teal-800', pink: 'bg-brand-pink/10 text-brand-pink',
  }[tone]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>
}
// eslint-disable-next-line react-refresh/only-export-components
export const statusTone = (s: string) =>
  (({ draft: 'slate', submitted: 'amber', approved: 'green', rejected: 'red', processed: 'teal', pending: 'amber', exported: 'teal', paid: 'green', deducted: 'green', sent: 'green', failed: 'red', posted: 'green' } as Record<string, 'slate' | 'green' | 'amber' | 'red' | 'purple' | 'teal'>)[s] ?? 'slate')

export function Alert({ tone = 'amber', children }: { tone?: 'amber' | 'red' | 'green' | 'blue'; children: ReactNode }) {
  const t = { amber: 'bg-amber-50 text-amber-900 border-amber-200', red: 'bg-red-50 text-red-900 border-red-200', green: 'bg-emerald-50 text-emerald-900 border-emerald-200', blue: 'bg-sky-50 text-sky-900 border-sky-200' }[tone]
  return <div className={`rounded-md border px-3 py-2 text-sm ${t}`}>{children}</div>
}

export function PeriodPicker({ value, onChange, from = 2024 }: { value: string; onChange: (p: string) => void; from?: number }) {
  const [y, m] = value.split('-').map(Number)
  const years: number[] = []
  for (let yy = new Date().getFullYear() + 1; yy >= from; yy--) years.push(yy)
  return (
    <div className="flex gap-1">
      <Select value={m} onChange={(e) => onChange(`${y}-${String(e.target.value).padStart(2, '0')}`)}>
        {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </Select>
      <Select value={y} onChange={(e) => onChange(`${e.target.value}-${String(m).padStart(2, '0')}`)}>
        {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
      </Select>
    </div>
  )
}

export function FileDrop({ onFile, accept = '.xls,.xlsx,.xlsm,.csv', label = 'Drop a file here or click to choose' }: { onFile: (f: File) => void; accept?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm ${over ? 'border-brand-lilac bg-brand-card' : 'border-slate-300 text-slate-500 hover:border-brand-lilac'}`}
    >
      {label}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
    </div>
  )
}

export function Table({ head, children, className = '' }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand-navy text-left text-xs uppercase tracking-wide text-white">
            {head.map((h, i) => <th key={i} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-hairline">{children}</tbody>
      </table>
    </div>
  )
}
export const Td = ({ children, num = false, className = '', colSpan, title }: { children?: ReactNode; num?: boolean; className?: string; colSpan?: number; title?: string }) => (
  <td colSpan={colSpan} title={title} className={`px-2 py-1 align-top ${num ? 'num-cell whitespace-nowrap' : ''} ${className}`}>{children}</td>
)
export const Money = ({ v, className = '' }: { v: number | null | undefined; className?: string }) => (
  <span className={`num-cell tabular-nums ${v != null && v < 0 ? 'text-red-600' : ''} ${className}`}>{money(v)}</span>
)

export function Stat({ label, value, sub, tone = 'navy' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'navy' | 'pink' | 'purple' | 'teal' }) {
  const t = { navy: 'border-l-brand-navy', pink: 'border-l-brand-pink', purple: 'border-l-brand-purple', teal: 'border-l-brand-teal' }[tone]
  return (
    <div className={`rounded-lg border border-brand-hairline border-l-4 bg-white px-4 py-3 shadow-sm ${t}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-display text-xl font-bold text-brand-navy tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="py-8 text-center text-sm text-slate-400">{label}</div>
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">{children}</div>
}
