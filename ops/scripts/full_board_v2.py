import json, urllib.request, urllib.error, math
from datetime import datetime, timezone, timedelta
from collections import defaultdict
OUT='/Users/elansmyla/Documents/Claude/Projects/SOV+Comp+POI/sov-tooling'
KEY=open(f'{OUT}/.sbkey').read().strip()
BASE='https://addwjngdezmmnxddulll.supabase.co/rest/v1'
H={'apikey':KEY,'Authorization':f'Bearer {KEY}'}
NOW=datetime.now(timezone.utc)
def g(t,c):
    o=[];off=0
    while True:
        r=json.loads(urllib.request.urlopen(urllib.request.Request(f'{BASE}/{t}?select={c}&limit=1000&offset={off}',headers=H),timeout=90).read());o+=r
        if len(r)<1000:break
        off+=1000
    return o
def iso(t):
    s=str(t or '').strip().replace(' ','T')
    if not s: return None
    if '+' not in s and 'Z' not in s: s+='+00:00'
    return s
def agedays(t):
    try: return max(0.0,(NOW-datetime.fromisoformat(iso(t))).total_seconds()/86400.0)
    except: return 0.0
def decay(age,hl): return 1.0 if age<=7 else 2**(-age/hl)

cfg=g('sov_config','config')[0]['config']
PW=cfg.get('platformWeights') or {'LinkedIn':.35,'Google News':.30,'Reddit':.20,'X':.15}
MINV=cfg.get('minPlatformVolume',3)
OW=cfg.get('overallWeights') or {'weighted':0.8,'unweighted':0.2,'sentiment':0.0}
HL=cfg.get('halfLifeDays') or {'LinkedIn':14,'Google News':30,'Reddit':10,'X':7}
print('weights:',OW,'| count = ALL posts (incl self-posts), decayed')

comps=g('competitors','name,aliases,linkedin_urn,active')
idx={}; activeSet=set(); turns=set()
for c in comps:
    if c.get('active') is False: continue
    activeSet.add(c['name'])
    if c.get('linkedin_urn'): turns.add(str(c['linkedin_urn']))
    for v in [c['name']]+(c.get('aliases') or []):
        k=str(v or '').strip().lower()
        if k: idx[k]=c['name']
def disp(cn):
    if cn is None: return None
    s=str(cn).strip()
    if not s or s.upper()=='NONE' or s.lower()=='null': return None
    return idx.get(s.lower(), s)

# classifier: employee profile_id -> their competitor (so employee self-posts aren't counted as external sentiment)
# single source of truth = the author_affiliation table (what n8n + frontend read); file is fallback
EMP={}
try:
    for a in g('author_affiliation','profile_id,competitor,verdict'):
        if a.get('verdict')=='employee' and a.get('profile_id') and a.get('competitor'):
            EMP[str(a['profile_id'])]=str(a['competitor']).strip().lower()
except Exception as e:
    print('WARN: author_affiliation fetch failed; falling back to author_verdicts.json:',e)
    try:
        for v in json.load(open(f'{OUT}/author_verdicts.json')):
            if v.get('verdict')=='employee' and v.get('key') and v.get('company'):
                EMP[str(v['key'])]=str(v['company']).strip().lower()
    except Exception as e2:
        print('WARN: file fallback also failed:',e2)

def li_external(r):
    a=r.get('author') or {}; prof=str(a.get('profile_id') or '') if isinstance(a,dict) else ''
    head=str(a.get('headline') or '').lower() if isinstance(a,dict) else ''; cn=str(r.get('companyName') or '')
    if prof and prof in turns: return False
    if cn and cn!='NONE' and cn.lower() in head: return False
    if prof and prof in EMP and cn and cn.lower()==EMP[prof]: return False  # classifier employee
    return True

posts=[]
for r in g('linkedin_posts','companyName,sentiment,post_weight,posted_at,author'):
    d=disp(r.get('companyName'))
    if not d: continue
    posts.append({'plat':'LinkedIn','co':d,'sent':r.get('sentiment'),'w':float(r.get('post_weight') or 0),
                  'ext':li_external(r),'age':agedays(r.get('posted_at'))})
for r in g('googlenews','companyName,sentiment,post_weight,publishedAt'):
    d=disp(r.get('companyName'));
    if not d: continue
    posts.append({'plat':'Google News','co':d,'sent':r.get('sentiment'),'w':float(r.get('post_weight') or 0),'ext':True,'age':agedays(r.get('publishedAt'))})
