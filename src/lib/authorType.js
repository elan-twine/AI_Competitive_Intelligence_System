// Single source of the author-type classification: 'company' | 'employee' |
// 'external'. useSOVData stamps it on every post; downstream consumers (the
// drill-in badges, Social Briefs) read that stamp so the rule never drifts
// between call sites.
//
// LinkedIn is ternary: company = the tracked competitor's own page URN;
// employee = the author_affiliation classifier confirmed them OR the company
// name appears in the author's headline; else external. X is binary via the
// `authorWeight` tier marker the pipeline stamps (1 = the company's own
// account, else external). News/Reddit carry no author signal → always external.
//
// `urnSet` — Set of tracked competitor page URNs (profile_id).
// `empKeys` — Set of `${companyName.toLowerCase()}|${profile_id}` the employee
//             classifier confirmed. Either may be omitted (treated as empty).
export function authorTypeOf(post, { urnSet, empKeys } = {}) {
  if (post.platform === 'X') return (Number(post.authorWeight) || 5) <= 1 ? 'company' : 'external'
  if (post.platform !== 'LinkedIn') return 'external'
  const a = post.author && typeof post.author === 'object' ? post.author : {}
  const prof = String(a.profile_id || '')
  if (prof && urnSet && urnSet.has(prof)) return 'company'
  const head = String(a.headline || '').toLowerCase()
  const cn = String(post.companyName || '').toLowerCase()
  if (prof && cn && empKeys && empKeys.has(`${cn}|${prof}`)) return 'employee'  // classifier-confirmed
  if (cn && head.includes(cn)) return 'employee'
  return 'external'
}
