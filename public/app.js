import { fetchBitstampCandles, BitstampLive, updateCurrentCandle } from './market.js';
import { computePrismaSwing } from './prisma-swing.js';
import { emaSeries, EMA_STYLE } from './indicators.js';

const $ = id => document.getElementById(id);
const PRICE_DEC = { BTC: 2, ETH: 2, XRP: 5 };
let asset = 'BTC';
let chartTf = '15m';
let chartMode = 'TACTICAL';
let swingTf = '1day';
let candles = [];
let engineState = null;
let swingState = null;
let swingCandles = [];
let swingMeta = {};
let lastTrade = null;
const overlays = { plan:true, options:false, levels:true, liq:false, medias:false };
let pivotHorizonHours = 48;
let pivotMode = 'ALL';

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
function optionsMarket(){ return rich().options_market||{}; }
function liquidityLayers(){ return rich().liquidity_layers||{}; }
function fmtOi(v){ const x=+v;if(!Number.isFinite(x))return '—';if(x>=1e6)return `${(x/1e6).toFixed(2)}M`;if(x>=1e3)return `${(x/1e3).toFixed(1)}K`;return x.toFixed(x<100?1:0); }
function pivotTimeline(){
  const p=rich().pivots||{};
  const raw=Array.isArray(p.timeline)&&p.timeline.length?p.timeline:(p.next||[]);
  return raw.filter(x=>Number.isFinite(Date.parse(x.pivot_utc))).sort((a,b)=>Date.parse(a.pivot_utc)-Date.parse(b.pivot_utc));
}
function isCandidateEvent(x){ return String(x?.display_class||'').toUpperCase()==='CANDIDATE'; }
function pivotEventColor(x){
  if(isCandidateEvent(x)) return '#8b8f95';
  const s=String(x?.tac_label||x?.direction_hint||'').toUpperCase();
  if(s.includes('BUY')||s.includes('BULL')||s.includes('LONG'))return '#15985a';
  if(s.includes('SELL')||s.includes('BEAR')||s.includes('SHORT'))return '#d84a4a';
  if(s.includes('C-TREND'))return '#e38b00';
  if(s.includes('COUNTER'))return '#9a63c8';
  if(s.includes('STRUCTURAL'))return '#198aa5';
  return '#555';
}

async function loadChart(){
  const token=++chartLoadToken; $('market-health').textContent='Bitstamp cargando'; $('market-dot').className='dot warn';
  try{ const data=await fetchBitstampCandles(asset,chartTf,420); if(token!==chartLoadToken)return; candles=data; lastTrade=null; $('market-health').textContent='Bitstamp live'; $('market-dot').className='dot ok'; updatePriceStrip(); drawChart(); }
  catch(e){ if(token!==chartLoadToken)return; $('market-health').textContent='Bitstamp error'; $('market-dot').className='dot err'; console.error(e); }
}

async function loadSwing(){
  const token=++swingLoadToken; swingState=null; swingCandles=[]; swingMeta={}; $('swing-state').textContent='CARGANDO'; $('swing-state').className='big-state neutral';
  try{
    const r=await fetch(`/api/prisma-series?asset=${asset}&tf=${swingTf}`,{cache:'no-store'}); const b=await r.json();
    if(token!==swingLoadToken)return; if(b.status!=='ok')throw new Error(b.message||'sin datos');
    swingCandles=(b.candles||[]).map(x=>({t:+new Date(x.t),o:+x.o,h:+x.h,l:+x.l,c:+x.c,v:+x.v||0})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.c));
    swingMeta={source:b.source,generated_utc:b.generated_utc,fallback_reason:b.fallback_reason||null};
    swingState=computePrismaSwing(swingCandles,asset,swingTf); swingState.market_source=b.source; swingState.generated_utc=b.generated_utc;
    renderAll();
  }
  catch(e){ if(token!==swingLoadToken)return; swingCandles=[]; swingState={status:'ERROR',message:String(e.message||e)}; renderAll(); }
}

async function loadState(){
  try{ const r=await fetch(`/api/state?ts=${Date.now()}`,{cache:'no-store'}); const b=await r.json(); if(!r.ok||b.status!=='ok')throw new Error(b.message||`HTTP ${r.status}`); engineState=b.data; $('engine-dot').className='dot ok'; $('engine-health').textContent=`D1 ${/^[234]\./.test(engineState?.publisher_version||'')?'rich':'live'}`; }
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

  const G=geometry(); const L=G.LONG||{}, S=G.SHORT||{}; const trig=!!t.trigger?.confirmed;
  const longConfirmed=(action==='LONG')||(trig&&bias==='LONG'), shortConfirmed=(action==='SHORT')||(trig&&bias==='SHORT');
  $('long-plan').innerHTML=metric('Status',longConfirmed?'CONFIRMED':(L.status||'PREVIEW'),longConfirmed?'pos':'warn')+metric('Entry',fmtPrice(L.entry),'long-entry')+metric('SL',fmtPrice(L.sl),'long-sl')+metric('TP1',fmtPrice(L.tp1),'long-tp')+metric('TP2',fmtPrice(L.tp2),'long-tp')+metric('TP3',fmtPrice(L.tp3),'long-tp')+metric('Risk',fmtPrice(L.risk));
  $('short-plan').innerHTML=metric('Status',shortConfirmed?'CONFIRMED':(S.status||'PREVIEW'),shortConfirmed?'neg':'warn')+metric('Entry',fmtPrice(S.entry),'short-entry')+metric('SL',fmtPrice(S.sl),'short-sl')+metric('TP1',fmtPrice(S.tp1),'short-tp')+metric('TP2',fmtPrice(S.tp2),'short-tp')+metric('TP3',fmtPrice(S.tp3),'short-tp')+metric('Risk',fmtPrice(S.risk));

  const reasons=(h.reasons||[]).map(x=>`<li>${x}</li>`).join('');
  $('decision-detail').innerHTML=`<div class="decision-main ${action==='LONG'?'pos':action==='SHORT'?'neg':''}">${action}</div><div class="small">${why}</div>`+metric('Directional bias',bias,dirClass(bias)==='long'?'pos':dirClass(bias)==='short'?'neg':'warn')+metric('Actionable',d.actionable?'YES':'NO',d.actionable?'pos':'warn')+metric('Tactical state',t.state||'—')+metric('HTF gate',h.gate||'—',h.allowed?'pos':'neg')+metric('Final state',h.final_state||'—')+(reasons?`<ul class="reason-list">${reasons}</ul>`:'');
}

