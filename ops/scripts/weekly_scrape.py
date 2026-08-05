#!/usr/bin/env python3
"""
weekly_scrape.py — Standalone weekly Share-of-Voice scraper (TRACK 2).

WHY THIS EXISTS
  The n8n weekly SOV workflow OOMs on n8n-Cloud's fixed 320MiB per-execution RAM
  (all cross-branch/loop run data is held in memory for a single execution). This
  is a from-scratch Python port with NO n8n and NO 320MiB ceiling: it loops one
  company at a time and frees each company's data before the next, so peak memory
  is bounded by a single company's post set (a few hundred rows), not the whole run.

WHAT IT PORTS (VERBATIM from the live n8n LinkedIn "sub" logic,
  n8n-backups/sov_SUB_pre-split_2026-06-30.json + MAIN dispatcher):
    - Apify LinkedIn keyword search (actor 5QnEH5N71IK2mFLrP,
      run-sync-get-dataset-items, body {keyword, date_filter:"past-week",
      limit:50, page_number, sort_type:"date_posted"}; paginate, stop when a page
      returns <50; maxRequests cap ~5).
    - Apify LinkedIn company-page (same actor, {company_urns, date_filter,
      limit:50, sort_type:"date_posted"}).   <-- R1 refinement (was "relevance")
    - Flatten field mapping (Flatten LinkedIn / Flatten LinkedIn Company).
    - Dedup by activity_id, company_page wins (Dedup LinkedIn by activity_id).
    - OpenAI attribution + sentiment prompt (LLM Sentiment+Attribution LinkedIn).
    - post_weight formula (Compute LinkedIn post_weight + recompute_weights.py).

THE THREE COMPANY-PAGE REFINEMENTS (from SPLIT_BUILD_STATE.md):
    R1: company-page scrape sort_type = "date_posted" (not "relevance").
    R2: company-page posts BYPASS the OpenAI attribution/relevance LLM entirely —
        auto-accept + force companyName = the company being processed.
    R3: company-page posts get sentiment = null and sentMult = 1.0 (no self-sentiment).
    Keyword-mention posts: full OpenAI attribution + sentiment; drop companyName == NONE.

LINKEDIN IS FULLY IMPLEMENTED (proof-of-concept). Reddit / X / Google News / the
weekly snapshot are stubbed with clear TODO markers and sibling-function scaffolding
so they can be dropped in later with the same per-company, memory-bounded loop shape.

  !!! THIS SCRIPT SPENDS APIFY MONEY WHEN RUN FOR REAL. It is BUILD-ONLY for now.
  !!! Do NOT run without Elan's explicit go. Use --dry-run to exercise it safely
  !!! (dry-run makes zero Apify calls and zero DB writes).

SECRETS (read at runtime; never hardcode/commit):
    Supabase service_role JWT : sov-tooling/.sbkey  (required)
    Apify token               : env APIFY_TOKEN, else the n8n-embedded default below
                                 (TODO: ROTATE — it's checked into the n8n node).
    OpenAI API key            : env OPENAI_API_KEY, else sov-tooling/.openaikey
                                 (REQUIRED to score keyword posts; if absent the
                                 script fails gracefully with a clear message —
                                 the user will provide it. company_page posts do
                                 NOT need OpenAI, so --company on a page-only run
                                 can proceed, but keyword scoring is skipped.)

USAGE:
    python3 sov-tooling/weekly_scrape.py                 # all active companies, LIVE
    python3 sov-tooling/weekly_scrape.py --dry-run       # scrape+score, NO Apify, NO writes
    python3 sov-tooling/weekly_scrape.py --company Orchid # single-company test
    python3 sov-tooling/weekly_scrape.py --max-requests 2 # lower the pagination cap
    python3 sov-tooling/weekly_scrape.py --company Orchid --dry-run --max-requests 1

    --dry-run     : make NO Apify calls and NO Supabase writes; print the plan +
                    what would have been scraped/scored/written. Zero cost.
    --company NAME: process only the competitor whose name matches NAME
                    (case-insensitive). Great for single-company validation.
    --max-requests N : LinkedIn keyword pagination page cap (default 5, per n8n).
"""

import os
import sys
import json
import time
import math
import argparse
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

