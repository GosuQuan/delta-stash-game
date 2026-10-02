/**
 * Release 20260926g regression tests (plain node + jsdom, real index.html + style.css + game.js):
 *  1. Tap-to-place anchor: with a staging item selected, a tap puts the shape's ICON cell (footprint anchor — the same
 *     alignment mouse drag uses) under the tapped cell instead of the bounding-box top-left; tapping an occupied cell
 *     still tries to place the selected item (bounding-box top-left fallback) before it falls back to selecting the
 *     placed item; conflicts reject only the new item; nothing selected → tap on a placed item selects it.
 *     Shapes: cross (6 cells, 3×4 box), L, J — all 4 rotations.
 *  2. Favicon: index.html links (relative hrefs), files exist, test/ copy is byte-identical, no root-absolute hrefs.
 *  3. Rotation persists immediately: rotating a placed / staged item writes the new rot to localStorage (no reload).
 *  4. Release stamp: 4× ?v= in index.html == version.json == BUILD_VERSION.
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
    syncCashDisplay, saveGame, SAVE_KEY, BUILD_VERSION, defFootprint, cellsFor,
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


function cellEl(w, r, c) { return w.document.querySelector(`#warehouseGrid .cell[data-r="${r}"][data-c="${c}"]`); }
/** a tap exactly as a finger / mouse delivers it: pointerdown + pointerup on what is under the point (badge if occupied) */
function tapGrid(w, r, c, type) {
  const ce = cellEl(w, r, c);
  const target = ce.querySelector(".cell-item") || ce;
  const [x, y] = cellCenter(w, r, c);
  pev(w, "pointerdown", x, y, target, { id: 1, type: type || "touch" });
  pev(w, "pointerup", x, y, target, { id: 1, type: type || "touch" });
}
function resetBoard(T) {
  T.initGrid(5);
  for (const uid of [...T.placed.keys()]) T.removeFromGrid(uid);
  T.staging = []; T.selectedUid = null; T.renderGrid(); T.renderStaging();
}
function stageRot(T, def, rot, uid) {
  const e = { uid: uid || "g_" + def.id, defId: def.id, rot: rot || 0, valueOverride: def.value };
  T.staging = [e]; T.renderStaging(); return e;
}
function tapCard(w, uid) {
  const card = w.document.querySelector(`#stagingArea .item-card[data-uid="${uid}"]`);
  pev(w, "pointerdown", 700, 200, card, { id: 1, type: "touch" }); pev(w, "pointerup", 700, 200, card, { id: 1, type: "touch" });
  return card;
}
const keyset = (cells) => cells.map((x) => `${x.r},${x.c}`).sort().join("|");
const occupiedBy = (T, uid) => { const out = []; const p = T.placed.get(uid); if (!p) return out; return T.cellsFor(p.defId, p.rot, p.ox, p.oy); };
const readSave = (w, T) => JSON.parse(w.localStorage.getItem(T.SAVE_KEY) || "null");