function renderProjection(){
  const p=rich().projection_12h||{}; const has=Number.isFinite(+p.central_price);
  $('projection-state').textContent=has?(p.bias||'12H'):'NO DATA'; $('projection-state').className=`big-state ${dirClass(p.bias)}`; $('projection-note').textContent=has?`${p.qualitative_confidence||'—'} · central ${fmtPrice(p.central_price)}`:(asset==='BTC'?'sin snapshot rico':'BTC Source-only por ahora');
  $('projection-panel').innerHTML=has?metric('Bias',p.bias||'—',dirClass(p.bias)==='long'?'pos':'neg')+metric('Confidence',p.qualitative_confidence||'—')+metric('Central',fmtPrice(p.central_price))+metric('Range',`${fmtPrice(p.range_low)} – ${fmtPrice(p.range_high)}`)+metric('Bull confirm',fmtPrice(p.bull_confirmation),'pos')+metric('Bear confirm',fmtPrice(p.bear_confirmation),'neg')+metric('Target',mtyTime(p.target_utc))+metric('Validated',p.validated?'YES':'NO · orientative',p.validated?'pos':'warn'):metric('Estado',asset==='BTC'?'esperando publisher V2':'No aplica todavía','warn');
}

function renderPivot(){
  const rp=rich().pivots||{};
  const timeline=pivotTimeline();
  const n=rp.next_event||timeline.find(x=>Date.parse(x.pivot_utc)>Date.now())||rp.next_classified||(rp.next||[])[0]||{};
  const iso=n.pivot_utc;
  if(!iso){$('pivot-state').textContent='—';$('pivot-note').textContent='sin evento publicado';return;}
  const mins=Math.max(0,(Date.parse(iso)-Date.now())/60000);
  const label=n.tac_label||n.direction_hint||'EVENT';
  $('pivot-state').textContent=mins<60?`${Math.floor(mins)}m`:`${Math.floor(mins/60)}h ${Math.floor(mins%60)}m`;
  $('pivot-state').className=`big-state ${isCandidateEvent(n)?'neutral':dirClass(label)}`;
  const mode=isCandidateEvent(n)?'CANDIDATE · DISPLAY ONLY':(n.hierarchy||n.display_class||'CLASSIFIED');
  $('pivot-note').textContent=`${label} · ${mtyTime(n.pivot_local||iso)} · ${mode}`;
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
  const p=rich().pivots||{}, now=Date.now(), end=now+pivotHorizonHours*3600e3;
  let timeline=pivotTimeline().filter(x=>{const t=Date.parse(x.pivot_utc);return t>=now&&t<=end;});
  if(pivotMode==='CLASSIFIED')timeline=timeline.filter(x=>!isCandidateEvent(x));
  const coverage=p.coverage||{};
  const classified=timeline.filter(x=>!isCandidateEvent(x)).length;
  const candidates=timeline.filter(isCandidateEvent).length;
  $('pivot-coverage-note').textContent=`${pivotHorizonHours===168?'7D':pivotHorizonHours+'H'} · ${classified} classified · ${candidates} candidates · candidates no alteran el motor`;

  if(!timeline.length){$('pivots-panel').innerHTML='<div class="small">No hay eventos publicados en este horizonte.</div>';return;}
  const rows=timeline.map(x=>{
    const candidate=isCandidateEvent(x);
    const label=x.tac_label||'—';
    const cls=candidate?'candidate':'classified';
    const tag=candidate?'UNCLASSIFIED':(x.hierarchy||x.display_class||'CLASSIFIED');
    const color=pivotEventColor(x);
    return `<div class="pivot-row ${cls}">
      <div class="pivot-time">${x.pivot_local_display||mtyTime(x.pivot_local||x.pivot_utc)}</div>
      <div><div class="pivot-label" style="color:${color}">${label}</div><div class="pivot-class">${tag}</div></div>
      <div>${x.event||'—'}${candidate?'<div class="tiny">display only · decision effect NONE</div>':''}</div>
    </div>`;
  }).join('');
  const active=(p.active_windows||[]).map(x=>`<span class="window-chip">${x.window_type||'WINDOW'} · ${x.polarity||''}</span>`).join('');
  const summary=`<div class="pivot-summary"><span class="window-chip">${timeline.length} events</span><span class="window-chip">${classified} classified</span><span class="window-chip">${candidates} candidates</span></div>`;
  const note=p.decision_effect&&String(p.decision_effect).includes('NONE')?'<div class="small warn" style="margin-bottom:7px">Candidatos y calendario compartido son contexto visual; no crean una entrada.</div>':'';
  $('pivots-panel').innerHTML=`${note}${summary}<div class="pivot-list full">${rows}</div>${active?`<div class="small" style="margin-top:8px">Ventanas activas</div>${active}`:''}`;
}

function tacticalOptionContext(){
  const o=astate()?.options||{}, om=optionsMarket();
  const fallbackLong=Array.isArray(om.top_candidates?.long)?om.top_candidates.long[0]:om.top_candidates?.long;
  const fallbackShort=Array.isArray(om.top_candidates?.short)?om.top_candidates.short[0]:om.top_candidates?.short;
  const topLong=o.top_long||fallbackLong, topShort=o.top_short||fallbackShort;
  const watch=String(o.watch_direction||astate()?.decision?.candidate||astate()?.tactical?.candidate_side||'').toUpperCase();
  const candidate=o.selected||(watch==='SHORT'?topShort:watch==='LONG'?topLong:null)||topLong||topShort||null;
  const execution=String(astate()?.decision?.action||'WAIT').toUpperCase();
  const selected=!!o.selected && ['LONG','SHORT'].includes(execution);
  return {o,om,topLong,topShort,candidate,execution,selected,watch};
}

