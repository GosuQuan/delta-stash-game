#!/usr/bin/env node
/**
 * IAP-off UI test (release 20260925g).
 *
 * Free trial / GitHub Pages / local builds have no payment platform → FEATURES.IAP_ENABLED === false.
 * Then NO real-money price may render anywhere ($ / USD / x.99), the 补给 shop button is not rendered,
 * and 一键整理 goes: 今日免费 → 🔑×1 (spends a key) → 「明日免费」 disabled (never a price).
 * Same jsdom harness as ads_off.test.js (real index.html + style.css + game.js).
 *
 * Run: npm test   (or node tests/iap_off.test.js; GAME_DIR=<dir> to test another build)
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
    get keys() { return keys; }, set keys(v) { keys = v; updateKeysUI(); },
    get organizeBusy() { return organizeBusy; },
    organizeFreeRemaining, speedOrganizeAll, updateKeysUI, openShop, tryExpandWarehouse,
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

function makeWorld(seed) {
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
async function finishReveal(w, pred) {
  return waitFor(() => {
    const deck = w.document.querySelector("#revealDeck");
    if (deck && !deck.hidden) w.document.querySelector("#btnDecryptNext")?.click();
    return pred();
  });
}

let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }

function rendered(w, node) {
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    if (n.id === "evalPanel") return false; // dev-only tool
    if (/^(SCRIPT|STYLE|TITLE|TEMPLATE)$/.test(n.tagName)) return false;
    if (n.hidden && !n.style.display) { /* [hidden] handled by computed style below */ }
    if (w.getComputedStyle(n).display === "none") return false;
  }
  return true;
}

const PRICE_RE = /\$\s?\d|USD|\d\.99|内购/;
function priceLeaks(w) {
  const out = [];
  const walker = w.document.createTreeWalker(w.document.body, w.NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (PRICE_RE.test(t.nodeValue) && rendered(w, t.parentElement)) {
      const p = t.parentElement;
      out.push(`${p.tagName.toLowerCase()}${p.id ? "#" + p.id : ""} «${t.nodeValue.trim().slice(0, 50)}»`);
    }
  }
  // titles/tooltips of rendered elements count too
  for (const n of w.document.querySelectorAll("[title]")) {
    if (PRICE_RE.test(n.getAttribute("title")) && rendered(w, n)) out.push(`title@${n.id || n.tagName} «${n.getAttribute("title")}»`);
  }
  return out;
}

function phase(w, name) {
  const p = priceLeaks(w);
  check(p.length === 0, `[${name}] visible real-money price: ${p.join(" | ")}`);
  const shop = w.document.querySelector("#btnShop");
  check(!shop || !rendered(w, shop), `[${name}] 补给 shop button rendered`);
}

function greedyPack(T) {
  const gs = T.gridSize();
  for (const e of T.staging.slice()) {
    let done = false;
    for (let rot = 0; rot < 4 && !done; rot++) for (let r = 0; r < gs && !done; r++) for (let c = 0; c < gs && !done; c++) {
      if (T.canPlace(e.defId, rot, r, c) && T.placeItem({ ...e, rot }, r, c)) {
        T.staging.splice(T.staging.findIndex((s) => s.uid === e.uid), 1); done = true;
      }
    }
  }
}

async function openRound(w, T, tag) {
  T.selectTier("common");
  T.openCrate();
  const ov = w.document.querySelector("#scanOverlay");
  if (ov) ov.dispatchEvent(new w.Event("pointerdown"));
  const ok = await finishReveal(w, () => T.crateOpenedThisRound && !T.revealing);
  check(ok, `[${tag}] reveal finished`);
}

async function main() {
  let rounds = 0;
  for (const seed of [11, 22]) {
    const w = makeWorld(seed);
    const T = w.__T;
    const $ = (s) => w.document.querySelector(s);
    const btn = $("#btnSpeedOrganize");
    check(T.FEATURES.IAP_ENABLED === false, `[seed ${seed}] default build has IAP_ENABLED=false`);
    check(w.document.body.classList.contains("iap-off"), `[seed ${seed}] body.iap-off set`);
    await waitFor(() => false, 50);
    phase(w, `seed ${seed} boot`);
    for (const id of ["#helpModal", "#bankruptModal"]) {
      const m = $(id);
      if (m) { m.hidden = false; phase(w, `seed ${seed} ${id}`); m.hidden = true; }
    }
    // openShop is refused (and the modal is gated off by CSS anyway)
    T.openShop();
    check(!rendered(w, $("#shopModal")), `[seed ${seed}] shop modal refused`);
    phase(w, `seed ${seed} after openShop`);

    // ---- round 0: free organize ----
    await openRound(w, T, `seed ${seed} r0`);
    phase(w, `seed ${seed} r0 open`);
    check(T.organizeFreeRemaining() === 1, `[seed ${seed}] free organize available`);
    check(/今日免费/.test(btn.textContent) && !btn.disabled, `[seed ${seed}] button shows 今日免费 («${btn.textContent}»)`);
    if (T.staging.length) {
      btn.click();
      await waitFor(() => !T.organizeBusy, 4000);
      check(T.organizeFreeRemaining() === 0, `[seed ${seed}] free organize consumed`);
    }
    phase(w, `seed ${seed} r0 after free organize`);

    // ---- keys state ----
    T.keys = 2;
    check(/🔑×1/.test(btn.textContent) && !btn.disabled, `[seed ${seed}] button shows 🔑×1 («${btn.textContent}»)`);
    phase(w, `seed ${seed} keys state`);
    greedyPack(T);
    T.extract();
    await waitFor(() => !T.settleReplayActive, 4000);
    await waitFor(() => false, 50);
    phase(w, `seed ${seed} r0 settle`);
    ($("#btnResultNext") || { click: () => T.nextRound() }).click();
    await waitFor(() => false, 50);
    rounds++;

    // ---- round 1: key organize ----
    await openRound(w, T, `seed ${seed} r1`);
    if (T.staging.length) {
      btn.click();
      await waitFor(() => false, 5);
      const cm = $("#confirmModal");
      check(cm && !cm.hidden, `[seed ${seed}] key confirm shown`);
      phase(w, `seed ${seed} key confirm`);
      $("#btnConfirmOk").click();
      await waitFor(() => !T.organizeBusy, 4000);
      check(T.keys === 1, `[seed ${seed}] one key spent (keys=${T.keys})`);
    }
    // ---- exhausted: no free, no keys ----
    T.keys = 0;
    check(/明日免费/.test(btn.textContent) && btn.disabled, `[seed ${seed}] exhausted → 明日免费 + disabled («${btn.textContent}» disabled=${btn.disabled})`);
    phase(w, `seed ${seed} exhausted`);
    T.speedOrganizeAll(); // programmatic call must not open a price confirm
    await waitFor(() => false, 5);
    check($("#confirmModal").hidden, `[seed ${seed}] exhausted organize opens no confirm`);
    // expand never routes to a price
    T.tryExpandWarehouse();
    await waitFor(() => false, 5);
    phase(w, `seed ${seed} expand`);
    if (!$("#confirmModal").hidden) $("#btnConfirmCancel").click();
    greedyPack(T);
    T.extract();
    await waitFor(() => !T.settleReplayActive, 4000);
    await waitFor(() => false, 50);
    phase(w, `seed ${seed} r1 settle`);
    rounds++;
  }
  console.log(`iap_off: rounds=${rounds} checks: pass=${pass} fail=${fail}`);
  if (fail) { console.log(failures.slice(0, 40).map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
  console.log("OK");
}
main().catch((e) => { console.error(e); process.exit(2); });
