#!/usr/bin/env python3
# Generalized re-run of the mindshare backfill (2026-07-13): recompute ALL
# currently-existing historical board rows under the live platformMultipliers
# (News 30->15, Reddit 3->1.5). Replaces the stale hardcoded 07-08 script.
#
# Run from the project root:  python3 sov-tooling/backfill_generalized.py
# Idempotent (upserts on conflict). Reads the LIVE sov_config multipliers, so it
# always backfills under whatever weights are current. Re-run any time weights change.
import json, urllib.request, datetime
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
print('Recomputing under platformMultipliers:', MULT)
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
now_iso = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
# ⚠️ as_of MUST match the Snapshot's convention: each weekly row is the all-time
# cumulative as of the LAST daily run while that week is current (isoThursday) =
# week_start + 6 days at 03:45 UTC — NOT week_start + 7 (the next week's start).
# Using +7 pulls the following week's events into this week's point; that is how
# the 2026-07-23 backfill dragged Oak's 07-15 launch into the 07-09 row. Even so,
# recomputing historical weekly rows is inherently lossy: a competitor attributed
# RETROACTIVELY (e.g. Oak, gated on 07-21) will surface in any week whose as_of is
# on/after that competitor's post dates, unlike the original point-in-time row.
WEEKS = ['2026-06-22','2026-06-29','2026-07-02','2026-07-09']
for wk in WEEKS:
    wk_d = datetime.date.fromisoformat(wk); last_run = wk_d + datetime.timedelta(days=6)
    as_of = (now_iso if last_run >= datetime.date.today() else last_run.isoformat()+'T03:45:00Z')
    rows = [dict(r, week_start=wk) for r in board(as_of, None)]
    req('POST','/sov_weekly?on_conflict=week_start,company', rows, 'resolution=merge-duplicates,return=minimal')
    dsum = sum(r['weighted_pct'] for r in rows if r['company'] in directSet)
    print(f'sov_weekly {wk}: {len(rows)} rows, direct sum {dsum:.2f}')
DAILY = [ (datetime.date(2026,6,29)+datetime.timedelta(days=i)).isoformat() for i in range((datetime.date(2026,7,13)-datetime.date(2026,6,29)).days+1) ]
for d in DAILY:
    for wd in (7,30):
        rows = board(d+'T03:45:00Z', wd)
        daily=[{'snapshot_date':d,'company':r['company'],'window_days':wd,'overall':r['overall'],'weighted_pct':r['weighted_pct'],'sentiment_pct':r['sentiment_pct'],'posts_count':r['posts_count']} for r in rows]
        req('POST','/sov_daily?on_conflict=snapshot_date,company,window_days', daily, 'resolution=merge-duplicates,return=minimal')
    print(f'sov_daily {d}: 7d+30d')
CUM = [ (datetime.date(2026,7,5)+datetime.timedelta(days=i)).isoformat() for i in range((datetime.date(2026,7,13)-datetime.date(2026,7,5)).days+1) ]
for d in CUM:
    # w0 = ALL-TIME CUMULATIVE as of end of day d. That is window_days=None (same
    # as the weekly board) stored under the window_days=0 marker — NOT window_days=0
    # passed to the RPC (which returns empty -> all-zero rows). as_of = next-day
    # boundary to capture all of day d, or now for the still-open current day.
    nb = datetime.date.fromisoformat(d) + datetime.timedelta(days=1)
    as_of = (now_iso if nb > datetime.date.today() else nb.isoformat()+'T03:45:00Z')
    rows = board(as_of, None)
    daily=[{'snapshot_date':d,'company':r['company'],'window_days':0,'overall':r['overall'],'weighted_pct':r['weighted_pct'],'sentiment_pct':r['sentiment_pct'],'posts_count':r['posts_count']} for r in rows]
    req('POST','/sov_daily?on_conflict=snapshot_date,company,window_days', daily, 'resolution=merge-duplicates,return=minimal')
    print(f'sov_daily {d}: w0 cumulative')
print('backfill complete')
