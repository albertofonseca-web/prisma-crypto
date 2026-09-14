# PRISMA Crypto Cloud v0.2 — D1 live state

**Cambio v0.2:** el frontend ya no espera que TAC publique al Durable Object. `GET /api/state` lee directamente `crypto_state_latest` desde el binding D1 `DB`; el navegador refresca ese estado cada 30 segundos. Bitstamp sigue directo/live para mercado y PRISMA Swing conserva su flujo separado.

# PRISMA Crypto Cloud v0.1

Terminal especializada para **BTC / ETH / XRP** que mantiene separados:

- **PRISMA Swing**: régimen confirmado + histéresis + sello rodante + Monte Carlo del motor PRISMA existente.
- **TAC Tactical / Independent Source Fork**: estado táctico, candidate side, trigger, HTF gate, pivotes y geometría Entry/SL/TP.
- **Options**: recomendaciones/watchlist Deribit publicadas por el fork.
- **Market live**: Bitstamp va directo al navegador; Cloudflare no procesa ticks.

La aplicación es **decision support / shadow**. No contiene endpoints de órdenes reales.

## Arquitectura Free-Tier First

```text
Bitstamp WebSocket ───────────────► navegador (precio live)
Bitstamp OHLC ────────────────────► navegador (fallback por Worker solo si CORS falla)

PRISMA Swing series
Bybit spot → Kraken fallback ─────► Worker cache → navegador → cálculo PRISMA Swing

Colab / Independent Source Fork
        │
        └── POST /api/publish (1/min aprox.)
                  │
                  ▼
          Cloudflare Worker
                  │
                  ▼
       SQLite Durable Object
          latest state + WS
                  │
                  └───────────────► navegador
```

Los archivos estáticos quedan fuera del Worker excepto `/api/*` (`run_worker_first`), por lo que HTML/CSS/JS no consumen requests dinámicas del Free Tier.

## Estructura

```text
prisma_crypto_cloud_v0_1/
├─ src/index.js                       Worker + Durable Object + API
├─ public/index.html                  terminal
├─ public/styles.css
├─ public/app.js
├─ public/market.js                   Bitstamp browser feed
├─ public/prisma-swing.js             extracción de PRISMA Swing
├─ publisher/TAC_CLOUDFLARE_PUBLISHER_V1.py
├─ schema/crypto_state.schema.json
├─ tests/
├─ wrangler.jsonc
└─ package.json
```

## Endpoints

- `GET /api/health` — health del Worker/Hub.
- `GET /api/state` — último snapshot publicado.
- `GET /api/ws` — WebSocket hibernable para cambios del motor.
- `POST /api/publish` — sólo publisher autenticado; guarda y retransmite estado.
- `GET /api/usage` — contadores aproximados de esta app.
- `GET /api/prisma-series?asset=BTC&tf=1day` — ruta de velas para PRISMA Swing; preserva Bybit→Kraken del motor actual.
- `GET /api/bitstamp-ohlc?asset=BTC&tf=1m` — fallback únicamente si el navegador no puede consultar Bitstamp directamente.

## Deploy recomendado: GitHub + Cloudflare Workers Builds

### 1. Crear repositorio

Crea un repo nuevo, sugerido:

`prisma-crypto`

Sube **el contenido de esta carpeta**, no la carpeta contenedora completa.

### 2. Importarlo en la nueva cuenta Cloudflare

Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Import a repository** → selecciona `prisma-crypto`.

El proyecto no necesita build de frontend. El deploy puede usar el default:

```bash
npx wrangler deploy
```

`wrangler.jsonc` crea en el primer deploy el Durable Object SQLite `CryptoHub` y sirve `public/` como Static Assets.

### 3. Crear el secreto del publisher

En el Worker → **Settings → Variables and Secrets** crea un secret:

`PUBLISH_TOKEN`

Usa una cadena aleatoria larga. No la subas a GitHub.

Alternativa por terminal:

```bash
npx wrangler secret put PUBLISH_TOKEN
```

### 4. Verificar Cloudflare

Abre:

```text
https://<tu-worker>.workers.dev/
https://<tu-worker>.workers.dev/api/health
```

Antes de conectar Colab:

- gráfica/mercado Bitstamp debe funcionar;
- PRISMA Swing debe calcular;
- TAC/HTF/Options mostrará `esperando publisher`.

