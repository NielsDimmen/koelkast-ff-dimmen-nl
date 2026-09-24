export type LatLon = { lat: number; lon: number }

export type BBox = { south: number; west: number; north: number; east: number }

const EARTH_RADIUS_M = 6_378_137

export function distanceMeters(a: LatLon, b: LatLon): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180
  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Bearing in degrees, 0 = north, 90 = east. */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Smallest signed difference, in the range -180..180. */
export function normalizeAngle(delta: number): number {
  let d = delta % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

export function destination(origin: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const δ = distanceM / EARTH_RADIUS_M
  const θ = (bearingDeg * Math.PI) / 180
  const φ1 = (origin.lat * Math.PI) / 180
  const λ1 = (origin.lon * Math.PI) / 180
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  )
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    )
  return {
    lat: (φ2 * 180) / Math.PI,
    lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  }
}

/** Local east/north offset of `point` from `origin`, in meters. */
export function eastNorth(origin: LatLon, point: LatLon): { e: number; n: number } {
  const lat0 = (origin.lat * Math.PI) / 180
  return {
    e: ((point.lon - origin.lon) * Math.PI) / 180 * Math.cos(lat0) * EARTH_RADIUS_M,
    n: ((point.lat - origin.lat) * Math.PI) / 180 * EARTH_RADIUS_M,
  }
}

/**
 * Signed distance in meters. Positive means `point` is to the right of
 * someone at `origin` looking along `bearingDeg`.
 */
export function signedSideMeters(origin: LatLon, bearingDeg: number, point: LatLon): number {
  const { e, n } = eastNorth(origin, point)
  const rad = (bearingDeg * Math.PI) / 180
  const de = Math.sin(rad)
  const dn = Math.cos(rad)
  return e * dn - n * de
}

export function projectPointOnSegment(
  p: LatLon,
  a: LatLon,
  b: LatLon,
): { point: LatLon; t: number; distance: number } {
  const ap = eastNorth(a, p)
  const ab = eastNorth(a, b)
  const ab2 = ab.e * ab.e + ab.n * ab.n
  let t = ab2 === 0 ? 0 : (ap.e * ab.e + ap.n * ab.n) / ab2
  t = Math.max(0, Math.min(1, t))
  const point = {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  }
  return { point, t, distance: distanceMeters(p, point) }
}

export type PolylineHit = {
  point: LatLon
  distance: number
  along: number
  index: number
  bearing: number
}

export function cumulativeDistances(points: LatLon[]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + distanceMeters(points[i - 1], points[i]))
  }
  return out
}

export function projectOntoPolyline(points: LatLon[], p: LatLon): PolylineHit | null {
  if (points.length < 2) return null
  let best: PolylineHit | null = null
  let along = 0
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = distanceMeters(points[i], points[i + 1])
    const proj = projectPointOnSegment(p, points[i], points[i + 1])
    if (!best || proj.distance < best.distance) {
      const bearing = segLen > 0.1 ? bearingDegrees(points[i], points[i + 1]) : 0
      best = {
        point: proj.point,
        distance: proj.distance,
        along: along + segLen * proj.t,
        index: i,
        bearing,
      }
    }
    along += segLen
  }
  return best
}

export function distanceToPolyline(points: LatLon[], p: LatLon): number {
  return projectOntoPolyline(points, p)?.distance ?? Number.POSITIVE_INFINITY
}

export function pointAlong(
  points: LatLon[],
  distanceM: number,
): { point: LatLon; index: number; bearing: number } | null {
  if (points.length === 0) return null
  if (points.length === 1 || distanceM <= 0) {
    const bearing = points.length > 1 ? bearingDegrees(points[0], points[1]) : 0
    return { point: points[0], index: 0, bearing }
  }
  let left = distanceM
  for (let i = 0; i < points.length - 1; i++) {
    const seg = distanceMeters(points[i], points[i + 1])
    if (left <= seg || i === points.length - 2) {
      const t = seg === 0 ? 0 : Math.max(0, Math.min(1, left / seg))
      return {
        point: {
          lat: points[i].lat + (points[i + 1].lat - points[i].lat) * t,
          lon: points[i].lon + (points[i + 1].lon - points[i].lon) * t,
        },
        index: i,
        bearing: seg === 0 ? 0 : bearingDegrees(points[i], points[i + 1]),
      }
    }
    left -= seg
  }
  return null
}

/** Polyline from `fromM` to `toM` along `points`, including interpolated endpoints. */
export function slicePolyline(points: LatLon[], fromM: number, toM: number): LatLon[] {
  if (points.length < 2 || toM <= fromM) return []
  const start = pointAlong(points, Math.max(0, fromM))
  const end = pointAlong(points, toM)
  if (!start || !end) return []
  const out: LatLon[] = [start.point]
  for (let i = start.index + 1; i <= end.index; i++) out.push(points[i])
  const last = out[out.length - 1]
  if (distanceMeters(last, end.point) > 0.5) out.push(end.point)
  return out
}

export function padsForRadius(lat: number, radiusM: number): { padLat: number; padLon: number } {
  return {
    padLat: radiusM / 111_320,
    padLon: radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))),
  }
}

function snap(value: number, grid: number, mode: 'down' | 'up'): number {
  const steps = value / grid
  const snapped = mode === 'down' ? Math.floor(steps + 1e-9) : Math.ceil(steps - 1e-9)
  return Math.round(snapped * grid * 1e6) / 1e6
}

export function snapBBox(
  lat: number,
  lon: number,
  padLat: number,
  padLon: number,
  grid = 0.02,
): BBox {
  return {
    south: snap(lat - padLat, grid, 'down'),
    north: snap(lat + padLat, grid, 'up'),
    west: snap(lon - padLon, grid, 'down'),
    east: snap(lon + padLon, grid, 'up'),
  }
}

/** Distance to the nearest edge. 0 when the point is outside the box. */
export function distanceToBBoxEdge(lat: number, lon: number, box: BBox): number {
  if (lat < box.south || lat > box.north || lon < box.west || lon > box.east) return 0
  return Math.min(
    distanceMeters({ lat, lon }, { lat: box.south, lon }),
    distanceMeters({ lat, lon }, { lat: box.north, lon }),
    distanceMeters({ lat, lon }, { lat, lon: box.west }),
    distanceMeters({ lat, lon }, { lat, lon: box.east }),
  )
}

export function formatCoord(n: number): string {
  return n.toFixed(5)
}
