import importlib.util
from pathlib import Path

HERE=Path(__file__).resolve().parent.parent
P=HERE/'publisher'/'TAC_CLOUDFLARE_PUBLISHER_V1.py'
spec=importlib.util.spec_from_file_location('pub',P)
pub=importlib.util.module_from_spec(spec);spec.loader.exec_module(pub)

payload=pub.build_payload()
assert payload['schema_version']=='1.0'
assert payload['orders_enabled'] is False
assert set(payload['assets'])=={'BTC','ETH','XRP'}
for code,row in payload['assets'].items():
    assert row['decision']['action'] in {'LONG','SHORT','WAIT'}
    assert row['decision']['actionable'] in {True,False}
print('test-publisher OK')
