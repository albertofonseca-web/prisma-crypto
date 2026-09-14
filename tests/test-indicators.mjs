import assert from 'node:assert/strict';
import { emaSeries } from '../public/indicators.js';

const rows=Array.from({length:80},(_,i)=>({t:1700000000000+i*60000,c:100+i+(i%5===0?2:0)}));
for(const n of [9,21,50]){
  const s=emaSeries(rows,n);
  assert.equal(s.length,rows.length-n+1,`EMA${n} length`);
  assert.ok(new Set(s.map(x=>x.v.toFixed(8))).size>10,`EMA${n} must be a curve, not one flat level`);
  assert.equal(s.at(-1).t,rows.at(-1).t,`EMA${n} timestamp alignment`);
  assert.ok(Number.isFinite(s.at(-1).v),`EMA${n} final value`);
}
assert.deepEqual(emaSeries(rows,500),[]);
console.log('EMA series tests: PASS');
