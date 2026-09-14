import { fetchBitstampCandles, BitstampLive, updateCurrentCandle } from "./market.js";
import { computePrismaSwing } from "./prisma-swing.js";

const $ = id => document.getElementById(id);
const PRICE_DEC = { BTC: 2, ETH: 2, XRP: 5 };
let asset = "BTC";
let chartTf = "1m";
let swingTf = "1day";
let candles = [];
let engineState = null;
let swingState = null;
let lastTrade = null;
let chartLoadToken = 0;
let swingLoadToken = 0;

function fmtPrice(v, a = asset) {
  if (!Number.isFinite(+v)) return "—";
  return (+v).toLocaleString("en-US", { minimumFractionDigits: PRICE_DEC[a], maximumFractionDigits: PRICE_DEC[a] });
}
function fmtNum(v, d = 2) { return Number.isFinite(+v) ? (+v).toFixed(d) : "—"; }
function fmtPct(v, d = 2) { return Number.isFinite(+v) ? `${(+v * 100).toFixed(d)}%` : "—"; }
function ageText(iso) {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
function mtyTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("es-MX", { timeZone: "America/Monterrey", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return iso; }
}
function metric(label, value, cls = "") {
  return `<div class="metric-row"><div class="metric-label">${label}</div><div class="metric-value ${cls}">${value ?? "—"}</div></div>`;
}
function dirClass(v) {
  const x = String(v || "").toUpperCase();
  return x.includes("LONG") || x === "BULL" ? "long" : x.includes("SHORT") || x === "BEAR" ? "short" : x.includes("WATCH") ? "watch" : "neutral";
}
function finalAssetState() { return engineState?.assets?.[asset] || null; }
function currentLivePrice() { return lastTrade?.asset === asset ? lastTrade.price : candles[candles.length - 1]?.c; }

const live = new BitstampLive(trade => {
  if (trade.asset !== asset) return;
  lastTrade = trade;
  updateCurrentCandle(candles, trade, chartTf);
  updatePriceStrip();
  drawChart();
}, status => {
  $("market-health").textContent = `Bitstamp ${status.toLowerCase()}`;
  $("market-dot").className = `dot ${status === "LIVE" ? "ok" : status === "ERROR" ? "err" : "warn"}`;
});

async function loadChart() {
  const token = ++chartLoadToken;
  $("market-health").textContent = "Bitstamp cargando velas";
  $("market-dot").className = "dot warn";
  try {
    const data = await fetchBitstampCandles(asset, chartTf, 360);
    if (token !== chartLoadToken) return;
    candles = data;
    lastTrade = null;
    $("market-health").textContent = "Bitstamp live";
    $("market-dot").className = "dot ok";
    updatePriceStrip();
    drawChart();
  } catch (error) {
    if (token !== chartLoadToken) return;
    $("market-health").textContent = `Bitstamp error`;
    $("market-dot").className = "dot err";
    console.error(error);
  }
}

async function loadSwing() {
  const token = ++swingLoadToken;
  swingState = null;
  $("swing-state").className = "big-state neutral";
  $("swing-state").textContent = "CARGANDO";
  $("swing-note").textContent = "PRISMA: régimen + histéresis + sello rodante + Monte Carlo.";
  try {
    const response = await fetch(`/api/prisma-series?asset=${asset}&tf=${swingTf}`, { cache: "no-store" });
    const body = await response.json();
    if (token !== swingLoadToken) return;
    if (body.status !== "ok") throw new Error(body.message || "sin datos PRISMA");
    swingState = computePrismaSwing(body.candles, asset, swingTf);
    swingState.market_source = body.source;
    swingState.market_fallback_reason = body.fallback_reason;
    renderAll();
  } catch (error) {
    if (token !== swingLoadToken) return;
    swingState = { status: "ERROR", message: String(error.message || error) };
    renderAll();
  }
}

async function loadInitialEngineState() {
  try {
    const r = await fetch(`/api/state?ts=${Date.now()}`, { cache: "no-store" });
    const body = await r.json();
    if (!r.ok || body.status !== "ok") throw new Error(body.message || `HTTP ${r.status}`);
    engineState = body.data || null;
    $("engine-dot").className = engineState ? "dot ok" : "dot warn";
    $("engine-health").textContent = engineState ? "Motor D1 live" : "D1 sin snapshot";
  } catch (error) {
    $("engine-dot").className = "dot err";
    $("engine-health").textContent = "D1 error";
    console.error("D1 state", error);
  }
  renderAll();
}

async function loadUsage() {
  try {
    const r = await fetch("/api/usage", { cache: "no-store" });
    const body = await r.json();
    const u = body.usage || {};
    const writesEst = (u.publishes || 0) * 2 + (u.ws_connections || 0);
    $("usage-panel").innerHTML =
      metric("Publishes hoy", `${u.publishes || 0}`) +
      metric("DB writes app · estimado", `${writesEst.toLocaleString()} / 100,000`) +
      metric("Conexiones WS hoy", `${u.ws_connections || 0}`) +
      metric("Static assets", "gratis / ilimitados", "pos") +
      metric("Guard", writesEst < 50000 ? "SAFE" : "WATCH", writesEst < 50000 ? "pos" : "warn");
  } catch (_) {
    $("usage-panel").innerHTML = metric("Estado", "sin contador", "warn");
  }
}

function updatePriceStrip() {
  const px = currentLivePrice();
  $("asset-name").textContent = `${asset}/USD`;
  $("live-price").textContent = fmtPrice(px);
  $("market-age").textContent = lastTrade ? ageText(new Date(lastTrade.timestamp).toISOString()) : "REST";
  const base = candles.length > 1 ? candles[Math.max(0, candles.length - Math.min(candles.length, 1440))].o : null;
  const change = Number.isFinite(px) && Number.isFinite(base) ? px / base - 1 : null;
  $("live-change").textContent = change == null ? "—" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%`;
  $("live-change").className = `change ${change == null ? "" : change >= 0 ? "pos" : "neg"}`;
}

function renderSwing() {
  const st = swingState;
  if (!st) return;
  const el = $("swing-state");
  if (st.status === "ERROR") {
    el.textContent = "ERROR"; el.className = "big-state short";
    $("swing-note").textContent = st.message || "No fue posible calcular PRISMA Swing.";
    $("swing-plan").innerHTML = metric("Estado", "ERROR", "neg");
    return;
  }
  const regime = st.regime || "LAT";
  el.textContent = regime === "BULL" ? "LONG" : regime === "BEAR" ? "SHORT" : "LATERAL";
  el.className = `big-state ${dirClass(regime)}`;
  $("swing-note").textContent = `${st.market_source || "PRISMA"} · ${swingTf.toUpperCase()} · ${st.plan?.sealed ? "SELLADO" : st.status}`;
  const p = st.plan;
  if (!p) {
    $("swing-plan").innerHTML = metric("Régimen", regime) + metric("Setup", "SIN SETUP DIRECCIONAL", "warn") + metric("Regla", "esperar confirmación");
    return;
  }
  $("swing-plan").innerHTML =
    metric("Dirección", p.dir, p.dir === "LONG" ? "pos" : "neg") +
    metric("Entrada / sello", fmtPrice(p.entry)) +
    metric("SL", fmtPrice(p.sl), "neg") +
    metric("TP1", `${fmtPrice(p.tp1)} · P ${p.pTp1}%`, "pos") +
    metric("TP2", `${fmtPrice(p.tp2)} · P ${p.pTp2}%`, "pos") +
    metric("R:R TP1", fmtNum(p.rr, 2)) +
    metric("Generación", `${p.gen || st.generation || 1}`) +
    metric("Sello", mtyTime(p.anchorT || p.ts));
}

function renderTactical(a) {
  const t = a?.tactical || {};
  const h = a?.htf || {};
  const d = a?.decision || {};
  $("tactical-state").textContent = t.actionable && t.direction && t.direction !== "NONE" ? t.direction : `${t.state || "WAIT"}${t.candidate_side && t.candidate_side !== "NONE" ? ` · ${t.candidate_side}` : ""}`;
  $("tactical-state").className = `big-state ${dirClass(t.actionable ? t.direction : t.state === "WATCH" ? `WATCH ${t.candidate_side}` : t.candidate_side)}`;
  $("tactical-note").textContent = `score ${fmtNum(t.clear_score, 3)} · ${t.signal_origin || "sin señal confirmada"}`;
  $("htf-state").textContent = h.gate || "—";
  $("htf-state").className = `big-state ${h.allowed ? "watch" : "short"}`;
  $("htf-note").textContent = h.allowed ? "PASS / no crea entrada" : (h.gate_reason || "BLOCKED");

  const action = d.action || "WAIT";
  $("final-decision").textContent = action;
  $("final-decision").className = `decision ${action === "LONG" ? "long" : action === "SHORT" ? "short" : "wait"}`;
  $("decision-reason").textContent = action === "WAIT" ? `${d.reason || "NO ACTION"} · candidato ${d.candidate || "NONE"}` : `${d.reason || "ENTRY CONFIRMED"}`;

  const g = t.preview_geometry || {};
  const L = g.LONG || {}, S = g.SHORT || {};
  $("tactical-plan").innerHTML =
    `<div class="badge ok">LONG</div>` +
    metric("Entry", fmtPrice(L.entry)) + metric("SL", fmtPrice(L.sl), "neg") + metric("TP1", fmtPrice(L.tp1), "pos") + metric("TP2", fmtPrice(L.tp2), "pos") + metric("TP3", fmtPrice(L.tp3), "pos") +
    `<div style="height:8px"></div><div class="badge bad">SHORT</div>` +
    metric("Entry", fmtPrice(S.entry)) + metric("SL", fmtPrice(S.sl), "neg") + metric("TP1", fmtPrice(S.tp1), "pos") + metric("TP2", fmtPrice(S.tp2), "pos") + metric("TP3", fmtPrice(S.tp3), "pos");
}

function renderPivot(a) {
  const p = a?.tac || {};
  const iso = p.next_pivot_utc;
  if (!iso) {
    $("pivot-state").textContent = p.pivot_confirmation || "—";
    $("pivot-note").textContent = "sin próximo pivote publicado";
    return;
  }
  const mins = Math.max(0, (Date.parse(iso) - Date.now()) / 60000);
  $("pivot-state").textContent = mins < 60 ? `${Math.floor(mins)}m ${Math.floor((mins % 1) * 60)}s` : `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
  $("pivot-state").className = `big-state ${dirClass(p.direction)}`;
  $("pivot-note").textContent = `${p.direction || ""} · ${mtyTime(p.next_pivot_monterrey || iso)} · ${p.label || p.event || ""}`;
}

function renderOptions(a) {
  const o = a?.options || {};
  const candidate = o.selected || (o.watch_direction === "SHORT" ? o.top_short : o.top_long) || o.top_long || o.top_short;
  if (!candidate) {
    $("options-panel").innerHTML = metric("Estado", o.status || "NO DATA", "warn") + metric("Dirección primaria", o.primary_direction || "WAIT");
    return;
  }
  $("options-panel").innerHTML =
    metric("Estado", o.selected ? "SELECTED" : "WATCH ONLY", o.selected ? "pos" : "warn") +
    metric("Dirección", candidate.direction || o.watch_direction || "WAIT") +
    metric("Estrategia", candidate.strategy || "—") +
    metric("Strikes", candidate.strikes || "—") +
    metric("Expiry", candidate.expiry_utc ? mtyTime(candidate.expiry_utc) : "—") +
    metric("Débito USD", Number.isFinite(+candidate.entry_debit_usd_approx) ? `$${fmtNum(candidate.entry_debit_usd_approx, 2)}` : "—") +
    metric("Max loss", Number.isFinite(+candidate.max_loss_usd_approx) ? `$${fmtNum(candidate.max_loss_usd_approx, 2)}` : "—", "neg") +
    metric("Max profit", Number.isFinite(+candidate.max_profit_usd_approx) ? `$${fmtNum(candidate.max_profit_usd_approx, 2)}` : "—", "pos") +
    metric("Breakeven", fmtPrice(candidate.breakeven_usd_approx)) +
    metric("PnL TP1", Number.isFinite(+candidate.pnl_tp1_usd_approx) ? `$${fmtNum(candidate.pnl_tp1_usd_approx, 2)}` : "—", (+candidate.pnl_tp1_usd_approx || 0) >= 0 ? "pos" : "neg") +
    metric("PnL SL", Number.isFinite(+candidate.pnl_sl_usd_approx) ? `$${fmtNum(candidate.pnl_sl_usd_approx, 2)}` : "—", "neg");
}

function renderInternals(a) {
  const f = a?.funding || {}, l = a?.liquidations || {};
  $("internals-panel").innerHTML =
    metric("Funding", f.rate == null ? (f.status || "NO DATA") : fmtPct(f.rate, 4), f.rate > 0 ? "warn" : "") +
    metric("Funding bias", f.bias || "—") +
    metric("Liquidation flow", l.pressure || l.status || "NO DATA") +
    metric("Liquidity above", typeof l.nearest_above === "object" ? JSON.stringify(l.nearest_above) : fmtPrice(l.nearest_above)) +
    metric("Liquidity below", typeof l.nearest_below === "object" ? JSON.stringify(l.nearest_below) : fmtPrice(l.nearest_below));
}

function renderDecisionDetail(a) {
  const d = a?.decision || { action: "WAIT" }, h = a?.htf || {}, t = a?.tactical || {};
  const reasons = (h.reasons || []).map(r => `<li>${r}</li>`).join("");
  $("decision-detail").innerHTML =
    `<div class="decision-main ${d.action === "LONG" ? "pos" : d.action === "SHORT" ? "neg" : ""}">${d.action || "WAIT"}</div>` +
    `<div class="small">${d.action === "WAIT" ? "No abrir posición todavía." : "Entrada habilitada por el fork y el gate HTF."}</div>` +
    metric("Candidato", d.candidate || t.candidate_side || "NONE") +
    metric("Actionable", d.actionable ? "YES" : "NO", d.actionable ? "pos" : "warn") +
    metric("Gate", h.gate || "—", h.allowed ? "pos" : "neg") +
    metric("Razón", d.reason || h.gate_reason || "—") +
    (reasons ? `<ul class="reason-list">${reasons}</ul>` : "");
}

function renderAlignment(a) {
  const swingDir = swingState?.plan?.dir || (swingState?.regime === "BULL" ? "LONG" : swingState?.regime === "BEAR" ? "SHORT" : "WAIT");
  const tacticalDir = a?.decision?.action !== "WAIT" ? a?.decision?.action : a?.decision?.candidate || "WAIT";
  let alignment = "NEUTRAL";
  if ((swingDir === "LONG" || swingDir === "SHORT") && swingDir === tacticalDir) alignment = `ALIGN ${swingDir}`;
  else if ((swingDir === "LONG" || swingDir === "SHORT") && (tacticalDir === "LONG" || tacticalDir === "SHORT") && swingDir !== tacticalDir) alignment = "CONFLICT";
  else if (swingDir !== "WAIT") alignment = `SWING ${swingDir} / ENTRY WAIT`;
  $("alignment-panel").innerHTML =
    metric("PRISMA Swing", swingDir, swingDir === "LONG" ? "pos" : swingDir === "SHORT" ? "neg" : "") +
    metric("TAC / Fork", tacticalDir, tacticalDir === "LONG" ? "pos" : tacticalDir === "SHORT" ? "neg" : "warn") +
    metric("Alignment", alignment, alignment.startsWith("ALIGN") ? "pos" : alignment === "CONFLICT" ? "neg" : "warn");
}

function renderSystem(a) {
  const sys = engineState?.system || {};
  const decisionAge = a?.tactical?.cutoff_utc ? ageText(a.tactical.cutoff_utc) : "—";
  $("engine-age").textContent = engineState?.generated_utc ? ageText(engineState.generated_utc) : "—";
  const file = (label, obj) => metric(label, obj?.status ? `${obj.status} · ${obj.age_seconds ?? "—"}s` : "—", obj?.status === "OK" && (obj.age_seconds ?? 9999) < 300 ? "pos" : "warn");
  $("system-panel").innerHTML =
    metric("Cloudflare", "LIVE", "pos") +
    metric("Fork cutoff", decisionAge, decisionAge.endsWith("s") || decisionAge.endsWith("m") ? "pos" : "warn") +
    file("Decision file", sys.decision_file) +
    file("Screener file", sys.screener_file) +
    file("Options file", sys.options_file) +
    metric("Orders", engineState?.orders_enabled ? "ENABLED" : "DISABLED", engineState?.orders_enabled ? "neg" : "pos");
}

function renderAll() {
  updatePriceStrip();
  renderSwing();
  const a = finalAssetState();
  if (!a) {
    $("engine-dot").className = "dot warn";
    $("engine-health").textContent = "D1 esperando snapshot";
    $("tactical-state").textContent = "WAIT";
    $("tactical-note").textContent = "Esperando el primer snapshot de D1.";
    $("htf-state").textContent = "—";
    $("pivot-state").textContent = "—";
    $("tactical-plan").innerHTML = metric("Estado", "SIN SNAPSHOT", "warn");
    $("options-panel").innerHTML = metric("Estado", "SIN SNAPSHOT", "warn");
    $("internals-panel").innerHTML = metric("Estado", "SIN SNAPSHOT", "warn");
    $("decision-detail").innerHTML = `<div class="decision-main">WAIT</div><div class="small">Esperando publicación del fork.</div>`;
    $("alignment-panel").innerHTML = metric("PRISMA Swing", swingState?.plan?.dir || "—") + metric("TAC / Fork", "WAIT") + metric("Alignment", "PENDING", "warn");
    renderSystem(null);
    drawChart();
    return;
  }
  renderTactical(a);
  renderPivot(a);
  renderOptions(a);
  renderInternals(a);
  renderDecisionDetail(a);
  renderAlignment(a);
  renderSystem(a);
  drawChart();
}

function chartLevels() {
  const levels = [];
  const p = swingState?.plan;
  if (p) {
    levels.push({ value: p.sl, label: "SW SL", color: "#D64545", dash: [] });
    levels.push({ value: p.tp1, label: "SW TP1", color: "#E08A00", dash: [] });
    levels.push({ value: p.tp2, label: "SW TP2", color: "#E08A00", dash: [4, 4] });
  }
  const t = finalAssetState()?.tactical?.preview_geometry || {};
  const candidate = finalAssetState()?.decision?.candidate;
  const g = candidate === "SHORT" ? t.SHORT : candidate === "LONG" ? t.LONG : null;
  if (g) {
    levels.push({ value: g.entry, label: `TAC ${candidate} E`, color: "#1F8EAA", dash: [5, 4] });
    levels.push({ value: g.sl, label: "TAC SL", color: "#D64545", dash: [5, 4] });
    levels.push({ value: g.tp1, label: "TAC TP1", color: "#1E9E5A", dash: [5, 4] });
    levels.push({ value: g.tp2, label: "TAC TP2", color: "#1E9E5A", dash: [2, 4] });
    levels.push({ value: g.tp3, label: "TAC TP3", color: "#157347", dash: [2, 4] });
  }
  return levels.filter(x => Number.isFinite(+x.value));
}

function drawChart() {
  const canvas = $("chart");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(320, rect.width || 1000), cssH = Math.max(320, Math.min(560, cssW * .42));
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cssW, cssH);
  if (!candles.length) {
    ctx.fillStyle = "#8A8A8E"; ctx.font = "12px Space Mono"; ctx.fillText("Cargando Bitstamp…", 18, 30); return;
  }
  const pad = { l: 14, r: 86, t: 12, b: 28 };
  const series = candles.slice(-220);
  const levels = chartLevels();
  let lo = Math.min(...series.map(c => c.l), ...levels.map(x => +x.value));
  let hi = Math.max(...series.map(c => c.h), ...levels.map(x => +x.value));
  const span = Math.max(hi - lo, Math.abs(hi) * .001); lo -= span * .06; hi += span * .06;
  const pw = cssW - pad.l - pad.r, ph = cssH - pad.t - pad.b;
  const x = i => pad.l + (i + .5) * pw / series.length;
  const y = v => pad.t + (hi - v) / (hi - lo) * ph;

  ctx.strokeStyle = "#ededee"; ctx.lineWidth = 1; ctx.font = "9px Space Mono"; ctx.fillStyle = "#8A8A8E";
  for (let k = 0; k <= 5; k++) {
    const yy = pad.t + ph * k / 5; const val = hi - (hi - lo) * k / 5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(cssW - pad.r, yy); ctx.stroke();
    ctx.fillText(fmtPrice(val), cssW - pad.r + 8, yy + 3);
  }
  const bodyW = Math.max(1, Math.min(8, pw / series.length * .65));
  series.forEach((c, i) => {
    const xx = x(i), up = c.c >= c.o, col = up ? "#1E9E5A" : "#D64545";
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xx, y(c.h)); ctx.lineTo(xx, y(c.l)); ctx.stroke();
    const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
    ctx.fillRect(xx - bodyW / 2, top, bodyW, Math.max(1, bot - top));
  });

  levels.forEach(level => {
    const yy = y(+level.value); ctx.save(); ctx.strokeStyle = level.color; ctx.lineWidth = 1.25; ctx.setLineDash(level.dash || []);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(cssW - pad.r, yy); ctx.stroke(); ctx.restore();
    ctx.fillStyle = level.color; ctx.font = "700 9px Space Mono"; ctx.fillText(`${level.label} ${fmtPrice(level.value)}`, pad.l + 4, Math.max(10, yy - 3));
  });

  const ticks = [0, Math.floor(series.length * .33), Math.floor(series.length * .66), series.length - 1];
  ctx.fillStyle = "#8A8A8E"; ctx.font = "9px Space Mono";
  ticks.forEach(i => { const d = new Date(series[i].t); ctx.fillText(d.toLocaleString("es-MX", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }), x(i) - 30, cssH - 8); });
}

