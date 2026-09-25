#!/usr/bin/env node
/**
 * 评测「重置今日次数」test.
 *
 * - Without ?eval=1 the button is NOT in the DOM at all — also when eval mode was switched on via the
 *   top-bar button / localStorage (deltaStashEval=1) but the URL has no eval=1.
 * - With ?eval=1 it sits in the eval panel (#evalTools) and one click resets every daily limit:
 *   each 厅专属柜 count, 限时柜 count (+cooldown), daily free 一键整理, 清算重整, follow-ball free retry,
 *   ad daily caps, daily quest + jackpot roll — and persists that in the save. Cash / career untouched.
 *
 * Run: npm test   (or node tests/eval_reset.test.js)
 */
"use strict";
const { makeWorld, rendered, makeChecker, waitFor } = require("./_harness");
const C = makeChecker();
const check = C.check;

const HOOK = `
  window.__T = {
    get cash() { return cash; }, get round() { return round; },
    get limitedDailyCount() { return limitedDailyCount; }, get limitedCooldownUntil() { return limitedCooldownUntil; },
    get dailyActivityCount() { return dailyActivityCount; }, get dailyActivityJackpotRolled() { return dailyActivityJackpotRolled; },
    get evalMode() { return evalMode; },
    CRATE_TIERS, hallCrateUsedToday, hallCrateRemaining, organizeFreeRemaining, restructureAvailable,
    followBallFreeRetryAvailable, todayKeyLocal,
    exhaustAll() {
      const day = todayKeyLocal();
      cash = 250000; peakCash = 250000; round = 30; honeymoonEnded = true;
      unlockedHalls = new Set(AUCTION_HALL_CFG.TIERS.filter((t) => peakCash >= t.peakCash).map((t) => t.id));
      hallCrateDaily = { key: day, counts: {} };
      for (const t of Object.keys(CRATE_TIERS)) if (CRATE_TIERS[t].exclusive) hallCrateDaily.counts[t] = CRATE_TIERS[t].exclusive.dailyMax;
      limitedDailyKey = day; limitedDailyCount = limitedDailyMax(); limitedCooldownUntil = Date.now() + 60000;
      consumeOrganizeFree(); consumeRestructure(); consumeFollowBallFreeRetry();
      localStorage.setItem(AD_DAY_KEY, JSON.stringify({ day, total: 8, byCat: { free_rent: 2 } }));
      dailyActivityKey = day; dailyActivityCount = 3; dailyActivityCompleted = true; dailyActivityJackpotRolled = true;
      updateStats();
    },
  };
`;

async function main() {
  // 1) no ?eval=1 → not rendered, even with eval mode on via localStorage / top-bar button
  for (const [name, opts] of [
    ["plain", {}],
    ["ls-eval", { storage: { deltaStashEval: "1" } }],
    ["eval=0", { url: "https://example.test/?eval=0" }],
  ]) {
    const w = makeWorld(Object.assign({ hook: HOOK, seed: 3 }, opts));
    await waitFor(() => false, 20);
    check(!w.document.getElementById("btnEvalResetDaily"), `[${name}] reset button absent`);
    if (!w.__T.evalMode) w.document.getElementById("btnEvalMode").click();
    check(w.__T.evalMode, `[${name}] eval mode on`);
    check(!w.document.getElementById("btnEvalResetDaily"), `[${name}] still absent after entering eval via top bar`);
    check(!/重置今日次数/.test(w.document.body.textContent), `[${name}] no 重置今日次数 text anywhere`);
  }

  // 2) ?eval=1 → rendered in the eval panel and resets everything
  const w = makeWorld({ hook: HOOK, seed: 4, url: "https://example.test/?eval=1" });
  const T = w.__T;
  await waitFor(() => false, 20);
  const btn = w.document.getElementById("btnEvalResetDaily");
  check(!!btn, "[eval=1] reset button exists");
  check(btn && btn.closest("#evalTools"), "[eval=1] inside #evalTools");
  check(btn && rendered(w, btn), "[eval=1] visible in the eval panel");
  check(btn && btn.textContent === "重置今日次数", "[eval=1] label");
  T.exhaustAll();
  const EXCL = Object.keys(T.CRATE_TIERS).filter((t) => T.CRATE_TIERS[t].exclusive);
  for (const t of EXCL) check(T.hallCrateRemaining(t) === 0, `[pre] ${t} used up`);
  check(T.limitedDailyCount > 0 && T.organizeFreeRemaining() === 0 && !T.restructureAvailable() && !T.followBallFreeRetryAvailable(), "[pre] other limits used up");
  const cash0 = T.cash, round0 = T.round;
  btn.click();
  for (const t of EXCL) check(T.hallCrateUsedToday(t) === 0 && T.hallCrateRemaining(t) === T.CRATE_TIERS[t].exclusive.dailyMax, `[reset] ${t} count 0`);
  check(T.limitedDailyCount === 0 && T.limitedCooldownUntil === 0, "[reset] 限时柜 count + cooldown");
  check(T.organizeFreeRemaining() === 1, "[reset] daily free organize back");
  check(T.restructureAvailable(), "[reset] 清算重整 available");
  check(T.followBallFreeRetryAvailable(), "[reset] follow-ball free retry available");
  check(!w.localStorage.getItem("deltaStashAdDaily"), "[reset] ad daily caps cleared");
  check(T.dailyActivityCount === 0 && !T.dailyActivityJackpotRolled, "[reset] daily quest + jackpot roll");
  check(T.cash === cash0 && T.round === round0, "[reset] cash / round untouched");
  const hallBtns = [...w.document.querySelectorAll("#hallCrates .hall-crate-btn:not(.locked)")];
  check(hallBtns.length > 0 && hallBtns.every((b) => !/用完/.test(b.textContent)), "[reset] crate list shows fresh counts");
  const save = JSON.parse(w.localStorage.getItem("deltaStashSave") || "{}");
  check(save.hallCrateDaily && Object.values(save.hallCrateDaily.counts || {}).every((v) => !v) && save.limitedDailyCount === 0, "[reset] persisted in save");

  C.done("eval_reset");
}
main().catch((e) => { console.error(e); process.exit(2); });
