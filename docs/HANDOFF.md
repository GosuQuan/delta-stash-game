# 仓储拍卖开箱 — 产品/技术交接（HANDOFF）

> 给「游戏商业化」合并用。数值均摘自当前 `game.js`（**以代码为准**）。  
> 基准：本地 SPA 试玩档 · 2026-09-23（Asia/Shanghai）

---

## ① 一句话与卖点

**一句话：** 付租金开仓储柜 → 随机异形掉落 → 塞进格子仓库 → 按货值结算本场盈亏。

**卖点（对齐商业化）：**

| 卖点 | 落地 |
|---|---|
| 开箱爽感 + 装箱脑力 | 四档柜 × 十档品级（白→大红，含粉/炎金）× 默认 5×5 高压装箱 |
| 短局可重复 | 单场约 2–5 分钟；结算特效默认「流畅」，可切「华丽」 |
| 前期友好、中后期上瘾 | 蜜月 5 场 / 现金 ¥3.5 万截止；中场拍卖厅 **18 万 / 28 万 / 40 万** |
| 轻商业化占位 | 广告/IAP 全 stub；试玩默认 `FEATURES.ADS_ENABLED = false` |
| 零构建可分发 | `index.html` + `style.css` + `game.js` + `audio.js`，itch zip 根目录即玩 |

---

## ② 核心循环与系统清单

### 核心循环

`选柜付租 → 开箱揭示 → 暂存拖拽装箱（R 旋转）→ 转卖结算 → 下一场 / 破产`

### 已实装功能与默认开关

| 系统 | 状态 / 默认 |
|---|---|
| 四档货柜 + 硬切割货池 | ✅ 普通 / 精选 / 密封 / 限时豪华 |
| 异形装箱 / 扩容 5→6→7→8 | ✅；现金扩容（永久，分级）`EXPAND_CASH_COSTS` = 6×6 ¥40,000 / 7×7 ¥120,000 / 8×8 ¥300,000（合计 ¥460,000）；IAP 仅支付平台（`IAP_ENABLED`） |
| 蜜月（新手保护） | ✅；`HONEYMOON.ROUNDS = 5` **或** `CASH_END = 35000`（先到先结束） |
| 结算特效 | ✅；默认 **流畅**（`settleFxMode = "smooth"`）；顶栏可切华丽 |
| 完美装箱 | ✅；利用率 ≥85% 或零弃货 → +10% 货值 & 下场租金 −12%（一次） |
| 热手 / 冷手 | ✅；连盈/连亏 3 场特效；冷手软保底（不送大红） |
| 贵货图鉴 Codex | ✅；门槛≈密封租金×0.35（≥¥10,000）；里程碑 5 / 10 / 20 |
| 开箱里程碑 | ✅；5 / 10 / 20 / 35 / 50（另有 75 / 100）；自动发放、无广告翻倍 |
| 高级拍卖厅 | ✅；峰值现金解锁；最高已解锁厅生效 |
| 每日活动 + 大奖 | ✅；`JACKPOT_CHANCE = 0.12`；完成后抽一次 |
| 限时豪华柜 | ✅；现金 ≥¥38,000 可刷；日上限 4（中场 +2 → 6） |
| 鉴宝挑战 | ✅；`FEATURES.CHALLENGE_ENABLED = true` |
| 一键整理 | ✅ stub；**每日免费 1 次**，其后 `$0.99` / 1 钥匙 |
| 清算重整（破产） | ✅；**每日 1 次**；发放 **¥5,850**；无广告 |
| 广告 | 代码保留；Pages/本地 `platform.supportsRewarded()`=false → **ADS 关**；门户可开 |
| 补给 IAP | ✅ stub；`IAP_SHOP_ENABLED` 仅 local；真钱价受 `IAP_ENABLED`（需 `supportsPayments`）闸门 |
| 本地存档 | ✅；正式版键 `deltaStashSave`；测试版前缀 `test_`（同域不串档） |
| 首局引导 | ✅；新档弹 onboarding（选柜→开箱→装箱→结算） |
| 点击解密揭示 | ✅；开箱后逐件点按揭晓（名称/稀有度/价值在解密前隐藏） |
| 正式版 / 测试版 | ✅；根目录正式（`EVAL_ALLOWED=false`，公开源码零评测 DOM/文案）；`/test/` 由 `tools/build-test.js` 注入 |
| 评测档 | ✅ **仅测试版**；`/test/?eval=1`（见⑤）；正式版 `?eval=1` 无效 |
| 金色描边（身份） | ✅；当前厅 ≥ **翡翠** **或** 生涯峰值现金 ≥ **¥250,000**；作用于品牌标与现金 HUD |

---

## ③ 数值表摘要（代码实值）

### 货柜租金（`CRATE_TIERS`）

| 柜 | id | fee | 件数 |
|---|---|---:|---|
| 普通柜 | common | **¥4,500** | 5–7 |
| 精选柜 | rare | **¥13,800** | 5–7 |
| 密封柜 | sealed | **¥30,000** | 5–8 |
| 限时豪华柜 | limited | **¥60,000** | 6–9 |

启动资金：`STARTING_CASH = ¥15,000`。

### 蜜月（`HONEYMOON`）

- 持续：场次 1..5 **或** 现金达 ¥35,000（先触发先结束；`?v=20260925d` 起 ¥45k→¥35k）
- 租金倍率：普通 ×0.70（¥3,150）、精选 ×0.80（¥11,050）；密封/限时 ×1.0
- 价值加成：普通 / 精选 0（`?v=20260925d` 起取消）；件数压到 4–6；屏蔽大红；首开保底紫/小金；蜜月比值约 普通 1.39 / 精选 1.33 / 密封 1.16 / 限时 1.17（见 `docs/sim/results.md`）

### 拍卖厅（`AUCTION_HALL_CFG.TIERS`，峰值现金）

| 厅 | 峰值门槛 | 金红权重 | 租金上浮 |
|---|---:|---:|---:|
| 青铜拍卖厅 | ¥40,000 | **+3%** | 0 |
| 翡翠拍卖厅 | ¥80,000 | **+4%** | 0 |
| **白银拍卖厅（中场）** | **¥180,000** | **+4%** | 0 |
| **铂金拍卖厅（中场）** | **¥280,000** | **+4%** | 0 |
| **赤金拍卖厅** | **¥400,000** | **+4%** | 0 |

`?v=20260925d` 起：租金上浮全部取消，金红翡翠 5%→4%、赤金 8%→4%；各厅比值比无厅高 0～+2.4 个百分点（sim）。

中场密度带 `MIDGAME_CFG`：峰值 ¥20万–¥40万 → 限时日上限 +2、刷新概率 +10%、每日主题追加 `MID_THEMES`（**不改掉率**）。

### 开箱里程碑（`OPEN_MILESTONE_CFG`）

| 累计开箱 | 奖励 |
|---:|---|
| 5 | 现金 ≈0.5× 普通租金 |
| 10 | 普通柜免费券 ×1 |
| 20 | 钥匙碎片 ×1（3 合 1 钥匙） |
| 35 | 精选柜免费券 ×1 |
| 50 | 限时豪华柜刷新 |
| 75 / 100 | 碎片 ×2 / 限时刷新 |

### 完美装箱（`PERFECT_PACK`）

- 触发：利用率 ≥ **0.85** 或本场零弃货
- 结算加成：**+10%** 已装货值
- 下场折扣券：**−12%** 租金（一次）

### 每日大奖

- `DAILY_ACTIVITY_CFG.JACKPOT_CHANCE = **0.12**`（商业带 8%–15%）
- 全屏红光可跳过 ≈2.5s；不出大红；无广告依赖

### 破产重整（`RESTRUCTURE`）

- `CASH = round(4500 × 1.3) = **¥5,850**`
- `DAILY_MAX = 1`

### 其它

- 软保底阈值 `PITY_THRESHOLD = 3`
- 一键整理免费配额 `ORGANIZE_DAILY_FREE_QUOTA = 1`
- 图鉴里程碑：收录 5 / 10 / 20
- 峰值里程碑：20万 / 25万 / 30万 / 35万 / 40万（券/碎片/津贴，不改掉率）

---


### 物品表摘要

- 掉落物定义约 **129** 条（`game.js` 物品表）；按柜 `allowed` 稀有度硬切割。
- 品级：白 / 绿 / 蓝 / 紫 / 粉 / 小金 / 大金 / 炎金 / 小红 / 大红。

