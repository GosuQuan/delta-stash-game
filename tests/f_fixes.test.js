#!/usr/bin/env node
/**
 * Release 20260926f regression tests (plain node + jsdom, real index.html + style.css + game.js):
 *  1. 「↻ 旋转」 button = exactly ONE 90° step per activation, same as keyboard R — for a selected staging item
 *     (tap-to-place), a selected placed item, an item held mid-drag (second pointer presses the button), after a
 *     drag-placement; mouse (pointerdown+pointerup+click), touch (pointerdown+touchstart+touchend+pointerup+click),
 *     and keyboard activation (click only). Four activations return to the original rotation.
 *     (Root cause: the button rotated on pointerdown AND again on the click of the same press.)
 *  2. No "Delta" in user-visible public text (index.html text/attrs/title/meta, DOM text at runtime, version.json,
 *     user-visible string literals in game.js/audio.js/platform.js); welcome modal kicker = 「STASH AUCTION」.
 *     Storage keys / identifiers (deltaStash*, DeltaStashPlatform, DELTA_STASH_PLATFORM, delta vars) are allowed.
 *  3. 「距青铜还差 …」 hint is recomputed from loaded state on load and after every cash change; hidden = no text.
 *  4. Every icon-only button (no visible text besides an icon / empty label) has a Chinese aria-label.
 * Run: npm test  (GAME_DIR=<dir> to test another build, e.g. test/)
 */
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) { console.error("jsdom missing — run `npm install` first."); process.exit(2); }
const DIR = process.env.GAME_DIR || path.join(__dirname, "..");
const BT = require("../tools/build-test.js");

const HOOK = `
  window.__T = {
    ITEM_DEFS, get placed() { return placed; }, get staging() { return staging; }, set staging(v) { staging = v; },
    get selectedUid() { return selectedUid; }, set selectedUid(v) { selectedUid = v; },
    get cash() { return cash; }, set cash(v) { cash = v; }, get peakCash() { return peakCash; }, set peakCash(v) { peakCash = v; },
    drag, el, gridSize: () => gridSize, initGrid, placeItem, removeFromGrid, renderGrid, renderStaging, updateStats,
    syncCashDisplay, saveGame, SAVE_KEY, BUILD_VERSION,
  };
`;

function makeWorld(saveRaw, opts) {
  opts = opts || {};
  const css = fs.readFileSync(path.join(DIR, "style.css"), "utf8");
  let html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  if (opts.evalBuild) html = BT.injectEvalMarkup(html);
  html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, "")
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
  const CELL = 40, GX = 100, GY = 100;
  const rect = (x, y, wd, h) => ({ left: x, top: y, x, y, width: wd, height: h, right: x + wd, bottom: y + h, toJSON() {} });
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains("cell") && this.dataset.r != null) return rect(GX + +this.dataset.c * CELL, GY + +this.dataset.r * CELL, CELL, CELL);
    if (this.id === "stagingArea") return rect(600, 100, 300, 300);
    return rect(0, 0, 0, 0);
  };
  w.Element.prototype.setPointerCapture = function () {};
  w.document.elementFromPoint = (x, y) => {
    if (x >= 600 && x < 900 && y >= 100 && y < 400) return w.document.getElementById("stagingArea");
    const c = Math.floor((x - GX) / CELL), r = Math.floor((y - GY) / CELL);
    return w.document.querySelector(`#warehouseGrid .cell[data-r="${r}"][data-c="${c}"]`) || w.document.body;
  };
  let src = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  if (opts.evalBuild && src.includes("EVAL_ALLOWED: false")) src = BT.injectEvalStrings(src.replace("EVAL_ALLOWED: false", "EVAL_ALLOWED: true"));
  const end = src.lastIndexOf("})();");
  w.eval(src.slice(0, end) + HOOK + src.slice(end));
  w.__CELL = { CELL, GX, GY };
  return w;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 5) { for (let i = 0; i < n; i++) await tick(); }
let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }

function pev(w, type, x, y, target, o) {
  o = o || {};
  const Ctor = w.PointerEvent || w.MouseEvent;
  const e = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  Object.defineProperty(e, "pointerType", { value: o.type || "mouse", configurable: true });
  Object.defineProperty(e, "pointerId", { value: o.id || 1, configurable: true });
  (target || w).dispatchEvent(e);
  return e;
}
const click = (w, n) => n.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
const touchEv = (w, type, n) => n.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
function cellCenter(w, r, c) { const { CELL, GX, GY } = w.__CELL; return [GX + (c + 0.5) * CELL, GY + (r + 0.5) * CELL]; }