function renderTacticalOptionsPlan(){
  const el=$('tactical-options-panel'); if(!el)return;
  const {o,om,topLong,topShort,candidate:c,execution,selected,watch}=tacticalOptionContext();
  const status=selected?'SELECTED':c?'WATCH ONLY':'NO CANDIDATE';
  const statusClass=selected?'pos':c?'warn':'neutral';
  let html=`<div class="option-plan-callout ${selected?'selected':'watch'}"><div class="option-plan-status ${statusClass}">${status}</div><div class="option-plan-sub">TAC / Fork · ${execution==='WAIT'?'sin entrada confirmada':'execution '+execution} · Deribit public market data</div></div>`;
  html+=metric('Tactical execution',execution,execution==='LONG'?'pos':execution==='SHORT'?'neg':'warn')+
        metric('Watch direction',watch||o.watch_direction||'—',dirClass(watch)==='long'?'pos':dirClass(watch)==='short'?'neg':'warn');
  if(c){
    html+=metric('Strategy',c.strategy||'—')+
      metric('Direction',c.direction||watch||'—',dirClass(c.direction||watch)==='long'?'pos':dirClass(c.direction||watch)==='short'?'neg':'warn')+
      metric('Legs',c.legs||c.strikes||'—')+
      metric('Expiry',mtyTime(c.expiry_utc))+
      metric('Debit / cost',fmtMoney(c.entry_debit_usd_approx))+
      metric('Max loss',fmtMoney(c.max_loss_usd_approx),'neg')+
      metric('Max profit',fmtMoney(c.max_profit_usd_approx),'pos')+
      metric('Breakeven',fmtPrice(c.breakeven_usd_approx))+
      `<div class="option-scenario-title">IF TAC UNDERLYING REACHES</div>`+
      metric('TP1 → option P&L',fmtMoney(c.pnl_tp1_usd_approx),(+c.pnl_tp1_usd_approx||0)>=0?'pos':'neg')+
      metric('TP2 → option P&L',fmtMoney(c.pnl_tp2_usd_approx),(+c.pnl_tp2_usd_approx||0)>=0?'pos':'neg')+
      metric('TP3 → option P&L',fmtMoney(c.pnl_tp3_usd_approx),(+c.pnl_tp3_usd_approx||0)>=0?'pos':'neg')+
      metric('SL → option P&L',fmtMoney(c.pnl_sl_usd_approx),(+c.pnl_sl_usd_approx||0)>=0?'pos':'neg')+
      metric('Spread',fmtPct(c.relative_spread_mean,1))+
      metric('Min OI',fmtOi(c.min_open_interest))+
      metric('Vol 24H',fmtOi(c.min_volume_24h));
  }
  const alt=[];
  if(topLong && topLong!==c)alt.push(`<div><b>LONG watch</b><span>${topLong.strategy||'—'} · ${topLong.strikes||topLong.legs||'—'}</span></div>`);
  if(topShort && topShort!==c)alt.push(`<div><b>SHORT watch</b><span>${topShort.strategy||'—'} · ${topShort.strikes||topShort.legs||'—'}</span></div>`);
  if(alt.length) html+=`<div class="option-watch-alts">${alt.join('')}</div>`;
  html+=`<div class="tiny option-warning">${chartMode==='SWING'?'Este plan pertenece al motor TAC/Fork y permanece separado del Swing. ':''}Las opciones nunca crean una entrada: TAC + HTF deben autorizar primero. ${c?.money_warning||''} · NO ORDERS.</div>`;
  el.innerHTML=html;
}

function renderOptions(){
  const {o,om,topLong,topShort,candidate:c,selected}=tacticalOptionContext();
  const nw=om.nearest_expiry||{}, cw=nw.call_wall||om.call_wall, pw=nw.put_wall||om.put_wall;
  let html=metric('Chain source',om.source||'DERIBIT','pos')+
    metric('Chain age',om.generated_utc?ageText(om.generated_utc):'—',om.generated_utc&&Date.now()-Date.parse(om.generated_utc)<15*60e3?'pos':'warn')+
    metric('Call wall · nearest',cw?`${fmtPrice(cw.strike)} · OI ${fmtOi(cw.open_interest)}`:'NO DATA',cw?'':'warn')+
    metric('Put wall · nearest',pw?`${fmtPrice(pw.strike)} · OI ${fmtOi(pw.open_interest)}`:'NO DATA',pw?'':'warn')+
    metric('Wall expiry',nw.expiry_utc?mtyTime(nw.expiry_utc):'—')+
    metric('TAC options status',selected?'SELECTED':(c?'WATCH ONLY':'NO CANDIDATE'),selected?'pos':c?'warn':'neutral');
  const cards=(om.expiry_walls||[]).slice(0,6).map(x=>`<div class="option-rung"><b>${mtyTime(x.expiry_utc)}</b><span>C ${x.call_wall?fmtPrice(x.call_wall.strike):'—'} · P ${x.put_wall?fmtPrice(x.put_wall.strike):'—'}</span><small>${Number.isFinite(+x.hours_to_expiry)?`${(+x.hours_to_expiry).toFixed(0)}h`:''}</small></div>`).join('');
  const alt=[]; if(topLong)alt.push(`<div><b>LONG</b> ${topLong.strategy||'—'} · ${topLong.strikes||topLong.legs||'—'}</div>`); if(topShort)alt.push(`<div><b>SHORT</b> ${topShort.strategy||'—'} · ${topShort.strikes||topShort.legs||'—'}</div>`);
  $('options-panel').innerHTML=html+(alt.length?`<div class="option-alts">${alt.join('')}</div>`:'')+(cards?`<div class="option-ladder">${cards}</div>`:'')+`<div class="tiny option-warning">Chain / OI walls / expiry ladder. El plan TAC operativo se muestra también junto a QUÉ HACER AHORA.</div>`;
}

function renderInternals(){
  const f=astate()?.funding||{}, l=astate()?.liquidations||{}, layers=liquidityLayers(), realized=layers.realized||{}, om=optionsMarket();
  const fStale=f.stale===true||(f.timestamp_utc&&Date.now()-Date.parse(f.timestamp_utc)>3*3600e3); const lTime=realized.generated_utc||l.updated_utc; const lStale=lTime&&Date.now()-Date.parse(lTime)>3*3600e3;
  const clusters=realized.clusters_4h||[]; const topShort=clusters.filter(x=>String(x.liquidated_side).toUpperCase()==='SHORT').sort((a,b)=>(+b.notional_usd||0)-(+a.notional_usd||0))[0]; const topLong=clusters.filter(x=>String(x.liquidated_side).toUpperCase()==='LONG').sort((a,b)=>(+b.notional_usd||0)-(+a.notional_usd||0))[0];
  $('internals-panel').innerHTML=metric('Funding 8H',Number.isFinite(+f.funding_8h)?fmtPct(f.funding_8h,4):(f.rate!=null?fmtPct(f.rate,4):f.status||'NO DATA'),fStale?'warn':'')+metric('Funding position',f.positioning||f.bias||'—')+metric('Funding age',f.timestamp_utc?ageText(f.timestamp_utc):'—',fStale?'warn':'pos')+metric('REALIZED liq regime',realized.regime_1h||l.pressure||realized.status||'NO DATA',lStale?'warn':'')+metric('Realized SHORT cluster',topShort?`${fmtPrice(topShort.weighted_price)} · ${fmtMoney(topShort.notional_usd)}`:'—')+metric('Realized LONG cluster',topLong?`${fmtPrice(topLong.weighted_price)} · ${fmtMoney(topLong.notional_usd)}`:'—')+metric('Liq age',lTime?ageText(lTime):'—',lStale?'warn':'pos')+metric('Estimated heatmap',layers.estimated_forward?.status||'NOT IMPORTED','warn')+metric('Call wall',om.call_wall?`${fmtPrice(om.call_wall.strike)} · ${fmtOi(om.call_wall.open_interest)}`:'—')+metric('Put wall',om.put_wall?`${fmtPrice(om.put_wall.strike)} · ${fmtOi(om.put_wall.open_interest)}`:'—');
}

