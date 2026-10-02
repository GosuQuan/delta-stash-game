const {G}=require("./lib.js");const {analyse}=require("./analytic.js");
const ids=["vein_core","gold_drone","solar_array","void_ingot"];
const base=G.CRATE_TIERS.sealed.mult;
function pEV(tid,st){const a=analyse(tid,st,ids);return a;}
const TARGET=+process.argv[2]||0.05, W=+process.argv[3]||8;
const st0={hm:false,hall:null};
const a0=pEV("sealed",st0);
console.log("base p",a0.pAny,"EV",a0.evCrate);
// others-in-xiaohong unchanged: M=0.6*(8+W)/9
function build(f,M){const m={...base};m.xiaohong=M;for(const r of ["xiaojin","dajin","yanjin"])m[r]=base[r]*f;return m;}
function solve(){
 let f=1,M=base.xiaohong*(8+W)/9;
 // inner: find M s.t. p=TARGET (W fixed) ; outer: f s.t. EV=EV0
 for(let it=0;it<60;it++){
  // find M by bisection for p
  let lo=0.05,hi=20;for(let k=0;k<80;k++){const mid=(lo+hi)/2;const a=pEV("sealed",{...st0,mult:build(f,mid),itemW:{vein_core:W}});if(a.pAny<TARGET)lo=mid;else hi=mid;}M=(lo+hi)/2;
  // find f by bisection for EV
  let flo=0.05,fhi=1.5;for(let k=0;k<80;k++){const mid=(flo+fhi)/2;const a=pEV("sealed",{...st0,mult:build(mid,M),itemW:{vein_core:W}});if(a.evCrate>a0.evCrate)fhi=mid;else flo=mid;}f=(flo+fhi)/2;}
 return {f,M};}
const {f,M}=solve();
const r=(x,n)=>+x.toFixed(n);
const mult=build(r(f,4),r(M,4));
const a=pEV("sealed",{...st0,mult,itemW:{vein_core:W}});
console.log({W,M:r(M,4),f:r(f,4),mult},"p",a.pAny,"E",a.eN,"EV",a.evCrate,"diff%",(a.evCrate/a0.evCrate-1)*100,"share",a.evCross/a.evCrate);
console.log("rarity probs",Object.fromEntries(Object.entries(a.rp).map(([k,v])=>[k,+(v*100).toFixed(3)])));
