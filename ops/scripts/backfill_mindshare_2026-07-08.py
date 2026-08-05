#!/usr/bin/env python3
# Historical board backfill for the mindshare-pool cutover (2026-07-08).
# Mirrors the Snapshot node byte-for-byte EXCEPT weighted = multiplier pool.
import json, urllib.request

SB = open('sov-tooling/.sbkey').read().strip()
BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
def req(method, path, body=None, prefer=None):
    h = {'apikey': SB, 'Authorization': 'Bearer '+SB, 'Content-Type': 'application/json'}
    if prefer: h['Prefer'] = prefer
    r = urllib.request.Request(BASE+path, method=method, headers=h,
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r) as resp:
        t = resp.read()
        return json.loads(t) if t else None

cfg = req('GET','/sov_config?select=config&id=eq.1')[0]['config']
MULT = cfg['platformMultipliers']
overallW = cfg.get('overallWeights') or {'weighted':0.80,'unweighted':0.20,'sentiment':0.0}
comps = req('GET','/competitors?select=name,type,active&active=eq.true')
allNames = [c['name'] for c in comps if c.get('name')]
allSet, directSet = set(allNames), set(c['name'] for c in comps if (c.get('type') or 'direct') != 'indirect')
PLATS = cfg.get('enabledPlatforms') or ['LinkedIn','Google News','Reddit','X']

def board(as_of, window_days):
    rows = req('POST','/rpc/sov_board_agg', {'as_of': as_of, 'window_days': window_days})
    agg = {p:{} for p in PLATS}
    for row in rows or []:
        p, name = row['platform'], row['company']
        if p not in agg or not name or name=='NONE' or name not in allSet: continue
        A = agg[p].setdefault(name, {'pw':0,'cntw':0,'count':0,'ss':0,'sc':0})
        A['pw'] += float(row['wsum'] or 0); A['cntw'] += int(row['cnt'] or 0); A['count'] += int(row['cnt'] or 0)
        A['ss'] += float(row['sent_sum'] or 0); A['sc'] += int(row['sent_cnt'] or 0)
    score, cntw, cnt, ss, sc = {}, {}, {}, {}, {}
    grandCntw = directScore = 0
    for p in PLATS:
        m = float(MULT.get(p, 1))
        for name, A in agg[p].items():
            score[name] = score.get(name,0) + m*A['pw']
            cntw[name] = cntw.get(name,0)+A['cntw']; cnt[name]=cnt.get(name,0)+A['count']
            ss[name]=ss.get(name,0)+A['ss']; sc[name]=sc.get(name,0)+A['sc']
    for name,v in score.items():
        if name in directSet: directScore += v
    for name,v in cntw.items():
        if name in directSet: grandCntw += v
    out=[]
    for name in allNames:
        w = round(100*score.get(name,0)/directScore,4) if directScore>0 else 0
        u = round(100*cntw.get(name,0)/grandCntw,4) if grandCntw>0 else 0
        avg = (ss.get(name,0)/sc[name]) if sc.get(name) else 0
        s = round(((avg+3)/6)*100,4)
        ov = round(overallW.get('weighted',0.8)*w + overallW.get('unweighted',0.2)*u + overallW.get('sentiment',0)*s,4)
        out.append({'company':name,'overall':ov,'weighted_pct':w,'unweighted_pct':u,'sentiment_pct':s,'posts_count':cnt.get(name,0)})
    return out

# Weekly legacy rows (post-epoch, displayed): boards as-of week end
for wk, as_of in [('2026-06-22','2026-06-29T03:45:00Z'), ('2026-06-29','2026-07-06T03:45:00Z')]:
    rows = [dict(r, week_start=wk) for r in board(as_of, None)]
    req('POST','/sov_weekly?on_conflict=week_start,company', rows, 'resolution=merge-duplicates,return=minimal')
    dsum = sum(r['weighted_pct'] for r in rows if r['company'] in directSet)
    print(f'sov_weekly {wk}: {len(rows)} rows, direct sum {dsum:.2f}')

# Daily rows 06-29..07-07 x windows [7,30] (07-08 comes from today's Snapshot run)
import datetime
d = datetime.date(2026,6,29)
while d <= datetime.date(2026,7,7):
    for wd in (7,30):
        rows = board(d.isoformat()+'T03:45:00Z', wd)
        daily = [{'snapshot_date':d.isoformat(),'company':r['company'],'window_days':wd,
                  'overall':r['overall'],'weighted_pct':r['weighted_pct'],
                  'sentiment_pct':r['sentiment_pct'],'posts_count':r['posts_count']} for r in rows]
        req('POST','/sov_daily?on_conflict=snapshot_date,company,window_days', daily, 'resolution=merge-duplicates,return=minimal')
    print(f'sov_daily {d}: 7d+30d written')
    d += datetime.timedelta(days=1)
print('backfill complete')
