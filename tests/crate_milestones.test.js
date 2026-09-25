#!/usr/bin/env node
/**
 * Crate-open regression test (hotfix 限时柜空柜, 2026-09-25).
 *
 * Loads index.html + the REAL game.js in jsdom, injects a small test hook before the closing
 * IIFE (test-only source transform; game.js itself is untouched), seeds Math.random, collapses
 * timers to 0 ms, and drives the real UI flow: openCrate() → ceremony skip → runSequentialReveal()
 * → greedy pack → extract().
 *
 * Matrix: every crate tier × every hall (none + all AUCTION_HALL_CFG tiers) × every open milestone
 * (read from OPEN_MILESTONE_CFG) × next-crate discount off/on (+ honeymoon where affordable).
 * Asserts per open:  ≥1 item delivered;  paidFeeThisRound == effectiveTierFee (after discount +
 * hall markup);  wallet delta at open == paid rent (minus any cash milestone granted in the same
 * open);  no refund on a round that has items.
 * Refund: forced 0-item round (every tier × discount) → settle refunds exactly the paid rent.
 * 厅专属柜 (CRATE_TIERS entries with `exclusive`, e.g. 杂货柜 / 夜班柜 / 双联柜) run through the same matrix
 * (daily counts reset per open; honeymoon mode skipped — unreachable below the ¥4万 unlock) plus:
 * locked below the hall's peak threshold (no charge), per-crate daily cap (no charge once used up,
 * independent of 限时柜), no free-rent tokens, and loot identical across halls / honeymoon state
 * (no hall gold/red uplift, no honeymoon effects) under the same seed.
 *
 * Run:  npm install && npm test      (or: npm i --no-save jsdom@24 && node tests/crate_milestones.test.js)
 * Env:  GAME_DIR=<dir with index.html + game.js> to test another build.
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
    get extractedThisRound() { return extractedThisRound; }, get paidFeeThisRound() { return paidFeeThisRound; },
    get settleReplayActive() { return settleReplayActive; }, get totalCrateOpens() { return totalCrateOpens; },
    get openMilestonesClaimed() { return openMilestonesClaimed; }, get nextCrateDiscountPct() { return nextCrateDiscountPct; },
    CRATE_TIERS, AUCTION_HALL_CFG, OPEN_MILESTONE_CFG, PERFECT_PACK, HONEYMOON, FEATURES,
    openCrate, extract, nextRound, canPlace, placeItem, effectiveTierFee, tierFee, honeymoonActive,
    activeAuctionHall, openMilestoneCash, getDef, gridSize: () => gridSize, rollLoot,
    get limitedDailyCount() { return limitedDailyCount; },
    hallCrate: typeof hallCrateAvailable === "function" ? {
      available: hallCrateAvailable, unlocked: hallCrateUnlocked, remaining: hallCrateRemaining,
      used: hallCrateUsedToday, max: hallCrateDailyMax, freeToken: freeTokenForTier,
      setFreeRent(n) { freeRentCharges = n; freeCommonCharges = n; freeRareCharges = n; },
    } : null,
    setup(o) {
      cash = o.cash; peakCash = Math.max(o.peakCash || 0, cash);
      round = o.round; honeymoonEnded = !!o.honeymoonEnded;
      unlockedHalls = new Set();
      if (o.hall) for (const t of AUCTION_HALL_CFG.TIERS) { unlockedHalls.add(t.id); if (t.id === o.hall) break; }
      totalCrateOpens = o.totalCrateOpens;
      openMilestonesClaimed = new Set(OPEN_MILESTONE_CFG.MILESTONES.map((m) => m.count).filter((c) => c !== o.pendingMilestone));
      // Peak-cash milestones pay cash inside updateStats(); pre-claim so wallet deltas isolate rent.
      peakMilestonesClaimed = new Set(PEAK_MILESTONE_CFG.MILESTONES.map((m) => m.peak));
      nextCrateDiscountPct = o.discount || 0;
      freeCommonCharges = 0; freeRareCharges = 0; freeRentCharges = 0; rareBoostCharges = 0;
      keys = o.keys || 0;
      limitedOffer = o.limited ? { endAt: Date.now() + 600000 } : null;
      dailyActivityCompleted = true; dailyActivityJackpotRolled = true; dailyActivityJackpotPending = false;
      bankrupt = false;
      if (typeof hallCrateDaily !== "undefined" && !o.keepDaily) hallCrateDaily = { key: todayKeyLocal(), counts: {} };
      selectedTier = o.tier;
    },
    forceEmptyRound() { staging = []; for (const uid of [...placed.keys()]) removeFromGrid(uid); },
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
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
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
  w.sessionStorage.setItem("auctionHelpSeen", "1");
  w.console.warn = () => {}; w.console.log = () => {};
  w.eval(`Math.random = (${mulberry32.toString()})(${seed});`);
  let src = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  const end = src.lastIndexOf("})();");
  if (end < 0) throw new Error("game.js IIFE close not found");
  w.eval(src.slice(0, end) + HOOK + src.slice(end));
  if (!w.__T) throw new Error("test hook not installed");
  return w;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, max = 20000) { for (let i = 0; i < max; i++) { if (pred()) return true; await tick(); } return false; }

function greedyPack(T) {
  const gs = T.gridSize();
  for (const e of T.staging.slice().sort((a, b) => (b.valueOverride || 0) - (a.valueOverride || 0))) {
    let done = false;
    for (let rot = 0; rot < 4 && !done; rot++) for (let r = 0; r < gs && !done; r++) for (let c = 0; c < gs && !done; c++) {
      if (T.canPlace(e.defId, rot, r, c) && T.placeItem({ ...e, rot }, r, c)) {
        T.staging.splice(T.staging.findIndex((s) => s.uid === e.uid), 1); done = true;
      }
    }
  }
}

let pass = 0, fail = 0; const failures = [];
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); } }

async function openOnce(w, o) {
  const T = w.__T;
  T.setup(o);
  const expectedFee = T.effectiveTierFee(o.tier);
  const ms = T.OPEN_MILESTONE_CFG.MILESTONES.find((m) => m.count === o.pendingMilestone && o.totalCrateOpens + 1 >= m.count);
  const msCash = ms && ms.reward === "cash" ? T.openMilestoneCash(ms.cashMult || 0.5) : 0;
  const cash0 = T.cash;
  T.openCrate();
  const cashAfterOpen = T.cash;
  const ov = w.document.querySelector("#scanOverlay");
  if (ov) ov.dispatchEvent(new w.Event("pointerdown"));
  const ok = await waitFor(() => T.crateOpenedThisRound && !T.revealing);
  return { T, expectedFee, msCash, cash0, cashAfterOpen, ok };
}

async function main() {
  const probe = makeWorld(1).__T;
  const TIERS = Object.keys(probe.CRATE_TIERS);
  const HALLS = [null, ...probe.AUCTION_HALL_CFG.TIERS.map((t) => t.id)];
  const MILESTONES = probe.OPEN_MILESTONE_CFG.MILESTONES.map((m) => m.count);
  const DISC = [0, probe.PERFECT_PACK.NEXT_DISCOUNT_PCT || 0.12];
  for (const need of [5, 10, 20, 35, 50, 75, 100]) {
    if (!MILESTONES.includes(need)) console.log(`note: milestone ${need} not in OPEN_MILESTONE_CFG`);
  }
  console.log(`tiers=${TIERS.join(",")} halls=${HALLS.length} milestones=${MILESTONES.join(",")} discounts=${DISC.join(",")}`);

  let opens = 0, seed = 1000;
  for (const tier of TIERS) for (const hall of HALLS) {
    const w = makeWorld(seed++);
    const hallPeak = hall ? probe.AUCTION_HALL_CFG.TIERS.find((t) => t.id === hall).peakCash : 0;
    const modes = [{ honey: false }];
    const excl = !!probe.CRATE_TIERS[tier].exclusive;
    // Honeymoon needs cash < CASH_END (¥35k) but 厅专属柜 unlock at peak ≥ ¥40k → never both in real play.
    if (probe.tierFee(tier) * 1.2 < probe.HONEYMOON.CASH_END && tier !== "limited" && !excl) modes.push({ honey: true });
    for (const { honey } of modes) for (const m of MILESTONES) for (const d of DISC) {
      const o = {
        tier, hall, discount: d, pendingMilestone: m, totalCrateOpens: m - 1,
        cash: honey ? Math.min(probe.HONEYMOON.CASH_END - 1, Math.max(probe.tierFee(tier) * 2, 15000)) : Math.max(500000, hallPeak * 2),
        peakCash: hallPeak, round: honey ? 1 : 30, honeymoonEnded: !honey,
        limited: tier === "limited", keys: m % 2,
      };
      const tag = `[${tier} hall=${hall} ms=${m} disc=${d} honey=${honey}]`;
      const r = await openOnce(w, o);
      const T = r.T;
      opens++;
      check(r.ok, `${tag} reveal finished`);
      check(T.totalCrateOpens === m && !T.openMilestonesClaimed.has(m) === false, `${tag} milestone ${m} fired during this open`);
      check(T.paidFeeThisRound === r.expectedFee, `${tag} paidFeeThisRound ${T.paidFeeThisRound} == effective fee ${r.expectedFee}`);
      check(r.cash0 - r.cashAfterOpen + r.msCash === r.expectedFee, `${tag} wallet delta at open ${r.cash0 - r.cashAfterOpen} (+ms cash ${r.msCash}) == fee ${r.expectedFee}`);
      if (d > 0) check(T.nextCrateDiscountPct === 0, `${tag} discount consumed`);
      const n = T.staging.length + T.placed.size;
      check(n >= 1, `${tag} delivered ${n} items (≥1)`);
      greedyPack(T);
      check(T.placed.size >= 1, `${tag} ≥1 item packable`);
      const fee = T.paidFeeThisRound, before = T.cash;
      T.extract();
      check(T.extractedThisRound, `${tag} settled`);
      check(T.paidFeeThisRound === fee && T.cash > before, `${tag} no refund on a round with items; settle credited ${T.cash - before}`);
      await waitFor(() => !T.settleReplayActive, 2000);
      T.nextRound();
    }
  }

  // Forced 0-item round → settle refunds exactly the actual paid rent (after discount + hall markup)
  let refunds = 0;
  for (const tier of TIERS) for (const d of DISC) for (const hall of [null, "silver_hall"]) {
    const w = makeWorld(seed++);
    const hallPeak = hall ? probe.AUCTION_HALL_CFG.TIERS.find((t) => t.id === hall).peakCash : 0;
    const tag = `[refund ${tier} hall=${hall} disc=${d}]`;
    const r = await openOnce(w, { tier, hall, discount: d, pendingMilestone: -1, totalCrateOpens: 500, cash: 500000, peakCash: hallPeak, round: 30, honeymoonEnded: true, limited: tier === "limited" });
    const T = r.T;
    const paid = r.cash0 - r.cashAfterOpen;
    check(paid === r.expectedFee && paid > 0, `${tag} paid ${paid} == fee ${r.expectedFee}`);
    T.forceEmptyRound();
    check(T.staging.length + T.placed.size === 0, `${tag} round forced to 0 items`);
    const before = T.cash;
    T.extract();
    check(T.extractedThisRound, `${tag} settled`);
    check(T.cash - before === paid, `${tag} refund ${T.cash - before} == paid ${paid}`);
    check(r.cash0 === T.cash, `${tag} wallet back to pre-open ${r.cash0} (now ${T.cash})`);
    const feeTxt = (w.document.querySelector("#resultFee") || {}).textContent || "";
    await waitFor(() => !T.settleReplayActive, 2000);
    check(/退/.test(((w.document.querySelector("#resultFee") || {}).textContent || "") + feeTxt), `${tag} result shows refund`);
    refunds++;
  }

  // 厅专属柜: unlock / daily cap / no free tokens / hall + honeymoon invariance
  const EXCL = TIERS.filter((t) => probe.CRATE_TIERS[t].exclusive);
  let exclCases = 0;
  for (const tier of EXCL) {
    const cfg = probe.CRATE_TIERS[tier];
    const hallId = cfg.exclusive.hall;
    const peak = probe.AUCTION_HALL_CFG.TIERS.find((t) => t.id === hallId).peakCash;
    const fee = cfg.fee;
    const tag = `[excl ${tier}]`;
    check(fee > 0 && cfg.exclusive.dailyMax > 0, `${tag} has fee + dailyMax`);
    // locked below the unlock peak: nothing charged, nothing opened
    {
      const w = makeWorld(seed++); const T = w.__T;
      T.setup({ tier, hall: null, cash: peak - 1, peakCash: peak - 1, round: 30, honeymoonEnded: true, totalCrateOpens: 500, pendingMilestone: -1 });
      check(!T.hallCrate.unlocked(tier), `${tag} locked at peak ${peak - 1}`);
      const c0 = T.cash; T.openCrate();
      check(T.cash === c0 && !T.crateOpenedThisRound, `${tag} locked open refused, no charge`);
    }
    // daily cap: dailyMax paid opens, then refused; 限时柜 count untouched; lower-hall crate open in top hall
    {
      const w = makeWorld(seed++); const T = w.__T;
      const top = probe.AUCTION_HALL_CFG.TIERS[probe.AUCTION_HALL_CFG.TIERS.length - 1];
      const base = { tier, hall: top.id, cash: 2000000, peakCash: top.peakCash, round: 40, honeymoonEnded: true, totalCrateOpens: 500, pendingMilestone: -1 };
      T.setup(base);
      T.hallCrate.setFreeRent(3);
      check(T.hallCrate.freeToken(tier) === null, `${tag} free-rent tokens never apply`);
      let limDrift = 0;
      for (let k = 0; k < cfg.exclusive.dailyMax; k++) {
        T.setup(Object.assign({}, base, { keepDaily: true, cash: T.cash }));
        const lim0 = T.limitedDailyCount;
        const r = await openOnce(w, Object.assign({}, base, { keepDaily: true, cash: T.cash }));
        limDrift += T.limitedDailyCount - lim0;
        check(r.ok && r.cash0 - r.cashAfterOpen === fee, `${tag} open ${k + 1}/${cfg.exclusive.dailyMax} charged ${r.cash0 - r.cashAfterOpen} == ${fee} in ${top.id}`);
        check(T.hallCrate.used(tier) === k + 1, `${tag} daily count ${T.hallCrate.used(tier)} == ${k + 1}`);
        greedyPack(T); T.extract(); await waitFor(() => !T.settleReplayActive, 2000); T.nextRound();
      }
      check(T.hallCrate.remaining(tier) === 0 && !T.hallCrate.available(tier), `${tag} cap reached`);
      T.setup(Object.assign({}, base, { keepDaily: true, cash: T.cash }));
      const c0 = T.cash; T.openCrate();
      check(T.cash === c0 && !T.crateOpenedThisRound, `${tag} open over daily cap refused, no charge`);
      check(limDrift === 0, `${tag} 限时柜 daily count untouched by exclusive opens (drift ${limDrift})`);
    }
    // same seed → identical loot with no hall vs top hall, and with a (contrived) honeymoon state
    {
      const rolls = [];
      for (const st of [
        { hall: null, round: 30, honeymoonEnded: true, cash: 500000, peakCash: peak },
        { hall: "crimson_hall", round: 30, honeymoonEnded: true, cash: 500000, peakCash: 400000 },
        { hall: hallId, round: 1, honeymoonEnded: false, cash: 20000, peakCash: peak },
      ]) {
        const w = makeWorld(seed); const T = w.__T;
        T.setup(Object.assign({ tier, totalCrateOpens: 500, pendingMilestone: -1 }, st));
        check(T.tierFee(tier) === fee, `${tag} fixed rent ${T.tierFee(tier)} == ${fee} (hall=${st.hall} hm=${T.honeymoonActive()})`);
        w.eval(`Math.random = (${mulberry32.toString()})(4242);`);
        rolls.push(JSON.stringify(T.rollLoot(tier).map((e) => [e.defId, e.valueOverride])));
      }
      seed++;
      check(rolls[0] === rolls[1], `${tag} loot identical with/without hall bonus`);
      check(rolls[0] === rolls[2], `${tag} loot identical with honeymoon state`);
      const loot = JSON.parse(rolls[0]);
      const [lo, hi] = cfg.count; const k = Math.max(1, cfg.rolls || 1);
      check(loot.length >= lo * k && loot.length <= hi * k, `${tag} item count ${loot.length} in ${lo * k}–${hi * k}`);
      check(loot.every(([id]) => cfg.allowed.includes(probe.getDef(id).rarity)), `${tag} rarities within allowed`);
      if (cfg.shapes) check(loot.every(([id]) => cfg.shapes.includes(probe.getDef(id).shape)), `${tag} shapes within ${cfg.shapes.join("/")}`);
    }
    exclCases++;
  }

  console.log(`opens=${opens} refundCases=${refunds} exclusiveCrates=${exclCases} checks: pass=${pass} fail=${fail}`);
  if (fail) { console.log(failures.slice(0, 40).map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
  console.log("OK");
}
main().catch((e) => { console.error(e); process.exit(2); });
