# 海外网页平台发布

## 构建原则

`platform.js` 是游戏唯一的门户 SDK 边界。默认版本不指定
`window.DELTA_STASH_PLATFORM`，因此是无广告、无外部 SDK 的 itch.io / 本地试玩版。

不要在同一包中加载多个门户的广告 SDK，也不要为 CrazyGames 或 Poki 版本接入第三方
广告网络。每个渠道单独打包并独立验收。

## CrazyGames 版本

在 `platform.js` 前注入下列配置，并按 CrazyGames 最新文档加载其 SDK：

```html
<script>window.DELTA_STASH_PLATFORM = "crazygames";</script>
<!-- CrazyGames SDK script supplied by its current integration guide -->
<script src="platform.js"></script>
```

桥接层会在可玩首帧通知 `gameplayStart`，在广告实际开始与结束时暂停/恢复，且只有
`adFinished` 后才发放激励奖励。每场点击“下一场拍卖”是中插请求机会，具体是否展示由
平台 SDK 的频率控制。上线前需用其 QA 工具检查移动端、广告被禁用及 AdBlock 场景。

## Poki 版本

以相同方式把平台名设置为 `poki`，并在 `platform.js` 前按 Poki 当前 HTML5 SDK 指南
加载 `PokiSDK`。桥接层将调用 `gameplayStart`、`gameplayStop`、`commercialBreak` 和
`rewardedBreak`（若 SDK 提供）。上传前使用 Poki Inspector 运行完整检查。

## itch.io 版本

无需 SDK。压缩包根目录必须包含：

```text
index.html
style.css
audio.js
platform.js
game.js
```

HTML5 在线版采用免费/自愿付费；若制作付费内容，另提供可下载的豪华版，而非把支付逻辑
写入游戏页面。

## 发布前清单

1. 以干净存档连续完成 10 场，分别验证桌面、390px 宽移动端和横竖屏切换。
2. 为每个门户创建独立 ZIP，不携带另一门户脚本、广告位或外链。
3. 准备英文标题、短描述、操作说明、横图、竖图、游戏截图与隐私政策 URL。
4. 平台正式接入前保持 `FEATURES.IAP_SHOP_ENABLED = false`；网页门户的 IAP 仅在平台书面批准后启用。
