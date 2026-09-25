#!/usr/bin/env node
/**
 * 厅专属柜 crate-list UI test (batch 1: 杂货柜 / 夜班柜 / 双联柜).
 *
 * Real index.html + style.css + game.js in jsdom. For each hall state (none / 青铜 / 翡翠 / 白银 / 赤金):
 *   main list = current hall's crates + next hall's crate (locked, with its unlock peak);
 *   older halls' crates only inside the collapsible「更多柜子」<details>; nothing further ahead shown.
 * Then opens every exclusive crate once through the real buttons (select → 支付租金并开箱 → reveal →
 * pack → settle), checks the daily count label, that the count survives a save → reload, and that a
 * new local day resets it. No real-money price or ad text may appear in the crate list.
 *
 * Run: npm test   (or node tests/hall_crates_ui.test.js; GAME_DIR=<dir> to test another build)
 */
"use strict";
const { makeWorld, waitFor, rendered, makeChecker } = require("./_harness");
const C = makeChecker();
const check = C.check;

const HOOK = `
  window.__T = {
    get cash() { return cash; }, get staging() { return staging; }, get placed() { return placed; },
    get revealing() { return revealing; }, get crateOpenedThisRound() { return crateOpenedThisRound; },
    get extractedThisRound() { return extractedThisRound; }, get settleReplayActive() { return settleReplayActive; },
    get paidFeeThisRound() { return paidFeeThisRound; }, get selectedTier() { return selectedTier; },
    CRATE_TIERS, AUCTION_HALL_CFG, canPlace, placeItem, extract, nextRound, updateStats, saveGame,
    hallCrateUsedToday, hallCrateRemaining, effectiveTierFee, gridSize: () => gridSize,
    get hallCrateDaily() { return hallCrateDaily; }, set hallCrateDaily(v) { hallCrateDaily = v; },
    setPeak(p, c) {
      cash = c != null ? c : Math.max(cash, 60000); peakCash = p;
      round = 40; honeymoonEnded = true;
      peakMilestonesClaimed = new Set([200000, 250000, 300000, 350000, 400000]);
      unlockedHalls = new Set(AUCTION_HALL_CFG.TIERS.filter((t) => p >= t.peakCash).map((t) => t.id));
      if (el.hallEnterModal) el.hallEnterModal.hidden = true;
      updateStats();
      if (el.hallEnterModal) el.hallEnterModal.hidden = true;
    },
  };
`;

const PRICE_AD_RE = /\\$\\s?\\d|USD|\\d\\.99|广告|内购/;

function listState(w) {
  const host = w.document.querySelector("#hallCrates");
  if (!host) return null;
  const main = [...host.querySelectorAll(":scope > .hall-crates-list .hall-crate-btn")].map((b) => b.dataset.tier);
  const more = [...host.querySelectorAll(".hall-crates-more .hall-crate-btn")].map((b) => b.dataset.tier);
  const locked = [...host.querySelectorAll(".hall-crate-btn.locked")].map((b) => b.dataset.tier);
  const details = host.querySelector(".hall-crates-more");
  return { host, main, more, locked, details };
}

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

