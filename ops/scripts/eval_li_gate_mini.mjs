#!/usr/bin/env node
// ============================================================================
// eval_li_gate_mini.mjs — SMALL, cheap check of gpt-4.1-mini on the LinkedIn
// attribution gate, built around the 11 HUMAN-FLAGGED misattributed posts
// (real ground truth: the stored answer is known WRONG, so a good model must
// NOT repeat it) plus a small clean sample.
//
// Replays the prod prompt from the Processor's 'LLM Attribution' node with the
// live roster. Batches posts like prod does (the prompt takes an array), so
// the big system prompt is paid once per BATCH, not per post — that's what
// keeps this under ~$0.20. gpt-4.1 runs only on mini's disagreements.
//   node sov-tooling/eval_li_gate_mini.mjs [--clean 20] [--batch 10]
// ============================================================================
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
const DIR = dirname(fileURLToPath(import.meta.url))
const SB = readFileSync(join(DIR, '.sbkey'), 'utf8').trim()
const OA = readFileSync(join(DIR, '.oakey'), 'utf8').trim()
const BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
const H = { apikey: SB, Authorization: 'Bearer ' + SB }
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>-1?Number(process.argv[i+1]):d}
const CLEAN = arg('--clean', 20), BATCH = arg('--batch', 10)
const get = async (p) => { const r = await fetch(BASE + p, { headers: H }); if (!r.ok) throw new Error(p+' -> '+r.status); return r.json() }

const competitors = await get('/competitors?select=*&order=name.asc')
const active = competitors.filter(c => c.active !== false)
const companies = active.map(c => ({ name:c.name, keywords:Array.isArray(c.keywords)?c.keywords:[], definition:c.definition||'', collision_terms:Array.isArray(c.collision_terms)?c.collision_terms:[], aliases:Array.isArray(c.aliases)?c.aliases:[], domain:c.domain||null, x_handle:c.x_handle||null, linkedin_urn:c.linkedin_urn||null, subreddits:Array.isArray(c.subreddits)?c.subreddits:[], type:c.type||'direct' }))
const companyEnum = companies.filter(c=>(c.type||'direct')!=='indirect').map(c=>c.name).join(", ")
const companyDefs = companies.filter(c=>(c.type||'direct')!=='indirect').map(c=>{const dom=c.domain?(' ('+c.domain+')'):'';const nots=(c.collision_terms&&c.collision_terms.length)?('. NOT: '+c.collision_terms.join('; ')):'';return c.name+dom+' \u2014 '+(c.definition||'(no definition yet)')+nots;}).join('\n\n')
const ctx = { companies, companyEnum, companyDefs }

const F = 'activity_id,text,post_url,author,companyName,misattributed'
const flagged = await get(`/linkedin_posts?select=${F}&misattributed=is.true&text=not.is.null`)
const clean   = await get(`/linkedin_posts?select=${F}&companyName=not.is.null&companyName=neq.NONE&misattributed=is.false&text=not.is.null&order=posted_at.desc&limit=${CLEAN}`)
const nones   = await get(`/linkedin_posts?select=${F}&companyName=eq.NONE&text=not.is.null&order=posted_at.desc&limit=${CLEAN}`)
const sample = [...flagged.map(p=>({...p,kind:'flagged'})), ...clean.map(p=>({...p,kind:'clean'})), ...nones.map(p=>({...p,kind:'none'}))]
console.log(`sample: ${flagged.length} human-flagged + ${clean.length} clean + ${nones.length} NONE = ${sample.length} posts, batches of ${BATCH}`)