/** one physical press of the on-screen button, as a given device would deliver it */
function pressRotate(w, kind, ptrId, at) {
  at = at || [0, 0];
  const b = w.document.getElementById("btnRotate");
  const id = ptrId || 7;
  if (kind === "mouse") {
    pev(w, "pointerdown", 0, 0, b, { id, type: "mouse" }); pev(w, "pointerup", at[0], at[1], b, { id, type: "mouse" }); click(w, b);
  } else if (kind === "touch") {
    // real phone order: pointerdown, touchstart, pointerup, touchend, (synthesized) click
    pev(w, "pointerdown", 0, 0, b, { id, type: "touch" }); touchEv(w, "touchstart", b);
    pev(w, "pointerup", at[0], at[1], b, { id, type: "touch" }); touchEv(w, "touchend", b); click(w, b);
  } else if (kind === "keyboard") {
    b.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); click(w, b); // Enter/Space on focused button = click only
  }
}
const pressKeyR = (w) => w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true }));

function itemRot(T, uid) {
  const p = T.placed.get(uid); if (p) return p.rot;
  const s = T.staging.find((x) => x.uid === uid); return s ? s.rot : null;
}
function resetBoard(T) {
  T.initGrid(5);
  for (const uid of [...T.placed.keys()]) T.removeFromGrid(uid);
  T.staging = []; T.selectedUid = null; T.renderGrid(); T.renderStaging();
}
function stage(T, w, def) {
  const e = { uid: "f_" + def.id, defId: def.id, rot: 0, valueOverride: def.value };
  T.staging = [e]; T.renderStaging(); return e;
}
function tapCard(w, uid) {
  const card = w.document.querySelector(`#stagingArea .item-card[data-uid="${uid}"]`);
  pev(w, "pointerdown", 700, 200, card, { id: 1, type: "touch" }); pev(w, "pointerup", 700, 200, card, { id: 1, type: "touch" });
  return card;
}

