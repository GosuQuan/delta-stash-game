#!/usr/bin/env node
/**
 * Release 20260926d — launch checks (plain node + jsdom, real index.html + style.css + game.js).
 *  1. Warehouse grid always has its cells (fresh load, owned 8×8, after settle → next round, after 清算重整) + visible grid lines in CSS.
 *  2. Hall hint 「距X还差 ¥Y」: [hidden] really hides (global rule), hint shows the gap to the NEXT hall and is hidden at the top hall.
 *  3. Touch: the touchmove guard only cancels while a drag is armed AND the event is cancelable; touch-action on draggables / grid.
 *  4. Owned warehouse size survives bankruptcy restructure (applyRestructure); only 新开档 resets it to 5×5.
 *  5. Eval taint: legacy `deltaStashEval` removed + save evalTainted (persisted, survives restructure, reset by 新开档),
 *     ?eval=1 session taints, eval_tainted 1|0 on EVERY tracked event (same field/format as tools/analytics/client-snippet.js).
 *  6. PUBLIC build: ?eval=1 / ?ball / ?soft / ?mono have no effect, no eval/数据 buttons or panel in the DOM, can't be switched on.
 *     TEST build (tools/build-test.js output in test/): eval only with ?eval=1, own storage prefix, analytics tagged test.
 */
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) { console.error("jsdom missing — run `npm install` first."); process.exit(2); }
const ROOT = path.join(__dirname, "..");

const HOOK = `
  window.__T = {
    FEATURES, ITEM_DEFS, drag, el, SAVE_KEY, ANALYTICS, track,
    get placed() { return placed; }, get staging() { return staging; },
    get gridSize() { return gridSize; }, get ownedGridMax() { return ownedGridMax; }, set ownedGridMax(v) { ownedGridMax = v; },
    get cash() { return cash; }, set cash(v) { cash = v; },
    get peakCash() { return peakCash; }, set peakCash(v) { peakCash = v; },
    get unlockedHalls() { return unlockedHalls; }, set unlockedHalls(v) { unlockedHalls = v; },
    get evalMode() { return evalMode; }, get evalTainted() { return evalTainted; },
    get evalForceFollowBall() { return evalForceFollowBall; }, get evalSoftChallenge() { return evalSoftChallenge; },
    get bankrupt() { return bankrupt; }, set bankrupt(v) { bankrupt = v; },
    set crateOpenedThisRound(v) { crateOpenedThisRound = v; }, set paidFeeThisRound(v) { paidFeeThisRound = v; },
    updateHallUI, applyRestructure, restructureAvailable, newSaveConfirm, saveGame, loadGame, setEvalMode, monoDebugOn,
    extract, nextRound, initGrid, renderGrid, tryExpandWarehouse, onTouchMoveGuard, placeItem, createItemCard,
    get extractedThisRound() { return extractedThisRound; },
  };
`;

function makeWorld({ dir = ROOT, query = "", save = null, ls = {}, prefix = "", flipEval = false, confirmOk = true } = {}) {
  const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8")
    .replace(/<script[^>]*src=[^>]*><\/script>/g, "")
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/, `<style>${css}</style>`);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" + query });
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
  w.confirm = () => confirmOk;
  w.sessionStorage.setItem(prefix + "auctionHelpSeen", "1");
  w.localStorage.setItem(prefix + "deltaStashOnboardingV1", "veteran");
  if (save) w.localStorage.setItem(prefix + "deltaStashSave", typeof save === "string" ? save : JSON.stringify(save));
  for (const [k, v] of Object.entries(ls)) w.localStorage.setItem(k, v);
  w.console.warn = () => {}; w.console.log = () => {};
  let src = fs.readFileSync(path.join(dir, "game.js"), "utf8");
  if (flipEval) src = src.replace("EVAL_ALLOWED: false", "EVAL_ALLOWED: true");
  const end = src.lastIndexOf("})();");
  w.eval(src.slice(0, end) + HOOK + src.slice(end));
  if (!w.__T) throw new Error("test hook not installed");
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
let pass = 0, fail = 0; const failures = [];
const check = (c, m) => { if (c) pass++; else { fail++; failures.push(m); } };
const shown = (w, n) => { for (let x = n; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === "none") return false; return !!n; };
const cells = (w) => w.document.querySelectorAll("#warehouseGrid .cell").length;
const log = (w) => w.__analyticsLog || [];

