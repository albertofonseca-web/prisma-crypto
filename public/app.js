import { fetchBitstampCandles, BitstampLive, updateCurrentCandle } from './market.js';
import { computePrismaSwing } from './prisma-swing.js';

const $ = id => document.getElementById(id);
const PRICE_DEC = { BTC: 2, ETH: 2, XRP: 5 };
let asset = 'BTC';
let chartTf = '15m';
let chartMode = 'TACTICAL';
let swingTf = '1day';
let candles = [];
let engineState = null;
let swingState = null;
let lastTrade = null;
let chartLoadToken = 0;
let swingLoadToken = 0;

const live = new BitstampLive(trade => {
  if (trade.asset !== asset) return;
  lastTrade = trade;
  updateCurrentCandle(candles, trade, chartTf);
  updatePriceStrip(); drawChart();
}, status => {
  $('market-health').textContent = `Bitstamp ${status.toLowerCase()}`;
  $('market-dot').className = `dot ${status === 'LIVE' ? 'ok' : status === 'ERROR' ? 'err' : 'warn'}`;
});

function fmtPrice(v, a=asset){ if(!Number.isFinite(+v))return '—'; return (+v).toLocaleString('en-US',{minimumFractionDigits:PRICE_DEC[a],maximumFractionDigits:PRICE_DEC[a]}); }
function fmtNum(v,d=2){ return Number.isFinite(+v)?(+v).toFixed(d):'—'; }
function fmtPct(v,d=2){ return Number.isFinite(+v)?`${(+v*100).toFixed(d)}%`:'—'; }
function fmtMoney(v){ return Number.isFinite(+v)?`$${(+v).toLocaleString('en-US',{maximumFractionDigits:2})}`:'—'; }
function ageText(iso){ if(!iso)return '—'; const ms=Date.now()-Date.parse(iso); if(!Number.isFinite(ms))return '—'; const s=Math.max(0,Math.round(ms/1000)); if(s<60)return `${s}s`; if(s<3600)return `${Math.floor(s/60)}m`; return `${(s/3600).toFixed(1)}h`; }
function mtyTime(iso){ if(!iso)return '—'; try{return new Date(iso).toLocaleString('es-MX',{timeZone:'America/Monterrey',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return iso;} }
function metric(label,value,cls=''){ return `<div class="metric-row"><div class="metric-label">${label}</div><div class="metric-value ${cls}">${value??'—'}</div></div>`; }
function dirClass(v){ const x=String(v||'').toUpperCase(); return x.includes('LONG')||x==='BULL'||x==='ALCISTA'?'long':x.includes('SHORT')||x==='BEAR'||x==='BAJISTA'?'short':x.includes('WATCH')?'watch':'neutral'; }
function astate(){ return engineState?.assets?.[asset]||null; }
function livePrice(){ return lastTrade?.asset===asset?lastTrade.price:candles.at(-1)?.c; }
function rich(){ return astate()?.rich||{}; }

async function loadChart(){
  const token=++chartLoadToken; $('market-health').textContent='Bitstamp cargando'; $('market-dot').className='dot warn';
  try{ const data=await fetchBitstampCandles(asset,chartTf,420); if(token!==chartLoadToken)return; candles=data; lastTrade=null; $('market-health').textContent='Bitstamp live'; $('market-dot').className='dot ok'; updatePriceStrip(); drawChart(); }
  catch(e){ if(token!==chartLoadToken)return; $('market-health').textContent='Bitstamp error'; $('market-dot').className='dot err'; console.error(e); }
}

async function loadSwing(){
  const token=++swingLoadToken; swingState=null; $('swing-state').textContent='CARGANDO'; $('swing-state').className='big-state neutral';
  try{ const r=await fetch(`/api/prisma-series?asset=${asset}&tf=${swingTf}`,{cache:'no-store'}); const b=await r.json(); if(token!==swingLoadToken)return; if(b.status!=='ok')throw new Error(b.message||'sin datos'); swingState=computePrismaSwing(b.candles,asset,swingTf); swingState.market_source=b.source; renderAll(); }
  catch(e){ if(token!==swingLoadToken)return; swingState={status:'ERROR',message:String(e.message||e)}; renderAll(); }
}

async function loadState(){
  try{ const r=await fetch(`/api/state?ts=${Date.now()}`,{cache:'no-store'}); const b=await r.json(); if(!r.ok||b.status!=='ok')throw new Error(b.message||`HTTP ${r.status}`); engineState=b.data; $('engine-dot').className='dot ok'; $('engine-health').textContent=`D1 ${engineState?.publisher_version?.startsWith('2.')?'rich':'live'}`; }
  catch(e){ $('engine-dot').className='dot err'; $('engine-health').textContent='D1 error'; console.error(e); }
  renderAll();
}

async function loadGuard(){
  try{ const r=await fetch('/api/health',{cache:'no-store'}); const b=await r.json(); $('usage-panel').innerHTML=metric('Worker',`v${b.worker_version||'—'}`,'pos')+metric('State source',b.state_source||'—','pos')+metric('D1 snapshot age',Number.isFinite(b.state_age_seconds)?`${b.state_age_seconds}s`:'—',b.state_age_seconds<180?'pos':'warn')+metric('UI refresh','30s')+metric('Market ticks','direct Bitstamp','pos')+metric('Architecture','FREE-TIER SAFE','pos'); }
  catch{ $('usage-panel').innerHTML=metric('Guard','health unavailable','warn'); }
}

function updatePriceStrip(){
  const px=livePrice(); $('asset-name').textContent=`${asset}/USD`; $('live-price').textContent=fmtPrice(px); $('market-age').textContent=lastTrade?ageText(new Date(lastTrade.timestamp).toISOString()):'REST';
  const base=candles.length>10?candles[Math.max(0,candles.length-96)]?.o:null; const ch=Number.isFinite(px)&&Number.isFinite(base)?px/base-1:null; $('live-change').textContent=ch==null?'—':`${ch>=0?'+':''}${(ch*100).toFixed(2)}%`; $('live-change').className=`change ${ch==null?'':ch>=0?'pos':'neg'}`;
}

function geometry(){
  const a=astate(); const r=rich(); const dyn=r.dynamic_now?.bilateral||{}; const fallback=a?.tactical?.preview_geometry||{};
  return { LONG: dyn.LONG||fallback.LONG||{}, SHORT: dyn.SHORT||fallback.SHORT||{} };
}

function renderExecution(){
  const a=astate(); if(!a)return;
  const d=a.decision||{}, t=a.tactical||{}, h=a.htf||{}; const action=d.action||'WAIT'; const bias=d.candidate||t.candidate_side||'NONE';
  $('final-decision').textContent=action; $('final-decision').className=`decision ${action==='LONG'?'long':action==='SHORT'?'short':'wait'}`;
  $('execution-state').textContent=action; $('execution-state').className=`big-state ${action==='LONG'?'long':action==='SHORT'?'short':'neutral'}`;
  let why=action==='WAIT'?'No abrir posición todavía.':'Entrada habilitada por TAC + gate.';
  if(action==='WAIT'&&String(h.final_state||'').includes('BLOCKED_SOURCE')) why='WAIT · Source/trigger todavía no confirma.';
  else if(action==='WAIT'&&!h.allowed) why=`WAIT · HTF veto: ${h.gate||'BLOCKED'}`;
  else if(action==='WAIT'&&t.state==='WATCH') why=`WATCH ${bias} · falta trigger.`;
  $('execution-note').textContent=why; $('decision-reason').textContent=why;
  $('bias-state').textContent=bias; $('bias-state').className=`big-state ${dirClass(bias)}`; $('bias-note').textContent=`score ${fmtNum(t.clear_score,2)} · tactical ${t.state||'—'}`;
  $('htf-state').textContent=h.gate||'—'; $('htf-state').className=`big-state ${h.allowed?'watch':'short'}`; $('htf-note').textContent=h.allowed?'HTF no veta · no crea entrada':(h.gate_reason||h.final_state||'BLOCKED');

  const G=geometry(); const L=G.LONG||{}, S=G.SHORT||{};
  $('long-plan').innerHTML=metric('Status',L.status||'PREVIEW',L.status==='ARMED'?'pos':'warn')+metric('Entry',fmtPrice(L.entry),'pos')+metric('SL',fmtPrice(L.sl),'neg')+metric('TP1',fmtPrice(L.tp1),'pos')+metric('TP2',fmtPrice(L.tp2),'pos')+metric('TP3',fmtPrice(L.tp3),'pos')+metric('Risk',fmtPrice(L.risk));
  $('short-plan').innerHTML=metric('Status',S.status||'PREVIEW',S.status==='ARMED'?'neg':'warn')+metric('Entry',fmtPrice(S.entry),'neg')+metric('SL',fmtPrice(S.sl),'neg')+metric('TP1',fmtPrice(S.tp1),'pos')+metric('TP2',fmtPrice(S.tp2),'pos')+metric('TP3',fmtPrice(S.tp3),'pos')+metric('Risk',fmtPrice(S.risk));

  const reasons=(h.reasons||[]).map(x=>`<li>${x}</li>`).join('');
  $('decision-detail').innerHTML=`<div class="decision-main ${action==='LONG'?'pos':action==='SHORT'?'neg':''}">${action}</div><div class="small">${why}</div>`+metric('Directional bias',bias,dirClass(bias)==='long'?'pos':dirClass(bias)==='short'?'neg':'warn')+metric('Actionable',d.actionable?'YES':'NO',d.actionable?'pos':'warn')+metric('Tactical state',t.state||'—')+metric('HTF gate',h.gate||'—',h.allowed?'pos':'neg')+metric('Final state',h.final_state||'—')+(reasons?`<ul class="reason-list">${reasons}</ul>`:'');
}

function renderProjection(){
  const p=rich().projection_12h||{}; const has=Number.isFinite(+p.central_price);
  $('projection-state').textContent=has?(p.bias||'12H'):'NO DATA'; $('projection-state').className=`big-state ${dirClass(p.bias)}`; $('projection-note').textContent=has?`${p.qualitative_confidence||'—'} · central ${fmtPrice(p.central_price)}`:(asset==='BTC'?'sin snapshot rico':'BTC Source-only por ahora');
  $('projection-panel').innerHTML=has?metric('Bias',p.bias||'—',dirClass(p.bias)==='long'?'pos':'neg')+metric('Confidence',p.qualitative_confidence||'—')+metric('Central',fmtPrice(p.central_price))+metric('Range',`${fmtPrice(p.range_low)} – ${fmtPrice(p.range_high)}`)+metric('Bull confirm',fmtPrice(p.bull_confirmation),'pos')+metric('Bear confirm',fmtPrice(p.bear_confirmation),'neg')+metric('Target',mtyTime(p.target_utc))+metric('Validated',p.validated?'YES':'NO · orientative',p.validated?'pos':'warn'):metric('Estado',asset==='BTC'?'esperando publisher V2':'No aplica todavía','warn');
}

function renderPivot(){
  const p=astate()?.tac||{}; const iso=p.next_pivot_utc; if(!iso){$('pivot-state').textContent='—';$('pivot-note').textContent='sin pivote Source para este activo';return;}
  const mins=Math.max(0,(Date.parse(iso)-Date.now())/60000); $('pivot-state').textContent=mins<60?`${Math.floor(mins)}m`:`${Math.floor(mins/60)}h ${Math.floor(mins%60)}m`; $('pivot-state').className=`big-state ${dirClass(p.direction)}`; $('pivot-note').textContent=`${p.label||p.direction||''} · ${mtyTime(p.next_pivot_monterrey||iso)}`;
}

function renderHTF(){
  const h=rich().htf_detail||{}; const box=tf=>{const x=h[tf]||{}; const p=x.profile||{}; return `<div class="htf-box"><div class="htf-title">${tf}</div>${metric('Trend',x.trend||'—',dirClass(x.trend)==='long'?'pos':dirClass(x.trend)==='short'?'neg':'warn')}${metric('Location',x.location||'—')}${metric('Reaction',x.reaction||'—')}${metric('EMA9 / 21',`${fmtPrice(x.ema9)} / ${fmtPrice(x.ema21)}`)}${metric('RSI14',fmtNum(x.rsi14,1))}${metric('POC',fmtPrice(p.poc))}${metric('VAH / VAL',`${fmtPrice(p.vah)} / ${fmtPrice(p.val)}`)}${metric('VWAP',fmtPrice(p.vwap))}</div>`;}; $('htf-detail').innerHTML=box('1H')+box('4H');
}

function renderLevels(){
  const profiles=rich().context_profiles||{}; let entries=Object.entries(profiles).filter(([,v])=>v&&Object.keys(v).length);
  if(!entries.length){ const h=rich().htf_detail||{}; entries=[['1H',h['1H']?.profile||{}],['4H',h['4H']?.profile||{}]]; }
  const priority=['24h','3d','7d','MTD','30d','1H','4H']; entries.sort((a,b)=>priority.indexOf(a[0])-priority.indexOf(b[0])); entries=entries.slice(0,6);
  $('levels-panel').innerHTML=entries.map(([k,v])=>`<div class="level-box"><div class="level-title">${k}</div>${[['POC',v.POC??v.poc],['VWAP',v.VWAP??v.vwap],['TWAP',v.TWAP],['VAH',v.VAH??v.vah],['VAL',v.VAL??v.val]].filter(([,x])=>Number.isFinite(+x)).map(([n,x])=>`<div class="level-line"><span>${n}</span><b>${fmtPrice(x)}</b></div>`).join('')}</div>`).join('')||'<div class="small">Sin niveles publicados.</div>';
}

function renderPivots(){
  const p=rich().pivots||{}; const next=p.next||[]; const active=p.active_windows||[]; if(!next.length){$('pivots-panel').innerHTML='<div class="small">No hay calendario Source publicado para este activo.</div>';return;}
  const rows=next.slice(0,6).map(x=>`<div class="pivot-row"><div class="pivot-time">${x.pivot_local_display||mtyTime(x.pivot_local||x.pivot_utc)}</div><div class="pivot-label ${dirClass(x.tac_label)==='long'?'pos':dirClass(x.tac_label)==='short'?'neg':'warn'}">${x.tac_label||'—'}</div><div>${x.event||'—'}</div></div>`).join('');
  const chips=active.map(x=>`<span class="window-chip">${x.window_type||'WINDOW'} · ${x.polarity||''}</span>`).join(''); $('pivots-panel').innerHTML=`<div class="pivot-list">${rows}</div>${chips?`<div class="small" style="margin-top:8px">Ventanas activas</div>${chips}`:''}`;
}

function renderOptions(){
  const o=astate()?.options||{}; const c=o.selected||(o.watch_direction==='SHORT'?o.top_short:o.top_long)||o.top_long||o.top_short; if(!c){$('options-panel').innerHTML=metric('Estado','NO DATA','warn');return;}
  $('options-panel').innerHTML=metric('Estado',o.selected?'SELECTED':'WATCH ONLY',o.selected?'pos':'warn')+metric('Dirección',c.direction||o.watch_direction||'WAIT')+metric('Strategy',c.strategy||'—')+metric('Legs',c.legs||'—')+metric('Expiry',mtyTime(c.expiry_utc))+metric('Debit',fmtMoney(c.entry_debit_usd_approx))+metric('Max loss',fmtMoney(c.max_loss_usd_approx),'neg')+metric('Max profit',fmtMoney(c.max_profit_usd_approx),'pos')+metric('Breakeven',fmtPrice(c.breakeven_usd_approx))+metric('PnL TP1',fmtMoney(c.pnl_tp1_usd_approx),(+c.pnl_tp1_usd_approx||0)>=0?'pos':'neg')+metric('PnL SL',fmtMoney(c.pnl_sl_usd_approx),'neg');
}

function renderInternals(){
  const f=astate()?.funding||{}, l=astate()?.liquidations||{}; const fStale=f.stale===true||(f.timestamp_utc&&Date.now()-Date.parse(f.timestamp_utc)>3*3600e3); const lStale=l.stale===true||(l.updated_utc&&Date.now()-Date.parse(l.updated_utc)>3*3600e3);
  $('internals-panel').innerHTML=metric('Funding 8H',Number.isFinite(+f.funding_8h)?fmtPct(f.funding_8h,4):(f.rate!=null?fmtPct(f.rate,4):f.status||'NO DATA'),fStale?'warn':'')+metric('Funding position',f.positioning||f.bias||'—')+metric('Funding age',f.timestamp_utc?ageText(f.timestamp_utc):'—',fStale?'warn':'pos')+metric('Liquidation pressure',l.pressure||l.status||'NO DATA',lStale?'warn':'')+metric('1H short liq',fmtMoney(l.short_liquidations))+metric('1H long liq',fmtMoney(l.long_liquidations))+metric('Coverage',l.coverage_1h||'—')+metric('Liq age',l.updated_utc?ageText(l.updated_utc):'—',lStale?'warn':'pos');
}

function renderSwing(){
  const s=swingState; if(!s){return;} if(s.status==='ERROR'){$('swing-state').textContent='ERROR';$('swing-state').className='big-state short';$('swing-note').textContent=s.message||'error';$('swing-plan').innerHTML='';return;}
  const regime=s.regime||'LAT'; const dir=s.plan?.dir||(regime==='BULL'?'LONG':regime==='BEAR'?'SHORT':'WAIT'); $('swing-state').textContent=dir; $('swing-state').className=`big-state ${dirClass(dir)}`; $('swing-note').textContent=`${s.market_source||'PRISMA'} · ${swingTf.toUpperCase()} · ${s.plan?.sealed?'SELLADO':s.status||''}`; const p=s.plan; $('swing-plan').innerHTML=p?metric('Entry / seal',fmtPrice(p.entry))+metric('SL',fmtPrice(p.sl),'neg')+metric('TP1',fmtPrice(p.tp1),'pos')+metric('TP2',fmtPrice(p.tp2),'pos')+metric('R:R',fmtNum(p.rr,2)):metric('Setup','SIN SETUP','warn');
}

function renderSystem(){
  const sys=engineState?.system||{}; const f=(label,o)=>metric(label,o?.status?`${o.status} · ${o.age_seconds??'—'}s`:'—',o?.status==='OK'&&(o.age_seconds??9999)<360?'pos':'warn'); $('engine-age').textContent=engineState?.generated_utc?ageText(engineState.generated_utc):'—'; $('system-panel').innerHTML=metric('Publisher',engineState?.publisher_version||'—',String(engineState?.publisher_version||'').startsWith('2.')?'pos':'warn')+metric('State hash',engineState?.state_hash||'—')+f('Decision',sys.decision_file)+f('Screener',sys.screener_file)+f('Options',sys.options_file)+metric('Orders',engineState?.orders_enabled?'ENABLED':'DISABLED',engineState?.orders_enabled?'neg':'pos');
}

function renderAll(){ updatePriceStrip(); const a=astate(); if(!a){$('execution-state').textContent='WAIT';$('execution-note').textContent='Esperando snapshot D1.';drawChart();return;} renderExecution();renderProjection();renderPivot();renderHTF();renderLevels();renderPivots();renderOptions();renderInternals();renderSwing();renderSystem();drawChart(); }

function profileLevels(){
  const p=rich().context_profiles||{}; const out=[]; const colors={POC:'#9a63c8',VWAP:'#e38b00',TWAP:'#4f7db7',VAH:'#198aa5',VAL:'#198aa5'}; for(const key of ['24h','3d','MTD']){const x=p[key];if(!x)continue;for(const n of ['POC','VWAP','TWAP','VAH','VAL'])if(Number.isFinite(+x[n]))out.push({value:+x[n],label:`${key} ${n}`,color:colors[n],dash:n==='VAH'||n==='VAL'?[2,4]:[4,3],kind:'profile'});} return out;
}
function tacticalLevels(){ const G=geometry(), out=[]; for(const [side,col] of [['LONG','#15985a'],['SHORT','#d84a4a']]){const g=G[side]||{}; for(const [k,lbl,dash] of [['entry',`${side} E`,[]],['sl',`${side} SL`,[5,4]],['tp1',`${side} TP1`,[4,3]],['tp2',`${side} TP2`,[2,4]],['tp3',`${side} TP3`,[2,4]]])if(Number.isFinite(+g[k]))out.push({value:+g[k],label:lbl,color:col,dash,kind:'tac'});} return out; }
function swingLevels(){ const p=swingState?.plan;if(!p)return[];return[{value:p.entry,label:'SW ENTRY',color:'#e38b00',dash:[]},{value:p.sl,label:'SW SL',color:'#d84a4a',dash:[]},{value:p.tp1,label:'SW TP1',color:'#e38b00',dash:[4,3]},{value:p.tp2,label:'SW TP2',color:'#e38b00',dash:[2,4]}].filter(x=>Number.isFinite(+x.value)); }

function distributeLabelYs(items, yFn, top, bottom, minGap=13){
  const rows=items.map((item,i)=>({item,i,target:yFn(item.value),y:yFn(item.value)})).sort((a,b)=>a.target-b.target);
  if(!rows.length)return rows;
  rows[0].y=Math.max(top,rows[0].target);
  for(let i=1;i<rows.length;i++)rows[i].y=Math.max(rows[i].target,rows[i-1].y+minGap);
  const overflow=rows.at(-1).y-bottom;
  if(overflow>0){
    rows.forEach(r=>r.y-=overflow);
    for(let i=rows.length-2;i>=0;i--)rows[i].y=Math.min(rows[i].y,rows[i+1].y-minGap);
    const under=top-rows[0].y;
    if(under>0)rows.forEach(r=>r.y+=under);
  }
  return rows;
}

function drawGutterLabel(ctx,text,x,y,color,align='left'){
  ctx.save(); ctx.font='700 8px Space Mono'; ctx.textBaseline='middle'; ctx.textAlign=align;
  const w=ctx.measureText(text).width, padX=3, h=11;
  const left=align==='right'?x-w-padX:x-padX;
  ctx.fillStyle='rgba(255,255,255,.92)'; ctx.fillRect(left,y-h/2,w+padX*2,h);
  ctx.fillStyle=color; ctx.fillText(text,x,y); ctx.restore();
}

function drawChart(){
  const canvas=$('chart'); if(!canvas)return;
  const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1,cssW=Math.max(340,rect.width||1100),cssH=Math.max(390,Math.min(640,cssW*.47));
  canvas.style.height=`${cssH}px`;canvas.width=Math.round(cssW*dpr);canvas.height=Math.round(cssH*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cssW,cssH);ctx.fillStyle='#fff';ctx.fillRect(0,0,cssW,cssH);
  if(!candles.length){ctx.fillStyle='#888';ctx.fillText('Cargando Bitstamp…',20,30);return;}

  // Desktop: dedicated left gutter for market/profile labels and right gutter for TAC Entry/SL/TP.
  // Mobile: keep compact in-chart labels so the candle area never collapses.
  const wide=cssW>=900;
  const pad=wide?{l:132,r:190,t:14,b:30}:{l:10,r:72,t:14,b:30};
  const plotLeft=pad.l, plotRight=cssW-pad.r;
  const series=candles.slice(-220); const px=livePrice()||series.at(-1)?.c;
  let levels=chartMode==='TACTICAL'?[...tacticalLevels(),...profileLevels()]:swingLevels();
  if(chartMode==='TACTICAL'&&Number.isFinite(px))levels=levels.filter(x=>Math.abs(x.value/px-1)<.08);

  const tr=rich().fractal?.trajectory||{}; let times=tr.times_utc||[],med=tr.source_median||[],q20=tr.source_q20||[],q80=tr.source_q80||[];
  const maxN={'1m':8,'5m':24,'15m':48,'1h':96,'4h':96}[chartTf]||48; times=times.slice(0,maxN);med=med.slice(0,maxN);q20=q20.slice(0,maxN);q80=q80.slice(0,maxN);
  const tMin=series[0].t; let tMax=series.at(-1).t;
  if(chartMode==='TACTICAL'&&times.length){const ft=Date.parse(times.at(-1));if(Number.isFinite(ft))tMax=Math.max(tMax,ft);}
  const futureVals=chartMode==='TACTICAL'?[...med,...q20,...q80].filter(Number.isFinite):[];
  let lo=Math.min(...series.map(c=>c.l),...levels.map(x=>x.value),...futureVals); let hi=Math.max(...series.map(c=>c.h),...levels.map(x=>x.value),...futureVals);
  if(!Number.isFinite(lo)||!Number.isFinite(hi)){lo=px*.98;hi=px*1.02;}
  const span=Math.max(hi-lo,Math.abs(hi)*.001);lo-=span*.06;hi+=span*.06;
  const pw=plotRight-plotLeft, ph=cssH-pad.t-pad.b;
  const xTime=t=>plotLeft+(t-tMin)/(tMax-tMin)*pw; const y=v=>pad.t+(hi-v)/(hi-lo)*ph;

  // Grid and price axis.
  ctx.strokeStyle='#eceeef';ctx.lineWidth=1;ctx.fillStyle='#8b8f95';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.textBaseline='alphabetic';
  for(let k=0;k<=5;k++){
    const yy=pad.t+ph*k/5,val=hi-(hi-lo)*k/5;ctx.beginPath();ctx.moveTo(plotLeft,yy);ctx.lineTo(plotRight,yy);ctx.stroke();
    ctx.fillText(fmtPrice(val),wide?cssW-64:plotRight+7,yy+3);
  }

  // TAC pivots are intentionally subtle, dotted and BEHIND price. No text on the chart.
  if(chartMode==='TACTICAL'){
    const piv=rich().pivots?.next||[];
    piv.forEach(p=>{const tt=Date.parse(p.pivot_utc);if(!Number.isFinite(tt)||tt<tMin||tt>tMax)return;const xx=xTime(tt);ctx.save();ctx.strokeStyle='rgba(85,85,85,.55)';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,pad.t+ph);ctx.stroke();ctx.restore();});
  }

  // Fractal Source-aware envelope behind levels/labels.
  if(chartMode==='TACTICAL'&&times.length&&med.length){
    const pts=times.map((t,i)=>({t:Date.parse(t),m:+med[i],lo:+q20[i],hi:+q80[i]})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.m));
    if(pts.length>1){ctx.save();ctx.fillStyle='rgba(25,138,165,.10)';ctx.beginPath();pts.forEach((p,i)=>{const xx=xTime(p.t),yy=y(Number.isFinite(p.hi)?p.hi:p.m);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});[...pts].reverse().forEach(p=>ctx.lineTo(xTime(p.t),y(Number.isFinite(p.lo)?p.lo:p.m)));ctx.closePath();ctx.fill();ctx.strokeStyle='#198aa5';ctx.lineWidth=2;ctx.setLineDash([]);ctx.beginPath();pts.forEach((p,i)=>{const xx=xTime(p.t),yy=y(p.m);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});ctx.stroke();ctx.restore();}
  }

  // Candles.
  const bw=Math.max(1,Math.min(7,pw/series.length*.62));
  series.forEach(c=>{const xx=xTime(c.t),up=c.c>=c.o,col=up?'#15985a':'#d84a4a';ctx.strokeStyle=col;ctx.fillStyle=col;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(xx,y(c.h));ctx.lineTo(xx,y(c.l));ctx.stroke();const top=y(Math.max(c.o,c.c)),bot=y(Math.min(c.o,c.c));ctx.fillRect(xx-bw/2,top,bw,Math.max(1,bot-top));});

  // Horizontal levels: lines stay in the plot; text is placed in dedicated gutters.
  levels.forEach(l=>{const yy=y(l.value);ctx.save();ctx.strokeStyle=l.color;ctx.lineWidth=1.1;ctx.setLineDash(l.dash||[]);ctx.beginPath();ctx.moveTo(plotLeft,yy);ctx.lineTo(plotRight,yy);ctx.stroke();ctx.restore();});

  const profileLabels=levels.filter(l=>l.kind==='profile');
  const tacLabels=levels.filter(l=>l.kind==='tac');
  const swingLabels=levels.filter(l=>l.kind!=='profile'&&l.kind!=='tac');
  const minY=pad.t+7,maxY=pad.t+ph-7;

  // LEFT = POC / VWAP / TWAP / VAH / VAL and other market structure.
  const leftRows=distributeLabelYs(profileLabels,y,minY,maxY,12);
  leftRows.forEach(r=>{
    const target=y(r.item.value), text=`${r.item.label} ${fmtPrice(r.item.value)}`;
    if(wide){ctx.save();ctx.strokeStyle=r.item.color;ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(plotLeft-5,target);ctx.lineTo(plotLeft-2,r.y);ctx.stroke();ctx.restore();drawGutterLabel(ctx,text,4,r.y,r.item.color,'left');}
    else drawGutterLabel(ctx,text,plotLeft+3,r.y,r.item.color,'left');
  });

  // RIGHT = LONG/SHORT Entry, SL and TP1-TP3. Collision-managed, never stacked on the left.
  const rightItems=chartMode==='TACTICAL'?tacLabels:swingLabels;
  const rightRows=distributeLabelYs(rightItems,y,minY,maxY,13);
  rightRows.forEach(r=>{
    const target=y(r.item.value), text=`${r.item.label} ${fmtPrice(r.item.value)}`;
    if(wide){ctx.save();ctx.strokeStyle=r.item.color;ctx.globalAlpha=.6;ctx.beginPath();ctx.moveTo(plotRight+2,target);ctx.lineTo(plotRight+6,r.y);ctx.stroke();ctx.restore();drawGutterLabel(ctx,text,plotRight+10,r.y,r.item.color,'left');}
    else drawGutterLabel(ctx,text,plotRight-3,r.y,r.item.color,'right');
  });

  const ticks=[tMin,tMin+(tMax-tMin)*.33,tMin+(tMax-tMin)*.66,tMax];ctx.fillStyle='#8b8f95';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ticks.forEach(t=>{const d=new Date(t);ctx.fillText(d.toLocaleString('es-MX',{timeZone:'America/Monterrey',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}),xTime(t)-28,cssH-8);});
}

