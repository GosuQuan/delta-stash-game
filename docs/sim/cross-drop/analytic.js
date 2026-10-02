"use strict";
const {G}=require("./lib.js");
const {RARITIES,CRATE_TIERS,AUCTION_HALL_CFG,HONEYMOON,ITEM_DEFS,FRIENDLY_SHAPES,AWKWARD_SHAPES,poolFor}=G;
// state: {hm:bool (honeymoon active), first:bool (guarantee pending), hall:id|null, loss:int, wOverride:{}, itemW:{}}
function pity(r,loss){if(loss<3)return 1;const ex=Math.min(loss-3+1,4);if(!new Set(["blue","purple","pink","xiaojin","dajin","yanjin","xiaohong","dahong"]).has(r))return Math.max(0.62,1-ex*0.08);return 1+ex*0.28;}
function rarityProbs(tid,st){const t=CRATE_TIERS[tid];const hall=st.hall?AUCTION_HALL_CFG.TIERS.find(h=>h.id===st.hall):null;
 const w=RARITIES.map(r=>{if(st.hm&&HONEYMOON.BLOCKED_RARITIES.includes(r.id))return 0;if(t.allowed&&!t.allowed.includes(r.id))return 0;
  let m=(st.mult&&st.mult[r.id]!=null)?st.mult[r.id]:t.mult[r.id];if(m==null||m<=0)return 0;
  let hmm=1;if(st.hm){const tb=HONEYMOON.WEIGHT_MULT[tid];if(tb&&tb[r.id]!=null)hmm=tb[r.id];}
  let hw=1;if(hall&&hall.weightMult&&typeof hall.weightMult[r.id]==="number"&&hall.weightMult[r.id]>0)hw=hall.weightMult[r.id];
  return r.weightBase*m*pity(r.id,st.loss||0)*hmm*hw;});
 const tot=w.reduce((a,b)=>a+b,0);const o={};RARITIES.forEach((r,i)=>o[r.id]=w[i]/tot);return o;}
function pf(tid){return tid==="rare"?[0.48,0.42]:tid==="sealed"?[0.22,0.68]:tid==="limited"?[0.14,0.78]:[0.82,0.12];}
// P(def | rarity pool) incl. shape-bias; itemW = per-item weight multipliers (for proposal sim)
function defProbs(pool,tid,itemW){const [a,b]=pf(tid);const wt=d=>(itemW&&itemW[d.id]!=null)?itemW[d.id]:(d.w&&typeof d.w==="object"?(d.w[tid]!=null?d.w[tid]:1):1);
 const sub=(f)=>{const s=pool.filter(f);return s.length?s:pool;};
 const out=new Map(pool.map(d=>[d.id,0]));
 const add=(set,p)=>{const tw=set.reduce((s,d)=>s+wt(d),0);for(const d of set)out.set(d.id,out.get(d.id)+p*wt(d)/tw);};
 add(sub(d=>FRIENDLY_SHAPES.has(d.shape)),a);add(sub(d=>AWKWARD_SHAPES.has(d.shape)),b);add(pool,1-a-b);return out;}
function itemProbs(tid,st){const rp=rarityProbs(tid,st);const res=new Map();
 for(const r of RARITIES){if(!rp[r.id])continue;const pool=poolFor(r.id,tid);const dp=defProbs(pool,tid,st.itemW);for(const [id,p] of dp)res.set(id,(res.get(id)||0)+rp[r.id]*p);}return res;}
function counts(tid,st){let [lo,hi]=CRATE_TIERS[tid].count;if(st.hm&&HONEYMOON.COUNT[tid])[lo,hi]=HONEYMOON.COUNT[tid];return [lo,hi];}
const JIT={sealed:[0.8,1.18],limited:[0.75,1.22],rare:[0.88,1.08],common:[0.86,1.02]};
function jit(tid,st){if(st.hm&&HONEYMOON.JITTER[tid])return HONEYMOON.JITTER[tid];return JIT[tid];}
function analyse(tid,st,crossSet){const ip=itemProbs(tid,st);const [lo,hi]=counts(tid,st);const k=hi-lo+1;
 let q=0;for(const id of crossSet)q+=ip.get(id)||0;
 // number of random rolls: n, or n-1 if first-open guarantee replaces item 0 (guarantee pool has no cross)
 const guar=st.hm&&st.first; let pAny=0,eN=0;
 for(let n=lo;n<=hi;n++){const m=guar?Math.max(n-1,0):n;pAny+=(1-Math.pow(1-q,m))/k;eN+=m*q/k;}
 // EV
 const scale=G.tierValueScale===undefined?1:CRATE_TIERS[tid].valueScale+((st.hm&&HONEYMOON.VALUE_SCALE_BONUS[tid])||0);
 const [jl,jh]=jit(tid,st);const mj=(jl+jh)/2;const meanN=(lo+hi)/2;
 let perRollEV=0,perRollCross=0;for(const [id,p] of ip){const d=ITEM_DEFS.find(x=>x.id===id);const v=d.value*scale*mj*p;perRollEV+=v;if(crossSet.includes(id))perRollCross+=v;}
 // guarantee: replaces item0 with purple(35%)/xiaojin... ignored in EV (EV listed for non-guarantee state) 
 return {q,pAny,eN,meanN,evCrate:perRollEV*meanN,evCross:perRollCross*meanN,share:perRollCross/perRollEV,perItem:crossSet.map(id=>[id,ip.get(id)||0]),rp:rarityProbs(tid,st),fee:CRATE_TIERS[tid].fee};}
module.exports={analyse,itemProbs,rarityProbs,defProbs,counts};
if(require.main===module){
 const cross=ITEM_DEFS.filter(d=>d.shape==="cross");console.log("cross items:",cross.map(d=>[d.id,d.name,d.rarity,d.value,d.tiers]));
 for(const tid of Object.keys(CRATE_TIERS)){for(const r of ["white","green","blue","purple","pink","xiaojin","dajin","yanjin","xiaohong","dahong"]){const pool=poolFor(r,tid);const has=pool.filter(d=>d.shape==="cross");const wt=CRATE_TIERS[tid].mult[r];if(has.length)console.log(tid,r,"mult",wt,"pool size",pool.length,"cross in pool",has.map(d=>d.id),"filteredEmpty?",ITEM_DEFS.filter(d=>d.rarity===r&&(!d.tiers||d.tiers.includes(tid))).length===0);}}
 const ids=cross.map(d=>d.id);
 for(const tid of Object.keys(CRATE_TIERS)){const a=analyse(tid,{hm:false,hall:null},ids);console.log(tid,"post-HM nohall",a.pAny,a.eN,a.share);}
}
