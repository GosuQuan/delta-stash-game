#!/usr/bin/env node
/**
 * Headless-browser regression sweep for the grid drag / shape UI (release 20260925i).
 * NOT part of `npm test` (needs Chrome + playwright-core). Usage:
 *   python3 -m http.server 8931 --bind 127.0.0.1   # in the repo root
 *   node tools/ui_drag_check.js [--mode=mouse|touch|both] [--rots=0,1] [--shot-dir=DIR]
 * Env: URL (default http://127.0.0.1:8931/index.html), PW (playwright-core path), CHROME (executable).
 *
 * For every ITEM_DEFS entry × rotation × input (PC mouse 1280×800 / 390×844 touch):
 *  seed a save with the item in 暂存 → check the card mini-grid (rendered layout) == expected cells →
 *  drag into the grid at origin (0,0) → check the landing highlight / ghost cells == expected →
 *  after drop the occupied cells == expected, the item icon is rendered on one of its own cells and
 *  is hit-testable → drag it again to the bottom-right edge → icon still rendered → reload (save) →
 *  icon still rendered and draggable back into 暂存.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const PW = process.env.PW || "/workspace/launch-pw/node_modules/playwright-core";
const { chromium } = require(PW);
const URL = process.env.URL || "http://127.0.0.1:8931/index.html";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const MODES = (args.mode || "both") === "both" ? ["mouse", "touch"] : [args.mode];
const ROTS = (args.rots || "0,1").split(",").map(Number);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const WORKERS = +(args.workers || 4);

// ---- shape data straight from game.js (same literals the game uses) ----
const src = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
function literal(name, open, close) {
  const i = src.indexOf(`const ${name} = ${open}`);
  if (i < 0) throw new Error(name + " not found");
  let depth = 0, j = src.indexOf(open, i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === open) depth++;
    else if (src[k] === close && --depth === 0) return eval("(" + src.slice(j, k + 1) + ")");
  }
  throw new Error(name + " unterminated");
}
const SHAPES = literal("SHAPES", "{", "}");
const ITEM_DEFS = literal("ITEM_DEFS", "[", "]");
function rotateCells(cells, times) {
  let c = cells.map(([r, col]) => [r, col]);
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) {
    c = c.map(([r, col]) => [col, -r]);
    const minR = Math.min(...c.map((x) => x[0])), minC = Math.min(...c.map((x) => x[1]));
    c = c.map(([r, col]) => [r - minR, col - minC]);
  }
  return c;
}
/** same rule as game.js shapeFootprint(): occupied cell nearest the bounding-box centre */
function anchorOf(cells) {
  const rows = Math.max(...cells.map((x) => x[0])) + 1, cols = Math.max(...cells.map((x) => x[1])) + 1;
  const cr = (rows - 1) / 2, cc = (cols - 1) / 2;
  let a = cells[0], best = Infinity;
  for (const [r, c] of [...cells].sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
    const d = (r - cr) ** 2 + (c - cc) ** 2;
    if (d < best - 1e-9) { best = d; a = [r, c]; }
  }
  return a;
}
const key = (cells) => cells.map(([r, c]) => r + "," + c).sort().join(" ");

function save(def, rot) {
  return JSON.stringify({
    v: 8, cash: 50000, round: 3, totalPnL: 0, wins: 1, losses: 1, honeymoonEnded: true, historyLog: [],
    gridSize: 5, ownedGridMax: 5, uidCounter: 100, paidFeeThisRound: 3150, crateOpenedThisRound: true,
    extractedThisRound: false, bankrupt: false, selectedTier: "common", totalCrateOpens: 3,
    staging: [{ uid: "i50", defId: def.id, rot, valueOverride: def.value }], placed: [],
  });
}

async function newCtx(browser, mode) {
  const touch = mode === "touch";
  const ctx = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 800 } });
  // seed saves before game.js runs (the old page's pagehide save would otherwise overwrite them)
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("auctionHelpSeen", "1");
      localStorage.setItem("deltaStashOnboardingV1", "veteran"); // skip the first-run onboarding modal (it would block pointer events)
      const seed = sessionStorage.getItem("__seedSave");
      if (seed) { localStorage.setItem("deltaStashSave", seed); sessionStorage.removeItem("__seedSave"); }
    } catch (_) {}
  });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  return { ctx, page, cdp, errs, touch };
}