function selectAsset(x){asset=x;document.querySelectorAll('.asset-btn').forEach(b=>b.classList.toggle('sel',b.dataset.asset===asset));live.connect(asset);loadChart();loadSwing();renderAll();}
function selectTf(x){chartTf=x;document.querySelectorAll('.tf-btn').forEach(b=>b.classList.toggle('sel',b.dataset.tf===chartTf));loadChart();}
function selectMode(x){chartMode=x;document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('sel',b.dataset.mode===chartMode));drawChart();}
document.querySelectorAll('.asset-btn').forEach(b=>b.addEventListener('click',()=>selectAsset(b.dataset.asset)));document.querySelectorAll('.tf-btn').forEach(b=>b.addEventListener('click',()=>selectTf(b.dataset.tf)));document.querySelectorAll('.mode-btn').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.mode)));$('swing-tf').addEventListener('change',e=>{swingTf=e.target.value;loadSwing();});window.addEventListener('resize',drawChart);setInterval(()=>{renderPivot();$('engine-age').textContent=engineState?.generated_utc?ageText(engineState.generated_utc):'—';},1000);setInterval(loadState,30000);setInterval(loadGuard,5*60*1000);
await Promise.allSettled([loadState(),loadChart(),loadSwing(),loadGuard()]);live.connect(asset);renderAll();
