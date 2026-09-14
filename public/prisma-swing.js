// PRISMA Swing extraction for BTC/ETH/XRP.
// Ported from motor_site_v4_17 index.html without changing the regime/hysteresis/MC rules.

const HYST = 8;
const ASSET_ZZ = { BTC: 1.5, ETH: 2.8, XRP: 3.2 };
const TF_ZZMULT = { "1h": 1, "4h": 1.5, "1day": 2.5, "1week": 4, "1month": 6 };
const TF_MCH = { "1h": 72, "4h": 42, "1day": 30, "1week": 12, "1month": 6 };

function strHash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRnd(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zigzag(win, ZZ) {
  if (!win?.length) return [];
  const piv = [];
  let dir = null, eIdx = 0, ePx = win[0].c;
  for (let i = 1; i < win.length; i++) {
    const px = win[i].c;
    if (dir === null) {
      const chg = ((px - ePx) / ePx) * 100;
      if (Math.abs(chg) >= ZZ) {
        dir = chg > 0 ? 1 : -1;
        piv.push({ i: eIdx, t: win[eIdx]?.t ?? null, px: ePx, type: dir > 0 ? "L" : "H" });
        eIdx = i; ePx = px;
      }
    } else if (dir === 1) {
      if (px > ePx) { ePx = px; eIdx = i; }
      else if (((ePx - px) / ePx) * 100 >= ZZ) {
        piv.push({ i: eIdx, t: win[eIdx]?.t ?? null, px: ePx, type: "H" });
        dir = -1; eIdx = i; ePx = px;
      }
    } else {
      if (px < ePx) { ePx = px; eIdx = i; }
      else if (((px - ePx) / ePx) * 100 >= ZZ) {
        piv.push({ i: eIdx, t: win[eIdx]?.t ?? null, px: ePx, type: "L" });
        dir = 1; eIdx = i; ePx = px;
      }
    }
  }
  piv.push({ i: eIdx, t: win[eIdx]?.t ?? null, px: ePx, type: dir === 1 ? "H" : "L", open: true });
  for (let j = 0; j < piv.length; j++) {
    const prev = [...piv.slice(0, j)].reverse().find(p => p.type === piv[j].type);
    piv[j].label = prev
      ? (piv[j].type === "H" ? (piv[j].px > prev.px ? "HH" : "LH") : (piv[j].px > prev.px ? "HL" : "LL"))
      : piv[j].type;
  }
  return piv;
}

function fibContext(win, piv) {
  const closed = piv.filter(p => !p.open);
  if (closed.length < 2) return null;
  const p1 = closed[closed.length - 2], p2 = closed[closed.length - 1];
  const lo = Math.min(p1.px, p2.px), hi = Math.max(p1.px, p2.px), up = p2.px > p1.px;
  const lnH = Math.log(hi), lnL = Math.log(lo), rng = lnH - lnL;
  const fibLog = r => up ? Math.exp(lnH - rng * r) : Math.exp(lnL + rng * r);
  return {
    l382: fibLog(.382),
    l5: fibLog(.5),
    l618: fibLog(.618),
    l786: fibLog(.786),
    ext1272: up ? Math.exp(lnL + rng * 1.272) : Math.exp(lnH - rng * 1.272),
    ext1618: up ? Math.exp(lnL + rng * 1.618) : Math.exp(lnH - rng * 1.618),
    swingHi: hi,
    swingLo: lo,
    up,
    price: win[win.length - 1]?.c ?? null
  };
}

function regimeRaw(win, ZZ) {
  if (win.length < 51) return "LAT";
  const rets = [];
  for (let j = win.length - 50; j < win.length; j++) {
    rets.push(((win[j].c - win[j - 1].c) / win[j - 1].c) * 100);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const th = 0.04 * (ZZ / 1.5);
  if (mean > th && vol < mean * 30) return "BULL";
  if (mean < -th) return "BEAR";
  return "LAT";
}

function regimeConfirmedTs(candles, ZZ) {
  let conf = "LAT", pend = null, pendN = 0, idx = null;
  for (let i = 60; i < candles.length; i++) {
    const win = candles.slice(Math.max(0, i - 200), i + 1);
    const raw = regimeRaw(win, ZZ);
    if (raw !== conf) {
      if (pend === raw) pendN++;
      else { pend = raw; pendN = 1; }
      if (pendN >= HYST) { conf = raw; idx = i; pend = null; pendN = 0; }
    } else { pend = null; pendN = 0; }
  }
  return { conf, idx, ts: idx != null ? +candles[idx].t : null };
}

function mcPlan(candles, asset, tf, seal, fib) {
  let rnd = Math.random, px, win;
  const ZZ = ASSET_ZZ[asset] * TF_ZZMULT[tf];
  if (seal?.idx != null && candles[seal.idx]) {
    px = candles[seal.idx].c;
    win = candles.slice(Math.max(0, seal.idx - 199), seal.idx + 1);
    rnd = seededRnd(strHash32(`${asset.toLowerCase()}|${tf}|${seal.ts}`));
  } else {
    px = candles[candles.length - 1]?.c;
    win = candles.slice(-200);
  }
  if (!px || win.length < 50) return null;

  const rets = [];
  for (let i = 1; i < win.length; i++) rets.push(Math.log(win[i].c / win[i - 1].c));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sig = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);

  const N = 2000, H = TF_MCH[tf] || 72;
  const maxes = new Array(N), mins = new Array(N);
  for (let n = 0; n < N; n++) {
    let lp = Math.log(px), mx = px, mn = px;
    for (let h = 0; h < H; h++) {
      const u1 = rnd() || 1e-9, u2 = rnd();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      lp += sig * z;
      const p = Math.exp(lp);
      if (p > mx) mx = p;
      if (p < mn) mn = p;
    }
    maxes[n] = mx; mins[n] = mn;
  }
  maxes.sort((a, b) => a - b); mins.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))];

  const rawReg = seal ? seal.conf : regimeRaw(candles.slice(-200), ZZ);
  const dirLong = rawReg !== "BEAR";
  let tp1, tp2, sl;
  if (dirLong) {
    tp1 = q(maxes, .50); tp2 = q(maxes, .75); sl = q(mins, .25);
  } else {
    tp1 = q(mins, .50); tp2 = q(mins, .25); sl = q(maxes, .75);
  }

  const fibLevels = fib ? [
    ["ext 1.272", fib.ext1272], ["ext 1.618", fib.ext1618],
    ["swing alto", fib.swingHi], ["fib 0.382", fib.l382], ["fib 0.5", fib.l5],
    ["fib 0.618", fib.l618], ["fib 0.786", fib.l786], ["swing bajo", fib.swingLo]
  ].filter(x => x[1]) : [];

  function snap(level, ok) {
    for (const [name, fv] of fibLevels) {
      if (ok(fv) && Math.abs(level - fv) / level < .004) return { px: fv, conf: name };
    }
    return { px: level, conf: null };
  }

  const s1 = snap(tp1, v => dirLong ? v > px : v < px);
  const s2 = snap(tp2, v => dirLong ? v > px : v < px);
  const s3 = snap(sl, v => dirLong ? v < px : v > px);
  if (dirLong) {
    if (s1.px <= px) Object.assign(s1, { px: tp1, conf: null });
    if (s2.px <= px) Object.assign(s2, { px: tp2, conf: null });
    if (s3.px >= px) Object.assign(s3, { px: sl, conf: null });
  } else {
    if (s1.px >= px) Object.assign(s1, { px: tp1, conf: null });
    if (s2.px >= px) Object.assign(s2, { px: tp2, conf: null });
    if (s3.px <= px) Object.assign(s3, { px: sl, conf: null });
  }

  const cntGE = (arr, v) => { let c = 0; for (let i = arr.length - 1; i >= 0 && arr[i] >= v; i--) c++; return c; };
  const cntLE = (arr, v) => { let c = 0; for (let i = 0; i < arr.length && arr[i] <= v; i++) c++; return c; };
  let pTp1, pTp2, pSl;
  if (dirLong) {
    pTp1 = Math.round(cntGE(maxes, s1.px) / N * 100);
    pTp2 = Math.round(cntGE(maxes, s2.px) / N * 100);
    pSl = Math.round(cntLE(mins, s3.px) / N * 100);
  } else {
    pTp1 = Math.round(cntLE(mins, s1.px) / N * 100);
    pTp2 = Math.round(cntLE(mins, s2.px) / N * 100);
    pSl = Math.round(cntGE(maxes, s3.px) / N * 100);
  }
  const risk = dirLong ? px - s3.px : s3.px - px;
  const reward = dirLong ? s1.px - px : px - s1.px;
  return {
    entry: px,
    tp1: s1.px, tp1c: s1.conf,
    tp2: s2.px, tp2c: s2.conf,
    sl: s3.px, slc: s3.conf,
    rr: risk > 0 ? reward / risk : 0,
    pTp1, pTp2, pSl,
    sigDay: sig * 100,
    horizon: H,
    dir: dirLong ? "LONG" : "SHORT",
    ts: seal ? seal.ts : Date.now(),
    anchorT: seal ? seal.ts : null,
    sealed: !!seal
  };
}