### 5. Conectar Colab

En Colab, después de montar Drive:

```python
import os

os.environ["PRISMA_CRYPTO_ENDPOINT"] = "https://<tu-worker>.workers.dev/api/publish"
os.environ["PRISMA_CRYPTO_PUBLISH_TOKEN"] = "PEGA_AQUI_EL_MISMO_SECRET"

exec(open(
    "/content/drive/MyDrive/tac/forks/source_reconstruction/"
    "TAC_CLOUDFLARE_PUBLISHER_V1.py",
    encoding="utf-8"
).read())
```

Para una sola prueba, ese archivo publica un snapshot y termina.

Para dejarlo corriendo como thread dentro de la sesión Colab:

```python
import importlib.util

path = "/content/drive/MyDrive/tac/forks/source_reconstruction/TAC_CLOUDFLARE_PUBLISHER_V1.py"
spec = importlib.util.spec_from_file_location("prisma_crypto_publisher", path)
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)
pub.start_background(60)
```

El publisher es **read-only** respecto al motor: lee JSONs del fork y publica estado; no recalcula señales ni habilita órdenes.

## Fuentes preservadas

### TAC / Tactical

El publisher consume por defecto:

```text
/content/drive/MyDrive/tac/forks/source_reconstruction/
  multi_asset/decision/latest_DECISION_SCREENER.json
  multi_asset/bot_interface/multi_asset_screener.json
  options/latest_options_multi_asset.json
```

También intenta:

```text
/content/drive/MyDrive/tac/funding/latest_funding.json
/content/drive/MyDrive/tac/liquidation_flow/summary/{BTC,ETH,XRP}.json
```

Si una capa falta, se publica `NO_DATA`; no se inventa información.

### PRISMA Swing

Se preservó del motor entregado:

- `HYST = 8`;
- ZZ base: BTC 1.5, ETH 2.8, XRP 3.2;
- multiplicadores TF del motor;
- `regimeRaw` BULL/BEAR/LAT;
- sello exacto de confirmación;
- sello rodante por resolución/expiración;
- Monte Carlo 2,000 caminos;
- PRNG determinístico `asset|tf|seal timestamp`;
- cuantiles TP1/TP2/SL;
- snap Fibonacci log cuando aplica.

La serie PRISMA conserva la ruta actual del Worker entregado: **Bybit spot primario → Kraken fallback**. TAC no cambia: su referencia canónica sigue siendo Bitstamp.

## Free-Tier Guard

Diseño base aproximado con publish cada minuto:

- ~1,440 `POST /api/publish` por día.
- ~2 escrituras DO por publish (latest + contador) = ~2,880 rows written/día.
- Límite Free SQLite DO: 100,000 rows written/día.
- Static Assets: no pasan por Worker salvo `/api/*`.
- Bitstamp ticks: directo navegador, cero Worker requests por tick.
- WebSocket usa Hibernation API; los mensajes salientes del DO no cobran requests adicionales.

La UI muestra contadores de **esta app**, no el consumo oficial completo de la cuenta Cloudflare.

## Seguridad / gobierno

- `PUBLISH_TOKEN` debe vivir sólo en Cloudflare Secret + runtime Colab.
- No hay claves de exchange en la UI.
- No hay endpoints de órdenes.
- `orders_enabled=false` viaja en el snapshot.
- PRISMA Swing y TAC Tactical no se fusionan matemáticamente; la UI muestra `ALIGN`, `CONFLICT` o `ENTRY WAIT` como lectura visual.
- La decisión TAC sigue obedeciendo `engine_actionable && htf_allowed`.

## Validaciones locales incluidas

```bash
npm install
npm run check
node tests/smoke-swing.mjs
python tests/test-publisher.py
```

## Siguiente incremento previsto

Después del primer deploy y primer snapshot real:

1. validar BTC / ETH / XRP contra los JSON de Drive;
2. revisar opciones reales del fork V5.2;
3. normalizar funding/liquidation con el shape exacto que esté generando tu runtime;
4. incorporar pivotes gráficos y niveles VAH/VAL/POC/VWAP/TWAP del fork;
5. agregar performance/backtest/forward en pestaña separada;
6. endurecer Free-Tier Guard con métricas reales de Cloudflare si se decide autorizar acceso a Analytics API.
