const BITSTAMP_SYMBOL = { BTC: "btcusd", ETH: "ethusd", XRP: "xrpusd" };
const STEP = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };

export async function fetchMarketCandles(asset, timeframe = "1m", limit = 420) {
  const response = await fetch(`/api/market-ohlc?asset=${encodeURIComponent(asset)}&tf=${encodeURIComponent(timeframe)}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok || body.status !== "ok") throw new Error(body.message || `market OHLC HTTP ${response.status}`);
  return (body.candles || [])
    .map(x => ({ t:+x.t, o:+x.o, h:+x.h, l:+x.l, c:+x.c, v:+x.v || 0 }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.c) && x.c > 0)
    .sort((a,b)=>a.t-b.t)
    .slice(-Math.max(50, Math.min(+limit || 420, 1000)));
}

export const fetchBitstampCandles = fetchMarketCandles;

export class BitstampLive {
  constructor(onTrade, onStatus) {
    this.onTrade = onTrade;
    this.onStatus = onStatus;
    this.socket = null;
    this.asset = null;
    this.retry = 0;
    this.closedByUser = false;
  }

  connect(asset) {
    this.disconnect();
    this.asset = asset;
    const symbol = BITSTAMP_SYMBOL[asset];
    if (!symbol) { this.onStatus?.("REST"); return; }
    this.closedByUser = false;
    const socket = new WebSocket("wss://ws.bitstamp.net");
    this.socket = socket;
    this.onStatus?.("CONNECTING");

    socket.onopen = () => {
      this.retry = 0;
      socket.send(JSON.stringify({ event: "bts:subscribe", data: { channel: `live_trades_${symbol}` } }));
      this.onStatus?.("LIVE");
    };

    socket.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event !== "trade" || !msg.data) return;
        const price = +(msg.data.price ?? msg.data.price_str);
        if (!Number.isFinite(price) || price <= 0) return;
        const ts = msg.data.microtimestamp ? Math.floor(+msg.data.microtimestamp / 1000) : (+msg.data.timestamp * 1000 || Date.now());
        this.onTrade?.({
          asset, price, amount: +(msg.data.amount ?? msg.data.amount_str) || 0,
          side: +msg.data.type === 0 ? "BUY" : "SELL", timestamp: ts, source: "BITSTAMP_WS"
        });
      } catch (_) {}
    };

    socket.onerror = () => this.onStatus?.("ERROR");
    socket.onclose = () => {
      if (this.closedByUser || this.socket !== socket) return;
      this.onStatus?.("RECONNECTING");
      const delay = Math.min(15000, 1200 * (2 ** Math.min(this.retry++, 4))) + Math.random() * 900;
      setTimeout(() => { if (!this.closedByUser && this.asset === asset) this.connect(asset); }, delay);
    };
  }

  disconnect() {
    this.closedByUser = true;
    const old = this.socket;
    this.socket = null;
    if (old) { try { old.close(); } catch (_) {} }
  }
}

export function updateCurrentCandle(candles, trade, timeframe = "1m") {
  const stepMs = (STEP[timeframe] || 60) * 1000;
  const bucket = Math.floor(trade.timestamp / stepMs) * stepMs;
  const last = candles[candles.length - 1];
  if (!last || bucket > last.t) {
    const open = last?.c ?? trade.price;
    candles.push({ t: bucket, o: open, h: trade.price, l: trade.price, c: trade.price, v: trade.amount || 0 });
    if (candles.length > 1000) candles.shift();
    return;
  }
  if (bucket === last.t) {
    last.h = Math.max(last.h, trade.price);
    last.l = Math.min(last.l, trade.price);
    last.c = trade.price;
    last.v += trade.amount || 0;
  }
}
