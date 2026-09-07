// Renders each page of a PDF (including CCITT/fax scans) to PNG so it can be read or OCR'd.
//   node scripts/pdf-to-png.mjs "<file.pdf>" "<out dir>" [scale]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const [file, out, scaleArg] = process.argv.slice(2); const scale = Number(scaleArg) || 2;
mkdirSync(out, { recursive: true });
import { pathToFileURL } from 'node:url';
const wasmUrl = pathToFileURL(join(process.cwd(), 'node_modules', 'pdfjs-dist', 'wasm') + '/').href;
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), disableFontFace: true, wasmUrl, useWasm: false }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p); const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const name = join(out, `${basename(file).replace(/\.pdf$/i, '')}_p${p}.png`); writeFileSync(name, canvas.toBuffer('image/png')); console.log(name, canvas.width + 'x' + canvas.height);
}
