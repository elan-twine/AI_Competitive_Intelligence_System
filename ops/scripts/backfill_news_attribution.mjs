#!/usr/bin/env node
// ============================================================================
// backfill_news_attribution.mjs — re-attribute googlenews rows the broken
// pipeline never scored (schema mismatch, 2026-07-20 .. 2026-08-05).
//
// Uses the SAME prompt as prod (rebuilt from the live competitors table) and
// the SAME post_weight math as the 'Compute News post_weight' node:
//     post_weight = newsTier(host) * sentimentMult * 2^(-ageDays/halfLife)
// Credibility is NOT re-scored (it only feeds a stored column, not the
// weight), so each article costs exactly one mini call.
//
//   node sov-tooling/backfill_news_attribution.mjs --since 2026-07-20 --dry
//   node sov-tooling/backfill_news_attribution.mjs --since 2026-07-20 --commit
// ============================================================================
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
const DIR = dirname(fileURLToPath(import.meta.url))
const SB = readFileSync(join(DIR, '.sbkey'), 'utf8').trim()
const OA = readFileSync(join(DIR, '.oakey'), 'utf8').trim()
const BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
const H = { apikey: SB, Authorization: 'Bearer ' + SB }
// Attribution stays on gpt-4.1: mini false-positives on namesake collisions
// (verified — it attributed a Lumos *Diagnostics* article to Lumos, which 4.1
// correctly rejects), and a wrong attribution permanently inflates a
// competitor's SOV. Override with --model only for experiments.
const MODEL = (process.argv.indexOf('--model') > -1 ? process.argv[process.argv.indexOf('--model') + 1] : 'gpt-4.1')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d }
const SINCE = arg('--since', '2026-07-20')
const COMMIT = process.argv.includes('--commit')
const LIMIT = Number(arg('--limit', '2000'))

const get = async (p) => { const r = await fetch(BASE + p, { headers: H }); if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + (await r.text()).slice(0,200)); return r.json() }

// --- prod context (mirrors 'Load Shared Context') ---
const competitors = await get('/competitors?select=*&order=name.asc')
const cfgRows = await get('/sov_config?select=config&id=eq.1')
const config = (cfgRows[0] && cfgRows[0].config) || {}
const active = competitors.filter(c => c.active !== false)
const companies = active.map(c => ({ name: c.name, keywords: Array.isArray(c.keywords)?c.keywords:[], definition: c.definition||'', collision_terms: Array.isArray(c.collision_terms)?c.collision_terms:[], aliases: Array.isArray(c.aliases)?c.aliases:[], domain: c.domain||null, x_handle: c.x_handle||null, linkedin_urn: c.linkedin_urn||null, subreddits: Array.isArray(c.subreddits)?c.subreddits:[], type: c.type||'direct' }))
const companyEnum = companies.filter(c => (c.type||'direct')!=='indirect').map(c => c.name).join(", ")
const companyDefs = companies.filter(c => (c.type||'direct')!=='indirect').map(c=>{const dom=c.domain?(' ('+c.domain+')'):'';const nots=(c.collision_terms&&c.collision_terms.length)?('. NOT: '+c.collision_terms.join('; ')):'';return c.name+dom+' \u2014 '+(c.definition||'(no definition yet)')+nots;}).join('\n\n')
const ctx = { companies, companyEnum, companyDefs }

// --- post_weight math, copied from 'Compute News post_weight' ---
const clamp = config.sentimentClamp || { min:0.5, max:1.3 }
const halfLife = (config.halfLifeDays && config.halfLifeDays["Google News"]) || 30
function newsTierMult(u){const nt=config.newsTiers;if(!nt||!nt.tiers)return 1;const m=String(u||'').match(/^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)/i);let host=m?m[1].replace(/^www\./i,'').toLowerCase():'';if(!host)return (nt.default!=null?nt.default:1);for(const k in nt.tiers){const t=nt.tiers[k];const ds=(t&&t.domains)||[];for(let i=0;i<ds.length;i++){const d=ds[i];if(host===d||host.endsWith('.'+d))return t.mult;}}return (nt.default!=null?nt.default:1);}
const weightFor = (url, sentiment, publishedAt) => {
  const s = Math.max(-3, Math.min(3, Number(sentiment || 0)))
  const sentimentMult = clamp.min + ((s + 3) / 6) * (clamp.max - clamp.min)
  let ageDays = 0
  if (publishedAt) { const d = new Date(publishedAt); if (!isNaN(d)) ageDays = Math.max(0, (Date.now() - d.getTime()) / 86400000) }
  return parseFloat((newsTierMult(url) * sentimentMult * Math.pow(2, -ageDays / halfLife)).toFixed(6))
}

