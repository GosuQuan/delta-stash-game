// delta-stash-analytics — 匿名玩法统计接收端（Cloudflare Worker + D1）
// POST /e  body: {"events":[{...}, ...]}（text/plain 或 application/json 均可）
// 不记录 IP；只记 Cloudflare 给出的国家代码。
const ALLOWED_ORIGINS = [
  /^https:\/\/gosuquan\.github\.io$/,
  /^https:\/\/([a-z0-9-]+\.)*itch\.zone$/,
  /^https:\/\/([a-z0-9-]+\.)*itch\.io$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

const EVENTS = new Set([
  "crate_open", "round_settle", "challenge_result", "bankrupt", "restructure",
  "new_save", "hall_unlock", "peak_reach", "warehouse_expand", "organize",
  "session_start", "session_end", "ui_anomaly",
]);

// 公共字段 -> 独立列；其余字段整体进 props（JSON）
const COMMON = {
  ts: "int", schema: "int", ev: "str", pid: "str", sid: "str", save: "str",
  build: "str", econ: "str", round: "int", cash: "int", peak: "int",
  hall: "str", grid: "int", honeymoon: "bool", eval: "bool", dev: "str", vw: "str",
};
const COLS = Object.keys(COMMON);

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 50;
const MAX_PROPS = 4096;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function coerce(kind, v) {
  if (v === undefined || v === null) return null;
  if (kind === "int") {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "bool") return v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
  const s = String(v);
  return s.length > 64 ? s.slice(0, 64) : s;
}

export function normalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!EVENTS.has(raw.ev)) return null;
  if (typeof raw.pid !== "string" || !ID_RE.test(raw.pid)) return null;
  const row = {};
  for (const k of COLS) row[k] = coerce(COMMON[k], raw[k]);
  const props = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k in COMMON) continue;
    if (k.length > 32) continue;
    props[k] = v;
  }
  let p = JSON.stringify(props);
  if (p.length > MAX_PROPS) p = JSON.stringify({ _dropped: "props_too_large" });
  row.props = p;
  return row;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGINS.some((re) => re.test(origin));
    const cors = okOrigin ? corsHeaders(origin) : {};

    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname !== "/e") return new Response("not found", { status: 404 });
    if (req.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (!okOrigin) return new Response("forbidden", { status: 403 });

    const len = Number(req.headers.get("Content-Length") || 0);
    if (len > MAX_BODY) return json({ ok: false, err: "too_large" }, 413, cors);
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ ok: false, err: "too_large" }, 413, cors);

    let body;
    try { body = JSON.parse(text); } catch (_) { return json({ ok: false, err: "bad_json" }, 400, cors); }
    const list = Array.isArray(body) ? body : body && Array.isArray(body.events) ? body.events : null;
    if (!list) return json({ ok: false, err: "no_events" }, 400, cors);

    const rows = list.slice(0, MAX_EVENTS).map(normalize).filter(Boolean);
    if (rows.length === 0) return json({ ok: true, n: 0 }, 200, cors);

    const country = (req.cf && req.cf.country) || null;
    const now = Date.now();
    const cols = ["received_at", "country", ...COLS, "props"];
    const sql = `INSERT INTO events (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    const stmt = env.DB.prepare(sql);
    await env.DB.batch(rows.map((r) => stmt.bind(now, country, ...COLS.map((k) => r[k]), r.props)));
    return json({ ok: true, n: rows.length }, 200, cors);
  },

  // 每天一次：把昨天的结算汇总进 daily_settle，删除 90 天前的原始事件
  async scheduled(_event, env) {
    await rollupAndPrune(env.DB, Date.now());
  },
};

export async function rollupAndPrune(db, nowMs) {
  const DAY = 86400000;
  // 北京时间（UTC+8）的自然日
  const todayStart = Math.floor((nowMs + 8 * 3600000) / DAY) * DAY - 8 * 3600000;
  const yStart = todayStart - DAY;
  await db.prepare(ROLLUP_SQL).bind(yStart, todayStart).run();
  await db.prepare("DELETE FROM events WHERE received_at < ?").bind(nowMs - 90 * DAY).run();
}

const ROLLUP_SQL = `
INSERT OR REPLACE INTO daily_settle
  (day, econ, tier_group, tier, honeymoon_open, grid, n, n_ratio, sum_ratio, n_profit, sum_rent, sum_value, sum_discard_n, n_perfect)
SELECT
  date((received_at / 1000) + 8 * 3600, 'unixepoch') AS day,
  econ, tier_group, tier, honeymoon_open, grid,
  COUNT(*),
  SUM(CASE WHEN rent_paid > 0 AND empty_refund = 0 THEN 1 ELSE 0 END),
  SUM(CASE WHEN rent_paid > 0 AND empty_refund = 0 THEN (loot_value + perfect_bonus) * 1.0 / rent_paid ELSE 0 END),
  SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END),
  SUM(rent_paid), SUM(loot_value + perfect_bonus), SUM(discard_n), SUM(perfect_pack)
FROM v_settle
WHERE received_at >= ? AND received_at < ?
GROUP BY day, econ, tier_group, tier, honeymoon_open, grid`;