### 广告与评测（显式）

- **`FEATURES.ADS_ENABLED = false`**（默认关；评测档内亦强制关）。
- 评测：`?eval=1` 或顶栏「评测」→ 可见蜜月状态、结算特效切换、**清档**；顶栏「新开档」同样 wipe 本地存档（`deltaStashSave`）。
- 结算旁「报 bug」复制诊断 JSON（含 FEATURES / 厅 / 蜜月 / `__monetizationLog` 尾部）。

## ④ 变现

### Feature flags（`FEATURES`）

```js
EVAL_ALLOWED: false          // 正式版关死；/test/ 生成时改 true
BUILD_ENV: "public"          // /test/ → "test"（埋点 build/econ/env）
ADS_ENABLED: platform.supportsRewarded()  // Pages/本地 false；门户可 true
CHALLENGE_ENABLED: true
IAP_SHOP_ENABLED: local only // 门户不露假购买
IAP_ENABLED: platform.supportsPayments()  // 无支付平台则永不显示 $ 价
KEYS_ENABLED: true
ORGANIZE_STUB_ENABLED: local only
ANALYTICS_ENABLED: true      // ENDPOINT 空＝只写本机队列
```

Pages 试玩广告默认关；门户翻 `supportsRewarded` 即可恢复广告芯片 / 日 cap UI，无需删代码。

### 广告位 id（`AD_PLACEMENTS`，stub）

| Key | placement id | 日类别（cap） |
|---|---|---|
| FREE_RENT | `ad_free_rent` | free_rent（2） |
| REVEAL_NEXT | `ad_reveal_next` | **禁用**（不打断揭示） |
| WAREHOUSE_TEMP | `ad_warehouse_temp` | warehouse_full（2，与 keep 合计） |
| KEEP_STAGING | `ad_keep_staging` | warehouse_full |
| SETTLE_REFUND | `ad_settle_refund` | settle_refund（2） |
| LIMITED_EARLY | `ad_limited_early` | limited_refresh（另计 1/日） |
| CHALLENGE_RETRY | `ad_challenge_retry` | challenge_retry（2） |

总日 cap：`AD_DAILY_CAP = 8`（四类合计）+ 限时刷新另 1。

### IAP SKU stubs（`IAP_SKUS`）

| id | 名 | 价 |
|---|---|---|
| `iap_keys_3` | 钥匙 ×3 | $0.99 |
| `iap_keys_10` | 钥匙 ×10 | $2.99 |
| `iap_warehouse_6` | 仓库 → 6×6 | $1.99 |
| `iap_warehouse_7` | 仓库 → 7×7 | $2.99 |
| `iap_warehouse_8` | 仓库 → 8×8 | $4.99 |
| `iap_rare_unit` | 稀有柜券 | $2.99 |
| `iap_speed_organize` | 一键整理 | $0.99 |
| `iap_protect_once` | 单次贵货保级 | $1.99 |

### 埋点

- `window.__monetizationLog`：环形数组（≤200）；经 `logMono(type, placementId, extra)` 写入
- `?mono=1` 或 localStorage `deltaStashMonoDebug=1`：页内 mono 调试条
- 匿名玩法统计（`?v=20260925i` 起；`?v=20260926g` 起开柜/结算带 `loot_ids` / `sold_ids` / `dropped_ids`）：`track(ev, fields)` → localStorage `deltaStashAnalyticsQueue`（≤200 条）+ `window.__analyticsLog`（≤300）。`ANALYTICS.ENDPOINT` 留空＝不发网络请求；`econ=econ-0925h`；评测档每条 `eval=1`；帮助页「参与匿名统计」关掉（`deltaStashAnalyticsOff=1`）后不记录。方案 / 清单：`docs/埋点方案.md`、`docs/埋点接入清单.md`；接收端：`tools/analytics/`。

---

## ⑤ 上线与评测

### 本地打开

```bash
cd /workspace/delta-stash-game
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765/
```

或直接打开 `index.html`（部分浏览器限制 `file://` 下 localStorage，建议用 http）。

### 发版清单（每次发版必做）

- 每次发版：`?v=` ×4（`index.html` 里 style.css / platform.js / audio.js / game.js）+ 根目录 `version.json` + `game.js` 的 `BUILD_VERSION` 一起改成同一个版本号，然后 `npm test`（`tests/version_check.test.js` 会校验三处一致，不一致就挂）。
- **正式版 + 测试版同版本、一次推送（20260926d 起；20260926e 起公开源码零评测痕迹）**：根目录是正式版（`FEATURES.EVAL_ALLOWED = false`，`BUILD_ENV="public"`；`?eval=1` / `?ball` / `?soft` / `?mono=1` 无效）。**评测面板 DOM、⋯ 菜单「评测/数据」、mono 调试条、以及 `EVAL_STR` 文案不在公开源码里**——只在 `node tools/build-test.js` 生成 `/test/` 时从 `tools/test-only/eval-markup.html` + `eval-strings.json` 注入。`/test/` 另改 `EVAL_ALLOWED=true`、`BUILD_ENV="test"`、storage 键前缀 `test_`、标题 `[测试版]` + 右下角小标签。**只改根目录文件，不手改 `test/`。**
- 发版流程（每次都按顺序）：①改版本号（4 个 `?v=` + `version.json` + `BUILD_VERSION`）→ ②`node tools/build-test.js` 重新生成 `test/` → ③`npm install && npm test`（含 `node tools/build-test.js --check`：`test/` 与生成结果不一致就挂；另校验正式版 eval 全关、测试版 `?eval=1` 才有评测）→ ④删掉 `package-lock.json`（不提交）→ ⑤`git pull --rebase` 后**只推一次**（后一次推送会顶掉前一次的 Pages build，两次之间隔 3 分钟以上）→ ⑥确认 Pages build `built`，用 cache-buster curl **两个**地址的 `version.json`：`https://gosuquan.github.io/delta-stash-game/version.json` 和 `https://gosuquan.github.io/delta-stash-game/test/version.json`，都必须是新版本号 → ⑦无头浏览器过一遍线上（正式版 `?eval=1` 无评测控件、`/test/?eval=1` 有）。
- 推 main 后确认 Pages build `built`，再用 cache-buster curl 线上 `index.html`（4 个 `?v=`）和 `version.json`。
- 跑着 `20260925d` 及以后版本的老标签页，会在下一场结算后提示「有更新，刷新后继续」（c 及更早的标签页没有这段代码，不会提示）（不会自动刷新；开箱 / 揭示 / 装箱中不提示），点「刷新」先存档再刷新。

### itch 打包

根目录必须是可玩入口（**不要**再包一层文件夹）。打包用**根目录（正式版）**文件，**不要**把 `test/` 打进去（测试版带评测面板）：

```bash
cd /workspace/delta-stash-game
zip -r ../delta-stash-game-itch.zip index.html style.css game.js audio.js platform.js version.json \
  favicon.svg favicon-32.png favicon.ico apple-touch-icon.png
```
（或用已打好的 `/workspace/itch-assets/dist/stash-auction-itch-20260926g.zip`，由少权自行上传 itch.io。）

itch 选择 “This file will be played in the browser”，确保 zip 顶层可见 `index.html`。

### 评测档（已实装；20260926d 起只存在于测试版）

> 正式版（根目录 / itch / CrazyGames）没有评测档：`FEATURES.EVAL_ALLOWED=false`，评测 / 数据按钮和面板直接从 DOM 删掉，`?eval=1` `?ball` `?soft` `?mono=1` 无效，旧 `localStorage.deltaStashEval` 不再生效（启动时删掉并把存档标 `evalTainted`）。评测请用测试版 **https://gosuquan.github.io/delta-stash-game/test/?eval=1**（存档独立，埋点 `build` 带 `-test`、`econ=test`、`env=test`）。

| 入口 | 行为 |
|---|---|
| 测试版 URL `?eval=1` | 进入评测档（只认 URL，不再持久到 localStorage） |
| 顶栏 ⋯ →「评测面板」 | 仅 `?eval=1` 会话里有，开关面板 |
| 评测档内 | **强制广告关**；展示蜜月状态；结算特效切换常显；**清档**；简易**数据**面板（开箱数 / 现金 / 拍卖厅 / 每日任务） |
| 结算旁「报 bug」 | 复制诊断 JSON（现金、场次、厅、蜜月、特效、FEATURES、近期 `__monetizationLog`） |

