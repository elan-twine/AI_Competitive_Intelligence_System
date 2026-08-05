#!/usr/bin/env python3
"""Apply the 2026-07-02 reclassification verdicts to Supabase.

Inputs: reclass_2026-07-02/{li_null,li_audit,news_null,news_audit}_*.verdicts.json
 - *_null verdicts: {key, companyName (exact|NONE), sentiment (int|null), reason}
   -> attributed rows get companyName+sentiment+reasoning; NONE rows get companyName='NONE'
      (post_weight stays null; the snapshot's Weekly Decay Refresh computes weights for
      attributed rows on its next run).
 - *_audit verdicts: {key, verdict keep|remove|reattribute, newCompany?, reason}
   -> remove: companyName='NONE', post_weight=null (text preserved for training)
   -> reattribute: companyName=newCompany, post_weight=null (recomputed on next refresh)
Backs up every mutated attributed row first (audit removals) to
reclass_2026-07-02/audit_removed_backup.json. Verifies completeness: every verdicts file
must have exactly as many rows as its input chunk.
"""
import json, os, sys, urllib.request

D = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(D, "reclass_2026-07-02")
KEY = open(os.path.join(D, ".sbkey")).read().strip()
BASE = "https://addwjngdezmmnxddulll.supabase.co/rest/v1"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Prefer": "return=minimal"}

VALID = {"Twine Security","Orchid Security","Linx Security","Surf AI","Opti","Lumos","Cerby",
         "Redblock","Torch Security","OFFROAD","BlinkOps","7AI","Console","Nagomi Security","Fabrix Security","NONE"}

def get(q):
    req = urllib.request.Request(BASE + q, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    return json.load(urllib.request.urlopen(req))

def patch(q, body):
    req = urllib.request.Request(BASE + q, headers=H, data=json.dumps(body).encode(), method="PATCH")
    urllib.request.urlopen(req)

def load_pair(stem):
    inp = json.load(open(os.path.join(R, stem + ".json")))
    out = json.load(open(os.path.join(R, stem + ".verdicts.json")))
    assert len(inp) == len(out), f"{stem}: input {len(inp)} != verdicts {len(out)} — INCOMPLETE, aborting"
    return inp, out

# ---------- 1) NULL-classification: linkedin ----------
li_attr, li_none = [], []
for i in range(4):
    inp, out = load_pair(f"li_null_{i}")
    for v in out:
        cn = v.get("companyName")
        assert cn in VALID, f"bad companyName {cn!r}"
        if cn == "NONE":
            li_none.append(v["activity_id"])
        else:
            li_attr.append(v)

# ---------- 2) NULL-classification: news ----------
gn_attr, gn_none = [], []
for i in range(4):
    inp, out = load_pair(f"news_null_{i}")
    for v in out:
        cn = v.get("companyName")
        assert cn in VALID, f"bad companyName {cn!r}"
        if cn == "NONE":
            gn_none.append(v["url"])
        else:
            gn_attr.append(v)

# ---------- 3) re-audit: linkedin + news ----------
li_removes, li_reattr = [], []
for i in range(7):
    inp, out = load_pair(f"li_audit_{i}")
    for v in out:
        if v.get("verdict") == "remove":
            li_removes.append(v)
        elif v.get("verdict") == "reattribute":
            assert v.get("newCompany") in VALID
            li_reattr.append(v)
gn_removes, gn_reattr = [], []
for i in range(2):
    inp, out = load_pair(f"news_audit_{i}")
    for v in out:
        if v.get("verdict") == "remove":
            gn_removes.append(v)
        elif v.get("verdict") == "reattribute":
            assert v.get("newCompany") in VALID
            gn_reattr.append(v)

print(f"verified complete. li: +{len(li_attr)} attr, {len(li_none)} none, -{len(li_removes)} removes, {len(li_reattr)} reattr")
print(f"news: +{len(gn_attr)} attr, {len(gn_none)} none, -{len(gn_removes)} removes, {len(gn_reattr)} reattr")

# ---------- 4) backup rows being removed/reattributed (they carry real attribution today) ----------
backup = []
for v in li_removes + li_reattr:
    backup += get(f"/linkedin_posts?select=*&activity_id=eq.{v['activity_id']}")
for v in gn_removes + gn_reattr:
    backup += get("/googlenews?select=*&url=eq." + urllib.parse.quote(v["url"], safe=""))
with open(os.path.join(R, "audit_removed_backup.json"), "w") as f:
    json.dump(backup, f, indent=1)
print(f"backed up {len(backup)} rows to audit_removed_backup.json")

# ---------- 5) apply ----------
# 5a. linkedin recovered attributions
for v in li_attr:
    body = {"companyName": v["companyName"], "reasoning": "reclass 2026-07-02: " + str(v.get("reason") or "")}
    if v.get("sentiment") is not None:
        body["sentiment"] = v["sentiment"]
    patch(f"/linkedin_posts?activity_id=eq.{v['activity_id']}", body)
print(f"applied {len(li_attr)} linkedin attributions")

# 5b. linkedin NONE (chunks of 60 ids)
for i in range(0, len(li_none), 60):
    ids = ",".join(f'"{x}"' for x in li_none[i:i+60])
    patch(f"/linkedin_posts?activity_id=in.({ids})", {"companyName": "NONE"})
print(f"applied {len(li_none)} linkedin NONE labels")

# 5c. news recovered attributions
import urllib.parse
for v in gn_attr:
    body = {"companyName": v["companyName"], "reasoning": "reclass 2026-07-02: " + str(v.get("reason") or "")}
    if v.get("sentiment") is not None:
        body["sentiment"] = v["sentiment"]
    patch("/googlenews?url=eq." + urllib.parse.quote(v["url"], safe=""), body)
print(f"applied {len(gn_attr)} news attributions")

# 5d. news NONE
for i, u in enumerate(gn_none):
    patch("/googlenews?url=eq." + urllib.parse.quote(u, safe=""), {"companyName": "NONE"})
print(f"applied {len(gn_none)} news NONE labels")

# 5e. audit removes/reattributes
for v in li_removes:
    patch(f"/linkedin_posts?activity_id=eq.{v['activity_id']}",
          {"companyName": "NONE", "post_weight": None, "reasoning": "audit 2026-07-02 remove: " + str(v.get("reason") or "")})
for v in li_reattr:
    patch(f"/linkedin_posts?activity_id=eq.{v['activity_id']}",
          {"companyName": v["newCompany"], "post_weight": None, "reasoning": "audit 2026-07-02 reattribute: " + str(v.get("reason") or "")})
for v in gn_removes:
    patch("/googlenews?url=eq." + urllib.parse.quote(v["url"], safe=""),
          {"companyName": "NONE", "post_weight": None, "reasoning": "audit 2026-07-02 remove: " + str(v.get("reason") or "")})
for v in gn_reattr:
    patch("/googlenews?url=eq." + urllib.parse.quote(v["url"], safe=""),
          {"companyName": v["newCompany"], "post_weight": None, "reasoning": "audit 2026-07-02 reattribute: " + str(v.get("reason") or "")})
print(f"applied removes: li {len(li_removes)}, news {len(gn_removes)}; reattributes: li {len(li_reattr)}, news {len(gn_reattr)}")
print("DONE")
