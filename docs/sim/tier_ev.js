#!/usr/bin/env node
/**
 * delta-stash-game 经济模拟器（货柜期望值 + 节奏）。只读 game.js，不改任何游戏文件。
 *
 * 运行期按声明名从 game.js 原样抽取数据与纯掉落函数（RARITIES / CRATE_TIERS / AUCTION_HALL_CFG /
 * HONEYMOON / ITEM_DEFS / rollLoot / tierFee …），在 node:vm 沙箱里执行（状态变量用 stub），
 * Math.random 用带种子的 mulberry32，可复现。
 *
 * 用法：
 *   node docs/sim/tier_ev.js [N=10000] [--game path/to/game.js] [--quiz 0.7] [--ball 0.7]
 *                            [--pity K] [--json out.json]
 *   node docs/sim/tier_ev.js --pace [--runs 2000] [--cap 400] [--profile optimal|conservative|both]
 *                            [--game ...] [--quiz 0.7] [--hm-off] [--json out.json]
 *   环境变量 GAME_JS 同 --game。默认 game.js = ../../game.js（相对本文件）。
 *
 * 模型要点（详见 docs/sim/results.md「方法」）：
 *  - 只计装进 5×5 的货。optimal = 两种贪心（价值密度降序 / 价值降序）取售价高者；
 *    conservative = 同样两种贪心，但可用格数上限为 80%×25 = 20 格（玩家留空隙 → 装箱效率为贪心的 80%）。
 *  - 结算同 extract()：售价 = 已装货值 + 完美装箱奖励（利用率 ≥85% 或零丢弃 → +10%）。
 *  - 鉴宝：值 ≥ 门槛（¥14k）的每件货触发，50% 答题 / 50% 跟球。答题答对率 --quiz（默认 0.7），
 *    跟球成功率 --ball（默认同 --quiz）。答对 = 不变；答错 = 降一级换物件、值 ×0.42–0.54；
 *    跟球成功（≥80%）= ×1.05–1.10；跟球失败（<50%）= 45% 降级，否则 ×0.60–0.75。
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const args = process.argv.slice(2);
const argVal = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const GAME = path.resolve(argVal("--game", process.env.GAME_JS || path.join(__dirname, "../../game.js")));
const src = fs.readFileSync(GAME, "utf8").split("\n");

function extract(declRe, optional = false) {
  const i = src.findIndex((l) => declRe.test(l));
  if (i < 0) {
    if (optional) return "";
    throw new Error("decl not found: " + declRe);
  }
  let depth = 0;
  const out = [];
  for (let j = i; j < src.length; j++) {
    const l = src[j];
    out.push(l);
    const s = l.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "");
    for (const ch of s) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
    }
    if (depth <= 0) return out.join("\n");
  }
  throw new Error("unbalanced: " + declRe);
}

const DECLS = [
  /^  const RARITIES = \[/, /^  const RARITY_MAP =/, /^  const MIN_FEE =/, /^  const CRATE_TIERS = \{/,
  /^  const LIMITED_CFG = \{/, /^  const CHALLENGE_CFG = \{/,
  /^  const AUCTION_HALL_CFG = \{/, /^  const PERFECT_PACK = \{/, /^  const HONEYMOON = \{/,
  /^  const PITY_THRESHOLD =/, /^  const DEFAULT_GRID =/, /^  const SHAPES = \{/, /^  const FRIENDLY_SHAPES =/,
  /^  const AWKWARD_SHAPES =/, /^  const ITEM_DEFS = \[/, /^  const byRarity =/, /^  for \(const it of ITEM_DEFS\)/,
  /^  function poolFor\(/, /^  function nextUid\(/, /^  function getDef\(/, /^  function rotateCells\(/,
  /^  function shapeCells\(/, /^  function itemValue\(/, /^  const PITY_RARITIES =/, /^  function honeymoonActive\(/,
  /^  function honeymoonGuaranteeRarity\(/, /^  function tierFee\(/, /^  function tierValueScale\(/,
  /^  function honeymoonWeightMult\(/, /^  function pityFactor\(/, /^  function weightedPick\(/, /^  function rollLoot\(/,
  /^  function activeAuctionHall\(/, /^  function auctionHallWeightMult\(/, /^  function rareBoostFactor\(/,
  /^  function challengeValueThreshold\(/, /^  const DOWNGRADE_MAP = \{/,
];
// Present only in newer game.js (empty-crate hotfix filler); extracted if found.
const OPTIONAL_DECLS = [/^  function makeFallbackLootEntry\(/];

const code = `
"use strict";
// ---- stubbed state (neutral: no IAP boost, no discount token) ----
let round = 1, cash = 15000, honeymoonEnded = false, honeymoonGoodDropSeen = true;
let lossStreak = 0, rareBoostCharges = 0, unlockedHalls = new Set(), uidCounter = 1;
let selectedTier = null, evalMode = false, evalSoftChallenge = false, peakCash = 0;
${DECLS.map((d) => extract(d)).join("\n")}
${OPTIONAL_DECLS.map((d) => extract(d, true)).join("\n")}
globalThis.API = {
  CRATE_TIERS, AUCTION_HALL_CFG, PERFECT_PACK, HONEYMOON, SHAPES, DEFAULT_GRID, LIMITED_CFG, MIN_FEE, PITY_THRESHOLD,
  rollLoot, shapeCells, itemValue, getDef, tierFee, honeymoonActive, challengeValueThreshold, poolFor, DOWNGRADE_MAP,
  rand: () => Math.random(),
  setState(o) {
    if ("round" in o) round = o.round; if ("cash" in o) cash = o.cash;
    if ("honeymoonEnded" in o) honeymoonEnded = o.honeymoonEnded;
    if ("lossStreak" in o) lossStreak = o.lossStreak;
    if ("hall" in o) unlockedHalls = new Set(o.hall ? [o.hall] : []);
    if ("goodDropSeen" in o) honeymoonGoodDropSeen = o.goodDropSeen;
  },
  goodDropSeen: () => honeymoonGoodDropSeen,
};`;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctx = vm.createContext({ console });
vm.runInContext(code, ctx, { filename: "game_extract.js" });
const G = ctx.API;
const setSeed = (s) => vm.runInContext(`Math.random = (${mulberry32.toString()})(${s});`, ctx);
const TIERS = Object.keys(G.CRATE_TIERS); // common, rare, sealed, limited
const HALLS = G.AUCTION_HALL_CFG.TIERS.map((t) => t.id);

// ---- packing ----
const N = G.DEFAULT_GRID; // 5
const CONS_CELLS = Math.round(0.8 * N * N); // conservative: 20 usable cells
const rotCache = {};
function rotations(shape) {
  if (rotCache[shape]) return rotCache[shape];
  const seen = new Set(), out = [];
  for (let r = 0; r < 4; r++) {
    const cells = G.shapeCells(shape, r);
    const key = cells.map((c) => c.join(",")).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key); out.push(cells);
  }
  return (rotCache[shape] = out);
}
function greedyPack(items, cmp, budget) {
  const grid = Array.from({ length: N }, () => Array(N).fill(false));
  const order = items.slice().sort(cmp);
  const packed = [];
  let used = 0;
  for (const it of order) {
    if (used + it.cells > budget) continue;
    let done = false;
    for (const cells of rotations(it.shape)) {
      for (let r = 0; r < N && !done; r++) for (let c = 0; c < N && !done; c++) {
        if (cells.every(([dr, dc]) => r + dr < N && c + dc < N && !grid[r + dr][c + dc])) {
          for (const [dr, dc] of cells) grid[r + dr][c + dc] = true;
          packed.push(it); used += it.cells; done = true;
        }
      }
      if (done) break;
    }
  }
  return packed;
}
const byDensity = (a, b) => b.value / b.cells - a.value / a.cells || b.value - a.value;
const byValue = (a, b) => b.value - a.value || a.cells - b.cells;

// settle math: mirrors extract() (no virtualSlots / keepStaging)
function settle(items, packed, fee) {
  const packedValue = packed.reduce((s, p) => s + p.value, 0);
  const used = packed.reduce((s, p) => s + p.cells, 0);
  const util = used / (N * N);
  const zeroDiscard = packed.length === items.length;
  const perfect = packedValue > 0 && (util >= G.PERFECT_PACK.UTIL_THRESHOLD || zeroDiscard);
  const bonus = perfect ? Math.round(packedValue * G.PERFECT_PACK.BONUS_PCT) : 0;
  return { packedValue, bonus, sale: packedValue + bonus, perfect, pl: packedValue + bonus - fee, n: packed.length };
}
function packBest(loot, fee, profile) {
  const budget = profile === "conservative" ? CONS_CELLS : N * N;
  const a = settle(loot, greedyPack(loot, byDensity, budget), fee);
  const b = settle(loot, greedyPack(loot, byValue, budget), fee);
  return b.sale > a.sale ? b : a;
}

// ---- 鉴宝 challenges ----
function applyChallenges(loot, tier, thr, quiz, ball) {
  const R = G.rand;
  return loot.map((e) => {
    if (G.itemValue(e) < thr) return e;
    const follow = R() < 0.5;
    const pass = R() < (follow ? ball : quiz);
    const downgrade = () => {
      const def = G.getDef(e.defId);
      const nextR = G.DOWNGRADE_MAP[def.rarity] || "blue";
      const pool = G.poolFor(nextR, tier);
      const pick = pool[Math.floor(R() * pool.length)] || def;
      return { ...e, defId: pick.id, valueOverride: Math.max(80, Math.round(G.itemValue(e) * (0.42 + R() * 0.12))) };
    };
    const mult = (m) => ({ ...e, valueOverride: Math.max(80, Math.round(G.itemValue(e) * m)) });
    if (!follow) return pass ? e : downgrade();
    if (pass) return mult(1 + (0.05 + R() * 0.05));
    return R() < 0.45 ? downgrade() : mult(0.6 + R() * 0.15);
  });
}
function openOnce(tier, fee, profile, quiz, ball) {
  const thr = G.challengeValueThreshold();
  const loot = applyChallenges(G.rollLoot(tier), tier, thr, quiz, ball).map((e) => {
    const d = G.getDef(e.defId);
    return { value: G.itemValue(e), shape: d.shape, cells: G.shapeCells(d.shape, 0).length, rarity: d.rarity };
  });
  return { loot, res: packBest(loot, fee, profile) };
}

function q(sorted, p) {
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function runGroup({ tier, hall, honeymoon, n, seed, lossStreak = 0, quiz = 0.7, ball = quiz, profile = "optimal" }) {
  G.setState(honeymoon
    ? { round: 1, cash: 15000, honeymoonEnded: false, goodDropSeen: true, hall, lossStreak }
    : { round: 99, cash: 100000, honeymoonEnded: true, goodDropSeen: true, hall, lossStreak });
  setSeed(seed);
  const fee = G.tierFee(tier);
  const pls = [];
  let saleSum = 0, rawSum = 0, rolled = 0, packedN = 0, perfectN = 0, profitN = 0;
  for (let k = 0; k < n; k++) {
    const { loot, res } = openOnce(tier, fee, profile, quiz, ball);
    rawSum += loot.reduce((s, x) => s + x.value, 0);
    rolled += loot.length; packedN += res.n;
    if (res.perfect) perfectN++;
    if (res.pl > 0) profitN++;
    saleSum += res.sale; pls.push(res.pl);
  }
  pls.sort((x, y) => x - y);
  const meanSale = saleSum / n;
  return {
    tier, hall: hall || "none", honeymoon, profile, fee, n,
    ratio: meanSale / fee, pProfit: profitN / n, p10: q(pls, 0.1), median: q(pls, 0.5), p90: q(pls, 0.9),
    meanSale, meanPL: meanSale - fee, meanRaw: rawSum / n, itemsRolled: rolled / n, itemsPacked: packedN / n,
    perfectRate: perfectN / n, honeymoonActive: G.honeymoonActive(),
  };
}

// ---- pacing (whole-career Monte Carlo) ----
/**
 * Per round: bankrupt check (cash < min(common 实付, MIN_FEE)) → run ends (清算重整 rescue NOT modelled);
 * limited offer may spawn (cash ≥ LIMITED_CFG.CASH_THRESHOLD, chance = ROLL_CHANCE (+post-honeymoon bonus),
 * lasts this round only, no daily cap); pick the affordable crate with the highest expected net
 * (EV table pre-simulated for this profile per honeymoon/hall state, using the discounted fee);
 * pay → roll → 鉴宝 → pack → settle; perfect pack grants 12% off the next crate; lossStreak (soft pity)
 * tracked as in game; halls unlock by peak cash (highest active); honeymoon ends permanently once
 * round > 5 or cash ≥ ¥45k.
 */