async function rotateTests() {
  const w = makeWorld(); const T = w.__T; await settle(20);
  const def = T.ITEM_DEFS.find((d) => d.shape === "1x2");
  check(!!def, "a 1x2 item exists for the rotate tests");

  for (const kind of ["mouse", "touch", "keyboard"]) {
    // --- A. staging item selected (phone: tap card → tap 旋转) ---
    resetBoard(T); const e = stage(T, w, def); tapCard(w, e.uid);
    check(T.selectedUid === e.uid, `${kind}/A: item selected after tap`);
    for (let i = 1; i <= 4; i++) {
      pressRotate(w, kind);
      check(itemRot(T, e.uid) === i % 4, `${kind}/A staging: activation ${i} → rot ${i % 4} (got ${itemRot(T, e.uid)})`);
    }
    // keyboard R is the reference: same step
    const before = itemRot(T, e.uid); pressKeyR(w);
    check(itemRot(T, e.uid) === (before + 1) % 4, `${kind}/A: keyboard R steps +1 as well`);
    pressKeyR(w); pressKeyR(w); pressKeyR(w);

    // --- B. placed item selected in the warehouse ---
    resetBoard(T); const ge = { uid: "f_grid", defId: def.id, rot: 0, valueOverride: def.value };
    T.placeItem(ge, 1, 1); T.renderGrid();
    const badge = w.document.querySelector(`#warehouseGrid .cell-item[data-uid="f_grid"]`);
    check(!!badge, `${kind}/B: placed badge rendered`);
    if (badge) { pev(w, "pointerdown", 150, 150, badge, { id: 1 }); pev(w, "pointerup", 150, 150, badge, { id: 1 }); }
    check(T.selectedUid === "f_grid", `${kind}/B: placed item selected`);
    const seen = [];
    for (let i = 0; i < 4; i++) { pressRotate(w, kind); seen.push(itemRot(T, "f_grid")); }
    check(JSON.stringify(seen) === "[1,2,3,0]", `${kind}/B placed: 4 activations → 1,2,3,0 (got ${seen})`);
    pressKeyR(w);
    check(itemRot(T, "f_grid") === 1, `${kind}/B: keyboard R after button = +1`);

    // --- C. after drag-placement: drag the staging card onto the grid, then rotate the just-placed item ---
    resetBoard(T); const ce = stage(T, w, def);
    const card = w.document.querySelector(`#stagingArea .item-card[data-uid="${ce.uid}"]`);
    const [tx, ty] = cellCenter(w, 1, 1);
    pev(w, "pointerdown", 700, 200, card, { id: 1, type: kind === "touch" ? "touch" : "mouse" });
    pev(w, "pointermove", 690, 210, null, { id: 1, type: kind === "touch" ? "touch" : "mouse" });
    pev(w, "pointermove", 600, 250, null, { id: 1, type: kind === "touch" ? "touch" : "mouse" });
    pev(w, "pointermove", tx, ty, null, { id: 1, type: kind === "touch" ? "touch" : "mouse" });
    pev(w, "pointerup", tx, ty, null, { id: 1, type: kind === "touch" ? "touch" : "mouse" });
    await settle(2);
    check(T.placed.has(ce.uid), `${kind}/C: drag-placement placed the item`);
    if (T.selectedUid !== ce.uid) T.selectedUid = ce.uid; // selection after drop is not what is under test
    const r0 = itemRot(T, ce.uid);
    pressRotate(w, kind);
    check(itemRot(T, ce.uid) === (r0 + 1) % 4, `${kind}/C after drag-placement: one activation = +1 (${r0}→${itemRot(T, ce.uid)})`);
    for (let i = 0; i < 3; i++) pressRotate(w, kind);
    check(itemRot(T, ce.uid) === r0, `${kind}/C: four activations return to ${r0} (got ${itemRot(T, ce.uid)})`);
  }

  // --- D. item HELD mid-drag, second pointer (finger) presses 旋转; the same press's pointerup ends the drag, then click arrives ---
  for (const kind of ["touch", "mouse"]) {
    resetBoard(T); const de = stage(T, w, def);
    const card = w.document.querySelector(`#stagingArea .item-card[data-uid="${de.uid}"]`);
    const ty = kind === "touch" ? "touch" : "mouse";
    pev(w, "pointerdown", 700, 200, card, { id: 1, type: ty });
    pev(w, "pointermove", 640, 260, null, { id: 1, type: ty });
    pev(w, "pointermove", 600, 300, null, { id: 1, type: ty });
    check(T.drag.active, `${kind}/D: drag is active`);
    const r0 = T.drag.rot;
    pressRotate(w, kind, 2, cellCenter(w, 1, 1)); // 2nd pointer's release over the grid drops the held item there
    // the press ended the drag (pointerup on window) — the click must NOT have rotated a second time
    const item = T.placed.get(de.uid) || T.staging.find((s) => s.uid === de.uid);
    check(!!item && T.placed.has(de.uid) && (itemRot(T, de.uid) === (r0 + 1) % 4), `${kind}/D held item: one press = +1 quarter turn, not 180° (rot ${r0}→${itemRot(T, de.uid)})`);
  }
  // held item: only pointerdown fires while still holding (no click yet) → exactly +1, and a later unrelated click still +1
  {
    resetBoard(T); const de = stage(T, w, def);
    const card = w.document.querySelector(`#stagingArea .item-card[data-uid="${de.uid}"]`);
    pev(w, "pointerdown", 700, 200, card, { id: 1, type: "touch" }); pev(w, "pointermove", 640, 260, null, { id: 1, type: "touch" }); pev(w, "pointermove", 600, 300, null, { id: 1, type: "touch" });
    const r0 = T.drag.rot; const b = w.document.getElementById("btnRotate");
    pev(w, "pointerdown", 0, 0, b, { id: 2, type: "touch" });
    check(T.drag.rot === (r0 + 1) % 4, `touch/D: pointerdown while holding rotates +1 immediately (${r0}→${T.drag.rot})`);
    pev(w, "pointerup", 600, 300, null, { id: 1, type: "touch" }); await settle(2);
  }
  // a swallowed click must not leak into a later keyboard activation
  {
    resetBoard(T); const ke = stage(T, w, def); tapCard(w, ke.uid);
    const b = w.document.getElementById("btnRotate");
    pev(w, "pointerdown", 0, 0, b, { id: 3, type: "touch" }); // selected only → no rotate on press
    check(itemRot(T, ke.uid) === 0, "pointerdown alone (selected, not held) does not rotate");
    pev(w, "pointerup", 0, 0, b, { id: 3, type: "touch" }); click(w, b);
    check(itemRot(T, ke.uid) === 1, "…the click does (+1)");
  }

}