# --------------------------------------------------------------------------- #
#  Paths / constants
# --------------------------------------------------------------------------- #
HERE = os.path.dirname(os.path.abspath(__file__))
SB_BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
LI_ACTOR = '5QnEH5N71IK2mFLrP'          # LinkedIn search + company-page actor
LI_ACTOR_URL = f'https://api.apify.com/v2/acts/{LI_ACTOR}/run-sync-get-dataset-items'
OPENAI_MODEL = 'gpt-4o-mini'            # matches the n8n LLM node
OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
NOW = datetime.now(timezone.utc)

# TODO(rotate): this Apify token is embedded in the n8n node and checked into the
# workflow JSON. Prefer env APIFY_TOKEN; rotate this default out when convenient.
APIFY_TOKEN_DEFAULT = 'apify_api_<REDACTED — see Apify console>'

# Per-company LinkedIn keyword overrides (VERBATIM from MAIN "Build LinkedIn
# Company Items"): specific names cut generic-word junk -> cheaper Apify.
# Default = [full company name]. Opti gets two queries.
KEYWORD_OVERRIDES = {
    'Lumos':   ['Lumos'],
    'Opti':    ['Opti IAM', 'Opti Identity'],
    'OFFROAD': ['Offroad Security'],
    '7AI':     ['7AI'],
    'Console': ['Console security'],
}

# Full company definitions (attribution/disambiguation) embedded into the OpenAI
# prompt. Loaded from competitor_definitions.md at runtime (see load_definitions()).
DEFINITIONS_FILE = os.path.join(HERE, 'competitor_definitions.md')


# --------------------------------------------------------------------------- #
#  Secrets
# --------------------------------------------------------------------------- #
def load_supabase_headers():
    """Read the Supabase service_role JWT from sov-tooling/.sbkey."""
    path = os.path.join(HERE, '.sbkey')
    if not os.path.exists(path):
        sys.exit(f'FATAL: Supabase key file not found at {path}')
    key = open(path).read().strip()
    return {'apikey': key, 'Authorization': f'Bearer {key}'}


def load_apify_token():
    """env APIFY_TOKEN, else the n8n-embedded default (with a rotate TODO)."""
    return os.environ.get('APIFY_TOKEN', '').strip() or APIFY_TOKEN_DEFAULT


def load_openai_key():
    """env OPENAI_API_KEY, else sov-tooling/.openaikey. Returns '' if absent.

    We DO NOT invent a key. Callers must check for '' and skip/abort keyword
    scoring gracefully with a clear message (company_page posts don't need it).
    """
    k = os.environ.get('OPENAI_API_KEY', '').strip()
    if k:
        return k
    path = os.path.join(HERE, '.openaikey')
    if os.path.exists(path):
        return open(path).read().strip()
    return ''


# --------------------------------------------------------------------------- #
#  HTTP helpers
# --------------------------------------------------------------------------- #
def _http(url, data=None, headers=None, method='GET', timeout=120):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    return urllib.request.urlopen(req, timeout=timeout).read()


def sb_get(headers, table, cols, extra=''):
    """Paginated Supabase GET (PostgREST). Returns list of rows."""
    out, off = [], 0
    while True:
        url = f'{SB_BASE}/{table}?select={cols}&limit=1000&offset={off}{extra}'
        rows = json.loads(_http(url, headers=headers, timeout=90))
        out += rows
        if len(rows) < 1000:
            break
        off += 1000
    return out


def sb_upsert(headers, table, conflict, rows, dry=False):
    """Batched upsert (POST + Prefer merge-duplicates), on_conflict=<conflict>."""
    if not rows:
        return 0
    if dry:
        print(f'      [DRY] would upsert {len(rows)} row(s) into {table} (on_conflict={conflict})')
        return 0
    h = dict(headers)
    h['Content-Type'] = 'application/json'
    h['Prefer'] = 'resolution=merge-duplicates,return=minimal'
    ok = 0
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        url = f'{SB_BASE}/{table}?on_conflict={conflict}'
        try:
            _http(url, data=json.dumps(chunk).encode(), headers=h, method='POST', timeout=120)
            ok += len(chunk)
        except urllib.error.HTTPError as e:
            print(f'      upsert err {e.code}: {e.read()[:200]}')
    return ok