const buildBody = (MODEL, POSTS) => ({ model: 'gpt-4.1', temperature: 0, messages: [{ role: 'system', content: "You are an expert linguistic analyst. Analyze sentiment using an integer scale -3..3. Identify the main company discussed or the authoring company EXCLUSIVELY among: " + (ctx.companyEnum) + ". Aliases and domains for disambiguation: " + (JSON.stringify(ctx.companies)) + ".\n\nDECISION PROCEDURE — apply to EVERY post BEFORE answering:\n1) List each candidate company-name token that appears in the text, title, or post_url.\n2) POSITIVE ANCHOR REQUIRED: to attribute a post to a listed company you MUST be able to point to a concrete, company-specific anchor IN THIS POST — its own website domain or LinkedIn handle; a product/feature unique to it; a named founder or employee; a funding round or acquisition tied to it; a named customer; OR the company named explicitly in ITS real context (identity security / IGA / SOC / the exact category in its definition below). If you cannot cite such an anchor, set companyName to NONE. A shared or similar-looking name token, by itself, is NEVER sufficient. ALSO VALID ANCHORS (any one counts as a concrete anchor): (a) SPONSOR/EXHIBITOR/PARTNER/PORTFOLIO/AWARD-FINALIST LISTS — a listed company's EXACT full name inside a curated roster of sponsors, exhibitors, partners, portfolio or finalists is a deliberate brand reference, not a namesake; attribute it even with no other detail (still reject fuzzy or namesake tokens like Lumo or Optiv). (b) AUTHOR-IDENTITY SELF-REFERENCE — if the author name or headline shows they are a founder, executive, or employee of a listed company, first-person language (we, our, I am building, my team, my company) about that company's category attributes the post to it EVEN when the company is never named and post_url is a personal profile; cite the author identity as the anchor. (c) LANGUAGE-AGNOSTIC — anchors and affiliation phrasing may appear in ANY language (e.g. Hebrew works-at or we-are-building phrasing, transliterated brand names, RTL text); translate mentally before applying every rule above.\n3) NAMES ARE EXACT — reject near-miss namesakes even inside an AI / security / privacy context: 'Lumo' (Proton's chatbot) is NOT 'Lumos'; 'Optiv' is NOT 'Opti'; '[24]7.ai' / '247.ai' / '7.ai' is NOT '7AI'; 'Torch.AI' is NOT 'Torch Security'; Amazon 'Blink' / 'Blink for Home' is NOT 'BlinkOps'; 'Luminous' / 'Lumo' is NOT 'Lumos'. If the post is about the OTHER named entity, set companyName to NONE.\n4) If the token is used in a clearly different sense (a chatbot, a flower, a VPN, a game, a spell, a healthcare benchmark, a train, an airline, a mythological figure), or you are unsure which entity is meant, set companyName to NONE.\nA wrong attribution to a namesake is far worse than a NONE — when in doubt, choose NONE.\n\nCOMPANY DEFINITIONS — A post is \"about\" a company only if it concerns the specific organization below (its product, funding, people, customers, category). REJECT posts that merely share the name token but match a NOT entry or the generic/unrelated senses.\n\n" + (ctx.companyDefs||'') + "\n\nSTRICT ATTRIBUTION RULE: Attribute a post to a company ONLY if it is GENUINELY about that specific organization per its definition above (its product, people, funding, customers, or category). If the post merely shares a name token and matches a 'NOT:' entry or a generic/unrelated sense, set companyName to NONE. Concrete collisions to REJECT (set NONE): Lumos = NOT Proton's \"Lumo\" chatbot/assistant (singular, no trailing s — the biggest collision), NOT a Women's-Health/medical LLM benchmark (Lumos Diagnostics), NOT Lumos Fiber/Business Finance/Digital Outdoor/Laboratories Nigeria, NOT solar/fiber networks/Harry-Potter spell/brain-game/mystical 'node' names — ATTRIBUTE ONLY when the post is about identity governance / access management / IGA or names lumos.com, Albus, or Identity Agent Force; Surf AI = NOT Surf Air Mobility (the airline/\"BrokerOS\"/Wheels Up), NOT crypto token \"@SurfAI\"/asksurf.ai, NOT Surfshark VPN, NOT generic web-surfing; Twine = NOT Meta's internal \"Twine\"/Tupperware cluster-management platform, NOT 'digital twin' research, NOT the Twine interactive-fiction tool, NOT the Python twine PyPI tool; 7AI = NOT 247.ai/[24]7.ai contact-center AI, NOT a 'top 7 AI tools' listicle; OFFROAD = NOT off-road/4x4/overlanding vehicles or off-road driving games; Console = NOT gaming consoles (PS5/Xbox/Switch) or the developer/terminal 'console'/console.log; Torch = NOT PyTorch, NOT Torch.AI defense data-orchestration, NOT a flashlight/Olympic-torch/Torch-browser; Opti = NOT Optiv (the cybersecurity integrator is a different company), NOT Optimizely; Orchid = NOT Orchid VPN/Orchid Protocol crypto, NOT the orchid flower; Oak - Identity Security OS = the identity-security company (oak.id) — NOT the web3 audit firm \"Oak Security\", NOT Oak Ridge/Oakland/oak wood; require identity-security context or oak.id/founder names.\n\nCompanies often post about themselves with we/our without naming themselves: inspect post_url domain/handle to attribute. If not relevant to a listed company or cybersecurity, set companyName to NONE. Input: array of objects with activity_id,text,title,post_url. Output ONLY a valid JSON array, one element per input post with exactly: activity_id, and companies — an array of EVERY listed company genuinely named AND anchored in the post (apply all the anchor and collision rules above per company). Each companies element = { companyName (a listed name), sentiment (int -3..3 for THIS company), reasoning (one sentence naming THIS company's concrete anchor) }. If no listed company qualifies, companies MUST be []. Never invent a company or duplicate one; each needs its own anchor." }, { role: 'user', content: JSON.stringify(POSTS) }] })
const parse = (content) => {
  const t = (content||'').replace(/```json/gi,'').replace(/```/g,'').trim()
  const a=t.indexOf('['), b2=t.lastIndexOf(']'), c=t.indexOf('{'), d=t.lastIndexOf('}')
  let txt=t; if(a!==-1&&b2>a) txt=t.slice(a,b2+1); else if(c!==-1&&d>c) txt=t.slice(c,d+1)
  try { return JSON.parse(txt) } catch { return null }
}
const primaryOf = (el) => {
  if (!el) return 'PARSE_FAIL'
  let comps = []
  if (Array.isArray(el.companies)) comps = el.companies.filter(x=>x&&x.companyName&&String(x.companyName).toUpperCase()!=='NONE')
  else if (el.companyName && String(el.companyName).toUpperCase()!=='NONE') comps=[el]
  return comps.length ? String(comps[0].companyName) : 'NONE'
}
async function runBatch(model, posts) {
  const POSTS = posts.map(p => ({ activity_id: p.activity_id, text: p.text, post_url: p.post_url, author: p.author }))
  for (let i=0;i<3;i++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+OA}, body: JSON.stringify(buildBody(model, POSTS)) })
      if (r.status===429) { await new Promise(s=>setTimeout(s,4000*(i+1))); continue }
      if (!r.ok) throw new Error(r.status+' '+(await r.text()).slice(0,120))
      const d = await r.json()
      const v = parse(d.choices?.[0]?.message?.content||'')
      const arr = Array.isArray(v) ? v : (v ? [v] : [])
      const byId = {}
      for (const el of arr) { const id = String(el.activity_id ?? el.id ?? ''); if (id) byId[id] = primaryOf(el) }
      return posts.map((p,ix) => ({ post:p, got: byId[String(p.activity_id)] ?? primaryOf(arr[ix]) }))
    } catch(e) { if(i===2) return posts.map(p=>({post:p, got:'ERROR'})) }
  }
}
const runModel = async (model, posts) => {
  const out=[]
  for (let i=0;i<posts.length;i+=BATCH) out.push(...await runBatch(model, posts.slice(i,i+BATCH)))
  return out
}
const norm = s => String(s||'').trim().toLowerCase()
const mini = await runModel('gpt-4.1-mini', sample)
const disagree = mini.filter(r => r.post.kind==='flagged'
  ? norm(r.got) === norm(r.post.companyName)          // repeated the KNOWN-WRONG answer
  : norm(r.got) !== norm(r.post.companyName))
