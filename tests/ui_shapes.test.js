#!/usr/bin/env node
/**
 * Shape / drag UI regression test (release 20260925j). Plain node + jsdom (same harness as
 * expand_cost / analytics: real index.html + style.css + game.js with a test hook).
 *
 *  1. For EVERY item definition × rotation 0–3: the card mini-grid cells == the drag-ghost cells ==
 *     the landing-highlight cells == the cells placeItem() occupies == SHAPES rotated independently
 *     here; the ghost icon sits on an occupied cell. style.css never turns .mini-shape into flex.
 *  2. Bug 1 (icon + drag handle were drawn on the bounding-box top-left, which is EMPTY for J/S/plus/
 *     cross and many rotations): every item × rotation placed in the grid renders exactly one icon on
 *     one of its own cells, every cell is a grab handle, and a real pointer drag (pointerdown on the
 *     icon → pointermove → pointerup over 暂存) takes it out again, then a drag from the card puts it
 *     back with its icon; item count and value never change. Also after save → reload.
 *  3. Settlement: pre-settle self-check fires track("ui_anomaly") with item/shape/rotated/vw_px when an
 *     icon is missing, re-renders (self-heal), and the settled cash equals a control run without the
 *     glitch. A grid item mid-drag is still in the save and still counted if settle happens.
 * Layout is stubbed (jsdom has none): cells are 40px squares at (100,100), 暂存 is at x 600–900.
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
    ITEM_DEFS, SHAPES, get placed() { return placed; }, get staging() { return staging; }, set staging(v) { staging = v; },
    get grid() { return grid; }, gridSize: () => gridSize, drag, el,
    get cash() { return cash; }, set cash(v) { cash = v; },
    set crateOpenedThisRound(v) { crateOpenedThisRound = v; }, get extractedThisRound() { return extractedThisRound; },
    set paidFeeThisRound(v) { paidFeeThisRound = v; },
    shapeFootprint: typeof shapeFootprint === "function" ? shapeFootprint : null,
    cellsFor, canPlace, placeItem, removeFromGrid, renderGrid, renderStaging, createItemCard, showGhost, hideGhost,
    highlightAt, clearHighlights, initGrid, extract, saveGame, itemValue, stashValue, SAVE_KEY,
    checkGridIntegrity: typeof checkGridIntegrity === "function" ? checkGridIntegrity : null,
  };
`;

function makeWorld(saveRaw) {
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
  // ---- minimal layout: 40px cells at (100,100); 暂存 box at x 600–900, y 100–400 ----
  const CELL = 40, GX = 100, GY = 100;
  const rect = (x, y, wd, h) => ({ left: x, top: y, x, y, width: wd, height: h, right: x + wd, bottom: y + h, toJSON() {} });
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains("cell") && this.dataset.r != null) {
      return rect(GX + +this.dataset.c * CELL, GY + +this.dataset.r * CELL, CELL, CELL);
    }
    if (this.id === "stagingArea") return rect(600, 100, 300, 300);
    return rect(0, 0, 0, 0);
  };
  w.Element.prototype.setPointerCapture = function () {};
  w.document.elementFromPoint = (x, y) => {
    if (x >= 600 && x < 900 && y >= 100 && y < 400) return w.document.getElementById("stagingArea");
    const c = Math.floor((x - GX) / CELL), r = Math.floor((y - GY) / CELL);
    return w.document.querySelector(`#warehouseGrid .cell[data-r="${r}"][data-c="${c}"]`) || w.document.body;
  };
  const src = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  const end = src.lastIndexOf("})();");
  if (end < 0) throw new Error("game.js IIFE close not found");
  w.eval(src.slice(0, end) + HOOK + src.slice(end));
  if (!w.__T) throw new Error("test hook not installed");
  w.__CELL = { CELL, GX, GY };
  return w;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 5) { for (let i = 0; i < n; i++) await tick(); }
let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }

// independent rotation (not the game's function) — the spec the UI must match
function rot90(cells, times) {
  let c = cells.map(([r, k]) => [r, k]);
  for (let i = 0; i < times % 4; i++) {
    c = c.map(([r, k]) => [k, -r]);
    const mr = Math.min(...c.map((x) => x[0])), mc = Math.min(...c.map((x) => x[1]));
    c = c.map(([r, k]) => [r - mr, k - mc]);
  }
  return c;
}
const K = (cells) => cells.map(([r, c]) => `${r},${c}`).sort().join(" ");

function pev(w, type, x, y, target) {
  const Ctor = w.PointerEvent || w.MouseEvent;
  const e = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  if (!("pointerType" in e) || !e.pointerType) Object.defineProperty(e, "pointerType", { value: "mouse" });
  if (e.pointerId == null || e.pointerId === 0) Object.defineProperty(e, "pointerId", { value: 1 });
  (target || w).dispatchEvent(e);
}
function cellCenter(w, r, c) { const { CELL, GX, GY } = w.__CELL; return [GX + (c + 0.5) * CELL, GY + (r + 0.5) * CELL]; }
function resetBoard(T, size) {
  if (T.gridSize() !== size) T.initGrid(size);
  for (const uid of [...T.placed.keys()]) T.removeFromGrid(uid);
  T.staging = [];
  T.renderGrid(); T.renderStaging();
}
function iconBadges(w, uid) {
  return [...w.document.querySelectorAll(`#warehouseGrid .cell-item[data-uid="${uid}"]`)].filter((b) => b.textContent.trim());
}

async function main() {
  const css = fs.readFileSync(path.join(DIR, "style.css"), "utf8");
  // CSS: no rule may lay the mini-grid out as anything but a grid
  const bad = [...css.matchAll(/([^{}]*mini-shape[^{}]*)\{([^}]*)\}/g)].filter((m) => /display\s*:\s*(?!grid)[a-z-]+/.test(m[2]) && !/span/.test(m[1]));
  check(bad.length === 0, `style.css .mini-shape display must be grid: ${bad.map((m) => m[1].trim() + "{" + m[2].trim() + "}").join(" | ")}`);

  const w = makeWorld();
  const T = w.__T;
  await settle(20);
  check(typeof T.shapeFootprint === "function", "shapeFootprint() is the shared shape source");
  check(typeof T.checkGridIntegrity === "function", "checkGridIntegrity() exists");
  const defs = T.ITEM_DEFS;
  check(defs.length >= 100, `item defs loaded (${defs.length})`);
  const shapeKeys = new Set();
  let cases = 0;
  resetBoard(T, 5);

  // ---------- 1. card mini-grid == ghost == highlight == placement (every def × rotation) ----------
  for (const def of defs) {
    check(!!T.SHAPES[def.shape], `${def.id}: shape ${def.shape} defined`);
    shapeKeys.add(def.shape);
    for (let rot = 0; rot < 4; rot++) {
      cases++;
      const tag = `${def.id}(${def.shape})@${rot * 90}°`;
      const exp = K(rot90(T.SHAPES[def.shape], rot));
      const entry = { uid: "u" + def.id, defId: def.id, rot, valueOverride: def.value };
      // card mini-grid (rows × cols grid of spans, hidden ones are blanks)
      const card = T.createItemCard(entry);
      const mini = card.querySelector(".mini-shape");
      const cols = +mini.dataset.cols || +(mini.getAttribute("style").match(/repeat\((\d+)/) || [])[1];
      const miniCells = [...mini.children].map((s, i) => [Math.floor(i / cols), i % cols, s]).filter(([, , s]) => !/visibility:\s*hidden/.test(s.getAttribute("style") || "")).map(([r, c]) => [r, c]);
      check(K(miniCells) === exp, `${tag}: card mini-grid ${K(miniCells)} ≠ ${exp}`);
      check(/display:\s*grid/.test(mini.getAttribute("style")), `${tag}: mini-grid inline display:grid`);
      // drag ghost
      T.staging = [entry];
      Object.assign(T.drag, { active: true, from: "staging", uid: entry.uid, rot, touch: false, grab: { dr: 0, dc: 0 }, lastCell: null });
      T.showGhost(def.id, rot, 0, 0, true, null);
      const g = T.el.dragGhost;
      const gcols = +(g.style.gridTemplateColumns.match(/repeat\((\d+)/) || [])[1];
      const gk = [...g.children].map((k, i) => [Math.floor(i / gcols), i % gcols, k]).filter(([, , k]) => k.style.visibility !== "hidden");
      check(K(gk.map(([r, c]) => [r, c])) === exp, `${tag}: ghost ${K(gk.map(([r, c]) => [r, c]))} ≠ ${exp}`);
      check(gk.some(([, , k]) => k.textContent.trim() === def.icon), `${tag}: ghost icon on an occupied cell`);
      // landing highlight
      T.highlightAt(0, 0);
      const hl = [...w.document.querySelectorAll("#warehouseGrid .cell.hl-ok, #warehouseGrid .cell.hl-bad")].map((c) => [+c.dataset.r, +c.dataset.c]);
      check(K(hl) === exp, `${tag}: highlight ${K(hl)} ≠ ${exp}`);
      T.clearHighlights(); T.hideGhost();
      Object.assign(T.drag, { active: false, from: null, uid: null, lastCell: null });
      // placement
      check(T.placeItem(entry, 0, 0), `${tag}: fits an empty 5×5 at (0,0)`);
      const p = T.placed.get(entry.uid);
      check(p && K(p.cells.map(({ r, c }) => [r, c])) === exp, `${tag}: placed cells ≠ ${exp}`);
      // ---------- 2a. rendered icon + handles ----------
      T.renderGrid();
      const icons = iconBadges(w, entry.uid);
      const occ = new Set(p.cells.map(({ r, c }) => `${r},${c}`));
      check(icons.length === 1 && icons[0].textContent.trim() === def.icon, `${tag}: exactly one icon rendered (got ${icons.length})`);
      check(icons.length === 1 && occ.has(`${icons[0].closest(".cell").dataset.r},${icons[0].closest(".cell").dataset.c}`), `${tag}: icon on one of the item's own cells`);
      const handles = w.document.querySelectorAll(`#warehouseGrid .cell-item.grab[data-uid="${entry.uid}"]`).length;
      check(handles === occ.size, `${tag}: every occupied cell is a grab handle (${handles}/${occ.size})`);
      check(T.checkGridIntegrity() === 0, `${tag}: integrity check clean`);
      // ---------- 2b. real pointer drag: grid → 暂存 → grid ----------
      const val0 = T.stashValue() + T.staging.filter((s) => s.uid !== entry.uid).reduce((a, s) => a + T.itemValue(s), 0);
      T.staging = [];
      const b = icons[0], bc = b.closest(".cell");
      const [sx, sy] = cellCenter(w, +bc.dataset.r, +bc.dataset.c);
      pev(w, "pointerdown", sx, sy, b);
      pev(w, "pointermove", sx + 60, sy + 5);
      pev(w, "pointermove", 750, 250);
      pev(w, "pointerup", 750, 250);
      await settle(2);
      check(!T.placed.has(entry.uid) && T.staging.length === 1 && T.staging[0].uid === entry.uid, `${tag}: dragged out of the grid into 暂存 (placed=${T.placed.has(entry.uid)} staging=${T.staging.length})`);
      check(T.staging[0] && T.staging[0].rot === rot && T.itemValue(T.staging[0]) === val0, `${tag}: rotation + value kept after drag out`);
      const card2 = w.document.querySelector(`#stagingArea .item-card[data-uid="${entry.uid}"]`);
      check(!!card2, `${tag}: card back in 暂存`);
      if (card2) {
        // drag the card back: the cursor holds the shape's icon cell → aim so origin lands at (0,0)
        const a = T.shapeFootprint(def.shape, rot).anchor;
        const [tx, ty] = cellCenter(w, a[0], a[1]);
        pev(w, "pointerdown", 700, 200, card2);
        pev(w, "pointermove", 690, 210);
        pev(w, "pointermove", tx, ty);
        pev(w, "pointerup", tx, ty);
        await settle(2);
        const p2 = T.placed.get(entry.uid);
        check(p2 && K(p2.cells.map(({ r, c }) => [r, c])) === exp && T.staging.length === 0, `${tag}: dragged back from the card to (0,0) (${p2 && K(p2.cells.map(({ r, c }) => [r, c]))})`);
        check(iconBadges(w, entry.uid).length === 1, `${tag}: icon rendered after drag back`);
      }
      T.removeFromGrid(entry.uid); T.staging = []; T.renderGrid();
    }
  }
  check(shapeKeys.size === Object.keys(T.SHAPES).length, `every SHAPES key is used by some item (${shapeKeys.size}/${Object.keys(T.SHAPES).length})`);

  // ---------- 2c. save → reload keeps every shape × rotation draggable with its icon ----------
  {
    const todo = [];
    for (const key of Object.keys(T.SHAPES)) { const d = defs.find((x) => x.shape === key); if (d) for (let r = 0; r < 4; r++) todo.push([d, r]); }
    let worlds = 0, restored = 0;
    while (todo.length) {
      resetBoard(T, 8);
      const batch = [];
      for (let i = 0; i < todo.length; i++) {
        const [d, r] = todo[i];
        let spot = null;
        for (let rr = 0; rr < 8 && !spot; rr++) for (let cc = 0; cc < 8 && !spot; cc++) if (T.canPlace(d.id, r, rr, cc, null)) spot = [rr, cc];
        if (!spot) continue;
        const e = { uid: `s${worlds}_${batch.length}`, defId: d.id, rot: r, valueOverride: d.value };
        T.placeItem(e, spot[0], spot[1]); batch.push([e, d]); todo.splice(i--, 1);
      }
      T.saveGame();
      const sv = JSON.parse(w.localStorage.getItem(T.SAVE_KEY));
      sv.ownedGridMax = 8; // an owned 8×8 (test board)
      const w2 = makeWorld(JSON.stringify(sv)); await settle(20);
      for (const [e, d] of batch) {
        const icons = iconBadges(w2, e.uid);
        check(w2.__T.placed.has(e.uid) && icons.length === 1 && icons[0].textContent.trim() === d.icon, `reload ${d.id}(${d.shape})@${e.rot * 90}°: icon rendered after reload (placed=${w2.__T.placed.has(e.uid)} icons=${icons.length} grid=${w2.__T.gridSize()} batch=${worlds})`);
        restored++;
      }
      // drag one of them out after reload (real events)
      const [e0] = batch[batch.length - 1];
      const ic = iconBadges(w2, e0.uid)[0];
      if (ic) {
        const c = ic.closest(".cell"); const [sx, sy] = cellCenter(w2, +c.dataset.r, +c.dataset.c);
        pev(w2, "pointerdown", sx, sy, ic); pev(w2, "pointermove", sx + 50, sy); pev(w2, "pointermove", 750, 250); pev(w2, "pointerup", 750, 250);
        await settle(2);
        check(!w2.__T.placed.has(e0.uid) && w2.__T.staging.some((s) => s.uid === e0.uid), `reload: ${e0.defId}@${e0.rot * 90}° draggable out after reload`);
      }
      worlds++;
      if (worlds > 20) { check(false, "reload batches did not converge"); break; }
    }
    check(restored === Object.keys(T.SHAPES).length * 4, `reload covered every shape × 4 rotations (${restored})`);
  }

  // ---------- 3. settlement: ui_anomaly self-check + value from state ----------
  async function settleWorld(glitch) {
    const wx = makeWorld(); const X = wx.__T; await settle(20);
    resetBoard(X, 5);
    const pick = ["proto_chip", "cable_tester", "briefcase", "bolt"].map((id) => X.ITEM_DEFS.find((d) => d.id === id));
    let i = 0;
    for (const [d, r] of [[pick[0], 0], [pick[1], 1], [pick[2], 2], [pick[3], 0]]) {
      let spot = null; // first free spot (reading order) — keeps the setup independent of shape sizes
      for (let rr = 0; rr < 5 && !spot; rr++) for (let cc = 0; cc < 5 && !spot; cc++) if (X.canPlace(d.id, r, rr, cc, null)) spot = [rr, cc];
      check(spot && X.placeItem({ uid: "z" + i++, defId: d.id, rot: r, valueOverride: d.value }, spot[0], spot[1]), `settle setup: ${d.id} fits`);
    }
    X.renderGrid();
    X.crateOpenedThisRound = true; X.paidFeeThisRound = 3150; X.cash = 20000;
    const stateValue = [...X.placed.values()].reduce((a, p) => a + X.itemValue(p), 0);
    let removed = null;
    if (glitch) { // simulate the old failure: the icon of one item is gone from the DOM
      const b = iconBadges(wx, "z1")[0]; removed = b && b.textContent; if (b) b.remove();
    }
    const log0 = (wx.__analyticsLog || []).length;
    X.extract();
    await settle(5);
    const evs = (wx.__analyticsLog || []).slice(log0).filter((e) => e.ev === "ui_anomaly");
    return { X, wx, evs, stateValue, cash: X.cash, removed, icons: iconBadges(wx, "z1").length };
  }
  const ctl = await settleWorld(false);
  const gl = await settleWorld(true);
  check(ctl.evs.length === 0, `control settle: no ui_anomaly (${ctl.evs.length})`);
  check(gl.removed === "💠" || gl.removed === "🧪", `glitch setup removed an icon (${gl.removed})`);
  check(gl.evs.length === 1, `glitch settle: exactly one ui_anomaly (${gl.evs.length})`);
  const ev = gl.evs[0] || {};
  check(ev.kind === "icon_missing" && ev.item === "cable_tester" && ev.shape === "J" && ev.rotated === true, `ui_anomaly fields item/shape/rotated (${JSON.stringify(ev)})`);
  check(ev.vw_px === gl.wx.innerWidth && ev.placed_n === 4 && ev.drawn_n === 3, `ui_anomaly vw_px/placed_n/drawn_n (${ev.vw_px}/${ev.placed_n}/${ev.drawn_n})`);
  check("eval" in ev && "eval_tainted" in ev && "build" in ev, "ui_anomaly carries track() common fields (eval, eval_tainted, build)");
  { // self-heal, checked directly (a settled round clears the grid afterwards)
    const wh = makeWorld(); const H = wh.__T; await settle(20); resetBoard(H, 5);
    const d = H.ITEM_DEFS.find((x) => x.id === "cable_tester");
    H.placeItem({ uid: "h1", defId: d.id, rot: 1, valueOverride: d.value }, 0, 0); H.renderGrid();
    iconBadges(wh, "h1")[0].remove();
    check(iconBadges(wh, "h1").length === 0 && H.checkGridIntegrity() === 1, "self-heal: mismatch detected");
    check(iconBadges(wh, "h1").length === 1 && H.checkGridIntegrity() === 0, "self-heal: grid re-rendered with the icon back");
  }
  check(gl.X.extractedThisRound && ctl.X.extractedThisRound, "both rounds settled");
  check(gl.cash === ctl.cash, `settled cash identical with/without render glitch (${gl.cash} vs ${ctl.cash})`);
  check(gl.cash - 20000 >= gl.stateValue, `settlement paid at least the state value ${gl.stateValue} (Δcash ${gl.cash - 20000})`);

  // ---------- 3b. mid-drag: save keeps the item, settle counts it ----------
  {
    const wx = makeWorld(); const X = wx.__T; await settle(20);
    resetBoard(X, 5);
    const d = X.ITEM_DEFS.find((x) => x.id === "gold_drone"); // cross
    X.placeItem({ uid: "m1", defId: d.id, rot: 1, valueOverride: d.value }, 1, 1);
    X.renderGrid();
    X.crateOpenedThisRound = true; X.paidFeeThisRound = 1000; X.cash = 5000;
    const ic = iconBadges(wx, "m1")[0];
    const c = ic.closest(".cell"); const [sx, sy] = cellCenter(wx, +c.dataset.r, +c.dataset.c);
    pev(wx, "pointerdown", sx, sy, ic); pev(wx, "pointermove", sx + 30, sy + 30);
    check(X.drag.active && !X.placed.has("m1"), "mid-drag: item lifted out of the grid state");
    X.saveGame();
    const sv = JSON.parse(wx.localStorage.getItem(X.SAVE_KEY));
    const inSave = sv.placed.find((e) => e.uid === "m1");
    check(inSave && inSave.ox === 1 && inSave.oy === 1 && inSave.rot === 1, `mid-drag save still has the item at its cells (${JSON.stringify(inSave)})`);
    X.extract(); await settle(3);
    check(X.extractedThisRound && !X.drag.active, "settle during a drag cancels the drag (no item left in the air)");
    check(X.cash === 5000 + X.itemValue({ defId: d.id, valueOverride: d.value }) + Math.round(X.itemValue({ defId: d.id, valueOverride: d.value }) * 0.1) || X.cash >= 5000 + d.value,
      `mid-drag settle counted the item (cash ${X.cash})`);
  }

  console.log(`ui_shapes: defs=${defs.length} shapes=${shapeKeys.size} cases=${cases} checks: pass=${pass} fail=${fail}`);
  if (fail) { console.log(failures.slice(0, 40).map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
  console.log("OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
