import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { InsuranceClaimFile } from '../lib/types'
import { fmtDate } from '../lib/format'
import { Button } from './ui'

const BUCKET = 'claim-files'
const MAX_MB = 15
const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.msg,.eml,.zip,.mp4,.mov'
const isImage = (f: { mime: string | null; file_name: string }) => (f.mime ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(f.file_name)
const size = (n: number | null) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Shrinks a phone photo to at most 1920 px on the long side (JPEG) so uploads stay small; other files are sent as they are. */
async function prepare(file: File): Promise<{ blob: Blob; name: string; mime: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return { blob: file, name: file.name, mime: file.type || 'application/octet-stream' }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, 1920 / Math.max(img.width, img.height)); const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', 0.85))
    return { blob, name: file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', mime: 'image/jpeg' }
  } catch { return { blob: file, name: file.name, mime: file.type } } finally { URL.revokeObjectURL(url) }
}

/** Documents and photos on one insurance claim: thumbnails for photos, open / download for everything, upload for people who may add to the claim. */
export default function ClaimFiles({ claimId, canAdd, canDeleteAll, userId }: { claimId: number; canAdd: boolean; canDeleteAll: boolean; userId: string | undefined }) {
  const [files, setFiles] = useState<InsuranceClaimFile[] | null>(null); const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const input = useRef<HTMLInputElement>(null)
  async function load() {
    const { data, error } = await supabase.from('fleet_insurance_claim_files').select('*').eq('claim_id', claimId).order('created_at')
    if (error) { setErr(error.message); setFiles([]); return }
    const list = (data ?? []) as InsuranceClaimFile[]; setFiles(list)
    if (list.length) { const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(list.map((f) => f.path), 3600); const m: Record<string, string> = {}; for (const s of signed ?? []) if (s.path && s.signedUrl) m[s.path] = s.signedUrl; setUrls(m) }
  }
  useEffect(() => { setFiles(null); setUrls({}); void load() }, [claimId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(list: FileList | null) {
    const picked = Array.from(list ?? []); if (!picked.length) return
    setErr(null); const problems: string[] = []
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i]; setBusy(`Uploading ${i + 1} of ${picked.length}: ${f.name}`)
      try {
        const p = await prepare(f)
        if (p.blob.size > MAX_MB * 1048576) { problems.push(`${f.name} is larger than ${MAX_MB} MB`); continue }
        const safe = p.name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-80) || 'file'
        const path = `${claimId}/${Date.now()}_${i}_${safe}`
        const up = await supabase.storage.from(BUCKET).upload(path, p.blob, { contentType: p.mime, upsert: false }); if (up.error) throw up.error
        const ins = await supabase.from('fleet_insurance_claim_files').insert({ claim_id: claimId, path, file_name: p.name, mime: p.mime, size_bytes: p.blob.size, kind: p.mime.startsWith('image/') ? 'photo' : 'document' })
        if (ins.error) { await supabase.storage.from(BUCKET).remove([path]); throw ins.error }
      } catch (e) { problems.push(`${f.name}: ${(e as Error).message}`) }
    }
    setBusy(null); if (problems.length) setErr(problems.join(' · ')); await load()
  }
  async function remove(f: InsuranceClaimFile) {
    if (!confirm(`Remove "${f.file_name}" from this claim?`)) return
    setErr(null); const d = await supabase.from('fleet_insurance_claim_files').delete().eq('id', f.id); if (d.error) { setErr(d.error.message); return }
    await supabase.storage.from(BUCKET).remove([f.path]); await load()
  }
  const photos = (files ?? []).filter(isImage), docs = (files ?? []).filter((f) => !isImage(f))
  const canDelete = (f: InsuranceClaimFile) => canDeleteAll || (!!userId && f.uploaded_by === userId)
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="font-display font-semibold text-brand-navy">Documents and photos{files && files.length > 0 ? ` (${files.length})` : ''}</h4>
        {canAdd && <span className="ml-auto"><Button size="sm" variant="secondary" disabled={!!busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Upload files'}</Button>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = '' }} /></span>}
      </div>
      {busy && <p className="mb-2 text-xs text-slate-500">{busy}</p>}
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      {files == null ? <p className="text-xs text-slate-500">Loading…</p> : files.length === 0 ? <p className="text-slate-500">Nothing uploaded yet{canAdd ? ` — claim form, police report, quotes, licence, photos of the damage (up to ${MAX_MB} MB each).` : '.'}</p> : (
        <div className="space-y-3">
          {photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {photos.map((f) => (
                <figure key={f.id} className="overflow-hidden rounded-md border border-slate-200">
                  <a href={urls[f.path]} target="_blank" rel="noreferrer">{urls[f.path] ? <img src={urls[f.path]} alt={f.file_name} loading="lazy" className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center text-xs text-slate-400">photo</div>}</a>
                  <figcaption className="flex items-start gap-1 px-2 py-1 text-[11px] text-slate-500"><span className="min-w-0 flex-1 truncate" title={`${f.file_name} · ${f.uploaded_by_name}`}>{fmtDate(f.created_at.slice(0, 10))} · {f.uploaded_by_name || 'unknown'}</span>{canDelete(f) && <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => void remove(f)} aria-label={`Remove ${f.file_name}`}>✕</button>}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {docs.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {docs.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <a href={urls[f.path]} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-brand-purple hover:underline">{f.file_name}</a>
                  <span className="text-xs text-slate-500">{size(f.size_bytes)} · {fmtDate(f.created_at.slice(0, 10))} · {f.uploaded_by_name || 'unknown'}</span>
                  {canDelete(f) && <button type="button" className="text-xs text-slate-400 hover:text-red-600" onClick={() => void remove(f)}>remove</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
