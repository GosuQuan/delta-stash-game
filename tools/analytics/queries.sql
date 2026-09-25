-- delta-stash-analytics · 对照模拟的常用查询
-- 用法：npx wrangler d1 execute delta_stash_analytics --remote --command "<粘贴一条>"
-- 把 :econ 换成要看的经济版本，如 'econ-0925h'。所有视图已排除评测模式。

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
  WHERE ev = 'peak_reach' AND eval = 0 AND econ = :econ
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
  WHERE eval = 0 AND econ = :econ AND ev = 'round_settle' GROUP BY save
), bk AS (
  SELECT save, MIN(json_extract(props, '$.rounds_since_start')) AS first_bk_round
  FROM events WHERE eval = 0 AND econ = :econ AND ev = 'bankrupt' GROUP BY save
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
FROM events WHERE ev = 'warehouse_expand' AND eval = 0 AND econ = :econ GROUP BY to_size, via;

-- Q7 离开时在第几场、停在哪一步（新存档前 20 场）
-- 手机切后台也会发 session_end，同一会话取最后一条
WITH last_end AS (
  SELECT sid, round, json_extract(props, '$.state') AS state,
    ROW_NUMBER() OVER (PARTITION BY sid ORDER BY ts DESC) AS rn
  FROM events WHERE ev = 'session_end' AND eval = 0
)
SELECT round, state, COUNT(*) AS n FROM last_end
WHERE rn = 1 AND round <= 20 GROUP BY round, state ORDER BY round, n DESC;

-- Q8 次日回访：首次打开后第 1 天还回来的玩家比例
WITH first AS (
  SELECT pid, MIN(date((ts / 1000) + 8 * 3600, 'unixepoch')) AS d0 FROM events
  WHERE ev = 'session_start' AND eval = 0 GROUP BY pid
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
FROM events WHERE ev = 'ui_anomaly' AND eval = 0
GROUP BY build, dev, vw, shape, rotated ORDER BY n DESC;
