import json, math, urllib.request, urllib.error
from datetime import datetime, timezone
OUT='/Users/elansmyla/Documents/Claude/Projects/SOV+Comp+POI/sov-tooling'
KEY=open(f'{OUT}/.sbkey').read().strip()
BASE='https://addwjngdezmmnxddulll.supabase.co/rest/v1'
H={'apikey':KEY,'Authorization':f'Bearer {KEY}'}
NOW=datetime.now(timezone.utc)

def get_all(table, cols):
    rows=[]; page=1000; off=0
    while True:
        h=dict(H); h['Range-Unit']='items'; h['Range']=f'{off}-{off+page-1}'
        req=urllib.request.Request(f'{BASE}/{table}?select={cols}',headers=h)
        rows.extend(json.loads(urllib.request.urlopen(req,timeout=90).read()))
        if len(rows)%page!=0 or len(rows)==0: break
        off+=page
    return rows

def upsert(table, conflict, rows):
    h=dict(H); h['Content-Type']='application/json'; h['Prefer']='resolution=merge-duplicates,return=minimal'
    ok=0
    for i in range(0,len(rows),200):
        ch=rows[i:i+200]
        req=urllib.request.Request(f'{BASE}/{table}?on_conflict={conflict}',data=json.dumps(ch).encode(),headers=h,method='POST')
        try:
            urllib.request.urlopen(req,timeout=120); ok+=len(ch)
        except urllib.error.HTTPError as e:
            print('  upsert err',e.code,e.read()[:200]);
    return ok

def sentmult(s):
    if s is None: return 1.0   # unscored / company-page (null by design) -> neutral
    s=max(-3,min(3,s)); return 0.5+((s+3)/6)*0.8
def iso(t):
    if not t: return None
    s=str(t).strip().replace(' ','T')
    if '+' not in s and 'Z' not in s: s+='+00:00'
    return s
def agedays(t):
    if not t: return 0.0
    try: d=datetime.fromisoformat(iso(t)); return max(0.0,(NOW-d).total_seconds()/86400.0)
    except: return 0.0
def decay(age, hl):
    # 7-day grace (full strength), then decay on ACTUAL age
    return 1.0 if age <= 7 else 2**(-age/hl)

# ---- 1) update sov_config ----
cfg=get_all('sov_config','id,config')
c=cfg[0]['config']
c.setdefault('engagementWeights',{}).setdefault('LinkedIn',{})['reshare']=10
c['engagementWeights'].setdefault('X',{})['repost']=10
c['authorBaseline']={'company':1.0,'employee':2.0,'external':5.0}   # ternary floor: own page < employee < external earned mention
c['authorEngMult']={'company':1.0,'employee':1.2,'external':2.0}    # engagement multiplier: external "new eyes" worth most
c['overallWeights']={'weighted':1.0,'unweighted':0.0,'sentiment':0.0}  # weighted-only (2026-06-30 decision); do NOT revert to .8/.2
h=dict(H); h['Content-Type']='application/json'; h['Prefer']='return=minimal'
req=urllib.request.Request(f'{BASE}/sov_config?id=eq.1',data=json.dumps({'config':c}).encode(),headers=h,method='PATCH')
urllib.request.urlopen(req,timeout=60)
print('sov_config updated: reach=eng^(49/50); ternary authorBaseline co1/emp2/ext5; authorEngMult co1/emp1.2/ext2; overallWeights weighted.8/extCount.2')

# ---- tracked URNs for authorType ----
comps=get_all('competitors','name,linkedin_urn,active')
turns=set(str(x['linkedin_urn']) for x in comps if x.get('linkedin_urn') and x.get('active') is not False)