清档亦可用顶栏「新开档」（`newSaveConfirm` → 清除 `deltaStashSave`）。


### itch 一句话卖点（可直接贴商店页）

> **中文：** 租下神秘仓储柜，开出异形稀有货，塞进格子仓库再转卖——有赚有亏，越装越上头。免费可玩。  
> **English:** Rent mystery storage units, unpack odd-shaped loot, tetris-pack your warehouse, and flip for profit (or loss). Free to play.

### 评测 6 问（请评测玩家书面回答）

1. 开局约 10 分钟爽不爽？新手保护（蜜月）结束后会不会突然太亏？
2. 装箱挤不挤？一键整理有没有用？
3. 普通 / 精选 / 密封（及限时）柜差异有没有体感？
4. 贵货守住题烦不烦？（题型、时长）
5. 结算默认「流畅」还卡吗？开「华丽」对比如何？
6. 大概玩到多少资金还想继续？（是否在 ~30 万附近仍有目标）

### 文件地图

| 路径 | 说明 |
|---|---|
| `index.html` | 壳 + UI |
| `style.css` | 样式 / 厅换肤 / 评测面板 |
| `game.js` | 玩法 · 经济 · 商业化 stub · 评测档 |
| `audio.js` | Web Audio |
| `favicon.svg` / `favicon-32.png` / `favicon.ico` / `apple-touch-icon.png` | 站点图标（`?v=20260926g` 起） |
| `docs/技术方案.md` | 早期设计稿（数值可能过时，**以 game.js 为准**） |
| `docs/HANDOFF.md` | 本交接 |

---

## 合并备注（给商业化）

0. **密封柜 ¥30,000 / 限时豪华柜 ¥60,000 以代码为准**；群内旧口头租金作废。**厅租金上浮已全部为 0**（`rentMarkupPct: 0`，自 `?v=20260925d`）；勿再按旧 +5%～+16% 口径加码。金红权重见 ③。


1. 改变现只动 `FEATURES` / `AD_*` / `IAP_SKUS`，不要改蜜月与厅阶梯 unless 重平衡。  
2. 中场厅 **¥18万 / ¥28万 / ¥40万** 已在代码；若帮助文案仍写旧阈值请同步。  
3. 真实 SDK 接入点：激励广告 stub、`stubPurchase`、`logMono` / `window.__monetizationLog`。  
4. 评测请用 `?eval=1`，用「报 bug」出诊断 JSON 贴 issue。

---

## ⑩ 冲刺日志（每 2 小时刷新）

> 最近更新：2026-10-02 15:57 Asia/Shanghai · 负责人：游戏grok · 线上 `version.json` = **20260926g**（Pages 正式版 + `/test/` 均已确认）

### 本轮已交付
- **点选锚点 + 旋转即时存档 + favicon + 埋点货清单（`?v=20260926g`，`d55a192`）**：**数值 / 广告 / 内购未动。**
  - 点选放置：以 footprint **图标锚点格**（包围盒中心最近已占格）对准点击格，不再用包围盒左上角（异形空左上角时不再抢偏）。
  - 旋转（R / 旋转按钮）后立刻 `saveGame()`，避免刷新丢朝向。
  - 站点 favicon：`favicon.svg` / `favicon-32.png` / `favicon.ico` / `apple-touch-icon.png`（正式版与 `/test/` 同步）。
  - 埋点：`crate_open` / `round_settle` 增加 `loot_ids` / `sold_ids` / `dropped_ids`（`def_id:count` 串；开柜时记下 loot，结算复用同一串）。配套 `docs/埋点*.md` v0.3、`tools/analytics/queries.sql` Q11–Q13。
  - 十字掉落分析文档入仓：`docs/sim/十字掉落概率分析.md`、`docs/sim/cross-drop/`（MC + 解析验证；**未改掉落数值**）。
  - 新增 `tests/g_fixes.test.js`；`npm test` 现含 `f_fixes` + `g_fixes`（共 11 套 + `build-test --check`）。
  - itch zip：`/workspace/itch-assets/dist/stash-auction-itch-20260926g.zip`（约 157 KB）已备好，**等测试员 g 结论后由少权自行上传 itch.io**。
- **旋转 90° 修复 + 欢迎名 + 厅提示 + aria-label（`?v=20260926f`，`b3680fa`）**：**数值未动。** 旋转按钮 `pointerdown`+`click` 双触发导致一次点 180°——改为每次恰好 90°；欢迎弹窗公开名 **STASH AUCTION**；拍卖厅提示随状态重算（修过期「距青铜还差…」）；顶栏图标按钮补齐 `aria-label`（图鉴等）；公开文案去掉 Delta 测试字样。新增 `tests/f_fixes.test.js`。
- **公开版零 eval 痕迹（`?v=20260926e`，`2b2d43c`）**：**数值 / 广告 / 内购未动。** 在 d 的正式版/测试版拆分之上，把评测面板标记、⋯ 菜单评测项、mono 调试条、以及 `EVAL_STR` 文案全部移出公开源码；只在 `tools/build-test.js` 生成 `/test/` 时从 `tools/test-only/eval-markup.html` + `eval-strings.json` 注入。`npm test` 含 `build-test --check` + `launch_j`：正式版源码与线上根目录无「评测」字样，`/test/?eval=1` 才有评测控件。
- **首局引导 + 点击解密揭示（`d726780` / `b9a9d7f`，随 20260926c+ 已在线上）**：新档 onboarding 弹层；开箱后逐件点按揭晓（解密前不露名称/稀有度/价值）。
- **上线前一轮（`?v=20260926d`，正式版 + 测试版同版本一次推送）**：**数值没动，广告 / 内购保持关闭。**
  - 修「异形物件放进仓库后图标消失、拖不动」：根因是图标和拖拽把手只画在包围盒左上角 (0,0) 那一格，而 J / S / plus / cross 本身以及旋转后的 L / L2 / T / Z / skew / stair / hook / corner / bigL 的 (0,0) 是**空格**。现在图标放在「最靠近包围盒中心的已占格」，每个已占格都是把手。物件一直在 `placed` 里，结算按 `placed` 算，没丢；只有「拖到半空时存档 / 结算」会丢——已修（拖拽中的物件按原位置进存档，结算前先取消拖拽）。迷你形状改成单一形状源（卡片 / 拖影 / 落位高亮 / 占格同一份，含旋转）。
  - 转运仓库格子线所有布局都画（原来手机空仓像一块黑板）；全局 `[hidden]{display:none !important}`，修拍卖厅提示卡在「距青铜还差 ¥25,000」；触屏 touchmove 改一个常驻非被动监听、仅 `cancelable` 时 `preventDefault`，网格空闲时不再 `touch-action:none`（消除 Console 警告）。
  - 结算前自检：状态里的物件数 vs 网格 DOM 里的图标数，不一致就发 `ui_anomaly`（物件 id / shape / rotated / 屏宽）并重绘自愈，结算永远按状态算。
  - 评测污染：启动时发现旧 `deltaStashEval` 就删掉并给存档永久标 `evalTainted:true`（破产重整保留，只有新开档清零）；带 `?eval=1` 玩过的存档也标；不回收现金 / 尺寸。埋点公共字段加 `eval_tainted: 1|0`（与 `tools/analytics/client-snippet.js` 一致）。
  - 正式版 / 测试版拆分 + 顶栏收纳（⋯ 菜单：新开档 / 清档；正式版没有评测 / 数据）见 ⑤ 发版流程。新增测试：`ui_shapes`（全部 24 种形状 × 4 个朝向放入 / 拖出 / 存档重载）、`launch_j`（格子必渲染、厅提示、触屏、破产保留尺寸、评测污染、正式版评测全关、测试版同步）、`header_menu`；`tools/ui_drag_check.js` 是浏览器端全量拖拽扫描（不进 `npm test`；本版实测 129 件 × 2 朝向 × 鼠标 / 触屏 = 516 例，0 失败）。