function paceProfile(profile, { runs, cap, quiz, ball, seed, evN, hmOff = false }) {
  // EV tables: key `${hm}|${hall}` → tier → mean sale
  const ev = {};
  let s = 900001;
  for (const hm of [true, false]) for (const hall of [null, ...HALLS]) {
    const row = {};
    for (const tier of TIERS) row[tier] = runGroup({ tier, hall, honeymoon: hm, n: evN, seed: s++, quiz, ball, profile }).meanSale;
    ev[`${hm}|${hall || "none"}`] = row;
  }
  const hallCfg = G.AUCTION_HALL_CFG.TIERS;
  const L = G.LIMITED_CFG;
  const out = { profile, runs, cap, reach80: [], reach300: [], bankruptAt: [], belowCommon10: 0, belowCommonPostHM: 0, crateMix: {} };
  for (const t of TIERS) out.crateMix[t] = 0;
  setSeed(seed);
  const R = G.rand;
  for (let run = 0; run < runs; run++) {
    let cash = 15000, peak = 15000, hmEnded = hmOff, goodDrop = false, loss = 0, disc = 0, hall = null;
    let r80 = null, r300 = null, bk = null, below10 = false, belowPost = false, hmEndRound = null;
    for (let round = 1; round <= cap; round++) {
      if (!hmEnded && !(round <= 5 && cash < 45000)) { hmEnded = true; hmEndRound = round; }
      G.setState({ round, cash, honeymoonEnded: hmEnded, lossStreak: loss, hall, goodDropSeen: goodDrop });
      const eff = (tier) => {
        const f = G.tierFee(tier);
        return disc > 0 ? Math.max(0, Math.round(f * (1 - disc) / 50) * 50) : f;
      };
      const commonFee = eff("common");
      if (cash < Math.min(commonFee, G.MIN_FEE)) { bk = round; break; }
      if (round <= 10 && cash < G.tierFee("common")) below10 = true;
      if (hmEndRound != null && round >= hmEndRound && round < hmEndRound + 3 && cash < G.tierFee("common")) belowPost = true;
      let limitedOn = false;
      if (cash >= L.CASH_THRESHOLD) {
        let chance = L.ROLL_CHANCE;
        if (hmEnded && round <= G.HONEYMOON.ROUNDS + L.POST_HONEYMOON_ROUNDS) chance = Math.min(0.85, chance + L.POST_HONEYMOON_ROLL_BONUS);
        limitedOn = R() < chance;
      }
      const hmNow = G.honeymoonActive();
      const row = ev[`${hmNow}|${hall || "none"}`];
      let best = null, bestEV = -Infinity;
      for (const tier of TIERS) {
        if (tier === "limited" && !limitedOn) continue;
        const f = eff(tier);
        if (f > cash) continue;
        const e = row[tier] - f;
        if (e > bestEV) { bestEV = e; best = tier; }
      }
      if (!best) { bk = round; break; } // cannot afford anything (e.g. common > cash ≥ MIN_FEE edge)
      const fee = eff(best);
      cash -= fee; disc = 0;
      out.crateMix[best]++;
      G.setState({ cash });
      const { res } = openOnce(best, fee, profile, quiz, ball);
      goodDrop = G.goodDropSeen();
      cash += res.sale;
      if (res.perfect) disc = G.PERFECT_PACK.NEXT_DISCOUNT_PCT;
      loss = res.packedValue < fee ? loss + 1 : 0;
      if (cash > peak) peak = cash;
      for (const t of hallCfg) if (peak >= t.peakCash) hall = t.id;
      if (!hmEnded && !(round <= 5 && cash < 45000)) { hmEnded = true; hmEndRound = round + 1; }
      if (r80 == null && cash >= 80000) r80 = round;
      if (r300 == null && cash >= 300000) { r300 = round; break; }
    }
    out.reach80.push(r80); out.reach300.push(r300); out.bankruptAt.push(bk);
    if (below10) out.belowCommon10++;
    if (belowPost) out.belowCommonPostHM++;
  }
  const medianRounds = (arr) => {
    const v = arr.map((x) => (x == null ? Infinity : x)).sort((a, b) => a - b);
    const m = v[Math.floor((v.length - 1) / 2)];
    return Number.isFinite(m) ? m : null;
  };
  const reached = (arr) => arr.filter((x) => x != null);
  const total = Object.values(out.crateMix).reduce((a, b) => a + b, 0);
  return {
    profile, runs, cap, quiz, ball, hmOff,
    median80: medianRounds(out.reach80), median300: medianRounds(out.reach300),
    median80Reached: medianRounds(reached(out.reach80)), median300Reached: medianRounds(reached(out.reach300)),
    never80: out.reach80.filter((x) => x == null).length / runs, never300: out.reach300.filter((x) => x == null).length / runs,
    bankrupt: out.bankruptAt.filter((x) => x != null).length / runs,
    bankrupt10: out.bankruptAt.filter((x) => x != null && x <= 10).length / runs,
    bankrupt15: out.bankruptAt.filter((x) => x != null && x <= 15).length / runs,
    belowCommon10: out.belowCommon10 / runs, belowCommonPostHM: out.belowCommonPostHM / runs,
    crateMix: Object.fromEntries(Object.entries(out.crateMix).map(([k, v]) => [k, v / total])),
    ev,
  };
}

