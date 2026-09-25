#!/usr/bin/env node
/**
 * Release-version tests (20260925d).
 *  1. Consistency: index.html ?v= ×4 (style/platform/audio/game), version.json, game.js BUILD_VERSION all equal.
 *  2. Update banner (jsdom, REAL game.js): fetch stubbed to return a different version →
 *     - no fetch / no banner while a crate is being opened or packed (mid-reveal);
 *     - banner 「有更新，刷新后继续」 appears after settle (fetch uses version.json?t=… + cache:'no-store');
 *     - throttled (≤1 fetch / 60 s); never reloads by itself;
 *     - clicking 刷新 writes the save first, then reloads.
 *   Same-version remote → no banner. Test-only source transform: `location.reload()` → spy.
 * Run: npm test   (Env GAME_DIR=<dir> to test another build.)
 */
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) {
  console.error("jsdom missing — run `npm install` (devDependency) first."); process.exit(2);
}
const DIR = process.env.GAME_DIR || path.join(__dirname, "..");
let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }

// ---------- 1. consistency ----------
const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
const gameSrc = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
const want = ["style.css", "platform.js", "audio.js", "game.js"];
const vers = {};
for (const f of want) {
  const m = html.match(new RegExp(`${f.replace(".", "\\.")}\\?v=([0-9A-Za-z._-]+)`));
  vers[f] = m ? m[1] : null;
  check(!!vers[f], `index.html has ${f}?v=`);
}
const allV = [...html.matchAll(/\?v=([0-9A-Za-z._-]+)/g)].map((m) => m[1]);
check(allV.length === 4, `index.html has exactly 4 ?v= (found ${allV.length})`);
let fileVersion = null;
try { fileVersion = JSON.parse(fs.readFileSync(path.join(DIR, "version.json"), "utf8")).version; } catch (e) { /* fail below */ }
check(typeof fileVersion === "string" && fileVersion.length > 0, "version.json has a version string");
const bm = gameSrc.match(/const BUILD_VERSION = ["']([^"']+)["']/);
const buildVersion = bm ? bm[1] : null;
check(!!buildVersion, "game.js defines BUILD_VERSION");
for (const f of want) check(vers[f] === buildVersion, `${f}?v=${vers[f]} == BUILD_VERSION ${buildVersion}`);
check(allV.every((v) => v === buildVersion), "every ?v= == BUILD_VERSION");
check(fileVersion === buildVersion, `version.json ${fileVersion} == BUILD_VERSION ${buildVersion}`);
console.log(`consistency: ?v=${[...new Set(allV)].join("/")} version.json=${fileVersion} BUILD_VERSION=${buildVersion}`);

// ---------- 2. banner ----------
const HOOK = `
  window.__V = {
    get cash() { return cash; }, set cash(v) { cash = v; }, get revealing() { return revealing; },
    get crateOpenedThisRound() { return crateOpenedThisRound; }, get extractedThisRound() { return extractedThisRound; },
    get staging() { return staging; }, SAVE_KEY, BUILD_VERSION,
    openCrate, extract, canPlace, placeItem, checkForUpdate, gridSize: () => gridSize,
    resetThrottle() { lastVersionCheckAt = 0; },
    setup() {
      cash = 50000; round = 9; honeymoonEnded = true; selectedTier = "common"; bankrupt = false;
      openMilestonesClaimed = new Set(OPEN_MILESTONE_CFG.MILESTONES.map((m) => m.count));
      peakMilestonesClaimed = new Set(PEAK_MILESTONE_CFG.MILESTONES.map((m) => m.peak));
      dailyActivityCompleted = true; dailyActivityJackpotRolled = true; dailyActivityJackpotPending = false;
    },
  };
`;

function makeWorld(remoteVersion) {
  const page = html.replace(/<script[^>]*src=[^>]*><\/script>/g, "");
  const dom = new JSDOM(page, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/delta-stash-game/" });
  const w = dom.window;
  const rs = setTimeout, rc = clearTimeout;
  w.setTimeout = (f, _ms, ...a) => rs(() => f(...a), 0);
  w.clearTimeout = (id) => rc(id);
  w.setInterval = () => 0; w.clearInterval = () => {};
  w.requestAnimationFrame = (f) => rs(() => f(Date.now()), 0);
  w.cancelAnimationFrame = (id) => rc(id);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.sessionStorage.setItem("auctionHelpSeen", "1");
  w.console.warn = () => {}; w.console.log = () => {};
  const log = { fetches: [], reloads: [] };
  w.fetch = (url, opts) => {
    log.fetches.push({ url: String(url), opts: opts || {} });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: remoteVersion }) });
  };
  w.__reloadSpy = () => { log.reloads.push({ save: w.localStorage.getItem(w.__V.SAVE_KEY) }); };
  let src = gameSrc;
  const n = (src.match(/location\.reload\(\)/g) || []).length;
  src = src.replace(/location\.reload\(\)/g, "window.__reloadSpy()");
  const end = src.lastIndexOf("})();");
  w.eval(`Math.random = (() => { let a = 4242; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; })();`);
  w.eval(src.slice(0, end) + HOOK + src.slice(end));
  return { w, log, reloadSites: n };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, max = 20000) { for (let i = 0; i < max; i++) { if (pred()) return true; await tick(); } return false; }
