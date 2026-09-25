#!/usr/bin/env node
/**
 * Anonymous analytics test (release 20260925i, docs/埋点接入清单.md).
 *
 * Real index.html + style.css + game.js in jsdom (same harness as expand_cost.test.js).
 * Asserts: events land in the bounded localStorage queue with econ = econ-0925h, build, save, tier / tier_group;
 * free-token (rent-0) opens are tagged rent_paid 0 + discount "free_token"; eval sessions are queued with eval = 1
 * (normal play eval = 0); the help-sheet toggle 「参与匿名统计」 (on by default, persisted) stops all queuing and
 * clears the queue; warehouse_expand fires exactly once with via = "cash" on a successful expand-button purchase,
 * never on insufficient cash, a refused confirm-time re-check, a free switch back to an owned size, or an eval
 * dropdown switch; ENDPOINT empty → no fetch / sendBeacon / XHR ever; queue size bounded; no personal fields;
 * save id survives save/load and changes on 新开档 (after a new_save event).
 */
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) {
  console.error("jsdom missing — run `npm install` (devDependency) first."); process.exit(2);
}
const DIR = process.env.GAME_DIR || path.join(__dirname, "..");
const QKEY = "deltaStashAnalyticsQueue";
const OFFKEY = "deltaStashAnalyticsOff";

const HOOK = `
  window.__T = {
    get cash() { return cash; }, set cash(v) { cash = v; updateStats(); },
    get revealing() { return revealing; }, get crateOpenedThisRound() { return crateOpenedThisRound; },
    get settleReplayActive() { return settleReplayActive; }, get evalMode() { return evalMode; },
    get analyticsSave() { return analyticsSave; }, get ownedGridMax() { return ownedGridMax; },
    FEATURES, ANALYTICS, BUILD_VERSION, SAVE_KEY, openCrate, extract, nextRound, track, saveGame, newSaveConfirm,
    tryExpandWarehouse, tryExpandWithCash, setEvalMode, gridSize: () => gridSize,
    selectTier(t) { selectedTier = t; },
    giveFreeCommon(n) { freeCommonCharges = n; },
  };
`;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorld(seed, opts = {}) {
  const css = fs.readFileSync(path.join(DIR, "style.css"), "utf8");
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8")
    .replace(/<script[^>]*src=[^>]*><\/script>/g, "")
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/, `<style>[hidden]{display:none}</style><style>${css}</style>`);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: opts.url || "https://example.test/" });
  const w = dom.window;
  const rs = setTimeout, rc = clearTimeout;
  w.setTimeout = (f, _ms, ...a) => rs(() => f(...a), 0);
  w.clearTimeout = (id) => rc(id);
  w.setInterval = () => 0; w.clearInterval = () => {};
  w.requestAnimationFrame = (f) => rs(() => f(Date.now()), 0);
  w.cancelAnimationFrame = (id) => rc(id);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLCanvasElement.prototype.getContext = () => null;
  // Network spies: version.json polling is the only allowed request
  w.__net = [];
  w.fetch = (url) => { if (!/^version\.json/.test(String(url))) w.__net.push(["fetch", String(url)]); return Promise.reject(new Error("offline")); };
  w.navigator.sendBeacon = (url) => { w.__net.push(["beacon", String(url)]); return true; };
  const xo = w.XMLHttpRequest.prototype.open;
  w.XMLHttpRequest.prototype.open = function (m, u, ...r) { w.__net.push(["xhr", String(u)]); return xo.call(this, m, u, ...r); };
  w.confirm = () => true;
  w.sessionStorage.setItem("auctionHelpSeen", "1");
  if (opts.saveRaw) w.localStorage.setItem("deltaStashSave", opts.saveRaw);
  for (const [k, v] of Object.entries(opts.ls || {})) w.localStorage.setItem(k, v);
  w.console.warn = () => {}; w.console.log = () => {};
  w.eval(`Math.random = (${mulberry32.toString()})(${seed});`);
  const src = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  const end = src.lastIndexOf("})();");
  if (end < 0) throw new Error("game.js IIFE close not found");
  w.eval(src.slice(0, end) + HOOK + src.slice(end));
  if (!w.__T) throw new Error("test hook not installed");
  w.__T.FEATURES.CHALLENGE_ENABLED = false; // deterministic rounds (challenge timers are collapsed)
  return w;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, max = 20000) { for (let i = 0; i < max; i++) { if (pred()) return true; await tick(); } return false; }
