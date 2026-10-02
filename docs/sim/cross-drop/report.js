const {G}=require("./lib.js");const {analyse,itemProbs}=require("./analytic.js");
const ids=G.ITEM_DEFS.filter(d=>d.shape==="cross").map(d=>d.id);
const halls=[null,...G.AUCTION_HALL_CFG.TIERS.map(h=>h.id)];
const f=(x,d=4)=>(x*100).toFixed(d)+"%";
for(const tid of ["sealed","limited"])for(const [sn,st0] of [["postHM",{hm:false,first:false}],["HM",{hm:true,first:false}],["HMfirst",{hm:true,first:true}]])for(const hall of halls){
 const a=analyse(tid,{...st0,hall},ids);
 console.log(tid.padEnd(8),sn.padEnd(8),(hall||"none").padEnd(14),"p="+f(a.pAny,3),"E="+a.eN.toFixed(5),"1/p="+(1/a.pAny).toFixed(1),"none22="+f(Math.pow(1-a.pAny,22),1),"none40="+f(Math.pow(1-a.pAny,40),1),"EV="+Math.round(a.evCrate),"crossEV="+Math.round(a.evCross),"share="+f(a.share,2),"per:"+a.perItem.map(([i,q])=>i+"="+f(q,3)).join(" "));
}
// pity sensitivity
for(const tid of ["sealed","limited"])for(const loss of [3,4,5,6]){const a=analyse(tid,{hm:false,hall:null,loss},ids);console.log("pity",tid,loss,f(a.pAny,3),"EV",Math.round(a.evCrate));}
// rarity probs per roll
for(const tid of ["sealed","limited"]){console.log(tid,"rarity probs post-HM none",JSON.stringify(Object.fromEntries(Object.entries(analyse(tid,{hm:false,hall:null},ids).rp).map(([k,v])=>[k,+(v*100).toFixed(3)]))));
 console.log(tid,"HM",JSON.stringify(Object.fromEntries(Object.entries(analyse(tid,{hm:true,hall:null},ids).rp).map(([k,v])=>[k,+(v*100).toFixed(3)]))));}
// pools
for(const tid of ["sealed","limited"])for(const r of ["dajin","yanjin","xiaohong","dahong"]){console.log(tid,r,G.poolFor(r,tid).map(d=>d.id+":"+d.shape+":"+d.value).join(", "));}
