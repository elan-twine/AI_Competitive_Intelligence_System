#!/usr/bin/env python3
# One-shot DATABASE STATE dump for onboarding / sanity checks.
# Run: python3 sov-tooling/db_state.py   (reads sov-tooling/.sbkey)
# Prints: per-table inventory (total / attributed / scored / stray) + the LIVE
# board (direct-only, weighted-only) so a new thread instantly knows the DB state.
import json, urllib.request, os, math
from datetime import datetime, timezone
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
K = open(os.path.join(HERE, '.sbkey')).read().strip()
B = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
H = {'apikey': K, 'Authorization': 'Bearer ' + K}
NOW = datetime.now(timezone.utc)

def count(p):
    return int(urllib.request.urlopen(urllib.request.Request(B + p, headers={**H, 'Prefer': 'count=exact'})).headers.get('Content-Range', '?/?').split('/')[-1])
def g(t, c):
    o = []; off = 0
    while True:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(f'{B}/{t}?select={c}&limit=1000&offset={off}', headers=H)).read()); o += r
        if len(r) < 1000: break
        off += 1000
    return o
def age(t):
    try:
        s = str(t or '').replace(' ', 'T'); s = s + ('' if ('+' in s or 'Z' in s) else '+00:00')
        return max(0, (NOW - datetime.fromisoformat(s)).total_seconds() / 86400)
    except: return 0
def decay(a, hl): return 1.0 if a <= 7 else 2 ** (-a / hl)

print("=== COMPETITORS ===")
comps = g('competitors', 'name,active,type,is_self,linkedin_urn,domain')
direct = set(c['name'] for c in comps if c.get('active') != False and (c.get('type') or 'direct') != 'indirect')
indirect = set(c['name'] for c in comps if c.get('active') != False and (c.get('type') or 'direct') == 'indirect')
print("  DIRECT:", sorted(direct))
print("  INDIRECT:", sorted(indirect))
print("  inactive/untracked rows:", sorted(c['name'] for c in comps if c.get('active') == False))

print("\n=== TABLE INVENTORY (attributed should == scored; stray should be 0) ===")
for t in ['linkedin_posts', 'googlenews', 'tweets', 'reddit_posts']:
    tot = count(f'/{t}?select=*&limit=1')
    none_null = count(f'/{t}?select=*&or=(companyName.is.null,companyName.eq.NONE)&limit=1')
    scored = count(f'/{t}?select=*&post_weight=not.is.null&limit=1')
    stray = count(f'/{t}?select=*&or=(companyName.is.null,companyName.eq.NONE)&post_weight=not.is.null&limit=1')
    print(f"  {t:<16} total={tot:<6} attributed={tot - none_null:<6} scored={scored:<6} stray-weights={stray}")

cfg = g('sov_config', 'config')[0]['config']
PW = cfg['platformWeights']; MINV = cfg.get('minPlatformVolume', 3); HL = cfg['halfLifeDays']; OW = cfg['overallWeights']
print(f"\n=== sov_config ===  overallWeights={OW} (weighted-only if weighted=1)")

posts = []
for t, dt, pf in [('linkedin_posts', 'LinkedIn', 'posted_at'), ('googlenews', 'Google News', 'publishedAt'), ('reddit_posts', 'Reddit', 'createdAt'), ('tweets', 'X', 'createdAt')]:
    for r in g(t, f'companyName,post_weight,{pf}'):
        cn = r.get('companyName')
        if not cn or cn == 'NONE': continue
        posts.append({'plat': dt, 'co': cn, 'w': float(r.get('post_weight') or 0), 'age': age(r.get(pf))})
pt = defaultdict(float); pc = defaultdict(lambda: defaultdict(float)); ct = defaultdict(int)
for p in posts:
    pc[p['plat']][p['co']] += p['w']; ct[p['co']] += 1
    if p['co'] in direct: pt[p['plat']] += p['w']
live = [pl for pl in pt if pt[pl] >= MINV] or list(pt)
wsum = sum(PW.get(pl, 0) for pl in live) or 1; eff = {pl: PW.get(pl, 0) / wsum for pl in live}
board = sorted(((c, sum(eff[pl] * ((pc[pl].get(c, 0) / pt[pl]) if pt[pl] > 0 else 0) for pl in live) * 100, ct[c]) for c in direct), key=lambda x: -x[1])
print(f"\n=== LIVE BOARD (direct-only, weighted-only) — eligible platforms {live} ===")
for c, w, n in board: print(f"  {c:<18}{w:>7.2f}%  ({n} posts)")
print(f"  sum = {sum(w for _, w, _ in board):.1f}")
print("\n(Non-direct attributed companies float vs the field; indirect are graphed but excluded from the %.)")