def sb_update(headers, table, match_col, match_val, fields, dry=False):
    """Single-row PATCH (used to write back sentiment/companyName/post_weight)."""
    if dry:
        return True
    h = dict(headers)
    h['Content-Type'] = 'application/json'
    h['Prefer'] = 'return=minimal'
    url = f'{SB_BASE}/{table}?{match_col}=eq.{urllib.parse.quote(str(match_val))}'
    try:
        _http(url, data=json.dumps(fields).encode(), headers=h, method='PATCH', timeout=60)
        return True
    except urllib.error.HTTPError as e:
        print(f'      update err {e.code}: {e.read()[:200]}')
        return False


def apify_run(token, body, dry=False):
    """POST to the LinkedIn actor run-sync-get-dataset-items -> list of items.

    In dry mode: prints the intended call and returns [] (zero cost).
    Retries transient errors (429/5xx) a few times.
    """
    if dry:
        print(f'      [DRY] would POST Apify actor {LI_ACTOR}  body={json.dumps(body)[:180]}')
        return []
    url = f'{LI_ACTOR_URL}?token={token}'
    headers = {'Content-Type': 'application/json'}
    for attempt in range(3):
        try:
            raw = _http(url, data=json.dumps(body).encode(), headers=headers,
                        method='POST', timeout=300)
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            print(f'      apify HTTP {e.code}: {e.read()[:200]}')
            if e.code in (429, 500, 502, 503):
                time.sleep(5 * (attempt + 1))
                continue
            return []
        except Exception as e:  # noqa: BLE001
            print(f'      apify err: {e}')
            time.sleep(5)
    return []


# --------------------------------------------------------------------------- #
#  Config loading
# --------------------------------------------------------------------------- #
def load_definitions():
    """Load the company definitions block (competitor_definitions.md) for the prompt."""
    if os.path.exists(DEFINITIONS_FILE):
        return open(DEFINITIONS_FILE).read().strip()
    return ''  # prompt still works with enum+aliases, just less disambiguation


def load_config(headers):
    """
    Port of MAIN "Load Competitors" + "Load SOV Config" + "Build Context".

    Returns a dict:
      config       : the sov_config.config JSON (engagementWeights, halfLifeDays, ...)
      companies    : [{name, aliases, domain, x_handle, linkedin_urn, subreddits, type}]
      linkedin_urns: [urn, ...] for all active companies with a URN
      companyEnum  : "Name1, Name2, ..." (for the OpenAI attribution enum)
      definitions  : the competitor_definitions.md text
    """
    comps = sb_get(headers, 'competitors',
                   'name,aliases,domain,x_handle,linkedin_urn,subreddits,type,active,is_self')
    active = [c for c in comps if c.get('active') is not False]
    companies = [{
        'name': c['name'],
        'aliases': c.get('aliases') if isinstance(c.get('aliases'), list) else [],
        'domain': c.get('domain'),
        'x_handle': c.get('x_handle'),
        'linkedin_urn': c.get('linkedin_urn'),
        'subreddits': c.get('subreddits') if isinstance(c.get('subreddits'), list) else [],
        'type': c.get('type') or 'direct',
    } for c in active]

    cfg_rows = sb_get(headers, 'sov_config', 'id,config', extra='&id=eq.1')
    config = cfg_rows[0]['config'] if cfg_rows and cfg_rows[0].get('config') else {}

    return {
        'config': config,
        'companies': companies,
        'linkedin_urns': [c['linkedin_urn'] for c in companies if c.get('linkedin_urn')],
        'companyEnum': ', '.join(c['name'] for c in companies),
        'definitions': load_definitions(),
    }


def keywords_for(company_name):
    """Per-company LinkedIn search keywords (override map, else [full name])."""
    return KEYWORD_OVERRIDES.get(company_name, [str(company_name)])


