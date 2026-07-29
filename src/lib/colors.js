// Single source of truth for per-company colors.
//
// Every chart/legend/bar that colors a series *by company* must use
// `colorForCompany(name)` so a given company keeps ONE stable color
// everywhere — across the SOV trend, the sentiment trend, rankings, legends,
// and regardless of the direct/indirect/all filter (the filter changes which
// companies are shown, never which color a company gets).
//
// Colors are assigned by each company's index in the SORTED roster
// (registerCompanyColors, called once the competitor list loads), so every
// tracked company gets a UNIQUE palette slot — hashing collided (~13 names
// into 16 buckets put Redblock/Surf AI/Torch on the same color). The hash
// only remains as a fallback for names that were never registered. Twine is
// special-cased to the theme accent token (light + dark safe) with a thicker
// stroke handled at the call site.

// Distinct line colors for competitors. Twine is handled separately (accent
// token #DBFE02 chartreuse — no yellow-greens anywhere in this list so lime
// stays exclusively Twine's), and this palette is for everyone else. MUTED by
// design (premium finish, 2026-07-29): ~40-50% saturation, mid lightness, so
// eleven simultaneous lines read as a calm field with Twine's lime as the
// protagonist — not a rainbow. ORDER MATTERS: roster slots are assigned
// front-to-back, so the first ~13 hues are tuned for maximum mutual
// separation; the tail is headroom for roster growth. Each survives BOTH the
// light and dark themes (darker than the dark-only mock pastels on purpose).
export const LINE_COLORS = [
  '#7C9BE6', // soft blue
  '#B48FD9', // lavender
  '#56B79F', // teal
  '#DD9A62', // sand orange
  '#D98BA8', // rose
  '#8B95A7', // slate
  '#5FA8CC', // sky
  '#C08472', // terracotta
  '#7FAF7C', // sage
  '#C2A05F', // camel
  '#9A8FE0', // periwinkle
  '#D9857A', // coral
  '#6FB5AD', // aqua
  '#B786BD', // orchid
  '#8598D9', // cornflower
  '#C99270', // caramel
  '#74AE9A', // pine
  '#B08D9E', // mauve
  '#98A6C4', // powder slate
  '#C4907F', // clay
]

export const isTwine = (name) => /twine/i.test(name || '')

// Deterministic 32-bit string hash (FNV-1a-ish). Same input → same output,
// stable across reloads and independent of any list ordering.
function hashName(name) {
  const s = String(name || '').trim().toLowerCase()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Roster registry: normalized company name → unique palette color. Built by
// registerCompanyColors from the FULL competitor roster (sorted, so assignment
// is deterministic regardless of fetch/filter order) and rebuilt on each call.
const rosterColors = new Map()

// Assign every roster name its own palette slot. Sorted case-insensitively so
// the same roster always yields the same colors; Twine is skipped (accent).
// Call with ALL competitors (active + inactive) so companies with residual
// historical posts keep a stable, unique color too. Names beyond the palette
// wrap (unavoidable past 20 companies — grow LINE_COLORS then).
export function registerCompanyColors(names) {
  rosterColors.clear()
  const roster = [...new Set(
    (names || []).map(n => String(n || '').trim()).filter(n => n && !isTwine(n))
  )].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  roster.forEach((name, i) => {
    rosterColors.set(name.toLowerCase(), LINE_COLORS[i % LINE_COLORS.length])
  })
}

// Stable company → color. Twine always returns the theme accent token so it
// reads correctly in both light and dark mode. Registered roster companies get
// their unique slot; unregistered names (shouldn't happen once the roster
// loads) fall back to the old hash so they still render deterministically.
// Either way the color never shifts when the direct/indirect/all or platform
// filters change the set of visible companies.
export function colorForCompany(name) {
  if (isTwine(name)) return 'var(--accent)'
  const registered = rosterColors.get(String(name || '').trim().toLowerCase())
  if (registered) return registered
  return LINE_COLORS[hashName(name) % LINE_COLORS.length]
}

// ---------------------------------------------------------------------------
// Single source of truth for per-PLATFORM colors (X / Reddit / Google News /
// LinkedIn). Previously each dashboard component kept its own literal color
// map, which drifted out of sync. Two shapes are exported so every call site
// keeps its exact rendered value with no visual change:
//   - PLATFORM_COLORS: literal hex, for inline styles / SVG fills.
//   - PLATFORM_COLOR_VAR: theme CSS custom properties, for components that
//     want light/dark-aware colors via var().
// ---------------------------------------------------------------------------
export const PLATFORM_COLORS = {
  'X': '#8B5CF6',        // violet — distinct from LinkedIn blue on both themes (X's own black/white would vanish in one theme)
  'Reddit': '#FF4500',
  'Google News': '#34D399',
  'LinkedIn': '#0A66C2',
}

export const PLATFORM_COLOR_VAR = {
  'X': 'var(--x-color)',
  'Reddit': 'var(--reddit-color)',
  'Google News': 'var(--news-color)',
  'LinkedIn': 'var(--linkedin-color)',
}
