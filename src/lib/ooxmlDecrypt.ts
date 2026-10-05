// Opens password-protected Office workbooks (ECMA-376 "agile" encryption: the format Excel uses for "Encrypt with Password").
// Runs in the browser with WebCrypto; the password is used in memory only and is never stored or sent anywhere.
import * as XLSX from 'xlsx'

export class PasswordError extends Error {
  wrong: boolean
  constructor(wrong: boolean) { super(wrong ? 'The password is not correct for this workbook' : 'This workbook is password-protected'); this.name = 'PasswordError'; this.wrong = wrong }
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length } return o }
const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b }
const fit = (b: Uint8Array, n: number) => { if (b.length >= n) return b.slice(0, n); const o = new Uint8Array(n).fill(0x36); o.set(b); return o }
const HASH: Record<string, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' }
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** True when the file is an encrypted Office container (OLE compound file holding EncryptionInfo + EncryptedPackage). */
export function isEncryptedWorkbook(data: Uint8Array) {
  if (data.length < 8 || data[0] !== 0xd0 || data[1] !== 0xcf || data[2] !== 0x11 || data[3] !== 0xe0) return false
  try { const cfb = XLSX.CFB.read(data, { type: 'array' }); return !!XLSX.CFB.find(cfb, 'EncryptionInfo') && !!XLSX.CFB.find(cfb, 'EncryptedPackage') } catch { return false }
}

/** AES-CBC without padding (WebCrypto always pads, so a valid padding block is appended first). */
async function aesCbcRaw(key: CryptoKey, iv: Uint8Array, data: Uint8Array) {
  const last = data.slice(data.length - 16)
  const pad = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: buf(last) }, key, new ArrayBuffer(0)))
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: buf(iv) }, key, buf(cat(data, pad))))
}
const aesKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', buf(raw), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'])

/** Returns the decrypted workbook bytes. Throws PasswordError when the password is missing or wrong. */
export async function decryptWorkbook(data: Uint8Array, password: string | null | undefined): Promise<Uint8Array> {
  const cfb = XLSX.CFB.read(data, { type: 'array' })
  const info = XLSX.CFB.find(cfb, 'EncryptionInfo'), pkg = XLSX.CFB.find(cfb, 'EncryptedPackage')
  if (!info || !pkg) throw new Error('Not an encrypted workbook')
  if (!password) throw new PasswordError(false)
  const ib = Uint8Array.from(info.content as ArrayLike<number>)
  const major = ib[0] | (ib[1] << 8), minor = ib[2] | (ib[3] << 8)
  if (major !== 4 || minor !== 4) throw new Error('This workbook uses an older password format that the app cannot open — re-save it in Excel without a password')
  // the header is a small XML document; read the two elements we need without a DOM so this also runs outside the browser
  const xml = new TextDecoder().decode(ib.slice(8))
  const el = (name: string) => { const m = xml.match(new RegExp('<(?:\\w+:)?' + name + '\\b([^>]*)>')); if (!m) throw new Error('Unexpected encryption header'); const at: Record<string, string> = {}; for (const a of m[1].matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) at[a[1]] = a[2]; return { getAttribute: (k: string) => at[k] ?? null } }
  type El = ReturnType<typeof el>
  const kd = el('keyData'), ek = el('encryptedKey')
  const num = (e: El, a: string) => Number(e.getAttribute(a)); const b = (e: El, a: string) => b64(e.getAttribute(a) ?? '')
  const hashName = HASH[(ek.getAttribute('hashAlgorithm') ?? '').toUpperCase()]
  if (!hashName || ek.getAttribute('cipherAlgorithm') !== 'AES' || ek.getAttribute('cipherChaining') !== 'ChainingModeCBC' || kd.getAttribute('cipherAlgorithm') !== 'AES' || kd.getAttribute('cipherChaining') !== 'ChainingModeCBC') throw new Error('This workbook uses an encryption method the app cannot open')
  const digest = async (x: Uint8Array) => new Uint8Array(await crypto.subtle.digest(hashName, buf(x)))

  // password → key: hash(salt + password in UTF-16LE), then spinCount rounds of hash(counter + previous)
  const pw = new Uint8Array(password.length * 2); for (let i = 0; i < password.length; i++) { const c = password.charCodeAt(i); pw[i * 2] = c & 0xff; pw[i * 2 + 1] = c >> 8 }
  const salt = b(ek, 'saltValue'); let h = await digest(cat(salt, pw))
  const spin = num(ek, 'spinCount'); const round = new Uint8Array(4 + h.length); const rv = new DataView(round.buffer)
  for (let i = 0; i < spin; i++) { rv.setUint32(0, i, true); round.set(h, 4); h = await digest(round) }
  const keyBytes = num(ek, 'keyBits') / 8, block = num(ek, 'blockSize')
  const derived = async (blockKey: number[]) => aesKey(fit(await digest(cat(h, Uint8Array.from(blockKey))), keyBytes))
  const iv0 = fit(salt, block)
  const verIn = await aesCbcRaw(await derived([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]), iv0, b(ek, 'encryptedVerifierHashInput'))
  const verHash = await aesCbcRaw(await derived([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]), iv0, b(ek, 'encryptedVerifierHashValue'))
  const expect = await digest(verIn.slice(0, num(ek, 'saltSize')))
  for (let i = 0; i < expect.length; i++) if (expect[i] !== verHash[i]) throw new PasswordError(true)
  const secret = (await aesCbcRaw(await derived([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]), iv0, b(ek, 'encryptedKeyValue'))).slice(0, keyBytes)

  // package: 8-byte length, then 4096-byte segments each with its own IV = hash(keyData salt + segment number)
  const pk = Uint8Array.from(pkg.content as ArrayLike<number>); const dv = new DataView(pk.buffer)
  const size = dv.getUint32(0, true) + dv.getUint32(4, true) * 2 ** 32
  const key = await aesKey(secret), kdSalt = b(kd, 'saltValue'), kdBlock = num(kd, 'blockSize'); const kdHashName = HASH[(kd.getAttribute('hashAlgorithm') ?? '').toUpperCase()]
  if (!kdHashName) throw new Error('This workbook uses an encryption method the app cannot open')
  const out = new Uint8Array(pk.length - 8)
  for (let off = 8, seg = 0; off < pk.length; off += 4096, seg++) {
    let chunk = pk.slice(off, Math.min(off + 4096, pk.length)); if (chunk.length % 16) chunk = cat(chunk, new Uint8Array(16 - (chunk.length % 16)))
    const iv = fit(new Uint8Array(await crypto.subtle.digest(kdHashName, buf(cat(kdSalt, le32(seg))))), kdBlock)
    out.set((await aesCbcRaw(key, iv, chunk)).slice(0, Math.min(4096, out.length - (off - 8))), off - 8)
  }
  return out.slice(0, size)
}