# --------------------------------------------------------------------------- #
#  Flatten (VERBATIM field mapping from Flatten LinkedIn / Flatten LinkedIn Company)
# --------------------------------------------------------------------------- #
def flatten_post(raw, source, company_hint=None):
    """Map one raw actor result to the linkedin_posts row shape.

    source: 'keyword' or 'company_page'. company_hint: the company name for
    company_page posts (from the URN map), used by R2 force-attribution.
    """
    if not raw.get('activity_id'):
        return None
    stats = raw.get('stats') or {}
    content = raw.get('content') or {}
    article = content.get('article') if isinstance(content, dict) else {}
    article = article or {}
    posted = raw.get('posted_at') or {}
    return {
        'activity_id': raw['activity_id'],
        'post_url': raw.get('post_url') or '',
        'text': raw.get('text') or '',
        'full_urn': raw.get('full_urn') or '',
        'author': raw.get('author') or {},
        'totalReactions': stats.get('total_reactions') or 0,
        'comments': stats.get('comments') or 0,
        'reshares': stats.get('shares') or 0,
        'posted_at': posted.get('date') if isinstance(posted, dict) else None,
        'hashtags': raw.get('hashtags') or [],
        'content': content,
        'is_reshare': bool(raw.get('is_reshare')),
        'metadata': raw.get('metadata') or {},
        'search_input': raw.get('search_input') or {},
        'title': article.get('title') or '',
        'imageURL': article.get('thumbnail_url') or '',
        'source': source,
        'companyHint': company_hint,   # only meaningful for company_page
    }


# --------------------------------------------------------------------------- #
#  Scrape LinkedIn for ONE company (keyword pagination + company page)
# --------------------------------------------------------------------------- #
def scrape_linkedin_company(company, token, max_requests, dry=False):
    """
    Scrape LinkedIn for a single company and return deduped flattened posts.

    Two streams (both actor 5QnEH5N71IK2mFLrP):
      1) keyword search  — per keyword-override, paginated (stop when page<50,
         cap max_requests), body {keyword, date_filter:'past-week', limit:50,
         page_number, sort_type:'date_posted'}. source='keyword'.
      2) company page    — {company_urns:<this company's urn>, date_filter:
         'past-week', limit:50, sort_type:'date_posted'}. source='company_page'.
         R1 refinement: sort_type is 'date_posted' (was 'relevance').

    Dedup by activity_id; company_page wins over keyword (Dedup node semantics).
    """
    name = company['name']
    posts = {}  # activity_id -> flattened row

    # ---- stream 1: keyword search (paginated) ----
    for kw in keywords_for(name):
        for page in range(1, max_requests + 1):
            body = {
                'keyword': kw,
                'date_filter': 'past-week',
                'limit': 50,
                'page_number': page,
                'sort_type': 'date_posted',
            }
            res = apify_run(token, body, dry=dry)
            for raw in res:
                fp = flatten_post(raw, source='keyword')
                if fp and fp['activity_id'] not in posts:
                    posts[fp['activity_id']] = fp
            if len(res) < 50:
                break  # window exhausted for this keyword (paginationCompleteWhen)
        print(f'      keyword "{kw}": scraped (running unique {len(posts)})')

    # ---- stream 2: company page (single call over this company's URN) ----
    urn = company.get('linkedin_urn')
    if urn:
        body = {
            'company_urns': str(urn),
            'date_filter': 'past-week',
            'limit': 50,
            'sort_type': 'date_posted',   # R1
        }
        res = apify_run(token, body, dry=dry)
        added = 0
        for raw in res:
            fp = flatten_post(raw, source='company_page', company_hint=name)
            aid = fp['activity_id'] if fp else None
            if not aid:
                continue
            # company_page wins on dedup (Dedup LinkedIn by activity_id semantics)
            if aid not in posts or posts[aid].get('source') != 'company_page':
                posts[aid] = fp
                added += 1
        print(f'      company-page: +{added} (unique now {len(posts)})')
    else:
        print(f'      company-page: SKIP (no linkedin_urn for {name})')

    return list(posts.values())


