from pathlib import Path
import importlib.util
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
cal=ROOT/'data'/'TAC_FULL_EVENT_DISPLAY_V3.csv'
df=pd.read_csv(cal)
assert len(df)==480, len(df)
assert (df.display_class=='TAC_OFFICIAL').sum()==355
assert (df.display_class=='FORK_PROVISIONAL').sum()==125
assert set(df.display_class)=={'TAC_OFFICIAL','FORK_PROVISIONAL'}
assert not df.display_class.astype(str).str.contains('CANDIDATE').any()
cutoff=pd.Timestamp('2026-09-28T02:49:00+00:00')
ts=pd.to_datetime(df.event_utc,utc=True,format='mixed')
assert (ts[df.display_class=='TAC_OFFICIAL']<=cutoff).all()
assert (ts[df.display_class=='FORK_PROVISIONAL']>cutoff).all()

p=ROOT/'publisher'/'TAC_CLOUDFLARE_PAYLOAD_V8_TAC_OFFICIAL_FORK_FUTURE.py'
spec=importlib.util.spec_from_file_location('p8',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.FULL_EVENT_DISPLAY=cal
m.SOURCE_WINDOWS=ROOT/'data'/'not-present.json'
out=m._shared_pivots('2026-09-27T20:00:00+00:00', timeline_days=3)
assert out['calendar_scope']=='TAC_DAILY_PLUS_WEEKLY_OFFICIAL_WITH_FORK_PROVISIONAL_COEXIST'
assert out['official_cutoff_utc'].startswith('2026-09-28T02:49:00')
assert out['coverage']['official_count']>0
assert out['coverage']['provisional_count']>0
classes=[x['display_class'] for x in out['timeline']]
assert set(classes)<= {'TAC_OFFICIAL','FORK_PROVISIONAL'}
# After the daily cutoff, weekly TAC official overlays may coexist with Fork provisional.
# Therefore both classes can appear in the forward timeline; no candidate class is allowed.
assert 'TAC_OFFICIAL' in classes
assert 'FORK_PROVISIONAL' in classes
assert not any(c not in {'TAC_OFFICIAL','FORK_PROVISIONAL'} for c in classes)
print('test-full-events PASS', out['coverage'])
