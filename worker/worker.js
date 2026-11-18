/**
 * Musik-Scoreboard – Online-Einträge
 * Cloudflare Worker mit D1-Datenbank (Binding-Name: DB)
 *
 *   GET    /data                 -> { entries: [...], names: [...] }   (öffentlich, ohne Token)
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

      // ---------- Neuen Eintrag ----------
      if (request.method === 'POST' && path === '/entries') {
        const body = await readJson(request);
        const name = cleanName(body.name);
        const minuten = toInt(body.minuten);
        const einheiten = toInt(body.einheiten);

        if (!name) return fail('Ungültiger Name.');
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
        if (!name) return fail(`Name: ${LIMITS.nameMin}–${LIMITS.nameMax} Zeichen, nur Buchstaben, Zahlen, Leerzeichen, - und _.`);
        const exists = await env.DB.prepare('SELECT name FROM names WHERE name = ?').bind(name).first();
        if (exists) return fail('Diesen Namen gibt es schon.', 409);
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