async function gridInfo(page) {
  return page.evaluate(() => {
    const c0 = document.querySelector('#warehouseGrid .cell[data-r="0"][data-c="0"]').getBoundingClientRect();
    return { x: c0.left, y: c0.top, cw: c0.width, ch: c0.height };
  });
}
/** pointer position that makes the drag target cell = (r,c) for this mode */
function pointFor(g, r, c, cells, touch) {
  if (!touch) { // mouse: the cursor holds the icon (anchor) cell of the shape
    const [ar, ac] = anchorOf(cells);
    return [g.x + (c + ac + 0.5) * g.cw, g.y + (r + ar + 0.5) * g.ch];
  }
  // touch (c72f5fc): the landing origin is the cell under (finger.x, finger.y − TOUCH_TARGET_LIFT = 12px)
  return [g.x + (c + 0.5) * g.cw, g.y + (r + 0.5) * g.ch + 12];
}
async function drag(S, from, to, midCheck) {
  const { page, cdp, touch } = S;
  const N = 14;
  if (touch) {
    const t = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
    await t("touchStart", from[0], from[1]);
    for (let i = 1; i <= N; i++) await t("touchMove", from[0] + (to[0] - from[0]) * i / N, from[1] + (to[1] - from[1]) * i / N);
    await page.waitForTimeout(60);
    const mid = midCheck ? await midCheck() : null;
    await t("touchEnd");
    await page.waitForTimeout(150);
    return mid;
  }
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= N; i++) await page.mouse.move(from[0] + (to[0] - from[0]) * i / N, from[1] + (to[1] - from[1]) * i / N);
  await page.waitForTimeout(40);
  const mid = midCheck ? await midCheck() : null;
  await page.mouse.up();
  await page.waitForTimeout(150);
  return mid;
}

