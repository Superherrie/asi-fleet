"""One-off: pull the device photos from the Jotform export into the it-photos bucket.
   py -3 scripts/import-jotform-photos.py <export.csv> [--apply] [--limit N]
Matches each device block in the CSV to a fleet_it_assets row (source = jotform) by serial, else by name + description,
fetches the first photo, shrinks it to 1280 px JPEG and stores it as <asset id>/jotform.jpg; writes a report to Fleet/Output."""
import csv, io, json, os, re, sys, time, urllib.request, urllib.parse, concurrent.futures as cf
from PIL import Image, ImageOps
try:
    import pillow_heif; pillow_heif.register_heif_opener()
except ImportError: pass

APPLY = '--apply' in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
CSV = next(a for a in sys.argv[1:] if a.lower().endswith('.csv'))
ENV = dict(l.split('=', 1) for l in open(os.path.join(os.path.dirname(__file__), '.env'), encoding='utf-8').read().splitlines() if '=' in l and not l.startswith('#'))
URL, KEY = ENV['SUPABASE_URL'].strip(), ENV['SUPABASE_SERVICE_ROLE_KEY'].strip()
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}
OUT = r'C:\Users\User1\OneDrive - Herman\OneDrive - Conekt Business Group\Desktop\Claude\Fleet\Output\Jotform photo import report (28 Oct 2026).csv'

def rest(method, path, body=None, headers=None):
    req = urllib.request.Request(URL + path, data=body, method=method, headers={**H, **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()

nk = lambda s: re.sub(r'[^a-z0-9]', '', str(s or '').lower())
JUNK = re.compile(r'^(n/?a|none|nil|unknown|no serial|-|\.|\?|x+)$', re.I)

# ---- assets from the app
st, body = rest('GET', '/rest/v1/fleet_it_assets?source=eq.jotform&select=id,serial_no,description,category,source_ref,photo_path&limit=5000')
assets = json.loads(body)
by_serial = {}
for a in assets:
    k = (a['serial_no'] or '').strip().lower()
    if k and not JUNK.match(k): by_serial.setdefault(k, a)
by_name_desc = {}
for a in assets:
    m = re.match(r'Jotform: (.*?), (.*?), (.*?), submitted', a['source_ref'] or '')
    if m: by_name_desc.setdefault(nk(m.group(1)) + '|' + nk(a['description']), a)

# ---- devices from the export (latest submission per serial wins, as in the data import)
rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))
devices = []
for r in rows[1:]:
    name, sub = r[2].strip(), r[0].strip()
    for k in range(7):
        b = 19 + 8 * k
        if b + 7 >= len(r): break
        typ, desc, serial, photos = r[b].strip(), r[b + 2].strip(), r[b + 3].strip(), [x.strip() for x in r[b + 7].split('\n') if x.strip().startswith('http')]
        if not (typ or desc or serial) or not photos: continue
        devices.append({'name': name, 'sub': sub, 'desc': desc, 'serial': serial, 'url': photos[0], 'n': len(photos)})
devices.sort(key=lambda d: d['sub'])
jobs = {}
for d in devices:
    k = d['serial'].lower()
    a = by_serial.get(k) if k and not JUNK.match(k) else None
    if not a: a = by_name_desc.get(nk(d['name']) + '|' + nk(d['desc']))
    if not a: d['status'] = 'no matching device on the register'; jobs.setdefault(('x', len(jobs)), d); continue
    if a['photo_path']: d['status'] = 'device already has a photo'; jobs.setdefault(('x', len(jobs)), d); continue
    d['asset'] = a['id']; jobs[('a', a['id'])] = d       # later submission replaces earlier for the same asset
todo = [d for k, d in jobs.items() if k[0] == 'a']
skipped = [d for k, d in jobs.items() if k[0] == 'x']
print(f'devices with photos {len(devices)}; matched to {len(todo)} assets; skipped {len(skipped)} ({sum(1 for d in skipped if "already" in d["status"])} already have a photo, {sum(1 for d in skipped if "no matching" in d["status"])} unmatched)')
if LIMIT: todo = todo[:LIMIT]
if not APPLY: print('dry run - add --apply'); sys.exit(0)

def fetch_shrink(d):
    for attempt in range(3):
        try:
            req = urllib.request.Request(d['url'], headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=120) as r: raw = r.read()
            low = d['url'].lower().split('?')[0]
            if low.endswith('.pdf'):
                import fitz; pg = fitz.open(stream=raw, filetype='pdf')[0]; raw = pg.get_pixmap(dpi=110).tobytes('jpeg')
            elif low.endswith('.zip'):
                import zipfile; z = zipfile.ZipFile(io.BytesIO(raw)); names = [n for n in z.namelist() if n.lower().endswith(('.jpg', '.jpeg', '.png', '.heic'))]
                if not names: raise ValueError('zip holds no image'); raw = z.read(names[0])
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGB')
            img.thumbnail((1280, 1280)); buf = io.BytesIO(); img.save(buf, 'JPEG', quality=82, optimize=True)
            return buf.getvalue(), len(raw)
        except Exception as e:
            err = e; time.sleep(8 if '429' in str(e) else 2)
    raise err

def process(d):
    try:
        jpg, raw = fetch_shrink(d)
        path = f"{d['asset']}/jotform.jpg"
        rest('POST', f'/storage/v1/object/it-photos/{path}', jpg, {'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
        rest('PATCH', f"/rest/v1/fleet_it_assets?id=eq.{d['asset']}", json.dumps({'photo_path': path, 'photo_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'photo_by': 'Jotform import'}).encode(), {'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
        return f'ok ({raw // 1024} KB -> {len(jpg) // 1024} KB)'
    except Exception as e:
        return f'FAILED: {e}'

done = 0
with cf.ThreadPoolExecutor(max_workers=int(os.environ.get('WORKERS', '6'))) as ex:
    for d, res in zip(todo, ex.map(process, todo)):
        d['status'] = res; done += 1
        if done % 50 == 0: print(f'  {done}/{len(todo)}')
ok = sum(1 for d in todo if d['status'].startswith('ok')); print(f'uploaded {ok} of {len(todo)}; failed {len(todo) - ok}')
with open(OUT, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['Asset id', 'Submitter', 'Submitted', 'Device', 'Serial', 'Photos on Jotform', 'First photo', 'Result'])
    for d in todo + skipped: w.writerow([d.get('asset', ''), d['name'], d['sub'], d['desc'], d['serial'], d['n'], d['url'], d['status']])
print('report', OUT)