async function main() {
  const w = makeWorld({ seed: 7, hook: HOOK });
  const T = w.__T;
  const $ = (s) => w.document.querySelector(s);
  const EXCL = Object.keys(T.CRATE_TIERS).filter((t) => T.CRATE_TIERS[t].exclusive);
  check(EXCL.length >= 3, `exclusive crates defined (${EXCL.join(",")})`);
  const hallOf = (t) => T.CRATE_TIERS[t].exclusive.hall;
  const halls = T.AUCTION_HALL_CFG.TIERS.map((h) => h.id);
  const idx = (t) => halls.indexOf(hallOf(t));

  // generic crates always present
  for (const g of ["common", "rare", "sealed"]) check(!!$(`#crateTiers .crate-btn[data-tier="${g}"]`), `generic ${g} button present`);

  const states = [
    { name: "none", peak: 20000, cur: -1 },
    { name: "bronze", peak: 40000, cur: 0 },
    { name: "jade", peak: 80000, cur: 1 },
    { name: "silver", peak: 180000, cur: 2 },
    { name: "crimson", peak: 400000, cur: 4 },
  ];
  for (const st of states) {
    T.setPeak(st.peak, st.peak);
    const L = listState(w);
    check(!!L, `[${st.name}] #hallCrates rendered`);
    if (!L) continue;
    const wantMain = EXCL.filter((t) => idx(t) === st.cur || idx(t) === st.cur + 1);
    const wantMore = EXCL.filter((t) => idx(t) < st.cur);
    const wantLocked = EXCL.filter((t) => idx(t) > st.cur && wantMain.includes(t));
    check(JSON.stringify(L.main) === JSON.stringify(wantMain), `[${st.name}] main list ${L.main} == ${wantMain}`);
    check(JSON.stringify(L.more) === JSON.stringify(wantMore), `[${st.name}] 更多柜子 ${L.more} == ${wantMore}`);
    check(JSON.stringify(L.locked) === JSON.stringify(wantLocked), `[${st.name}] locked ${L.locked} == ${wantLocked}`);
    for (const t of wantLocked) {
      const b = L.host.querySelector(`[data-tier="${t}"]`);
      check(b.disabled && /🔒/.test(b.textContent) && /解锁/.test(b.textContent), `[${st.name}] ${t} locked label «${b.textContent}»`);
    }
    for (const t of wantMain.filter((x) => !wantLocked.includes(x))) {
      const b = L.host.querySelector(`[data-tier="${t}"]`);
      const cfg = T.CRATE_TIERS[t];
      check(!b.disabled, `[${st.name}] ${t} enabled`);
      check(b.textContent.includes(cfg.name) && b.textContent.includes(cfg.flavor), `[${st.name}] ${t} shows name + flavor`);
      check(new RegExp(`今日 ${cfg.exclusive.dailyMax}/${cfg.exclusive.dailyMax}`).test(b.textContent), `[${st.name}] ${t} daily label «${b.textContent}»`);
    }
    if (wantMore.length) {
      check(!!L.details && !L.details.open, `[${st.name}] 更多柜子 collapsed by default`);
      check(/更多柜子/.test(L.details.querySelector("summary").textContent), `[${st.name}] summary text`);
      // older crates stay openable
      for (const t of wantMore) check(!L.host.querySelector(`[data-tier="${t}"]`).disabled, `[${st.name}] older ${t} still openable`);
    } else check(!L.details, `[${st.name}] no 更多柜子 when nothing older`);
    const leak = PRICE_AD_RE.test(L.host.textContent) || [...L.host.querySelectorAll("[title]")].some((n) => PRICE_AD_RE.test(n.title));
    check(!leak, `[${st.name}] no real-money price / ad text in crate list`);
  }

  // open each exclusive crate once through the real UI (silver hall: all three unlocked)
  T.setPeak(180000, 300000);
  for (const t of EXCL) {
    const cfg = T.CRATE_TIERS[t];
    let L = listState(w);
    if (L.details && L.more.includes(t)) { L.details.open = true; }
    const btn = L.host.querySelector(`[data-tier="${t}"]`);
    check(rendered(w, btn), `[open ${t}] button visible`);
    btn.click();
    check(T.selectedTier === t, `[open ${t}] selected`);
    const openBtn = $("#btnOpenCrate");
    check(!openBtn.disabled, `[open ${t}] open button enabled`);
    const cash0 = T.cash;
    const want = T.effectiveTierFee(t); // rent, or rent −12% if the previous open was a perfect pack
    check(want === cfg.fee || want === Math.round(cfg.fee * 0.88 / 50) * 50, `[open ${t}] effective fee ${want} (rent ${cfg.fee})`);
    openBtn.click();
    check(cash0 - T.cash === want && T.paidFeeThisRound === want, `[open ${t}] paid ${cash0 - T.cash} == ${want}`);
    const ov = $("#scanOverlay"); if (ov) ov.dispatchEvent(new w.Event("pointerdown"));
    check(await waitFor(() => T.crateOpenedThisRound && !T.revealing), `[open ${t}] reveal done`);
    const n = T.staging.length + T.placed.size;
    const [lo, hi] = cfg.count; const k = cfg.rolls || 1;
    check(n >= lo * k && n <= hi * k, `[open ${t}] ${n} items in ${lo * k}–${hi * k}`);
    check(T.hallCrateUsedToday(t) === 1, `[open ${t}] daily count 1`);
    greedyPack(T);
    const before = T.cash;
    $("#btnExtract").click();
    await waitFor(() => T.extractedThisRound && !T.settleReplayActive, 5000);
    check(T.extractedThisRound && T.cash > before, `[open ${t}] settled (+${T.cash - before})`);
    check(!$("#resultModal").hidden, `[open ${t}] result modal shown`);
    if (k > 1) check(/双联/.test($("#roundLog").textContent), `[open ${t}] ledger notes the 双联 batches`);
    T.nextRound();
    L = listState(w);
    const b2 = L.host.querySelector(`[data-tier="${t}"]`);
    check(new RegExp(`今日 ${cfg.exclusive.dailyMax - 1}/${cfg.exclusive.dailyMax}`).test(b2.textContent), `[open ${t}] label after open «${b2.textContent}»`);
  }
  // save → reload keeps counts; stale day resets
  T.saveGame();
  const saved = w.localStorage.getItem("deltaStashSave");
  check(saved && /hallCrateDaily/.test(saved), "save contains hallCrateDaily");
  const w2 = makeWorld({ seed: 8, hook: HOOK, storage: { deltaStashSave: saved } });
  for (const t of EXCL) check(w2.__T.hallCrateUsedToday(t) === 1, `reload keeps ${t} count`);
  const stale = JSON.parse(saved); stale.hallCrateDaily.key = "2000-01-01";
  const w3 = makeWorld({ seed: 9, hook: HOOK, storage: { deltaStashSave: JSON.stringify(stale) } });
  for (const t of EXCL) check(w3.__T.hallCrateUsedToday(t) === 0, `new day resets ${t} count`);

  C.done("hall_crates_ui");
}
main().catch((e) => { console.error(e); process.exit(2); });
