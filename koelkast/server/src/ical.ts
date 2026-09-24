/** Pure iCalendar helpers used on the server and mirrored in web types. */

export type AgendaEvent = {
  uid: string
  summary: string
  location: string | null
  description: string | null
  start: string
  end: string | null
  /** Degrees north, east when GEO is present. */
  lat: number | null
  lon: number | null
  nightliner: boolean
}

const NIGHTLINER_RE = /night\s*liner|nachtliner|nacht\s*liner|\bnl\b|nachtlijn/i

export function isNightlinerText(...parts: (string | null | undefined)[]): boolean {
  return parts.some((part) => part != null && NIGHTLINER_RE.test(part))
}

/** Unfold folded ICS lines (RFC 5545). */
export function unfoldIcal(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
}

function unescapeIcal(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function parseIcalDate(value: string): string | null {
  const clean = value.trim()
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(clean)
  if (!match) return null
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = match
  if (h === '00' && mi === '00' && s === '00' && !clean.includes('T')) {
    return `${y}-${mo}-${d}T00:00:00.000Z`
  }
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseGeo(value: string): { lat: number; lon: number } | null {
  const parts = value.split(/[;,]/).map((part) => Number(part.trim()))
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
  return { lat: parts[0], lon: parts[1] }
}

/**
 * Extract VEVENT blocks. LOCATION / GEO / DESCRIPTION feed remaining-km logic.
 */
export function parseIcalendar(raw: string): AgendaEvent[] {
  const text = unfoldIcal(raw)
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1)
  const events: AgendaEvent[] = []
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0] ?? block
    const fields = new Map<string, string>()
    for (const line of body.split('\n')) {
      const colon = line.indexOf(':')
      if (colon < 0) continue
      const left = line.slice(0, colon)
      const name = left.split(';')[0].toUpperCase()
      fields.set(name, unescapeIcal(line.slice(colon + 1).trim()))
    }
    const summary = fields.get('SUMMARY') ?? ''
    const location = fields.get('LOCATION') || null
    const description = fields.get('DESCRIPTION') || null
    const startRaw = fields.get('DTSTART')
    if (!startRaw) continue
    const start = parseIcalDate(startRaw)
    if (!start) continue
    const end = fields.get('DTEND') ? parseIcalDate(fields.get('DTEND')!) : null
    const geo = fields.get('GEO') ? parseGeo(fields.get('GEO')!) : null
    events.push({
      uid: fields.get('UID') ?? `${start}-${summary}`,
      summary,
      location,
      description,
      start,
      end,
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
      nightliner: isNightlinerText(summary, location, description),
    })
  }
  return events.sort((a, b) => a.start.localeCompare(b.start))
}

/**
 * End of a nightliner window when DTEND is missing.
 * Date-only show/travel days must cover the overnight departure (often 00:30–02:00
 * the next calendar day), so use 36h instead of a short 8h daytime window.
 */
export function nightlinerEndMs(event: AgendaEvent): number {
  if (event.end) return Date.parse(event.end)
  const start = Date.parse(event.start)
  const dateOnly = /T00:00:00(\.000)?Z$/.test(event.start)
  return start + (dateOnly ? 36 : 8) * 3600_000
}

/** Current nightliner window, or the next upcoming one. */
export function pickNightliner(events: AgendaEvent[], now = new Date()): AgendaEvent | null {
  const nightliners = events.filter((event) => event.nightliner)
  if (nightliners.length === 0) return null
  const t = now.getTime()
  for (const event of nightliners) {
    const start = Date.parse(event.start)
    const end = nightlinerEndMs(event)
    if (t >= start && t <= end) return event
  }
  for (const event of nightliners) {
    if (Date.parse(event.start) >= t) return event
  }
  return null
}