async function tapTests() {
  const w = makeWorld(); const T = w.__T; await settle(20);
  const defs = {};
  for (const s of ["cross", "L", "J"]) { defs[s] = T.ITEM_DEFS.find((d) => d.shape === s); check(!!defs[s], `item with shape ${s} exists`); }
  const one = T.ITEM_DEFS.find((d) => d.shape === "1x1");
  const CROSS = [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1], [1, 3]];

  // sanity: the cross definition is the 6-cell 3×4 shape and its anchor is an OCCUPIED cell (not the empty box corner)
  {
    const fp = T.defFootprint(defs.cross.id, 0);
    check(JSON.stringify(fp.cells) === JSON.stringify(CROSS) && fp.rows === 3 && fp.cols === 4, "cross footprint = 6 cells in a 3×4 box");
    check(fp.cells.some(([r, c]) => r === fp.anchor[0] && c === fp.anchor[1]) && !(fp.anchor[0] === 0 && fp.anchor[1] === 0), `cross anchor ${fp.anchor} is an occupied non-corner cell`);
  }

  // ---- A. empty board: tap puts the ICON (anchor) cell under the tapped cell, all shapes × rotations × touch/mouse ----
  for (const shape of ["cross", "L", "J"]) {
    for (let rot = 0; rot < 4; rot++) for (const ptr of ["touch", "mouse"]) {
      resetBoard(T); const e = stageRot(T, defs[shape], rot); tapCard(w, e.uid);
      check(T.selectedUid === e.uid, `A ${shape}/${rot}/${ptr}: staged item selected`);
      const fp = T.defFootprint(defs[shape].id, rot);
      const tr = 2, tc = 2; // tapped cell
      tapGrid(w, tr, tc, ptr);
      const p = T.placed.get(e.uid);
      check(!!p, `A ${shape}/${rot}/${ptr}: placed`);
      if (p) {
        check(p.ox === tr - fp.anchor[0] && p.oy === tc - fp.anchor[1], `A ${shape}/${rot}/${ptr}: origin = tapped cell − anchor (got ${p.ox},${p.oy})`);
        check(occupiedBy(T, e.uid).some((x) => x.r === tr && x.c === tc), `A ${shape}/${rot}/${ptr}: the tapped cell is part of the placed footprint`);
        const badge = cellEl(w, tr, tc).querySelector(".cell-item");
        check(!!badge && badge.dataset.icon === "1", `A ${shape}/${rot}/${ptr}: icon sits on the tapped cell`);
      }
      check(!T.staging.some((s) => s.uid === e.uid), `A ${shape}/${rot}/${ptr}: removed from staging`);
    }
  }

  // ---- B. bounding-box top-left cell occupied by ANOTHER item, the selected item itself fits ----
  for (const shape of ["cross", "L", "J"]) {
    for (let rot = 0; rot < 4; rot++) {
      const fp = T.defFootprint(defs[shape].id, rot);
      const cornerInShape = fp.cells.some(([r, c]) => r === 0 && c === 0);
      const BR = 1, BC = 1; // blocker 1×1 at the would-be bounding-box top-left

      // B1: tap an EMPTY cell (anchor aligned) with the blocker sitting in the bbox corner of the new shape
      resetBoard(T); T.placeItem({ uid: "blk", defId: one.id, rot: 0, valueOverride: one.value }, BR, BC); T.renderGrid();
      let e = stageRot(T, defs[shape], rot); tapCard(w, e.uid);
      const origin = { r: BR, c: BC }; // shape box top-left == blocker
      const [ar, ac] = fp.anchor;
      const tapR = origin.r + ar, tapC = origin.c + ac; // anchor-aligned tap that makes the box top-left land on the blocker
      if (!cornerInShape) {
        check(!(tapR === BR && tapC === BC), `B1 ${shape}/${rot}: test setup — tapped cell is not the blocker`);
        tapGrid(w, tapR, tapC);
        const p = T.placed.get(e.uid);
        check(!!p && p.ox === origin.r && p.oy === origin.c, `B1 ${shape}/${rot}: placed around the blocker via empty-cell tap (got ${p && p.ox + "," + p.oy})`);
        check(T.placed.has("blk"), `B1 ${shape}/${rot}: blocker untouched`);
        check(!!p && !occupiedBy(T, "blk").length === false, `B1 ${shape}/${rot}: blocker still has its cell`);
      }

      // B2: tap ON the occupied bbox top-left cell (the reported bug): the selected item must be placed, not the blocker selected
      resetBoard(T); T.placeItem({ uid: "blk", defId: one.id, rot: 0, valueOverride: one.value }, BR, BC); T.renderGrid();
      e = stageRot(T, defs[shape], rot); tapCard(w, e.uid);
      tapGrid(w, BR, BC);
      const p2 = T.placed.get(e.uid);
      if (!cornerInShape) {
        check(!!p2 && p2.ox === BR && p2.oy === BC, `B2 ${shape}/${rot}: tap on occupied bbox-top-left places the selected item (got ${p2 && p2.ox + "," + p2.oy})`);
        check(T.placed.has("blk") && T.placed.get("blk").ox === BR && T.placed.get("blk").oy === BC, `B2 ${shape}/${rot}: blocker stays where it was`);
        check(!T.staging.some((s) => s.uid === e.uid), `B2 ${shape}/${rot}: item left staging`);
        check(T.selectedUid !== "blk", `B2 ${shape}/${rot}: blocker was NOT selected by the tap`);
      } else {
        // the corner cell belongs to the shape → genuinely conflicts → rejected, existing stays, blocker selected (old behaviour)
        check(!p2 && T.staging.some((s) => s.uid === e.uid), `B2 ${shape}/${rot}: shape covers the corner → rejected, stays in staging`);
        check(T.placed.has("blk") && T.selectedUid === "blk", `B2 ${shape}/${rot}: blocker kept and selected on a rejected tap`);
      }
    }
  }

  // ---- C. true conflict via anchor-aligned tap: only the NEW item is rejected ----
  for (const shape of ["cross", "L", "J"]) {
    resetBoard(T);
    const fp = T.defFootprint(defs[shape].id, 0);
    // blocker on a cell the shape will cover (offset of a non-anchor shape cell)
    const other = fp.cells.find(([r, c]) => !(r === fp.anchor[0] && c === fp.anchor[1]));
    const tr = 2, tc = 2, br = tr - fp.anchor[0] + other[0], bc = tc - fp.anchor[1] + other[1];
    T.placeItem({ uid: "blk", defId: one.id, rot: 0, valueOverride: one.value }, br, bc); T.renderGrid();
    const e = stageRot(T, defs[shape], 0); tapCard(w, e.uid);
    tapGrid(w, tr, tc);
    check(!T.placed.has(e.uid) && T.staging.some((s) => s.uid === e.uid), `C ${shape}: overlapping tap rejects the new item (stays staged)`);
    check(T.placed.has("blk") && T.placed.get("blk").ox === br && T.placed.get("blk").oy === bc, `C ${shape}: existing item unchanged`);
    check(T.selectedUid === e.uid, `C ${shape}: the staged item stays selected after a rejected tap`);
    check(T.placed.size === 1, `C ${shape}: nothing else placed (${T.placed.size})`);
  }

  // ---- D. nothing selected: tapping a placed item still selects it (touch + mouse); selecting staged card works ----
  for (const ptr of ["touch", "mouse"]) {
    resetBoard(T); T.placeItem({ uid: "blk", defId: one.id, rot: 0, valueOverride: one.value }, 1, 1); T.renderGrid();
    check(T.selectedUid === null, `D ${ptr}: nothing selected at start`);
    tapGrid(w, 1, 1, ptr);
    check(T.selectedUid === "blk", `D ${ptr}: tap on placed item with nothing selected selects it`);
    check(T.placed.has("blk"), `D ${ptr}: item still placed`);
  }

  // ---- E. selected PLACED item + tap on an empty cell does not move/place anything (only staging items tap-place) ----
  {
    resetBoard(T); T.placeItem({ uid: "blk", defId: one.id, rot: 0, valueOverride: one.value }, 1, 1); T.renderGrid();
    T.selectedUid = "blk"; tapGrid(w, 3, 3);
    check(T.placed.size === 1 && T.placed.get("blk").ox === 1, "E: placed item selected + tap on empty cell → no change");
  }

  // ---- F. drag placement unchanged (mouse drag of the cross: icon/anchor cell under the pointer) and agrees with tap ----
  for (const ptr of ["mouse"]) {
    resetBoard(T); const e = stageRot(T, defs.cross, 0);
    const card = w.document.querySelector(`#stagingArea .item-card[data-uid="${e.uid}"]`);
    const [tx, ty] = cellCenter(w, 2, 2);
    pev(w, "pointerdown", 700, 200, card, { id: 1, type: ptr });
    pev(w, "pointermove", 690, 210, null, { id: 1, type: ptr }); pev(w, "pointermove", 600, 250, null, { id: 1, type: ptr });
    pev(w, "pointermove", tx, ty, null, { id: 1, type: ptr }); pev(w, "pointerup", tx, ty, null, { id: 1, type: ptr });
    await settle(2);
    const p = T.placed.get(e.uid); const fp = T.defFootprint(defs.cross.id, 0);
    check(!!p && p.ox === 2 - fp.anchor[0] && p.oy === 2 - fp.anchor[1], `F drag: cross dropped with its anchor under the pointer (got ${p && p.ox + "," + p.oy})`);
    const dragCells = p ? keyset(occupiedBy(T, e.uid)) : "";
    resetBoard(T); const e2 = stageRot(T, defs.cross, 0); tapCard(w, e2.uid); tapGrid(w, 2, 2);
    check(dragCells && dragCells === keyset(occupiedBy(T, e2.uid)), "F: tap-place and drag-place land on the same cells");
  }
  // drag of an already placed item while a staged item is selected still moves the placed item (not tap-place)
  {
    resetBoard(T); T.placeItem({ uid: "blk", defId: one.id, rot: 0, valueOverride: one.value }, 1, 1); T.renderGrid();
    const e = stageRot(T, defs.L, 0); T.selectedUid = e.uid; T.renderStaging();
    const badge = cellEl(w, 1, 1).querySelector(".cell-item");
    const [sx, sy] = cellCenter(w, 1, 1), [dx, dy] = cellCenter(w, 3, 3);
    pev(w, "pointerdown", sx, sy, badge, { id: 1, type: "mouse" });
    pev(w, "pointermove", sx + 20, sy + 20, null, { id: 1, type: "mouse" }); pev(w, "pointermove", dx, dy, null, { id: 1, type: "mouse" });
    pev(w, "pointerup", dx, dy, null, { id: 1, type: "mouse" });
    await settle(2);
    check(T.placed.has("blk") && T.placed.get("blk").ox === 3 && T.placed.get("blk").oy === 3, `F2: dragging a placed item still moves it (got ${T.placed.get("blk") && T.placed.get("blk").ox + "," + T.placed.get("blk").oy})`);
    check(T.staging.some((s) => s.uid === e.uid), "F2: the selected staged item was not tap-placed by the drag");
  }
  w.close();
}

