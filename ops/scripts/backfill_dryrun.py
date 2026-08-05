#!/usr/bin/env python3
# DRY RUN for the board-history multiplier backfill. READ-ONLY: reads live config,
# reads stored sov_daily/sov_weekly rows, recomputes each frozen row under the
# CURRENT platformMultipliers via the sov_board_agg RPC (a read), and prints the
# before->after delta. Writes NOTHING. Use this to review the change before
# running backfill_generalized.py (which does the actual upserts).
#
#   python3 sov-tooling/backfill_dryrun.py
import json, urllib.request, datetime
SB = open('sov-tooling/.sbkey').read().strip()
BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
def req(method, path, body=None):
    h = {'apikey': SB, 'Authorization': 'Bearer '+SB, 'Content-Type': 'application/json'}
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
print('LIVE platformMultipliers:', MULT)
print('direct competitors:', len(directSet), '| total tracked:', len(allSet))
print('='*70)

def board(as_of, window_days):
    rows = req('POST','/rpc/sov_board_agg', {'as_of': as_of, 'window_days': window_days})
    agg = {p:{} for p in PLATS}
    for row in rows or []:
        p, name = row['platform'], row['company']
        if p not in agg or not name or name=='NONE' or name not in allSet: continue
        A = agg[p].setdefault(name, {'pw':0,'cntw':0,'count':0})
        A['pw'] += float(row['wsum'] or 0); A['cntw'] += int(row['cnt'] or 0); A['count'] += int(row['cnt'] or 0)
    score, cntw = {}, {}
    directScore = grandCntw = 0
    for p in PLATS:
        m = float(MULT.get(p, 1))
        for name, A in agg[p].items():
            score[name] = score.get(name,0) + m*A['pw']
            cntw[name] = cntw.get(name,0)+A['cntw']
    for name,v in score.items():
        if name in directSet: directScore += v
    for name,v in cntw.items():
        if name in directSet: grandCntw += v
    out={}
    for name in allNames:
        w = round(100*score.get(name,0)/directScore,4) if directScore>0 else 0
        u = round(100*cntw.get(name,0)/grandCntw,4) if grandCntw>0 else 0
        ov = round(overallW.get('weighted',0.8)*w + overallW.get('unweighted',0.2)*u,4)
        out[name] = {'overall':ov,'weighted_pct':w}
    return out

now_iso = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

def show_delta(tag, stored_by_name, new_by_name, key='overall', top=6):
    rows=[]
    for name in stored_by_name:
        old = stored_by_name[name]; new = new_by_name.get(name,{}).get(key,0)
        if abs(new-old) >= 0.05:
            rows.append((abs(new-old), name, old, new))
    rows.sort(reverse=True)
    if not rows:
        print(f'  {tag}: no material change'); return 0
    print(f'  {tag}: {len(rows)} companies shift (top {min(top,len(rows))} by |Δ|):')
    for _,name,old,new in rows[:top]:
        print(f'      {name:28} {old:6.2f} -> {new:6.2f}  ({new-old:+.2f})')
    return len(rows)

# --- Frozen WEEKLY rows (<= 2026-07-09) ---
print('\nWEEKLY (frozen weeks <= 2026-07-09):')
wk_rows = req('GET','/sov_weekly?select=week_start,company,overall&order=week_start.desc')
by_week={}
for r in wk_rows:
    if r['week_start'] <= '2026-07-09':
        by_week.setdefault(r['week_start'],{})[r['company']]=float(r['overall'] or 0)
total=0
for wk in sorted(by_week, reverse=True):
    wk_d=datetime.date.fromisoformat(wk); nb=wk_d+datetime.timedelta(days=7)
    as_of=(now_iso if nb>datetime.date.today() else nb.isoformat()+'T03:45:00Z')
    new=board(as_of,None)
    total += show_delta(f'week {wk}', by_week[wk], new)

# --- Frozen DAILY rows (2026-06-29 .. 2026-07-14), window 7 & 30 ---
print('\nDAILY (frozen 2026-06-29 .. 2026-07-14):')
dl_rows = req('GET','/sov_daily?select=snapshot_date,company,overall,window_days&order=snapshot_date.desc')
by_day={}
for r in dl_rows:
    if r['snapshot_date'] <= '2026-07-14' and r['window_days'] in (7,30):
        by_day.setdefault((r['snapshot_date'],r['window_days']),{})[r['company']]=float(r['overall'] or 0)
for (d,wd) in sorted(by_day, reverse=True):
    new=board(d+'T03:45:00Z', wd)
    total += show_delta(f'{d} w{wd}', by_day[(d,wd)], new)

print('\n'+'='*70)
print(f'DRY RUN COMPLETE — nothing written. Total row-company shifts >=0.05: {total}')
print('To apply: python3 sov-tooling/backfill_generalized.py (after extending its date ranges to match).')