- **匿名玩法统计接入（`?v=20260925i`）**：按 `docs/埋点接入清单.md` 接入 12 个事件（开柜 / 结算 / 守住挑战 / 破产 / 重整 / 新开档 / 拍卖厅解锁 / 峰值节点 / 扩容 / 整理 / 会话开始与结束），公共字段带 `econ=econ-0925h`、`save`、`eval`。`ENDPOINT` 暂时留空，事件只存进本机 localStorage 队列（最多 200 条），不发任何网络请求。评测档照常记录，每条带 `eval=1`。免费券开柜记 `rent_paid=0`、`discount=free_token`，方便从比值里排除。扩容只在「扩容」键现金扣款成功后记一次（`via=cash`），评测档下拉切尺寸不记。帮助页新增说明和「参与匿名统计」开关（默认开，关掉后清空队列、不再记录）。**数值未改动。** 新增 `tests/analytics.test.js`（g 起覆盖 `loot_ids`/`sold_ids`/`dropped_ids`）。
- **扩容改分级永久现金价（`?v=20260925h`）**：游戏商业化反馈原来固定 ¥6,000 / 级太便宜（5→8 共 ¥18,000）。改为 5→6 **¥40,000**、6→7 **¥120,000**、7→8 **¥300,000**，永久拥有（存档新增 `ownedGridMax`，老档已扩的尺寸保留）。现金不够时扩容键显示价格并置灰，悬停提示还差多少，不会出现真钱价。确认时会再核一次现金，绝不扣成负数。顶栏「仓库」下拉原来能免费直接选 8×8，是个绕过扣费的漏洞：现在非评测只能选已拥有的尺寸（未拥有的带 🔒），评测档可自由切换，退出评测后回到已拥有尺寸；切回已拥有的更大尺寸免费。帮助说明和评测面板都列了三档价格。新增 `tests/expand_cost.test.js`（三档精确扣费、现金不足不扣、不为负、下拉锁、存档永久、老档兼容）。
- **手机格子放大 + 触屏拖拽抬高 + 试玩版去真钱价（`?v=20260925g`，`d13693b`）**：
  - 手机 / 平板格子：原因是移动端样式里 `--cell-size` 的 clamp 带 `!important`，压过了 JS 算出的尺寸（手机一直 26–34px）。现在 JS 用 important 统一接管所有布局，网格面板吃满剩余高度（ResizeObserver + 横竖屏切换）。实测装箱中 5×5：390×844 **34→64** · 360×780 33→64 · 375×667 64 · 414×896 64 · 340×620 28.5→54 · 800×1000 64 · 1366×768 64（不变）；8×8：360×780 41 · 390×844 45 · 1366×768 64。手机页面无滚动，结算键和评测面板都能点到。
  - 触屏拖拽（少权真机：「手指会挡住移动的物体」）：只对 touch / pen 生效，鼠标完全不变。拖影上移到手指上方约 28px，放大 1.05 倍、加投影、不透明，并有手指圆点和连线；落点改按拖影左上格计算（所见即所落），落位格用醒目的绿 / 红填充加描边，画在网格最上层。拖动中可旋转，点选放置照旧。模拟 390×844 真触摸：落位和高亮格完全一致，放不下时不落位。
  - 去真钱价（游戏商业化）：新增 `FEATURES.IAP_ENABLED`，只有支付平台才为 true，Pages / 本地为 false。一键整理顺序为「今日免费 → 🔑×1（耗 1 把钥匙）→ 明日免费（置灰）」，不再显示 $0.99。保级按钮只在有保级券时出现；「补给」商店隐藏；扩容直接花现金；帮助 / 提示 / 标题里不再出现 $ / 内购字样。实现是 `body.iap-off` 闸门，放在样式表末尾。新增 `tests/iap_off.test.js`。