console.log(`mini disagreed / repeated-wrong on ${disagree.length}/${sample.length} — re-checking those with gpt-4.1`)
const ctrl = disagree.length ? await runModel('gpt-4.1', disagree.map(d=>d.post)) : []
const ctrlBy = Object.fromEntries(ctrl.map(c=>[c.post.activity_id, c.got]))

for (const kind of ['flagged','clean','none']) {
  const rs = mini.filter(r=>r.post.kind===kind)
  if (!rs.length) continue
  const ok = rs.filter(r => kind==='flagged'
    ? norm(r.got) !== norm(r.post.companyName)
    : kind==='none' ? norm(r.got)==='none' : norm(r.got)===norm(r.post.companyName)).length
  const label = kind==='flagged' ? 'human-flagged (must NOT repeat the wrong answer)' : kind==='none' ? 'NONE (rejection)' : 'clean attributed'
  console.log(`  ${label}: ${ok}/${rs.length}`)
}
let miniOnly = 0
console.log('\ndisagreements (mini vs stored) with gpt-4.1 as control:')
for (const d of disagree) {
  const c = ctrlBy[d.post.activity_id]
  const same = norm(c)===norm(d.got)
  if (!same) miniOnly++
  console.log(`  [${d.post.kind}] stored=${d.post.companyName} mini=${d.got} 4.1=${c} ${same?'(4.1 agrees with mini)':'<-- MINI-ONLY'}`)
}
console.log(`\ngenuine mini-vs-4.1 divergence: ${miniOnly}/${sample.length}`)
writeFileSync(join(DIR,'eval_li_results.json'), JSON.stringify(mini.map(m=>({kind:m.post.kind,id:m.post.activity_id,stored:m.post.companyName,mini:m.got,ctrl:ctrlBy[m.post.activity_id]??null})),null,1))
console.log('wrote sov-tooling/eval_li_results.json')