// ---------------- 2. no "Delta" in user-visible public text ----------------
function stripNonVisible(js) {
  // drop comments + the identifier/storage-key forms that must stay for save compatibility
  return js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
    .replace(/["'`]deltaStash[A-Za-z0-9_]*["'`]/g, '""')
    .replace(/\bDELTA_STASH_PLATFORM\b|\bDeltaStashPlatform\b|\bdeltaStash\w*/g, "")
    .replace(/https?:\/\/[^\s"'`)]*/g, "")
    .replace(/[A-Za-z_$][\w$]*[Dd]elta[\w$]*|\bdelta\b/g, ""); // code identifiers: cashDelta, spawnCashDeltaLabel, delta, cash-delta css class…
}
async function deltaTests() {
  const files = ["index.html", "game.js", "style.css", "audio.js", "platform.js", "version.json"];
  const manifest = fs.readdirSync(DIR).filter((f) => /manifest|\.webmanifest$/i.test(f));
  for (const f of [...files, ...manifest]) {
    const raw = fs.readFileSync(path.join(DIR, f), "utf8");
    let vis = raw;
    if (f === "index.html") {
      vis = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    } else if (f.endsWith(".js")) vis = stripNonVisible(raw);
    else if (f.endsWith(".css")) vis = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/[\w-]*[Dd]elta[\w-]*/g, ""); // class names / keyframes
    check(!/delta|三角洲/i.test(vis), `${f}: no "Delta" / 三角洲 in user-visible text${/delta|三角洲/i.test(vis) ? " → " + (vis.match(/.{0,30}(delta|三角洲).{0,30}/i) || [""])[0] : ""}`);
  }
  // runtime DOM text + attributes (public + eval build)
  for (const evalBuild of [false, true]) {
    const w = makeWorld(null, { evalBuild }); await settle(20);
    const d = w.document;
    const texts = [d.title, ...[...d.querySelectorAll("meta")].map((m) => m.getAttribute("content") || ""), d.body.textContent];
    for (const el of d.querySelectorAll("[title],[aria-label],[placeholder],[alt]")) for (const a of ["title", "aria-label", "placeholder", "alt"]) texts.push(el.getAttribute(a) || "");
    const hit = texts.find((t) => /delta|三角洲/i.test(t));
    check(!hit, `${evalBuild ? "eval" : "public"} DOM: no Delta in text/title/meta/attrs${hit ? " → " + (hit.match(/.{0,25}(delta|三角洲).{0,25}/i) || [""])[0].replace(/\s+/g, " ") : ""}`);
    const k = d.querySelector(".onboarding-kicker");
    check(k && k.textContent.trim() === "STASH AUCTION", `${evalBuild ? "eval" : "public"}: welcome modal kicker is 「STASH AUCTION」 (got ${k && k.textContent})`);

  }
  check(/"version"\s*:\s*"\d{8}[a-z]"/.test(fs.readFileSync(path.join(DIR, "version.json"), "utf8")), "version.json parses as a release id");
  // storage keys stay put (save compatibility)
  const g = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  check(/SAVE_KEY = "(test_)?deltaStashSave"/.test(g), "SAVE_KEY unchanged (save compatibility)");
}

// ---------------- 3. hall hint ----------------
async function hintTests() {
  const hintOf = (w) => { const h = w.document.getElementById("hallUnlockHint"); return { hidden: h.hidden, text: h.textContent }; };
  const mkSave = async (cash, peak) => {
    const a = makeWorld(); await settle(20); a.__T.cash = cash; a.__T.peakCash = peak; a.__T.saveGame();
    const raw = a.localStorage.getItem(a.__T.SAVE_KEY); return raw;
  };
  // cash 30000 / peak 30000 → 距青铜还差 ¥10,000 right after load
  let w = makeWorld(await mkSave(30000, 30000)); await settle(20);
  let h = hintOf(w);
  check(!h.hidden && h.text === "距青铜还差 ¥10,000", `load: hint shows 距青铜还差 ¥10,000 (got ${h.hidden ? "hidden" : h.text})`);
  // cash change without any other refresh path: syncCashDisplay alone, then updateStats
  w.__T.cash = 38000; w.__T.syncCashDisplay();
  h = hintOf(w); check(!h.hidden && h.text === "距青铜还差 ¥2,000", `cash→38000 (syncCashDisplay): hint ¥2,000 (got ${h.text})`);
  w.__T.cash = 39500; w.__T.updateStats(); h = hintOf(w);
  check(!h.hidden && h.text === "距青铜还差 ¥500", `cash→39500 (updateStats): hint ¥500 (got ${h.text})`);
  w.__T.cash = 41000; w.__T.updateStats(); h = hintOf(w);
  check(h.hidden && h.text === "", `cash→41000 (bronze unlocked): hint hidden and empty (got ${h.hidden}/${h.text})`);

  // peak ≫ cash: hint follows peak, not stale; hidden state carries no leftover text
  w = makeWorld(await mkSave(100000, 100000)); await settle(20); h = hintOf(w);
  check(h.hidden && h.text === "", `load past bronze: hint hidden, no stale text (got ${h.hidden}/"${h.text}")`);

  w = makeWorld(await mkSave(4000, 4000)); await settle(20); h = hintOf(w);
  check(h.hidden && h.text === "", `load far from bronze (¥4,000): hidden, empty (got ${h.hidden}/"${h.text}")`);
  w.__T.cash = 6000; w.__T.syncCashDisplay(); h = hintOf(w);
  check(!h.hidden && h.text === "距青铜还差 ¥34,000", `cash 4000→6000 shows ¥34,000 (got ${h.hidden ? "hidden" : h.text})`);

  w = makeWorld(await mkSave(30000, 36000)); await settle(20); h = hintOf(w);
  check(!h.hidden && h.text === "距青铜还差 ¥4,000", `peak 36000 > cash 30000: hint uses peak (got ${h.text})`);

}

// ---------------- 4. aria-labels ----------------
async function ariaTests() {
  for (const evalBuild of [false, true]) {
    const w = makeWorld(null, { evalBuild }); await settle(20); const d = w.document;
    const tag = evalBuild ? "eval" : "public";
    const iconOnly = [...d.querySelectorAll("button")].filter((b) => {
      if (b.classList.contains("eval-only")) return false; // eval markup lives in tools/test-only (test build only, behaviour untouched)
      const clone = b.cloneNode(true);
      clone.querySelectorAll("svg,[aria-hidden='true']").forEach((n) => n.remove());
      clone.querySelectorAll(".hdr-label").forEach((n) => n.remove()); // phone CSS hides these → icon-only there
      return !clone.textContent.replace(/[\s↻⬆⚡▶🔑]/gu, "").length;
    });
    check(iconOnly.length >= 6, `${tag}: found icon-only buttons (${iconOnly.map((b) => b.id || b.className).join(",")})`);
    for (const b of iconOnly) {
      const al = (b.getAttribute("aria-label") || "").trim();
      check(/[\u4e00-\u9fff]/.test(al), `${tag}: #${b.id || b.className} has a Chinese aria-label (got "${al}")`);
    }
    const want = { btnCodex: "贵货图鉴", btnShop: "补给商店", btnRotate: "旋转", btnHelp: "帮助", btnMute: "音效", btnMore: "更多" };
    for (const [id, t] of Object.entries(want)) {
      const b = d.getElementById(id);
      check(b && b.getAttribute("aria-label") === t, `${tag}: #${id} aria-label = ${t} (got ${b && b.getAttribute("aria-label")})`);
      if (b && ["btnCodex", "btnShop", "btnRotate", "btnMore"].includes(id)) check(b.getAttribute("title") === t, `${tag}: #${id} title == aria-label`);
    }
    const fx = d.getElementById("btnFxMode");
    check(/^结算特效：流畅$/.test(fx.getAttribute("aria-label")), `${tag}: #btnFxMode aria-label tracks 流畅/华丽 (got ${fx.getAttribute("aria-label")})`);
    // every button in the whole page (static + created later) has an accessible name
    const nameless = [...d.querySelectorAll("button")].filter((b) => !(b.getAttribute("aria-label") || b.textContent.replace(/\s/g, "") || b.getAttribute("title")));
    check(nameless.length === 0, `${tag}: no button without an accessible name (${nameless.map((b) => b.id || b.className).join(",")})`);

  }
}

(async () => {
  await rotateTests();
  await deltaTests();
  await hintTests();
  await ariaTests();
  console.log(`f_fixes: ${pass} checks passed, ${fail} failed`);
  if (fail) { console.log(failures.slice(0, 60).map((f) => " ✗ " + f).join("\n")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
