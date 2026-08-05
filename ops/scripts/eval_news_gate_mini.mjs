#!/usr/bin/env node
// ============================================================================
// eval_news_gate_mini.mjs — can gpt-4.1-mini replace gpt-4.1 on the News
// sentiment+attribution gate? Replays the EXACT prod prompt (system rebuilt
// from the live competitors table with the workflow's own construction code;
// user = the stored article row, label fields stripped) against a labelled
// sample from googlenews, for BOTH models, and scores agreement with the
// stored verdicts (incl. human-flagged misattributed rows, where the stored
// gpt-4.1 answer was WRONG).
//
// Setup: drop Twine's OpenAI key into sov-tooling/.oakey (chmod 600).
// Run:   node sov-tooling/eval_news_gate_mini.mjs [--mini-only] [--n 60]
// Cost:  ~120 articles x ~6k tok x 2 models ~= $2-3 (mini alone ~$0.30).
// Output: summary to stdout + sov-tooling/eval_mini_results.csv
// ============================================================================
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const SB = readFileSync(join(DIR, '.sbkey'), 'utf8').trim()
let OA
try { OA = readFileSync(join(DIR, '.oakey'), 'utf8').trim() } catch {
  console.error('Missing sov-tooling/.oakey — put Twine\'s OpenAI API key there (chmod 600) and re-run.')
  process.exit(1)
}
const BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
const H = { apikey: SB, Authorization: 'Bearer ' + SB }
const MINI_ONLY = process.argv.includes('--mini-only')
const N = Number((process.argv.find(a => a.startsWith('--n')) || '').split('=')[1] || 60)

const get = async (path) => { const r = await fetch(BASE + path, { headers: H }); if (!r.ok) throw new Error(path + ' -> ' + r.status); return r.json() }

// --- rebuild the gate's shared context exactly like the workflow's 'Load Shared Context' node ---
const competitors = await get('/competitors?select=*&order=name.asc')
const active = competitors.filter(c => c.active !== false)
const companies = active.map(c => ({ name: c.name, keywords: Array.isArray(c.keywords)?c.keywords:[], definition: c.definition||'', collision_terms: Array.isArray(c.collision_terms)?c.collision_terms:[], aliases: Array.isArray(c.aliases) ? c.aliases : [], domain: c.domain || null, x_handle: c.x_handle || null, linkedin_urn: c.linkedin_urn || null, subreddits: Array.isArray(c.subreddits) ? c.subreddits : [], type: c.type || 'direct' }))
const companyEnum = companies.filter(c => (c.type||'direct')!=='indirect').map(c => c.name).join(", ")
const companyDefs = companies.filter(c => (c.type||'direct')!=='indirect').map(c=>{const dom=c.domain?(' ('+c.domain+')'):'';const nots=(c.collision_terms&&c.collision_terms.length)?('. NOT: '+c.collision_terms.join('; ')):'';return c.name+dom+' \u2014 '+(c.definition||'(no definition yet)')+nots;}).join('\n\n')
const ctx = { companies, companyEnum, companyDefs }

// --- labelled sample (strip verdict fields from what the model sees) ---
const FIELDS = 'url,title,source,articleText,publishedAt,companyName,misattributed'
const attributed = await get(`/googlenews?select=${FIELDS}&companyName=not.is.null&companyName=neq.NONE&articleText=not.is.null&misattributed=is.false&order=publishedAt.desc&limit=${N}`)
const nones = await get(`/googlenews?select=${FIELDS}&companyName=eq.NONE&articleText=not.is.null&order=publishedAt.desc&limit=${N}`)
const flagged = await get(`/googlenews?select=${FIELDS}&misattributed=is.true&articleText=not.is.null&limit=50`)
const sample = [...attributed.map(a=>({ ...a, label: a.companyName, kind: 'attributed' })),
                ...nones.map(a=>({ ...a, label: 'NONE', kind: 'none' })),
                ...flagged.map(a=>({ ...a, label: 'NOT ' + a.companyName, kind: 'misattributed' }))]
console.log(`sample: ${attributed.length} attributed + ${nones.length} NONE + ${flagged.length} human-flagged = ${sample.length}`)