async function finishReveal(w, pred) {
  return waitFor(() => {
    const deck = w.document.querySelector("#revealDeck");
    if (deck && !deck.hidden) w.document.querySelector("#btnDecryptNext")?.click();
    return pred();
  });
}
async function settle(w) { for (let i = 0; i < 200; i++) await tick(); }
const banner = (w) => w.document.getElementById("updateBanner");
const bannerVisible = (w) => !!banner(w) && !banner(w).hidden;

function pack(V) {
  const gs = V.gridSize();
  for (const e of V.staging.slice().sort((a, b) => (b.valueOverride || 0) - (a.valueOverride || 0))) {
    let done = false;
    for (let rot = 0; rot < 4 && !done; rot++) for (let r = 0; r < gs && !done; r++) for (let c = 0; c < gs && !done; c++) {
      if (V.canPlace(e.defId, rot, r, c) && V.placeItem({ ...e, rot }, r, c)) {
        V.staging.splice(V.staging.findIndex((s) => s.uid === e.uid), 1); done = true;
      }
    }
  }
}

async function main() {
  // A. newer release on the server
  {
    const { w, log, reloadSites } = makeWorld("20991231z");
    const V = w.__V;
    check(reloadSites >= 1, "game.js has a location.reload() call site (refresh button)");
    V.setup();
    V.openCrate();
    check(V.revealing || (V.crateOpenedThisRound && !V.extractedThisRound), "crate open in progress");
    // mid-open: explicit check + tab becoming visible → nothing
    V.resetThrottle();
    V.checkForUpdate("test-mid-open");
    w.document.dispatchEvent(new w.Event("visibilitychange"));
    await settle(w);
    check(log.fetches.length === 0, `no version fetch during open (got ${log.fetches.length})`);
    check(!bannerVisible(w), "no banner during open");
    const ov = w.document.querySelector("#scanOverlay");
    if (ov) ov.dispatchEvent(new w.Event("pointerdown"));
    const revealed = await finishReveal(w, () => V.crateOpenedThisRound && !V.revealing);
    check(revealed, "reveal finished");
    V.resetThrottle();
    V.checkForUpdate("test-packing");
    await settle(w);
    check(log.fetches.length === 0 && !bannerVisible(w), "no fetch / banner while packing (round unsettled)");
    pack(V);
    V.extract();
    const shown = await waitFor(() => bannerVisible(w));
    check(shown, "banner appears after settle");
    check(log.fetches.length === 1, `exactly one fetch after settle (got ${log.fetches.length})`);
    const f = log.fetches[0] || { url: "", opts: {} };
    check(/^version\.json\?t=\d+$/.test(f.url), `fetch url version.json?t=<now> (got ${f.url})`);
    check(f.opts.cache === "no-store", "fetch uses cache:'no-store'");
    check(banner(w) && /有更新，刷新后继续/.test(banner(w).textContent), "banner text 有更新，刷新后继续");
    check(log.reloads.length === 0, "no automatic reload");
    // throttle: another trigger within 60 s → no new fetch
    const before = log.fetches.length;
    w.document.dispatchEvent(new w.Event("visibilitychange"));
    await settle(w);
    check(log.fetches.length === before, "throttled: no second fetch within 60 s");
    // click 刷新 → save written first, then reload
    V.cash = 123457;
    w.localStorage.removeItem(V.SAVE_KEY);
    const btn = w.document.getElementById("btnUpdateReload");
    check(!!btn && btn.textContent === "刷新", "刷新 button present");
    if (btn) btn.click();
    check(log.reloads.length === 1, "clicking 刷新 reloads once");
    const saved = log.reloads[0] && log.reloads[0].save ? JSON.parse(log.reloads[0].save) : null;
    check(!!saved && saved.cash === 123457, "save written (with current cash) before reload");
  }
  // B. same version on the server → nothing
  {
    const { w, log } = makeWorld(null);
    const V = w.__V;
    // replace stub: remote == BUILD_VERSION
    w.fetch = (url, opts) => { log.fetches.push({ url, opts }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: V.BUILD_VERSION }) }); };
    V.setup(); V.resetThrottle(); V.checkForUpdate("idle");
    await settle(w);
    check(log.fetches.length === 1, "idle check fetches once");
    check(!bannerVisible(w), "same version → no banner");
  }
  // C. network error → silent
  {
    const { w } = makeWorld(null);
    const V = w.__V;
    w.fetch = () => Promise.reject(new Error("offline"));
    V.setup(); V.resetThrottle();
    let threw = false;
    try { V.checkForUpdate("idle"); await settle(w); } catch (_) { threw = true; }
    check(!threw && !bannerVisible(w), "fetch error is silent");
  }
  console.log(`version checks: pass=${pass} fail=${fail}`);
  if (fail) { for (const m of failures) console.log("FAIL: " + m); process.exit(1); }
  console.log("OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
