// A stored post row can credit SEVERAL tracked companies: the attribution gate
// writes every company genuinely named in a post into `company_names`
// ([{ name, sentiment, reasoning }]) and keeps the first one in `companyName`.
//
// The board RPC (sov_board_agg) unnests `company_names`, so each listed company
// gets the post's weight. Every post-level view must do the same, or a post
// counts toward a company's score while being absent from that company's lists
// (2026-11-17: a Gartner "Premier Sponsors" post scored for Twine but was only
// listed under Oak).
//
// fanOutCompanies(row) -> one post object per credited company. Mirrors the RPC:
//   - `company_names` non-empty  -> one entry per listed company (name from the list)
//   - otherwise                  -> the row as-is (single `companyName`)
// Each copy carries THAT company's sentiment/reasoning, plus `coCredited` (all
// names on the row) when more than one company shares the post.
export function fanOutCompanies(row) {
  if (!row) return []
  const list = Array.isArray(row.company_names)
    ? row.company_names.filter(c => c && typeof c.name === 'string' && c.name.trim() && c.name !== 'NONE')
    : []
  if (list.length === 0) return [row]
  const seen = new Set()
  const out = []
  for (const c of list) {
    const k = c.name.trim().toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    const isPrimary = c.name === row.companyName
    out.push({
      ...row,
      companyName: c.name,
      // The list entry is authoritative for its company; fall back to the row's
      // own sentiment only for the primary company (older rows / manual edits).
      sentiment: c.sentiment != null ? c.sentiment : (isPrimary ? (row.sentiment ?? null) : null),
      reasoning: c.reasoning || (isPrimary ? row.reasoning : '') || '',
    })
  }
  if (out.length > 1) {
    const names = out.map(p => p.companyName)
    for (const p of out) p.coCredited = names
  }
  return out
}