# --------------------------------------------------------------------------- #
#  Score keyword posts via OpenAI (attribution + sentiment)
# --------------------------------------------------------------------------- #
def _build_llm_system_prompt(ctx):
    """VERBATIM port of the LLM Sentiment+Attribution LinkedIn system prompt."""
    aliases = json.dumps([{
        'name': c['name'], 'aliases': c.get('aliases') or [], 'domain': c.get('domain')
    } for c in ctx['companies']])
    return (
        "You are an expert linguistic analyst. Analyze sentiment using an integer "
        f"scale -3..3. Identify the main company discussed or the authoring company "
        f"EXCLUSIVELY among: {ctx['companyEnum']}. Aliases and domains for "
        f"disambiguation: {aliases}.\n\n"
        f"{ctx['definitions']}\n\n"
        "STRICT ATTRIBUTION RULE: Attribute a post to a company ONLY if it is "
        "GENUINELY about that specific organization per its definition above (its "
        "product, people, funding, customers, or category). If the post merely shares "
        "a name token and matches a 'NOT:' entry or a generic/unrelated sense, set "
        "companyName to NONE.\n\n"
        "Companies often post about themselves with we/our without naming themselves: "
        "inspect post_url domain/handle to attribute. If not relevant to a listed "
        "company or cybersecurity, set companyName to NONE. Input: array of objects "
        "with activity_id,text,title,post_url. Output ONLY a valid JSON array, each "
        "element with exactly: activity_id, companyName (a listed name or NONE), "
        "sentiment (int -3..3), reasoning (one sentence)."
    )


def _parse_llm_json(text):
    """Port of Parse LinkedIn LLM: strip fences, slice [..], JSON.parse -> list."""
    raw = str(text or '').replace('```json', '').replace('```', '').strip()
    if not raw:
        return []
    a, b = raw.find('['), raw.rfind(']')
    txt = raw[a:b + 1] if (a != -1 and b != -1 and b > a) else raw
    try:
        parsed = json.loads(txt)
    except Exception:  # noqa: BLE001
        return []
    return parsed if isinstance(parsed, list) else [parsed]


def score_posts(keyword_posts, ctx, openai_key, dry=False):
    """
    Attribute + score KEYWORD posts via OpenAI (LLM is free; batch in one call).

    Returns {activity_id: {companyName, sentiment, reasoning}} for the subset the
    LLM returned. Callers then apply the relevance gate (drop companyName==NONE).

    company_page posts are NOT passed here — they are force-attributed (R2).

    If openai_key is empty, we DO NOT invent one: print a clear message and return
    {} so keyword posts are simply left unscored (company_page still proceeds).
    """
    if not keyword_posts:
        return {}
    if not openai_key:
        print('      OpenAI key MISSING (set OPENAI_API_KEY or create '
              'sov-tooling/.openaikey) — skipping keyword attribution/sentiment. '
              'company_page posts are unaffected.')
        return {}

    # slim payload — only the fields the prompt uses
    payload = [{
        'activity_id': p['activity_id'],
        'text': p.get('text', ''),
        'title': p.get('title', ''),
        'post_url': p.get('post_url', ''),
    } for p in keyword_posts]

    if dry:
        print(f'      [DRY] would call OpenAI ({OPENAI_MODEL}) to score '
              f'{len(payload)} keyword post(s)')
        return {}

    body = {
        'model': OPENAI_MODEL,
        'messages': [
            {'role': 'system', 'content': _build_llm_system_prompt(ctx)},
            {'role': 'user', 'content': json.dumps(payload)},
        ],
        'temperature': 0,
    }
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {openai_key}'}
    try:
        raw = _http(OPENAI_URL, data=json.dumps(body).encode(), headers=headers,
                    method='POST', timeout=180)
        resp = json.loads(raw)
        text = resp['choices'][0]['message']['content']
    except urllib.error.HTTPError as e:
        print(f'      OpenAI HTTP {e.code}: {e.read()[:200]}')
        return {}
    except Exception as e:  # noqa: BLE001
        print(f'      OpenAI err: {e}')
        return {}

    out = {}
    for e in _parse_llm_json(text):
        aid = e.get('activity_id')
        if aid:
            out[str(aid)] = {
                'companyName': e.get('companyName'),
                'sentiment': e.get('sentiment'),
                'reasoning': e.get('reasoning'),
            }
    return out


# --------------------------------------------------------------------------- #
#  post_weight (VERBATIM formula from Compute LinkedIn post_weight + recompute_weights.py)
# --------------------------------------------------------------------------- #
def _age_days(posted_at):
    if not posted_at:
        return 0.0
    s = str(posted_at).strip().replace(' ', 'T')
    if '+' not in s and 'Z' not in s and 'T' in s:
        s += '+00:00'
    try:
        d = datetime.fromisoformat(s.replace('Z', '+00:00'))
        return max(0.0, (NOW - d).total_seconds() / 86400.0)
    except Exception:  # noqa: BLE001
        return 0.0