for r in g('reddit_posts','companyName,sentiment,post_weight,createdAt'):
    d=disp(r.get('companyName'))
    if not d: continue
    posts.append({'plat':'Reddit','co':d,'sent':r.get('sentiment'),'w':float(r.get('post_weight') or 0),'ext':True,'age':agedays(r.get('createdAt'))})
for r in g('tweets','companyName,sentiment,post_weight,createdAt'):
    d=disp(r.get('companyName'))
    if not d: continue
    posts.append({'plat':'X','co':d,'sent':r.get('sentiment'),'w':float(r.get('post_weight') or 0),'ext':True,'age':agedays(r.get('createdAt'))})

# weighted denominator (active only)
platTot=defaultdict(float); platCo=defaultdict(lambda:defaultdict(float))
for p in posts:
    platCo[p['plat']][p['co']]+=p['w']
    if p['co'] in activeSet: platTot[p['plat']]+=p['w']
live=[pl for pl in platTot if platTot[pl]>=MINV] or list(platTot)
wsum=sum(PW.get(pl,0) for pl in live) or 1
eff={pl:PW.get(pl,0)/wsum for pl in live}

# all-posts decayed count (company self-posts count too — content production is an OKR)
cntw=defaultdict(float); cnt=defaultdict(int); sS=defaultdict(float); sN=defaultdict(int)
for p in posts:
    cnt[p['co']]+=1
    cntw[p['co']]+=decay(p['age'],HL.get(p['plat'],14))
    if p['ext'] and p['sent'] is not None:   # sentiment = EXTERNAL only (earned perception, not self-promo)
        try: sS[p['co']]+=float(p['sent']); sN[p['co']]+=1
        except: pass
cntTot=sum(cntw[c] for c in cntw if c in activeSet) or 1

board=[]
for c in sorted(cnt):
    wtd=sum(eff[pl]*((platCo[pl].get(c,0)/platTot[pl]) if platTot[pl]>0 else 0) for pl in live)*100
    cs=(cntw[c]/cntTot)*100
    avg=(sS[c]/sN[c]) if sN[c] else 0; sent=((avg+3)/6)*100
    overall=OW['weighted']*wtd+OW['unweighted']*cs+OW.get('sentiment',0)*sent
    board.append({'co':c,'active':c in activeSet,'overall':overall,'wtd':wtd,'cnt':cs,'sent':sent,'posts':cnt[c],'cntw':cntw[c]})
board.sort(key=lambda x:-x['overall'])
def show(rows,t):
    print(f"\n=== {t} ===")
    print(f"{'company':<20}{'SOV%':>8}{'wtd':>8}{'cnt%':>8}{'sent':>7}{'posts':>7}{'cntWt':>8}")
    for b in rows:
        print(f"{b['co']:<20}{b['overall']:>8.2f}{b['wtd']:>8.2f}{b['cnt']:>8.2f}{b['sent']:>7.1f}{b['posts']:>7}{b['cntw']:>8.1f}")
act=[b for b in board if b['active']]; non=[b for b in board if not b['active']]
show(act,"ACTIVE (new baseline model; SOV% sums to 100)")
print(f"   >>> SUM active SOV% = {sum(b['overall'] for b in act):.2f}")
show(non,"NON-ACTIVE (float vs active field)")
# write active to sov_weekly
today=NOW.date(); ws=(today-timedelta(days=today.weekday())).isoformat()
snap=[{'week_start':ws,'company':b['co'],'overall':round(b['overall'],2),'weighted_pct':round(b['wtd'],2),
       'unweighted_pct':round(b['cnt'],2),'sentiment_pct':round(b['sent'],2),'posts_count':b['posts']} for b in act]
HU=dict(H);HU['Content-Type']='application/json';HU['Prefer']='resolution=merge-duplicates,return=minimal'
try:
    urllib.request.urlopen(urllib.request.Request(f'{BASE}/sov_weekly?on_conflict=week_start,company',data=json.dumps(snap).encode(),headers=HU,method='POST'),timeout=90)
    print(f"\nsov_weekly upsert OK (active, week {ws})")
except urllib.error.HTTPError as e: print("\nsov_weekly ERR",e.code,e.read()[:200])
