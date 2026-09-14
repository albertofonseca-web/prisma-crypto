#!/usr/bin/env python3
"""PRISMA Crypto D1 publisher v6 — full TAC/Source event timeline payload.
Read-only bridge. No trading logic changes. No orders.
"""
from __future__ import annotations
import importlib.util
import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

FORK = Path('/content/drive/MyDrive/tac/forks/source_reconstruction')
PAYLOAD_BUILDER = FORK / 'TAC_CLOUDFLARE_PAYLOAD_V6_FULL_EVENT_TIMELINE.py'
DEFAULT_INTERVAL = 60
DEFAULT_HISTORY_INTERVAL = 300


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'No fue posible cargar {path}')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _config(account_id=None, database_id=None, token=None):
    account_id = (account_id or os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')).strip()
    database_id = (database_id or os.environ.get('PRISMA_CRYPTO_D1_DATABASE_ID', '')).strip()
    token = (token or os.environ.get('CLOUDFLARE_D1_API_TOKEN', '')).strip()
    missing = [k for k, v in [('CLOUDFLARE_ACCOUNT_ID', account_id), ('PRISMA_CRYPTO_D1_DATABASE_ID', database_id), ('CLOUDFLARE_D1_API_TOKEN', token)] if not v]
    if missing:
        raise RuntimeError('Faltan variables de runtime: ' + ', '.join(missing))
    return account_id, database_id, token


def d1_query(sql: str, params: list[Any] | None = None, *, account_id=None, database_id=None, token=None, timeout=30):
    account_id, database_id, token = _config(account_id, database_id, token)
    endpoint = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query'
    body = json.dumps({'sql': sql, 'params': params or []}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    req = urllib.request.Request(endpoint, data=body, method='POST', headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Accept': 'application/json',
        'User-Agent': 'PRISMA-Crypto-Colab-D1/6.0',
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            out = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        text = exc.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Cloudflare D1 HTTP {exc.code}: {text[:800]}') from exc
    if not out.get('success', False):
        raise RuntimeError('Cloudflare D1 API error: ' + json.dumps(out.get('errors', out), ensure_ascii=False)[:1000])
    return out


def build_payload() -> dict:
    mod = load_module(PAYLOAD_BUILDER, 'prisma_payload_builder_v2')
    return mod.build_payload()


def publish_latest(payload: dict | None = None) -> dict:
    payload = payload or build_payload()
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), default=str)
    sql = '''
    INSERT INTO crypto_state_latest (id, generated_utc, state_hash, schema_version, payload, updated_at)
    VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET generated_utc=excluded.generated_utc, state_hash=excluded.state_hash,
      schema_version=excluded.schema_version, payload=excluded.payload, updated_at=CURRENT_TIMESTAMP
    '''
    out = d1_query(sql, [payload.get('generated_utc'), payload.get('state_hash'), payload.get('schema_version'), payload_text])
    size_kb = len(payload_text.encode('utf-8')) / 1024
    print(f"[PRISMA D1 V6] latest OK · hash={payload.get('state_hash')} · {size_kb:.1f}KB · FULL EVENT TIMELINE")
    return out


def publish_history(payload: dict) -> dict:
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), default=str)
    out = d1_query('INSERT INTO crypto_state_history (generated_utc,state_hash,payload,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)',
                   [payload.get('generated_utc'), payload.get('state_hash'), payload_text])
    print(f"[PRISMA D1 V6] history OK · hash={payload.get('state_hash')}")
    return out


def publish_once(write_history=False):
    payload = build_payload()
    publish_latest(payload)
    if write_history:
        publish_history(payload)
    return payload


def loop(interval_seconds=DEFAULT_INTERVAL, history_interval_seconds=DEFAULT_HISTORY_INTERVAL):
    interval_seconds = max(30, int(interval_seconds)); history_interval_seconds = max(interval_seconds, int(history_interval_seconds))
    next_history = 0.0
    print(f'[PRISMA D1 V6] loop {interval_seconds}s · history {history_interval_seconds}s · FULL EVENT TIMELINE · NO ORDERS')
    while True:
        started = time.time()
        try:
            now = time.time(); do_history = now >= next_history
            publish_once(write_history=do_history)
            if do_history: next_history = now + history_interval_seconds
        except Exception as exc:
            print(f'[PRISMA D1 V6] ERROR {type(exc).__name__}: {exc}')
        time.sleep(max(1, interval_seconds - (time.time() - started)))


def start_background(interval_seconds=DEFAULT_INTERVAL, history_interval_seconds=DEFAULT_HISTORY_INTERVAL):
    th = threading.Thread(target=loop, args=(interval_seconds, history_interval_seconds), daemon=True, name='prisma-crypto-d1-publisher-v6')
    th.start(); return th

if __name__ == '__main__':
    publish_once(write_history=True)