def compute_post_weight(post, company_set_urns, config, is_company_page,
                        sentiment):
    """
    LinkedIn post_weight, ported EXACTLY:

      eng    = 1*reactions + 3*comments + 10*reshares (+1.5 if imageURL)
      reach  = eng ** (49/50)                       (near-linear reach)
      sentMult = 0.5 + ((clamp(sentiment,-3,3)+3)/6)*0.8   -> range 0.5..1.3
                 R3: company_page posts use sentMult = 1.0 (no self-sentiment)
      decay  = 1 if ageDays<=7 else 2**(-ageDays/14)       (7-day grace, HL=14)
      authorType = company if source==company_page OR author urn in competitor set,
                   else external
      B = company?1:5   (additive presence floor; external baseline 5)
      M = company?1.0:1.5
      post_weight = (B + reach*M) * sentMult * decay

    engagementWeights / halfLife / baselines / mults read from sov_config with the
    same defaults the n8n node uses, so behavior matches even if config is empty.
    """
    ew = ((config.get('engagementWeights') or {}).get('LinkedIn')
          or {'reaction': 1, 'comment': 3, 'reshare': 10, 'image': 1.5})
    half_life = (config.get('halfLifeDays') or {}).get('LinkedIn', 14) \
        if isinstance(config.get('halfLifeDays'), dict) else 14
    AB = config.get('authorBaseline') or {'company': 1.0, 'external': 5.0}
    AEM = config.get('authorEngMult') or {'company': 1.0, 'external': 1.5}

    reactions = float(post.get('totalReactions') or 0)
    comments = float(post.get('comments') or 0)
    reshares = float(post.get('reshares') or 0)
    has_image = bool(post.get('imageURL'))

    eng = (ew.get('reaction', 1) * reactions
           + ew.get('comment', 3) * comments
           + ew.get('reshare', 10) * reshares)
    if has_image:
        eng += ew.get('image', 1.5)
    reach = eng ** (49 / 50)

    # authorType
    author = post.get('author') or {}
    author_urn = str(author.get('profile_id') or '')
    if is_company_page or (author_urn and author_urn in company_set_urns):
        author_type = 'company'
    else:
        author_type = 'external'

    # sentMult — R3: company_page => 1.0 (no self-sentiment)
    if is_company_page:
        sent_mult = 1.0
    else:
        s = max(-3, min(3, int(sentiment) if sentiment is not None else 0))
        sent_mult = 0.5 + ((s + 3) / 6) * 0.8   # 0.5 .. 1.3

    B = (AB.get('company', 1.0) if author_type == 'company' else AB.get('external', 5.0))
    M = (AEM.get('company', 1.0) if author_type == 'company' else AEM.get('external', 1.5))

    age = _age_days(post.get('posted_at'))
    decay = 1.0 if age <= 7 else 2 ** (-age / half_life)   # 7-day grace

    return (B + reach * M) * sent_mult * decay, author_type


# --------------------------------------------------------------------------- #
#  Write raw posts + scored fields back to Supabase
# --------------------------------------------------------------------------- #
RAW_UPSERT_FIELDS = ('activity_id', 'post_url', 'text', 'full_urn', 'author',
                     'totalReactions', 'comments', 'reshares', 'posted_at',
                     'hashtags', 'content', 'is_reshare', 'metadata',
                     'search_input', 'title', 'imageURL')