const buildBody = (MODEL, row) => {
  const article = { url: row.url, title: row.title, source: row.source, articleText: row.articleText }
  return { model: MODEL, temperature: 0, messages: [ { role: 'system', content: "You are an expert sentiment + attribution analyst. Identify the main company discussed EXCLUSIVELY among: " + (ctx.companyEnum) + ". Aliases/domains: " + (JSON.stringify(ctx.companies)) + ".\n\nDECISION PROCEDURE — apply to EVERY post BEFORE answering:\n1) List each candidate company-name token that appears in the text, title, or post_url.\n2) POSITIVE ANCHOR REQUIRED: to attribute a post to a listed company you MUST be able to point to a concrete, company-specific anchor IN THIS POST — its own website domain or LinkedIn handle; a product/feature unique to it; a named founder or employee; a funding round or acquisition tied to it; a named customer; OR the company named explicitly in ITS real context (identity security / IGA / SOC / the exact category in its definition below). If you cannot cite such an anchor, set companyName to NONE. A shared or similar-looking name token, by itself, is NEVER sufficient. ALSO VALID ANCHORS: (a) SPONSOR/EXHIBITOR/PARTNER/PORTFOLIO/companies-to-watch LISTS — a listed company's EXACT full name in such a curated roster is a deliberate brand reference, not a namesake; attribute it even with no further detail (still reject fuzzy or namesake tokens). (b) LANGUAGE-AGNOSTIC — anchors may appear in any language (Hebrew, transliterated names, RTL text); translate the article mentally before applying every rule above. A domain, founder name, or exact brand token is a valid anchor regardless of language.EDIT 2 + EDIT 3 are the same workflow (xVOA25o3tZlAnSCx) — make both, publish once.\n3) NAMES ARE EXACT — reject near-miss namesakes even inside an AI / security / privacy context: 'Lumo' (Proton's chatbot) is NOT 'Lumos'; 'Optiv' is NOT 'Opti'; '[24]7.ai' / '247.ai' / '7.ai' is NOT '7AI'; 'Torch.AI' is NOT 'Torch Security'; Amazon 'Blink' / 'Blink for Home' is NOT 'BlinkOps'; 'Luminous' / 'Lumo' is NOT 'Lumos'. If the post is about the OTHER named entity, set companyName to NONE.\n4) If the token is used in a clearly different sense (a chatbot, a flower, a VPN, a game, a spell, a healthcare benchmark, a train, an airline, a mythological figure), or you are unsure which entity is meant, set companyName to NONE.\nA wrong attribution to a namesake is far worse than a NONE — when in doubt, choose NONE.\n\nCOMPANY DEFINITIONS — A post is \"about\" a company only if it concerns the specific organization below (its product, funding, people, customers, category). REJECT posts that merely share the name token but match a NOT entry or the generic/unrelated senses.\n\n" + (ctx.companyDefs||'') + "\n\nSTRICT ATTRIBUTION RULE: Attribute a post to a company ONLY if it is GENUINELY about that specific organization per its definition above (its product, people, funding, customers, or category). If the post merely shares a name token and matches a 'NOT:' entry or a generic/unrelated sense, set companyName to NONE. Concrete collisions to REJECT (set NONE): Lumos = NOT Proton's \"Lumo\" chatbot, NOT Lumos Fiber/Business Finance/Digital Outdoor/Laboratories Nigeria, NOT solar/fiber networks/Harry-Potter spell/brain-game; Surf AI = NOT Surf Air Mobility (the airline/\"BrokerOS\"/Wheels Up), NOT crypto token \"@SurfAI\"/asksurf.ai, NOT Surfshark VPN, NOT generic web-surfing; Twine = NOT Meta's internal \"Twine\"/Tupperware cluster-management platform, NOT 'digital twin' research, NOT the Twine interactive-fiction tool, NOT the Python twine PyPI tool; 7AI = NOT 247.ai/[24]7.ai contact-center AI, NOT a 'top 7 AI tools' listicle; OFFROAD = NOT off-road/4x4/overlanding vehicles or off-road driving games; Console = NOT gaming consoles (PS5/Xbox/Switch) or the developer/terminal 'console'/console.log; Torch = NOT PyTorch, NOT Torch.AI defense data-orchestration, NOT a flashlight/Olympic-torch/Torch-browser; Opti = NOT Optiv (the cybersecurity integrator is a different company), NOT Optimizely; Orchid = NOT Orchid VPN/Orchid Protocol crypto, NOT the orchid flower; Oak - Identity Security OS = the identity-security company (oak.id) — NOT the web3 audit firm \"Oak Security\", NOT Oak Ridge/Oakland/oak wood; require identity-security context or oak.id/founder names.\n\nSentiment integer -3..3. Input objects have url,title,source,articleText. Output ONLY a JSON array, one element per article with exactly: url, and companies — an array of EVERY listed company genuinely named AND anchored in the article; each element = { companyName (listed name), sentiment (int -3..3 for THIS company), reasoning (one sentence naming THIS company's anchor) }; [] if none." }, { role: 'user', content: (JSON.stringify(article)) } ] }
}

