var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ALLOWED_ORIGINS = [
  "https://loaxleo.github.io",
  "http://localhost:8766"
];
var LIMITS = {
  maxMinuten: 600,
  // pro Eintrag
  maxEinheiten: 20,
  // pro Eintrag
  maxPerHourPerIp: 30,
  // gegen Spam
  nameMin: 2,
  nameMax: 30
};
var TZ = "Europe/Zurich";
var worker_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Token",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const json = /* @__PURE__ */ __name((body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    }), "json");
    const fail = /* @__PURE__ */ __name((message, status = 400) => json({ error: message }, status), "fail");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (request.method === "GET" && (path === "/data" || path === "/")) {
        const entries = await env.DB.prepare(
          "SELECT id, name, week, kw, minuten, einheiten, created_at FROM entries ORDER BY id"
        ).all();
        const names = await env.DB.prepare("SELECT name FROM names ORDER BY name").all();
        return json({ entries: entries.results, names: names.results.map((r) => r.name) });
      }
      if (request.method === "POST" && path === "/entries") {
        const body = await readJson(request);
        const name = cleanName(body.name);
        const minuten = toInt(body.minuten);
        const einheiten = toInt(body.einheiten);
        if (!name) return fail("Ung\xFCltiger Name.");
        if (minuten === null || minuten < 0 || minuten > LIMITS.maxMinuten)
          return fail(`Minuten m\xFCssen zwischen 0 und ${LIMITS.maxMinuten} liegen.`);
        if (einheiten === null || einheiten < 0 || einheiten > LIMITS.maxEinheiten)
          return fail(`Einheiten m\xFCssen zwischen 0 und ${LIMITS.maxEinheiten} liegen.`);
        if (minuten === 0 && einheiten === 0) return fail("Bitte Minuten oder Einheiten eintragen.");
        const ip = request.headers.get("CF-Connecting-IP") || "";
        const since = new Date(Date.now() - 36e5).toISOString();
        const recent = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM entries WHERE ip = ? AND created_at > ?"
        ).bind(ip, since).first();
        if (recent.n >= LIMITS.maxPerHourPerIp) return fail("Zu viele Eintr\xE4ge in kurzer Zeit. Bitte sp\xE4ter nochmals.", 429);
        const { id: week, kw } = isoWeek(/* @__PURE__ */ new Date());
        const token = crypto.randomUUID();
        const created = (/* @__PURE__ */ new Date()).toISOString();
        const res = await env.DB.prepare(
          "INSERT INTO entries (name, week, kw, minuten, einheiten, created_at, token, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(name, week, kw, minuten, einheiten, created, token, ip).run();
        return json({ id: res.meta.last_row_id, token, week, kw, name, minuten, einheiten, created_at: created }, 201);
      }
      const del = path.match(/^\/entries\/(\d+)$/);
      if (request.method === "DELETE" && del) {
        const token = request.headers.get("X-Token") || "";
        const res = await env.DB.prepare("DELETE FROM entries WHERE id = ? AND token = ?").bind(Number(del[1]), token).run();
        if (!res.meta.changes) return fail("Eintrag nicht gefunden oder nicht deiner.", 404);
        return json({ ok: true });
      }
      if (request.method === "POST" && path === "/names") {
        const body = await readJson(request);
        const name = cleanName(body.name);
        if (!name) return fail(`Name: ${LIMITS.nameMin}\u2013${LIMITS.nameMax} Zeichen, nur Buchstaben, Zahlen, Leerzeichen, - und _.`);
        const exists = await env.DB.prepare("SELECT name FROM names WHERE name = ?").bind(name).first();
        if (exists) return fail("Diesen Namen gibt es schon.", 409);
        await env.DB.prepare("INSERT INTO names (name, created_at) VALUES (?, ?)").bind(name, (/* @__PURE__ */ new Date()).toISOString()).run();
        return json({ name }, 201);
      }
      return fail("Nicht gefunden.", 404);
    } catch (err) {
      return fail("Serverfehler: " + (err && err.message ? err.message : String(err)), 500);
    }
  }
};
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
__name(readJson, "readJson");
function toInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
__name(toInt, "toInt");
function cleanName(v) {
  const name = String(v ?? "").trim().replace(/\s+/g, " ");
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) return null;
  if (!/^[\p{L}\p{N} _\-]+$/u.test(name)) return null;
  return name;
}
__name(cleanName, "cleanName");
function isoWeek(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const t = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const kw = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return { id: `${y}-W${String(kw).padStart(2, "0")}`, kw };
}
__name(isoWeek, "isoWeek");

// ../../../../tmp/wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../tmp/wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-cNL7c9/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../tmp/wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-cNL7c9/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
