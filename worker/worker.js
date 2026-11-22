/**
 * Musik-Scoreboard – Online-Einträge
 * Cloudflare Worker mit D1-Datenbank (Binding-Name: DB)
 *
 *   GET    /data                 -> { entries: [...], names: [...] }   (öffentlich, ohne Token)
 *   GET    /excel[?fresh=1]      -> { updated_at, entries, weeks }  direkt aus der OneDrive-Excel
 *                                   (Variable EXCEL_URL = Freigabelink; ohne Variable: 404)
 *   POST   /entries              { name, minuten, einheiten } -> { id, token, week, kw }
 *   DELETE /entries/:id          Header "X-Token: <token>"     -> { ok: true }
 *   POST   /names                { name } -> { name }
 */

// Nur diese Seiten dürfen die API aus dem Browser benutzen
const ALLOWED_ORIGINS = [
  'https://loaxleo.github.io',
  'http://localhost:8766',
];

const LIMITS = {
  maxMinuten: 600,      // pro Eintrag
  maxEinheiten: 20,     // pro Eintrag
  maxPerHourPerIp: 30,  // gegen Spam
  nameMin: 2,
  nameMax: 30,
};

const TZ = 'Europe/Zurich';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Token',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    const fail = (message, status = 400) => json({ error: message }, status);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      // ---------- Alles lesen ----------
      if (request.method === 'GET' && (path === '/data' || path === '/')) {
        const entries = await env.DB.prepare(
          'SELECT id, name, week, kw, minuten, einheiten, created_at FROM entries ORDER BY id'
        ).all();
        const names = await env.DB.prepare('SELECT name FROM names ORDER BY name').all();
        return json({ entries: entries.results, names: names.results.map(r => r.name) });
      }

      // ---------- Excel direkt aus OneDrive lesen ----------
      if (request.method === 'GET' && path === '/excel') {
        if (!env.EXCEL_URL) return fail('EXCEL_URL ist nicht gesetzt.', 404);
        const fresh = url.searchParams.has('fresh');
        const cache = caches.default;
        const key = new Request('https://cache.local/excel');
        if (!fresh) {
          const hit = await cache.match(key);
          if (hit) return json(await hit.json());
        }
        const data = await readExcel(env.EXCEL_URL);
        // 60 s zwischenspeichern, damit OneDrive nicht bei jedem Seitenaufruf gefragt wird
        await cache.put(key, new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'max-age=60' } }));
        return json(data);
      }

      // ---------- Neuen Eintrag ----------
      if (request.method === 'POST' && path === '/entries') {
        const body = await readJson(request);
        const name = cleanName(body.name);
        const minuten = toInt(body.minuten);
        const einheiten = toInt(body.einheiten);

        if (!name) return fail('Ungültiger Benutzername.');
        if (minuten === null || minuten < 0 || minuten > LIMITS.maxMinuten)
          return fail(`Minuten müssen zwischen 0 und ${LIMITS.maxMinuten} liegen.`);
        if (einheiten === null || einheiten < 0 || einheiten > LIMITS.maxEinheiten)
          return fail(`Einheiten müssen zwischen 0 und ${LIMITS.maxEinheiten} liegen.`);
        if (minuten === 0 && einheiten === 0) return fail('Bitte Minuten oder Einheiten eintragen.');

        const ip = request.headers.get('CF-Connecting-IP') || '';
        const since = new Date(Date.now() - 3600_000).toISOString();
        const recent = await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM entries WHERE ip = ? AND created_at > ?'
        ).bind(ip, since).first();
        if (recent.n >= LIMITS.maxPerHourPerIp) return fail('Zu viele Einträge in kurzer Zeit. Bitte später nochmals.', 429);

        const { id: week, kw } = isoWeek(new Date());
        const token = crypto.randomUUID();
        const created = new Date().toISOString();
        const res = await env.DB.prepare(
          'INSERT INTO entries (name, week, kw, minuten, einheiten, created_at, token, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(name, week, kw, minuten, einheiten, created, token, ip).run();

        return json({ id: res.meta.last_row_id, token, week, kw, name, minuten, einheiten, created_at: created }, 201);
      }

      // ---------- Eigenen Eintrag löschen ----------
      const del = path.match(/^\/entries\/(\d+)$/);
      if (request.method === 'DELETE' && del) {
        const token = request.headers.get('X-Token') || '';
        const res = await env.DB.prepare('DELETE FROM entries WHERE id = ? AND token = ?')
          .bind(Number(del[1]), token).run();
        if (!res.meta.changes) return fail('Eintrag nicht gefunden oder nicht deiner.', 404);
        return json({ ok: true });
      }

      // ---------- Neuen Namen anlegen ----------
      if (request.method === 'POST' && path === '/names') {
        const body = await readJson(request);
        const name = cleanName(body.name);
        if (!name) return fail(`Benutzername: ${LIMITS.nameMin}–${LIMITS.nameMax} Zeichen, nur Buchstaben, Zahlen, Leerzeichen, - und _.`);
        const exists = await env.DB.prepare('SELECT name FROM names WHERE name = ?').bind(name).first();
        if (exists) return fail('Diesen Benutzernamen gibt es schon.', 409);
        await env.DB.prepare('INSERT INTO names (name, created_at) VALUES (?, ?)')
          .bind(name, new Date().toISOString()).run();
        return json({ name }, 201);
      }

      return fail('Nicht gefunden.', 404);
    } catch (err) {
      return fail('Serverfehler: ' + (err && err.message ? err.message : String(err)), 500);
    }
  },
};

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function toInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function cleanName(v) {
  const name = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) return null;
  if (!/^[\p{L}\p{N} _\-]+$/u.test(name)) return null;
  return name;
}

