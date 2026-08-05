#!/usr/bin/env python3
"""
30-day backfill scraper (STEP 1 of backfill_30d_PLAN.md).

Pulls the past ~30 days from all 4 platforms via Apify, dedupes LinkedIn, and
writes raw staged JSON to backfill_staging/. Does NOT touch the DB — scoring
(STEP 2, Claude) + weight/load (STEP 3) come after.

SAFETY: with no APIFY_TOKEN in the env it DRY-RUNS — prints exactly what it would
call + the cost estimate, and makes zero paid calls. Set APIFY_TOKEN to run for real.

Env knobs:
  APIFY_TOKEN     (required to actually run; rotated token from Elan/n8n)
  LI_DATE_FILTER  default 'past-month'  (confirm via STEP 0 of the plan)
  LI_MAX_PAGES    default 12            (safety cap; 50 results/page)
  MAX_AGE_DAYS    default 30            (client-side window cutoff)
"""
import os, json, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

OUT = '/Users/elansmyla/Documents/Claude/Projects/SOV+Comp+POI/sov-tooling'
STAGE = f'{OUT}/backfill_staging'
KEY = open(f'{OUT}/.sbkey').read().strip()
SB = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
SBH = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}

TOKEN = os.environ.get('APIFY_TOKEN', '').strip()
DRY = not TOKEN
LI_DATE_FILTER = os.environ.get('LI_DATE_FILTER', 'past-month')
LI_MAX_PAGES = int(os.environ.get('LI_MAX_PAGES', '12'))
MAX_AGE_DAYS = int(os.environ.get('MAX_AGE_DAYS', '30'))
NOW = datetime.now(timezone.utc)
CUTOFF = NOW - timedelta(days=MAX_AGE_DAYS)

ACT = {  # actor/task ids (from SOV_Workflow_v2)
    'li': '5QnEH5N71IK2mFLrP',        # LinkedIn search + company-page
    'reddit': 'RSijjMBLS6g1W11GY',    # $0.052 PER START -> exactly one call
    'x': '61RPP7dywgiy0JPD0',
    'news_task': '3Z6SK7F2WoPU3t2sg',
}
cost = {'li_results': 0, 'reddit_starts': 0, 'x_results': 0, 'news_results': 0, 'li_company_results': 0}

def sb_get(table, cols, extra=''):
    o = []; off = 0
    while True:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(
            f'{SB}/{table}?select={cols}&limit=1000&offset={off}{extra}', headers=SBH), timeout=90).read())
        o += r
        if len(r) < 1000: break
        off += 1000
    return o

def apify(act_id, body, is_task=False):
    """run-sync-get-dataset-items -> list. DRY mode returns [] without calling."""
    if DRY:
        print(f'   [DRY] would POST {"task" if is_task else "actor"} {act_id}  body={json.dumps(body)[:160]}')
        return []
    base = 'actor-tasks' if is_task else 'acts'
    url = f'https://api.apify.com/v2/{base}/{act_id}/run-sync-get-dataset-items?token={TOKEN}'
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    for attempt in range(3):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=300).read())
        except urllib.error.HTTPError as e:
            print(f'   apify HTTP {e.code}: {e.read()[:200]}')
            if e.code in (429, 500, 502, 503): time.sleep(5 * (attempt + 1)); continue
            return []
        except Exception as e:
            print(f'   apify err: {e}'); time.sleep(5); continue
    return []

def post_date(p):
    """best-effort post timestamp from an actor result (key name varies)."""
    for k in ('posted_at', 'postedAt', 'postedDate', 'date', 'time', 'publishedAt', 'created_at', 'createdAt'):
        v = p.get(k)
        if v:
            s = str(v).strip().replace(' ', 'T')
            if '+' not in s and 'Z' not in s and 'T' in s: s += '+00:00'
            try: return datetime.fromisoformat(s.replace('Z', '+00:00'))
            except Exception: pass
    return None

def li_id(p):
    for k in ('activity_id', 'urn', 'full_urn', 'id', 'post_url', 'postUrl', 'url'):
        if p.get(k): return str(p[k])
    return None

# ---- roster ----
comps = sb_get('competitors', 'name,aliases,linkedin_urn,active')
active = [c for c in comps if c.get('active') is not False]
keywords = [c['name'] for c in active]
urns = [str(c['linkedin_urn']) for c in active if c.get('linkedin_urn')]
print(f"{'DRY-RUN (no APIFY_TOKEN) — no paid calls' if DRY else 'LIVE RUN'} | window={MAX_AGE_DAYS}d | LI_DATE_FILTER={LI_DATE_FILTER} | {len(active)} companies")
print('companies:', ', '.join(keywords))
if not DRY: os.makedirs(STAGE, exist_ok=True)