function rollSeal(candles, asset, tf, seal0, fib) {
  const H = TF_MCH[tf] || 72;
  let anchor = { idx: seal0.idx, ts: seal0.ts, conf: seal0.conf };
  let gen = 1, res = null;
  for (let guard = 0; guard < 600; guard++) {
    const plan = mcPlan(candles, asset, tf, anchor, fib);
    if (!plan) return { plan: null, gen, res };
    const L = plan.dir === "LONG";
    const lim = Math.min(candles.length - 1, anchor.idx + H);
    let fin = null, j = anchor.idx + 1;
    for (; j <= lim; j++) {
      const k = candles[j];
      if (L ? k.l <= plan.sl : k.h >= plan.sl) { fin = "sl"; break; }
      if (L ? k.h >= plan.tp2 : k.l <= plan.tp2) { fin = "tp2"; break; }
    }
    const expired = fin === null && anchor.idx + H < candles.length - 1;
    if (fin === null && !expired) {
      plan.gen = gen; plan.resPrev = res;
      return { plan, gen, res };
    }
    const nIdx = fin ? j : anchor.idx + H;
    res = fin || "vencido";
    gen++;
    anchor = { idx: nIdx, ts: +candles[nIdx].t, conf: anchor.conf };
  }
  const plan = mcPlan(candles, asset, tf, anchor, fib);
  if (plan) { plan.gen = gen; plan.resPrev = res; }
  return { plan, gen, res };
}

