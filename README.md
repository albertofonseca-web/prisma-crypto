# PRISMA Crypto Cloud v0.3.5 — Swing Workspace Fix

## Fixed in v0.3.5

- Swing is now a real workspace, not tactical candles with distant Swing lines superimposed.
- Swing candles come from the selected Swing timeframe (4H / 1D / 1W / 1M).
- PRISMA Swing market series use Bitstamp as the canonical source. 1W/1M are aggregated from Bitstamp daily OHLC.
- The Swing viewport follows market structure and **does not expand to include distant TP/SL**. Out-of-range targets/stops are shown as edge arrows and remain fully visible in the right-side trade plan.
- Swing chart adds PRISMA structural pivots (HH/LH/HL/LL) and Fibonacci context.
- Swing mode uses a dedicated right-side `SWING · QUÉ HACER AHORA` panel with Entry, SL, TP1, TP2, distance %, model probabilities, R:R, regime, horizon, generation and source.
- Tactical and Swing timeframe controls are now separate.
- Swing moving averages are computed from the active Swing series rather than reusing tactical 1H EMA values.
- Tactical/Fork logic, D1 contract, options, Call/Put Walls and liquidation overlays are unchanged.

This release is Cloudflare/frontend only. If the v0.3.4/V5 publisher is already running in Colab, **do not restart Colab for this Swing fix**.

# PRISMA Crypto Cloud v0.3.4 — PRISMA Feature Parity

## Added in v0.3.4

- Chart toolbar inspired by the existing PRISMA page: Futuros, Opciones, Sin plan, Niveles, Liq, Medias, Pantalla completa.
- Deribit Call Wall / Put Wall from live option-chain open interest. Nearest-expiry walls are used on-chart; aggregate walls remain visible in the panel.
- Options intelligence expands the existing fork screener: selected/watch strategy, legs, expiry, debit, max loss/profit, breakeven, PnL at TAC TP1/TP2/TP3/SL, spread, OI, volume and expiry wall ladder.
- Realized liquidation-flow overlay from the TAC Binance/Deribit shadow collector. This is explicitly NOT a forward liquidation heatmap and has score weight 0.
- The legacy PRISMA estimated Bybit-perp liquidation model is not silently recreated: its exact estimator code was not recovered in the current source set. The UI reports this honestly.
- 1H EMA9/EMA21/EMA50 overlay under Medias.
- All new overlays are display/context only and do not alter TAC/HTF/fork trading logic.

## Cloud contract

Publisher: `5.0.0_PRISMA_FEATURE_PARITY`  
Terminal contract: `PRISMA_CRYPTO_RICH_V4_FEATURE_PARITY`

# PRISMA Crypto Cloud v0.3.3 — Fork Display Parity

This release closes the remaining display gaps between the live fork outputs and the web terminal.

## Fixed in v0.3.3

- BTC, ETH and XRP all receive a pivot timeline in the web payload.
- ETH/XRP use the shared TAC/Source pivot calendar **for display only**; it has no scoring or execution effect.
- The chart draws the latest 3 pivots plus future pivots vertically behind price.
- ETH/XRP fractal trajectory is read directly from each asset's `fractal/latest.json`, so the web does not depend on a reduced signal serializer.
- ETH/XRP fractals remain asset-specific technical analogues; no BTC Source trajectory is reused.
- Original fork geometry colors are restored:
  - LONG Entry yellow `#ffd400`
  - LONG SL dark red `#a61b1b`
  - LONG TP dark green `#1b8f3a`
  - SHORT Entry orange `#ffb347`
  - SHORT SL light red `#ff6b6b`
  - SHORT TP light green `#7cfc98`
- Confirmed candidate entries are visibly marked and use heavier lines.
- POC/VWAP/TWAP/VAH/VAL remain on the left; Entry/SL/TP stay on the right.
- The chart now exposes a fail-visible parity badge instead of silently omitting missing data.

See `docs/FORK_PARITY_AUDIT.md` for the complete parity checklist.

## Cloud contract

Expected after the new Colab runner is active:

- `publisher_version: 4.0.0_FORK_DISPLAY_PARITY`
- `terminal_contract: PRISMA_CRYPTO_RICH_V3_FORK_PARITY`

## Cloudflare deployment

Replace the contents of the existing `prisma-crypto` repository with this package and commit. Do not create a new Worker.

Validate:

- `/api/health` -> `worker_version: "0.3.3"`
- `/api/state` -> `publisher_version: "4.0.0_FORK_DISPLAY_PARITY"`

## Colab runtime

The production-side companion files are stored separately in the private Drive folder: `MULTI_ASSET_SHADOW_ENGINE_V4_FORK_PARITY.py`, `TAC_CLOUDFLARE_PAYLOAD_V4_1_FORK_PARITY.py`, `TAC_D1_PUBLISHER_V4_1_FORK_PARITY.py`, `SOURCE_FORK_MULTI_ASSET_V5_13_D1_FORK_PARITY.py`, and the embedded bootstrap below. Restart the runtime completely and run only:

```python
from google.colab import drive
drive.mount('/content/drive')

exec(open(
    '/content/drive/MyDrive/tac/forks/source_reconstruction/'
    'SOURCE_FORK_MULTI_ASSET_V5_14_D1_FORK_PARITY_EMBEDDED.py',
    encoding='utf-8'
).read())
```

Expected markers:

```text
PRISMA CRYPTO V5.14
INDEPENDENT SOURCE FORK V5.13
[PRISMA D1 V4] ... FORK DISPLAY PARITY
```

Orders remain disabled. BTC trading/TAC/Source logic is unchanged. ETH/XRP remain shadow.