let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }

const queue = (w) => { try { return JSON.parse(w.localStorage.getItem(QKEY) || "[]"); } catch (_) { return null; } };
const evs = (w, name) => queue(w).filter((e) => e.ev === name);

async function playRound(w, tier = "common") {
  const T = w.__T;
  T.selectTier(tier);
  T.openCrate();
  const opened = await waitFor(() => T.crateOpenedThisRound && !T.revealing);
  T.extract();
  await waitFor(() => !T.settleReplayActive, 2000);
  await waitFor(() => false, 5);
  T.nextRound();
  await waitFor(() => false, 3);
  return opened;
}

const PII = ["name", "email", "ip", "phone", "account", "user", "username", "ua", "userAgent", "fingerprint", "lang", "tz"];

async function main() {
  // ---------- normal play: queued locally with econ-0925h ----------
  const w = makeWorld(21);
  const T = w.__T;
  await waitFor(() => false, 30);
  check(T.FEATURES.ANALYTICS_ENABLED === true, "FEATURES.ANALYTICS_ENABLED true");
  check(T.ANALYTICS.ENDPOINT === "", `ENDPOINT empty (got «${T.ANALYTICS.ENDPOINT}»)`);
  check(T.ANALYTICS.ECON === "econ-0925h", "ANALYTICS.ECON = econ-0925h");
  const cb = w.document.getElementById("analyticsOptIn");
  const help = w.document.getElementById("helpModal");
  check(!!cb && cb.checked, "help sheet toggle exists and is on by default");
  check(help && help.textContent.includes("为了调平数值，游戏会匿名记录开柜、结算等玩法数据，不含姓名、账号、IP 等个人信息，可以随时关闭。"), "help sheet shows the approved copy");
  check(help && help.textContent.includes("参与匿名统计"), "help sheet toggle label 参与匿名统计");
  check(evs(w, "session_start").length === 1, `session_start queued once (${evs(w, "session_start").length})`);
  const opened = await playRound(w, "common");
  check(opened, "common crate opened");
  const co = evs(w, "crate_open"), rsE = evs(w, "round_settle");
  check(co.length === 1 && rsE.length === 1, `one crate_open + one round_settle queued (${co.length}/${rsE.length})`);
  const all = queue(w);
  check(all.length > 0 && all.every((e) => e.econ === "econ-0925h"), "every queued event has econ = econ-0925h");
  check(all.every((e) => e.eval === 0), "normal play: eval = 0 on every event");
  check(all.every((e) => e.build === T.BUILD_VERSION && e.schema === 1), "build = BUILD_VERSION, schema = 1");
  check(all.every((e) => typeof e.save === "string" && e.save === T.analyticsSave.save), "save field = current save id");
  check(all.every((e) => typeof e.pid === "string" && e.pid.length >= 6 && typeof e.sid === "string"), "pid / sid present");
  if (co[0]) {
    check(co[0].tier === "common" && co[0].tier_group === "general", `crate_open tier common / general (${co[0].tier}/${co[0].tier_group})`);
    check(co[0].rent_paid > 0 && co[0].discount !== "free_token", `paid open: rent_paid ${co[0].rent_paid} discount ${co[0].discount}`);
    check(co[0].items >= 1 && co[0].rarity && typeof co[0].rarity === "object", "crate_open items + rarity counts");
    check(co[0].daily_left === null, "general crate daily_left null");
    check(co[0].honeymoon === 1 ? co[0].discount === "honeymoon" : true, `honeymoon open tagged discount=honeymoon (${co[0].discount})`);
  }
  if (rsE[0]) {
    check(rsE[0].tier === "common" && rsE[0].rent_paid === co[0].rent_paid, "round_settle carries tier + rent_paid");
    check(["loot_value", "packed_value", "discard_n", "util_pct", "perfect_pack", "perfect_bonus", "empty_refund", "net", "challenges", "dur_s"].every((k) => k in rsE[0]), "round_settle has schema fields");
  }
  const bad = all.flatMap((e) => Object.keys(e).filter((k) => PII.includes(k)));
  check(bad.length === 0, `no personal fields in events (${bad.join(",")})`);

  // rent-0 (free token) open: distinguishable
  T.giveFreeCommon(1);
  await playRound(w, "common");
  const co2 = evs(w, "crate_open").slice(-1)[0], rs2 = evs(w, "round_settle").slice(-1)[0];
  check(co2 && co2.rent_paid === 0 && co2.discount === "free_token" && co2.rent_cash_pct === 0, `free-token crate_open rent_paid 0 / free_token (${co2 && co2.rent_paid}/${co2 && co2.discount})`);
  check(rs2 && rs2.rent_paid === 0 && rs2.discount === "free_token", `free-token round_settle rent_paid 0 / free_token (${rs2 && rs2.rent_paid}/${rs2 && rs2.discount})`);

  // pagehide → session_end queued, still no network
  w.dispatchEvent(new w.Event("pagehide"));
  await waitFor(() => false, 3);
  check(evs(w, "session_end").length === 1, "session_end queued on pagehide");
  check(w.__net.length === 0, `no network call with empty ENDPOINT (${JSON.stringify(w.__net)})`);

  // save id survives save/load; 新开档 → new_save then a new id
  T.saveGame();
  const raw = w.localStorage.getItem(T.SAVE_KEY);
  const sid0 = T.analyticsSave.save;
  const wl = makeWorld(22, { saveRaw: raw });
  await waitFor(() => false, 30);
  const ss = evs(wl, "session_start")[0];
  check(ss && ss.save === sid0 && ss.is_new === false, `reload keeps save id (${ss && ss.save} vs ${sid0})`);
  wl.__T.newSaveConfirm();
  await waitFor(() => false, 3);
  const ns = evs(wl, "new_save")[0];
  check(ns && ns.save === sid0 && typeof ns.prev_round === "number", "new_save emitted with the old save id");
  check(wl.__T.analyticsSave.save !== sid0, "new save gets a new save id");

  // ---------- bounded queue ----------
  for (let i = 0; i < 500; i++) T.track("organize", { source: "key", packed_n: 1, packed_value: 1, keys_left: 0 });
  const qn = queue(w).length;
  check(qn === T.ANALYTICS.QUEUE_MAX && qn <= 200, `queue bounded at QUEUE_MAX (${qn} / ${T.ANALYTICS.QUEUE_MAX})`);
  check(w.__analyticsLog.length <= T.ANALYTICS.LOCAL_MAX, `__analyticsLog bounded (${w.__analyticsLog.length})`);
  check(w.__net.length === 0, "still no network after 500 events");

  // ---------- eval session: queued with eval = 1 ----------
  const we = makeWorld(23, { url: "https://example.test/?eval=1" });
  await waitFor(() => false, 30);
  check(we.__T.evalMode === true, "?eval=1 → eval mode");
  await playRound(we, "common");
  const qe = queue(we);
  check(qe.some((e) => e.ev === "crate_open") && qe.some((e) => e.ev === "round_settle"), `eval: crate_open + round_settle queued (${qe.map((e) => e.ev).join(",")})`);
  check(qe.length > 0 && qe.every((e) => e.eval === 1 && e.econ === "econ-0925h"), "eval: every event has eval = 1 + econ");
  check(we.__net.length === 0, "eval: no network");

  // ---------- toggle off: nothing queued ----------
  const wo = makeWorld(24);
  await waitFor(() => false, 30);
  const cbo = wo.document.getElementById("analyticsOptIn");
  check(queue(wo).length >= 1, "toggle world: session_start queued before opt-out");
  cbo.checked = false; cbo.dispatchEvent(new wo.Event("change"));
  check(wo.localStorage.getItem(OFFKEY) === "1", "opt-out persisted in localStorage");
  check(wo.localStorage.getItem(QKEY) === null, "opt-out clears the pending queue");
  const logN = wo.__analyticsLog.length;
  await playRound(wo, "common");
  wo.__T.track("organize", { source: "key" });
  wo.dispatchEvent(new wo.Event("pagehide"));
  check(wo.localStorage.getItem(QKEY) === null, "toggle off: nothing queued after a full round");
  check(wo.__analyticsLog.length === logN, `toggle off: __analyticsLog unchanged (${logN} → ${wo.__analyticsLog.length})`);
  // persisted off across reload
  const wo2 = makeWorld(25, { ls: { [OFFKEY]: "1" } });
  await waitFor(() => false, 30);
  check(wo2.document.getElementById("analyticsOptIn").checked === false, "toggle stays off after reload");
  await playRound(wo2, "common");
  check(wo2.localStorage.getItem(QKEY) === null && wo2.__analyticsLog.length === 0, "off after reload: nothing queued (not even session_start)");
  const cb2 = wo2.document.getElementById("analyticsOptIn");
  cb2.checked = true; cb2.dispatchEvent(new wo2.Event("change"));
  await playRound(wo2, "common");
  check(evs(wo2, "crate_open").length === 1 && wo2.localStorage.getItem(OFFKEY) === null, "turning it back on resumes queuing");

  // ---------- warehouse_expand ----------
  const wx = makeWorld(26);
  const X = wx.__T;
  const $ = (s) => wx.document.querySelector(s);
  await waitFor(() => false, 30);
  const expands = () => evs(wx, "warehouse_expand");
  const clickOk = async () => { if (!$("#confirmModal").hidden) { $("#btnConfirmOk").click(); } await waitFor(() => false, 3); };
  X.cash = 39999; X.tryExpandWarehouse(); await clickOk();
  check(X.gridSize() === 5 && expands().length === 0, `insufficient cash: no expand, no event (${expands().length})`);
  X.cash = 40000; X.tryExpandWithCash(); await waitFor(() => false, 3);
  X.cash = 100; await clickOk(); // confirm-time re-check refuses
  check(X.gridSize() === 5 && expands().length === 0, "refused confirm-time re-check: no event");
  X.cash = 40000; const cashBefore = X.cash;
  $("#btnExpand").click(); await clickOk();
  const ex = expands();
  check(X.gridSize() === 6 && ex.length === 1, `successful button purchase → exactly one warehouse_expand (${ex.length}, grid ${X.gridSize()})`);
  if (ex[0]) {
    check(ex[0].via === "cash" && ex[0].from === 5 && ex[0].to === 6 && ex[0].cost === 40000 && ex[0].cash_before === cashBefore,
      `warehouse_expand fields via=cash 5→6 cost 40000 cash_before ${cashBefore} (${JSON.stringify(ex[0])})`);
    check(ex[0].cost_cash_pct === +(40000 / cashBefore).toFixed(3), "cost_cash_pct");
  }
  const sel = $("#gridSizeSelect");
  sel.value = "5"; sel.dispatchEvent(new wx.Event("change")); await waitFor(() => false, 3);
  X.tryExpandWarehouse(); await clickOk(); // free switch back up to owned 6×6
  check(X.gridSize() === 6 && expands().length === 1, "free switch to owned size: no new event");
  X.setEvalMode(true);
  sel.value = "8"; sel.dispatchEvent(new wx.Event("change")); await waitFor(() => false, 3);
  check(X.gridSize() === 8 && X.ownedGridMax === 6, `eval dropdown switched to 8×8 without buying (grid ${X.gridSize()} owned ${X.ownedGridMax})`);
  check(expands().length === 1, `eval dropdown switch: no warehouse_expand (${expands().length})`);
  sel.value = "7"; sel.dispatchEvent(new wx.Event("change")); await waitFor(() => false, 3);
  check(expands().length === 1, "eval dropdown switch again: still one event");
  X.setEvalMode(false); await waitFor(() => false, 3);
  check(expands().length === 1 && wx.__net.length === 0, "leaving eval: no event, no network");

  console.log(`analytics: checks: pass=${pass} fail=${fail}`);
  if (fail) { console.log(failures.slice(0, 40).map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
  console.log("OK");
}
main().catch((e) => { console.error(e); process.exit(2); });