function selectAsset(next) {
  asset = next;
  document.querySelectorAll(".asset-btn").forEach(b => b.classList.toggle("sel", b.dataset.asset === asset));
  live.connect(asset);
  loadChart(); loadSwing(); renderAll();
}
function selectChartTf(next) {
  chartTf = next;
  document.querySelectorAll(".tf-btn").forEach(b => b.classList.toggle("sel", b.dataset.tf === chartTf));
  loadChart();
}

document.querySelectorAll(".asset-btn").forEach(b => b.addEventListener("click", () => selectAsset(b.dataset.asset)));
document.querySelectorAll(".tf-btn").forEach(b => b.addEventListener("click", () => selectChartTf(b.dataset.tf)));
$("swing-tf").addEventListener("change", e => { swingTf = e.target.value; loadSwing(); });
window.addEventListener("resize", () => drawChart());
setInterval(() => { renderPivot(finalAssetState()); $("engine-age").textContent = engineState?.generated_utc ? ageText(engineState.generated_utc) : "—"; }, 1000);
setInterval(loadUsage, 5 * 60 * 1000);
setInterval(loadInitialEngineState, 30 * 1000);

await Promise.allSettled([loadInitialEngineState(), loadChart(), loadSwing(), loadUsage()]);
live.connect(asset);
renderAll();
