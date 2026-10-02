#!/usr/bin/env node
/**
 * Header toolbar + 「⋯」 overflow menu (release 20260925k).
 *
 * Phone header must be ONE row of same-size SVG icon buttons (图鉴 / 流畅 / 音效 / 帮助 / ⋯);
 * 新开档 / 清档 live in #moreMenu (still behind their confirm); 评测 + 数据 exist only with ?eval=1.
 * Wrapping itself is verified with Playwright screenshots (docs/playtest-shots/layout-k); here we
 * pin the structure + behaviour in jsdom with the real index.html + style.css + game.js.
 *
 * Run: npm test   (or node tests/header_menu.test.js; GAME_DIR=<dir> to test another build)
 */
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) {
  console.error("jsdom missing — run `npm install` (devDependency) first."); process.exit(2);
}
const BT = require("../tools/build-test.js"); // injectEvalMarkup / injectEvalStrings: eval markup + strings exist only in the test build
const DIR = process.env.GAME_DIR || path.join(__dirname, "..");

function makeWorld(query, testBuild) {
  const css = fs.readFileSync(path.join(DIR, "style.css"), "utf8");
  const html = (testBuild ? BT.injectEvalMarkup : (x) => x)(fs.readFileSync(path.join(DIR, "index.html"), "utf8"))
    .replace(/<script[^>]*src=[^>]*><\/script>/g, "")
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/, `<style>[hidden]{display:none}</style><style>${css}</style>`);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" + (query || "") });
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
  w.__confirms = [];
  w.confirm = (msg) => { w.__confirms.push(String(msg)); return false; };
  // ?eval=1 only does anything in the test build → flip the build flag for those worlds (public: see launch_j.test.js)
  let gsrc = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  if (testBuild) gsrc = BT.injectEvalStrings(gsrc.replace("EVAL_ALLOWED: false", "EVAL_ALLOWED: true"));
  w.eval(gsrc);
  return w;
}

let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }
const shown = (w, n) => { for (let x = n; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === "none") return false; return true; };
const click = (w, n) => n.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  // ---- normal player ----
  const w = makeWorld("");
  await tick(); await tick();
  const $ = (s) => w.document.querySelector(s);
  const menu = $("#moreMenu"), more = $("#btnMore");
  check(!!menu && !!more, "#moreMenu / #btnMore exist");
  check(menu.hidden && !shown(w, menu), "menu closed at boot");
  check(menu.contains($("#btnNewSave")), "新开档 is inside the ⋯ menu");
  check(menu.contains($("#btnEvalClear")), "清档 is inside the ⋯ menu");
  check(!$("#btnEvalMode") && !$("#btnDataPanel") && !$("#evalPanel") && !$("#dataPanel"), "public build: 评测 / 数据 / eval panel are not in the DOM at all (not even in ⋯)");
  const bar = $(".header-actions");
  const barIds = [...bar.querySelectorAll(".hdr-btn")].filter((b) => !menu.contains(b) && shown(w, b)).map((b) => b.id);
  check(JSON.stringify(barIds) === JSON.stringify(["btnCodex", "btnFxMode", "btnMute", "btnHelp", "btnMore"]),
    `normal toolbar = 图鉴/流畅/音效/帮助/⋯, got ${barIds.join(",")}`);
  for (const b of bar.querySelectorAll(".hdr-btn, .more-item")) {
    check(!!b.querySelector("svg.hdr-ic"), `#${b.id} has an inline SVG line icon`);
    check(!/[\u{1F300}-\u{1FAFF}\u2753]/u.test(b.textContent), `#${b.id} has no emoji text`);
  }
  check(![...w.document.querySelectorAll("button")].some((b) => /评测|数据/.test(b.textContent)), "public build: no 评测 / 数据 button text anywhere");
  check(!/(^|\s)(btn|ghost)(\s|$)/.test($("#btnNewSave").className), "menu items are not bar-style .btn boxes");
  check($("#btnNewSave").classList.contains("danger") && $("#btnEvalClear").classList.contains("danger"), "destructive items styled .danger");

  click(w, more);
  check(!menu.hidden && shown(w, menu), "⋯ opens the menu");
  check(more.getAttribute("aria-expanded") === "true", "aria-expanded=true when open");
  check(shown(w, $("#btnNewSave")) && shown(w, $("#btnEvalClear")), "新开档 + 清档 visible in the open menu");
  w.document.body.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  check(menu.hidden && more.getAttribute("aria-expanded") === "false", "outside tap closes the menu");
  click(w, more);
  $("#btnNewSave").dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  check(!menu.hidden, "pointerdown inside the menu keeps it open");
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check(menu.hidden, "Esc closes the menu");

  click(w, more); click(w, $("#btnNewSave"));
  check(w.__confirms.length === 1 && /新开档/.test(w.__confirms[0]), "新开档 still goes through its confirm");
  check(menu.hidden, "picking an item closes the menu");
  click(w, more); click(w, $("#btnEvalClear"));
  check(w.__confirms.length === 2, "清档 still goes through its confirm");

  click(w, $("#btnMute"));
  const muted = $("#btnMute").classList.contains("is-muted");
  check($("#btnMute .mute-label").textContent === (muted ? "静音" : "音效"), "mute label mirrors state");
  check(!!$("#btnMute svg.hdr-ic"), "mute keeps its SVG icon after toggling (no emoji swap)");
  click(w, $("#btnFxMode"));
  check($("#fxModeLabel").textContent === "华丽", "流畅 → 华丽 toggle still works");

  // ---- test build without ?eval=1: eval controls exist but stay hidden ----
  const t0 = makeWorld("", true);
  await tick(); await tick();
  const tq = (s) => t0.document.querySelector(s);
  check(!!tq("#btnEvalMode") && !!tq("#btnDataPanel") && !shown(t0, tq("#btnEvalMode")) && !shown(t0, tq("#btnDataPanel")) && !shown(t0, tq("#evalPanel")), "test build without ?eval=1: 评测 / 数据 / panel hidden");
  // ---- eval (?eval=1) — test build only ----
  const e = makeWorld("?eval=1", true);
  await tick(); await tick();
  const q = (s) => e.document.querySelector(s);
  check(shown(e, q("#btnDataPanel")), "数据 visible in eval mode");
  check(!q("#btnEvalMode").hidden, "评测 present (in ⋯) in eval mode");
  const panelWas = q("#evalPanel").hidden;
  click(e, q("#btnMore")); click(e, q("#btnEvalMode"));
  check(q("#evalPanel").hidden !== panelWas, "评测 item toggles the eval panel");
  check(q("#moreMenu").hidden, "menu closes after 评测");
  click(e, q("#btnDataPanel"));
  check(!q("#dataPanel").hidden, "数据 opens the data panel");

  console.log(`header_menu: checks: pass=${pass} fail=${fail}`);
  if (fail) { for (const f of failures) console.log("  FAIL " + f); process.exit(1); }
  console.log("OK");
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
