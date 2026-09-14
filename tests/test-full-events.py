from pathlib import Path
import importlib.util
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
cal=ROOT/'data'/'TAC_FULL_EVENT_DISPLAY_V1.csv'
df=pd.read_csv(cal)
assert len(df)==488, len(df)
assert (df.display_class=='CANDIDATE').sum()==93
assert (df.display_class=='CLASSIFIED_SOURCE').sum()==142
assert (df.display_class=='HISTORICAL_TAC').sum()==253
assert set(df.loc[df.display_class=='CANDIDATE','decision_effect'].astype(str))=={'NONE'}

p=ROOT/'publisher'/'TAC_CLOUDFLARE_PAYLOAD_V6_FULL_EVENT_TIMELINE.py'
spec=importlib.util.spec_from_file_location('p6',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.FULL_EVENT_DISPLAY=cal
m.SOURCE_WINDOWS=ROOT/'data'/'not-present.json'
out=m._shared_pivots('2026-09-14T07:00:00+00:00', timeline_days=2)
assert out['coverage']['timeline_count']>out['coverage']['classified_count']
assert out['coverage']['candidate_count']>0
assert out['next_event']['display_class']=='CANDIDATE'
assert out['next_classified']['display_class']!='CANDIDATE'
print('test-full-events PASS', out['coverage'])