const rows = await get(`/googlenews?select=url,title,source,articleText,publishedAt&companyName=is.null&articleText=not.is.null&publishedAt=gte.${SINCE}&order=publishedAt.desc&limit=${LIMIT}`)
console.log(`${rows.length} unattributed articles with text since ${SINCE} | model=${MODEL} | ${COMMIT ? 'COMMIT' : 'DRY RUN'}`)

const buildBody = (article) => ({ model: MODEL, temperature: 0, messages: [ { role: 'system', content: "You are an expert sentiment + attribution analyst. Identify the main company discussed EXCLUSIVELY among: " + (ctx.companyEnum) + ". Aliases/domains: " + (JSON.stringify(ctx.companies)) + ".\n\nDECISION PROCEDURE — apply to EVERY post BEFORE answering:\n1) List each candidate company-name token that appears in the text, title, or post_url.\n2) POSITIVE ANCHOR REQUIRED: to attribute a post to a listed company you MUST be able to point to a concrete, company-specific anchor IN THIS POST — its own website domain or LinkedIn handle; a product/feature unique to it; a named founder or employee; a funding round or acquisition tied to it; a named customer; OR the company named explicitly in ITS real context (identity security / IGA / SOC / the exact category in its definition below). If you cannot cite such an anchor, set companyName to NONE. A shared or similar-looking name token, by itself, is NEVER sufficient. ALSO VALID ANCHORS: (a) SPONSOR/EXHIBITOR/PARTNER/PORTFOLIO/companies-to-watch LISTS — a listed company's EXACT full name in such a curated roster is a deliberate brand reference, not a namesake; attribute it even with no further detail (still reject fuzzy or namesake tokens). (b) LANGUAGE-AGNOSTIC — anchors may appear in any language (Hebrew, transliterated names, RTL text); translate the article mentally before applying every rule above. A domain, founder name, or exact brand token is a valid anchor regardless of language.EDIT 2 + EDIT 3 are the same workflow (xVOA25o3tZlAnSCx) — make both, publish once.\n3) NAMES ARE EXACT — reject near-miss namesakes even inside an AI / security / privacy context: 'Lumo' (Proton's chatbot) is NOT 'Lumos'; 'Optiv' is NOT 'Opti'; '[24]7.ai' / '247.ai' / '7.ai' is NOT '7AI'; 'Torch.AI' is NOT 'Torch Security'; Amazon 'Blink' / 'Blink for Home' is NOT 'BlinkOps'; 'Luminous' / 'Lumo' is NOT 'Lumos'. If the post is about the OTHER named entity, set companyName to NONE.\n4) If the token is used in a clearly different sense (a chatbot, a flower, a VPN, a game, a spell, a healthcare benchmark, a train, an airline, a mythological figure), or you are unsure which entity is meant, set companyName to NONE.\nA wrong attribution to a namesake is far worse than a NONE — when in doubt, choose NONE.\n\nCOMPANY DEFINITIONS — A post is \"about\" a company only if it concerns the specific organization below (its product, funding, people, customers, category). REJECT posts that merely share the name token but match a NOT entry or the generic/unrelated senses.\n\n" + (ctx.companyDefs||'') + "\n\nSTRICT ATTRIBUTION RULE: Attribute a post to a company ONLY if it is GENUINELY about that specific organization per its definition above (its product, people, funding, customers, or category). If the post merely shares a name token and matches a 'NOT:' entry or a generic/unrelated sense, set companyName to NONE. Concrete collisions to REJECT (set NONE): Lumos = NOT Proton's \"Lumo\" chatbot, NOT Lumos Fiber/Business Finance/Digital Outdoor/Laboratories Nigeria, NOT solar/fiber networks/Harry-Potter spell/brain-game; Surf AI = NOT Surf Air Mobility (the airline/\"BrokerOS\"/Wheels Up), NOT crypto token \"@SurfAI\"/asksurf.ai, NOT Surfshark VPN, NOT generic web-surfing; Twine = NOT Meta's internal \"Twine\"/Tupperware cluster-management platform, NOT 'digital twin' research, NOT the Twine interactive-fiction tool, NOT the Python twine PyPI tool; 7AI = NOT 247.ai/[24]7.ai contact-center AI, NOT a 'top 7 AI tools' listicle; OFFROAD = NOT off-road/4x4/overlanding vehicles or off-road driving games; Console = NOT gaming consoles (PS5/Xbox/Switch) or the developer/terminal 'console'/console.log; Torch = NOT PyTorch, NOT Torch.AI defense data-orchestration, NOT a flashlight/Olympic-torch/Torch-browser; Opti = NOT Optiv (the cybersecurity integrator is a different company), NOT Optimizely; Orchid = NOT Orchid VPN/Orchid Protocol crypto, NOT the orchid flower; Oak - Identity Security OS = the identity-security company (oak.id) — NOT the web3 audit firm \"Oak Security\", NOT Oak Ridge/Oakland/oak wood; require identity-security context or oak.id/founder names.\n\nSentiment integer -3..3. Input objects have url,title,source,articleText. Output ONLY a JSON array, one element per article with exactly: url, and companies — an array of EVERY listed company genuinely named AND anchored in the article; each element = { companyName (listed name), sentiment (int -3..3 for THIS company), reasoning (one sentence naming THIS company's anchor) }; [] if none." }, { role: 'user', content: (JSON.stringify(article)) } ] })

