import { DurableObject } from "cloudflare:workers";

const APP_VERSION = "0.4.0";
const HUB_NAME = "global";
const ASSETS = new Set(["BTC","ETH","XRP","GC","MXN","CL","NG","ZW","ZC","ES","NQ"]);
const CRYPTO_ASSETS = new Set(["BTC","ETH","XRP"]);
const YAHOO_TICKER = {
  GC:"GC=F", MXN:"MXN=X", CL:"CL=F", NG:"NG=F", ZW:"ZW=F", ZC:"ZC=F", ES:"ES=F", NQ:"NQ=F"
};
const TACTICAL_TFS = new Set(["1m","5m","15m","1h","4h"]);
const TF_MAP = {
  "1m":"1","5m":"5","15m":"15","1h":"60","4h":"240"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}


async function d1Latest(env) {
  if (!env.DB) throw new Error("D1 binding DB no configurado");
  const row = await env.DB.prepare(
    "SELECT generated_utc, state_hash, schema_version, payload, updated_at FROM crypto_state_latest WHERE id = 1"
  ).first();
  if (!row) return null;
  let payload = null;
  try { payload = JSON.parse(row.payload); }
  catch (error) { throw new Error(`D1 payload inválido: ${error.message || error}`); }
  return {
    payload,
    generated_utc: row.generated_utc,
    state_hash: row.state_hash,
    schema_version: row.schema_version,
    updated_at: row.updated_at
  };
}

async function handleD1State(env) {
  try {
    const latest = await d1Latest(env);
    return json({
      status: "ok",
      source: "D1",
      data: latest?.payload || null,
      meta: latest ? {
        generated_utc: latest.generated_utc,
        state_hash: latest.state_hash,
        schema_version: latest.schema_version,
        updated_at: latest.updated_at
      } : null
    });
  } catch (error) {
    return json({ status: "error", source: "D1", message: String(error.message || error) }, 503);
  }
}

async function handleD1Health(env) {
  try {
    const latest = await d1Latest(env);
    const generated = latest?.generated_utc ? Date.parse(latest.generated_utc) : NaN;
    const age = Number.isFinite(generated) ? Math.max(0, Math.round((Date.now() - generated) / 1000)) : null;
    return json({
      status: "ok",
      worker_version: APP_VERSION,
      state_source: "D1",
      latest_state: latest ? "available" : "empty",
      state_age_seconds: age,
      state_hash: latest?.state_hash || null,
      d1_updated_at: latest?.updated_at || null
    });
  } catch (error) {
    return json({ status: "degraded", worker_version: APP_VERSION, state_source: "D1", error: String(error.message || error) }, 503);
  }
}

function hub(env) {
  return env.CRYPTO_HUB.getByName(HUB_NAME);
}

function safeTokenEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorizedPublisher(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return safeTokenEqual(auth.slice(7), env.PUBLISH_TOKEN || "");
}

function saneaVelas(rows) {
  rows.sort((a, b) => a.t - b.t);
  const ded = [];
  for (const row of rows) {
    if (ded.length && ded[ded.length - 1].t === row.t) ded[ded.length - 1] = row;
    else ded.push(row);
  }
  if (ded.length < 2) return ded;
  const lim = Math.log(3);
  const segments = [];
  let seg = [ded[0]];
  for (let i = 1; i < ded.length; i++) {
    if (Math.abs(Math.log(ded[i].c / ded[i - 1].c)) > lim) {
      segments.push(seg);
      seg = [ded[i]];
    } else seg.push(ded[i]);
  }
  segments.push(seg);
  return segments.reduce((best, current) => current.length > best.length ? current : best, segments[0]);
}


function bitstampSymbol(asset) {
  return { BTC: "btcusd", ETH: "ethusd", XRP: "xrpusd" }[asset];
}

