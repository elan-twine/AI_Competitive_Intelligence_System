// Single source of truth for per-company colors.
//
// Every chart/legend/bar that colors a series *by company* must use
// `colorForCompany(name)` so a given company keeps ONE stable color
// everywhere — across the SOV trend, the sentiment trend, rankings, legends,
// and regardless of the direct/indirect/all filter (the filter changes which
// companies are shown, never which color a company gets).
//
// Color is derived from a stable hash of the company name into a fixed
// palette — no dependence on array order or the filtered set. Twine is special-
// cased to the theme accent token (light + dark safe) with a thicker stroke
// handled at the call site.

// Distinct line colors for competitors. Twine is handled separately (accent
// token), so this palette is for everyone else. Tuned for MAXIMUM hue
// separation — 16 well-spaced hues around the wheel so every tracked
// competitor gets a clearly different color, with no near-duplicate
// blues/greens sitting next to each other. Mid-saturation / mid-lightness so
// each reads on BOTH the light and dark themes.
export const LINE_COLORS = [
  '#E6194B', // red
  '#3CB44B', // green
  '#F58231', // orange
  '#4363D8', // blue
  '#911EB4', // purple
  '#F032E6', // magenta
  '#008080', // teal
  '#9A6324', // brown
  '#BCB800', // olive/yellow
  '#469990', // deep cyan-teal
  '#E377C2', // pink
  '#7F7F00', // dark olive
  '#00A5CF', // sky/cyan
  '#D45500', // burnt orange
  '#6A00FF', // indigo/violet
  '#A0521D', // sienna
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

// Stable company → color. Twine always returns the theme accent token so it
// reads correctly in both light and dark mode. Everyone else maps into
// LINE_COLORS via a hash of their name, so the color never shifts when the
// direct/indirect/all filter changes the set of visible companies.
export function colorForCompany(name) {
  if (isTwine(name)) return 'var(--accent)'
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
// Use colorForPlatform(name) to resolve a hex color with a sensible fallback.
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

export function colorForPlatform(platform, fallback = '#888') {
  return PLATFORM_COLORS[platform] || fallback
}
