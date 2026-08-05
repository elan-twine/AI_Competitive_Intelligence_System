#!/usr/bin/env bash
# Re-export the live SOV n8n workflows into ops/n8n/ with credentials redacted.
# Run after any workflow change so the repo copy doesn't go stale.
#   ./ops/scripts/export_n8n.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json,re,subprocess,os,glob
SUBS=[(re.compile(r'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9._-]+'),'<REDACTED_SUPABASE_JWT>'),
      (re.compile(r'apify_api_[A-Za-z0-9]+'),'<REDACTED_APIFY_TOKEN>'),
      (re.compile(r'sk-(proj|admin|or)-[A-Za-z0-9._-]+'),'<REDACTED_OPENAI_KEY>')]
for f in glob.glob('ops/n8n/*.json'):
    wid=None
    for line in open('ops/n8n/README.md'):
        if os.path.basename(f) in line and '`' in line:
            wid=line.split('`')[1]; break
    if not wid: continue
    out=subprocess.run([os.path.expanduser('~/bin/n8n-admin'),'get',wid],capture_output=True,text=True).stdout
    w=json.loads(out); keep={k:w.get(k) for k in ('name','nodes','connections','settings','active') if k in w}
    s=json.dumps(keep,indent=1)
    for rx,rep in SUBS: s=rx.sub(rep,s)
    open(f,'w').write(s); print('updated',f)
PY
