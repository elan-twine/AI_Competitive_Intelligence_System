#!/usr/bin/env python3
# Faithful stand-in for the SOV Weekly Snapshot workflow (hNauQrczVV1VDxCF),
# which the n8n Public API can't trigger (no execute endpoint). Pure compute —
# NO Apify, NO scrape. Replicates "Compute SOV Snapshot" exactly:
#   • sov_weekly: current week (isoThursday, UTC) = all-time board as-of NOW
#   • sov_daily : trailing 8 days, windows 7 & 30 (as-of NOW-i*day) + w0
#     (all-time cumulative as-of END-OF-DAY 23:59:59.999Z), window_days=0
# board() is verified to reproduce the Snapshot's output exactly. Does NOT touch
# older weekly rows (e.g. the Oak-fixed week 07-09).
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
overallW = cfg.get('overallWeights') or {'weighted':0.80,'unweighted':0.20,'sentiment':0.0}
comps = req('GET','/competitors?select=name,type,active&active=eq.true')
allNames = [c['name'] for c in comps if c.get('name')]
allSet = set(allNames)
directSet = set(c['name'] for c in comps if (c.get('type') or 'direct') != 'indirect')
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
        out.append({'company':name,'overall':ov,'weighted_pct':w,'unweighted_pct':u,'sentiment_pct':s,'posts_count':cnt.get(name,0)})
    return out

now = datetime.datetime.now(datetime.timezone.utc)
def iso(dt): return dt.strftime('%Y-%m-%dT%H:%M:%S.') + f'{dt.microsecond//1000:03d}Z'

# --- weekly: current week (isoThursday UTC) = all-time as-of NOW ---
d0 = datetime.datetime(now.year, now.month, now.day, tzinfo=datetime.timezone.utc)
js_day = (d0.weekday() + 1) % 7          # JS getUTCDay: Sun=0..Sat=6
back = (js_day - 4 + 7) % 7              # days since last Thursday
week_start = (d0 - datetime.timedelta(days=back)).strftime('%Y-%m-%d')
wk_rows = [dict(r, week_start=week_start) for r in board(iso(now), None)]
req('POST','/sov_weekly?on_conflict=week_start,company', wk_rows, 'resolution=merge-duplicates,return=minimal')
dsum = sum(r['weighted_pct'] for r in wk_rows if r['company'] in directSet)
print(f'sov_weekly {week_start}: {len(wk_rows)} rows, direct weighted sum {dsum:.2f}')

# --- daily: trailing 8 days, windows 7 & 30 + w0 cumulative ---
DAY = datetime.timedelta(days=1)
for i in range(8):
    asof = now - i*DAY
    snap_date = asof.strftime('%Y-%m-%d')
    for wd in (7, 30):
        rows = board(iso(asof), wd)
        daily = [{'snapshot_date':snap_date,'company':r['company'],'window_days':wd,'overall':r['overall'],'weighted_pct':r['weighted_pct'],'sentiment_pct':r['sentiment_pct'],'posts_count':r['posts_count']} for r in rows]
        req('POST','/sov_daily?on_conflict=snapshot_date,company,window_days', daily, 'resolution=merge-duplicates,return=minimal')
    eod = snap_date + 'T23:59:59.999Z'
    rows0 = board(eod, None)
    cum = [{'snapshot_date':snap_date,'company':r['company'],'window_days':0,'overall':r['overall'],'weighted_pct':r['weighted_pct'],'sentiment_pct':r['sentiment_pct'],'posts_count':r['posts_count']} for r in rows0]
    req('POST','/sov_daily?on_conflict=snapshot_date,company,window_days', cum, 'resolution=merge-duplicates,return=minimal')
    print(f'sov_daily {snap_date}: 7d+30d+w0')
print('snapshot complete')
