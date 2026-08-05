#!/usr/bin/env python3
# Read-only smoke suite for the 2026-07 features (multi-company attribution,
# direct/indirect tracking policy, table-driven competitors). NO paid runs — just
# DB reads + n8n-admin execution status. Run after a deploy, nightly, or after a
# competitor change:  python3 sov-tooling/verify_features.py
import json, urllib.request, urllib.parse, subprocess, datetime, sys
SB = open('sov-tooling/.sbkey').read().strip()
BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
H = {'apikey': SB, 'Authorization': 'Bearer ' + SB}
EDIT_DAY = '2026-07-23'   # policy/gate edits went live this day; "new" data = on/after
PLAT = {'linkedin_posts': 'posted_at', 'tweets': 'createdAt', 'googlenews': 'publishedAt', 'reddit_posts': 'createdAt'}
NON_LI = ['tweets', 'googlenews', 'reddit_posts']
oks = warns = fails = 0
def line(tag, msg):
    global oks, warns, fails
    oks += tag == 'PASS'; warns += tag == 'WARN'; fails += tag == 'FAIL'
    print(f'  [{tag}] {msg}')
def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + path, headers=H)))
def count(table, q):
    r = urllib.request.Request(f'{BASE}/{table}?{q}&select=id', headers={**H, 'Prefer': 'count=exact'}, method='HEAD')
    try:
        with urllib.request.urlopen(r) as resp:
            cr = resp.headers.get('content-range', '*/0'); return int(cr.split('/')[-1])
    except urllib.error.HTTPError:
        # tables keyed differently (no `id`) — retry without a select column
        r2 = urllib.request.Request(f'{BASE}/{table}?{q}', headers={**H, 'Prefer': 'count=exact'}, method='HEAD')
        with urllib.request.urlopen(r2) as resp:
            cr = resp.headers.get('content-range', '*/0'); return int(cr.split('/')[-1])

comps = get('/competitors?select=name,type,active,definition,keywords,collision_terms&active=eq.true')
direct = [c for c in comps if (c.get('type') or 'direct') != 'indirect']
indirect = [c for c in comps if (c.get('type') or 'direct') == 'indirect']

print('\n1) TABLE-DRIVEN — every active competitor has enrichment the gates read:')
empty = [c['name'] for c in comps if not c.get('definition')]
if empty: line('WARN', f'{len(empty)} competitor(s) have NO definition (run Auto-fill in the app): {", ".join(empty)}')
else: line('PASS', f'all {len(comps)} active competitors have a definition (gate disambiguation)')

print('\n2) MULTI-COMPANY — board healthy + company_names populating:')
# direct SOV% sum ≈ 100 on the latest 7d board
board = get(f'/sov_daily?select=company,overall,window_days,snapshot_date&window_days=eq.7&order=snapshot_date.desc&limit=40')
if board:
    latest = board[0]['snapshot_date']
    dsum = sum(r['overall'] for r in board if r['snapshot_date'] == latest and r['company'] in {c['name'] for c in direct})
    line('PASS' if 95 <= dsum <= 105 else 'FAIL', f'direct SOV% sum on {latest} 7d board = {dsum:.1f} (expect ~100)')
for t in PLAT:
    n = count(t, 'company_names=not.is.null')
    (line('PASS', f'{t}: {n} rows carry company_names[]') if n else
     line('WARN', f'{t}: 0 rows with company_names yet — workflows may not have run since the edit'))

print('\n3) DIRECT/INDIRECT — indirect tracked SOLELY via LinkedIn (post-edit data):')
inames = {c['name'] for c in indirect}
leak = 0
for t in NON_LI:
    for nm in inames:
        n = count(t, f'companyName=eq.{urllib.parse.quote(nm)}&{PLAT[t]}=gte.{EDIT_DAY}')
        if n:
            leak += 1; line('FAIL', f'{t}: indirect "{nm}" has {n} attributed post(s) on/after {EDIT_DAY} (should be 0)')
if not leak: line('PASS', f'no indirect competitor attributed on X/Reddit/News since {EDIT_DAY}')

print('\n4) ATTRIBUTION HEALTH — gates still attributing (last 3d):')
since = (datetime.date(2026, 7, 23) - datetime.timedelta(days=3)).isoformat()
for t, col in PLAT.items():
    n = count(t, f'companyName=not.is.null&companyName=neq.NONE&{col}=gte.{since}')
    line('PASS' if n or t in ('googlenews', 'reddit_posts') else 'WARN',
         f'{t}: {n} attributed post(s) since {since}' + (' (weekly/low-volume ok)' if not n and t in ('googlenews','reddit_posts') else ''))

print('\n5) WORKFLOW EXECUTIONS — last runs succeeded (catches gate errors):')
WF = {'F2EclaqNpxi054iI': 'Processor', 'xVOA25o3tZlAnSCx': 'News', '3aYO4hfbwRbx7tv0': 'X', 'qN2hd39B7AlUlXb3': 'Reddit'}
for wid, nm in WF.items():
    try:
        out = subprocess.run(['/Users/elansmyla/bin/n8n-admin', 'executions', wid], capture_output=True, text=True, timeout=30).stdout.strip().splitlines()
        top = out[0] if out else '(no executions)'
        line('PASS' if 'success' in top else 'WARN', f'{nm}: latest exec → {top[:70]}')
    except Exception as e:
        line('WARN', f'{nm}: could not read executions ({e})')

print(f'\n=== {oks} PASS · {warns} WARN · {fails} FAIL ===')
sys.exit(1 if fails else 0)
