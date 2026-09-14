from pathlib import Path
import importlib.util, json, tempfile

ROOT=Path(__file__).resolve().parent.parent
P=ROOT/'publisher'/'TAC_CLOUDFLARE_PAYLOAD_V4_1_FORK_PARITY.py'
spec=importlib.util.spec_from_file_location('p4',P)
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

# Fractal compact must accept technical trajectory aliases used by ETH/XRP.
raw={'model':'TECHNICAL_ANALOGUE_NO_SOURCE','bias':'LONG','trajectory':{'times_utc':['a','b'],'technical_median':[1,2],'technical_q20':[.5,1.5],'technical_q80':[1.5,2.5]}}
f=m._fractal_compact(raw)
assert f['trajectory']['median']==[1,2]
assert f['trajectory']['q20']==[.5,1.5]
assert f['trajectory']['q80']==[1.5,2.5]

# Shared calendar helper must split recent/future and mark display-only.
with tempfile.TemporaryDirectory() as td:
    td=Path(td)
    csvp=td/'p.csv'; winp=td/'w.json'
    csvp.write_text('master_idx,timestamp_utc,timestamp_monterrey,date_monterrey,time_monterrey,label,event,source_class,direction_hint,polarity,hierarchy,zone_state,confidence\n1,2026-09-14T04:00:00+00:00,2026-09-13T22:00:00-06:00,2026-09-13,22:00,SOURCE_BEAR,A,SRC,SHORT,BEAR,P,OUT,HIGH\n2,2026-09-14T06:00:00+00:00,2026-09-14T00:00:00-06:00,2026-09-14,00:00,SOURCE_BULL,B,SRC,LONG,BULL,P,OUT,HIGH\n',encoding='utf-8')
    winp.write_text(json.dumps({'active_windows':[{'window_type':'CAUTION'}],'upcoming_windows':[]}),encoding='utf-8')
    m.SHARED_PIVOT_MASTER=csvp; m.SOURCE_WINDOWS=winp
    p=m._shared_pivots('2026-09-14T05:00:00+00:00')
    assert p['recent'][-1]['tac_label']=='SOURCE_BEAR'
    assert p['next'][0]['tac_label']=='SOURCE_BULL'
    assert p['decision_effect']=='NONE'
print('test-parity OK')
