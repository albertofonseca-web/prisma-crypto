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
