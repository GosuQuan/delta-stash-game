"use strict";
const {G,setSeed,GAME}=require("./lib.js");const {analyse}=require("./analytic.js");
const N=+process.argv[2]||250000;
const ids=G.ITEM_DEFS.filter(d=>d.shape==="cross").map(d=>d.id);
const out=[];let seed=777001;
for(const tid of ["common","rare","sealed","limited"])for(const [sn,st0,hall] of [["postHM",{hm:false,first:false},null],["postHM+hall1.04",{hm:false,first:false},"crimson_hall"],["HM",{hm:true,first:false},null]]){
 if((tid==="limited")&&sn==="HM")continue;
 const st={...st0,hall};
 G.setState(st.hm?{round:1,cash:15000,honeymoonEnded:false,goodDropSeen:true,hall,lossStreak:0}:{round:99,cash:100000,honeymoonEnded:true,goodDropSeen:true,hall,lossStreak:0});
 setSeed(seed++);let any=0,cnt=0,ev=0,evc=0;
 for(let k=0;k<N;k++){const loot=G.rollLoot(tid);let c=0;for(const e of loot){const v=G.itemValue(e);ev+=v;if(G.getDef(e.defId).shape==="cross"){c++;evc+=v;}}if(c)any++;cnt+=c;}
 const a=analyse(tid,st,ids);
 out.push({game:GAME.split("/").pop(),tid,state:sn,mcP:any/N,anP:a.pAny,mcE:cnt/N,anE:a.eN,mcEV:ev/N,anEV:a.evCrate,mcShare:evc/ev,anShare:a.evCross/a.evCrate});
}
require("fs").writeFileSync(require("path").join(__dirname,"verify_"+GAME.split("/").pop()+".json"),JSON.stringify(out,null,1));