# ---- 1) LinkedIn mentions (per company, window-exhaustion pagination) ----
li_raw = {}
for kw in keywords:
    kept = 0
    for page in range(1, LI_MAX_PAGES + 1):
        body = {'keyword': kw, 'date_filter': LI_DATE_FILTER, 'limit': 50, 'page_number': page, 'sort_type': 'date_posted'}
        res = apify(ACT['li'], body)
        cost['li_results'] += len(res)
        oldest = None
        for p in res:
            i = li_id(p)
            if i: li_raw.setdefault(i, {**p, 'search_input': kw, 'source': 'keyword'}); kept += 1
            d = post_date(p)
            if d and (oldest is None or d < oldest): oldest = d
        if len(res) < 50:
            break  # window exhausted for this company
        if oldest and oldest < CUTOFF:
            break  # reached the 30-day cutoff
        if page == LI_MAX_PAGES:
            print(f'   ⚠ {kw}: hit LI_MAX_PAGES={LI_MAX_PAGES} (possible truncation — bump cap or split into weekly windows)')
    print(f'   LinkedIn "{kw}": {kept} kept (running unique {len(li_raw)})')

# ---- 2) LinkedIn company-page (one batched call over all URNs) ----
if urns:
    res = apify(ACT['li'], {'date_filter': LI_DATE_FILTER, 'company_urns': ','.join(urns), 'limit': 50, 'sort_type': 'relevance'})
    cost['li_company_results'] += len(res)
    for p in res:
        i = li_id(p)
        if i: li_raw.setdefault(i, {**p, 'source': 'company_page'})
    print(f'   LinkedIn company-page: +{len(res)} (unique now {len(li_raw)})')

# ---- 3) Reddit (ONE batched call — $0.052/start) ----
reddit_raw = apify(ACT['reddit'], {'searchQueries': keywords, 'sort': 'new', 'time': 'month', 'maxItems': 600,
                                   'proxyConfiguration': {'useApifyProxy': True, 'apifyProxyGroups': ['RESIDENTIAL']}})
cost['reddit_starts'] += 1

# ---- 4) X (ONE batched call, 30-day start) ----
x_parts = []
for c in active:
    x_parts.append(f'"{c["name"]}"')
    if c.get('x_handle'): x_parts.append('@' + str(c['x_handle']).lstrip('@'))
x_query = ' OR '.join(dict.fromkeys(x_parts))
x_start = CUTOFF.date().isoformat()
x_raw = apify(ACT['x'], {'searchTerms': [x_query], 'sort': 'Latest', 'start': x_start, 'maxItems': 800, 'includeSearchTerms': True})
cost['x_results'] += len(x_raw)

# ---- 5) Google News (task, 30-day timeframe) ----
news_raw = apify(ACT['news_task'], {'keywords': keywords, 'maxArticles': 100, 'timeframe': '30d',
                                    'region_language': 'US:en', 'decodeUrls': True, 'extractDescriptions': True,
                                    'proxyConfiguration': {'useApifyProxy': True}}, is_task=True)
cost['news_results'] += len(news_raw)

# ---- stage + report ----
if not DRY:
    json.dump(list(li_raw.values()), open(f'{STAGE}/linkedin_raw.json', 'w'))
    json.dump(reddit_raw, open(f'{STAGE}/reddit_raw.json', 'w'))
    json.dump(x_raw, open(f'{STAGE}/x_raw.json', 'w'))
    json.dump(news_raw, open(f'{STAGE}/news_raw.json', 'w'))

est = cost['li_results'] * 0.005 + cost['li_company_results'] * 0.005 + cost['reddit_starts'] * 0.052 + cost['x_results'] * 0.0004 + cost['news_results'] * 0.002
print('\n=== SUMMARY ===')
print(f"LinkedIn mentions unique : {len(li_raw)}  (results pulled: {cost['li_results']} + company-page {cost['li_company_results']})")
print(f"Reddit items             : {len(reddit_raw)}  (starts: {cost['reddit_starts']})")
print(f"X items                  : {len(x_raw)}")
print(f"News items               : {len(news_raw)}")
print(f"Estimated Apify cost      : ${est:.2f}")
if DRY:
    print('\nDRY-RUN: nothing scraped, nothing spent. Set APIFY_TOKEN to run for real.')
else:
    print(f'\nStaged to {STAGE}/. NEXT: STEP 2 (Claude scoring) -> STEP 3 (recompute_weights.py + full_board_v2.py).')