async function saveTests() {
  const w = makeWorld(); const T = w.__T; await settle(20);
  const def = T.ITEM_DEFS.find((d) => d.shape === "1x2");
  for (const kind of ["mouse", "touch", "keyboard", "keyR"]) {
    const press = () => (kind === "keyR" ? pressKeyR(w) : pressRotate(w, kind));
    // --- placed item ---
    resetBoard(T); const ge = { uid: "g_placed", defId: def.id, rot: 0, valueOverride: def.value };
    T.placeItem(ge, 1, 1); T.renderGrid(); T.saveGame(); await settle(3);
    check(readSave(w, T).placed.find((x) => x.uid === "g_placed").rot === 0, `${kind}/placed: save starts at rot 0`);
    T.selectedUid = "g_placed";
    for (let i = 1; i <= 4; i++) {
      press(); await settle(3); // scheduleSave is debounced (80ms mocked to a 0ms timer) — no reload in between
      const sv = readSave(w, T).placed.find((x) => x.uid === "g_placed");
      check(sv && sv.rot === i % 4, `${kind}/placed: after press ${i} localStorage rot = ${i % 4} (got ${sv && sv.rot})`);
      check(T.placed.get("g_placed").rot === i % 4, `${kind}/placed: in-memory rot = ${i % 4}`);
    }
    // --- staged item ---
    resetBoard(T); const se = stageRot(T, def, 0, "g_staged"); tapCard(w, se.uid); T.saveGame(); await settle(3);
    check(readSave(w, T).staging.find((x) => x.uid === "g_staged").rot === 0, `${kind}/staged: save starts at rot 0`);
    for (let i = 1; i <= 4; i++) {
      press(); await settle(3);
      const sv = readSave(w, T).staging.find((x) => x.uid === "g_staged");
      check(sv && sv.rot === i % 4, `${kind}/staged: after press ${i} localStorage rot = ${i % 4} (got ${sv && sv.rot})`);
    }
  }
  // rotation blocked by a neighbour / wall: rot unchanged and the save still agrees with memory
  {
    resetBoard(T); const long = T.ITEM_DEFS.find((d) => d.shape === "1x3");
    T.placeItem({ uid: "g_wall", defId: long.id, rot: 0, valueOverride: long.value }, 0, 3); // cols 3..5? grid is 5 → use origin col 2
    T.removeFromGrid("g_wall"); T.placeItem({ uid: "g_wall", defId: long.id, rot: 0, valueOverride: long.value }, 4, 2); T.renderGrid();
    T.placeItem({ uid: "g_nb", defId: def.id, rot: 0, valueOverride: def.value }, 3, 2); T.renderGrid(); // blocks the 90° (vertical) footprint
    T.selectedUid = "g_wall"; T.saveGame(); await settle(3);
    pressKeyR(w); await settle(3);
    const sv = readSave(w, T).placed.find((x) => x.uid === "g_wall");
    check(sv && sv.rot === T.placed.get("g_wall").rot, `blocked rotation: save (${sv && sv.rot}) agrees with memory (${T.placed.get("g_wall").rot})`);
    check(T.placed.has("g_nb"), "blocked rotation: neighbour untouched");
  }
  // reload from the save immediately after a rotation: new rot is what comes back
  {
    resetBoard(T); T.placeItem({ uid: "g_r", defId: def.id, rot: 0, valueOverride: def.value }, 2, 1); T.renderGrid(); T.selectedUid = "g_r";
    pressKeyR(w); await settle(3);
    const raw = w.localStorage.getItem(T.SAVE_KEY);
    const w2 = makeWorld(raw); await settle(20);
    const p = w2.__T.placed.get("g_r");
    check(!!p && p.rot === 1, `reload right after rotating: placed item comes back with rot 1 (got ${p && p.rot})`);
    w2.close();
  }
  w.close();
}

