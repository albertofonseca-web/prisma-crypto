from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]
idx=(ROOT/'public'/'index.html').read_text(encoding='utf-8')
app=(ROOT/'public'/'app.js').read_text(encoding='utf-8')
worker=(ROOT/'src'/'index.js').read_text(encoding='utf-8')

assets=['BTC','ETH','XRP','GC','MXN','CL','NG','ZW','ZC','ES','NQ']
for a in assets:
    assert f'data-asset="{a}"' in idx, a

# Only tactical chart buttons exist.
buttons=re.findall(r'data-tf="([^"]+)"',idx)
assert buttons==['1m','5m','15m','1h','4h'], buttons
for forbidden in ['1d','1day','1w','1week','1month']:
    assert f'data-tf="{forbidden}"' not in idx.lower()

assert 'const TACTICAL_TFS = new Set(["1m","5m","15m","1h","4h"]);' in worker
# The legacy Bitstamp fallback must not expose 1D either.
assert '"1d": 86400' not in worker

# TAC stays on for crypto only; macro/futures assets are technical-only.
for a in ['BTC','ETH','XRP']:
    assert re.search(rf'\b{a}:\{{[^\n]+tac:true', app), a
for a in ['GC','MXN','CL','NG','ZW','ZC','ES','NQ']:
    assert re.search(rf'\b{a}:\{{[^\n]+tac:false', app), a
print('test-tactical-contract PASS')
