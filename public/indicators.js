export const EMA_STYLE = Object.freeze({
  9:  { color: '#15985a', width: 1.7 },
  21: { color: '#6f74d8', width: 1.45 },
  50: { color: '#20a4b6', width: 1.35 },
});

export function emaSeries(rows, period){
  const n=Number(period);
  if(!Array.isArray(rows)||!Number.isInteger(n)||n<2)return[];
  const clean=rows.map(r=>({t:+r.t,c:+r.c})).filter(r=>Number.isFinite(r.t)&&Number.isFinite(r.c));
  if(clean.length<n)return[];
  let seed=0;
  for(let i=0;i<n;i++)seed+=clean[i].c;
  let ema=seed/n;
  const out=[{t:clean[n-1].t,v:ema}];
  const k=2/(n+1);
  for(let i=n;i<clean.length;i++){
    ema=clean[i].c*k+ema*(1-k);
    out.push({t:clean[i].t,v:ema});
  }
  return out;
}
