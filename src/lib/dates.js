// Shared post-date formatting. Every place a post is displayed shows the date
// it was posted (Elan's standing preference): "Jul 5", with the year appended
// only when it isn't the current year ("Dec 30, 2025").
export function fmtPostDate(ts) {
  const dt = new Date(ts)
  if (isNaN(dt.getTime())) return ''
  const opts = { month: 'short', day: 'numeric' }
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return dt.toLocaleDateString(undefined, opts)
}
