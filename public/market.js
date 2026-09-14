const BITSTAMP_SYMBOL = { BTC: "btcusd", ETH: "ethusd", XRP: "xrpusd" };
const STEP = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

export async function fetchBitstampCandles(asset, timeframe = "1m", limit = 320) {
  const symbol = BITSTAMP_SYMBOL[asset];
  const step = STEP[timeframe] || 60;
  const url = `https://www.bitstamp.net/api/v2/ohlc/${symbol}/?step=${step}&limit=${Math.min(limit, 1000)}`;
  let rows;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Bitstamp OHLC HTTP ${response.status}`);
    const body = await response.json();
    rows = (body?.data?.ohlc || []).map(x => ({
      t: +x.timestamp * 1000, o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume || 0
    }));
  } catch (directError) {
    const fallback = await fetch(`/api/bitstamp-ohlc?asset=${asset}&tf=${timeframe}`, { cache: "no-store" });
    const body = await fallback.json();
    if (body.status !== "ok") throw directError;
    rows = body.candles || [];
  }
  return rows.filter(x => Number.isFinite(x.c) && x.c > 0).sort((a, b) => a.t - b.t);
}

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
    this.closedByUser = false;
    const symbol = BITSTAMP_SYMBOL[asset];
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
        const ts = msg.data.microtimestamp
          ? Math.floor(+msg.data.microtimestamp / 1000)
          : (+msg.data.timestamp * 1000 || Date.now());
        this.onTrade?.({
          asset,
          price,
          amount: +(msg.data.amount ?? msg.data.amount_str) || 0,
          side: +msg.data.type === 0 ? "BUY" : "SELL",
          timestamp: ts,
          source: "BITSTAMP_WS"
        });
      } catch (_) {}
    };

    socket.onerror = () => this.onStatus?.("ERROR");
    socket.onclose = () => {
      if (this.closedByUser || this.socket !== socket) return;
      this.onStatus?.("RECONNECTING");
      const delay = Math.min(15000, 1200 * (2 ** Math.min(this.retry++, 4))) + Math.random() * 900;
      setTimeout(() => {
        if (!this.closedByUser && this.asset === asset) this.connect(asset);
      }, delay);
    };
  }

  disconnect() {
    this.closedByUser = true;
    const old = this.socket;
    this.socket = null;
    if (old) {
      try { old.close(); } catch (_) {}
    }
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
