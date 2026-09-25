/**
 * 仓储拍卖 · 集装箱开箱 — offline storage-auction packing game
 */
(() => {
  "use strict";

  // Optional portal integration. The local/itch build deliberately has no SDK.
  const platform = window.DeltaStashPlatform || null;

  // ----- Rarity: 大红 > 小红 > 炎金 > 大金 > 小金 > 粉 > 紫 > 蓝 > 绿 > 白 -----
  // Clearer grade labels (品级名 · 色阶); pink/yanjin fill blue→gold→red gaps.
  const RARITIES = [
    { id: "dahong",   name: "大红·神话", color: "#ff2a2a", glow: "rgba(255,42,42,0.55)",  weightBase: 0.30 },
    { id: "xiaohong", name: "小红·传说", color: "#e85a5a", glow: "rgba(232,90,90,0.45)",  weightBase: 0.85 },
    { id: "yanjin",   name: "炎金·至臻", color: "#ff8c2a", glow: "rgba(255,140,42,0.5)",  weightBase: 1.5 },
    { id: "dajin",    name: "大金·金耀", color: "#f5c518", glow: "rgba(245,197,24,0.5)",  weightBase: 2.0 },
    { id: "xiaojin",  name: "小金·鎏金", color: "#d4a84b", glow: "rgba(212,168,75,0.4)",  weightBase: 4.0 },
    { id: "pink",     name: "粉色·绮梦", color: "#f472b6", glow: "rgba(244,114,182,0.42)", weightBase: 6.5 },
    { id: "purple",   name: "紫色·史诗", color: "#b46dff", glow: "rgba(180,109,255,0.4)", weightBase: 8.5 },
    { id: "blue",     name: "蓝色·精品", color: "#4aa3e0", glow: "rgba(74,163,224,0.35)", weightBase: 15 },
    { id: "green",    name: "绿色·良品", color: "#4ecf88", glow: "rgba(78,207,136,0.3)",  weightBase: 25 },
    { id: "white",    name: "白色·凡品", color: "#c8d0cc", glow: "rgba(200,208,204,0.25)",weightBase: 38 },
  ];
  const RARITY_MAP = Object.fromEntries(RARITIES.map((r) => [r.id, r]));
  /** Gold+ rarities for VFX / challenge logic bias (xiaojin → dahong). */
  const GOLD_PLUS_RARITIES = new Set(["xiaojin", "dajin", "yanjin", "xiaohong", "dahong"]);
  /** Wealth flex: gold outline when hall ≥ 翡翠 or career peak ≥ this. */
  const WEALTH_GOLD_PEAK = 250000;
  const BIG_GAIN_ABS = 8000; // coin-burst / jackpot display threshold (¥)

  // Economy (econ-retune, 游戏商业化 targets; value ÷ rent, packing loss + 70% 鉴宝 included, post-honeymoon):
  // 普通 1.08–1.15 (recovery crate) · 精选 1.00–1.08 · 密封 1.02–1.12 · 限时 1.05–1.15; pricier = lower P(profit),
  // recouped mainly by big hits. Tuned by pool weights only (item prices global). See docs/sim/results.md.
  /** Release id — must match index.html ?v= ×4 and version.json (npm test enforces). */
  const BUILD_VERSION = "20260925d";
  const STARTING_CASH = 15000;
  const MIN_FEE = 5000; // common fee

  const CRATE_TIERS = {
    // HARD pool cuts — tiers must feel different (paid upgrade narrative)
    // allowed: rarity ids that can drop; others weight → 0
    common: {
      id: "common", name: "普通柜", fee: 4500, count: [5, 7],
      valueScale: 1.12,
      allowed: ["white", "green", "blue", "purple", "pink"],
      // CUT: no gold/red. Recovery crate: green/blue dominant, little junk, purple/pink trimmed (low variance)
      mult: {
        dahong: 0, xiaohong: 0, yanjin: 0, dajin: 0, xiaojin: 0,
        pink: 0.08, purple: 0.2, blue: 2.3, green: 2.4, white: 0.4,
      },
    },
    rare: {
      id: "rare", name: "精选柜", fee: 13800, count: [5, 7],
      valueScale: 1.06,
      allowed: ["white", "green", "blue", "purple", "pink", "xiaojin", "dajin", "yanjin", "xiaohong"],
      // blue/purple/pink core; gold/red trimmed, white/green backfill; tiny 小红; no 大红
      mult: {
        dahong: 0, xiaohong: 0.06, yanjin: 0.16, dajin: 0.32, xiaojin: 0.9,
        pink: 1.35, purple: 1.6, blue: 1.45, green: 0.9, white: 0.7,
      },
    },
    sealed: {
      id: "sealed", name: "密封柜", fee: 30000, count: [5, 8],
      valueScale: 1.08,
      allowed: ["green", "blue", "purple", "pink", "xiaojin", "dajin", "yanjin", "xiaohong", "dahong"],
      // gold/red ≈11% of rolls (was ≈26%); green/blue backfill → usually a loss, big hits recoup
      mult: {
        dahong: 0.55, xiaohong: 0.6, yanjin: 0.7, dajin: 0.8, xiaojin: 0.8,
        pink: 1.0, purple: 1.3, blue: 1.2, green: 0.6, white: 0,
      },
    },
    // Limited-time luxury desire sink (~¥60k). Mostly blue/purple filler; 大红 share kept ≈ same (jackpot crate).
    limited: {
      id: "limited", name: "限时豪华柜", fee: 60000, count: [6, 9],
      valueScale: 1.12,
      limited: true,
      allowed: ["blue", "purple", "pink", "xiaojin", "dajin", "yanjin", "xiaohong", "dahong"],
      mult: {
        dahong: 3.0, xiaohong: 1.3, yanjin: 0.65, dajin: 0.55, xiaojin: 0.55,
        pink: 0.85, purple: 1.7, blue: 1.4, green: 0, white: 0,
      },
    },
  };

  /** Limited-offer commercialization / pacing */
  const LIMITED_CFG = {
    CASH_THRESHOLD: 38000, // mid-game: after honeymoon + a few rares / sealed
    DAILY_MAX: 4,
    COUNTDOWN_MIN_MS: 60_000,
    COUNTDOWN_MAX_MS: 180_000,
    ROLL_CHANCE: 0.50, // when eligible after settle / nextRound
    // Extra roll chance for a few rounds right after honeymoon ends
    POST_HONEYMOON_ROLL_BONUS: 0.18,
    POST_HONEYMOON_ROUNDS: 3,
    KEY_REFRESH_COST: 1,
    COOLDOWN_AFTER_EXPIRE_MS: 15_000,
  };

  /**
   * Mid-game ~¥30万 band (游戏商业化 / playtest lock).
   * Density-only: more daily quest / limited refresh — NOT huge drop-rate buffs.
   * Active when peakCash in [MID_LO, MID_HI] (hooks ~20万–40万).
   */
  const MIDGAME_CFG = {
    MID_LO: 200000,
    MID_HI: 400000,
    LIMITED_DAILY_BONUS: 2, // DAILY_MAX 4 → 6 in band
    LIMITED_ROLL_BONUS: 0.10, // +10% spawn chance (cap later)
    QUEST_EXTRA_THEMES: true,
  };

  /**
   * Value-threshold challenge: fire when a single item could swing sealed-round P/L.
   * Threshold scales with sealed rent — not rarity color. Cheap purples skip.
   */
  const CHALLENGE_CFG = {
    // Scales with sealed rent: item that can swing that round's P/L.
    // Value-threshold only (not rarity color) — cheap purples / 小金 skip.
    VALUE_FACTOR: 0.45, // 0.45×30k ≈ ¥13.5k → clamped by MIN
    MIN_VALUE: 14000,
    TIME_MS: 8000, // quiz: solvable in 5–8s; timer at upper end
    KEY_PROTECT_COST: 1,
    // Follow-ball (游戏商业化): alternate to quiz on value-threshold challenges
    FOLLOW_BALL_CHANCE: 0.5,
    FOLLOW_BALL_MS_MIN: 9000,
    FOLLOW_BALL_MS_MAX: 14000,
    FOLLOW_BALL_FREE_RETRY_DAY_KEY: "deltaStashFollowBallFreeDay",
    FOLLOW_BALL_FREE_RETRY_PER_DAY: 1, // ads-off: 1 free retry / calendar day
  };

  /**
   * Commercialization feature flags (playtest defaults).
   * Flip ADS_ENABLED to re-enable rewarded ads / daily caps UI without deleting code.
   */

  /**
   * 「贵货图鉴」— lightweight premium-item codex (游戏商业化).
   * Threshold: sealed-rent-based (same family as challenge/expensive gate).
   *   max(¥10,000, round(sealedFee × 0.35)) ≈ ¥10,500 with sealed fee ¥30k.
   * Slightly wider than live 鉴宝 MIN (¥14k / 0.45×) so the catalog stays
   * ~20 premium slots (NOT hundreds) and milestones 5 / 10 / 20 are reachable.
   * UI: silhouette until obtained; Chinese labels; localStorage via main save.
   * Rewards (each once): restart-cash chunk (RESTRUCTURE.CASH) or 1 free common
   * crate token (freeRentCharges). No ads.
   */
  const CODEX_CFG = {
    VALUE_FACTOR: 0.35,
    MIN_VALUE: 10000,
    MILESTONES: [
      { count: 5,  reward: "cash", label: "再起资金" },
      { count: 10, reward: "free_common", label: "普通柜免费券 ×1" },
      { count: 20, reward: "cash", label: "再起资金" },
    ],
  };

  /**
   * 「开箱里程碑」— total successful crate opens (游戏商业化 / locked).
   * Claim once each; auto-grant; Chinese toast; claimed flags in save.
   * No ad-double while ADS_ENABLED is off. Rewards are immediately playable.
   * 5  → cash ≈0.5× common rent
   * 10 → 1 free common crate token
   * 20 → 1 key fragment (3 fragments → 1 key)
   * 35 → 1 free rare/精选 crate token
   * 50 → 1 limited-luxury refresh (spawn/refresh 限时豪华柜)
   */
  const OPEN_MILESTONE_CFG = {
    KEY_FRAGS_PER_KEY: 3,
    MILESTONES: [
      { count: 5,  reward: "cash", cashMult: 0.5, label: "开箱津贴" },
      { count: 10, reward: "free_common", label: "普通柜免费券 ×1" },
      { count: 20, reward: "key_frag", amount: 1, label: "钥匙碎片 ×1" },
      { count: 35, reward: "free_rare", label: "精选柜免费券 ×1" },
      { count: 50, reward: "limited_refresh", label: "限时豪华柜刷新" },
      { count: 75, reward: "key_frag", amount: 2, label: "钥匙碎片 ×2" },
      { count: 100, reward: "limited_refresh", label: "限时豪华柜刷新" },
    ],
  };

  /**
   * Peak-cash content hooks around ~20万–40万 (mid playground).
   * Rewards = tokens / small cash — NOT drop-rate buffs.
   */
  const PEAK_MILESTONE_CFG = {
    MILESTONES: [
      { peak: 200000, reward: "limited_refresh", label: "中场限时刷新券 ×1" },
      { peak: 250000, reward: "key_frag", amount: 1, label: "钥匙碎片 ×1" },
      { peak: 300000, reward: "free_rare", label: "精选柜免费券 ×1" },
      { peak: 350000, reward: "limited_refresh", label: "中场限时刷新券 ×1" },
      { peak: 400000, reward: "cash", cashMult: 1.0, label: "赤金入场津贴" },
    ],
  };

  /**
   * 「高级拍卖厅」— cash-milestone easter-egg halls (游戏商业化).
   * Unlock by career peak cash (survives dips). Highest unlocked is active.
   * Mid-game lock (~¥30万): 白银 ¥180k / 铂金 ¥280k between 翡翠 and 赤金;
   * 赤金 raised to ¥400k. econ-retune: no rent markup (rentMarkupPct 0); gold/red uplift +3% (bronze) / +4% (jade→crimson)
   * so each hall's value/rent ratio sits 0 to +3pp above no-hall (common unaffected: no gold/red in its pool).
   * Documented: ¥40k / ¥80k / ¥180k / ¥280k / ¥400k.
   * Chinese flavor toast on unlock; persist unlocked ids + peakCash.
   */
  const AUCTION_HALL_CFG = {
    PREVIEW_WITHIN: 35000, // faint top-bar hint when within this of next hall
    /** Hall ids at/above this get wealth-gold outline (identity flex). */
    GOLD_OUTLINE_MIN_SKIN: "jade",
    TIERS: [
      {
        id: "bronze_hall",
        name: "青铜拍卖厅",
        peakCash: 40000,
        skinId: "bronze", // future hall-skins IAP identity
        valueRange: "约 ¥800 – ¥4万",
        toast: "隐藏通道开启：「青铜拍卖厅」——金红权重 +3%，租金不加价。",
        goldRedBoostPct: 0.03,
        rentMarkupPct: 0,
        weightMult: { xiaojin: 1.03, dajin: 1.03, yanjin: 1.03, xiaohong: 1.03, dahong: 1.03 },
      },
      {
        id: "jade_hall",
        name: "翡翠拍卖厅",
        peakCash: 80000,
        skinId: "jade",
        valueRange: "约 ¥2千 – ¥9万",
        toast: "「翡翠拍卖厅」揭幕：金红权重 +4%，租金不加价，亏本仍可能。",
        goldRedBoostPct: 0.04, // econ-retune: 5%→4% (keeps limited ≤ +3pp over no-hall)
        rentMarkupPct: 0,
        weightMult: { xiaojin: 1.04, dajin: 1.04, yanjin: 1.04, xiaohong: 1.04, dahong: 1.04 },
      },
      {
        id: "silver_hall",
        name: "白银拍卖厅",
        peakCash: 180000,
        skinId: "silver",
        valueRange: "约 ¥4千 – ¥14万",
        toast: "「白银拍卖厅」入驻中场：金红权重 +4%，租金不加价，~30万主场开启。",
        goldRedBoostPct: 0.04, // lean mid-hall uplift
        rentMarkupPct: 0,
        weightMult: { xiaojin: 1.04, dajin: 1.04, yanjin: 1.04, xiaohong: 1.04, dahong: 1.04 },
      },
      {
        id: "platinum_hall",
        name: "铂金拍卖厅",
        peakCash: 280000,
        skinId: "platinum",
        valueRange: "约 ¥6千 – ¥22万",
        toast: "「铂金拍卖厅」点亮：金红权重 +4%，租金不加价，主场密度稳步提升。",
        goldRedBoostPct: 0.04, // lean mid-hall uplift
        rentMarkupPct: 0,
        weightMult: { xiaojin: 1.04, dajin: 1.04, yanjin: 1.04, xiaohong: 1.04, dahong: 1.04 },
      },
      {
        id: "crimson_hall",
        name: "赤金拍卖厅",
        peakCash: 400000,
        skinId: "crimson",
        valueRange: "约 ¥8千 – ¥35万",
        toast: "传闻中的「赤金拍卖厅」——金红权重 +4%，租金不加价，远非稳赚。",
        goldRedBoostPct: 0.04, // econ-retune: 8%→4% so hall ratio stays 0~+3pp over no-hall
        rentMarkupPct: 0,
        weightMult: { xiaojin: 1.04, dajin: 1.04, yanjin: 1.04, xiaohong: 1.04, dahong: 1.04 },
      },
    ],
  };

  /** Rotating settle-loss consolation one-liners (display-only). */
  const LOSS_CONSOLATIONS = [
    "房东也有亏本的时候——再来一场。",
    "货不对板很正常，仓储拍卖就是这样。",
    "亏一点长点记性，下一柜也许翻本。",
    "箱子不会同情你，但下一场还在。",
    "今日手气偏冷，喝口水再开。",
    "租金已付，教训免费。",
    "大亏也是故事——小赚才是日常。",
    "别急着加码密封柜，先稳住节奏。",
  ];

  const SETTLE_FX_KEY = "deltaStashSettleFx"; // "smooth" | "fancy"
  const DAILY_BEST_KEY = "deltaStashDailyBest";

  /**
   * 每日活动：按日期哈希轮换主题，共用奖励池；完成后只抽一次低频「超级大奖」。
   * 中奖率落在 8%–15% 商业带；全屏红光可跳过（约 2–3s）；不出大红；无广告依赖。
   */
  const DAILY_ACTIVITY_CFG = {
    JACKPOT_CHANCE: 0.12, // 8%–15% commercial band; one roll per local day
    JACKPOT_AUTO_MS: 2500, // skippable 2–3s red fullscreen
    QUALIFYING_RARITIES: new Set(["blue", "purple", "pink", "xiaojin", "dajin", "yanjin", "xiaohong", "dahong"]),
    THEMES: [
      {
        id: "blue_hunter",
        name: "蓝货猎人",
        label: "今日开到蓝以上",
        target: 3,
        unit: "件",
        icon: "蓝货",
      },
      {
        id: "zero_discard",
        name: "零弃货挑战",
        label: "今日零弃货结算",
        target: 3,
        unit: "场",
        icon: "零弃",
      },
      {
        id: "limited_taste",
        name: "限时柜尝鲜",
        label: "今日开启限时柜",
        target: 1,
        unit: "次",
        icon: "限时",
      },
      {
        id: "pink_seeker",
        name: "绮梦寻踪",
        label: "今日开到粉色以上",
        target: 2,
        unit: "件",
        icon: "粉货",
      },
      {
        id: "sealed_runner",
        name: "密封柜连开",
        label: "今日开启密封柜",
        target: 2,
        unit: "次",
        icon: "密封",
      },
    ],
    /** Extra mid-game themes (~20万–40万 band) — density, not drop buffs. */
    MID_THEMES: [
      {
        id: "gold_taste",
        name: "金货试炼",
        label: "今日开到小金以上",
        target: 2,
        unit: "件",
        icon: "金货",
      },
      {
        id: "mid_limited",
        name: "中场限时热",
        label: "今日开启限时柜",
        target: 2,
        unit: "次",
        icon: "中限",
      },
      {
        id: "perfect_pack_mid",
        name: "完美装箱日",
        label: "今日完美装箱结算",
        target: 2,
        unit: "场",
        icon: "完美",
      },
    ],
  };

  const FEATURES = {
    ADS_ENABLED: !!(platform && platform.supportsRewarded && platform.supportsRewarded()),
    CHALLENGE_ENABLED: true,  // keep quiz; ad-retry hidden when ads off
    // The local build keeps stubs for testing; portal builds never expose fake purchases.
    IAP_SHOP_ENABLED: !platform || platform.provider() === "local",
    KEYS_ENABLED: true,       // key sinks still usable
    ORGANIZE_STUB_ENABLED: !platform || platform.provider() === "local",
  };

  /**
   * 完美装箱奖励 — settle bonus + one-use next-crate discount token.
   * Trigger: warehouse util ≥ UTIL_THRESHOLD OR zero discarded staging that round.
   */
  const PERFECT_PACK = {
    UTIL_THRESHOLD: 0.85,      // ≥85% fill
    BONUS_PCT: 0.10,           // +10% of packed (placed) loot value (range 8–12%)
    NEXT_DISCOUNT_PCT: 0.12,   // 12% off next crate fee, one use (range 10–15%)
  };

  /**
   * Early-game honeymoon「新手保护」: first N rounds OR until ~¥20k cash (whichever first).
   * Common/rare only — clearly positive EV, juicier mid/high loot, lighter packing pressure.
   * Soft pity / limited / challenges / ADS_ENABLED / base price table untouched.
   */
  const HONEYMOON = {
    ROUNDS: 5,                 // rounds 1..5 (product window 3–5; was ending too fast in playtest)
    CASH_END: 35000,           // econ-retune r2: ¥45k→¥35k (conservative sim still hit ¥80k < 35 rounds)
    // econ-retune round 2 targets (70% 鉴宝): common 1.30–1.45, rare 1.25–1.40, sealed/limited 1.10–1.20
    FEE_MULT: { common: 0.70, rare: 0.80 }, // ¥3,150 / ¥11,050; sealed/limited = 1.0
    VALUE_SCALE_BONUS: { common: 0, rare: 0 }, // was +0.30 / +0.24 (honeymoon ratio ~2.7 / ~2.15)
    // Mild tilt toward mid pieces (was much stronger); rent discount carries most of the honeymoon edge
    WEIGHT_MULT: {
      common: { white: 1.0, green: 1.0, blue: 1.0, purple: 1.3, pink: 1.0 },
      rare: {
        white: 0.9, green: 0.9, blue: 1.0, purple: 1.1, pink: 1.1,
        xiaojin: 1.15, dajin: 1.1, yanjin: 1.0, xiaohong: 1.0,
      },
      // 大红 is blocked in honeymoon; lift gold/小红 so sealed/limited stay ≥1.10 (econ-retune)
      sealed: { xiaojin: 1.3, dajin: 1.4, yanjin: 1.5, xiaohong: 1.6 },
      limited: { xiaojin: 1.6, dajin: 2.0, yanjin: 2.5, xiaohong: 3.5 },
    },
    JITTER: {
      common: [0.88, 1.04],
      rare: [0.93, 1.18],
    },
    // Fewer pieces → less discard pressure on 5×5 while values stay high
    COUNT: { common: [4, 6], rare: [4, 6] },
    // First eligible honeymoon open guarantees one feel-good 紫/小金 drop.
    GUARANTEE_RARITIES: ["purple", "xiaojin"],
    // 大红 is reserved for post-honeymoon / premium limited play.
    BLOCKED_RARITIES: ["dahong"],
  };

  const SAVE_KEY = "deltaStashSave";
  const HISTORY_MAX = 50;
  const PITY_THRESHOLD = 3; // soft boost after N consecutive below-cost settles
  const GRID_SIZES = [5, 6, 7, 8]; // default 5×5 — packing pressure every round
  const DEFAULT_GRID = 5;
  const EXPAND_CASH_COST = 6000; // cheaper early expands; IAP / cash (no ad expand in playtest)
  const ORGANIZE_KEY_COST = 1; // spend keys for one-shot organize if not unlocked
  const ORGANIZE_IAP_PRICE = "$0.99";
  const ORGANIZE_DAILY_FREE_QUOTA = 1;
  const ORGANIZE_FREE_DAY_KEY = "deltaStashOrganizeFreeDay";

  /**
   * 「清算重整」— soft bailout on bankrupt (游戏商业化).
   * Grant ≈ 1.2–1.5× common crate fee; pick 1.3× and document.
   * common.fee = ¥4,500 → restart cash = Math.round(4500 * 1.3) = ¥5,850
   * (enough for one post-honeymoon common open with a thin cushion).
   * Max 1 per calendar day via localStorage day key. No ads.
   */
  const RESTRUCTURE = {
    FEE_MULT: 1.3,
    get CASH() { return Math.round(CRATE_TIERS.common.fee * this.FEE_MULT); }, // 5850
    DAY_KEY: "deltaStashRestructureDay",
    DAILY_MAX: 1,
  };
  /** Playtest lock: 8 rewarded ads/day combined across 4 categories */
  const AD_DAILY_CAP = 8;
  const AD_DAY_KEY = "deltaStashAdDaily";
  const MONO_DEBUG_KEY = "deltaStashMonoDebug";

  /** Per-category daily caps (sum = AD_DAILY_CAP). limited_refresh is separate. */
  const AD_CATEGORY_CAPS = {
    free_rent: 2,       // 免费再租
    warehouse_full: 2,  // 满仓临时格 + 不弃货 (combined)
    settle_refund: 2,   // 亏本回血
    challenge_retry: 2, // 贵货守住重试
  };
  /** Limited luxury crate ad-refresh — separate from the 8 (OR 1 key) */
  const AD_LIMITED_REFRESH_CAP = 1;

  /** Rewarded-ad placement ids (stubs) */
  const AD_PLACEMENTS = {
    FREE_RENT: "ad_free_rent",
    REVEAL_NEXT: "ad_reveal_next", // disabled for playtest — do not interrupt reveal rhythm
    WAREHOUSE_TEMP: "ad_warehouse_temp",
    KEEP_STAGING: "ad_keep_staging",
    SETTLE_REFUND: "ad_settle_refund",
    LIMITED_EARLY: "ad_limited_early",
    CHALLENGE_RETRY: "ad_challenge_retry",
  };

  /** Map placement → category key (null = disabled / not in pool) */
  const AD_PLACEMENT_CATEGORY = {
    [AD_PLACEMENTS.FREE_RENT]: "free_rent",
    [AD_PLACEMENTS.WAREHOUSE_TEMP]: "warehouse_full",
    [AD_PLACEMENTS.KEEP_STAGING]: "warehouse_full",
    [AD_PLACEMENTS.SETTLE_REFUND]: "settle_refund",
    [AD_PLACEMENTS.CHALLENGE_RETRY]: "challenge_retry",
    [AD_PLACEMENTS.LIMITED_EARLY]: "limited_refresh",
    [AD_PLACEMENTS.REVEAL_NEXT]: null,
  };

  const AD_CATEGORY_LABELS = {
    free_rent: "免费再租",
    warehouse_full: "满仓",
    settle_refund: "亏本回血",
    challenge_retry: "贵货重试",
    limited_refresh: "限时刷新",
  };

  /** IAP SKU stubs — locked playtest itch dollar placeholders */
  const IAP_SKUS = [
    { id: "iap_keys_3", name: "钥匙 ×3", desc: "轻量消耗：刷新限时柜 / 贵货保级", price: "$0.99", keys: 3 },
    { id: "iap_keys_10", name: "钥匙 ×10", desc: "批量钥匙补给", price: "$2.99", keys: 10 },
    { id: "iap_warehouse_6", name: "仓库 → 6×6", desc: "从拥挤 5×5 扩到 6×6", price: "$1.99", gridMin: 6 },
    { id: "iap_warehouse_7", name: "仓库 → 7×7", desc: "永久解锁 7×7 仓库", price: "$2.99", gridMin: 7 },
    { id: "iap_warehouse_8", name: "仓库 → 8×8", desc: "永久解锁 8×8 仓库", price: "$4.99", gridMin: 8 },
    { id: "iap_rare_unit", name: "稀有柜券", desc: "下场开箱提升金/红权重（仍可能亏）", price: "$2.99", rareBoost: 1 },
    { id: "iap_speed_organize", name: "一键整理", desc: "解锁一键装箱：按价值优先自动码入仓库", price: "$0.99", speedOrganize: true, organizeUnlock: true },
    { id: "iap_protect_once", name: "单次贵货保级", desc: "鉴宝失败时保级不降（也可用 1 钥匙）", price: "$1.99", protectOnce: 1 },
  ];

  /**
   * Shape footprints for 5×5 packing pressure.
   * Friendly (普通柜 bias): 1x1 / 1x2 / 2x1 / 2x2 / 1x3 / 3x1
   * Medium/awkward (精选+): L / L2 / T / S / J / Z / U / skew / corner
   * Premium awkward (密封/限时 bias): plus / bigL / wide / fat / stair / hook / cross
   * All fit in 5×5; never require paid organize to settle (manual always possible).
   */
  const SHAPES = {
    "1x1": [[0, 0]],
    "1x2": [[0, 0], [0, 1]],
    "2x1": [[0, 0], [1, 0]],
    "2x2": [[0, 0], [0, 1], [1, 0], [1, 1]],
    "1x3": [[0, 0], [0, 1], [0, 2]],
    "3x1": [[0, 0], [1, 0], [2, 0]],
    "1x4": [[0, 0], [0, 1], [0, 2], [0, 3]],
    "4x1": [[0, 0], [1, 0], [2, 0], [3, 0]],
    "L":   [[0, 0], [1, 0], [2, 0], [2, 1]],
    "L2":  [[0, 0], [0, 1], [0, 2], [1, 0]],
    "J":   [[0, 1], [1, 1], [2, 0], [2, 1]],
    "T":   [[0, 0], [0, 1], [0, 2], [1, 1]],
    "S":   [[0, 1], [0, 2], [1, 0], [1, 1]],
    "Z":   [[0, 0], [0, 1], [1, 1], [1, 2]],
    "U":   [[0, 0], [1, 0], [1, 1], [1, 2], [0, 2]],
    "skew":[[0, 0], [1, 0], [1, 1], [2, 1]],
    "corner": [[0, 0], [0, 1], [1, 0]],
    "stair": [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
    "hook": [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
    "cross": [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1], [1, 3]],
    "plus":[[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
    "bigL":[[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2]],
    "wide":[[0, 0], [0, 1], [0, 2], [0, 3]],
    "fat": [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
  };
  /** Friendly shapes — 普通柜 pool bias (IAP: 5×5 always manually completable). */
  const FRIENDLY_SHAPES = new Set(["1x1", "1x2", "2x1", "2x2", "1x3", "3x1", "corner"]);
  /** Awkward shapes — sealed/limited bias (paid delight = discard fewer / easier perfect). */
  const AWKWARD_SHAPES = new Set(["L", "L2", "J", "T", "S", "Z", "U", "skew", "stair", "hook", "cross", "plus", "bigL", "wide", "fat", "1x4", "4x1"]);

  // Storage-auction flavored loot (original names)
  const ITEM_DEFS = [
    { id: "bolt", name: "生锈螺丝罐", icon: "🔩", shape: "1x1", rarity: "white", value: 80 },
    { id: "tape", name: "旧封箱胶带", icon: "🩹", shape: "1x2", rarity: "white", value: 120 },
    { id: "ration", name: "过期罐头", icon: "🥫", shape: "1x1", rarity: "white", value: 150 },
    { id: "mag_empty", name: "空塑料盒", icon: "⬜", shape: "1x2", rarity: "white", value: 100 },
    { id: "wire", name: "缠绕铁丝", icon: "➰", shape: "1x3", rarity: "white", value: 90 },
    { id: "bandage", name: "急救绷带卷", icon: "🩹", shape: "1x2", rarity: "green", value: 320 },
    { id: "ammo_box", name: "工具零件盒", icon: "📦", shape: "2x1", rarity: "green", value: 450 },
    { id: "flashlight", name: "工业手电", icon: "🔦", shape: "1x2", rarity: "green", value: 380 },
    { id: "gps_old", name: "旧车载导航", icon: "📍", shape: "1x1", rarity: "green", value: 500 },
    { id: "canteen", name: "保温水壶", icon: "🍶", shape: "1x2", rarity: "green", value: 280 },
    { id: "scope_low", name: "单筒望远镜", icon: "🔭", shape: "1x3", rarity: "green", value: 550 },
    { id: "medkit", name: "家用急救箱", icon: "💊", shape: "2x2", rarity: "blue", value: 1200 },
    { id: "armor_light", name: "防护护膝套", icon: "🛡️", shape: "2x2", rarity: "blue", value: 1500 },
    { id: "radio", name: "对讲机套装", icon: "📻", shape: "2x1", rarity: "blue", value: 980 },
    { id: "suppressor", name: "管道消音器", icon: "🔇", shape: "1x3", rarity: "blue", value: 1100 },
    { id: "intel_disk", name: "加密硬盘", icon: "💾", shape: "1x1", rarity: "blue", value: 1350 },
    { id: "grip", name: "电动工具握把", icon: "✊", shape: "L2", rarity: "blue", value: 1050 },
    { id: "armor_mid", name: "防撞复合板", icon: "🧱", shape: "2x2", rarity: "purple", value: 3200 },
    { id: "nvg", name: "夜视摄像模组", icon: "👁️", shape: "T", rarity: "purple", value: 3800 },
    { id: "cash_stack", name: "成捆现钞", icon: "💵", shape: "2x1", rarity: "purple", value: 4500 },
    { id: "barrel", name: "精密轴杆", icon: "📏", shape: "1x3", rarity: "purple", value: 2900 },
    { id: "drone_part", name: "航拍机零件", icon: "🛸", shape: "L", rarity: "purple", value: 3600 },
    { id: "keycard", name: "物业门禁卡", icon: "🃏", shape: "1x2", rarity: "purple", value: 5000 },
    { id: "rose_lens", name: "玫光鉴宝镜", icon: "🪞", shape: "1x1", rarity: "pink", value: 6200 },
    { id: "silk_crate", name: "绮梦绒匣", icon: "🎀", shape: "2x1", rarity: "pink", value: 6800 },
    { id: "pearl_case", name: "粉珠首饰匣", icon: "🩷", shape: "2x2", rarity: "pink", value: 7400 },
    { id: "gold_watch", name: "名牌金表", icon: "⌚", shape: "1x1", rarity: "xiaojin", value: 8200 },
    { id: "gold_bar", name: "小金砖", icon: "🟨", shape: "2x1", rarity: "xiaojin", value: 12000 },
    { id: "laser", name: "激光测距仪", icon: "🔴", shape: "1x2", rarity: "xiaojin", value: 7500 },
    { id: "thermal", name: "热成像芯", icon: "🌡️", shape: "2x2", rarity: "xiaojin", value: 9800 },
    { id: "briefcase", name: "锁死公文包", icon: "💼", shape: "S", rarity: "xiaojin", value: 11000 },
    { id: "ingot", name: "大金锭", icon: "🏆", shape: "2x2", rarity: "dajin", value: 22000 },
    { id: "proto_chip", name: "未上市芯片", icon: "💠", shape: "plus", rarity: "dajin", value: 28000 },
    { id: "heavy_plate", name: "重型合金板", icon: "🦺", shape: "fat", rarity: "dajin", value: 19500 },
    { id: "satellite", name: "卫星通讯终端", icon: "📡", shape: "T", rarity: "dajin", value: 25000 },
    { id: "ember_ingot", name: "炎金锭胚", icon: "🔶", shape: "2x1", rarity: "yanjin", value: 34000 },
    { id: "solar_flare", name: "炎芒核心", icon: "🔆", shape: "plus", rarity: "yanjin", value: 38000 },
    { id: "forge_plate", name: "锻炎合金板", icon: "🟧", shape: "fat", rarity: "yanjin", value: 36000 },
    { id: "red_case", name: "赤纹密码箱", icon: "📕", shape: "L", rarity: "xiaohong", value: 48000 },
    { id: "red_core", name: "赤心能源芯", icon: "❤️", shape: "2x2", rarity: "xiaohong", value: 55000 },
    { id: "red_intel", name: "绝密红档", icon: "📜", shape: "wide", rarity: "xiaohong", value: 42000 },
    { id: "crimson_crate", name: "绯红封印匣", icon: "💎", shape: "bigL", rarity: "dahong", value: 120000, tiers: ["sealed", "limited"] },
    { id: "apex_core", name: "穹顶核心", icon: "✴️", shape: "plus", rarity: "dahong", value: 150000, tiers: ["sealed", "limited"] },
    { id: "war_trophy", name: "拍卖场传奇藏品", icon: "⚔️", shape: "fat", rarity: "dahong", value: 135000, tiers: ["sealed", "limited"] },
    // --- tier-flavored exclusives (pool cuts) ---
    { id: "dust_rag", name: "积灰抹布捆", icon: "🧹", shape: "1x2", rarity: "white", value: 60, tiers: ["common"] },
    { id: "broken_fan", name: "坏掉的风扇", icon: "🌀", shape: "2x2", rarity: "white", value: 140, tiers: ["common"] },
    { id: "cheap_tools", name: "地摊工具袋", icon: "🧰", shape: "2x1", rarity: "green", value: 420, tiers: ["common", "rare"] },
    { id: "office_pc", name: "二手办公主机", icon: "🖥️", shape: "2x2", rarity: "blue", value: 1600, tiers: ["common", "rare"] },
    { id: "vault_frag", name: "保险柜残片", icon: "🗿", shape: "L", rarity: "purple", value: 4100, tiers: ["rare", "sealed"] },
    { id: "pink_relic", name: "绮梦残卷", icon: "📕", shape: "1x2", rarity: "pink", value: 7800, tiers: ["common", "rare", "sealed"] },
    { id: "curated_set", name: "精选藏品匣", icon: "📦", shape: "S", rarity: "xiaojin", value: 10500, tiers: ["rare", "sealed"] },
    { id: "yan_seal", name: "炎金火漆", icon: "🔏", shape: "1x1", rarity: "yanjin", value: 40000, tiers: ["sealed", "limited"] },
    { id: "sealed_relic", name: "密封柜遗产", icon: "🏺", shape: "plus", rarity: "dajin", value: 31000, tiers: ["sealed", "limited"] },
    { id: "landlord_safe", name: "房东密码金库", icon: "🏦", shape: "fat", rarity: "xiaohong", value: 62000, tiers: ["sealed", "limited"] },
    // --- limited luxury exclusives (premium desire sink) ---
    { id: "vip_ledger", name: "黑金账本", icon: "📓", shape: "1x2", rarity: "purple", value: 7200, tiers: ["limited"] },
    { id: "auction_gavel", name: "金质拍卖槌", icon: "🔨", shape: "1x3", rarity: "xiaojin", value: 16000, tiers: ["limited"] },
    { id: "vault_crown", name: "金库冠冕", icon: "👑", shape: "2x2", rarity: "dajin", value: 42000, tiers: ["limited"] },
    { id: "blood_contract", name: "血契仓单", icon: "🩸", shape: "S", rarity: "xiaohong", value: 82000, tiers: ["limited"] },
    { id: "phantom_crate", name: "幻影货柜芯", icon: "👻", shape: "plus", rarity: "dahong", value: 240000, tiers: ["limited"] },
    { id: "tycoon_seal", name: "大亨火漆印", icon: "🔏", shape: "fat", rarity: "dahong", value: 280000, tiers: ["limited"] },
    // --- catalog expansion: more kinds + medium/awkward footprints ---
    // white · friendly / light awkward
    { id: "rusty_nail_box", name: "锈钉铁盒", icon: "📎", shape: "1x1", rarity: "white", value: 70 },
    { id: "plastic_bucket", name: "开裂塑料桶", icon: "🪣", shape: "2x2", rarity: "white", value: 110 },
    { id: "old_newspaper", name: "过期报纸捆", icon: "📰", shape: "1x3", rarity: "white", value: 55 },
    { id: "bent_hanger", name: "变形衣架组", icon: "🪝", shape: "corner", rarity: "white", value: 85 },
    { id: "dusty_frame", name: "空相框堆", icon: "🖼️", shape: "2x1", rarity: "white", value: 95 },
    { id: "cable_mess", name: "缠死电源线", icon: "🔌", shape: "skew", rarity: "white", value: 75, tiers: ["common", "rare"] },
    { id: "chipped_mug", name: "缺口马克杯", icon: "☕", shape: "1x1", rarity: "white", value: 65 },
    { id: "foam_scraps", name: "泡沫碎块袋", icon: "🧊", shape: "1x2", rarity: "white", value: 50 },
    // green · mostly friendly, some medium
    { id: "multi_bit", name: "多头批头盒", icon: "🪛", shape: "1x2", rarity: "green", value: 360 },
    { id: "work_gloves", name: "耐磨手套对", icon: "🧤", shape: "corner", rarity: "green", value: 340 },
    { id: "tape_measure", name: "钢卷尺", icon: "📐", shape: "1x3", rarity: "green", value: 410 },
    { id: "paint_roller", name: "旧滚筒刷", icon: "🖌️", shape: "3x1", rarity: "green", value: 390 },
    { id: "spare_hinges", name: "合页零件袋", icon: "🔗", shape: "2x1", rarity: "green", value: 470 },
    { id: "led_strip", name: "断线灯带", icon: "💡", shape: "1x4", rarity: "green", value: 520, tiers: ["common", "rare"] },
    { id: "tool_belt", name: "半旧工具腰带", icon: "🪢", shape: "Z", rarity: "green", value: 580, tiers: ["rare", "sealed"] },
    { id: "clamp_set", name: "木工夹具组", icon: "🗜️", shape: "L2", rarity: "green", value: 610, tiers: ["rare"] },
    // blue · mix friendly + medium awkward
    { id: "dashcam", name: "行车记录仪", icon: "📹", shape: "1x2", rarity: "blue", value: 1250 },
    { id: "power_bank", name: "大容量充电宝", icon: "🔋", shape: "2x1", rarity: "blue", value: 1180 },
    { id: "router_mesh", name: "旧路由节点", icon: "📶", shape: "corner", rarity: "blue", value: 1320 },
    { id: "lock_pick_kit", name: "开锁练习套", icon: "🗝️", shape: "T", rarity: "blue", value: 1450 },
    { id: "servo_motor", name: "伺服电机", icon: "⚙️", shape: "2x2", rarity: "blue", value: 1550 },
    { id: "cable_tester", name: "网线测试仪", icon: "🧪", shape: "J", rarity: "blue", value: 1380 },
    { id: "tripod_mini", name: "迷你三脚架", icon: "📷", shape: "skew", rarity: "blue", value: 1280 },
    { id: "label_printer", name: "标签打印机", icon: "🖨️", shape: "U", rarity: "blue", value: 1680, tiers: ["rare", "sealed"] },
    { id: "bench_vise", name: "台虎钳残件", icon: "⚒️", shape: "stair", rarity: "blue", value: 1720, tiers: ["sealed"] },
    // purple · more awkward
    { id: "gyro_module", name: "陀螺仪模组", icon: "🌀", shape: "T", rarity: "purple", value: 3400 },
    { id: "carbon_plate", name: "碳纤维板材", icon: "⬛", shape: "wide", rarity: "purple", value: 3900 },
    { id: "servo_arm", name: "机械臂关节", icon: "🦾", shape: "L", rarity: "purple", value: 3700 },
    { id: "optic_bundle", name: "光纤束卷", icon: "🪢", shape: "Z", rarity: "purple", value: 3500 },
    { id: "sealed_drive", name: "加固硬盘匣", icon: "🗄️", shape: "S", rarity: "purple", value: 4300 },
    { id: "uav_wing", name: "航拍机翼板", icon: "✈️", shape: "hook", rarity: "purple", value: 4100, tiers: ["rare", "sealed"] },
    { id: "press_mold", name: "精密压模", icon: "🧱", shape: "U", rarity: "purple", value: 4600, tiers: ["sealed", "limited"] },
    { id: "signal_amp", name: "信号放大器", icon: "📡", shape: "stair", rarity: "purple", value: 4400, tiers: ["sealed"] },
    // pink · mid bridge
    { id: "velvet_pouch", name: "丝绒珠宝袋", icon: "👛", shape: "corner", rarity: "pink", value: 6400 },
    { id: "rose_clock", name: "玫金座钟", icon: "🕰️", shape: "T", rarity: "pink", value: 7100 },
    { id: "crystal_vial", name: "粉晶药瓶匣", icon: "🧴", shape: "J", rarity: "pink", value: 6900 },
    { id: "lace_frame", name: "蕾丝装裱框", icon: "🪟", shape: "U", rarity: "pink", value: 7600 },
    { id: "perfume_chest", name: "香水收藏匣", icon: "🌺", shape: "skew", rarity: "pink", value: 8000, tiers: ["rare", "sealed"] },
    { id: "ballet_box", name: "芭蕾首饰盒", icon: "🩰", shape: "stair", rarity: "pink", value: 8200, tiers: ["sealed", "limited"] },
    { id: "opal_tray", name: "蛋白石托盘", icon: "✨", shape: "Z", rarity: "pink", value: 7700 },
    // xiaojin
    { id: "gilt_compass", name: "鎏金罗盘", icon: "🧭", shape: "corner", rarity: "xiaojin", value: 8600 },
    { id: "coin_belt", name: "金币腰封", icon: "🪙", shape: "1x4", rarity: "xiaojin", value: 9200 },
    { id: "gold_lens", name: "镀金镜头", icon: "🔍", shape: "J", rarity: "xiaojin", value: 9800 },
    { id: "safe_dial", name: "金库转盘", icon: "🔐", shape: "T", rarity: "xiaojin", value: 10500 },
    { id: "gilt_chain", name: "鎏金链匣", icon: "📿", shape: "hook", rarity: "xiaojin", value: 11200, tiers: ["rare", "sealed"] },
    { id: "auction_paddle", name: "鎏金竞拍牌", icon: "🏓", shape: "skew", rarity: "xiaojin", value: 10800, tiers: ["sealed", "limited"] },
    { id: "gold_flute", name: "金管短笛", icon: "🎶", shape: "4x1", rarity: "xiaojin", value: 11500, tiers: ["sealed"] },
    // dajin
    { id: "bullion_slice", name: "金条切片", icon: "🟨", shape: "1x3", rarity: "dajin", value: 21000 },
    { id: "chrono_core", name: "金耀机芯", icon: "⏱️", shape: "plus", rarity: "dajin", value: 26000 },
    { id: "gilt_mask", name: "金面礼器", icon: "🎭", shape: "U", rarity: "dajin", value: 24500 },
    { id: "vault_keyset", name: "金库钥匙组", icon: "🔑", shape: "stair", rarity: "dajin", value: 27000, tiers: ["sealed", "limited"] },
    { id: "gold_drone", name: "镀金勘测机", icon: "🚁", shape: "cross", rarity: "dajin", value: 29000, tiers: ["limited"] },
    { id: "ingot_mold", name: "金锭模具", icon: "🪙", shape: "hook", rarity: "dajin", value: 23500, tiers: ["sealed"] },
    // yanjin
    { id: "ember_lens", name: "炎晶透镜", icon: "🟠", shape: "T", rarity: "yanjin", value: 33000 },
    { id: "flare_rod", name: "炎芒短棒", icon: "🪄", shape: "4x1", rarity: "yanjin", value: 35000 },
    { id: "magma_seal", name: "熔金印匣", icon: "🌋", shape: "U", rarity: "yanjin", value: 37000 },
    { id: "forge_hammer", name: "锻炎锤头", icon: "🔨", shape: "hook", rarity: "yanjin", value: 39000, tiers: ["sealed", "limited"] },
    { id: "solar_array", name: "炎阵列板", icon: "☀️", shape: "cross", rarity: "yanjin", value: 41000, tiers: ["limited"] },
    { id: "cinder_chest", name: "烬金宝匣", icon: "📦", shape: "stair", rarity: "yanjin", value: 36500, tiers: ["sealed"] },
    // xiaohong
    { id: "blood_lens", name: "血纹目镜", icon: "🧿", shape: "S", rarity: "xiaohong", value: 45000 },
    { id: "crimson_scroll", name: "赤卷密函", icon: "📜", shape: "wide", rarity: "xiaohong", value: 48000 },
    { id: "ruby_matrix", name: "红宝石阵列", icon: "♦️", shape: "plus", rarity: "xiaohong", value: 52000 },
    { id: "scar_contract", name: "疤面仓单", icon: "📝", shape: "Z", rarity: "xiaohong", value: 50000, tiers: ["sealed", "limited"] },
    { id: "red_hook_crate", name: "赤钩货匣", icon: "🪝", shape: "hook", rarity: "xiaohong", value: 56000, tiers: ["limited"] },
    { id: "vein_core", name: "血脉能源芯", icon: "💉", shape: "cross", rarity: "xiaohong", value: 58000, tiers: ["sealed", "limited"] },
    // dahong · awkward premium
    { id: "myth_gavel", name: "神话拍卖槌", icon: "⚖️", shape: "bigL", rarity: "dahong", value: 160000, tiers: ["sealed", "limited"] },
    { id: "void_ingot", name: "虚空赤锭", icon: "🌑", shape: "cross", rarity: "dahong", value: 175000, tiers: ["limited"] },
    { id: "omen_tablet", name: "谶纬赤碑", icon: "🗿", shape: "stair", rarity: "dahong", value: 155000, tiers: ["sealed", "limited"] },
    { id: "dragon_latch", name: "龙纹门闩", icon: "🐉", shape: "hook", rarity: "dahong", value: 168000, tiers: ["limited"] },
    // also allow sealed dahong into limited pool via tiers expansion below
  ];

  const byRarity = {};
  for (const it of ITEM_DEFS) (byRarity[it.rarity] ||= []).push(it);

  function poolFor(rarity, tierId) {
    const pool = byRarity[rarity] || [];
    const filtered = pool.filter((it) => !it.tiers || it.tiers.includes(tierId));
    return filtered.length ? filtered : pool;
  }

  // ----- State -----
  let gridSize = DEFAULT_GRID;
  let grid = [];
  let placed = new Map();
  let staging = [];
  let selectedUid = null;
  let selectedTier = null;
  let round = 1;
  let cash = STARTING_CASH;
  // Display-only cash VFX (does not affect economy math)
  let displayCash = null; // null → snap on next sync
  let cashAnimToken = 0;
  let cashFxFlags = { pulse: null, burst: false, jackpot: false, flash: null };
  let totalPnL = 0;
  let wins = 0;
  let losses = 0;
  let lossStreak = 0; // consecutive settles with lootValue < fee (soft pity / 「冷手」)
  let profitStreak = 0; // consecutive profitable settles (net >= 0) — 「热手」
  let settleReplayActive = false; // highlight before P/L SFX (skippable; fancy only)
  let settleFxMode = "smooth"; // "smooth"（流畅 default）| "fancy"（华丽）
  let lastAnnouncedHallId = null; // hall enter card shown for this id
  let openCeremony = null; // { cancel, timers, done }
  let dailyBest = null; // { day, value, defId, rarity, name, icon, tierId }
  let honeymoonEnded = false; // persisted; true once early-game boost expires
  let honeymoonGoodDropSeen = false; // persisted; guaranteed 紫/小金 already delivered
  let honeymoonEndToastShown = false;
  let historyLog = []; // { html } last HISTORY_MAX
  let paidFeeThisRound = 0;
  let crateOpenedThisRound = false;
  let extractedThisRound = false;
  let bankrupt = false;
  let uidCounter = 1;
  let revealing = false; // sequential staging reveal in progress
  // Hotfix 空柜: loot rolled by openCrate but not yet pushed to staging (persisted so a
  // reload / forced settle mid-reveal never loses paid items).
  let pendingRevealLoot = null;
  let revealGen = 0; // bumped per open / forced settle / new round → stale reveal loops stop
  let expandUses = 0; // monetization hook counter
  let keys = 0;
  let keyFragments = 0; // 3 → 1 key (开箱里程碑)
  let freeRentCharges = 0; // legacy / ad / codex free daily-tier rent
  let freeCommonCharges = 0; // 普通柜免费券（开箱里程碑）
  let freeRareCharges = 0; // 精选柜免费券（开箱里程碑）
  let limitedRefreshCharges = 0; // 限时豪华柜免费刷新次数
  let rareBoostCharges = 0;
  let keepStagingThisRound = false;
  let virtualSlots = 0; // temp +N: staging items auto-sold on settle (up to N)
  let speedOrganizeUnlocked = false;
  let lastSettleLoss = 0; // abs(net) when net < 0
  let settleRefundUsed = false;
  let protectCharges = 0; // IAP 单次贵货保级 charges
  let revealPause = null; // { resolve, entry, index } during optional ad gate
  let adOfferLogged = {}; // debounce ad_offer logs per placement per day
  let organizeFreeUsedDay = ""; // local date on which the daily free organize was used
  let nextCrateDiscountPct = 0; // persisted one-use「下一柜折扣」(0 or PERFECT_PACK.NEXT_DISCOUNT_PCT)

  // Limited-time offer: at most one active; endAt persisted for mid-session
  let limitedOffer = null; // { endAt: number } | null
  let limitedDailyCount = 0;
  let limitedDailyKey = ""; // YYYY-MM-DD local
  let limitedCooldownUntil = 0;
  let limitedTickTimer = null;

  // Value-threshold timed challenge during reveal
  let challengeActive = null; // runtime UI state
  let challengeRetryUsed = false; // per-item ad retry once

  // 贵货图鉴 — collected defIds + claimed milestone counts
  let codexCollected = new Set(); // defId strings
  let codexClaimed = new Set(); // milestone counts (5, 10, 20)

  // 开箱里程碑 — career open count + claimed flags
  let totalCrateOpens = 0;
  let openMilestonesClaimed = new Set(); // 5, 10, 20, 35, 50

  // 高级拍卖厅 — peak cash unlocks
  let peakCash = STARTING_CASH;
  let unlockedHalls = new Set(); // hall id strings
  let peakMilestonesClaimed = new Set(); // peak cash content hooks (~20万–40万)

  // 每日活动 — local-day quest and one jackpot roll, persisted with the main save
  let dailyActivityKey = "";
  let dailyActivityCount = 0;
  let dailyActivityCompleted = false;
  let dailyActivityJackpotRolled = false;
  let dailyActivityJackpotPending = false;
  let dailyJackpotTimer = null;

  const drag = {
    active: false,
    uid: null,
    from: null,
    rot: 0,
    lastCell: null,
    valid: false,
    limbo: null,
    moved: false,
    startX: 0,
    startY: 0,
    pending: null, // { uid, from, pointerId, startX, startY } — touch-friendly delay
  };

  const $ = (s) => document.querySelector(s);
  const el = {
    cashBalance: $("#cashBalance"),
    capacityText: $("#capacityText"),
    stashValue: $("#stashValue"),
    totalPnL: $("#totalPnL"),
    roundNum: $("#roundNum"),
    feePreview: $("#feePreview"),
    roundFeeChip: $("#roundFeeChip"),
    paidFeeText: $("#paidFeeText"),
    gridSizeSelect: $("#gridSizeSelect"),
    btnHelp: $("#btnHelp"),
    btnMute: $("#btnMute"),
    crateTiers: $("#crateTiers"),
    btnOpenCrate: $("#btnOpenCrate"),
    stagingArea: $("#stagingArea"),
    stagingEmpty: $("#stagingEmpty"),
    stagingCount: $("#stagingCount"),
    warehouseGrid: $("#warehouseGrid"),
    dragGhost: $("#dragGhost"),
    btnRotate: $("#btnRotate"),
    btnClearGrid: $("#btnClearGrid"),
    btnExtract: $("#btnExtract"),
    btnNextRound: $("#btnNextRound"),
    actionDesc: $("#actionDesc"),
    itemDetail: $("#itemDetail"),
    roundLog: $("#roundLog"),
    scanOverlay: $("#scanOverlay"),
    scanTitle: $("#scanTitle"),
    scanList: $("#scanList"),
    helpModal: $("#helpModal"),
    btnCloseHelp: $("#btnCloseHelp"),
    resultModal: $("#resultModal"),
    resultTitle: $("#resultTitle"),
    resultLoot: $("#resultLoot"),
    resultFee: $("#resultFee"),
    resultNet: $("#resultNet"),
    resultCash: $("#resultCash"),
    resultPerfectRow: $("#resultPerfectRow"),
    resultPerfectBonus: $("#resultPerfectBonus"),
    resultDiscountRow: $("#resultDiscountRow"),
    resultDiscount: $("#resultDiscount"),
    resultMeta: $("#resultMeta"),
    discountChip: $("#discountChip"),
    resultItems: $("#resultItems"),
    btnResultNext: $("#btnResultNext"),
    btnResultClose: $("#btnResultClose"),
    bankruptModal: $("#bankruptModal"),
    bankruptCash: $("#bankruptCash"),
    bankruptPnL: $("#bankruptPnL"),
    bankruptMeta: $("#bankruptMeta"),
    bankruptRestructureHint: $("#bankruptRestructureHint"),
    btnRestructure: $("#btnRestructure"),
    btnBankruptNewSave: $("#btnBankruptNewSave"),
    btnRestart: $("#btnRestart"),
    btnNewSave: $("#btnNewSave"),
    btnExpand: $("#btnExpand"),
    pityHint: $("#pityHint"),
    honeymoonHint: $("#honeymoonHint"),
    btnEvalMode: $("#btnEvalMode"),
    btnDataPanel: $("#btnDataPanel"),
    btnEvalClear: $("#btnEvalClear"),
    btnReportBug: $("#btnReportBug"),
    evalPanel: $("#evalPanel"),
    evalHoneymoonLine: $("#evalHoneymoonLine"),
    evalAdsLine: $("#evalAdsLine"),
    evalFxSelect: $("#evalFxSelect"),
    btnEvalCash: $("#btnEvalCash"),
    btnEvalForceBall: $("#btnEvalForceBall"),
    btnEvalSoftChallenge: $("#btnEvalSoftChallenge"),
    btnEvalPanelClose: $("#btnEvalPanelClose"),
    btnEvalExit: $("#btnEvalExit"),
    stagingPanel: $("#stagingPanel"),
    dataPanel: $("#dataPanel"),
    dataPanelList: $("#dataPanelList"),
    limitedOfferPanel: $("#limitedOfferPanel"),
    limitedOfferFee: $("#limitedOfferFee"),
    limitedOfferCountdown: $("#limitedOfferCountdown"),
    limitedOfferSelect: $("#limitedOfferSelect"),
    btnLimitedKeyRefresh: $("#btnLimitedKeyRefresh"),
    btnLimitedAdEarly: $("#btnLimitedAdEarly"),
    challengeModal: $("#challengeModal"),
    challengeItemName: $("#challengeItemName"),
    challengeItemValue: $("#challengeItemValue"),
    challengeQuestion: $("#challengeQuestion"),
    challengeChoices: $("#challengeChoices"),
    challengeTimerBar: $("#challengeTimerBar"),
    challengeTimerText: $("#challengeTimerText"),
    challengeFailActions: $("#challengeFailActions"),
    followBallWrap: $("#followBallWrap"),
    followBallArena: $("#followBallArena"),
    followBall: $("#followBall"),
    followBallMeter: $("#followBallMeter"),
    btnFollowBallSkip: $("#btnFollowBallSkip"),
    btnChallengeAdRetry: $("#btnChallengeAdRetry"),
    btnChallengeKeyProtect: $("#btnChallengeKeyProtect"),
    btnChallengeIapProtect: $("#btnChallengeIapProtect"),
    btnChallengeAcceptFail: $("#btnChallengeAcceptFail"),
    careerLine: $("#careerLine"),
    saveHint: $("#saveHint"),
    toastHost: $("#toastHost"),
    btnShop: $("#btnShop"),
    keysChip: $("#keysChip"),
    btnAdFreeRent: $("#btnAdFreeRent"),
    adCapLine: $("#adCapLine"),
    revealAdBar: $("#revealAdBar"),
    btnAdRevealNext: $("#btnAdRevealNext"),
    btnSkipRevealAd: $("#btnSkipRevealAd"),
    warehouseFullOffers: $("#warehouseFullOffers"),
    btnAdTempSlots: $("#btnAdTempSlots"),
    btnAdKeepLoot: $("#btnAdKeepLoot"),
    btnSpeedOrganize: $("#btnSpeedOrganize"),
    resultAdSlot: $("#resultAdSlot"),
    btnAdSettleRefund: $("#btnAdSettleRefund"),
    btnAdBankruptRent: $("#btnAdBankruptRent"),
    shopModal: $("#shopModal"),
    shopGrid: $("#shopGrid"),
    btnCloseShop: $("#btnCloseShop"),
    confirmModal: $("#confirmModal"),
    confirmTitle: $("#confirmTitle"),
    confirmBody: $("#confirmBody"),
    btnConfirmOk: $("#btnConfirmOk"),
    btnConfirmCancel: $("#btnConfirmCancel"),
    monoDebug: $("#monoDebug"),
    btnCodex: $("#btnCodex"),
    codexModal: $("#codexModal"),
    btnCloseCodex: $("#btnCloseCodex"),
    codexGrid: $("#codexGrid"),
    codexProgress: $("#codexProgress"),
    codexThresholdLabel: $("#codexThresholdLabel"),
    codexMilestones: $("#codexMilestones"),
    openMilestoneLine: $("#openMilestoneLine"),
    hallChip: $("#hallChip"),
    hallUnlockHint: $("#hallUnlockHint"),
    hallLine: $("#hallLine"),
    hallEnterModal: $("#hallEnterModal"),
    hallEnterCard: $("#hallEnterCard"),
    hallEnterName: $("#hallEnterName"),
    hallEnterFacts: $("#hallEnterFacts"),
    hallEnterNote: $("#hallEnterNote"),
    btnHallEnterOk: $("#btnHallEnterOk"),
    scanBox: $("#scanBox"),
    scanProgress: $("#scanProgress"),
    scanDoorBar: $("#scanDoorBar"),
    scanDoorTrack: $("#scanDoorTrack"),
    scanSkipHint: $("#scanSkipHint"),
    btnFxMode: $("#btnFxMode"),
    fxModeLabel: $("#fxModeLabel"),
    dailyBestChip: $("#dailyBestChip"),
    dailyActivityBanner: $("#dailyActivityBanner"),
    dailyActivityIcon: $("#dailyActivityIcon"),
    dailyActivityLabel: $("#dailyActivityLabel"),
    dailyActivityProgress: $("#dailyActivityProgress"),
    dailyActivityFill: $("#dailyActivityFill"),
    dailyActivityState: $("#dailyActivityState"),
    dailyJackpotOverlay: $("#dailyJackpotOverlay"),
    jackpotParticles: $("#jackpotParticles"),
    jackpotRewardText: $("#jackpotRewardText"),
  };


  // ----- Audio (Web Audio via audio.js) -----
  const FX = () => (typeof window !== "undefined" && window.AudioFX) || null;

  function fx(fn) {
    const a = FX();
    if (!a || typeof a[fn] !== "function") return;
    try { a[fn](...Array.prototype.slice.call(arguments, 1)); } catch (_) { /* ignore */ }
  }

  function syncMuteUI() {
    const a = FX();
    const btn = el.btnMute;
    if (!btn || !a) return;
    const m = a.isMuted();
    btn.classList.toggle("is-muted", m);
    btn.setAttribute("aria-pressed", m ? "true" : "false");
    const icon = btn.querySelector(".mute-icon");
    if (icon) icon.textContent = m ? "🔇" : "🔊";
    btn.title = m ? "开启音效" : "关闭音效";
  }

  function nextUid() { return "i" + uidCounter++; }
  function getDef(id) { return ITEM_DEFS.find((d) => d.id === id); }

  function rotateCells(cells, times) {
    let c = cells.map(([r, col]) => [r, col]);
    const t = ((times % 4) + 4) % 4;
    for (let i = 0; i < t; i++) {
      c = c.map(([r, col]) => [col, -r]);
      const minR = Math.min(...c.map((x) => x[0]));
      const minC = Math.min(...c.map((x) => x[1]));
      c = c.map(([r, col]) => [r - minR, col - minC]);
    }
    return c;
  }

  function shapeCells(key, rot) {
    return rotateCells(SHAPES[key] || SHAPES["1x1"], rot);
  }


  function safeSetSelectValue(selectEl, value) {
    if (!selectEl) return;
    try {
      selectEl.value = String(value);
    } catch (_) {
      try {
        const v = String(value);
        const opts = selectEl.options;
        if (!opts) return;
        for (let i = 0; i < opts.length; i++) {
          if (opts[i].value === v) {
            opts[i].selected = true;
            break;
          }
        }
      } catch (__) { /* ignore */ }
    }
  }

  function formatYen(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "¥" + Math.abs(Math.round(n)).toLocaleString("zh-CN");
  }

  function itemValue(entry) {
    if (entry.valueOverride != null) return entry.valueOverride;
    return getDef(entry.defId).value;
  }

  const PITY_RARITIES = new Set(["blue", "purple", "pink", "xiaojin", "dajin", "yanjin", "xiaohong", "dahong"]);

  /** Early-game honeymoon: comfortable EV for new players; ends by round or cash. */
  function honeymoonActive() {
    if (honeymoonEnded) return false;
    return round <= HONEYMOON.ROUNDS && cash < HONEYMOON.CASH_END;
  }

  function honeymoonGuaranteeRarity(tierId) {
    if (!honeymoonActive() || honeymoonGoodDropSeen) return null;
    const tier = CRATE_TIERS[tierId];
    if (!tier) return null;
    const available = HONEYMOON.GUARANTEE_RARITIES.filter((rarityId) => {
      if (tier.allowed && !tier.allowed.includes(rarityId)) return false;
      return poolFor(rarityId, tierId)?.length;
    });
    if (!available.length) return null;
    // Common gets 紫; higher tiers get a little extra 小金 excitement.
    if (available.includes("xiaojin") && tierId !== "common" && Math.random() < 0.65) {
      return "xiaojin";
    }
    return available[0];
  }

  function checkHoneymoonEnd() {
    if (honeymoonEnded) return false;
    if (honeymoonActive()) return false;
    honeymoonEnded = true;
    if (!honeymoonEndToastShown) {
      honeymoonEndToastShown = true;
      showToast("新手保护已结束");
      addLog("新手保护已结束 — 租金与货池回归日常经济。", false);
    }
    return true;
  }

  function tierFee(tierId) {
    const tier = CRATE_TIERS[tierId];
    if (!tier) return MIN_FEE;
    let fee = tier.fee;
    if (honeymoonActive()) {
      const m = HONEYMOON.FEE_MULT[tierId];
      if (m != null && m < 1) fee = Math.round(fee * m / 50) * 50; // snap to ¥50
    }
    // Active hall rent offsets its gold/red weight boost; discount applies after this.
    const hall = activeAuctionHall();
    if (hall && hall.rentMarkupPct > 0) fee = Math.round(fee * (1 + hall.rentMarkupPct));
    return fee;
  }

  /** Apply one-use「下一柜折扣」token on top of base/honeymoon fee. */
  function effectiveTierFee(tierId) {
    let fee = tierFee(tierId);
    if (nextCrateDiscountPct > 0) {
      fee = Math.round(fee * (1 - nextCrateDiscountPct) / 50) * 50;
      fee = Math.max(0, fee);
    }
    return fee;
  }

  function warehouseUtilRatio() {
    const total = gridSize * gridSize;
    return total > 0 ? usedCells() / total : 0;
  }

  function minPlayableFee() {
    return Math.min(effectiveTierFee("common"), MIN_FEE);
  }

  function tierValueScale(tierId) {
    const tier = CRATE_TIERS[tierId];
    let scale = tier && tier.valueScale != null ? tier.valueScale : 1;
    if (honeymoonActive()) {
      const bonus = HONEYMOON.VALUE_SCALE_BONUS[tierId];
      if (bonus) scale += bonus;
    }
    return scale;
  }

  function honeymoonWeightMult(tierId, rarityId) {
    if (!honeymoonActive()) return 1;
    if (HONEYMOON.BLOCKED_RARITIES.includes(rarityId)) return 0;
    const table = HONEYMOON.WEIGHT_MULT[tierId];
    if (!table) return 1;
    const m = table[rarityId];
    return m != null ? m : 1;
  }

  /** Soft pity: after N below-cost settles, next EV slightly above cost — NOT guaranteed red. */
  function pityFactor(rarityId) {
    if (lossStreak < PITY_THRESHOLD) return 1;
    const excess = Math.min(lossStreak - PITY_THRESHOLD + 1, 4); // 1..4
    if (!PITY_RARITIES.has(rarityId)) {
      // dampen junk (mild)
      return Math.max(0.62, 1 - excess * 0.08);
    }
    // streak 3→1.28x … 6+→1.84x — keeps existing mild feel, no free red
    return 1 + excess * 0.28;
  }

  function pityActive() {
    return lossStreak >= PITY_THRESHOLD;
  }

  function weightedPick(tierId) {
    const tier = CRATE_TIERS[tierId];
    const honeymoonBlocked = honeymoonActive() ? new Set(HONEYMOON.BLOCKED_RARITIES) : new Set();
    // Rare-unit IAP: temporarily widen pool toward gold (still not guaranteed red)
    let allow = tier.allowed ? new Set(tier.allowed) : null;
    if (rareBoostCharges > 0 && allow) {
      allow = new Set(allow);
      ["purple", "pink", "xiaojin", "dajin", "yanjin", "xiaohong"].forEach((id) => allow.add(id));
    }
    const weights = RARITIES.map((r) => {
      if (honeymoonBlocked.has(r.id)) return 0;
      if (allow && !allow.has(r.id)) return 0;
      let m = tier.mult[r.id];
      if (m == null || m <= 0) {
        // boosted leak for cut rarities
        if (rareBoostCharges > 0 && allow && allow.has(r.id)) {
          m = ({ purple: 0.8, xiaojin: 0.55, dajin: 0.28, xiaohong: 0.08 })[r.id] || 0;
        } else {
          return 0;
        }
      }
      return Math.max(0, r.weightBase * m * pityFactor(r.id) * rareBoostFactor(r.id) * honeymoonWeightMult(tierId, r.id) * auctionHallWeightMult(r.id));
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      const fallback = (allow ? [...allow] : (tier.allowed || [])).find((id) => !honeymoonBlocked.has(id));
      return fallback || "white";
    }
    let roll = Math.random() * total;
    for (let i = 0; i < RARITIES.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return RARITIES[i].id;
    }
    return RARITIES[RARITIES.length - 1].id;
  }

  function rollLoot(tierId) {
    const tier = CRATE_TIERS[tierId];
    if (!tier) return [];
    let [lo, hi] = tier.count || [3, 5];
    if (honeymoonActive() && HONEYMOON.COUNT[tierId]) {
      [lo, hi] = HONEYMOON.COUNT[tierId];
    }
    const n = Math.max(1, lo + Math.floor(Math.random() * (Math.max(hi, lo) - lo + 1)));
    const scale = tierValueScale(tierId);
    // Tier-flavored jitter: common slightly lower; sealed/limited wider swing
    let jitterLo = 0.88, jitterHi = 1.05;
    if (tierId === "rare") { jitterLo = 0.88; jitterHi = 1.08; }
    else if (tierId === "sealed") { jitterLo = 0.8; jitterHi = 1.18; }
    else if (tierId === "limited") { jitterLo = 0.75; jitterHi = 1.22; }
    else { jitterLo = 0.86; jitterHi = 1.02; }
    if (honeymoonActive() && HONEYMOON.JITTER[tierId]) {
      [jitterLo, jitterHi] = HONEYMOON.JITTER[tierId];
    }

    function makeEntry(def) {
      const jitter = jitterLo + Math.random() * (jitterHi - jitterLo);
      return {
        uid: nextUid(),
        defId: def.id,
        rot: 0,
        valueOverride: Math.round(def.value * scale * jitter),
      };
    }

    /**
     * Shape bias (游戏商业化 packing pressure):
     * 普通柜 → friendly shapes (5×5 always manually completable; organize = delight not survival)
     * 精选 → mild awkward mix
     * 密封/限时 → higher awkward-shape ratio (harder discard tradeoffs)
     */
    function pickDefFromPool(pool, tid) {
      if (!pool || !pool.length) return null;
      let preferFriendly = 0.78;
      let preferAwkward = 0.22;
      if (tid === "rare") { preferFriendly = 0.48; preferAwkward = 0.42; }
      else if (tid === "sealed") { preferFriendly = 0.22; preferAwkward = 0.68; }
      else if (tid === "limited") { preferFriendly = 0.14; preferAwkward = 0.78; }
      else { preferFriendly = 0.82; preferAwkward = 0.12; } // common
      const roll = Math.random();
      let filtered = pool;
      if (roll < preferFriendly) {
        const f = pool.filter((d) => FRIENDLY_SHAPES.has(d.shape));
        if (f.length) filtered = f;
      } else if (roll < preferFriendly + preferAwkward) {
        const a = pool.filter((d) => AWKWARD_SHAPES.has(d.shape));
        if (a.length) filtered = a;
      }
      return filtered[Math.floor(Math.random() * filtered.length)];
    }

    const items = [];
    for (let i = 0; i < n; i++) {
      const rarity = weightedPick(tierId);
      let pool = poolFor(rarity, tierId);
      if (!pool?.length) {
        // Fallback: any allowed rarity with items, then any item
        const allowed = (tier.allowed || []).slice();
        for (const r of allowed) {
          pool = poolFor(r, tierId);
          if (pool?.length) break;
        }
      }
      if (!pool?.length) pool = ITEM_DEFS;
      if (!pool?.length) continue;
      const def = pickDefFromPool(pool, tierId);
      if (!def) continue;
      items.push(makeEntry(def));
    }
    // Paid open must never yield empty staging — force ≥1 filler
    if (items.length === 0 && ITEM_DEFS.length) {
      const fallbackPool = poolFor((tier.allowed && tier.allowed[0]) || "white", tierId);
      const def = (fallbackPool && fallbackPool[0]) || ITEM_DEFS[0];
      items.push(makeEntry(def));
    }

    // Honeymoon feel-good guarantee: replace one rolled item, never add extra capacity.
    const guaranteedRarity = honeymoonGuaranteeRarity(tierId);
    if (guaranteedRarity && items.length) {
      const pool = poolFor(guaranteedRarity, tierId);
      if (pool?.length) {
        const def = pool[Math.floor(Math.random() * pool.length)];
        items[0] = makeEntry(def);
        honeymoonGoodDropSeen = true;
      }
    }
    return items;
  }

  /**
   * 垫底货 (hotfix 空柜): one cheap filler for a paid open that somehow rolled nothing.
   * Lowest allowed rarity for the tier, smallest footprint (always fits an empty 5×5),
   * value = def.value × tier valueScale (no jitter). Never used on the normal roll path,
   * so drop weights / EV are unchanged.
   */
  function makeFallbackLootEntry(tierId) {
    const tier = CRATE_TIERS[tierId] || null;
    const order = RARITIES.map((r) => r.id).reverse(); // white → dahong
    const allowed = tier && tier.allowed ? order.filter((id) => tier.allowed.includes(id)) : order;
    let pool = null;
    for (const rid of allowed) {
      pool = tier ? poolFor(rid, tierId) : byRarity[rid];
      if (pool && pool.length) break;
    }
    if (!pool || !pool.length) pool = ITEM_DEFS;
    let def = pool[0];
    let best = Infinity;
    for (const d of pool) {
      const n = SHAPES[d.shape] ? shapeCells(d.shape, 0).length : Infinity;
      if (n < best || (n === best && d.value < def.value)) { best = n; def = d; }
    }
    const scale = tier ? tierValueScale(tierId) : 1;
    return { uid: nextUid(), defId: def.id, rot: 0, valueOverride: Math.round(def.value * scale), _fallback: true };
  }

  // ----- Limited-time luxury offer -----
  function todayKeyLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** ~¥20万–40万 mid playground band (peak-based so dips keep density). */
  function inMidGameBand() {
    return peakCash >= MIDGAME_CFG.MID_LO && peakCash <= MIDGAME_CFG.MID_HI;
  }

  function limitedDailyMax() {
    let max = LIMITED_CFG.DAILY_MAX;
    if (inMidGameBand()) max += MIDGAME_CFG.LIMITED_DAILY_BONUS || 0;
    return max;
  }

  function ensureLimitedDaily() {
    const k = todayKeyLocal();
    if (limitedDailyKey !== k) {
      limitedDailyKey = k;
      limitedDailyCount = 0;
    }
  }

  function dateHash(str) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function ensureDailyActivity() {
    const k = todayKeyLocal();
    if (dailyActivityKey !== k) {
      dailyActivityKey = k;
      dailyActivityCount = 0;
      dailyActivityCompleted = false;
      dailyActivityJackpotRolled = false;
      dailyActivityJackpotPending = false;
      return true;
    }
    return false;
  }

  /** Pick today's quest theme by local-date hash (stable within the day). */
  function getDailyTheme() {
    ensureDailyActivity();
    let themes = DAILY_ACTIVITY_CFG.THEMES.slice();
    if (MIDGAME_CFG.QUEST_EXTRA_THEMES && inMidGameBand() && Array.isArray(DAILY_ACTIVITY_CFG.MID_THEMES)) {
      themes = themes.concat(DAILY_ACTIVITY_CFG.MID_THEMES);
    }
    const idx = dateHash(dailyActivityKey || todayKeyLocal()) % themes.length;
    return themes[idx];
  }

  function updateDailyActivityUI() {
    const reset = ensureDailyActivity();
    const theme = getDailyTheme();
    const target = theme.target;
    const count = Math.min(target, Math.max(0, dailyActivityCount));
    const complete = dailyActivityCompleted || count >= target;
    dailyActivityCompleted = complete;
    if (el.dailyActivityIcon) el.dailyActivityIcon.textContent = theme.icon || "今日";
    if (el.dailyActivityLabel) el.dailyActivityLabel.textContent = theme.label;
    if (el.dailyActivityProgress) {
      el.dailyActivityProgress.textContent = complete
        ? `${target} / ${target} ${theme.unit} · 已完成`
        : `${count} / ${target} ${theme.unit}`;
    }
    if (el.dailyActivityFill) {
      el.dailyActivityFill.style.width = `${Math.round((count / Math.max(1, target)) * 100)}%`;
    }
    if (el.dailyActivityBanner) {
      el.dailyActivityBanner.classList.toggle("complete", complete);
      el.dailyActivityBanner.dataset.theme = theme.id;
      el.dailyActivityBanner.title = `${theme.name} · 完成后有机会抽超级大奖`;
    }
    if (el.dailyActivityState) {
      el.dailyActivityState.textContent = complete
        ? (dailyActivityJackpotRolled ? "今日抽奖已结算" : "已完成 · 正在抽奖…")
        : `${theme.name} · 有机会抽大奖`;
    }
    if (reset) scheduleSave();
  }

  function bumpDailyActivity(amount) {
    ensureDailyActivity();
    if (dailyActivityCompleted || !(amount > 0)) return;
    const theme = getDailyTheme();
    const target = theme.target;
    dailyActivityCount = Math.min(target, dailyActivityCount + amount);
    if (dailyActivityCount >= target) {
      dailyActivityCompleted = true;
      dailyActivityJackpotPending = true;
      showToast(`${theme.name}完成！正在抽取超级大奖`, "rare");
    }
    updateDailyActivityUI();
    scheduleSave();
  }

  /** 蓝货猎人 / 绮梦寻踪 / 金货试炼：开箱掉落计入。 */
  function recordDailyActivityLoot(loot) {
    if (!Array.isArray(loot)) return;
    const tid = getDailyTheme().id;
    let gained = 0;
    for (const entry of loot) {
      const def = getDef(entry && entry.defId);
      if (!def) continue;
      if (tid === "blue_hunter" && DAILY_ACTIVITY_CFG.QUALIFYING_RARITIES.has(def.rarity)) gained += 1;
      else if (tid === "pink_seeker") {
        const order = ["pink", "xiaojin", "dajin", "yanjin", "xiaohong", "dahong"];
        if (order.includes(def.rarity)) gained += 1;
      } else if (tid === "gold_taste" && GOLD_PLUS_RARITIES.has(def.rarity)) gained += 1;
    }
    if (gained) bumpDailyActivity(gained);
  }

  /** 限时柜尝鲜 / 中场限时热：开启限时豪华柜计入。 */
  function recordDailyLimitedOpen() {
    const tid = getDailyTheme().id;
    if (tid !== "limited_taste" && tid !== "mid_limited") return;
    bumpDailyActivity(1);
  }

  /** 零弃货挑战：本场结算零遗弃暂存计入。 */
  function recordDailyZeroDiscard() {
    if (getDailyTheme().id !== "zero_discard") return;
    bumpDailyActivity(1);
  }

  /** 密封柜连开 / 完美装箱日 */
  function recordDailySealedOpen() {
    if (getDailyTheme().id !== "sealed_runner") return;
    bumpDailyActivity(1);
  }
  function recordDailyPerfectPack() {
    if (getDailyTheme().id !== "perfect_pack_mid") return;
    bumpDailyActivity(1);
  }

  function dailyJackpotReward() {
    const roll = Math.random();
    if (roll < 0.24) {
      freeCommonCharges += 1;
      return "普通柜免费券 ×1";
    }
    if (roll < 0.46) {
      freeRareCharges += 1;
      return "精选柜免费券 ×1";
    }
    if (roll < 0.68) {
      limitedRefreshCharges += 1;
      return "限时刷新券 ×1";
    }
    const amount = Math.round((5000 + Math.random() * 5000) / 500) * 500;
    cash += amount;
    queueCashFx({ burst: true, jackpot: true, flash: "red" });
    return `现金 ${formatYen(amount)}`;
  }

  function hideDailyJackpot() {
    if (dailyJackpotTimer) { clearTimeout(dailyJackpotTimer); dailyJackpotTimer = null; }
    if (el.dailyJackpotOverlay) {
      el.dailyJackpotOverlay.hidden = true;
      el.dailyJackpotOverlay.classList.remove("show");
    }
    document.body.classList.remove("daily-jackpot-open");
  }

  function showDailyJackpot(rewardText) {
    const overlay = el.dailyJackpotOverlay;
    if (!overlay) return;
    if (el.jackpotRewardText) el.jackpotRewardText.textContent = `获得：${rewardText}`;
    if (el.jackpotParticles) {
      el.jackpotParticles.innerHTML = "";
      if (!prefersReducedMotion()) {
        const colors = ["#ffe873", "#ff6f61", "#72f2c2", "#a98bff", "#ffffff"];
        const glyphs = ["✦", "◆", "★", "¥", "✹"];
        const n = isLowFx() ? 8 : 16; // was 46 — main-thread DOM storm
        const frag = document.createDocumentFragment();
        for (let i = 0; i < n; i++) {
          const particle = document.createElement("span");
          particle.className = "jackpot-particle";
          particle.textContent = glyphs[i % glyphs.length];
          particle.style.setProperty("--particle-color", colors[i % colors.length]);
          particle.style.setProperty("--particle-size", `${10 + (i % 5) * 3}px`);
          particle.style.setProperty("--particle-x", `${((i * 37) % 100) - 50}vw`);
          particle.style.setProperty("--particle-y", `${((i * 53) % 90) - 45}vh`);
          particle.style.setProperty("--particle-delay", `${(i % 6) * 0.04}s`);
          frag.appendChild(particle);
        }
        el.jackpotParticles.appendChild(frag);
      }
    }
    overlay.hidden = false;
    overlay.classList.remove("show");
    void overlay.offsetWidth;
    overlay.classList.add("show");
    document.body.classList.add("daily-jackpot-open");
    fx("rarityFanfare", "dahong");
    screenFlash("red");
    dailyJackpotTimer = setTimeout(hideDailyJackpot, DAILY_ACTIVITY_CFG.JACKPOT_AUTO_MS || 2500);
  }

  function maybeTriggerDailyJackpot() {
    ensureDailyActivity();
    if (!dailyActivityJackpotPending || dailyActivityJackpotRolled) return;
    dailyActivityJackpotPending = false;
    dailyActivityJackpotRolled = true;
    updateDailyActivityUI();
    const won = Math.random() < DAILY_ACTIVITY_CFG.JACKPOT_CHANCE;
    if (!won) {
      showToast("今日挑战完成，但超级大奖擦肩而过", "rare");
      scheduleSave();
      return;
    }
    const reward = dailyJackpotReward();
    showToast(`超级大奖到账：${reward}`, "jackpot");
    showDailyJackpot(reward);
    updateStats();
    scheduleSave();
  }

  function challengeValueThreshold() {
    const sealedFee = (CRATE_TIERS.sealed && CRATE_TIERS.sealed.fee) || 30000;
    // Keys: MIN_VALUE / VALUE_FACTOR (were briefly mistyped → NaN → never challenge)
    let thr = Math.max(CHALLENGE_CFG.MIN_VALUE, Math.round(sealedFee * CHALLENGE_CFG.VALUE_FACTOR));
    if (evalMode && evalSoftChallenge) {
      thr = Math.min(thr, 8000); // eval: cheaper sealed packs can still hit 鉴宝
    }
    return thr;
  }

  /** 贵货图鉴 threshold — sealed-rent-based (see CODEX_CFG). */
  function codexValueThreshold() {
    const sealedFee = (CRATE_TIERS.sealed && CRATE_TIERS.sealed.fee) || 30000;
    return Math.max(CODEX_CFG.MIN_VALUE, Math.round(sealedFee * CODEX_CFG.VALUE_FACTOR));
  }

  function codexCatalog() {
    const thr = codexValueThreshold();
    return ITEM_DEFS
      .filter((d) => d.value >= thr)
      .slice()
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh"));
  }

  function tryUnlockCodex(defId) {
    const def = getDef(defId);
    if (!def || def.value < codexValueThreshold()) return false;
    if (codexCollected.has(defId)) return false;
    codexCollected.add(defId);
    const n = codexCollected.size;
    showToast(`图鉴收录：${def.icon} ${def.name}（${n}/${codexCatalog().length}）`);
    addLog(`贵货图鉴收录 <strong>${def.name}</strong>（${n}/${codexCatalog().length}）`);
    renderCodexModal();
    scheduleSave();
    return true;
  }

  function codexRewardCashAmount() {
    return RESTRUCTURE.CASH;
  }

  function claimCodexMilestone(count) {
    const ms = CODEX_CFG.MILESTONES.find((m) => m.count === count);
    if (!ms) return;
    if (codexClaimed.has(count)) {
      showToast("该里程碑奖励已领取");
      return;
    }
    if (codexCollected.size < count) {
      showToast(`还需收录 ${count - codexCollected.size} 件贵货`);
      return;
    }
    codexClaimed.add(count);
    if (ms.reward === "free_common") {
      freeCommonCharges += 1;
      showToast("已获得普通柜免费券 ×1");
      addLog(`图鉴里程碑 ${count}：获得<strong>普通柜免费券 ×1</strong>`);
      updateFreeRentOffer();
      updateCrateButtons();
      updateFeePreview();
    } else {
      const amt = codexRewardCashAmount();
      cash += amt;
      queueCashFx({ pulse: "milestone", burst: true, flash: "gold" });
      showToast(`已领取再起资金 ${formatYen(amt)}`, "success");
      addLog(`图鉴里程碑 ${count}：领取再起资金 <strong>${formatYen(amt)}</strong>`);
    }
    updateStats();
    renderCodexModal();
    scheduleSave();
  }

  function renderCodexModal() {
    renderOpenMilestoneLine();
    updateHallUI();
    if (!el.codexGrid) return;
    const catalog = codexCatalog();
    const thr = codexValueThreshold();
    const got = catalog.filter((d) => codexCollected.has(d.id)).length;
    if (el.codexProgress) {
      el.codexProgress.textContent = `已收录 ${got} / ${catalog.length}`;
    }
    if (el.codexThresholdLabel) {
      el.codexThresholdLabel.textContent =
        `收录门槛 ${formatYen(thr)}（密封柜租金 ×${CODEX_CFG.VALUE_FACTOR}，与鉴宝贵货同族）`;
    }
    el.codexGrid.innerHTML = "";
    for (const def of catalog) {
      const known = codexCollected.has(def.id);
      const rar = RARITY_MAP[def.rarity];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "codex-card" + (known ? " revealed" : " silhouette");
      card.dataset.id = def.id;
      if (known) {
        card.style.setProperty("--rar", rar.color);
        card.innerHTML = `
          <span class="codex-icon">${def.icon}</span>
          <span class="codex-name">${def.name}</span>
          <span class="codex-meta" style="color:${rar.color}">${rar.name}</span>
          <span class="codex-val">${formatYen(def.value)}</span>`;
        card.title = `${def.name} · ${rar.name} · 基价 ${formatYen(def.value)}`;
      } else {
        card.innerHTML = `
          <span class="codex-icon silhouette-glyph">?</span>
          <span class="codex-name">未收录</span>
          <span class="codex-meta">贵货</span>
          <span class="codex-val">????</span>`;
        card.title = "尚未获得该贵货";
      }
      el.codexGrid.appendChild(card);
    }
    if (el.codexMilestones) {
      el.codexMilestones.innerHTML = "";
      for (const ms of CODEX_CFG.MILESTONES) {
        const row = document.createElement("div");
        row.className = "codex-ms-row";
        const claimed = codexClaimed.has(ms.count);
        const ready = !claimed && codexCollected.size >= ms.count;
        const rewardTxt = ms.reward === "free_common"
          ? "普通柜免费券 ×1"
          : `再起资金 ${formatYen(codexRewardCashAmount())}`;
        row.innerHTML = `
          <div class="codex-ms-info">
            <strong>收录 ${ms.count} 件</strong>
            <span>${rewardTxt}</span>
          </div>`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn" + (ready ? " accent" : " ghost");
        btn.disabled = claimed || !ready;
        btn.textContent = claimed ? "已领取" : ready ? "领取" : `差 ${Math.max(0, ms.count - codexCollected.size)}`;
        btn.addEventListener("click", () => {
          fx("uiClick");
          claimCodexMilestone(ms.count);
        });
        row.appendChild(btn);
        el.codexMilestones.appendChild(row);
      }
    }
  }

  function openCodexModal() {
    renderCodexModal();
    if (el.codexModal) el.codexModal.hidden = false;
  }

  function closeCodexModal() {
    if (el.codexModal) el.codexModal.hidden = true;
  }

  function openMilestoneCash(mult) {
    return Math.round(CRATE_TIERS.common.fee * mult);
  }

  function grantKeyFragment(n) {
    const add = Math.max(1, n | 0);
    keyFragments += add;
    const need = OPEN_MILESTONE_CFG.KEY_FRAGS_PER_KEY || 3;
    let forged = 0;
    while (keyFragments >= need) {
      keyFragments -= need;
      keys += 1;
      forged += 1;
    }
    updateKeysUI();
    if (forged > 0) {
      showToast(`钥匙碎片合成：钥匙 ×${forged}（碎片 ${keyFragments}/${need}）`);
    } else {
      showToast(`获得钥匙碎片 ×${add}（${keyFragments}/${need}）`);
    }
    return forged;
  }

  function grantLimitedLuxuryRefresh() {
    // Immediately playable: refresh active timer or spawn a new limited offer
    const span =
      LIMITED_CFG.COUNTDOWN_MIN_MS +
      Math.floor(Math.random() * (LIMITED_CFG.COUNTDOWN_MAX_MS - LIMITED_CFG.COUNTDOWN_MIN_MS + 1));
    if (limitedOfferActive()) {
      limitedOffer.endAt = Date.now() + span;
      limitedCooldownUntil = 0;
      showToast("限时豪华柜已刷新倒计时");
      setActionDesc(`限时货柜倒计时已刷新：租金 ${formatYen(CRATE_TIERS.limited.fee)}，抓紧开箱。`);
      updateLimitedOfferUI();
      scheduleSave();
      return true;
    }
    const ok = spawnLimitedOffer(true);
    if (!ok) {
      // Soft fallback: bank a charge (e.g. mid-reveal) — still playable soon
      limitedRefreshCharges += 1;
      showToast("已获得限时豪华柜刷新券 ×1");
    }
    return ok;
  }

  function applyOpenMilestoneReward(ms) {
    if (ms.reward === "cash") {
      const amt = openMilestoneCash(ms.cashMult || 0.5);
      cash += amt;
      queueCashFx({ pulse: "milestone", burst: true, flash: "gold" });
      showToast(`开箱里程碑 ${ms.count}：津贴 ${formatYen(amt)}`, "success");
      addLog(`开箱里程碑 ${ms.count}：津贴 <strong>${formatYen(amt)}</strong>`);
    } else if (ms.reward === "free_common") {
      freeCommonCharges += 1;
      showToast(`开箱里程碑 ${ms.count}：普通柜免费券 ×1`);
      addLog(`开箱里程碑 ${ms.count}：获得<strong>普通柜免费券 ×1</strong>`);
    } else if (ms.reward === "free_rare") {
      freeRareCharges += 1;
      showToast(`开箱里程碑 ${ms.count}：精选柜免费券 ×1`);
      addLog(`开箱里程碑 ${ms.count}：获得<strong>精选柜免费券 ×1</strong>`);
    } else if (ms.reward === "key_frag") {
      addLog(`开箱里程碑 ${ms.count}：获得<strong>钥匙碎片 ×${ms.amount || 1}</strong>`);
      grantKeyFragment(ms.amount || 1);
    } else if (ms.reward === "limited_refresh") {
      addLog(`开箱里程碑 ${ms.count}：获得<strong>限时豪华柜刷新</strong>`);
      grantLimitedLuxuryRefresh();
    }
    updateStats();
    updateCrateButtons();
    updateFeePreview();
    updateFreeRentOffer();
    updateKeysUI();
    updateLimitedOfferUI();
  }

  /** Auto-claim open milestones once each when total opens crosses threshold. */
  function checkOpenMilestones() {
    let any = false;
    for (const ms of OPEN_MILESTONE_CFG.MILESTONES) {
      if (openMilestonesClaimed.has(ms.count)) continue;
      if (totalCrateOpens < ms.count) continue;
      openMilestonesClaimed.add(ms.count);
      applyOpenMilestoneReward(ms);
      any = true;
    }
    if (any) {
      renderCodexModal();
      scheduleSave();
    }
  }

  function renderOpenMilestoneLine() {
    if (!el.openMilestoneLine) return;
    const parts = OPEN_MILESTONE_CFG.MILESTONES.map((ms) => {
      const done = openMilestonesClaimed.has(ms.count);
      return `<span class="om-chip${done ? " done" : ""}">${ms.count}${done ? "✓" : ""}</span>`;
    });
    el.openMilestoneLine.innerHTML =
      `<span class="om-label">累计开箱 <strong>${totalCrateOpens}</strong></span>` +
      `<span class="om-chips">${parts.join("")}</span>` +
      (freeCommonCharges || freeRareCharges || limitedRefreshCharges || keyFragments
        ? `<span class="om-tokens">券：普${freeCommonCharges}·精${freeRareCharges}·刷${limitedRefreshCharges} · 碎片${keyFragments}/${OPEN_MILESTONE_CFG.KEY_FRAGS_PER_KEY}</span>`
        : "");
  }

  function auctionHallById(id) {
    return AUCTION_HALL_CFG.TIERS.find((t) => t.id === id) || null;
  }

  /** Highest unlocked hall (by peakCash threshold order). */
  function activeAuctionHall() {
    let best = null;
    for (const t of AUCTION_HALL_CFG.TIERS) {
      if (unlockedHalls.has(t.id)) best = t;
    }
    return best;
  }

  function auctionHallWeightMult(rarityId) {
    const hall = activeAuctionHall();
    if (!hall || !hall.weightMult) return 1;
    const m = hall.weightMult[rarityId];
    return typeof m === "number" && m > 0 ? m : 1;
  }

  function notePeakCash() {
    if (cash > peakCash) peakCash = cash;
  }

  function applyPeakMilestoneReward(ms) {
    if (ms.reward === "cash") {
      const amt = openMilestoneCash(ms.cashMult || 1);
      cash += amt;
      queueCashFx({ pulse: "milestone", burst: true, flash: "gold" });
      showToast(`峰值里程碑 ${formatYen(ms.peak)}：${ms.label} ${formatYen(amt)}`, "success");
      addLog(`峰值里程碑 ${formatYen(ms.peak)}：<strong>${ms.label}</strong> ${formatYen(amt)}`);
    } else if (ms.reward === "free_rare") {
      freeRareCharges += 1;
      showToast(`峰值里程碑 ${formatYen(ms.peak)}：${ms.label}`);
      addLog(`峰值里程碑 ${formatYen(ms.peak)}：获得<strong>${ms.label}</strong>`);
    } else if (ms.reward === "key_frag") {
      addLog(`峰值里程碑 ${formatYen(ms.peak)}：获得<strong>${ms.label}</strong>`);
      grantKeyFragment(ms.amount || 1);
    } else if (ms.reward === "limited_refresh") {
      limitedRefreshCharges += 1;
      showToast(`峰值里程碑 ${formatYen(ms.peak)}：${ms.label}`);
      addLog(`峰值里程碑 ${formatYen(ms.peak)}：获得<strong>${ms.label}</strong>`);
    }
    updateStats();
    updateCrateButtons();
    updateFeePreview();
    updateFreeRentOffer();
    updateKeysUI();
    updateLimitedOfferUI();
  }

  /** Content hooks at ~20万–40万 — tokens/cash only, not drop buffs. */
  function checkPeakMilestones() {
    let any = false;
    for (const ms of PEAK_MILESTONE_CFG.MILESTONES) {
      if (peakMilestonesClaimed.has(ms.peak)) continue;
      if (peakCash < ms.peak) continue;
      peakMilestonesClaimed.add(ms.peak);
      applyPeakMilestoneReward(ms);
      any = true;
    }
    if (any) scheduleSave();
  }

  /** Unlock halls when career peak cash crosses thresholds (once each). */
  function checkAuctionHalls() {
    notePeakCash();
    const prevId = activeAuctionHall() && activeAuctionHall().id;
    let newly = [];
    for (const t of AUCTION_HALL_CFG.TIERS) {
      if (unlockedHalls.has(t.id)) continue;
      if (peakCash < t.peakCash) continue;
      unlockedHalls.add(t.id);
      newly.push(t);
      queueCashFx({ pulse: "milestone", flash: "gold" });
      addLog(`解锁高级拍卖厅 <strong>${t.name}</strong>（峰值现金 ${formatYen(t.peakCash)}）`);
    }
    checkPeakMilestones();
    updateHallUI();
    syncWealthGoldOutline();
    if (newly.length) {
      renderCodexModal();
      scheduleSave();
      // Enter card for the highest newly unlocked (active hall)
      const active = activeAuctionHall();
      if (active) showHallEnterCard(active, { unlock: true });
    } else {
      const active = activeAuctionHall();
      // On load/change: announce once when active hall differs from last shown
      if (active && active.id !== lastAnnouncedHallId && active.id !== prevId) {
        showHallEnterCard(active, { unlock: false });
      }
    }
  }

  const HALL_SKIN_CLASSES = ["hall-bronze", "hall-jade", "hall-silver", "hall-platinum", "hall-crimson"];
  const HALL_SKIN_CHIP = ["skin-bronze", "skin-jade", "skin-silver", "skin-platinum", "skin-crimson"];

  function applyHallTheme(hall) {
    const body = document.body;
    body.classList.remove(...HALL_SKIN_CLASSES);
    if (!hall || !hall.skinId) return;
    body.classList.add("hall-" + hall.skinId);
  }

  /** Identity flex: gold outline when hall ≥ 翡翠 OR career peak ≥ ¥250k. */
  function wealthGoldActive() {
    if (peakCash >= WEALTH_GOLD_PEAK) return true;
    const hall = activeAuctionHall();
    if (!hall) return false;
    const minSkin = AUCTION_HALL_CFG.GOLD_OUTLINE_MIN_SKIN || "jade";
    const order = AUCTION_HALL_CFG.TIERS.map((t) => t.skinId);
    const hi = order.indexOf(hall.skinId);
    const lo = order.indexOf(minSkin);
    return hi >= 0 && lo >= 0 && hi >= lo;
  }

  function syncWealthGoldOutline() {
    const on = wealthGoldActive();
    document.body.classList.toggle("wealth-gold", on);
    if (el.cashBalance) el.cashBalance.classList.toggle("gold-outline", on);
    const brand = document.querySelector(".brand-mark");
    if (brand) brand.classList.toggle("gold-outline", on);
    const stats = document.querySelector(".stats");
    if (stats) stats.classList.toggle("gold-outline-hud", on);
  }

  function hallFactsHtml(hall) {
    const gr = Math.round((hall.goldRedBoostPct || 0) * 100);
    const rent = Math.round((hall.rentMarkupPct || 0) * 100);
    return (
      `<li>成交货值区间：<strong>${hall.valueRange || "—"}</strong></li>` +
      `<li>金红掉率提升：<strong>+${gr}%</strong></li>` +
      `<li>租金上浮：<strong>${rent > 0 ? `+${rent}%` : "不加价"}</strong></li>`
    );
  }

  /** One-card hall enter: name / value range / gold-red uplift. 「知道了」dismisses. */
  function showHallEnterCard(hall, opts) {
    if (!hall || !el.hallEnterModal) {
      if (hall) showToast(hall.toast || hall.name, "rare");
      return;
    }
    opts = opts || {};
    lastAnnouncedHallId = hall.id;
    if (el.hallEnterName) el.hallEnterName.textContent = hall.name;
    if (el.hallEnterFacts) el.hallEnterFacts.innerHTML = hallFactsHtml(hall);
    if (el.hallEnterNote) {
      el.hallEnterNote.textContent = opts.unlock
        ? (hall.toast || "新拍卖厅已解锁。厅堂加成已生效，亏本仍可能。")
        : "厅堂加成已生效。亏本仍可能。点击顶栏厅名可再看说明。";
    }
    if (el.hallEnterCard) {
      el.hallEnterCard.classList.remove(...HALL_SKIN_CHIP);
      if (hall.skinId) el.hallEnterCard.classList.add("skin-" + hall.skinId);
    }
    applyHallTheme(hall);
    el.hallEnterModal.hidden = false;
    fx("uiClick");
  }

  function hideHallEnterCard() {
    if (el.hallEnterModal) el.hallEnterModal.hidden = true;
  }

  function nextHallPreview() {
    for (const t of AUCTION_HALL_CFG.TIERS) {
      if (!unlockedHalls.has(t.id)) return t;
    }
    return null;
  }

  function updateHallUI() {
    const hall = activeAuctionHall();
    applyHallTheme(hall);
    if (el.hallChip) {
      if (hall) {
        el.hallChip.hidden = false;
        el.hallChip.textContent = hall.name;
        el.hallChip.classList.remove(...HALL_SKIN_CHIP);
        if (hall.skinId) el.hallChip.classList.add("skin-" + hall.skinId);
        el.hallChip.title =
          `点击查看 · ${hall.name}（峰值 ${formatYen(peakCash)}）· 金红 +${Math.round(hall.goldRedBoostPct * 100)}%${hall.rentMarkupPct > 0 ? ` · 租金 +${Math.round(hall.rentMarkupPct * 100)}%` : ""} · 货值 ${hall.valueRange || ""}`;
      } else {
        el.hallChip.hidden = true;
      }
    }
    // Faint preview when within ¥20k of next hall
    if (el.hallUnlockHint) {
      const next = nextHallPreview();
      const within = AUCTION_HALL_CFG.PREVIEW_WITHIN || 20000;
      if (next && peakCash < next.peakCash && next.peakCash - peakCash <= within) {
        const remain = next.peakCash - peakCash;
        el.hallUnlockHint.hidden = false;
        el.hallUnlockHint.textContent = `距${next.name.replace("拍卖厅", "")}还差 ${formatYen(remain)}`;
        el.hallUnlockHint.title = `峰值再积 ${formatYen(remain)} 可解锁「${next.name}」`;
      } else {
        el.hallUnlockHint.hidden = true;
      }
    }
    if (el.hallLine) {
      const bits = AUCTION_HALL_CFG.TIERS.map((t) => {
        const on = unlockedHalls.has(t.id);
        return `<span class="hall-chip${on ? " on" : ""}">${on ? "✓ " : ""}${t.name}<small>${formatYen(t.peakCash)} · 金红 +${Math.round(t.goldRedBoostPct * 100)}%${t.rentMarkupPct > 0 ? ` · 租金 +${Math.round(t.rentMarkupPct * 100)}%` : ""} · ${t.valueRange || ""}</small></span>`;
      });
      el.hallLine.innerHTML =
        `<span class="hall-label">高级拍卖厅 · 峰值 <strong>${formatYen(peakCash)}</strong></span>` +
        `<span class="hall-chips">${bits.join("")}</span>`;
    }
  }

  /** Value-threshold only: expensive pieces that can swing sealed-round P/L. */
  function shouldChallengeItem(entry) {
    if (!entry) return false;
    const v = itemValue(entry);
    return v >= challengeValueThreshold();
  }

  function limitedOfferActive() {
    return !!(limitedOffer && limitedOffer.endAt && Date.now() < limitedOffer.endAt);
  }

  function clearLimitedOffer(reason) {
    if (!limitedOffer) return;
    limitedOffer = null;
    if (reason === "expire" || reason === "miss") {
      limitedCooldownUntil = Date.now() + LIMITED_CFG.COOLDOWN_AFTER_EXPIRE_MS;
      showToast("限时货柜已消失");
    }
    if (selectedTier === "limited") selectedTier = null;
    updateLimitedOfferUI();
    updateCrateButtons();
    updateFeePreview();
    scheduleSave();
  }

  function limitedRollChance() {
    let chance = LIMITED_CFG.ROLL_CHANCE;
    // After honeymoon ends, briefly boost so mid-game players see offers sooner
    if (honeymoonEnded && !honeymoonActive()) {
      const window = LIMITED_CFG.POST_HONEYMOON_ROUNDS || 0;
      if (window > 0 && round <= HONEYMOON.ROUNDS + window) {
        chance = Math.min(0.85, chance + (LIMITED_CFG.POST_HONEYMOON_ROLL_BONUS || 0));
      }
    }
    // Mid ~30万 band: density bump only (not drop-rate)
    if (inMidGameBand()) {
      chance = Math.min(0.88, chance + (MIDGAME_CFG.LIMITED_ROLL_BONUS || 0));
    }
    return chance;
  }

  function spawnLimitedOffer(forced) {
    ensureLimitedDaily();
    if (limitedOfferActive()) return false;
    if (!forced) {
      if (cash < LIMITED_CFG.CASH_THRESHOLD) return false;
      if (limitedDailyCount >= limitedDailyMax()) return false;
      if (Date.now() < limitedCooldownUntil) return false;
      if (crateOpenedThisRound || revealing || extractedThisRound) return false;
      if (Math.random() > limitedRollChance()) return false;
    } else {
      if (cash < LIMITED_CFG.CASH_THRESHOLD && !forced) return false;
    }
    const span =
      LIMITED_CFG.COUNTDOWN_MIN_MS +
      Math.floor(Math.random() * (LIMITED_CFG.COUNTDOWN_MAX_MS - LIMITED_CFG.COUNTDOWN_MIN_MS + 1));
    limitedOffer = { endAt: Date.now() + span };
    limitedDailyCount += 1;
    limitedCooldownUntil = 0;
    showToast("限时豪华柜出现！高风险高回报");
    setActionDesc(
      `限时货柜已刷新：租金 ${formatYen(CRATE_TIERS.limited.fee)}，倒计时内可租。货池优于密封，仍可能大亏。`
    );
    updateLimitedOfferUI();
    scheduleSave();
    return true;
  }

  function maybeRollLimitedOffer() {
    ensureLimitedDaily();
    if (limitedOfferActive()) {
      updateLimitedOfferUI();
      return;
    }
    // Expire stale persisted offer
    if (limitedOffer && limitedOffer.endAt && Date.now() >= limitedOffer.endAt) {
      clearLimitedOffer("expire");
    }
    spawnLimitedOffer(false);
  }

  function formatCountdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
  }

  function updateLimitedOfferUI() {
    const panel = el.limitedOfferPanel;
    if (!panel) return;
    ensureLimitedDaily();
    const active = limitedOfferActive();
    panel.hidden = !active && cash < LIMITED_CFG.CASH_THRESHOLD;
    panel.classList.toggle("active", active);
    panel.classList.toggle("waiting", !active && cash >= LIMITED_CFG.CASH_THRESHOLD);

    const limFee = effectiveTierFee("limited");
    if (el.limitedOfferFee) {
      const disc = nextCrateDiscountPct > 0 && limFee < CRATE_TIERS.limited.fee;
      el.limitedOfferFee.textContent = disc
        ? `租金 ${formatYen(limFee)}（折）`
        : `租金 ${formatYen(limFee)}`;
    }
    if (active) {
      const left = limitedOffer.endAt - Date.now();
      if (el.limitedOfferCountdown) {
        el.limitedOfferCountdown.textContent = `剩余 ${formatCountdown(left)}`;
      }
      if (el.limitedOfferSelect) {
        el.limitedOfferSelect.disabled =
          crateOpenedThisRound || extractedThisRound || revealing || bankrupt || cash < limFee;
        el.limitedOfferSelect.textContent =
          selectedTier === "limited" ? "已选中限时柜" : "选择限时货柜";
      }
    } else if (cash >= LIMITED_CFG.CASH_THRESHOLD) {
      if (el.limitedOfferCountdown) {
        const remain = Math.max(0, limitedDailyMax() - limitedDailyCount);
        el.limitedOfferCountdown.textContent =
          remain <= 0 ? "今日限时次数已用完" : `现金达标 · 今日还可出现 ${remain} 次`;
      }
      if (el.limitedOfferSelect) {
        el.limitedOfferSelect.disabled = true;
        el.limitedOfferSelect.textContent = "等待刷新…";
      }
    }

    if (el.btnLimitedKeyRefresh) {
      const canFreeRefresh = limitedRefreshCharges > 0;
      const canKeyRefresh = keys >= LIMITED_CFG.KEY_REFRESH_COST;
      el.btnLimitedKeyRefresh.disabled =
        (!canFreeRefresh && !canKeyRefresh) || revealing || crateOpenedThisRound;
      el.btnLimitedKeyRefresh.textContent = canFreeRefresh
        ? `限时刷新券 ×${limitedRefreshCharges}`
        : `🔑 花${LIMITED_CFG.KEY_REFRESH_COST}钥匙刷新`;
    }
    if (el.btnLimitedAdEarly) {
      if (!FEATURES.ADS_ENABLED) {
        el.btnLimitedAdEarly.hidden = true;
      } else {
        el.btnLimitedAdEarly.hidden = false;
      }
      const limRem = categoryRemaining("limited_refresh");
      const limOk = limRem > 0 && limitedDailyCount < limitedDailyMax();
      el.btnLimitedAdEarly.disabled = revealing || crateOpenedThisRound || !limOk;
      el.btnLimitedAdEarly.textContent = limOk
        ? `▶ 看广告刷新（今日${limRem}/1）`
        : limRem <= 0
          ? "今日限时广告刷新已用完"
          : "今日限时次数已用完";
      if (limOk && !el.limitedOfferPanel?.hidden) {
        logAdOfferOnce(AD_PLACEMENTS.LIMITED_EARLY, { rem: limRem });
      }
    }

    // Live tick
    if (active && !limitedTickTimer) {
      limitedTickTimer = setInterval(() => {
        if (!limitedOfferActive()) {
          clearInterval(limitedTickTimer);
          limitedTickTimer = null;
          clearLimitedOffer("expire");
          return;
        }
        updateLimitedOfferUI();
      }, 400);
    } else if (!active && limitedTickTimer) {
      clearInterval(limitedTickTimer);
      limitedTickTimer = null;
    }
  }

  function refreshLimitedWithKey() {
    const useCharge = limitedRefreshCharges > 0;
    if (!useCharge && keys < LIMITED_CFG.KEY_REFRESH_COST) {
      showToast("钥匙不足");
      logMono("iap_click", "limited_key_refresh", { blocked: "no_keys" });
      return;
    }
    if (useCharge) {
      limitedRefreshCharges -= 1;
      logMono("iap_click", "limited_refresh_charge", { left: limitedRefreshCharges });
    } else {
      keys -= LIMITED_CFG.KEY_REFRESH_COST;
      updateKeysUI();
      logMono("iap_click", "limited_key_refresh", { keysLeft: keys, cost: LIMITED_CFG.KEY_REFRESH_COST });
      logMono("iap_complete", "limited_key_refresh", { keysLeft: keys });
    }
    // Force spawn / replace countdown
    if (limitedOfferActive()) clearLimitedOffer("refresh");
    limitedCooldownUntil = 0;
    ensureLimitedDaily();
    const span =
      LIMITED_CFG.COUNTDOWN_MIN_MS +
      Math.floor(Math.random() * (LIMITED_CFG.COUNTDOWN_MAX_MS - LIMITED_CFG.COUNTDOWN_MIN_MS + 1));
    limitedOffer = { endAt: Date.now() + span };
    if (limitedDailyCount < limitedDailyMax()) limitedDailyCount += 1;
    showToast(useCharge ? "已使用限时刷新券 · 豪华柜已刷新" : "已消耗钥匙 · 限时货柜刷新");
    updateLimitedOfferUI();
    updateStats();
    scheduleSave();
  }

  function refreshLimitedWithAd() {
    offerRewardedAd(AD_PLACEMENTS.LIMITED_EARLY, () => {
      limitedCooldownUntil = 0;
      if (limitedOfferActive()) {
        // Extend / refresh timer
        const span =
          LIMITED_CFG.COUNTDOWN_MIN_MS +
          Math.floor(Math.random() * (LIMITED_CFG.COUNTDOWN_MAX_MS - LIMITED_CFG.COUNTDOWN_MIN_MS + 1));
        limitedOffer.endAt = Date.now() + span;
        showToast("广告完成 · 限时倒计时已刷新");
      } else {
        spawnLimitedOffer(true);
        showToast("广告完成 · 限时货柜已刷出");
      }
      updateLimitedOfferUI();
      scheduleSave();
    });
  }

  // ----- Value-threshold timed challenge (5–8s math + logic/judgment) -----
  const CHALLENGE_MATH = [
    () => {
      const a = 7 + Math.floor(Math.random() * 12);
      const b = 3 + Math.floor(Math.random() * 9);
      return { q: `${a} + ${b} = ?`, a: String(a + b), wrong: [a + b - 2, a + b + 1, a + b + 3].map(String) };
    },
    () => {
      const a = 6 + Math.floor(Math.random() * 10);
      const b = 2 + Math.floor(Math.random() * 8);
      return { q: `${a} × ${b} = ?`, a: String(a * b), wrong: [a * b - a, a * b + b, a * (b + 1)].map(String) };
    },
    () => {
      const a = 20 + Math.floor(Math.random() * 40);
      const b = 5 + Math.floor(Math.random() * 12);
      return { q: `${a} − ${b} = ?`, a: String(a - b), wrong: [a - b - 3, a - b + 2, a + b].map(String) };
    },
    () => {
      const n = 4 + Math.floor(Math.random() * 6);
      return { q: `${n} 的两倍是？`, a: String(n * 2), wrong: [n + 2, n * 3, n * 2 + 1].map(String) };
    },
    () => {
      const opts = [
        { q: "一周有几天？", a: "7", wrong: ["5", "6", "8"] },
        { q: "一年有几个月？", a: "12", wrong: ["10", "11", "24"] },
        { q: "一小时多少分钟？", a: "60", wrong: ["30", "90", "100"] },
        { q: "三角形有几条边？", a: "3", wrong: ["2", "4", "5"] },
        { q: "正方形有几个直角？", a: "4", wrong: ["2", "3", "5"] },
        { q: "人民币 1 元等于多少角？", a: "10", wrong: ["5", "12", "100"] },
        { q: "一打等于几个？", a: "12", wrong: ["10", "6", "24"] },
        { q: "直角是多少度？", a: "90", wrong: ["45", "60", "180"] },
        { q: "圆有几个圆心？", a: "1", wrong: ["0", "2", "无数"] },
        { q: "5 的平方是？", a: "25", wrong: ["10", "20", "15"] },
      ];
      return opts[Math.floor(Math.random() * opts.length)];
    },
    () => {
      const a = 10 + Math.floor(Math.random() * 20);
      const even = a % 2 === 0 ? a : a + 1;
      return { q: `${even} 的一半是？`, a: String(even / 2), wrong: [String(even - 2), String(even / 2 + 1), String(even * 2)] };
    },
    () => {
      const a = 8 + Math.floor(Math.random() * 15);
      const b = 2 + Math.floor(Math.random() * 6);
      const c = 1 + Math.floor(Math.random() * 5);
      return { q: `${a} + ${b} − ${c} = ?`, a: String(a + b - c), wrong: [a + b + c, a - b + c, a + b].map(String) };
    },
    () => {
      const a = 3 + Math.floor(Math.random() * 7);
      const b = 3 + Math.floor(Math.random() * 7);
      const c = 2 + Math.floor(Math.random() * 5);
      return { q: `${a} × ${b} + ${c} = ?`, a: String(a * b + c), wrong: [a * b - c, a * (b + 1), (a + 1) * b].map(String) };
    },
    () => {
      const tot = 20 + Math.floor(Math.random() * 30);
      const take = 3 + Math.floor(Math.random() * 8);
      return { q: `货值 ¥${tot}，付租金 ¥${take}，还剩？`, a: String(tot - take), wrong: [tot + take, tot - take - 2, tot].map(String) };
    },
    () => {
      const n = 9 + Math.floor(Math.random() * 12);
      return { q: `${n} × 10 = ?`, a: String(n * 10), wrong: [n + 10, n * 9, n * 11].map(String) };
    },
    () => {
      const packs = [
        { q: "3 的立方是？", a: "27", wrong: ["9", "18", "81"] },
        { q: "100 的 10% 是？", a: "10", wrong: ["1", "20", "50"] },
        { q: "2 + 2 × 2 = ?", a: "6", wrong: ["8", "4", "10"] },
        { q: "15 ÷ 3 = ?", a: "5", wrong: ["3", "6", "45"] },
        { q: "7 的三倍是？", a: "21", wrong: ["14", "24", "28"] },
        { q: "最小的两位数是？", a: "10", wrong: ["1", "11", "9"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const a = 4 + Math.floor(Math.random() * 8);
      return { q: `连续加：${a}+${a}+${a}=？`, a: String(a * 3), wrong: [a * 2, a * 4, a + 3].map(String) };
    },
    () => {
      const price = 50 + Math.floor(Math.random() * 50);
      const disc = 10;
      const ans = Math.round(price * (100 - disc) / 100);
      return { q: `原价 ¥${price}，打 ${100 - disc} 折后？`, a: String(ans), wrong: [String(price - disc), String(price), String(ans + 5)] };
    },
  ];

  /** Logic / judgment bank — still 5–8s solvable, Chinese UI. */
  const CHALLENGE_LOGIC = [
    () => {
      const packs = [
        { q: "找规律：2、4、6、？", a: "8", wrong: ["7", "9", "10"] },
        { q: "找规律：1、2、4、8、？", a: "16", wrong: ["10", "12", "14"] },
        { q: "找规律：3、6、9、？", a: "12", wrong: ["10", "11", "15"] },
        { q: "找规律：5、10、15、？", a: "20", wrong: ["18", "25", "16"] },
        { q: "找规律：10、9、8、？", a: "7", wrong: ["6", "9", "11"] },
        { q: "找规律：2、3、5、8、？", a: "12", wrong: ["10", "11", "13"] },
        { q: "找规律：1、1、2、3、5、？", a: "8", wrong: ["6", "7", "9"] },
        { q: "找规律：100、90、80、？", a: "70", wrong: ["60", "85", "75"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const packs = [
        { q: "哪个与众不同？苹果 / 香蕉 / 汽车 / 橙子", a: "汽车", wrong: ["苹果", "香蕉", "橙子"] },
        { q: "哪个与众不同？猫 / 狗 / 桌子 / 鸟", a: "桌子", wrong: ["猫", "狗", "鸟"] },
        { q: "哪个与众不同？红 / 蓝 / 圆 / 绿", a: "圆", wrong: ["红", "蓝", "绿"] },
        { q: "哪个与众不同？春 / 夏 / 热 / 秋", a: "热", wrong: ["春", "夏", "秋"] },
        { q: "哪个与众不同？金 / 银 / 木 / 铜", a: "木", wrong: ["金", "银", "铜"] },
        { q: "哪个与众不同？开箱 / 装箱 / 睡觉 / 转卖", a: "睡觉", wrong: ["开箱", "装箱", "转卖"] },
        { q: "哪个与众不同？圆 / 方 / 三角 / 甜", a: "甜", wrong: ["圆", "方", "三角"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const packs = [
        { q: "判断：所有正方形都是矩形。", a: "对", wrong: ["错", "不一定", "无法判断"] },
        { q: "判断：所有矩形都是正方形。", a: "错", wrong: ["对", "不一定", "只有长方形"] },
        { q: "判断：今天之后是明天。", a: "对", wrong: ["错", "不一定", "看时区"] },
        { q: "判断：1 公斤铁比 1 公斤棉花重。", a: "错", wrong: ["对", "铁更重", "棉花更轻"] },
        { q: "判断：偶数能被 2 整除。", a: "对", wrong: ["错", "只有个位数", "不一定"] },
        { q: "判断：冰是水的固体形态。", a: "对", wrong: ["错", "是气体", "是液体"] },
        { q: "判断：太阳从西边升起。", a: "错", wrong: ["对", "有时对", "看季节"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const packs = [
        { q: "甲比乙高，乙比丙高。谁最矮？", a: "丙", wrong: ["甲", "乙", "一样高"] },
        { q: "货柜 A 比 B 贵，B 比 C 贵。哪个最便宜？", a: "C", wrong: ["A", "B", "一样"] },
        { q: "小明只带了钥匙没带钱包。他能开门吗？（假设有钥匙即可）", a: "能", wrong: ["不能", "需要钱包", "不确定"] },
        { q: "若「贵货必金色」为假，则：", a: "有贵货不是金色", wrong: ["没有贵货", "全是金色", "全是白色"] },
        { q: "只有会员能进贵宾厅。小李不是会员。小李能进吗？", a: "不能", wrong: ["能", "不一定", "可以旁听"] },
        { q: "货已装箱才能转卖。这箱货还在暂存。能转卖吗？", a: "不能", wrong: ["能", "看租金", "可以"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const packs = [
        { q: "哪个更大？ 1/2 还是 1/3？", a: "1/2", wrong: ["1/3", "一样大", "无法比较"] },
        { q: "三个数 8、3、5，中间大小是？", a: "5", wrong: ["8", "3", "4"] },
        { q: "东、南、西、北——「对面是西」的方向是？", a: "东", wrong: ["南", "北", "西"] },
        { q: "箱子里有 3 红 2 蓝。随机摸 1 个，更可能是？", a: "红", wrong: ["蓝", "一样", "绿"] },
        { q: "哪个更小？ 0.2 还是 0.15？", a: "0.15", wrong: ["0.2", "一样", "无法比较"] },
        { q: "排序 金>紫>蓝，紫在第几？", a: "第二", wrong: ["第一", "第三", "第四"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const packs = [
        { q: "「仓」字有几划？（口算常见写法）", a: "4", wrong: ["3", "5", "6"] },
        { q: "若 ★=2、◆=3，则 ★+◆=？", a: "5", wrong: ["4", "6", "23"] },
        { q: "一天有几个整点？（0–23）", a: "24", wrong: ["12", "23", "60"] },
        { q: "镜子里的「左右」通常会？", a: "对调", wrong: ["不变", "上下颠倒", "消失"] },
        { q: "若 ●=1、▲=4，则 ▲−●=？", a: "3", wrong: ["5", "4", "2"] },
        { q: "「上下」的反义词更接近？", a: "左右无关", wrong: ["前后", "一样", "颠倒即反义"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const packs = [
        { q: "房东收租金，租客付租金。谁付钱？", a: "租客", wrong: ["房东", "双方", "中介"] },
        { q: "开箱在装箱之前还是之后？", a: "之前", wrong: ["之后", "同时", "无所谓"] },
        { q: "密封柜通常比普通柜？", a: "更贵", wrong: ["更便宜", "一样", "免费"] },
        { q: "若今日限时次数用完，还能钥匙刷新吗？（规则允许时）", a: "能", wrong: ["不能", "必须广告", "明天再说"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
    () => {
      const packs = [
        { q: "A 真则 B 假；A 为真。B 是？", a: "假", wrong: ["真", "不确定", "也真"] },
        { q: "袋子里只有白绿货。摸到蓝货可能吗？", a: "不可能", wrong: ["可能", "大概率", "看运气"] },
        { q: "连盈三场叫什么？（本游）", a: "热手", wrong: ["冷手", "破产", "蜜月"] },
        { q: "品级：蓝 和 紫，哪个更高？", a: "紫", wrong: ["蓝", "一样", "看柜子"] },
      ];
      return packs[Math.floor(Math.random() * packs.length)];
    },
  ];

  // backward-compatible alias
  const CHALLENGE_BANK = CHALLENGE_MATH.concat(CHALLENGE_LOGIC);

  const DOWNGRADE_MAP = {
    dahong: "xiaohong",
    xiaohong: "yanjin",
    yanjin: "dajin",
    dajin: "xiaojin",
    xiaojin: "pink",
    pink: "purple",
    purple: "blue",
  };

  function pickChallengeQuestion(entry) {
    const def = entry && getDef(entry.defId);
    const rarity = def && def.rarity;
    const goldPlus = !!(rarity && GOLD_PLUS_RARITIES.has(rarity));
    // Gold+ bias toward logic/judgment; still mix some math. Others ~half-half.
    const logicChance = goldPlus ? 0.72 : 0.48;
    const pool = Math.random() < logicChance ? CHALLENGE_LOGIC : CHALLENGE_MATH;
    const gen = pool[Math.floor(Math.random() * pool.length)];
    const raw = gen();
    const choices = [raw.a, ...raw.wrong].sort(() => Math.random() - 0.5);
    const uniq = [...new Set(choices)].slice(0, 4);
    if (!uniq.includes(raw.a)) uniq[0] = raw.a;
    return { question: raw.q, answer: raw.a, choices: uniq, kind: pool === CHALLENGE_LOGIC ? "logic" : "math" };
  }

  function downgradeEntry(entry) {
    const def = getDef(entry.defId);
    if (!def) return entry;
    const nextR = DOWNGRADE_MAP[def.rarity] || "blue";
    const pool = poolFor(nextR, selectedTier || "sealed");
    const pick = pool[Math.floor(Math.random() * pool.length)] || def;
    const oldV = itemValue(entry);
    const newV = Math.max(80, Math.round(oldV * (0.42 + Math.random() * 0.12)));
    entry.defId = pick.id;
    entry.valueOverride = newV;
    entry._challenged = true;
    entry._downgraded = true;
    return entry;
  }


  function applyChallengeValueMult(entry, mult) {
    const cur = itemValue(entry);
    entry.valueOverride = Math.max(80, Math.round(cur * mult));
    entry._challenged = true;
    return entry;
  }

  function followBallFreeRetryAvailable() {
    try {
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      return localStorage.getItem(CHALLENGE_CFG.FOLLOW_BALL_FREE_RETRY_DAY_KEY) !== day;
    } catch (_) {
      return false;
    }
  }

  function consumeFollowBallFreeRetry() {
    try {
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      localStorage.setItem(CHALLENGE_CFG.FOLLOW_BALL_FREE_RETRY_DAY_KEY, day);
    } catch (_) { /* ignore */ }
  }

  /** Soft settle from hit rate. <50% can still land here after player accepts fail. */
  function settleFollowBallHitRate(entry, hitRate) {
    if (hitRate >= 0.8) {
      const boost = 1 + (0.05 + Math.random() * 0.05);
      applyChallengeValueMult(entry, boost);
      return { ok: true, label: `跟随成功 · 货值 ×${boost.toFixed(2)}` };
    }
    if (hitRate >= 0.5) {
      if (Math.random() < 0.55) {
        applyChallengeValueMult(entry, 0.9);
        return { ok: true, label: "跟随一般 · 货值 −10%" };
      }
      entry._challenged = true;
      return { ok: true, label: "跟随一般 · 货值不变" };
    }
    // <50%: one-tier drop OR −25–40% value (never forced to white via map alone)
    if (Math.random() < 0.45) {
      downgradeEntry(entry);
      return { ok: false, label: "跟随失败 · 货物降级" };
    }
    const cut = 0.6 + Math.random() * 0.15; // keep 60–75% → −25%～−40%
    applyChallengeValueMult(entry, cut);
    return { ok: false, label: `跟随失败 · 货值 ×${cut.toFixed(2)}` };
  }

  function runFollowBallChallenge(entry) {
    return new Promise((resolve) => {
      if (!el.challengeModal || !el.followBallWrap || !el.followBallArena || !el.followBall) {
        resolve(entry);
        return;
      }
      challengeRetryUsed = false;

      const def = getDef(entry.defId);
      const rar = RARITY_MAP[def.rarity];
      const threshold = challengeValueThreshold();
      const duration =
        CHALLENGE_CFG.FOLLOW_BALL_MS_MIN +
        Math.floor(
          Math.random() *
            (CHALLENGE_CFG.FOLLOW_BALL_MS_MAX - CHALLENGE_CFG.FOLLOW_BALL_MS_MIN + 1)
        );

      if (el.challengeItemName) {
        el.challengeItemName.innerHTML =
          `${def.icon} ${def.name} <small style="color:${rar.color}">${rar.name}</small>`;
      }
      if (el.challengeItemValue) {
        el.challengeItemValue.textContent =
          `估价 ${formatYen(itemValue(entry))} · 鉴宝门槛 ${formatYen(threshold)} · 跟随球`;
      }
      if (el.challengeQuestion) {
        el.challengeQuestion.textContent =
          "跟随金球：限时点击命中移动的球（准确率决定货值）";
      }
      if (el.challengeChoices) {
        el.challengeChoices.innerHTML = "";
        el.challengeChoices.hidden = true;
      }
      if (el.challengeFailActions) el.challengeFailActions.hidden = true;
      el.followBallWrap.hidden = false;

      const arena = el.followBallArena;
      const ball = el.followBall;
      let hits = 0;
      let attempts = 0;
      let settled = false;
      let moveId = null;
      let tickId = null;
      let failGraceId = null;
      let lastRate = 0;
      const started = Date.now();

      function meter() {
        lastRate = attempts > 0 ? hits / attempts : 0;
        if (el.followBallMeter) {
          el.followBallMeter.textContent =
            `命中 ${hits} / ${attempts} · 准确率 ${
              attempts ? Math.round(lastRate * 100) + "%" : "—"
            }`;
        }
        return lastRate;
      }

      function placeBall() {
        const aw = arena.clientWidth || 280;
        const ah = arena.clientHeight || 160;
        const pad = 22;
        const x = pad + Math.random() * Math.max(8, aw - pad * 2);
        const y = pad + Math.random() * Math.max(8, ah - pad * 2);
        ball.style.left = `${x}px`;
        ball.style.top = `${y}px`;
      }

      function paintTimer() {
        const left = Math.max(0, duration - (Date.now() - started));
        if (el.challengeTimerText) el.challengeTimerText.textContent = `${Math.ceil(left / 1000)}s`;
        if (el.challengeTimerBar) {
          el.challengeTimerBar.style.width = `${(left / duration) * 100}%`;
        }
        return left;
      }

      function stopMotion() {
        if (moveId) clearInterval(moveId);
        if (tickId) clearInterval(tickId);
        moveId = null;
        tickId = null;
        ball.onclick = null;
        arena.onclick = null;
        if (el.btnFollowBallSkip) el.btnFollowBallSkip.onclick = null;
      }

      function cleanupAll() {
        stopMotion();
        if (failGraceId) clearTimeout(failGraceId);
        failGraceId = null;
        el.followBallWrap.hidden = true;
        challengeActive = null;
      }

      function finishOk(label) {
        if (settled) return;
        settled = true;
        cleanupAll();
        el.challengeModal.hidden = true;
        showToast(label);
        resolve(entry);
      }

      function acceptFailSettle() {
        if (settled) return;
        settled = true;
        cleanupAll();
        const r = settleFollowBallHitRate(entry, lastRate);
        el.challengeModal.hidden = true;
        showToast(r.label);
        resolve(entry);
      }

      function acceptDowngrade() {
        // skip / hard accept: treat as fail tier (commercial)
        if (settled) return;
        settled = true;
        cleanupAll();
        downgradeEntry(entry);
        el.challengeModal.hidden = true;
        showToast("跟随失败 · 货物降级");
        resolve(entry);
      }

      function finishProtect(via) {
        if (settled) return;
        settled = true;
        cleanupAll();
        entry._challenged = true;
        el.challengeModal.hidden = true;
        showToast(via === "key" ? "已消耗钥匙 · 保级成功" : "贵货保级成功");
        scheduleSave();
        resolve(entry);
      }

      function keyProtect() {
        if (keys < CHALLENGE_CFG.KEY_PROTECT_COST) {
          showToast("钥匙不足");
          return;
        }
        keys -= CHALLENGE_CFG.KEY_PROTECT_COST;
        updateKeysUI();
        finishProtect("key");
      }

      function iapProtect() {
        if (protectCharges > 0) {
          protectCharges -= 1;
          finishProtect("iap");
          return;
        }
        const sku = IAP_SKUS.find((s) => s.id === "iap_protect_once");
        if (!sku) return;
        showConfirm(
          "确认补给（测试）",
          `购买「${sku.name}」· ${sku.price}\n（占位：不会真实扣款）`,
          () => finishProtect("iap")
        );
      }

      function restartFollowRound() {
        // clear fail UI and restart motion for remaining duration window
        if (el.challengeFailActions) el.challengeFailActions.hidden = true;
        el.followBallWrap.hidden = false;
        if (el.challengeQuestion) {
          el.challengeQuestion.textContent =
            "跟随金球：限时点击命中移动的球（准确率决定货值）";
        }
        hits = 0;
        attempts = 0;
        meter();
        placeBall();
        const restart = Date.now();
        const leftBudget = Math.max(6000, duration);
        stopMotion();
        wireHits();
        moveId = setInterval(placeBall, 480);
        tickId = setInterval(() => {
          const left = Math.max(0, leftBudget - (Date.now() - restart));
          if (el.challengeTimerText) el.challengeTimerText.textContent = `${Math.ceil(left / 1000)}s`;
          if (el.challengeTimerBar) {
            el.challengeTimerBar.style.width = `${(left / leftBudget) * 100}%`;
          }
          if (left <= 0) endByRate(false);
        }, 100);
        showToast("再试一次 · 跟随球");
      }

      function adRetry() {
        if (FEATURES.ADS_ENABLED) {
          if (challengeRetryUsed) return;
          const retryRem = categoryRemaining("challenge_retry");
          const retryOk = !challengeRetryUsed && retryRem > 0 && adsRemaining() > 0;
          if (!retryOk) {
            showToast("今日贵货重试广告已用完");
            return;
          }
          offerRewardedAd(AD_PLACEMENTS.CHALLENGE_RETRY, () => {
            challengeRetryUsed = true;
            restartFollowRound();
          });
          return;
        }
        // ads off: 1 free retry / day
        if (!followBallFreeRetryAvailable()) {
          showToast("今日免费重试已用完");
          return;
        }
        consumeFollowBallFreeRetry();
        challengeRetryUsed = true;
        restartFollowRound();
      }

      function showFailActions() {
        stopMotion();
        el.followBallWrap.hidden = true;
        if (el.challengeChoices) el.challengeChoices.hidden = true;
        if (el.challengeFailActions) el.challengeFailActions.hidden = false;
        if (el.challengeQuestion) {
          el.challengeQuestion.textContent =
            `跟随准确率 ${Math.round(lastRate * 100)}% — 低于 50%，货物将贬值或降级。`;
        }
        const retryRem = categoryRemaining("challenge_retry");
        const freeOk = !FEATURES.ADS_ENABLED && followBallFreeRetryAvailable();
        const adOk =
          FEATURES.ADS_ENABLED && !challengeRetryUsed && retryRem > 0 && adsRemaining() > 0;
        if (el.btnChallengeAdRetry) {
          if (FEATURES.ADS_ENABLED) {
            el.btnChallengeAdRetry.hidden = false;
            el.btnChallengeAdRetry.disabled = !adOk;
            el.btnChallengeAdRetry.textContent = challengeRetryUsed
              ? "已用过广告重试"
              : adOk
                ? `▶ 看广告重试一次（今日${retryRem}/2）`
                : "今日贵货重试广告已用完";
            if (adOk) logAdOfferOnce(AD_PLACEMENTS.CHALLENGE_RETRY, { rem: retryRem });
          } else {
            el.btnChallengeAdRetry.hidden = false;
            el.btnChallengeAdRetry.disabled = !freeOk || challengeRetryUsed;
            el.btnChallengeAdRetry.textContent =
              freeOk && !challengeRetryUsed
                ? "免费再试一次（今日 1 次）"
                : "今日免费重试已用完";
          }
        }
        if (el.btnChallengeKeyProtect) {
          el.btnChallengeKeyProtect.disabled = keys < CHALLENGE_CFG.KEY_PROTECT_COST;
          el.btnChallengeKeyProtect.textContent =
            `🔑 花${CHALLENGE_CFG.KEY_PROTECT_COST}钥匙保级不降`;
        }
        if (el.btnChallengeIapProtect) {
          const sku = IAP_SKUS.find((s) => s.id === "iap_protect_once");
          const canUseCharge = protectCharges > 0;
          el.btnChallengeIapProtect.disabled = false;
          el.btnChallengeIapProtect.textContent = canUseCharge
            ? `使用保级券 ×${protectCharges}`
            : `＄${(sku && sku.price) || "$1.99"} 单次贵货保级`;
        }
        const grace = FEATURES.ADS_ENABLED ? 10000 : 4000;
        if (failGraceId) clearTimeout(failGraceId);
        failGraceId = setTimeout(() => {
          if (!settled) acceptFailSettle();
        }, grace);
      }

      function endByRate(forceSkip) {
        if (settled) return;
        if (forceSkip) {
          acceptDowngrade();
          return;
        }
        meter();
        if (lastRate >= 0.5) {
          const r = settleFollowBallHitRate(entry, lastRate);
          finishOk(r.label);
          return;
        }
        // <50% → fail actions (retry / protect / accept soft settle)
        showFailActions();
      }

      function wireHits() {
        ball.onclick = (e) => {
          e.stopPropagation();
          attempts += 1;
          hits += 1;
          ball.classList.add("is-hit");
          setTimeout(() => ball.classList.remove("is-hit"), 80);
          meter();
          placeBall();
        };
        arena.onclick = () => {
          attempts += 1;
          meter();
        };
        if (el.btnFollowBallSkip) {
          el.btnFollowBallSkip.onclick = () => endByRate(true);
        }
      }

      challengeActive = {
        mode: "followball",
        entry,
        acceptDowngrade: acceptFailSettle, // accept fail button → soft tier settle
        adRetry,
        keyProtect,
        iapProtect,
      };

      placeBall();
      meter();
      paintTimer();
      wireHits();
      moveId = setInterval(placeBall, 480);
      tickId = setInterval(() => {
        if (paintTimer() <= 0) endByRate(false);
      }, 100);
      el.challengeModal.hidden = false;
    });
  }

  function runItemChallenge(entry) {
    return new Promise((resolve) => {
      if (!el.challengeModal) {
        resolve(entry);
        return;
      }
      challengeRetryUsed = false;
      // 50% follow-ball vs quiz (游戏商业化 · 金红守住玩法轮换)
      const followChance = (evalMode && evalForceFollowBall)
        ? 1
        : (CHALLENGE_CFG.FOLLOW_BALL_CHANCE || 0.5);
      if (
        el.followBallWrap &&
        Math.random() < followChance
      ) {
        runFollowBallChallenge(entry).then(resolve);
        return;
      }
      if (el.followBallWrap) el.followBallWrap.hidden = true;
      const quiz = pickChallengeQuestion(entry);
      const def = getDef(entry.defId);
      const rar = RARITY_MAP[def.rarity];
      const threshold = challengeValueThreshold();

      if (el.challengeItemName) {
        el.challengeItemName.innerHTML =
          `${def.icon} ${def.name} <small style="color:${rar.color}">${rar.name}</small>`;
      }
      if (el.challengeItemValue) {
        el.challengeItemValue.textContent =
          `估价 ${formatYen(itemValue(entry))} · 鉴宝门槛 ${formatYen(threshold)}`;
      }
      if (el.challengeQuestion) el.challengeQuestion.textContent = quiz.question;
      if (el.challengeFailActions) el.challengeFailActions.hidden = true;

      const choicesEl = el.challengeChoices;
      if (choicesEl) {
        choicesEl.innerHTML = "";
        choicesEl.hidden = false;
        quiz.choices.forEach((c) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn challenge-choice";
          btn.textContent = c;
          btn.addEventListener("click", () => finish(c === quiz.answer));
          choicesEl.appendChild(btn);
        });
      }

      let remaining = CHALLENGE_CFG.TIME_MS;
      const started = Date.now();
      let settled = false;
      let tickId = null;

      function paintTimer() {
        const left = Math.max(0, CHALLENGE_CFG.TIME_MS - (Date.now() - started));
        remaining = left;
        if (el.challengeTimerText) el.challengeTimerText.textContent = `${Math.ceil(left / 1000)}s`;
        if (el.challengeTimerBar) {
          el.challengeTimerBar.style.width = `${(left / CHALLENGE_CFG.TIME_MS) * 100}%`;
        }
      }

      function cleanup() {
        if (tickId) clearInterval(tickId);
        tickId = null;
        challengeActive = null;
      }

      function showFailActions() {
        if (el.challengeChoices) el.challengeChoices.hidden = true;
        if (el.challengeFailActions) el.challengeFailActions.hidden = false;
        if (el.challengeQuestion) {
          el.challengeQuestion.textContent = "鉴宝失败！货物品级将下降——或使用补给挽回。";
        }
        const retryRem = categoryRemaining("challenge_retry");
        const retryOk = FEATURES.ADS_ENABLED && !challengeRetryUsed && retryRem > 0 && adsRemaining() > 0;
        if (el.btnChallengeAdRetry) {
          el.btnChallengeAdRetry.hidden = !FEATURES.ADS_ENABLED;
          el.btnChallengeAdRetry.disabled = !retryOk;
          el.btnChallengeAdRetry.textContent = challengeRetryUsed
            ? "已用过广告重试"
            : retryOk
              ? `▶ 看广告重试一次（今日${retryRem}/2）`
              : "今日贵货重试广告已用完";
          if (retryOk) logAdOfferOnce(AD_PLACEMENTS.CHALLENGE_RETRY, { rem: retryRem });
        }
        if (el.btnChallengeKeyProtect) {
          el.btnChallengeKeyProtect.disabled = keys < CHALLENGE_CFG.KEY_PROTECT_COST;
          el.btnChallengeKeyProtect.textContent =
            `🔑 花${CHALLENGE_CFG.KEY_PROTECT_COST}钥匙保级不降`;
        }
        if (el.btnChallengeIapProtect) {
          const sku = IAP_SKUS.find((s) => s.id === "iap_protect_once");
          const canUseCharge = protectCharges > 0;
          el.btnChallengeIapProtect.disabled = false;
          el.btnChallengeIapProtect.textContent = canUseCharge
            ? `使用保级券 ×${protectCharges}`
            : `＄${(sku && sku.price) || "$1.99"} 单次贵货保级`;
          logMono("iap_offer", "iap_protect_once", { protectCharges, keys });
        }
      }

      function finish(success) {
        if (settled) return;
        if (success) {
          settled = true;
          cleanup();
          el.challengeModal.hidden = true;
          showToast("鉴宝成功 · 货物保留");
          resolve(entry);
          return;
        }
        // fail path — show stubs, but never hang reveal forever
        if (tickId) clearInterval(tickId);
        tickId = null;
        showFailActions();
        // Auto-accept downgrade if player doesn't act (ads off → shorter grace)
        const grace = FEATURES.ADS_ENABLED ? 10000 : 4000;
        setTimeout(() => {
          if (!settled) acceptDowngrade();
        }, grace);
      }

      function acceptDowngrade() {
        if (settled) return;
        settled = true;
        cleanup();
        downgradeEntry(entry);
        el.challengeModal.hidden = true;
        showToast("鉴宝失败 · 货物降级");
        resolve(entry);
      }

      function adRetry() {
        if (challengeRetryUsed) return;
        offerRewardedAd(AD_PLACEMENTS.CHALLENGE_RETRY, () => {
          challengeRetryUsed = true;
          // re-roll question and restart timer
          const quiz2 = pickChallengeQuestion(entry);
          if (el.challengeQuestion) el.challengeQuestion.textContent = quiz2.question;
          if (el.challengeFailActions) el.challengeFailActions.hidden = true;
          if (el.challengeChoices) {
            el.challengeChoices.hidden = false;
            el.challengeChoices.innerHTML = "";
            quiz2.choices.forEach((c) => {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "btn challenge-choice";
              btn.textContent = c;
              btn.addEventListener("click", () => finish(c === quiz2.answer));
              el.challengeChoices.appendChild(btn);
            });
          }
          // restart timer
          const restart = Date.now();
          tickId = setInterval(() => {
            const left = Math.max(0, CHALLENGE_CFG.TIME_MS - (Date.now() - restart));
            if (el.challengeTimerText) el.challengeTimerText.textContent = `${Math.ceil(left / 1000)}s`;
            if (el.challengeTimerBar) {
              el.challengeTimerBar.style.width = `${(left / CHALLENGE_CFG.TIME_MS) * 100}%`;
            }
            if (left <= 0) finish(false);
          }, 100);
          showToast("广告完成 · 再试一次");
        });
      }

      function finishProtect(via) {
        if (settled) return;
        settled = true;
        cleanup();
        el.challengeModal.hidden = true;
        showToast(via === "key" ? "已消耗钥匙 · 保级成功" : "贵货保级成功");
        scheduleSave();
        resolve(entry);
      }

      function keyProtect() {
        if (keys < CHALLENGE_CFG.KEY_PROTECT_COST) {
          showToast("钥匙不足");
          logMono("iap_click", "challenge_key_protect", { blocked: "no_keys" });
          return;
        }
        keys -= CHALLENGE_CFG.KEY_PROTECT_COST;
        updateKeysUI();
        logMono("iap_click", "challenge_key_protect", { keysLeft: keys, cost: CHALLENGE_CFG.KEY_PROTECT_COST });
        logMono("iap_complete", "challenge_key_protect", { keysLeft: keys });
        finishProtect("key");
      }

      function iapProtect() {
        if (protectCharges > 0) {
          protectCharges -= 1;
          logMono("iap_click", "iap_protect_once", { via: "charge", left: protectCharges });
          logMono("iap_complete", "iap_protect_once", { via: "charge", left: protectCharges });
          finishProtect("iap");
          return;
        }
        const sku = IAP_SKUS.find((s) => s.id === "iap_protect_once");
        if (!sku) return;
        logMono("iap_click", sku.id, { price: sku.price, via: "challenge" });
        showConfirm(
          "确认补给（测试）",
          `购买「${sku.name}」· ${sku.price}\n（占位：不会真实扣款）`,
          () => {
            logMono("iap_complete", sku.id, { price: sku.price, via: "challenge" });
            // Consume immediately for this protect — don't bank a spare charge
            finishProtect("iap");
          }
        );
      }

      challengeActive = {
        entry,
        acceptDowngrade,
        adRetry,
        keyProtect,
        iapProtect,
      };

      paintTimer();
      el.challengeModal.hidden = false;
      tickId = setInterval(() => {
        paintTimer();
        if (remaining <= 0) finish(false);
      }, 100);
    });
  }


  /** Mobile: shrink --cell-size so the full N×N warehouse fits in .grid-wrap width (no clipped columns). */
  function fitCellSizeToWrap() {
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    document.body.classList.toggle("is-mobile", mobile);
    if (!mobile) return;
    const wrap = el.gridWrap || document.querySelector(".grid-wrap");
    if (!wrap || !gridSize) return;
    const style = getComputedStyle(wrap);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const avail = Math.max(120, wrap.clientWidth - padX - 2);
    // leave 1px border budget; clamp so 5×5 stays usable and 8×8 still fits
    const raw = Math.floor(avail / gridSize);
    const px = Math.max(16, Math.min(34, raw));
    document.documentElement.style.setProperty("--cell-size", px + "px");
  }

  // ----- Grid -----
  function initGrid(size) {
    gridSize = size;
    grid = Array.from({ length: size }, () => Array(size).fill(null));
    placed.clear();
    document.documentElement.dataset.gridSize = String(size);
    // Desktop: fixed cell sizes. Mobile media query owns --cell-size — do not inline-override it
    // (inline 56px was blowing past mobile clamp and forcing page scroll).
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    if (mobile) {
      // Fit after layout; provisional size avoids flash of desktop cells
      document.documentElement.style.setProperty("--cell-size", "24px");
    } else {
      document.documentElement.style.removeProperty("--cell-size"); // clear prior mobile fit
      document.documentElement.style.setProperty(
        "--cell-size",
        size >= 8 ? "40px" : size >= 7 ? "44px" : size >= 6 ? "50px" : "56px"
      );
    }
    document.body.classList.toggle("is-mobile", mobile);
    renderGrid();
    updateStats();
    if (mobile) {
      requestAnimationFrame(() => {
        fitCellSizeToWrap();
        renderGrid();
      });
    }
  }

  function cellsFor(defId, rot, or, oc) {
    return shapeCells(getDef(defId).shape, rot).map(([dr, dc]) => ({
      r: or + dr,
      c: oc + dc,
    }));
  }

  function canPlace(defId, rot, or, oc, ignoreUid) {
    for (const { r, c } of cellsFor(defId, rot, or, oc)) {
      if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) return false;
      const occ = grid[r][c];
      // Foreign occupants always block — never treat conflict as displaceable
      if (occ && occ.uid !== ignoreUid) return false;
    }
    return true;
  }

  /**
   * Place entry at (or,oc). On conflict with any other uid: abort with no mutations
   * to those items (do NOT kick them to staging). Only the caller decides what to
   * do with the dragged/candidate piece.
   */
  function placeItem(entry, or, oc) {
    const cells = cellsFor(entry.defId, entry.rot, or, oc);
    for (const { r, c } of cells) {
      if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) return false;
      const occ = grid[r][c];
      if (occ && occ.uid !== entry.uid) return false;
    }
    // Mutate only after the full footprint is free of foreigners
    if (placed.has(entry.uid)) removeFromGrid(entry.uid);
    for (const { r, c } of cells) {
      grid[r][c] = { uid: entry.uid, defId: entry.defId, rot: entry.rot, ox: or, oy: oc };
    }
    placed.set(entry.uid, {
      uid: entry.uid,
      defId: entry.defId,
      rot: entry.rot,
      ox: or,
      oy: oc,
      cells,
      valueOverride: entry.valueOverride,
    });
    return true;
  }

  function removeFromGrid(itemUid) {
    const p = placed.get(itemUid);
    if (!p) return null;
    for (const { r, c } of p.cells) {
      if (grid[r][c]?.uid === itemUid) grid[r][c] = null;
    }
    placed.delete(itemUid);
    return {
      uid: p.uid,
      defId: p.defId,
      rot: p.rot,
      valueOverride: p.valueOverride,
      _ox: p.ox,
      _oy: p.oy,
      _origRot: p.rot,
    };
  }

  function usedCells() {
    if (!grid || !grid.length) return 0;
    let n = 0;
    for (let r = 0; r < gridSize; r++) {
      const row = grid[r];
      if (!row) continue;
      for (let c = 0; c < gridSize; c++) if (row[c]) n++;
    }
    return n;
  }

  function stashValue() {
    let v = 0;
    for (const p of placed.values()) v += itemValue(p);
    return v;
  }

  // ----- Render -----
  function clearHighlights() {
    el.warehouseGrid.querySelectorAll(".cell").forEach((c) => {
      c.classList.remove("hl-ok", "hl-bad");
    });
  }

  function renderGrid() {
    const g = el.warehouseGrid;
    g.style.gridTemplateColumns = `repeat(${gridSize}, var(--cell-size))`;
    g.style.gridTemplateRows = `repeat(${gridSize}, var(--cell-size))`;
    g.innerHTML = "";

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r;
        cell.dataset.c = c;

        const occ = grid[r][c];
        if (occ) {
          cell.classList.add("occupied");
          const def = getDef(occ.defId);
          const rar = RARITY_MAP[def.rarity];
          const isOrigin = occ.ox === r && occ.oy === c;
          const badge = document.createElement("div");
          badge.className = "cell-item" + (isOrigin ? " origin" : "");
          badge.style.borderColor = rar.color;
          badge.style.background = rar.color + "28";
          badge.style.boxShadow = `inset 0 0 ${isOrigin ? 10 : 5}px ${rar.glow}`;
          if (isOrigin) {
            badge.textContent = def.icon;
            badge.title = `${def.name}（${rar.name}）· 双击取回`;
            badge.dataset.uid = occ.uid;
            badge.addEventListener("pointerdown", onGridPointerDown);
            badge.addEventListener("dblclick", onGridDblClick);
            badge.addEventListener("mouseenter", () => {
              const p = placed.get(occ.uid);
              if (p) showDetail(p);
            });
          }
          cell.appendChild(badge);
        }

        cell.addEventListener("pointerenter", onCellEnter);
        cell.addEventListener("pointerdown", onCellPointerDown);
        cell.addEventListener("pointerup", onCellPointerUp);
        g.appendChild(cell);
      }
    }
  }

  function miniShapeHTML(shapeKey, rot, color) {
    const cells = shapeCells(shapeKey, rot);
    const maxR = Math.max(...cells.map((x) => x[0]));
    const maxC = Math.max(...cells.map((x) => x[1]));
    const set = new Set(cells.map(([r, c]) => `${r},${c}`));
    let html = `<div class="mini-shape" style="grid-template-columns:repeat(${maxC + 1},6px)">`;
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        html += set.has(`${r},${c}`)
          ? `<span style="background:${color}"></span>`
          : `<span style="visibility:hidden"></span>`;
      }
    }
    return html + "</div>";
  }

  function createItemCard(entry) {
    const def = getDef(entry.defId);
    const rar = RARITY_MAP[def.rarity];
    const card = document.createElement("div");
    let cls = "item-card";
    if (entry._reveal) {
      cls += " reveal-in";
      if (def.rarity === "xiaojin" || def.rarity === "dajin") cls += " reveal-gold";
      else if (def.rarity === "xiaohong" || def.rarity === "dahong") cls += " reveal-red";
      else if (def.rarity === "purple") cls += " reveal-purple";
    }
    if (GOLD_PLUS_RARITIES.has(def.rarity)) cls += " card-shimmer";
    card.className = cls;
    card.dataset.uid = entry.uid;
    card.dataset.rarity = def.rarity;
    if (selectedUid === entry.uid) card.classList.add("selected");
    card.style.borderColor = rar.color;
    card.style.boxShadow = `0 0 12px ${rar.glow}`;

    card.innerHTML = `
      <span class="rarity-dot" style="background:${rar.color};box-shadow:0 0 6px ${rar.color}"></span>
      <div class="item-art" style="--rar:${rar.color};--glow:${rar.glow}">
        <div class="item-art-bg"></div>
        <span class="item-icon">${def.icon}</span>
        ${miniShapeHTML(def.shape, entry.rot, rar.color)}
      </div>
      <div class="item-name" title="${def.name}">${def.name}</div>
      <div class="item-meta">
        <span class="rarity-tag" style="color:${rar.color}">${rar.name}</span>
        <span class="val">${formatYen(itemValue(entry))}</span>
      </div>
    `;
    card.addEventListener("pointerdown", onStagingPointerDown);
    card.addEventListener("mouseenter", () => showDetail(entry));
    card.addEventListener("click", () => {
      if (drag.active) return;
      selectedUid = entry.uid;
      renderStaging();
      showDetail(entry);
      updatePlaceTargetClass();
    });
    return card;
  }

  function renderStaging() {
    const area = el.stagingArea;
    [...area.querySelectorAll(".item-card")].forEach((n) => n.remove());
    if (staging.length === 0) {
      if (el.stagingEmpty) el.stagingEmpty.hidden = false;
    } else {
      if (el.stagingEmpty) el.stagingEmpty.hidden = true;
      staging.forEach((e) => {
        const card = createItemCard(e);
        area.appendChild(card);
        if (e._reveal) {
          e._reveal = false;
          card.addEventListener("animationend", () => {
            card.classList.remove("reveal-in", "reveal-gold", "reveal-red", "reveal-purple");
          }, { once: true });
        }
      });
    }
    el.stagingCount.textContent = staging.length + " 件";
  }

  function showDetail(entry) {
    if (!entry) {
      el.itemDetail.className = "item-detail empty";
      el.itemDetail.innerHTML = "<p>悬停或选中货物查看详情</p>";
      return;
    }
    const def = getDef(entry.defId);
    const rar = RARITY_MAP[def.rarity];
    el.itemDetail.className = "item-detail";
    el.itemDetail.innerHTML = `
      <div class="detail-art" style="--rar:${rar.color};--glow:${rar.glow}">
        <span class="detail-icon">${def.icon}</span>
      </div>
      <div class="detail-name">${def.name}</div>
      <div class="detail-row"><span>品级</span><strong style="color:${rar.color}">${rar.name}</strong></div>
      <div class="detail-row"><span>转卖估价</span><strong style="color:var(--amber-bright)">${formatYen(itemValue(entry))}</strong></div>
      <div class="detail-row"><span>形状</span><strong>${def.shape} · ${entry.rot * 90}°</strong></div>
      ${miniShapeHTML(def.shape, entry.rot, rar.color)}
    `;
  }

  function updateFeePreview() {
    if (!el.feePreview) return;
    if (!selectedTier || crateOpenedThisRound || extractedThisRound || bankrupt) {
      el.feePreview.textContent = crateOpenedThisRound
        ? `本场已付租金 ${formatYen(paidFeeThisRound)}`
        : "选择仓储柜查看租金";
      el.feePreview.className = "fee-preview";
      return;
    }
    const base = tierFee(selectedTier);
    const fee = effectiveTierFee(selectedTier);
    const disc = nextCrateDiscountPct > 0 && fee < base;
    const freeKind = freeTokenForTier(selectedTier);
    const can = !!freeKind || cash >= fee;
    const warm = honeymoonActive() && (selectedTier === "common" || selectedTier === "rare");
    const discTag = disc ? ` · 下一柜-${Math.round(nextCrateDiscountPct * 100)}%` : "";
    if (freeKind) {
      el.feePreview.textContent = `${freeTokenLabel(freeKind)}（余额 ${formatYen(cash)}）${disc ? " · 折扣券保留" : ""}`;
      el.feePreview.className = "fee-preview afford";
      return;
    }
    el.feePreview.textContent = can
      ? (warm
          ? `保护租金 ${formatYen(fee)}（余额 ${formatYen(cash)}）${discTag}`
          : `将支付租金 ${formatYen(fee)}（余额 ${formatYen(cash)}）${discTag}`)
      : `租金 ${formatYen(fee)} — 现金不足！${discTag}`;
    el.feePreview.className = "fee-preview " + (can ? "afford" : "broke");
  }

  function updateStats() {
    syncCashDisplay();
    updateDailyActivityUI();
    checkAuctionHalls();
    syncWealthGoldOutline();
    {
      const used = usedCells();
      const total = gridSize * gridSize;
      const pct = Math.round(warehouseUtilRatio() * 100);
      el.capacityText.textContent = crateOpenedThisRound && !extractedThisRound
        ? `${used} / ${total}（${pct}%）`
        : `${used} / ${total}`;
      el.capacityText.classList.toggle(
        "util-high",
        crateOpenedThisRound && !extractedThisRound && warehouseUtilRatio() >= PERFECT_PACK.UTIL_THRESHOLD
      );
    }
    el.stashValue.textContent = formatYen(stashValue());
    el.totalPnL.textContent = formatYen(totalPnL);
    el.totalPnL.classList.toggle("pos", totalPnL > 0);
    el.totalPnL.classList.toggle("neg", totalPnL < 0);
    el.roundNum.textContent = String(round);

    if (el.roundFeeChip) {
      el.roundFeeChip.hidden = !(crateOpenedThisRound && paidFeeThisRound > 0);
    }
    if (el.paidFeeText) el.paidFeeText.textContent = formatYen(paidFeeThisRound);

    el.btnExtract.disabled = !crateOpenedThisRound || extractedThisRound || bankrupt || revealing;
    if (el.btnExtract && !extractedThisRound) {
      el.btnExtract.textContent = placed.size === 0 && crateOpenedThisRound
        ? "放弃装箱并结算（亏损租金）"
        : "转卖结算";
    }
    if (el.careerLine) {
      {
        let streakBit = "";
        if (profitStreak >= 3) streakBit = ` · 热手 ${profitStreak}`;
        else if (profitStreak > 0) streakBit = ` · 连盈 ${profitStreak}`;
        else if (lossStreak > 0) streakBit = ` · 连亏 ${lossStreak}`;
        el.careerLine.textContent = `战绩 ${wins} 胜 / ${losses} 负` + streakBit;
      }
    }
    checkHoneymoonEnd();
    if (el.honeymoonHint) {
      const hm = honeymoonActive();
      const sealedFee = (CRATE_TIERS.sealed && CRATE_TIERS.sealed.fee) || 30000;
      const sealedReady = !hm && cash >= sealedFee;
      if (hm) {
        el.honeymoonHint.hidden = false;
        el.honeymoonHint.textContent = "新手保护";
      } else if (sealedReady) {
        el.honeymoonHint.hidden = false;
        el.honeymoonHint.textContent = "密封柜已可租";
      } else {
        el.honeymoonHint.hidden = true;
      }
    }
    if (el.pityHint) {
      el.pityHint.hidden = !pityActive();
      if (pityActive()) {
        if (lossStreak >= PITY_THRESHOLD + 2) el.pityHint.textContent = "冷手 · 转机将近";
        else if (lossStreak >= PITY_THRESHOLD) el.pityHint.textContent = "冷手 · 手气回暖中";
        else el.pityHint.textContent = "手气回暖中";
      }
    }
    if (el.btnExpand) {
      const maxSize = GRID_SIZES[GRID_SIZES.length - 1];
      el.btnExpand.disabled = gridSize >= maxSize || bankrupt;
      const ni = GRID_SIZES.indexOf(gridSize);
      const nsz = ni >= 0 && ni < GRID_SIZES.length - 1 ? GRID_SIZES[ni + 1] : null;
      el.btnExpand.title = !nsz
        ? "已达最大仓库"
        : `扩容至 ${nsz}×${nsz}（现金 / 广告 / 补给）`;
    }
    updateFeePreview();
    updateCrateButtons();
    updateKeysUI();
    updateFreeRentOffer();
    updateWarehouseFullOffers();
    updateAdCapUI();
  
    if (evalMode) { syncEvalPanel(); syncDataPanel(); }
  }

  function setActionDesc(t) { el.actionDesc.textContent = t; }

  // ----- Cash / reveal VFX (display-only; never mutates economy) -----
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  /**
   * Settle/VFX budget — low-end & reduced-motion skip heavy particles / long replay.
   * Cause of 转卖结算 stutter: 1.5s replay + forced reflows + many DOM coins + long count-up
   * all stacked on presentSettle's sync modal build.
   */
  let _lowFxCached = null;
  function isLowFx() {
    if (_lowFxCached != null) return _lowFxCached;
    if (prefersReducedMotion()) {
      _lowFxCached = true;
      return true;
    }
    try {
      const mem = navigator.deviceMemory;
      const cores = navigator.hardwareConcurrency;
      const saveData = navigator.connection && navigator.connection.saveData;
      _lowFxCached = !!(saveData || (typeof mem === "number" && mem > 0 && mem <= 4) ||
        (typeof cores === "number" && cores > 0 && cores <= 4));
    } catch (_) {
      _lowFxCached = false;
    }
    return _lowFxCached;
  }

  function settleReplayMs() {
    // 流畅 default: no replay overlay (P/L SFX + number tick only)
    if (settleFxMode !== "fancy") return 0;
    if (prefersReducedMotion()) return 0;
    if (isLowFx()) return 420;
    return allowFancyVfx() ? 980 : 720; // 华丽 richer highlight
  }

  function loadSettleFxMode() {
    try {
      const v = localStorage.getItem(SETTLE_FX_KEY);
      settleFxMode = v === "fancy" ? "fancy" : "smooth";
    } catch (_) {
      settleFxMode = "smooth";
    }
    return settleFxMode;
  }

  function setSettleFxMode(mode) {
    settleFxMode = mode === "fancy" ? "fancy" : "smooth";
    try { localStorage.setItem(SETTLE_FX_KEY, settleFxMode); } catch (_) { /* ignore */ }
    syncFxModeUI();
    return settleFxMode;
  }

  function toggleSettleFxMode() {
    return setSettleFxMode(settleFxMode === "fancy" ? "smooth" : "fancy");
  }

  function syncFxModeUI() {
    const btn = el.btnFxMode;
    if (!btn) return;
    const fancy = settleFxMode === "fancy";
    btn.classList.toggle("is-fancy", fancy);
    btn.setAttribute("aria-pressed", fancy ? "true" : "false");
    if (el.fxModeLabel) el.fxModeLabel.textContent = fancy ? "华丽" : "流畅";
    btn.title = fancy
      ? "结算特效：华丽（回放+金币）。点此切回「流畅」"
      : "结算特效：流畅（仅盈亏音效+数字跳动）。点此开启「华丽」";
  }

  function allowFancyVfx() {
    return settleFxMode === "fancy" && !prefersReducedMotion() && !isLowFx();
  }

  function pickLossConsolation() {
    const i = Math.floor(Math.random() * LOSS_CONSOLATIONS.length);
    return LOSS_CONSOLATIONS[i] || LOSS_CONSOLATIONS[0];
  }


  function loadDailyBest() {
    try {
      const raw = localStorage.getItem(DAILY_BEST_KEY);
      if (!raw) { dailyBest = null; return; }
      const o = JSON.parse(raw);
      if (!o || o.day !== todayKeyLocal()) { dailyBest = null; return; }
      dailyBest = o;
    } catch (_) { dailyBest = null; }
  }

  function saveDailyBest() {
    try {
      if (!dailyBest) localStorage.removeItem(DAILY_BEST_KEY);
      else localStorage.setItem(DAILY_BEST_KEY, JSON.stringify(dailyBest));
    } catch (_) { /* ignore */ }
  }

  function noteDailyBestFromLoot(loot, tierId) {
    if (!Array.isArray(loot) || !loot.length) return;
    let best = null;
    let bestV = dailyBest && dailyBest.day === todayKeyLocal() ? dailyBest.value : 0;
    for (const entry of loot) {
      const v = itemValue(entry);
      if (v > bestV) {
        bestV = v;
        best = entry;
      }
    }
    if (!best) return;
    const def = getDef(best.defId);
    if (!def) return;
    dailyBest = {
      day: todayKeyLocal(),
      value: bestV,
      defId: best.defId,
      rarity: def.rarity,
      name: def.name,
      icon: def.icon,
      tierId: tierId || null,
    };
    saveDailyBest();
    updateDailyBestUI();
  }

  function updateDailyBestUI() {
    const chip = el.dailyBestChip;
    if (!chip) return;
    if (!dailyBest || dailyBest.day !== todayKeyLocal() || !(dailyBest.value > 0)) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    chip.textContent = `今日最佳 ${dailyBest.icon || "★"} ${formatYen(dailyBest.value)}`;
    chip.title = `今日最佳开箱：${dailyBest.name || ""}（${formatYen(dailyBest.value)}）· 点击回放`;
  }

  function replayDailyBest() {
    if (!dailyBest || !dailyBest.defId) {
      showToast("今日尚无最佳开箱记录");
      return;
    }
    // Temporarily force a short fancy-style replay regardless of mode
    const entry = { defId: dailyBest.defId, valueOverride: dailyBest.value };
    const prev = settleFxMode;
    settleFxMode = "fancy";
    playSettleReplay(entry, () => {
      settleFxMode = prev;
      showToast(`今日最佳：${dailyBest.icon || ""} ${dailyBest.name} · ${formatYen(dailyBest.value)}`, "rare");
    });
  }

  function ensureFxHosts() {
    if (!document.getElementById("screenFlash")) {
      const flash = document.createElement("div");
      flash.id = "screenFlash";
      flash.className = "screen-flash";
      flash.setAttribute("aria-hidden", "true");
      document.body.appendChild(flash);
    }
    if (!document.getElementById("cashFxHost")) {
      const host = document.createElement("div");
      host.id = "cashFxHost";
      host.className = "cash-fx-host";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
    }
  }

  /** Queue display-only flair before next syncCashDisplay / updateStats. */
  function queueCashFx(opts) {
    if (!opts) return;
    if (opts.pulse) cashFxFlags.pulse = opts.pulse;
    if (opts.burst) cashFxFlags.burst = true;
    if (opts.jackpot) cashFxFlags.jackpot = true;
    if (opts.flash) cashFxFlags.flash = opts.flash;
  }

  function snapCashDisplay() {
    cashAnimToken++;
    displayCash = cash;
    if (!el.cashBalance) return;
    el.cashBalance.textContent = formatYen(cash);
    el.cashBalance.classList.toggle("neg", cash < minPlayableFee());
    el.cashBalance.classList.remove("cash-flash-up", "cash-flash-down", "cash-pulse", "cash-jackpot");
  }

  function pulseCashHeader(kind) {
    if (!el.cashBalance || prefersReducedMotion()) return;
    const node = el.cashBalance;
    node.classList.remove("cash-pulse", "cash-jackpot");
    // reflow to restart animation
    void node.offsetWidth;
    node.classList.add(kind === "jackpot" ? "cash-jackpot" : "cash-pulse");
    const clr = () => node.classList.remove("cash-pulse", "cash-jackpot");
    node.addEventListener("animationend", clr, { once: true });
    setTimeout(clr, 900);
  }

  function screenFlash(kind) {
    if (prefersReducedMotion() || isLowFx()) return;
    ensureFxHosts();
    const node = document.getElementById("screenFlash");
    if (!node) return;
    clearTimeout(node._fxT);
    node.className = "screen-flash";
    requestAnimationFrame(() => {
      node.className = "screen-flash show flash-" + (kind || "gold");
      node._fxT = setTimeout(() => {
        node.className = "screen-flash";
      }, 280);
    });
  }

  function ensureStreakHost() {
    let host = document.getElementById("streakBanner");
    if (host) return host;
    host = document.createElement("div");
    host.id = "streakBanner";
    host.className = "streak-banner";
    host.setAttribute("aria-live", "polite");
    host.hidden = true;
    document.body.appendChild(host);
    return host;
  }

  /** Short 「热手」/「冷手」takeover — display-only. */
  function showStreakBanner(kind) {
    const host = ensureStreakHost();
    const hot = kind === "hot";
    host.hidden = false;
    host.className = "streak-banner show " + (hot ? "streak-hot" : "streak-cold");
    host.innerHTML = hot
      ? "<span class=\"streak-glyph\">🔥</span><span class=\"streak-title\">热手</span><span class=\"streak-sub\">连盈三场</span>"
      : "<span class=\"streak-glyph\">❄️</span><span class=\"streak-title\">冷手</span><span class=\"streak-sub\">连亏三场 · 手气回暖中</span>";
    void host.offsetWidth;
    clearTimeout(host._t);
    host._t = setTimeout(() => {
      host.classList.remove("show");
      host.hidden = true;
    }, hot ? 1100 : 1300);
    if (!prefersReducedMotion()) screenFlash(hot ? "hot" : "cold");
    fx(hot ? "hotHand" : "coldHand");
  }

  function ensureSettleReplayHost() {
    let host = document.getElementById("settleReplayOverlay");
    if (host) return host;
    host = document.createElement("div");
    host.id = "settleReplayOverlay";
    host.className = "settle-replay-overlay";
    host.setAttribute("aria-hidden", "true");
    host.hidden = true;
    host.innerHTML =
      '<div class="settle-replay-card">' +
      '<p class="settle-replay-kicker">本场高光</p>' +
      '<div class="settle-replay-icon" id="settleReplayIcon"></div>' +
      '<div class="settle-replay-name" id="settleReplayName"></div>' +
      '<div class="settle-replay-meta" id="settleReplayMeta"></div>' +
      '<div class="settle-replay-val" id="settleReplayVal"></div>' +
      '<p class="settle-replay-skip">点击任意处跳过</p>' +
      "</div>";
    document.body.appendChild(host);
    return host;
  }

  /**
   * Short highlight of the round's most valuable sold item, then callback
   * (P/L SFX + result modal). Duration: ~980ms (low-fx ~420ms).
   * Skip: pointerdown anywhere (window capture — overlay, toasts, HUD) or Esc/Space/Enter
   * finishes immediately. Cash was already applied in extract(); `done` runs exactly once
   * via finishOnce, so skipping never double-applies money or restarts the number tick.
   * Reduced-motion / empty loot → immediate callback.
   */
  function playSettleReplay(entry, done) {
    const finishOnce = (() => {
      let doneFlag = false;
      return () => {
        if (doneFlag) return;
        doneFlag = true;
        if (typeof done === "function") done();
      };
    })();
    const ms = settleReplayMs();
    if (!entry || ms <= 0) {
      finishOnce();
      return;
    }
    const def = getDef(entry.defId);
    if (!def) {
      finishOnce();
      return;
    }
    const rar = RARITY_MAP[def.rarity] || { name: "", color: "#fff" };
    const host = ensureSettleReplayHost();
    const icon = document.getElementById("settleReplayIcon");
    const name = document.getElementById("settleReplayName");
    const meta = document.getElementById("settleReplayMeta");
    const val = document.getElementById("settleReplayVal");
    if (icon) icon.textContent = def.icon || "📦";
    if (name) name.textContent = def.name || "";
    if (meta) {
      meta.textContent = rar.name || "";
      meta.style.color = rar.color || "#fff";
    }
    if (val) val.textContent = formatYen(itemValue(entry));

    // Drop listeners left over from a previous (overlapping) replay
    if (typeof host._unbindSkip === "function") host._unbindSkip();

    const teardown = () => {
      clearTimeout(host._t);
      if (typeof host._unbindSkip === "function") host._unbindSkip();
      host.classList.remove("show");
      host.hidden = true;
      document.body.classList.remove("settle-replay-open");
      finishOnce();
    };

    host.hidden = false;
    // Avoid forced sync reflow: toggle class on next frame
    host.classList.remove("show");
    requestAnimationFrame(() => {
      if (host.hidden) return;
      host.classList.add("show");
      document.body.classList.add("settle-replay-open");
      // Skip screenFlash here on low-fx — presentSettle/cashFx may flash once
      if (!isLowFx()) {
        screenFlash(def.rarity === "dahong" || def.rarity === "xiaohong" ? "red" : "gold");
      }
      fx("settleClick");
    });

    // Was: listener on the overlay only, but the overlay is `pointer-events: none` in CSS,
    // so taps fell through (e.g. only dismissed a toast). Listen on window in capture phase
    // and swallow the event so the tap/Esc doesn't also hit the UI underneath (Esc would
    // otherwise close the result modal via the global keydown handler).
    const onSkipPointer = (ev) => {
      if (ev.cancelable) ev.preventDefault();
      ev.stopPropagation();
      teardown();
    };
    const onSkipKey = (ev) => {
      const k = ev.key;
      if (k !== "Escape" && k !== " " && k !== "Spacebar" && k !== "Enter") return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.repeat) return;
      teardown();
    };
    window.addEventListener("pointerdown", onSkipPointer, true);
    window.addEventListener("keydown", onSkipKey, true);
    host._unbindSkip = () => {
      window.removeEventListener("pointerdown", onSkipPointer, true);
      window.removeEventListener("keydown", onSkipKey, true);
      host._unbindSkip = null;
    };
    clearTimeout(host._t);
    host._t = setTimeout(teardown, ms);
  }

  function triggerHotColdStreakFx() {
    if (profitStreak === 3) {
      showStreakBanner("hot");
      showToast("热手！连盈三场", "success");
    } else if (lossStreak === 3) {
      showStreakBanner("cold");
      showToast("冷手…手气回暖中", "warn");
    }
  }

  function spawnCoinBurst(intensity) {
    // 华丽 only — 流畅 default stays light (no particles)
    if (settleFxMode !== "fancy" || prefersReducedMotion()) return;
    if (isLowFx()) return; // skip DOM particles on low-end
    ensureFxHosts();
    const host = document.getElementById("cashFxHost");
    const anchor = el.cashBalance;
    if (!host || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rich = allowFancyVfx();
    const n = rich
      ? Math.min(14, Math.max(6, (intensity | 0) + 4))
      : Math.min(6, Math.max(3, (intensity | 0) >> 1));
    const glyphs = rich ? ["💴", "✦", "★", "✨", "🪙"] : ["💴", "✦"];
    const frag = document.createDocumentFragment();
    const nodes = [];
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "cash-coin" + (rich && i % 4 === 0 ? " cash-coin-lg" : "");
      p.textContent = glyphs[i % glyphs.length];
      const ang = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.4;
      const dist = (rich ? 36 : 28) + Math.random() * (rich ? 52 : 36);
      p.style.left = cx + "px";
      p.style.top = cy + "px";
      p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      p.style.setProperty("--dy", Math.sin(ang) * dist - 18 + "px");
      p.style.animationDelay = (i * (rich ? 0.015 : 0.02)) + "s";
      frag.appendChild(p);
      nodes.push(p);
    }
    host.appendChild(frag);
    setTimeout(() => {
      for (let i = 0; i < nodes.length; i++) nodes[i].remove();
    }, rich ? 820 : 650);
  }

  /** 华丽-only rarity spark ring on cash HUD (display-only). */
  function spawnRaritySparkRing(color) {
    if (!allowFancyVfx() || !el.cashBalance) return;
    ensureFxHosts();
    const host = document.getElementById("cashFxHost");
    if (!host) return;
    const rect = el.cashBalance.getBoundingClientRect();
    const ring = document.createElement("span");
    ring.className = "cash-spark-ring";
    ring.style.left = (rect.left + rect.width / 2) + "px";
    ring.style.top = (rect.top + rect.height / 2) + "px";
    ring.style.setProperty("--spark", color || "#f5c518");
    host.appendChild(ring);
    setTimeout(() => ring.remove(), 700);
  }

  function spawnCashDeltaLabel(delta) {
    if (!el.cashBalance || prefersReducedMotion() || !delta) return;
    ensureFxHosts();
    const host = document.getElementById("cashFxHost");
    const rect = el.cashBalance.getBoundingClientRect();
    if (!host) return;
    const lab = document.createElement("span");
    lab.className = "cash-delta " + (delta > 0 ? "up" : "down");
    lab.textContent = (delta > 0 ? "+" : "") + formatYen(delta);
    lab.style.left = rect.left + rect.width / 2 + "px";
    lab.style.top = rect.top + "px";
    host.appendChild(lab);
    setTimeout(() => lab.remove(), 900);
  }

  function syncCashDisplay() {
    if (!el.cashBalance) return;
    el.cashBalance.classList.toggle("neg", cash < minPlayableFee());
    if (displayCash == null || prefersReducedMotion() || isLowFx()) {
      const delta = displayCash == null ? 0 : cash - displayCash;
      displayCash = cash;
      el.cashBalance.textContent = formatYen(cash);
      // still honor queued pulse/flash on snap paths (load uses snapCashDisplay)
      consumeCashFxFlags(delta);
      return;
    }
    const from = displayCash;
    const to = cash;
    if (from === to) {
      el.cashBalance.textContent = formatYen(cash);
      consumeCashFxFlags(0);
      return;
    }
    const delta = to - from;
    const token = ++cashAnimToken;
    // Cap count-up — long 850–900ms rAF text writes competed with modal paint
    const dur = Math.min(420, Math.max(200, Math.abs(delta) > 50000 ? 420 : Math.abs(delta) > 10000 ? 360 : 260));
    const t0 = performance.now();
    el.cashBalance.classList.remove("cash-flash-up", "cash-flash-down");
    el.cashBalance.classList.add(delta > 0 ? "cash-flash-up" : "cash-flash-down");
    spawnCashDeltaLabel(delta);
    consumeCashFxFlags(delta);

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }
    let lastPaint = 0;
    function frame(now) {
      if (token !== cashAnimToken) return;
      const p = Math.min(1, (now - t0) / dur);
      // Throttle text writes ~30fps to cut main-thread style thrash
      if (p >= 1 || now - lastPaint >= 32) {
        lastPaint = now;
        const v = Math.round(from + (to - from) * easeOutCubic(p));
        displayCash = v;
        el.cashBalance.textContent = formatYen(v);
      }
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        displayCash = to;
        el.cashBalance.textContent = formatYen(to);
        el.cashBalance.classList.toggle("neg", cash < minPlayableFee());
      }
    }
    requestAnimationFrame(frame);
  }

  function consumeCashFxFlags(delta) {
    const flags = cashFxFlags;
    cashFxFlags = { pulse: null, burst: false, jackpot: false, flash: null };
    const big = Math.abs(delta) >= BIG_GAIN_ABS || flags.burst || flags.jackpot;
    const fancy = allowFancyVfx();
    // 流畅: pulse class + optional delta label only (no coins / screen flash)
    if (flags.jackpot || flags.pulse) {
      pulseCashHeader(flags.jackpot ? "jackpot" : flags.pulse);
    } else if (delta > 0 && big) {
      pulseCashHeader("reward");
    }
    if (fancy) {
      if (flags.jackpot) {
        spawnCoinBurst(8);
        screenFlash("jackpot");
      } else if ((flags.pulse || flags.burst) && delta > 0 && big) {
        spawnCoinBurst(6);
      } else if (flags.burst && delta > 0) {
        spawnCoinBurst(5);
      }
      if (flags.flash && !flags.jackpot) screenFlash(flags.flash);
    }
  }

  function showToast(msg, kind) {
    const host = el.toastHost;
    if (!host) return;
    const t = document.createElement("div");
    const k = kind && typeof kind === "string" ? kind : "";
    t.className = "toast" + (k ? " toast-" + k : "");
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.remove(), k === "jackpot" ? 3400 : 2800);
  }

  // ----- Monetization stubs (ads / IAP) — offline, no real SDK -----
  window.__monetizationLog = window.__monetizationLog || [];

  

  function applyAdsMasterSwitch() {
    if (!FEATURES.ADS_ENABLED) {
      document.querySelectorAll(".ad-chip, .bankrupt-ad-slot, #revealAdBar, #adCapLine, #warehouseFullOffers, #resultAdSlot, .ad-chip").forEach((n) => {
        n.hidden = true;
      });
    } else {
      document.querySelectorAll(".ad-chip, .bankrupt-ad-slot").forEach((n) => {
        // leave visibility to dedicated updaters
        n.hidden = false;
      });
      if (typeof updateAdCapUI === "function") updateAdCapUI();
    }
  }

  // ----- Eval mode (评测档) -----
  const EVAL_LS_KEY = "deltaStashEval";
  let evalMode = false;
  let evalAdsForcedOff = false;
  let evalForceFollowBall = false; // eval: FOLLOW_BALL_CHANCE → 1
  let evalSoftChallenge = false;   // eval: lower 鉴宝 threshold


  function applyEvalUrlFlags() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get("ball") === "1") evalForceFollowBall = true;
      if (q.get("soft") === "1") evalSoftChallenge = true;
    } catch (_) { /* ignore */ }
  }

  function evalModeOn() {
    try {
      if (/(?:\?|&)eval=1(?:&|$)/.test(location.search)) return true;
      if (localStorage.getItem(EVAL_LS_KEY) === "1") return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function setEvalPanelVisible(vis) {
    if (!el.evalPanel) return;
    el.evalPanel.hidden = !vis;
    // Button pressed state tracks panel visibility while evalMode stays on
    if (el.btnEvalMode && evalMode) {
      el.btnEvalMode.setAttribute("aria-pressed", vis ? "true" : "false");
      el.btnEvalMode.classList.toggle("on", !!vis);
    }
  }

  function setEvalMode(on, { showPanel } = {}) {
    evalMode = !!on;
    try {
      if (evalMode) localStorage.setItem(EVAL_LS_KEY, "1");
      else localStorage.removeItem(EVAL_LS_KEY);
    } catch (_) { /* ignore */ }
    document.body.classList.toggle("eval-mode", evalMode);
    if (el.btnDataPanel) el.btnDataPanel.hidden = !evalMode;
    if (el.btnEvalClear) el.btnEvalClear.hidden = !evalMode;
    if (!evalMode && el.dataPanel) el.dataPanel.hidden = true;
    // Mode ON → show panel by default (unless caller asks otherwise). Mode OFF → always hide.
    const wantPanel = evalMode && (showPanel !== false);
    if (el.evalPanel) el.evalPanel.hidden = !wantPanel;
    if (el.btnEvalMode) {
      const pressed = evalMode && wantPanel;
      el.btnEvalMode.setAttribute("aria-pressed", pressed ? "true" : "false");
      el.btnEvalMode.classList.toggle("on", !!pressed);
    }
    // Force ads off while evaluating; restore prior flag when leaving if we flipped it.
    if (evalMode) {
      if (FEATURES.ADS_ENABLED) {
        FEATURES.ADS_ENABLED = false;
        evalAdsForcedOff = true;
      } else {
        evalAdsForcedOff = false;
      }
    } else if (evalAdsForcedOff) {
      FEATURES.ADS_ENABLED = true;
      evalAdsForcedOff = false;
    }
    applyAdsMasterSwitch();
    // Keep settle-FX control visible/emphasized in eval
    if (el.btnFxMode) el.btnFxMode.hidden = false;
    syncEvalPanel();
    syncDataPanel();
    updateStats();
  }

  function toggleEvalMode() {
    setEvalMode(!evalMode);
  }

  function syncEvalPanel() {
    if (!el.evalPanel || !evalMode) return;
    const hm = (typeof honeymoonActive === "function") ? honeymoonActive() : false;
    let hmText = "蜜月：已结束";
    if (hm) {
      hmText = `蜜月：进行中 · 场次 ${round}/${HONEYMOON.ROUNDS} · 现金上限 ¥${HONEYMOON.CASH_END.toLocaleString("zh-CN")}`;
    } else if (!honeymoonEnded) {
      hmText = "蜜月：未开始/临界";
    }
    if (el.evalHoneymoonLine) el.evalHoneymoonLine.textContent = hmText;
    if (el.evalAdsLine) {
      el.evalAdsLine.textContent = `广告：强制关闭（FEATURES.ADS_ENABLED=${FEATURES.ADS_ENABLED}）`;
    }
    if (el.evalFxSelect) {
      const mode = settleFxMode === "fancy" ? "fancy" : "smooth";
      safeSetSelectValue(el.evalFxSelect, mode);
    }
    // Surface honeymoon chip even after end while evaluating
    if (el.honeymoonHint && evalMode) {
      el.honeymoonHint.hidden = false;
      el.honeymoonHint.textContent = hm ? "新手保护（评测）" : (honeymoonEnded ? "蜜月已结束（评测）" : "蜜月状态（评测）");
    }
    if (el.btnEvalForceBall) {
      el.btnEvalForceBall.setAttribute("aria-pressed", evalForceFollowBall ? "true" : "false");
      el.btnEvalForceBall.classList.toggle("on", evalForceFollowBall);
      el.btnEvalForceBall.textContent = evalForceFollowBall ? "强制跟随球 · 开" : "强制跟随球";
    }
    if (el.btnEvalSoftChallenge) {
      el.btnEvalSoftChallenge.setAttribute("aria-pressed", evalSoftChallenge ? "true" : "false");
      el.btnEvalSoftChallenge.classList.toggle("on", evalSoftChallenge);
      el.btnEvalSoftChallenge.textContent = evalSoftChallenge ? "软鉴宝门槛 · 开" : "软鉴宝门槛";
    }
  }

  function syncDataPanel() {
    if (!el.dataPanelList) return;
    const hall = (typeof activeAuctionHall === "function") ? activeAuctionHall() : null;
    let dailyBit = "—";
    try {
      const theme = (typeof getDailyTheme === "function") ? getDailyTheme() : null;
      if (theme) {
        dailyBit = `${theme.label || theme.name || theme.id} ${dailyActivityCount}/${theme.target}${theme.unit || ""}`;
        if (dailyActivityCompleted) dailyBit += dailyActivityJackpotRolled ? " · 大奖已抽" : " · 已完成";
      }
    } catch (_) { /* ignore */ }
    const opens = (typeof totalCrateOpens !== "undefined") ? totalCrateOpens : 0;
    el.dataPanelList.innerHTML =
      `<li>开箱：<strong>${opens}</strong></li>` +
      `<li>现金：<strong>${formatYen(cash)}</strong>（峰值 ${formatYen(peakCash)}）</li>` +
      `<li>拍卖厅：<strong>${hall ? hall.name : "未解锁"}</strong></li>` +
      `<li>每日：<strong>${dailyBit}</strong></li>` +
      `<li>连盈/连亏：${profitStreak} / ${lossStreak}</li>`;
  }

  function buildBugDiagnostics() {
    const hall = (typeof activeAuctionHall === "function") ? activeAuctionHall() : null;
    let mono = [];
    try {
      mono = (window.__monetizationLog || []).slice(-30);
    } catch (_) { mono = []; }
    return {
      ts: new Date().toISOString(),
      evalMode,
      cash,
      peakCash,
      round,
      totalCrateOpens: (typeof totalCrateOpens !== "undefined") ? totalCrateOpens : null,
      honeymoonActive: (typeof honeymoonActive === "function") ? honeymoonActive() : null,
      honeymoonEnded,
      settleFxMode,
      hall: hall ? { id: hall.id, name: hall.name, peakCash: hall.peakCash } : null,
      features: Object.assign({}, FEATURES),
      daily: {
        key: dailyActivityKey,
        count: dailyActivityCount,
        completed: dailyActivityCompleted,
        jackpotRolled: dailyActivityJackpotRolled,
      },
      gridSize: (typeof gridSize !== "undefined") ? gridSize : null,
      selectedTier: (typeof selectedTier !== "undefined") ? selectedTier : null,
      revealing: (typeof revealing !== "undefined") ? !!revealing : null,
      crateOpenedThisRound: (typeof crateOpenedThisRound !== "undefined") ? !!crateOpenedThisRound : null,
      extractedThisRound: (typeof extractedThisRound !== "undefined") ? !!extractedThisRound : null,
      bankrupt: (typeof bankrupt !== "undefined") ? !!bankrupt : null,
      crateBtnDom: el.crateTiers
        ? Array.from(el.crateTiers.querySelectorAll(".crate-btn")).map((b) => ({
            tier: b.dataset.tier,
            disabled: !!b.disabled,
            fee: (b.querySelector("[data-fee-label]") || {}).textContent || null,
            selected: b.classList.contains("selected"),
          }))
        : null,
      openBtnDisabled: el.btnOpenCrate ? !!el.btnOpenCrate.disabled : null,
      modals: {
        help: el.helpModal ? !el.helpModal.hidden : null,
        result: el.resultModal ? !el.resultModal.hidden : null,
        bankrupt: el.bankruptModal ? !el.bankruptModal.hidden : null,
        shop: el.shopModal ? !el.shopModal.hidden : null,
        challenge: el.challengeModal ? !el.challengeModal.hidden : null,
        confirm: el.confirmModal ? !el.confirmModal.hidden : null,
      },
      monetizationLogTail: mono,
      ua: (typeof navigator !== "undefined") ? navigator.userAgent : "",
    };
  }

  async function copyBugDiagnostics() {
    const payload = JSON.stringify(buildBugDiagnostics(), null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const ta = document.createElement("textarea");
        ta.value = payload;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      if (typeof showToast === "function") showToast("已复制诊断 JSON");
      else if (typeof addLog === "function") addLog("已复制诊断 JSON");
    } catch (err) {
      console.error(err);
      if (typeof showToast === "function") showToast("复制失败，请看控制台");
      console.log("[bug-diagnostics]", payload);
    }
  }


  function monoDebugOn() {
    try {
      return localStorage.getItem(MONO_DEBUG_KEY) === "1" ||
        /(?:\?|&)mono=1(?:&|$)/.test(location.search);
    } catch (_) { return false; }
  }

  function logMono(type, placementId, extra) {
    const ev = Object.assign({
      t: Date.now(),
      type,
      placement: placementId || null,
    }, extra || {});
    window.__monetizationLog.push(ev);
    if (window.__monetizationLog.length > 200) window.__monetizationLog.shift();
    try {
      console.log("[monetization]", type, placementId || "", extra || {});
    } catch (_) { /* ignore */ }
    if (monoDebugOn() && el.monoDebug) {
      el.monoDebug.hidden = false;
      const line = document.createElement("div");
      line.textContent = `${type} ${placementId || ""} ${extra ? JSON.stringify(extra) : ""}`;
      el.monoDebug.prepend(line);
      while (el.monoDebug.children.length > 12) el.monoDebug.removeChild(el.monoDebug.lastChild);
    }
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function organizeFreeRemaining() {
    let usedDay = organizeFreeUsedDay;
    try {
      usedDay = localStorage.getItem(ORGANIZE_FREE_DAY_KEY) || usedDay;
    } catch (_) { /* ignore */ }
    organizeFreeUsedDay = usedDay;
    return Math.max(0, ORGANIZE_DAILY_FREE_QUOTA - (usedDay === todayKey() ? 1 : 0));
  }

  function consumeOrganizeFree() {
    const day = todayKey();
    organizeFreeUsedDay = day;
    try {
      localStorage.setItem(ORGANIZE_FREE_DAY_KEY, day);
    } catch (_) { /* private mode / quota */ }
  }

  /** 「清算重整」daily quota — localStorage day key, max 1/calendar day. */
  function restructureUsedDay() {
    try {
      return localStorage.getItem(RESTRUCTURE.DAY_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function restructureAvailable() {
    return restructureUsedDay() !== todayKey();
  }

  function consumeRestructure() {
    const day = todayKey();
    try {
      localStorage.setItem(RESTRUCTURE.DAY_KEY, day);
    } catch (_) { /* private mode / quota */ }
  }

  function clearWarehouseAndStaging() {
    staging = [];
    pendingRevealLoot = null;
    revealGen += 1;
    placed.clear();
    virtualSlots = 0;
    keepStagingThisRound = false;
    selectedUid = null;
    grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
  }

  function updateBankruptModalUI() {
    if (!el.bankruptModal) return;
    const avail = restructureAvailable();
    const cashAmt = RESTRUCTURE.CASH;
    if (el.bankruptRestructureHint) {
      el.bankruptRestructureHint.hidden = !avail;
      el.bankruptRestructureHint.textContent =
        `清算重整：清空仓库与暂存，发放再起资金 ${formatYen(cashAmt)}（约 ${RESTRUCTURE.FEE_MULT}× 普通柜租金 ¥${CRATE_TIERS.common.fee.toLocaleString("zh-CN")}；每日 ${RESTRUCTURE.DAILY_MAX} 次）。`;
    }
    if (el.bankruptMeta) {
      el.bankruptMeta.textContent = avail
        ? "现金已不足以支付任何仓储租金。可「清算重整」清仓再起，或「新开档」。"
        : "现金已不足以支付任何仓储租金。今日「清算重整」已用完，只能「新开档」。";
    }
    if (el.btnRestructure) {
      el.btnRestructure.hidden = !avail;
      el.btnRestructure.disabled = !avail;
      el.btnRestructure.textContent = `清算重整（+${formatYen(cashAmt)}）`;
    }
    if (el.btnBankruptNewSave) el.btnBankruptNewSave.hidden = false;
    // Legacy full restart hidden — commercial path is restructure / 新开档 only
    if (el.btnRestart) el.btnRestart.hidden = true;
  }

  /**
   * Soft bailout: wipe warehouse + staging, grant ~1.3× common fee, resume play.
   * Does NOT reset honeymoon / perfect-pack token / organize-free / ADS flags / career stats.
   */
  function applyRestructure() {
    if (!restructureAvailable()) {
      showToast("今日清算重整已用完，请新开档");
      updateBankruptModalUI();
      return;
    }
    const wasExtracted = extractedThisRound;
    const grant = RESTRUCTURE.CASH;
    consumeRestructure();
    clearWarehouseAndStaging();
    cash = grant;
    snapCashDisplay();
    bankrupt = false;
    paidFeeThisRound = 0;
    crateOpenedThisRound = false;
    extractedThisRound = false;
    revealing = false;
    selectedTier = null;
    lastSettleLoss = 0;
    settleRefundUsed = false;
    hideRevealAdBar();
    if (revealPause) {
      try { resolveRevealPause(false); } catch (_) { /* ignore */ }
    }
    if (wasExtracted) {
      round += 1;
      maybeRollLimitedOffer();
    }
    if (el.bankruptModal) el.bankruptModal.hidden = true;
    if (el.resultModal) el.resultModal.hidden = true;
    if (el.btnNextRound) el.btnNextRound.hidden = true;
    renderStaging();
    renderGrid();
    showDetail(null);
    updateStats();
    updateCrateButtons();
    updateFeePreview();
    updateFreeRentOffer();
    updateWarehouseFullOffers();
    addLog(
      `清算重整 · 清仓再起资金 <strong>${formatYen(grant)}</strong>（${RESTRUCTURE.FEE_MULT}× 普通柜 ¥${CRATE_TIERS.common.fee.toLocaleString("zh-CN")}）· 今日已用`
    );
    setActionDesc(
      `清算重整完成：仓库与暂存已清空，现金 ${formatYen(cash)}。选柜付租继续。`
    );
    showToast(`清算重整成功 · 再起资金 ${formatYen(grant)}`);
    logMono("restructure", "清算重整", { cash: grant, mult: RESTRUCTURE.FEE_MULT, fee: CRATE_TIERS.common.fee });
    scheduleSave();
  }

  function emptyAdByCat() {
    return {
      free_rent: 0,
      warehouse_full: 0,
      settle_refund: 0,
      challenge_retry: 0,
      limited_refresh: 0,
    };
  }

  function readAdDay() {
    try {
      const raw = localStorage.getItem(AD_DAY_KEY);
      if (!raw) return { day: todayKey(), count: 0, byCat: emptyAdByCat() };
      const o = JSON.parse(raw);
      if (!o || o.day !== todayKey()) return { day: todayKey(), count: 0, byCat: emptyAdByCat() };
      const byCat = Object.assign(emptyAdByCat(), o.byCat || {});
      // Migrate legacy count-only saves into free_rent bucket for display continuity
      let count = Math.max(0, Number(o.count) || 0);
      const catSum = Object.keys(AD_CATEGORY_CAPS).reduce((s, k) => s + (byCat[k] || 0), 0);
      if (catSum === 0 && count > 0) {
        byCat.free_rent = Math.min(count, AD_CATEGORY_CAPS.free_rent);
      }
      count = Object.keys(AD_CATEGORY_CAPS).reduce((s, k) => s + (byCat[k] || 0), 0);
      return { day: o.day, count, byCat };
    } catch (_) {
      return { day: todayKey(), count: 0, byCat: emptyAdByCat() };
    }
  }

  function writeAdDay(dayObj) {
    try {
      localStorage.setItem(AD_DAY_KEY, JSON.stringify({
        day: dayObj.day || todayKey(),
        count: dayObj.count || 0,
        byCat: dayObj.byCat || emptyAdByCat(),
      }));
    } catch (_) { /* ignore */ }
  }

  function placementCategory(placementId) {
    return Object.prototype.hasOwnProperty.call(AD_PLACEMENT_CATEGORY, placementId)
      ? AD_PLACEMENT_CATEGORY[placementId]
      : null;
  }

  function categoryCap(cat) {
    if (cat === "limited_refresh") return AD_LIMITED_REFRESH_CAP;
    return AD_CATEGORY_CAPS[cat] || 0;
  }

  function categoryUsed(cat) {
    const day = readAdDay();
    return Math.max(0, Number(day.byCat[cat]) || 0);
  }

  function categoryRemaining(cat) {
    return Math.max(0, categoryCap(cat) - categoryUsed(cat));
  }

  function adsRemaining() {
    return Math.max(0, AD_DAILY_CAP - readAdDay().count);
  }

  /** Whether this placement can still be watched today (caps + disabled). */
  function canWatchAd(placementId) {
    if (placementId === AD_PLACEMENTS.REVEAL_NEXT) return false;
    const cat = placementCategory(placementId);
    if (!cat) return false;
    if (cat === "limited_refresh") {
      return categoryRemaining(cat) > 0;
    }
    if (adsRemaining() <= 0) return false;
    return categoryRemaining(cat) > 0;
  }

  function updateAdCapUI() {
    if (!FEATURES.ADS_ENABLED) {
      if (el.adCapLine) el.adCapLine.hidden = true;
      return;
    }
    const day = readAdDay();
    const left = adsRemaining();
    if (el.adCapLine) {
      const show = cash < minPlayableFee() || freeRentCharges > 0 || !el.btnAdFreeRent?.hidden || left < AD_DAILY_CAP;
      el.adCapLine.hidden = !show && left >= AD_DAILY_CAP;
      const fr = categoryRemaining("free_rent");
      const wh = categoryRemaining("warehouse_full");
      const rf = categoryRemaining("settle_refund");
      const ch = categoryRemaining("challenge_retry");
      el.adCapLine.textContent =
        `今日广告 ${day.count}/${AD_DAILY_CAP} · 再租${fr}/2 · 满仓${wh}/2 · 回血${rf}/2 · 重试${ch}/2`;
    }
  }

  function logAdOfferOnce(placementId, extra) {
    const key = `${todayKey()}::${placementId}`;
    if (adOfferLogged[key]) return;
    adOfferLogged[key] = true;
    logMono("ad_offer", placementId, Object.assign({ remaining: adsRemaining() }, extra || {}));
  }

  function updateKeysUI() {
    if (el.keysChip) {
      const need = OPEN_MILESTONE_CFG.KEY_FRAGS_PER_KEY || 3;
      el.keysChip.textContent = keyFragments > 0
        ? `🔑 ×${keys} · 碎片 ${keyFragments}/${need}`
        : `🔑 ×${keys}`;
      el.keysChip.title = keyFragments > 0
        ? `钥匙 ×${keys} · 钥匙碎片 ${keyFragments}/${need}（满则合成）`
        : "钥匙（内购占位货币）";
    }
    if (el.discountChip) {
      const has = nextCrateDiscountPct > 0;
      el.discountChip.hidden = !has;
      if (has) {
        el.discountChip.textContent = `下一柜 -${Math.round(nextCrateDiscountPct * 100)}%`;
        el.discountChip.title = `完美装箱奖励：下场开箱租金减 ${Math.round(nextCrateDiscountPct * 100)}%（用一次）`;
      }
    }
    if (el.btnSpeedOrganize) {
      const show = FEATURES.ORGANIZE_STUB_ENABLED || FEATURES.IAP_SHOP_ENABLED;
      el.btnSpeedOrganize.hidden = !show;
      el.btnSpeedOrganize.classList.remove("ad-chip"); // never hide with ADS_ENABLED=false sweep
      if (speedOrganizeUnlocked) {
        el.btnSpeedOrganize.textContent = "⚡ 一键整理";
        el.btnSpeedOrganize.title = "一键整理（已解锁）";
      } else if (organizeFreeRemaining() > 0) {
        el.btnSpeedOrganize.textContent = "⚡ 整理 今日免费";
        el.btnSpeedOrganize.title = "一键整理（今日免费 1 次）";
      } else {
        el.btnSpeedOrganize.textContent = `⚡ 整理 ${ORGANIZE_IAP_PRICE} / 🔑${ORGANIZE_KEY_COST}`;
        el.btnSpeedOrganize.title = `一键整理（占位 ${ORGANIZE_IAP_PRICE} / 或花${ORGANIZE_KEY_COST}钥匙）`;
      }
    }
    // Packing mode: collapse crate chrome on mobile; keep staging visible
    const packingNow = !!(crateOpenedThisRound && !extractedThisRound);
    const wasPacking = document.body.classList.contains("packing");
    document.body.classList.toggle("packing", packingNow);
    // Narrow immersion: auto-collapse eval/data panels when packing starts
    // (CSS docks them as bottom sheet; do not force display:none via packing)
    if (packingNow && !wasPacking) {
      // Only on the transition into packing — never re-hide every frame
      setEvalPanelVisible(false);
      if (el.dataPanel) el.dataPanel.hidden = true;
    }
    // Ensure packing class is on as soon as crate is open (staging CSS depends on it)
    if (packingNow) document.body.classList.add("packing");
    if (document.body.classList.contains("is-mobile") || window.matchMedia("(max-width: 700px)").matches) {
      requestAnimationFrame(() => fitCellSizeToWrap());
    }
  }

  function updateFreeRentOffer() {
    // Ads off: never surface free-rent ad chips (bankrupt soft-lock still uses cash/IAP)
    if (!FEATURES.ADS_ENABLED) {
      if (el.btnAdFreeRent) el.btnAdFreeRent.hidden = true;
      if (el.btnAdBankruptRent) el.btnAdBankruptRent.hidden = true;
      updateAdCapUI();
      return;
    }
    const broke = cash < minPlayableFee();
    const homeIdle = !crateOpenedThisRound && !extractedThisRound && !revealing && !bankrupt;
    const rem = categoryRemaining("free_rent");
    const canOffer = rem > 0 && adsRemaining() > 0 && freeRentCharges === 0;
    if (el.btnAdFreeRent) {
      el.btnAdFreeRent.hidden = !(broke || homeIdle) || freeRentCharges > 0;
      el.btnAdFreeRent.disabled = !canOffer;
      el.btnAdFreeRent.textContent = canOffer
        ? `▶ 看广告 · 免费再租 1 次（今日${rem}/2）`
        : rem <= 0
          ? "今日免费再租广告已用完"
          : "▶ 看广告 · 免费再租 1 次";
      if (!el.btnAdFreeRent.hidden && canOffer) {
        logAdOfferOnce(AD_PLACEMENTS.FREE_RENT, { rem });
      }
    }
    if (el.btnAdBankruptRent) {
      el.btnAdBankruptRent.hidden = false;
      el.btnAdBankruptRent.disabled = !canOffer;
      el.btnAdBankruptRent.textContent = canOffer
        ? `▶ 看广告 · 免费再租 1 次（今日${rem}/2）`
        : "今日免费再租广告已用完";
      if (!el.bankruptModal?.hidden && canOffer) {
        logAdOfferOnce(AD_PLACEMENTS.FREE_RENT, { rem, via: "bankrupt" });
      }
    }
    updateAdCapUI();
  }

  function updateWarehouseFullOffers() {
    if (!el.warehouseFullOffers) return;
    if (!FEATURES.ADS_ENABLED) {
      el.warehouseFullOffers.hidden = true;
      return;
    }
    const fullPressure =
      crateOpenedThisRound &&
      !extractedThisRound &&
      !revealing &&
      staging.length > 0 &&
      (usedCells() >= gridSize * gridSize - 2 || staging.length >= 3);
    el.warehouseFullOffers.hidden = !fullPressure;
    const rem = categoryRemaining("warehouse_full");
    const poolOk = rem > 0 && adsRemaining() > 0;
    if (el.btnAdKeepLoot) {
      const used = keepStagingThisRound;
      el.btnAdKeepLoot.disabled = used || !poolOk;
      el.btnAdKeepLoot.textContent = used
        ? "已启用 · 本局不弃货"
        : poolOk
          ? `▶ 看广告 · 本局不弃货（满仓${rem}/2）`
          : "今日满仓广告已用完";
    }
    if (el.btnAdTempSlots) {
      const used = virtualSlots > 0;
      el.btnAdTempSlots.disabled = used || !poolOk;
      el.btnAdTempSlots.textContent = used
        ? `已临时+${virtualSlots}格`
        : poolOk
          ? `▶ 看广告临时+2格（满仓${rem}/2）`
          : "今日满仓广告已用完";
    }
    if (fullPressure && poolOk) {
      logAdOfferOnce(AD_PLACEMENTS.WAREHOUSE_TEMP, { rem });
      logAdOfferOnce(AD_PLACEMENTS.KEEP_STAGING, { rem });
    }
  }

  let confirmCb = null;
  function showConfirm(title, body, onOk) {
    if (!el.confirmModal) {
      if (confirm(`${title}\n\n${body}`)) onOk();
      return;
    }
    el.confirmTitle.textContent = title;
    el.confirmBody.textContent = body;
    confirmCb = onOk;
    el.confirmModal.hidden = false;
  }

  function closeConfirm(ok) {
    if (el.confirmModal) el.confirmModal.hidden = true;
    const cb = confirmCb;
    confirmCb = null;
    if (ok && typeof cb === "function") cb();
  }

  /** Request a portal rewarded video; rewards are granted only after completion. */
  async function offerRewardedAd(placementId, onSuccess) {
    // Local/itch builds have no ad SDK and must remain completely playable.
    if (!FEATURES.ADS_ENABLED) {
      logMono("ad_cap", placementId, { reason: "ads_disabled" });
      showToast("广告已关闭（试玩）");
      return;
    }
    logMono("ad_click", placementId, { remaining: adsRemaining() });
    if (placementId === AD_PLACEMENTS.REVEAL_NEXT) {
      showToast("「看广告开下一件」已关闭（不打断开箱节奏）");
      logMono("ad_cap", placementId, { reason: "disabled" });
      return;
    }
    const cat = placementCategory(placementId);
    if (!cat) {
      showToast("该广告位暂不可用");
      logMono("ad_cap", placementId, { reason: "unknown_placement" });
      return;
    }
    const day = readAdDay();
    const usedCat = Math.max(0, Number(day.byCat[cat]) || 0);
    const capCat = categoryCap(cat);
    if (usedCat >= capCat) {
      const label = AD_CATEGORY_LABELS[cat] || cat;
      showToast(`今日「${label}」广告已达上限（${capCat}次）`);
      logMono("ad_cap", placementId, { category: cat, used: usedCat, cap: capCat, reason: "category" });
      updateAdCapUI();
      return;
    }
    if (cat !== "limited_refresh" && day.count >= AD_DAILY_CAP) {
      showToast(`今日广告次数已用完（${AD_DAILY_CAP}次）`);
      logMono("ad_cap", placementId, { count: day.count, reason: "total" });
      updateAdCapUI();
      return;
    }
    if (!platform || !platform.supportsRewarded || !platform.supportsRewarded()) {
      showToast("当前渠道暂不支持广告奖励");
      logMono("ad_cap", placementId, { reason: "sdk_unavailable" });
      return;
    }
    const completed = await platform.requestRewarded();
    if (!completed) {
      showToast("广告暂不可用，请稍后再试");
      logMono("ad_cap", placementId, { reason: "not_completed" });
      return;
    }
    day.byCat[cat] = usedCat + 1;
    if (cat !== "limited_refresh") {
      day.count = Object.keys(AD_CATEGORY_CAPS).reduce((s, k) => s + (day.byCat[k] || 0), 0);
    }
    writeAdDay(day);
    logMono("ad_complete", placementId, {
      category: cat,
      count: day.count,
      catUsed: day.byCat[cat],
      catCap: capCat,
    });
    showToast("广告观看完成，奖励已到账");
    updateAdCapUI();
    updateFreeRentOffer();
    updateWarehouseFullOffers();
    updateLimitedOfferUI();
    if (typeof onSuccess === "function") onSuccess();
  }

  function grantFreeRent() {
    freeRentCharges += 1;
    bankrupt = false;
    if (el.bankruptModal) el.bankruptModal.hidden = true;
    showToast("已获得免费再租 1 次");
    setActionDesc("免费租柜券已到账：下场开箱将免租金一次。");
    updateFreeRentOffer();
    updateStats();
    scheduleSave();
  }

  function grantTempSlots() {
    virtualSlots += 2;
    showToast("临时货架 +2：结算时最多 2 件暂存货可一并转卖");
    setActionDesc(`临时+${virtualSlots}格已生效：未装箱的暂存货中，价值最高的最多 ${virtualSlots} 件会在结算时自动售出。`);
    updateWarehouseFullOffers();
    scheduleSave();
  }

  function grantKeepStaging() {
    keepStagingThisRound = true;
    showToast("本局不弃货：暂存区货物结算时一并转卖");
    setActionDesc("本局不弃货已启用——暂存区未装箱货物也会计入转卖。");
    updateWarehouseFullOffers();
    scheduleSave();
  }

  function grantSettleRefund() {
    if (settleRefundUsed || lastSettleLoss <= 0) return;
    const pct = 0.3 + Math.random() * 0.2; // 30%–50%
    const refund = Math.round(lastSettleLoss * pct);
    cash += refund;
    totalPnL += refund;
    settleRefundUsed = true;
    queueCashFx({ pulse: "reward", burst: refund >= BIG_GAIN_ABS });
    showToast(`广告回本 +${formatYen(refund)}（${Math.round(pct * 100)}%）`, "success");
    if (el.resultCash) el.resultCash.textContent = formatYen(cash);
    if (el.resultAdSlot) el.resultAdSlot.hidden = true;
    addLog(`广告回本 <strong>${formatYen(refund)}</strong>（亏损的 ${Math.round(pct * 100)}%）`);
    updateStats();
    checkBankrupt();
    scheduleSave();
  }

  function renderShop() {
    if (!el.shopGrid) return;
    el.shopGrid.innerHTML = "";
    IAP_SKUS.forEach((sku) => {
      logMono("iap_offer", sku.id, { price: sku.price });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shop-sku";
      btn.dataset.sku = sku.id;
      btn.innerHTML = `
        <span class="sku-name">${sku.name}</span>
        <span class="sku-price">${sku.price}</span>
        <span class="sku-desc">${sku.desc}</span>`;
      btn.addEventListener("click", () => stubPurchase(sku));
      el.shopGrid.appendChild(btn);
    });
  }

  function stubPurchase(sku) {
    logMono("iap_click", sku.id, { price: sku.price });
    showConfirm(
      "确认补给（测试）",
      `购买「${sku.name}」· ${sku.price}\n（占位：不会真实扣款）`,
      () => {
        logMono("iap_complete", sku.id, { price: sku.price });
        applyIap(sku);
      }
    );
  }

  function applyIap(sku) {
    if (sku.keys) {
      keys += sku.keys;
      showToast(`获得钥匙 ×${sku.keys}`);
    }
    if (sku.rareBoost) {
      rareBoostCharges += sku.rareBoost;
      showToast("稀有仓储券已生效：下场开箱金/红权重提升");
    }
    if (sku.gridMin) {
      if (gridSize >= sku.gridMin) {
        showToast(`仓库已是 ${gridSize}×${gridSize}，无需重复扩容`);
      } else {
        applyExpand(sku.gridMin, "iap");
      }
    }
    if (sku.speedOrganize) {
      speedOrganizeUnlocked = true;
      showToast("已解锁「一键整理」");
    }
    if (sku.protectOnce) {
      protectCharges += sku.protectOnce;
      showToast(`已获得贵货保级 ×${sku.protectOnce}`);
    }
    updateKeysUI();
    updateStats();
    scheduleSave();
  }

  function openShop() {
    renderShop();
    if (el.shopModal) el.shopModal.hidden = false;
    logMono("iap_click", "shop_open");
  }

  /** Soft rarity boost from rare-unit IAP — mild, not free red */
  function rareBoostFactor(rarityId) {
    if (rareBoostCharges <= 0) return 1;
    const hot = new Set(["xiaojin", "dajin", "xiaohong", "dahong"]);
    if (hot.has(rarityId)) return 1.55;
    if (rarityId === "purple") return 1.2;
    if (rarityId === "white" || rarityId === "green") return 0.85;
    return 1;
  }

  function findBestPackSlot(defId, ignoreUid) {
    // Highest-value packing: try rotations × row-major positions; first fit
    for (let rot = 0; rot < 4; rot++) {
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          if (canPlace(defId, rot, r, c, ignoreUid)) {
            return { r, c, rot };
          }
        }
      }
    }
    return null;
  }

  function planOrganizeFromStaging() {
    // Simulate packing highest-value staging items first into free cells (grid stays)
    const sorted = [...staging].sort((a, b) => itemValue(b) - itemValue(a));
    // Shadow occupancy from current grid
    const shadow = Array.from({ length: gridSize }, (_, r) =>
      Array.from({ length: gridSize }, (_, c) => (grid[r][c] ? grid[r][c].uid : null))
    );
    const canShadow = (defId, rot, or, oc) => {
      for (const { r, c } of cellsFor(defId, rot, or, oc)) {
        if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) return false;
        if (shadow[r][c]) return false;
      }
      return true;
    };
    const markShadow = (defId, rot, or, oc, uid) => {
      for (const { r, c } of cellsFor(defId, rot, or, oc)) shadow[r][c] = uid;
    };
    const plan = [];
    let left = 0;
    for (const e of sorted) {
      let slot = null;
      for (let rot = 0; rot < 4 && !slot; rot++) {
        for (let r = 0; r < gridSize && !slot; r++) {
          for (let c = 0; c < gridSize && !slot; c++) {
            if (canShadow(e.defId, rot, r, c)) slot = { r, c, rot };
          }
        }
      }
      if (slot) {
        plan.push({ entry: e, ...slot });
        markShadow(e.defId, slot.rot, slot.r, slot.c, e.uid);
      } else {
        left += 1;
      }
    }
    const totalVal = plan.reduce((s, p) => s + itemValue(p.entry), 0);
    return { plan, left, totalVal };
  }

  let organizeBusy = false;
  async function runOrganizeAnimation(plan) {
    organizeBusy = true;
    try {
      for (const step of plan) {
        const e = step.entry;
        if (!findStaging(e.uid)) continue;
        const ok = placeItem(
          { uid: e.uid, defId: e.defId, rot: step.rot, valueOverride: e.valueOverride },
          step.r,
          step.c
        );
        if (!ok) continue;
        staging = staging.filter((s) => s.uid !== e.uid);
        fx("placeSnap");
        renderStaging();
        renderGrid();
        updateStats();
        // Brief highlight
        const cells = cellsFor(e.defId, step.rot, step.r, step.c);
        for (const cell of cells) {
          const cellEl = el.warehouseGrid.querySelector(`[data-r="${cell.r}"][data-c="${cell.c}"]`);
          if (cellEl) cellEl.classList.add("hl-ok");
        }
        await new Promise((r) => setTimeout(r, 160));
        clearHighlights();
      }
    } finally {
      organizeBusy = false;
      scheduleSave();
    }
  }

  function requestOrganize() {
    if (organizeBusy || drag.active || revealing) return;
    if (!FEATURES.ORGANIZE_STUB_ENABLED && !speedOrganizeUnlocked) {
      showToast("一键整理未开放");
      return;
    }
    if (staging.length === 0) {
      showToast("暂存区没有可整理的货物");
      return;
    }
    const go = (source = "iap") => {
      const { plan, left, totalVal } = planOrganizeFromStaging();
      if (!plan.length) {
        showToast("当前仓库没有空位可装入");
        return false;
      }
      if (source === "free") {
        consumeOrganizeFree();
        logMono("organize_free_use", "organize_daily_free", { packed: plan.length, left, totalVal });
        updateKeysUI();
      } else {
        logMono("iap_click", "iap_speed_organize_use", { source, packed: plan.length, left, totalVal });
      }
      showToast(`整理计划：装入 ${plan.length} 件 · 总价值 ${formatYen(totalVal)} · 剩 ${left} 件`);
      runOrganizeAnimation(plan);
      return true;
    };
    if (speedOrganizeUnlocked) {
      go("unlocked");
      return;
    }
    if (organizeFreeRemaining() > 0) {
      go("free");
      return;
    }
    // Stub unlock: IAP $0.99 OR spend keys
    const keyOk = FEATURES.KEYS_ENABLED && keys >= ORGANIZE_KEY_COST;
    const msg = keyOk
      ? `解锁「一键整理」· ${ORGANIZE_IAP_PRICE}（占位）
或花费钥匙 ×${ORGANIZE_KEY_COST}（当前 ${keys}）单次使用。
点确认 = 补给占位解锁；点取消后可再选钥匙。`
      : `解锁「一键整理」· ${ORGANIZE_IAP_PRICE}
（占位：不会真实扣款）`;
    showConfirm("一键整理", msg, () => {
      const sku = IAP_SKUS.find((s) => s.id === "iap_speed_organize");
      if (sku) {
        logMono("iap_complete", sku.id, { price: sku.price });
        applyIap(sku);
      } else {
        speedOrganizeUnlocked = true;
      }
      go();
    });
    // Also offer key spend via second path when keys available
    if (keyOk) {
      // Soft alternate: long-press not available; show toast hint
      setTimeout(() => {
        if (speedOrganizeUnlocked || organizeBusy) return;
        showToast(`提示：也可花 ${ORGANIZE_KEY_COST} 钥匙单次整理（点整理后再确认钥匙）`);
      }, 600);
      // Wire one-shot key spend if user cancels IAP — attach once on confirm modal cancel? Keep simple:
      // If they click organize again after cancel, offer keys.
    }
  }

  function speedOrganizeAll() {
    // The daily free use takes priority over paid/key fallback.
    if (!speedOrganizeUnlocked && organizeFreeRemaining() > 0) {
      requestOrganize();
      return;
    }
    // Back-compat alias: after the daily free use, spend one key when available.
    if (!speedOrganizeUnlocked && FEATURES.KEYS_ENABLED && keys >= ORGANIZE_KEY_COST && staging.length > 0) {
      showConfirm(
        "钥匙整理",
        `花费钥匙 ×${ORGANIZE_KEY_COST} 进行一次一键整理？
（也可在补给花 ${ORGANIZE_IAP_PRICE} 永久解锁）`,
        () => {
          keys -= ORGANIZE_KEY_COST;
          updateKeysUI();
          const { plan, left, totalVal } = planOrganizeFromStaging();
          if (!plan.length) {
            keys += ORGANIZE_KEY_COST; // refund
            updateKeysUI();
            showToast("没有空位，已退回钥匙");
            return;
          }
          showToast(`整理：装入 ${plan.length} 件 · ${formatYen(totalVal)} · 剩 ${left}`);
          logMono("iap_click", "organize_key_spend", { packed: plan.length });
          runOrganizeAnimation(plan);
          scheduleSave();
        }
      );
      return;
    }
    requestOrganize();
  }


  function addLog(html, persist) {
    const li = document.createElement("li");
    li.innerHTML = html;
    el.roundLog.prepend(li);
    if (persist !== false) {
      historyLog.unshift({ html });
      if (historyLog.length > HISTORY_MAX) historyLog.length = HISTORY_MAX;
      // trim DOM
      while (el.roundLog.children.length > HISTORY_MAX) {
        el.roundLog.removeChild(el.roundLog.lastChild);
      }
      scheduleSave();
    }
  }

  function renderHistoryFromSave() {
    el.roundLog.innerHTML = "";
    historyLog.forEach((entry) => {
      const li = document.createElement("li");
      li.innerHTML = entry.html;
      el.roundLog.appendChild(li);
    });
  }

  function updateCrateButtons() {
    el.crateTiers.querySelectorAll(".crate-btn").forEach((btn) => {
      const tid = btn.dataset.tier;
      if (tid === "limited") return; // limited lives in its own panel
      const tier = CRATE_TIERS[tid];
      const feeLabel = btn.querySelector("[data-fee-label]");
      const feeBase = tier ? tierFee(tid) : 0;
      const feeNow = tier ? effectiveTierFee(tid) : 0;
      if (feeLabel && tier) {
        const disc = nextCrateDiscountPct > 0 && feeNow < feeBase;
        const baseLabel = honeymoonActive() && HONEYMOON.FEE_MULT[tid]
          ? `保护租金 ${formatYen(feeNow)}`
          : `租金 ${formatYen(feeNow)}`;
        feeLabel.textContent = disc ? `${baseLabel}（折）` : baseLabel;
      }
      const freeKindBtn = freeTokenForTier(tid);
      const canAfford = !!freeKindBtn || cash >= feeNow;
      const hasBailout = freeCommonCharges > 0 || freeRentCharges > 0;
      btn.disabled = crateOpenedThisRound || extractedThisRound || (bankrupt && !hasBailout) || revealing || !canAfford;
      btn.classList.toggle("selected", selectedTier === tid);
      btn.classList.toggle("unaffordable", !canAfford && !crateOpenedThisRound);
    });
    // Limited selection validity
    if (selectedTier === "limited" && !limitedOfferActive()) {
      selectedTier = null;
    }
    const tierObj = selectedTier ? CRATE_TIERS[selectedTier] : null;
    const freeKindSel = selectedTier ? freeTokenForTier(selectedTier) : null;
    const hasBailout = freeCommonCharges > 0 || freeRentCharges > 0;
    const canOpen =
      selectedTier &&
      tierObj &&
      !crateOpenedThisRound &&
      !extractedThisRound &&
      !(bankrupt && !hasBailout && !freeKindSel) &&
      !revealing &&
      (selectedTier !== "limited" || limitedOfferActive()) &&
      (!!freeKindSel || cash >= effectiveTierFee(selectedTier));
    el.btnOpenCrate.disabled = !canOpen;
    if (el.btnOpenCrate) {
      const useFreeBtn = !!freeKindSel && !crateOpenedThisRound;
      const discBtn = !useFreeBtn && nextCrateDiscountPct > 0 && !crateOpenedThisRound;
      el.btnOpenCrate.textContent = useFreeBtn
        ? `${freeTokenLabel(freeKindSel)}开箱`
        : discBtn
          ? `折扣开箱（-${Math.round(nextCrateDiscountPct * 100)}%）`
          : selectedTier === "limited"
            ? "支付限时租金并开箱"
            : "支付租金并开箱";
    }
    updateLimitedOfferUI();
  }

  function checkBankrupt() {
    // Bankrupt when cash can't cover cheapest playable rent (and no free-rent charge).
    // Spec: cash ≤ 0 OR can't continue → offer 「清算重整」 once/day (no ads).
    if (cash < minPlayableFee() && freeCommonCharges <= 0 && freeRentCharges <= 0) {
      bankrupt = true;
      el.bankruptCash.textContent = formatYen(cash);
      el.bankruptPnL.textContent = formatYen(totalPnL);
      updateBankruptModalUI();
      el.bankruptModal.hidden = false;
      const avail = restructureAvailable();
      setActionDesc(
        avail
          ? "现金不足以支付任何仓储租金——可「清算重整」清仓再起（每日 1 次），或「新开档」。"
          : "现金不足以支付任何仓储租金——今日「清算重整」已用完，请「新开档」。"
      );
      updateCrateButtons();
      updateFreeRentOffer();
      scheduleSave();
      return true;
    }
    if (cash < minPlayableFee() && (freeCommonCharges > 0 || freeRentCharges > 0)) {
      bankrupt = false;
      if (el.bankruptModal) el.bankruptModal.hidden = true;
    }
    return false;
  }

  // ----- Crate (pay fee → open) -----
  const REVEAL_AD_RARITIES = new Set(["blue", "purple", "xiaojin", "dajin", "xiaohong", "dahong"]);

  /** Free open tokens: common-only / rare-only / legacy freeRent (any daily tier). */
  function freeTokenForTier(tierId) {
    if (tierId === "common" && freeCommonCharges > 0) return "common";
    if (tierId === "rare" && freeRareCharges > 0) return "rare";
    if (tierId && tierId !== "limited" && freeRentCharges > 0) return "rent";
    return null;
  }

  function consumeFreeToken(kind) {
    if (kind === "common") freeCommonCharges = Math.max(0, freeCommonCharges - 1);
    else if (kind === "rare") freeRareCharges = Math.max(0, freeRareCharges - 1);
    else if (kind === "rent") freeRentCharges = Math.max(0, freeRentCharges - 1);
  }

  function freeTokenLabel(kind) {
    if (kind === "common") return "普通柜免费券";
    if (kind === "rare") return "精选柜免费券";
    return "免费再租券";
  }

  function openCrate() {
    if (!selectedTier || crateOpenedThisRound || bankrupt || revealing) return;
    if (selectedTier === "limited" && !limitedOfferActive()) {
      showToast("限时货柜已过期");
      selectedTier = null;
      updateCrateButtons();
      return;
    }
    // Snapshot the tier: side effects below (open-milestone rewards → updateStats →
    // updateCrateButtons) clear a "limited" selection once the offer is consumed, which
    // used to make rollLoot(null) return [] (paid ¥ but empty crate). Never re-read
    // selectedTier after this point.
    const tierId = selectedTier;
    const tier = CRATE_TIERS[tierId];
    hideUpdateBanner(); // never show the update prompt during an open / reveal
    // Free tokens: common / rare dedicated, or legacy freeRent — never luxury limited
    const freeKind = freeTokenForTier(tierId);
    const useFree = !!freeKind;
    const rentBase = tierFee(tierId);
    const rent = effectiveTierFee(tierId);
    if (!useFree && cash < rent) {
      setActionDesc(`现金不足，无法租下「${tier.name}」（需 ${formatYen(rent)}）。可看广告免费再租。`);
      updateFeePreview();
      updateFreeRentOffer();
      return;
    }

    let feePaid = 0;
    if (useFree) {
      consumeFreeToken(freeKind);
      feePaid = 0;
      paidFeeThisRound = 0;
      showToast(`已使用${freeTokenLabel(freeKind)}`);
      // 免费券优先：不消耗下一柜折扣券
    } else {
      const usedDisc = nextCrateDiscountPct > 0 && rent < rentBase;
      const discPctUsed = nextCrateDiscountPct;
      if (usedDisc) nextCrateDiscountPct = 0;
      const cashBeforeRent = cash;
      cash -= rent;
      // Store exactly what left the wallet (post discount + hall markup) — refunds use this.
      feePaid = cashBeforeRent - cash;
      paidFeeThisRound = feePaid;
      if (usedDisc) {
        showToast(`已使用下一柜折扣（-${Math.round(discPctUsed * 100)}%）`);
      }
    }

    // Light key consume on sealed/limited when keys available (flavor / future currency)
    if ((tierId === "sealed" || tierId === "limited") && keys > 0) {
      keys -= 1;
      updateKeysUI();
      showToast(tierId === "limited" ? "消耗钥匙 ×1（限时柜）" : "消耗钥匙 ×1（密封柜）");
    }
    // Consuming a limited offer removes it (miss countdown otherwise)
    if (tierId === "limited") {
      limitedOffer = null;
      if (limitedTickTimer) { clearInterval(limitedTickTimer); limitedTickTimer = null; }
    }

    totalCrateOpens += 1;
    checkOpenMilestones();

    const usedRareBoost = rareBoostCharges > 0;
    const loot = rollLoot(tierId);
    // Paid/free open must never be empty — deliver a real 垫底货 up front.
    if (!Array.isArray(loot) || loot.length === 0) {
      console.warn("[openCrate] empty roll for", tierId, "— adding fallback item");
      loot.push(makeFallbackLootEntry(tierId));
    }
    pendingRevealLoot = loot;
    revealGen += 1;
    recordDailyActivityLoot(loot);
    if (tierId === "limited") recordDailyLimitedOpen();
    if (tierId === "sealed") recordDailySealedOpen();
    if (usedRareBoost) {
      rareBoostCharges -= 1;
      showToast("稀有仓储券已消耗");
    }
    revealing = true;
    keepStagingThisRound = false;
    virtualSlots = 0;
    scheduleSave();

    noteDailyBestFromLoot(loot, tierId);

    const feeLabel = feePaid > 0 ? `已付 ${formatYen(feePaid)}` : "免费再租";
    const hall = activeAuctionHall();
    const hallId = hall ? hall.id : null;
    const audio = FX();
    const timing = (audio && typeof audio.getCrateOpenTiming === "function")
      ? audio.getCrateOpenTiming(tierId)
      : { totalMs: tierId === "common" ? 800 : tierId === "rare" ? 1200 : tierId === "limited" ? 2500 : 2200, phases: [] };

    // ---- Skippable industrial open ceremony (locked timings) ----
    el.scanOverlay.hidden = false;
    el.scanOverlay.classList.add("skip-ready");
    if (el.scanBox) {
      el.scanBox.classList.remove("tier-common", "tier-rare", "tier-sealed", "tier-limited");
      el.scanBox.classList.add("tier-" + (tierId || "rare"));
    }
    el.scanTitle.textContent = `正在撬开「${tier.name}」…（${feeLabel}）`;
    if (el.scanProgress) el.scanProgress.textContent = (timing.phases[0] && timing.phases[0].cue) || "撬锁…";
    if (el.scanDoorBar) el.scanDoorBar.style.width = "0%";
    el.scanList.innerHTML = "";

    fx("resume");
    let openHandle = null;
    if (audio && typeof audio.playCrateOpen === "function") {
      try { openHandle = audio.playCrateOpen(tierId, hallId); } catch (_) { openHandle = null; }
    }

    const phaseTimers = [];
    let doorRaf = 0;
    let finished = false;
    const t0 = performance.now();

    const finishOpen = () => {
      if (finished) return;
      finished = true;
      phaseTimers.forEach((id) => clearTimeout(id));
      if (doorRaf) cancelAnimationFrame(doorRaf);
      if (openHandle && typeof openHandle.cancel === "function") openHandle.cancel();
      if (el.scanOverlay) {
        el.scanOverlay.removeEventListener("pointerdown", onSkip);
        el.scanOverlay.classList.remove("skip-ready");
        el.scanOverlay.hidden = true;
      }
      if (el.scanDoorBar) el.scanDoorBar.style.width = "100%";
      crateOpenedThisRound = true;
      document.body.classList.add("packing");
      staging = [];
      renderStaging();
      Promise.resolve(runSequentialReveal(loot, tier, feePaid, tierId)).catch((err) => {
        console.warn("[openCrate] reveal failed", err);
        flushPendingRevealLoot();
        revealing = false;
        if (el.challengeModal) el.challengeModal.hidden = true;
        challengeActive = null;
        updateStats();
        scheduleSave();
      });
    };

    function onSkip(ev) {
      if (ev) ev.preventDefault();
      // Quick lid sting so skip still feels like an open
      try {
        if (audio && typeof audio.playOpenPhaseSfx === "function") {
          audio.playOpenPhaseSfx("lid", tierId, hallId);
        }
      } catch (_) { /* ignore */ }
      finishOpen();
    }

    (timing.phases || []).forEach((ph) => {
      phaseTimers.push(setTimeout(() => {
        if (finished) return;
        if (el.scanProgress) el.scanProgress.textContent = ph.cue || "";
        const pct = Math.min(98, Math.round((ph.at / Math.max(1, timing.totalMs)) * 100) + 8);
        if (el.scanDoorBar) el.scanDoorBar.style.width = pct + "%";
      }, ph.at));
    });

    const tickDoor = (now) => {
      if (finished) return;
      const p = Math.min(1, (now - t0) / Math.max(1, timing.totalMs));
      if (el.scanDoorBar) {
        // Smooth bar; phase snaps still jump ahead slightly
        const cur = parseFloat(el.scanDoorBar.style.width) || 0;
        const target = p * 100;
        if (target > cur) el.scanDoorBar.style.width = target.toFixed(1) + "%";
      }
      if (p < 1) doorRaf = requestAnimationFrame(tickDoor);
    };
    doorRaf = requestAnimationFrame(tickDoor);

    el.scanOverlay.addEventListener("pointerdown", onSkip);
    phaseTimers.push(setTimeout(finishOpen, timing.totalMs));

    // Prefill loot list near end of ceremony (not all at once up front)
    const listAt = Math.max(0, timing.totalMs - 280);
    phaseTimers.push(setTimeout(() => {
      if (finished) return;
      loot.forEach((entry, i) => {
        const def = getDef(entry.defId);
        if (!def) return;
        const rar = RARITY_MAP[def.rarity];
        const li = document.createElement("li");
        li.style.animationDelay = `${0.04 + i * 0.06}s`;
        li.innerHTML = `
          <span style="font-size:18px">${def.icon}</span>
          <span>${def.name}</span>
          <span style="color:${rar.color};font-size:11px;font-weight:800">${rar.name}</span>
          <span class="scan-val">${formatYen(itemValue(entry))}</span>`;
        el.scanList.appendChild(li);
      });
    }, listAt));

    updateStats();
    updateFreeRentOffer();
  }

  function hideRevealAdBar() {
    if (el.revealAdBar) el.revealAdBar.hidden = true;
    revealPause = null;
  }

  function resolveRevealPause(watched) {
    const p = revealPause;
    hideRevealAdBar();
    if (p && typeof p.resolve === "function") p.resolve(!!watched);
  }

  /** Reveal ad gate DISABLED for playtest — do not interrupt sequential reveal rhythm */
  function maybeRevealAdGate(_entry, _index, _total) {
    if (el.revealAdBar) el.revealAdBar.hidden = true;
    return Promise.resolve(false);
  }

  /** Push one revealed entry into staging exactly once. */
  function deliverToStaging(entry) {
    if (!entry || staging.some((s) => s.uid === entry.uid) || placed.has(entry.uid)) return false;
    entry._reveal = true;
    staging.push(entry);
    tryUnlockCodex(entry.defId);
    return true;
  }

  /** Flush any not-yet-revealed loot straight into staging (forced settle / reload mid-reveal). */
  function flushPendingRevealLoot() {
    const pend = pendingRevealLoot;
    pendingRevealLoot = null;
    if (!Array.isArray(pend)) return 0;
    let n = 0;
    for (const e of pend) {
      if (e && getDef(e.defId) && deliverToStaging(e)) n += 1;
    }
    if (n) renderStaging();
    return n;
  }

  async function runSequentialReveal(loot, tier, feePaid, tierId) {
    const STEP = 280;
    const tid = tierId || (tier && tier.id) || null;
    if (!Array.isArray(loot)) loot = [];
    const gen = revealGen;
    // A forced settle / new round bumps revealGen; stop drip-feeding stale loot then.
    const aborted = () => gen !== revealGen || extractedThisRound;
    try {
      if (loot.length === 0) {
        // openCrate already guarantees loot; belt-and-suspenders — actually add the item.
        loot.push(makeFallbackLootEntry(tid));
        showToast("本柜空空如也…已补发一件垫底货");
      }
      for (let i = 0; i < loot.length; i++) {
        if (aborted()) break;
        let entry = loot[i];
        try {
          await maybeRevealAdGate(entry, i, loot.length);
          await new Promise((r) => setTimeout(r, 40));
          // Value-threshold timed challenge (disabled when FEATURES.CHALLENGE_ENABLED=false)
          if (FEATURES.CHALLENGE_ENABLED && shouldChallengeItem(entry)) {
            entry = await Promise.race([
              runItemChallenge(entry),
              // Hard safety: never block reveal forever if modal/UI fails
              new Promise((resolve) => setTimeout(() => resolve(entry), (CHALLENGE_CFG.TIME_MS || 8000) + 12000)),
            ]);
            loot[i] = entry;
          }
          if (aborted()) break;
          let def = entry && getDef(entry.defId);
          if (!def) {
            // Was: `continue` → item silently dropped. Swap in a 垫底货 instead.
            console.warn("[reveal] missing def", entry && entry.defId, "— substituting fallback");
            entry = makeFallbackLootEntry(tid);
            loot[i] = entry;
            def = getDef(entry.defId);
          }
          deliverToStaging(entry);
          try { fx("lootTick", i, def.rarity); } catch (_) {}
          try { fx("rarityFanfare", def.rarity); } catch (_) {}
          if (allowFancyVfx() && GOLD_PLUS_RARITIES.has(def.rarity)) {
            const rc = RARITY_MAP[def.rarity];
            spawnRaritySparkRing(rc && rc.color);
          }
          if (GOLD_PLUS_RARITIES.has(def.rarity)) {
            const flashKind =
              def.rarity === "dahong" || def.rarity === "xiaohong" ? "red" :
              def.rarity === "dajin" ? "jackpot" : "gold";
            screenFlash(flashKind);
          }
          renderStaging();
          selectedUid = entry.uid;
          showDetail(entry);
          updateStats();
          updateWarehouseFullOffers();
        } catch (err) {
          console.warn("[reveal] item error", err);
          // Still surface the item so staging is never empty mid-fail
          if (entry && getDef(entry.defId) && !aborted() && deliverToStaging(entry)) {
            renderStaging();
          }
        }
        if (i < loot.length - 1) {
          await new Promise((r) => setTimeout(r, STEP));
        }
      }
      if (aborted()) return;
      // Last line of defence: a paid reveal that ended with nothing delivered gets a real 垫底货.
      if (roundItemCount() === 0) {
        const filler = makeFallbackLootEntry(tid);
        loot.push(filler);
        deliverToStaging(filler);
        renderStaging();
        showToast("本柜空空如也…已补发一件垫底货");
      }
      await new Promise((r) => setTimeout(r, 120));
      try { fx("lootRevealEnd"); } catch (_) {}
      const totalV = loot.reduce((s, e) => s + (getDef(e.defId) ? itemValue(e) : 0), 0);
      const feeTxt = feePaid > 0 ? `-${formatYen(feePaid)}` : "免费";
      addLog(
        `第 ${round} 场租下<strong>${tier.name}</strong>（${feeTxt}），开出 ${loot.length} 件 · 货值约 ${formatYen(totalV)}`
      );
      const warehouseCells = gridSize * gridSize;
      const occupiedCells = usedCells();
      const freeCells = warehouseCells - occupiedCells;
      const stagingCellsNeeded = staging.reduce((sum, entry) => {
        const def = getDef(entry.defId);
        const shape = entry.shape || (def && def.shape);
        return sum + (shape ? shapeCells(shape, entry.rot || 0).length : 0);
      }, 0);
      // Warehouse is cleared each settle, so judge by how much of the free space
      // this crate's loot would eat (irregular shapes rarely pack past ~60%).
      const spaceTight =
        freeCells < stagingCellsNeeded ||
        (freeCells > 0 && stagingCellsNeeded / freeCells >= 0.6) ||
        (warehouseCells > 0 && occupiedCells / warehouseCells >= 0.55);
      setActionDesc(
        feePaid > 0
          ? `已付租金 ${formatYen(feePaid)}。${spaceTight ? "空间紧张——优先装箱高价值；装不下的结算时遗弃。" : "把货拖进仓库装箱，装不下的结算时遗弃。"}`
          : `免费再租已使用。${spaceTight ? "空间紧张——优先装箱高价值；装不下的结算时遗弃。" : "把货拖进仓库装箱，装不下的结算时遗弃。"}`
      );
    } catch (err) {
      console.warn("[reveal] fatal", err);
      showToast("开箱展示出错，已强制恢复");
    } finally {
      // Superseded (forced settle / next round already took over) → leave shared state alone.
      if (gen === revealGen) {
        // Anything not yet shown (e.g. fatal error mid-loop) still lands in staging.
        if (!extractedThisRound) flushPendingRevealLoot();
        pendingRevealLoot = null;
        revealing = false;
        hideRevealAdBar();
        // If challenge modal somehow left open, close it
        if (el.challengeModal) el.challengeModal.hidden = true;
        challengeActive = null;
        updateStats();
        updateWarehouseFullOffers();
        maybeTriggerDailyJackpot();
        scheduleSave();
      }
    }
  }

  // ----- Drag -----
  function findStaging(uid) { return staging.find((e) => e.uid === uid); }

  function currentDragEntry() {
    if (!drag.active) return null;
    if (drag.from === "staging") {
      const s = findStaging(drag.uid);
      return s ? { ...s, rot: drag.rot } : null;
    }
    if (drag.limbo) return { ...drag.limbo, rot: drag.rot };
    return null;
  }

  // ----- Drag scroll lock / grid coordinate helpers -----
  let _dragScrollLocked = false;
  let _lastPointer = { x: 0, y: 0 };
  function preventWheelDuringDrag(e) {
    if (_dragScrollLocked) e.preventDefault();
  }
  function setDragScrollLock(on) {
    if (on === _dragScrollLocked) return;
    _dragScrollLocked = !!on;
    document.body.classList.toggle("drag-scroll-lock", _dragScrollLocked);
    document.documentElement.classList.toggle("drag-scroll-lock", _dragScrollLocked);
    if (_dragScrollLocked) {
      document.body.style.overflow = "hidden";
      window.addEventListener("wheel", preventWheelDuringDrag, { passive: false });
      window.addEventListener("touchmove", preventWheelDuringDrag, { passive: false });
    } else {
      document.body.style.overflow = "";
      window.removeEventListener("wheel", preventWheelDuringDrag);
      window.removeEventListener("touchmove", preventWheelDuringDrag);
    }
  }

  /** Map client coords → grid cell using cell[0,0] rect (shared by hit-test + ghost). */
  function cellFromPoint(clientX, clientY) {
    const grid = el.warehouseGrid;
    if (!grid) return null;
    const origin = grid.querySelector('.cell[data-r="0"][data-c="0"]') || grid.querySelector(".cell");
    if (!origin) return null;
    const orect = origin.getBoundingClientRect();
    const cw = orect.width || 1;
    const ch = orect.height || 1;
    const c = Math.floor((clientX - orect.left) / cw);
    const r = Math.floor((clientY - orect.top) / ch);
    if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) return null;
    return { r, c };
  }

  function cellRect(r, c) {
    const cellEl = el.warehouseGrid.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    return cellEl ? cellEl.getBoundingClientRect() : null;
  }

  function measuredCellSize() {
    const origin = el.warehouseGrid.querySelector(".cell");
    if (origin) {
      const r = origin.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }
    const fallback = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell-size")) || 34;
    return { w: fallback, h: fallback };
  }

  /**
   * Ghost origin (shape 0,0) snaps to the same cell used by highlightAt/placeItem.
   * snapCell: {r,c} when pointer is over the warehouse; otherwise follow cursor.
   */
  function showGhost(defId, rot, x, y, valid, snapCell) {
    const def = getDef(defId);
    const rar = RARITY_MAP[def.rarity];
    const cells = shapeCells(def.shape, rot);
    const maxR = Math.max(...cells.map((c) => c[0]));
    const maxC = Math.max(...cells.map((c) => c[1]));
    const set = new Set(cells.map(([r, c]) => `${r},${c}`));
    const ghost = el.dragGhost;
    const { w: cw, h: ch } = measuredCellSize();
    ghost.hidden = false;
    ghost.classList.toggle("invalid", !valid);
    ghost.style.gridTemplateColumns = `repeat(${maxC + 1}, ${cw}px)`;
    ghost.style.gap = "0px";
    if (snapCell) {
      const rect = cellRect(snapCell.r, snapCell.c);
      if (rect) {
        ghost.style.left = rect.left + "px";
        ghost.style.top = rect.top + "px";
        ghost.style.transform = "none";
      } else {
        ghost.style.left = x + "px";
        ghost.style.top = y + "px";
        ghost.style.transform = "none";
      }
    } else {
      ghost.style.left = x + "px";
      ghost.style.top = y + "px";
      ghost.style.transform = "none";
    }
    let html = "";
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        if (set.has(`${r},${c}`)) {
          html += `<div class="ghost-cell" style="width:${cw}px;height:${ch}px;border:1px solid ${rar.color};background:${rar.color}66">${r === 0 && c === 0 ? def.icon : ""}</div>`;
        } else {
          html += `<div class="ghost-cell" style="width:${cw}px;height:${ch}px;visibility:hidden"></div>`;
        }
      }
    }
    ghost.innerHTML = html;
  }

  function hideGhost() {
    el.dragGhost.hidden = true;
    el.dragGhost.innerHTML = "";
  }

  function highlightAt(or, oc) {
    clearHighlights();
    const entry = currentDragEntry();
    if (!entry) return;
    const ignore = drag.from === "grid" ? drag.uid : null;
    const cells = cellsFor(entry.defId, drag.rot, or, oc);
    const ok = canPlace(entry.defId, drag.rot, or, oc, ignore);
    if (drag._hlValid !== ok) {
      drag._hlValid = ok;
      fx("hoverTick", ok);
    }
    drag.valid = ok;
    drag.lastCell = { r: or, c: oc };
    for (const { r, c } of cells) {
      if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) continue;
      const cellEl = el.warehouseGrid.querySelector(`[data-r="${r}"][data-c="${c}"]`);
      if (cellEl) cellEl.classList.add(ok ? "hl-ok" : "hl-bad");
    }
  }

  function updatePlaceTargetClass() {
    const ready = !drag.active && !!selectedUid && !!findStaging(selectedUid);
    el.warehouseGrid.classList.toggle("place-target", ready);
  }

  function beginDrag(uid, from, x, y) {
    let entry;
    if (from === "staging") {
      entry = findStaging(uid);
    } else {
      entry = removeFromGrid(uid);
      if (entry) {
        drag.limbo = entry;
        renderGrid();
        updateStats();
      }
    }
    if (!entry) return;

    drag.pending = null;
    drag.active = true;
    drag.uid = uid;
    drag.from = from;
    drag.rot = entry.rot;
    drag.lastCell = null;
    drag.valid = false;
    drag._hlValid = null;
    drag.moved = false;
    drag.startX = x;
    drag.startY = y;
    selectedUid = uid;
    showDetail({ ...entry, rot: drag.rot });
    updatePlaceTargetClass();

    if (from === "staging") {
      el.stagingArea.querySelector(`[data-uid="${uid}"]`)?.classList.add("dragging");
    }
    setDragScrollLock(true);
    _lastPointer = { x, y };
    const snap0 = cellFromPoint(x, y);
    if (snap0) highlightAt(snap0.r, snap0.c);
    showGhost(entry.defId, drag.rot, x, y, snap0 ? drag.valid : true, snap0);
    document.body.style.cursor = "grabbing";
    fx("pickup");
  }

  function isCoarsePointer() {
    return window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  }

  function armPendingDrag(uid, from, e) {
    selectedUid = uid;
    if (from === "staging") {
      const s = findStaging(uid);
      if (s) showDetail(s);
      // Do not re-render staging here — that would destroy the pointer capture target.
      el.stagingArea.querySelectorAll(".item-card").forEach((card) => {
        card.classList.toggle("selected", card.dataset.uid === uid);
      });
    } else {
      const p = placed.get(uid);
      if (p) showDetail(p);
    }
    updatePlaceTargetClass();
    drag.pending = {
      uid,
      from,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      // Mobile: prefer tap-to-place; require a longer drag before lifting into drag mode
      threshold: (e.pointerType === "touch" || isCoarsePointer()) ? 28 : 8,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  }

  function onStagingPointerDown(e) {
    if (e.button !== 0) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    armPendingDrag(e.currentTarget.dataset.uid, "staging", e);
  }

  function onGridPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    armPendingDrag(e.currentTarget.dataset.uid, "grid", e);
  }

  function onGridDblClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (drag.active) return;
    const uid = e.currentTarget.dataset.uid;
    const entry = removeFromGrid(uid);
    if (!entry) return;
    staging.push({
      uid: entry.uid,
      defId: entry.defId,
      rot: entry.rot,
      valueOverride: entry.valueOverride,
    });
    selectedUid = entry.uid;
    fx("returnStaging");
    renderStaging();
    renderGrid();
    updateStats();
    showDetail(entry);
  }

  function onCellEnter(e) {
    if (!drag.active) return;
    const snap = { r: +e.currentTarget.dataset.r, c: +e.currentTarget.dataset.c };
    highlightAt(snap.r, snap.c);
    const entry = currentDragEntry();
    _lastPointer = { x: e.clientX, y: e.clientY };
    if (entry) showGhost(entry.defId, drag.rot, e.clientX, e.clientY, drag.valid, snap);
  }

  function onPointerMove(e) {
    if (drag.pending && !drag.active) {
      const p = drag.pending;
      if (p.pointerId != null && e.pointerId !== p.pointerId) return;
      const dist = Math.abs(e.clientX - p.startX) + Math.abs(e.clientY - p.startY);
      const thr = p.threshold != null ? p.threshold : 8;
      if (dist > thr) {
        beginDrag(p.uid, p.from, e.clientX, e.clientY);
      } else {
        return;
      }
    }
    if (!drag.active) return;
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) {
      drag.moved = true;
    }
    const entry = currentDragEntry();
    if (!entry) return;
    _lastPointer = { x: e.clientX, y: e.clientY };

    const snap = cellFromPoint(e.clientX, e.clientY);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (snap) {
      highlightAt(snap.r, snap.c);
      el.stagingArea.classList.remove("drag-over");
    } else {
      clearHighlights();
      drag.lastCell = null;
      drag.valid = false;
      el.stagingArea.classList.toggle("drag-over", !!under?.closest?.("#stagingArea"));
    }
    showGhost(entry.defId, drag.rot, e.clientX, e.clientY, drag.valid, snap);
  }

  function restoreLimboToGrid() {
    const L = drag.limbo;
    if (!L) return;
    placeItem(
      { uid: L.uid, defId: L.defId, rot: L._origRot ?? L.rot, valueOverride: L.valueOverride },
      L._ox,
      L._oy
    );
  }

  function finishDrag(e, forceCancel) {
    if (!drag.active) return;
    el.stagingArea.classList.remove("drag-over");
    document.body.style.cursor = "";
    setDragScrollLock(false);

    const entry = currentDragEntry();
    const under = e ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const overStaging = !!under?.closest?.("#stagingArea");

    let audioOutcome = null; // "snap" | "return" | null
    if (forceCancel) {
      // Cancel: put grid piece back where it was; staging piece stays in staging.
      // Existing warehouse items are never touched.
      if (drag.from === "grid") restoreLimboToGrid();
    } else if (overStaging && drag.from === "grid" && entry) {
      staging.push({
        uid: entry.uid,
        defId: entry.defId,
        rot: drag.rot,
        valueOverride: entry.valueOverride,
      });
      audioOutcome = "return";
    } else if (drag.lastCell && entry) {
      // Re-validate at drop time — never displace conflicting grid items
      const ignore = drag.from === "grid" ? entry.uid : null;
      const fits = canPlace(entry.defId, drag.rot, drag.lastCell.r, drag.lastCell.c, ignore);
      if (fits) {
        const ok = placeItem(
          { uid: entry.uid, defId: entry.defId, rot: drag.rot, valueOverride: entry.valueOverride },
          drag.lastCell.r,
          drag.lastCell.c
        );
        if (ok && drag.from === "staging") {
          staging = staging.filter((s) => s.uid !== drag.uid);
        } else if (!ok && drag.from === "grid") {
          // Placement refused: restore only the dragged piece (drag cancel)
          restoreLimboToGrid();
        }
        audioOutcome = ok ? "snap" : null;
      } else {
        // Invalid / overlap: leave existing grid items untouched; only handle dragged piece
        if (drag.from === "grid") {
          restoreLimboToGrid();
        }
        // from staging: entry remains in staging array — no-op
        audioOutcome = null;
      }
    } else if (drag.from === "grid" && entry) {
      // Dropped off-grid (not staging): cancel back to original cells, do not dump to staging
      restoreLimboToGrid();
    }

    // Audio: layer 3 snap vs return (distinct from crate open)
    if (audioOutcome === "snap") fx("placeSnap");
    else if (audioOutcome === "return") fx("returnStaging");

    hideGhost();
    clearHighlights();
    drag.active = false;
    drag.uid = null;
    drag.from = null;
    drag.limbo = null;
    drag._hlValid = null;
    drag.pending = null;
    renderStaging();
    renderGrid();
    updateStats();
    updatePlaceTargetClass();
    scheduleSave();
  }

  function tryTapPlace(r, c) {
    if (drag.active) return false;
    // Pending select is fine — clear it and place (mobile tap-select → tap-cell)
    if (drag.pending) drag.pending = null;
    if (!selectedUid) return false;
    const s = findStaging(selectedUid);
    if (!s) return false;
    if (!canPlace(s.defId, s.rot, r, c, null)) {
      clearHighlights();
      const cells = cellsFor(s.defId, s.rot, r, c);
      for (const cell of cells) {
        if (cell.r < 0 || cell.c < 0 || cell.r >= gridSize || cell.c >= gridSize) continue;
        const cellEl = el.warehouseGrid.querySelector(`[data-r="${cell.r}"][data-c="${cell.c}"]`);
        if (cellEl) cellEl.classList.add("hl-bad");
      }
      setTimeout(clearHighlights, 220);
      showToast("放不下 · 点「旋转」后再试");
      return false;
    }
    const ok = placeItem(
      { uid: s.uid, defId: s.defId, rot: s.rot, valueOverride: s.valueOverride },
      r,
      c
    );
    if (!ok) return false;
    staging = staging.filter((x) => x.uid !== s.uid);
    // Advance selection to next staging item for fast mobile packing
    selectedUid = staging[0] ? staging[0].uid : null;
    fx("placeSnap");
    renderStaging();
    renderGrid();
    updateStats();
    updatePlaceTargetClass();
    scheduleSave();
    return true;
  }

  let _tapPlacedOnDown = false;
  function onCellPointerDown(e) {
    _tapPlacedOnDown = false;
    // Primary place path (esp. mobile): tap cell while staging item selected
    if (drag.active) return;
    if (e.button != null && e.button !== 0) return;
    const r = +e.currentTarget.dataset.r;
    const c = +e.currentTarget.dataset.c;
    if (selectedUid && findStaging(selectedUid)) {
      e.preventDefault();
      e.stopPropagation();
      clearHighlights();
      const s = findStaging(selectedUid);
      if (s) {
        const cells = cellsFor(s.defId, s.rot, r, c);
        const ok = canPlace(s.defId, s.rot, r, c, null);
        for (const cell of cells) {
          if (cell.r < 0 || cell.c < 0 || cell.r >= gridSize || cell.c >= gridSize) continue;
          const cellEl = el.warehouseGrid.querySelector(`[data-r="${cell.r}"][data-c="${cell.c}"]`);
          if (cellEl) cellEl.classList.add(ok ? "hl-ok" : "hl-bad");
        }
      }
      _tapPlacedOnDown = tryTapPlace(r, c);
    }
  }

  function onCellPointerUp(e) {
    if (drag.active) {
      const snap = cellFromPoint(e.clientX, e.clientY) || {
        r: +e.currentTarget.dataset.r,
        c: +e.currentTarget.dataset.c,
      };
      highlightAt(snap.r, snap.c);
      finishDrag(e, false);
      return;
    }
    // Avoid double-place when pointerdown already placed (would drop next item)
    if (_tapPlacedOnDown) {
      _tapPlacedOnDown = false;
      return;
    }
    if (!drag.pending) {
      tryTapPlace(+e.currentTarget.dataset.r, +e.currentTarget.dataset.c);
    }
  }

  function onPointerUp(e) {
    if (drag.pending && !drag.active) {
      // Tap without drag: keep selection for tap-to-place / rotate
      drag.pending = null;
      updatePlaceTargetClass();
      return;
    }
    if (!drag.active) return;
    const snap = cellFromPoint(e.clientX, e.clientY);
    if (snap) {
      highlightAt(snap.r, snap.c);
      finishDrag(e, false);
      return;
    }
    finishDrag(e, false);
  }

  // ----- Rotate -----
  function rotateSelected() {
    if (drag.active) {
      drag.rot = (drag.rot + 1) % 4;
      fx("rotate");
      const entry = currentDragEntry();
      const snap = drag.lastCell
        ? { r: drag.lastCell.r, c: drag.lastCell.c }
        : cellFromPoint(_lastPointer.x, _lastPointer.y);
      if (entry && snap) highlightAt(snap.r, snap.c);
      if (entry) {
        showGhost(
          entry.defId,
          drag.rot,
          _lastPointer.x,
          _lastPointer.y,
          drag.valid,
          snap || drag.lastCell
        );
        showDetail({ ...entry, rot: drag.rot });
      }
      return;
    }
    // Pending drag (pointer down, not yet moved): still allow rotate for selected piece
    if (drag.pending && selectedUid) {
      if (drag.pending.from === "staging") {
        const s = findStaging(selectedUid);
        if (s) {
          s.rot = (s.rot + 1) % 4;
          drag.pending.rot = s.rot;
          fx("rotate");
          renderStaging();
          showDetail(s);
          updatePlaceTargetClass();
          return;
        }
      }
    }
    if (!selectedUid) return;
    const s = findStaging(selectedUid);
    if (s) {
      s.rot = (s.rot + 1) % 4;
      fx("rotate");
      renderStaging();
      showDetail(s);
      updatePlaceTargetClass();
      return;
    }
    const p = placed.get(selectedUid);
    if (!p) return;
    const newRot = (p.rot + 1) % 4;
    const snapshot = {
      uid: p.uid,
      defId: p.defId,
      rot: p.rot,
      valueOverride: p.valueOverride,
      ox: p.ox,
      oy: p.oy,
    };
    removeFromGrid(p.uid);
    if (canPlace(snapshot.defId, newRot, snapshot.ox, snapshot.oy, snapshot.uid)) {
      placeItem({ ...snapshot, rot: newRot }, snapshot.ox, snapshot.oy);
      fx("rotate");
    } else {
      placeItem(snapshot, snapshot.ox, snapshot.oy);
      fx("rotate");
    }
    renderGrid();
    updateStats();
    const now = placed.get(selectedUid);
    if (now) showDetail(now);
  }

  // ----- Settle / round -----
  /** Items physically present this round: temp storage + warehouse grid. */
  function roundItemCount() {
    return (Array.isArray(staging) ? staging.length : 0) + (placed ? placed.size : 0);
  }

  /** Settle-time empty-round refund. Returns the refunded ¥ (0 if none). */
  function applyEmptyRoundRefund() {
    const paid = Math.max(0, Math.round(Number(paidFeeThisRound) || 0));
    if (paid <= 0 || roundItemCount() > 0) return 0;
    cash += paid;
    paidFeeThisRound = 0;
    console.warn("[extract] 0 items at settle — refunding actual paid rent", paid);
    showToast(`本柜未开出任何货物，租金 ${formatYen(paid)} 已全额退还`);
    addLog(`第 ${round} 场货柜为空：租金 <strong>${formatYen(paid)}</strong> 已全额退还`);
    return paid;
  }

  function extract() {
    // Safety: if reveal somehow stuck, force-clear so settle is never soft-locked
    if (revealing && staging.length > 0 && !challengeActive) {
      revealing = false;
      // Stop the drip-feed and land every not-yet-revealed paid item in staging first,
      // so it is settle-counted (packed or discarded) instead of vanishing.
      revealGen += 1;
      flushPendingRevealLoot();
    }
    if (!crateOpenedThisRound || extractedThisRound || bankrupt || revealing || settleReplayActive) return;
    fx("uiClick");
    // Last-resort safety net (hotfix 空柜) — the ONE place that decides a refund, and it
    // looks only at what is physically in this round (staging + warehouse), never at any
    // open-time record/counter. 0 items + rent paid → refund exactly the ¥ deducted at
    // open (paidFeeThisRound = actual charge after discount + hall markup), whatever the cause.
    const emptyCrateRefund = applyEmptyRoundRefund();
    const items = [...placed.values()];
    let bonusFromStaging = [];
    let remainingStaging = [...staging];

    if (keepStagingThisRound) {
      bonusFromStaging = remainingStaging;
      remainingStaging = [];
    } else if (virtualSlots > 0 && remainingStaging.length) {
      const sorted = [...remainingStaging].sort((a, b) => itemValue(b) - itemValue(a));
      bonusFromStaging = sorted.slice(0, virtualSlots);
      const take = new Set(bonusFromStaging.map((e) => e.uid));
      remainingStaging = remainingStaging.filter((e) => !take.has(e.uid));
    }

    const soldEntries = [
      ...items.map((p) => ({ defId: p.defId, valueOverride: p.valueOverride, uid: p.uid })),
      ...bonusFromStaging,
    ];
    const lootValue = soldEntries.reduce((s, p) => s + itemValue(p), 0);
    const packedValue = items.reduce((s, p) => s + itemValue(p), 0);
    const lost = remainingStaging.length;
    const lostVal = remainingStaging.reduce((s, e) => s + itemValue(e), 0);
    const fee = paidFeeThisRound;
    const totalCells = gridSize * gridSize;
    const occupiedCells = usedCells();
    const utilRatio = totalCells > 0 ? occupiedCells / totalCells : 0;
    const utilPct = Math.round(utilRatio * 100);
    const zeroDiscard = lost === 0;
    // 完美装箱：利用率≥85% 或 本场零遗弃暂存；需有装箱货值才发奖
    const perfectPack =
      packedValue > 0 &&
      (utilRatio >= PERFECT_PACK.UTIL_THRESHOLD || zeroDiscard);
    let perfectBonus = 0;
    let grantedNextDiscount = false;
    if (perfectPack) {
      perfectBonus = Math.round(packedValue * PERFECT_PACK.BONUS_PCT);
      nextCrateDiscountPct = PERFECT_PACK.NEXT_DISCOUNT_PCT;
      grantedNextDiscount = true;
    }

    const net = lootValue + perfectBonus - fee;
    const profit = net >= 0;

    cash += lootValue;
    if (perfectBonus > 0) cash += perfectBonus;
    {
      const gain = lootValue + perfectBonus;
      if (perfectPack && perfectBonus > 0) {
        queueCashFx({ pulse: "perfect", burst: true, jackpot: net >= 15000, flash: net >= 15000 ? "jackpot" : "gold" });
      } else if (net >= 20000) {
        queueCashFx({ pulse: "reward", burst: true, jackpot: true, flash: "jackpot" });
      } else if (gain >= BIG_GAIN_ABS) {
        queueCashFx({ pulse: "reward", burst: true, flash: "gold" });
      } else if (net < 0 && Math.abs(net) >= BIG_GAIN_ABS) {
        queueCashFx({ pulse: "reward", flash: "red" });
      }
    }
    totalPnL += net;
    extractedThisRound = true;
    lastSettleLoss = net < 0 ? -net : 0;
    settleRefundUsed = false;

    // Soft pity: consecutive below-cost settles (loot sold < rent; bonus excluded)
    const belowCost = lootValue < fee;
    if (emptyCrateRefund > 0) {
      // refunded empty crate: neither a win nor a loss
    } else if (belowCost) {
      lossStreak += 1;
      losses += 1;
    } else {
      lossStreak = 0;
      wins += 1;
    }
    // 「热手」：连续盈利（净利 >= 0）；与 pity 的 belowCost 计数分开持久化
    if (emptyCrateRefund > 0) { /* streak unchanged */ }
    else if (profit) profitStreak += 1;
    else profitStreak = 0;

    if (zeroDiscard && soldEntries.length > 0) recordDailyZeroDiscard();
    if (perfectPack) recordDailyPerfectPack();

    const sortedSold = soldEntries
      .slice()
      .sort((a, b) => itemValue(b) - itemValue(a));
    const highlight = sortedSold[0] || null;

    const presentSettle = () => {
      // Frame 1: show modal shell + headline numbers (cheap) so settle feels instant
      fx(profit ? "settleWin" : "settleLoss");

      el.resultTitle.textContent = perfectPack
        ? (profit ? "完美装箱 · 盈利！" : "完美装箱！")
        : profit
          ? "本场盈利！"
          : "本场亏损…";
      el.resultLoot.textContent = formatYen(lootValue);
      el.resultFee.textContent = emptyCrateRefund > 0
        ? `¥0（空柜已退 ${formatYen(emptyCrateRefund)}）`
        : fee > 0 ? "-" + formatYen(fee) : "¥0（免费再租）";
      if (el.resultPerfectRow && el.resultPerfectBonus) {
        el.resultPerfectRow.hidden = !perfectPack || perfectBonus <= 0;
        el.resultPerfectRow.style.display = el.resultPerfectRow.hidden ? "none" : "";
        el.resultPerfectBonus.textContent = perfectBonus > 0 ? "+" + formatYen(perfectBonus) : "";
      }
      if (el.resultDiscountRow && el.resultDiscount) {
        el.resultDiscountRow.hidden = !grantedNextDiscount;
        el.resultDiscountRow.style.display = el.resultDiscountRow.hidden ? "none" : "";
        if (grantedNextDiscount) {
          el.resultDiscount.textContent =
            `下场租金 -${Math.round(PERFECT_PACK.NEXT_DISCOUNT_PCT * 100)}%（用一次）`;
        }
      }
      el.resultNet.textContent = formatYen(net);
      el.resultNet.className = profit ? "pos" : "neg";
      el.resultCash.textContent = formatYen(cash);
      el.resultMeta.textContent = "";
      el.resultItems.innerHTML = "";
      // Loss consolation one-liner (rotating)
      let consol = el.resultModal && el.resultModal.querySelector(".loss-consolation");
      if (!profit) {
        if (!consol && el.resultMeta && el.resultMeta.parentNode) {
          consol = document.createElement("p");
          consol.className = "loss-consolation";
          el.resultMeta.parentNode.insertBefore(consol, el.resultMeta.nextSibling);
        }
        if (consol) {
          consol.hidden = false;
          consol.textContent = pickLossConsolation();
        }
      } else if (consol) {
        consol.hidden = true;
        consol.textContent = "";
      }
      if (el.resultAdSlot) el.resultAdSlot.hidden = true;
      el.btnNextRound.hidden = false;
      el.resultModal.hidden = false;
      settleReplayActive = false;

      const fillDetails = () => {
        let meta =
          `装箱转卖 ${items.length} 件 · 占用 ${occupiedCells} 格（利用率 ${utilPct}%）` +
          (bonusFromStaging.length
            ? ` · 广告保全 ${bonusFromStaging.length} 件`
            : "") +
          (lost ? ` · 遗弃暂存 ${lost} 件（${formatYen(lostVal)}）` : zeroDiscard ? " · 零遗弃" : "");
        if (perfectPack) {
          const why =
            utilRatio >= PERFECT_PACK.UTIL_THRESHOLD && zeroDiscard
              ? `高利用率 ${utilPct}% · 零遗弃`
              : utilRatio >= PERFECT_PACK.UTIL_THRESHOLD
                ? `高利用率 ${utilPct}%`
                : "零遗弃暂存";
          meta += ` · 完美装箱（${why}）`;
        }
        el.resultMeta.textContent = meta;

        // Cap list paint — long item lists stalled the main thread
        const listCap = isLowFx() ? 8 : 16;
        const shown = sortedSold.slice(0, listCap);
        const extra = sortedSold.length - shown.length;
        el.resultItems.innerHTML =
          shown
            .map((p) => {
              const def = getDef(p.defId);
              const rar = RARITY_MAP[def.rarity];
              return `<li><span>${def.icon} ${def.name} <small style="color:${rar.color}">${rar.name}</small></span><span>${formatYen(itemValue(p))}</span></li>`;
            })
            .join("") +
          (extra > 0 ? `<li class="result-more">…另有 ${extra} 件</li>` : "");

        if (el.resultAdSlot) {
          const showRefund = FEATURES.ADS_ENABLED && !profit && lastSettleLoss > 0;
          el.resultAdSlot.hidden = !showRefund;
          if (showRefund && el.btnAdSettleRefund) {
            const rem = categoryRemaining("settle_refund");
            const ok = rem > 0 && adsRemaining() > 0 && !settleRefundUsed;
            el.btnAdSettleRefund.disabled = !ok;
            el.btnAdSettleRefund.textContent = ok
              ? `▶ 看广告回本 30%–50%（今日${rem}/2）`
              : rem <= 0 || adsRemaining() <= 0
                ? "今日亏本回血广告已用完"
                : "已使用回本";
            if (ok) logAdOfferOnce(AD_PLACEMENTS.SETTLE_REFUND, { rem, loss: lastSettleLoss });
          }
        }

        addLog(
          `第 ${round} 场结算：售出 <strong>${formatYen(lootValue)}</strong>` +
            (perfectBonus > 0 ? ` + 完美装箱 <strong>${formatYen(perfectBonus)}</strong>` : "") +
            ` − 租金 ${formatYen(fee)} = ` +
            `<strong style="color:${profit ? "#4ecf88" : "#c45c5c"}">${formatYen(net)}</strong> · 现金 ${formatYen(cash)}` +
            (grantedNextDiscount
              ? ` · 获下一柜折扣 -${Math.round(PERFECT_PACK.NEXT_DISCOUNT_PCT * 100)}%`
              : "")
        );

        if (perfectPack) {
          const parts = [];
          if (perfectBonus > 0) parts.push(`奖励 +${formatYen(perfectBonus)}`);
          if (grantedNextDiscount) {
            parts.push(`下一柜 -${Math.round(PERFECT_PACK.NEXT_DISCOUNT_PCT * 100)}%`);
          }
          const why =
            utilRatio >= PERFECT_PACK.UTIL_THRESHOLD
              ? `利用率 ${utilPct}%`
              : "零遗弃";
          showToast(`完美装箱！${why}` + (parts.length ? " · " + parts.join(" · ") : ""), perfectBonus > 0 ? "jackpot" : "success");
        }

        setActionDesc(
          (perfectPack ? "完美装箱！" : "") +
            `本场${profit ? "盈利" : "亏损"} ${formatYen(net)}。现金 ${formatYen(cash)}。点「下一场」继续竞拍。`
        );
        triggerHotColdStreakFx();
        updateStats();
        updateWarehouseFullOffers();
        scheduleSave();
        // After the (80 ms debounced) save lands: quiet check for a newer release.
        setTimeout(() => checkForUpdate("settle"), 150);
      };

      // Frame 2+: heavy list / stats / streak after modal is visible
      requestAnimationFrame(() => requestAnimationFrame(fillDetails));
    };

    staging = [];
    placed.clear();
    keepStagingThisRound = false;
    virtualSlots = 0;
    grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
    renderStaging();
    renderGrid();
    // Lock extract while highlight replay runs (~0.7s) before P/L SFX
    settleReplayActive = true;
    if (el.btnExtract) el.btnExtract.disabled = true;
    playSettleReplay(highlight, presentSettle);
  }

  function nextRound() {
    if (checkBankrupt()) {
      el.resultModal.hidden = true;
      el.btnNextRound.hidden = true;
      return;
    }
    extractedThisRound = false;
    crateOpenedThisRound = false;
    paidFeeThisRound = 0;
    keepStagingThisRound = false;
    virtualSlots = 0;
    lastSettleLoss = 0;
    settleRefundUsed = false;
    selectedTier = null;
    selectedUid = null;
    staging = [];
    pendingRevealLoot = null;
    revealGen += 1;
    placed.clear();
    initGrid(gridSize);
    round += 1;
    el.btnNextRound.hidden = true;
    el.resultModal.hidden = true;
    updateCrateButtons();
    renderStaging();
    showDetail(null);
    updateStats();
    setActionDesc(
      `第 ${round} 场：选柜付租 → 开箱装箱 → 转卖结算。贵柜风险更高。现金 ${formatYen(cash)}。`
    );
    maybeRollLimitedOffer();
    // This click is a natural between-round break; portal SDKs decide actual pacing.
    if (platform && typeof platform.requestMidgame === "function") platform.requestMidgame();
    scheduleSave();
  }

  function resetCareerState(keepGridPref) {
    cash = STARTING_CASH;
    displayCash = null;
    totalPnL = 0;
    wins = 0;
    losses = 0;
    lossStreak = 0;
    profitStreak = 0;
    settleReplayActive = false;
    honeymoonEnded = false;
    honeymoonGoodDropSeen = false;
    honeymoonEndToastShown = false;
    historyLog = [];
    round = 1;
    paidFeeThisRound = 0;
    crateOpenedThisRound = false;
    extractedThisRound = false;
    bankrupt = false;
    revealing = false;
    pendingRevealLoot = null;
    revealGen += 1;
    expandUses = 0;
    keys = 0;
    keyFragments = 0;
    freeRentCharges = 0;
    freeCommonCharges = 0;
    freeRareCharges = 0;
    limitedRefreshCharges = 0;
    nextCrateDiscountPct = 0;
    rareBoostCharges = 0;
    keepStagingThisRound = false;
    virtualSlots = 0;
    speedOrganizeUnlocked = false;
    protectCharges = 0;
    lastSettleLoss = 0;
    settleRefundUsed = false;
    revealPause = null;
    adOfferLogged = {};
    hideRevealAdBar();
    selectedTier = null;
    selectedUid = null;
    staging = [];
    placed.clear();
    uidCounter = 1;
    limitedOffer = null;
    limitedCooldownUntil = 0;
    // keep limitedDailyCount/key across restart within same day? Clear on new save feel
    limitedDailyCount = 0;
    limitedDailyKey = todayKeyLocal();
    if (limitedTickTimer) { clearInterval(limitedTickTimer); limitedTickTimer = null; }
    if (el.challengeModal) el.challengeModal.hidden = true;
    challengeActive = null;
    codexCollected = new Set();
    codexClaimed = new Set();
    totalCrateOpens = 0;
    openMilestonesClaimed = new Set();
    peakCash = STARTING_CASH;
    unlockedHalls = new Set();
    peakMilestonesClaimed = new Set();
    lastAnnouncedHallId = null;
    hideHallEnterCard();
    applyHallTheme(null);
    document.body.classList.remove("wealth-gold");
    if (el.cashBalance) el.cashBalance.classList.remove("gold-outline");
    if (el.hallUnlockHint) el.hallUnlockHint.hidden = true;
    dailyActivityKey = todayKeyLocal();
    dailyActivityCount = 0;
    dailyActivityCompleted = false;
    dailyActivityJackpotRolled = false;
    dailyActivityJackpotPending = false;
    hideDailyJackpot();
    if (el.codexModal) el.codexModal.hidden = true;
    if (el.hallChip) el.hallChip.hidden = true;
    if (!keepGridPref) {
      gridSize = DEFAULT_GRID;
      if (el.gridSizeSelect) safeSetSelectValue(el.gridSizeSelect, DEFAULT_GRID);
    }
  }

  function restartGame() {
    resetCareerState(true);
    el.bankruptModal.hidden = true;
    el.resultModal.hidden = true;
    el.btnNextRound.hidden = true;
    initGrid(+el.gridSizeSelect.value || DEFAULT_GRID);
    renderStaging();
    showDetail(null);
    updateStats();
    el.roundLog.innerHTML = "";
    addLog(`重新入场，启动资金 <strong>${formatYen(STARTING_CASH)}</strong>`);
    setActionDesc("重新入场成功。选一间仓储柜，支付租金后开箱装箱转卖。");
    scheduleSave();
  }

  function newSaveConfirm() {
    if (!confirm("确定「新开档」？将清除本机存档（现金、战绩、账本、手气等），不可恢复。")) return;
    clearSave();
    resetCareerState(false);
    el.bankruptModal.hidden = true;
    el.resultModal.hidden = true;
    el.btnNextRound.hidden = true;
    initGrid(DEFAULT_GRID);
    renderStaging();
    showDetail(null);
    updateStats();
    el.roundLog.innerHTML = "";
    addLog(`新开档 · 启动资金 <strong>${formatYen(STARTING_CASH)}</strong> · 仓库 ${DEFAULT_GRID}×${DEFAULT_GRID}`);
    setActionDesc("新档已开。默认仓库 5×5，几乎每场都要弃货——或使用「扩容」/补给。");
    scheduleSave();
    showToast("存档已清除，新档开始");
  }

  /** Monetization hook: expand via IAP shop or cash (playtest: no expand ad). */
  function tryExpandWarehouse() {
    const maxSize = GRID_SIZES[GRID_SIZES.length - 1];
    if (gridSize >= maxSize) {
      showToast("仓库已达最大规格");
      return;
    }
    const idx = GRID_SIZES.indexOf(gridSize);
    const next = idx >= 0 && idx < GRID_SIZES.length - 1 ? GRID_SIZES[idx + 1] : gridSize + 1;
    const skuId = next <= 6 ? "iap_warehouse_6" : next <= 7 ? "iap_warehouse_7" : "iap_warehouse_8";
    const sku = IAP_SKUS.find((s) => s.id === skuId);
    const price = (sku && sku.price) || "$1.99";
    logMono("iap_offer", skuId, { next, price });
    showConfirm(
      `扩容至 ${next}×${next}`,
      `补给内购 ${price}（占位）· 或 Shift+点击用现金 ${formatYen(EXPAND_CASH_COST)}。\n点确认 = 打开补给商店。`,
      () => {
        openShop();
        showToast(`请购买「仓库 → ${next}×${next}」（${price}）`);
      }
    );
    setActionDesc(`扩容 ${next}×${next}：补给 ${price} / 现金 ${formatYen(EXPAND_CASH_COST)}（Shift+点击扩容）。`);
  }

  function tryExpandWithCash() {
    const maxSize = GRID_SIZES[GRID_SIZES.length - 1];
    if (gridSize >= maxSize) return;
    const idx = GRID_SIZES.indexOf(gridSize);
    const next = idx >= 0 && idx < GRID_SIZES.length - 1 ? GRID_SIZES[idx + 1] : gridSize + 1;
    if (cash < EXPAND_CASH_COST) {
      showToast(`现金不足（需 ${formatYen(EXPAND_CASH_COST)}）`);
      return;
    }
    showConfirm(
      "现金扩容",
      `花费 ${formatYen(EXPAND_CASH_COST)} 扩容至 ${next}×${next}？`,
      () => {
        cash -= EXPAND_CASH_COST;
        applyExpand(next, "cash");
      }
    );
  }

  function applyExpand(nextSize, via) {
    // Return placed items to staging before resize
    for (const uid of [...placed.keys()]) {
      const entry = removeFromGrid(uid);
      if (entry) {
        staging.push({
          uid: entry.uid,
          defId: entry.defId,
          rot: entry.rot,
          valueOverride: entry.valueOverride,
        });
      }
    }
    expandUses += 1;
    if (el.gridSizeSelect) safeSetSelectValue(el.gridSizeSelect, nextSize);
    initGrid(nextSize);
    renderStaging();
    updateStats();
    const viaLabel = via === "cash" ? "现金" : via === "iap" ? "内购" : "广告";
    addLog(`仓库扩容至 <strong>${nextSize}×${nextSize}</strong>（${viaLabel}）`);
    setActionDesc(`仓库已扩容为 ${nextSize}×${nextSize}。装箱货物已退回暂存。`);
    showToast(`扩容成功 → ${nextSize}×${nextSize}`);
    scheduleSave();
  }

  // ----- Persistence (localStorage) -----
  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveGame(); }, 80);
  }

  function serializePlaced() {
    return [...placed.values()].map((p) => ({
      uid: p.uid,
      defId: p.defId,
      rot: p.rot,
      ox: p.ox,
      oy: p.oy,
      valueOverride: p.valueOverride,
    }));
  }

  function saveGame() {
    const payload = {
      v: 8,
      cash,
      round,
      totalPnL,
      wins,
      losses,
      lossStreak,
      profitStreak,
      honeymoonEnded,
      honeymoonGoodDropSeen,
      historyLog: historyLog.slice(0, HISTORY_MAX),
      gridSize,
      expandUses,
      uidCounter,
      paidFeeThisRound,
      crateOpenedThisRound,
      extractedThisRound,
      bankrupt,
      selectedTier,
      keys,
      keyFragments,
      freeRentCharges,
      freeCommonCharges,
      freeRareCharges,
      limitedRefreshCharges,
      nextCrateDiscountPct,
      rareBoostCharges,
      keepStagingThisRound,
      virtualSlots,
      speedOrganizeUnlocked,
      protectCharges,
      codexCollected: [...codexCollected],
      codexClaimed: [...codexClaimed],
      totalCrateOpens,
      openMilestonesClaimed: [...openMilestonesClaimed],
      peakCash,
      unlockedHalls: [...unlockedHalls],
      peakMilestonesClaimed: [...peakMilestonesClaimed],
      dailyActivityKey,
      dailyActivityCount,
      dailyActivityCompleted,
      dailyActivityJackpotRolled,
      dailyActivityJackpotPending,
      limitedOffer: limitedOfferActive() ? { endAt: limitedOffer.endAt } : null,
      limitedDailyCount,
      limitedDailyKey: limitedDailyKey || todayKeyLocal(),
      limitedCooldownUntil,
      staging: staging.map((e) => ({
        uid: e.uid,
        defId: e.defId,
        rot: e.rot,
        valueOverride: e.valueOverride,
      })),
      // Paid loot not yet revealed (reload mid-ceremony must not eat the rent)
      pendingRevealLoot: Array.isArray(pendingRevealLoot)
        ? pendingRevealLoot
            .filter((e) => e && !staging.some((s) => s.uid === e.uid) && !placed.has(e.uid))
            .map((e) => ({ uid: e.uid, defId: e.defId, rot: e.rot || 0, valueOverride: e.valueOverride }))
        : null,
      placed: serializePlaced(),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      if (el.saveHint) {
        el.saveHint.textContent = "进度已保存在本地";
        el.saveHint.title = "最近保存 · 本机浏览器";
      }
    } catch (_) { /* quota / private mode */ }
  }

  // ----- Release check (version.json) — non-blocking, never auto-reloads, save format untouched -----
  const VERSION_CHECK_MIN_MS = 60000;
  let lastVersionCheckAt = 0;
  let pendingUpdateVersion = null; // newer release seen but not shown yet (e.g. round started meanwhile)

  /** True only between rounds: nothing opened, or the opened crate is already settled. */
  function roundIdleForUpdate() {
    return !revealing && !settleReplayActive && (!crateOpenedThisRound || extractedThisRound);
  }

  function hideUpdateBanner() {
    const b = document.getElementById("updateBanner");
    if (b) b.hidden = true;
  }

  function showUpdateBanner() {
    if (!roundIdleForUpdate()) return;
    let b = document.getElementById("updateBanner");
    if (!b) {
      b = document.createElement("div");
      b.id = "updateBanner";
      b.setAttribute("role", "status");
      b.style.cssText =
        "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;" +
        "align-items:center;padding:8px 12px;border-radius:10px;background:rgba(20,24,28,0.92);color:#fff;" +
        "box-shadow:0 4px 16px rgba(0,0,0,0.35);font-size:14px;";
      const msg = document.createElement("span");
      msg.textContent = "有更新，刷新后继续";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "btnUpdateReload";
      btn.className = "btn";
      btn.textContent = "刷新";
      btn.addEventListener("click", () => {
        if (!roundIdleForUpdate()) { showToast("本场结束后再刷新"); return; }
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        saveGame(); // save first, then reload
        location.reload();
      });
      b.append(msg, btn);
      document.body.appendChild(b);
    }
    b.hidden = false;
  }

  /** Fetch version.json (no-store, ≤ once / 60 s, silent on errors); prompt only between rounds. */
  function checkForUpdate(reason) {
    if (!roundIdleForUpdate()) return;
    if (pendingUpdateVersion) { showUpdateBanner(); return; }
    const now = Date.now();
    if (now - lastVersionCheckAt < VERSION_CHECK_MIN_MS) return;
    if (typeof fetch !== "function") return;
    lastVersionCheckAt = now;
    try {
      fetch(`version.json?t=${now}`, { cache: "no-store" })
        .then((r) => (r && r.ok ? r.json() : null))
        .then((data) => {
          const remote = data && typeof data.version === "string" ? data.version.trim() : "";
          if (!remote || remote === BUILD_VERSION) return;
          pendingUpdateVersion = remote;
          showUpdateBanner(); // no-op if a round started meanwhile; shown after next settle
        })
        .catch(() => { /* offline / 404 — ignore */ });
    } catch (_) { /* ignore */ }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate("visible");
  });

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* ignore */ }
  }

  function loadGame() {
    let raw;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (_) { return false; }
    if (!raw) return false;
    let data;
    try { data = JSON.parse(raw); } catch (_) { return false; }
    if (!data || typeof data !== "object") return false;

    cash = Number(data.cash);
    if (!Number.isFinite(cash)) cash = STARTING_CASH;
    displayCash = null; // snap HUD on restore (no count-from-start)
    round = Math.max(1, Number(data.round) || 1);
    totalPnL = Number(data.totalPnL) || 0;
    wins = Math.max(0, Number(data.wins) || 0);
    losses = Math.max(0, Number(data.losses) || 0);
    lossStreak = Math.max(0, Number(data.lossStreak) || 0);
    profitStreak = Math.max(0, Number(data.profitStreak) || 0);
    honeymoonEnded = !!data.honeymoonEnded;
    honeymoonGoodDropSeen = !!data.honeymoonGoodDropSeen;
    // Recompute end if mid-honeymoon save already past thresholds
    if (!honeymoonEnded && (round > HONEYMOON.ROUNDS || cash >= HONEYMOON.CASH_END)) {
      honeymoonEnded = true;
    }
    honeymoonEndToastShown = honeymoonEnded;
    historyLog = Array.isArray(data.historyLog) ? data.historyLog.slice(0, HISTORY_MAX) : [];
    expandUses = Math.max(0, Number(data.expandUses) || 0);
    keys = Math.max(0, Number(data.keys) || 0);
    keyFragments = Math.max(0, Number(data.keyFragments) || 0);
    freeRentCharges = Math.max(0, Number(data.freeRentCharges) || 0);
    freeCommonCharges = Math.max(0, Number(data.freeCommonCharges) || 0);
    freeRareCharges = Math.max(0, Number(data.freeRareCharges) || 0);
    limitedRefreshCharges = Math.max(0, Number(data.limitedRefreshCharges) || 0);
    {
      const d = Number(data.nextCrateDiscountPct);
      nextCrateDiscountPct =
        Number.isFinite(d) && d > 0
          ? Math.min(0.5, Math.max(0, d))
          : 0;
    }
    rareBoostCharges = Math.max(0, Number(data.rareBoostCharges) || 0);
    keepStagingThisRound = !!data.keepStagingThisRound;
    virtualSlots = Math.max(0, Number(data.virtualSlots) || 0);
    speedOrganizeUnlocked = !!data.speedOrganizeUnlocked;
    protectCharges = Math.max(0, Number(data.protectCharges) || 0);
    codexCollected = new Set(
      Array.isArray(data.codexCollected)
        ? data.codexCollected.filter((id) => getDef(id))
        : []
    );
    codexClaimed = new Set(
      Array.isArray(data.codexClaimed)
        ? data.codexClaimed.map(Number).filter((n) => Number.isFinite(n))
        : []
    );
    totalCrateOpens = Math.max(0, Number(data.totalCrateOpens) || 0);
    openMilestonesClaimed = new Set(
      Array.isArray(data.openMilestonesClaimed)
        ? data.openMilestonesClaimed.map(Number).filter((n) => Number.isFinite(n))
        : []
    );
    peakMilestonesClaimed = new Set(
      Array.isArray(data.peakMilestonesClaimed)
        ? data.peakMilestonesClaimed.map(Number).filter((n) => Number.isFinite(n))
        : []
    );
    {
      const pc = Number(data.peakCash);
      peakCash = Number.isFinite(pc) && pc > 0 ? pc : cash;
      if (cash > peakCash) peakCash = cash;
    }
    unlockedHalls = new Set(
      Array.isArray(data.unlockedHalls)
        ? data.unlockedHalls.filter((id) => AUCTION_HALL_CFG.TIERS.some((t) => t.id === id))
        : []
    );
    // Backfill unlocks from peak if flags missing (migrate)
    for (const t of AUCTION_HALL_CFG.TIERS) {
      if (peakCash >= t.peakCash) unlockedHalls.add(t.id);
    }
    dailyActivityKey = typeof data.dailyActivityKey === "string" ? data.dailyActivityKey : todayKeyLocal();
    {
      // Theme target depends on today's date hash; clamp after key restore
      const themes = DAILY_ACTIVITY_CFG.THEMES;
      const tIdx = (function () {
        let h = 2166136261;
        const s = dailyActivityKey || todayKeyLocal();
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0) % themes.length;
      })();
      const themeTarget = (themes[tIdx] && themes[tIdx].target) || 3;
      dailyActivityCount = Math.max(0, Math.min(themeTarget, Number(data.dailyActivityCount) || 0));
      dailyActivityCompleted = !!data.dailyActivityCompleted || dailyActivityCount >= themeTarget;
    }
    dailyActivityJackpotRolled = !!data.dailyActivityJackpotRolled;
    dailyActivityJackpotPending = !!data.dailyActivityJackpotPending && dailyActivityCompleted && !dailyActivityJackpotRolled;
    ensureDailyActivity();
    uidCounter = Math.max(1, Number(data.uidCounter) || 1);
    paidFeeThisRound = Math.max(0, Number(data.paidFeeThisRound) || 0);
    crateOpenedThisRound = !!data.crateOpenedThisRound;
    extractedThisRound = !!data.extractedThisRound;
    bankrupt = !!data.bankrupt;
    selectedTier = data.selectedTier || null;
    revealing = false;

    ensureLimitedDaily();
    limitedDailyKey = typeof data.limitedDailyKey === "string" ? data.limitedDailyKey : todayKeyLocal();
    limitedDailyCount = Math.max(0, Number(data.limitedDailyCount) || 0);
    ensureLimitedDaily(); // reset count if day rolled
    limitedCooldownUntil = Math.max(0, Number(data.limitedCooldownUntil) || 0);
    if (data.limitedOffer && data.limitedOffer.endAt && Number(data.limitedOffer.endAt) > Date.now()) {
      limitedOffer = { endAt: Number(data.limitedOffer.endAt) };
    } else {
      limitedOffer = null;
    }
    if (selectedTier === "limited" && !limitedOfferActive()) selectedTier = null;

    let gs = Number(data.gridSize) || DEFAULT_GRID;
    if (!GRID_SIZES.includes(gs)) {
      // migrate old 10/12 → 8, unknown → default 5
      gs = gs >= 8 ? 8 : gs >= 7 ? 7 : gs >= 6 ? 6 : DEFAULT_GRID;
    }
    gridSize = gs;
    if (el.gridSizeSelect) safeSetSelectValue(el.gridSizeSelect, gridSize);

    staging = Array.isArray(data.staging)
      ? data.staging.map((e) => ({
          uid: e.uid || nextUid(),
          defId: e.defId,
          rot: e.rot || 0,
          valueOverride: e.valueOverride,
        })).filter((e) => getDef(e.defId))
      : [];

    // Restore paid-but-unrevealed loot (saved mid-ceremony) straight into staging.
    pendingRevealLoot = null;
    if (Array.isArray(data.pendingRevealLoot) && data.pendingRevealLoot.length && !extractedThisRound) {
      let restored = 0;
      for (const e of data.pendingRevealLoot) {
        if (!e || !getDef(e.defId) || staging.some((s) => s.uid === e.uid)) continue;
        staging.push({ uid: e.uid || nextUid(), defId: e.defId, rot: e.rot || 0, valueOverride: e.valueOverride });
        restored += 1;
      }
      if (restored) crateOpenedThisRound = true;
    }

    initGrid(gridSize);
    placed.clear();
    if (Array.isArray(data.placed)) {
      for (const e of data.placed) {
        if (!getDef(e.defId)) continue;
        placeItem(
          { uid: e.uid || nextUid(), defId: e.defId, rot: e.rot || 0, valueOverride: e.valueOverride },
          e.ox | 0,
          e.oy | 0
        );
      }
    }
    renderGrid();
    renderStaging();
    renderHistoryFromSave();
    el.btnNextRound.hidden = !extractedThisRound || bankrupt;
    if (bankrupt) {
      el.bankruptCash.textContent = formatYen(cash);
      el.bankruptPnL.textContent = formatYen(totalPnL);
      updateBankruptModalUI();
      el.bankruptModal.hidden = false;
    }
    updateStats();
    updateLimitedOfferUI();
    maybeTriggerDailyJackpot();
    setActionDesc(
      `欢迎回来。现金 ${formatYen(cash)} · 第 ${round} 场 · 战绩 ${wins} 胜 / ${losses} 负。进度已从本地恢复。`
    );
    return true;
  }

  // ----- Bind -----
  function bind() {
    if (el.dailyJackpotOverlay) el.dailyJackpotOverlay.addEventListener("click", hideDailyJackpot);
    el.crateTiers.querySelectorAll(".crate-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        selectedTier = btn.dataset.tier;
        updateCrateButtons();
        updateFeePreview();
        const tier = CRATE_TIERS[selectedTier];
        const rent = effectiveTierFee(selectedTier);
        const discNote = nextCrateDiscountPct > 0 ? `（含下一柜-${Math.round(nextCrateDiscountPct * 100)}%）` : "";
        setActionDesc(
          `已看中「${tier.name}」，租金 ${formatYen(rent)}${honeymoonActive() && HONEYMOON.FEE_MULT[selectedTier] ? "（新手保护）" : ""}${discNote}。点「支付租金并开箱」向房东付款。`
        );
      });
    });

    el.btnOpenCrate.addEventListener("click", openCrate);
        el.btnRotate.addEventListener("pointerdown", (e) => {
      // During drag, rotate on press without waiting for click (click would end drag via pointerup)
      if (drag.active || drag.pending || selectedUid) {
        e.preventDefault();
        e.stopPropagation();
        rotateSelected();
      }
    });
    el.btnRotate.addEventListener("click", (e) => {
      if (drag.active) {
        e.preventDefault();
        return;
      }
      rotateSelected();
    });
    el.btnExtract.addEventListener("click", extract);

    if (el.limitedOfferSelect) {
      el.limitedOfferSelect.addEventListener("click", () => {
        if (!limitedOfferActive()) return;
        if (crateOpenedThisRound || revealing || extractedThisRound) return;
        if (cash < effectiveTierFee("limited")) {
          showToast("现金不足，无法租限时柜");
          return;
        }
        selectedTier = "limited";
        updateCrateButtons();
        updateFeePreview();
        setActionDesc(
          `已看中「限时豪华柜」，租金 ${formatYen(effectiveTierFee("limited"))}。货池优于密封——倒计时结束即消失。`
        );
      });
    }
    if (el.btnLimitedKeyRefresh) {
      el.btnLimitedKeyRefresh.addEventListener("click", () => {
        fx("uiClick");
        refreshLimitedWithKey();
      });
    }
    if (el.btnLimitedAdEarly) {
      el.btnLimitedAdEarly.addEventListener("click", () => {
        fx("uiClick");
        refreshLimitedWithAd();
      });
    }
    if (el.btnChallengeAdRetry) {
      el.btnChallengeAdRetry.addEventListener("click", () => {
        if (challengeActive) challengeActive.adRetry();
      });
    }
    if (el.btnChallengeKeyProtect) {
      el.btnChallengeKeyProtect.addEventListener("click", () => {
        if (challengeActive) challengeActive.keyProtect();
      });
    }
    if (el.btnChallengeIapProtect) {
      el.btnChallengeIapProtect.addEventListener("click", () => {
        if (challengeActive) challengeActive.iapProtect();
      });
    }
    if (el.btnChallengeAcceptFail) {
      el.btnChallengeAcceptFail.addEventListener("click", () => {
        if (challengeActive) challengeActive.acceptDowngrade();
      });
    }

    if (el.btnMute) {
      el.btnMute.addEventListener("click", () => {
        const a = FX();
        if (!a) return;
        a.toggleMute();
        syncMuteUI();
        if (!a.isMuted()) a.uiClick();
      });
    }

    if (el.btnFxMode) {
      el.btnFxMode.addEventListener("click", () => {
        const mode = toggleSettleFxMode();
        fx("uiClick");
        showToast(mode === "fancy" ? "结算特效：华丽（回放+金币）" : "结算特效：流畅（仅音效+数字）");
      });
    }
    if (el.hallChip) {
      el.hallChip.addEventListener("click", () => {
        const hall = activeAuctionHall();
        if (!hall) return;
        fx("uiClick");
        showHallEnterCard(hall, { unlock: false });
      });
      el.hallChip.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.hallChip.click();
        }
      });
    }
    if (el.btnHallEnterOk) {
      el.btnHallEnterOk.addEventListener("click", () => {
        fx("uiClick");
        hideHallEnterCard();
      });
    }
    if (el.hallEnterModal) {
      el.hallEnterModal.addEventListener("click", (e) => {
        if (e.target === el.hallEnterModal) hideHallEnterCard();
      });
    }
    if (el.dailyBestChip) {
      el.dailyBestChip.addEventListener("click", () => {
        fx("uiClick");
        replayDailyBest();
      });
    }

    if (el.btnNewSave) {
      el.btnNewSave.addEventListener("click", () => {
        fx("uiClick");
        newSaveConfirm();
      });
    }

    if (el.btnEvalMode) {
      el.btnEvalMode.addEventListener("click", () => {
        if (typeof fx === "function") fx("uiClick");
        // evalMode stays independent of panel visibility
        if (!evalMode) {
          setEvalMode(true); // enters mode + shows panel
          return;
        }
        if (el.evalPanel && el.evalPanel.hidden) {
          setEvalPanelVisible(true);
          syncEvalPanel();
          return;
        }
        // Mode on + panel open → collapse panel only (do not exit eval)
        setEvalPanelVisible(false);
      });
    }
    if (el.btnEvalPanelClose) {
      el.btnEvalPanelClose.addEventListener("click", () => {
        if (typeof fx === "function") fx("uiClick");
        setEvalPanelVisible(false);
      });
    }
    if (el.btnEvalExit) {
      el.btnEvalExit.addEventListener("click", () => {
        if (typeof fx === "function") fx("uiClick");
        setEvalMode(false);
      });
    }
    if (el.btnDataPanel) {
      el.btnDataPanel.addEventListener("click", () => {
        if (typeof fx === "function") fx("uiClick");
        if (!el.dataPanel) return;
        el.dataPanel.hidden = !el.dataPanel.hidden;
        if (!el.dataPanel.hidden) syncDataPanel();
      });
    }
    if (el.btnEvalClear) {
      el.btnEvalClear.addEventListener("click", () => {
        if (typeof fx === "function") fx("uiClick");
        newSaveConfirm();
      });
    }
    if (el.btnEvalCash) {
      el.btnEvalCash.addEventListener("click", () => {
        if (!evalMode) return;
        if (typeof fx === "function") fx("uiClick");
        cash += 50000;
        if (typeof peakCash !== "undefined" && cash > peakCash) peakCash = cash;
        showToast("评测：现金 +¥50,000");
        if (typeof updateStats === "function") updateStats();
        if (typeof updateCrateButtons === "function") updateCrateButtons();
        if (typeof syncEvalPanel === "function") syncEvalPanel();
        if (typeof syncDataPanel === "function") syncDataPanel();
        if (typeof scheduleSave === "function") scheduleSave();
      });
    }
    if (el.btnEvalForceBall) {
      el.btnEvalForceBall.addEventListener("click", () => {
        if (!evalMode) return;
        if (typeof fx === "function") fx("uiClick");
        evalForceFollowBall = !evalForceFollowBall;
        showToast(evalForceFollowBall ? "评测：跟随球 100%" : "评测：跟随球恢复 50%");
        syncEvalPanel();
      });
    }
    if (el.btnEvalSoftChallenge) {
      el.btnEvalSoftChallenge.addEventListener("click", () => {
        if (!evalMode) return;
        if (typeof fx === "function") fx("uiClick");
        evalSoftChallenge = !evalSoftChallenge;
        showToast(
          evalSoftChallenge
            ? "评测：鉴宝门槛降至 ≤¥8,000"
            : "评测：鉴宝门槛恢复正式值"
        );
        syncEvalPanel();
        if (typeof syncDataPanel === "function") syncDataPanel();
      });
    }
    if (el.btnReportBug) {
      el.btnReportBug.addEventListener("click", () => {
        if (typeof fx === "function") fx("uiClick");
        copyBugDiagnostics();
      });
    }
    if (el.evalFxSelect) {
      el.evalFxSelect.addEventListener("change", () => {
        setSettleFxMode(el.evalFxSelect.value === "fancy" ? "fancy" : "smooth");
        syncEvalPanel();
      });
    }

    if (el.btnExpand) {
      el.btnExpand.addEventListener("click", (e) => {
        fx("uiClick");
        if (e.shiftKey) tryExpandWithCash();
        else tryExpandWarehouse();
      });
      el.btnExpand.title = "扩容：点击打开补给；Shift+点击用现金";
    }

    if (el.btnShop) {
      el.btnShop.addEventListener("click", () => {
        fx("uiClick");
        openShop();
      });
    }
    if (el.btnCloseShop) {
      el.btnCloseShop.addEventListener("click", () => { el.shopModal.hidden = true; });
    }
    if (el.shopModal) {
      el.shopModal.addEventListener("click", (e) => {
        if (e.target === el.shopModal) el.shopModal.hidden = true;
      });
    }
    if (el.btnConfirmOk) el.btnConfirmOk.addEventListener("click", () => closeConfirm(true));
    if (el.btnConfirmCancel) el.btnConfirmCancel.addEventListener("click", () => closeConfirm(false));
    if (el.confirmModal) {
      el.confirmModal.addEventListener("click", (e) => {
        if (e.target === el.confirmModal) closeConfirm(false);
      });
    }

    const wireAd = (btn, placement, grant) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        fx("uiClick");
        offerRewardedAd(placement, grant);
      });
    };
    wireAd(el.btnAdFreeRent, AD_PLACEMENTS.FREE_RENT, grantFreeRent);
    wireAd(el.btnAdBankruptRent, AD_PLACEMENTS.FREE_RENT, grantFreeRent);
    wireAd(el.btnAdTempSlots, AD_PLACEMENTS.WAREHOUSE_TEMP, grantTempSlots);
    wireAd(el.btnAdKeepLoot, AD_PLACEMENTS.KEEP_STAGING, grantKeepStaging);
    wireAd(el.btnAdSettleRefund, AD_PLACEMENTS.SETTLE_REFUND, grantSettleRefund);

    // Ads master switch: hide all ad chips/bars when FEATURES.ADS_ENABLED=false
    if (!FEATURES.ADS_ENABLED) {
      document.querySelectorAll(".ad-chip, .bankrupt-ad-slot, #revealAdBar, #adCapLine, #warehouseFullOffers, #resultAdSlot").forEach((n) => {
        n.hidden = true;
      });
    }
    if (el.revealAdBar) el.revealAdBar.hidden = true;
    if (el.btnAdRevealNext) {
      el.btnAdRevealNext.addEventListener("click", () => {
        fx("uiClick");
        logMono("ad_click", AD_PLACEMENTS.REVEAL_NEXT, { disabled: true });
        logMono("ad_cap", AD_PLACEMENTS.REVEAL_NEXT, { reason: "disabled" });
        showToast("「看广告开下一件」已关闭");
        resolveRevealPause(false);
      });
    }
    if (el.btnSkipRevealAd) {
      el.btnSkipRevealAd.addEventListener("click", () => {
        fx("uiClick");
        resolveRevealPause(false);
      });
    }
    if (el.btnSpeedOrganize) {
      el.btnSpeedOrganize.addEventListener("click", () => {
        fx("uiClick");
        speedOrganizeAll();
      });
    }

    // Unlock AudioContext on first user gesture
    const unlock = () => { fx("resume"); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    el.btnNextRound.addEventListener("click", nextRound);
    el.btnResultNext.addEventListener("click", nextRound);
    el.btnResultClose.addEventListener("click", () => { el.resultModal.hidden = true; });
    el.btnHelp.addEventListener("click", () => { el.helpModal.hidden = false; });
    el.btnCloseHelp.addEventListener("click", () => { el.helpModal.hidden = true; });
    el.helpModal.addEventListener("click", (e) => {
      if (e.target === el.helpModal) el.helpModal.hidden = true;
    });
    if (el.btnCodex) {
      el.btnCodex.addEventListener("click", () => {
        fx("uiClick");
        openCodexModal();
      });
    }
    if (el.btnCloseCodex) {
      el.btnCloseCodex.addEventListener("click", () => closeCodexModal());
    }
    if (el.codexModal) {
      el.codexModal.addEventListener("click", (e) => {
        if (e.target === el.codexModal) closeCodexModal();
      });
    }
    if (el.btnRestructure) {
      el.btnRestructure.addEventListener("click", () => {
        fx("uiClick");
        applyRestructure();
      });
    }
    if (el.btnBankruptNewSave) {
      el.btnBankruptNewSave.addEventListener("click", () => {
        fx("uiClick");
        newSaveConfirm();
      });
    }
    if (el.btnRestart) el.btnRestart.addEventListener("click", restartGame);

    el.btnClearGrid.addEventListener("click", () => {
      for (const uid of [...placed.keys()]) {
        const entry = removeFromGrid(uid);
        if (entry) {
          staging.push({
            uid: entry.uid,
            defId: entry.defId,
            rot: entry.rot,
            valueOverride: entry.valueOverride,
          });
        }
      }
      renderStaging();
      renderGrid();
      updateStats();
    });

    el.gridSizeSelect.addEventListener("change", () => {
      for (const uid of [...placed.keys()]) {
        const entry = removeFromGrid(uid);
        if (entry) {
          staging.push({
            uid: entry.uid,
            defId: entry.defId,
            rot: entry.rot,
            valueOverride: entry.valueOverride,
          });
        }
      }
      initGrid(+el.gridSizeSelect.value);
      renderStaging();
      setActionDesc(`仓库已切换为 ${gridSize}×${gridSize}，装箱货物已退回暂存。`);
      scheduleSave();
    });

    el.stagingArea.addEventListener("pointerup", (e) => {
      if (drag.active || drag.pending) return;
      if (e.target.closest?.(".item-card")) return;
      if (!selectedUid) return;
      if (findStaging(selectedUid)) return;
      const entry = removeFromGrid(selectedUid);
      if (!entry) return;
      staging.push({
        uid: entry.uid,
        defId: entry.defId,
        rot: entry.rot,
        valueOverride: entry.valueOverride,
      });
      fx("returnStaging");
      renderStaging();
      renderGrid();
      updateStats();
      showDetail(entry);
      updatePlaceTargetClass();
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", (e) => {
      if (drag.pending && !drag.active) {
        drag.pending = null;
        return;
      }
      finishDrag(e, true);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rotateSelected();
      } else if (e.key === "Escape") {
        if (drag.active) finishDrag(e, true);
        if (revealPause) { resolveRevealPause(false); return; }
        el.helpModal.hidden = true;
        el.resultModal.hidden = true;
        if (el.shopModal) el.shopModal.hidden = true;
        if (el.codexModal) el.codexModal.hidden = true;
        if (el.confirmModal && !el.confirmModal.hidden) closeConfirm(false);
      }
    });

    window.addEventListener("beforeunload", () => { saveGame(); });

    // Keep --cell-size ownership correct across rotate/resize
    const mqMobile = window.matchMedia("(max-width: 700px)");
    const syncCellSizeOwner = () => {
      const mobile = mqMobile.matches;
      document.body.classList.toggle("is-mobile", mobile);
      if (mobile) {
        fitCellSizeToWrap();
        renderGrid();
      } else {
        document.documentElement.style.setProperty(
          "--cell-size",
          gridSize >= 8 ? "40px" : gridSize >= 7 ? "44px" : gridSize >= 6 ? "50px" : "56px"
        );
        renderGrid();
      }
    };
    mqMobile.addEventListener("change", syncCellSizeOwner);
    window.addEventListener("resize", () => {
      if (mqMobile.matches) {
        fitCellSizeToWrap();
      }
    }, { passive: true });
  }

  // ----- Init -----
  bind();
  try { loadSettleFxMode(); } catch (e) { console.warn("[boot] loadSettleFxMode", e); }
  try { applyEvalUrlFlags(); setEvalMode(evalModeOn()); } catch (e) { console.warn("[boot] setEvalMode", e); }
  try { syncFxModeUI(); } catch (e) { console.warn("[boot] syncFxModeUI", e); }
  try { syncMuteUI(); } catch (e) { console.warn("[boot] syncMuteUI", e); }
  try { loadDailyBest(); updateDailyBestUI(); } catch (e) { console.warn("[boot] dailyBest", e); }
  if (monoDebugOn() && el.monoDebug) el.monoDebug.hidden = false;
  let restored = false;
  try { restored = !!loadGame(); } catch (e) { console.warn("[boot] loadGame", e); restored = false; }
  if (!restored) {
    if (el.gridSizeSelect) safeSetSelectValue(el.gridSizeSelect, DEFAULT_GRID);
    try { initGrid(DEFAULT_GRID); } catch (e) { console.warn("[boot] initGrid", e); }
    updateCrateButtons();
    try { updateStats(); } catch (e) { console.warn("[boot] updateStats", e); }
    try { updateKeysUI(); } catch (e) { console.warn("[boot] updateKeysUI", e); }
    setActionDesc(
      `欢迎来到仓储拍卖场。启动资金 ${formatYen(STARTING_CASH)}（约 3–4 次普通柜）。默认仓库 ${DEFAULT_GRID}×${DEFAULT_GRID}，装箱极紧。补给/广告为占位。`
    );
    addLog(`入场 · 启动资金 <strong>${formatYen(STARTING_CASH)}</strong> · 仓库 ${DEFAULT_GRID}×${DEFAULT_GRID}`);
  } else {
    updateCrateButtons();
    try { updateKeysUI(); } catch (e) { console.warn("[boot] updateKeysUI", e); }
  }
  // Always refresh crate affordance after boot UI settles (guards earlier UI sync throws).
  try { updateCrateButtons(); } catch (e) { console.warn("[boot] updateCrateButtons", e); }
  // Apply hall theme silently on boot (card only on unlock / chip tap)
  {
    const hall = activeAuctionHall();
    if (hall) {
      lastAnnouncedHallId = hall.id;
      applyHallTheme(hall);
    }
    updateHallUI();
  }
  updateAdCapUI();
  updateLimitedOfferUI();
  if (platform && typeof platform.gameplayStart === "function") platform.gameplayStart();
  if (!crateOpenedThisRound && !extractedThisRound) maybeRollLimitedOffer();
  try {
    if (!sessionStorage.getItem("auctionHelpSeen")) {
      el.helpModal.hidden = false;
      sessionStorage.setItem("auctionHelpSeen", "1");
    }
  } catch (_) { /* ignore */ }
})();
