"use strict";
const fs=require("fs"),vm=require("vm"),path=require("path");
const GAME=process.env.GAME_JS||path.join(__dirname,"..","..","..","game.js");
const src=fs.readFileSync(GAME,"utf8").split("\n");
function extract(declRe){const i=src.findIndex(l=>declRe.test(l));if(i<0)throw new Error("nf "+declRe);let d=0;const out=[];
 for(let j=i;j<src.length;j++){const l=src[j];out.push(l);const s=l.replace(/\/\/.*$/,"").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g,"");
 for(const ch of s){if("([{".includes(ch))d++;else if(")]}".includes(ch))d--;}if(d<=0)return out.join("\n");}throw new Error("unb");}
const DECLS=[/^  const RARITIES = \[/,/^  const RARITY_MAP =/,/^  const MIN_FEE =/,/^  const CRATE_TIERS = \{/,/^  const LIMITED_CFG = \{/,/^  const CHALLENGE_CFG = \{/,/^  const AUCTION_HALL_CFG = \{/,/^  const HONEYMOON = \{/,/^  const DEFAULT_GRID =/,/^  const SHAPES = \{/,/^  const FRIENDLY_SHAPES =/,/^  const AWKWARD_SHAPES =/,/^  const ITEM_DEFS = \[/,/^  const byRarity =/,/^  for \(const it of ITEM_DEFS\)/,/^  function poolFor\(/,/^  function nextUid\(/,/^  function getDef\(/,/^  function itemValue\(/,/^  const PITY_RARITIES =/,/^  const PITY_THRESHOLD =/,/^  function honeymoonActive\(/,/^  function honeymoonGuaranteeRarity\(/,/^  function tierValueScale\(/,/^  function honeymoonWeightMult\(/,/^  function pityFactor\(/,/^  function weightedPick\(/,/^  function rollLoot\(/,/^  function activeAuctionHall\(/,/^  function auctionHallWeightMult\(/,/^  function rareBoostFactor\(/,/^  const DOWNGRADE_MAP = \{/];
const code=`"use strict";
let round=1,cash=15000,honeymoonEnded=false,honeymoonGoodDropSeen=true,lossStreak=0,rareBoostCharges=0,unlockedHalls=new Set(),uidCounter=1;
${DECLS.map(extract).join("\n")}
globalThis.API={RARITIES,CRATE_TIERS,AUCTION_HALL_CFG,HONEYMOON,ITEM_DEFS,FRIENDLY_SHAPES,AWKWARD_SHAPES,SHAPES,poolFor,rollLoot,getDef,itemValue,tierValueScale,
 setState(o){if("round" in o)round=o.round;if("cash" in o)cash=o.cash;if("honeymoonEnded" in o)honeymoonEnded=o.honeymoonEnded;if("lossStreak" in o)lossStreak=o.lossStreak;if("hall" in o)unlockedHalls=new Set(o.hall?[o.hall]:[]);if("goodDropSeen" in o)honeymoonGoodDropSeen=o.goodDropSeen;},
 honeymoonActive};`;
const ctx=vm.createContext({console});vm.runInContext(code,ctx);
function mulberry32(a){return function(){a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const setSeed=s=>vm.runInContext(`Math.random=(${mulberry32.toString()})(${s});`,ctx);
module.exports={G:ctx.API,setSeed,GAME};
