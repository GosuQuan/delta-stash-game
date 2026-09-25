#!/usr/bin/env node
/**
 * Warehouse expansion pricing test (release 20260925h).
 *
 * Tiered, permanent, in-game-cash expansion: 5→6 ¥40,000 · 6→7 ¥120,000 · 7→8 ¥300,000.
 * Asserts: default 5×5; each tier charges EXACTLY its price; insufficient cash never charges, the
 * button shows the price (disabled) and cash never goes negative; the header size dropdown cannot
 * bypass the cost outside eval mode (eval may pick freely, leaving eval drops back to the owned size);
 * owned size survives save/load (old saves without the field keep their size); switching back up
 * to an owned size is free; no real-money price is shown (IAP off).
 * Same jsdom harness as ads_off.test.js (real index.html + style.css + game.js).
 */
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) {
  console.error("jsdom missing — run `npm install` (devDependency) first."); process.exit(2);
}
const DIR = process.env.GAME_DIR || path.join(__dirname, "..");

const HOOK = `
  window.__T = {
    get staging() { return staging; }, get placed() { return placed; }, get cash() { return cash; },
    get revealing() { return revealing; }, get crateOpenedThisRound() { return crateOpenedThisRound; },
    get extractedThisRound() { return extractedThisRound; }, get settleReplayActive() { return settleReplayActive; },
    FEATURES, openCrate, extract, nextRound, canPlace, placeItem, gridSize: () => gridSize,
    selectTier(t) { selectedTier = t; },
    get cash() { return cash; }, set cash(v) { cash = v; updateStats(); },
    get ownedGridMax() { return ownedGridMax; }, get evalMode() { return evalMode; },
    tryExpandWarehouse, tryExpandWithCash, setEvalMode, saveGame, updateStats, EXPAND_CASH_COSTS, SAVE_KEY,
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

function makeWorld(seed, saveRaw) {
  const css = fs.readFileSync(path.join(DIR, "style.css"), "utf8");
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8")
    .replace(/<script[^>]*src=[^>]*><\/script>/g, "")
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/, `<style>[hidden]{display:none}</style><style>${css}</style>`);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" });
  const w = dom.window;
  const rs = setTimeout, rc = clearTimeout;
  w.setTimeout = (f, _ms, ...a) => rs(() => f(...a), 0);
  w.clearTimeout = (id) => rc(id);
  w.setInterval = () => 0; w.clearInterval = () => {};
  w.requestAnimationFrame = (f) => rs(() => f(Date.now()), 0);
  w.cancelAnimationFrame = (id) => rc(id);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.fetch = () => Promise.reject(new Error("offline"));
  w.sessionStorage.setItem("auctionHelpSeen", "1");
  if (saveRaw) w.localStorage.setItem("deltaStashSave", saveRaw);
  w.console.warn = () => {}; w.console.log = () => {};
  w.eval(`Math.random = (${mulberry32.toString()})(${seed});`);
  const src = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  const end = src.lastIndexOf("})();");
  if (end < 0) throw new Error("game.js IIFE close not found");
  w.eval(src.slice(0, end) + HOOK + src.slice(end));
  if (!w.__T) throw new Error("test hook not installed");
  return w;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, max = 20000) { for (let i = 0; i < max; i++) { if (pred()) return true; await tick(); } return false; }

let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }

const PRICES = { 6: 40000, 7: 120000, 8: 300000 };
const money = /\$\s?\d|USD|\d\.99/;

async function main() {
  // ---------- tier prices charged exactly ----------
  let w = makeWorld(7);
  let T = w.__T;
  const $ = (s) => w.document.querySelector(s);
  await waitFor(() => false, 50);
  check(T.FEATURES.IAP_ENABLED === false, "IAP off by default");
  check(T.gridSize() === 5 && T.ownedGridMax === 5, `default start is 5×5 (got ${T.gridSize()} owned ${T.ownedGridMax})`);
  check(JSON.stringify(T.EXPAND_CASH_COSTS) === JSON.stringify(PRICES), `EXPAND_CASH_COSTS = ${JSON.stringify(T.EXPAND_CASH_COSTS)}`);
  const btn = $("#btnExpand");
  check(/¥4万/.test(btn.textContent) && btn.disabled, `start cash ¥15,000: button shows ¥4万 and is disabled («${btn.textContent}» disabled=${btn.disabled})`);
  check(!money.test(btn.textContent + btn.title), `no real-money price on expand button («${btn.textContent}» / «${btn.title}»)`);

  const confirmOpen = () => !$("#confirmModal").hidden;
  async function attempt(size, cashBefore, expectOk) {
    T.cash = cashBefore;
    cashBefore = T.cash; // peak-cash milestones may pay a bonus on updateStats — measure from here
    const g0 = T.gridSize();
    T.tryExpandWarehouse();
    await waitFor(() => false, 3);
    if (confirmOpen()) {
      check(!money.test($("#confirmBody").textContent), `[→${size}] confirm has no real-money price`);
      $("#btnConfirmOk").click();
      await waitFor(() => false, 3);
    }
    const tag = `[→${size}×${size} cash ${cashBefore}]`;
    if (expectOk) {
      check(T.gridSize() === size, `${tag} expanded (grid ${T.gridSize()})`);
      check(T.cash === cashBefore - PRICES[size], `${tag} charged exactly ${PRICES[size]} (cash ${T.cash})`);
      check(T.ownedGridMax === size, `${tag} owned=${T.ownedGridMax}`);
    } else {
      check(T.gridSize() === g0, `${tag} not expanded`);
      check(T.cash === cashBefore, `${tag} nothing charged (cash ${T.cash})`);
    }
    check(T.cash >= 0, `${tag} cash never negative (${T.cash})`);
  }
  await attempt(6, 39999, false);
  await attempt(6, 40000, true);             // → cash 0
  check(/¥12万/.test(btn.textContent) && btn.disabled, `at 6×6 with ¥0: button shows ¥12万 disabled («${btn.textContent}»)`);
  await attempt(7, 119999, false);
  await attempt(7, 120005, true);            // → cash 5
  await attempt(8, 299999, false);
  await attempt(8, 300000, true);            // → cash 0
  T.cash = 1e6; const c8 = T.cash; T.tryExpandWarehouse(); await waitFor(() => false, 3);
  check(!confirmOpen() && T.cash === c8 && T.gridSize() === 8, `at 8×8 no further charge (confirm=${confirmOpen()} cash=${T.cash} grid=${T.gridSize()})`);
  // direct cash path with 0 cash cannot go negative
  const w2 = makeWorld(8); const T2 = w2.__T; await waitFor(() => false, 20);
  T2.cash = 0; T2.tryExpandWithCash(); await waitFor(() => false, 3);
  check(T2.cash === 0 && T2.gridSize() === 5 && w2.document.querySelector("#confirmModal").hidden, "tryExpandWithCash with ¥0: no confirm, no charge");
  // confirm opened with enough cash, then cash drops before OK → re-check refuses
  T2.cash = 40000; T2.tryExpandWithCash(); await waitFor(() => false, 3);
  T2.cash = 100; w2.document.querySelector("#btnConfirmOk").click(); await waitFor(() => false, 3);
  check(T2.cash === 100 && T2.gridSize() === 5, `confirm-time re-check: cash ${T2.cash} grid ${T2.gridSize()}`);

  // ---------- dropdown bypass lock ----------
  const w3 = makeWorld(9); const T3 = w3.__T; await waitFor(() => false, 20);
  const sel = w3.document.querySelector("#gridSizeSelect");
  const disabled = [...sel.options].filter((o) => o.disabled).map((o) => o.value).join(",");
  check(disabled === "6,7,8", `dropdown locks unowned sizes outside eval (disabled=${disabled})`);
  T3.cash = 1e6; const c3 = T3.cash;
  sel.value = "8"; sel.dispatchEvent(new w3.Event("change"));
  await waitFor(() => false, 3);
  check(T3.gridSize() === 5 && sel.value === "5" && T3.cash === c3, `dropdown cannot jump to 8×8 for free (grid ${T3.gridSize()} sel=${sel.value} cash=${T3.cash})`);
  T3.setEvalMode(true);
  check([...sel.options].every((o) => !o.disabled), "eval mode: all sizes selectable");
  sel.value = "8"; sel.dispatchEvent(new w3.Event("change"));
  await waitFor(() => false, 3);
  check(T3.gridSize() === 8 && T3.ownedGridMax === 5, `eval: free 8×8 without owning it (grid ${T3.gridSize()} owned ${T3.ownedGridMax})`);
  T3.setEvalMode(false);
  await waitFor(() => false, 3);
  check(T3.gridSize() === 5, `leaving eval drops back to owned 5×5 (grid ${T3.gridSize()})`);

  // ---------- permanence: save/load + old saves + free switch back ----------
  T.saveGame();
  const raw = w.localStorage.getItem(T.SAVE_KEY);
  const w4 = makeWorld(10, raw); const T4 = w4.__T; await waitFor(() => false, 20);
  check(T4.gridSize() === 8 && T4.ownedGridMax === 8, `save/load keeps bought 8×8 (grid ${T4.gridSize()} owned ${T4.ownedGridMax})`);
  const old = JSON.parse(raw); delete old.ownedGridMax; old.gridSize = 7;
  const w5 = makeWorld(11, JSON.stringify(old)); const T5 = w5.__T; await waitFor(() => false, 20);
  check(T5.gridSize() === 7 && T5.ownedGridMax === 7, `old save (no ownedGridMax) keeps its 7×7 (grid ${T5.gridSize()} owned ${T5.ownedGridMax})`);
  const sel5 = w5.document.querySelector("#gridSizeSelect");
  sel5.value = "5"; sel5.dispatchEvent(new w5.Event("change")); await waitFor(() => false, 3);
  check(T5.gridSize() === 5, "can switch down to an owned smaller size");
  const c5 = T5.cash; T5.tryExpandWarehouse(); await waitFor(() => false, 3);
  check(T5.gridSize() === 6 && T5.cash === c5, `switching back up to owned 6×6 is free (grid ${T5.gridSize()} cash ${T5.cash} vs ${c5})`);
  const fresh = JSON.parse(raw); fresh.gridSize = 5; fresh.ownedGridMax = 5;
  const w6 = makeWorld(12, JSON.stringify(fresh)); await waitFor(() => false, 20);
  check(w6.__T.gridSize() === 5 && w6.__T.ownedGridMax === 5, "unexpanded save stays 5×5");

  console.log(`expand_cost: checks: pass=${pass} fail=${fail}`);
  if (fail) { console.log(failures.slice(0, 40).map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
  console.log("OK");
}
main().catch((e) => { console.error(e); process.exit(2); });
