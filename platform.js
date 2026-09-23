/**
 * Portal bridge for the browser builds.
 *
 * The game remains fully playable when no portal SDK is present. A portal
 * wrapper can set `window.DELTA_STASH_PLATFORM` to `crazygames` or `poki`
 * before this file loads; this keeps portal-specific code out of game rules.
 */
(function (global) {
  "use strict";

  const requested = String(global.DELTA_STASH_PLATFORM || "local").toLowerCase();
  const hasCrazyGames = () => Boolean(global.CrazyGames && global.CrazyGames.SDK);
  const hasPoki = () => Boolean(global.PokiSDK);

  function provider() {
    if (requested === "crazygames" && hasCrazyGames()) return "crazygames";
    if (requested === "poki" && hasPoki()) return "poki";
    return "local";
  }

  function safely(fn) {
    try { return fn(); } catch (_) { return undefined; }
  }

  function gameplayStart() {
    if (provider() === "crazygames") safely(() => global.CrazyGames.SDK.game.gameplayStart());
    if (provider() === "poki") safely(() => global.PokiSDK.gameplayStart());
  }

  function gameplayStop() {
    if (provider() === "crazygames") safely(() => global.CrazyGames.SDK.game.gameplayStop());
    if (provider() === "poki") safely(() => global.PokiSDK.gameplayStop());
  }

  /** Resolve true only after a rewarded video has genuinely completed. */
  function requestRewarded() {
    return new Promise((resolve) => {
      if (provider() === "crazygames") {
        try {
          global.CrazyGames.SDK.ad.requestAd("rewarded", {
            adStarted: gameplayStop,
            adFinished: () => { gameplayStart(); resolve(true); },
            adError: () => { gameplayStart(); resolve(false); },
          });
        } catch (_) {
          resolve(false);
        }
        return;
      }
      if (provider() === "poki" && typeof global.PokiSDK.rewardedBreak === "function") {
        try {
          global.PokiSDK.rewardedBreak()
            .then((success) => resolve(success === true))
            .catch(() => resolve(false));
        } catch (_) {
          resolve(false);
        }
        return;
      }
      resolve(false);
    });
  }

  function requestMidgame() {
    if (provider() === "crazygames") {
      safely(() => global.CrazyGames.SDK.ad.requestAd("midgame", {
        adStarted: gameplayStop,
        adFinished: gameplayStart,
        adError: gameplayStart,
      }));
    } else if (provider() === "poki" && typeof global.PokiSDK.commercialBreak === "function") {
      safely(() => global.PokiSDK.commercialBreak());
    }
  }

  global.DeltaStashPlatform = Object.freeze({
    provider,
    supportsRewarded: () => provider() !== "local",
    gameplayStart,
    gameplayStop,
    requestRewarded,
    requestMidgame,
  });
})(window);
