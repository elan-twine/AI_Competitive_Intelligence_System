// Tiny client-side CSV export — no dependencies, no server round-trip.
// Values are quoted when needed; arrays/objects are JSON-stringified.

function cell(v) {
  if (v == null) return ''
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

// rows: array of plain objects. columns: [{ key, label }] (order + headers);
// omit to derive from the first row's keys.
export function toCSV(rows, columns) {
  if (!rows?.length) return ''
  const cols = columns || Object.keys(rows[0]).map(k => ({ key: k, label: k }))
  const head = cols.map(c => cell(c.label)).join(',')
  const body = rows.map(r => cols.map(c => cell(typeof c.key === 'function' ? c.key(r) : r[c.key])).join(','))
  return [head, ...body].join('\n')
}

export function downloadCSV(filename, rows, columns) {
  const csv = toCSV(rows, columns)
  if (!csv) return
  // BOM so Excel opens UTF-8 (competitor names, arrows) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