# ---- classifier: employee profile_id -> their competitor (canonical, lowercased) ----
# From the author-affiliation verdicts (heuristic -> headline LLM -> profile scrape). An
# author who is an employee of competitor X counts as company-authored ONLY on posts about
# X (an Orchid employee posting about Cerby is still external w.r.t. Cerby).
EMP={}
try:   # single source of truth = the author_affiliation table (what n8n + frontend read)
    for a in get_all('author_affiliation','profile_id,competitor,verdict'):
        if a.get('verdict')=='employee' and a.get('profile_id') and a.get('competitor'):
            EMP[str(a['profile_id'])]=str(a['competitor']).strip().lower()
    print('classifier employees from author_affiliation:',len(EMP))
except Exception as e:
    print('WARN: author_affiliation fetch failed; falling back to author_verdicts.json:',e)
    try:
        for v in json.load(open(f'{OUT}/author_verdicts.json')):
            if v.get('verdict')=='employee' and v.get('key') and v.get('company'):
                EMP[str(v['key'])]=str(v['company']).strip().lower()
    except Exception as e2:
        print('WARN: file fallback also failed:',e2)
    print('classifier employees loaded (file):',len(EMP))

# ---- 2) recompute LinkedIn ----
li=get_all('linkedin_posts','activity_id,totalReactions,comments,reshares,imageURL,sentiment,posted_at,author,companyName')
print('linkedin rows:',len(li))
FLIP=[0]
def authortype(r):
    a=r.get('author') or {}
    prof=str(a.get('profile_id') or '') if isinstance(a,dict) else ''
    head=(str(a.get('headline') or '').lower()) if isinstance(a,dict) else ''
    cn=str(r.get('companyName') or '')
    if prof and prof in turns: return 'company'                 # the org's own page
    if prof and prof in EMP and cn and cn.lower()==EMP[prof]:   # classifier: known employee posting about own company
        FLIP[0]+=1; return 'employee'
    if cn and cn!='NONE' and cn.lower() in head: return 'employee'  # headline names the company
    return 'external'
AB=c.get('authorBaseline',{'company':1.0,'employee':2.0,'external':5.0}); AEM=c.get('authorEngMult',{'company':1.0,'employee':1.2,'external':2.0})
li_rows=[]; ex=co=0
for r in li:
    eng=1*(r.get('totalReactions') or 0)+3*(r.get('comments') or 0)+10*(r.get('reshares') or 0)+(1.5 if r.get('imageURL') else 0)
    reach=eng**(49/50)  # near-linear reach
    at=authortype(r)
    if at=='company': co+=1
    else: ex+=1
    B=AB.get(at, AB['external'])      # ternary additive presence floor (company/employee/external)
    M=AEM.get(at, AEM['external'])    # ternary engagement multiplier
    pw=(B + reach*M)*sentmult(r.get('sentiment'))*decay(agedays(r.get('posted_at')),14.0)
    li_rows.append({'activity_id':r['activity_id'],'post_weight':round(pw,6)})
print(f'  authorType: company={co} external={ex}  (classifier flipped {FLIP[0]} employee posts external->company)')
print('  upserted LinkedIn:',upsert('linkedin_posts','activity_id',li_rows))

# ---- 3) recompute X ----
tw=get_all('tweets','id,likeCount,replyCount,retweetCount,quoteCount,viewCount,authorWeight,sentiment,createdAt')
print('tweets rows:',len(tw))
tw_rows=[]
for r in tw:
    eng=1*(r.get('likeCount') or 0)+2*(r.get('replyCount') or 0)+10*(r.get('retweetCount') or 0)+4*(r.get('quoteCount') or 0)
    reach=((r.get('viewCount') or 0)+eng)**(49/50)  # D1: near-linear reach
    aw=r.get('authorWeight') if r.get('authorWeight') is not None else 1
    pw=reach*float(aw)*sentmult(r.get('sentiment'))*decay(agedays(r.get('createdAt')),7.0)
    tw_rows.append({'id':r['id'],'post_weight':round(pw,6)})
print('  upserted X:',upsert('tweets','id',tw_rows))
print('\nDONE. Run li_snapshot.py next for the new board.')