function swingPct(v,entry){ if(!Number.isFinite(+v)||!Number.isFinite(+entry)||+entry===0)return '—'; const x=(+v/+entry-1)*100; return `${x>=0?'+':''}${x.toFixed(2)}%`; }
function swingTfLabel(tf=swingTf){ return ({'4h':'4H','1day':'1D','1week':'1W','1month':'1M'})[tf]||String(tf||'').toUpperCase(); }
function swingDecisionHtml(){
  const s=swingState, p=s?.plan;
  if(!s||s.status==='ERROR') return `<div class="decision-main neg">ERROR</div><div class="small">${s?.message||'Swing no disponible'}</div>`;
  if(!p) return `<div class="decision-main">WAIT</div><div class="small">PRISMA Swing ${swingTfLabel()} · ${s.status||'SIN SETUP DIRECCIONAL'}</div>`+metric('Regime',s.regime||'LAT')+metric('Raw regime',s.raw_regime||'—')+metric('Source',s.market_source||swingMeta.source||'BITSTAMP');
  const cls=p.dir==='LONG'?'pos':'neg';
  return `<div class="swing-callout"><div class="swing-action ${cls}">${p.dir} · SWING PLAN</div><div class="swing-sub">Plan ${p.sealed?'sellado':'actual'} · referencia de decisión, no orden automática</div></div>`+
    metric('Entry / seal',fmtPrice(p.entry))+
    metric('SL',`${fmtPrice(p.sl)} · ${swingPct(p.sl,p.entry)} · P ${p.pSl??'—'}%`,'neg')+
    metric('TP1',`${fmtPrice(p.tp1)} · ${swingPct(p.tp1,p.entry)} · P ${p.pTp1??'—'}%`,'pos')+
    metric('TP2',`${fmtPrice(p.tp2)} · ${swingPct(p.tp2,p.entry)} · P ${p.pTp2??'—'}%`,'pos')+
    metric('R:R',fmtNum(p.rr,2),p.rr>=1?'pos':'warn')+
    metric('Regime',s.regime||'—',dirClass(p.dir)==='long'?'pos':'neg')+
    metric('Horizon',`${p.horizon??'—'} bars · ${swingTfLabel()}`)+
    metric('Generation',p.gen??s.generation??'—')+
    metric('Previous plan',p.resPrev||s.previous_resolution||'—')+
    metric('Source',s.market_source||swingMeta.source||'BITSTAMP','pos')+
    metric('Series age',s.generated_utc?ageText(s.generated_utc):'—');
}
function renderSwing(){
  const s=swingState;
  if(!s){$('swing-state').textContent='CARGANDO';$('swing-state').className='big-state neutral';$('swing-note').textContent='';$('swing-plan').innerHTML='';return;}
  if(s.status==='ERROR'){$('swing-state').textContent='ERROR';$('swing-state').className='big-state short';$('swing-note').textContent=s.message||'error';$('swing-plan').innerHTML='';return;}
  const regime=s.regime||'LAT'; const p=s.plan; const dir=p?.dir||(regime==='BULL'?'LONG':regime==='BEAR'?'SHORT':'WAIT');
  $('swing-state').textContent=dir; $('swing-state').className=`big-state ${dirClass(dir)}`;
  $('swing-note').textContent=`${s.market_source||swingMeta.source||'BITSTAMP'} · ${swingTfLabel()} · ${p?.sealed?'SELLADO':s.status||''}`;
  $('swing-plan').innerHTML=p?
    metric('Entry / seal',fmtPrice(p.entry))+metric('SL',`${fmtPrice(p.sl)} · ${swingPct(p.sl,p.entry)} · P ${p.pSl??'—'}%`,'neg')+metric('TP1',`${fmtPrice(p.tp1)} · ${swingPct(p.tp1,p.entry)} · P ${p.pTp1??'—'}%`,'pos')+metric('TP2',`${fmtPrice(p.tp2)} · ${swingPct(p.tp2,p.entry)} · P ${p.pTp2??'—'}%`,'pos')+metric('R:R',fmtNum(p.rr,2),p.rr>=1?'pos':'warn')+metric('Regime',regime)+metric('Horizon',`${p.horizon??'—'} bars`)+metric('Generation',p.gen??s.generation??'—'):
    metric('Setup',s.status==='NO_DIRECTIONAL_SETUP'?'SIN SETUP DIRECCIONAL':s.status||'SIN SETUP','warn')+metric('Regime',regime)+metric('Raw regime',s.raw_regime||'—');
}

function renderModeContext(){
  const swing=chartMode==='SWING'; document.body.classList.toggle('mode-swing',swing);
  $('tactical-tf-row')?.classList.toggle('hidden',swing); $('swing-tf-row')?.classList.toggle('hidden',!swing);
  if(swing){
    $('chart-kicker').textContent='PRISMA SWING MARKET MAP';
    if($('mode-options-kicker'))$('mode-options-kicker').textContent='TAC / FORK OPTIONS · CONTEXT';
    $('chart-title').innerHTML=`Bitstamp · estructura + Fibonacci + plan Swing <span id="chart-coverage" class="badge warn">CHECKING</span>`;
    $('decision-kicker').textContent='SWING · QUÉ HACER AHORA';
    const p=swingState?.plan; const dir=p?.dir||'WAIT';
    $('final-decision').textContent=p?`SWING ${dir}`:'SWING WAIT'; $('final-decision').className=`decision ${dir==='LONG'?'long':dir==='SHORT'?'short':'wait'}`;
    $('decision-reason').textContent=p?`PRISMA Swing ${swingTfLabel()} · Entry ${fmtPrice(p.entry)} · SL ${fmtPrice(p.sl)} · TP1 ${fmtPrice(p.tp1)}`:`PRISMA Swing ${swingTfLabel()} · sin setup direccional`;
    $('decision-detail').innerHTML=swingDecisionHtml();
  }else{
    $('chart-kicker').textContent='TACTICAL MARKET MAP';
    if($('mode-options-kicker'))$('mode-options-kicker').textContent='TAC / FORK OPTIONS PLAN';
    $('chart-title').innerHTML=`Bitstamp + TAC geometry + profiles + Source/Fractal <span id="chart-coverage" class="badge warn">CHECKING</span>`;
    $('decision-kicker').textContent='QUÉ HACER AHORA';
  }
}

