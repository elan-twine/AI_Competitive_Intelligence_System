#!/usr/bin/env python3
# Surgical fix for the ONE sov_weekly row the 2026-07-23 backfill corrupted:
# week_start 2026-07-09. The backfill recomputed it with as_of = next-week-start
# (07-16), which — now that Oak's 07-15 launch posts are attributed — pulled Oak
# into the 07-09 cumulative (spurious ~34% spike in the YTD Standings chart).
#
# The Weekly Snapshot writes each week's row ONCE, on the last daily run while it
# is the current week (isoThursday). For week 07-09 that run was 07-15 03:45 UTC,
# BEFORE Oak was attributed -> Oak = 0. We reproduce that exact as_of (07-15
# 03:45) under the CURRENT multipliers, so the row is Oak-free AND weight-
# consistent with the other backfilled weeks (06-22/06-29/07-02, which were pre-
# Oak and are already correct).
#
# DRY RUN by default (prints current-vs-new, writes nothing). Add --apply to write.
#   python3 sov-tooling/fix_week_0709.py            # dry run
#   python3 sov-tooling/fix_week_0709.py --apply     # actually upsert week 07-09
import json, urllib.request, sys
APPLY = '--apply' in sys.argv
WEEK = '2026-07-09'
AS_OF = '2026-07-15T03:45:00Z'   # the original Snapshot run for this week (pre-Oak)
SB = open('sov-tooling/.sbkey').read().strip()
BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
def req(method, path, body=None, prefer=None):
    h = {'apikey': SB, 'Authorization': 'Bearer '+SB, 'Content-Type': 'application/json'}
    if prefer: h['Prefer'] = prefer
    r = urllib.request.Request(BASE+path, method=method, headers=h,
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r) as resp:
        t = resp.read(); return json.loads(t) if t else None

cfg = req('GET','/sov_config?select=config&id=eq.1')[0]['config']
MULT = cfg['platformMultipliers']
overallW = cfg.get('overallWeights') or {'weighted':0.80,'unweighted':0.20,'sentiment':0.0}
comps = req('GET','/competitors?select=name,type,active&active=eq.true')
allNames = [c['name'] for c in comps if c.get('name')]
allSet, directSet = set(allNames), set(c['name'] for c in comps if (c.get('type') or 'direct') != 'indirect')
PLATS = cfg.get('enabledPlatforms') or ['LinkedIn','Google News','Reddit','X']

def board(as_of):
    rows = req('POST','/rpc/sov_board_agg', {'as_of': as_of, 'window_days': None})
    agg = {p:{} for p in PLATS}
    for row in rows or []:
        p, name = row['platform'], row['company']
        if p not in agg or not name or name=='NONE' or name not in allSet: continue
        A = agg[p].setdefault(name, {'pw':0,'cntw':0,'count':0,'ss':0,'sc':0})
        A['pw'] += float(row['wsum'] or 0); A['cntw'] += int(row['cnt'] or 0); A['count'] += int(row['cnt'] or 0)
        A['ss'] += float(row['sent_sum'] or 0); A['sc'] += int(row['sent_cnt'] or 0)
    score, cntw, cnt, ss, sc = {}, {}, {}, {}, {}
    for p in PLATS:
        m = float(MULT.get(p, 1))
        for name, A in agg[p].items():
            score[name] = score.get(name,0) + m*A['pw']
            cntw[name] = cntw.get(name,0)+A['cntw']; cnt[name]=cnt.get(name,0)+A['count']
            ss[name]=ss.get(name,0)+A['ss']; sc[name]=sc.get(name,0)+A['sc']
    directScore = sum(v for n,v in score.items() if n in directSet)
    grandCntw = sum(v for n,v in cntw.items() if n in directSet)
    out=[]
    for name in allNames:
        w = round(100*score.get(name,0)/directScore,4) if directScore>0 else 0
        u = round(100*cntw.get(name,0)/grandCntw,4) if grandCntw>0 else 0
        avg = (ss.get(name,0)/sc[name]) if sc.get(name) else 0
        s = round(((avg+3)/6)*100,4)
        ov = round(overallW.get('weighted',0.8)*w + overallW.get('unweighted',0.2)*u + overallW.get('sentiment',0)*s,4)
        out.append({'week_start':WEEK,'company':name,'overall':ov,'weighted_pct':w,'unweighted_pct':u,'sentiment_pct':s,'posts_count':cnt.get(name,0)})
    return out

new_rows = board(AS_OF)
cur = req('GET', f'/sov_weekly?select=company,overall&week_start=eq.{WEEK}')
curmap = {r['company']: r['overall'] for r in cur}
print(f'week {WEEK}  recompute as_of {AS_OF} (Oak-free, current weights)')
print(f'{"company":28} {"current":>8} -> {"new":>8}   delta')
for r in sorted(new_rows, key=lambda x: -x['overall']):
    c = curmap.get(r['company'], 0); n = r['overall']
    if abs(n-c) >= 0.05 or r['company']=='Oak - Identity Security OS':
        print(f'  {r["company"]:28} {c:8.2f} -> {n:8.2f}   {n-c:+.2f}')

if APPLY:
    req('POST','/sov_weekly?on_conflict=week_start,company', new_rows, prefer='resolution=merge-duplicates,return=minimal')
    print(f'\nAPPLIED — wrote {len(new_rows)} rows for week {WEEK}. Refresh the dashboard.')
else:
    print('\nDRY RUN — nothing written. Re-run with --apply to fix the row.')