if (require.main === module) {
  const n = +(args.find((a, i) => /^\d+$/.test(a) && !/^--/.test(args[i - 1] || "")) || 10000);
  const jsonOut = argVal("--json", null);
  const quiz = +argVal("--quiz", 0.7);
  const ball = +argVal("--ball", quiz);
  console.error(`game.js = ${GAME}  quiz=${quiz} ball=${ball}`);
  if (args.includes("--pace")) {
    const runs = +argVal("--runs", 2000), cap = +argVal("--cap", 400), evN = +argVal("--evn", 4000);
    const prof = argVal("--profile", "both");
    const profiles = prof === "both" ? ["optimal", "conservative"] : [prof];
    const hmOff = args.includes("--hm-off"); // sensitivity only: start with honeymoon already ended
    const res = profiles.map((p, i) => paceProfile(p, { runs, cap, quiz, ball, seed: 777 + i, evN, hmOff }));
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(res, null, 1));
    const pct = (x) => (x * 100).toFixed(1) + "%";
    for (const r of res) {
      console.log(`[${r.profile}] runs=${r.runs} cap=${r.cap}  median→80k=${r.median80} (reached-only ${r.median80Reached}, never ${pct(r.never80)})` +
        `  median→300k=${r.median300} (reached-only ${r.median300Reached}, never ${pct(r.never300)})`);
      console.log(`   bankrupt=${pct(r.bankrupt)}  ≤10r=${pct(r.bankrupt10)}  ≤15r=${pct(r.bankrupt15)}  <commonRent in r1-10=${pct(r.belowCommon10)}` +
        `  <commonRent in 3r after HM=${pct(r.belowCommonPostHM)}  mix=${Object.entries(r.crateMix).map(([k, v]) => k + ":" + pct(v)).join(" ")}`);
    }
  } else {
    const pity = +argVal("--pity", 0);
    const profile = argVal("--profile", "optimal");
    const results = [];
    // Common random numbers: same seed per (honeymoon, tier) across halls → hall deltas are not seed noise.
    for (const honeymoon of [true, false]) for (const hall of [null, ...HALLS]) TIERS.forEach((tier, ti) => {
      const seed = 12345 + (honeymoon ? 0 : 100) + ti;
      results.push(runGroup({ tier, hall, honeymoon, n, seed, lossStreak: pity, quiz, ball, profile }));
    });
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
    for (const r of results) console.log(
      [r.honeymoon ? "HM" : "post", r.hall, r.tier, r.fee, r.ratio.toFixed(3), (r.pProfit * 100).toFixed(1) + "%",
       Math.round(r.p10), Math.round(r.median), Math.round(r.p90), "items " + r.itemsPacked.toFixed(2) + "/" + r.itemsRolled.toFixed(2)].join("\t"));
  }
}
module.exports = { G, runGroup, paceProfile };
