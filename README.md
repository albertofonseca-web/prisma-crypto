## v0.3.1 — Chart rules fix

- Market structure labels (POC/VWAP/TWAP/VAH/VAL) stay on the **left**.
- TAC LONG/SHORT Entry/SL/TP1-TP3 labels move to a dedicated **right** gutter with collision spacing.
- TAC pivot verticals are dotted, subtle, behind price, and carry no rotated text.
- Horizontal level lines remain in the plot while labels live outside the candle field on desktop.

# PRISMA Crypto Cloud v0.3 — Rich Decision Terminal

v0.3 convierte la prueba de conectividad v0.2 en una terminal de decisión útil. La infraestructura D1 se conserva; el cambio principal está en el contrato de datos y el frontend.

## Qué muestra

- BTC / ETH / XRP con precio y velas Bitstamp directas al navegador.
- `EXECUTION` desde posición cero: LONG / SHORT / WAIT.
- `DIRECTIONAL BIAS` separado de la autorización de entrada.
- TAC Tactical + HTF Gate 1H/4H.
- Geometría bilateral LONG y SHORT: Entry, SL, TP1, TP2, TP3.
- Niveles POC / VWAP / TWAP / VAH / VAL.
- Próximos pivotes y ventanas Source para BTC.
- Trayectoria Source-aware BTC con mediana y banda Q20–Q80.
- Proyección 12H orientativa BTC, claramente marcada como no validada.
- PRISMA Swing en módulo independiente, sin fusionar matemáticamente motores.
- Opciones Deribit watch/selected, funding, liquidations y system health.

## Cambio de publisher

La UI rica requiere estos archivos en:

`/content/drive/MyDrive/tac/forks/source_reconstruction/`

- `TAC_CLOUDFLARE_PAYLOAD_V2.py`
- `TAC_D1_PUBLISHER_V2.py`
- `SOURCE_FORK_MULTI_ASSET_V5_7_D1_RICH.py`
- `SOURCE_FORK_MULTI_ASSET_V5_8_D1_RICH_EMBEDDED.py` (bootstrap privado con credenciales, si se usa)

El contrato mantiene `schema_version: 1.0` para compatibilidad con D1, pero añade:

- `publisher_version: 2.0.0_RICH_TERMINAL`
- `terminal_contract: PRISMA_CRYPTO_RICH_V1`
- `assets.BTC.rich.dynamic_now`
- `assets.BTC.rich.projection_12h`
- `assets.BTC.rich.context_profiles`
- `assets.BTC.rich.pivots`
- `assets.BTC.rich.fractal`
- `assets.<ASSET>.rich.htf_detail`

No cambia TAC, HTF, opciones ni reglas de trading. No habilita órdenes.

## Deployment Cloudflare

Reemplaza el contenido del repo `prisma-crypto` por el contenido de este paquete y haz commit. Cloudflare debe desplegar el mismo Worker.

Validación:

- `/api/health` debe reportar `worker_version: "0.3.1"`.
- `/api/state` debe reportar `publisher_version: "2.0.0_RICH_TERMINAL"` después de reiniciar Colab con V5.8.

## Colab

Después de colocar los cuatro archivos anteriores en Drive, reinicia completamente el runtime y ejecuta sólo:

```python
from google.colab import drive
drive.mount('/content/drive')

exec(open(
    '/content/drive/MyDrive/tac/forks/source_reconstruction/'
    'SOURCE_FORK_MULTI_ASSET_V5_8_D1_RICH_EMBEDDED.py',
    encoding='utf-8'
).read())
```

Debe aparecer:

```text
INDEPENDENT SOURCE FORK V5.7
[PRISMA D1 V2] latest OK ... RICH
[PRISMA D1 V2] publisher ON ...
```

## Seguridad

El bootstrap V5.8 conserva el método que el usuario autorizó previamente: credenciales incrustadas en un archivo privado de Drive. Ese archivo no debe subirse a GitHub.
