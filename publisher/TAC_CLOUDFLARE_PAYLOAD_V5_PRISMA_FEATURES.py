#!/usr/bin/env python3
"""PRISMA Crypto rich payload builder v4 — full fork display parity.

Extends the existing fork snapshot with the rich decision context already produced
by the Independent Source Fork. Read-only: no trading logic is changed and no
orders can be placed.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = Path('/content/drive/MyDrive/tac')
FORK = BASE / 'forks' / 'source_reconstruction'
LEGACY_BUILDER = FORK / 'TAC_CLOUDFLARE_PUBLISHER_V1_1.py'

BTC_NOW = FORK / 'now_charts' / 'latest_NOW_BTC.json'
BTC_DYNAMIC = FORK / 'live' / 'dynamic_now_status.json'
BTC_PLAN = FORK / 'live' / 'latest_plan.json'
BTC_FRACTAL = FORK / 'fractal_source_aware' / 'latest' / 'BTC_FRACTAL_SOURCE_AWARE_V1.json'
HTF_FILES = {
    'BTC': FORK / 'htf_context' / 'latest_HTF_CONTEXT.json',
    'ETH': FORK / 'assets' / 'ETH' / 'htf_context' / 'latest_HTF_CONTEXT.json',
    'XRP': FORK / 'assets' / 'XRP' / 'htf_context' / 'latest_HTF_CONTEXT.json',
}
ASSET_SIGNALS = {
    'ETH': FORK / 'assets' / 'ETH' / 'bot_interface' / 'latest_signal.json',
    'XRP': FORK / 'assets' / 'XRP' / 'bot_interface' / 'latest_signal.json',
}
ASSET_FRACTALS = {
    'ETH': FORK / 'assets' / 'ETH' / 'fractal' / 'latest.json',
    'XRP': FORK / 'assets' / 'XRP' / 'fractal' / 'latest.json',
}
SHARED_PIVOT_MASTER = FORK / 'TAC_SOURCE_PIVOTS_180D_MASTER_V1.csv'
SOURCE_WINDOWS = FORK / 'source_windows' / 'latest_source_windows.json'
OPTIONS_ROOT = FORK / 'options'
LIQ_SUMMARY_FILES = {a: FORK / 'liquidation_flow' / 'summary' / f'{a}.json' for a in ('BTC','ETH','XRP')}


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'No fue posible cargar {path}')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return {} if default is None else default


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _compact_geom(g: Any):
    if not isinstance(g, dict):
        return {}
    out = {}
    for side in ('LONG', 'SHORT'):
        x = g.get(side)
        if not isinstance(x, dict):
            continue
        out[side] = {k: x.get(k) for k in ('status', 'entry', 'risk', 'sl', 'tp1', 'tp2', 'tp3', 'stage', 'active_stop', 'activation_utc') if k in x}
    return out


def _profile_summary(raw: Any):
    if not isinstance(raw, dict):
        return {}
    keep = ('POC', 'VWAP', 'TWAP', 'VAL', 'VAH')
    return {k: raw.get(k) for k in keep if _num(raw.get(k)) is not None}


def _htf_tf(raw: Any):
    if not isinstance(raw, dict):
        return {}
    profile = raw.get('profile') if isinstance(raw.get('profile'), dict) else {}
    return {
        'timeframe': raw.get('timeframe'),
        'price': raw.get('price'),
        'trend': raw.get('trend'),
        'location': raw.get('location'),
        'reaction': raw.get('reaction'),
        'ema9': raw.get('ema9'),
        'ema21': raw.get('ema21'),
        'ema50': raw.get('ema50'),
        'atr14': raw.get('atr14'),
        'rsi14': raw.get('rsi14'),
        'profile': {k: profile.get(k) for k in ('poc', 'val', 'vah', 'vwap', 'value_area_pct') if k in profile},
        'last_completed_bar_utc': raw.get('last_completed_bar_utc'),
    }


def _htf(asset: str):
    raw = _json(HTF_FILES[asset], {})
    return {
        'generated_utc': raw.get('generated_utc'),
        'cutoff_utc': raw.get('cutoff_utc'),
        'cutoff_monterrey': raw.get('cutoff_monterrey'),
        '1H': _htf_tf(raw.get('1H')),
        '4H': _htf_tf(raw.get('4H')),
    }


def _fractal_compact(raw: Any, max_points: int = 96):
    if not isinstance(raw, dict):
        return {}
    tr = raw.get('trajectory') if isinstance(raw.get('trajectory'), dict) else {}
    times = tr.get('times_utc') if isinstance(tr.get('times_utc'), list) else []
    n = min(max_points, len(times))
    def pick(*names):
        for name in names:
            x=tr.get(name)
            if isinstance(x,list):
                return x[:n]
        return []
    model=str(raw.get('model') or '')
    return {
        'status': raw.get('status') or ('OK' if raw.get('bias') else None),
        'version': raw.get('version'),
        'model': raw.get('model'),
        'bias': raw.get('bias'),
        'generated_utc': raw.get('generated_utc'),
        'asof_utc': raw.get('asof_utc') or tr.get('asof_utc'),
        'asof_monterrey': raw.get('asof_monterrey'),
        'selected_analogues': raw.get('selected_analogues'),
        'trajectory_analogues': raw.get('trajectory_analogues'),
        'source_calendar_used': raw.get('source_calendar_used'),
        'source_status': raw.get('source_status'),
        'horizons': raw.get('horizons') if isinstance(raw.get('horizons'), dict) else {},
        'trajectory': {
            'step_minutes': tr.get('step_minutes'),
            'horizon_hours': tr.get('horizon_hours'),
            'asof_utc': tr.get('asof_utc'),
            'anchor_price': tr.get('anchor_price'),
            'times_utc': times[:n],
            # Generic names consumed by v0.3.2. Keep Source aliases for BTC compatibility.
            'median': pick('source_median','technical_median','median'),
            'q20': pick('source_q20','technical_q20','q20'),
            'q80': pick('source_q80','technical_q80','q80'),
            'source_median': pick('source_median'),
            'source_q20': pick('source_q20'),
            'source_q80': pick('source_q80'),
            'technical_median': pick('technical_median'),
            'technical_q20': pick('technical_q20'),
            'technical_q80': pick('technical_q80'),
        },
    }



def _parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except Exception:
        return None


def _shared_pivots(reference_utc: str | None, *, next_count: int = 8, recent_count: int = 3) -> dict:
    """Shared Source/TAC calendar for display only on ETH/XRP.

    This never changes ETH/XRP scoring or gating. BTC continues to use its own
    frozen plan outputs.  The calendar is exposed so every asset chart can show
    the same observational pivot timeline the user expects from the fork UI.
    """
    ref = _parse_iso(reference_utc) or datetime.now(timezone.utc)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    rows=[]
    try:
        with SHARED_PIVOT_MASTER.open('r', encoding='utf-8', newline='') as f:
            for r in csv.DictReader(f):
                t=_parse_iso(r.get('timestamp_utc'))
                if t is None:
                    continue
                if t.tzinfo is None:
                    t=t.replace(tzinfo=timezone.utc)
                rows.append({
                    'pivot_utc': t.isoformat(),
                    'pivot_local': r.get('timestamp_monterrey'),
                    'pivot_local_display': f"{r.get('date_monterrey','')} {r.get('time_monterrey','')}".strip(),
                    'tac_label': r.get('label'),
                    'event': r.get('event'),
                    'source_class': r.get('source_class'),
                    'direction_hint': r.get('direction_hint'),
                    'polarity': r.get('polarity'),
                    'hierarchy': r.get('hierarchy'),
                    'zone_state': r.get('zone_state'),
                    'confidence': r.get('confidence'),
                    'observational_only': True,
                    'decision_effect': 'NONE',
                    '_t': t,
                })
    except Exception:
        rows=[]
    rows.sort(key=lambda x:x['_t'])
    past=[x for x in rows if x['_t'] <= ref][-recent_count:]
    future=[x for x in rows if x['_t'] > ref][:next_count]
    def clean(seq):
        out=[]
        for x in seq:
            y={k:v for k,v in x.items() if k!='_t'}
            out.append(y)
        return out
    win=_json(SOURCE_WINDOWS,{})
    return {
        'recent': clean(past),
        'next': clean(future),
        'active_windows': (win.get('active_windows') or [])[:8] if isinstance(win,dict) else [],
        'upcoming_windows': (win.get('upcoming_windows') or [])[:12] if isinstance(win,dict) else [],
        'calendar_scope': 'SHARED_SOURCE_TAC_OBSERVATIONAL',
        'decision_effect': 'NONE',
    }


def _asset_rich(asset_code: str, asset: dict):
    sig=_json(ASSET_SIGNALS[asset_code],{})
    geom=sig.get('preview_geometry') if isinstance(sig.get('preview_geometry'),dict) else {}
    geom=_compact_geom(geom)
    if geom:
        asset.setdefault('tactical',{})['preview_geometry']=geom
    profiles=sig.get('context_profiles') if isinstance(sig.get('context_profiles'),dict) else {}
    # Safety fallback: HTF structure already contains valid asset-specific POC/VAL/VAH/VWAP.
    htf=_htf(asset_code)
    if not profiles:
        profiles={}
        for tf in ('1H','4H'):
            p=(htf.get(tf) or {}).get('profile') or {}
            if p:
                profiles[tf]={
                    'POC':p.get('poc'),'VWAP':p.get('vwap'),'VAH':p.get('vah'),'VAL':p.get('val')
                }
    # Read the dedicated asset fractal file directly.  This makes the cloud
    # contract resilient even if an older signal serializer omits trajectory.
    fractal_file=_json(ASSET_FRACTALS[asset_code],{})
    fractal=fractal_file if isinstance(fractal_file,dict) and fractal_file.get('trajectory') else (sig.get('fractal') if isinstance(sig.get('fractal'),dict) else {})
    proj=sig.get('projection_12h') if isinstance(sig.get('projection_12h'),dict) else {}
    piv=_shared_pivots(sig.get('cutoff_utc') or sig.get('generated_utc'))
    return {
        'dynamic_now':{
            'cutoff_utc':sig.get('cutoff_utc'),
            'cutoff_local':sig.get('cutoff_monterrey'),
            'current_price':sig.get('current_price'),
            'bilateral':geom,
            'fractal_overlay':{
                'status':'OK' if fractal.get('trajectory') else 'PENDING',
                'model':fractal.get('model'),
                'bias':fractal.get('bias'),
            },
        },
        'projection_12h':proj,
        'context_profiles':{k:_profile_summary(v) for k,v in profiles.items() if isinstance(v,dict)},
        'pivots':piv,
        'fractal':_fractal_compact(fractal),
        'htf_detail':htf,
    }

def _btc_rich(asset: dict):
    now = _json(BTC_NOW, {})
    dynamic = _json(BTC_DYNAMIC, {})
    plan = _json(BTC_PLAN, {})
    frozen = plan.get('frozen_plan') if isinstance(plan.get('frozen_plan'), dict) else {}
    context = frozen.get('context_profiles') if isinstance(frozen.get('context_profiles'), dict) else {}
    proj = frozen.get('projection_12h') if isinstance(frozen.get('projection_12h'), dict) else {}
    funding = frozen.get('funding_context') if isinstance(frozen.get('funding_context'), dict) else {}
    liq = plan.get('liquidation_flow_context') if isinstance(plan.get('liquidation_flow_context'), dict) else {}

    bilateral = dynamic.get('long_geometry') and dynamic.get('short_geometry')
    geom = {
        'LONG': dynamic.get('long_geometry', {}),
        'SHORT': dynamic.get('short_geometry', {}),
    } if bilateral else now.get('dynamic_bilateral', {})
    geom = _compact_geom(geom)
    if geom:
        asset.setdefault('tactical', {})['preview_geometry'] = geom

    if funding:
        asset['funding'] = {
            'status': 'OK' if funding.get('available', True) else 'NO_DATA',
            'source': funding.get('source'),
            'instrument': funding.get('instrument'),
            'timestamp_utc': funding.get('captured_utc'),
            'funding_1h': funding.get('funding_1h'),
            'funding_8h': funding.get('funding_8h'),
            'cumulative_24h': funding.get('cumulative_24h'),
            'zscore_90d': funding.get('zscore_90d'),
            'percentile_90d': funding.get('percentile_90d'),
            'slope_8h': funding.get('slope_8h'),
            'positioning': funding.get('positioning'),
            'effect': funding.get('effect'),
            'stale': funding.get('stale'),
        }
    windows = liq.get('windows') if isinstance(liq.get('windows'), dict) else {}
    oneh = windows.get('1h') if isinstance(windows.get('1h'), dict) else {}
    if liq:
        asset['liquidations'] = {
            'status': liq.get('status'),
            'updated_utc': liq.get('generated_utc'),
            'pressure': liq.get('regime_1h'),
            'activity': liq.get('activity_1h'),
            'stale': liq.get('stale'),
            'long_liquidations': oneh.get('long_liquidated_usd'),
            'short_liquidations': oneh.get('short_liquidated_usd'),
            'total_1h': oneh.get('total_usd'),
            'imbalance_1h': oneh.get('imbalance'),
            'coverage_1h': oneh.get('coverage_status'),
            'interpretation': liq.get('regime_interpretation'),
            'limitation': liq.get('limitation'),
        }

    return {
        'dynamic_now': {
            'cutoff_utc': dynamic.get('cutoff_utc') or now.get('cutoff_utc'),
            'cutoff_local': dynamic.get('cutoff_local') or now.get('cutoff_local'),
            'current_price': dynamic.get('current_price') or now.get('current_price'),
            'bilateral': geom,
            'next_pivot_local': dynamic.get('next_pivot_local') or (now.get('next_pivots') or [{}])[0].get('pivot_local'),
            'fractal_overlay': dynamic.get('fractal_overlay') or now.get('fractal_overlay'),
        },
        'projection_12h': proj,
        'context_profiles': {k: _profile_summary(v) for k, v in context.items() if isinstance(v, dict)},
        'pivots': {
            'recent': _shared_pivots(dynamic.get('cutoff_utc') or now.get('cutoff_utc')).get('recent', []),
            'next': (now.get('next_pivots') or _shared_pivots(dynamic.get('cutoff_utc') or now.get('cutoff_utc')).get('next', []))[:8],
            'active_windows': (now.get('active_source_windows') or [])[:8],
            'upcoming_windows': (now.get('upcoming_source_windows') or [])[:12],
            'calendar_scope': 'BTC_SOURCE_AUTHORITATIVE_DISPLAY',
            'decision_effect': 'BTC_ENGINE_OWN_RULES',
        },
        'fractal': _fractal_compact(_json(BTC_FRACTAL, {})),
        'htf_detail': _htf('BTC'),
    }



def _float(v, default=None):
    try:
        x=float(v)
        return x if x == x and abs(x) != float('inf') else default
    except Exception:
        return default


def _mtime_iso(path: Path):
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _wall_record(rows, option_type: str, *, spot=None, relation=None):
    agg={}
    for r in rows:
        if str(r.get('option_type','')).lower()!=option_type:
            continue
        strike=_float(r.get('strike')); oi=max(0.0,_float(r.get('open_interest'),0.0) or 0.0)
        vol=max(0.0,_float(r.get('volume'),0.0) or 0.0)
        if strike is None: continue
        if relation=='above' and spot is not None and strike < spot: continue
        if relation=='below' and spot is not None and strike > spot: continue
        rec=agg.setdefault(strike,{'strike':strike,'open_interest':0.0,'volume_24h':0.0,'contracts':0,'expiries':set()})
        rec['open_interest']+=oi; rec['volume_24h']+=vol; rec['contracts']+=1
        if r.get('expiry_utc'): rec['expiries'].add(str(r.get('expiry_utc')))
    if not agg and relation:
        return _wall_record(rows,option_type,spot=spot,relation=None)
    if not agg: return None
    best=max(agg.values(),key=lambda x:(x['open_interest'],x['volume_24h']))
    if best['open_interest']<=0 and best['volume_24h']<=0: return None
    return {**best,'expiries':len(best['expiries']),'scope':'AGGREGATED_VISIBLE_EXPIRIES'}


def _top_oi_levels(rows, option_type: str, limit=5):
    agg={}
    for r in rows:
        if str(r.get('option_type','')).lower()!=option_type: continue
        strike=_float(r.get('strike')); oi=max(0.0,_float(r.get('open_interest'),0.0) or 0.0); vol=max(0.0,_float(r.get('volume'),0.0) or 0.0)
        if strike is None: continue
        rec=agg.setdefault(strike,{'strike':strike,'open_interest':0.0,'volume_24h':0.0})
        rec['open_interest']+=oi;rec['volume_24h']+=vol
    return sorted(agg.values(),key=lambda x:(x['open_interest'],x['volume_24h']),reverse=True)[:limit]


def _options_market(asset_code: str) -> dict:
    root=OPTIONS_ROOT/asset_code
    chain_path=root/'latest_chain.csv'; reco_path=root/'latest_recommendation.json'
    reco=_json(reco_path,{})
    rows=[]
    try:
        with chain_path.open('r',encoding='utf-8',newline='') as f:
            now=datetime.now(timezone.utc)
            for r in csv.DictReader(f):
                exp=_parse_iso(r.get('expiry_utc'))
                if exp is not None and exp.tzinfo is None: exp=exp.replace(tzinfo=timezone.utc)
                if exp is not None and exp <= now: continue
                rows.append(r)
    except Exception:
        rows=[]
    mc=reco.get('market_context') if isinstance(reco.get('market_context'),dict) else {}
    spot=_float(mc.get('current_bitstamp'))
    if spot is None and rows:
        vals=[_float(r.get('bitstamp_reference')) for r in rows]
        vals=[x for x in vals if x is not None]
        if vals: spot=sorted(vals)[len(vals)//2]
    call_wall=_wall_record(rows,'call',spot=spot,relation='above')
    put_wall=_wall_record(rows,'put',spot=spot,relation='below')
    dominant_call=_wall_record(rows,'call')
    dominant_put=_wall_record(rows,'put')

    by_exp={}
    for r in rows:
        exp=str(r.get('expiry_utc') or '')
        if not exp: continue
        by_exp.setdefault(exp,[]).append(r)
    expiry_walls=[]
    for exp,grp in by_exp.items():
        dt=_parse_iso(exp); hours=(dt-datetime.now(timezone.utc)).total_seconds()/3600 if dt else None
        expiry_walls.append({
            'expiry_utc':exp,'hours_to_expiry':hours,
            'call_wall':_wall_record(grp,'call',spot=spot,relation='above'),
            'put_wall':_wall_record(grp,'put',spot=spot,relation='below'),
            'total_call_oi':sum(max(0.0,_float(x.get('open_interest'),0.0) or 0.0) for x in grp if str(x.get('option_type','')).lower()=='call'),
            'total_put_oi':sum(max(0.0,_float(x.get('open_interest'),0.0) or 0.0) for x in grp if str(x.get('option_type','')).lower()=='put'),
        })
    expiry_walls.sort(key=lambda x: 1e99 if x['hours_to_expiry'] is None else x['hours_to_expiry'])
    nearest=expiry_walls[0] if expiry_walls else None
    # Preserve the live options screener's own ladder/recommendation; no strategy is invented here.
    ladder=reco.get('expiry_ladder') if isinstance(reco.get('expiry_ladder'),list) else []
    top=reco.get('top_candidates') if isinstance(reco.get('top_candidates'),dict) else {}
    generated=reco.get('generated_utc') or _mtime_iso(chain_path)
    return {
        'status':'OK' if rows else 'NO_CHAIN_DATA',
        'source':'DERIBIT_PUBLIC_API',
        'generated_utc':generated,
        'chain_rows':len(rows),
        'spot_reference':spot,
        'call_wall':call_wall,
        'put_wall':put_wall,
        'dominant_call_wall':dominant_call,
        'dominant_put_wall':dominant_put,
        'nearest_expiry':nearest,
        'top_call_oi_levels':_top_oi_levels(rows,'call',5),
        'top_put_oi_levels':_top_oi_levels(rows,'put',5),
        'expiry_walls':expiry_walls[:8],
        'recommendation_status':reco.get('status'),
        'primary_direction':reco.get('primary_direction'),
        'watch_direction':reco.get('watch_direction'),
        'execution_authorized':bool(reco.get('execution_authorized',False)),
        'selected':reco.get('selected'),
        'top_candidates':{
            'long':(top.get('long') or [])[:3] if isinstance(top.get('long'),list) else top.get('long'),
            'short':(top.get('short') or [])[:3] if isinstance(top.get('short'),list) else top.get('short'),
        },
        'expiry_ladder':ladder[:12],
        'wall_method':'OPEN_INTEREST_BY_STRIKE_AGGREGATED_FROM_DERIBIT_CHAIN; chart defaults to nearest-expiry walls',
        'score_weight':0,
    }


def _liquidity_layers(asset_code: str) -> dict:
    raw=_json(LIQ_SUMMARY_FILES[asset_code],{})
    clusters=raw.get('realized_clusters_4h') if isinstance(raw.get('realized_clusters_4h'),list) else []
    realized={
        'status':raw.get('status') or ('NO_DATA' if not raw else None),
        'available':bool(raw.get('available',False)),
        'generated_utc':raw.get('generated_utc'),
        'regime_1h':raw.get('regime_1h'),
        'activity_1h':raw.get('activity_1h'),
        'clusters_4h':clusters[:8],
        'burst_monitor_5m':raw.get('burst_monitor_5m') if isinstance(raw.get('burst_monitor_5m'),dict) else {},
        'limitation':raw.get('limitation') or 'REALIZED_FLOW_NOT_A_FORWARD_LIQUIDATION_HEATMAP',
        'decision_use':raw.get('decision_use') or 'DISPLAY_AND_LOG_ONLY',
        'score_weight':0,
    }
    return {
        'realized':realized,
        'estimated_forward':{
            'status':'NOT_IMPORTED',
            'source_hint':'legacy PRISMA UI describes a Bybit-perp estimated model; exact estimator code not recovered in this fork',
            'is_real_positions':False,
            'score_weight':0,
        },
    }

def build_payload() -> dict:
    legacy = _load(LEGACY_BUILDER, 'prisma_payload_builder_v11')
    payload = legacy.build_payload()
    payload['publisher_version'] = '5.0.0_PRISMA_FEATURE_PARITY'
    payload['terminal_contract'] = 'PRISMA_CRYPTO_RICH_V4_FEATURE_PARITY'

    assets = payload.get('assets') if isinstance(payload.get('assets'), dict) else {}
    for asset in ('BTC', 'ETH', 'XRP'):
        a = assets.get(asset)
        if not isinstance(a, dict):
            continue
        if asset == 'BTC':
            rich = _btc_rich(a)
        else:
            rich = _asset_rich(asset,a)
        rich['options_market'] = _options_market(asset)
        rich['liquidity_layers'] = _liquidity_layers(asset)
        a['rich'] = rich

    content_for_hash = json.dumps(assets, sort_keys=True, separators=(',', ':'), default=str).encode('utf-8')
    payload['state_hash'] = hashlib.sha256(content_for_hash).hexdigest()[:16]
    return payload


if __name__ == '__main__':
    print(json.dumps(build_payload(), ensure_ascii=False, indent=2, default=str))
