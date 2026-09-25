  // ===== 匿名玩法统计（埋点）· 粘贴进 game.js 的 IIFE 内，放在 logMono 附近 =====
  // 依赖 game.js 里已有的：FEATURES, round, cash, peakCash, gridSize, evalMode,
  // activeAuctionHall(), honeymoonActive(), monoDebugOn(), el.monoDebug, CRATE_TIERS
  const ANALYTICS = {
    SCHEMA: 1,
    ECON: "econ-0925h",        // 经济数值版本：只有调数值时才改，和发版号无关
    ENDPOINT: "",              // 接收端部署后填 https://delta-stash-analytics.<子域>.workers.dev/e ；留空 = 只进本地队列
    OPT_OUT_KEY: "deltaStashAnalyticsOff", // "1" = 玩家关闭了「参与匿名统计」
    PID_KEY: "deltaStashPid",
    VISIT_KEY: "deltaStashVisit",          // {first, last} 日期
    QUEUE_KEY: "deltaStashAnalyticsQueue", // 未发出的事件（离线重试）
    BATCH: 10,
    FLUSH_MS: 30000,
    LOCAL_MAX: 300,
    QUEUE_MAX: 200,
  };
  // FEATURES 里加：ANALYTICS_ENABLED: true
  const GENERAL_TIERS = new Set(["common", "rare", "sealed", "limited"]);
  window.__analyticsLog = window.__analyticsLog || [];
  let analyticsQueue = [];
  let analyticsFlushTimer = null;
  const analyticsSid = randomId();
  const analyticsSessionT0 = Date.now();
  let analyticsSessionRounds = 0;
  // 存档里持久化（saveGame/loadGame 各加一行，新开档时重置）：
  // { save, paidOpens, steadyOpens, playMs, restructureN, peakMarks: [] }
  let analyticsSave = freshAnalyticsSave();
  let roundCtx = null; // 开柜时记下，结算时用

  function randomId() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* ignore */ }
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function freshAnalyticsSave() {
    return { save: randomId(), paidOpens: 0, steadyOpens: 0, playMs: 0, restructureN: 0, peakMarks: [] };
  }
  function analyticsOn() {
    if (!FEATURES.ANALYTICS_ENABLED) return false;
    try { return localStorage.getItem(ANALYTICS.OPT_OUT_KEY) !== "1"; } catch (_) { return true; }
  }
  function setAnalyticsOptIn(on) { // 帮助页开关「参与匿名统计」调用
    try {
      if (on) localStorage.removeItem(ANALYTICS.OPT_OUT_KEY);
      else {
        localStorage.setItem(ANALYTICS.OPT_OUT_KEY, "1");
        localStorage.removeItem(ANALYTICS.QUEUE_KEY);
      }
    } catch (_) { /* ignore */ }
    if (!on) analyticsQueue = [];
  }
  function analyticsPid() {
    try {
      let p = localStorage.getItem(ANALYTICS.PID_KEY);
      if (!p) { p = randomId(); localStorage.setItem(ANALYTICS.PID_KEY, p); }
      return p;
    } catch (_) { return "nostorage-" + analyticsSid; }
  }
  function analyticsDev() {
    const w = window.innerWidth || 0;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "") || ("ontouchstart" in window && w <= 820);
    const vw = w <= 360 ? "le360" : w <= 420 ? "le420" : w <= 820 ? "le820" : "wide";
    return { dev: mobile ? "mobile" : "pc", vw };
  }
  function analyticsBuild() {
    const m = /(?:\?|&)v=([^&]+)/.exec(location.search);
    return (typeof GAME_BUILD !== "undefined" && GAME_BUILD) || (m && m[1]) || null;
  }
  function tierGroup(tierId) { return GENERAL_TIERS.has(tierId) ? "general" : "hall"; }
  function playMinutes() { return Math.round((analyticsSave.playMs + (Date.now() - analyticsSessionT0)) / 60000); }
  function steadyShare() { return analyticsSave.paidOpens > 0 ? +(analyticsSave.steadyOpens / analyticsSave.paidOpens).toFixed(3) : 1; }

  function track(ev, fields) {
    if (!analyticsOn()) return;
    const hall = activeAuctionHall();
    const e = Object.assign({
      schema: ANALYTICS.SCHEMA, ev, ts: Date.now(),
      pid: analyticsPid(), sid: analyticsSid, save: analyticsSave.save,
      build: analyticsBuild(), econ: ANALYTICS.ECON,
      round, cash: Math.round(cash), peak: Math.round(peakCash),
      hall: hall ? hall.id : null, grid: gridSize,
      honeymoon: !!honeymoonActive(), eval: !!evalMode,
      eval_tainted: evalTainted ? 1 : 0, // 存档进过评测：由 grok 在存档里持久化，只有新开档清零
    }, analyticsDev(), fields || {});
    window.__analyticsLog.push(e);
    if (window.__analyticsLog.length > ANALYTICS.LOCAL_MAX) window.__analyticsLog.shift();
    if (monoDebugOn() && el.monoDebug) {
      el.monoDebug.hidden = false;
      const line = document.createElement("div");
      line.textContent = `📊 ${ev} ${JSON.stringify(fields || {})}`;
      el.monoDebug.prepend(line);
      while (el.monoDebug.children.length > 12) el.monoDebug.removeChild(el.monoDebug.lastChild);
    }
    if (!ANALYTICS.ENDPOINT) return; // 接收端未部署：只留本地
    analyticsQueue.push(e);
    if (analyticsQueue.length > ANALYTICS.QUEUE_MAX) analyticsQueue.splice(0, analyticsQueue.length - ANALYTICS.QUEUE_MAX);
    persistAnalyticsQueue();
    if (analyticsQueue.length >= ANALYTICS.BATCH) flushAnalytics(false);
    else if (!analyticsFlushTimer) analyticsFlushTimer = setTimeout(() => flushAnalytics(false), ANALYTICS.FLUSH_MS);
  }
  function persistAnalyticsQueue() {
    try { localStorage.setItem(ANALYTICS.QUEUE_KEY, JSON.stringify(analyticsQueue)); } catch (_) { /* ignore */ }
  }
  function restoreAnalyticsQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(ANALYTICS.QUEUE_KEY) || "[]");
      if (Array.isArray(q)) analyticsQueue = q.slice(-ANALYTICS.QUEUE_MAX);
    } catch (_) { analyticsQueue = []; }
  }
  function flushAnalytics(useBeacon) {
    if (analyticsFlushTimer) { clearTimeout(analyticsFlushTimer); analyticsFlushTimer = null; }
    if (!ANALYTICS.ENDPOINT || !analyticsOn() || analyticsQueue.length === 0) return;
    const batch = analyticsQueue.splice(0, 50);
    persistAnalyticsQueue();
    const body = JSON.stringify({ events: batch });
    // text/plain = 简单请求，不触发 CORS 预检；sendBeacon 在关页时也能发出去
    if (useBeacon && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ANALYTICS.ENDPOINT, new Blob([body], { type: "text/plain" }));
      if (!ok) { analyticsQueue = batch.concat(analyticsQueue); persistAnalyticsQueue(); }
      return;
    }
    fetch(ANALYTICS.ENDPOINT, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true })
      .then((r) => { if (!r.ok && r.status >= 500) throw new Error(String(r.status)); })
      .catch(() => { analyticsQueue = batch.concat(analyticsQueue).slice(-ANALYTICS.QUEUE_MAX); persistAnalyticsQueue(); });
  }

  // ---- 会话 ----
  function trackSessionStart(isNewSave) {
    restoreAnalyticsQueue();
    const today = new Date().toISOString().slice(0, 10);
    let visit = null;
    try { visit = JSON.parse(localStorage.getItem(ANALYTICS.VISIT_KEY) || "null"); } catch (_) { visit = null; }
    const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    const first = visit && visit.first ? visit.first : today;
    const last = visit && visit.last ? visit.last : null;
    try { localStorage.setItem(ANALYTICS.VISIT_KEY, JSON.stringify({ first, last: today })); } catch (_) { /* ignore */ }
    track("session_start", {
      is_new: !!isNewSave,
      days_since_first: dayDiff(first, today),
      days_since_last: last ? dayDiff(last, today) : null,
    });
    flushAnalytics(false);
  }
  let analyticsSessionEnded = false;
  function trackSessionEnd() {
    if (analyticsSessionEnded) return;
    analyticsSessionEnded = true;
    const state = bankrupt ? "bankrupt_modal"
      : revealing ? "revealing"
      : (crateOpenedThisRound && !extractedThisRound) ? "packing" : "idle";
    track("session_end", {
      session_rounds: analyticsSessionRounds,
      session_s: Math.round((Date.now() - analyticsSessionT0) / 1000),
      state,
      last_net: roundCtx && roundCtx.lastNet != null ? roundCtx.lastNet : null,
      streak: profitStreak > 0 ? profitStreak : -lossStreak,
    });
    flushAnalytics(true);
  }
  window.addEventListener("pagehide", trackSessionEnd);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") trackSessionEnd();
    else if (analyticsSessionEnded) { analyticsSessionEnded = false; } // 切回前台：同一会话继续
  });
  // ===== 埋点代码结束；各触发点的调用见 docs/埋点接入清单.md =====
