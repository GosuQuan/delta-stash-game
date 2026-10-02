-- delta-stash-analytics · 对照模拟的常用查询
-- 用法：npx wrangler d1 execute delta_stash_analytics --remote --command "<粘贴一条>"
-- 把 :econ 换成要看的经济版本，如 'econ-0925h'。所有视图和查询都排除评测模式（eval = 1）和进过评测的存档（eval_tainted = 1）。

-- Q1 各柜比值与赚钱概率（对照商业化方案 4.1 / 5）
-- 排除蜜月、免费券（实付 0）、空柜退款
SELECT tier_group, tier, COUNT(*) AS n,
  ROUND(AVG((loot_value + perfect_bonus) * 1.0 / rent_paid), 3) AS ratio_avg,
  ROUND(AVG(CASE WHEN net > 0 THEN 1.0 ELSE 0 END), 3)           AS p_profit,
  ROUND(AVG(discard_n), 2)                                        AS discard_avg,
  ROUND(AVG(perfect_pack), 3)                                     AS p_perfect
FROM v_settle
WHERE econ = :econ AND honeymoon_open = 0 AND rent_paid > 0 AND empty_refund = 0
GROUP BY tier_group, tier ORDER BY tier_group, rent_base;

-- Q1b 比值分布（看尾部：最好 10% 是否随档次拉高）
SELECT tier,
  SUM(r < 0.5) AS lt_0_5, SUM(r >= 0.5 AND r < 1) AS b_0_5_1, SUM(r >= 1 AND r < 1.5) AS b_1_1_5,
  SUM(r >= 1.5 AND r < 3) AS b_1_5_3, SUM(r >= 3) AS ge_3
FROM (SELECT tier, (loot_value + perfect_bonus) * 1.0 / rent_paid AS r FROM v_settle
      WHERE econ = :econ AND honeymoon_open = 0 AND rent_paid > 0 AND empty_refund = 0)
GROUP BY tier;

-- Q1c 蜜月期比值（对照 4.2）
SELECT tier, COUNT(*) AS n,
  ROUND(AVG((loot_value + perfect_bonus) * 1.0 / rent_paid), 3) AS ratio_avg
FROM v_settle
WHERE econ = :econ AND honeymoon_open = 1 AND rent_paid > 0 AND empty_refund = 0
GROUP BY tier;

-- Q2 鉴宝答对率（模拟假设 70%）
SELECT kind, COUNT(*) AS n, ROUND(AVG(ok), 3) AS ok_rate,
  ROUND(AVG(CASE WHEN result = 'up' THEN 1.0 ELSE 0 END), 3)   AS p_up,
  ROUND(AVG(CASE WHEN result = 'down' THEN 1.0 ELSE 0 END), 3) AS p_down,
  ROUND(AVG(answer_ms) / 1000.0, 1) AS answer_s
FROM v_challenge WHERE econ = :econ GROUP BY kind;

-- Q3 节奏：稳健档到 8 万 / 30 万的场数中位数（对照 35–50 / 100–150）
WITH r AS (
  SELECT json_extract(props, '$.mark') AS mark, json_extract(props, '$.rounds_to') AS rounds_to
  FROM events
  WHERE ev = 'peak_reach' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ
    AND json_extract(props, '$.steady_share') >= 0.8
), ranked AS (
  SELECT mark, rounds_to,
    ROW_NUMBER() OVER (PARTITION BY mark ORDER BY rounds_to) AS rn,
    COUNT(*) OVER (PARTITION BY mark) AS cnt
  FROM r
)
SELECT mark, MAX(cnt) AS n_saves, MIN(rounds_to) AS min_rounds,
  MAX(CASE WHEN rn = (cnt + 1) / 2 THEN rounds_to END) AS median_rounds,
  MAX(rounds_to) AS max_rounds
FROM ranked GROUP BY mark ORDER BY mark;

