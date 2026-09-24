import { distanceMeters, projectOntoPolyline, type LatLon } from './geometry'

export type AgendaEvent = {
  uid: string
  summary: string
  location: string | null
  description: string | null
  start: string
  end: string | null
  lat: number | null
  lon: number | null
  nightliner: boolean
}

export type RemainingKm = {
  km: number
  label: string
  source: 'nightliner-geo' | 'nightliner-location' | 'demo-track' | 'onbekend'
}

/** Remaining distance along a GPX/demo polyline from the current position to the end. */
export function remainingAlongTrack(points: LatLon[], here: LatLon): number | null {
  if (points.length < 2) return null
  const projection = projectOntoPolyline(points, here)
  if (!projection) return null
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i])
  return Math.max(0, total - projection.along)
}

/**
 * Format remaining km, optionally with a destination place.
 * - `destination` string → append ` · <place>`
 * - `destination` null → append ` · bestemming onbekend` (nightliner without a place)
 * - `destination` omitted/undefined → no destination part (live GPS without nightliner)
 */
export function formatRemainingKm(km: number | null, destination?: string | null): string {
  let base: string
  if (km == null || !Number.isFinite(km)) base = '– km resterend'
  else if (km < 0.5) base = '< 1 km resterend'
  else if (km >= 10) base = `${Math.round(km)} km resterend`
  else {
    base = `${km.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km resterend`
  }
  if (destination === undefined) return base
  const place = (destination ?? '').trim()
  return `${base} · ${place || 'bestemming onbekend'}`
}

/**
 * Drive destination for a nightliner event.
 * Prefer DESCRIPTION text like "Nightliner drive to Amsterdam 203km" or
 * "Nightliners to Maastricht 121km"; otherwise a short LOCATION place name
 * (not a full venue address, not lat,lon).
 */
export function nightlinerDestination(event: AgendaEvent): string | null {
  const fromDescription = placeFromDriveTo(event.description)
  if (fromDescription) return fromDescription
  if (event.location) {
    const location = event.location.trim()
    // Venue addresses ("Ziggo Dome, De Passage…") are show sites, not drive targets.
    if (location && !location.includes(',') && location.length <= 40 && !parseLatLonText(location)) {
      return location
    }
  }
  return null
}

/**
 * Extract place from nightliner drive phrasing in DESCRIPTION:
 * "Nightliner drive to Amsterdam 203km", "Nightliners drive to Maastricht 121km",
 * or "Nightliners to München 217km".
 */
export function placeFromDriveTo(text: string | null | undefined): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  const match =
    /night\s*liners?\s+(?:drives?\s+)?to\s+(.+?)(?:\s+\d+(?:[.,]\d+)?\s*km\b|(?=\s+(?:Solotech|Shuttle|Hotel|Crew|Timesheet|Event)\b)|$)/i.exec(
      flat,
    ) ?? /drives?\s+to\s+(.+?)(?:\s+\d+(?:[.,]\d+)?\s*km\b|$)/i.exec(flat)
  if (!match) return null
  return cleanPlaceName(match[1])
}

function cleanPlaceName(raw: string): string | null {
  const place = raw
    .replace(/\s+\d+(?:[.,]\d+)?\s*km\b.*$/i, '')
    .replace(/\s+(?:Solotech|Shuttle|Hotel|Crew|Timesheet|Event)\b.*$/i, '')
    .replace(/[.,;:]+$/g, '')
    .trim()
  return place || null
}

/**
 * Prefer GEO coordinates on the nightliner event. Without GEO, use crow-flies
 * only when LOCATION looks like "lat,lon"; otherwise keep null and let the UI
 * fall back to the demo track.
 */
export function remainingForNightliner(
  event: AgendaEvent,
  here: LatLon,
): RemainingKm | null {
  if (event.lat != null && event.lon != null) {
    const km = distanceMeters(here, { lat: event.lat, lon: event.lon }) / 1000
    return {
      km,
      label: event.summary,
      source: 'nightliner-geo',
    }
  }
  if (event.location) {
    const coords = parseLatLonText(event.location)
    if (coords) {
      const km = distanceMeters(here, coords) / 1000
      return {
        km,
        label: event.summary,
        source: 'nightliner-location',
      }
    }
  }
  return {
    km: Number.NaN,
    label: event.summary,
    source: 'onbekend',
  }
}

export function parseLatLonText(text: string): LatLon | null {
  const match = /(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/.exec(text)
  if (!match) return null
  const lat = Number(match[1])
  const lon = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}