async function attribute(row, tries = 3) {
  const article = { url: row.url, title: row.title, source: row.source, articleText: row.articleText }
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+OA}, body: JSON.stringify(buildBody(article)) })
      if (r.status === 429) { await new Promise(s=>setTimeout(s, 4000*(i+1))); continue }
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0,120))
      const d = await r.json()
      const content = (d.choices?.[0]?.message?.content || '').replace(/```json/gi,'').replace(/```/g,'').trim()
      const a = content.indexOf('['), b = content.lastIndexOf(']'), c2 = content.indexOf('{'), e2 = content.lastIndexOf('}')
      let txt = content
      if (a !== -1 && b > a) txt = content.slice(a, b+1); else if (c2 !== -1 && e2 > c2) txt = content.slice(c2, e2+1)
      let v; try { v = JSON.parse(txt) } catch { return { ok:false, reason:'unparseable' } }
      const el = Array.isArray(v) ? (v[0] || null) : v
      let comps = []
      if (el) {
        if (Array.isArray(el.companies)) comps = el.companies.filter(x => x && x.companyName && String(x.companyName).toUpperCase() !== 'NONE')
        else if (el.companyName && String(el.companyName).toUpperCase() !== 'NONE') comps = [el]
      }
      return { ok:true, comps }
    } catch (e) { if (i === tries-1) return { ok:false, reason: String(e).slice(0,120) } }
  }
  return { ok:false, reason:'retries exhausted' }
}

let attributed = 0, none = 0, failed = 0, written = 0
const log = []
let idx = 0
const worker = async () => {
  while (idx < rows.length) {
    const row = rows[idx++]
    const res = await attribute(row)
    if (!res.ok) { failed++; log.push({ url: row.url, verdict: 'FAIL', reason: res.reason }); continue }
    const comps = res.comps
    const primary = comps[0] || null
    const company_names = comps.map(x => ({ name: x.companyName, sentiment: x.sentiment != null ? x.sentiment : null, reasoning: x.reasoning || '' }))
    const companyName = primary ? primary.companyName : 'NONE'
    const sentiment = primary && primary.sentiment != null ? primary.sentiment : null
    const post_weight = primary ? weightFor(row.url, sentiment, row.publishedAt) : null
    if (primary) attributed++; else none++
    log.push({ url: row.url, verdict: companyName, n: comps.length, pw: post_weight })
    if (COMMIT) {
      const patch = { companyName, sentiment, reasoning: primary ? (primary.reasoning || '') : 'no listed company anchored in this article', company_names, post_weight }
      const r = await fetch(BASE + '/googlenews?url=eq.' + encodeURIComponent(row.url), { method:'PATCH', headers:{...H, 'Content-Type':'application/json', Prefer:'return=minimal'}, body: JSON.stringify(patch) })
      if (r.ok) written++; else log.push({ url: row.url, verdict:'WRITE_FAIL', reason: (await r.text()).slice(0,120) })
    }
    const done = attributed + none + failed
    if (done % 50 === 0) console.log(`  ${done}/${rows.length} (attributed ${attributed}, none ${none}, failed ${failed})`)
  }
}
await Promise.all(Array.from({length: 8}, worker))
console.log(`\nDONE — attributed ${attributed}, NONE ${none}, failed ${failed}, written ${written}`)
const hits = log.filter(l => l.verdict !== 'NONE' && l.verdict !== 'FAIL')
console.log('\nattributed articles:')
for (const h of hits.slice(0, 40)) console.log(`  ${h.verdict}${h.n>1?' (+'+(h.n-1)+' more)':''}  pw=${h.pw}  ${h.url}`)
writeFileSync(join(DIR, 'backfill_news_log.json'), JSON.stringify(log, null, 1))
console.log('\nwrote sov-tooling/backfill_news_log.json')