-- Q4 破产率（按存档算）：前 15 场 / 第 16 场以后（对照 <10% / <15%）
-- 分母：前 15 场 = 至少结算过 1 场的存档；16 场以后 = 打到第 16 场的存档
WITH saves AS (
  SELECT save, MAX(round) AS max_round FROM events
  WHERE eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ AND ev = 'round_settle' GROUP BY save
), bk AS (
  SELECT save, MIN(json_extract(props, '$.rounds_since_start')) AS first_bk_round
  FROM events WHERE eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ AND ev = 'bankrupt' GROUP BY save
)
SELECT
  COUNT(*) AS saves_early,
  ROUND(AVG(CASE WHEN bk.first_bk_round <= 15 THEN 1.0 ELSE 0 END), 3) AS bankrupt_rate_early,
  SUM(s.max_round >= 16) AS saves_late,
  ROUND(SUM(CASE WHEN s.max_round >= 16 AND bk.first_bk_round >= 16 THEN 1.0 ELSE 0 END)
        / NULLIF(SUM(s.max_round >= 16), 0), 3) AS bankrupt_rate_late
FROM saves s LEFT JOIN bk ON bk.save = s.save;

-- Q5 装箱：按仓库尺寸看丢弃和占用（决定双联柜和扩容定价准不准）
SELECT grid, tier, COUNT(*) AS n, ROUND(AVG(discard_n), 2) AS discard_avg,
  ROUND(AVG(util_pct), 1) AS util_avg, ROUND(AVG(perfect_pack), 3) AS p_perfect
FROM v_settle WHERE econ = :econ AND rent_paid > 0 GROUP BY grid, tier ORDER BY grid, tier;

-- Q6 扩容时机：买的时候扩容价占现金多少（模拟假设 ≤ 40% 就买）
SELECT json_extract(props, '$.to') AS to_size, json_extract(props, '$.via') AS via, COUNT(*) AS n,
  ROUND(AVG(json_extract(props, '$.cost_cash_pct')), 3) AS cost_cash_pct_avg,
  ROUND(AVG(round), 1) AS round_avg
FROM events WHERE ev = 'warehouse_expand' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ GROUP BY to_size, via;

-- Q7 离开时在第几场、停在哪一步（新存档前 20 场）
-- 手机切后台也会发 session_end，同一会话取最后一条
WITH last_end AS (
  SELECT sid, round, json_extract(props, '$.state') AS state,
    ROW_NUMBER() OVER (PARTITION BY sid ORDER BY ts DESC) AS rn
  FROM events WHERE ev = 'session_end' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0
)
SELECT round, state, COUNT(*) AS n FROM last_end
WHERE rn = 1 AND round <= 20 GROUP BY round, state ORDER BY round, n DESC;

-- Q8 次日回访：首次打开后第 1 天还回来的玩家比例
WITH first AS (
  SELECT pid, MIN(date((ts / 1000) + 8 * 3600, 'unixepoch')) AS d0 FROM events
  WHERE ev = 'session_start' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 GROUP BY pid
)
SELECT f.d0, COUNT(*) AS new_players,
  ROUND(AVG(EXISTS (SELECT 1 FROM events e WHERE e.pid = f.pid AND e.ev = 'session_start'
    AND date((e.ts / 1000) + 8 * 3600, 'unixepoch') = date(f.d0, '+1 day'))), 3) AS d1_return
FROM first f GROUP BY f.d0 ORDER BY f.d0;

-- Q9 样本量：各柜非蜜月、实付 > 0 的结算场数（几百场之前只看方向）
SELECT tier, COUNT(*) AS n FROM v_settle
WHERE econ = :econ AND honeymoon_open = 0 AND rent_paid > 0 AND empty_refund = 0 GROUP BY tier;

-- Q10 界面异常：格子里的物品数和画出来的图标数对不上（按版本、设备、宽度）
SELECT build, dev, vw, COUNT(*) AS n, COUNT(DISTINCT pid) AS players,
  json_extract(props, '$.shape') AS shape, json_extract(props, '$.rotated') AS rotated
FROM events WHERE ev = 'ui_anomaly' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0
GROUP BY build, dev, vw, shape, rotated ORDER BY n DESC;

-- ===== Q11–Q13 掉落分析（依赖 loot_ids / sold_ids / dropped_ids，见 20260926g 起） =====
-- 字段格式：`物品id:数量`，逗号连接，按 id 排序，最长 200 字符；超长时先丢低价值物品，十字物品总会保留。
-- 所以低价值物品的出现率在长列表里会偏低，Q11–Q13 的结论只对高价值物品（尤其十字物品）可信。
-- 没有 loot_ids 的旧版事件（字段为 NULL）自动排除；round_settle.loot_ids 为 NULL 表示该场中途刷新过页面，同样不计。
-- 十字物品的概率是低概率事件：密封柜至少要几百场真人开柜才能下结论，样本量 n 看 n_opens / n_rounds，几百场之前只看方向。
-- 解析方法：用递归 CTE 把 'a:2,b:1' 拆成多行（只用 instr / substr，不依赖 json_each，D1 / SQLite 都能跑）。

