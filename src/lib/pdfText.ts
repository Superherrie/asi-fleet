// Browser-side PDF text extraction with pdfjs. Returns lines both in content order (like `pdftotext -raw`)
// and grouped by vertical position (like `pdftotext -layout`), so the invoice parsers can pick what they need.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface Item { str: string; x: number; y: number; w: number }

export async function pdfTextLines(file: File): Promise<{ raw: string[]; layout: string[]; text: string }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const raw: string[] = []; const layout: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const content = await page.getTextContent()
    const items: Item[] = []
    for (const it of content.items) {
      if (!('str' in it)) continue
      const t = it as { str: string; transform: number[]; width: number; hasEOL?: boolean }
      items.push({ str: t.str, x: t.transform[4], y: t.transform[5], w: t.width })
    }
    // content order: pdfjs emits items in stream order; break lines on hasEOL / y change
    let line = ''; let lastY: number | null = null
    for (const it of items) {
      if (lastY != null && Math.abs(it.y - lastY) > 2) { raw.push(line.trim()); line = '' }
      line += (line && !line.endsWith(' ') ? ' ' : '') + it.str; lastY = it.y
    }
    if (line.trim()) raw.push(line.trim())
    // layout order: group by y (tolerance 3pt), sort by x, pad gaps so column regexes see 2+ spaces
    const bands = new Map<number, Item[]>()
    for (const it of items) { const key = [...bands.keys()].find((k) => Math.abs(k - it.y) <= 3) ?? it.y; (bands.get(key) ?? bands.set(key, []).get(key)!).push(it) }
    for (const key of [...bands.keys()].sort((a, b) => b - a)) {
      const row = bands.get(key)!.sort((a, b) => a.x - b.x)
      let s = ''; let cursor = 0
      for (const it of row) { const gap = it.x - cursor; s += (gap > 12 ? '   ' : s ? ' ' : '') + it.str; cursor = it.x + it.w }
      layout.push(s)
    }
    raw.push(''); layout.push('')
  }
  return { raw, layout, text: layout.join('\n') }
}