const callModel = async (model, row, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OA },
        body: JSON.stringify(buildBody(model, row)),
      })
      if (r.status === 429) { await new Promise(s => setTimeout(s, 4000 * (i + 1))); continue }
      if (!r.ok) throw new Error(model + ' ' + r.status + ' ' + (await r.text()).slice(0, 120))
      const d = await r.json()
      // Mirror the FIXED prod parser: a bare "[]" (or companies:[]) is a valid
      // NONE verdict, not a parse failure — that conflation is exactly the bug
      // this eval exists downstream of.
      const content = (d.choices?.[0]?.message?.content || '').replace(/```json/gi,'').replace(/```/g,'').trim()
      let v = null
      try {
        const a = content.indexOf('['), b = content.lastIndexOf(']')
        const c = content.indexOf('{'), e2 = content.lastIndexOf('}')
        let txt = content
        if (a !== -1 && b > a) txt = content.slice(a, b + 1)
        else if (c !== -1 && e2 > c) txt = content.slice(c, e2 + 1)
        v = JSON.parse(txt)
      } catch { return { company: 'PARSE_FAIL', raw: content.slice(0, 160) } }
      const el = Array.isArray(v) ? (v[0] || null) : v
      let comps = []
      if (el) {
        if (Array.isArray(el.companies)) comps = el.companies.filter(x => x && x.companyName && String(x.companyName).toUpperCase() !== 'NONE')
        else if (el.companyName && String(el.companyName).toUpperCase() !== 'NONE') comps = [el]
      }
      return { company: comps.length ? String(comps[0].companyName) : 'NONE', raw: content.slice(0, 160) }
    } catch (e) { if (i === tries - 1) return { company: 'ERROR', raw: String(e).slice(0, 160) } }
  }
  return { company: 'ERROR', raw: 'retries exhausted' }
}

// Pass 1: mini over the whole sample. Pass 2: gpt-4.1 ONLY on the rows mini
// disagreed with — the stored labels were produced by 4.1 at an earlier time
// with an older roster/definitions, so a disagreement can mean "mini is worse"
// OR "the prompt drifted since". Re-scoring just those separates the two at a
// fraction of the cost of a full control run (Elan, 2026-08-05).
const results = []
const POOL = 8
const runModel = async (model, rows) => {
  let idx = 0, done = 0
  const worker = async () => {
    while (idx < rows.length) {
      const row = rows[idx++]
      const out = await callModel(model, row)
      results.push({ model, kind: row.kind, label: row.label, got: out.company, url: row.url, raw: out.raw })
      if (++done % 25 === 0) console.log(`  ${model}: ${done}/${rows.length}`)
    }
  }
  await Promise.all(Array.from({ length: POOL }, worker))
}

const norm0 = (s) => String(s || '').trim().toLowerCase()
const agrees = (r) => r.kind === 'none' ? norm0(r.got) === 'none' : norm0(r.got) === norm0(r.label)

await runModel('gpt-4.1-mini', sample)
const disagreed = results.filter(r => r.model === 'gpt-4.1-mini' && r.kind !== 'misattributed' && !agrees(r))
  .map(r => sample.find(s => s.url === r.url)).filter(Boolean)
console.log(`\nmini disagreed on ${disagreed.length}/${sample.length} — re-scoring just those with gpt-4.1 as control`)
if (!MINI_ONLY && disagreed.length) await runModel('gpt-4.1', disagreed)
const models = [...new Set(results.map(r => r.model))]

// --- score ---
const norm = norm0
for (const model of models) {
  const rs = results.filter(r => r.model === model)
  const att = rs.filter(r => r.kind === 'attributed')
  const non = rs.filter(r => r.kind === 'none')
  const flg = rs.filter(r => r.kind === 'misattributed')
  const attOk = att.filter(r => norm(r.got) === norm(r.label)).length
  const nonOk = non.filter(r => norm(r.got) === 'none').length
  const flgOk = flg.filter(r => norm(r.got) !== norm(r.label.replace(/^NOT /, ''))).length
  console.log(`\n===== ${model}${model === 'gpt-4.1' ? ' (control: only mini\'s disagreements)' : ''}`)
  console.log(`attributed agreement: ${attOk}/${att.length}`)
  console.log(`NONE (rejection) agreement: ${nonOk}/${non.length}`)
  console.log(`human-flagged (should NOT repeat the known-wrong answer): ${flgOk}/${flg.length}`)
  for (const r of rs.filter(r => (r.kind === 'attributed' && norm(r.got) !== norm(r.label)) || (r.kind === 'none' && norm(r.got) !== 'none')))
    console.log(`  DISAGREE [${r.kind}] expected=${r.label} got=${r.got} ${r.url}`)
}
const csv = 'model,kind,label,got,url\n' + results.map(r => [r.model, r.kind, JSON.stringify(r.label), JSON.stringify(r.got), r.url].join(',')).join('\n')
writeFileSync(join(DIR, 'eval_mini_results.csv'), csv)
console.log('\nwrote sov-tooling/eval_mini_results.csv')
