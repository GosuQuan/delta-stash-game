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
| 前期友好、中后期上瘾 | 蜜月 5 场 / 现金 ¥4.5 万截止；中场拍卖厅 **18 万 / 28 万 / 40 万** |
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
| 异形装箱 / 扩容 5→6→7→8 | ✅；现金扩容 `EXPAND_CASH_COST = 6000` 或 IAP stub |
| 蜜月（新手保护） | ✅；`HONEYMOON.ROUNDS = 5` **或** `CASH_END = 45000`（先到先结束） |
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
| 广告 | 代码保留；**`FEATURES.ADS_ENABLED = false`** |
| 补给 IAP | ✅ stub；`FEATURES.IAP_SHOP_ENABLED = true` |
| 本地存档 | ✅；`localStorage` 键 `deltaStashSave` |
| 评测档 | ✅；`?eval=1` 或顶栏「评测」（见⑤） |
| 金色描边（身份） | ✅；当前厅 ≥ **翡翠** **或** 生涯峰值现金 ≥ **¥250,000**；作用于品牌标与现金 HUD |

---

## ③ 数值表摘要（代码实值）

### 货柜租金（`CRATE_TIERS`）

| 柜 | id | fee | 件数 |
|---|---|---:|---|
| 普通柜 | common | **¥4,500** | 5–7 |
| 精选柜 | rare | **¥15,000** | 5–7 |
| 密封柜 | sealed | **¥30,000** | 5–8 |
| 限时豪华柜 | limited | **¥60,000** | 6–9 |

启动资金：`STARTING_CASH = ¥15,000`。

### 蜜月（`HONEYMOON`）

- 持续：场次 1..5 **或** 现金达 ¥45,000（先触发先结束；2026-09-23 由试玩反馈加长）
- 租金倍率：普通 ×0.65（≈¥2,925）、精选 ×0.80（≈¥12,000）；密封/限时 ×1.0
- 价值加成：普通 +0.30、精选 +0.24；件数压到 4–6；屏蔽大红；首开保底紫/小金

### 拍卖厅（`AUCTION_HALL_CFG.TIERS`，峰值现金）

| 厅 | 峰值门槛 | 金红权重 | 租金上浮 |
|---|---:|---:|---:|
|---|---:|---:|---:|
| 青铜拍卖厅 | ¥40,000 | **+3%** | +5% |
| 翡翠拍卖厅 | ¥80,000 | **+5%** | +8% |
| **白银拍卖厅（中场）** | **¥180,000** | **+4%** | +10% |
| **铂金拍卖厅（中场）** | **¥280,000** | **+4%** | +13% |
| **赤金拍卖厅** | **¥400,000** | **+8%** | +16% |

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
ADS_ENABLED: false           // 试玩关闭激励视频 UI
CHALLENGE_ENABLED: true
IAP_SHOP_ENABLED: true
KEYS_ENABLED: true
ORGANIZE_STUB_ENABLED: true
```

翻 `ADS_ENABLED = true` 即可恢复广告芯片 / 日 cap UI，无需删代码。

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

---

## ⑤ 上线与评测

### 本地打开

```bash
cd /workspace/delta-stash-game
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765/
```

或直接打开 `index.html`（部分浏览器限制 `file://` 下 localStorage，建议用 http）。

### itch 打包

根目录必须是可玩入口（**不要**再包一层文件夹）：

```bash
cd /workspace/delta-stash-game
zip -r ../delta-stash-game-itch.zip index.html style.css game.js audio.js
```

itch 选择 “This file will be played in the browser”，确保 zip 顶层可见 `index.html`。

### 评测档（已实装）

| 入口 | 行为 |
|---|---|
| URL `?eval=1` | 进入评测档（localStorage `deltaStashEval=1` 可持久） |
| 顶栏「评测」 | 同样进出评测档 |
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
| `docs/技术方案.md` | 早期设计稿（数值可能过时，**以 game.js 为准**） |
| `docs/HANDOFF.md` | 本交接 |

---

## 合并备注（给商业化）

0. **密封柜 ¥30,000 / 限时豪华柜 ¥60,000 以代码为准**；群内旧口头租金作废。厅租金上浮维持 +5%～+16%，勿再加码。


1. 改变现只动 `FEATURES` / `AD_*` / `IAP_SKUS`，不要改蜜月与厅阶梯 unless 重平衡。  
2. 中场厅 **¥18万 / ¥28万 / ¥40万** 已在代码；若帮助文案仍写旧阈值请同步。  
3. 真实 SDK 接入点：激励广告 stub、`stubPurchase`、`logMono` / `window.__monetizationLog`。  
4. 评测请用 `?eval=1`，用「报 bug」出诊断 JSON 贴 issue。

---

## ⑩ 冲刺日志（每 ~25 分钟刷新）

> 最近更新：2026-09-23 02:42 Asia/Shanghai · 负责人：游戏grok

### 本轮已交付
- **开箱灰阻塞**：根因 `setEvalMode→updateStats→usedCells` 在 grid 未初始化时抛错；已加空值保护 + boot try/catch。
- **PC 滚动/裁切**：桌面 `@media (min-width:961px)` 去掉 `overflow:hidden` 锁死，允许页面纵向滚动。
- **移动端沉浸**：`body.packing` 隐藏评测面板/帮助噪点/部分顶栏；仓库格 `fitCellSizeToWrap` 按容器宽适配，避免 8×8 右侧被裁。
- **格子提示叠层**：`mini-shape` 叠在 `item-art` 右下角，暂存卡更扁。
- **蜜月加长**：`ROUNDS 4→5`，`CASH_END ¥20k→¥45k`（对齐试玩「1 局就结束」反馈）。

### 进行中
- GitHub 建仓上传（待 `gh auth`）
- 金红「跟随球」小游戏（商业化需求已落，排在 UI 后）

### 下一里程碑（商业化已立项，未开工）
- 主题季 + 玩法切换（赤金厅终局扩展）
- itch.io 上传（等登录）

### 测试请验
1. PC：Ctrl+F5，确认整页可滚、底栏/账本可见
2. 移动/窄屏：`?eval=1`，开箱后仓库格完整、装箱时顶栏变干净
3. 新档蜜月：应能打满约 5 场或现金近 ¥45k 才结束


---

## ⑪ 商业化验收日志（每 ~25 分钟刷新）

> 最近更新：2026-09-23 02:43 Asia/Shanghai · 负责人：游戏商业化

### 验收结论（进行中）
| 项 | 状态 | 说明 |
|---|---|---|
| 开箱灰阻塞 | ✅ 已关 | 普通柜可点，保护租金约 ¥2,950 |
| 蜜月过短 | 🔄 待复验 | 已放宽至 5 场 / ¥45k；测试清档重跑中 |
| PC 裁切/滚动 | 🔄 待复验 | grok 已改可滚 |
| 移动端沉浸 | 🔄 待复验 | packing 模式藏噪点 |
| 精选/密封体感 | ⏳ 未测完 | |
| 贵货守住题 | ⏳ 未碰到 | |
| 结算卡顿 | ⏳ 需多结几局 | |
| 广告 | 🔒 保持关 | `ADS_ENABLED=false`，评测期不开 |

### 已立项待开发（数值已提）
1. 跟随球守住玩法（命中率→保值/增值/贬值；与答题共用触发）
2. 终局：主题季 + 玩法切换（竞速/极限仓/只开密封限时/主题契约）
3. itch 免费评测包（广告仍关）

### 变现开关（评测包）
- 广告：关
- IAP stub：开（一键整理每天免费 1 次）
- 不以广告回血撑手感