def write_posts(headers, posts, scored, ctx, dry=False):
    """
    Upsert raw posts to linkedin_posts (on_conflict=activity_id), then write back
    sentiment / companyName / reasoning / post_weight per post.

    - company_page posts (R2): auto-accept, companyName forced = companyHint,
      sentiment=null, post_weight computed with sentMult=1.0 (R3).
    - keyword posts: use the LLM verdict; RELEVANCE GATE drops companyName==NONE
      (no write of scored fields for dropped posts — raw row still upserted).
    """
    if not posts:
        return {'upserted': 0, 'scored': 0, 'dropped': 0}

    # 1) upsert raw rows
    raw_rows = [{k: p.get(k) for k in RAW_UPSERT_FIELDS} for p in posts]
    upserted = sb_upsert(headers, 'linkedin_posts', 'activity_id', raw_rows, dry=dry)

    company_urns = set(str(u) for u in ctx['linkedin_urns'] if u)
    config = ctx['config']
    scored_count, dropped = 0, 0

    for p in posts:
        aid = str(p['activity_id'])
        is_cp = p.get('source') == 'company_page'

        if is_cp:
            # R2: force companyName = company being processed; R3: sentiment=null
            company_name = p.get('companyHint')
            sentiment = None
            reasoning = 'company-page auto-attribution'
        else:
            verdict = scored.get(aid)
            if not verdict:
                # unscored (no OpenAI key or LLM omitted it) — leave scored fields alone
                continue
            company_name = verdict.get('companyName')
            # RELEVANCE GATE: drop NONE / empty (LinkedIn Relevance Gate node)
            if not company_name or str(company_name).upper() == 'NONE':
                dropped += 1
                continue
            sentiment = verdict.get('sentiment')
            reasoning = verdict.get('reasoning')

        pw, author_type = compute_post_weight(
            p, company_urns, config, is_company_page=is_cp, sentiment=sentiment)

        fields = {
            'companyName': company_name,
            'sentiment': sentiment,
            'reasoning': reasoning,
            'post_weight': round(pw, 6),
        }
        if dry:
            print(f'      [DRY] {aid[:24]:<24} src={p.get("source"):<12} '
                  f'co={company_name} sent={sentiment} at={author_type} pw={pw:.4f}')
        else:
            sb_update(headers, 'linkedin_posts', 'activity_id', aid, fields)
        scored_count += 1

    return {'upserted': upserted, 'scored': scored_count, 'dropped': dropped}


# --------------------------------------------------------------------------- #
#  Per-company driver (LinkedIn)  — memory-bounded: one company, then free
# --------------------------------------------------------------------------- #
def run_linkedin_for_company(company, ctx, secrets, args):
    """Scrape -> score -> weight -> write for ONE company. Returns a summary dict."""
    name = company['name']
    print(f'  [LinkedIn] {name} (type={company.get("type")})')

    posts = scrape_linkedin_company(
        company, secrets['apify_token'], args.max_requests, dry=args.dry_run)

    keyword_posts = [p for p in posts if p.get('source') == 'keyword']
    scored = score_posts(keyword_posts, ctx, secrets['openai_key'], dry=args.dry_run)

    if args.dry_run:
        # still exercise write_posts to print the plan; it makes no writes in dry
        result = write_posts(secrets['sb_headers'], posts, scored, ctx, dry=True)
    else:
        result = write_posts(secrets['sb_headers'], posts, scored, ctx, dry=False)

    summary = {
        'company': name,
        'scraped': len(posts),
        'keyword': len(keyword_posts),
        'company_page': len(posts) - len(keyword_posts),
        **result,
    }
    print(f'    -> scraped={summary["scraped"]} '
          f'(kw={summary["keyword"]}, page={summary["company_page"]}) '
          f'upserted={summary["upserted"]} scored={summary["scored"]} '
          f'dropped_NONE={summary["dropped"]}')
    return summary


# --------------------------------------------------------------------------- #
#  TODO: sibling platform modules (same per-company, memory-bounded shape)
# --------------------------------------------------------------------------- #
def run_reddit_for_company(company, ctx, secrets, args):
    """TODO(reddit): port from n8n `SOV — Reddit` (qN2hd39B7AlUlXb3).
    Actor RSijjMBLS6g1W11GY charges PER START ($0.052) — so Reddit is best done as
    ONE batched call over all companies, NOT per-company (see backfill_scrape.py).
    Structure decision: implement Reddit as a run_reddit_all_companies(ctx, ...)
    batch function rather than per-company, then attribute/score/weight per row.
    """
    raise NotImplementedError('Reddit not yet ported (see backfill_scrape.py for the actor call).')


def run_x_for_company(company, ctx, secrets, args):
    """TODO(x): port from n8n `SOV — X` (3aYO4hfbwRbx7tv0).
    Actor 61RPP7dywgiy0JPD0; X is also cheapest as ONE batched OR-query over all
    handles/names (backfill_scrape.py builds the query). post_weight for X:
    reach = (viewCount+eng)^(49/50); pw = reach*authorWeight*sentMult*decay(HL=7).
    """
    raise NotImplementedError('X/Twitter not yet ported (see recompute_weights.py X block).')