export function computePrismaSwing(candlesInput, asset = "BTC", tf = "1day") {
  const assetCode = asset.toUpperCase();
  const candles = (candlesInput || [])
    .map(x => ({ t: +new Date(x.t), o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v || 0 }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.c) && x.c > 0)
    .sort((a, b) => a.t - b.t);
  if (candles.length < 80) return { status: "INSUFFICIENT_DATA", asset: assetCode, tf };
  const zz = ASSET_ZZ[assetCode] * TF_ZZMULT[tf];
  const piv = zigzag(candles.slice(-400), zz);
  const fib = fibContext(candles.slice(-400), piv);
  const seal = regimeConfirmedTs(candles, zz);
  const currentRaw = regimeRaw(candles.slice(-200), zz);

  if (seal.conf === "LAT" || seal.idx == null) {
    return {
      status: "NO_DIRECTIONAL_SETUP",
      asset: assetCode,
      tf,
      regime: seal.conf,
      raw_regime: currentRaw,
      seal,
      plan: null,
      pivots: piv.slice(-12),
      fib,
      source_logic: "PRISMA motor_site_v4_17 · regime+hysteresis+MC"
    };
  }
  const rolled = rollSeal(candles, assetCode, tf, seal, fib);
  return {
    status: rolled.plan ? "READY" : "NO_PLAN",
    asset: assetCode,
    tf,
    regime: seal.conf,
    raw_regime: currentRaw,
    seal,
    plan: rolled.plan,
    generation: rolled.gen,
    previous_resolution: rolled.res,
    pivots: piv.slice(-12),
    fib,
    source_logic: "PRISMA motor_site_v4_17 · regime+hysteresis+rolling-seal+MC"
  };
}