async function main() {
  const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""); // comments stripped

  // ---------- 1. grid cells always rendered ----------
  {
    const w = makeWorld(); const T = w.__T; await settle();
    check(cells(w) === 25 && T.gridSize === 5, `fresh load renders 5×5 cells (${cells(w)})`);
    check(/\.warehouse-grid \.cell\s*\{[^}]*box-shadow:\s*inset/.test(css), "style.css draws grid lines on every cell (all layouts)");
    check(/gridTemplateColumns|repeat\(5/.test(w.document.querySelector("#warehouseGrid").getAttribute("style") || ""), "grid has its template columns");
    check(/ 25$|\/ 25$/.test(w.document.querySelector("#capacityText").textContent.trim()), `capacity text 0 / 25 (${w.document.querySelector("#capacityText").textContent})`);
    // owned 8×8 save
    T.saveGame();
    const sv = JSON.parse(w.localStorage.getItem(T.SAVE_KEY)); sv.gridSize = 8; sv.ownedGridMax = 8;
    const w8 = makeWorld({ save: sv }); await settle();
    check(cells(w8) === 64 && w8.__T.gridSize === 8, `fresh load with owned 8×8 renders 64 cells (${cells(w8)})`);
    // settle → next round keeps cells
    const T8 = w8.__T;
    const d = T8.ITEM_DEFS.find((x) => x.shape === "1x1");
    T8.placeItem({ uid: "g1", defId: d.id, rot: 0, valueOverride: d.value }, 0, 0);
    T8.crateOpenedThisRound = true; T8.paidFeeThisRound = 1000; T8.cash = 20000;
    T8.extract(); await settle(8);
    check(T8.extractedThisRound && cells(w8) === 64, `after settlement the 8×8 grid still has 64 cells (${cells(w8)})`);
    w8.document.querySelector("#btnNextRound").click(); await settle();
    check(cells(w8) === 64 && w8.document.querySelector("#capacityText").textContent.includes("/ 64"), `after next round: 64 cells, capacity ?/64 (${cells(w8)} ${w8.document.querySelector("#capacityText").textContent})`);
    // after 清算重整
    T8.bankrupt = true; T8.cash = 10;
    check(T8.restructureAvailable(), "restructure available for the test");
    T8.applyRestructure(); await settle();
    check(cells(w8) === 64, `after restructure the grid still has its cells (${cells(w8)})`);
  }

  // ---------- 2. hall hint ----------
  {
    const w = makeWorld(); const T = w.__T; await settle();
    const hint = w.document.querySelector("#hallUnlockHint");
    check(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css), "style.css has global [hidden]{display:none !important}");
    const run = (unlocked, peak) => { T.unlockedHalls = new Set(unlocked); T.peakCash = peak; T.updateHallUI(); };
    run([], 15000);
    check(!hint.hidden && shown(w, hint) && /^距青铜还差 ¥25,000$/.test(hint.textContent.trim()), `no hall, peak 15k: 距青铜还差 ¥25,000 (${hint.textContent})`);
    run(["bronze_hall"], 45000);
    check(!hint.hidden && /^距翡翠还差 ¥35,000$/.test(hint.textContent.trim()), `bronze hall: gap is to the NEXT hall 翡翠 (${hint.textContent})`);
    check(!/青铜/.test(hint.textContent), "bronze hall: hint no longer mentions 青铜");
    run(["bronze_hall", "jade_hall"], 100000);
    check(hint.hidden && !shown(w, hint), "jade hall, next hall 80k away (> preview window): hint hidden AND not displayed");
    run(["bronze_hall", "jade_hall"], 170000);
    check(shown(w, hint) && /^距白银还差 ¥10,000$/.test(hint.textContent.trim()), `jade hall, 10k from silver: 距白银还差 ¥10,000 (${hint.textContent})`);
    run(["bronze_hall", "jade_hall", "silver_hall"], 200000);
    check(hint.hidden && !shown(w, hint), "silver hall, far from platinum: hidden and not displayed (the 「stuck 青铜」 bug)");
    run(["bronze_hall", "jade_hall", "silver_hall", "platinum_hall", "crimson_hall"], 900000);
    check(hint.hidden && !shown(w, hint), "top hall: hint hidden");
    // every element carrying [hidden] is display:none (nothing leaks through a component display rule)
    const leaks = [...w.document.querySelectorAll("[hidden]")].filter((n) => w.getComputedStyle(n).display !== "none").map((n) => n.id || n.className);
    check(leaks.length === 0, `no [hidden] element is displayed: ${leaks.join(",")}`);
  }

  // ---------- 3. touch ----------
  {
    const w = makeWorld(); const T = w.__T; await settle();
    const ev = (cancelable) => { const e = new w.Event("touchmove", { bubbles: true, cancelable }); let prevented = false; const o = e.preventDefault.bind(e); e.preventDefault = () => { prevented = true; o(); }; return [e, () => prevented]; };
    let [e, p] = ev(true); w.document.dispatchEvent(e);
    check(!p(), "no drag: touchmove is never cancelled (page scrolls normally)");
    T.drag.active = true;
    [e, p] = ev(true); w.document.dispatchEvent(e);
    check(p(), "active drag: cancelable touchmove is cancelled");
    [e, p] = ev(false); w.document.dispatchEvent(e);
    check(!p(), "active drag: non-cancelable touchmove is NOT cancelled (no console warning)");
    T.drag.active = false; T.drag.pending = { pointerType: "touch" };
    [e, p] = ev(true); w.document.dispatchEvent(e);
    check(p(), "armed touch drag: cancelable touchmove cancelled");
    T.drag.pending = { pointerType: "mouse" };
    [e, p] = ev(true); w.document.dispatchEvent(e);
    check(!p(), "armed mouse drag: touchmove untouched");
    T.drag.pending = null;
    check(/\.item-card,\s*\n?\.cell-item\.origin\s*\{[^}]*touch-action:\s*none/.test(css), "item cards touch-action:none");
    check(/\.cell \.cell-item\.grab\s*\{[^}]*touch-action:\s*none/.test(css), "grid item handles touch-action:none");
    check(/\.warehouse-grid\.touch-dragging\s*\{\s*touch-action:\s*none/.test(css), "grid touch-action:none while dragging");
    check(!/\.warehouse-grid\s*\{[^}]*touch-action:\s*none/.test(css), "grid is not touch-action:none when idle (page can scroll)");
    const src = fs.readFileSync(path.join(ROOT, "game.js"), "utf8");
    check(/addEventListener\("touchmove",\s*onTouchMoveGuard,\s*\{\s*passive:\s*false\s*\}\)/.test(src), "touchmove listener is registered non-passive at boot");
    check(/e\.cancelable/.test(src.slice(src.indexOf("function onTouchMoveGuard"), src.indexOf("function onTouchMoveGuard") + 300)), "guard checks e.cancelable");
  }

  // ---------- 4. owned size vs restructure / 新开档 ----------
  {
    const w = makeWorld(); const T = w.__T; await settle();
    T.saveGame();
    const sv = JSON.parse(w.localStorage.getItem(T.SAVE_KEY)); sv.gridSize = 7; sv.ownedGridMax = 7;
    const w7 = makeWorld({ save: sv }); await settle(); const X = w7.__T;
    check(X.gridSize === 7 && X.ownedGridMax === 7, "owned 7×7 loaded");
    X.bankrupt = true; X.cash = 5;
    X.applyRestructure(); await settle();
    check(X.gridSize === 7 && X.ownedGridMax === 7 && cells(w7) === 49, `restructure keeps the owned 7×7 (grid ${X.gridSize} owned ${X.ownedGridMax} cells ${cells(w7)})`);
    X.saveGame(); const afterR = JSON.parse(w7.localStorage.getItem(X.SAVE_KEY));
    check(afterR.ownedGridMax === 7 && afterR.gridSize === 7, "…and the save keeps it");
    X.newSaveConfirm(); await settle();
    check(X.gridSize === 5 && X.ownedGridMax === 5 && cells(w7) === 25, `新开档 resets to 5×5 (grid ${X.gridSize} owned ${X.ownedGridMax} cells ${cells(w7)})`);
  }

  // ---------- 5. eval taint ----------
  {
    // legacy flag → removed + tainted + persisted
    const w = makeWorld({ ls: { deltaStashEval: "1" } }); await settle(); const T = w.__T;
    check(w.localStorage.getItem("deltaStashEval") === null, "legacy deltaStashEval removed on load");
    check(T.evalTainted === true && T.evalMode === false, "legacy flag: save tainted, eval NOT active");
    await settle(30); T.saveGame();
    const sv = JSON.parse(w.localStorage.getItem(T.SAVE_KEY));
    check(sv.evalTainted === true, "evalTainted persisted in the save");
    const w2 = makeWorld({ save: sv }); await settle(); const T2 = w2.__T;
    check(T2.evalTainted === true, "evalTainted survives reload");
    T2.bankrupt = true; T2.cash = 3; T2.applyRestructure(); await settle();
    T2.saveGame();
    check(T2.evalTainted === true && JSON.parse(w2.localStorage.getItem(T2.SAVE_KEY)).evalTainted === true, "evalTainted survives 清算重整");
    // tracked events carry eval_tainted: 1
    T2.track("probe", {});
    const evs = log(w2);
    check(evs.length > 0 && evs.every((e) => e.eval_tainted === 1), `every event has eval_tainted = 1 (${evs.map((e) => e.eval_tainted).join(",")})`);
    T2.newSaveConfirm(); await settle();
    check(T2.evalTainted === false, "新开档 clears evalTainted");
    T2.track("probe2", {});
    const last = log(w2).filter((e) => e.ev === "probe2")[0];
    check(last && last.eval_tainted === 0 && last.eval === 0, "after 新开档 events carry eval_tainted = 0");
    T2.saveGame(); check(JSON.parse(w2.localStorage.getItem(T2.SAVE_KEY)).evalTainted === false, "…and the save is clean");

    // clean save, normal session: eval_tainted 0 on every event
    const wc = makeWorld(); await settle(); wc.__T.track("a", {}); wc.__T.track("b", { x: 1 });
    check(log(wc).length >= 2 && log(wc).every((e) => e.eval_tainted === 0 && (e.eval_tainted === 0 || e.eval_tainted === 1)), "clean save: eval_tainted = 0 (number 1|0) on every event");
    // format identical to tools/analytics/client-snippet.js
    const snip = fs.readFileSync(path.join(ROOT, "tools/analytics/client-snippet.js"), "utf8");
    check(/eval_tainted:\s*evalTainted \? 1 : 0/.test(snip) && /eval_tainted:\s*evalTainted \? 1 : 0/.test(fs.readFileSync(path.join(ROOT, "game.js"), "utf8")), "game.js uses the exact `eval_tainted: evalTainted ? 1 : 0` of client-snippet.js");

    // ?eval=1 session on the TEST build taints the save; no clawback of cash/sizes
    const wt = makeWorld({ query: "?eval=1", flipEval: true }); await settle(); const TT = wt.__T;
    check(TT.evalMode === true && TT.evalTainted === true, "test build ?eval=1 session: eval on + save tainted");
    wt.__T.track("e", {});
    check(log(wt).every((e) => e.eval === 1 && e.eval_tainted === 1), "eval session events: eval=1 eval_tainted=1");
    await settle(30); TT.saveGame();
    const svt = JSON.parse(wt.localStorage.getItem(TT.SAVE_KEY));
    check(svt.evalTainted === true, "?eval=1 taint is persisted");
    const wn = makeWorld({ save: svt, flipEval: true }); await settle(); // reopened WITHOUT ?eval=1
    check(wn.__T.evalMode === false && wn.__T.evalTainted === true, "reopened without ?eval=1: eval off, still tainted");
    check(Math.round(wn.__T.cash) === Math.round(svt.cash), "no clawback of cash");
  }

  // ---------- 6. PUBLIC build: eval fully off ----------
  {
    const src = fs.readFileSync(path.join(ROOT, "game.js"), "utf8");
    check(/EVAL_ALLOWED:\s*false,/.test(src) && /BUILD_ENV:\s*"public"/.test(src), "root game.js: EVAL_ALLOWED false, BUILD_ENV public");
    const w = makeWorld({ query: "?eval=1&ball=1&soft=1&mono=1", ls: { deltaStashMonoDebug: "1" } }); await settle(); const T = w.__T;
    const d = w.document;
    check(T.FEATURES.EVAL_ALLOWED === false && T.evalMode === false, "public ?eval=1: eval mode off");
    check(!T.evalForceFollowBall && !T.evalSoftChallenge, "public ?ball=1 / ?soft=1: no effect");
    check(!T.monoDebugOn() && !d.getElementById("monoDebug"), "public ?mono=1 / localStorage mono flag: debug lines off, element removed");
    for (const id of ["btnEvalMode", "btnDataPanel", "evalPanel", "dataPanel", "btnEvalExit", "btnEvalCash", "btnEvalForceBall", "btnEvalSoftChallenge", "evalFxSelect"]) check(!d.getElementById(id), `public: #${id} not in the DOM`);
    check(!/评测|数据/.test(d.querySelector(".top-bar").textContent), "public: no 评测 / 数据 text in the header");
    check(![...d.querySelectorAll("button")].some((b) => /^(评测|数据)/.test(b.textContent.trim())), "public: no 评测 / 数据 button anywhere");
    check(!d.body.classList.contains("eval-mode"), "public: body has no eval-mode class");
    T.setEvalMode(true);
    check(T.evalMode === false && !d.body.classList.contains("eval-mode"), "public: setEvalMode(true) cannot turn eval on");
    check(!T.evalTainted, "public ?eval=1 does not taint the save");
    // dropdown locked to owned sizes
    const sel = d.querySelector("#gridSizeSelect");
    check([...sel.options].filter((o) => +o.value > T.ownedGridMax).every((o) => o.disabled), "public: dropdown locks sizes above the owned size even with ?eval=1");
    sel.value = "8"; sel.dispatchEvent(new w.Event("change")); await settle();
    check(T.gridSize === 5, `public ?eval=1: cannot switch to 8×8 for free (grid ${T.gridSize})`);
    // legacy localStorage flag cleaned + taint
    const wl = makeWorld({ ls: { deltaStashEval: "1" } }); await settle();
    check(wl.localStorage.getItem("deltaStashEval") === null && wl.__T.evalMode === false && wl.__T.evalTainted === true, "public: legacy deltaStashEval cleaned, eval off, save tainted");
    // clicking nothing exists; also the key being set later is ignored
    wl.localStorage.setItem("deltaStashEval", "1");
    check(wl.__T.evalMode === false, "public: deltaStashEval written later is ignored");
  }

  // ---------- 6b. TEST build (generated test/) ----------
  {
    const bt = require("../tools/build-test.js");
    const problems = bt.check();
    check(problems.length === 0, "test/ in sync with tools/build-test.js: " + problems.join("; "));
    const TD = path.join(ROOT, "test");
    const tsrc = fs.readFileSync(path.join(TD, "game.js"), "utf8");
    check(/EVAL_ALLOWED:\s*true,/.test(tsrc) && /BUILD_ENV:\s*"test"/.test(tsrc), "test/game.js: EVAL_ALLOWED true, BUILD_ENV test");
    check(JSON.parse(fs.readFileSync(path.join(TD, "version.json"), "utf8")).version === JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version, "test/ and root share the same version");
    check(/\[测试版\]/.test(fs.readFileSync(path.join(TD, "index.html"), "utf8")), "test/index.html title tagged [测试版]");
    // no unprefixed storage keys
    for (const f of ["game.js", "audio.js", "platform.js"]) {
      const s = fs.readFileSync(path.join(TD, f), "utf8");
      const bad = [...s.matchAll(/["'`](deltaStash\w*|auctionHelpSeen)["'`]/g)].map((m) => m[1]);
      check(bad.length === 0, `test/${f}: every storage key is prefixed (unprefixed: ${bad.join(",")})`);
    }
    // without ?eval=1: nothing visible; with it: controls appear
    const P = "test_";
    const w0 = makeWorld({ dir: TD, prefix: P }); await settle();
    check(w0.__T.FEATURES.EVAL_ALLOWED && w0.__T.evalMode === false, "test build without ?eval=1: eval off");
    check(!shown(w0, w0.document.getElementById("btnEvalMode")) && !shown(w0, w0.document.getElementById("btnDataPanel")) && !shown(w0, w0.document.getElementById("evalPanel")), "test build without ?eval=1: no eval controls visible");
    const w1 = makeWorld({ dir: TD, prefix: P, query: "?eval=1" }); await settle();
    check(w1.__T.evalMode === true, "test build ?eval=1: eval on");
    check(shown(w1, w1.document.getElementById("evalPanel")) && shown(w1, w1.document.getElementById("btnDataPanel")) && !w1.document.getElementById("btnEvalMode").hidden, "test build ?eval=1: eval panel + 数据 + 评测 present");
    w1.__T.track("t", {});
    const te = log(w1).filter((e) => e.ev === "t")[0];
    check(te && te.build.endsWith("-test") && te.econ === "test" && te.env === "test" && te.eval === 1 && te.eval_tainted === 1, `test build analytics tagged (${JSON.stringify(te && { b: te.build, e: te.econ, env: te.env })})`);
    w1.__T.saveGame();
    const keys = Object.keys(w1.localStorage).filter((k) => /deltaStash/i.test(k));
    check(keys.length > 0 && keys.every((k) => k.startsWith(P)), `test build writes only test_-prefixed keys (${keys.join(",")})`);
    // public analytics untagged
    const wp = makeWorld(); await settle(); wp.__T.track("p", {});
    const pe = log(wp).filter((e) => e.ev === "p")[0];
    check(pe && pe.build === JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version && pe.econ === "econ-0925h" && !("env" in pe), "public analytics: plain build, econ-0925h, no env tag");
    // the two builds never share storage: a public save is invisible to the test build
    const wpub = makeWorld(); await settle(); wpub.__T.cash = 77777; wpub.__T.saveGame();
    const pubSave = wpub.localStorage.getItem("deltaStashSave");
    const wtest = makeWorld({ dir: TD, prefix: P, ls: { deltaStashSave: pubSave } }); await settle();
    check(wtest.__T.cash === 15000, `test build ignores a public save (cash ${wtest.__T.cash})`);
  }

  console.log(`launch_j: checks: pass=${pass} fail=${fail}`);
  if (fail) { console.log(failures.map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
  console.log("OK");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