function renderSystem(){
  const sys=engineState?.system||{}; const f=(label,o)=>metric(label,o?.status?`${o.status} · ${o.age_seconds??'—'}s`:'—',o?.status==='OK'&&(o.age_seconds??9999)<360?'pos':'warn'); $('engine-age').textContent=engineState?.generated_utc?ageText(engineState.generated_utc):'—'; $('system-panel').innerHTML=metric('Publisher',engineState?.publisher_version||'—',/^[234]\./.test(String(engineState?.publisher_version||''))?'pos':'warn')+metric('State hash',engineState?.state_hash||'—')+f('Decision',sys.decision_file)+f('Screener',sys.screener_file)+f('Options',sys.options_file)+metric('Orders',engineState?.orders_enabled?'ENABLED':'DISABLED',engineState?.orders_enabled?'neg':'pos');
}

function renderCoverage(){
  const el=$('chart-coverage'); if(!el)return;
  if(chartMode==='SWING'){
    const ready=swingCandles.length>=80 && swingState && swingState.status!=='ERROR';
    const txt=!ready?'SWING DATA MISSING':swingState?.plan?'SWING PLAN READY':(swingState?.status==='NO_DIRECTIONAL_SETUP'?'SWING · NO SETUP':'SWING READY');
    el.textContent=txt; el.className=`badge ${ready?'ok':'bad'}`;
    const legend=$('fractal-legend'); if(legend)legend.textContent='Swing structure / Fibonacci';
    return;
  }
  const r=rich(), profiles=r.context_profiles||{}, fr=r.fractal||{}, tr=fr.trajectory||{}, piv=r.pivots||{};
  const hasProfiles=Object.keys(profiles).length>0||Object.keys(r.htf_detail||{}).length>0; const hasFractal=(tr.times_utc||[]).length>1 && ((tr.median||tr.source_median||tr.technical_median||[]).length>1); const hasPivots=((piv.timeline||[]).length>0)||((piv.next||[]).length>0);
  const ok=hasProfiles&&hasFractal&&hasPivots; el.textContent=ok?'FORK DATA COMPLETE':`MISSING ${[!hasProfiles?'TA':'',!hasFractal?'FRACTAL':'',!hasPivots?'PIVOTS':''].filter(Boolean).join(' / ')}`;el.className=`badge ${ok?'ok':'bad'}`;
  const legend=$('fractal-legend'); if(legend) legend.textContent=asset==='BTC'?'Source fractal median / Q20–Q80':'Technical fractal median / Q20–Q80';
}

function renderAll(){ renderCoverage(); updatePriceStrip(); const a=astate(); if(!a){$('execution-state').textContent='WAIT';$('execution-note').textContent='Esperando snapshot D1.';drawChart();return;} renderExecution();renderProjection();renderPivot();renderHTF();renderLevels();renderPivots();renderOptions();renderTacticalOptionsPlan();renderInternals();renderSwing();renderSystem();renderModeContext();renderCoverage();drawChart(); }

function profileLevels(){
  const r=rich(), p=r.context_profiles||{}; const out=[]; const colors={POC:'#9a63c8',VWAP:'#e38b00',TWAP:'#4f7db7',VAH:'#198aa5',VAL:'#198aa5'};
  let keys=['24h','3d','MTD'].filter(k=>p[k]&&Object.keys(p[k]).length);
  // ETH/XRP safety fallback: while full 24h/3d/MTD parity is warming up, plot
  // their already-published asset-specific HTF profiles instead of showing a blank map.
  let source=p;
  if(!keys.length){
    const h=r.htf_detail||{}; source={};
    for(const tf of ['1H','4H']){const hp=h[tf]?.profile||{}; if(Object.keys(hp).length) source[tf]={POC:hp.POC??hp.poc,VWAP:hp.VWAP??hp.vwap,TWAP:hp.TWAP??hp.twap,VAH:hp.VAH??hp.vah,VAL:hp.VAL??hp.val};}
    keys=['1H','4H'].filter(k=>source[k]&&Object.keys(source[k]).length);
  }
  for(const key of keys){const x=source[key];if(!x)continue;for(const n of ['POC','VWAP','TWAP','VAH','VAL']){const v=x[n]??x[n.toLowerCase()];if(Number.isFinite(+v))out.push({value:+v,label:`${key} ${n}`,color:colors[n],dash:n==='VAH'||n==='VAL'?[2,4]:[4,3],kind:'profile'});}}
  return out;
}
function tacticalLevels(){
  const G=geometry(), out=[], a=astate()||{}, t=a.tactical||{}, confirmed=!!t.trigger?.confirmed, candidate=(a.decision?.candidate||t.candidate_side||'').toUpperCase(), active=(a.decision?.action||'WAIT').toUpperCase();
  // Exact fork palette: entries yellow/orange, SL dark/light red, TP dark/light green.
  const palettes={LONG:{entry:'#ffd400',sl:'#a61b1b',tp:'#1b8f3a'},SHORT:{entry:'#ffb347',sl:'#ff6b6b',tp:'#7cfc98'}};
  for(const side of ['LONG','SHORT']){const g=G[side]||{},pal=palettes[side],isConfirmed=(active===side)||(confirmed&&candidate===side);
    for(const [k,sfx,dash] of [['entry','E',[]],['sl','SL',[]],['tp1','TP1',[4,3]],['tp2','TP2',[4,3]],['tp3','TP3',[4,3]]]){if(!Number.isFinite(+g[k]))continue; const color=k==='entry'?pal.entry:k==='sl'?pal.sl:pal.tp; const mark=(k==='entry'&&isConfirmed)?'✓ ':''; out.push({value:+g[k],label:`${mark}${side} ${sfx}`,color,dash,kind:'tac',side,key:k,confirmed:isConfirmed,alpha:(candidate&&candidate!==side&&active==='WAIT')?.62:1});}
  } return out; }
function optionLevels(){
  if(!overlays.options)return[];
  const om=optionsMarket(), out=[], nw=om.nearest_expiry||{};
  const cw=nw.call_wall||om.call_wall, pw=nw.put_wall||om.put_wall;
  if(cw&&Number.isFinite(+cw.strike))out.push({value:+cw.strike,label:`CALL WALL OI ${fmtOi(cw.open_interest)}`,color:'#2878d7',dash:[7,3],kind:'option-wall'});
  if(pw&&Number.isFinite(+pw.strike))out.push({value:+pw.strike,label:`PUT WALL OI ${fmtOi(pw.open_interest)}`,color:'#cc45c8',dash:[7,3],kind:'option-wall'});
  // Option legs belong to the TAC/Fork plan. In Swing mode we keep only market OI walls
  // so a tactical Deribit candidate is never presented as a Swing recommendation.
  const c=chartMode==='TACTICAL'?tacticalOptionContext().candidate:null;
  if(c){
    const strikes=String(c.strikes||'').split('/').map(Number).filter(Number.isFinite);
    strikes.slice(0,4).forEach((v,i)=>out.push({value:v,label:`TAC OPT LEG ${i+1}`,color:'#8357c5',dash:[2,3],kind:'option-plan'}));
    if(Number.isFinite(+c.breakeven_usd_approx))out.push({value:+c.breakeven_usd_approx,label:'TAC OPT B/E',color:'#b26b00',dash:[3,3],kind:'option-plan'});
  }
  return out;
}
function liquidationLevels(){
  if(!overlays.liq)return[];
  const r=liquidityLayers().realized||{}, clusters=r.clusters_4h||[];
  return clusters.filter(x=>Number.isFinite(+x.weighted_price)).slice(0,8).map(x=>{const side=String(x.liquidated_side||'').toUpperCase();return{value:+x.weighted_price,label:`REALIZED ${side} LIQ ${fmtMoney(x.notional_usd)}`,color:side==='LONG'?'#cc45c8':'#2878d7',dash:[2,3],kind:'liq'};});
}
function visibleEmaCurves(rows, label){
  if(!overlays.medias||!rows?.length)return[];
  return [9,21,50].map(n=>{
    const points=emaSeries(rows,n);
    const style=EMA_STYLE[n];
    return {n,label:`${label} EMA${n}`,points,color:style.color,width:style.width};
  }).filter(x=>x.points.length>1);
}