function staticTests() {
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  const icons = links.filter((l) => /rel="(icon|apple-touch-icon)"/.test(l));
  check(icons.length >= 3, `index.html has icon links (found ${icons.length})`);
  check(links.some((l) => /rel="icon"/.test(l) && /type="image\/svg\+xml"/.test(l) && /href="favicon\.svg"/.test(l)), "svg <link rel=icon href=favicon.svg>");
  check(links.some((l) => /rel="icon"/.test(l) && /sizes="32x32"/.test(l) && /href="favicon-32\.png"/.test(l)), "png 32 <link rel=icon>");
  check(links.some((l) => /rel="apple-touch-icon"/.test(l) && /href="apple-touch-icon\.png"/.test(l)), "apple-touch-icon link");
  for (const l of icons) {
    const href = (/href="([^"]+)"/.exec(l) || [])[1] || "";
    check(!href.startsWith("/") && !/^[a-z]+:/i.test(href) && !href.includes(".."), `icon href "${href}" is relative (works from sub-paths and /test/)`);
    const f = path.join(DIR, href.split("?")[0]);
    check(fs.existsSync(f) && fs.statSync(f).size > 100 && fs.statSync(f).size < 20000, `icon file ${href} exists in ${path.basename(DIR) || DIR} and is small`);
  }
  for (const f of BT.ASSET_FILES) {
    check(fs.existsSync(path.join(__dirname, "..", f)), `root ${f} exists`);
    const t = path.join(__dirname, "..", "test", f);
    check(fs.existsSync(t) && fs.readFileSync(t).equals(fs.readFileSync(path.join(__dirname, "..", f))), `test/${f} is a byte-identical copy`);
  }
  check(BT.ASSET_FILES.includes("favicon.ico"), "favicon.ico is shipped too (fallback for clients that ignore <link>)");
  check(BT.check().length === 0, "test/ is in sync with the generator: " + BT.check().join("; "));
  // release stamp
  const ver = JSON.parse(fs.readFileSync(path.join(DIR, "version.json"), "utf8")).version;
  const vs = [...html.matchAll(/\?v=([0-9A-Za-z._-]+)/g)].map((m) => m[1]);
  check(vs.length === 4 && vs.every((v) => v === ver), `index.html has 4 ?v= all == version.json (${vs.join(",")} vs ${ver})`);
  const gm = /const BUILD_VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(DIR, "game.js"), "utf8"));
  check(gm && gm[1] === ver, `BUILD_VERSION (${gm && gm[1]}) == version.json (${ver})`);
}

(async () => {
  staticTests();
  await tapTests();
  await saveTests();
  console.log(`g_fixes: ${pass} checks passed, ${fail} failed`);
  if (fail) { console.log(failures.slice(0, 60).map((f) => " ✗ " + f).join("\n")); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