- **PC 缩小一档（`?v=20260925f`，`44f958a`）**：少权反馈 e 版「PC端的有点太大了」。桌面（≥961px）格子上限 120→**64px**（5×5 ≈ 322px；8×8 空间不够时照旧缩小，始终完整无滚动条）；整体 `max-width` 1640→**1280px** 居中；中间「转运仓库」面板改为贴合内容（工具行 + 网格）并垂直居中，不再是大空框；面板内边距 12→10、标题 / 顶栏数字 / 品牌字号略缩，暂存卡上限 112px。格子尺寸计算改为按中栏宽 + 到 `.main-layout` 底部的高度（不读网格自身高度，无反馈循环），并在顶栏收起时重算。
- **PC 布局重排 + 关广告即隐藏（`?v=20260925e`，`fac1a83`）**：桌面三栏；关广告（`FEATURES.ADS_ENABLED=false`，Pages 默认）时所有广告位不渲染；`tests/ads_off.test.js`。
- **经济重调上线 + 版本提示（`?v=20260925d`）**：蜜月 CASH_END ¥35k；厅租金上浮全 0；`version.json` 结算后更新提示。详见历史条目与 `docs/sim/results.md`。
- **空柜退租二修 + 开箱里程碑回归测试**（`6d72e10`，`?v=20260925c`）：结算单一退租点 `applyEmptyRoundRefund()`；`tests/crate_milestones.test.js`。
- **既有交付仍有效**：Pages https://gosuquan.github.io/delta-stash-game/ 、门户 `platform.js`、精选 `fee=13800` / 蜜月 UI ¥11,050、开箱灰保护、窄屏 staging、跟随球鉴宝、华丽可跳过、空间紧张（≥0.6）。
- **数值核对（以 `game.js` 为准）**：启动 ¥15,000；柜租 4500 / **13800** / 30000 / 60000；蜜月 ROUNDS=5 · CASH_END=35000 · FEE_MULT 0.70/0.80；厅峰 4万/8万/**18万/28万/40万**（租金上浮全 0，金红 +3%/+4%/+4%/+4%/+4%）；`BUILD_VERSION=20260926g`；物品表 **129**；`JACKPOT_CHANCE=0.12`；重整 ¥5,850；`ORGANIZE_DAILY_FREE_QUOTA=1`；`FEATURES.ADS_ENABLED` 随 `platform.supportsRewarded()`（Pages 免广告）。
### 进行中
- 游戏侧：线上停在 **20260926g**；专属厅柜批次 1 在分支 `origin/hall-crates-b1`（`9f0db02`：杂货柜 / 夜班柜 / 双联柜 + 每日次数 + 「更多柜子」+ 评测重置今日次数），**未合 main、未上线**——等模拟表进群 + 游戏商业化放行（见 ⑪）。
- itch.io：g 包已打好，**等测试员对 g 的结论**后由少权上传（本 agent 不代传）。
- 上架截图：须用**正式版**公开页（无测试黄标 / 无评测字样），新档或约 ¥8 万存档。
- 阻塞：本机 Windows / Mac 副本若 offline，不影响本仓 GitHub 文档推送。

### 下一里程碑（商业化已立项）
- 专属厅柜批次 1（青铜杂货 / 翡翠夜班 / 白银双联）模拟放行 → 合 main → 实测闭环 → 批次 2（铂金古董 / 赤金命运）
- itch.io 免费评测包上传（测试员 g 通过后；百万以后不加爆率，路线图见 ⑪）
- 顶栏 `aria-label` **已在 f 落地**（不再单独立项）

### 测试请验
1. **g 点选锚点 / 旋转存档（`?v=20260926g`）**：点选放置异形（尤其 J/S/plus/cross）时图标格对准点击格；旋转后强刷，朝向应保留。正式版 https://gosuquan.github.io/delta-stash-game/ 与测试版 `/test/` 均为 `20260926g`。
2. **f 旋转按钮 / 厅提示 / aria（`?v=20260926f` 起）**：旋转按钮每次点击恰好 90°（非 180°）；厅提示随解锁状态更新；顶栏图标按钮有 `aria-label`。
3. **正式版 / 测试版隔离**：正式版强刷后页面与源码均无「评测」；`?eval=1` 无评测控件。测试版 `/test/?eval=1` 有评测面板 / 数据；存档与正式版互不串。
4. **异形拖拽（d 起）**：J / S / plus / cross 及旋转后的 L/T/Z 等放入仓库后图标可见、可再拖出；结算货值按 `placed` 不错账。
5. **限时空柜 / 退租**：在测试版强刷后用里程碑 20/35 × 有无折扣复测（正式版无评测重置次数时可跨日）；0 件须全额退实付租金。
6. （可选）本地 `npm install && npm test` 应全绿（11 套：`crate_milestones` / `version_check` / `ads_off` / `iap_off` / `expand_cost` / `analytics` / `ui_shapes` / `launch_j` / `header_menu` / `f_fixes` / `g_fixes` + `build-test --check`）。


## ⑪ 商业化验收日志（每 2 小时迭代）

> 最近更新：2026-09-25 16:00 Asia/Shanghai · 负责人：游戏商业化 · 完整方案见 `docs/商业化方案.md`

### 线上
- GitHub Pages 免广告试玩版：https://gosuquan.github.io/delta-stash-game/ ，当前 `?v=20260925f`，`g` 版待发
- 商业化验收：✅ 可对外试玩；广告保持关；试玩版不显示任何真实价格

### 验收结论
| 项 | 状态 | 说明 |
|---|---|---|
| 开箱灰阻塞 / 蜜月 / 窄屏 | ✅ 已收 | |
| 空间紧张（低占用不误报、高占用该弹） | ✅ 已收 | 本场货物占剩余格 ≥60% 提示 |
| 柜子档位差异 | ✅ 数值已重调上线（`d`） | 模拟四柜全达标；真人稳健局到 8 万待测 |
| 空柜 bug | ✅ 已修（`c`） | 结算时 0 件全额退租；里程碑 × 柜型 × 折扣自动测试；第 20 场失败为旧版 a 标签页未刷新；第 35 次里程碑真机复测待补 |
| 华丽 vs 流畅 | ✅ 已收 | 默认流畅，华丽可点屏 / Esc / 空格跳过 |
| 版本更新提示 | ✅ 已上线（`d`） | 结算后读 `version.json`，开柜中不弹 |
| 广告位隐藏 | ✅ 已收（`e`） | 广告关时全部整块隐藏，自动测试查「广告」字样 |
| 试玩版去掉美元价格 | 🔄 `g` 版 | 整理按钮：今日免费 / 🔧×1 / 明日免费置灰 |
| 贵货自然触发守住 | ⏳ 未测 | 等新数值下踩 |
| 冲资金到 ~30 万 | ⏳ 未测 | |
| 拍卖厅专属柜 | 🔄 开发中 | 第一批青铜 / 翡翠 / 白银，见下 |

### 今日经济决策
- 不涨租金，只调货池权重，同一件货全局一个价
- 目标（货值 ÷ 实付租金 / 赚钱概率，蜜月后、鉴宝 70%）：普通 1.08–1.15 / 50–60%；精选 1.00–1.08 / 40–50%；密封 1.02–1.12 / 30–40%；限时 1.05–1.15 / 25–35%
- 模拟结果（`d` 版）：普通 1.125 / 54%，精选 1.06 / 45%，密封 1.07 / 37%，限时 1.11 / 33%
- 蜜月：普通 1.30–1.45、精选 1.25–1.40、密封和限时 1.10–1.20；现金上限 ¥35k，最多 5 场；普通柜蜜月租金 ¥3,150（0.70 倍）
- 拍卖厅不加租金，金红加成让每厅比无厅高 0–3 个百分点
- 节奏按稳健档（只开租金 ≤ 现金 40% 的柜子）考核：到 8 万 35–50 场（模拟 39），到 30 万 100–150 场（模拟 110），第 16 场后破产率 <15%（模拟 0%）

### 拍卖厅专属柜（2026-09-25 15:55 定）
| 厅 | 柜子 | 租金 | 每天 | 出货 | 目标比值 / 赚钱概率 |
|---|---|---|---|---|---|
| 青铜 | 杂货柜 | ¥9,000 | 5 | 8–10 件小件，白到紫 | 1.08–1.14 / 50–60% |
| 翡翠 | 夜班柜 | ¥21,000 | 4 | 3–4 件，密封池去掉最低两档 | 1.05–1.12 / 35–40% |
| 白银 | 双联柜 | ¥27,600 | 3 | 两份精选池 10–14 件，同一仓库 | 贪心 1.00–1.06，满仓约 1.12 / 40–50% |
| 铂金 | 古董柜 | ¥90,000 | 2 | 2–3 件大件，金色起步，每件都守住 | 1.05–1.12 / 25–30% |
| 赤金 | 命运柜 | ¥120,000 | 2 | 10% 横财约 4 倍、15% 大亏约 0.2 倍、75% 正常 | 1.00–1.10 / 30–35% |
- 四个通用柜所有厅保留；专属柜按峰值现金永久解锁；列表只展示当前厅和下一档厅，其余收进「更多柜子」
- 拍卖厅金红加成不作用于专属柜；专属柜每日次数各自独立
- 验收：五柜各自达标；稳健档加专属柜后到 30 万仍 100–150 场、第 16 场后破产率 <15%
- 上线：第一批青铜 / 翡翠 / 白银 → 实测闭环 → 第二批铂金 / 赤金；每批模拟表经商业化放行才推线上
- 闭环：测试员每柜至少 5 场（评测模式可重置当日次数），记租金、件数、丢弃、货值、净额；「会不会主动选它」「一场就能感觉出区别」两问都为是

### 路线图（专属柜之后）
1. 百万以后：专属皮肤、声望段位、每周契约
2. 竞速模式
- 暂缓：盲拍、主题契约、主题季、极限仓、幸运时段、赛季榜
- 原则：百万以后给新目标和更难玩法，不加爆率

### 下一步
- 专属柜两批验收闭环后，上架 itch.io 免费评测包（之前卡在登录 / Cloudflare 验证，需要少权协助登录）

---


## ⑫ 试玩日志（测试玩家 · 每 ~25 分钟）

> 最近更新：2026-10-02 16:38 Asia/Shanghai · 负责人：游戏测试玩家  
> 当前线上版本：`version.json` = **20260926g**（本轮 curl：正式版 + `/test/` 均为 `20260926g`；`favicon.svg` / `favicon.ico` HTTP 200）  
> 截图：`docs/playtest-shots/line1-retest2/`、`docs/playtest-shots/line-followball/`、`docs/playtest-shots/line3-narrow/`（含 `v2-*.png`）、`docs/playtest-shots/line2-mid/`、`docs/playtest-shots/line2-verify-0925/`、`docs/playtest-shots/line2-tight-bc4f/`、`docs/playtest-shots/line2-tight-online/`、`docs/playtest-shots/line4-tiers/`、`docs/playtest-shots/line5-fx/`、`docs/playtest-shots/line6-limited-fix/`（含 `08-console-v-c.png`）、`docs/playtest-shots/line7-g-mobile/`、`docs/playtest-shots/launch-j/`（~13:05–13:06）、`docs/playtest-shots/line8-d/`（~13:15–14:04）、`docs/playtest-shots/line9-f/`（~14:20–15:02）、`docs/playtest-shots/line10-g/`（~15:58）（本机 gitignore，勿提交 PNG）  
> 自动化对照日志（本机，未入库）：`/workspace/g-verify/live2.txt`（g 四项 · 15:47 · **106 passed / 0 failed**）；`/workspace/cross-check/results.json`（f 十字种档 · 对 `20260926f` · **96/96 ok**）

### 已测线路
| 线路 | 状态 | 备注 |
|---|---|---|
| 开箱灰阻塞复验 | ✅ | 清档后普通柜可开、可装箱结算 |
| 蜜月 5 场 / ¥45k 重跑 | ✅ 偏过 | 已能自然结束蜜月进青铜/翡翠侧 |
| 柜差（普通→精选→密封→限时） | ✅ 本轮已推 | line4-tiers 线上踩完：租金台阶体感清晰（普通均租≈¥4k / 精选≈¥13k / 密封≈¥31k / 限时¥60k 档）；密封起开始赌；截图 `01-common-settle`…`05-worst` |
| 贵货鉴宝 / 跟随球 | 🔄 部分 | 强制跟随球下已打到高命中结算；自然经济触发仍弱 |
| 窄屏装箱沉浸（line3） | ✅ 复验通过（v2） | 暂存可见可点、货卡可拖、评测可再开 |
| 中盘翡翠厅续玩（line2-mid） | ✅ 本轮已推 | 场次约 20、现金约 ¥10.1万（含评测加钱）；更正：非纯自然节奏 |
| ⑩「测试请验」复验（line2-verify-0925） | ✅ 本轮已推 | 精选蜜月 UI ¥11,050；0% 占用无「空间紧张」误报 |
| 「空间紧张」bc4f 本地补踩（line2-tight-bc4f） | ⚠️ 作废 | 本地旧 `game.js` 缓存；以线上为准 |
| 「空间紧张」线上 Pages 复踩（line2-tight-online） | ✅ 通过 | ≥约 15 格弹、较小不弹；`aee6a72` 版本号防缓存 |
| 结算华丽 vs 流畅（line5-fx） | ✅ 本轮已推 | 流畅≈0.2s 无回放；华丽≈1.8s 有高光回放、无卡顿、刷新后记住模式；建议保留流畅默认 |
| 限时空柜复验（line6-limited-fix · b→c 已确认 / 现 g 待踩） | 🔄 待复测 | b 上第20次里程碑空箱未退租✗已证；**14:13 Console 确认 Pages 曾跑 `?v=20260925c`**（`08-console-v-c.png`）；保留档场次24·现金¥168,397·白银厅·下一柜−12%，但「今日限时次数已用完」；里程碑35/20 空柜复测**尚未开踩**；现线上已是 **`?v=20260926g`**，line7–line10 截图**未见**限时里程碑空柜/退租场面，仍待强刷复测 |
| g 版手机布局 / 去美元价 / 扩容锁（line7-g-mobile） | ✅ 本轮已推 | 390/360 装箱网格铺满；拖影可见浮于格上；一键整理无 `$`；扩容 6×6 ¥40,000 / 7×7 ¥120,000 / 8×8 ¥300,000；现金购 6×6 后刷新仍 6×6；非评测下拉未拥有尺寸带 🔒；新档蜜月普通¥3,150 / 精选¥11,050；截图时 Console 曾见 `?v=20260925g`（手机段）与 `?v=20260925i`（下拉锁段） |
| launch_j 对照截图（launch-j · ~13:06） | ✅ 本轮已推（对照 d 请验） | 正式版/测试版各有 fresh·header(360/390/412)·more-menu·broken-items-in-grid·card-vs-highlight；测试版另有 `test-eval*.png` / `test-eval-more-menu-390`（⋯ 含「评测面板」）；正式版顶栏未见评测入口（`public-header-*`）。文件名示意测格子渲染/卡片vs高亮；**是否完全无残影待肉眼细读** |
| 正式/测试拆分 + 顶栏 + 异形 L（line8-d · d→e） | ✅ 本轮已推 | Console：`A1-public-e-console` / `A1-old-save-e-console` 正式版 `game.js?v=20260926e` 且 `?eval=1` 无评测控件；`B-version-e-console` 测试版标题 `[测试版]` + `?v=20260926e`；`B3-analytics-e-console` 埋点 `build=20260926e-test`。`C-topbar-{360,390,412}`（及 `*-nomenu`）顶栏收纳；`C-shape-L` / `C-shape-L-incognito` L 形物件在格内可见图标（对照 d 异形修复）。老档续玩见场次34·白银厅（`A1-old-save-e`） |
| f 版欢迎名 / 旋转90° / 厅提示 / plus·十字（line9-f） | ✅ 本轮已推 | 欢迎 **STASH AUCTION**（`A1-public-welcome`）；旋转连点 +90° 有 `/workspace/cross-check` 对 f 全绿（含 post-place ↻×4）支撑，15:34 交接放行；厅提示：新档见「距离青铜还差 ¥25,000」（`A4-test-fresh-initial`），加钱至 ¥65,000 见「距离翡翠还差 ¥15,000」（`A4-test-after-plus50k-hint`），再至 ¥115,000 进翡翠后提示消失（`A4-test-after-plus100k-hint-hidden`）；plus 触屏装箱（`B-plus-*`）；十字自然游玩截图场次23 / 重置场次6 暂存未见十字（`B-cross-22rounds-no-cross` / `B-cross-fresh-reset-6`），种档补验见 cross-check **96/96** |
| g 四项复核（line10-g · `?v=20260926g`） | ✅ 本轮已推 | 真机截图：桌面/390 点选落在已占格对照（`occupied-desktop-blocked` / `occupied-390-touch-blocked`）。自动化：`/workspace/g-verify/live2.txt` 正式+测试 × 桌面+390 **106 passed / 0 failed**——覆盖 favicon 200、旋转×4 即时写入存档 `[1,2,3,0]`、点选落点被占/锚点格、以及 `__analyticsLog` 的 `crate_open.loot_ids` / `round_settle.loot_ids` / `sold_ids` / `dropped_ids`（`物品id:数量`，build=`20260926g` / `20260926g-test`）。本轮 curl favicon 亦 200 |
| 冲资金 ~30 万 | ⏳ 未闭环 | line7 续玩档约 ¥17.8万；`line9-f/B-plus-390-touch` 测试版画面现金约 ¥30万+ / 铂金厅（评测/测试口径，**非**稳健档自然冲刺证据） |
| 专属厅柜批次1（青铜杂货 / 翡翠夜班 / 白银双联） | ⏳ 未开踩 | 新截图柜列表仍为普通/精选/密封（±限时）；未见专属柜 UI（⑩ 记 `hall-crates-b1` 未合 main） |

### 评测 6 问进度
1–3 可写：开局/装箱顺；窄屏已翻；柜差租金台阶与「密封起开始赌」体感已立（line4-tiers）；line7 补手机 390/360 装箱可读可拖；line8/line9/line10 补正式·测试隔离、欢迎名 STASH AUCTION、厅距离提示与 g 点选/旋转存档/埋点货清单。4 贵货：强制路径已摸到，自然触发仍弱。5 华丽已比完（line5-fx：流畅默认、华丽可跳过）。6 冲资金未闭环（自然稳健口径未到；测试版有高现金截图不可算过）。

### 新 bug / 体验点
1. ~~窄屏装箱：暂存区隐藏 / 货品不显示~~ → **v2 已过**。
2. **评测 UI 形态**（降级）：可再开已验；叠层是否算「底栏 sheet」待产品确认。d 起评测仅 `/test/?eval=1`（line8 Console / launch-j 测试版菜单已见「评测面板」）。
3. ~~**「空间紧张」写死误报 + 高货量门控**~~ → ✅ 线上整条收（`line2-tight-online/`）。
4. **蜜月后现金门槛**（仍开）：无评测加钱时密封/跟随球难自然出现。
5. **限时豪华柜里程碑空箱（仍待复测）**：白银厅限时付 ¥66,000 / 0 件（`line4-tiers/05-worst.png`）；`?v=20260925b` 复验第20次里程碑（钥匙碎片+折扣路径）付≈¥58,100 仍 0 件、结算扣满租未退（`line6-limited-fix/bug-milestone-no-loot-no-refund.png` + `00-round20-log.png` + `05-console-version.png`）。`6d72e10` / `?v=20260925c` 已上退租兜底+自动测试；**14:13 已截 Console 确认 c 戳**（`08-console-v-c.png`），但第35次里程碑限时复测未开踩（保留档「今日限时次数已用完」）。现 Pages 已是 **`?v=20260926g`**；line7–line10 **未开**限时里程碑空柜场面，**空柜/退租仍待真机复测**（若当日限时用尽需跨日或测试版评测重置次数）。
6. **结算面板旧行残留**（次要）：`bug-stale-settle-lines.png` 仍见 CSS 已修的空行，疑标签页旧缓存；强刷复测时顺带确认。
7. 开箱灰 / 中盘结算链路本轮 **无新阻塞**；line7–line10（含 g 四项自动化全绿）未见新硬阻塞。十字自然掉落仍稀（line9 自然截图未见），依赖种档补验。

### 验收状态建议（给商业化对照 ⑪）
| 项 | 建议 |
|---|---|
| 开箱灰阻塞 | 维持 ✅ |
| 蜜月过短 | 可改 ✅ |
| 窄屏装箱沉浸 / PC·移动复验 | **建议改 ✅**（`line3-narrow/v2-*.png` + line7 390/360） |
| 贵货守住 / 跟随球 | 仍 ⏳→🔄；玩法可达，优先补自然经济样本 |
| 「空间紧张」文案 | ✅ 整条收 |
| 评测 UI（底栏 sheet） | 建议 🔄→偏 ✅；d/e 起改走 `/test/?eval=1`（launch-j / line8 已对照） |
| 柜差体感（普通→精选→密封→限时） | **建议 ✅**（line4-tiers；⑩「测试请验」1 可勾） |
| 华丽结算对比 | **建议 ✅**（line5-fx；流畅默认 + 华丽可跳过已验；⑩「测试请验」2 可勾） |
| g 版手机格子 / 拖影 / 去美元价 | **建议 ✅**（line7-g-mobile；390/360 网格铺满、拖影可见、整理无 `$`） |
| 扩容分级价 + 下拉锁 | **建议 ✅**（line7：确认框 ¥40,000→6×6、购后刷新仍 6×6；非评测 🔒；评测可自由切） |
| 正式版 / 测试版隔离（d/e） | **建议 ✅**（line8 Console：正式 `?eval=1` 无评测控件；测试 `[测试版]` + 评测面板；launch-j 双端对照） |
| 异形 L / plus 图标落格（d） | **建议 ✅**（`line8-d/C-shape-L*`；`line9-f/B-plus*`；cross-check 十字种档全绿） |
| 欢迎弹窗公开名 STASH AUCTION（f） | **建议 ✅**（`line9-f/A1-public-welcome.png`） |
| 旋转每次恰好 90°（f） | **建议 ✅**（cross-check 对 f：pre/post-place ↻×4 全绿；g-verify live 旋转即时存档 `[1,2,3,0]`） |
| 厅距离提示（f） | **建议 ✅**（`A4-test-fresh-initial` / `A4-test-after-plus50k-hint` / `A4-test-after-plus100k-hint-hidden`） |
| g 点选落点被占 / 旋转即时存档 / favicon / 埋点 loot_ids（g） | **建议 ✅**（line10-g 截图 + `g-verify/live2.txt` 106/0；正式+测试×桌面+390） |
| 限时空柜空箱 / 退租兜底 | **🔄 修复已上（c→现 20260926g）待真机复测**；里程碑 20/35 × 折扣尚未开踩 |
| 中盘经济体感 | 🔄 样本续积；继续冲赤金 / ~30万（自然口径） |
| 经济重调 / 蜜月价（d+） | 🔄 部分：line7 新档见普通蜜月租 **¥3,150**、精选 **¥11,050**、蜜月上限 ¥35,000·场次 1/5（`14-new-save.png`）；稳健档打到 8 万 / 专属厅柜批次1 **未开踩** |
| 专属厅柜批次1 | ⏳ 未开踩（未合 main） |

### 进行中 / 待测
- **空柜/退租复测**（阻塞项延续）：在 `?v=20260926g` 强刷后测里程碑 35/20 × 有无折扣；限时次数用尽时需跨日或测试版评测重置。
- **稳健档打到 ¥8 万**（不加钱、≤40% 现金）：line7–line10 未按该口径开踩。
- **冲资金 ~30 万** / 自然贵货样本（勿把测试版高现金截图算闭环）。
- **专属厅柜批次1**：青铜杂货柜 / 翡翠夜班柜 / 白银双联柜（每柜≥5 场记租金·件数·丢弃·货值·净额；两道闭环题）——等合入 main 再踩。
- **评测「重置今日限时次数」按钮**：依赖专属柜/测试版评测能力；限时用尽仍卡空柜复测。
- **商业化 itch 包**：⑩ 记 zip 已备好、等测试员 g 结论；本轮 g 四项已绿——交商业化/少权自行上传。

### 试玩日志
- **2026-09-23 03:06** · line1-retest2：蜜月约 3/5，现金 ¥20,924，盈亏 +¥8,524；开箱装箱结算正常；占用 28% 仍「空间紧张」。
- **2026-09-23 03:07–03:27** · line-followball：蜜月中碰到高价鉴宝答题失败（大金锭）；蜜月后现金闸门明显；评测强制跟随球开着仍难靠自然经济验证手感。
- **2026-09-23 03:31–03:41** · line-followball 续：强制跟随球打到鎏金链匣高命中（100% / 195·195），结果屏与评测面板已截；自然触发仍依赖加现金。
- **2026-09-23 03:43–03:55** · line3-narrow：窄屏/沉浸复验；暂存隐藏 + 装箱货品不显示 + 评测 sheet 缺失/叠层均仍在；放弃结算遗弃 7 件确认「看不见的暂存」；翡翠厅场次约 17、现金约 ¥52.9k（含评测加钱）。
- **2026-09-23 04:07–04:09** · line3-narrow v2：对照 ⑩ 结构修复后再验——暂存可见、货卡可拖装箱、评测可再开、转卖结算正常；翡翠厅场次 18、现金约 ¥98.1k（含评测加钱）、本场遗弃 5 件 / 亏损 −¥4,736；截图 `v2-01-staging.png` … `v2-04-settle.png`。
- **2026-09-23 04:23–04:37** · line2-mid：中盘续玩至场次约 20、翡翠厅、现金约 ¥101,304；摸到限时神秘柜（约 ¥44.8k）与翡翠厅说明弹层；第20场结算本场 −¥352（货 ¥13,898 / 租 ¥14,250）；**「空间紧张」在 1/25（4%）开箱仍弹**（`bug-space-tight.png`）；截图 `line2-mid/01-start.png` … `04-settle.png`。
- **2026-09-25 12:42–12:48** · line2-verify-0925：对照 ⑩「测试请验」清档复验——蜜月场次1、现金¥15k→开箱后约¥12,050；精选柜标价 **¥11,050**（`Math.round(13800×0.8/50)×50`，`01-rare-fee.png`）；普通柜开箱后占用 **0/25（0%）**，交易面板无「空间紧张」误报（`02-low-occ-open.png`）；窄屏本轮未重测（维持 v2 ✅）。6 问仍约 1–3 可写，4–6 未推进。无硬阻塞。
- **2026-09-25 12:52–12:54** · line2-tight-bc4f：对照 `bc4f5b8`（本场货物形状总格 / 剩余格 ≥0.6 也提示）本地补踩——普通小柜不误报✅（`01-small-crate-normal.png`）；密封大柜「空间紧张」已出✅（`02-big-crate-tight.png`）；精选中档仍普通装箱句（`bug-tight-missing.png`，已付¥14,490）待确认 staging 是否≥60%。6 问仍约 1–2。
- **2026-09-25 13:00–13:03** · line2-tight-online：GitHub Pages 强刷复踩（含 `bc4f5b8`）——精选约 18 格（实付¥14,490）、普通约 17 格均弹「空间紧张」；普通约 14 格走正常提示；**通过**。截图 `01-rare-open.png` · `02-common-open.png` · `03-any-small.png`。本地 line2-tight-bc4f 的精选漏报确认是旧 `game.js` 缓存。下一项：柜差（line4-tiers，线上版）。
- **2026-09-25 13:05–13:15** · line4-tiers：柜差线上入档——普通完美装箱 +¥13,354（租¥2,950）/ 精选 +¥4,574（租¥12,750）/ 密封 −¥3,287（租¥33,000）/ 密封高光 +¥30,803（租¥28,500·含炎金）/ **限时最差 −¥66,000（货¥0，`05-worst.png`，「已补发垫底货」未生效）**。普通均租≈¥4,037 / 均净 +¥5,544（去保护场比值≈1.23≈模拟1.24）；精选均租≈¥12,983 / 均净 +¥1,161（比值≈1.03 vs 模拟1.48）；密封均租≈¥31,300 / 均净 +¥19,859（比值≈1.63 vs 模拟2.24，每场弃1件）。租金台阶体感清晰。截图 `line4-tiers/`。
- **2026-09-25 13:15–13:21** · line5-fx：华丽 vs 流畅线上踩完——流畅≈0.2s 无回放；华丽≈1.8s 有高光回放、无卡顿、刷新后记住模式；当时无明显跳过（后续 `13942c8` / v=b 已加任意处/Esc 跳过）。建议保留流畅默认。精选 3 场全赚（+31,403 / +11,661 / +6,231），累计精选 6 场赢 5。截图 `line5-fx/`。
- **2026-09-25 13:44–13:53** · line6-limited-fix（`?v=20260925b`）：普通时机限时出 7 件含炎金✅（`03-normal-limited.png`）；华丽跳过点屏/Esc✅（`04-fancy-skip.png`）；**第20次里程碑开限时扣≈¥58,100 仍 0 件、结算未退租**✗（`01-milestone-open` / `02-milestone-settle` / `bug-milestone-no-loot-no-refund` / `00-round20-log` / `05-console-version`）。grok 认定真 bug（里程碑钥匙碎片+折扣路径），商业化标上线阻塞，要求 0 件全额退租 + 自动测试后发 `?v=20260925c`。试玩已停手保留第35次里程碑（存档第24场）；现金约 ¥13.5万。6 问约 1–3 可写、5 已比完、4 自然仍弱、6 冲资金未到。
- **2026-09-25 14:13–14:20** · line6 发版确认（未开复测）：Pages Console 确认 `platform.js` / `style.css` 曾带 `?v=20260925c`（`08-console-v-c.png`）；保留档场次24、现金¥168,397、白银厅、碎片1/3、下一柜−12%，限时豪华柜显示「今日限时次数已用完」——第35次里程碑限时**尚未开踩**。同期 grok 已将经济重调推上 `?v=20260925d`（⑩ 14:20）；试玩改在 **d 强刷**后做空柜/退租复测，并顺带核对蜜月租¥3,150与厅无租金上浮。6 问仍约 1–3 可写、5 已比完、4 自然仍弱、6 未到。
- **2026-10-02 ~12:10–12:35** · line7-g-mobile（对照 ⑩ g/h：手机格子 / 拖影 / 去美元价 / 扩容分级+下拉锁；截图入档 `docs/playtest-shots/line7-g-mobile/`）：
  - **390 宽**（`01`–`03`，DevTools Responsive 390×569，`?eval=1`）：装箱界面网格铺满可视区；Console 确认当时脚本 `game.js?v=20260925g`；续玩档白银厅·场次34·现金约 ¥178,270；工具行见「旋转 / 一键整理 / 扩容 / 清空」，**一键整理文案无 `$`**；已装箱件可见，底栏「转卖结算」可达。
  - **360 宽**（`04`–`06`，360×569，同 `?v=20260925g`）：网格仍可读可点；`05-360-drag` 拖动中物品拖影浮于网格上方并有落点高亮。
  - **扩容价与购后持久**（`07`–`08`、`10`–`12`）：评测面板列永久扩容 **6×6 ¥40,000 / 7×7 ¥120,000 / 8×8 ¥300,000**；确认框「花费 ¥40,000 永久扩容至 6×6」；另档现金 ¥115,000→购后 ¥75,000、容量 0/36、toast「扩容成功 -> 6x6」、扩容键改标「扩容 ¥12万」；**刷新后仍为 6×6 / ¥75,000**（`12-after-reload`）。广告文案见「强制关闭 / ADS_ENABLED=false」。
  - **下拉锁**（`09`、`15`–`16`）：非评测新档（Console 曾见 `game.js?v=20260925i`）仓库下拉 **5×5 可选，6×6/7×7/8×8 均带 🔒**；`16` 画面仍停在 5×5+锁（未见未购解锁）。评测档文案写明可自由切换尺寸。
  - **新档蜜月价**（`14-new-save`）：清档后现金 ¥15,000·5×5·蜜月进行中 1/5·现金上限 ¥35,000；普通柜 **¥3,150**、精选 **¥11,050**；密封带锁；「整理 今日免费」「扩容 ¥4万」。
  - **未覆盖**：限时里程碑空柜/退租、稳健档打到 8 万、冲 30 万、专属厅柜批次1、评测「重置今日限时次数」。续玩档限时仍见「今日限时次数已用完」（`09`）。截图当时线上曾确认 **`?v=20260926c`**（非截图当时的 g/i 戳）。6 问仍约 1–3 可写、5 已比完、4 自然仍弱、6 未到。
- **2026-10-02 ~13:05–13:06** · launch-j（对照 ⑩ launch_j / d 正式·测试拆分；截图 `docs/playtest-shots/launch-j/`）：正式版与测试版并列截 `public-*` / `test-*`——fresh PC·390、header 360/390/412、more-menu 390、broken-items-in-grid PC·390、card-vs-highlight PC·390；测试版另有 `test-eval-pc` / `test-eval-390` / `test-eval-more-menu-390`（⋯ 菜单含「评测面板 / 新开档 / 清档」）。正式版 `public-header-*` 顶栏为图鉴/流畅/音效/帮助/更多，**无**「评测/数据」。未见限时里程碑空柜场面。
- **2026-10-02 ~13:15–14:04** · line8-d（对照 d→e：正式/测试隔离、顶栏、异形 L；截图 `docs/playtest-shots/line8-d/`）：
  - **版本 Console**：`A1-public-d-console`（较早 d 戳段）→ `A1-public-e-console` / `A1-old-save-e-console` 正式版 `game.js?v=20260926e`，`?eval=1` 时评测按钮/class 检查为无；`B-version-e-console` 测试版 `title` 含 `[测试版]`、`game.js?v=20260926e`；`B3-analytics-e-console` 见 `__analyticsLog.build=20260926e-test`。
  - **老档 / 测试档画面**：`A1-old-save-e` 续玩白银厅·场次34；`A1-public-eval-e` / `B1-test-e` / `B2-test-e` / `B1-test-e-cash65000` 等为公开·测试对照帧。
  - **顶栏**：`C-topbar-{360,390,412}` 与 `*-nomenu`——390 装箱中顶栏 ⋯ 含「新开档/清档」，工具行见旋转/整理今日免费/扩容¥4万/清空。
  - **异形 L**：`C-shape-L` / `C-shape-L-incognito` 仓库内 L 形「航拍机零件」图标可见（对照 d 异形图标修复）。
  - **未覆盖**：空柜退租、稳健 8 万、自然冲 30 万、专属厅柜。
- **2026-10-02 ~14:20–15:02** · line9-f（对照 f：欢迎名 / 旋转 / 厅提示 / plus·十字；截图 `docs/playtest-shots/line9-f/`）：
  - **欢迎名**：`A1-public-welcome` 弹窗顶部可见 **STASH AUCTION**。
  - **手机宽**：`A2-360` / `A2-390` 选柜界面（蜜月保护租普通¥3,150 / 精选¥11,050；扩容¥4万键可见）。
  - **旋转**：`A3-*-rotation4` 为场景帧；另有本机 `/workspace/cross-check` 对正式/测试 × 鼠标/触屏 **96/96**（含 pre/post-place ↻ 每次 +90°、非法落点回弹、reload 朝向保留），支撑「恰好 90°」放行。
  - **厅距离提示（~14:53–14:58）**：测试版新档顶栏「距离青铜还差 ¥25,000」（`A4-test-fresh-initial` / `A4-test-fresh-after-refresh`）；评测 +¥50,000→现金 ¥65,000 见「距离翡翠还差 ¥15,000」（`A4-test-after-plus50k-hint`）；再 +¥50,000→¥115,000 解锁翡翠后顶栏不再显示「距离…」（`A4-test-after-plus100k-hint-hidden`）。低现金续玩赤金厅帧无该提示（`A4-test-lowcash-idle`）。
  - **plus / 十字**：`B-plus-desktop` / `B-plus-390-touch` plus 触屏落格；自然游玩 `B-cross-22rounds-no-cross`（场次23·赤金）与 `B-cross-fresh-reset-6`（场次6·白银）暂存未见十字形——与交接「自然多场未出、种档补验」一致；种档十字路径见 cross-check 全绿。
  - **15:34 交接**：e/f 复核放行；商业化已开始挂 itch；g 当时在 `release-g` 待上，约定上线后只复核四项。
- **2026-10-02 ~15:47–15:58** · line10-g（对照 ⑩ g 四项 · 线上已是 **`?v=20260926g`**；截图 `docs/playtest-shots/line10-g/` + 本机 `g-verify/live2.txt`）：
  - **自动化（15:47）**：正式版+测试版 × 桌面1280 + 手机390，**106 passed / 0 failed**。样例埋点：`crate_open`/`round_settle` 带 `loot_ids`（如 `bandage:1,canteen:1,…`），结算含 `sold_ids` / `dropped_ids`；`build=20260926g` 或 `20260926g-test`；favicon/apple-touch 请求 200、无根路径 `/favicon.ico` 误求；旋转×4 存档 `rot` 序列 `[1,2,3,0]`；点选落在已占角/锚点格用例通过。
  - **真机截图（~15:58）**：`occupied-desktop-blocked.webp`（正式版桌面，L 形「航拍机零件」落点高亮叠已占格）；`occupied-390-touch-blocked.webp`（390 触屏，断续灯带落点高亮）。本轮 curl 正式版 `favicon.svg`/`favicon.ico` 均为 200。
  - **结论**：g 约定四项（点选被占、旋转即时存档、favicon、埋点 loot_ids/sold_ids/dropped_ids）**建议放行**；itch 压缩包可交少权上传。空柜里程碑 / 稳健 8 万 / 自然冲 30 万 / 专属柜仍未踩。
