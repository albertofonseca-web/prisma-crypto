#!/usr/bin/env python3
"""PRISMA Crypto publisher v1.

Read-only bridge from the Independent Source Fork files in Google Drive to the
Cloudflare PRISMA Crypto API. It does not calculate signals and cannot place orders.

Expected environment variables:
  PRISMA_CRYPTO_ENDPOINT=https://<worker>.workers.dev/api/publish
  PRISMA_CRYPTO_PUBLISH_TOKEN=<secret configured with wrangler secret put>

Designed for Google Colab + mounted Google Drive.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

BASE = Path("/content/drive/MyDrive/tac")
FORK = BASE / "forks" / "source_reconstruction"
DECISION_FILE = FORK / "multi_asset" / "decision" / "latest_DECISION_SCREENER.json"
SCREENER_FILE = FORK / "multi_asset" / "bot_interface" / "multi_asset_screener.json"
OPTIONS_MULTI_FILE = FORK / "options" / "latest_options_multi_asset.json"
FUNDING_FILE = BASE / "funding" / "latest_funding.json"
LIQ_SUMMARY_ROOT = BASE / "liquidation_flow" / "summary"
ASSETS = ("BTC", "ETH", "XRP")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {} if default is None else default


def file_health(path: Path) -> dict:
    if not path.exists():
        return {"status": "MISSING", "path": str(path), "modified_utc": None, "age_seconds": None}
    stat = path.stat()
    modified = datetime.fromtimestamp(stat.st_mtime, timezone.utc)
    return {
        "status": "OK",
        "path": str(path),
        "modified_utc": modified.isoformat(),
        "age_seconds": max(0, int(time.time() - stat.st_mtime)),
        "size_bytes": stat.st_size,
    }


def pick(d: Any, *keys: str, default=None):
    cur = d
    for key in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return default if cur is None else cur


def asset_options(options_multi: dict, asset: str) -> dict:
    # Supports both the new fork-local compact output and the older aggregate shape.
    raw = None
    if isinstance(options_multi, dict):
        raw = pick(options_multi, "assets", asset)
        if raw is None:
            for item in options_multi.get("assets", []) if isinstance(options_multi.get("assets"), list) else []:
                if str(item.get("asset_code", "")).upper() == asset:
                    raw = item
                    break
    if not raw:
        per = read_json(FORK / "options" / asset / "latest_result.json", {})
        raw = per or read_json(FORK / "options" / asset / "latest_recommendation.json", {})
    if not isinstance(raw, dict):
        raw = {}

    recommendation = raw.get("recommendation") if isinstance(raw.get("recommendation"), dict) else raw
    selected = recommendation.get("selected")
    tops = recommendation.get("top_candidates") or raw.get("top_candidates") or {}
    top_long = (tops.get("long") or [None])[0] if isinstance(tops, dict) else None
    top_short = (tops.get("short") or [None])[0] if isinstance(tops, dict) else None
    tac_ctx = recommendation.get("tac_context") or {}

    return {
        "status": recommendation.get("status") or raw.get("status") or ("READY" if raw else "NO_DATA"),
        "primary_direction": recommendation.get("primary_direction") or tac_ctx.get("primary_direction") or "WAIT",
        "watch_direction": tac_ctx.get("watch_direction") or recommendation.get("watch_direction") or "WAIT",
        "execution_authorized": bool(recommendation.get("execution_authorized", False)),
        "selected": selected,
        "top_long": top_long,
        "top_short": top_short,
        "quality": raw.get("quality") if isinstance(raw.get("quality"), dict) else {},
    }


def compact_candidate(candidate: Any) -> dict | None:
    if not isinstance(candidate, dict):
        return None
    keys = (
        "strategy", "direction", "expiry_utc", "legs", "strikes",
        "entry_debit_native", "entry_debit_usd_approx", "premium_currency",
        "max_loss_usd_approx", "max_profit_usd_approx", "breakeven_usd_approx",
        "pnl_tp1_usd_approx", "pnl_tp2_usd_approx", "pnl_tp3_usd_approx",
        "pnl_sl_usd_approx", "pnl_central_12h_usd_approx",
        "roi_tp1", "roi_sl", "roi_central_12h",
        "relative_spread_mean", "min_open_interest", "min_volume_24h",
        "hours_to_expiry", "rank_score", "model", "money_warning",
    )
    return {k: candidate.get(k) for k in keys if k in candidate}


def normalize_funding(raw: dict, asset: str) -> dict:
    if not isinstance(raw, dict):
        return {"status": "NO_DATA"}
    # Accept several historical shapes without assuming one exact schema.
    candidates = [
        raw.get(asset),
        pick(raw, "assets", asset),
        pick(raw, "latest", asset),
    ]
    item = next((x for x in candidates if isinstance(x, dict)), None)
    if item is None and asset == "BTC" and any(k in raw for k in ("funding_rate", "rate", "instrument")):
        item = raw
    if not item:
        return {"status": "NO_DATA"}
    return {
        "status": item.get("status") or "OK",
        "rate": item.get("funding_rate", item.get("rate")),
        "annualized": item.get("annualized"),
        "instrument": item.get("instrument"),
        "timestamp_utc": item.get("timestamp_utc") or item.get("updated_utc") or item.get("ts"),
        "bias": item.get("bias") or item.get("classification"),
    }


def normalize_liquidation(asset: str) -> dict:
    raw = read_json(LIQ_SUMMARY_ROOT / f"{asset}.json", {})
    if not raw:
        return {"status": "NO_DATA"}
    keep = {
        "status": raw.get("status") or "OK",
        "updated_utc": raw.get("updated_utc") or raw.get("generated_utc"),
        "pressure": raw.get("pressure") or raw.get("state") or raw.get("classification"),
        "nearest_above": raw.get("nearest_above") or raw.get("liquidity_above"),
        "nearest_below": raw.get("nearest_below") or raw.get("liquidity_below"),
        "long_liquidations": raw.get("long_liquidations") or raw.get("long_value"),
        "short_liquidations": raw.get("short_liquidations") or raw.get("short_value"),
    }
    return keep


def build_asset(asset: str, decision: dict, screener: dict, options_multi: dict, funding: dict) -> dict:
    d = pick(decision, "assets", asset, default={}) or {}
    s = pick(screener, "assets", asset, default={}) or {}
    preview = s.get("preview_geometry") or {}
    pivot = s.get("pivot_context") or {}
    next_pivot = pivot.get("next") or {}
    source_ctx = s.get("source_context") or {}
    opt = asset_options(options_multi, asset)

    engine_direction = str(d.get("engine_direction") or s.get("direction") or "NONE").upper()
    actionable = bool(d.get("engine_actionable", s.get("actionable", False)))
    htf_allowed = bool(d.get("htf_allowed", True))
    action = engine_direction if actionable and htf_allowed and engine_direction in {"LONG", "SHORT"} else "WAIT"
    candidate = str(d.get("engine_candidate") or s.get("candidate_side") or "NONE").upper()

    price = s.get("current_price")
    if price is None:
        for candidate_price in (
            pick(opt, "quality", "bitstamp_reference"),
            pick(opt, "selected", "spot"),
            pick(s, "trigger", "entry_reference"),
        ):
            if isinstance(candidate_price, (int, float)):
                price = candidate_price
                break

    reasons = d.get("htf_reasons") or []
    decision_reason = d.get("gate_reason") or d.get("final_state") or s.get("state") or "WAIT"

    return {
        "market_ref": {
            "price": price,
            "source": "FORK_REFERENCE",
            "timestamp_utc": s.get("cutoff_utc") or s.get("generated_utc"),
        },
        "decision": {
            "action": action,
            "candidate": candidate,
            "actionable": actionable,
            "reason": decision_reason,
        },
        "tactical": {
            "state": s.get("state") or d.get("engine_state") or "WAIT",
            "actionable": actionable,
            "direction": engine_direction,
            "candidate_side": candidate,
            "clear_score": s.get("clear_score"),
            "score_breakdown": s.get("score_breakdown") or {},
            "technical": s.get("technical") or {},
            "fractal": s.get("fractal") or {},
            "trigger": s.get("trigger") or {},
            "preview_geometry": preview,
            "signal_origin": s.get("signal_origin"),
            "cutoff_utc": s.get("cutoff_utc"),
        },
        "htf": {
            "gate": d.get("htf_gate") or "UNKNOWN",
            "allowed": htf_allowed,
            "final_state": d.get("final_state") or "UNKNOWN",
            "gate_reason": d.get("gate_reason"),
            "long_score": d.get("htf_long_score"),
            "short_score": d.get("htf_short_score"),
            "balance_score": d.get("htf_balance_score"),
            "reasons": reasons,
        },
        "tac": {
            "pivot_confirmation": s.get("pivot_confirmation"),
            "next_pivot_utc": next_pivot.get("timestamp_utc"),
            "next_pivot_monterrey": next_pivot.get("timestamp_monterrey"),
            "minutes_to": next_pivot.get("minutes_to"),
            "direction": next_pivot.get("direction"),
            "label": next_pivot.get("label"),
            "event": next_pivot.get("event"),
            "active_caution": source_ctx.get("active_caution"),
            "active_source_clear": source_ctx.get("active_source_clear"),
            "next_source_clear": source_ctx.get("next_source_clear"),
        },
        "options": {
            **opt,
            "selected": compact_candidate(opt.get("selected")),
            "top_long": compact_candidate(opt.get("top_long")),
            "top_short": compact_candidate(opt.get("top_short")),
        },
        "funding": normalize_funding(funding, asset),
        "liquidations": normalize_liquidation(asset),
        "performance": {},
    }


def build_payload() -> dict:
    decision = read_json(DECISION_FILE, {})
    screener = read_json(SCREENER_FILE, {})
    options_multi = read_json(OPTIONS_MULTI_FILE, {})
    funding = read_json(FUNDING_FILE, {})

    assets = {asset: build_asset(asset, decision, screener, options_multi, funding) for asset in ASSETS}
    content_for_hash = json.dumps(assets, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    revision_hash = hashlib.sha256(content_for_hash).hexdigest()[:16]

    return {
        "schema_version": "1.0",
        "publisher_version": "1.0.0",
        "generated_utc": utc_now(),
        "state_hash": revision_hash,
        "mode": "SHADOW_DECISION_SUPPORT",
        "orders_enabled": False,
        "assets": assets,
        "system": {
            "fork_root": str(FORK),
            "decision_file": file_health(DECISION_FILE),
            "screener_file": file_health(SCREENER_FILE),
            "options_file": file_health(OPTIONS_MULTI_FILE),
            "funding_file": file_health(FUNDING_FILE),
            "publisher_utc": utc_now(),
        },
    }


def publish_once(endpoint: str | None = None, token: str | None = None, timeout: int = 20) -> dict:
    endpoint = endpoint or os.environ.get("PRISMA_CRYPTO_ENDPOINT")
    token = token or os.environ.get("PRISMA_CRYPTO_PUBLISH_TOKEN")
    if not endpoint:
        raise RuntimeError("Falta PRISMA_CRYPTO_ENDPOINT")
    if not token:
        raise RuntimeError("Falta PRISMA_CRYPTO_PUBLISH_TOKEN")
    payload = build_payload()
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            out = json.loads(text)
            print(f"[PRISMA CRYPTO] published {payload['state_hash']} · HTTP {response.status} · revision={out.get('revision')}")
            return out
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Cloudflare HTTP {exc.code}: {text[:500]}") from exc


def loop(interval_seconds: int = 60):
    interval_seconds = max(30, int(interval_seconds))
    print(f"[PRISMA CRYPTO] publisher loop every {interval_seconds}s · NO ORDERS")
    while True:
        started = time.time()
        try:
            publish_once()
        except Exception as exc:
            print(f"[PRISMA CRYPTO] ERROR {type(exc).__name__}: {exc}")
        time.sleep(max(1, interval_seconds - (time.time() - started)))


def start_background(interval_seconds: int = 60) -> threading.Thread:
    thread = threading.Thread(target=loop, args=(interval_seconds,), daemon=True, name="prisma-crypto-publisher")
    thread.start()
    return thread


if __name__ == "__main__":
    publish_once()
