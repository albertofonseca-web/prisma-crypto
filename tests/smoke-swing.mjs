import assert from 'node:assert/strict';
import { computePrismaSwing } from '../public/prisma-swing.js';

const candles=[];
let p=50000;
const t0=Date.UTC(2024,0,1);
for(let i=0;i<900;i++){
  const r=0.0015 + Math.sin(i/17)*0.0004;
  const o=p; p*=1+r;
  candles.push({t:t0+i*86400000,o,h:Math.max(o,p)*1.002,l:Math.min(o,p)*0.998,c:p,v:100});
}
const out=computePrismaSwing(candles,'BTC','1day');
assert.equal(out.asset,'BTC');
assert.equal(out.tf,'1day');
assert.ok(['READY','NO_DIRECTIONAL_SETUP','NO_PLAN'].includes(out.status));
assert.ok(Array.isArray(out.pivots));
assert.ok(out.pivots.length > 0);
assert.ok(out.pivots.some(x => Number.isFinite(+x.t)));
if(out.plan){
  assert.ok(out.plan.entry>0);
  assert.ok(out.plan.sl>0);
  assert.ok(out.plan.tp1>0);
  assert.ok(['LONG','SHORT'].includes(out.plan.dir));
}
console.log('smoke-swing OK', out.status, out.regime, out.plan?.dir || 'NO_PLAN');
