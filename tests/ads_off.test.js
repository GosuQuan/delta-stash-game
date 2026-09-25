#!/usr/bin/env node
/**
 * Ads-off UI test (release 20260925e).
 *
 * With FEATURES.ADS_ENABLED === false (the default local / GitHub Pages build: no portal SDK),
 * ad UI must be HIDDEN — not rendered greyed/disabled and not reserving layout space.
 * Loads index.html + style.css + the REAL game.js in jsdom (same harness idea as
 * crate_milestones.test.js), then: boot → open a crate (real openCrate + reveal) → pack → settle,
 * and after each phase asserts that no *rendered* element contains 广告 / 看广告 text and that every
 * ad placement (data-placement="ad_*", .ad-chip, reveal/warehouse/result/bankrupt ad slots)
 * computes to display:none.
 *
 * Rendering model: jsdom's cascade (specificity + !important, @media ignored) with a UA-style
 * `[hidden]{display:none}` injected first, so an author `display:flex` that beats [hidden]
 * (the old 「下一件看起来不错…看广告立刻开箱？（已关闭）」 leak) is caught.
 * Exempt: #evalPanel (dev-only eval tool, hidden unless ?eval=1) and <script>/<style>/<title>.
 *
 * Run: npm test   (or node tests/ads_off.test.js; GAME_DIR=<dir> to test another build)
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
    if (w.getComputedStyle(n).display === "none") return false;
  }
  return true;
}

function adTextLeaks(w) {
  const out = [];
  const walker = w.document.createTreeWalker(w.document.body, w.NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (/广告/.test(t.nodeValue) && rendered(w, t.parentElement)) {
      const p = t.parentElement;
      out.push(`${p.tagName.toLowerCase()}${p.id ? "#" + p.id : ""}.${p.className || ""} «${t.nodeValue.trim().slice(0, 40)}»`);
    }
  }
  return out;
}

const AD_SELECTORS = '[data-placement^="ad_"]:not(#btnChallengeAdRetry), .ad-chip:not(#btnChallengeAdRetry):not(#btnChallengeIapProtect), #revealAdBar, #warehouseFullOffers, #adCapLine, #resultAdSlot, .bankrupt-ad-slot, #btnAdRevealNext, #btnSkipRevealAd';

function adPlacementLeaks(w) {
  return [...w.document.querySelectorAll(AD_SELECTORS)]
    .filter((n) => rendered(w, n))
    .map((n) => `${n.tagName.toLowerCase()}#${n.id || "?"}.${n.className}`);
}

function phase(w, name) {
  const txt = adTextLeaks(w);
  check(txt.length === 0, `[${name}] visible 广告 text: ${txt.join(" | ")}`);
  const pl = adPlacementLeaks(w);
  check(pl.length === 0, `[${name}] ad placements rendered: ${pl.join(" | ")}`);
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

async function main() {
  let rounds = 0;
  for (const seed of [11, 22, 33]) {
    const w = makeWorld(seed);
    const T = w.__T;
    check(T.FEATURES.ADS_ENABLED === false, `[seed ${seed}] default build has ADS_ENABLED=false`);
    check(w.document.body.classList.contains("ads-off"), `[seed ${seed}] body.ads-off set`);
    await waitFor(() => false, 50);
    phase(w, `seed ${seed} boot`);
    // Help sheet (auto-opens on first visit) must not advertise ads either
    const help = w.document.querySelector("#helpModal");
    if (help) { help.hidden = false; phase(w, `seed ${seed} help open`); help.hidden = true; }
    // Bankrupt modal ad slot must stay hidden too
    const bk = w.document.querySelector("#bankruptModal");
    if (bk) { bk.hidden = false; phase(w, `seed ${seed} bankrupt modal`); bk.hidden = true; }

    for (let round = 0; round < 2; round++) {
      const tag = `seed ${seed} r${round}`;
      T.selectTier("common");
      T.openCrate();
      const ov = w.document.querySelector("#scanOverlay");
      if (ov) ov.dispatchEvent(new w.Event("pointerdown"));
      const ok = await finishReveal(w, () => T.crateOpenedThisRound && !T.revealing);
      check(ok, `[${tag}] reveal finished after item decrypt clicks`);
      check(T.staging.length + T.placed.size > 0, `[${tag}] items delivered`);
      phase(w, `${tag} after open`);
      greedyPack(T);
      phase(w, `${tag} packing`);
      T.extract();
      check(T.extractedThisRound, `[${tag}] settled`);
      await waitFor(() => !T.settleReplayActive, 4000);
      await waitFor(() => false, 50);
      const modal = w.document.querySelector("#resultModal");
      check(modal && rendered(w, modal), `[${tag}] result modal shown`);
      phase(w, `${tag} after settle`);
      const next = w.document.querySelector("#btnResultNext");
      if (next) next.click(); else T.nextRound();
      await waitFor(() => false, 50);
      phase(w, `${tag} next round`);
      rounds++;
    }
  }
  console.log(`ads_off: rounds=${rounds} checks: pass=${pass} fail=${fail}`);
  if (fail) { console.log(failures.slice(0, 40).map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
  console.log("OK");
}
main().catch((e) => { console.error(e); process.exit(2); });