/** occupied cells, icon badges (hit-testable?) — all from the rendered DOM */
function domState(page, icon) {
  return page.evaluate((icon) => {
    const occ = [...document.querySelectorAll("#warehouseGrid .cell.occupied")].map((c) => [+c.dataset.r, +c.dataset.c]);
    const badges = [...document.querySelectorAll("#warehouseGrid .cell-item")].filter((b) => b.textContent.trim() === icon).map((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const cell = b.closest(".cell");
      return { r: +cell.dataset.r, c: +cell.dataset.c, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, hit: hit === b || b.contains(hit), vis: getComputedStyle(b).visibility !== "hidden" && r.width > 0 };
    });
    return { occ, badges, staging: document.querySelectorAll("#stagingArea .item-card").length };
  }, icon);
}
/** mini-grid on the card, read from rendered layout (not from the HTML string) */
function miniCells(page) {
  return page.evaluate(() => {
    const spans = [...document.querySelectorAll('#stagingArea .item-card .mini-shape span')];
    if (!spans.length) return null;
    const rects = spans.map((s) => ({ r: s.getBoundingClientRect(), on: getComputedStyle(s).visibility !== "hidden" }));
    const xs = [...new Set(rects.map((o) => Math.round(o.r.left)))].sort((a, b) => a - b);
    const ys = [...new Set(rects.map((o) => Math.round(o.r.top)))].sort((a, b) => a - b);
    return rects.filter((o) => o.on).map((o) => [ys.indexOf(Math.round(o.r.top)), xs.indexOf(Math.round(o.r.left))]);
  });
}
function hlCells(page) {
  return page.evaluate(() => {
    const hl = [...document.querySelectorAll("#warehouseGrid .cell.hl-ok, #warehouseGrid .cell.hl-bad")].map((c) => [+c.dataset.r, +c.dataset.c]);
    const g = document.querySelector(".drag-ghost");
    let ghost = null, ghostIcon = null;
    if (g && !g.hidden) {
      const kids = [...g.children];
      const cols = (g.style.gridTemplateColumns.match(/repeat\((\d+)/) || [])[1] | 0;
      ghost = kids.map((k, i) => [Math.floor(i / cols), i % cols, k]).filter(([, , k]) => k.style.visibility !== "hidden").map(([r, c]) => [r, c]);
      ghostIcon = kids.some((k) => k.style.visibility !== "hidden" && k.textContent.trim());
    }
    const fp = document.querySelectorAll(".touch-footprint .fp-cell").length;
    return { hl, ghost, ghostIcon, fp };
  });
}

async function runCase(S, def, rot) {
  const { page, touch } = S;
  const fails = [];
  const exp = rotateCells(SHAPES[def.shape], rot);
  const H = Math.max(...exp.map((x) => x[0])) + 1, W = Math.max(...exp.map((x) => x[1])) + 1;
  await page.evaluate((raw) => { sessionStorage.setItem("__seedSave", raw); }, save(def, rot));
  await page.reload();
  await page.waitForSelector("#stagingArea .item-card", { timeout: 5000 });
  await page.waitForTimeout(250);
  const mini = await miniCells(page);
  if (!mini || key(mini) !== key(exp)) fails.push(`card mini-grid ${mini && key(mini)} ≠ ${key(exp)}`);
  const g = await gridInfo(page);
  const card = await page.$("#stagingArea .item-card");
  const cb = await card.boundingBox();
  // 1) staging → grid origin (0,0)
  const mid = await drag(S, [cb.x + cb.width / 2, cb.y + cb.height / 2], pointFor(g, 0, 0, exp, touch), () => hlCells(page));
  if (key(mid.hl) !== key(exp)) fails.push(`drag highlight ${key(mid.hl)} ≠ ${key(exp)}`);
  if (!mid.ghost || key(mid.ghost) !== key(exp)) fails.push(`drag ghost ${mid.ghost && key(mid.ghost)} ≠ ${key(exp)}`);
  if (!mid.ghostIcon) fails.push("drag ghost shows no icon");
  let st = await domState(page, def.icon);
  if (key(st.occ) !== key(exp)) { fails.push(`placed cells ${key(st.occ)} ≠ ${key(exp)}`); return fails; }
  const b1 = st.badges.find((b) => b.vis && b.hit && exp.some(([r, c]) => r === b.r && c === b.c));
  if (!b1) { fails.push(`after drop: icon not rendered/hit-testable (badges ${JSON.stringify(st.badges.map((b) => [b.r, b.c, b.vis, b.hit]))})`); return fails; }
  // 2) grid → grid bottom-right edge (item >1 tall/wide touching the edge)
  const dr = 5 - H, dc = 5 - W;
  if (dr > 0 || dc > 0) {
    // grab at the icon; target origin shifts by (dr,dc)
    const off = touch ? pointFor(g, dr, dc, exp, true) : [b1.x + dc * g.cw, b1.y + dr * g.ch];
    await drag(S, [b1.x, b1.y], off);
    st = await domState(page, def.icon);
    const exp2 = exp.map(([r, c]) => [r + dr, c + dc]);
    if (key(st.occ) !== key(exp2)) { fails.push(`re-drag in grid: cells ${key(st.occ)} ≠ ${key(exp2)}`); return fails; }
    if (!st.badges.some((b) => b.vis && b.hit)) { fails.push("after re-drag: icon missing"); return fails; }
  }
  // 3) reload from save → icon still there, drag back to 暂存
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector("#warehouseGrid .cell", { timeout: 5000 });
  await page.waitForTimeout(250);
  st = await domState(page, def.icon);
  const b3 = st.badges.find((b) => b.vis && b.hit);
  if (st.occ.length !== exp.length) { fails.push(`after reload: ${st.occ.length} cells`); return fails; }
  if (!b3) { fails.push("after reload: icon missing"); return fails; }
  const area = await (await page.$("#stagingArea")).boundingBox();
  let to = [area.x + area.width / 2, area.y + area.height / 2];
  if (touch) to = [to[0], to[1] + 12]; // c72f5fc: the staging drop test uses (finger.x, finger.y − 12)
  await drag(S, [b3.x, b3.y], to);
  st = await domState(page, def.icon);
  if (st.occ.length !== 0 || st.staging !== 1) fails.push(`drag back to 暂存 failed (occ ${st.occ.length}, staging ${st.staging})`);
  return fails;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const defs = ITEM_DEFS.filter((d) => !ONLY || ONLY.has(d.id) || ONLY.has(d.shape));
  const results = [];
  for (const mode of MODES) {
    const jobs = [];
    for (const d of defs) for (const r of ROTS) jobs.push([d, r]);
    let next = 0;
    await Promise.all(Array.from({ length: WORKERS }, async () => {
      const S = await newCtx(browser, mode);
      await S.page.goto(URL + "?t=" + Date.now());
      while (next < jobs.length) {
        const [d, r] = jobs[next++];
        let fails;
        try { fails = await runCase(S, d, r); } catch (e) { fails = ["exception: " + String(e).split("\n")[0]]; }
        results.push({ mode, id: d.id, shape: d.shape, rot: r, fails });
      }
      if (S.errs.length) results.push({ mode, id: "(page)", shape: "", rot: -1, fails: S.errs });
      await S.ctx.close();
    }));
  }
  await browser.close();
  const bad = results.filter((x) => x.fails.length);
  const byShape = {};
  for (const x of bad) (byShape[`${x.mode} ${x.shape}@${x.rot}`] ||= { ids: [], fails: x.fails }).ids.push(x.id);
  console.log(`cases ${results.length} · failing ${bad.length}`);
  for (const [k, v] of Object.entries(byShape).sort()) console.log(`  ✗ ${k} [${v.ids.join(",")}]\n      ${v.fails.join("\n      ")}`);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(results, null, 1));
  process.exit(bad.length ? 1 : 0);
})();