async function bitstampOhlcPage(asset, step, limit = 1000, end = null) {
  const symbol = bitstampSymbol(asset);
  if (!symbol) throw new Error(`Bitstamp symbol no configurado para ${asset}`);
  const params = new URLSearchParams({ step: String(step), limit: String(limit) });
  if (end) params.set("end", String(Math.floor(end / 1000)));
  const upstream = `https://www.bitstamp.net/api/v2/ohlc/${symbol}/?${params.toString()}`;
  const response = await fetch(upstream, { headers: { "user-agent": "PRISMA-Crypto/0.4.0" } });
  if (!response.ok) throw new Error(`Bitstamp HTTP ${response.status}`);
  const body = await response.json();
  const rows = (body?.data?.ohlc || []).map(x => ({
    t: +x.timestamp * 1000, o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume || 0
  })).filter(x => Number.isFinite(x.c) && x.c > 0);
  if (!rows.length) throw new Error("Bitstamp serie vacía");
  return saneaVelas(rows);
}


async function prismaSeries(asset, tf) {
  if (!ASSETS.has(asset) || !TACTICAL_TFS.has(tf)) throw new Error(`timeframe táctico no soportado: ${tf}`);
  if (CRYPTO_ASSETS.has(asset)) {
    const step = {"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400}[tf];
    return { candles: await bitstampOhlcPage(asset, step, 500), source: "BITSTAMP" };
  }
  return { candles: await yahooSeries(asset, tf), source: "YAHOO_FINANCE" };
}



function aggregateFixed(rows, hours) {
  const ms=hours*3600e3, buckets=new Map();
  for(const x of rows){
    const t=Math.floor(x.t/ms)*ms, k=String(t), b=buckets.get(k);
    if(!b)buckets.set(k,{t,o:x.o,h:x.h,l:x.l,c:x.c,v:x.v||0});
    else{b.h=Math.max(b.h,x.h);b.l=Math.min(b.l,x.l);b.c=x.c;b.v+=x.v||0;}
  }
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}

async function yahooSeries(asset, tf) {
  const ticker=YAHOO_TICKER[asset];
  if(!ticker)throw new Error(`Yahoo ticker no configurado para ${asset}`);
  const spec={
    "1m":{interval:"1m",range:"7d"},
    "5m":{interval:"5m",range:"60d"},
    "15m":{interval:"15m",range:"60d"},
    "1h":{interval:"1h",range:"730d"},
    "4h":{interval:"1h",range:"730d",aggregate:4}
  }[tf];
  if(!spec)throw new Error(`timeframe táctico no soportado: ${tf}`);
  const q=new URLSearchParams({interval:spec.interval,range:spec.range,includePrePost:"true",events:"div,splits"});
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${q.toString()}`;
  const response=await fetch(url,{headers:{"user-agent":"PRISMA-Crypto/0.4"}});
  if(!response.ok)throw new Error(`Yahoo HTTP ${response.status}`);
  const body=await response.json(), chart=body?.chart||{};
  if(chart.error)throw new Error(`Yahoo ${chart.error.description||chart.error.code||"error"}`);
  const result=chart.result?.[0], ts=result?.timestamp||[], quote=result?.indicators?.quote?.[0]||{};
  const rows=[];
  for(let i=0;i<ts.length;i++){
    const o=+quote.open?.[i],h=+quote.high?.[i],l=+quote.low?.[i],c=+quote.close?.[i],v=+quote.volume?.[i]||0;
    if([o,h,l,c].every(Number.isFinite)&&c>0)rows.push({t:+ts[i]*1000,o,h,l,c,v});
  }
  if(rows.length<10)throw new Error("Yahoo serie vacía");
  const clean=saneaVelas(rows);
  return spec.aggregate?aggregateFixed(clean,spec.aggregate):clean;
}

async function handleMarketOhlc(request) {
  const url=new URL(request.url);
  const asset=(url.searchParams.get("asset")||"BTC").toUpperCase();
  const tf=url.searchParams.get("tf")||"15m";
  if(!ASSETS.has(asset)||!TACTICAL_TFS.has(tf))return json({status:"error",message:"asset/timeframe táctico no permitido"},400);
  const cache=caches.default, ck=new Request(`${url.origin}/__cache/market?asset=${asset}&tf=${tf}`);
  const cached=await cache.match(ck); if(cached)return cached;
  try{
    let rows,source;
    if(CRYPTO_ASSETS.has(asset)){
      const step={"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400}[tf];
      rows=await bitstampOhlcPage(asset,step,500); source="BITSTAMP";
    }else{
      rows=await yahooSeries(asset,tf); source="YAHOO_FINANCE";
    }
    rows=rows.slice(-500);
    const ttl={"1m":20,"5m":60,"15m":120,"1h":300,"4h":600}[tf]||120;
    const out=json({status:"ok",source,asset,tf,generated_utc:new Date().toISOString(),candles:rows},200,{"cache-control":`public, s-maxage=${ttl}`});
    await cache.put(ck,out.clone()); return out;
  }catch(error){return json({status:"error",message:String(error.message||error)},502);}
}

async function handleBitstampOhlc(request) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC").toUpperCase();
  const tf = url.searchParams.get("tf") || "1m";
  const symbol = { BTC: "btcusd", ETH: "ethusd", XRP: "xrpusd" }[asset];
  const step = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 }[tf];
  if (!symbol || !step) return json({ status: "error", message: "asset/timeframe no permitido" }, 400);
  const upstream = `https://www.bitstamp.net/api/v2/ohlc/${symbol}/?step=${step}&limit=360`;
  const cache = caches.default;
  const ck = new Request(`${url.origin}/__cache/bitstamp?asset=${asset}&tf=${tf}`);
  const cached = await cache.match(ck);
  if (cached) return cached;
  try {
    const r = await fetch(upstream);
    if (!r.ok) throw new Error(`Bitstamp HTTP ${r.status}`);
    const b = await r.json();
    const rows = (b?.data?.ohlc || []).map(x => ({
      t: +x.timestamp * 1000, o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume || 0
    })).filter(x => Number.isFinite(x.c) && x.c > 0);
    const ttl = tf === "1m" ? 20 : tf === "5m" ? 60 : tf === "15m" ? 120 : tf === "1h" ? 300 : 600;
    const out = json({ status: "ok", source: "BITSTAMP_WORKER_FALLBACK", asset, tf, candles: rows }, 200, { "cache-control": `public, s-maxage=${ttl}` });
    await cache.put(ck, out.clone());
    return out;
  } catch (error) {
    return json({ status: "error", message: String(error.message || error) }, 502);
  }
}

async function handlePrismaSeries(request) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC").toUpperCase();
  const tf = url.searchParams.get("tf") || "15m";
  if (!ASSETS.has(asset)) return json({ status: "error", message: "asset no permitido" }, 400);
  if (!TACTICAL_TFS.has(tf)) return json({ status: "error", message: "timeframe táctico no permitido" }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__cache/prisma-series?asset=${asset}&tf=${tf}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const result = await prismaSeries(asset, tf);
    const ttl = { "1m": 20, "5m": 60, "15m": 120, "1h": 300, "4h": 900 }[tf] || 300;
    const response = json({
      status: "ok",
      asset,
      tf,
      source: result.source,
      fallback_reason: result.fallback_reason || null,
      generated_utc: new Date().toISOString(),
      candles: result.candles
    }, 200, { "cache-control": `public, s-maxage=${ttl}` });
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    return json({ status: "error", message: String(error.message || error) }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return handleD1Health(env);
    }

    if (url.pathname === "/api/state") {
      return handleD1State(env);
    }

    if (url.pathname === "/api/usage") {
      return hub(env).fetch("https://hub/usage");
    }

    if (url.pathname === "/api/ws") {
      if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
        return json({ status: "error", message: "WebSocket upgrade requerido" }, 426);
      }
      return hub(env).fetch(request);
    }

    if (url.pathname === "/api/publish") {
      if (request.method !== "POST") return json({ status: "error", message: "POST requerido" }, 405);
      if (!authorizedPublisher(request, env)) return json({ status: "error", message: "no autorizado" }, 401);
      const length = +(request.headers.get("content-length") || 0);
      if (length > 1_000_000) return json({ status: "error", message: "payload demasiado grande" }, 413);
      let payload;
      try { payload = await request.json(); }
      catch { return json({ status: "error", message: "JSON inválido" }, 400); }
      if (payload?.schema_version !== "1.0" || !payload?.assets) {
        return json({ status: "error", message: "schema_version 1.0 y assets son requeridos" }, 400);
      }
      for (const asset of Object.keys(payload.assets)) {
        if (!ASSETS.has(asset)) return json({ status: "error", message: `asset inesperado: ${asset}` }, 400);
      }
      return hub(env).fetch("https://hub/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    }


    if (url.pathname === "/api/market-ohlc") {
      return handleMarketOhlc(request);
    }

    if (url.pathname === "/api/bitstamp-ohlc") {
      return handleBitstampOhlc(request);
    }

    if (url.pathname === "/api/prisma-series") {
      return handlePrismaSeries(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class CryptoHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch (_) {
      // Safe fallback on local runtimes that do not expose auto-response yet.
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if ((url.pathname === "/api/ws" || url.pathname === "/ws") &&
        (request.headers.get("upgrade") || "").toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ connected_utc: new Date().toISOString() });
      const latest = await this.ctx.storage.get("latest");
      if (latest) server.send(JSON.stringify({ type: "state", data: latest }));
      await this.bumpUsage("ws_connections", 1);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/state") {
      const latest = await this.ctx.storage.get("latest");
      return json({ status: "ok", data: latest || null });
    }

    if (url.pathname === "/usage") {
      const usage = await this.getUsage();
      return json({ status: "ok", usage, note: "Contadores de esta aplicación; no son métricas oficiales de toda la cuenta Cloudflare." });
    }

    if (url.pathname === "/health") {
      const latest = await this.ctx.storage.get("latest");
      const generated = latest?.generated_utc ? Date.parse(latest.generated_utc) : NaN;
      const age = Number.isFinite(generated) ? Math.max(0, Math.round((Date.now() - generated) / 1000)) : null;
      return json({
        hub: "ok",
        latest_state: latest ? "available" : "empty",
        state_age_seconds: age,
        websocket_clients: this.ctx.getWebSockets().length
      });
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      const payload = await request.json();
      const previous = await this.ctx.storage.get("latest");
      const revision = (previous?.revision || 0) + 1;
      const next = {
        ...payload,
        revision,
        received_utc: new Date().toISOString()
      };
      await this.ctx.storage.put("latest", next);
      await this.bumpUsage("publishes", 1);
      const message = JSON.stringify({ type: "state", data: next });
      let delivered = 0;
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(message); delivered++; } catch (_) {}
      }
      return json({ status: "ok", revision, websocket_clients: delivered });
    }

    return json({ status: "error", message: "not found" }, 404);
  }

  async getUsage() {
    const day = new Date().toISOString().slice(0, 10);
    return (await this.ctx.storage.get(`usage:${day}`)) || {
      day_utc: day,
      publishes: 0,
      ws_connections: 0
    };
  }

  async bumpUsage(field, amount) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `usage:${day}`;
    const usage = (await this.ctx.storage.get(key)) || { day_utc: day, publishes: 0, ws_connections: 0 };
    usage[field] = (usage[field] || 0) + amount;
    await this.ctx.storage.put(key, usage);
  }

  async webSocketMessage(ws, message) {
    if (message === "ping") return; // handled by auto-response when available
    if (message === "state") {
      const latest = await this.ctx.storage.get("latest");
      ws.send(JSON.stringify({ type: "state", data: latest || null }));
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (_) {}
  }
}
