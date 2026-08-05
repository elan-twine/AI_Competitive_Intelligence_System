import json, urllib.request, urllib.error
from datetime import datetime, timezone
# Seeds public.author_affiliation from author_verdicts.json (the classifier output).
# Idempotent upsert on `key`. Run AFTER migration 0013 is applied (DDL = Elan/SQL editor).
OUT='/Users/elansmyla/Documents/Claude/Projects/SOV+Comp+POI/sov-tooling'
KEY=open(f'{OUT}/.sbkey').read().strip()
BASE='https://addwjngdezmmnxddulll.supabase.co/rest/v1'
H={'apikey':KEY,'Authorization':f'Bearer {KEY}'}
NOW=datetime.now(timezone.utc).isoformat()

verds=json.load(open(f'{OUT}/author_verdicts.json'))
rows=[]
for v in verds:
    rows.append({
        'key': str(v['key']),
        'name': v.get('name'),
        'profile_id': str(v['key']),          # key == author.profile_id for all current verdicts
        'competitor': v.get('company'),
        'verdict': v.get('verdict'),
        'employer': v.get('employer'),
        'method': v.get('method') or 'llm',
        'checked_at': NOW,
    })

h=dict(H); h['Content-Type']='application/json'; h['Prefer']='resolution=merge-duplicates,return=minimal'
req=urllib.request.Request(f'{BASE}/author_affiliation?on_conflict=key',data=json.dumps(rows).encode(),headers=h,method='POST')
try:
    urllib.request.urlopen(req,timeout=90)
    from collections import Counter
    print('author_affiliation seeded:',len(rows),'rows |',dict(Counter(r['verdict'] for r in rows)))
except urllib.error.HTTPError as e:
    body=e.read()[:300]
    print('LOAD FAILED',e.code,body)
    if e.code==404 or b'PGRST205' in body:
        print('-> table missing: apply migration 0013 in the Supabase SQL editor first.')