-- Q11 每个柜子里每件物品的掉落率（按 tier 分：sealed / limited / common …）
-- p_per_open = 含该物品的开柜占比；pieces_per_open = 平均每次开柜掉几件；n_opens 是该柜子的开柜总数（样本量）
WITH RECURSIVE opens AS (
  SELECT id, COALESCE(json_extract(props, '$.tier'), 'unknown') AS tier, json_extract(props, '$.loot_ids') AS ids
  FROM events
  WHERE ev = 'crate_open' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ
    AND json_extract(props, '$.loot_ids') IS NOT NULL AND json_extract(props, '$.loot_ids') <> ''
), split(id, tier, item, rest) AS (
  SELECT id, tier, '', ids || ',' FROM opens
  UNION ALL
  SELECT id, tier, substr(rest, 1, instr(rest, ',') - 1), substr(rest, instr(rest, ',') + 1)
  FROM split WHERE rest <> ''
), pieces AS (
  SELECT id, tier, substr(item, 1, instr(item, ':') - 1) AS item_id,
    CAST(substr(item, instr(item, ':') + 1) AS INTEGER) AS qty
  FROM split WHERE item <> ''
), n_open AS (
  SELECT tier, COUNT(*) AS n_opens FROM opens GROUP BY tier
)
SELECT p.tier, p.item_id, o.n_opens,
  COUNT(DISTINCT p.id) AS opens_with_item, SUM(p.qty) AS pieces,
  ROUND(COUNT(DISTINCT p.id) * 1.0 / o.n_opens, 4) AS p_per_open,
  ROUND(SUM(p.qty) * 1.0 / o.n_opens, 4)           AS pieces_per_open
FROM pieces p JOIN n_open o ON o.tier = p.tier
GROUP BY p.tier, p.item_id ORDER BY p.tier, p_per_open DESC, p.item_id;

-- Q12 十字物品：每次开柜至少掉一件的概率，和平均开几次柜掉一件（密封柜 vs 限时柜）
-- 十字物品 id 清单（来自 release-g game.js，20260926g 核对）：gold_drone 镀金勘测机、solar_array 炎阵列板、
--   vein_core 血脉能源芯、void_ingot 虚空赤锭。密封柜只出 vein_core，限时柜四件都出；以游戏端 shape = "cross" 为准，加了新十字物品要同步改这里。
-- 注意：这是观测概率，不是保底；不能写成「必出十字」。
-- p_at_least_one = 至少含一件十字的开柜 / 开柜总数；opens_per_cross = 开柜总数 / 十字总件数（掉 0 件时为 NULL）
WITH RECURSIVE opens AS (
  SELECT id, json_extract(props, '$.tier') AS tier, json_extract(props, '$.loot_ids') AS ids
  FROM events
  WHERE ev = 'crate_open' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ
    AND json_extract(props, '$.tier') IN ('sealed', 'limited')
    AND json_extract(props, '$.loot_ids') IS NOT NULL AND json_extract(props, '$.loot_ids') <> ''
), split(id, tier, item, rest) AS (
  SELECT id, tier, '', ids || ',' FROM opens
  UNION ALL
  SELECT id, tier, substr(rest, 1, instr(rest, ',') - 1), substr(rest, instr(rest, ',') + 1)
  FROM split WHERE rest <> ''
), cross_pieces AS (
  SELECT id, tier, CAST(substr(item, instr(item, ':') + 1) AS INTEGER) AS qty
  FROM split
  WHERE item <> '' AND substr(item, 1, instr(item, ':') - 1) IN ('gold_drone', 'solar_array', 'vein_core', 'void_ingot') -- 十字物品 id 清单需和游戏端核对
), per_open AS (
  SELECT o.id, o.tier, COALESCE(SUM(c.qty), 0) AS cross_n
  FROM opens o LEFT JOIN cross_pieces c ON c.id = o.id GROUP BY o.id, o.tier
)
SELECT tier, COUNT(*) AS n_opens,
  SUM(cross_n > 0) AS opens_with_cross, SUM(cross_n) AS cross_pieces,
  ROUND(AVG(CASE WHEN cross_n > 0 THEN 1.0 ELSE 0 END), 4) AS p_at_least_one,
  ROUND(COUNT(*) * 1.0 / NULLIF(SUM(cross_n), 0), 1)       AS opens_per_cross