def run_news_for_company(company, ctx, secrets, args):
    """TODO(news): port from n8n `SOV — Google News` (xVOA25o3tZlAnSCx).
    Google News actor-TASK 3Z6SK7F2WoPU3t2sg; includes a Firecrawl article-text
    fetch + a source-credibility LLM pass before weighting. Direct-companies only
    (Mentions Gate). Table: googlenews (on_conflict=url).
    """
    raise NotImplementedError('Google News not yet ported.')


def write_weekly_snapshot(ctx, secrets, args):
    """TODO(snapshot): port from n8n `SOV — Weekly Snapshot` (hNauQrczVV1VDxCF).
    After all platforms are scored, compute the weekly board (direct-only,
    weighted-only, per-platform normalized then combined via overallWeights) and
    upsert into sov_weekly (on_conflict=week_start,company). See db_state.py for
    the exact board math (platformWeights, minPlatformVolume, halfLifeDays).
    """
    raise NotImplementedError('Weekly snapshot not yet ported (see db_state.py board math).')


# --------------------------------------------------------------------------- #
#  main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description='Standalone weekly SOV scraper (LinkedIn PoC).')
    ap.add_argument('--company', help='process only this competitor (case-insensitive name match)')
    ap.add_argument('--dry-run', action='store_true',
                    help='scrape+score plan only; NO Apify calls, NO DB writes (zero cost)')
    ap.add_argument('--max-requests', type=int, default=5,
                    help='LinkedIn keyword pagination page cap (default 5, per n8n)')
    args = ap.parse_args()

    # ---- secrets ----
    sb_headers = load_supabase_headers()
    apify_token = load_apify_token()
    openai_key = load_openai_key()
    secrets = {
        'sb_headers': sb_headers,
        'apify_token': apify_token,
        'openai_key': openai_key,
    }

    # ---- config ----
    ctx = load_config(sb_headers)
    companies = ctx['companies']
    if args.company:
        want = args.company.strip().lower()
        companies = [c for c in companies if c['name'].strip().lower() == want]
        if not companies:
            sys.exit(f'FATAL: --company "{args.company}" matched no active competitor. '
                     f'Active: {ctx["companyEnum"]}')

    mode = 'DRY-RUN (no Apify, no writes)' if args.dry_run else 'LIVE RUN (SPENDS APIFY)'
    print('=' * 78)
    print(f'weekly_scrape.py | {mode} | max-requests={args.max_requests}')
    print(f'companies: {", ".join(c["name"] for c in companies)}')
    print(f'OpenAI key: {"present" if openai_key else "MISSING (keyword scoring will be skipped)"}')
    print(f'Apify token: {"env APIFY_TOKEN" if os.environ.get("APIFY_TOKEN") else "n8n-embedded default (TODO rotate)"}')
    print('=' * 78)

    # ---- per-company loop (memory-bounded: process one, then drop it) ----
    summaries = []
    for company in companies:
        try:
            summaries.append(run_linkedin_for_company(company, ctx, secrets, args))
        except Exception as e:  # noqa: BLE001 — one company's failure must not abort the run
            print(f'    !! {company["name"]} failed: {e}')
        # TODO: once ported, call sibling platforms here (Reddit/X/News are better
        # batched over all companies — see their stubs). Keep per-company memory low.

    # TODO(snapshot): after all platforms complete, call write_weekly_snapshot(ctx, ...).

    # ---- report ----
    print('=' * 78)
    print('SUMMARY (LinkedIn):')
    tot = {'scraped': 0, 'upserted': 0, 'scored': 0, 'dropped': 0}
    for s in summaries:
        for k in tot:
            tot[k] += s.get(k, 0)
        print(f'  {s["company"]:<18} scraped={s["scraped"]:<4} '
              f'kw={s["keyword"]:<3} page={s["company_page"]:<3} '
              f'upserted={s["upserted"]:<4} scored={s["scored"]:<4} dropped={s["dropped"]}')
    print(f'  {"TOTAL":<18} scraped={tot["scraped"]:<4} '
          f'{"":13}upserted={tot["upserted"]:<4} scored={tot["scored"]:<4} dropped={tot["dropped"]}')
    if args.dry_run:
        print('\nDRY-RUN: nothing scraped, nothing spent, nothing written.')
    print('=' * 78)


if __name__ == '__main__':
    main()