// ISO-Kalenderwoche nach Schweizer Zeit (Mo–So)
function isoWeek(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).map(p => [p.type, p.value])
  );
  const t = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const kw = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return { id: `${y}-W${String(kw).padStart(2, '0')}`, kw };
}

// =====================================================================
//  Excel (.xlsx) ohne Bibliothek lesen: ZIP entpacken, XML auswerten
// =====================================================================

async function readExcel(shareUrl) {
  const u = new URL(shareUrl);
  u.searchParams.set('download', '1');           // OneDrive/SharePoint: Datei statt Vorschau
  const res = await fetch(u.toString(), { redirect: 'follow', cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error('Excel nicht erreichbar (HTTP ' + res.status + ')');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('Freigabelink liefert keine Excel-Datei (Anmeldung nötig?)');

  const files = unzipIndex(buf);
  const text = async name => (files[name] ? new TextDecoder().decode(await inflate(buf, files[name])) : null);

  // erstes Tabellenblatt finden
  const workbook = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (firstSheet && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${firstSheet[1]}"`));
    const target = rel && rel.match(/Target="([^"]+)"/);
    if (target) sheetPath = target[1].startsWith('/') ? target[1].slice(1) : 'xl/' + target[1].replace(/^\.\//, '');
  }

  const shared = [];
  const sst = await text('xl/sharedStrings.xml');
  if (sst) for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(allText(si[1]));

  const sheet = await text(sheetPath);
  if (!sheet) throw new Error('Tabellenblatt nicht gefunden');

  // Zellen -> rows[zeile][spalte]
  const rows = [];
  for (const m of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const ref = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (!ref) continue;
    const col = colIndex(ref[1]);
    const row = Number(ref[2]) - 1;
    const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
    const inner = m[2] || '';
    const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    let value = null;
    if (type === 's') value = v !== undefined ? shared[Number(v)] : null;
    else if (type === 'inlineStr') value = allText(inner);
    else if (type === 'str' || type === 'e') value = v !== undefined ? decode(v) : null;
    else if (type === 'b') value = v === '1';
    else value = v !== undefined ? Number(v) : null;
    (rows[row] ||= [])[col] = value;
  }

  // gleiche Auswertung wie sync.py
  const header = rows[0] || [];
  const weekCols = [];
  header.forEach((v, col) => {
    const m = String(v ?? '').match(/KW\s*(\d+)/i);
    if (m) weekCols.push({ kw: Number(m[1]), col });
  });
  const num = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
  const entries = [];
  const weeks = weekCols.map(w => ({ kw: w.kw, entries: [] }));
  for (const r of rows.slice(2)) {
    if (!r) continue;
    const name = String(r[0] ?? '').trim();
    if (!name) continue;
    entries.push({ name, minuten: num(r[1]), einheiten: num(r[2]) });
    weekCols.forEach((w, i) => weeks[i].entries.push({ name, minuten: num(r[w.col]), einheiten: num(r[w.col + 1]) }));
  }

  const modified = res.headers.get('Last-Modified');
  const stamp = modified ? new Date(modified) : new Date();
  return { updated_at: formatCH(stamp), entries, weeks, source: 'excel-live' };
}

function allText(xml) {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => decode(t[1])).join('');
}

function decode(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()]
    ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function formatCH(d) {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d).replace(',', '');
}

// Zentralverzeichnis des ZIP lesen -> { dateiname: { offset, method, size } }
function unzipIndex(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Ungültige Excel-Datei');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    files[name] = { offset, method, size };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function inflate(buf, f) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = f.offset + 30 + dv.getUint16(f.offset + 26, true) + dv.getUint16(f.offset + 28, true);
  const data = buf.subarray(start, start + f.size);
  if (f.method === 0) return data;
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