FROM per_open GROUP BY tier ORDER BY tier;

-- Q13 每件物品的丢弃率和卖出率（来自 round_settle：dropped_ids / sold_ids 对照 loot_ids）
-- 只统计 loot_ids 非空的场次（中途刷新过的场次 loot_ids 为 NULL，不计）。按件数算：
-- discard_rate = 丢弃件数 / 掉落件数；sold_rate = 卖出件数 / 掉落件数；unaccounted = 掉落 − 卖出 − 丢弃（正常为 0，
-- 非 0 说明 200 字符截断丢了低价值物品，或埋点有问题）。n_rounds_with_item 是含该物品的场数（样本量）。
WITH RECURSIVE base AS (
  SELECT id, COALESCE(json_extract(props, '$.tier'), 'unknown') AS tier, 'loot' AS kind, json_extract(props, '$.loot_ids') AS ids
  FROM events
  WHERE ev = 'round_settle' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ
    AND json_extract(props, '$.loot_ids') IS NOT NULL AND json_extract(props, '$.loot_ids') <> ''
  UNION ALL
  SELECT id, COALESCE(json_extract(props, '$.tier'), 'unknown'), 'sold', json_extract(props, '$.sold_ids')
  FROM events
  WHERE ev = 'round_settle' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ
    AND json_extract(props, '$.loot_ids') IS NOT NULL AND json_extract(props, '$.loot_ids') <> ''
    AND json_extract(props, '$.sold_ids') IS NOT NULL AND json_extract(props, '$.sold_ids') <> ''
  UNION ALL
  SELECT id, COALESCE(json_extract(props, '$.tier'), 'unknown'), 'dropped', json_extract(props, '$.dropped_ids')
  FROM events
  WHERE ev = 'round_settle' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0 AND econ = :econ
    AND json_extract(props, '$.loot_ids') IS NOT NULL AND json_extract(props, '$.loot_ids') <> ''
    AND json_extract(props, '$.dropped_ids') IS NOT NULL AND json_extract(props, '$.dropped_ids') <> ''
), split(id, tier, kind, item, rest) AS (
  SELECT id, tier, kind, '', ids || ',' FROM base
  UNION ALL
  SELECT id, tier, kind, substr(rest, 1, instr(rest, ',') - 1), substr(rest, instr(rest, ',') + 1)
  FROM split WHERE rest <> ''
), pieces AS (
  SELECT id, tier, kind, substr(item, 1, instr(item, ':') - 1) AS item_id,
    CAST(substr(item, instr(item, ':') + 1) AS INTEGER) AS qty
  FROM split WHERE item <> ''
)
SELECT tier, item_id,
  COUNT(DISTINCT CASE WHEN kind = 'loot' THEN id END)           AS n_rounds_with_item,
  SUM(CASE WHEN kind = 'loot'    THEN qty ELSE 0 END)           AS loot_pieces,
  SUM(CASE WHEN kind = 'sold'    THEN qty ELSE 0 END)           AS sold_pieces,
  SUM(CASE WHEN kind = 'dropped' THEN qty ELSE 0 END)           AS dropped_pieces,
  ROUND(SUM(CASE WHEN kind = 'sold'    THEN qty ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN kind = 'loot' THEN qty ELSE 0 END), 0), 4) AS sold_rate,
  ROUND(SUM(CASE WHEN kind = 'dropped' THEN qty ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN kind = 'loot' THEN qty ELSE 0 END), 0), 4) AS discard_rate,
  SUM(CASE WHEN kind = 'loot' THEN qty WHEN kind IN ('sold', 'dropped') THEN -qty ELSE 0 END) AS unaccounted
FROM pieces GROUP BY tier, item_id ORDER BY tier, loot_pieces DESC, item_id;
