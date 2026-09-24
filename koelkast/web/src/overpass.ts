import {
  distanceToBBoxEdge,
  formatCoord,
  padsForRadius,
  snapBBox,
  type BBox,
} from './geometry'
import { isDrivableHighway, waysFromElements, type Way } from './matcher'
import { stopsFromElements, type StopFeature } from './stops'
import type { OsmElement } from './types'

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export async function overpass(query: string, timeoutMs: number): Promise<OsmElement[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('/api/overpass', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const raw = await response.text()
      let message = raw || `Server ${response.status}`
      try {
        const parsed = JSON.parse(raw) as { error?: string }
        if (parsed.error) message = parsed.error
      } catch {
        message = raw.slice(0, 80)
      }
      throw new OverpassError(message, response.status)
    }
    const body = (await response.json()) as { elements?: OsmElement[] }
    return body.elements ?? []
  } catch (error) {
    if (error instanceof OverpassError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new OverpassError('timeout')
    throw new OverpassError(error instanceof Error ? error.message : 'netwerkfout')
  } finally {
    clearTimeout(timer)
  }
}

const ROAD_HIGHWAYS =
  'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'

function boxArgs(box: BBox): string {
  return `${formatCoord(box.south)},${formatCoord(box.west)},${formatCoord(box.north)},${formatCoord(box.east)}`
}

export function roadQuery(box: BBox): string {
  return `[out:json][timeout:25];way["highway"~"^(${ROAD_HIGHWAYS})$"](${boxArgs(box)});out geom;`
}

export function stopsQuery(box: BBox): string {
  const bounds = boxArgs(box)
  // Bbox-filters, geen around op het hele snelwegennet: dat laat Overpass
  // te vaak timen. Service-wegen mét ref zitten zo toch in het gebied.
  return `[out:json][timeout:25];
(
  way["highway"="motorway"](${bounds});
  way["highway"="motorway_link"](${bounds});
  way["highway"="service"]["ref"](${bounds});
  node["amenity"="fuel"](${bounds});
  way["amenity"="fuel"](${bounds});
  node["highway"="rest_area"](${bounds});
  way["highway"="rest_area"](${bounds});
  node["highway"="services"](${bounds});
  way["highway"="services"](${bounds});
);
out geom;`
}

export function roadBBox(lat: number, lon: number): BBox {
  const { padLat, padLon } = padsForRadius(lat, 3000)
  return snapBBox(lat, lon, padLat, padLon, 0.02)
}

export function stopsBBox(lat: number, lon: number): BBox {
  const { padLat, padLon } = padsForRadius(lat, 60_000)
  return snapBBox(lat, lon, padLat, padLon, 0.1)
}

export type FetchState = 'leeg' | 'laden' | 'ok' | 'fout'

export class TileCache<T> {
  bbox: BBox | null = null
  data: T | null = null
  state: FetchState = 'leeg'
  error: string | null = null
  private flight: Promise<void> | null = null
  private retryAt = 0

  constructor(
    private readonly makeBox: (lat: number, lon: number) => BBox,
    private readonly marginM: number,
    private readonly load: (box: BBox) => Promise<T>,
  ) {}

  needs(lat: number, lon: number): boolean {
    if (!this.bbox || this.data == null) return true
    return distanceToBBoxEdge(lat, lon, this.bbox) < this.marginM
  }

  ensure(lat: number, lon: number): void {
    if (!this.needs(lat, lon) || this.flight || Date.now() < this.retryAt) return
    const box = this.makeBox(lat, lon)
    this.state = 'laden'
    this.error = null
    this.flight = this.load(box)
      .then((data) => {
        this.bbox = box
        this.data = data
        this.state = 'ok'
        this.error = null
        this.retryAt = 0
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : 'fout'
        this.state = this.data ? 'ok' : 'fout'
        this.retryAt = Date.now() + 15_000
      })
      .finally(() => {
        this.flight = null
      })
  }
}

export async function loadRoads(box: BBox): Promise<Way[]> {
  const elements = await overpass(roadQuery(box), 50_000)
  return waysFromElements(elements, (way) => isDrivableHighway(way.highway))
}

export type StopsPayload = { ways: Way[]; stops: StopFeature[] }

export async function loadStops(box: BBox): Promise<StopsPayload> {
  const elements = await overpass(stopsQuery(box), 90_000)
  return {
    ways: waysFromElements(
      elements,
      (way) => way.highway === 'motorway' || way.highway === 'motorway_link' || way.highway === 'service',
    ),
    stops: stopsFromElements(elements),
  }
}
