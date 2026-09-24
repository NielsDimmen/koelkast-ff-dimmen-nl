import { readFileSync } from 'node:fs'

export type AppOptions = {
  overpass_url: string
  overpass_fallback_url: string
  cache_hours: number
  bocht_drempel_graden: number
  lookahead_seconden: number
  /** Private iCalendar URL. Never expose this to the web client. */
  agenda_url: string
}

export const DEFAULT_OPTIONS: AppOptions = {
  overpass_url: 'https://overpass-api.de/api/interpreter',
  overpass_fallback_url: 'https://overpass.kumi.systems/api/interpreter',
  cache_hours: 24,
  bocht_drempel_graden: 15,
  lookahead_seconden: 8,
  agenda_url: 'https://dpf.tourmanagement.com/icalendar/ybTnYwuRyGogFPXzcR3qZiVF38N9acmk',
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export function optionsFromUnknown(raw: unknown): AppOptions {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    overpass_url: typeof source.overpass_url === 'string' && source.overpass_url ? source.overpass_url : DEFAULT_OPTIONS.overpass_url,
    overpass_fallback_url:
      typeof source.overpass_fallback_url === 'string' ? source.overpass_fallback_url : DEFAULT_OPTIONS.overpass_fallback_url,
    cache_hours: num(source.cache_hours, DEFAULT_OPTIONS.cache_hours),
    bocht_drempel_graden: num(source.bocht_drempel_graden, DEFAULT_OPTIONS.bocht_drempel_graden),
    lookahead_seconden: num(source.lookahead_seconden, DEFAULT_OPTIONS.lookahead_seconden),
    agenda_url: typeof source.agenda_url === 'string' ? source.agenda_url : DEFAULT_OPTIONS.agenda_url,
  }
}

export function readOptions(path = process.env.OPTIONS_PATH ?? '/data/options.json'): AppOptions {
  try {
    return optionsFromUnknown(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_OPTIONS }
  }
}
