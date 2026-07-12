// Canonical LinkedIn post URL from a bare numeric activity id. Single source of
// this template (used here and by postsOfInterest's id→url path).
export function linkedinActivityUrl(id) {
  return id ? `https://www.linkedin.com/feed/update/urn:li:activity:${id}/` : ''
}

// Best-effort canonical URL for any tracked post, so EVERY item shown in the
// dashboard is openable — even when the scrape didn't store an explicit share
// URL. Falls back to constructing the URL from the platform's stable id
// (LinkedIn activity id, tweet id, Reddit permalink) when no stored link exists.
export function resolvePostUrl(p) {
  if (!p || typeof p !== 'object') return ''
  const http = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) ? u.trim() : ''
  const digits = (v) => { const m = String(v ?? '').match(/\d{6,}/); return m ? m[0] : '' }
  const plat = p.platform

  if (plat === 'LinkedIn') {
    const id = digits(p.activity_id)
      || (String(p.full_urn || '').match(/activity[:-](\d{6,})/i) || [])[1]
      || (String(p.post_url || '').match(/activity[:-](\d{6,})/i) || [])[1]
    return http(p.post_url) || linkedinActivityUrl(id)
  }
  if (plat === 'X') {
    const id = digits(p.id)
    return http(p.url) || http(p.twitterUrl) || (id ? `https://x.com/i/status/${id}` : '')
  }
  if (plat === 'Reddit') {
    const perm = p.permalink
      ? (String(p.permalink).startsWith('http') ? p.permalink : `https://www.reddit.com${p.permalink}`)
      : ''
    return http(p.url) || http(perm)
  }
  if (plat === 'Google News') return http(p.url)

  // Unknown/legacy shape (e.g. a posts_of_interest row): try common fields.
  return http(p.url) || http(p.post_url) || ''
}