function swingLevels(){
  const p=swingState?.plan;if(!p)return[];
  const entryColor='#e38b00', tpColor='#15985a', slColor='#d84a4a';
  return [
    {value:p.entry,label:'SW ENTRY',color:entryColor,dash:[],kind:'swing-plan',key:'entry'},
    {value:p.sl,label:'SW SL',color:slColor,dash:[],kind:'swing-plan',key:'sl'},
    {value:p.tp1,label:'SW TP1',color:tpColor,dash:[5,3],kind:'swing-plan',key:'tp1'},
    {value:p.tp2,label:'SW TP2',color:tpColor,dash:[2,4],kind:'swing-plan',key:'tp2'}
  ].filter(x=>Number.isFinite(+x.value));
}
function swingStructureLevels(){
  if(!overlays.levels)return[]; const f=swingState?.fib;if(!f)return[];
  const rows=[['SW HIGH',f.swingHi,'#15985a',[3,3]],['FIB 38.2',f.l382,'#4f7db7',[3,3]],['FIB 50.0',f.l5,'#9a63c8',[3,3]],['FIB 61.8',f.l618,'#9a63c8',[3,3]],['FIB 78.6',f.l786,'#4f7db7',[3,3]],['SW LOW',f.swingLo,'#d84a4a',[3,3]]];
  return rows.filter(([,v])=>Number.isFinite(+v)).map(([label,value,color,dash])=>({label,value:+value,color,dash,kind:'swing-structure'}));
}

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

  const swing=chartMode==='SWING';
  const source=swing?swingCandles:candles;
  if(!source.length){ctx.fillStyle='#888';ctx.font='11px Space Mono';ctx.fillText(swing?'Cargando serie Bitstamp Swing…':'Cargando Bitstamp…',20,30);return;}

  const wide=cssW>=900;
  const pad=wide?{l:132,r:205,t:14,b:30}:{l:10,r:78,t:14,b:30};
  const plotLeft=pad.l, plotRight=cssW-pad.r;
  const swingN=({'4h':180,'1day':110,'1week':104,'1month':72})[swingTf]||110;
  const series=source.slice(-(swing?swingN:220));
  const px=swing?(livePrice()||series.at(-1)?.c):(livePrice()||series.at(-1)?.c);
  // Compute EMA on the full loaded series, then draw only the visible time window.
  // This avoids the false flat horizontal 'EMA levels' used before v0.3.7.
  const emaCurves=visibleEmaCurves(source, swing?swingTfLabel():chartTf.toUpperCase());

  let levels=[];
  if(!swing){
    if(overlays.plan)levels.push(...tacticalLevels());
    if(overlays.levels)levels.push(...profileLevels());
    levels.push(...optionLevels(),...liquidationLevels());
    if(Number.isFinite(px))levels=levels.filter(x=>Math.abs(x.value/px-1)<((x.kind==='option-wall'||x.kind==='option-plan')?.18:.10));
  }else{
    if(overlays.plan)levels.push(...swingLevels());
    if(overlays.levels)levels.push(...swingStructureLevels(),...profileLevels());
    levels.push(...optionLevels(),...liquidationLevels());
  }

  const fr=rich().fractal||{}, tr=fr.trajectory||{}; let times=tr.times_utc||[],med=tr.median||tr.source_median||tr.technical_median||[],q20=tr.q20||tr.source_q20||tr.technical_q20||[],q80=tr.q80||tr.source_q80||tr.technical_q80||[];
  const maxN={'1m':8,'5m':24,'15m':48,'1h':96,'4h':96}[chartTf]||48; times=times.slice(0,maxN);med=med.slice(0,maxN);q20=q20.slice(0,maxN);q80=q80.slice(0,maxN);
  const tMin=series[0].t; let tMax=series.at(-1).t;
  if(!swing&&times.length){const ft=Date.parse(times.at(-1));if(Number.isFinite(ft))tMax=Math.max(tMax,ft);}
  if(!swing){const futureHours=['1m','5m','15m'].includes(chartTf)?24:48; const horizon=series.at(-1).t+futureHours*3600e3; const fp=pivotTimeline().map(x=>Date.parse(x.pivot_utc)).filter(x=>Number.isFinite(x)&&x<=horizon&&x>=series.at(-1).t); if(fp.length)tMax=Math.max(tMax,...fp);}

  let lo,hi;
  const visibleEmaValues=emaCurves.flatMap(c=>c.points.filter(p=>p.t>=series[0].t&&p.t<=series.at(-1).t).map(p=>p.v)).filter(Number.isFinite);
  if(swing){
    // Critical Swing rule: viewport follows price structure, never distant TP/SL.
    // Far targets remain in the right plan panel and receive edge markers.
    lo=Math.min(...series.map(c=>c.l),...visibleEmaValues); hi=Math.max(...series.map(c=>c.h),...visibleEmaValues);
    const raw=Math.max(hi-lo,Math.abs(series.at(-1)?.c||1)*.01); lo-=raw*.08;hi+=raw*.08;
  }else{
    const futureVals=[...med,...q20,...q80].filter(Number.isFinite);
    lo=Math.min(...series.map(c=>c.l),...levels.map(x=>x.value),...futureVals,...visibleEmaValues); hi=Math.max(...series.map(c=>c.h),...levels.map(x=>x.value),...futureVals,...visibleEmaValues);
    if(!Number.isFinite(lo)||!Number.isFinite(hi)){lo=px*.98;hi=px*1.02;}
    const span=Math.max(hi-lo,Math.abs(hi)*.001);lo-=span*.06;hi+=span*.06;
  }
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo===hi){lo=px*.98;hi=px*1.02;}

  const pw=plotRight-plotLeft, ph=cssH-pad.t-pad.b;
  const xTime=t=>plotLeft+(t-tMin)/Math.max(1,tMax-tMin)*pw; const y=v=>pad.t+(hi-v)/(hi-lo)*ph;

  // Grid and price axis.
  ctx.strokeStyle='#eceeef';ctx.lineWidth=1;ctx.fillStyle='#8b8f95';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.textBaseline='alphabetic';
  for(let k=0;k<=5;k++){
    const yy=pad.t+ph*k/5,val=hi-(hi-lo)*k/5;ctx.beginPath();ctx.moveTo(plotLeft,yy);ctx.lineTo(plotRight,yy);ctx.stroke();
    ctx.fillText(fmtPrice(val),wide?cssW-64:plotRight+7,yy+3);
  }

  if(!swing){
    // Full event display timeline. Classified TAC/Source events are stronger;
    // unclassified astronomical candidates are intentionally faint and never affect decisions.
    const pp=rich().pivots||{}, piv=[...(pp.recent||[]).slice(-3),...pivotTimeline()];
    piv.forEach(p=>{const tt=Date.parse(p.pivot_utc);if(!Number.isFinite(tt)||tt<tMin||tt>tMax)return;const xx=xTime(tt),candidate=isCandidateEvent(p);ctx.save();ctx.strokeStyle=candidate?'rgba(120,124,130,.25)':pivotEventColor(p);ctx.globalAlpha=candidate?.52:.62;ctx.lineWidth=candidate?.8:1.15;ctx.setLineDash(candidate?[2,5]:[4,4]);ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,pad.t+ph);ctx.stroke();ctx.restore();});

    // Source/technical fractal.
    if(times.length&&med.length){
      const pts=times.map((t,i)=>({t:Date.parse(t),m:+med[i],lo:+q20[i],hi:+q80[i]})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.m));
      if(pts.length>1){ctx.save();ctx.fillStyle='rgba(25,138,165,.10)';ctx.beginPath();pts.forEach((p,i)=>{const xx=xTime(p.t),yy=y(Number.isFinite(p.hi)?p.hi:p.m);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});[...pts].reverse().forEach(p=>ctx.lineTo(xTime(p.t),y(Number.isFinite(p.lo)?p.lo:p.m)));ctx.closePath();ctx.fill();ctx.strokeStyle='#198aa5';ctx.lineWidth=2;ctx.setLineDash([]);ctx.beginPath();pts.forEach((p,i)=>{const xx=xTime(p.t),yy=y(p.m);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});ctx.stroke();ctx.restore();}
    }
  }

  // Candles. Swing intentionally uses PRISMA-style blue candles so mode is visually unmistakable.
  const bw=Math.max(1,Math.min(8,pw/series.length*.62));
  series.forEach(c=>{const xx=xTime(c.t),up=c.c>=c.o,col=swing?(up?'#6ba5e7':'#234f86'):(up?'#15985a':'#d84a4a');ctx.strokeStyle=col;ctx.fillStyle=col;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(xx,y(c.h));ctx.lineTo(xx,y(c.l));ctx.stroke();const top=y(Math.max(c.o,c.c)),bot=y(Math.min(c.o,c.c));ctx.fillRect(xx-bw/2,top,bw,Math.max(1,bot-top));});

  // True moving averages: one point per candle, connected as curves.
  // They are computed from the active visible timeframe, never a single 1H snapshot value.
  if(overlays.medias){
    emaCurves.forEach(curve=>{
      const pts=curve.points.filter(p=>p.t>=tMin&&p.t<=series.at(-1).t&&Number.isFinite(p.v));
      if(pts.length<2)return;
      ctx.save();ctx.strokeStyle=curve.color;ctx.lineWidth=curve.width;ctx.globalAlpha=.90;ctx.setLineDash([]);ctx.beginPath();
      pts.forEach((p,i)=>{const xx=xTime(p.t),yy=y(p.v);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});ctx.stroke();
      const last=pts.at(-1); if(last){const ly=y(last.v);if(ly>=pad.t&&ly<=pad.t+ph){ctx.font='700 8px Space Mono';ctx.fillStyle=curve.color;ctx.textAlign='right';ctx.fillText(`EMA${curve.n}`,Math.min(plotRight-4,xTime(last.t)+50),ly-4);}}
      ctx.restore();
    });
  }

  // Swing structure pivots from the actual PRISMA Swing series.
  if(swing){
    const piv=(swingState?.pivots||[]).filter(p=>Number.isFinite(+p.t)&&Number.isFinite(+p.px)&&+p.t>=tMin&&+p.t<=tMax).slice(-8);
    piv.forEach(p=>{const xx=xTime(+p.t),yy=y(+p.px);if(yy<pad.t||yy>pad.t+ph)return;ctx.save();ctx.fillStyle=p.type==='H'?'#d84a4a':'#15985a';ctx.beginPath();ctx.arc(xx,yy,3.2,0,Math.PI*2);ctx.fill();ctx.font='700 8px Space Mono';ctx.textAlign='center';ctx.fillText(p.label||p.type,xx,yy+(p.type==='H'?-7:12));ctx.restore();});
    if(Number.isFinite(px)&&px>=lo&&px<=hi){const yy=y(px);ctx.save();ctx.strokeStyle='rgba(23,25,29,.5)';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(plotLeft,yy);ctx.lineTo(plotRight,yy);ctx.stroke();ctx.restore();}
  }

  const visibleLevels=levels.filter(l=>Number.isFinite(+l.value)&&+l.value>=lo&&+l.value<=hi);
  const offscreenSwing=swing?levels.filter(l=>l.kind==='swing-plan'&&Number.isFinite(+l.value)&&(+l.value<lo||+l.value>hi)):[];

  // Horizontal levels visible inside the price viewport only.
  visibleLevels.forEach(l=>{const yy=y(l.value);ctx.save();ctx.strokeStyle=l.color;ctx.globalAlpha=l.alpha??1;ctx.lineWidth=l.confirmed?1.5:1.1;ctx.setLineDash(l.dash||[]);ctx.beginPath();ctx.moveTo(plotLeft,yy);ctx.lineTo(plotRight,yy);ctx.stroke();ctx.restore();});

  const leftKinds=swing?['profile','option-wall','liq','swing-structure']:['profile','option-wall','liq'];
  const leftLabels=visibleLevels.filter(l=>leftKinds.includes(l.kind));
  const tacLabels=visibleLevels.filter(l=>l.kind==='tac');
  const optionPlanLabels=visibleLevels.filter(l=>l.kind==='option-plan');
  const swingLabels=visibleLevels.filter(l=>l.kind==='swing-plan');
  const minY=pad.t+7,maxY=pad.t+ph-7;

  const leftRows=distributeLabelYs(leftLabels,y,minY,maxY,12);
  leftRows.forEach(r=>{
    const target=y(r.item.value), text=`${r.item.label} ${fmtPrice(r.item.value)}`;
    if(wide){ctx.save();ctx.strokeStyle=r.item.color;ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(plotLeft-5,target);ctx.lineTo(plotLeft-2,r.y);ctx.stroke();ctx.restore();drawGutterLabel(ctx,text,4,r.y,r.item.color,'left');}
    else drawGutterLabel(ctx,text,plotLeft+3,r.y,r.item.color,'left');
  });

  const rightItems=(swing?swingLabels:tacLabels).concat(optionPlanLabels);
  const rightRows=distributeLabelYs(rightItems,y,minY,maxY,13);
  rightRows.forEach(r=>{
    const target=y(r.item.value), text=`${r.item.label} ${fmtPrice(r.item.value)}`;
    if(wide){ctx.save();ctx.strokeStyle=r.item.color;ctx.globalAlpha=.6;ctx.beginPath();ctx.moveTo(plotRight+2,target);ctx.lineTo(plotRight+6,r.y);ctx.stroke();ctx.restore();drawGutterLabel(ctx,text,plotRight+10,r.y,r.item.color,'left');}
    else drawGutterLabel(ctx,text,plotRight-3,r.y,r.item.color,'right');
  });

  // Distant Swing TP/SL no longer destroy the chart scale: show them as edge arrows.
  if(swing&&offscreenSwing.length){
    const top=offscreenSwing.filter(x=>x.value>hi).sort((a,b)=>a.value-b.value);
    const bot=offscreenSwing.filter(x=>x.value<lo).sort((a,b)=>b.value-a.value);
    top.slice(0,4).forEach((l,i)=>drawGutterLabel(ctx,`↑ ${l.label} ${fmtPrice(l.value)}`,plotRight+10,pad.t+10+i*14,l.color,'left'));
    bot.slice(0,4).forEach((l,i)=>drawGutterLabel(ctx,`↓ ${l.label} ${fmtPrice(l.value)}`,plotRight+10,pad.t+ph-10-i*14,l.color,'left'));
  }

  const ticks=[tMin,tMin+(tMax-tMin)*.33,tMin+(tMax-tMin)*.66,tMax];ctx.fillStyle='#8b8f95';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ticks.forEach(t=>{const d=new Date(t);const opts=swing&&['1week','1month'].includes(swingTf)?{timeZone:'America/Monterrey',year:'2-digit',month:'short'}:{timeZone:'America/Monterrey',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'};ctx.fillText(d.toLocaleString('es-MX',opts),xTime(t)-28,cssH-8);});
}

function refreshOverlayButtons(){
  document.querySelectorAll('[data-overlay]').forEach(b=>b.classList.toggle('sel',!!overlays[b.dataset.overlay]));
}
function toggleOverlay(name){overlays[name]=!overlays[name];refreshOverlayButtons();drawChart();}
function clearPlan(){overlays.plan=false;overlays.options=false;refreshOverlayButtons();drawChart();}
async function toggleFullscreen(){const el=$('chart-card');try{if(!document.fullscreenElement)await el.requestFullscreen();else await document.exitFullscreen();}catch(e){console.warn(e);}setTimeout(drawChart,100);}

function selectAsset(x){asset=x;document.querySelectorAll('[data-pivot-hours]').forEach(b=>b.addEventListener('click',()=>{pivotHorizonHours=+b.dataset.pivotHours||48;document.querySelectorAll('[data-pivot-hours]').forEach(x=>x.classList.toggle('sel',+x.dataset.pivotHours===pivotHorizonHours));renderPivots();drawChart();}));
document.querySelectorAll('[data-pivot-mode]').forEach(b=>b.addEventListener('click',()=>{pivotMode=b.dataset.pivotMode||'ALL';document.querySelectorAll('[data-pivot-mode]').forEach(x=>x.classList.toggle('sel',x.dataset.pivotMode===pivotMode));renderPivots();drawChart();}));
document.querySelectorAll('.asset-btn').forEach(b=>b.classList.toggle('sel',b.dataset.asset===asset));live.connect(asset);loadChart();loadSwing();renderAll();}
function selectTf(x){chartTf=x;document.querySelectorAll('.tf-btn').forEach(b=>b.classList.toggle('sel',b.dataset.tf===chartTf));loadChart();}
function selectMode(x){chartMode=x;document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('sel',b.dataset.mode===chartMode));renderModeContext();renderTacticalOptionsPlan();renderCoverage();drawChart();}
function selectSwingTf(x){swingTf=x;document.querySelectorAll('.swing-tf-btn').forEach(b=>b.classList.toggle('sel',b.dataset.swingTf===swingTf));if($('swing-tf'))$('swing-tf').value=swingTf;loadSwing();}
document.querySelectorAll('[data-pivot-hours]').forEach(b=>b.addEventListener('click',()=>{pivotHorizonHours=+b.dataset.pivotHours||48;document.querySelectorAll('[data-pivot-hours]').forEach(x=>x.classList.toggle('sel',+x.dataset.pivotHours===pivotHorizonHours));renderPivots();drawChart();}));
document.querySelectorAll('[data-pivot-mode]').forEach(b=>b.addEventListener('click',()=>{pivotMode=b.dataset.pivotMode||'ALL';document.querySelectorAll('[data-pivot-mode]').forEach(x=>x.classList.toggle('sel',x.dataset.pivotMode===pivotMode));renderPivots();drawChart();}));
document.querySelectorAll('.asset-btn').forEach(b=>b.addEventListener('click',()=>selectAsset(b.dataset.asset)));document.querySelectorAll('.tf-btn').forEach(b=>b.addEventListener('click',()=>selectTf(b.dataset.tf)));document.querySelectorAll('.swing-tf-btn').forEach(b=>b.addEventListener('click',()=>selectSwingTf(b.dataset.swingTf)));document.querySelectorAll('.mode-btn').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.mode)));document.querySelectorAll('[data-overlay]').forEach(b=>b.addEventListener('click',()=>toggleOverlay(b.dataset.overlay)));$('no-plan-btn')?.addEventListener('click',clearPlan);$('fullscreen-btn')?.addEventListener('click',toggleFullscreen);$('swing-tf').addEventListener('change',e=>selectSwingTf(e.target.value));document.addEventListener('fullscreenchange',()=>setTimeout(drawChart,80));window.addEventListener('resize',drawChart);setInterval(()=>{renderPivot();$('engine-age').textContent=engineState?.generated_utc?ageText(engineState.generated_utc):'—';},1000);setInterval(loadState,30000);setInterval(loadGuard,5*60*1000);refreshOverlayButtons();
await Promise.allSettled([loadState(),loadChart(),loadSwing(),loadGuard()]);live.connect(asset);renderAll();
