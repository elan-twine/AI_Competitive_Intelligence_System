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

// 'YYYY-MM-DD' key for a Date, in the viewer's LOCAL timezone. The shared
// key-builder for week/day bucketing that aligns to the local calendar day
// (SOV weekly/daily series, drill-in weeks, competitive-review weeks).
export function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// 'YYYY-MM-DD' key in UTC — for buckets that must be timezone-independent
// (Posts-of-Interest period bucketing, whose anchor math is all UTC).
export function ymdUTC(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Human day-range label from two Dates: "Jul 2 – 8" (same month collapsed) or
// "Jul 30 – Aug 5". Options:
//   utc               — read UTC parts (for UTC-bucketed data like POI)
//   withYear          — append the end year ("Jun 16 – Jun 22, 2026")
//   collapseSameMonth — drop the repeated month when both dates share it (default
//                       true; pass false to always show both months)
// Callers add any leading "Week of " prefix themselves.
export function fmtDateRange(start, end, { utc = false, withYear = false, collapseSameMonth = true } = {}) {
  const mOpts = utc ? { month: 'short', timeZone: 'UTC' } : { month: 'short' }
  const sM = start.toLocaleDateString(undefined, mOpts)
  const eM = end.toLocaleDateString(undefined, mOpts)
  const sD = utc ? start.getUTCDate() : start.getDate()
  const eD = utc ? end.getUTCDate() : end.getDate()
  const range = (collapseSameMonth && sM === eM) ? `${sM} ${sD} – ${eD}` : `${sM} ${sD} – ${eM} ${eD}`
  if (withYear) return `${range}, ${utc ? end.getUTCFullYear() : end.getFullYear()}`
  return range
}
