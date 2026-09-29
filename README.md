# PRISMA Crypto Cloud v0.4.1 — Multi-Asset Tactical Only

## Scope

This release expands the decision terminal to 11 assets and removes the high-timeframe Swing workspace from the web UI.

### Assets

- BTC, ETH, XRP — Bitstamp market data; TAC + technical analysis.
- GC (`GC=F`), MXN (`MXN=X`), CL (`CL=F`), NG (`NG=F`), ZW (`ZW=F`), ZC (`ZC=F`), ES (`ES=F`), NQ (`NQ=F`) — Yahoo Finance market data; technical-only.

### Tactical timeframes

Only these timeframes are exposed by the UI and market API:

- 1m
- 5m
- 15m
- 1H
- 4H

The 1D, 1W and 1M controls and the PRISMA Swing workspace are removed from this release.

## TAC policy

- BTC / ETH / XRP: TAC context remains enabled.
- GC / MXN / CL / NG / ZW / ZC / ES / NQ: TAC is disabled; the UI hides TAC timeline, pivots, Deribit/options and liquidation overlays for those assets.

## Data contract

- `publisher_version: 8.1.0_MULTI_ASSET_TACTICAL_ONLY`
- `terminal_contract: PRISMA_CRYPTO_RICH_V8_MULTI_ASSET_TACTICAL`
- `schema_version: 1.0` remains for D1 compatibility.
- Asset payloads include decision, tactical state, HTF 1H/4H, profile levels, fractal/projection, and data QC when available.

## Files to keep synchronized in Drive

`/content/drive/MyDrive/tac/forks/source_reconstruction/`

- `TAC_CLOUDFLARE_PUBLISHER_V1_1.py`
- `TAC_CLOUDFLARE_PAYLOAD_V8_TAC_OFFICIAL_FORK_FUTURE.py`
- `TAC_D1_PUBLISHER_V8_TAC_OFFICIAL_FORK_FUTURE.py`

## Deployment

The Cloudflare project source is this directory. Deploy using the existing PRISMA Crypto Worker/D1 configuration (`npm run deploy` / `wrangler deploy`) after preserving the existing bindings and secrets.

No orders are enabled by this release.

## v0.4.1 hardening

- Legacy Swing CSS/classes removed from the web client.
- Legacy Bitstamp fallback no longer accepts 1D.
- All market endpoints are constrained to 1m / 5m / 15m / 1H / 4H.
- Added regression test for the 11-asset universe and tactical-only timeframe contract.
