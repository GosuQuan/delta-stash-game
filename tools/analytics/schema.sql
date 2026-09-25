-- delta-stash-analytics · D1 建表
-- 部署：npx wrangler d1 execute delta_stash_analytics --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,          -- 服务器收到的时间（毫秒）
  country     TEXT,                      -- Cloudflare 国家代码，不存 IP
  ts          INTEGER,                   -- 客户端时间（毫秒）
  schema      INTEGER,
  ev          TEXT NOT NULL,
  pid         TEXT NOT NULL,             -- 匿名玩家 ID
  sid         TEXT,                      -- 会话 ID
  save        TEXT,                      -- 存档 ID（新开档换新）
  build       TEXT,                      -- 发版号，如 20260925g
  econ        TEXT,                      -- 经济数值版本，如 econ-0925h
  round       INTEGER,
  cash        INTEGER,
  peak        INTEGER,
  hall        TEXT,
  grid        INTEGER,
  honeymoon   INTEGER,
  eval        INTEGER,                   -- 本条发生在评测模式 1 / 否 0
  eval_tainted INTEGER,                  -- 存档进过评测（可能有加过的钱、免费尺寸）1 / 否 0
  dev         TEXT,                      -- mobile / pc
  vw          TEXT,                      -- 视口宽度分档
  props       TEXT                       -- 事件私有字段（JSON）
);
CREATE INDEX IF NOT EXISTS idx_events_ev ON events (ev, econ, received_at);
CREATE INDEX IF NOT EXISTS idx_events_save ON events (save, round);
CREATE INDEX IF NOT EXISTS idx_events_pid ON events (pid, ts);

-- 按天汇总（原始事件 90 天后删除，这张表长期保留）
CREATE TABLE IF NOT EXISTS daily_settle (
  day TEXT, econ TEXT, tier_group TEXT, tier TEXT, honeymoon_open INTEGER, grid INTEGER,
  n INTEGER, n_ratio INTEGER, sum_ratio REAL, n_profit INTEGER,
  sum_rent INTEGER, sum_value INTEGER, sum_discard_n INTEGER, n_perfect INTEGER,
  PRIMARY KEY (day, econ, tier_group, tier, honeymoon_open, grid)
);

-- 以下视图默认排除评测模式（eval = 1）和进过评测的存档（eval_tainted = 1）
DROP VIEW IF EXISTS v_settle;
CREATE VIEW v_settle AS
SELECT id, received_at, pid, save, sid, build, econ, round, cash, grid, hall, dev, vw, country,
  json_extract(props, '$.tier')            AS tier,
  json_extract(props, '$.tier_group')      AS tier_group,
  json_extract(props, '$.honeymoon_open')  AS honeymoon_open,
  json_extract(props, '$.discount')        AS discount,
  json_extract(props, '$.rent_base')       AS rent_base,
  json_extract(props, '$.rent_paid')       AS rent_paid,
  json_extract(props, '$.loot_value')      AS loot_value,
  json_extract(props, '$.packed_value')    AS packed_value,
  json_extract(props, '$.discard_n')       AS discard_n,
  json_extract(props, '$.discard_value')   AS discard_value,
  json_extract(props, '$.util_pct')        AS util_pct,
  json_extract(props, '$.perfect_pack')    AS perfect_pack,
  json_extract(props, '$.perfect_bonus')   AS perfect_bonus,
  json_extract(props, '$.empty_refund')    AS empty_refund,
  json_extract(props, '$.net')             AS net,
  json_extract(props, '$.challenges')      AS challenges,
  json_extract(props, '$.challenge_ok')    AS challenge_ok,
  json_extract(props, '$.rent_cash_pct')   AS rent_cash_pct,
  json_extract(props, '$.dur_s')           AS dur_s
FROM events WHERE ev = 'round_settle' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0;

DROP VIEW IF EXISTS v_challenge;
CREATE VIEW v_challenge AS
SELECT id, received_at, pid, save, econ, round, hall,
  json_extract(props, '$.kind')         AS kind,
  json_extract(props, '$.rarity')       AS rarity,
  json_extract(props, '$.ok')           AS ok,
  json_extract(props, '$.result')       AS result,
  json_extract(props, '$.value_before') AS value_before,
  json_extract(props, '$.value_after')  AS value_after,
  json_extract(props, '$.hit_rate')     AS hit_rate,
  json_extract(props, '$.protect')      AS protect,
  json_extract(props, '$.answer_ms')    AS answer_ms
FROM events WHERE ev = 'challenge_result' AND eval = 0 AND COALESCE(eval_tainted, 0) = 0;
