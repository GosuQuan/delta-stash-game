"use strict";
const {G,setSeed}=require("./lib.js");const {analyse}=require("./analytic.js");
const N=+process.argv[2]||300000;
const cross=G.ITEM_DEFS.filter(d=>d.shape==="cross");const ids=cross.map(d=>d.id);
const halls=[null,...G.AUCTION_HALL_CFG.TIERS.map(h=>h.id)];
const states=[["postHM",{hm:false,first:false}],["HM(guarantee used)",{hm:true,first:false}],["HM first-open(guarantee pending)",{hm:true,first:true}]];
const rows=[];let seed=2026100201;
for(const tid of ["common","rare","sealed","limited"]){
 for(const hall of (tid==="common"||tid==="rare")?[null,"crimson_hall"]:halls)for(const [sn,st0] of states){
  if((tid==="common"||tid==="rare")&&sn.startsWith("HM first")&&false)continue;
  const st={...st0,hall};
  G.setState(st.hm?{round:1,cash:15000,honeymoonEnded:false,goodDropSeen:!st.first,hall,lossStreak:0}:{round:99,cash:100000,honeymoonEnded:true,goodDropSeen:true,hall,lossStreak:0});
  setSeed(seed++);
  let any=0,cnt=0,ev=0,evc=0,items=0;const per={};
  for(let k=0;k<N;k++){
   if(st.hm&&st.first)G.setState({goodDropSeen:false,round:1,cash:15000});
   const loot=G.rollLoot(tid);let c=0;
   for(const e of loot){const d=G.getDef(e.defId);const v=G.itemValue(e);ev+=v;items++;if(d.shape==="cross"){c++;evc+=v;per[d.id]=(per[d.id]||0)+1;}}
   if(c)any++;cnt+=c;}
  const a=analyse(tid,st,ids);
  rows.push({tid,hall:hall||"none",state:sn,N,mcP:any/N,anP:a.pAny,mcE:cnt/N,anE:a.eN,mcEV:ev/N,anEV:a.evCrate,mcShare:evc/ev,anShare:a.evCross/a.evCrate,per:Object.fromEntries(Object.entries(per).map(([k,v])=>[k,v/N])),anPer:Object.fromEntries(a.perItem.map(([i,q])=>[i,q])),fee:a.fee});
  console.error(tid,hall,sn,"done");
 }}
require("fs").writeFileSync(require("path").join(__dirname,"mc.json"),JSON.stringify(rows,null,1));
